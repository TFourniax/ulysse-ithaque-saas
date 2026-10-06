import type { CompanyContext } from './company-context.ts';
import type { Doctrine } from './doctrine.ts';
import { doctrineRef } from './doctrine.ts';
import type { Opportunity } from './opportunity.ts';
import type { ClosedReason, Recommendation } from './recommendation.ts';
import { computeFingerprint, isOpen } from './recommendation.ts';
import type { AbstentionReason, RuleDefinition, RuleRegistry, Signal } from './rules.ts';
import { DAY_MS, HOUR_MS, parseInstant } from './time.ts';

export type AnalysisSubject = Readonly<{
  opportunity: Opportunity;
  /** Start of the last successful sync of the subject's connection; null before the first sync. */
  dataAsOf: string | null;
  connectionActive: boolean;
}>;

export type Evaluation = Readonly<{
  subject: Opportunity;
  rule: RuleDefinition;
  signal: Signal;
  fingerprint: string;
  dataAsOf: string;
  slot: string;
}>;

export type Abstention = Readonly<{
  subjectId: string;
  ruleId: string;
  reason: AbstentionReason;
  detail: string;
}>;

type SlotState = 'signal' | 'stale' | 'missing' | 'none';

export type EvaluationResult = Readonly<{
  evaluations: readonly Evaluation[];
  abstentions: readonly Abstention[];
  slots: ReadonlyMap<string, SlotState>;
  evaluatedSubjects: number;
}>;

export type Candidate = Readonly<{
  subject: Opportunity;
  rule: RuleDefinition;
  signal: Signal;
  fingerprint: string;
  dataAsOf: string;
  replaces: Recommendation | null;
}>;

export type Closure = Readonly<{
  recommendation: Recommendation;
  status: 'expired' | 'superseded';
  reason: ClosedReason;
  /** Index in `candidates` of the replacing recommendation when superseded. */
  replacedBy: number | null;
}>;

export type AnalysisPlan = Readonly<{
  candidates: readonly Candidate[];
  unchanged: readonly Recommendation[];
  closures: readonly Closure[];
  abstentions: readonly Abstention[];
}>;

export function slotOf(subjectId: string, kind: string): string {
  return `${subjectId}\u0000${kind}`;
}

export function enabledRules(
  doctrine: Doctrine,
  rules: RuleRegistry,
): Array<{ rule: RuleDefinition; parameters: Readonly<Record<string, number>> }> {
  return doctrine.content.rules.flatMap((config) => {
    const rule = rules.get(config.ruleId);
    return config.enabled && rule ? [{ rule, parameters: config.parameters }] : [];
  });
}

export function isFresh(dataAsOf: string | null, maxSourceAgeHours: number, now: number): boolean {
  if (dataAsOf === null) return false;
  const at = parseInstant(dataAsOf);
  return at <= now && now - at <= maxSourceAgeHours * HOUR_MS;
}

/** Step 1 (pure): evaluate enabled doctrine rules on fresh, active subjects. */
export function evaluateSignals(input: {
  tenantId: string;
  now: number;
  doctrine: Doctrine;
  rules: RuleRegistry;
  context: CompanyContext | null;
  subjects: readonly AnalysisSubject[];
}): EvaluationResult {
  const { doctrine, now } = input;
  const ref = doctrineRef(doctrine);
  const policy = doctrine.content.policy;
  const evaluations: Evaluation[] = [];
  const abstentions: Abstention[] = [];
  const slots = new Map<string, SlotState>();
  let evaluatedSubjects = 0;
  for (const subject of input.subjects) {
    const o = subject.opportunity;
    if (o.deletedAt !== null || !subject.connectionActive) continue;
    evaluatedSubjects += 1;
    const rules = enabledRules(doctrine, input.rules);
    if (!isFresh(subject.dataAsOf, policy.maxSourceAgeHours, now)) {
      // One abstention per subject: no rule may conclude on data older than the doctrine allows.
      abstentions.push({
        subjectId: o.id,
        ruleId: '*',
        reason: 'stale_source',
        detail: subject.dataAsOf ?? 'never_synced',
      });
      for (const { rule } of rules) slots.set(slotOf(o.id, rule.kind), 'stale');
      continue;
    }
    for (const { rule, parameters } of rules) {
      const slot = slotOf(o.id, rule.kind);
      const outcome = rule.evaluate({ opportunity: o, parameters, context: input.context, now });
      if (outcome.type === 'no_signal') {
        if (!slots.has(slot)) slots.set(slot, 'none');
        continue;
      }
      if (outcome.type === 'abstain') {
        abstentions.push({
          subjectId: o.id,
          ruleId: rule.id,
          reason: outcome.reason,
          detail: outcome.detail,
        });
        slots.set(slot, 'missing');
        continue;
      }
      slots.set(slot, 'signal');
      const fingerprint = computeFingerprint({
        tenantId: input.tenantId,
        subjectId: o.id,
        ruleId: rule.id,
        ruleVersion: rule.version,
        doctrine: ref,
        signal: outcome.signal,
      });
      evaluations.push({
        subject: o,
        rule,
        signal: outcome.signal,
        fingerprint,
        dataAsOf: subject.dataAsOf ?? '',
        slot,
      });
    }
  }
  return { evaluations, abstentions, slots, evaluatedSubjects };
}

/**
 * Step 2 (pure): reconcile evaluations with stored recommendations.
 * - same fingerprint already open → unchanged (no duplicate, no notification storm);
 * - same fingerprint already decided → not re-proposed;
 * - recent rejection of the same subject/kind → cooldown;
 * - different fingerprint for an open slot → supersede and link;
 * - open recommendation no longer supported → expired with an explicit reason;
 * - net-new proposals admitted by priority up to the doctrine volume cap.
 */
export function planAnalysis(input: {
  now: number;
  doctrine: Doctrine;
  evaluation: EvaluationResult;
  subjectIds: ReadonlyMap<string, { deleted: boolean; connectionActive: boolean }>;
  open: readonly Recommendation[];
  previousByFingerprint: ReadonlyMap<string, Recommendation>;
  recentRejections: readonly Recommendation[];
}): AnalysisPlan {
  const { doctrine, now, evaluation } = input;
  const policy = doctrine.content.policy;
  const openBySlot = new Map<string, Recommendation>();
  for (const rec of input.open)
    if (isOpen(rec.status)) openBySlot.set(slotOf(rec.subject.id, rec.kind), rec);
  const cooldownStart = now - policy.rejectionCooldownDays * DAY_MS;
  const rejectedSlots = new Set(
    input.recentRejections
      .filter(
        (r) =>
          r.status === 'rejected' &&
          r.closedAt !== null &&
          parseInstant(r.closedAt) >= cooldownStart,
      )
      .map((r) => slotOf(r.subject.id, r.kind)),
  );
  const slots = new Map(evaluation.slots);
  const abstentions: Abstention[] = [...evaluation.abstentions];
  const unchanged: Recommendation[] = [];
  const proposals: Evaluation[] = [];

  for (const e of evaluation.evaluations) {
    const current = openBySlot.get(e.slot);
    if (current && current.fingerprint === e.fingerprint) {
      unchanged.push(current);
      continue;
    }
    const previous = input.previousByFingerprint.get(e.fingerprint);
    if (previous && (previous.status === 'approved' || previous.status === 'rejected')) {
      abstentions.push({
        subjectId: e.subject.id,
        ruleId: e.rule.id,
        reason: 'already_decided',
        detail: previous.id,
      });
      // An open recommendation with an outdated fingerprint can no longer be approved: close it.
      slots.set(e.slot, 'missing');
      continue;
    }
    if (rejectedSlots.has(e.slot) && !current) {
      abstentions.push({
        subjectId: e.subject.id,
        ruleId: e.rule.id,
        reason: 'rejection_cooldown',
        detail: e.rule.kind,
      });
      continue;
    }
    proposals.push(e);
  }

  const candidates: Candidate[] = [];
  const closures: Closure[] = [];
  const replacedSlots = new Set<string>();
  for (const p of proposals) {
    const replaced = openBySlot.get(p.slot);
    if (!replaced) continue;
    replacedSlots.add(p.slot);
    candidates.push({
      subject: p.subject,
      rule: p.rule,
      signal: p.signal,
      fingerprint: p.fingerprint,
      dataAsOf: p.dataAsOf,
      replaces: replaced,
    });
    const reason: ClosedReason =
      replaced.doctrine.id !== doctrine.id ? 'doctrine_changed' : 'evidence_changed';
    closures.push({
      recommendation: replaced,
      status: 'superseded',
      reason,
      replacedBy: candidates.length - 1,
    });
  }
  for (const [slot, rec] of openBySlot) {
    if (replacedSlots.has(slot) || unchanged.includes(rec)) continue;
    const subject = input.subjectIds.get(rec.subject.id);
    let reason: ClosedReason | null = null;
    if (!subject || subject.deleted) reason = 'source_deleted';
    else if (!subject.connectionActive) reason = 'connection_revoked';
    else if (rec.doctrine.id !== doctrine.id) reason = 'doctrine_changed';
    else {
      const state = slots.get(slot);
      // 'stale' keeps the recommendation open: approval stays blocked by the freshness check.
      if (state === 'none' || state === undefined) reason = 'signal_resolved';
      else if (state === 'missing') reason = 'evidence_changed';
    }
    if (reason) closures.push({ recommendation: rec, status: 'expired', reason, replacedBy: null });
  }

  const openAfter = openBySlot.size - closures.filter((c) => c.status === 'expired').length;
  let capacity = Math.max(0, policy.maxOpenRecommendations - openAfter);
  const fresh = proposals
    .filter((p) => !openBySlot.has(p.slot))
    .sort(
      (a, b) =>
        b.signal.priority.score - a.signal.priority.score ||
        a.fingerprint.localeCompare(b.fingerprint),
    );
  for (const p of fresh) {
    if (capacity <= 0) {
      abstentions.push({
        subjectId: p.subject.id,
        ruleId: p.rule.id,
        reason: 'volume_cap',
        detail: String(policy.maxOpenRecommendations),
      });
      continue;
    }
    capacity -= 1;
    candidates.push({
      subject: p.subject,
      rule: p.rule,
      signal: p.signal,
      fingerprint: p.fingerprint,
      dataAsOf: p.dataAsOf,
      replaces: null,
    });
  }
  return { candidates, unchanged, closures, abstentions };
}

/** Recomputes the fingerprint the doctrine would produce now for an existing recommendation. */
export function currentFingerprintFor(input: {
  recommendation: Recommendation;
  opportunity: Opportunity | null;
  doctrine: Doctrine | null;
  rules: RuleRegistry;
  context: CompanyContext | null;
  now: number;
}): string | null {
  const { recommendation: rec, opportunity, doctrine } = input;
  if (!opportunity || opportunity.deletedAt !== null || !doctrine) return null;
  const rule = input.rules.get(rec.ruleId);
  const config = doctrine.content.rules.find((r) => r.ruleId === rec.ruleId);
  if (!rule || rule.version !== rec.ruleVersion || !config || !config.enabled) return null;
  const outcome = rule.evaluate({
    opportunity,
    parameters: config.parameters,
    context: input.context,
    now: input.now,
  });
  if (outcome.type !== 'signal') return null;
  return computeFingerprint({
    tenantId: rec.tenantId,
    subjectId: opportunity.id,
    ruleId: rule.id,
    ruleVersion: rule.version,
    doctrine: doctrineRef(doctrine),
    signal: outcome.signal,
  });
}
