import { InMemoryWorkflow } from '../../packages/domain/src/workflow.ts';
import type { Context } from '../../packages/domain/src/workflow.ts';

const now = '2026-10-06T14:00:00.000Z';
const worker: Context = { tenantId: 'fictional-company', actorId: 'offline-fixture-worker', role: 'owner' };
const reviewer: Context = { ...worker, actorId: 'fictional-human-reviewer', role: 'reviewer' };
const workflow = new InMemoryWorkflow();
workflow.ingest(worker, {
  tenantId: worker.tenantId, sourceId: 'fictional-crm', sourceVersion: 1,
  externalId: 'fictional-opportunity-001', stage: 'open', nextStep: null,
  lastInteractionAt: '2026-09-26T14:00:00.000Z', observedAt: '2026-10-06T13:30:00.000Z'
}, now);
const [recommendation] = workflow.generate(worker, now);
if (!recommendation) throw new Error('Fixture did not generate a recommendation.');
const decision = workflow.decide(reviewer, {
  recommendationId: recommendation.id,
  decision: 'approve', expectedRevision: recommendation.revision,
  idempotencyKey: 'fictional-human-review-001'
}, now);
console.log(JSON.stringify({
  mode: 'offline-demo',
  doctrine: 'Fictional test rule; not validated business doctrine.',
  recommendation, humanDecision: decision, audit: workflow.audit(reviewer),
  externalActions: 0,
  limitations: 'In-memory only; no UI, production authentication, persistence, scheduler or live connector.'
}, null, 2));
