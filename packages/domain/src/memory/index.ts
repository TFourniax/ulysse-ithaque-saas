import type { CompanyContext } from '../company-context.ts';
import type { Context } from '../context.ts';
import { assertContext } from '../context.ts';
import type { CursorKey } from '../cursor.ts';
import { decodeCursor, encodeCursor } from '../cursor.ts';
import type { Doctrine } from '../doctrine.ts';
import { DomainError, ensure } from '../errors.ts';
import type { Opportunity, SourceHead } from '../opportunity.ts';
import type { IdGenerator, RecommendationFilter, TenantTx, UnitOfWork } from '../ports.ts';
import type {
  DecisionRecord,
  EvidenceLink,
  Recommendation,
  RevisionRecord,
} from '../recommendation.ts';
import { isOpen } from '../recommendation.ts';
import type {
  Analysis,
  AuditEvent,
  Connection,
  Fact,
  IdempotencyReceipt,
  Member,
  OutboxEvent,
  Page,
  PageRequest,
  SourceRecord,
  SyncRun,
} from '../records.ts';

/** Whole in-memory state; every row carries its tenantId. */
export type MemoryState = {
  connections: Connection[];
  syncRuns: SyncRun[];
  sourceRecords: SourceRecord[];
  opportunities: Opportunity[];
  facts: Fact[];
  doctrines: Doctrine[];
  contexts: CompanyContext[];
  recommendations: Recommendation[];
  evidence: EvidenceLink[];
  revisions: RevisionRecord[];
  decisions: DecisionRecord[];
  analyses: Analysis[];
  receipts: IdempotencyReceipt[];
  audit: AuditEvent[];
  outbox: OutboxEvent[];
  members: Member[];
};

export function emptyMemoryState(): MemoryState {
  return {
    connections: [],
    syncRuns: [],
    sourceRecords: [],
    opportunities: [],
    facts: [],
    doctrines: [],
    contexts: [],
    recommendations: [],
    evidence: [],
    revisions: [],
    decisions: [],
    analyses: [],
    receipts: [],
    audit: [],
    outbox: [],
    members: [],
  };
}

export const randomIds: IdGenerator = { next: () => crypto.randomUUID() };

export function sequentialIds(prefix = '00000000-0000-4000-8000-'): IdGenerator {
  let n = 0;
  return { next: () => `${prefix}${String(++n).padStart(12, '0')}` };
}

/**
 * Reference adapter for fast tests and the offline demo. Transactions are
 * serialized and applied to a copy committed only on success, which mirrors
 * the atomicity contract of the PostgreSQL adapter. Not durable.
 */
export class MemoryUnitOfWork implements UnitOfWork {
  #state: MemoryState;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(state: MemoryState = emptyMemoryState()) {
    this.#state = state;
  }

  /** Test/demo inspection of committed state (copy). */
  snapshot(): MemoryState {
    return structuredClone(this.#state);
  }

  /** Seeds rows directly (fixtures only). */
  seed(mutator: (state: MemoryState) => void): void {
    const working = structuredClone(this.#state);
    mutator(working);
    this.#state = working;
  }

  async run<T>(ctx: Context, work: (tx: TenantTx) => Promise<T>): Promise<T> {
    assertContext(ctx);
    const previous = this.#queue;
    let release!: () => void;
    this.#queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous.catch(() => undefined);
    try {
      const working = structuredClone(this.#state);
      const result = await work(new MemoryTx(ctx.tenantId, working));
      this.#state = working;
      return structuredClone(result);
    } finally {
      release();
    }
  }
}

function after(
  key: CursorKey,
  cursor: CursorKey,
  directions: readonly ('asc' | 'desc')[],
): boolean {
  for (let i = 0; i < key.length; i += 1) {
    const a = key[i];
    const b = cursor[i];
    if (a === b || a === undefined || b === undefined) continue;
    const greater = a > b;
    return directions[i] === 'asc' ? greater : !greater;
  }
  return false;
}

function paginate<T>(
  items: T[],
  page: PageRequest,
  keyOf: (item: T) => CursorKey,
  directions: readonly ('asc' | 'desc')[],
): Page<T> {
  const sorted = [...items].sort((x, y) => {
    const a = keyOf(x);
    const b = keyOf(y);
    if (after(a, b, directions)) return 1;
    if (after(b, a, directions)) return -1;
    return 0;
  });
  const cursor = page.cursor ? decodeCursor(page.cursor, directions.length) : null;
  const remaining = cursor
    ? sorted.filter((item) => after(keyOf(item), cursor, directions))
    : sorted;
  const items_ = remaining.slice(0, page.limit);
  const last = items_.at(-1);
  return {
    items: items_,
    nextCursor:
      remaining.length > page.limit && last !== undefined ? encodeCursor(keyOf(last)) : null,
  };
}

const RECOMMENDATION_ORDER = ['desc', 'desc', 'asc'] as const;
export const recommendationKey = (r: Recommendation): CursorKey => [
  r.priority.score,
  r.generatedAt,
  r.id,
];

function matchesView(r: Recommendation, filter: RecommendationFilter): boolean {
  const expired = isOpen(r.status) && r.expiresAt <= filter.now;
  switch (filter.view) {
    case 'open':
      return isOpen(r.status) && !expired;
    case 'decided':
      return r.status === 'approved' || r.status === 'rejected';
    case 'closed':
      return r.status === 'expired' || r.status === 'superseded' || expired;
    case 'all':
      return true;
  }
}

class MemoryTx implements TenantTx {
  readonly tenantId: string;
  readonly #s: MemoryState;

  constructor(tenantId: string, state: MemoryState) {
    this.tenantId = tenantId;
    this.#s = state;
  }

  async lock(_scope: string): Promise<void> {
    // Memory transactions are already fully serialized.
  }

  #own<T extends { tenantId: string }>(rows: T[]): T[] {
    return rows.filter((r) => r.tenantId === this.tenantId);
  }

  #check(row: { tenantId: string }): void {
    ensure(row.tenantId === this.tenantId, 'TENANT_MISMATCH');
  }

  #replace<T extends { tenantId: string }>(rows: T[], match: (r: T) => boolean, next: T): void {
    this.#check(next);
    const index = rows.findIndex((r) => r.tenantId === this.tenantId && match(r));
    ensure(index >= 0, 'NOT_FOUND');
    rows[index] = next;
  }

  async getConnection(id: string): Promise<Connection | null> {
    return this.#own(this.#s.connections).find((c) => c.id === id) ?? null;
  }
  async listConnections(): Promise<Connection[]> {
    return this.#own(this.#s.connections).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async insertConnection(connection: Connection): Promise<void> {
    this.#check(connection);
    this.#s.connections.push(connection);
  }
  async updateConnection(connection: Connection): Promise<void> {
    this.#replace(this.#s.connections, (c) => c.id === connection.id, connection);
  }

  async insertSyncRun(run: SyncRun): Promise<void> {
    this.#check(run);
    this.#s.syncRuns.push(run);
  }
  async updateSyncRun(run: SyncRun): Promise<void> {
    this.#replace(this.#s.syncRuns, (r) => r.id === run.id, run);
  }
  async getSyncRun(id: string): Promise<SyncRun | null> {
    return this.#own(this.#s.syncRuns).find((r) => r.id === id) ?? null;
  }
  async listSyncRuns(connectionId: string, limit: number): Promise<SyncRun[]> {
    return this.#own(this.#s.syncRuns)
      .filter((r) => r.connectionId === connectionId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id))
      .slice(0, limit);
  }

  async getSourceHead(connectionId: string, externalId: string): Promise<SourceHead | null> {
    const rows = this.#own(this.#s.sourceRecords).filter(
      (r) => r.connectionId === connectionId && r.externalId === externalId,
    );
    const head = rows.sort((a, b) => b.revision - a.revision)[0];
    if (!head) return null;
    return {
      sourceRecordId: head.id,
      revision: head.revision,
      contentHash: head.contentHash ?? '',
      providerVersion: head.providerVersion,
      sourceModifiedAt: head.sourceModifiedAt,
      observedAt: head.observedAt,
      deletedAt: head.deletedAt,
    };
  }
  async insertSourceRecord(record: SourceRecord): Promise<void> {
    this.#check(record);
    const duplicate = this.#own(this.#s.sourceRecords).some(
      (r) =>
        r.connectionId === record.connectionId &&
        r.externalId === record.externalId &&
        r.revision === record.revision,
    );
    if (duplicate) throw new DomainError('SOURCE_VERSION_CONFLICT', 'duplicate revision');
    this.#s.sourceRecords.push(record);
  }
  async touchSourceRecord(sourceRecordId: string, observedAt: string): Promise<void> {
    const row = this.#own(this.#s.sourceRecords).find((r) => r.id === sourceRecordId);
    ensure(row !== undefined, 'NOT_FOUND');
    this.#replace(this.#s.sourceRecords, (r) => r.id === sourceRecordId, { ...row, observedAt });
  }

  async getOpportunity(id: string): Promise<Opportunity | null> {
    return this.#own(this.#s.opportunities).find((o) => o.id === id) ?? null;
  }
  async getOpportunityByExternalId(
    connectionId: string,
    externalId: string,
  ): Promise<Opportunity | null> {
    return (
      this.#own(this.#s.opportunities).find(
        (o) => o.connectionId === connectionId && o.externalId === externalId,
      ) ?? null
    );
  }
  async upsertOpportunity(opportunity: Opportunity): Promise<void> {
    this.#check(opportunity);
    const index = this.#s.opportunities.findIndex(
      (o) => o.tenantId === this.tenantId && o.id === opportunity.id,
    );
    if (index >= 0) this.#s.opportunities[index] = opportunity;
    else this.#s.opportunities.push(opportunity);
  }
  async listOpportunities(
    page: PageRequest,
    filter: { includeDeleted: boolean },
  ): Promise<Page<Opportunity>> {
    const rows = this.#own(this.#s.opportunities).filter(
      (o) => filter.includeDeleted || o.deletedAt === null,
    );
    return paginate(rows, page, (o) => [o.fields.name, o.id], ['asc', 'asc']);
  }
  async listOpportunitiesForAnalysis(deletedSince: string): Promise<Opportunity[]> {
    return this.#own(this.#s.opportunities)
      .filter((o) => o.deletedAt === null || o.deletedAt >= deletedSince)
      .sort((a, b) => a.id.localeCompare(b.id));
  }
  async insertFacts(facts: readonly Fact[]): Promise<void> {
    for (const fact of facts) this.#check(fact);
    this.#s.facts.push(...facts);
  }
  async supersedeFacts(subjectId: string, at: string): Promise<void> {
    this.#s.facts = this.#s.facts.map((f) =>
      f.tenantId === this.tenantId && f.subjectId === subjectId && f.supersededAt === null
        ? { ...f, supersededAt: at }
        : f,
    );
  }
  async listCurrentFacts(subjectId: string): Promise<Fact[]> {
    return this.#own(this.#s.facts).filter(
      (f) => f.subjectId === subjectId && f.supersededAt === null,
    );
  }
  async purgeConnectionData(
    connectionId: string,
  ): Promise<{ sourceRecords: number; opportunities: number; facts: number }> {
    const mine = (r: { tenantId: string; connectionId: string }) =>
      r.tenantId === this.tenantId && r.connectionId === connectionId;
    const counts = {
      sourceRecords: this.#s.sourceRecords.filter(mine).length,
      opportunities: this.#s.opportunities.filter(mine).length,
      facts: this.#s.facts.filter(mine).length,
    };
    const factIds = new Set(this.#s.facts.filter(mine).map((f) => f.id));
    this.#s.sourceRecords = this.#s.sourceRecords.filter((r) => !mine(r));
    this.#s.opportunities = this.#s.opportunities.filter((r) => !mine(r));
    this.#s.facts = this.#s.facts.filter((r) => !mine(r));
    // Evidence keeps its value snapshot for decision history; the fact reference is cleared.
    this.#s.evidence = this.#s.evidence.map((e) =>
      factIds.has(e.factId) ? { ...e, factId: '' } : e,
    );
    return counts;
  }

  async getActiveDoctrine(): Promise<Doctrine | null> {
    const validated = this.#own(this.#s.doctrines).filter((d) => d.status === 'validated');
    return (
      validated.sort((a, b) => (b.validatedAt ?? '').localeCompare(a.validatedAt ?? ''))[0] ?? null
    );
  }
  async getDoctrine(id: string): Promise<Doctrine | null> {
    return this.#own(this.#s.doctrines).find((d) => d.id === id) ?? null;
  }
  async listDoctrines(): Promise<Doctrine[]> {
    return this.#own(this.#s.doctrines).sort(
      (a, b) => a.key.localeCompare(b.key) || b.version - a.version,
    );
  }
  async insertDoctrine(doctrine: Doctrine): Promise<void> {
    this.#check(doctrine);
    ensure(
      !this.#own(this.#s.doctrines).some(
        (d) => d.key === doctrine.key && d.version === doctrine.version,
      ),
      'REVISION_CONFLICT',
    );
    this.#s.doctrines.push(doctrine);
  }
  async updateDoctrine(doctrine: Doctrine): Promise<void> {
    this.#replace(this.#s.doctrines, (d) => d.id === doctrine.id, doctrine);
  }

  async getCurrentContext(): Promise<CompanyContext | null> {
    return this.#own(this.#s.contexts).sort((a, b) => b.version - a.version)[0] ?? null;
  }
  async insertContext(context: CompanyContext): Promise<void> {
    this.#check(context);
    ensure(
      !this.#own(this.#s.contexts).some((c) => c.version === context.version),
      'REVISION_CONFLICT',
    );
    this.#s.contexts.push(context);
  }

  async getRecommendation(id: string): Promise<Recommendation | null> {
    return this.#own(this.#s.recommendations).find((r) => r.id === id) ?? null;
  }
  async listRecommendations(
    filter: RecommendationFilter,
    page: PageRequest,
  ): Promise<Page<Recommendation>> {
    const rows = this.#own(this.#s.recommendations).filter(
      (r) =>
        matchesView(r, filter) &&
        (!filter.kind || r.kind === filter.kind) &&
        (!filter.subjectId || r.subject.id === filter.subjectId),
    );
    return paginate(rows, page, recommendationKey, RECOMMENDATION_ORDER);
  }
  async listOpenRecommendations(): Promise<Recommendation[]> {
    return this.#own(this.#s.recommendations)
      .filter((r) => isOpen(r.status))
      .sort((a, b) => a.id.localeCompare(b.id));
  }
  async listRecommendationsByFingerprint(
    fingerprints: readonly string[],
  ): Promise<Recommendation[]> {
    const set = new Set(fingerprints);
    return this.#own(this.#s.recommendations).filter((r) => set.has(r.fingerprint));
  }
  async listRejectedSince(since: string): Promise<Recommendation[]> {
    return this.#own(this.#s.recommendations).filter(
      (r) => r.status === 'rejected' && r.closedAt !== null && r.closedAt >= since,
    );
  }
  async insertRecommendation(rec: Recommendation): Promise<void> {
    this.#check(rec);
    const conflict = this.#own(this.#s.recommendations).some(
      (r) =>
        r.id === rec.id ||
        (isOpen(r.status) &&
          isOpen(rec.status) &&
          r.subject.id === rec.subject.id &&
          r.kind === rec.kind),
    );
    ensure(!conflict, 'REVISION_CONFLICT', 'open recommendation already exists for subject/kind');
    this.#s.recommendations.push(rec);
  }
  async updateRecommendation(rec: Recommendation): Promise<void> {
    this.#replace(this.#s.recommendations, (r) => r.id === rec.id, rec);
  }
  async insertEvidence(links: readonly EvidenceLink[]): Promise<void> {
    for (const link of links) this.#check(link);
    this.#s.evidence.push(...links);
  }
  async listEvidence(recommendationId: string): Promise<EvidenceLink[]> {
    return this.#own(this.#s.evidence).filter((e) => e.recommendationId === recommendationId);
  }
  async insertRevision(revision: RevisionRecord): Promise<void> {
    this.#check(revision);
    this.#s.revisions.push(revision);
  }
  async listRevisions(recommendationId: string): Promise<RevisionRecord[]> {
    return this.#own(this.#s.revisions)
      .filter((r) => r.recommendationId === recommendationId)
      .sort((a, b) => a.contentRevision - b.contentRevision);
  }
  async insertDecision(decision: DecisionRecord): Promise<void> {
    this.#check(decision);
    this.#s.decisions.push(decision);
  }
  async listDecisions(recommendationId: string): Promise<DecisionRecord[]> {
    return this.#own(this.#s.decisions)
      .filter((d) => d.recommendationId === recommendationId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async insertAnalysis(analysis: Analysis): Promise<void> {
    this.#check(analysis);
    this.#s.analyses.push(analysis);
  }
  async listAnalyses(limit: number): Promise<Analysis[]> {
    return this.#own(this.#s.analyses)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id))
      .slice(0, limit);
  }

  async getReceipt(
    actorId: string,
    operation: string,
    key: string,
  ): Promise<IdempotencyReceipt | null> {
    return (
      this.#own(this.#s.receipts).find(
        (r) => r.actorId === actorId && r.operation === operation && r.key === key,
      ) ?? null
    );
  }
  async insertReceipt(receipt: IdempotencyReceipt): Promise<void> {
    this.#check(receipt);
    if (await this.getReceipt(receipt.actorId, receipt.operation, receipt.key))
      throw new DomainError('IDEMPOTENCY_CONFLICT');
    this.#s.receipts.push(receipt);
  }

  async appendAudit(event: AuditEvent): Promise<void> {
    this.#check(event);
    this.#s.audit.push(event);
  }
  async listAudit(page: PageRequest, filter: { resourceId?: string }): Promise<Page<AuditEvent>> {
    const rows = this.#own(this.#s.audit).filter(
      (e) => !filter.resourceId || e.resourceId === filter.resourceId,
    );
    return paginate(rows, page, (e) => [e.createdAt, e.id], ['desc', 'desc']);
  }
  async enqueueOutbox(event: OutboxEvent): Promise<void> {
    this.#check(event);
    this.#s.outbox.push(event);
  }

  async listMembers(): Promise<Member[]> {
    return this.#own(this.#s.members).sort((a, b) => a.displayName.localeCompare(b.displayName));
  }
  async getMember(userId: string): Promise<Member | null> {
    return this.#own(this.#s.members).find((m) => m.userId === userId) ?? null;
  }
  async updateMember(member: Member): Promise<void> {
    this.#replace(this.#s.members, (m) => m.userId === member.userId, member);
  }
}
