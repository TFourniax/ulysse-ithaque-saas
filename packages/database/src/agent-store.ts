import type { Context, TenantTx } from '@ulysse/domain';
import type { Pool, PoolClient } from 'pg';
import { runInTransaction } from './uow.ts';
import type { Row } from './rows.ts';
import { str } from './rows.ts';

/** Uses the real runtime role and the same short transaction as business publication. */
export class PgAgentStore {
  readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }
  async transaction<T>(ctx: Context, work: (tx: TenantTx, sql: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { return await runInTransaction(client, ctx, (tx) => work(tx, client)); }
    finally { client.release(); }
  }
  async resolve(hash: string): Promise<Context | null> {
    const result = await this.pool.query<Row>('SELECT * FROM app.resolve_agent_capability($1)', [hash]);
    const row = result.rows[0];
    return row ? { tenantId: str(row, 'tenant_id'), actor: { kind: 'service', serviceId: 'ulysse-worker', scopes: ['analysis:run'] }, correlationId: `agent:${str(row, 'id')}` } : null;
  }
  async event(sql: PoolClient, tenantId: string, runId: string, kind: string, label: string, references: readonly string[] = []): Promise<void> {
    await sql.query('INSERT INTO agent_events(tenant_id,run_id,sequence,kind,label,references) SELECT $1,$2,coalesce(max(sequence),0)+1,$3,$4,$5 FROM agent_events WHERE tenant_id=$1 AND run_id=$2 HAVING coalesce(max(sequence),0)<40', [tenantId, runId, kind, label, references]);
  }
  async list(ctx: Context): Promise<Row[]> {
    return this.transaction(ctx, async (_tx, sql) => (await sql.query<Row>('SELECT id,subject_id,mode,status,trigger,snapshot,model,hermes_version,instructions_version,started_at,completed_at,result,error_code,retrieved,tool_calls,model_calls,input_tokens,output_tokens,reserved_usd,committed_usd,cost_state,correlation_id FROM agent_runs WHERE tenant_id=$1 ORDER BY started_at DESC LIMIT 50', [ctx.tenantId])).rows);
  }
  async events(ctx: Context, id: string): Promise<Row[]> {
    return this.transaction(ctx, async (_tx, sql) => (await sql.query<Row>('SELECT sequence,kind,label,references,created_at FROM agent_events WHERE tenant_id=$1 AND run_id=$2 ORDER BY sequence', [ctx.tenantId, id])).rows);
  }
}
