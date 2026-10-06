import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { ModelSettings } from '@ulysse/ai';
import { ModelError, ScriptedProvider } from '@ulysse/ai';
import type { Connector } from '@ulysse/connectors';
import {
  ConnectorError,
  createRegistry,
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
  systemClock,
} from '@ulysse/domain';
import {
  FIXTURE_CONTEXT,
  FIXTURE_DOCTRINE,
  fixtureCatalog,
  userContext,
} from '@ulysse/domain/testing';
import { createLogger, createMetrics } from '@ulysse/observability';
import { loadWorkerConfig } from '../src/config.ts';
import type { FaultHooks } from '../src/runtime.ts';
import { noCredentialStore, WorkerRuntime } from '../src/runtime.ts';

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
        if (request.user.includes('OPP-2')) throw new ModelError('unavailable', 'provider down');
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
