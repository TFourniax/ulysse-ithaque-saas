import { createHash } from 'node:crypto';

export type Role = 'owner' | 'reviewer' | 'viewer';
export type Context = Readonly<{ tenantId: string; actorId: string; role: Role }>;
export type Deal = Readonly<{
  tenantId: string;
  sourceId: string;
  sourceVersion: number;
  externalId: string;
  stage: 'open' | 'won' | 'lost';
  lastInteractionAt: string;
  nextStep: string | null;
  observedAt: string;
}>;
export type Recommendation = Readonly<{
  id: string;
  tenantId: string;
  dealId: string;
  kind: 'review_next_step';
  status: 'pending' | 'approved' | 'rejected';
  revision: number;
  generatedAt: string;
  expiresAt: string;
  sourceId: string;
  sourceVersion: number;
  observedAt: string;
  ruleVersion: 'demo-next-step-v1';
  summary: string;
  explanation: string;
  priority: number;
}>;
export type AuditEvent = Readonly<{
  tenantId: string;
  actorId: string;
  event: 'source.ingested' | 'recommendation.generated' | 'recommendation.approved' | 'recommendation.rejected';
  resourceId: string;
  at: string;
  revision: number;
}>;
export type Decision = Readonly<{
  recommendationId: string;
  expectedRevision: number;
  decision: 'approve' | 'reject';
  idempotencyKey: string;
}>;
export type Policy = Readonly<{
  inactivityDays: number;
  maxSourceAgeHours: number;
  recommendationLifetimeHours: number;
}>;

const HOUR = 3_600_000;
const DEFAULT_POLICY: Policy = {
  inactivityDays: 7,
  maxSourceAgeHours: 24,
  recommendationLifetimeHours: 24
};
export class DomainError extends Error {
  code: string;
  constructor(code: string) { super(code); this.code = code; }
}
function ensure(ok: boolean, code: string): asserts ok {
  if (!ok) throw new DomainError(code);
}
function nonblank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 200;
}
function time(value: unknown): number {
  ensure(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(value), 'INVALID_TIMESTAMP');
  const parsed = Date.parse(value);
  ensure(Number.isFinite(parsed) && new Date(parsed).toISOString() === value, 'INVALID_TIMESTAMP');
  return parsed;
}
function key(...parts: string[]): string { return JSON.stringify(parts); }
function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function contextValid(ctx: Context): void {
  ensure(!!ctx && nonblank(ctx.tenantId) && nonblank(ctx.actorId), 'INVALID_CONTEXT');
  ensure(['owner', 'reviewer', 'viewer'].includes(ctx.role), 'INVALID_ROLE');
}
function reviewer(ctx: Context): void {
  contextValid(ctx);
  ensure(ctx.role === 'owner' || ctx.role === 'reviewer', 'FORBIDDEN');
}
function validateDeal(deal: Deal, tenantId: string): Deal {
  ensure(!!deal && deal.tenantId === tenantId, 'TENANT_MISMATCH');
  ensure(nonblank(deal.sourceId) && nonblank(deal.externalId), 'INVALID_SOURCE');
  ensure(Number.isSafeInteger(deal.sourceVersion) && deal.sourceVersion > 0, 'INVALID_VERSION');
  ensure(['open', 'won', 'lost'].includes(deal.stage), 'INVALID_STAGE');
  ensure(deal.nextStep === null || (typeof deal.nextStep === 'string' && deal.nextStep.length <= 2000), 'INVALID_NEXT_STEP');
  ensure(time(deal.lastInteractionAt) <= time(deal.observedAt), 'INVALID_TIMELINE');
  // Project known fields only; never retain arbitrary raw payloads in the domain store.
  return {
    tenantId, sourceId: deal.sourceId, externalId: deal.externalId,
    sourceVersion: deal.sourceVersion, stage: deal.stage,
    lastInteractionAt: deal.lastInteractionAt, nextStep: deal.nextStep,
    observedAt: deal.observedAt
  };
}

/**
 * Offline reference adapter. Not a production repository or authentication boundary.
 * Context must be built by a trusted API/worker after authentication and membership checks.
 * Production must replace maps with transactional PostgreSQL storage and an outbox.
 */
export class InMemoryWorkflow {
  #deals = new Map<string, Deal>();
  #recommendations = new Map<string, Recommendation>();
  #audit: AuditEvent[] = [];
  #receipts = new Map<string, { fingerprint: string; result: Recommendation }>();
  #policy: Policy;
  constructor(policy: Policy = DEFAULT_POLICY) {
    ensure(!!policy && Number.isFinite(policy.inactivityDays) && policy.inactivityDays > 0, 'INVALID_POLICY');
    ensure(Number.isFinite(policy.maxSourceAgeHours) && policy.maxSourceAgeHours > 0, 'INVALID_POLICY');
    ensure(Number.isFinite(policy.recommendationLifetimeHours) && policy.recommendationLifetimeHours > 0, 'INVALID_POLICY');
    this.#policy = { ...policy };
  }
  ingest(ctx: Context, input: Deal, now: string): Deal {
    reviewer(ctx);
    const nowMs = time(now);
    const deal = validateDeal(input, ctx.tenantId);
    ensure(time(deal.observedAt) <= nowMs, 'FUTURE_SOURCE');
    const recordKey = key(ctx.tenantId, deal.sourceId, deal.externalId);
    const previous = this.#deals.get(recordKey);
    if (previous) {
      ensure(deal.sourceVersion >= previous.sourceVersion, 'SOURCE_VERSION_REGRESSION');
      if (deal.sourceVersion === previous.sourceVersion) {
        ensure(fingerprint(deal) === fingerprint(previous), 'SOURCE_VERSION_CONFLICT');
        return structuredClone(previous);
      }
      ensure(time(deal.observedAt) >= time(previous.observedAt), 'SOURCE_TIME_REGRESSION');
    }
    this.#deals.set(recordKey, deal);
    this.#audit.push({
      tenantId: ctx.tenantId, actorId: ctx.actorId, event: 'source.ingested',
      resourceId: deal.externalId, at: now, revision: deal.sourceVersion
    });
    return structuredClone(deal);
  }
  generate(ctx: Context, now: string): Recommendation[] {
    reviewer(ctx);
    const nowMs = time(now);
    const result: Recommendation[] = [];
    for (const deal of this.#deals.values()) {
      if (deal.tenantId !== ctx.tenantId || deal.stage !== 'open' || deal.nextStep?.trim()) continue;
      const sourceAge = nowMs - time(deal.observedAt);
      if (sourceAge < 0 || sourceAge > this.#policy.maxSourceAgeHours * HOUR) continue;
      const days = Math.floor((nowMs - time(deal.lastInteractionAt)) / (24 * HOUR));
      if (days < this.#policy.inactivityDays) continue;
      // One suggestion per source version and rule version; reruns cannot create notification storms.
      const id = fingerprint([ctx.tenantId, deal.sourceId, deal.externalId, deal.sourceVersion, 'demo-next-step-v1']);
      const existing = this.#recommendations.get(key(ctx.tenantId, id));
      if (existing) { result.push(structuredClone(existing)); continue; }
      const rec: Recommendation = {
        id, tenantId: ctx.tenantId, dealId: deal.externalId,
        kind: 'review_next_step', status: 'pending', revision: 1,
        generatedAt: now, expiresAt: new Date(nowMs + this.#policy.recommendationLifetimeHours * HOUR).toISOString(),
        sourceId: deal.sourceId, sourceVersion: deal.sourceVersion, observedAt: deal.observedAt,
        ruleVersion: 'demo-next-step-v1', priority: Math.min(100, days * 4),
        summary: 'Définir la prochaine étape de cette opportunité.',
        explanation: days + ' jours sans interaction et aucune prochaine étape renseignée. Vérifier le contexte avant de préparer une relance.'
      };
      this.#recommendations.set(key(ctx.tenantId, id), rec);
      this.#audit.push({
        tenantId: ctx.tenantId, actorId: ctx.actorId, event: 'recommendation.generated',
        resourceId: id, at: now, revision: rec.revision
      });
      result.push(structuredClone(rec));
    }
    return result.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  }
  list(ctx: Context): Recommendation[] {
    contextValid(ctx);
    return [...this.#recommendations.values()]
      .filter(rec => rec.tenantId === ctx.tenantId)
      .map(rec => structuredClone(rec))
      .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  }
  decide(ctx: Context, input: Decision, now: string): Recommendation {
    reviewer(ctx);
    const nowMs = time(now);
    ensure(!!input && nonblank(input.recommendationId) && nonblank(input.idempotencyKey), 'INVALID_DECISION');
    ensure(input.decision === 'approve' || input.decision === 'reject', 'INVALID_DECISION');
    ensure(Number.isSafeInteger(input.expectedRevision) && input.expectedRevision > 0, 'INVALID_REVISION');
    const receiptKey = key(ctx.tenantId, ctx.actorId, input.idempotencyKey);
    const requestHash = fingerprint([input.recommendationId, input.expectedRevision, input.decision]);
    const receipt = this.#receipts.get(receiptKey);
    if (receipt) {
      ensure(receipt.fingerprint === requestHash, 'IDEMPOTENCY_CONFLICT');
      return structuredClone(receipt.result);
    }
    const recKey = key(ctx.tenantId, input.recommendationId);
    const rec = this.#recommendations.get(recKey);
    ensure(!!rec, 'NOT_FOUND');
    ensure(rec.revision === input.expectedRevision, 'REVISION_CONFLICT');
    ensure(rec.status === 'pending', 'ALREADY_DECIDED');
    ensure(nowMs >= time(rec.generatedAt), 'INVALID_TIMELINE');
    if (input.decision === 'approve') {
      ensure(nowMs < time(rec.expiresAt), 'EXPIRED');
      const current = this.#deals.get(key(ctx.tenantId, rec.sourceId, rec.dealId));
      ensure(!!current && current.sourceVersion === rec.sourceVersion, 'STALE_EVIDENCE');
      ensure(nowMs - time(current.observedAt) <= this.#policy.maxSourceAgeHours * HOUR, 'STALE_EVIDENCE');
    }
    const next: Recommendation = {
      ...rec, status: input.decision === 'approve' ? 'approved' : 'rejected', revision: rec.revision + 1
    };
    this.#recommendations.set(recKey, next);
    this.#audit.push({
      tenantId: ctx.tenantId, actorId: ctx.actorId,
      event: input.decision === 'approve' ? 'recommendation.approved' : 'recommendation.rejected',
      resourceId: rec.id, at: now, revision: next.revision
    });
    this.#receipts.set(receiptKey, { fingerprint: requestHash, result: structuredClone(next) });
    // Approval only records a human decision. It never dispatches an external action.
    return structuredClone(next);
  }
  audit(ctx: Context): AuditEvent[] {
    contextValid(ctx);
    return this.#audit.filter(event => event.tenantId === ctx.tenantId).map(event => structuredClone(event));
  }
}
