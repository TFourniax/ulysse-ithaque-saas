import type { AnalysisSubject } from '../analysis.ts';
import { enabledRules, evaluateSignals, planAnalysis } from '../analysis.ts';
import type { Context } from '../context.ts';
import { requireScope } from '../context.ts';
import { assertUsableForAnalysis, doctrineRef } from '../doctrine.ts';
import { fingerprintOf } from '../hash.ts';
import type { EvidenceLink, Recommendation } from '../recommendation.ts';
import { close, expiresAtFor } from '../recommendation.ts';
import type { Analysis, AnalysisTrigger } from '../records.ts';
import { DAY_MS, toInstant } from '../time.ts';
import type { ServiceDeps } from './shared.ts';
import { audit, outbox } from './shared.ts';

const DELETED_LOOKBACK_DAYS = 30;

export class AnalysisService {
  readonly #deps: ServiceDeps;

  constructor(deps: ServiceDeps) {
    this.#deps = deps;
  }

  /**
   * Runs the validated doctrine over current tenant facts and reconciles the
   * result with stored recommendations, in one transaction. Idempotent: running
   * twice on unchanged data produces no new recommendation and no new audit event
   * other than the analysis record itself.
   */
  async run(ctx: Context, trigger: AnalysisTrigger): Promise<Analysis> {
    requireScope(ctx, 'analysis:run');
    const { uow, clock, ids, rules } = this.#deps;
    return uow.run(ctx, async (tx) => {
      await tx.lock('analysis');
      const now = clock.now().getTime();
      const at = toInstant(now);
      const doctrine = await tx.getActiveDoctrine();
      const context = await tx.getCurrentContext();
      const base = {
        tenantId: ctx.tenantId,
        id: ids.next(),
        trigger,
        contextVersion: context?.version ?? null,
        formulation: { provider: 'template', model: null, promptVersion: null },
        startedAt: at,
        completedAt: at,
        usage: null,
      };
      if (!doctrine) {
        const skipped: Analysis = {
          ...base,
          status: 'skipped',
          doctrineId: null,
          doctrineVersion: null,
          ruleVersions: {},
          inputHash: fingerprintOf({ doctrine: null }),
          evaluated: 0,
          generated: 0,
          unchanged: 0,
          closed: 0,
          abstentions: { no_validated_doctrine: 1 },
          errorCode: 'no_validated_doctrine',
        };
        await tx.insertAnalysis(skipped);
        return skipped;
      }
      assertUsableForAnalysis(doctrine);
      const connections = new Map((await tx.listConnections()).map((c) => [c.id, c]));
      const opportunities = await tx.listOpportunitiesForAnalysis(
        toInstant(now - DELETED_LOOKBACK_DAYS * DAY_MS),
      );
      const subjects: AnalysisSubject[] = opportunities.map((o) => {
        const connection = connections.get(o.connectionId);
        return {
          opportunity: o,
          dataAsOf: connection?.dataAsOf ?? null,
          connectionActive: connection?.status === 'active',
        };
      });
      const evaluation = evaluateSignals({
        tenantId: ctx.tenantId,
        now,
        doctrine,
        rules,
        context,
        subjects,
      });
      const open = await tx.listOpenRecommendations();
      const previous = await tx.listRecommendationsByFingerprint(
        evaluation.evaluations.map((e) => e.fingerprint),
      );
      const previousByFingerprint = new Map<string, Recommendation>();
      for (const rec of previous) {
        const known = previousByFingerprint.get(rec.fingerprint);
        if (!known || known.generatedAt < rec.generatedAt)
          previousByFingerprint.set(rec.fingerprint, rec);
      }
      const recentRejections = await tx.listRejectedSince(
        toInstant(now - doctrine.content.policy.rejectionCooldownDays * DAY_MS),
      );
      const plan = planAnalysis({
        now,
        doctrine,
        evaluation,
        subjectIds: new Map(
          subjects.map((s) => [
            s.opportunity.id,
            { deleted: s.opportunity.deletedAt !== null, connectionActive: s.connectionActive },
          ]),
        ),
        open,
        previousByFingerprint,
        recentRejections,
      });

      const analysisId = base.id;
      const ref = doctrineRef(doctrine);
      const created: Recommendation[] = [];
      for (const candidate of plan.candidates) {
        const { signal, subject } = candidate;
        const rec: Recommendation = {
          tenantId: ctx.tenantId,
          id: ids.next(),
          subject: {
            type: 'opportunity',
            id: subject.id,
            externalId: subject.externalId,
            label: subject.fields.name,
            connectionId: subject.connectionId,
          },
          kind: signal.kind,
          ruleId: candidate.rule.id,
          ruleVersion: candidate.rule.version,
          doctrine: ref,
          contextVersion: context?.version ?? null,
          analysisId,
          status: 'pending',
          revision: 1,
          contentRevision: 1,
          fingerprint: candidate.fingerprint,
          priority: signal.priority,
          title: signal.title,
          whyNow: signal.whyNow,
          proposedAction: signal.proposedAction,
          assumptions: signal.assumptions,
          missingInformation: signal.missingInformation,
          formulation: 'template',
          generatedAt: at,
          expiresAt: expiresAtFor(now, doctrine.content.policy.recommendationLifetimeHours),
          dataAsOf: candidate.dataAsOf,
          maxSourceAgeHours: doctrine.content.policy.maxSourceAgeHours,
          closedAt: null,
          closedReason: null,
          supersedesId: candidate.replaces?.id ?? null,
          supersededById: null,
          updatedAt: at,
        };
        created.push(rec);
      }
      // Close replaced or unsupported recommendations before inserting their successors.
      for (const closure of plan.closures) {
        const successor =
          closure.replacedBy === null ? null : (created[closure.replacedBy]?.id ?? null);
        const next = close(closure.recommendation, closure.status, closure.reason, now, successor);
        await tx.updateRecommendation(next);
        await tx.appendAudit(
          audit(ctx, ids, at, {
            eventType: `recommendation.${closure.status}`,
            resourceType: 'recommendation',
            resourceId: next.id,
            revision: next.revision,
            metadata: { reason: closure.reason, supersededBy: successor },
          }),
        );
      }
      for (const rec of created) {
        await tx.insertRecommendation(rec);
        const facts = await tx.listCurrentFacts(rec.subject.id);
        const candidate = plan.candidates[created.indexOf(rec)];
        const links: EvidenceLink[] = (candidate?.signal.evidence ?? []).flatMap((ref) => {
          const fact = facts.find((f) => f.factType === ref.factType);
          if (!fact) return [];
          return [
            {
              tenantId: ctx.tenantId,
              id: ids.next(),
              recommendationId: rec.id,
              factId: fact.id,
              sourceRecordId: fact.sourceRecordId,
              sourceRevision: fact.sourceRevision,
              connectionId: fact.connectionId,
              factType: fact.factType,
              label: ref.label,
              state: fact.state,
              value: fact.value,
              locator: fact.locator,
              material: ref.material,
              observedAt: fact.observedAt,
              sourceModifiedAt: fact.sourceModifiedAt,
            },
          ];
        });
        await tx.insertEvidence(links);
        await tx.insertRevision({
          tenantId: ctx.tenantId,
          recommendationId: rec.id,
          contentRevision: 1,
          proposedAction: rec.proposedAction,
          note: null,
          createdBy: null,
          createdAt: at,
        });
        await tx.appendAudit(
          audit(ctx, ids, at, {
            eventType: 'recommendation.generated',
            resourceType: 'recommendation',
            resourceId: rec.id,
            revision: rec.revision,
            metadata: {
              ruleId: rec.ruleId,
              doctrineVersion: rec.doctrine.version,
              priority: rec.priority.score,
              supersedes: rec.supersedesId,
            },
          }),
        );
        await tx.enqueueOutbox(
          outbox(ctx, ids, at, 'recommendation.generated', { type: 'recommendation', id: rec.id }),
        );
      }
      const abstentions: Record<string, number> = {};
      for (const a of plan.abstentions) abstentions[a.reason] = (abstentions[a.reason] ?? 0) + 1;
      const analysis: Analysis = {
        ...base,
        status: 'completed',
        doctrineId: doctrine.id,
        doctrineVersion: doctrine.version,
        ruleVersions: Object.fromEntries(
          enabledRules(doctrine, rules).map(({ rule }) => [rule.id, rule.version]),
        ),
        inputHash: fingerprintOf({
          doctrine: [doctrine.id, doctrine.version],
          context: context?.version ?? null,
          subjects: subjects.map((s) => [
            s.opportunity.id,
            s.opportunity.revision,
            s.dataAsOf,
            s.connectionActive,
          ]),
        }),
        evaluated: evaluation.evaluatedSubjects,
        generated: created.length,
        unchanged: plan.unchanged.length,
        closed: plan.closures.length,
        abstentions,
        errorCode: null,
      };
      await tx.insertAnalysis(analysis);
      return analysis;
    });
  }
}
