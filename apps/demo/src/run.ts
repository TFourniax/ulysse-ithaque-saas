/**
 * Offline demo: fictional CRM records → background analysis → explained proposal
 * → human decision → audit trail. In-memory only; no external action, no network.
 */
import {
  AnalysisService,
  CompanyContextService,
  ConnectionService,
  defaultRules,
  DoctrineService,
  fixedClock,
  IngestionService,
  QueryService,
  ReviewService,
} from '@ulysse/domain';
import { MemoryUnitOfWork, randomIds } from '@ulysse/domain/memory';
import {
  FIXTURE_CONTEXT,
  FIXTURE_DOCTRINE,
  fixtureCatalog,
  record,
  serviceContext,
  userContext,
} from '@ulysse/domain/testing';

const tenantId = '0b3c1f9e-2d4a-4c5b-8e6f-000000000001';
const ownerId = '0b3c1f9e-2d4a-4c5b-8e6f-0000000000a1';
const reviewerId = '0b3c1f9e-2d4a-4c5b-8e6f-0000000000a2';
const owner = userContext(tenantId, ownerId, 'owner', 'demo');
const reviewer = userContext(tenantId, reviewerId, 'reviewer', 'demo');
const worker = serviceContext(tenantId);
const deps = {
  uow: new MemoryUnitOfWork(),
  clock: fixedClock('2026-10-06T14:00:00.000Z'),
  ids: randomIds,
  rules: defaultRules,
};

const doctrines = new DoctrineService(deps);
const doctrine = await doctrines.draft(owner, FIXTURE_DOCTRINE);
await doctrines.validate(owner, doctrine.id, 'Validation fictive pour la démonstration.');
await new CompanyContextService(deps).update(owner, {
  content: FIXTURE_CONTEXT,
  source: 'fixture',
});
const connection = await new ConnectionService(deps, fixtureCatalog).create(owner, {
  provider: 'fixture-crm',
  displayName: 'CRM fictif',
  config: { dataset: 'demo' },
});

const ingestion = new IngestionService(deps);
const run = await ingestion.start(worker, connection.id, 'initial');
await ingestion.applyPage(worker, run.run.id, {
  records: [
    record('fictional-opportunity-001'),
    record('fictional-opportunity-002', { stage: 'won' }),
  ],
  rejectedByConnector: 0,
  cursorAfter: 'fixture-watermark',
  complete: true,
});
const analysis = await new AnalysisService(deps).run(worker, 'source_change');
const queries = new QueryService(deps);
const [proposal] = (await queries.listRecommendations(reviewer, { view: 'open' })).items;
if (!proposal) throw new Error('Fixture did not generate a recommendation.');
const decision = await new ReviewService(deps).decide(
  reviewer,
  proposal.id,
  { decision: 'approve', expectedRevision: proposal.revision, reason: null },
  'fictional-human-review-001',
);
const detail = await queries.getRecommendation(reviewer, proposal.id);

process.stdout.write(
  JSON.stringify(
    {
      mode: 'offline-demo',
      doctrine: `${doctrine.title} — fictional rule set, not validated business doctrine.`,
      analysis: { generated: analysis.generated, abstentions: analysis.abstentions },
      recommendation: {
        title: detail.recommendation.title,
        whyNow: detail.recommendation.whyNow,
        priority: detail.recommendation.priority,
        missingInformation: detail.recommendation.missingInformation,
        evidence: detail.evidence.map((e) => ({
          fact: e.label,
          state: e.state,
          value: e.value,
          sourceRevision: e.sourceRevision,
          observedAt: e.observedAt,
        })),
      },
      humanDecision: {
        status: decision.recommendation.status,
        decision: decision.decision.decision,
        actorId: decision.decision.actorId,
      },
      audit: detail.history.map((e) => `${e.eventType} by ${e.actorType}:${e.actorId}`),
      externalActions: 0,
      limitations:
        'In-memory adapter only. The SaaS stack (PostgreSQL, API, worker, web) is documented in README.',
    },
    null,
    2,
  ) + '\n',
);
