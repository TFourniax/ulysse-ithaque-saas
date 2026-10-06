import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DomainError } from '../src/errors.ts';
import { validateDoctrineContent, validatePolicy } from '../src/doctrine.ts';
import {
  contentHash,
  empty,
  planSourceChange,
  present,
  unavailable,
  validateFields,
  validateNormalizedRecord,
} from '../src/opportunity.ts';
import {
  decide,
  expiresAtFor,
  QUALITY_LABELS,
  validateDecisionInput,
} from '../src/recommendation.ts';
import { buildQualityReport } from '../src/report.ts';
import {
  defaultRules,
  overdueNextStepRule,
  parameterSpecs,
  stalledOpportunityRule,
} from '../src/rules.ts';
import { FIXTURE_DOCTRINE, opportunityFields, record } from '../src/testing/fixtures.ts';
import { parseInstant } from '../src/time.ts';
import type { Opportunity } from '../src/opportunity.ts';
import type { Recommendation } from '../src/recommendation.ts';

const NOW = parseInstant('2026-10-06T14:00:00.000Z');

function code(c: string) {
  return (e: unknown) => e instanceof DomainError && e.code === c;
}

function opportunity(fields = opportunityFields()): Opportunity {
  return {
    tenantId: '00000000-0000-4000-8000-000000000001',
    id: '00000000-0000-4000-8000-000000000002',
    connectionId: '00000000-0000-4000-8000-000000000003',
    externalId: 'deal-1',
    sourceRecordId: '00000000-0000-4000-8000-000000000004',
    revision: 1,
    fields,
    sourceModifiedAt: null,
    observedAt: '2026-10-06T13:30:00.000Z',
    ingestedAt: '2026-10-06T13:30:00.000Z',
    deletedAt: null,
  };
}

test('timestamps must be canonical UTC instants and real calendar dates', () => {
  assert.equal(parseInstant('2026-10-06T14:00:00Z'), NOW);
  for (const bad of [
    'yesterday',
    '2026-02-30T14:00:00.000Z',
    '2026-10-06 14:00:00',
    '2026-10-06T14:00:00+02:00',
    12,
  ]) {
    assert.throws(() => parseInstant(bad), code('INVALID_TIMESTAMP'));
  }
});

test('field projection keeps known fields only and distinguishes empty from unavailable', () => {
  const fields = validateFields({
    ...opportunityFields({ nextStep: empty, segment: unavailable }),
    rawBody: 'PRIVATE',
  });
  assert.equal('rawBody' in fields, false);
  assert.deepEqual(fields.nextStep, { state: 'empty' });
  assert.deepEqual(fields.segment, { state: 'unavailable' });
  assert.throws(
    () =>
      validateFields({ ...opportunityFields(), amount: present({ amount: 1.5, currency: 'EUR' }) }),
    code('INVALID_INPUT'),
  );
  assert.throws(
    () => validateFields({ ...opportunityFields(), stage: 'maybe' }),
    code('INVALID_INPUT'),
  );
  assert.throws(
    () => validateNormalizedRecord({ ...record('x'), entityType: 'contact' }),
    code('INVALID_INPUT'),
  );
});

test('source change planning: create, unchanged, revise, stale, delete, restore, conflict', () => {
  const at = '2026-10-06T13:30:00.000Z';
  const r = record('deal-1');
  const created = planSourceChange(null, r, at, NOW);
  assert.equal(created.kind, 'create');
  const head = {
    sourceRecordId: 's1',
    revision: 1,
    contentHash: contentHash(r.fields!),
    providerVersion: 'v1',
    sourceModifiedAt: r.sourceModifiedAt,
    observedAt: at,
    deletedAt: null,
  };
  assert.equal(planSourceChange(head, { ...r, providerVersion: 'v2' }, at, NOW).kind, 'unchanged');
  assert.deepEqual(
    planSourceChange(head, record('deal-1', { stage: 'won' }), at, NOW).kind,
    'revise',
  );
  assert.equal(
    planSourceChange(
      head,
      record('deal-1', { stage: 'won' }, { sourceModifiedAt: '2026-10-01T00:00:00.000Z' }),
      at,
      NOW,
    ).kind,
    'stale',
  );
  assert.throws(
    () =>
      planSourceChange(
        head,
        record('deal-1', { stage: 'won' }, { providerVersion: 'v1' }),
        at,
        NOW,
      ),
    code('SOURCE_VERSION_CONFLICT'),
  );
  const deleted = planSourceChange(
    head,
    { ...r, deleted: true, fields: null, sourceModifiedAt: '2026-10-06T13:10:00.000Z' },
    at,
    NOW,
  );
  assert.deepEqual(deleted, { kind: 'delete', revision: 2 });
  const tomb = { ...head, revision: 2, deletedAt: at };
  assert.equal(
    planSourceChange(tomb, { ...r, deleted: true, fields: null }, at, NOW).kind,
    'ignore_delete',
  );
  const restored = planSourceChange(tomb, r, at, NOW);
  assert.ok(restored.kind === 'revise' && restored.restored);
  assert.throws(
    () => planSourceChange(head, r, '2026-10-06T13:00:00.000Z', NOW),
    code('SOURCE_TIME_REGRESSION'),
  );
  assert.throws(
    () => planSourceChange(null, r, '2026-10-07T13:00:00.000Z', NOW),
    code('FUTURE_SOURCE'),
  );
});

test('fixture rules are explicit, fictional and explain their priority', () => {
  assert.equal(stalledOpportunityRule.fictional, true);
  assert.equal(overdueNextStepRule.fictional, true);
  const outcome = stalledOpportunityRule.evaluate({
    opportunity: opportunity(),
    parameters: { inactivityDays: 7 },
    context: null,
    now: NOW,
  });
  assert.ok(outcome.type === 'signal');
  assert.equal(outcome.signal.priority.score, 30);
  assert.match(outcome.signal.priority.reasons[0]!.label, /10 jours/);
  assert.ok(outcome.signal.missingInformation.some((m) => m.includes('Segment')));
  const overdue = overdueNextStepRule.evaluate({
    opportunity: opportunity(
      opportunityFields({
        nextStep: present('Envoyer la proposition'),
        nextStepDueAt: present('2026-09-30T09:00:00.000Z'),
      }),
    ),
    parameters: { graceDays: 2 },
    context: null,
    now: NOW,
  });
  assert.equal(overdue.type, 'signal');
  const unknownDue = overdueNextStepRule.evaluate({
    opportunity: opportunity(
      opportunityFields({ nextStep: present('Appeler'), nextStepDueAt: unavailable }),
    ),
    parameters: { graceDays: 2 },
    context: null,
    now: NOW,
  });
  assert.deepEqual(unknownDue, {
    type: 'abstain',
    reason: 'missing_data',
    detail: 'next_step_due_at',
  });
});

test('doctrine content is validated against rule parameter contracts', () => {
  const specs = parameterSpecs(defaultRules);
  const content = validateDoctrineContent(FIXTURE_DOCTRINE.content, specs);
  assert.equal(content.rules.length, 2);
  assert.throws(
    () =>
      validatePolicy({
        maxSourceAgeHours: 0,
        recommendationLifetimeHours: 1,
        maxOpenRecommendations: 1,
        rejectionCooldownDays: 0,
      }),
    code('INVALID_POLICY'),
  );
  assert.throws(
    () =>
      validateDoctrineContent(
        {
          rules: [{ ruleId: 'unknown', enabled: true, parameters: {} }],
          policy: (FIXTURE_DOCTRINE.content as { policy: unknown }).policy,
        },
        specs,
      ),
    code('INVALID_POLICY'),
  );
  assert.throws(
    () =>
      validateDoctrineContent(
        {
          rules: [
            {
              ruleId: 'fixture.overdue-next-step',
              enabled: true,
              parameters: { graceDays: 1, extra: 3 },
            },
          ],
          policy: (FIXTURE_DOCTRINE.content as { policy: unknown }).policy,
        },
        specs,
      ),
    code('INVALID_POLICY'),
  );
});

test('the pure decision function blocks approval on any evidence doubt', () => {
  const rec = {
    tenantId: 't',
    id: 'r',
    revision: 1,
    contentRevision: 1,
    status: 'pending',
    generatedAt: '2026-10-06T14:00:00.000Z',
    expiresAt: expiresAtFor(NOW, 24),
    fingerprint: 'f',
    maxSourceAgeHours: 24,
  } as unknown as Recommendation;
  const ok = {
    currentFingerprint: 'f',
    dataAsOf: '2026-10-06T13:00:00.000Z',
    connectionActive: true,
    doctrineActive: true,
  };
  const input = { decision: 'approve' as const, expectedRevision: 1, reason: null, quality: null };
  assert.equal(decide(rec, input, ok, 'u', NOW, 'd').next.status, 'approved');
  for (const bad of [
    { currentFingerprint: null },
    { connectionActive: false },
    { doctrineActive: false },
    { dataAsOf: null },
    { dataAsOf: '2026-10-05T13:00:00.000Z' },
  ]) {
    assert.throws(
      () => decide(rec, input, { ...ok, ...bad }, 'u', NOW, 'd'),
      code('STALE_EVIDENCE'),
    );
  }
  assert.equal(
    decide(
      rec,
      { ...input, decision: 'reject' },
      { ...ok, currentFingerprint: null },
      'u',
      NOW,
      'd',
    ).next.status,
    'rejected',
  );
});

test('quality labels follow the decision: useful only with an approval', () => {
  const base = { expectedRevision: 1, reason: null };
  assert.equal(validateDecisionInput({ ...base, decision: 'approve' }).quality, null);
  assert.equal(
    validateDecisionInput({ ...base, decision: 'approve', quality: 'useful' }).quality,
    'useful',
  );
  for (const label of QUALITY_LABELS.filter((l) => l !== 'useful'))
    assert.equal(
      validateDecisionInput({ ...base, decision: 'reject', quality: label }).quality,
      label,
    );
  for (const bad of [
    { decision: 'reject', quality: 'useful' },
    { decision: 'approve', quality: 'duplicate' },
    { decision: 'approve', quality: 'great' },
    { decision: 'reject', quality: 3 },
  ])
    assert.throws(() => validateDecisionInput({ ...base, ...bad }), code('INVALID_DECISION'));
});

test('the quality report only counts what was recorded', () => {
  const at = (h: number) =>
    new Date(Date.parse('2026-10-01T00:00:00.000Z') + h * 3_600_000).toISOString();
  const report = buildQualityReport({
    from: at(0),
    to: at(240),
    now: Date.parse(at(240)),
    recommendations: [
      {
        id: 'a',
        kind: 'define_next_step',
        status: 'approved',
        generatedAt: at(1),
        expiresAt: at(100),
      },
      {
        id: 'b',
        kind: 'define_next_step',
        status: 'rejected',
        generatedAt: at(2),
        expiresAt: at(100),
      },
      {
        id: 'c',
        kind: 'follow_up_overdue_step',
        status: 'pending',
        generatedAt: at(3),
        expiresAt: at(50),
      },
      {
        id: 'd',
        kind: 'follow_up_overdue_step',
        status: 'pending',
        generatedAt: at(4),
        expiresAt: at(400),
      },
    ],
    decisions: [
      {
        recommendationId: 'a',
        kind: 'define_next_step',
        decision: 'approve',
        quality: 'useful',
        decidedAt: at(3),
        generatedAt: at(1),
      },
      {
        recommendationId: 'b',
        kind: 'define_next_step',
        decision: 'reject',
        quality: null,
        decidedAt: at(8),
        generatedAt: at(2),
      },
    ],
    analyses: [],
    truncated: false,
  });
  assert.equal(report.proposals.generated, 4);
  assert.deepEqual(report.proposals.byStatus, { approved: 1, rejected: 1, expired: 1, pending: 1 });
  assert.deepEqual(report.proposals.byKind, { define_next_step: 2, follow_up_overdue_step: 2 });
  assert.equal(report.decisions.approved, 1);
  assert.equal(report.decisions.rejected, 1);
  assert.equal(report.decisions.byQuality.useful, 1);
  assert.equal(report.decisions.byQuality.unlabeled, 1);
  assert.equal(report.decisions.byQuality.duplicate, 0);
  assert.equal(report.decisions.medianHoursToDecision, 4);
  assert.equal(report.latestAnalysis, null);
});
