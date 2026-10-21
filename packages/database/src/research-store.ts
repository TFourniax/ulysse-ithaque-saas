import { randomUUID } from 'node:crypto';
import type {
  Context,
  TenantTx,
  ResearchCampaign,
  ResearchCandidate,
  ResearchPage,
  ResearchProfile,
  ResearchTask,
  ResearchTaskBody,
  WorkspaceSource,
} from '@ulysse/domain';
import {
  canonicalResearchUrl,
  ensure,
  fingerprintOf,
  initialResearchQueries,
  requirePermission,
  requireScope,
  researchDomain,
  researchProfileHash,
} from '@ulysse/domain';
import type { PoolClient } from 'pg';
import { PgAgentStore } from './agent-store.ts';
import { int, json, num, oneOf, str, strOrNull, type Row } from './rows.ts';

export type ResearchPolicy = { revision: number; profile: ResearchProfile };
const campaignSelect = `SELECT c.*,
  (SELECT count(*) FROM research_calls x WHERE x.tenant_id=c.tenant_id AND x.campaign_id=c.id AND x.kind='model') AS model_calls,
  (SELECT coalesce(sum(cost_usd),0) FROM research_calls x WHERE x.tenant_id=c.tenant_id AND x.campaign_id=c.id) AS committed_usd,
  (SELECT count(*) FROM research_calls x WHERE x.tenant_id=c.tenant_id AND x.campaign_id=c.id AND x.cost_state='unknown') AS uncertain_calls,
  (SELECT count(*) FROM research_candidates x WHERE x.tenant_id=c.tenant_id AND x.campaign_id=c.id AND (x.body->>'own')::boolean=false) AS candidate_count,
  (SELECT count(*) FROM research_candidates x WHERE x.tenant_id=c.tenant_id AND x.campaign_id=c.id AND (x.body->>'own')::boolean=false AND x.body->>'relevance' IN ('direct','indirect','substitute') AND jsonb_array_length(x.body->'facts')>0 AND x.body->>'review'<>'excluded') AS qualified_count,
  (SELECT count(*) FROM research_tasks x WHERE x.tenant_id=c.tenant_id AND x.campaign_id=c.id AND x.status IN ('pending','running')) AS pending_tasks
  FROM research_campaigns c`;
function campaignFrom(r: Row): ResearchCampaign {
  return {
    id: str(r, 'id'),
    revision: int(r, 'revision'),
    profile: json(r, 'profile'),
    profileRevision: int(r, 'profile_revision'),
    contextVersion: int(r, 'context_version'),
    status: oneOf(r, 'status', ['queued', 'running', 'paused', 'completed', 'cancelled', 'failed']),
    stopReason: strOrNull(r, 'stop_reason'),
    createdAt: str(r, 'created_at'),
    updatedAt: str(r, 'updated_at'),
    searches: int(r, 'searches'),
    pages: int(r, 'pages'),
    modelCalls: int(r, 'model_calls'),
    committedUsd: num(r, 'committed_usd'),
    uncertainCalls: int(r, 'uncertain_calls'),
    candidateCount: int(r, 'candidate_count'),
    qualifiedCount: int(r, 'qualified_count'),
    pendingTasks: int(r, 'pending_tasks'),
  };
}
function candidateFrom(r: Row): ResearchCandidate {
  return { ...json<ResearchCandidate>(r, 'body'), revision: int(r, 'revision') };
}
export class PgResearchStore extends PgAgentStore {
  async policy(sql: PoolClient, tenant: string): Promise<ResearchPolicy | null> {
    const row = (
      await sql.query<Row>('SELECT revision,profile FROM research_policies WHERE tenant_id=$1', [
        tenant,
      ])
    ).rows[0];
    return row ? { revision: int(row, 'revision'), profile: json(row, 'profile') } : null;
  }
  async savePolicy(ctx: Context, profile: ResearchProfile, revision: number | null): Promise<void> {
    const actor = requirePermission(ctx, 'context:manage');
    canonicalResearchUrl(profile.website);
    await this.transaction(ctx, async (tx, sql) => {
      await tx.lock('analysis');
      const old = await this.policy(sql, ctx.tenantId);
      ensure((old?.revision ?? null) === revision, 'REVISION_CONFLICT');
      await sql.query(
        'INSERT INTO research_policies(tenant_id,revision,profile,authorized_by) VALUES($1,1,$2,$3) ON CONFLICT(tenant_id) DO UPDATE SET revision=research_policies.revision+1,profile=excluded.profile,authorized_by=excluded.authorized_by',
        [ctx.tenantId, JSON.stringify(profile), actor.userId],
      );
      await sql.query(
        "UPDATE research_campaigns SET status='cancelled',stop_reason='policy_changed',revision=revision+1,updated_at=clock_timestamp() WHERE tenant_id=$1 AND status IN ('queued','running','paused')",
        [ctx.tenantId],
      );
      const waiting = await sql.query<{ id: string }>(
        "SELECT DISTINCT research_id AS id FROM workflow_requests WHERE tenant_id=$1 AND status='queued' AND research_id IS NOT NULL",
        [ctx.tenantId],
      );
      for (const row of waiting.rows) await this.wakeWorkflows(tx, sql, ctx, row.id);
      await this.audit(tx, ctx, 'research.policy_changed', ctx.tenantId);
    });
  }
  async ensureCampaign(
    ctx: Context,
    tx: TenantTx,
    sql: PoolClient,
    requestKey?: string,
  ): Promise<string | null> {
    const policy = await this.policy(sql, ctx.tenantId);
    if (!policy?.profile.enabled) return null;
    const contextVersion = (await tx.getCurrentContext())?.version ?? 0;
    const inputHash = researchProfileHash(policy.profile, contextVersion);
    const doctrine = await tx.getActiveDoctrine();
    const maxAgeHours = Math.min(
      policy.profile.maxAgeDays * 24,
      doctrine?.content.policy.maxSourceAgeHours ?? Infinity,
    );
    const previous = (
      await sql.query<Row>(
        requestKey
          ? 'SELECT id,input_hash FROM research_campaigns WHERE tenant_id=$1 AND request_key=$2'
          : "SELECT id,input_hash FROM research_campaigns WHERE tenant_id=$1 AND input_hash=$2 AND profile_revision=$3 AND (status NOT IN ('cancelled','failed') OR (status='cancelled' AND stop_reason='user_cancelled')) AND created_at>clock_timestamp()-($4::numeric*interval '1 hour') ORDER BY created_at DESC LIMIT 1",
        requestKey
          ? [ctx.tenantId, requestKey]
          : [ctx.tenantId, inputHash, policy.revision, maxAgeHours],
      )
    ).rows[0];
    if (previous) {
      ensure(str(previous, 'input_hash') === inputHash, 'IDEMPOTENCY_CONFLICT');
      return str(previous, 'id');
    }
    const active = await sql.query(
      "SELECT id FROM research_campaigns WHERE tenant_id=$1 AND status IN ('queued','running')",
      [ctx.tenantId],
    );
    ensure((active.rowCount ?? 0) < 2, 'INVALID_INPUT', 'research queue limit');
    const id = randomUUID();
    await sql.query(
      'INSERT INTO research_campaigns(tenant_id,id,profile,profile_revision,context_version,input_hash,request_key) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [
        ctx.tenantId,
        id,
        JSON.stringify(policy.profile),
        policy.revision,
        contextVersion,
        inputHash,
        requestKey ?? randomUUID(),
      ],
    );
    await this.addTask(
      sql,
      ctx.tenantId,
      id,
      { kind: 'read', url: canonicalResearchUrl(policy.profile.website), depth: 0 },
      0,
    );
    await this.addTask(sql, ctx.tenantId, id, { kind: 'plan' }, 2);
    for (const search of initialResearchQueries(policy.profile))
      await this.addTask(sql, ctx.tenantId, id, { kind: 'search', search }, 10);
    await this.enqueue(tx, ctx, id);
    await this.audit(tx, ctx, 'research.requested', id);
    return id;
  }
  async forWorkflow(
    ctx: Context,
    tx: TenantTx,
    sql: PoolClient,
    id?: string,
  ): Promise<string | null> {
    if (!id) return this.ensureCampaign(ctx, tx, sql);
    const campaign = await this.campaign(sql, ctx.tenantId, id);
    ensure(await this.isCurrent(tx, sql, campaign), 'STALE_EVIDENCE');
    ensure(
      campaign.status !== 'cancelled' || campaign.stopReason === 'user_cancelled',
      'STALE_EVIDENCE',
    );
    return id;
  }
  async enqueue(tx: TenantTx, ctx: Context, id: string, notBefore?: string): Promise<void> {
    await tx.enqueueOutbox({
      tenantId: ctx.tenantId,
      id: randomUUID(),
      eventType: 'research.requested',
      subjectType: 'research',
      subjectId: id,
      payload: notBefore ? { notBefore } : {},
      createdAt: new Date().toISOString(),
    });
  }
  async addTask(
    sql: PoolClient,
    tenant: string,
    campaign: string,
    body: ResearchTaskBody,
    priority: number,
  ): Promise<void> {
    const key = fingerprintOf(body.kind === 'read' ? { kind: body.kind, url: body.url } : body);
    await sql.query(
      'INSERT INTO research_tasks(tenant_id,campaign_id,id,task_key,body,priority) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,campaign_id,task_key) DO NOTHING',
      [tenant, campaign, randomUUID(), key, JSON.stringify(body), priority],
    );
  }
  async campaign(sql: PoolClient, tenant: string, id: string): Promise<ResearchCampaign> {
    const r = (
      await sql.query<Row>(`${campaignSelect} WHERE c.tenant_id=$1 AND c.id=$2`, [tenant, id])
    ).rows[0];
    ensure(r, 'NOT_FOUND');
    return campaignFrom(r);
  }
  async campaigns(ctx: Context): Promise<ResearchCampaign[]> {
    requirePermission(ctx, 'analysis:read');
    return this.transaction(ctx, async (_tx, sql) =>
      (
        await sql.query<Row>(
          `${campaignSelect} WHERE c.tenant_id=$1 ORDER BY c.created_at DESC LIMIT 30`,
          [ctx.tenantId],
        )
      ).rows.map(campaignFrom),
    );
  }
  async candidates(
    sql: PoolClient,
    tenant: string,
    campaign: string,
    offset = 0,
    query = '',
    candidate?: string,
  ): Promise<{ items: ResearchCandidate[]; total: number }> {
    const filter =
      "tenant_id=$1 AND campaign_id=$2 AND ($3='' OR strpos(lower(body::text),lower($3))>0) AND ($4::uuid IS NULL OR id=$4)";
    const count = (
      await sql.query<Row>(`SELECT count(*) AS total FROM research_candidates WHERE ${filter}`, [
        tenant,
        campaign,
        query,
        candidate ?? null,
      ])
    ).rows[0];
    const rows = await sql.query<Row>(
      `SELECT body,revision FROM research_candidates WHERE ${filter} ORDER BY (body->>'own')::boolean DESC,domain,id LIMIT 25 OFFSET $5`,
      [tenant, campaign, query, candidate ?? null, offset],
    );
    return { items: rows.rows.map(candidateFrom), total: count ? int(count, 'total') : 0 };
  }
  async candidate(sql: PoolClient, tenant: string, id: string): Promise<ResearchCandidate> {
    const row = (
      await sql.query<Row>(
        'SELECT body,revision FROM research_candidates WHERE tenant_id=$1 AND id=$2',
        [tenant, id],
      )
    ).rows[0];
    ensure(row, 'NOT_FOUND');
    return candidateFrom(row);
  }
  async discover(
    sql: PoolClient,
    tenant: string,
    campaign: ResearchCampaign,
    url: string,
    title: string,
  ): Promise<{ candidate: ResearchCandidate; fresh: boolean }> {
    const domain = researchDomain(url);
    const old = (
      await sql.query<Row>(
        'SELECT body,revision FROM research_candidates WHERE tenant_id=$1 AND campaign_id=$2 AND domain=$3',
        [tenant, campaign.id, domain],
      )
    ).rows[0];
    if (old) return { candidate: candidateFrom(old), fresh: false };
    const candidate: ResearchCandidate = {
      id: randomUUID(),
      campaignId: campaign.id,
      domain,
      name: title.slice(0, 200) || domain,
      revision: 1,
      own: domain === researchDomain(campaign.profile.website),
      relevance: 'unqualified',
      reason: 'Page à lire et pertinence à qualifier.',
      facts: [],
      pages: [],
      errors: [],
      review: 'pending',
      note: '',
      corrections: [],
    };
    await sql.query(
      'INSERT INTO research_candidates(tenant_id,campaign_id,id,domain,body) VALUES($1,$2,$3,$4,$5)',
      [tenant, campaign.id, candidate.id, domain, JSON.stringify(candidate)],
    );
    return { candidate, fresh: true };
  }
  async saveCandidate(
    sql: PoolClient,
    tenant: string,
    candidate: ResearchCandidate,
  ): Promise<void> {
    await sql.query(
      'UPDATE research_candidates SET body=$3,revision=revision+1 WHERE tenant_id=$1 AND id=$2',
      [tenant, candidate.id, JSON.stringify(candidate)],
    );
  }
  async page(sql: PoolClient, tenant: string, id: string): Promise<ResearchPage> {
    const row = (
      await sql.query<Row>('SELECT body FROM research_pages WHERE tenant_id=$1 AND id=$2', [
        tenant,
        id,
      ])
    ).rows[0];
    ensure(row, 'NOT_FOUND');
    return json(row, 'body');
  }
  async isCurrent(tx: TenantTx, sql: PoolClient, campaign: ResearchCampaign): Promise<boolean> {
    const policy = await this.policy(sql, tx.tenantId);
    const authorized = await sql.query(
      "SELECT 1 FROM research_policies p JOIN tenants t ON t.id=p.tenant_id JOIN memberships m ON m.tenant_id=p.tenant_id AND m.user_id=p.authorized_by JOIN users u ON u.id=m.user_id WHERE p.tenant_id=$1 AND t.status='active' AND m.status='active' AND m.role='owner' AND u.status='active'",
      [tx.tenantId],
    );
    return (
      authorized.rowCount === 1 &&
      policy?.profile.enabled === true &&
      policy.revision === campaign.profileRevision &&
      ((await tx.getCurrentContext())?.version ?? 0) === campaign.contextVersion
    );
  }
  async claim(
    ctx: Context,
    id: string,
  ): Promise<{ campaign: ResearchCampaign; task: ResearchTask } | null> {
    requireScope(ctx, 'analysis:run');
    return this.transaction(ctx, async (tx, sql) => {
      await tx.lock('analysis');
      const campaign = await this.campaign(sql, ctx.tenantId, id);
      if (!['queued', 'running'].includes(campaign.status)) return null;
      if (!(await this.isCurrent(tx, sql, campaign))) {
        await this.setStatus(sql, ctx.tenantId, id, 'cancelled', 'context_changed');
        await this.wakeWorkflows(tx, sql, ctx, id);
        return null;
      }
      // A provider cooldown gates the whole campaign, including duplicate/maintenance jobs.
      // Its deadline is persisted before releasing the lease; restarting a worker cannot bypass it.
      const cooldown = (
        await sql.query<{ retry_at: string | null }>(
          "SELECT max((summary->>'retryAt')::timestamptz)::text AS retry_at FROM research_tasks WHERE tenant_id=$1 AND campaign_id=$2 AND status='pending' AND (summary->>'retryAt')::timestamptz>clock_timestamp()",
          [ctx.tenantId, id],
        )
      ).rows[0]?.retry_at;
      if (cooldown) {
        await this.enqueue(tx, ctx, id, new Date(cooldown).toISOString());
        return null;
      }
      const running = await sql.query(
        "SELECT id FROM research_tasks WHERE tenant_id=$1 AND campaign_id=$2 AND status='running' AND expires_at>clock_timestamp()",
        [ctx.tenantId, id],
      );
      if (running.rowCount) throw new Error('research_already_running');
      // Reservations from interrupted attempts remain committed; a retry receives its own ledger entry.
      await sql.query(
        "UPDATE research_tasks SET status=CASE WHEN attempt<3 THEN 'pending' ELSE 'failed' END,error_code='interrupted' WHERE tenant_id=$1 AND campaign_id=$2 AND status='running'",
        [ctx.tenantId, id],
      );
      const row = (
        await sql.query<Row>(
          "SELECT * FROM research_tasks WHERE tenant_id=$1 AND campaign_id=$2 AND status='pending' AND (body->>'kind'<>'search' OR $3) AND (body->>'kind'<>'read' OR $4) ORDER BY priority,created_at,id LIMIT 1",
          [
            ctx.tenantId,
            id,
            campaign.searches < campaign.profile.maxSearches,
            campaign.pages < campaign.profile.maxPages,
          ],
        )
      ).rows[0];
      if (!row) {
        const remaining = (
          await sql.query(
            "SELECT id FROM research_tasks WHERE tenant_id=$1 AND campaign_id=$2 AND status='pending' LIMIT 1",
            [ctx.tenantId, id],
          )
        ).rowCount;
        const failed = await sql.query(
          "SELECT id FROM research_tasks WHERE tenant_id=$1 AND campaign_id=$2 AND status='failed' LIMIT 1",
          [ctx.tenantId, id],
        );
        await this.setStatus(
          sql,
          ctx.tenantId,
          id,
          remaining ? 'paused' : 'completed',
          remaining ? 'collection_limit' : failed.rowCount ? 'steps_failed' : 'coverage_reached',
        );
        await this.wakeWorkflows(tx, sql, ctx, id);
        return null;
      }
      const body = json<ResearchTaskBody>(row, 'body');
      const lease = randomUUID();
      await sql.query(
        "UPDATE research_tasks SET status='running',attempt=attempt+1,lease=$3,expires_at=clock_timestamp()+interval '110 seconds',summary=summary-'retryAt' WHERE tenant_id=$1 AND id=$2",
        [ctx.tenantId, str(row, 'id'), lease],
      );
      await sql.query(
        "UPDATE research_campaigns SET status='running',stop_reason=NULL,searches=searches+$3,pages=pages+$4,updated_at=clock_timestamp() WHERE tenant_id=$1 AND id=$2",
        [ctx.tenantId, id, body.kind === 'search' ? 1 : 0, body.kind === 'read' ? 1 : 0],
      );
      return {
        campaign,
        task: { id: str(row, 'id'), campaignId: id, body, attempt: int(row, 'attempt') + 1, lease },
      };
    });
  }
  async complete(
    ctx: Context,
    task: ResearchTask,
    work: (tx: TenantTx, sql: PoolClient, campaign: ResearchCampaign) => Promise<object>,
    errorCode?: string,
  ): Promise<void> {
    await this.transaction(ctx, async (tx, sql) => {
      await tx.lock('analysis');
      const campaign = await this.campaign(sql, ctx.tenantId, task.campaignId);
      const current = await sql.query(
        "SELECT id FROM research_tasks WHERE tenant_id=$1 AND id=$2 AND lease=$3 AND status='running' AND expires_at>clock_timestamp()",
        [ctx.tenantId, task.id, task.lease],
      );
      if (
        !current.rowCount ||
        campaign.status !== 'running' ||
        !(await this.isCurrent(tx, sql, campaign))
      )
        return;
      const summary = await work(tx, sql, campaign);
      await sql.query(
        'UPDATE research_tasks SET status=$4,summary=$5,error_code=$6 WHERE tenant_id=$1 AND id=$2 AND lease=$3',
        [
          ctx.tenantId,
          task.id,
          task.lease,
          errorCode ? 'failed' : 'done',
          JSON.stringify(summary),
          errorCode ?? null,
        ],
      );
      await sql.query(
        'UPDATE research_campaigns SET revision=revision+1,updated_at=clock_timestamp() WHERE tenant_id=$1 AND id=$2',
        [ctx.tenantId, task.campaignId],
      );
      await this.enqueue(tx, ctx, task.campaignId);
    });
  }
  async setStatus(
    sql: PoolClient,
    tenant: string,
    id: string,
    status: ResearchCampaign['status'],
    reason: string | null,
  ): Promise<void> {
    await sql.query(
      'UPDATE research_campaigns SET status=$3,stop_reason=$4,revision=revision+1,updated_at=clock_timestamp() WHERE tenant_id=$1 AND id=$2',
      [tenant, id, status, reason],
    );
  }
  async pause(ctx: Context, task: ResearchTask, reason: string): Promise<void> {
    await this.transaction(ctx, async (tx, sql) => {
      await tx.lock('analysis');
      const c = await this.campaign(sql, ctx.tenantId, task.campaignId);
      if (c.status !== 'running') return;
      const changed = await sql.query(
        "UPDATE research_tasks SET status='pending',error_code=$4 WHERE tenant_id=$1 AND id=$2 AND lease=$3 AND status='running'",
        [ctx.tenantId, task.id, task.lease, reason],
      );
      if (!changed.rowCount) return;
      await this.setStatus(sql, ctx.tenantId, task.campaignId, 'paused', reason);
      await this.wakeWorkflows(tx, sql, ctx, task.campaignId);
    });
  }
  async deferProvider(
    ctx: Context,
    task: ResearchTask,
    reason: string,
    retryAfter: number | null,
  ): Promise<boolean> {
    if (
      !['provider_http_429', 'provider_http_503'].includes(reason) ||
      (retryAfter !== null && (!Number.isFinite(retryAfter) || retryAfter < 0 || retryAfter > 900))
    )
      return false;
    return this.transaction(ctx, async (tx, sql) => {
      await tx.lock('analysis');
      const c = await this.campaign(sql, ctx.tenantId, task.campaignId);
      if (c.status !== 'running' || !(await this.isCurrent(tx, sql, c))) return false;
      const row = (
        await sql.query<Row>(
          "SELECT coalesce((summary->>'providerRetries')::integer,0) AS retries FROM research_tasks WHERE tenant_id=$1 AND id=$2 AND lease=$3 AND status='running' AND expires_at>clock_timestamp()",
          [ctx.tenantId, task.id, task.lease],
        )
      ).rows[0];
      if (!row) return false;
      const retries = int(row, 'retries');
      if (retries >= 2) return false;
      const seconds = Math.max(retryAfter ?? 0, 60 * 2 ** retries);
      const deferred = (
        await sql.query<{ retry_at: string }>(
          "UPDATE research_tasks SET status='pending',lease=NULL,expires_at=NULL,error_code=$4,summary=summary || jsonb_build_object('providerRetries',$5::integer,'retryAt',clock_timestamp()+$6*interval '1 second') WHERE tenant_id=$1 AND id=$2 AND lease=$3 RETURNING summary->>'retryAt' AS retry_at",
          [ctx.tenantId, task.id, task.lease, reason, retries + 1, seconds],
        )
      ).rows[0];
      if (!deferred) return false;
      await this.setStatus(
        sql,
        ctx.tenantId,
        task.campaignId,
        'running',
        'provider_retry_scheduled',
      );
      await this.enqueue(tx, ctx, task.campaignId, new Date(deferred.retry_at).toISOString());
      return true;
    });
  }
  async wakeWorkflows(tx: TenantTx, sql: PoolClient, ctx: Context, id: string): Promise<void> {
    const rows = await sql.query<{ id: string }>(
      "SELECT id FROM workflow_requests WHERE tenant_id=$1 AND research_id=$2 AND status='queued'",
      [ctx.tenantId, id],
    );
    for (const row of rows.rows)
      await tx.enqueueOutbox({
        tenantId: ctx.tenantId,
        id: randomUUID(),
        eventType: 'workflow.requested',
        subjectType: 'workflow',
        subjectId: row.id,
        payload: {},
        createdAt: new Date().toISOString(),
      });
  }
  async action(
    ctx: Context,
    id: string,
    revision: number,
    action: 'cancel' | 'pause' | 'resume',
    limits?: Pick<ResearchProfile, 'budgetUsd' | 'maxSearches' | 'maxPages'>,
  ): Promise<void> {
    requirePermission(ctx, 'context:manage');
    await this.transaction(ctx, async (tx, sql) => {
      await tx.lock('analysis');
      const c = await this.campaign(sql, ctx.tenantId, id);
      ensure(c.revision === revision, 'REVISION_CONFLICT');
      if (action === 'cancel' || action === 'pause') {
        if (action === 'pause') {
          ensure(['queued', 'running'].includes(c.status), 'INVALID_TRANSITION');
          ensure(await this.isCurrent(tx, sql, c), 'STALE_EVIDENCE');
        }
        // Invalidate in-flight publication even if the user resumes before its response arrives.
        await sql.query(
          "UPDATE research_tasks SET status='pending',lease=NULL,expires_at=NULL WHERE tenant_id=$1 AND campaign_id=$2 AND status='running'",
          [ctx.tenantId, id],
        );
        await this.setStatus(
          sql,
          ctx.tenantId,
          id,
          action === 'pause' ? 'paused' : 'cancelled',
          action === 'pause' ? 'user_paused' : 'user_cancelled',
        );
        await this.wakeWorkflows(tx, sql, ctx, id);
      } else {
        ensure(
          c.status === 'paused' ||
            (c.status === 'cancelled' && c.stopReason === 'user_cancelled') ||
            c.status === 'failed' ||
            (c.status === 'completed' && c.stopReason === 'steps_failed'),
          'INVALID_TRANSITION',
        );
        ensure(await this.isCurrent(tx, sql, c), 'STALE_EVIDENCE');
        if (limits) {
          ensure(
            limits.budgetUsd >= c.profile.budgetUsd &&
              limits.maxSearches >= c.profile.maxSearches &&
              limits.maxPages >= c.profile.maxPages,
            'INVALID_INPUT',
          );
          await sql.query('UPDATE research_campaigns SET profile=$3 WHERE tenant_id=$1 AND id=$2', [
            ctx.tenantId,
            id,
            JSON.stringify({ ...c.profile, ...limits }),
          ]);
        }
        await sql.query(
          "UPDATE research_tasks SET status='pending',attempt=0 WHERE tenant_id=$1 AND campaign_id=$2 AND status='failed'",
          [ctx.tenantId, id],
        );
        await sql.query(
          "UPDATE research_tasks SET summary=summary-'retryAt'-'providerRetries' WHERE tenant_id=$1 AND campaign_id=$2 AND status='pending'",
          [ctx.tenantId, id],
        );
        await this.setStatus(sql, ctx.tenantId, id, 'queued', null);
        await this.enqueue(tx, ctx, id);
      }
      await this.audit(tx, ctx, `research.${action}`, id);
    });
  }
  async review(
    ctx: Context,
    id: string,
    body: {
      revision: number;
      decision: ResearchCandidate['review'];
      note: string;
      corrections: ResearchCandidate['corrections'];
    },
  ): Promise<void> {
    const actor = requirePermission(ctx, 'recommendation:decide');
    await this.transaction(ctx, async (tx, sql) => {
      await tx.lock('analysis');
      const item = await this.candidate(sql, ctx.tenantId, id);
      ensure(item.revision === body.revision, 'REVISION_CONFLICT');
      const c = await this.campaign(sql, ctx.tenantId, item.campaignId);
      if (body.decision === 'approved') {
        ensure(await this.isCurrent(tx, sql, c), 'STALE_EVIDENCE');
        ensure(
          item.facts.length > 0 &&
            !['unqualified', 'irrelevant', 'directory'].includes(item.relevance),
          'INVALID_TRANSITION',
        );
        ensure(
          item.pages.every(
            (p) => Date.now() - Date.parse(p.retrievedAt) < c.profile.maxAgeDays * 86400000,
          ),
          'STALE_EVIDENCE',
        );
      }
      ensure(
        body.corrections.every((f) => item.facts.some((old) => old.id === f.factId)),
        'INVALID_INPUT',
      );
      await sql.query(
        'INSERT INTO research_reviews(tenant_id,id,candidate_id,revision,actor_id,decision,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [
          ctx.tenantId,
          randomUUID(),
          id,
          item.revision,
          actor.userId,
          JSON.stringify(body),
          JSON.stringify(item),
        ],
      );
      await this.saveCandidate(sql, ctx.tenantId, {
        ...item,
        review: body.decision,
        note: body.note,
        corrections: body.corrections,
      });
      await sql.query(
        'UPDATE research_campaigns SET revision=revision+1 WHERE tenant_id=$1 AND id=$2',
        [ctx.tenantId, item.campaignId],
      );
      await this.audit(tx, ctx, `research.candidate_${body.decision}`, id);
    });
  }
  /** A compact, explicitly provisional digest; the complete matrix remains paginated in research. */
  async workflowSources(
    sql: PoolClient,
    tenant: string,
    campaignId: string,
  ): Promise<{
    sources: WorkspaceSource[];
    revision: number;
    status: string;
    pendingReferences: string[];
  }> {
    const c = await this.campaign(sql, tenant, campaignId);
    const rows = await sql.query<Row>(
      "SELECT body,revision FROM research_candidates WHERE tenant_id=$1 AND campaign_id=$2 AND body->>'review'<>'excluded' AND body->>'relevance' IN ('direct','indirect','substitute') ORDER BY (body->>'own')::boolean DESC,(body->>'review'='approved') DESC,domain",
      [tenant, campaignId],
    );
    const sources = rows.rows
      .map(candidateFrom)
      .filter((item) => item.facts.length > 0)
      .map((item): WorkspaceSource => ({
        id: item.id,
        revision: item.revision,
        kind: item.own ? 'offer' : 'competitor',
        title: item.name,
        url: `https://${item.domain}/`,
        observedAt: item.pages[0]?.retrievedAt ?? c.createdAt,
        origin: 'observed',
        text: researchSourceText(item),
      }));
    return {
      sources,
      revision: c.revision,
      status: c.status,
      pendingReferences: rows.rows
        .map(candidateFrom)
        .filter((c) => c.review !== 'approved')
        .map((c) => `source:${c.id}:r${c.revision}`),
    };
  }
  async audit(tx: TenantTx, ctx: Context, eventType: string, id: string): Promise<void> {
    await tx.appendAudit({
      tenantId: ctx.tenantId,
      id: randomUUID(),
      actorType: ctx.actor.kind === 'user' ? 'user' : 'service',
      actorId: ctx.actor.kind === 'user' ? ctx.actor.userId : ctx.actor.serviceId,
      eventType,
      resourceType: 'research',
      resourceId: id,
      revision: null,
      correlationId: ctx.correlationId,
      metadata: {},
      createdAt: new Date().toISOString(),
    });
  }
}

function researchSourceText(item: ResearchCandidate): string {
  const facts = item.facts.map((f) => ({
    id: f.id,
    offer: f.offer,
    dimension: f.dimension,
    value: f.value,
    quote: f.quote,
    quality: f.quality,
    url: item.pages.find((p) => p.id === f.pageId)?.url,
    correction: item.corrections.find((c) => c.factId === f.id)?.value,
  }));
  const base = {
    review: item.review,
    qualification: item.reason,
    note: item.note.slice(0, 400),
    totalFacts: facts.length,
    coverage: 'Digest limité; autres faits dans la matrice de recherche.',
  };
  const selected: typeof facts = [];
  for (const fact of facts) {
    if (JSON.stringify({ ...base, facts: [...selected, fact] }).length <= 5000) selected.push(fact);
  }
  return JSON.stringify({ ...base, facts: selected });
}
