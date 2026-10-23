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
  workflowPublicationEvidence,
  withResearchCoverage,
} from '@ulysse/domain';
import type { Pool, PoolClient, WorkflowRequest } from '@ulysse/database';
import { PgWorkspaceStore, PgResearchStore } from '@ulysse/database';
import { z } from 'zod';
import { workflowFailure, type WorkflowStage } from './agent-errors.ts';
import { WORKFLOW_TIMEOUT_MS } from './workflow-retry.ts';
import {
  researchPreview,
  workflowResearchCatalog,
  seedResearchEvidence,
} from './workflow-catalog.ts';
import { workflowCitations } from './buyer-review.ts';

export const WORKFLOW_TOOLS = [
  'get_workflow_context',
  'list_company_sources',
  'read_company_source',
] as const;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const WORKFLOW_EVIDENCE_PREFIX = 'ULYSSE_WORKFLOW_EVIDENCE_V1\n';
// Keep the initial evidence stable and bounded even when the conversation envelope
// grows. The extra capacity belongs to tool replies and signed history, not seeding.
export const nativeEvidenceBudget = (maxContextBytes: number) =>
  Math.min(56000, maxContextBytes - 24000);
function workflowContext(input: WorkflowInput, id: string) {
  const references = [
    `workflow:${id}`,
    `context:v${input.context?.version ?? 0}`,
    `doctrine:${input.doctrine?.id ?? ''}:v${input.doctrine?.version ?? 0}`,
  ];
  if (input.buyer) references.push(`buyer:${input.buyer.id}`);
  return {
    references,
    kind: input.kind,
    brief: input.brief,
    context: input.context?.content,
    doctrine: input.doctrine?.content,
    buyer: input.buyer,
    research: input.research
      ? {
          id: input.research.id,
          status: input.research.status,
          candidateCount: input.research.candidateCount,
          qualifiedCount: input.research.qualifiedCount,
          provisionalCount: input.research.pendingReferences.length,
          geography: input.research.geography,
        }
      : null,
    untrusted: true,
  };
}
function requiredSources(input: WorkflowInput, request: WorkflowRequest) {
  return input.sources.filter((s) => request.sourceIds.includes(s.id));
}
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
  maxContextBytes?: number;
  modelSettings?: Parameters<AgentExecutor['execute']>[0]['modelSettings'];
  fallbackModel?: string;
  fallbackProfileHash?: string;
  session: string;
  budgets: { run: number; session: number; month: number };
  hermesVersion: string;
};
export class WorkflowRuntime {
  readonly store: PgWorkspaceStore;
  readonly settings: Settings;
  readonly executor: AgentExecutor;
  readonly reviewBuyer: (
    capability: string,
    draft: WorkflowResult,
    signal?: AbortSignal,
  ) => Promise<WorkflowResult>;
  constructor(
    pool: Pool,
    settings: Settings,
    executor: AgentExecutor,
    reviewBuyer: WorkflowRuntime['reviewBuyer'],
  ) {
    this.store = new PgWorkspaceStore(pool);
    this.settings = settings;
    this.executor = executor;
    this.reviewBuyer = reviewBuyer;
  }
  async prepareEvidence(
    ctx: Context,
    tx: TenantTx,
    sql: PoolClient,
    subjectId: string,
    inputHash: string,
    maxEvidenceBytes: number,
    review?: { cited: readonly string[]; read: readonly string[] },
  ) {
    const run = await this.store.get(sql, ctx.tenantId, subjectId);
    const input = await this.store.input(tx, sql, run);
    this.store.assertFresh(input);
    ensure(run.status === 'running' && workflowInputHash(input) === inputHash, 'STALE_EVIDENCE');
    const context = workflowContext(input, subjectId);
    const required = review
      ? input.sources.filter(
          (s) =>
            run.sourceIds.includes(s.id) ||
            review.cited.includes(sourceReference(s)) ||
            (['offer', 'website'].includes(s.kind) && review.read.includes(sourceReference(s))),
        )
      : requiredSources(input, run);
    // Seed a bounded first comparison from saved, qualified evidence, independently
    // of whether Hermes chooses another read. Native generation uses the same fixed
    // allowance on every turn so this does not mutate its signed initial message.
    // Review may add only texts actually supplied/read during generation.
    const selected =
      input.kind === 'buyer' && input.research
        ? seedResearchEvidence(
            required,
            review
              ? input.sources.filter((s) => review.read.includes(sourceReference(s)))
              : input.sources,
            Math.min(
              24000,
              Math.max(
                0,
                maxEvidenceBytes -
                  Buffer.byteLength(JSON.stringify({ context, sources: required })) -
                  2048,
              ),
            ),
          )
        : required;
    const sources = selected.map((s) => ({
      ...s,
      reference: sourceReference(s),
      untrusted: true,
    }));
    // Deliver the actual versioned text, not just an identifier marked as read.
    // Native execution seeds this message once; later checks rebuild it only to
    // verify authorization/freshness, without modifying Hermes' signed history.
    const citationRoles = {
      offerReferences: selected
        .filter((s) => s.kind === 'offer' || s.kind === 'website')
        .map(sourceReference),
      competitorReferences: selected.filter((s) => s.kind === 'competitor').map(sourceReference),
    };
    const payload = {
      context,
      sources,
      citationRoles,
      publicationRequirements: {
        benchmarkRequired: workflowPublicationEvidence(input, []).benchmarkRequired,
      },
      untrusted: true,
    };
    // Leave room for escaped JSON and the surrounding message. Mandatory source text
    // is never truncated to fit a catalog; the gateway still checks the complete request.
    const remaining = Math.max(
      0,
      maxEvidenceBytes - Buffer.byteLength(JSON.stringify(payload)) - 512,
    );
    const researchCatalog =
      input.research && !review
        ? workflowResearchCatalog(input.sources, Math.min(24000, Math.floor(remaining / 2)))
        : undefined;
    return {
      references: [...context.references, ...sources.map((s) => s.reference)],
      publication: workflowPublicationEvidence(input, [
        ...context.references,
        ...sources.map((s) => s.reference),
      ]),
      sourceCount: sources.length,
      seededCompetitorCount: selected.length - required.length,
      catalogCount: researchCatalog?.items.length ?? 0,
      ...citationRoles,
      messageWithoutCatalog: {
        role: 'user',
        content: WORKFLOW_EVIDENCE_PREFIX + JSON.stringify(payload),
      },
      message: {
        role: 'user',
        content: WORKFLOW_EVIDENCE_PREFIX + JSON.stringify({ ...payload, researchCatalog }),
      },
    };
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
        await sql.query(
          "UPDATE agent_runs SET status='interrupted',completed_at=clock_timestamp(),error_code='lease_expired',reserved_usd=committed_usd WHERE tenant_id=$1 AND id=$2 AND status IN ('running','validating') AND expires_at<=clock_timestamp()",
          [ctx.tenantId, request.agentRunId],
        );
        await this.finish(sql, ctx, id, 'failed', null, 'interrupted');
        return false;
      }
      if (request.status !== 'queued') return false;
      if (request.researchId) {
        const research = new PgResearchStore(this.store.pool);
        const campaign = await research.campaign(sql, ctx.tenantId, request.researchId);
        if (['queued', 'running'].includes(campaign.status)) return false;
      }
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
        "UPDATE agent_runs SET status='interrupted',completed_at=clock_timestamp(),error_code='lease_expired',reserved_usd=committed_usd WHERE tenant_id=$1 AND status IN ('running','validating') AND expires_at<=clock_timestamp()",
        [ctx.tenantId],
      );
      // Older buyer/content runs kept their whole run envelope after failure. Each
      // transmitted call already has its conservative upper cost in committed_usd,
      // including calls still uncertain or in flight. Release only the unused part;
      // preserve costs, counters, session identity and all business history.
      await sql.query(
        "UPDATE agent_runs SET reserved_usd=committed_usd WHERE tenant_id=$1 AND workflow_kind IN ('buyer','content') AND status NOT IN ('running','validating') AND reserved_usd>committed_usd",
        [ctx.tenantId],
      );
      const slots = await sql.query<{ available: boolean }>(
        'SELECT app.agent_slot_available() AS available',
      );
      if (!slots.rows[0]?.available) throw new Error('agent_concurrency_limit');
      const inputHash = workflowInputHash(input);
      await sql.query(
        "INSERT INTO agent_runs(tenant_id,id,subject_id,input_hash,mode,status,trigger,snapshot,capability_hash,expires_at,session_id,model,hermes_version,instructions_version,correlation_id,workflow_kind) VALUES($1,$2,$3,$4,$5,'running','manual',$6,$7,clock_timestamp()+($14::integer * interval '1 millisecond'),$8,$9,$10,$11,$12,$13)",
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
            primaryModel: this.settings.model,
            primaryModelProfile: this.settings.modelProfile ?? null,
            fallbackModel: this.settings.fallbackModel ?? null,
            fallbackProfileHash: this.settings.fallbackProfileHash ?? null,
          }),
          hash(capability),
          this.settings.session,
          this.settings.model,
          this.settings.hermesVersion,
          WORKFLOW_VERSION,
          ctx.correlationId,
          kind,
          WORKFLOW_TIMEOUT_MS + (kind === 'buyer' ? 120000 : 0),
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
    let stage: WorkflowStage = 'execution';
    try {
      const initialEvidence =
        this.settings.providerRoute === 'anthropic' && this.settings.mode !== 'simulated'
          ? await this.store.transaction(ctx, async (tx, sql) => {
              const request = await this.store.get(sql, ctx.tenantId, id);
              const evidence = await this.prepareEvidence(
                ctx,
                tx,
                sql,
                id,
                request.inputHash ?? '',
                nativeEvidenceBudget(this.settings.maxContextBytes ?? 80000),
              );
              ensure(
                Buffer.byteLength(evidence.message.content) <= 80000,
                'INVALID_INPUT',
                'context limit',
              );
              return evidence.message.content;
            })
          : undefined;
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
                fallbackModel: this.settings.fallbackModel,
                timeoutMs: WORKFLOW_TIMEOUT_MS,
                workflow: kind,
                initialEvidence,
              },
              signal,
            );
      stage = 'result';
      let result = validateWorkflowResult(raw);
      if (
        result.kind === 'buyer' &&
        result.outcome === 'draft' &&
        this.settings.mode !== 'simulated'
      ) {
        // Do not let review turn an unread/invented citation into a newly authorized read.
        stage = 'publication';
        await this.store.transaction(ctx, async (_tx, sql) => {
          const run = Run.parse(
            (
              await sql.query('SELECT * FROM agent_runs WHERE tenant_id=$1 AND id=$2', [
                ctx.tenantId,
                agentId,
              ])
            ).rows[0],
          );
          ensure(
            workflowCitations(result).every((ref) => run.retrieved.includes(ref)),
            'INVALID_INPUT',
            'unretrieved citation',
          );
        });
        stage = 'execution';
        result = await this.reviewBuyer(capability, result, signal);
      }
      stage = 'publication';
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
          ...workflowContext(input, id).references,
          ...requiredSources(input, request).map(sourceReference),
        ];
        ensure(
          required.every((ref) => run.retrieved.includes(ref)),
          'INVALID_INPUT',
          'required source unread',
        );
        validateWorkflowPublication(result, input, new Set(run.retrieved));
        const published = withResearchCoverage(result, input);
        await sql.query(
          'UPDATE agent_runs SET status=$3,result=$4,error_code=NULL,completed_at=clock_timestamp(),reserved_usd=committed_usd WHERE tenant_id=$1 AND id=$2',
          [
            ctx.tenantId,
            agentId,
            result.outcome === 'draft' ? 'completed' : 'abstained',
            JSON.stringify(published),
          ],
        );
        await this.finish(sql, ctx, id, published.outcome, published);
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
      const code = signal?.aborted ? 'interrupted' : workflowFailure(error, stage);
      await this.store.transaction(ctx, async (_tx, sql) => {
        // Fixed codes only: do not persist an exception, source text, or model output.
        await sql.query(
          "UPDATE agent_runs SET snapshot=jsonb_set(snapshot,'{workflowFailure}',$3::jsonb) WHERE tenant_id=$1 AND id=$2 AND status='running'",
          [ctx.tenantId, agentId, JSON.stringify({ stage, code })],
        );
        const failed = await sql.query<{ error_code: string }>(
          "UPDATE agent_runs SET status=$3,error_code=CASE WHEN $3='obsolete' THEN $4 ELSE coalesce(error_code,$4) END,completed_at=clock_timestamp(),reserved_usd=committed_usd WHERE tenant_id=$1 AND id=$2 AND status='running' RETURNING error_code",
          [ctx.tenantId, agentId, obsolete ? 'obsolete' : 'failed', code],
        );
        const cause = failed.rows[0]?.error_code ?? code;
        // Revocation may already have closed this run while the gateway was waiting.
        // Keep all incurred/uncertain costs but release its unused envelope immediately.
        await sql.query(
          "UPDATE agent_runs SET reserved_usd=committed_usd WHERE tenant_id=$1 AND id=$2 AND status NOT IN ('running','validating') AND reserved_usd>committed_usd",
          [ctx.tenantId, agentId],
        );
        const run = await this.store.get(sql, ctx.tenantId, id);
        if (run.status === 'running')
          await this.finish(sql, ctx, id, obsolete ? 'obsolete' : 'failed', null, cause);
        if (failed.rowCount) await this.store.event(sql, ctx.tenantId, agentId, 'error', cause);
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
    const params = z
      .object({
        sourceId: z.uuid().optional(),
        sourceIds: z.array(z.uuid()).min(1).max(4).optional(),
        offset: z.number().int().min(0).optional(),
      })
      .strict()
      .parse(args);
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
        const context = workflowContext(input, request.id);
        refs = context.references;
        value = context;
      } else if (name === 'list_company_sources') {
        value = {
          items: input.sources.slice(params.offset ?? 0, (params.offset ?? 0) + 20).map((s) => ({
            id: s.id,
            kind: s.kind,
            title: s.title,
            origin: s.origin,
            url: s.url,
            observedAt: s.observedAt,
            ...(s.research ? { research: researchPreview(s) } : {}),
            required: request.sourceIds.includes(s.id),
            reviewStatus: input.research?.pendingReferences.includes(sourceReference(s))
              ? 'pending'
              : 'approved_or_company',
          })),
          total: input.sources.length,
          nextOffset:
            (params.offset ?? 0) + 20 < input.sources.length ? (params.offset ?? 0) + 20 : null,
          coverage: input.research
            ? 'Sources choisies et corpus de recherche publique. Lire toutes les sources required=true, puis les concurrents pertinents pour une synthèse; la matrice complète reste dans Recherche. Corpus non exhaustif, collecte et revue peuvent être incomplètes.'
            : 'Corpus fourni par l’entreprise, non exhaustif.',
        };
      } else {
        ensure(Boolean(params.sourceId) !== Boolean(params.sourceIds), 'INVALID_INPUT');
        const ids = params.sourceIds ?? [params.sourceId];
        const items = ids.map((id) => {
          const source = input.sources.find((s) => s.id === id);
          ensure(source, 'NOT_FOUND');
          const { research, ...versioned } = source;
          return {
            ...versioned,
            ...(research ? { research: researchPreview(source) } : {}),
            reference: sourceReference(source),
            untrusted: true,
          };
        });
        refs = items.map((item) => item.reference);
        value = params.sourceIds ? { items } : items[0];
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
