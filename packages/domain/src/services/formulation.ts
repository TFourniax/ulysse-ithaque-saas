import type { CompanyContext } from '../company-context.ts';
import type { Context } from '../context.ts';
import { requireScope } from '../context.ts';
import { ensure } from '../errors.ts';
import type { EvidenceLink, Recommendation } from '../recommendation.ts';
import { reformulate } from '../recommendation.ts';
import type { ModelOutcome, ModelUsage } from '../records.ts';
import { parseInstant, toInstant } from '../time.ts';
import type { ServiceDeps } from './shared.ts';
import { audit } from './shared.ts';

export type FormulationInputs = Readonly<{
  recommendation: Recommendation;
  evidence: readonly EvidenceLink[];
  context: CompanyContext | null;
  /** Reported model spend of the tenant since the start of the current month (UTC). */
  spentThisMonthUsd: number;
}>;

export type FormulationProvenance = Readonly<{
  provider: string;
  model: string;
  promptVersion: string;
}>;

function monthStart(now: number): string {
  const d = new Date(now);
  return toInstant(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/**
 * Optional model-assisted wording. The model call happens outside any database
 * transaction: `prepare` reads, the caller formulates and validates, `apply`
 * re-checks the recommendation under lock before writing a new content revision.
 */
export class FormulationService {
  readonly #deps: ServiceDeps;

  constructor(deps: ServiceDeps) {
    this.#deps = deps;
  }

  async prepare(ctx: Context, recommendationId: string): Promise<FormulationInputs | null> {
    requireScope(ctx, 'analysis:run');
    const { uow, clock } = this.#deps;
    return uow.run(ctx, async (tx) => {
      const now = clock.now().getTime();
      const rec = await tx.getRecommendation(recommendationId);
      if (
        !rec ||
        rec.status !== 'pending' ||
        rec.contentRevision !== 1 ||
        now >= parseInstant(rec.expiresAt)
      )
        return null;
      return {
        recommendation: rec,
        evidence: await tx.listEvidence(rec.id),
        context: await tx.getCurrentContext(),
        spentThisMonthUsd: await tx.sumModelCostSince(monthStart(now)),
      };
    });
  }

  async apply(
    ctx: Context,
    recommendationId: string,
    expectedRevision: number,
    proposedAction: string,
    provenance: FormulationProvenance,
  ): Promise<Recommendation> {
    requireScope(ctx, 'analysis:run');
    const { uow, clock, ids } = this.#deps;
    return uow.run(ctx, async (tx) => {
      const rec = await tx.getRecommendation(recommendationId, { forUpdate: true });
      ensure(rec !== null, 'NOT_FOUND');
      ensure(rec.revision === expectedRevision, 'REVISION_CONFLICT');
      const now = clock.now().getTime();
      const { next, revision } = reformulate(rec, proposedAction, now);
      await tx.updateRecommendation(next);
      await tx.insertRevision(revision);
      await tx.appendAudit(
        audit(ctx, ids, toInstant(now), {
          eventType: 'recommendation.formulated',
          resourceType: 'recommendation',
          resourceId: rec.id,
          revision: next.revision,
          metadata: {
            provider: provenance.provider,
            model: provenance.model,
            promptVersion: provenance.promptVersion,
          },
        }),
      );
      return next;
    });
  }

  async recordUsage(
    ctx: Context,
    usage: Readonly<{
      recommendationId: string | null;
      provider: string;
      model: string;
      promptVersion: string;
      inputTokens: number;
      outputTokens: number;
      costUsd: number | null;
      latencyMs: number;
      outcome: ModelOutcome;
      errorCode: string | null;
    }>,
  ): Promise<ModelUsage> {
    requireScope(ctx, 'analysis:run');
    const { uow, clock, ids } = this.#deps;
    return uow.run(ctx, async (tx) => {
      const row: ModelUsage = {
        tenantId: ctx.tenantId,
        id: ids.next(),
        createdAt: toInstant(clock.now()),
        ...usage,
      };
      await tx.insertModelUsage(row);
      return row;
    });
  }
}
