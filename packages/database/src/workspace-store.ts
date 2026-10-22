import { randomUUID } from 'node:crypto';
import type {
  Context,
  TenantTx,
  WorkflowBrief,
  WorkflowInput,
  WorkflowKind,
  WorkflowResult,
  WorkspaceSource,
} from '@ulysse/domain';
import {
  assertUsableForAnalysis,
  ensure,
  fingerprintOf,
  HOUR_MS,
  isDomainError,
  requirePermission,
  workflowInputHash,
} from '@ulysse/domain';
import type { PoolClient } from 'pg';
import { PgAgentStore } from './agent-store.ts';
import { PgResearchStore } from './research-store.ts';
import type { Row } from './rows.ts';
import { int, json, oneOf, str, strOrNull } from './rows.ts';

export type WorkflowRequest = {
  id: string;
  kind: WorkflowKind;
  brief: WorkflowBrief;
  sourceIds: string[];
  revision: number;
  status:
    | 'queued'
    | 'running'
    | 'draft'
    | 'needs_context'
    | 'abstained'
    | 'approved'
    | 'rejected'
    | 'obsolete'
    | 'failed';
  mode: 'rules' | 'simulated' | 'hermes-live' | 'hermes-stub';
  result: WorkflowResult | null;
  errorCode: string | null;
  createdAt: string;
  inputHash: string | null;
  agentRunId: string | null;
  stale: boolean;
  researchId: string | null;
};
function requestFrom(r: Row): WorkflowRequest {
  return {
    id: str(r, 'id'),
    kind: oneOf(r, 'kind', ['buyer', 'content']),
    brief: json(r, 'brief'),
    sourceIds: json(r, 'source_ids'),
    revision: int(r, 'revision'),
    status: oneOf(r, 'status', [
      'queued',
      'running',
      'draft',
      'needs_context',
      'abstained',
      'approved',
      'rejected',
      'obsolete',
      'failed',
    ]),
    mode: oneOf(r, 'mode', ['rules', 'simulated', 'hermes-live', 'hermes-stub']),
    result: json(r, 'result'),
    errorCode: strOrNull(r, 'error_code'),
    createdAt: str(r, 'created_at'),
    inputHash: strOrNull(r, 'input_hash'),
    agentRunId: strOrNull(r, 'agent_run_id'),
    stale: false,
    researchId: strOrNull(r, 'research_id'),
  };
}
export class PgWorkspaceStore extends PgAgentStore {
  async sources(ctx: Context): Promise<WorkspaceSource[]> {
    return this.transaction(ctx, (_tx, sql) => this.readSources(sql, ctx.tenantId));
  }
  async readSources(sql: PoolClient, tenantId: string): Promise<WorkspaceSource[]> {
    const rows = await sql.query<Row>(
      'SELECT id,revision,body FROM workspace_sources WHERE tenant_id=$1 AND retired_at IS NULL ORDER BY created_at,id LIMIT 200',
      [tenantId],
    );
    return rows.rows.map((r) => ({
      ...json<Omit<WorkspaceSource, 'id' | 'revision'>>(r, 'body'),
      id: str(r, 'id'),
      revision: int(r, 'revision'),
    }));
  }
  async saveSource(
    ctx: Context,
    source: Omit<WorkspaceSource, 'id' | 'revision'>,
    existing?: { id: string; revision: number },
  ): Promise<WorkspaceSource> {
    requirePermission(ctx, 'context:manage');
    ensure(
      Number.isFinite(Date.parse(source.observedAt)) && Date.parse(source.observedAt) <= Date.now(),
      'FUTURE_SOURCE',
    );
    return this.transaction(ctx, async (tx, sql) => {
      await tx.lock('analysis');
      const id = existing?.id ?? randomUUID();
      if (existing) {
        const updated = await sql.query(
          'UPDATE workspace_sources SET body=$4,revision=revision+1 WHERE tenant_id=$1 AND id=$2 AND revision=$3 AND retired_at IS NULL',
          [ctx.tenantId, id, existing.revision, JSON.stringify(source)],
        );
        ensure(updated.rowCount === 1, 'REVISION_CONFLICT');
      } else {
        ensure(
          (await this.readSources(sql, ctx.tenantId)).length < 200,
          'INVALID_INPUT',
          'source limit',
        );
        await sql.query(
          'INSERT INTO workspace_sources(tenant_id,id,revision,body) VALUES($1,$2,1,$3)',
          [ctx.tenantId, id, JSON.stringify(source)],
        );
      }
      await this.audit(tx, ctx, 'workspace.source_saved', id);
      return { ...source, id, revision: (existing?.revision ?? 0) + 1 };
    });
  }
  async withdraw(ctx: Context, id: string, revision: number): Promise<void> {
    requirePermission(ctx, 'context:manage');
    await this.transaction(ctx, async (tx, sql) => {
      await tx.lock('analysis');
      const changed = await sql.query(
        "UPDATE workspace_sources SET body='{}',retired_at=clock_timestamp(),revision=revision+1 WHERE tenant_id=$1 AND id=$2 AND revision=$3 AND retired_at IS NULL",
        [ctx.tenantId, id, revision],
      );
      ensure(changed.rowCount === 1, 'REVISION_CONFLICT');
      await sql.query('SELECT app.withdraw_workspace_source($1)', [id]);
      await this.audit(tx, ctx, 'workspace.source_withdrawn', id);
    });
  }
  async get(sql: PoolClient, tenantId: string, id: string): Promise<WorkflowRequest> {
    const row = (
      await sql.query<Row>('SELECT * FROM workflow_requests WHERE tenant_id=$1 AND id=$2', [
        tenantId,
        id,
      ])
    ).rows[0];
    ensure(row, 'NOT_FOUND');
    return requestFrom(row);
  }
  async input(tx: TenantTx, sql: PoolClient, request: WorkflowRequest): Promise<WorkflowInput> {
    const [context, doctrine, all] = await Promise.all([
      tx.getCurrentContext(),
      tx.getActiveDoctrine(),
      this.readSources(sql, tx.tenantId),
    ]);
    const sources = request.sourceIds.map((id) => {
      const s = all.find((s) => s.id === id);
      ensure(s, 'STALE_EVIDENCE', 'source unavailable');
      return s;
    });
    let buyer: WorkflowInput['buyer'] = null;
    if (request.brief.buyerRunId) {
      ensure(request.kind === 'content', 'INVALID_INPUT');
      const previous = await this.get(sql, tx.tenantId, request.brief.buyerRunId);
      ensure(
        previous.kind === 'buyer' &&
          previous.brief.buyerRunId === null &&
          (previous.status === 'draft' || previous.status === 'approved') &&
          previous.result?.outcome === 'draft',
        'STALE_EVIDENCE',
        'buyer unavailable',
      );
      const priorInput = await this.input(tx, sql, previous);
      ensure(
        previous.inputHash === workflowInputHash(priorInput),
        'STALE_EVIDENCE',
        'buyer obsolete',
      );
      this.assertFresh(priorInput);
      buyer = { id: previous.id, result: previous.result };
    }
    let research: WorkflowInput['research'];
    if (request.researchId) {
      const store = new PgResearchStore(this.pool);
      const campaign = await store.campaign(sql, tx.tenantId, request.researchId);
      ensure(await store.isCurrent(tx, sql, campaign), 'STALE_EVIDENCE');
      const corpus = await store.workflowSources(
        sql,
        tx.tenantId,
        request.researchId,
        request.brief,
      );
      sources.push(...corpus.sources);
      research = {
        id: campaign.id,
        revision: campaign.revision,
        status: campaign.status,
        candidateCount: campaign.candidateCount,
        qualifiedCount: campaign.qualifiedCount,
        pendingReferences: corpus.pendingReferences,
        geography: campaign.profile.geography,
      };
    }
    return {
      kind: request.kind,
      brief: request.brief,
      context,
      doctrine,
      sources,
      buyer,
      research,
    };
  }
  assertFresh(input: WorkflowInput): void {
    ensure(input.doctrine, 'DOCTRINE_NOT_VALIDATED');
    assertUsableForAnalysis(input.doctrine);
    const maxAge = input.doctrine.content.policy.maxSourceAgeHours * HOUR_MS;
    ensure(
      input.sources.every(
        (s) =>
          Date.parse(s.observedAt) <= Date.now() && Date.now() - Date.parse(s.observedAt) <= maxAge,
      ),
      'STALE_EVIDENCE',
      'refresh source excerpts',
    );
  }
  async listWorkflows(ctx: Context): Promise<WorkflowRequest[]> {
    requirePermission(ctx, 'analysis:read');
    return this.transaction(ctx, async (tx, sql) => {
      const rows = (
        await sql.query<Row>(
          'SELECT * FROM workflow_requests WHERE tenant_id=$1 ORDER BY created_at DESC,id DESC LIMIT 50',
          [ctx.tenantId],
        )
      ).rows;
      const runs: WorkflowRequest[] = [];
      for (const row of rows) {
        const run = requestFrom(row);
        if (run.inputHash) {
          try {
            const input = await this.input(tx, sql, run);
            this.assertFresh(input);
            run.stale = run.inputHash !== workflowInputHash(input);
          } catch (error) {
            if (!isDomainError(error)) throw error;
            run.stale = true;
          }
        }
        runs.push(run);
      }
      return runs;
    });
  }
  async create(
    ctx: Context,
    body: {
      kind: WorkflowKind;
      brief: WorkflowBrief;
      sourceIds: string[];
      requestKey: string;
      researchId?: string;
    },
    mode: WorkflowRequest['mode'],
  ): Promise<string> {
    const actor = requirePermission(ctx, 'recommendation:revise');
    ensure(new Set(body.sourceIds).size === body.sourceIds.length, 'INVALID_INPUT');
    ensure(body.kind === 'content' || body.brief.buyerRunId === null, 'INVALID_INPUT');
    ensure(body.kind === 'buyer' || body.researchId === undefined, 'INVALID_INPUT');
    return this.transaction(ctx, async (tx, sql) => {
      await tx.lock('analysis');
      const requestHash = fingerprintOf({ body, mode });
      const previous = (
        await sql.query<Row>(
          'SELECT id,request_hash FROM workflow_requests WHERE tenant_id=$1 AND created_by=$2 AND request_key=$3',
          [ctx.tenantId, actor.userId, body.requestKey],
        )
      ).rows[0];
      if (previous) {
        ensure(str(previous, 'request_hash') === requestHash, 'IDEMPOTENCY_CONFLICT');
        return str(previous, 'id');
      }
      const sources = await this.readSources(sql, ctx.tenantId);
      ensure(
        body.sourceIds.every((id) => sources.some((s) => s.id === id)),
        'NOT_FOUND',
      );
      const pending = await sql.query(
        "SELECT id FROM workflow_requests WHERE tenant_id=$1 AND status IN ('queued','running') LIMIT 5",
        [ctx.tenantId],
      );
      ensure((pending.rowCount ?? 0) < 5, 'INVALID_INPUT', 'queue limit');
      const id = randomUUID();
      const researchStore = new PgResearchStore(this.pool);
      const researchId =
        body.kind === 'buyer'
          ? await researchStore.forWorkflow(ctx, tx, sql, body.researchId)
          : body.brief.buyerRunId
            ? (await this.get(sql, ctx.tenantId, body.brief.buyerRunId)).researchId
            : null;
      await sql.query(
        'INSERT INTO workflow_requests(tenant_id,id,kind,brief,source_ids,request_key,request_hash,mode,created_by,research_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [
          ctx.tenantId,
          id,
          body.kind,
          JSON.stringify(body.brief),
          body.sourceIds,
          body.requestKey,
          requestHash,
          mode,
          actor.userId,
          researchId,
        ],
      );
      // Validate a linked buyer in the same tenant now; it is rechecked by the worker.
      if (body.brief.buyerRunId) await this.input(tx, sql, await this.get(sql, ctx.tenantId, id));
      await tx.enqueueOutbox({
        tenantId: ctx.tenantId,
        id: randomUUID(),
        eventType: 'workflow.requested',
        subjectType: 'workflow',
        subjectId: id,
        payload: {},
        createdAt: new Date().toISOString(),
      });
      await this.audit(tx, ctx, 'workflow.requested', id);
      return id;
    });
  }
  async review(
    ctx: Context,
    id: string,
    revision: number,
    decision: 'approve' | 'reject',
  ): Promise<void> {
    const actor = requirePermission(ctx, 'recommendation:decide');
    await this.transaction(ctx, async (tx, sql) => {
      await tx.lock('analysis');
      const run = await this.get(sql, ctx.tenantId, id);
      ensure(run.revision === revision, 'REVISION_CONFLICT');
      ensure(run.status === 'draft', 'INVALID_TRANSITION');
      ensure(
        run.mode === 'hermes-live' || decision === 'reject',
        'INVALID_TRANSITION',
        'simulation cannot be approved',
      );
      if (decision === 'approve') {
        const input = await this.input(tx, sql, run);
        this.assertFresh(input);
        ensure(run.inputHash === workflowInputHash(input), 'STALE_EVIDENCE');
        const references = [
          ...(run.result?.findings ?? []),
          ...(run.result?.benchmark ?? []),
          ...(run.result?.uniqueness ? [run.result.uniqueness] : []),
          ...(run.result?.content ? [run.result.content] : []),
        ].flatMap((f) => f.references);
        ensure(
          !references.some((ref) => input.research?.pendingReferences.includes(ref)),
          'INVALID_TRANSITION',
          'research evidence awaits review',
        );
      }
      await sql.query(
        'UPDATE workflow_requests SET status=$3,revision=revision+1,reviewed_by=$4 WHERE tenant_id=$1 AND id=$2',
        [ctx.tenantId, id, decision === 'approve' ? 'approved' : 'rejected', actor.userId],
      );
      await this.audit(tx, ctx, `workflow.${decision}`, id);
    });
  }
  async audit(tx: TenantTx, ctx: Context, eventType: string, id: string): Promise<void> {
    await tx.appendAudit({
      tenantId: ctx.tenantId,
      id: randomUUID(),
      actorType: ctx.actor.kind === 'user' ? 'user' : 'service',
      actorId: ctx.actor.kind === 'user' ? ctx.actor.userId : ctx.actor.serviceId,
      eventType,
      resourceType: 'workspace',
      resourceId: id,
      revision: null,
      correlationId: ctx.correlationId,
      metadata: {},
      createdAt: new Date().toISOString(),
    });
  }
}
