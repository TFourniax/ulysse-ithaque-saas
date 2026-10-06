/**
 * Adapter contract scenarios. The same business scenarios run against the
 * in-memory adapter (fast) and the PostgreSQL adapter (real transactions, RLS,
 * application role) to prove both behave identically.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { Context, Role } from '../context.ts';
import { DomainError } from '../errors.ts';
import type { NormalizedRecord } from '../opportunity.ts';
import { present, unavailable } from '../opportunity.ts';
import type { UnitOfWork } from '../ports.ts';
import type { OutboxEvent } from '../records.ts';
import { defaultRules } from '../rules.ts';
import { AnalysisService } from '../services/analysis-service.ts';
import { ConnectionService } from '../services/connections.ts';
import { FormulationService } from '../services/formulation.ts';
import { CompanyContextService, DoctrineService, MemberService } from '../services/governance.ts';
import { IngestionService } from '../services/ingestion.ts';
import { MaintenanceService } from '../services/maintenance.ts';
import { QueryService } from '../services/queries.ts';
import { ReviewService } from '../services/review.ts';
import type { ServiceDeps } from '../services/shared.ts';
import type { fixedClock } from '../time.ts';
import { HOUR_MS } from '../time.ts';
import {
  FIXTURE_CONTEXT,
  FIXTURE_DOCTRINE,
  fixtureCatalog,
  record,
  serviceContext,
  tombstone,
  userContext,
} from './fixtures.ts';

export const SCENARIO_START = '2026-10-06T14:00:00.000Z';

export type Harness = Readonly<{
  uow: UnitOfWork;
  clock: ReturnType<typeof fixedClock>;
  /** Creates a tenant and returns its id. */
  createTenant(name: string): Promise<string>;
  /** Creates a user with an active membership; returns the user id. */
  addMember(tenantId: string, role: Role, displayName: string): Promise<string>;
  outbox(tenantId: string): Promise<OutboxEvent[]>;
  close(): Promise<void>;
}>;

function expectCode(code: string): (error: unknown) => boolean {
  return (error: unknown) => {
    assert.ok(error instanceof DomainError, `expected DomainError ${code}, got ${String(error)}`);
    assert.equal(error.code, code);
    return true;
  };
}

export function defineWorkflowScenarios(
  adapterName: string,
  makeHarness: () => Promise<Harness>,
): void {
  describe(`workflow scenarios (${adapterName})`, () => {
    let h: Harness;
    before(async () => {
      h = await makeHarness();
    });
    after(async () => {
      await h.close();
    });

    async function world(name = 'A') {
      h.clock.set(SCENARIO_START);
      const tenantId = await h.createTenant(`Entreprise fictive ${name}`);
      const ownerId = await h.addMember(tenantId, 'owner', `Owner ${name}`);
      const reviewerId = await h.addMember(tenantId, 'reviewer', `Reviewer ${name}`);
      const viewerId = await h.addMember(tenantId, 'viewer', `Viewer ${name}`);
      const owner = userContext(tenantId, ownerId, 'owner');
      const reviewer = userContext(tenantId, reviewerId, 'reviewer');
      const viewer = userContext(tenantId, viewerId, 'viewer');
      const deps: ServiceDeps = {
        uow: h.uow,
        clock: h.clock,
        ids: { next: () => crypto.randomUUID() },
        rules: defaultRules,
      };
      const services = {
        review: new ReviewService(deps),
        ingestion: new IngestionService(deps),
        analysis: new AnalysisService(deps),
        maintenance: new MaintenanceService(deps),
        connections: new ConnectionService(deps, fixtureCatalog),
        doctrines: new DoctrineService(deps),
        context: new CompanyContextService(deps),
        members: new MemberService(deps),
        queries: new QueryService(deps),
        formulation: new FormulationService(deps),
      };
      const doctrine = await services.doctrines.draft(owner, FIXTURE_DOCTRINE);
      await services.doctrines.validate(owner, doctrine.id, 'Validation fictive pour les tests.');
      await services.context.update(owner, { content: FIXTURE_CONTEXT, source: 'fixture' });
      const connection = await services.connections.create(owner, {
        provider: 'fixture-crm',
        displayName: 'CRM fictif',
        config: { dataset: 'demo' },
      });
      const worker = serviceContext(tenantId);
      async function sync(
        records: readonly NormalizedRecord[],
        options: {
          trigger?: 'initial' | 'scheduled' | 'manual' | 'replay';
          complete?: boolean;
        } = {},
      ) {
        const started = await services.ingestion.start(
          worker,
          connection.id,
          options.trigger ?? 'scheduled',
        );
        return services.ingestion.applyPage(worker, started.run.id, {
          records,
          rejectedByConnector: 0,
          cursorAfter: `cursor-${records.length}`,
          complete: options.complete ?? true,
        });
      }
      const analyze = () => services.analysis.run(worker, 'source_change');
      const open = async (ctx: Context = reviewer) =>
        (await services.queries.listRecommendations(ctx, { view: 'open' })).items;
      const auditTypes = async () =>
        (await services.queries.listAudit(owner, { limit: 100 })).items.map((e) => e.eventType);
      return {
        tenantId,
        owner,
        reviewer,
        viewer,
        worker,
        services,
        connection,
        doctrine,
        sync,
        analyze,
        open,
        auditTypes,
        ids: { ownerId, reviewerId, viewerId },
      };
    }

    function decision(id: string, revision = 1, kind: 'approve' | 'reject' = 'approve') {
      return { id, input: { decision: kind, expectedRevision: revision, reason: null } };
    }

    test('background facts produce an explained, sourced recommendation without any question', async () => {
      const w = await world();
      await w.sync([record('deal-1')]);
      const analysis = await w.analyze();
      assert.equal(analysis.generated, 1);
      const [rec] = await w.open();
      assert.ok(rec);
      assert.equal(rec.status, 'pending');
      assert.equal(rec.kind, 'define_next_step');
      assert.equal(rec.doctrine.fictional, true);
      assert.match(rec.whyNow, /10 jours/);
      assert.equal(rec.dataAsOf, SCENARIO_START);
      const detail = await w.services.queries.getRecommendation(w.viewer, rec.id);
      assert.equal(detail.evidenceState, 'current');
      const material = detail.evidence
        .filter((e) => e.material)
        .map((e) => e.factType)
        .sort();
      assert.deepEqual(material, ['last_interaction_at', 'next_step', 'stage']);
      assert.ok(
        detail.evidence.every((e) => e.sourceRevision === 1 && e.connectionId === w.connection.id),
      );
      assert.equal(detail.revisions.length, 1);
    });

    test('replaying ingestion and analysis creates no duplicate recommendation or audit event', async () => {
      const w = await world();
      await w.sync([record('deal-1')]);
      await w.analyze();
      const before = await w.auditTypes();
      await w.sync([record('deal-1')]);
      const second = await w.analyze();
      assert.equal(second.generated, 0);
      assert.equal(second.unchanged, 1);
      assert.equal((await w.open()).length, 1);
      const afterTypes = await w.auditTypes();
      assert.equal(afterTypes.filter((t) => t === 'recommendation.generated').length, 1);
      assert.equal(
        afterTypes.length,
        before.length + 1,
        'only the second source.synced summary is added',
      );
    });

    test('metadata-only source changes do not re-post the same signal', async () => {
      const w = await world();
      await w.sync([record('deal-1', {}, { providerVersion: 'v1', etag: 'e1' })]);
      await w.analyze();
      h.clock.advance(HOUR_MS);
      await w.sync([
        record(
          'deal-1',
          {},
          { providerVersion: 'v2', etag: 'e2', sourceModifiedAt: '2026-10-06T14:30:00.000Z' },
        ),
      ]);
      const second = await w.analyze();
      assert.equal(second.generated, 0);
      assert.equal((await w.open()).length, 1);
    });

    test('identical external IDs in two tenants stay isolated', async () => {
      const a = await world('A');
      const b = await world('B');
      await a.sync([record('deal-1')]);
      await b.sync([record('deal-1')]);
      await a.analyze();
      await b.analyze();
      const [recA] = await a.open();
      const [recB] = await b.open();
      assert.ok(recA && recB);
      assert.notEqual(recA.id, recB.id);
      await assert.rejects(
        b.services.queries.getRecommendation(b.reviewer, recA.id),
        expectCode('NOT_FOUND'),
      );
      const d = decision(recA.id);
      await assert.rejects(
        b.services.review.decide(b.reviewer, d.id, d.input, 'retry-key-0001'),
        expectCode('NOT_FOUND'),
      );
      const auditB = await b.services.queries.listAudit(b.owner, { limit: 100 });
      assert.ok(auditB.items.every((e) => e.tenantId === b.tenantId));
      assert.ok(!auditB.items.some((e) => e.resourceId === recA.id));
    });

    test('a worker identity of tenant B cannot write into a sync run of tenant A', async () => {
      const a = await world('A');
      const b = await world('B');
      const started = await a.services.ingestion.start(a.worker, a.connection.id, 'scheduled');
      await assert.rejects(
        b.services.ingestion.applyPage(b.worker, started.run.id, {
          records: [record('x')],
          rejectedByConnector: 0,
          cursorAfter: null,
          complete: true,
        }),
        expectCode('NOT_FOUND'),
      );
      await assert.rejects(
        b.services.ingestion.start(b.worker, a.connection.id, 'manual'),
        expectCode('NOT_FOUND'),
      );
    });

    test('viewers read but cannot decide or revise; people cannot impersonate the ingestion worker', async () => {
      const w = await world();
      await w.sync([record('deal-1')]);
      await w.analyze();
      const [rec] = await w.open(w.viewer);
      assert.ok(rec);
      const d = decision(rec.id);
      await assert.rejects(
        w.services.review.decide(w.viewer, d.id, d.input, 'viewer-key-0001'),
        expectCode('FORBIDDEN'),
      );
      await assert.rejects(
        w.services.review.revise(
          w.viewer,
          rec.id,
          { expectedRevision: 1, proposedAction: 'x', note: null, submit: true },
          'viewer-key-0002',
        ),
        expectCode('FORBIDDEN'),
      );
      await assert.rejects(
        w.services.ingestion.start(w.owner, w.connection.id, 'manual'),
        expectCode('FORBIDDEN'),
      );
      await assert.rejects(w.services.analysis.run(w.owner, 'manual'), expectCode('FORBIDDEN'));
      await assert.rejects(w.services.queries.listAudit(w.viewer, {}), expectCode('FORBIDDEN'));
    });

    test('closed deals, recent interactions and planned next steps produce no noise', async () => {
      const w = await world();
      await w.sync([
        record('won', { stage: 'won' }),
        record('lost', { stage: 'lost' }),
        record('recent', { lastInteractionAt: present('2026-10-05T14:00:00.000Z') }),
        record('planned', {
          nextStep: present('Appeler jeudi'),
          nextStepDueAt: present('2026-10-09T09:00:00.000Z'),
        }),
      ]);
      const analysis = await w.analyze();
      assert.equal(analysis.generated, 0);
      assert.equal(analysis.evaluated, 4);
    });

    test('unavailable fields lead to an explicit abstention, never to a guess', async () => {
      const w = await world();
      await w.sync([record('unknown-activity', { lastInteractionAt: unavailable })]);
      const analysis = await w.analyze();
      assert.equal(analysis.generated, 0);
      assert.equal(analysis.abstentions.missing_data, 1);
    });

    test('stale sources abstain; future-dated or conflicting records are rejected', async () => {
      const w = await world();
      await w.sync([record('deal-1')]);
      h.clock.advance(25 * HOUR_MS);
      const analysis = await w.analyze();
      assert.equal(analysis.generated, 0);
      assert.equal(analysis.abstentions.stale_source, 1);
      const run = await w.sync([
        record('future', {}, { sourceModifiedAt: '2026-10-09T00:00:00.000Z' }),
        record('deal-1', { name: 'changed' }, { providerVersion: 'same' }),
      ]);
      assert.equal(run.rejected, 1);
      await w.sync([record('deal-2', {}, { providerVersion: 'p1' })]);
      const conflict = await w.sync([
        record('deal-2', { name: 'Autre contenu' }, { providerVersion: 'p1' }),
      ]);
      assert.equal(conflict.rejected, 1);
    });

    test('out-of-order pages are ignored instead of regressing a newer source version', async () => {
      const w = await world();
      await w.sync([
        record('deal-1', { stage: 'won' }, { sourceModifiedAt: '2026-10-06T13:00:00.000Z' }),
      ]);
      const run = await w.sync([
        record('deal-1', { stage: 'open' }, { sourceModifiedAt: '2026-10-05T13:00:00.000Z' }),
      ]);
      assert.equal(run.stale, 1);
      assert.equal((await w.analyze()).generated, 0);
    });

    test('approval records an attributed decision and one audit event, without any external action', async () => {
      const w = await world();
      await w.sync([record('deal-1')]);
      await w.analyze();
      const [rec] = await w.open();
      assert.ok(rec);
      const d = decision(rec.id);
      const result = await w.services.review.decide(w.reviewer, d.id, d.input, 'approve-key-0001');
      assert.equal(result.replayed, false);
      assert.equal(result.recommendation.status, 'approved');
      assert.equal(result.recommendation.revision, 2);
      assert.equal(result.decision.actorId, w.ids.reviewerId);
      const types = await w.auditTypes();
      assert.equal(types.filter((t) => t === 'recommendation.approved').length, 1);
      assert.equal('execute' in w.services.review, false);
      const outbox = await h.outbox(w.tenantId);
      assert.ok(
        outbox.some((e) => e.eventType === 'recommendation.decided' && e.subjectId === rec.id),
      );
      const detail = await w.services.queries.getRecommendation(w.viewer, rec.id);
      assert.equal(detail.decisions.length, 1);
      assert.ok(
        detail.history.some(
          (e) => e.eventType === 'recommendation.approved' && e.actorId === w.ids.reviewerId,
        ),
      );
    });

    test('a retried decision returns the stored result without a second audit event', async () => {
      const w = await world();
      await w.sync([record('deal-1')]);
      await w.analyze();
      const [rec] = await w.open();
      assert.ok(rec);
      const d = decision(rec.id);
      const first = await w.services.review.decide(w.reviewer, d.id, d.input, 'retry-key-0001');
      h.clock.advance(48 * HOUR_MS);
      const retry = await w.services.review.decide(w.reviewer, d.id, d.input, 'retry-key-0001');
      assert.equal(retry.replayed, true);
      assert.deepEqual(retry.recommendation, first.recommendation);
      assert.deepEqual(retry.decision, first.decision);
      assert.equal((await w.auditTypes()).filter((t) => t === 'recommendation.approved').length, 1);
    });

    test('concurrent identical retries produce one decision', async () => {
      const w = await world();
      await w.sync([record('deal-1')]);
      await w.analyze();
      const [rec] = await w.open();
      assert.ok(rec);
      const d = decision(rec.id);
      const results = await Promise.all(
        [1, 2, 3].map(() => w.services.review.decide(w.reviewer, d.id, d.input, 'same-key-00001')),
      );
      assert.equal(results.filter((r) => !r.replayed).length, 1);
      assert.equal(new Set(results.map((r) => r.decision.id)).size, 1);
      assert.equal((await w.auditTypes()).filter((t) => t === 'recommendation.approved').length, 1);
    });

    test('reusing an idempotency key for a different intent is rejected', async () => {
      const w = await world();
      await w.sync([record('deal-1')]);
      await w.analyze();
      const [rec] = await w.open();
      assert.ok(rec);
      const d = decision(rec.id);
      await w.services.review.decide(w.reviewer, d.id, d.input, 'key-intent-0001');
      await assert.rejects(
        w.services.review.decide(
          w.reviewer,
          d.id,
          { ...d.input, decision: 'reject' },
          'key-intent-0001',
        ),
        expectCode('IDEMPOTENCY_CONFLICT'),
      );
    });

    test('two concurrent reviewers: exactly one decision wins, the other gets a conflict', async () => {
      const w = await world();
      const second = userContext(
        w.tenantId,
        await h.addMember(w.tenantId, 'reviewer', 'Second reviewer'),
        'reviewer',
      );
      await w.sync([record('deal-1')]);
      await w.analyze();
      const [rec] = await w.open();
      assert.ok(rec);
      const results = await Promise.allSettled([
        w.services.review.decide(
          w.reviewer,
          rec.id,
          { decision: 'approve', expectedRevision: 1, reason: null },
          'reviewer-1-key',
        ),
        w.services.review.decide(
          second,
          rec.id,
          { decision: 'reject', expectedRevision: 1, reason: 'Pas prioritaire' },
          'reviewer-2-key',
        ),
      ]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      assert.equal(fulfilled.length, 1);
      assert.equal(rejected.length, 1);
      assert.ok(
        rejected[0]?.reason instanceof DomainError &&
          rejected[0].reason.code === 'REVISION_CONFLICT',
      );
      const detail = await w.services.queries.getRecommendation(w.reviewer, rec.id);
      assert.equal(detail.decisions.length, 1);
    });

    test('a decided recommendation cannot be reversed with a fresh revision', async () => {
      const w = await world();
      await w.sync([record('deal-1')]);
      await w.analyze();
      const [rec] = await w.open();
      assert.ok(rec);
      await w.services.review.decide(
        w.reviewer,
        rec.id,
        { decision: 'approve', expectedRevision: 1, reason: null },
        'first-key-0001',
      );
      await assert.rejects(
        w.services.review.decide(
          w.reviewer,
          rec.id,
          { decision: 'reject', expectedRevision: 2, reason: null },
          'second-key-0001',
        ),
        expectCode('ALREADY_DECIDED'),
      );
    });

    test('approval expires with the TTL while rejection stays possible; maintenance persists expiry', async () => {
      const w = await world();
      await w.sync([record('deal-1')]);
      await w.analyze();
      const [rec] = await w.open();
      assert.ok(rec);
      h.clock.advance(73 * HOUR_MS);
      await assert.rejects(
        w.services.review.decide(
          w.reviewer,
          rec.id,
          { decision: 'approve', expectedRevision: 1, reason: null },
          'late-approve-01',
        ),
        expectCode('EXPIRED'),
      );
      assert.equal(
        (await w.open()).length,
        0,
        'expired recommendations leave the open list before maintenance runs',
      );
      const rejected = await w.services.review.decide(
        w.reviewer,
        rec.id,
        { decision: 'reject', expectedRevision: 1, reason: 'Trop tard' },
        'late-reject-01',
      );
      assert.equal(rejected.recommendation.status, 'rejected');

      const other = await world('TTL');
      await other.sync([record('deal-2')]);
      await other.analyze();
      h.clock.advance(73 * HOUR_MS);
      assert.deepEqual(await other.services.maintenance.expireDue(other.worker), { expired: 1 });
      const closed = await other.services.queries.listRecommendations(other.reviewer, {
        view: 'closed',
      });
      const expiredRec = closed.items[0];
      assert.ok(expiredRec);
      assert.equal(expiredRec.status, 'expired');
      assert.equal(expiredRec.closedReason, 'ttl');
    });

    test('approval is blocked when the source changed after generation', async () => {
      const w = await world();
      await w.sync([record('deal-1')]);
      await w.analyze();
      const [rec] = await w.open();
      assert.ok(rec);
      await w.sync([
        record('deal-1', { stage: 'won' }, { sourceModifiedAt: '2026-10-06T13:45:00.000Z' }),
      ]);
      const detail = await w.services.queries.getRecommendation(w.reviewer, rec.id);
      assert.equal(detail.evidenceState, 'changed');
      await assert.rejects(
        w.services.review.decide(
          w.reviewer,
          rec.id,
          { decision: 'approve', expectedRevision: 1, reason: null },
          'changed-key-001',
        ),
        expectCode('STALE_EVIDENCE'),
      );
    });

    test('approval checks source freshness independently from the TTL', async () => {
      const w = await world();
      await w.sync([record('deal-1')]);
      await w.analyze();
      const [rec] = await w.open();
      assert.ok(rec);
      h.clock.advance(25 * HOUR_MS);
      await assert.rejects(
        w.services.review.decide(
          w.reviewer,
          rec.id,
          { decision: 'approve', expectedRevision: 1, reason: null },
          'fresh-key-0001',
        ),
        expectCode('STALE_EVIDENCE'),
      );
      await w.sync([record('deal-1')]);
      const ok = await w.services.review.decide(
        w.reviewer,
        rec.id,
        { decision: 'approve', expectedRevision: 1, reason: null },
        'fresh-key-0002',
      );
      assert.equal(ok.recommendation.status, 'approved');
    });

    test('a material change supersedes the pending proposal and links both', async () => {
      const w = await world();
      await w.sync([record('deal-1')]);
      await w.analyze();
      const [first] = await w.open();
      assert.ok(first);
      await w.sync([
        record(
          'deal-1',
          { lastInteractionAt: present('2026-09-20T10:00:00.000Z') },
          { sourceModifiedAt: '2026-10-06T13:50:00.000Z' },
        ),
      ]);
      const analysis = await w.analyze();
      assert.equal(analysis.generated, 1);
      assert.equal(analysis.closed, 1);
      const [second] = await w.open();
      assert.ok(second);
      assert.equal(second.supersedesId, first.id);
      const old = await w.services.queries.getRecommendation(w.reviewer, first.id);
      assert.equal(old.recommendation.status, 'superseded');
      assert.equal(old.recommendation.supersededById, second.id);
      assert.equal(old.recommendation.closedReason, 'evidence_changed');
    });

    test('resolved signals and deleted sources close open proposals with an explicit reason', async () => {
      const w = await world();
      await w.sync([record('deal-1'), record('deal-2')]);
      await w.analyze();
      assert.equal((await w.open()).length, 2);
      await w.sync([
        record(
          'deal-1',
          { nextStep: present('Rendez-vous planifié') },
          { sourceModifiedAt: '2026-10-06T13:40:00.000Z' },
        ),
        tombstone('deal-2'),
      ]);
      await w.analyze();
      assert.equal((await w.open()).length, 0);
      const closed = await w.services.queries.listRecommendations(w.reviewer, { view: 'closed' });
      const reasons = closed.items.map((r) => r.closedReason).sort();
      assert.deepEqual(reasons, ['signal_resolved', 'source_deleted']);
      const opportunities = await w.services.queries.listOpportunities(w.viewer, {});
      assert.equal(opportunities.items.length, 1);
    });

    test('a decided proposal is not re-published when the same evidence is analyzed again', async () => {
      const w = await world();
      await w.sync([record('deal-1')]);
      await w.analyze();
      const [rec] = await w.open();
      assert.ok(rec);
      await w.services.review.decide(
        w.reviewer,
        rec.id,
        { decision: 'approve', expectedRevision: 1, reason: null },
        'decided-key-001',
      );
      const replay = await w.analyze();
      assert.equal(replay.generated, 0);
      assert.equal(replay.abstentions.already_decided, 1);
    });

    test('a rejection starts a cooldown for the same subject and kind', async () => {
      const w = await world();
      await w.sync([record('deal-1')]);
      await w.analyze();
      const [rec] = await w.open();
      assert.ok(rec);
      await w.services.review.decide(
        w.reviewer,
        rec.id,
        { decision: 'reject', expectedRevision: 1, reason: 'Client en pause' },
        'reject-key-0001',
      );
      await w.sync([
        record(
          'deal-1',
          { lastInteractionAt: present('2026-09-21T10:00:00.000Z') },
          { sourceModifiedAt: '2026-10-06T13:55:00.000Z' },
        ),
      ]);
      const analysis = await w.analyze();
      assert.equal(analysis.generated, 0);
      assert.equal(analysis.abstentions.rejection_cooldown, 1);
    });

    test('the doctrine volume cap keeps only the highest priorities open', async () => {
      const w = await world();
      const capped = await w.services.doctrines.draft(w.owner, {
        ...FIXTURE_DOCTRINE,
        content: {
          ...(FIXTURE_DOCTRINE.content as object),
          policy: {
            maxSourceAgeHours: 24,
            recommendationLifetimeHours: 72,
            maxOpenRecommendations: 2,
            rejectionCooldownDays: 14,
          },
        },
      });
      await w.services.doctrines.validate(w.owner, capped.id, null);
      await w.sync([
        record('d-10', { lastInteractionAt: present('2026-09-26T14:00:00.000Z') }),
        record('d-20', { lastInteractionAt: present('2026-09-16T14:00:00.000Z') }),
        record('d-15', { lastInteractionAt: present('2026-09-21T14:00:00.000Z') }),
      ]);
      const analysis = await w.analyze();
      assert.equal(analysis.generated, 2);
      assert.equal(analysis.abstentions.volume_cap, 1);
      const open = await w.open();
      assert.deepEqual(
        open.map((r) => r.subject.externalId),
        ['d-20', 'd-15'],
      );
    });

    test('a human edit creates a new content revision that needs a new approval', async () => {
      const w = await world();
      await w.sync([record('deal-1')]);
      await w.analyze();
      const [rec] = await w.open();
      assert.ok(rec);
      const draft = await w.services.review.revise(
        w.reviewer,
        rec.id,
        {
          expectedRevision: 1,
          proposedAction: 'Appeler le contact fictif mardi.',
          note: 'Précision',
          submit: false,
        },
        'revise-key-0001',
      );
      assert.equal(draft.recommendation.status, 'draft');
      assert.equal(draft.recommendation.contentRevision, 2);
      await assert.rejects(
        w.services.review.decide(
          w.reviewer,
          rec.id,
          { decision: 'approve', expectedRevision: 2, reason: null },
          'draft-approve-1',
        ),
        expectCode('INVALID_TRANSITION'),
      );
      const submitted = await w.services.review.revise(
        w.reviewer,
        rec.id,
        {
          expectedRevision: 2,
          proposedAction: 'Appeler le contact fictif mardi.',
          note: null,
          submit: true,
        },
        'revise-key-0002',
      );
      assert.equal(submitted.recommendation.status, 'pending');
      const approved = await w.services.review.decide(
        w.owner,
        rec.id,
        { decision: 'approve', expectedRevision: 3, reason: null },
        'approve-rev-001',
      );
      assert.equal(approved.decision.contentRevision, 2);
      const detail = await w.services.queries.getRecommendation(w.reviewer, rec.id);
      assert.equal(detail.revisions.length, 2);
    });

    test('validating a new doctrine version supersedes proposals of the previous version', async () => {
      const w = await world();
      await w.sync([record('deal-1')]);
      await w.analyze();
      const [rec] = await w.open();
      assert.ok(rec);
      const v2 = await w.services.doctrines.draft(w.owner, FIXTURE_DOCTRINE);
      assert.equal(v2.version, 2);
      await w.services.doctrines.validate(w.owner, v2.id, null);
      await assert.rejects(
        w.services.review.decide(
          w.reviewer,
          rec.id,
          { decision: 'approve', expectedRevision: 1, reason: null },
          'doctrine-key-01',
        ),
        expectCode('STALE_EVIDENCE'),
      );
      await w.analyze();
      const [next] = await w.open();
      assert.ok(next);
      assert.equal(next.doctrine.version, 2);
      assert.equal(next.supersedesId, rec.id);
      const doctrines = await w.services.doctrines.list(w.viewer);
      assert.deepEqual(
        doctrines.map((d) => [d.version, d.status]),
        [
          [2, 'validated'],
          [1, 'retired'],
        ],
      );
    });

    test('draft doctrines and invalid parameters are refused', async () => {
      const w = await world();
      await assert.rejects(
        w.services.doctrines.draft(w.owner, {
          ...FIXTURE_DOCTRINE,
          content: {
            rules: [
              {
                ruleId: 'fixture.stalled-opportunity',
                enabled: true,
                parameters: { inactivityDays: 0 },
              },
            ],
            policy: (FIXTURE_DOCTRINE.content as { policy: unknown }).policy,
          },
        }),
        expectCode('INVALID_POLICY'),
      );
      await assert.rejects(
        w.services.doctrines.draft(w.reviewer, FIXTURE_DOCTRINE),
        expectCode('FORBIDDEN'),
      );
      await assert.rejects(
        w.services.doctrines.draft(w.owner, { ...FIXTURE_DOCTRINE, origin: 'customer' }),
        expectCode('DOCTRINE_RIGHTS'),
      );
    });

    test('revoking a connection blocks new syncs, closes its proposals and allows purge', async () => {
      const w = await world();
      await w.sync([record('deal-1')]);
      await w.analyze();
      const [rec] = await w.open();
      assert.ok(rec);
      await assert.rejects(
        w.services.connections.revoke(w.reviewer, w.connection.id),
        expectCode('FORBIDDEN'),
      );
      await w.services.connections.revoke(w.owner, w.connection.id);
      await assert.rejects(
        w.services.ingestion.start(w.worker, w.connection.id, 'scheduled'),
        expectCode('CONNECTION_INACTIVE'),
      );
      await assert.rejects(
        w.services.connections.requestSync(w.reviewer, w.connection.id),
        expectCode('CONNECTION_INACTIVE'),
      );
      assert.equal((await w.open()).length, 0);
      const closed = await w.services.queries.getRecommendation(w.reviewer, rec.id);
      assert.equal(closed.recommendation.closedReason, 'connection_revoked');
      const purged = await w.services.maintenance.purgeRevokedConnection(w.worker, w.connection.id);
      assert.equal(purged.opportunities, 1);
      assert.equal(
        (await w.services.queries.listOpportunities(w.viewer, { includeDeleted: true })).items
          .length,
        0,
      );
      const history = await w.services.queries.getRecommendation(w.reviewer, rec.id);
      assert.ok(history.evidence.length > 0, 'evidence snapshots remain for the decision history');
      assert.ok((await h.outbox(w.tenantId)).some((e) => e.eventType === 'connection.revoked'));
    });

    test('a revocation committed during a sync stops the next page', async () => {
      const w = await world();
      const started = await w.services.ingestion.start(w.worker, w.connection.id, 'initial');
      await w.services.ingestion.applyPage(w.worker, started.run.id, {
        records: [record('deal-1')],
        rejectedByConnector: 0,
        cursorAfter: 'p1',
        complete: false,
      });
      await w.services.connections.revoke(w.owner, w.connection.id);
      await assert.rejects(
        w.services.ingestion.applyPage(w.worker, started.run.id, {
          records: [record('deal-2')],
          rejectedByConnector: 0,
          cursorAfter: 'p2',
          complete: true,
        }),
        expectCode('CONNECTION_INACTIVE'),
      );
    });

    test('an interrupted sync resumes from the persisted checkpoint and keeps the pass start as freshness', async () => {
      const w = await world();
      const first = await w.services.ingestion.start(w.worker, w.connection.id, 'initial');
      await w.services.ingestion.applyPage(w.worker, first.run.id, {
        records: [record('deal-1')],
        rejectedByConnector: 0,
        cursorAfter: 'page-2',
        complete: false,
      });
      h.clock.advance(HOUR_MS);
      const resumed = await w.services.ingestion.start(w.worker, w.connection.id, 'scheduled');
      assert.equal(resumed.cursor, 'page-2');
      await w.services.ingestion.applyPage(w.worker, resumed.run.id, {
        records: [record('deal-2')],
        rejectedByConnector: 0,
        cursorAfter: 'watermark',
        complete: true,
      });
      const [connection] = await w.services.connections.list(w.viewer);
      assert.ok(connection);
      assert.equal(connection.dataAsOf, SCENARIO_START);
      assert.equal(connection.cursor, 'watermark');
      const runs = await w.services.connections.syncRuns(w.viewer, w.connection.id);
      assert.deepEqual(runs.map((r) => r.status).sort(), ['failed', 'succeeded']);
      assert.equal(runs.find((r) => r.status === 'failed')?.errorCode, 'interrupted');
    });

    test('malformed records are counted and skipped while valid records and the checkpoint commit together', async () => {
      const w = await world();
      const started = await w.services.ingestion.start(w.worker, w.connection.id, 'initial');
      const poison = { ...record('deal-2'), fields: { ...record('deal-2').fields, name: 7 } };
      const run = await w.services.ingestion.applyPage(w.worker, started.run.id, {
        records: [record('deal-1'), poison],
        rejectedByConnector: 0,
        cursorAfter: 'p1',
        complete: false,
      });
      assert.equal(run.rejected, 1);
      assert.equal(run.created, 1);
      const [connection] = await w.services.connections.list(w.viewer);
      assert.equal(connection?.cursor, 'p1');
    });

    test('memberships: the last owner cannot be demoted or revoked', async () => {
      const w = await world();
      await assert.rejects(
        w.services.members.revoke(w.owner, w.ids.ownerId),
        expectCode('INVALID_TRANSITION'),
      );
      await assert.rejects(
        w.services.members.changeRole(w.owner, w.ids.ownerId, 'viewer'),
        expectCode('INVALID_TRANSITION'),
      );
      const revoked = await w.services.members.revoke(w.owner, w.ids.viewerId);
      assert.equal(revoked.status, 'revoked');
      await assert.rejects(
        w.services.members.revoke(w.reviewer, w.ids.viewerId),
        expectCode('FORBIDDEN'),
      );
      const members = await w.services.members.list(w.reviewer);
      assert.equal(members.length, 3);
    });

    test('returned snapshots cannot mutate stored state', async () => {
      const w = await world();
      await w.sync([record('deal-1')]);
      await w.analyze();
      const [rec] = await w.open();
      assert.ok(rec);
      (rec as { status: string }).status = 'approved';
      const [again] = await w.open();
      assert.equal(again?.status, 'pending');
    });

    test('unknown raw fields are dropped and source text never reaches the audit log', async () => {
      const w = await world();
      const raw = {
        ...record('deal-1', { nextStep: present('SECRET-NEXT-STEP') }),
        privateEmailBody: 'PRIVATE',
        token: 'SECRET',
      };
      await w.sync([raw]);
      await w.analyze();
      const opportunities = await w.services.queries.listOpportunities(w.viewer, {});
      assert.equal('privateEmailBody' in (opportunities.items[0] as object), false);
      const audit = await w.services.queries.listAudit(w.owner, { limit: 100 });
      assert.doesNotMatch(JSON.stringify(audit.items), /PRIVATE|SECRET/);
    });

    test('malformed inputs fail closed', async () => {
      const w = await world();
      await w.sync([record('deal-1')]);
      await w.analyze();
      const [rec] = await w.open();
      assert.ok(rec);
      await assert.rejects(
        w.services.review.decide(
          w.reviewer,
          rec.id,
          { decision: 'execute', expectedRevision: 1 },
          'bad-input-0001',
        ),
        expectCode('INVALID_DECISION'),
      );
      await assert.rejects(
        w.services.review.decide(
          w.reviewer,
          rec.id,
          { decision: 'approve', expectedRevision: 0 },
          'bad-input-0002',
        ),
        expectCode('INVALID_REVISION'),
      );
      await assert.rejects(
        w.services.review.decide(
          w.reviewer,
          rec.id,
          { decision: 'approve', expectedRevision: 1 },
          'short',
        ),
        expectCode('INVALID_INPUT'),
      );
      await assert.rejects(
        w.services.queries.listRecommendations({ ...w.reviewer, tenantId: 'not-a-uuid' }, {}),
        expectCode('INVALID_CONTEXT'),
      );
      await assert.rejects(
        w.services.queries.listRecommendations(
          userContext(w.tenantId, w.ids.reviewerId, 'admin' as Role),
          {},
        ),
        expectCode('INVALID_ROLE'),
      );
      await assert.rejects(
        w.services.queries.listRecommendations(w.reviewer, { cursor: '!!' }),
        expectCode('INVALID_INPUT'),
      );
    });

    test('decisions cannot be timestamped before the recommendation was generated', async () => {
      const w = await world();
      await w.sync([record('deal-1')]);
      await w.analyze();
      const [rec] = await w.open();
      assert.ok(rec);
      h.clock.set('2026-10-06T13:59:00.000Z');
      await assert.rejects(
        w.services.review.decide(
          w.reviewer,
          rec.id,
          { decision: 'reject', expectedRevision: 1, reason: null },
          'timeline-key-01',
        ),
        expectCode('INVALID_TIMELINE'),
      );
    });

    test('model-assisted wording creates a machine revision but never overwrites a human edit', async () => {
      const w = await world();
      await w.sync([record('deal-1'), record('deal-2')]);
      await w.analyze();
      const [first, second] = await w.open();
      assert.ok(first && second);
      const inputs = await w.services.formulation.prepare(w.worker, first.id);
      assert.ok(inputs);
      assert.ok(inputs.evidence.length > 0);
      assert.equal(inputs.spentThisMonthUsd, 0);
      const provenance = { provider: 'fake', model: 'fake-model', promptVersion: 'next-step-v1' };
      const formulated = await w.services.formulation.apply(
        w.worker,
        first.id,
        inputs.recommendation.revision,
        'Relancer le contact par téléphone cette semaine.',
        provenance,
      );
      assert.equal(formulated.formulation, 'model');
      assert.equal(formulated.contentRevision, 2);
      await w.services.formulation.recordUsage(w.worker, {
        recommendationId: first.id,
        ...provenance,
        inputTokens: 420,
        outputTokens: 60,
        costUsd: 0.0012,
        latencyMs: 850,
        outcome: 'formulated',
        errorCode: null,
      });
      assert.equal(
        await w.services.formulation.prepare(w.worker, first.id),
        null,
        'already reformulated',
      );
      const approved = await w.services.review.decide(
        w.reviewer,
        first.id,
        { decision: 'approve', expectedRevision: formulated.revision, reason: null },
        'formulated-approve',
      );
      assert.equal(approved.decision.contentRevision, 2);
      await w.services.review.revise(
        w.reviewer,
        second.id,
        { expectedRevision: 1, proposedAction: 'Texte humain.', note: null, submit: true },
        'human-edit-0001',
      );
      assert.equal(await w.services.formulation.prepare(w.worker, second.id), null);
      await assert.rejects(
        w.services.formulation.apply(w.worker, second.id, 2, 'Texte machine.', provenance),
        expectCode('INVALID_TRANSITION'),
      );
      await assert.rejects(
        w.services.formulation.prepare(w.reviewer, second.id),
        expectCode('FORBIDDEN'),
      );
      const spent = await w.services.formulation.prepare(
        w.worker,
        (await w.open()).find((r) => r.id !== first.id && r.id !== second.id)?.id ?? first.id,
      );
      assert.equal(spent, null);
    });

    test('pagination is stable and complete', async () => {
      const w = await world();
      await w.sync(
        Array.from({ length: 7 }, (_, i) =>
          record(`deal-${i}`, {
            lastInteractionAt: present(`2026-09-${String(10 + i).padStart(2, '0')}T10:00:00.000Z`),
          }),
        ),
      );
      await w.analyze();
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const page = await w.services.queries.listRecommendations(w.reviewer, { limit: 3, cursor });
        seen.push(...page.items.map((r) => r.id));
        cursor = page.nextCursor;
      } while (cursor);
      assert.equal(seen.length, 7);
      assert.equal(new Set(seen).size, 7);
    });
  });
}
