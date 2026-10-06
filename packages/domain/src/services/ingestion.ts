import type { Context } from '../context.ts';
import { requireScope } from '../context.ts';
import { ensure, isDomainError } from '../errors.ts';
import type { NormalizedRecord, Opportunity } from '../opportunity.ts';
import { factsOf, planSourceChange, validateNormalizedRecord } from '../opportunity.ts';
import type { TenantTx } from '../ports.ts';
import type { Connection, Fact, SyncRun, SyncTrigger } from '../records.ts';
import { toInstant } from '../time.ts';
import type { ServiceDeps } from './shared.ts';
import { audit, outbox } from './shared.ts';

export type SyncStart = Readonly<{ run: SyncRun; cursor: string | null; connection: Connection }>;

export type PageInput = Readonly<{
  /** Raw connector output; each record is validated again at this trust boundary. */
  records: readonly unknown[];
  /** Records the connector itself could not normalize (counted, never stored). */
  rejectedByConnector: number;
  cursorAfter: string | null;
  /** True when the provider reports no further page for this run. */
  complete: boolean;
}>;

export type SyncFailure = Readonly<{ code: string; detail: string; terminal: boolean }>;

const ERROR_CODE = /^[a-z][a-z0-9_.-]{1,63}$/;

function minimize(detail: string): string {
  // Error details are operator hints: strip anything that looks like a token or an e-mail and cap length.
  return detail
    .replace(/[A-Za-z0-9+/_-]{32,}/g, '[redacted]')
    .replace(/[^\s@]+@[^\s@]+/g, '[redacted-email]')
    .slice(0, 300);
}

export class IngestionService {
  readonly #deps: ServiceDeps;

  constructor(deps: ServiceDeps) {
    this.#deps = deps;
  }

  /** Opens a sync run after re-checking, at execution time, that the connection is still active. */
  async start(ctx: Context, connectionId: string, trigger: SyncTrigger): Promise<SyncStart> {
    requireScope(ctx, 'source:ingest', connectionId);
    const { uow, clock, ids } = this.#deps;
    return uow.run(ctx, async (tx) => {
      const connection = await tx.getConnection(connectionId, { forUpdate: true });
      ensure(connection !== null, 'NOT_FOUND');
      ensure(connection.status === 'active', 'CONNECTION_INACTIVE', connection.status);
      const at = toInstant(clock.now());
      // Runs interrupted by a crash are closed; the new run resumes from the persisted checkpoint.
      for (const stale of await tx.listSyncRuns(connectionId, 20)) {
        if (stale.status === 'running') {
          await tx.updateSyncRun({
            ...stale,
            status: 'failed',
            completedAt: at,
            errorCode: 'interrupted',
            errorDetail: 'Run superseded by a new run.',
          });
        }
      }
      // A replay re-reads everything; other runs resume from the checkpoint advanced with the last persisted page.
      const cursor = trigger === 'replay' ? null : connection.cursor;
      const passStartedAt =
        trigger === 'replay' || connection.passStartedAt === null ? at : connection.passStartedAt;
      const run: SyncRun = {
        tenantId: ctx.tenantId,
        id: ids.next(),
        connectionId,
        trigger,
        status: 'running',
        startedAt: at,
        completedAt: null,
        pages: 0,
        seen: 0,
        created: 0,
        revised: 0,
        unchanged: 0,
        deleted: 0,
        stale: 0,
        rejected: 0,
        cursorStart: cursor,
        cursorEnd: cursor,
        errorCode: null,
        errorDetail: null,
      };
      await tx.insertSyncRun(run);
      const updated: Connection = {
        ...connection,
        cursor,
        passStartedAt,
        lastSyncStartedAt: at,
        updatedAt: at,
      };
      await tx.updateConnection(updated);
      return { run, cursor, connection: updated };
    });
  }

  /**
   * Persists one page, its facts, an outbox event and the advanced checkpoint in a
   * single transaction. Replaying a page is harmless: unchanged content creates no revision.
   */
  async applyPage(ctx: Context, runId: string, page: PageInput): Promise<SyncRun> {
    const { uow, clock, ids } = this.#deps;
    return uow.run(ctx, async (tx) => {
      const run = await tx.getSyncRun(runId);
      ensure(run !== null, 'NOT_FOUND');
      requireScope(ctx, 'source:ingest', run.connectionId);
      ensure(run.status === 'running', 'INVALID_TRANSITION', `sync run ${run.status}`);
      const connection = await tx.getConnection(run.connectionId, { forUpdate: true });
      ensure(connection !== null, 'NOT_FOUND');
      ensure(connection.status === 'active', 'CONNECTION_INACTIVE', connection.status);
      const now = clock.now().getTime();
      const at = toInstant(now);
      const counts = {
        created: 0,
        revised: 0,
        unchanged: 0,
        deleted: 0,
        stale: 0,
        rejected: page.rejectedByConnector,
      };
      for (const raw of page.records) {
        let record: NormalizedRecord;
        try {
          record = validateNormalizedRecord(raw);
        } catch (error) {
          if (isDomainError(error)) {
            counts.rejected += 1;
            continue;
          }
          throw error;
        }
        try {
          const outcome = await this.#applyRecord(tx, ctx, connection, record, at, now);
          counts[outcome] += 1;
        } catch (error) {
          if (
            isDomainError(error, 'SOURCE_VERSION_CONFLICT') ||
            isDomainError(error, 'FUTURE_SOURCE')
          ) {
            counts.rejected += 1;
            continue;
          }
          throw error;
        }
      }
      const changed = counts.created + counts.revised + counts.deleted;
      const next: SyncRun = {
        ...run,
        pages: run.pages + 1,
        seen: run.seen + page.records.length,
        created: run.created + counts.created,
        revised: run.revised + counts.revised,
        unchanged: run.unchanged + counts.unchanged,
        deleted: run.deleted + counts.deleted,
        stale: run.stale + counts.stale,
        rejected: run.rejected + counts.rejected,
        cursorEnd: page.cursorAfter,
        ...(page.complete ? { status: 'succeeded' as const, completedAt: at } : {}),
      };
      await tx.updateSyncRun(next);
      let updated: Connection = { ...connection, cursor: page.cursorAfter, updatedAt: at };
      if (page.complete) {
        updated = {
          ...updated,
          lastSuccessAt: at,
          // Records are confirmed current as of the start of the pass that just completed.
          dataAsOf: connection.passStartedAt ?? run.startedAt,
          passStartedAt: null,
          lastErrorCode: null,
          lastErrorAt: null,
          consecutiveFailures: 0,
          nextSyncAt: toInstant(now + connection.syncIntervalMinutes * 60_000),
        };
        await tx.appendAudit(
          audit(ctx, ids, at, {
            eventType: 'source.synced',
            resourceType: 'connection',
            resourceId: connection.id,
            metadata: {
              runId: run.id,
              trigger: run.trigger,
              pages: next.pages,
              created: next.created,
              revised: next.revised,
              deleted: next.deleted,
              rejected: next.rejected,
            },
          }),
        );
      }
      await tx.updateConnection(updated);
      if (changed > 0 || page.complete) {
        // Analysis is coalesced per tenant downstream; completion also refreshes data freshness.
        await tx.enqueueOutbox(
          outbox(
            ctx,
            ids,
            at,
            'source.changed',
            { type: 'connection', id: connection.id },
            { runId: run.id, changed, complete: page.complete },
          ),
        );
      }
      return next;
    });
  }

  async fail(ctx: Context, runId: string, failure: SyncFailure): Promise<SyncRun> {
    const { uow, clock, ids } = this.#deps;
    ensure(ERROR_CODE.test(failure.code), 'INVALID_INPUT', 'error code');
    return uow.run(ctx, async (tx) => {
      const run = await tx.getSyncRun(runId);
      ensure(run !== null, 'NOT_FOUND');
      requireScope(ctx, 'source:ingest', run.connectionId);
      const at = toInstant(clock.now());
      const next: SyncRun =
        run.status === 'running'
          ? {
              ...run,
              status: 'failed',
              completedAt: at,
              errorCode: failure.code,
              errorDetail: minimize(failure.detail),
            }
          : run;
      await tx.updateSyncRun(next);
      const connection = await tx.getConnection(run.connectionId, { forUpdate: true });
      if (connection && connection.status !== 'revoked') {
        await tx.updateConnection({
          ...connection,
          status: failure.terminal ? 'error' : connection.status,
          lastErrorCode: failure.code,
          lastErrorAt: at,
          consecutiveFailures: connection.consecutiveFailures + 1,
          updatedAt: at,
        });
        await tx.appendAudit(
          audit(ctx, ids, at, {
            eventType: 'connection.sync_failed',
            resourceType: 'connection',
            resourceId: connection.id,
            metadata: { runId, code: failure.code, terminal: failure.terminal },
          }),
        );
      }
      return next;
    });
  }

  async #applyRecord(
    tx: TenantTx,
    ctx: Context,
    connection: Connection,
    record: NormalizedRecord,
    at: string,
    now: number,
  ): Promise<'created' | 'revised' | 'unchanged' | 'deleted' | 'stale'> {
    const { ids } = this.#deps;
    const head = await tx.getSourceHead(connection.id, record.externalId);
    const change = planSourceChange(head, record, at, now);
    if (change.kind === 'stale' || change.kind === 'ignore_delete') return 'stale';
    if (change.kind === 'unchanged') {
      if (head) await tx.touchSourceRecord(head.sourceRecordId, at);
      return 'unchanged';
    }
    const sourceRecordId = ids.next();
    const revision = change.revision;
    const deleted = change.kind === 'delete';
    await tx.insertSourceRecord({
      tenantId: ctx.tenantId,
      id: sourceRecordId,
      connectionId: connection.id,
      entityType: 'opportunity',
      externalId: record.externalId,
      revision,
      providerVersion: record.providerVersion,
      etag: record.etag,
      contentHash: deleted ? null : change.contentHash,
      normalized: record.fields,
      sourceModifiedAt: record.sourceModifiedAt,
      observedAt: at,
      ingestedAt: at,
      deletedAt: deleted ? at : null,
    });
    const existing = await tx.getOpportunityByExternalId(connection.id, record.externalId);
    const fields = record.fields ?? existing?.fields;
    ensure(fields !== undefined, 'INVALID_INPUT', 'fields');
    const opportunity: Opportunity = {
      tenantId: ctx.tenantId,
      id: existing?.id ?? ids.next(),
      connectionId: connection.id,
      externalId: record.externalId,
      sourceRecordId,
      revision,
      fields,
      sourceModifiedAt: record.sourceModifiedAt,
      observedAt: at,
      ingestedAt: at,
      deletedAt: deleted ? at : null,
    };
    await tx.upsertOpportunity(opportunity);
    await tx.supersedeFacts(opportunity.id, at);
    if (!deleted) {
      const facts: Fact[] = factsOf(fields).map((f) => ({
        tenantId: ctx.tenantId,
        id: ids.next(),
        subjectType: 'opportunity',
        subjectId: opportunity.id,
        connectionId: connection.id,
        sourceRecordId,
        sourceRevision: revision,
        factType: f.factType,
        state: f.state,
        value: f.value,
        locator: f.locator,
        observedAt: at,
        sourceModifiedAt: record.sourceModifiedAt,
        supersededAt: null,
      }));
      await tx.insertFacts(facts);
    }
    if (deleted) return 'deleted';
    return change.kind === 'create' ? 'created' : 'revised';
  }
}
