import { currentFingerprintFor } from '../analysis.ts';
import type { Context } from '../context.ts';
import { requirePermission } from '../context.ts';
import { ensure } from '../errors.ts';
import { fingerprintOf } from '../hash.ts';
import type { TenantTx } from '../ports.ts';
import type {
  DecisionRecord,
  EvidenceCheck,
  Recommendation,
  RevisionRecord,
} from '../recommendation.ts';
import { decide, revise, validateDecisionInput, validateRevisionInput } from '../recommendation.ts';
import type { RuleRegistry } from '../rules.ts';
import { HOUR_MS, toInstant } from '../time.ts';
import type { ServiceDeps } from './shared.ts';
import { audit, DEFAULT_RECEIPT_TTL_HOURS, outbox, validateIdempotencyKey } from './shared.ts';

export type DecisionResult = Readonly<{
  recommendation: Recommendation;
  decision: DecisionRecord;
  replayed: boolean;
}>;
export type RevisionResult = Readonly<{
  recommendation: Recommendation;
  revision: RevisionRecord;
  replayed: boolean;
}>;

/** Reads current evidence state inside the caller's transaction (no caching across transactions). */
export async function checkEvidence(
  tx: TenantTx,
  rec: Recommendation,
  rules: RuleRegistry,
  now: number,
): Promise<EvidenceCheck> {
  const [opportunity, connection, doctrine, active, context] = await Promise.all([
    tx.getOpportunity(rec.subject.id),
    tx.getConnection(rec.subject.connectionId),
    tx.getDoctrine(rec.doctrine.id),
    tx.getActiveDoctrine(),
    tx.getCurrentContext(),
  ]);
  const doctrineActive =
    doctrine !== null && doctrine.status === 'validated' && active?.id === doctrine.id;
  return {
    currentFingerprint: currentFingerprintFor({
      recommendation: rec,
      opportunity,
      doctrine,
      rules,
      context,
      now,
    }),
    dataAsOf: connection?.dataAsOf ?? null,
    connectionActive: connection?.status === 'active',
    doctrineActive,
  };
}

export class ReviewService {
  readonly #deps: ServiceDeps;

  constructor(deps: ServiceDeps) {
    this.#deps = deps;
  }

  /**
   * Atomic: lock → idempotency receipt → rights → evidence revalidation → decision
   * → audit → outbox → receipt. A retried request returns the stored result without a second audit.
   */
  async decide(
    ctx: Context,
    recommendationId: string,
    rawInput: unknown,
    idempotencyKey: unknown,
  ): Promise<DecisionResult> {
    const actor = requirePermission(ctx, 'recommendation:decide');
    const key = validateIdempotencyKey(idempotencyKey);
    const input = validateDecisionInput(rawInput);
    const requestHash = fingerprintOf({ op: 'decide', recommendationId, ...input });
    const { uow, clock, ids, rules } = this.#deps;
    return uow.run(ctx, async (tx) => {
      const now = clock.now().getTime();
      const rec = await tx.getRecommendation(recommendationId, { forUpdate: true });
      ensure(rec !== null, 'NOT_FOUND');
      const receipt = await tx.getReceipt(actor.userId, 'recommendation.decide', key);
      if (receipt) {
        ensure(receipt.requestHash === requestHash, 'IDEMPOTENCY_CONFLICT');
        return { ...(receipt.response as Omit<DecisionResult, 'replayed'>), replayed: true };
      }
      const evidence = await checkEvidence(tx, rec, rules, now);
      const { next, decision } = decide(rec, input, evidence, actor.userId, now, ids.next());
      const at = toInstant(now);
      await tx.updateRecommendation(next);
      await tx.insertDecision(decision);
      await tx.appendAudit(
        audit(ctx, ids, at, {
          eventType:
            input.decision === 'approve' ? 'recommendation.approved' : 'recommendation.rejected',
          resourceType: 'recommendation',
          resourceId: rec.id,
          revision: next.revision,
          metadata: {
            contentRevision: rec.contentRevision,
            withReason: input.reason !== null,
            quality: input.quality,
          },
        }),
      );
      await tx.enqueueOutbox(
        outbox(
          ctx,
          ids,
          at,
          'recommendation.decided',
          { type: 'recommendation', id: rec.id },
          { decision: input.decision },
        ),
      );
      const response = { recommendation: next, decision };
      await tx.insertReceipt({
        tenantId: ctx.tenantId,
        actorId: actor.userId,
        operation: 'recommendation.decide',
        key,
        requestHash,
        response,
        createdAt: at,
        expiresAt: toInstant(
          now + (this.#deps.receiptTtlHours ?? DEFAULT_RECEIPT_TTL_HOURS) * HOUR_MS,
        ),
      });
      return { ...response, replayed: false };
    });
  }

  async revise(
    ctx: Context,
    recommendationId: string,
    rawInput: unknown,
    idempotencyKey: unknown,
  ): Promise<RevisionResult> {
    const actor = requirePermission(ctx, 'recommendation:revise');
    const key = validateIdempotencyKey(idempotencyKey);
    const input = validateRevisionInput(rawInput);
    const requestHash = fingerprintOf({ op: 'revise', recommendationId, ...input });
    const { uow, clock, ids } = this.#deps;
    return uow.run(ctx, async (tx) => {
      const now = clock.now().getTime();
      const rec = await tx.getRecommendation(recommendationId, { forUpdate: true });
      ensure(rec !== null, 'NOT_FOUND');
      const receipt = await tx.getReceipt(actor.userId, 'recommendation.revise', key);
      if (receipt) {
        ensure(receipt.requestHash === requestHash, 'IDEMPOTENCY_CONFLICT');
        return { ...(receipt.response as Omit<RevisionResult, 'replayed'>), replayed: true };
      }
      const { next, revision } = revise(rec, input, actor.userId, now);
      const at = toInstant(now);
      await tx.updateRecommendation(next);
      if (next.contentRevision !== rec.contentRevision) await tx.insertRevision(revision);
      await tx.appendAudit(
        audit(ctx, ids, at, {
          eventType:
            next.contentRevision !== rec.contentRevision
              ? 'recommendation.revised'
              : 'recommendation.submitted',
          resourceType: 'recommendation',
          resourceId: rec.id,
          revision: next.revision,
          metadata: { contentRevision: next.contentRevision, status: next.status },
        }),
      );
      const response = { recommendation: next, revision };
      await tx.insertReceipt({
        tenantId: ctx.tenantId,
        actorId: actor.userId,
        operation: 'recommendation.revise',
        key,
        requestHash,
        response,
        createdAt: at,
        expiresAt: toInstant(
          now + (this.#deps.receiptTtlHours ?? DEFAULT_RECEIPT_TTL_HOURS) * HOUR_MS,
        ),
      });
      return { ...response, replayed: false };
    });
  }
}
