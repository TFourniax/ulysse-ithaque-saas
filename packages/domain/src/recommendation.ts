import type { DoctrineRef } from './doctrine.ts';
import { ensure } from './errors.ts';
import { fingerprintOf } from './hash.ts';
import type { FactType, FactValue } from './opportunity.ts';
import type { Priority, RecommendationKind, Signal } from './rules.ts';
import { HOUR_MS, parseInstant, toInstant } from './time.ts';

export const RECOMMENDATION_STATUSES = [
  'draft',
  'pending',
  'approved',
  'rejected',
  'expired',
  'superseded',
] as const;
export type RecommendationStatus = (typeof RECOMMENDATION_STATUSES)[number];
export const OPEN_STATUSES: readonly RecommendationStatus[] = ['draft', 'pending'];

export const CLOSED_REASONS = [
  'ttl',
  'evidence_changed',
  'signal_resolved',
  'source_deleted',
  'connection_revoked',
  'doctrine_changed',
  'replaced',
] as const;
export type ClosedReason = (typeof CLOSED_REASONS)[number];

export type Subject = Readonly<{
  type: 'opportunity';
  id: string;
  externalId: string;
  label: string;
  connectionId: string;
}>;

export type Recommendation = Readonly<{
  tenantId: string;
  id: string;
  subject: Subject;
  kind: RecommendationKind;
  ruleId: string;
  ruleVersion: string;
  doctrine: DoctrineRef;
  contextVersion: number | null;
  analysisId: string;
  status: RecommendationStatus;
  /** Optimistic concurrency token: incremented on every state or content change. */
  revision: number;
  /** Incremented only when the proposed content materially changes. */
  contentRevision: number;
  fingerprint: string;
  priority: Priority;
  title: string;
  whyNow: string;
  proposedAction: string;
  assumptions: readonly string[];
  missingInformation: readonly string[];
  formulation: 'template' | 'model';
  generatedAt: string;
  expiresAt: string;
  dataAsOf: string;
  maxSourceAgeHours: number;
  closedAt: string | null;
  closedReason: ClosedReason | null;
  supersedesId: string | null;
  supersededById: string | null;
  updatedAt: string;
}>;

export type EvidenceLink = Readonly<{
  tenantId: string;
  id: string;
  recommendationId: string;
  factId: string;
  sourceRecordId: string;
  sourceRevision: number;
  connectionId: string;
  factType: FactType;
  label: string;
  state: FactValue['state'];
  value: unknown;
  locator: string;
  material: boolean;
  observedAt: string;
  sourceModifiedAt: string | null;
}>;

export type DecisionKind = 'approve' | 'reject';

export type DecisionRecord = Readonly<{
  tenantId: string;
  id: string;
  recommendationId: string;
  /** Revision the reviewer saw (expectedRevision). */
  revision: number;
  contentRevision: number;
  actorId: string;
  decision: DecisionKind;
  reason: string | null;
  createdAt: string;
}>;

export type RevisionRecord = Readonly<{
  tenantId: string;
  recommendationId: string;
  contentRevision: number;
  proposedAction: string;
  note: string | null;
  /** null when produced by the analysis pipeline. */
  createdBy: string | null;
  createdAt: string;
}>;

export function computeFingerprint(input: {
  tenantId: string;
  subjectId: string;
  ruleId: string;
  ruleVersion: string;
  doctrine: Pick<DoctrineRef, 'key' | 'version'>;
  signal: Pick<Signal, 'kind' | 'materialFacts'>;
}): string {
  return fingerprintOf({
    tenantId: input.tenantId,
    subjectId: input.subjectId,
    kind: input.signal.kind,
    ruleId: input.ruleId,
    ruleVersion: input.ruleVersion,
    doctrineKey: input.doctrine.key,
    doctrineVersion: input.doctrine.version,
    material: input.signal.materialFacts,
  });
}

export function isOpen(status: RecommendationStatus): boolean {
  return status === 'draft' || status === 'pending';
}

/** A pending/draft recommendation past its TTL is reported expired even before maintenance persists it. */
export function effectiveStatus(rec: Recommendation, now: number): RecommendationStatus {
  if (isOpen(rec.status) && now >= parseInstant(rec.expiresAt)) return 'expired';
  return rec.status;
}

export function expiresAtFor(generatedAt: number, lifetimeHours: number): string {
  return toInstant(generatedAt + lifetimeHours * HOUR_MS);
}

/** Current state of the evidence, recomputed from storage inside the decision transaction. */
export type EvidenceCheck = Readonly<{
  /** Fingerprint the active rule produces on current data; null if the signal no longer holds. */
  currentFingerprint: string | null;
  /** Start time of the last successful sync of the source connection. */
  dataAsOf: string | null;
  connectionActive: boolean;
  doctrineActive: boolean;
}>;

export type DecisionInput = Readonly<{
  decision: DecisionKind;
  expectedRevision: number;
  reason: string | null;
}>;

export function validateDecisionInput(input: unknown): DecisionInput {
  ensure(typeof input === 'object' && input !== null, 'INVALID_DECISION');
  const raw = input as Record<string, unknown>;
  ensure(raw.decision === 'approve' || raw.decision === 'reject', 'INVALID_DECISION');
  ensure(
    Number.isSafeInteger(raw.expectedRevision) && (raw.expectedRevision as number) > 0,
    'INVALID_REVISION',
  );
  const reason = raw.reason ?? null;
  ensure(
    reason === null || (typeof reason === 'string' && reason.length <= 1000),
    'INVALID_DECISION',
    'reason',
  );
  return {
    decision: raw.decision,
    expectedRevision: raw.expectedRevision as number,
    reason: typeof reason === 'string' && reason.trim() ? reason.trim() : null,
  };
}

function checkRevision(rec: Recommendation, expectedRevision: number): void {
  ensure(rec.revision === expectedRevision, 'REVISION_CONFLICT');
}

/**
 * Pure decision transition. Approval requires an open pending recommendation,
 * an unexpired TTL and evidence still identical and fresh. Rejection of a
 * pending/draft recommendation stays possible after expiry or evidence change.
 */
export function decide(
  rec: Recommendation,
  input: DecisionInput,
  evidence: EvidenceCheck,
  actorId: string,
  now: number,
  decisionId: string,
): { next: Recommendation; decision: DecisionRecord } {
  checkRevision(rec, input.expectedRevision);
  ensure(rec.status !== 'approved' && rec.status !== 'rejected', 'ALREADY_DECIDED');
  ensure(isOpen(rec.status), 'INVALID_TRANSITION', `${rec.status} -> ${input.decision}`);
  ensure(now >= parseInstant(rec.generatedAt), 'INVALID_TIMELINE');
  if (input.decision === 'approve') {
    ensure(
      rec.status === 'pending',
      'INVALID_TRANSITION',
      'draft must be submitted before approval',
    );
    ensure(now < parseInstant(rec.expiresAt), 'EXPIRED');
    ensure(evidence.connectionActive, 'STALE_EVIDENCE', 'connection inactive');
    ensure(evidence.doctrineActive, 'STALE_EVIDENCE', 'doctrine changed');
    ensure(evidence.currentFingerprint === rec.fingerprint, 'STALE_EVIDENCE', 'facts changed');
    ensure(
      evidence.dataAsOf !== null &&
        now - parseInstant(evidence.dataAsOf) <= rec.maxSourceAgeHours * HOUR_MS,
      'STALE_EVIDENCE',
      'source freshness',
    );
  }
  const at = toInstant(now);
  const next: Recommendation = {
    ...rec,
    status: input.decision === 'approve' ? 'approved' : 'rejected',
    revision: rec.revision + 1,
    closedAt: at,
    updatedAt: at,
  };
  // Approval records a human decision only; it never dispatches an external action (ADR-0002).
  return {
    next,
    decision: {
      tenantId: rec.tenantId,
      id: decisionId,
      recommendationId: rec.id,
      revision: input.expectedRevision,
      contentRevision: rec.contentRevision,
      actorId,
      decision: input.decision,
      reason: input.reason,
      createdAt: at,
    },
  };
}

export type RevisionInput = Readonly<{
  expectedRevision: number;
  proposedAction: string;
  note: string | null;
  submit: boolean;
}>;

export function validateRevisionInput(input: unknown): RevisionInput {
  ensure(typeof input === 'object' && input !== null, 'INVALID_INPUT');
  const raw = input as Record<string, unknown>;
  ensure(
    Number.isSafeInteger(raw.expectedRevision) && (raw.expectedRevision as number) > 0,
    'INVALID_REVISION',
  );
  ensure(
    typeof raw.proposedAction === 'string' &&
      raw.proposedAction.trim().length > 0 &&
      raw.proposedAction.length <= 4000,
    'INVALID_INPUT',
    'proposedAction',
  );
  const note = raw.note ?? null;
  ensure(
    note === null || (typeof note === 'string' && note.length <= 1000),
    'INVALID_INPUT',
    'note',
  );
  ensure(typeof raw.submit === 'boolean', 'INVALID_INPUT', 'submit');
  return {
    expectedRevision: raw.expectedRevision as number,
    proposedAction: raw.proposedAction.trim(),
    note: typeof note === 'string' && note.trim() ? note.trim() : null,
    submit: raw.submit,
  };
}

/**
 * A human edit creates a new content revision. Any previous review is void:
 * the result is `pending` (submitted) or `draft` and needs a fresh decision.
 */
export function revise(
  rec: Recommendation,
  input: RevisionInput,
  actorId: string,
  now: number,
): { next: Recommendation; revision: RevisionRecord } {
  checkRevision(rec, input.expectedRevision);
  ensure(rec.status !== 'approved' && rec.status !== 'rejected', 'ALREADY_DECIDED');
  ensure(isOpen(rec.status), 'INVALID_TRANSITION', `${rec.status} -> revise`);
  ensure(now < parseInstant(rec.expiresAt), 'EXPIRED');
  const changed = input.proposedAction !== rec.proposedAction;
  ensure(
    changed || (rec.status === 'draft' && input.submit),
    'INVALID_INPUT',
    'no material change',
  );
  const at = toInstant(now);
  const contentRevision = changed ? rec.contentRevision + 1 : rec.contentRevision;
  return {
    next: {
      ...rec,
      proposedAction: input.proposedAction,
      contentRevision,
      status: input.submit ? 'pending' : 'draft',
      revision: rec.revision + 1,
      updatedAt: at,
    },
    revision: {
      tenantId: rec.tenantId,
      recommendationId: rec.id,
      contentRevision,
      proposedAction: input.proposedAction,
      note: input.note,
      createdBy: actorId,
      createdAt: at,
    },
  };
}

/**
 * Model-assisted wording of the proposed step. Applies only to a pending,
 * unexpired recommendation whose content was never edited by a human
 * (content revision 1): a person's wording is never overwritten.
 */
export function reformulate(
  rec: Recommendation,
  proposedAction: string,
  now: number,
): { next: Recommendation; revision: RevisionRecord } {
  ensure(rec.status === 'pending', 'INVALID_TRANSITION', `${rec.status} -> reformulate`);
  ensure(
    rec.contentRevision === 1,
    'INVALID_TRANSITION',
    'human-edited content is never overwritten',
  );
  ensure(now < parseInstant(rec.expiresAt), 'EXPIRED');
  const text = proposedAction.trim();
  ensure(text.length > 0 && text.length <= 4000, 'INVALID_INPUT', 'proposedAction');
  const at = toInstant(now);
  return {
    next: {
      ...rec,
      proposedAction: text,
      contentRevision: 2,
      formulation: 'model',
      revision: rec.revision + 1,
      updatedAt: at,
    },
    revision: {
      tenantId: rec.tenantId,
      recommendationId: rec.id,
      contentRevision: 2,
      proposedAction: text,
      note: 'Formulation assistée par modèle (à vérifier avant décision).',
      createdBy: null,
      createdAt: at,
    },
  };
}

/** System closure used by maintenance and analysis (TTL, changed or deleted evidence, replacement). */
export function close(
  rec: Recommendation,
  status: 'expired' | 'superseded',
  reason: ClosedReason,
  now: number,
  supersededById: string | null = null,
): Recommendation {
  ensure(isOpen(rec.status), 'INVALID_TRANSITION', `${rec.status} -> ${status}`);
  ensure(
    status === 'superseded' ? supersededById !== null : supersededById === null,
    'INVALID_TRANSITION',
  );
  const at = toInstant(now);
  return {
    ...rec,
    status,
    closedReason: reason,
    closedAt: at,
    supersededById,
    revision: rec.revision + 1,
    updatedAt: at,
  };
}
