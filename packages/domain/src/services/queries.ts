import type { Context } from '../context.ts';
import { requirePermission } from '../context.ts';
import { ensure } from '../errors.ts';
import type { Opportunity } from '../opportunity.ts';
import type { RecommendationView } from '../ports.ts';
import type {
  DecisionRecord,
  EvidenceLink,
  Recommendation,
  RecommendationStatus,
  RevisionRecord,
} from '../recommendation.ts';
import { effectiveStatus } from '../recommendation.ts';
import type { Analysis, AuditEvent, Page } from '../records.ts';
import { toInstant } from '../time.ts';
import { checkEvidence } from './review.ts';
import type { ServiceDeps } from './shared.ts';

export type EvidenceState =
  'current' | 'changed' | 'stale' | 'connection_inactive' | 'doctrine_changed';

export type RecommendationSummary = Recommendation &
  Readonly<{ effectiveStatus: RecommendationStatus }>;

export type RecommendationDetail = Readonly<{
  recommendation: RecommendationSummary;
  evidence: readonly EvidenceLink[];
  evidenceState: EvidenceState;
  revisions: readonly RevisionRecord[];
  decisions: readonly DecisionRecord[];
  history: readonly AuditEvent[];
}>;

function clampLimit(limit: number | undefined): number {
  return Math.min(Math.max(Math.trunc(limit ?? 25), 1), 100);
}

export class QueryService {
  readonly #deps: ServiceDeps;

  constructor(deps: ServiceDeps) {
    this.#deps = deps;
  }

  async listRecommendations(
    ctx: Context,
    options: { view?: RecommendationView; limit?: number; cursor?: string | null; kind?: string },
  ): Promise<Page<RecommendationSummary>> {
    requirePermission(ctx, 'recommendation:read');
    const now = this.#deps.clock.now().getTime();
    return this.#deps.uow.run(ctx, async (tx) => {
      const page = await tx.listRecommendations(
        {
          view: options.view ?? 'open',
          now: toInstant(now),
          ...(options.kind ? { kind: options.kind } : {}),
        },
        { limit: clampLimit(options.limit), cursor: options.cursor ?? null },
      );
      return {
        items: page.items.map((r) => ({ ...r, effectiveStatus: effectiveStatus(r, now) })),
        nextCursor: page.nextCursor,
      };
    });
  }

  async getRecommendation(ctx: Context, id: string): Promise<RecommendationDetail> {
    requirePermission(ctx, 'recommendation:read');
    const now = this.#deps.clock.now().getTime();
    return this.#deps.uow.run(ctx, async (tx) => {
      const rec = await tx.getRecommendation(id);
      ensure(rec !== null, 'NOT_FOUND');
      const [evidence, revisions, decisions, history, check] = await Promise.all([
        tx.listEvidence(id),
        tx.listRevisions(id),
        tx.listDecisions(id),
        tx.listAudit({ limit: 100, cursor: null }, { resourceId: id }),
        checkEvidence(tx, rec, this.#deps.rules, now),
      ]);
      let evidenceState: EvidenceState = 'current';
      if (!check.connectionActive) evidenceState = 'connection_inactive';
      else if (!check.doctrineActive) evidenceState = 'doctrine_changed';
      else if (check.currentFingerprint !== rec.fingerprint) evidenceState = 'changed';
      else if (
        check.dataAsOf === null ||
        now - Date.parse(check.dataAsOf) > rec.maxSourceAgeHours * 3_600_000
      )
        evidenceState = 'stale';
      return {
        recommendation: { ...rec, effectiveStatus: effectiveStatus(rec, now) },
        evidence,
        evidenceState,
        revisions,
        decisions,
        history: history.items,
      };
    });
  }

  async listOpportunities(
    ctx: Context,
    options: { limit?: number; cursor?: string | null; includeDeleted?: boolean },
  ): Promise<Page<Opportunity>> {
    requirePermission(ctx, 'opportunity:read');
    return this.#deps.uow.run(ctx, (tx) =>
      tx.listOpportunities(
        { limit: clampLimit(options.limit), cursor: options.cursor ?? null },
        { includeDeleted: options.includeDeleted ?? false },
      ),
    );
  }

  async listAudit(
    ctx: Context,
    options: { limit?: number; cursor?: string | null; resourceId?: string },
  ): Promise<Page<AuditEvent>> {
    requirePermission(ctx, 'audit:read');
    return this.#deps.uow.run(ctx, (tx) =>
      tx.listAudit(
        { limit: clampLimit(options.limit), cursor: options.cursor ?? null },
        options.resourceId ? { resourceId: options.resourceId } : {},
      ),
    );
  }

  async listAnalyses(ctx: Context, limit?: number): Promise<Analysis[]> {
    requirePermission(ctx, 'analysis:read');
    return this.#deps.uow.run(ctx, (tx) => tx.listAnalyses(clampLimit(limit)));
  }
}
