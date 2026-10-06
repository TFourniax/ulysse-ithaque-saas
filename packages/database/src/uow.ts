import type { Context, TenantTx, UnitOfWork } from '@ulysse/domain';
import { actorRef, assertContext, DomainError } from '@ulysse/domain';
import type { Pool, PoolClient } from 'pg';
import { PgTenantTx } from './tenant-tx.ts';

type PgError = Error & { code?: string; constraint?: string; table?: string };

const RETRYABLE = new Set(['40001', '40P01']);

function isPgError(error: unknown): error is PgError {
  return error instanceof Error && typeof (error as PgError).code === 'string';
}

/** Translates storage errors into stable domain codes; unknown errors propagate unchanged. */
export function mapPgError(error: unknown): unknown {
  if (!isPgError(error)) return error;
  switch (error.code) {
    case '23505':
      if (error.table === 'idempotency_receipts') return new DomainError('IDEMPOTENCY_CONFLICT');
      if (error.table === 'source_records')
        return new DomainError('SOURCE_VERSION_CONFLICT', 'duplicate revision');
      return new DomainError('REVISION_CONFLICT', error.constraint ?? error.table ?? 'unique');
    case '23503':
      return new DomainError(
        'NOT_FOUND',
        `reference outside tenant or missing (${error.constraint ?? 'fk'})`,
      );
    case '22P02':
      return new DomainError('NOT_FOUND', 'malformed identifier');
    case '42501':
      return /row-level security/i.test(error.message)
        ? new DomainError('TENANT_MISMATCH')
        : new DomainError('FORBIDDEN', 'storage privilege');
    case undefined:
    default:
      return error;
  }
}

/**
 * One PostgreSQL transaction per unit of work. The tenant and user are set with
 * `set_config(..., is_local => true)`: they vanish at COMMIT/ROLLBACK, so a pooled
 * connection never carries a previous tenant's context.
 */
export class PgUnitOfWork implements UnitOfWork {
  readonly #pool: Pool;
  readonly #maxAttempts: number;

  constructor(pool: Pool, options: { maxAttempts?: number } = {}) {
    this.#pool = pool;
    this.#maxAttempts = options.maxAttempts ?? 3;
  }

  async run<T>(ctx: Context, work: (tx: TenantTx) => Promise<T>): Promise<T> {
    assertContext(ctx);
    for (let attempt = 1; ; attempt += 1) {
      const client = await this.#pool.connect();
      let broken = false;
      try {
        return await runInTransaction(client, ctx, work);
      } catch (error) {
        broken = isPgError(error) && error.code?.startsWith('08') === true;
        if (isPgError(error) && RETRYABLE.has(error.code ?? '') && attempt < this.#maxAttempts)
          continue;
        throw mapPgError(error);
      } finally {
        client.release(broken);
      }
    }
  }
}

export async function runInTransaction<T>(
  client: PoolClient,
  ctx: Context,
  work: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  await client.query('BEGIN');
  try {
    const actor = actorRef(ctx.actor);
    await client.query(
      "SELECT set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true), set_config('app.actor', $3, true), set_config('app.correlation_id', $4, true)",
      [
        ctx.tenantId,
        actor.type === 'user' ? actor.id : '',
        `${actor.type}:${actor.id}`,
        ctx.correlationId,
      ],
    );
    const result = await work(new PgTenantTx(client, ctx.tenantId));
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}
