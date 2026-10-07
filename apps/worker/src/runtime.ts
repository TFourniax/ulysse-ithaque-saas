import type { ModelSettings } from '@ulysse/ai';
import type { AgentRuntime } from './agent-runtime.ts';
import { formulateNextStep, PROMPT_VERSION } from '@ulysse/ai';
import type { Connector, ConnectorContext, ConnectorRegistry } from '@ulysse/connectors';
import { ConnectorError } from '@ulysse/connectors';
import type { Pool } from '@ulysse/database';
import { PGBOSS_SCHEMA, PgUnitOfWork, QUEUES } from '@ulysse/database';
import type {
  Clock,
  Connection,
  Context,
  RuleRegistry,
  ServiceDeps,
  ServiceScope,
} from '@ulysse/domain';
import {
  AnalysisService,
  FormulationService,
  IngestionService,
  isDomainError,
  MaintenanceService,
} from '@ulysse/domain';
import type { Logger, Metrics } from '@ulysse/observability';
import type { Job, SendOptions } from 'pg-boss';
import { PgBoss } from 'pg-boss';
import type { z } from 'zod';
import type { WorkerConfig } from './config.ts';
import { ConnectionJob, RecommendationJob, SyncJob, TenantJob } from './jobs.ts';

/** Resolves an opaque credential reference server-side. Secrets never go to logs, browsers or models. */
export interface CredentialStore {
  resolve(connection: Connection): Promise<ConnectorContext['credential']>;
  remove(connection: Connection): Promise<void>;
}

/** Fixture connections need no secret; a live connector requires a configured secret store (UL-008). */
export const noCredentialStore: CredentialStore = {
  resolve: async (connection) => {
    if (connection.credentialRef !== null)
      throw new ConnectorError('misconfigured', 'no credential store configured');
    return { type: 'none' };
  },
  remove: async () => undefined,
};

/** Test-only hooks to simulate crashes around persistence boundaries. */
export type FaultHooks = Readonly<{
  beforePagePersist?: (page: number) => void;
  afterPagePersisted?: (page: number) => void;
}>;

export type WorkerDeps = Readonly<{
  config: WorkerConfig;
  /** Pool authenticated as ulysse_worker (no BYPASSRLS). */
  pool: Pool;
  connectionString: string;
  registry: ConnectorRegistry;
  credentials: CredentialStore;
  rules: RuleRegistry;
  clock: Clock;
  logger: Logger;
  metrics: Metrics;
  faults?: FaultHooks;
  /** Optional model-assisted wording; null provider = deterministic wording only. */
  model?: ModelSettings;
  agent?: AgentRuntime;
}>;

type OutboxRow = {
  tenant_id: string;
  id: string;
  event_type: string;
  subject_type: string;
  subject_id: string;
  payload: Record<string, unknown>;
  created_at: string;
};

const SERVICE_ID = 'ulysse-worker';

function serviceContext(
  tenantId: string,
  correlationId: string,
  scopes: readonly ServiceScope[],
  connectionId?: string,
): Context {
  return {
    tenantId,
    actor: {
      kind: 'service',
      serviceId: SERVICE_ID,
      scopes,
      ...(connectionId ? { connectionId } : {}),
    },
    correlationId: correlationId.slice(0, 128),
  };
}

function parse<T extends z.ZodType>(schema: T, job: Job<unknown>): z.infer<T> {
  const parsed = schema.safeParse(job.data);
  if (!parsed.success) throw new Error(`invalid payload for ${job.name}`);
  return parsed.data;
}

/**
 * Background runtime. Jobs are delivered at least once: every handler is safe to
 * replay because the domain services are idempotent on business data
 * (unchanged content creates no revision, an unchanged signal no recommendation).
 */
export class WorkerRuntime {
  readonly boss: PgBoss;
  readonly #deps: WorkerDeps;
  readonly #uow: PgUnitOfWork;
  readonly #ingestion: IngestionService;
  readonly #analysis: AnalysisService;
  readonly #maintenance: MaintenanceService;
  readonly #formulation: FormulationService;
  #relayTimer: NodeJS.Timeout | null = null;
  #relaying = false;
  #stopping = false;
  readonly #abort = new AbortController();

  constructor(deps: WorkerDeps) {
    this.#deps = deps;
    this.#uow = new PgUnitOfWork(deps.pool);
    const serviceDeps: ServiceDeps = {
      uow: this.#uow,
      clock: deps.clock,
      ids: { next: () => crypto.randomUUID() },
      rules: deps.rules,
    };
    this.#ingestion = new IngestionService(serviceDeps);
    this.#analysis = new AnalysisService(serviceDeps);
    this.#maintenance = new MaintenanceService(serviceDeps);
    this.#formulation = new FormulationService(serviceDeps);
    this.boss = new PgBoss({
      connectionString: deps.connectionString,
      schema: PGBOSS_SCHEMA,
      application_name: 'ulysse-worker-jobs',
      migrate: false,
      createSchema: false,
      supervise: true,
      schedule: true,
    });
    this.boss.on('error', (error: unknown) =>
      deps.logger.error({ err: error }, 'job runtime error'),
    );
  }

  async start(
    options: { work?: boolean; schedule?: boolean; relay?: boolean } = {},
  ): Promise<void> {
    const { config } = this.#deps;
    await this.boss.start();
    if (options.schedule ?? true) {
      await this.boss.schedule(
        QUEUES.dispatchSyncs,
        config.SYNC_DISPATCH_CRON,
        {},
        { singletonKey: 'dispatch' },
      );
      await this.boss.schedule(
        QUEUES.dispatchMaintenance,
        config.MAINTENANCE_CRON,
        {},
        { singletonKey: 'dispatch' },
      );
    }
    if (options.work ?? true) await this.#registerWorkers();
    if (options.relay ?? true) {
      this.#relayTimer = setInterval(() => void this.#relayTick(), config.OUTBOX_POLL_MS);
    }
  }

  /** Graceful stop: no new jobs, wait for active ones (pages are transactional, so an abort loses nothing). */
  async stop(timeoutMs = 30_000): Promise<void> {
    this.#stopping = true;
    if (this.#relayTimer) clearInterval(this.#relayTimer);
    await this.boss.stop({ graceful: true, timeout: timeoutMs, close: true });
    this.#abort.abort();
  }

  async #registerWorkers(): Promise<void> {
    const { config, metrics } = this.#deps;
    const common = { localConcurrency: config.WORKER_CONCURRENCY, pollingIntervalSeconds: 0.5 };
    const tenantScoped = { ...common, groupConcurrency: config.WORKER_TENANT_CONCURRENCY };
    const instrument =
      (queue: string, handler: (job: Job<unknown>) => Promise<void>) =>
      async (jobs: Job<unknown>[]) => {
        for (const job of jobs) {
          const end = metrics.jobDuration.startTimer({ queue });
          try {
            await handler(job);
            metrics.jobs.inc({ queue, outcome: 'completed' });
          } catch (error) {
            metrics.jobs.inc({ queue, outcome: 'failed' });
            this.#deps.logger.warn(
              {
                queue,
                jobId: job.id,
                retry: job.retryCount,
                err:
                  error instanceof Error ? { name: error.name, message: error.message } : undefined,
              },
              'job failed',
            );
            throw error;
          } finally {
            end();
          }
        }
      };
    await this.boss.work(
      QUEUES.dispatchSyncs,
      common,
      instrument(QUEUES.dispatchSyncs, () => this.dispatchSyncs().then(() => undefined)),
    );
    await this.boss.work(
      QUEUES.dispatchMaintenance,
      common,
      instrument(QUEUES.dispatchMaintenance, () =>
        this.dispatchMaintenance().then(() => undefined),
      ),
    );
    await this.boss.work(
      QUEUES.connectionSync,
      tenantScoped,
      instrument(QUEUES.connectionSync, (job) => this.handleSync(parse(SyncJob, job), job.id)),
    );
    await this.boss.work(
      QUEUES.tenantAnalyze,
      tenantScoped,
      instrument(QUEUES.tenantAnalyze, (job) => this.handleAnalyze(parse(TenantJob, job), job.id)),
    );
    await this.boss.work(
      QUEUES.tenantMaintain,
      tenantScoped,
      instrument(QUEUES.tenantMaintain, (job) =>
        this.handleMaintain(parse(TenantJob, job), job.id),
      ),
    );
    await this.boss.work(
      QUEUES.connectionPurge,
      tenantScoped,
      instrument(QUEUES.connectionPurge, (job) =>
        this.handlePurge(parse(ConnectionJob, job), job.id),
      ),
    );
    if (this.#deps.model?.provider) {
      await this.boss.work(
        QUEUES.recommendationFormulate,
        tenantScoped,
        instrument(QUEUES.recommendationFormulate, (job) =>
          this.handleFormulate(parse(RecommendationJob, job), job.id),
        ),
      );
    }
  }

  #isStopping(): boolean {
    return this.#stopping;
  }

  async #relayTick(): Promise<void> {
    if (this.#relaying || this.#stopping) return;
    this.#relaying = true;
    try {
      while ((await this.relayOutbox()) > 0 && !this.#isStopping()) {
        // Drain in batches.
      }
    } catch (error) {
      this.#deps.logger.error({ err: error }, 'outbox relay failed');
    } finally {
      this.#relaying = false;
    }
  }

  /**
   * Hands pending outbox events to the job queue in the same transaction that marks
   * them published: an event is either still pending or queued, never lost.
   */
  async relayOutbox(limit = 100): Promise<number> {
    const client = await this.#deps.pool.connect();
    try {
      await client.query('BEGIN');
      const claimed = await client.query<OutboxRow>('SELECT * FROM app.claim_outbox($1)', [limit]);
      const db = {
        executeSql: async (text: string, values?: unknown[]) => client.query(text, values),
      };
      for (const event of claimed.rows) {
        const job = this.#jobFor(event);
        if (job) await this.boss.send(job.name, job.data, { ...job.options, db });
      }
      if (claimed.rows.length > 0) {
        await client.query('SELECT app.mark_outbox_published($1::uuid[], $2::uuid[], now())', [
          claimed.rows.map((e) => e.tenant_id),
          claimed.rows.map((e) => e.id),
        ]);
      }
      await client.query('COMMIT');
      const backlog = await client.query<{ pending: string }>(
        'SELECT pending FROM app.outbox_backlog()',
      );
      this.#deps.metrics.outboxBacklog.set(Number(backlog.rows[0]?.pending ?? 0));
      return claimed.rows.length;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  #jobFor(event: OutboxRow): { name: string; data: object; options: SendOptions } | null {
    const tenantId = event.tenant_id;
    const group = { id: tenantId };
    switch (event.event_type) {
      case 'source.changed':
        return {
          name: QUEUES.tenantAnalyze,
          data: { tenantId, trigger: 'source_change' },
          options: { singletonKey: tenantId, group },
        };
      case 'doctrine.changed':
      case 'context.changed':
        return {
          name: QUEUES.tenantAnalyze,
          data: { tenantId, trigger: 'doctrine_change' },
          options: { singletonKey: tenantId, group },
        };
      case 'connection.sync_requested': {
        const trigger =
          typeof event.payload.trigger === 'string' ? event.payload.trigger : 'manual';
        return {
          name: QUEUES.connectionSync,
          data: { tenantId, connectionId: event.subject_id, trigger },
          options: { singletonKey: event.subject_id, group },
        };
      }
      case 'connection.revoked':
        return {
          name: QUEUES.connectionPurge,
          data: { tenantId, connectionId: event.subject_id },
          options: { singletonKey: event.subject_id, group },
        };
      case 'recommendation.generated':
        // Model-assisted wording is opt-in; without a provider the deterministic text stays.
        return this.#deps.model?.provider
          ? {
              name: QUEUES.recommendationFormulate,
              data: { tenantId, recommendationId: event.subject_id },
              options: { singletonKey: event.subject_id, group },
            }
          : null;
      default:
        // recommendation.decided: no background action in this version (no external execution, ADR-0002).
        return null;
    }
  }

  /** Enqueues due connections; stately queues coalesce duplicates per connection. */
  async dispatchSyncs(now: Date = this.#deps.clock.now()): Promise<number> {
    const due = await this.#deps.pool.query<{ tenant_id: string; connection_id: string }>(
      'SELECT tenant_id, connection_id FROM app.due_connections($1, 200)',
      [now.toISOString()],
    );
    for (const row of due.rows) {
      await this.boss.send(
        QUEUES.connectionSync,
        { tenantId: row.tenant_id, connectionId: row.connection_id, trigger: 'scheduled' },
        { singletonKey: row.connection_id, group: { id: row.tenant_id } },
      );
    }
    await this.refreshQueueMetrics();
    return due.rows.length;
  }

  /** Publishes queued job counts (ulysse_queue_backlog) once per dispatch cycle. */
  async refreshQueueMetrics(): Promise<void> {
    for (const queue of await this.boss.getQueues(Object.values(QUEUES)))
      this.#deps.metrics.queueBacklog.set({ queue: queue.name }, queue.queuedCount);
  }

  async dispatchMaintenance(): Promise<number> {
    const tenants = await this.#deps.pool.query<{ tenant_id: string }>(
      'SELECT tenant_id FROM app.active_tenants()',
    );
    for (const row of tenants.rows) {
      await this.boss.send(
        QUEUES.tenantMaintain,
        { tenantId: row.tenant_id, trigger: 'scheduled' },
        { singletonKey: row.tenant_id, group: { id: row.tenant_id } },
      );
    }
    await this.#deps.pool.query('SELECT * FROM app.purge_expired(now())');
    return tenants.rows.length;
  }

  /** Reads pages and persists each one (records + facts + outbox + checkpoint) atomically. */
  async handleSync(job: SyncJob, jobId: string): Promise<void> {
    const { config, registry, credentials, faults, metrics } = this.#deps;
    const ctx = serviceContext(job.tenantId, `job:${jobId}`, ['source:ingest'], job.connectionId);
    let runId: string;
    let cursor: string | null;
    let connection: Connection;
    try {
      if (job.runId) {
        const continuing = await this.#uow.run(ctx, async (tx) => ({
          run: await tx.getSyncRun(job.runId ?? ''),
          connection: await tx.getConnection(job.connectionId),
        }));
        if (
          !continuing.run ||
          continuing.run.status !== 'running' ||
          !continuing.connection ||
          continuing.connection.status !== 'active'
        )
          return;
        runId = continuing.run.id;
        connection = continuing.connection;
        cursor = continuing.connection.cursor;
      } else {
        const started = await this.#ingestion.start(ctx, job.connectionId, job.trigger);
        runId = started.run.id;
        connection = started.connection;
        cursor = started.cursor;
      }
    } catch (error) {
      // Revoked, paused or deleted connections: the job ends without touching the source.
      if (isDomainError(error, 'CONNECTION_INACTIVE') || isDomainError(error, 'NOT_FOUND')) return;
      throw error;
    }
    const connector: Connector | undefined = registry.get(connection.provider);
    if (!connector) {
      await this.#ingestion.fail(ctx, runId, {
        code: 'provider_unavailable',
        detail: `no connector installed for ${connection.provider}`,
        terminal: true,
      });
      return;
    }
    let pages = 0;
    try {
      const connectorContext: ConnectorContext = {
        tenantId: job.tenantId,
        connectionId: job.connectionId,
        config: connection.config,
        credential: await credentials.resolve(connection),
        signal: this.#abort.signal,
      };
      for (;;) {
        const result = await connector.pullPage(connectorContext, {
          cursor,
          pageSize: config.SYNC_PAGE_SIZE,
        });
        const records = [];
        let rejected = 0;
        for (const raw of result.records) {
          const normalized = connector.normalize(raw);
          if (normalized.ok) records.push(normalized.record);
          else rejected += 1;
        }
        faults?.beforePagePersist?.(pages);
        const run = await this.#ingestion.applyPage(ctx, runId, {
          records,
          rejectedByConnector: rejected,
          cursorAfter: result.nextCursor,
          complete: result.complete,
        });
        pages += 1;
        faults?.afterPagePersisted?.(pages);
        metrics.syncRecords.inc(
          { provider: connection.provider, outcome: 'seen' },
          result.records.length,
        );
        if (rejected > 0)
          metrics.syncRecords.inc({ provider: connection.provider, outcome: 'rejected' }, rejected);
        if (run.status === 'succeeded') return;
        cursor = result.nextCursor;
        if (pages >= config.SYNC_MAX_PAGES_PER_JOB || this.#stopping) {
          // Yield to other tenants; the continuation resumes this run from the persisted checkpoint.
          await this.boss.send(
            QUEUES.connectionSync,
            { ...job, runId },
            { singletonKey: job.connectionId, group: { id: job.tenantId } },
          );
          return;
        }
      }
    } catch (error) {
      if (error instanceof ConnectorError) {
        await this.#ingestion.fail(ctx, runId, {
          code: error.code,
          detail: error.message,
          terminal: error.terminal,
        });
        if (error.terminal) return;
        throw error;
      }
      if (isDomainError(error, 'CONNECTION_INACTIVE')) {
        await this.#ingestion
          .fail(ctx, runId, {
            code: 'connection_inactive',
            detail: 'connection revoked or paused during sync',
            terminal: false,
          })
          .catch(() => undefined);
        return;
      }
      throw error;
    }
  }

  async handleAnalyze(job: TenantJob, jobId: string): Promise<void> {
    const ctx = serviceContext(job.tenantId, `job:${jobId}`, ['analysis:run']);
    if (this.#deps.agent) {
      await this.#deps.agent.analyze(ctx, job.trigger, this.#abort.signal);
      return;
    }
    const analysis = await this.#analysis.run(ctx, job.trigger);
    if (analysis.generated > 0) {
      const connections = await this.#uow.run(ctx, (tx) => tx.listConnections());
      const oldest = connections
        .map((c) => c.dataAsOf)
        .filter((d): d is string => d !== null)
        .sort()[0];
      if (oldest)
        this.#deps.metrics.timeToRecommendation.observe(
          (Date.parse(analysis.completedAt) - Date.parse(oldest)) / 1000,
        );
    }
    this.#deps.logger.info(
      {
        tenantId: job.tenantId,
        analysisId: analysis.id,
        generated: analysis.generated,
        closed: analysis.closed,
        status: analysis.status,
      },
      'analysis completed',
    );
  }

  async handleMaintain(job: TenantJob, jobId: string): Promise<void> {
    const ctx = serviceContext(job.tenantId, `job:${jobId}`, ['recommendation:maintain']);
    await this.#maintenance.expireDue(ctx);
    // A process crash can leave an expired lease without a fresh source event.
    // Periodic reconciliation retries it; completed input hashes are skipped.
    if (this.#deps.agent) await this.#deps.agent.analyze(serviceContext(job.tenantId, `job:${jobId}:resume`, ['analysis:run']), 'scheduled', this.#abort.signal);
    const now = this.#deps.clock.now().getTime();
    for (const c of await this.#uow.run(ctx, (tx) => tx.listConnections())) {
      if (c.status === 'active' && c.dataAsOf) {
        this.#deps.metrics.dataAge.set(
          { tenant: c.tenantId, connection: c.id, provider: c.provider },
          (now - Date.parse(c.dataAsOf)) / 1000,
        );
      }
    }
  }

  async handlePurge(job: ConnectionJob, jobId: string): Promise<void> {
    const ctx = serviceContext(
      job.tenantId,
      `job:${jobId}`,
      ['connection:operate'],
      job.connectionId,
    );
    const connection = await this.#uow.run(ctx, (tx) => tx.getConnection(job.connectionId));
    if (!connection || connection.status !== 'revoked') return;
    // Erase agent-derived content, retain usage accounting so erasure cannot reset budgets.
    if (this.#deps.agent) await this.#deps.agent.store.transaction(ctx, async (_tx, sql) => {
      await sql.query('DELETE FROM agent_events WHERE tenant_id=$1 AND run_id IN (SELECT r.id FROM agent_runs r JOIN opportunities o ON o.tenant_id=r.tenant_id AND o.id=r.subject_id WHERE r.tenant_id=$1 AND o.connection_id=$2)', [ctx.tenantId, job.connectionId]);
      await sql.query("UPDATE agent_runs SET result=NULL,retrieved='{}',snapshot='{}',status=CASE WHEN status IN ('running','validating') THEN 'interrupted' ELSE status END,error_code='source_purged' WHERE tenant_id=$1 AND subject_id IN (SELECT id FROM opportunities WHERE tenant_id=$1 AND connection_id=$2)", [ctx.tenantId, job.connectionId]);
    });
    const connector = this.#deps.registry.get(connection.provider);
    if (connector) {
      await connector
        .revoke({
          tenantId: job.tenantId,
          connectionId: job.connectionId,
          config: connection.config,
          credential: { type: 'none' },
          signal: this.#abort.signal,
        })
        .catch((error: unknown) =>
          this.#deps.logger.warn(
            { err: error instanceof Error ? error.message : 'unknown' },
            'provider-side revocation failed',
          ),
        );
    }
    await this.#deps.credentials.remove(connection);
    await this.#maintenance.purgeRevokedConnection(ctx, job.connectionId);
  }

  /**
   * Optional wording by a model, outside any transaction. Only facts already linked
   * to the recommendation are sent; the result is validated, recorded with its
   * usage, and applied only if nobody decided or edited the proposal meanwhile.
   */
  async handleFormulate(job: RecommendationJob, jobId: string): Promise<void> {
    const settings = this.#deps.model;
    const provider = settings?.provider;
    if (!settings || !provider) return;
    const ctx = serviceContext(job.tenantId, `job:${jobId}`, ['analysis:run']);
    const inputs = await this.#formulation.prepare(ctx, job.recommendationId);
    if (!inputs) return;
    const context = inputs.context?.content;
    const result = await formulateNextStep(
      provider,
      {
        recommendation: inputs.recommendation,
        evidence: inputs.evidence,
        context: context
          ? {
              offers: context.offers,
              targetSegments: context.targetSegments,
              salesProcess: context.salesProcess,
            }
          : null,
      },
      {
        timeoutMs: settings.timeoutMs,
        maxOutputTokens: settings.maxOutputTokens,
        monthlyBudgetUsd: settings.monthlyBudgetUsd,
        spentThisMonthUsd: inputs.spentThisMonthUsd,
      },
    );
    const { metrics } = this.#deps;
    metrics.modelCalls.inc({
      provider: provider.name,
      model: result.model,
      outcome: result.status,
    });
    if (result.usage) {
      metrics.modelTokens.inc(
        { provider: provider.name, model: result.model, direction: 'input' },
        result.usage.inputTokens,
      );
      metrics.modelTokens.inc(
        { provider: provider.name, model: result.model, direction: 'output' },
        result.usage.outputTokens,
      );
      if (result.usage.costUsd !== null)
        metrics.modelCostUsd.inc(
          { provider: provider.name, model: result.model },
          result.usage.costUsd,
        );
    }
    await this.#formulation.recordUsage(ctx, {
      recommendationId: job.recommendationId,
      provider: provider.name,
      model: result.model,
      promptVersion: PROMPT_VERSION,
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
      costUsd: result.usage?.costUsd ?? null,
      latencyMs: result.latencyMs,
      outcome: result.status,
      errorCode: result.status === 'formulated' ? null : result.reason.slice(0, 64),
    });
    if (result.status !== 'formulated') return;
    try {
      await this.#formulation.apply(
        ctx,
        job.recommendationId,
        inputs.recommendation.revision,
        result.proposedAction,
        {
          provider: provider.name,
          model: result.model,
          promptVersion: PROMPT_VERSION,
        },
      );
    } catch (error) {
      // A human decided, edited, or the proposal expired meanwhile: the human action wins.
      if (
        isDomainError(error, 'REVISION_CONFLICT') ||
        isDomainError(error, 'INVALID_TRANSITION') ||
        isDomainError(error, 'EXPIRED')
      )
        return;
      throw error;
    }
  }
}
