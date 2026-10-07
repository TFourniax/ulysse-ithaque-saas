import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { ModelSettings } from '@ulysse/ai';
import { ModelError, ScriptedProvider } from '@ulysse/ai';
import type { Connector } from '@ulysse/connectors';
import {
  ConnectorError,
  createRegistry,
  commercialFixture,
  FixtureConnector,
  MemoryFixtureStore,
} from '@ulysse/connectors';
import type { Pool } from '@ulysse/database';
import { AdminClient, createPool, PgUnitOfWork, QUEUES } from '@ulysse/database';
import type { TestDatabase } from '@ulysse/database/testing';
import { createTestDatabase } from '@ulysse/database/testing';
import type { ServiceDeps } from '@ulysse/domain';
import {
  CompanyContextService,
  ConnectionService,
  defaultRules,
  DoctrineService,
  QueryService,
  ReviewService,
  systemClock,
  agentInputHash,
} from '@ulysse/domain';
import {
  FIXTURE_CONTEXT,
  FIXTURE_DOCTRINE,
  fixtureCatalog,
  serviceContext,
  userContext,
} from '@ulysse/domain/testing';
import { createLogger, createMetrics } from '@ulysse/observability';
import { loadWorkerConfig } from '../src/config.ts';
import { AgentRuntime, agentConfig, MAX_ATTEMPTS, TOOL_NAMES } from '../src/agent-runtime.ts';
import type { FaultHooks } from '../src/runtime.ts';
import { noCredentialStore, WorkerRuntime } from '../src/runtime.ts';

// Versioned instructions Hermes sends once the Ulysse plugin has set the system prompt.
const instructions = await readFile(
  new URL('../../../services/hermes/instructions.txt', import.meta.url),
  'utf8',
);

describe('UL-016 agent pipeline with real PostgreSQL roles', () => {
  async function world(
    name: string,
    company: 'acme' | 'globex' = 'acme',
    scenario: Parameters<typeof commercialFixture>[1] = 'baseline',
  ) {
    const data = commercialFixture(company, scenario);
    store.upsert(name, 'OPP-001', stalled('OPP-001', 12, { commercial: data }), iso(-1000));
    const w = await tenantWorld(name, name);
    const connection = await w.connect();
    const agent = new AgentRuntime(workerPool, agentConfig({ ULYSSE_ANALYSIS_MODE: 'simulated' }));
    const runtime = runtimeWith({ agent });
    await runtime.handleSync(
      { tenantId: w.tenantId, connectionId: connection.id, trigger: 'initial' },
      crypto.randomUUID(),
    );
    const ctx = serviceContext(w.tenantId, ['analysis:run']);
    const o = await agent.store.transaction(ctx, (tx) =>
      tx.getOpportunityByExternalId(connection.id, 'OPP-001'),
    );
    assert.ok(o);
    return { ...w, agent, runtime, ctx, o, connection };
  }
  test('two tenants with the same external identifier use tools and publish separate references; replay is idempotent', async () => {
    const a = await world('agent-acme');
    const b = await world('agent-globex', 'globex');
    await Promise.all([
      a.agent.analyze(a.ctx, 'source_change'),
      b.agent.analyze(b.ctx, 'source_change'),
    ]);
    for (const w of [a, b]) {
      const recs = await w.open();
      assert.equal(recs.length, 1);
      assert.equal(recs[0]?.ruleId, 'ulysse.agent.v1');
      const runs = await w.agent.store.list(w.owner);
      const run = runs[0];
      assert.ok(run);
      assert.equal(run.status, 'completed');
      assert.ok(Number(run.tool_calls) >= 6);
      await w.agent.analyze(w.ctx, 'source_change');
      assert.equal((await w.open()).length, 1);
      assert.equal((await w.agent.store.list(w.owner)).length, 1);
      const detail = await w.queries.getRecommendation(w.owner, recs[0].id);
      assert.ok(detail.evidence.every((e) => e.tenantId === w.tenantId));
      assert.ok(detail.evidence.some((e) => e.factType === 'commercial_context'));
    }
    assert.equal(await a.agent.store.transaction(a.owner, (tx) => tx.getOpportunity(b.o.id)), null);
  });
  test('pause, opposition and absent exchanges produce no contact recommendation', async () => {
    for (const scenario of ['pause', 'opposition', 'insufficient'] as const) {
      const w = await world(`agent-${scenario}`, 'acme', scenario);
      await w.agent.analyze(w.ctx, 'source_change');
      assert.equal((await w.open()).length, 0);
      assert.equal((await w.agent.store.list(w.owner))[0]?.status, 'abstained');
    }
  });
  test('human decisions persist, viewer cannot decide, and rejection suppresses regeneration', async () => {
    const w = await world('agent-review');
    await w.agent.analyze(w.ctx, 'source_change');
    const rec = (await w.open())[0];
    assert.ok(rec);
    const review = new ReviewService({
      uow: new PgUnitOfWork(appPool),
      clock: systemClock,
      ids: { next: () => crypto.randomUUID() },
      rules: defaultRules,
    });
    await assert.rejects(
      review.decide(
        {
          ...w.owner,
          actor: {
            kind: 'user',
            userId: w.owner.actor.kind === 'user' ? w.owner.actor.userId : '',
            role: 'viewer',
          },
        },
        rec.id,
        { expectedRevision: rec.revision, decision: 'approve', reason: null },
        crypto.randomUUID(),
      ),
    );
    const key = crypto.randomUUID();
    const decision = await review.decide(
      w.owner,
      rec.id,
      { expectedRevision: rec.revision, decision: 'reject', reason: 'À clarifier' },
      key,
    );
    assert.equal(decision.decision.decision, 'reject');
    assert.equal(
      (
        await review.decide(
          w.owner,
          rec.id,
          { expectedRevision: rec.revision, decision: 'reject', reason: 'À clarifier' },
          key,
        )
      ).replayed,
      true,
    );
    await w.agent.analyze(w.ctx, 'manual');
    assert.equal((await w.open()).length, 0);
  });
  test('related history has stable versions and a concurrent human decision invalidates publication', async () => {
    const w = await world('agent-history-version');
    await w.agent.analyze(w.ctx, 'source_change');
    const previous = (await w.open())[0];
    assert.ok(previous);
    store.upsert(
      'agent-history-version',
      'OPP-001',
      stalled('OPP-001', 12, { commercial: commercialFixture('acme', 'positive_reply') }),
      iso(0),
    );
    await w.runtime.handleSync(
      { tenantId: w.tenantId, connectionId: w.connection.id, trigger: 'manual' },
      crypto.randomUUID(),
    );
    const review = new ReviewService({
      uow: new PgUnitOfWork(appPool),
      clock: systemClock,
      ids: { next: () => crypto.randomUUID() },
      rules: defaultRules,
    });
    const runner: AgentRuntime = new AgentRuntime(workerPool, liveTestConfig(), {
      execute: async (request) => {
        await runner.tool(request.capability, 'get_opportunity', {});
        await runner.tool(request.capability, 'get_active_doctrine', {});
        await runner.tool(request.capability, 'get_company_context', {});
        const history = await runner.tool(request.capability, 'list_related_recommendations', {
          limit: 1,
        });
        assert.ok(
          JSON.stringify(history).includes(
            `recommendation:${previous.id}:r${String(previous.revision)}`,
          ),
        );
        await review.decide(
          w.owner,
          previous.id,
          {
            expectedRevision: previous.revision,
            decision: 'reject',
            reason: 'Décision pendant analyse',
          },
          crypto.randomUUID(),
        );
        return abstention;
      },
    });
    await runner.run(w.ctx, w.o.id, 'test');
    const run = (await runner.store.list(w.owner)).find((r) => r.error_code === 'history_changed');
    assert.ok(run);
    assert.equal(run.status, 'obsolete');
    assert.equal((await w.open()).length, 0);
  });
  test('a technical error records failure without closing an existing proposal', async () => {
    const w = await world('agent-technical-error');
    await w.agent.analyze(w.ctx, 'source_change');
    const previous = (await w.open())[0];
    assert.ok(previous);
    store.upsert(
      'agent-technical-error',
      'OPP-001',
      stalled('OPP-001', 12, { commercial: commercialFixture('acme', 'positive_reply') }),
      iso(0),
    );
    await w.runtime.handleSync(
      { tenantId: w.tenantId, connectionId: w.connection.id, trigger: 'manual' },
      crypto.randomUUID(),
    );
    const runner: AgentRuntime = new AgentRuntime(workerPool, liveTestConfig(), {
      execute: async (request) => {
        await runner.tool(request.capability, 'get_opportunity', {});
        await runner.tool(request.capability, 'get_active_doctrine', {});
        await runner.tool(request.capability, 'get_company_context', {});
        return {
          version: 'ulysse-agent-v1',
          outcome: 'technical_error',
          summary: 'Erreur technique de recette, sans proposition.',
          proposals: [],
        };
      },
    });
    await runner.run(w.ctx, w.o.id, 'test');
    const run = (await runner.store.list(w.owner)).find(
      (r) => r.error_code === 'agent_reported_error',
    );
    assert.ok(run);
    assert.equal(run.status, 'failed');
    assert.equal((await w.open())[0]?.id, previous.id);
  });
  test('capabilities reject foreign subjects, unavailable tools, expired leases and revoked connections', async () => {
    const w = await world('agent-capability');
    const other = await world('agent-other');
    const capability = 'test-run-capability';
    const runId = crypto.randomUUID();
    await w.agent.store.transaction(w.ctx, async (tx, sql) => {
      const d = await tx.getActiveDoctrine();
      assert.ok(d);
      const c = await tx.getCurrentContext();
      await sql.query(
        "INSERT INTO agent_runs(tenant_id,id,subject_id,input_hash,mode,status,trigger,snapshot,capability_hash,expires_at,session_id,model,hermes_version,instructions_version,correlation_id) VALUES($1,$2,$3,$4,'simulated','running','test','{}',$5,clock_timestamp()+interval '90 seconds','test','simulation','test','test','test')",
        [
          w.tenantId,
          runId,
          w.o.id,
          agentInputHash(w.o, d, c),
          createHash('sha256').update(capability).digest('hex'),
        ],
      );
    });
    await assert.rejects(w.agent.tool(capability, 'get_opportunity', { subjectId: other.o.id }));
    await assert.rejects(w.agent.tool(capability, 'terminal', {}));
    assert.ok(await w.agent.tool(capability, 'get_opportunity', { subjectId: w.o.id }));
    await w.connections.revoke(w.owner, w.connection.id);
    await assert.rejects(w.agent.tool(capability, 'get_opportunity', {}));
    await w.agent.store.transaction(w.ctx, async (_tx, sql) => {
      await sql.query(
        "UPDATE agent_runs SET expires_at=clock_timestamp()-interval '1 second' WHERE tenant_id=$1 AND id=$2",
        [w.tenantId, runId],
      );
    });
    await assert.rejects(w.agent.tool(capability, 'get_active_doctrine', {}));
  });
  const liveTestConfig = () =>
    agentConfig({
      ULYSSE_ANALYSIS_MODE: 'hermes-live',
      ENABLE_FIXTURE_CONNECTOR: 'true',
      HERMES_SERVICE_TOKEN: 'x'.repeat(32),
      OPENROUTER_API_KEY: 'test-only-never-transmitted',
      AGENT_MODEL_ID: 'openai/gpt-4.1-mini',
      AGENT_RUN_BUDGET_USD: '.25',
      AGENT_SESSION_BUDGET_USD: '2',
      AGENT_MONTH_BUDGET_USD: '10',
      AGENT_SESSION_ID: `test-${crypto.randomUUID()}`,
    });
  const abstention = {
    version: 'ulysse-agent-v1',
    outcome: 'no_signal',
    summary: 'Aucun signal dans ce test de contrôle.',
    proposals: [],
  };
  // The request shape Hermes sends once the Ulysse plugin has set the system prompt.
  const gatewayBody = (content: string, system = instructions) => ({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content },
    ],
    tools: TOOL_NAMES.map((name: string) => ({
      type: 'function',
      function: { name, parameters: {} },
    })),
  });
  test('atomic reservations bound concurrent tenants and unknown historical cost blocks live', async () => {
    const a = await world('agent-budget-a');
    const b = await world('agent-budget-b');
    const c = await world('agent-budget-c');
    const releases: Array<() => void> = [];
    const blocked = {
      execute: () =>
        new Promise<unknown>((resolve) => {
          releases.push(() => resolve(abstention));
        }),
    };
    const config = liveTestConfig();
    const runners = [a, b, c].map(() => new AgentRuntime(workerPool, config, blocked));
    const ra = runners[0];
    const rb = runners[1];
    const rc = runners[2];
    assert.ok(ra && rb && rc);
    const pending = [ra.run(a.ctx, a.o.id, 'test'), rb.run(b.ctx, b.o.id, 'test')];
    await waitFor(async () => releases.length === 2);
    try {
      await assert.rejects(rc.run(c.ctx, c.o.id, 'test'), /concurrency/);
    } finally {
      releases.forEach((release) => release());
      await Promise.all(pending);
    }
    const unknown = await world('agent-unknown-cost');
    await unknown.agent.store.transaction(unknown.ctx, async (tx) => {
      await tx.insertModelUsage({
        tenantId: unknown.tenantId,
        id: crypto.randomUUID(),
        recommendationId: null,
        provider: 'test',
        model: 'test',
        promptVersion: 'test',
        inputTokens: 100,
        outputTokens: 20,
        costUsd: null,
        latencyMs: 1,
        outcome: 'failed',
        errorCode: 'unknown',
        createdAt: new Date().toISOString(),
      });
    });
    let invoked = false;
    const runtime = new AgentRuntime(workerPool, liveTestConfig(), {
      execute: async () => {
        invoked = true;
        return abstention;
      },
    });
    await runtime.run(unknown.ctx, unknown.o.id, 'test');
    assert.equal(invoked, false);
    assert.equal((await runtime.store.list(unknown.owner))[0]?.status, 'budget_reached');
  });
  test('source changes during execution prevent publication and retry after a completed run cannot duplicate', async () => {
    const w = await world('agent-obsolete');
    const runner: AgentRuntime = new AgentRuntime(workerPool, liveTestConfig(), {
      execute: async (request) => {
        await runner.tool(request.capability, 'get_opportunity', { subjectId: w.o.id });
        await runner.tool(request.capability, 'get_active_doctrine', {});
        store.upsert(
          'agent-obsolete',
          'OPP-001',
          stalled('OPP-001', 12, { commercial: commercialFixture('acme', 'positive_reply') }),
          iso(0),
        );
        await w.runtime.handleSync(
          { tenantId: w.tenantId, connectionId: w.connection.id, trigger: 'manual' },
          crypto.randomUUID(),
        );
        return abstention;
      },
    });
    await runner.run(w.ctx, w.o.id, 'test');
    assert.equal((await runner.store.list(w.owner))[0]?.status, 'obsolete');
    assert.equal((await w.open()).length, 0);
    await w.agent.analyze(w.ctx, 'source_change');
    const recs = await w.open();
    assert.equal(recs.length, 1);
    // Equivalent to a crash after publication, before the pg-boss acknowledgement.
    await w.agent.analyze(w.ctx, 'source_change');
    assert.equal((await w.open())[0]?.id, recs[0]?.id);
  });

  test('inference accounting preserves estimated and uncertain costs and bounds retries', async (t) => {
    const w = await world('agent-gateway-accounting');
    let transmitted = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      transmitted++;
      if (transmitted === 3) throw new Error('simulated uncertain provider outcome');
      return new Response(
        JSON.stringify({
          usage: {
            prompt_tokens: 10,
            completion_tokens: 5,
            ...(transmitted === 2 ? {} : { cost: 0 }),
          },
          choices: [],
        }),
        { status: 200 },
      );
    });
    const runner: AgentRuntime = new AgentRuntime(workerPool, liveTestConfig(), {
      execute: async (request) => {
        await runner.tool(request.capability, 'get_opportunity', { subjectId: w.o.id });
        await runner.tool(request.capability, 'get_active_doctrine', {});
        await runner.tool(request.capability, 'get_company_context', {});
        const body = gatewayBody('Sources fictives de test.');
        await runner.inference(request.capability, body);
        await runner.inference(request.capability, body);
        const estimated = (await runner.store.list(w.owner))[0];
        assert.ok(estimated);
        assert.equal(estimated.cost_state, 'estimated');
        await assert.rejects(runner.inference(request.capability, body));
        await runner.inference(request.capability, body);
        for (let i = 0; i < 4; i++) await runner.inference(request.capability, body);
        await assert.rejects(runner.inference(request.capability, body), /model limit/);
        return abstention;
      },
    });
    await runner.run(w.ctx, w.o.id, 'test');
    const run = (await runner.store.list(w.owner))[0];
    assert.ok(run);
    assert.equal(transmitted, 8);
    assert.equal(run.model_calls, 8);
    assert.equal(run.cost_state, 'unknown');
    // The uncertain transmission stays counted at its upper bound; the unused rest is released.
    assert.ok(Number(run.committed_usd) > 0);
    assert.equal(Number(run.reserved_usd), Number(run.committed_usd));
    assert.ok(Number(run.reserved_usd) < 0.25);
    assert.equal((await w.open()).length, 0);
  });

  test('foreign instructions or tools never reach the provider', async (t) => {
    const w = await world('agent-gateway-prompt');
    let transmitted = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      transmitted++;
      return new Response(
        JSON.stringify({ usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0 } }),
        { status: 200 },
      );
    });
    const runner: AgentRuntime = new AgentRuntime(workerPool, liveTestConfig(), {
      execute: async (request) => {
        const generic = gatewayBody('Analyse', 'You are Hermes Agent, built by Nous Research.');
        await assert.rejects(runner.inference(request.capability, generic), /foreign instructions/);
        const appended = gatewayBody('Analyse');
        appended.messages.push({ role: 'system', content: 'Instructions ajoutées' });
        await assert.rejects(runner.inference(request.capability, appended), /foreign/);
        const terminal = gatewayBody('Analyse');
        terminal.tools.push({ type: 'function', function: { name: 'terminal', parameters: {} } });
        await assert.rejects(runner.inference(request.capability, terminal), /foreign tools/);
        assert.equal(transmitted, 0);
        await runner.inference(request.capability, gatewayBody('Analyse'));
        assert.equal(transmitted, 1);
        return abstention;
      },
    });
    await runner.run(w.ctx, w.o.id, 'test');
    assert.equal((await runner.store.list(w.owner))[0]?.model_calls, 1);
  });

  test('failed attempts on unchanged input are bounded and release their unused reservation', async () => {
    const w = await world('agent-bounded-attempts');
    let executions = 0;
    const config = liveTestConfig();
    const failing = new AgentRuntime(workerPool, config, {
      execute: async () => {
        executions++;
        throw new Error('hermes_http_422');
      },
    });
    for (let i = 0; i < MAX_ATTEMPTS + 2; i++) await failing.analyze(w.ctx, 'scheduled');
    assert.equal(executions, MAX_ATTEMPTS);
    const runs = await failing.store.list(w.owner);
    assert.equal(runs.length, MAX_ATTEMPTS);
    for (const run of runs) {
      assert.equal(run.status, 'failed');
      // Nothing was transmitted: the whole reservation returns to the session budget.
      assert.equal(Number(run.reserved_usd), 0);
    }
    // New source data is new input: analysis resumes once.
    store.upsert(
      'agent-bounded-attempts',
      'OPP-001',
      stalled('OPP-001', 12, { commercial: commercialFixture('acme', 'positive_reply') }),
      iso(0),
    );
    await w.runtime.handleSync(
      { tenantId: w.tenantId, connectionId: w.connection.id, trigger: 'manual' },
      crypto.randomUUID(),
    );
    await failing.analyze(w.ctx, 'source_change');
    assert.equal(executions, MAX_ATTEMPTS + 1);
  });

  test('an expired run resumes before publication and an invented citation cannot publish', async () => {
    const w = await world('agent-crash-before-publication');
    const expired = crypto.randomUUID();
    await w.agent.store.transaction(w.ctx, async (tx, sql) => {
      const doctrine = await tx.getActiveDoctrine();
      assert.ok(doctrine);
      const context = await tx.getCurrentContext();
      await sql.query(
        "INSERT INTO agent_runs(tenant_id,id,subject_id,input_hash,mode,status,trigger,snapshot,capability_hash,expires_at,session_id,model,hermes_version,instructions_version,correlation_id) VALUES($1,$2,$3,$4,'simulated','running','test','{}',$5,clock_timestamp()-interval '1 second','test','simulation','test','test','test')",
        [
          w.tenantId,
          expired,
          w.o.id,
          agentInputHash(w.o, doctrine, context),
          createHash('sha256').update(expired).digest('hex'),
        ],
      );
    });
    await w.agent.analyze(w.ctx, 'scheduled');
    const runs = await w.agent.store.list(w.owner);
    assert.ok(runs.some((r) => r.id === expired && r.status === 'interrupted'));
    assert.equal((await w.open()).length, 1);
    await w.agent.analyze(w.ctx, 'scheduled');
    assert.equal((await w.open()).length, 1);
    const invalid = await world('agent-invalid-citation');
    const runner: AgentRuntime = new AgentRuntime(workerPool, liveTestConfig(), {
      execute: async (request) => {
        await runner.tool(request.capability, 'get_opportunity', { subjectId: invalid.o.id });
        await runner.tool(request.capability, 'get_active_doctrine', {});
        await runner.tool(request.capability, 'get_company_context', {});
        return {
          version: 'ulysse-agent-v1',
          outcome: 'proposals',
          summary: 'Résultat invalide de test',
          proposals: [
            {
              action: 'clarify',
              title: 'Vérifier',
              nextStep: 'Clarifier',
              justification: 'Citation fictive non récupérée',
              references: ['material:invented'],
              assumptions: [],
              missingInformation: [],
              limits: [],
              urgency: 'normal',
            },
          ],
        };
      },
    });
    await runner.run(invalid.ctx, invalid.o.id, 'test');
    assert.equal((await invalid.open()).length, 0);
    assert.equal((await runner.store.list(invalid.owner))[0]?.status, 'failed');
  });
});

let db: TestDatabase;
let admin: AdminClient;
let appPool: Pool;
let workerPool: Pool;
const store = new MemoryFixtureStore();

const day = 86_400_000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

function stalled(id: string, inactiveDays: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    title: `Opportunité fictive ${id}`,
    status: 'open',
    last_activity: iso(-inactiveDays * day),
    next_action: null,
    amount_cents: 500000,
    currency: 'EUR',
    owner: { name: 'Commercial fictif' },
    ...extra,
  };
}

function runtimeWith(
  options: {
    registry?: Connector[];
    faults?: FaultHooks;
    env?: Record<string, string>;
    model?: ModelSettings;
    metrics?: ReturnType<typeof createMetrics>;
    agent?: AgentRuntime;
  } = {},
) {
  return new WorkerRuntime({
    config: loadWorkerConfig({
      OUTBOX_POLL_MS: '150',
      WORKER_CONCURRENCY: '2',
      LOG_LEVEL: 'silent',
      ...options.env,
    }),
    pool: workerPool,
    connectionString: db.workerUrl,
    registry: createRegistry(options.registry ?? [new FixtureConnector(store)]),
    credentials: noCredentialStore,
    rules: defaultRules,
    clock: systemClock,
    logger: createLogger('worker-test', { level: 'silent' }),
    metrics: options.metrics ?? createMetrics('worker-test'),
    ...(options.faults ? { faults: options.faults } : {}),
    ...(options.model ? { model: options.model } : {}),
    ...(options.agent ? { agent: options.agent } : {}),
  });
}

async function waitFor<T>(probe: () => Promise<T | null | false>, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function tenantWorld(name: string, dataset: string) {
  const tenantId = await admin.provisionTenant(
    `${name}-${crypto.randomUUID().slice(0, 6)}`,
    `Entreprise fictive ${name}`,
  );
  const ownerId = await admin.provisionUser({
    issuer: 'https://idp.test',
    subject: crypto.randomUUID(),
    email: null,
    displayName: `Owner ${name}`,
  });
  await admin.setMembership(tenantId, ownerId, 'owner');
  const deps: ServiceDeps = {
    uow: new PgUnitOfWork(appPool),
    clock: systemClock,
    ids: { next: () => crypto.randomUUID() },
    rules: defaultRules,
  };
  const owner = userContext(tenantId, ownerId, 'owner');
  const doctrines = new DoctrineService(deps);
  const d = await doctrines.draft(owner, FIXTURE_DOCTRINE);
  await doctrines.validate(owner, d.id, null);
  await new CompanyContextService(deps).update(owner, {
    content: FIXTURE_CONTEXT,
    source: 'fixture',
  });
  const connections = new ConnectionService(deps, fixtureCatalog);
  const queries = new QueryService(deps);
  const connect = () =>
    connections.create(owner, {
      provider: 'fixture-crm',
      displayName: `CRM ${name}`,
      config: { dataset },
    });
  const open = async () =>
    (await queries.listRecommendations(owner, { view: 'open', limit: 100 })).items;
  const count = async (sql: string) => {
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      const r = await client.query<{ n: number }>(sql);
      await client.query('COMMIT');
      return r.rows[0]?.n ?? 0;
    } finally {
      client.release();
    }
  };
  return { tenantId, owner, connections, queries, connect, open, count };
}

before(async () => {
  db = await createTestDatabase();
  admin = await AdminClient.connect(db.migratorUrl);
  appPool = createPool({ connectionString: db.appUrl, applicationName: 'worker-test-app', max: 6 });
  workerPool = createPool({
    connectionString: db.workerUrl,
    applicationName: 'worker-test',
    max: 10,
  });
});

after(async () => {
  await appPool.end();
  await workerPool.end();
  await admin.close();
  await db.drop();
});

describe('background ingestion with pg-boss', () => {
  test('authorizing a source leads to synced facts and proposals with no further user action', async () => {
    store.upsert('acme', 'OPP-1', stalled('OPP-1', 12), iso(-day));
    store.upsert('acme', 'OPP-2', stalled('OPP-2', 1), iso(-day));
    const w = await tenantWorld('acme', 'acme');
    const runtime = runtimeWith();
    await runtime.start({ schedule: false });
    try {
      const connection = await w.connect();
      const first = await waitFor(async () => {
        const open = await w.open();
        return open.length === 1 ? open : null;
      });
      assert.equal(first[0]?.subject.externalId, 'OPP-1');
      // New data appears at the source; the scheduled dispatcher picks it up.
      store.upsert('acme', 'OPP-3', stalled('OPP-3', 20), iso(-60_000));
      await runtime.dispatchSyncs(new Date(Date.now() + 60 * 60_000));
      const second = await waitFor(async () => {
        const open = await w.open();
        return open.length === 2 ? open : null;
      });
      assert.deepEqual(second.map((r) => r.subject.externalId).sort(), ['OPP-1', 'OPP-3']);
      const [c] = await w.connections.list(w.owner);
      assert.ok(c);
      assert.equal(c.id, connection.id);
      assert.ok(c.dataAsOf, 'freshness is recorded');
      assert.equal(c.lastErrorCode, null);
    } finally {
      await runtime.stop(5000);
    }
  });

  test('replaying a sync job or its events creates no duplicates', async () => {
    store.upsert('replay', 'OPP-1', stalled('OPP-1', 15), iso(-day));
    const w = await tenantWorld('replay', 'replay');
    const runtime = runtimeWith();
    await runtime.start({ schedule: false });
    try {
      const connection = await w.connect();
      await waitFor(async () => (await w.open()).length === 1);
      await runtime.handleSync(
        { tenantId: w.tenantId, connectionId: connection.id, trigger: 'replay' },
        'test-replay-1',
      );
      await runtime.handleSync(
        { tenantId: w.tenantId, connectionId: connection.id, trigger: 'replay' },
        'test-replay-2',
      );
      await runtime.handleAnalyze(
        { tenantId: w.tenantId, trigger: 'source_change' },
        'test-analyze-1',
      );
      assert.equal((await w.open()).length, 1);
      assert.equal(await w.count('SELECT count(*)::int AS n FROM source_records'), 1);
      assert.equal(
        await w.count(
          "SELECT count(*)::int AS n FROM audit_events WHERE event_type = 'recommendation.generated'",
        ),
        1,
      );
    } finally {
      await runtime.stop(5000);
    }
  });

  test('a crash before commit leaves nothing; a crash after commit resumes from the checkpoint', async () => {
    for (let i = 0; i < 5; i += 1)
      store.upsert('crash', `OPP-${String(i)}`, stalled(`OPP-${String(i)}`, 10 + i), iso(-day));
    const w = await tenantWorld('crash', 'crash');
    const connection = await w.connect();
    const env = { SYNC_PAGE_SIZE: '2' };
    const before = runtimeWith({
      env,
      faults: {
        beforePagePersist: () => {
          throw new Error('simulated crash before commit');
        },
      },
    });
    await assert.rejects(
      before.handleSync(
        { tenantId: w.tenantId, connectionId: connection.id, trigger: 'initial' },
        'crash-1',
      ),
      /before commit/,
    );
    assert.equal(await w.count('SELECT count(*)::int AS n FROM source_records'), 0);
    assert.equal(
      await w.count('SELECT count(*)::int AS n FROM connections WHERE cursor IS NOT NULL'),
      0,
    );
    const afterCommit = runtimeWith({
      env,
      faults: {
        afterPagePersisted: (page) => {
          if (page === 1) throw new Error('simulated crash after commit');
        },
      },
    });
    await assert.rejects(
      afterCommit.handleSync(
        { tenantId: w.tenantId, connectionId: connection.id, trigger: 'initial' },
        'crash-2',
      ),
      /after commit/,
    );
    assert.equal(
      await w.count('SELECT count(*)::int AS n FROM source_records'),
      2,
      'first page committed',
    );
    const healthy = runtimeWith({ env });
    await healthy.handleSync(
      { tenantId: w.tenantId, connectionId: connection.id, trigger: 'initial' },
      'crash-3',
    );
    assert.equal(
      await w.count('SELECT count(*)::int AS n FROM source_records'),
      5,
      'every record exactly once',
    );
    assert.equal(
      await w.count('SELECT count(*)::int AS n FROM source_records WHERE revision > 1'),
      0,
    );
    const runs = await w.connections.syncRuns(w.owner, connection.id);
    assert.deepEqual(runs.map((r) => r.status).sort(), ['failed', 'failed', 'succeeded']);
  });

  test('transient errors are retried with backoff; terminal errors stop and are visible', async () => {
    store.upsert('errors', 'OPP-1', stalled('OPP-1', 9), iso(-day));
    const w = await tenantWorld('errors', 'errors');
    const connection = await w.connect();
    const flaky = new MemoryFixtureStore();
    flaky.upsert('errors', 'OPP-1', stalled('OPP-1', 9), iso(-day));
    flaky.injectFault({
      onCall: 1,
      error: new ConnectorError('rate_limited', 'quota exceeded', 30),
    });
    flaky.injectFault({
      onCall: 2,
      error: new ConnectorError('auth_revoked', 'grant revoked by the provider'),
    });
    const runtime = runtimeWith({ registry: [new FixtureConnector(flaky)] });
    await assert.rejects(
      runtime.handleSync(
        { tenantId: w.tenantId, connectionId: connection.id, trigger: 'initial' },
        'err-1',
      ),
      ConnectorError,
    );
    let [c] = await w.connections.list(w.owner);
    assert.ok(c);
    assert.equal(c.status, 'active');
    assert.equal(c.lastErrorCode, 'rate_limited');
    assert.equal(c.consecutiveFailures, 1);
    assert.ok(c.nextSyncAt && Date.parse(c.nextSyncAt) > Date.now(), 'next attempt is pushed back');
    await runtime.handleSync(
      { tenantId: w.tenantId, connectionId: connection.id, trigger: 'scheduled' },
      'err-2',
    );
    [c] = await w.connections.list(w.owner);
    assert.ok(c);
    assert.equal(c.status, 'error');
    assert.equal(c.lastErrorCode, 'auth_revoked');
    assert.equal(c.nextSyncAt, null, 'a terminal error is not retried automatically');
  });

  test('revocation stops access and purges source data through the outbox', async () => {
    store.upsert('revoke', 'OPP-1', stalled('OPP-1', 11), iso(-day));
    const w = await tenantWorld('revoke', 'revoke');
    const runtime = runtimeWith();
    await runtime.start({ schedule: false });
    try {
      const connection = await w.connect();
      await waitFor(async () => (await w.open()).length === 1);
      await w.connections.revoke(w.owner, connection.id);
      await waitFor(
        async () => (await w.count('SELECT count(*)::int AS n FROM opportunities')) === 0,
      );
      assert.equal(await w.count('SELECT count(*)::int AS n FROM source_records'), 0);
      assert.equal(await w.count('SELECT count(*)::int AS n FROM facts'), 0);
      assert.equal((await w.open()).length, 0);
      await runtime.handleSync(
        { tenantId: w.tenantId, connectionId: connection.id, trigger: 'scheduled' },
        'after-revoke',
      );
      assert.equal(
        await w.count('SELECT count(*)::int AS n FROM source_records'),
        0,
        'no new access after revocation',
      );
      assert.equal((await runtime.dispatchSyncs(new Date(Date.now() + 86_400_000))) >= 0, true);
    } finally {
      await runtime.stop(5000);
    }
  });

  test('each dispatch cycle publishes the queued job count per queue', async () => {
    const metrics = createMetrics('worker-test');
    const runtime = runtimeWith({ metrics });
    await runtime.start({ schedule: false });
    try {
      await runtime.dispatchSyncs();
      const backlog = await metrics.registry.getSingleMetricAsString('ulysse_queue_backlog');
      for (const queue of Object.values(QUEUES))
        assert.match(backlog, new RegExp(`queue="${queue.replaceAll('.', '\\.')}"`), queue);
    } finally {
      await runtime.stop(5000);
    }
  });

  test('a forged job cannot make tenant B read tenant A connections', async () => {
    store.upsert('forge', 'OPP-1', stalled('OPP-1', 11), iso(-day));
    const a = await tenantWorld('forge-a', 'forge');
    const b = await tenantWorld('forge-b', 'forge');
    const connection = await a.connect();
    const runtime = runtimeWith();
    await runtime.handleSync(
      { tenantId: b.tenantId, connectionId: connection.id, trigger: 'initial' },
      'forged',
    );
    assert.equal(await b.count('SELECT count(*)::int AS n FROM source_records'), 0);
    assert.equal(await a.count('SELECT count(*)::int AS n FROM source_records'), 0);
  });

  test('a large tenant yields between pages so another tenant is not starved', async () => {
    for (let i = 0; i < 25; i += 1)
      store.upsert('big', `OPP-${String(i)}`, stalled(`OPP-${String(i)}`, 10), iso(-day));
    store.upsert('small', 'OPP-1', stalled('OPP-1', 10), iso(-day));
    const big = await tenantWorld('big', 'big');
    const small = await tenantWorld('small', 'small');
    const runtime = runtimeWith({
      env: { SYNC_PAGE_SIZE: '1', SYNC_MAX_PAGES_PER_JOB: '1', WORKER_CONCURRENCY: '1' },
    });
    await runtime.start({ schedule: false });
    try {
      const bigConnection = await big.connect();
      await new Promise((r) => setTimeout(r, 400));
      const smallConnection = await small.connect();
      await waitFor(async () =>
        (await small.connections.syncRuns(small.owner, smallConnection.id)).some(
          (r) => r.status === 'succeeded',
        ),
      );
      const bigRuns = await big.connections.syncRuns(big.owner, bigConnection.id);
      assert.ok(
        !bigRuns.some((r) => r.status === 'succeeded'),
        'the small tenant finished while the large one was still paging',
      );
      await waitFor(
        async () =>
          (await big.connections.syncRuns(big.owner, bigConnection.id)).some(
            (r) => r.status === 'succeeded',
          ),
        60_000,
      );
      assert.equal(await big.count('SELECT count(*)::int AS n FROM source_records'), 25);
    } finally {
      await runtime.stop(5000);
    }
  });

  test('graceful stop lets the current page commit and the next runtime resumes', async () => {
    for (let i = 0; i < 6; i += 1)
      store.upsert('stop', `OPP-${String(i)}`, stalled(`OPP-${String(i)}`, 10), iso(-day));
    const w = await tenantWorld('stop', 'stop');
    const connection = await w.connect();
    const stopping = runtimeWith({ env: { SYNC_PAGE_SIZE: '2' } });
    await stopping.start({ schedule: false, relay: false, work: false });
    // Stop is requested while the job runs: the job commits its current page, then yields.
    const running = stopping.handleSync(
      { tenantId: w.tenantId, connectionId: connection.id, trigger: 'initial' },
      'graceful-1',
    );
    await Promise.allSettled([running, stopping.stop(5000)]);
    const persisted = await w.count('SELECT count(*)::int AS n FROM source_records');
    assert.ok(persisted % 2 === 0, 'only whole pages are persisted');
    const next = runtimeWith({ env: { SYNC_PAGE_SIZE: '2' } });
    await next.handleSync(
      { tenantId: w.tenantId, connectionId: connection.id, trigger: 'scheduled' },
      'graceful-2',
    );
    assert.equal(await w.count('SELECT count(*)::int AS n FROM source_records'), 6);
  });

  test('optional model wording is applied in the background, recorded, and degrades safely', async () => {
    store.upsert('model', 'OPP-1', stalled('OPP-1', 14), iso(-day));
    store.upsert('model', 'OPP-2', stalled('OPP-2', 16), iso(-day));
    const w = await tenantWorld('model', 'model');
    const good = {
      abstain: false,
      abstainReason: null,
      proposedAction: 'Appeler le contact pour convenir d’une prochaine étape datée cette semaine.',
      rationale: 'Pas d’interaction récente ni de prochaine étape enregistrée.',
      citations: ['F1'],
    };
    // Deterministic per opportunity: other tenants' pending events may also reach this runtime.
    const provider = new ScriptedProvider(
      Array.from({ length: 50 }, () => (request: { user: string }) => {
        if (request.user.includes('OPP-2'))
          throw new ModelError('unavailable', 'provider down', {
            inputTokens: 0,
            outputTokens: 0,
            costUsd: 0,
          });
        return good;
      }),
    );
    const runtime = runtimeWith({
      model: { provider, timeoutMs: 2000, maxOutputTokens: 300, monthlyBudgetUsd: 1 },
    });
    await runtime.start({ schedule: false });
    try {
      await w.connect();
      // Usage is recorded before the wording is applied (cost counts even on a conflict).
      await waitFor(
        async () =>
          (await w.count('SELECT count(*)::int AS n FROM model_usage')) === 2 &&
          (await w.count(
            "SELECT count(*)::int AS n FROM audit_events WHERE event_type = 'recommendation.formulated'",
          )) === 1,
      );
      const open = await w.open();
      assert.equal(open.length, 2);
      assert.deepEqual(
        open.map((r) => r.formulation).sort(),
        ['model', 'template'],
        'one formulated, one kept deterministic after a provider failure',
      );
      const formulated = open.find((r) => r.formulation === 'model');
      assert.equal(formulated?.proposedAction, good.proposedAction);
      assert.equal(formulated.contentRevision, 2);
      assert.equal(
        await w.count(
          "SELECT count(*)::int AS n FROM model_usage WHERE outcome = 'failed' AND error_code = 'unavailable'",
        ),
        1,
      );
      assert.equal(
        await w.count(
          "SELECT count(*)::int AS n FROM audit_events WHERE event_type = 'recommendation.formulated'",
        ),
        1,
      );
      assert.ok(
        provider.requests.every((r) => !r.user.includes(w.tenantId)),
        'no internal identifiers sent to the model',
      );
    } finally {
      await runtime.stop(5000);
    }
  });

  test('model calls stop when the tenant budget is reached', async () => {
    store.upsert('budget', 'OPP-1', stalled('OPP-1', 14), iso(-day));
    const w = await tenantWorld('budget', 'budget');
    const provider = new ScriptedProvider([]);
    const runtime = runtimeWith({
      model: { provider, timeoutMs: 2000, maxOutputTokens: 300, monthlyBudgetUsd: 0 },
    });
    await runtime.start({ schedule: false });
    try {
      await w.connect();
      await waitFor(
        async () =>
          (await w.count(
            "SELECT count(*)::int AS n FROM model_usage WHERE outcome = 'skipped_budget'",
          )) === 1,
      );
      assert.equal(provider.requests.length, 0);
      assert.equal((await w.open())[0]?.formulation, 'template');
    } finally {
      await runtime.stop(5000);
    }
  });
});
