import type { Context, TenantTx } from '@ulysse/domain';
import type { Pool, PoolClient } from 'pg';
import { runInTransaction } from './uow.ts';
import type { Row } from './rows.ts';
import { str } from './rows.ts';

/** Uses the real runtime role and the same short transaction as business publication. */
export class PgAgentStore {
  readonly pool: Pool;
  constructor(pool: Pool) {
    this.pool = pool;
  }
  async transaction<T>(
    ctx: Context,
    work: (tx: TenantTx, sql: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await runInTransaction(client, ctx, (tx) => work(tx, client));
    } finally {
      client.release();
    }
  }
  async resolve(hash: string): Promise<Context | null> {
    const result = await this.pool.query<Row>('SELECT * FROM app.resolve_agent_capability($1)', [
      hash,
    ]);
    const row = result.rows[0];
    return row
      ? {
          tenantId: str(row, 'tenant_id'),
          actor: { kind: 'service', serviceId: 'ulysse-worker', scopes: ['analysis:run'] },
          correlationId: `agent:${str(row, 'id')}`,
        }
      : null;
  }
  async event(
    sql: PoolClient,
    tenantId: string,
    runId: string,
    kind: string,
    label: string,
    references: readonly string[] = [],
  ): Promise<void> {
    await sql.query(
      'INSERT INTO agent_events(tenant_id,run_id,sequence,kind,label,reference_ids) SELECT $1,$2,coalesce(max(sequence),0)+1,$3,$4,$5 FROM agent_events WHERE tenant_id=$1 AND run_id=$2 HAVING coalesce(max(sequence),0)<40',
      [tenantId, runId, kind, label, references],
    );
  }
  async list(ctx: Context, id?: string): Promise<Row[]> {
    return this.transaction(
      ctx,
      async (_tx, sql) =>
        (
          await sql.query<Row>(
            // Subject label for the Analyses page; null once the source was purged.
            `SELECT r.id,r.subject_id,o.name AS subject_label,o.external_id AS subject_external_id,r.mode,r.status,r.trigger,r.snapshot,r.model,r.hermes_version,r.instructions_version,r.started_at,r.completed_at,r.result,r.error_code,r.retrieved,r.tool_calls,r.model_calls,r.input_tokens,r.output_tokens,r.reserved_usd,r.committed_usd,r.cost_state,r.correlation_id FROM agent_runs r LEFT JOIN opportunities o ON o.tenant_id=r.tenant_id AND o.id=r.subject_id WHERE r.tenant_id=$1 ${id ? 'AND r.id=$2' : ''} ORDER BY r.started_at DESC LIMIT 50`,
            id ? [ctx.tenantId, id] : [ctx.tenantId],
          )
        ).rows,
    );
  }
  async events(ctx: Context, id: string): Promise<Row[]> {
    return this.transaction(
      ctx,
      async (_tx, sql) =>
        (
          await sql.query<Row>(
            'SELECT sequence,kind,label,reference_ids AS "references",created_at FROM agent_events WHERE tenant_id=$1 AND run_id=$2 ORDER BY sequence',
            [ctx.tenantId, id],
          )
        ).rows,
    );
  }
}
