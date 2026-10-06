import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DomainError, InMemoryWorkflow } from '../src/workflow.ts';
import type { Context, Deal } from '../src/workflow.ts';

const NOW = '2026-10-06T14:00:00.000Z';
const A: Context = { tenantId: 'demo-a', actorId: 'reviewer-a', role: 'reviewer' };
const B: Context = { tenantId: 'demo-b', actorId: 'reviewer-b', role: 'reviewer' };
function deal(overrides: Partial<Deal> = {}): Deal {
  return {
    tenantId: A.tenantId, sourceId: 'fictional-crm', sourceVersion: 1,
    externalId: 'deal-1', stage: 'open',
    lastInteractionAt: '2026-09-26T14:00:00.000Z', nextStep: null,
    observedAt: '2026-10-06T13:30:00.000Z', ...overrides
  };
}
function expectError(fn: () => unknown, code: string): void {
  assert.throws(fn, (err: unknown) => err instanceof DomainError && err.code === code);
}
function ready(): { workflow: InMemoryWorkflow; id: string } {
  const workflow = new InMemoryWorkflow();
  workflow.ingest(A, deal(), NOW);
  return { workflow, id: workflow.generate(A, NOW)[0]!.id };
}
function request(id: string) {
  return { recommendationId: id, expectedRevision: 1, decision: 'approve' as const, idempotencyKey: 'review-1' };
}
test('CRM evidence generates an explained recommendation without a question', () => {
  const { workflow, id } = ready();
  const rec = workflow.list(A)[0]!;
  assert.equal(rec.id, id);
  assert.equal(rec.status, 'pending');
  assert.equal(rec.sourceVersion, 1);
  assert.equal(rec.ruleVersion, 'demo-next-step-v1');
  assert.match(rec.explanation, /10 jours/);
  assert.equal(rec.observedAt, deal().observedAt);
});
test('replaying ingestion and generation does not duplicate records or audit events', () => {
  const { workflow } = ready();
  workflow.ingest(A, deal(), NOW);
  workflow.generate(A, NOW);
  assert.equal(workflow.list(A).length, 1);
  assert.deepEqual(workflow.audit(A).map(event => event.event), ['source.ingested', 'recommendation.generated']);
});
test('identical external IDs across tenants remain isolated', () => {
  const { workflow, id } = ready();
  workflow.ingest(B, deal({ tenantId: B.tenantId }), NOW);
  const other = workflow.generate(B, NOW)[0]!;
  assert.notEqual(other.id, id);
  assert.equal(workflow.list(B).length, 1);
  expectError(() => workflow.decide(B, request(id), NOW), 'NOT_FOUND');
  assert.ok(workflow.audit(B).every(event => event.tenantId === B.tenantId));
});
test('cross tenant input is rejected before persistence', () => {
  const workflow = new InMemoryWorkflow();
  expectError(() => workflow.ingest(B, deal(), NOW), 'TENANT_MISMATCH');
  assert.equal(workflow.audit(A).length, 0);
  assert.equal(workflow.audit(B).length, 0);
});
test('a viewer can inspect their tenant but cannot ingest, generate or decide', () => {
  const { workflow, id } = ready();
  const viewer = { ...A, role: 'viewer' as const };
  assert.equal(workflow.list(viewer).length, 1);
  expectError(() => workflow.ingest(viewer, deal(), NOW), 'FORBIDDEN');
  expectError(() => workflow.generate(viewer, NOW), 'FORBIDDEN');
  expectError(() => workflow.decide(viewer, request(id), NOW), 'FORBIDDEN');
});
test('closed deals, recent interactions and defined next steps do not create noise', () => {
  const workflow = new InMemoryWorkflow();
  workflow.ingest(A, deal({ externalId: 'won', stage: 'won' }), NOW);
  workflow.ingest(A, deal({ externalId: 'lost', stage: 'lost' }), NOW);
  workflow.ingest(A, deal({ externalId: 'recent', lastInteractionAt: '2026-10-05T14:00:00.000Z' }), NOW);
  workflow.ingest(A, deal({ externalId: 'planned', nextStep: 'Appeler jeudi' }), NOW);
  assert.equal(workflow.generate(A, NOW).length, 0);
});
test('stale or future source evidence cannot generate a recommendation', () => {
  const workflow = new InMemoryWorkflow();
  workflow.ingest(A, deal({ observedAt: '2026-10-04T13:30:00.000Z' }), NOW);
  assert.equal(workflow.generate(A, NOW).length, 0);
  expectError(() => workflow.ingest(A, deal({ sourceVersion: 2, observedAt: '2026-10-07T13:30:00.000Z' }), NOW), 'FUTURE_SOURCE');
});
test('source versions are monotonic and same version with different facts is rejected', () => {
  const workflow = new InMemoryWorkflow();
  workflow.ingest(A, deal({ sourceVersion: 2 }), NOW);
  expectError(() => workflow.ingest(A, deal(), NOW), 'SOURCE_VERSION_REGRESSION');
  expectError(() => workflow.ingest(A, deal({ sourceVersion: 2, stage: 'won' }), NOW), 'SOURCE_VERSION_CONFLICT');
});
test('source observed time must not regress on a newer version', () => {
  const workflow = new InMemoryWorkflow();
  workflow.ingest(A, deal(), NOW);
  expectError(() => workflow.ingest(A, deal({ sourceVersion: 2, observedAt: '2026-10-06T13:00:00.000Z' }), NOW), 'SOURCE_TIME_REGRESSION');
});
test('human approval changes status and appends one attributed audit event', () => {
  const { workflow, id } = ready();
  const result = workflow.decide(A, request(id), NOW);
  assert.equal(result.status, 'approved');
  assert.equal(result.revision, 2);
  assert.equal(workflow.audit(A).at(-1)!.actorId, A.actorId);
  assert.equal(workflow.audit(A).at(-1)!.event, 'recommendation.approved');
  assert.equal('execute' in workflow, false);
});
test('retried human approval returns same receipt without duplicate audit', () => {
  const { workflow, id } = ready();
  const first = workflow.decide(A, request(id), NOW);
  const retry = workflow.decide(A, request(id), '2026-10-07T14:00:00.000Z');
  assert.deepEqual(first, retry);
  assert.equal(workflow.audit(A).length, 3);
});
test('reusing an idempotency key for a different intent is rejected', () => {
  const { workflow, id } = ready();
  workflow.decide(A, request(id), NOW);
  expectError(() => workflow.decide(A, { ...request(id), decision: 'reject' }, NOW), 'IDEMPOTENCY_CONFLICT');
});
test('competing decisions with a stale revision are rejected', () => {
  const { workflow, id } = ready();
  workflow.decide(A, request(id), NOW);
  expectError(() => workflow.decide({ ...A, actorId: 'second-reviewer' }, { ...request(id), decision: 'reject' }, NOW), 'REVISION_CONFLICT');
});
test('a fresh revision cannot reverse an already recorded decision', () => {
  const { workflow, id } = ready();
  workflow.decide(A, request(id), NOW);
  expectError(() => workflow.decide(A, { ...request(id), expectedRevision: 2, decision: 'reject', idempotencyKey: 'new' }, NOW), 'ALREADY_DECIDED');
});
test('approval expires while rejection remains possible', () => {
  const { workflow, id } = ready();
  const later = '2026-10-07T14:00:00.000Z';
  expectError(() => workflow.decide(A, request(id), later), 'EXPIRED');
  assert.equal(workflow.decide(A, { ...request(id), decision: 'reject' }, later).status, 'rejected');
});
test('approval detects changed source evidence even when recommendation has not expired', () => {
  const { workflow, id } = ready();
  workflow.ingest(A, deal({ sourceVersion: 2, stage: 'won' }), NOW);
  expectError(() => workflow.decide(A, request(id), NOW), 'STALE_EVIDENCE');
});
test('approval detects source freshness independently from recommendation TTL', () => {
  const workflow = new InMemoryWorkflow({ inactivityDays: 7, maxSourceAgeHours: 1, recommendationLifetimeHours: 24 });
  workflow.ingest(A, deal(), NOW);
  const id = workflow.generate(A, NOW)[0]!.id;
  expectError(() => workflow.decide(A, request(id), '2026-10-06T15:00:00.000Z'), 'STALE_EVIDENCE');
});
test('snapshots cannot mutate internal records or audit history', () => {
  const { workflow } = ready();
  const list = workflow.list(A);
  (list[0] as { status: string }).status = 'approved';
  const audit = workflow.audit(A);
  (audit[0] as { actorId: string }).actorId = 'spoofed';
  assert.equal(workflow.list(A)[0]!.status, 'pending');
  assert.equal(workflow.audit(A)[0]!.actorId, A.actorId);
});
test('input projection drops unknown raw content fields and avoids logging source text', () => {
  const workflow = new InMemoryWorkflow();
  const input = { ...deal(), privateEmailBody: 'PRIVATE', token: 'SECRET' };
  const saved = workflow.ingest(A, input, NOW);
  assert.equal('token' in saved, false);
  assert.equal('privateEmailBody' in saved, false);
  assert.doesNotMatch(JSON.stringify(workflow.audit(A)), /PRIVATE|SECRET/);
});
test('malformed IDs, invalid roles, timestamps, versions and decisions fail closed', () => {
  const workflow = new InMemoryWorkflow();
  expectError(() => workflow.list({ ...A, tenantId: '' }), 'INVALID_CONTEXT');
  expectError(() => workflow.list({ ...A, role: 'admin' as never }), 'INVALID_ROLE');
  expectError(() => workflow.ingest(A, deal({ sourceVersion: NaN }), NOW), 'INVALID_VERSION');
  expectError(() => workflow.ingest(A, deal({ observedAt: 'yesterday' }), NOW), 'INVALID_TIMESTAMP');
  expectError(() => workflow.ingest(A, deal({ observedAt: '2026-02-30T14:00:00.000Z' }), NOW), 'INVALID_TIMESTAMP');
  const { workflow: readyWorkflow, id } = ready();
  expectError(() => readyWorkflow.decide(A, { ...request(id), decision: 'execute' as never }, NOW), 'INVALID_DECISION');
});
test('decision timestamps cannot precede recommendation creation', () => {
  const { workflow, id } = ready();
  expectError(() => workflow.decide(A, request(id), '2026-10-06T13:59:00.000Z'), 'INVALID_TIMELINE');
});
test('configuration is validated and copied on construction', () => {
  expectError(() => new InMemoryWorkflow({ inactivityDays: 0, maxSourceAgeHours: 24, recommendationLifetimeHours: 24 }), 'INVALID_POLICY');
  const policy = { inactivityDays: 7, maxSourceAgeHours: 24, recommendationLifetimeHours: 24 };
  const workflow = new InMemoryWorkflow(policy);
  policy.inactivityDays = 100;
  workflow.ingest(A, deal(), NOW);
  assert.equal(workflow.generate(A, NOW).length, 1);
});
