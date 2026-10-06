import type { CompanyContext } from './company-context.ts';
import { isTargetSegment } from './company-context.ts';
import type { ParameterSpec } from './doctrine.ts';
import type { FactType, Opportunity } from './opportunity.ts';
import { DAY_MS, parseInstant } from './time.ts';

export const RECOMMENDATION_KINDS = ['define_next_step', 'follow_up_overdue_step'] as const;
export type RecommendationKind = (typeof RECOMMENDATION_KINDS)[number];

export type PriorityReason = Readonly<{ label: string; points: number }>;
export type Priority = Readonly<{ score: number; reasons: readonly PriorityReason[] }>;

export type EvidenceRef = Readonly<{ factType: FactType; label: string; material: boolean }>;

export type Signal = Readonly<{
  kind: RecommendationKind;
  /** Facts whose change makes the signal different; drives the fingerprint. */
  materialFacts: Readonly<Record<string, unknown>>;
  evidence: readonly EvidenceRef[];
  title: string;
  whyNow: string;
  proposedAction: string;
  assumptions: readonly string[];
  missingInformation: readonly string[];
  priority: Priority;
}>;

export const ABSTENTION_REASONS = [
  'stale_source',
  'missing_data',
  'volume_cap',
  'rejection_cooldown',
  'already_decided',
] as const;
export type AbstentionReason = (typeof ABSTENTION_REASONS)[number];

export type RuleOutcome =
  | Readonly<{ type: 'no_signal' }>
  | Readonly<{ type: 'abstain'; reason: AbstentionReason; detail: string }>
  | Readonly<{ type: 'signal'; signal: Signal }>;

export type RuleInput = Readonly<{
  opportunity: Opportunity;
  parameters: Readonly<Record<string, number>>;
  context: CompanyContext | null;
  now: number;
}>;

export type RuleDefinition = Readonly<{
  id: string;
  version: string;
  kind: RecommendationKind;
  label: string;
  /** Fixture rules are technical examples, never validated business doctrine. */
  fictional: boolean;
  parameters: readonly ParameterSpec[];
  evaluate(input: RuleInput): RuleOutcome;
}>;

const TARGET_SEGMENT_POINTS = 20;

function daysSince(iso: string, now: number): number {
  return Math.floor((now - parseInstant(iso)) / DAY_MS);
}

function commonMissing(o: Opportunity): string[] {
  const missing: string[] = [];
  if (o.fields.ownerName.state !== 'present')
    missing.push('Responsable commercial non renseigné ou non fourni par la source.');
  if (o.fields.amount.state === 'unavailable') missing.push('Montant non fourni par la source.');
  if (o.fields.segment.state === 'unavailable')
    missing.push(
      'Segment non fourni par la source : la priorité ne tient pas compte des segments cibles.',
    );
  return missing;
}

function segmentBonus(o: Opportunity, context: CompanyContext | null): PriorityReason[] {
  if (o.fields.segment.state === 'present' && isTargetSegment(context, o.fields.segment.value)) {
    return [
      {
        label: `Segment « ${o.fields.segment.value} » prioritaire dans le contexte de l'entreprise`,
        points: TARGET_SEGMENT_POINTS,
      },
    ];
  }
  return [];
}

function score(reasons: PriorityReason[]): Priority {
  return {
    score: Math.min(
      100,
      reasons.reduce((sum, r) => sum + r.points, 0),
    ),
    reasons,
  };
}

/** Fictional fixture rule ported from the foundation kernel (`demo-next-step-v1`). */
export const stalledOpportunityRule: RuleDefinition = {
  id: 'fixture.stalled-opportunity',
  version: '2',
  kind: 'define_next_step',
  label: 'Opportunité ouverte sans prochaine étape ni interaction récente (règle fictive)',
  fictional: true,
  parameters: [{ name: 'inactivityDays', min: 1, max: 365, integer: true }],
  evaluate({ opportunity: o, parameters, context, now }) {
    if (o.fields.stage !== 'open') return { type: 'no_signal' };
    if (o.fields.nextStep.state === 'present') return { type: 'no_signal' };
    if (o.fields.nextStep.state === 'unavailable') {
      return { type: 'abstain', reason: 'missing_data', detail: 'next_step' };
    }
    if (o.fields.lastInteractionAt.state !== 'present') {
      return { type: 'abstain', reason: 'missing_data', detail: 'last_interaction_at' };
    }
    const inactivityDays = parameters.inactivityDays ?? Number.NaN;
    const days = daysSince(o.fields.lastInteractionAt.value, now);
    if (!(days >= inactivityDays)) return { type: 'no_signal' };
    const reasons: PriorityReason[] = [
      {
        label: `${days} jours sans interaction enregistrée (3 points par jour, plafonné à 60)`,
        points: Math.min(60, days * 3),
      },
      ...segmentBonus(o, context),
    ];
    return {
      type: 'signal',
      signal: {
        kind: 'define_next_step',
        materialFacts: {
          stage: o.fields.stage,
          nextStep: o.fields.nextStep.state,
          lastInteractionAt: o.fields.lastInteractionAt.value,
        },
        evidence: [
          { factType: 'stage', label: 'Étape de vente', material: true },
          { factType: 'next_step', label: 'Prochaine étape', material: true },
          { factType: 'last_interaction_at', label: 'Dernière interaction', material: true },
          { factType: 'owner_name', label: 'Responsable', material: false },
          { factType: 'amount', label: 'Montant', material: false },
          { factType: 'segment', label: 'Segment', material: false },
        ],
        title: `Définir la prochaine étape : ${o.fields.name}`,
        whyNow: `${days} jours sans interaction enregistrée (seuil : ${inactivityDays} jours) et aucune prochaine étape renseignée.`,
        proposedAction:
          "Vérifier le contexte de l'opportunité puis décider d'une prochaine étape datée (relance, rendez-vous ou clôture).",
        assumptions: [
          'La date de dernière interaction reflète les échanges enregistrés dans la source ; des échanges hors source peuvent exister.',
        ],
        missingInformation: commonMissing(o),
        priority: score(reasons),
      },
    };
  },
};

export const overdueNextStepRule: RuleDefinition = {
  id: 'fixture.overdue-next-step',
  version: '1',
  kind: 'follow_up_overdue_step',
  label: 'Prochaine étape échue sur une opportunité ouverte (règle fictive)',
  fictional: true,
  parameters: [{ name: 'graceDays', min: 0, max: 60, integer: true }],
  evaluate({ opportunity: o, parameters, context, now }) {
    if (o.fields.stage !== 'open' || o.fields.nextStep.state !== 'present')
      return { type: 'no_signal' };
    if (o.fields.nextStepDueAt.state === 'unavailable') {
      return { type: 'abstain', reason: 'missing_data', detail: 'next_step_due_at' };
    }
    if (o.fields.nextStepDueAt.state === 'empty') return { type: 'no_signal' };
    const graceDays = parameters.graceDays ?? Number.NaN;
    const overdue = daysSince(o.fields.nextStepDueAt.value, now);
    if (!(overdue > graceDays)) return { type: 'no_signal' };
    const reasons: PriorityReason[] = [
      {
        label: `Échéance dépassée de ${overdue} jours (4 points par jour, plafonné à 60)`,
        points: Math.min(60, overdue * 4),
      },
      ...segmentBonus(o, context),
    ];
    return {
      type: 'signal',
      signal: {
        kind: 'follow_up_overdue_step',
        materialFacts: {
          stage: o.fields.stage,
          nextStep: o.fields.nextStep.value,
          nextStepDueAt: o.fields.nextStepDueAt.value,
        },
        evidence: [
          { factType: 'stage', label: 'Étape de vente', material: true },
          { factType: 'next_step', label: 'Prochaine étape', material: true },
          { factType: 'next_step_due_at', label: 'Échéance', material: true },
          { factType: 'last_interaction_at', label: 'Dernière interaction', material: false },
          { factType: 'owner_name', label: 'Responsable', material: false },
          { factType: 'segment', label: 'Segment', material: false },
        ],
        title: `Prochaine étape échue : ${o.fields.name}`,
        whyNow: `La prochaine étape « ${o.fields.nextStep.value} » était prévue il y a ${overdue} jours (tolérance : ${graceDays} jours).`,
        proposedAction:
          "Confirmer si l'étape a eu lieu, puis mettre à jour ou replanifier la prochaine étape.",
        assumptions: ["L'échéance enregistrée dans la source est à jour."],
        missingInformation: commonMissing(o),
        priority: score(reasons),
      },
    };
  },
};

export type RuleRegistry = ReadonlyMap<string, RuleDefinition>;

export function createRuleRegistry(rules: readonly RuleDefinition[]): RuleRegistry {
  return new Map(rules.map((r) => [r.id, r]));
}

export const defaultRules: RuleRegistry = createRuleRegistry([
  stalledOpportunityRule,
  overdueNextStepRule,
]);

export function parameterSpecs(
  registry: RuleRegistry,
): ReadonlyMap<string, readonly ParameterSpec[]> {
  return new Map([...registry.values()].map((r) => [r.id, r.parameters]));
}
