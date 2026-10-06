import type { Context } from '../context.ts';
import { requirePermission } from '../context.ts';
import { ensure } from '../errors.ts';
import { close, isOpen } from '../recommendation.ts';
import type { Connection, SyncRun } from '../records.ts';
import { toInstant } from '../time.ts';
import type { ServiceDeps } from './shared.ts';
import { audit, outbox } from './shared.ts';

/** What the domain needs to know about an installed connector, without importing it. */
export type ConnectorDescription = Readonly<{
  provider: string;
  kind: 'fixture' | 'live';
  scopes: readonly string[];
  defaultSyncIntervalMinutes: number;
  validateConfig(config: unknown): Readonly<Record<string, string | number | boolean>>;
}>;

export interface ConnectorCatalog {
  describe(provider: string): ConnectorDescription | null;
}

export type CreateConnectionInput = Readonly<{
  provider: string;
  displayName: string;
  config: unknown;
  syncIntervalMinutes?: number;
}>;

export class ConnectionService {
  readonly #deps: ServiceDeps;
  readonly #catalog: ConnectorCatalog;

  constructor(deps: ServiceDeps, catalog: ConnectorCatalog) {
    this.#deps = deps;
    this.#catalog = catalog;
  }

  async list(ctx: Context): Promise<Connection[]> {
    requirePermission(ctx, 'connection:read');
    return this.#deps.uow.run(ctx, (tx) => tx.listConnections());
  }

  async syncRuns(ctx: Context, connectionId: string, limit = 20): Promise<SyncRun[]> {
    requirePermission(ctx, 'connection:read');
    return this.#deps.uow.run(ctx, async (tx) => {
      ensure((await tx.getConnection(connectionId)) !== null, 'NOT_FOUND');
      return tx.listSyncRuns(connectionId, Math.min(Math.max(limit, 1), 100));
    });
  }

  /**
   * Authorizes a source for the tenant. For providers needing OAuth, the adapter
   * completes the provider flow first and passes only an opaque `credentialRef`.
   */
  async create(
    ctx: Context,
    input: CreateConnectionInput,
    credentialRef: string | null = null,
  ): Promise<Connection> {
    const actor = requirePermission(ctx, 'connection:manage');
    const description = this.#catalog.describe(input.provider);
    ensure(description !== null, 'INVALID_INPUT', 'provider');
    ensure(
      typeof input.displayName === 'string' &&
        input.displayName.trim().length > 0 &&
        input.displayName.length <= 120,
      'INVALID_INPUT',
      'displayName',
    );
    const interval = input.syncIntervalMinutes ?? description.defaultSyncIntervalMinutes;
    ensure(
      Number.isInteger(interval) && interval >= 5 && interval <= 7 * 24 * 60,
      'INVALID_INPUT',
      'syncIntervalMinutes',
    );
    const config = description.validateConfig(input.config);
    const { uow, clock, ids } = this.#deps;
    return uow.run(ctx, async (tx) => {
      const at = toInstant(clock.now());
      const connection: Connection = {
        tenantId: ctx.tenantId,
        id: ids.next(),
        provider: description.provider,
        displayName: input.displayName.trim(),
        status: 'active',
        config,
        credentialRef,
        grantedScopes: description.scopes,
        syncIntervalMinutes: interval,
        cursor: null,
        passStartedAt: null,
        lastSyncStartedAt: null,
        lastSuccessAt: null,
        dataAsOf: null,
        lastErrorCode: null,
        lastErrorAt: null,
        consecutiveFailures: 0,
        nextSyncAt: at,
        createdBy: actor.userId,
        createdAt: at,
        updatedAt: at,
        revokedAt: null,
        revokedBy: null,
      };
      await tx.insertConnection(connection);
      await tx.appendAudit(
        audit(ctx, ids, at, {
          eventType: 'connection.created',
          resourceType: 'connection',
          resourceId: connection.id,
          metadata: { provider: connection.provider, scopes: connection.grantedScopes.join(' ') },
        }),
      );
      await tx.enqueueOutbox(
        outbox(
          ctx,
          ids,
          at,
          'connection.sync_requested',
          { type: 'connection', id: connection.id },
          { trigger: 'initial' },
        ),
      );
      return connection;
    });
  }

  /** Queues a sync through the outbox; the response means "queued", never "done". */
  async requestSync(
    ctx: Context,
    connectionId: string,
    options: { replay?: boolean } = {},
  ): Promise<{ queued: true }> {
    requirePermission(ctx, options.replay ? 'connection:manage' : 'connection:sync');
    const { uow, clock, ids } = this.#deps;
    return uow.run(ctx, async (tx) => {
      const connection = await tx.getConnection(connectionId);
      ensure(connection !== null, 'NOT_FOUND');
      ensure(connection.status === 'active', 'CONNECTION_INACTIVE', connection.status);
      const at = toInstant(clock.now());
      const trigger = options.replay ? 'replay' : 'manual';
      await tx.appendAudit(
        audit(ctx, ids, at, {
          eventType: 'connection.sync_requested',
          resourceType: 'connection',
          resourceId: connectionId,
          metadata: { trigger },
        }),
      );
      await tx.enqueueOutbox(
        outbox(
          ctx,
          ids,
          at,
          'connection.sync_requested',
          { type: 'connection', id: connectionId },
          { trigger },
        ),
      );
      return { queued: true };
    });
  }

  /**
   * Revocation is immediate for reads and approvals (status check) and asynchronous
   * for cleanup: the worker deletes credentials and purges source data via the outbox.
   */
  async revoke(ctx: Context, connectionId: string): Promise<Connection> {
    const actor = requirePermission(ctx, 'connection:manage');
    const { uow, clock, ids } = this.#deps;
    return uow.run(ctx, async (tx) => {
      const connection = await tx.getConnection(connectionId, { forUpdate: true });
      ensure(connection !== null, 'NOT_FOUND');
      ensure(connection.status !== 'revoked', 'INVALID_TRANSITION', 'already revoked');
      const now = clock.now().getTime();
      const at = toInstant(now);
      const revoked: Connection = {
        ...connection,
        status: 'revoked',
        revokedAt: at,
        revokedBy: actor.userId,
        nextSyncAt: null,
        updatedAt: at,
      };
      await tx.updateConnection(revoked);
      for (const rec of await tx.listOpenRecommendations()) {
        if (rec.subject.connectionId !== connectionId || !isOpen(rec.status)) continue;
        const next = close(rec, 'expired', 'connection_revoked', now);
        await tx.updateRecommendation(next);
        await tx.appendAudit(
          audit(ctx, ids, at, {
            eventType: 'recommendation.expired',
            resourceType: 'recommendation',
            resourceId: rec.id,
            revision: next.revision,
            metadata: { reason: 'connection_revoked' },
          }),
        );
      }
      await tx.appendAudit(
        audit(ctx, ids, at, {
          eventType: 'connection.revoked',
          resourceType: 'connection',
          resourceId: connectionId,
        }),
      );
      await tx.enqueueOutbox(
        outbox(
          ctx,
          ids,
          at,
          'connection.revoked',
          { type: 'connection', id: connectionId },
          { provider: connection.provider },
        ),
      );
      return revoked;
    });
  }
}
