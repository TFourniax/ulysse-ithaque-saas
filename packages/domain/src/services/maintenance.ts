import type { Context } from '../context.ts';
import { requireScope } from '../context.ts';
import { ensure } from '../errors.ts';
import { close } from '../recommendation.ts';
import { parseInstant, toInstant } from '../time.ts';
import type { ServiceDeps } from './shared.ts';
import { audit } from './shared.ts';

export class MaintenanceService {
  readonly #deps: ServiceDeps;

  constructor(deps: ServiceDeps) {
    this.#deps = deps;
  }

  /** Persists TTL expiry so lists, audit and approvals agree on the closed state. */
  async expireDue(ctx: Context): Promise<{ expired: number }> {
    requireScope(ctx, 'recommendation:maintain');
    const { uow, clock, ids } = this.#deps;
    return uow.run(ctx, async (tx) => {
      const now = clock.now().getTime();
      const at = toInstant(now);
      let expired = 0;
      for (const rec of await tx.listOpenRecommendations()) {
        if (now < parseInstant(rec.expiresAt)) continue;
        const locked = await tx.getRecommendation(rec.id, { forUpdate: true });
        if (!locked || (locked.status !== 'pending' && locked.status !== 'draft')) continue;
        const next = close(locked, 'expired', 'ttl', now);
        await tx.updateRecommendation(next);
        await tx.appendAudit(
          audit(ctx, ids, at, {
            eventType: 'recommendation.expired',
            resourceType: 'recommendation',
            resourceId: next.id,
            revision: next.revision,
            metadata: { reason: 'ttl' },
          }),
        );
        expired += 1;
      }
      return { expired };
    });
  }

  /** Deletes source records, projections and facts of a revoked connection (retention: immediate). */
  async purgeRevokedConnection(
    ctx: Context,
    connectionId: string,
  ): Promise<{ sourceRecords: number; opportunities: number; facts: number }> {
    requireScope(ctx, 'connection:operate', connectionId);
    const { uow, clock, ids } = this.#deps;
    return uow.run(ctx, async (tx) => {
      const connection = await tx.getConnection(connectionId, { forUpdate: true });
      ensure(connection !== null, 'NOT_FOUND');
      ensure(
        connection.status === 'revoked',
        'INVALID_TRANSITION',
        'purge requires a revoked connection',
      );
      const purged = await tx.purgeConnectionData(connectionId);
      const at = toInstant(clock.now());
      await tx.updateConnection({
        ...connection,
        cursor: null,
        passStartedAt: null,
        credentialRef: null,
        updatedAt: at,
      });
      await tx.appendAudit(
        audit(ctx, ids, at, {
          eventType: 'connection.purged',
          resourceType: 'connection',
          resourceId: connectionId,
          metadata: purged,
        }),
      );
      return purged;
    });
  }
}
