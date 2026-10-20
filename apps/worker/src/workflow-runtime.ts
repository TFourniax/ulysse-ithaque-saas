import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type {
  AgentExecutor,
  Context,
  TenantTx,
  WorkflowInput,
  WorkflowResult,
} from '@ulysse/domain';
import {
  ensure,
  isDomainError,
  pendingWorkflow,
  requireScope,
  sourceReference,
  validateWorkflowPublication,
  validateWorkflowResult,
  WORKFLOW_VERSION,
  workflowInputHash,
  workflowQuestions,
} from '@ulysse/domain';
import type { Pool, PoolClient, WorkflowRequest } from '@ulysse/database';
import { PgWorkspaceStore } from '@ulysse/database';
import { z } from 'zod';

export const WORKFLOW_TOOLS = [
  'get_workflow_context',
  'list_company_sources',
  'read_company_source',
] as const;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const Run = z.object({
  id: z.uuid(),
  subject_id: z.uuid(),
  input_hash: z.string(),
  status: z.string(),
  expires_at: z.string(),
  retrieved: z.array(z.string()),
  tool_calls: z.number(),
});
type Settings = {
  mode: 'rules' | 'simulated' | 'hermes-live' | 'hermes-stub';
  model: string;
  providerRoute: string;
  modelProfile?: object;
  modelProfileHash?: string;
  modelSettings?: Parameters<AgentExecutor['execute']>[0]['modelSettings'];
  session: string;
  budgets: { run: number; session: number; month: number };
  hermesVersion: string;
};
export class WorkflowRuntime {
  readonly store: PgWorkspaceStore;
  readonly settings: Settings;
  readonly executor: AgentExecutor;
  constructor(pool: Pool, settings: Settings, executor: AgentExecutor) {
    this.store = new PgWorkspaceStore(pool);
    this.settings = settings;
    this.executor = executor;
  }
  async assertCurrent(
    ctx: Context,
    tx: TenantTx,
    sql: PoolClient,
    subjectId: string,
    inputHash: string,
  ): Promise<void> {
    const run = await this.store.get(sql, ctx.tenantId, subjectId);
    const input = await this.store.input(tx, sql, run);
    this.store.assertFresh(input);
    ensure(run.status === 'running' && workflowInputHash(input) === inputHash, 'STALE_EVIDENCE');
  }
  async run(ctx: Context, id: string, signal?: AbortSignal): Promise<void> {
    requireScope(ctx, 'analysis:run');
    const capability = randomBytes(32).toString('base64url');
    const agentId = randomUUID();
    let kind: WorkflowRequest['kind'] = 'buyer';
    const accepted = await this.store.transaction(ctx, async (tx, sql) => {
      await tx.lock('analysis');
      const request = await this.store.get(sql, ctx.tenantId, id);
      kind = request.kind;
      if (request.status === 'running') {
        const active = await sql.query(
          "SELECT 1 FROM agent_runs WHERE tenant_id=$1 AND id=$2 AND status='running' AND expires_at>clock_timestamp()",
          [ctx.tenantId, request.agentRunId],
        );
        if (active.rowCount) throw new Error('workflow_already_running');
        await this.finish(sql, ctx, id, 'failed', null, 'interrupted');
        return false;
      }
      if (request.status !== 'queued') return false;
      let input: WorkflowInput;
      try {
        input = await this.store.input(tx, sql, request);
      } catch (error) {
        if (!isDomainError(error)) throw error;
        await this.finish(sql, ctx, id, 'obsolete', null, error.code);
        return false;
      }
      const questions = workflowQuestions(input);
      if (!input.doctrine) questions.push('Quelle doctrine validée doit guider cette analyse ?');
      if (questions.length) {
        await this.finish(
          sql,
          ctx,
          id,
          'needs_context',
          pendingWorkflow(kind, questions, 'Préciser le contexte avant l’analyse.'),
        );
        return false;
      }
      try {
        this.store.assertFresh(input);
      } catch (error) {
        if (!isDomainError(error)) throw error;
        await this.finish(sql, ctx, id, 'obsolete', null, error.code);
        return false;
      }
      if (request.mode !== this.settings.mode || this.settings.mode === 'rules') {
        await this.finish(
          sql,
          ctx,
          id,
          'abstained',
          pendingWorkflow(kind, [], 'Le moteur d’analyse pour ce parcours n’est pas activé.'),
          'engine_unavailable',
        );
        return false;
      }
      await sql.query(
        "UPDATE agent_runs SET status='interrupted',completed_at=clock_timestamp(),error_code='lease_expired' WHERE tenant_id=$1 AND status IN ('running','validating') AND expires_at<=clock_timestamp()",
        [ctx.tenantId],
      );
      const slots = await sql.query<{ available: boolean }>(
        'SELECT app.agent_slot_available() AS available',
      );
      if (!slots.rows[0]?.available) throw new Error('agent_concurrency_limit');
      const inputHash = workflowInputHash(input);
      await sql.query(
        "INSERT INTO agent_runs(tenant_id,id,subject_id,input_hash,mode,status,trigger,snapshot,capability_hash,expires_at,session_id,model,hermes_version,instructions_version,correlation_id,workflow_kind) VALUES($1,$2,$3,$4,$5,'running','manual',$6,$7,clock_timestamp()+interval '90 seconds',$8,$9,$10,$11,$12,$13)",
        [
          ctx.tenantId,
          agentId,
          id,
          inputHash,
          this.settings.mode,
          JSON.stringify({
            contextVersion: input.context?.version,
            doctrineId: input.doctrine?.id,
            sources: input.sources.map((s) => ({ id: s.id, revision: s.revision })),
            buyerRunId: input.buyer?.id ?? null,
            providerRoute: this.settings.providerRoute,
            modelProfile: this.settings.modelProfile ?? null,
            modelProfileHash: this.settings.modelProfileHash ?? null,
          }),
          hash(capability),
          this.settings.session,
          this.settings.model,
          this.settings.hermesVersion,
          WORKFLOW_VERSION,
          ctx.correlationId,
          kind,
        ],
      );
      await sql.query(
        "UPDATE workflow_requests SET status='running',input_hash=$3,agent_run_id=$4,revision=revision+1 WHERE tenant_id=$1 AND id=$2",
        [ctx.tenantId, id, inputHash, agentId],
      );
      if (this.settings.mode !== 'simulated') {
        const b = this.settings.budgets;
        const reserved = await sql.query<{ accepted: boolean }>(
          'SELECT app.reserve_agent_run_budget($1,$2,$3,$4) AS accepted',
          [agentId, b.run, b.session, b.month],
        );
        if (!reserved.rows[0]?.accepted) {
          await sql.query(
            "UPDATE agent_runs SET status='budget_reached',completed_at=clock_timestamp(),error_code='reservation_refused' WHERE tenant_id=$1 AND id=$2",
            [ctx.tenantId, agentId],
          );
          await this.finish(sql, ctx, id, 'failed', null, 'budget_reached');
          return false;
        }
      }
      await this.store.event(
        sql,
        ctx.tenantId,
        agentId,
        'started',
        kind === 'buyer' ? 'Client synthétique démarré' : 'Contenu contextualisé démarré',
      );
      return true;
    });
    if (!accepted) return;
    try {
      const raw =
        this.settings.mode === 'simulated'
          ? await this.simulate(capability, kind)
          : await this.executor.execute(
              {
                runId: agentId,
                capability,
                subjectId: id,
                mode: this.settings.mode === 'hermes-stub' ? 'hermes-stub' : 'hermes-live',
                model: this.settings.model,
                modelSettings: this.settings.modelSettings,
                timeoutMs: 90000,
                workflow: kind,
              },
              signal,
            );
      const result = validateWorkflowResult(raw);
      await this.store.transaction(ctx, async (tx, sql) => {
        await tx.lock('analysis');
        const request = await this.store.get(sql, ctx.tenantId, id);
        const run = Run.parse(
          (
            await sql.query('SELECT * FROM agent_runs WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [
              ctx.tenantId,
              agentId,
            ])
          ).rows[0],
        );
        ensure(
          run.status === 'running' &&
            request.status === 'running' &&
            Date.parse(run.expires_at) > Date.now(),
          'STALE_EVIDENCE',
        );
        const input = await this.store.input(tx, sql, request);
        this.store.assertFresh(input);
        ensure(run.input_hash === workflowInputHash(input), 'STALE_EVIDENCE');
        const required = [
          `workflow:${id}`,
          `context:v${input.context?.version ?? 0}`,
          `doctrine:${input.doctrine?.id ?? ''}:v${input.doctrine?.version ?? 0}`,
          ...input.sources.map(sourceReference),
        ];
        if (input.buyer) required.push(`buyer:${input.buyer.id}`);
        ensure(
          required.every((ref) => run.retrieved.includes(ref)),
          'INVALID_INPUT',
          'required source unread',
        );
        validateWorkflowPublication(result, input, new Set(run.retrieved));
        await sql.query(
          "UPDATE agent_runs SET status=$3,result=$4,completed_at=clock_timestamp(),reserved_usd=CASE WHEN cost_state='unknown' THEN reserved_usd ELSE committed_usd END WHERE tenant_id=$1 AND id=$2",
          [
            ctx.tenantId,
            agentId,
            result.outcome === 'draft' ? 'completed' : 'abstained',
            JSON.stringify(result),
          ],
        );
        await this.finish(sql, ctx, id, result.outcome, result);
        await this.store.audit(tx, ctx, 'workflow.completed', id);
        await this.store.event(
          sql,
          ctx.tenantId,
          agentId,
          'completed',
          'Résultat préparé pour revue humaine',
        );
      });
    } catch (error) {
      const obsolete = isDomainError(error, 'STALE_EVIDENCE');
      const code = signal?.aborted
        ? 'interrupted'
        : obsolete
          ? 'versions_changed'
          : 'result_refused';
      await this.store.transaction(ctx, async (_tx, sql) => {
        await sql.query(
          "UPDATE agent_runs SET status=$3,error_code=$4,completed_at=clock_timestamp() WHERE tenant_id=$1 AND id=$2 AND status='running'",
          [ctx.tenantId, agentId, obsolete ? 'obsolete' : 'failed', code],
        );
        const run = await this.store.get(sql, ctx.tenantId, id);
        if (run.status === 'running')
          await this.finish(sql, ctx, id, obsolete ? 'obsolete' : 'failed', null, code);
      });
    }
  }
  async finish(
    sql: PoolClient,
    ctx: Context,
    id: string,
    status: WorkflowRequest['status'],
    result: WorkflowResult | null,
    error: string | null = null,
  ): Promise<void> {
    await sql.query(
      'UPDATE workflow_requests SET status=$3,result=$4,error_code=$5,revision=revision+1 WHERE tenant_id=$1 AND id=$2',
      [ctx.tenantId, id, status, result ? JSON.stringify(result) : null, error],
    );
  }
  async tool(capability: string, name: string, args: unknown): Promise<unknown> {
    ensure((WORKFLOW_TOOLS as readonly string[]).includes(name), 'FORBIDDEN');
    const params = z.object({ sourceId: z.uuid().optional() }).strict().parse(args);
    const ctx = await this.store.resolve(hash(capability));
    ensure(ctx, 'FORBIDDEN');
    return this.store.transaction(ctx, async (tx, sql) => {
      const run = Run.parse(
        (
          await sql.query(
            'SELECT * FROM agent_runs WHERE tenant_id=$1 AND capability_hash=$2 FOR UPDATE',
            [ctx.tenantId, hash(capability)],
          )
        ).rows[0],
      );
      ensure(
        run.status === 'running' && Date.parse(run.expires_at) > Date.now() && run.tool_calls < 12,
        'FORBIDDEN',
      );
      const request = await this.store.get(sql, ctx.tenantId, run.subject_id);
      const input = await this.store.input(tx, sql, request);
      this.store.assertFresh(input);
      ensure(
        request.status === 'running' && workflowInputHash(input) === run.input_hash,
        'STALE_EVIDENCE',
      );
      let refs: string[] = [];
      let value: unknown;
      if (name === 'get_workflow_context') {
        refs = [
          `workflow:${request.id}`,
          `context:v${input.context?.version ?? 0}`,
          `doctrine:${input.doctrine?.id ?? ''}:v${input.doctrine?.version ?? 0}`,
        ];
        if (input.buyer) refs.push(`buyer:${input.buyer.id}`);
        value = {
          references: refs,
          kind: input.kind,
          brief: input.brief,
          context: input.context?.content,
          doctrine: input.doctrine?.content,
          buyer: input.buyer,
          untrusted: true,
        };
      } else if (name === 'list_company_sources') {
        value = {
          items: input.sources.map((s) => ({
            id: s.id,
            kind: s.kind,
            title: s.title,
            origin: s.origin,
            url: s.url,
            observedAt: s.observedAt,
          })),
          coverage: 'Corpus fourni par l’entreprise, non exhaustif.',
        };
      } else {
        const source = input.sources.find((s) => s.id === params.sourceId);
        ensure(source, 'NOT_FOUND');
        refs = [sourceReference(source)];
        value = { ...source, reference: refs[0], untrusted: true };
      }
      await sql.query(
        'UPDATE agent_runs SET tool_calls=tool_calls+1,retrieved=ARRAY(SELECT DISTINCT unnest(retrieved || $3::text[])) WHERE tenant_id=$1 AND id=$2',
        [ctx.tenantId, run.id, refs],
      );
      await this.store.event(sql, ctx.tenantId, run.id, 'tool', name, refs);
      return value;
    });
  }
  async simulate(capability: string, kind: WorkflowRequest['kind']): Promise<WorkflowResult> {
    await this.tool(capability, 'get_workflow_context', {});
    const list = z
      .object({ items: z.array(z.object({ id: z.uuid() })) })
      .parse(await this.tool(capability, 'list_company_sources', {}));
    for (const s of list.items)
      await this.tool(capability, 'read_company_source', { sourceId: s.id });
    return pendingWorkflow(
      kind,
      [],
      'Circuit vérifié en simulation. Aucun diagnostic ni contenu métier n’est produit sans modèle réel.',
    );
  }
}
