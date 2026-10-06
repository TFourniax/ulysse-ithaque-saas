import type { CompanyContext } from './company-context.ts';
import type { Context } from './context.ts';
import type { Doctrine } from './doctrine.ts';
import type { Opportunity, SourceHead } from './opportunity.ts';
import type { DecisionDigest, RecommendationDigest } from './report.ts';
import type {
  DecisionRecord,
  EvidenceLink,
  Recommendation,
  RevisionRecord,
} from './recommendation.ts';
import type {
  Analysis,
  AuditEvent,
  Connection,
  Fact,
  IdempotencyReceipt,
  Member,
  ModelUsage,
  OutboxEvent,
  Page,
  PageRequest,
  SourceRecord,
  SyncRun,
} from './records.ts';

export type RecommendationView = 'open' | 'decided' | 'closed' | 'all';

export type RecommendationFilter = Readonly<{
  view: RecommendationView;
  /** Reference time used to classify open recommendations past their TTL as closed. */
  now: string;
  kind?: string;
  subjectId?: string;
}>;

/**
 * Storage operations available inside one tenant-scoped transaction.
 * Every method is implicitly restricted to `tenantId`; adapters must enforce it
 * (PostgreSQL: RLS + transaction-local tenant setting; memory: explicit filter).
 * Adapters store and load; business decisions live in the domain functions and services.
 */
export interface TenantTx {
  readonly tenantId: string;

  /** Serializes transactions of this tenant on `scope` until commit (e.g. one analysis at a time). */
  lock(scope: string): Promise<void>;

  getConnection(id: string, opts?: { forUpdate?: boolean }): Promise<Connection | null>;
  listConnections(): Promise<Connection[]>;
  insertConnection(connection: Connection): Promise<void>;
  updateConnection(connection: Connection): Promise<void>;

  insertSyncRun(run: SyncRun): Promise<void>;
  updateSyncRun(run: SyncRun): Promise<void>;
  getSyncRun(id: string): Promise<SyncRun | null>;
  listSyncRuns(connectionId: string, limit: number): Promise<SyncRun[]>;

  getSourceHead(connectionId: string, externalId: string): Promise<SourceHead | null>;
  insertSourceRecord(record: SourceRecord): Promise<void>;
  touchSourceRecord(sourceRecordId: string, observedAt: string): Promise<void>;

  getOpportunity(id: string): Promise<Opportunity | null>;
  getOpportunityByExternalId(connectionId: string, externalId: string): Promise<Opportunity | null>;
  upsertOpportunity(opportunity: Opportunity): Promise<void>;
  listOpportunities(
    page: PageRequest,
    filter: { includeDeleted: boolean },
  ): Promise<Page<Opportunity>>;
  /** All non-deleted opportunities plus those deleted after `deletedSince` (analysis input). */
  listOpportunitiesForAnalysis(deletedSince: string): Promise<Opportunity[]>;
  insertFacts(facts: readonly Fact[]): Promise<void>;
  supersedeFacts(subjectId: string, at: string): Promise<void>;
  listCurrentFacts(subjectId: string): Promise<Fact[]>;
  purgeConnectionData(
    connectionId: string,
  ): Promise<{ sourceRecords: number; opportunities: number; facts: number }>;

  getActiveDoctrine(): Promise<Doctrine | null>;
  getDoctrine(id: string, opts?: { forUpdate?: boolean }): Promise<Doctrine | null>;
  listDoctrines(): Promise<Doctrine[]>;
  insertDoctrine(doctrine: Doctrine): Promise<void>;
  updateDoctrine(doctrine: Doctrine): Promise<void>;

  getCurrentContext(): Promise<CompanyContext | null>;
  insertContext(context: CompanyContext): Promise<void>;

  getRecommendation(id: string, opts?: { forUpdate?: boolean }): Promise<Recommendation | null>;
  listRecommendations(
    filter: RecommendationFilter,
    page: PageRequest,
  ): Promise<Page<Recommendation>>;
  listOpenRecommendations(): Promise<Recommendation[]>;
  listRecommendationsByFingerprint(fingerprints: readonly string[]): Promise<Recommendation[]>;
  listRejectedSince(since: string): Promise<Recommendation[]>;
  insertRecommendation(rec: Recommendation): Promise<void>;
  updateRecommendation(rec: Recommendation): Promise<void>;
  insertEvidence(links: readonly EvidenceLink[]): Promise<void>;
  listEvidence(recommendationId: string): Promise<EvidenceLink[]>;
  insertRevision(revision: RevisionRecord): Promise<void>;
  listRevisions(recommendationId: string): Promise<RevisionRecord[]>;
  insertDecision(decision: DecisionRecord): Promise<void>;
  listDecisions(recommendationId: string): Promise<DecisionRecord[]>;
  /** Recommendations generated in [from, to] (inclusive), oldest first, at most `limit`. */
  listRecommendationDigests(
    from: string,
    to: string,
    limit: number,
  ): Promise<RecommendationDigest[]>;
  /** Decisions taken in [from, to] (inclusive) with their recommendation's kind and generation time. */
  listDecisionDigests(from: string, to: string, limit: number): Promise<DecisionDigest[]>;

  insertAnalysis(analysis: Analysis): Promise<void>;
  insertModelUsage(usage: ModelUsage): Promise<void>;
  /** Sum of reported model costs (USD) for the tenant since `since`. */
  sumModelCostSince(since: string): Promise<number>;
  listAnalyses(limit: number): Promise<Analysis[]>;

  getReceipt(actorId: string, operation: string, key: string): Promise<IdempotencyReceipt | null>;
  /** Must fail with IDEMPOTENCY_CONFLICT when the (actor, operation, key) already exists. */
  insertReceipt(receipt: IdempotencyReceipt): Promise<void>;

  appendAudit(event: AuditEvent): Promise<void>;
  listAudit(page: PageRequest, filter: { resourceId?: string }): Promise<Page<AuditEvent>>;
  enqueueOutbox(event: OutboxEvent): Promise<void>;

  listMembers(): Promise<Member[]>;
  getMember(userId: string, opts?: { forUpdate?: boolean }): Promise<Member | null>;
  updateMember(member: Member): Promise<void>;
}

/** Runs `work` atomically for `ctx.tenantId`: everything commits or nothing does. */
export interface UnitOfWork {
  run<T>(ctx: Context, work: (tx: TenantTx) => Promise<T>): Promise<T>;
}

export interface IdGenerator {
  next(): string;
}
