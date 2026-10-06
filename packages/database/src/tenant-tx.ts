import type {
  Analysis,
  AuditEvent,
  CompanyContext,
  Connection,
  CursorKey,
  DecisionDigest,
  DecisionRecord,
  Doctrine,
  EvidenceLink,
  Fact,
  IdempotencyReceipt,
  Member,
  ModelUsage,
  Opportunity,
  OpportunityFields,
  OutboxEvent,
  Page,
  PageRequest,
  Recommendation,
  RecommendationDigest,
  RecommendationFilter,
  RevisionRecord,
  SourceHead,
  SourceRecord,
  SyncRun,
  TenantTx,
} from '@ulysse/domain';
import {
  CLOSED_REASONS,
  CONNECTION_STATUSES,
  decodeCursor,
  DOCTRINE_ORIGINS,
  DOCTRINE_STATUSES,
  DomainError,
  encodeCursor,
  QUALITY_LABELS,
  RECOMMENDATION_KINDS,
  RECOMMENDATION_STATUSES,
  ROLES,
  USAGE_RIGHTS,
} from '@ulysse/domain';
import type { PoolClient } from 'pg';
import type { Row } from './rows.ts';
import { bool, int, intOrNull, json, num, oneOf, str, strArray, strOrNull } from './rows.ts';

type Queryable = Pick<PoolClient, 'query'>;

const FACT_STATES = ['present', 'empty', 'unavailable'] as const;

function connectionFrom(r: Row): Connection {
  return {
    tenantId: str(r, 'tenant_id'),
    id: str(r, 'id'),
    provider: str(r, 'provider'),
    displayName: str(r, 'display_name'),
    status: oneOf(r, 'status', CONNECTION_STATUSES),
    config: json(r, 'config'),
    credentialRef: strOrNull(r, 'credential_ref'),
    grantedScopes: strArray(r, 'granted_scopes'),
    syncIntervalMinutes: int(r, 'sync_interval_minutes'),
    cursor: strOrNull(r, 'cursor'),
    passStartedAt: strOrNull(r, 'pass_started_at'),
    lastSyncStartedAt: strOrNull(r, 'last_sync_started_at'),
    lastSuccessAt: strOrNull(r, 'last_success_at'),
    dataAsOf: strOrNull(r, 'data_as_of'),
    lastErrorCode: strOrNull(r, 'last_error_code'),
    lastErrorAt: strOrNull(r, 'last_error_at'),
    consecutiveFailures: int(r, 'consecutive_failures'),
    nextSyncAt: strOrNull(r, 'next_sync_at'),
    createdBy: strOrNull(r, 'created_by'),
    createdAt: str(r, 'created_at'),
    updatedAt: str(r, 'updated_at'),
    revokedAt: strOrNull(r, 'revoked_at'),
    revokedBy: strOrNull(r, 'revoked_by'),
  };
}

function syncRunFrom(r: Row): SyncRun {
  return {
    tenantId: str(r, 'tenant_id'),
    id: str(r, 'id'),
    connectionId: str(r, 'connection_id'),
    trigger: oneOf(r, 'trigger', ['initial', 'scheduled', 'manual', 'replay'] as const),
    status: oneOf(r, 'status', ['running', 'succeeded', 'failed', 'cancelled'] as const),
    startedAt: str(r, 'started_at'),
    completedAt: strOrNull(r, 'completed_at'),
    pages: int(r, 'pages'),
    seen: int(r, 'seen'),
    created: int(r, 'created'),
    revised: int(r, 'revised'),
    unchanged: int(r, 'unchanged'),
    deleted: int(r, 'deleted'),
    stale: int(r, 'stale'),
    rejected: int(r, 'rejected'),
    cursorStart: strOrNull(r, 'cursor_start'),
    cursorEnd: strOrNull(r, 'cursor_end'),
    errorCode: strOrNull(r, 'error_code'),
    errorDetail: strOrNull(r, 'error_detail'),
  };
}

function opportunityFrom(r: Row): Opportunity {
  return {
    tenantId: str(r, 'tenant_id'),
    id: str(r, 'id'),
    connectionId: str(r, 'connection_id'),
    externalId: str(r, 'external_id'),
    sourceRecordId: str(r, 'source_record_id'),
    revision: int(r, 'revision'),
    fields: json<OpportunityFields>(r, 'fields'),
    sourceModifiedAt: strOrNull(r, 'source_modified_at'),
    observedAt: str(r, 'observed_at'),
    ingestedAt: str(r, 'ingested_at'),
    deletedAt: strOrNull(r, 'deleted_at'),
  };
}

function factFrom(r: Row): Fact {
  return {
    tenantId: str(r, 'tenant_id'),
    id: str(r, 'id'),
    subjectType: 'opportunity',
    subjectId: str(r, 'subject_id'),
    connectionId: str(r, 'connection_id'),
    sourceRecordId: str(r, 'source_record_id'),
    sourceRevision: int(r, 'source_revision'),
    factType: str(r, 'fact_type') as Fact['factType'],
    state: oneOf(r, 'state', FACT_STATES),
    value: r.value ?? null,
    locator: str(r, 'locator'),
    observedAt: str(r, 'observed_at'),
    sourceModifiedAt: strOrNull(r, 'source_modified_at'),
    supersededAt: strOrNull(r, 'superseded_at'),
  };
}

function doctrineFrom(r: Row): Doctrine {
  return {
    tenantId: str(r, 'tenant_id'),
    id: str(r, 'id'),
    key: str(r, 'key'),
    version: int(r, 'version'),
    status: oneOf(r, 'status', DOCTRINE_STATUSES),
    title: str(r, 'title'),
    origin: oneOf(r, 'origin', DOCTRINE_ORIGINS),
    usageRights: oneOf(r, 'usage_rights', USAGE_RIGHTS),
    content: json(r, 'content'),
    contentHash: str(r, 'content_hash'),
    createdBy: strOrNull(r, 'created_by'),
    createdAt: str(r, 'created_at'),
    validatedBy: strOrNull(r, 'validated_by'),
    validatedAt: strOrNull(r, 'validated_at'),
    validationNote: strOrNull(r, 'validation_note'),
    retiredAt: strOrNull(r, 'retired_at'),
  };
}

function contextFrom(r: Row): CompanyContext {
  return {
    tenantId: str(r, 'tenant_id'),
    id: str(r, 'id'),
    version: int(r, 'version'),
    content: json(r, 'content'),
    source: oneOf(r, 'source', ['manual', 'fixture'] as const),
    note: strOrNull(r, 'note'),
    createdBy: strOrNull(r, 'created_by'),
    createdAt: str(r, 'created_at'),
  };
}

function recommendationFrom(r: Row): Recommendation {
  return {
    tenantId: str(r, 'tenant_id'),
    id: str(r, 'id'),
    subject: {
      type: 'opportunity',
      id: str(r, 'subject_id'),
      externalId: str(r, 'subject_external_id'),
      label: str(r, 'subject_label'),
      connectionId: str(r, 'connection_id'),
    },
    kind: oneOf(r, 'kind', RECOMMENDATION_KINDS),
    ruleId: str(r, 'rule_id'),
    ruleVersion: str(r, 'rule_version'),
    doctrine: {
      id: str(r, 'doctrine_id'),
      key: str(r, 'doctrine_key'),
      version: int(r, 'doctrine_version'),
      origin: oneOf(r, 'doctrine_origin', DOCTRINE_ORIGINS),
      fictional: bool(r, 'doctrine_fictional'),
    },
    contextVersion: intOrNull(r, 'context_version'),
    analysisId: str(r, 'analysis_id'),
    status: oneOf(r, 'status', RECOMMENDATION_STATUSES),
    revision: int(r, 'revision'),
    contentRevision: int(r, 'content_revision'),
    fingerprint: str(r, 'fingerprint'),
    priority: json(r, 'priority'),
    title: str(r, 'title'),
    whyNow: str(r, 'why_now'),
    proposedAction: str(r, 'proposed_action'),
    assumptions: json(r, 'assumptions'),
    missingInformation: json(r, 'missing_information'),
    formulation: oneOf(r, 'formulation', ['template', 'model'] as const),
    generatedAt: str(r, 'generated_at'),
    expiresAt: str(r, 'expires_at'),
    dataAsOf: str(r, 'data_as_of'),
    maxSourceAgeHours: num(r, 'max_source_age_hours'),
    closedAt: strOrNull(r, 'closed_at'),
    closedReason: r.closed_reason === null ? null : oneOf(r, 'closed_reason', CLOSED_REASONS),
    supersedesId: strOrNull(r, 'supersedes_id'),
    supersededById: strOrNull(r, 'superseded_by_id'),
    updatedAt: str(r, 'updated_at'),
  };
}

function evidenceFrom(r: Row): EvidenceLink {
  return {
    tenantId: str(r, 'tenant_id'),
    id: str(r, 'id'),
    recommendationId: str(r, 'recommendation_id'),
    factId: strOrNull(r, 'fact_id') ?? '',
    sourceRecordId: strOrNull(r, 'source_record_id') ?? '',
    sourceRevision: int(r, 'source_revision'),
    connectionId: str(r, 'connection_id'),
    factType: str(r, 'fact_type') as EvidenceLink['factType'],
    label: str(r, 'label'),
    state: oneOf(r, 'state', FACT_STATES),
    value: r.value ?? null,
    locator: str(r, 'locator'),
    material: bool(r, 'material'),
    observedAt: str(r, 'observed_at'),
    sourceModifiedAt: strOrNull(r, 'source_modified_at'),
  };
}

function auditFrom(r: Row): AuditEvent {
  return {
    tenantId: str(r, 'tenant_id'),
    id: str(r, 'id'),
    actorType: oneOf(r, 'actor_type', ['user', 'service'] as const),
    actorId: str(r, 'actor_id'),
    eventType: str(r, 'event_type'),
    resourceType: str(r, 'resource_type'),
    resourceId: str(r, 'resource_id'),
    revision: intOrNull(r, 'revision'),
    correlationId: str(r, 'correlation_id'),
    metadata: json(r, 'metadata'),
    createdAt: str(r, 'created_at'),
  };
}

function analysisFrom(r: Row): Analysis {
  return {
    tenantId: str(r, 'tenant_id'),
    id: str(r, 'id'),
    trigger: str(r, 'trigger') as Analysis['trigger'],
    status: oneOf(r, 'status', ['completed', 'failed', 'skipped'] as const),
    doctrineId: strOrNull(r, 'doctrine_id'),
    doctrineVersion: intOrNull(r, 'doctrine_version'),
    ruleVersions: json(r, 'rule_versions'),
    contextVersion: intOrNull(r, 'context_version'),
    formulation: json(r, 'formulation'),
    inputHash: str(r, 'input_hash'),
    startedAt: str(r, 'started_at'),
    completedAt: str(r, 'completed_at'),
    evaluated: int(r, 'evaluated'),
    generated: int(r, 'generated'),
    unchanged: int(r, 'unchanged'),
    closed: int(r, 'closed'),
    abstentions: json(r, 'abstentions'),
    usage: json(r, 'usage'),
    errorCode: strOrNull(r, 'error_code'),
  };
}

function jsonParam(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

function pageOf<T>(rows: T[], limit: number, keyOf: (item: T) => CursorKey): Page<T> {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > limit && last !== undefined ? encodeCursor(keyOf(last)) : null,
  };
}

function asString(v: string | number | undefined): string {
  if (typeof v !== 'string') throw new DomainError('INVALID_INPUT', 'cursor');
  return v;
}

function asNumber(v: string | number | undefined): number {
  if (typeof v !== 'number') throw new DomainError('INVALID_INPUT', 'cursor');
  return v;
}

/**
 * Tenant-scoped operations on one PostgreSQL transaction. Every statement filters
 * on tenant_id explicitly AND is constrained by RLS using the transaction-local
 * `app.tenant_id` setting (defense in depth).
 */
export class PgTenantTx implements TenantTx {
  readonly tenantId: string;
  readonly #db: Queryable;

  constructor(db: Queryable, tenantId: string) {
    this.#db = db;
    this.tenantId = tenantId;
  }

  async #rows(sql: string, params: unknown[] = []): Promise<Row[]> {
    const result = await this.#db.query<Row>(sql, params);
    return result.rows;
  }

  async #one(sql: string, params: unknown[] = []): Promise<Row | null> {
    return (await this.#rows(sql, params))[0] ?? null;
  }

  async #exec(sql: string, params: unknown[] = []): Promise<number> {
    const result = await this.#db.query(sql, params);
    return result.rowCount ?? 0;
  }

  async #mustUpdate(sql: string, params: unknown[]): Promise<void> {
    if ((await this.#exec(sql, params)) !== 1) throw new DomainError('NOT_FOUND');
  }

  async lock(scope: string): Promise<void> {
    await this.#exec('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `${this.tenantId}:${scope}`,
    ]);
  }

  // Connections ---------------------------------------------------------------
  async getConnection(id: string, opts?: { forUpdate?: boolean }): Promise<Connection | null> {
    const row = await this.#one(
      `SELECT * FROM connections WHERE tenant_id = $1 AND id = $2${opts?.forUpdate ? ' FOR UPDATE' : ''}`,
      [this.tenantId, id],
    );
    return row ? connectionFrom(row) : null;
  }

  async listConnections(): Promise<Connection[]> {
    return (
      await this.#rows('SELECT * FROM connections WHERE tenant_id = $1 ORDER BY created_at, id', [
        this.tenantId,
      ])
    ).map(connectionFrom);
  }

  async insertConnection(c: Connection): Promise<void> {
    await this.#exec(
      `INSERT INTO connections (tenant_id, id, provider, display_name, status, config, credential_ref, granted_scopes,
         sync_interval_minutes, cursor, pass_started_at, last_sync_started_at, last_success_at, data_as_of, last_error_code,
         last_error_at, consecutive_failures, next_sync_at, created_by, created_at, updated_at, revoked_at, revoked_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
      [
        c.tenantId,
        c.id,
        c.provider,
        c.displayName,
        c.status,
        JSON.stringify(c.config),
        c.credentialRef,
        c.grantedScopes,
        c.syncIntervalMinutes,
        c.cursor,
        c.passStartedAt,
        c.lastSyncStartedAt,
        c.lastSuccessAt,
        c.dataAsOf,
        c.lastErrorCode,
        c.lastErrorAt,
        c.consecutiveFailures,
        c.nextSyncAt,
        c.createdBy,
        c.createdAt,
        c.updatedAt,
        c.revokedAt,
        c.revokedBy,
      ],
    );
  }

  async updateConnection(c: Connection): Promise<void> {
    await this.#mustUpdate(
      `UPDATE connections SET display_name = $3, status = $4, config = $5, credential_ref = $6, granted_scopes = $7,
         sync_interval_minutes = $8, cursor = $9, pass_started_at = $10, last_sync_started_at = $11, last_success_at = $12,
         data_as_of = $13, last_error_code = $14, last_error_at = $15, consecutive_failures = $16, next_sync_at = $17,
         updated_at = $18, revoked_at = $19, revoked_by = $20
       WHERE tenant_id = $1 AND id = $2`,
      [
        c.tenantId,
        c.id,
        c.displayName,
        c.status,
        JSON.stringify(c.config),
        c.credentialRef,
        c.grantedScopes,
        c.syncIntervalMinutes,
        c.cursor,
        c.passStartedAt,
        c.lastSyncStartedAt,
        c.lastSuccessAt,
        c.dataAsOf,
        c.lastErrorCode,
        c.lastErrorAt,
        c.consecutiveFailures,
        c.nextSyncAt,
        c.updatedAt,
        c.revokedAt,
        c.revokedBy,
      ],
    );
  }

  // Sync runs -------------------------------------------------------------------
  async insertSyncRun(r: SyncRun): Promise<void> {
    await this.#exec(
      `INSERT INTO sync_runs (tenant_id, id, connection_id, trigger, status, started_at, completed_at, pages, seen, created,
         revised, unchanged, deleted, stale, rejected, cursor_start, cursor_end, error_code, error_detail)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [
        r.tenantId,
        r.id,
        r.connectionId,
        r.trigger,
        r.status,
        r.startedAt,
        r.completedAt,
        r.pages,
        r.seen,
        r.created,
        r.revised,
        r.unchanged,
        r.deleted,
        r.stale,
        r.rejected,
        r.cursorStart,
        r.cursorEnd,
        r.errorCode,
        r.errorDetail,
      ],
    );
  }

  async updateSyncRun(r: SyncRun): Promise<void> {
    await this.#mustUpdate(
      `UPDATE sync_runs SET status = $3, completed_at = $4, pages = $5, seen = $6, created = $7, revised = $8,
         unchanged = $9, deleted = $10, stale = $11, rejected = $12, cursor_end = $13, error_code = $14, error_detail = $15
       WHERE tenant_id = $1 AND id = $2`,
      [
        r.tenantId,
        r.id,
        r.status,
        r.completedAt,
        r.pages,
        r.seen,
        r.created,
        r.revised,
        r.unchanged,
        r.deleted,
        r.stale,
        r.rejected,
        r.cursorEnd,
        r.errorCode,
        r.errorDetail,
      ],
    );
  }

  async getSyncRun(id: string): Promise<SyncRun | null> {
    const row = await this.#one('SELECT * FROM sync_runs WHERE tenant_id = $1 AND id = $2', [
      this.tenantId,
      id,
    ]);
    return row ? syncRunFrom(row) : null;
  }

  async listSyncRuns(connectionId: string, limit: number): Promise<SyncRun[]> {
    return (
      await this.#rows(
        'SELECT * FROM sync_runs WHERE tenant_id = $1 AND connection_id = $2 ORDER BY started_at DESC, id DESC LIMIT $3',
        [this.tenantId, connectionId, limit],
      )
    ).map(syncRunFrom);
  }

  // Sources ---------------------------------------------------------------------
  async getSourceHead(connectionId: string, externalId: string): Promise<SourceHead | null> {
    const row = await this.#one(
      `SELECT id, revision, content_hash, provider_version, source_modified_at, observed_at, deleted_at
       FROM source_records
       WHERE tenant_id = $1 AND connection_id = $2 AND entity_type = 'opportunity' AND external_id = $3
       ORDER BY revision DESC LIMIT 1`,
      [this.tenantId, connectionId, externalId],
    );
    if (!row) return null;
    return {
      sourceRecordId: str(row, 'id'),
      revision: int(row, 'revision'),
      contentHash: strOrNull(row, 'content_hash') ?? '',
      providerVersion: strOrNull(row, 'provider_version'),
      sourceModifiedAt: strOrNull(row, 'source_modified_at'),
      observedAt: str(row, 'observed_at'),
      deletedAt: strOrNull(row, 'deleted_at'),
    };
  }

  async insertSourceRecord(r: SourceRecord): Promise<void> {
    await this.#exec(
      `INSERT INTO source_records (tenant_id, id, connection_id, entity_type, external_id, revision, provider_version, etag,
         content_hash, normalized, source_modified_at, observed_at, ingested_at, deleted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        r.tenantId,
        r.id,
        r.connectionId,
        r.entityType,
        r.externalId,
        r.revision,
        r.providerVersion,
        r.etag,
        r.contentHash,
        jsonParam(r.normalized),
        r.sourceModifiedAt,
        r.observedAt,
        r.ingestedAt,
        r.deletedAt,
      ],
    );
  }

  async touchSourceRecord(sourceRecordId: string, observedAt: string): Promise<void> {
    await this.#mustUpdate(
      'UPDATE source_records SET observed_at = $3 WHERE tenant_id = $1 AND id = $2',
      [this.tenantId, sourceRecordId, observedAt],
    );
  }

  // Opportunities and facts ---------------------------------------------------
  async getOpportunity(id: string): Promise<Opportunity | null> {
    const row = await this.#one('SELECT * FROM opportunities WHERE tenant_id = $1 AND id = $2', [
      this.tenantId,
      id,
    ]);
    return row ? opportunityFrom(row) : null;
  }

  async getOpportunityByExternalId(
    connectionId: string,
    externalId: string,
  ): Promise<Opportunity | null> {
    const row = await this.#one(
      'SELECT * FROM opportunities WHERE tenant_id = $1 AND connection_id = $2 AND external_id = $3',
      [this.tenantId, connectionId, externalId],
    );
    return row ? opportunityFrom(row) : null;
  }

  async upsertOpportunity(o: Opportunity): Promise<void> {
    await this.#exec(
      `INSERT INTO opportunities (tenant_id, id, connection_id, external_id, source_record_id, revision, name, stage, fields,
         source_modified_at, observed_at, ingested_at, deleted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (tenant_id, id) DO UPDATE SET source_record_id = EXCLUDED.source_record_id, revision = EXCLUDED.revision,
         name = EXCLUDED.name, stage = EXCLUDED.stage, fields = EXCLUDED.fields, source_modified_at = EXCLUDED.source_modified_at,
         observed_at = EXCLUDED.observed_at, ingested_at = EXCLUDED.ingested_at, deleted_at = EXCLUDED.deleted_at`,
      [
        o.tenantId,
        o.id,
        o.connectionId,
        o.externalId,
        o.sourceRecordId,
        o.revision,
        o.fields.name,
        o.fields.stage,
        JSON.stringify(o.fields),
        o.sourceModifiedAt,
        o.observedAt,
        o.ingestedAt,
        o.deletedAt,
      ],
    );
  }

  async listOpportunities(
    page: PageRequest,
    filter: { includeDeleted: boolean },
  ): Promise<Page<Opportunity>> {
    const params: unknown[] = [this.tenantId, page.limit + 1];
    let where = 'tenant_id = $1';
    if (!filter.includeDeleted) where += ' AND deleted_at IS NULL';
    if (page.cursor) {
      const [name, id] = decodeCursor(page.cursor, 2);
      params.push(asString(name), asString(id));
      where += ' AND (name COLLATE "C", id::text COLLATE "C") > ($3 COLLATE "C", $4 COLLATE "C")';
    }
    const rows = (
      await this.#rows(
        `SELECT * FROM opportunities WHERE ${where} ORDER BY name COLLATE "C", id::text COLLATE "C" LIMIT $2`,
        params,
      )
    ).map(opportunityFrom);
    return pageOf(rows, page.limit, (o) => [o.fields.name, o.id]);
  }

  async listOpportunitiesForAnalysis(deletedSince: string): Promise<Opportunity[]> {
    return (
      await this.#rows(
        'SELECT * FROM opportunities WHERE tenant_id = $1 AND (deleted_at IS NULL OR deleted_at >= $2) ORDER BY id',
        [this.tenantId, deletedSince],
      )
    ).map(opportunityFrom);
  }

  async insertFacts(facts: readonly Fact[]): Promise<void> {
    if (facts.length === 0) return;
    const columns = 14;
    const values: unknown[] = [];
    const tuples = facts.map((f, i) => {
      values.push(
        f.tenantId,
        f.id,
        f.subjectType,
        f.subjectId,
        f.connectionId,
        f.sourceRecordId,
        f.sourceRevision,
        f.factType,
        f.state,
        f.state === 'present' ? JSON.stringify(f.value) : null,
        f.locator,
        f.observedAt,
        f.sourceModifiedAt,
        f.supersededAt,
      );
      return `(${Array.from({ length: columns }, (_, c) => `$${i * columns + c + 1}`).join(',')})`;
    });
    await this.#exec(
      `INSERT INTO facts (tenant_id, id, subject_type, subject_id, connection_id, source_record_id, source_revision, fact_type,
         state, value, locator, observed_at, source_modified_at, superseded_at) VALUES ${tuples.join(',')}`,
      values,
    );
  }

  async supersedeFacts(subjectId: string, at: string): Promise<void> {
    await this.#exec(
      'UPDATE facts SET superseded_at = $3 WHERE tenant_id = $1 AND subject_id = $2 AND superseded_at IS NULL',
      [this.tenantId, subjectId, at],
    );
  }

  async listCurrentFacts(subjectId: string): Promise<Fact[]> {
    return (
      await this.#rows(
        'SELECT * FROM facts WHERE tenant_id = $1 AND subject_id = $2 AND superseded_at IS NULL ORDER BY fact_type',
        [this.tenantId, subjectId],
      )
    ).map(factFrom);
  }

  async purgeConnectionData(
    connectionId: string,
  ): Promise<{ sourceRecords: number; opportunities: number; facts: number }> {
    const facts = await this.#exec(
      'DELETE FROM facts WHERE tenant_id = $1 AND connection_id = $2',
      [this.tenantId, connectionId],
    );
    const opportunities = await this.#exec(
      'DELETE FROM opportunities WHERE tenant_id = $1 AND connection_id = $2',
      [this.tenantId, connectionId],
    );
    const sourceRecords = await this.#exec(
      'DELETE FROM source_records WHERE tenant_id = $1 AND connection_id = $2',
      [this.tenantId, connectionId],
    );
    return { sourceRecords, opportunities, facts };
  }

  // Doctrine and context ------------------------------------------------------
  async getActiveDoctrine(): Promise<Doctrine | null> {
    const row = await this.#one(
      "SELECT * FROM doctrines WHERE tenant_id = $1 AND status = 'validated'",
      [this.tenantId],
    );
    return row ? doctrineFrom(row) : null;
  }

  async getDoctrine(id: string, opts?: { forUpdate?: boolean }): Promise<Doctrine | null> {
    const row = await this.#one(
      `SELECT * FROM doctrines WHERE tenant_id = $1 AND id = $2${opts?.forUpdate ? ' FOR UPDATE' : ''}`,
      [this.tenantId, id],
    );
    return row ? doctrineFrom(row) : null;
  }

  async listDoctrines(): Promise<Doctrine[]> {
    return (
      await this.#rows('SELECT * FROM doctrines WHERE tenant_id = $1 ORDER BY key, version DESC', [
        this.tenantId,
      ])
    ).map(doctrineFrom);
  }

  async insertDoctrine(d: Doctrine): Promise<void> {
    await this.#exec(
      `INSERT INTO doctrines (tenant_id, id, key, version, status, title, origin, usage_rights, content, content_hash, created_by,
         created_at, validated_by, validated_at, validation_note, retired_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        d.tenantId,
        d.id,
        d.key,
        d.version,
        d.status,
        d.title,
        d.origin,
        d.usageRights,
        JSON.stringify(d.content),
        d.contentHash,
        d.createdBy,
        d.createdAt,
        d.validatedBy,
        d.validatedAt,
        d.validationNote,
        d.retiredAt,
      ],
    );
  }

  async updateDoctrine(d: Doctrine): Promise<void> {
    await this.#mustUpdate(
      `UPDATE doctrines SET status = $3, validated_by = $4, validated_at = $5, validation_note = $6, retired_at = $7
       WHERE tenant_id = $1 AND id = $2`,
      [d.tenantId, d.id, d.status, d.validatedBy, d.validatedAt, d.validationNote, d.retiredAt],
    );
  }

  async getCurrentContext(): Promise<CompanyContext | null> {
    const row = await this.#one(
      'SELECT * FROM company_contexts WHERE tenant_id = $1 ORDER BY version DESC LIMIT 1',
      [this.tenantId],
    );
    return row ? contextFrom(row) : null;
  }

  async insertContext(c: CompanyContext): Promise<void> {
    await this.#exec(
      `INSERT INTO company_contexts (tenant_id, id, version, content, source, note, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        c.tenantId,
        c.id,
        c.version,
        JSON.stringify(c.content),
        c.source,
        c.note,
        c.createdBy,
        c.createdAt,
      ],
    );
  }

  // Recommendations ---------------------------------------------------------------
  async getRecommendation(
    id: string,
    opts?: { forUpdate?: boolean },
  ): Promise<Recommendation | null> {
    const row = await this.#one(
      `SELECT * FROM recommendations WHERE tenant_id = $1 AND id = $2${opts?.forUpdate ? ' FOR UPDATE' : ''}`,
      [this.tenantId, id],
    );
    return row ? recommendationFrom(row) : null;
  }

  async listRecommendations(
    filter: RecommendationFilter,
    page: PageRequest,
  ): Promise<Page<Recommendation>> {
    const params: unknown[] = [this.tenantId, page.limit + 1, filter.now];
    const where = ['tenant_id = $1'];
    switch (filter.view) {
      case 'open':
        where.push("status IN ('draft', 'pending') AND expires_at > $3");
        break;
      case 'decided':
        where.push("status IN ('approved', 'rejected')");
        break;
      case 'closed':
        where.push(
          "(status IN ('expired', 'superseded') OR (status IN ('draft', 'pending') AND expires_at <= $3))",
        );
        break;
      case 'all':
        break;
    }
    // $3 is always bound; reference it so its type is known for every view.
    if (filter.view === 'decided' || filter.view === 'all')
      where.push('$3::timestamptz IS NOT NULL');
    if (filter.kind) {
      params.push(filter.kind);
      where.push(`kind = $${params.length}`);
    }
    if (filter.subjectId) {
      params.push(filter.subjectId);
      where.push(`subject_id = $${params.length}`);
    }
    if (page.cursor) {
      const [priority, generatedAt, id] = decodeCursor(page.cursor, 3);
      params.push(asNumber(priority), asString(generatedAt), asString(id));
      const p = params.length;
      where.push(
        `(priority_score < $${p - 2} OR (priority_score = $${p - 2} AND (generated_at < $${p - 1} OR (generated_at = $${p - 1} AND id::text COLLATE "C" > $${p}))))`,
      );
    }
    const rows = (
      await this.#rows(
        `SELECT * FROM recommendations WHERE ${where.join(' AND ')} ORDER BY priority_score DESC, generated_at DESC, id::text COLLATE "C" LIMIT $2`,
        params,
      )
    ).map(recommendationFrom);
    return pageOf(rows, page.limit, (r) => [r.priority.score, r.generatedAt, r.id]);
  }

  async listOpenRecommendations(): Promise<Recommendation[]> {
    return (
      await this.#rows(
        "SELECT * FROM recommendations WHERE tenant_id = $1 AND status IN ('draft', 'pending') ORDER BY id",
        [this.tenantId],
      )
    ).map(recommendationFrom);
  }

  async listRecommendationsByFingerprint(
    fingerprints: readonly string[],
  ): Promise<Recommendation[]> {
    if (fingerprints.length === 0) return [];
    return (
      await this.#rows(
        'SELECT * FROM recommendations WHERE tenant_id = $1 AND fingerprint = ANY($2::text[])',
        [this.tenantId, fingerprints],
      )
    ).map(recommendationFrom);
  }

  async listRejectedSince(since: string): Promise<Recommendation[]> {
    return (
      await this.#rows(
        "SELECT * FROM recommendations WHERE tenant_id = $1 AND status = 'rejected' AND closed_at >= $2",
        [this.tenantId, since],
      )
    ).map(recommendationFrom);
  }

  async insertRecommendation(r: Recommendation): Promise<void> {
    await this.#exec(
      `INSERT INTO recommendations (tenant_id, id, subject_type, subject_id, subject_external_id, subject_label, connection_id, kind,
         rule_id, rule_version, doctrine_id, doctrine_key, doctrine_version, doctrine_origin, doctrine_fictional, context_version,
         analysis_id, status, revision, content_revision, fingerprint, priority_score, priority, title, why_now, proposed_action,
         assumptions, missing_information, formulation, generated_at, expires_at, data_as_of, max_source_age_hours, closed_at,
         closed_reason, supersedes_id, superseded_by_id, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,
         $31,$32,$33,$34,$35,$36,$37,$38)`,
      [
        r.tenantId,
        r.id,
        r.subject.type,
        r.subject.id,
        r.subject.externalId,
        r.subject.label,
        r.subject.connectionId,
        r.kind,
        r.ruleId,
        r.ruleVersion,
        r.doctrine.id,
        r.doctrine.key,
        r.doctrine.version,
        r.doctrine.origin,
        r.doctrine.fictional,
        r.contextVersion,
        r.analysisId,
        r.status,
        r.revision,
        r.contentRevision,
        r.fingerprint,
        r.priority.score,
        JSON.stringify(r.priority),
        r.title,
        r.whyNow,
        r.proposedAction,
        JSON.stringify(r.assumptions),
        JSON.stringify(r.missingInformation),
        r.formulation,
        r.generatedAt,
        r.expiresAt,
        r.dataAsOf,
        r.maxSourceAgeHours,
        r.closedAt,
        r.closedReason,
        r.supersedesId,
        r.supersededById,
        r.updatedAt,
      ],
    );
  }

  async updateRecommendation(r: Recommendation): Promise<void> {
    await this.#mustUpdate(
      `UPDATE recommendations SET status = $3, revision = $4, content_revision = $5, proposed_action = $6, formulation = $7,
         closed_at = $8, closed_reason = $9, superseded_by_id = $10, updated_at = $11
       WHERE tenant_id = $1 AND id = $2`,
      [
        r.tenantId,
        r.id,
        r.status,
        r.revision,
        r.contentRevision,
        r.proposedAction,
        r.formulation,
        r.closedAt,
        r.closedReason,
        r.supersededById,
        r.updatedAt,
      ],
    );
  }

  async insertEvidence(links: readonly EvidenceLink[]): Promise<void> {
    for (const e of links) {
      await this.#exec(
        `INSERT INTO evidence_links (tenant_id, id, recommendation_id, fact_id, source_record_id, source_revision, connection_id,
           fact_type, label, state, value, locator, material, observed_at, source_modified_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          e.tenantId,
          e.id,
          e.recommendationId,
          e.factId || null,
          e.sourceRecordId || null,
          e.sourceRevision,
          e.connectionId,
          e.factType,
          e.label,
          e.state,
          e.state === 'present' ? JSON.stringify(e.value) : null,
          e.locator,
          e.material,
          e.observedAt,
          e.sourceModifiedAt,
        ],
      );
    }
  }

  async listEvidence(recommendationId: string): Promise<EvidenceLink[]> {
    return (
      await this.#rows(
        'SELECT * FROM evidence_links WHERE tenant_id = $1 AND recommendation_id = $2 ORDER BY material DESC, fact_type',
        [this.tenantId, recommendationId],
      )
    ).map(evidenceFrom);
  }

  async insertRevision(r: RevisionRecord): Promise<void> {
    await this.#exec(
      `INSERT INTO recommendation_revisions (tenant_id, recommendation_id, content_revision, proposed_action, note, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        r.tenantId,
        r.recommendationId,
        r.contentRevision,
        r.proposedAction,
        r.note,
        r.createdBy,
        r.createdAt,
      ],
    );
  }

  async listRevisions(recommendationId: string): Promise<RevisionRecord[]> {
    return (
      await this.#rows(
        'SELECT * FROM recommendation_revisions WHERE tenant_id = $1 AND recommendation_id = $2 ORDER BY content_revision',
        [this.tenantId, recommendationId],
      )
    ).map((r) => ({
      tenantId: str(r, 'tenant_id'),
      recommendationId: str(r, 'recommendation_id'),
      contentRevision: int(r, 'content_revision'),
      proposedAction: str(r, 'proposed_action'),
      note: strOrNull(r, 'note'),
      createdBy: strOrNull(r, 'created_by'),
      createdAt: str(r, 'created_at'),
    }));
  }

  async insertDecision(d: DecisionRecord): Promise<void> {
    await this.#exec(
      `INSERT INTO decisions (tenant_id, id, recommendation_id, revision, content_revision, actor_id, decision, reason, quality, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        d.tenantId,
        d.id,
        d.recommendationId,
        d.revision,
        d.contentRevision,
        d.actorId,
        d.decision,
        d.reason,
        d.quality,
        d.createdAt,
      ],
    );
  }

  async listDecisions(recommendationId: string): Promise<DecisionRecord[]> {
    return (
      await this.#rows(
        'SELECT * FROM decisions WHERE tenant_id = $1 AND recommendation_id = $2 ORDER BY created_at, id',
        [this.tenantId, recommendationId],
      )
    ).map((r) => ({
      tenantId: str(r, 'tenant_id'),
      id: str(r, 'id'),
      recommendationId: str(r, 'recommendation_id'),
      revision: int(r, 'revision'),
      contentRevision: int(r, 'content_revision'),
      actorId: str(r, 'actor_id'),
      decision: oneOf(r, 'decision', ['approve', 'reject'] as const),
      reason: strOrNull(r, 'reason'),
      quality: r.quality === null ? null : oneOf(r, 'quality', QUALITY_LABELS),
      createdAt: str(r, 'created_at'),
    }));
  }

  async listRecommendationDigests(
    from: string,
    to: string,
    limit: number,
  ): Promise<RecommendationDigest[]> {
    return (
      await this.#rows(
        `SELECT id, kind, status, generated_at, expires_at FROM recommendations
          WHERE tenant_id = $1 AND generated_at >= $2 AND generated_at <= $3
          ORDER BY generated_at, id LIMIT $4`,
        [this.tenantId, from, to, limit],
      )
    ).map((r) => ({
      id: str(r, 'id'),
      kind: oneOf(r, 'kind', RECOMMENDATION_KINDS),
      status: oneOf(r, 'status', RECOMMENDATION_STATUSES),
      generatedAt: str(r, 'generated_at'),
      expiresAt: str(r, 'expires_at'),
    }));
  }

  async listDecisionDigests(from: string, to: string, limit: number): Promise<DecisionDigest[]> {
    return (
      await this.#rows(
        `SELECT d.recommendation_id, r.kind, d.decision, d.quality, d.created_at, r.generated_at
           FROM decisions d
           JOIN recommendations r ON r.tenant_id = d.tenant_id AND r.id = d.recommendation_id
          WHERE d.tenant_id = $1 AND d.created_at >= $2 AND d.created_at <= $3
          ORDER BY d.created_at, d.id LIMIT $4`,
        [this.tenantId, from, to, limit],
      )
    ).map((r) => ({
      recommendationId: str(r, 'recommendation_id'),
      kind: oneOf(r, 'kind', RECOMMENDATION_KINDS),
      decision: oneOf(r, 'decision', ['approve', 'reject'] as const),
      quality: r.quality === null ? null : oneOf(r, 'quality', QUALITY_LABELS),
      decidedAt: str(r, 'created_at'),
      generatedAt: str(r, 'generated_at'),
    }));
  }

  // Analyses, receipts, audit, outbox --------------------------------------------
  async insertAnalysis(a: Analysis): Promise<void> {
    await this.#exec(
      `INSERT INTO analyses (tenant_id, id, trigger, status, doctrine_id, doctrine_version, rule_versions, context_version, formulation,
         input_hash, started_at, completed_at, evaluated, generated, unchanged, closed, abstentions, usage, error_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [
        a.tenantId,
        a.id,
        a.trigger,
        a.status,
        a.doctrineId,
        a.doctrineVersion,
        JSON.stringify(a.ruleVersions),
        a.contextVersion,
        JSON.stringify(a.formulation),
        a.inputHash,
        a.startedAt,
        a.completedAt,
        a.evaluated,
        a.generated,
        a.unchanged,
        a.closed,
        JSON.stringify(a.abstentions),
        jsonParam(a.usage),
        a.errorCode,
      ],
    );
  }

  async listAnalyses(limit: number): Promise<Analysis[]> {
    return (
      await this.#rows(
        'SELECT * FROM analyses WHERE tenant_id = $1 ORDER BY started_at DESC, id DESC LIMIT $2',
        [this.tenantId, limit],
      )
    ).map(analysisFrom);
  }

  async insertModelUsage(u: ModelUsage): Promise<void> {
    await this.#exec(
      `INSERT INTO model_usage (tenant_id, id, recommendation_id, provider, model, prompt_version, input_tokens, output_tokens,
         cost_usd, latency_ms, outcome, error_code, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        u.tenantId,
        u.id,
        u.recommendationId,
        u.provider,
        u.model,
        u.promptVersion,
        u.inputTokens,
        u.outputTokens,
        u.costUsd,
        Math.round(u.latencyMs),
        u.outcome,
        u.errorCode,
        u.createdAt,
      ],
    );
  }

  async sumModelCostSince(since: string): Promise<number> {
    const row = await this.#one(
      'SELECT COALESCE(sum(cost_usd), 0)::text AS total FROM model_usage WHERE tenant_id = $1 AND created_at >= $2',
      [this.tenantId, since],
    );
    return row ? num(row, 'total') : 0;
  }

  async getReceipt(
    actorId: string,
    operation: string,
    key: string,
  ): Promise<IdempotencyReceipt | null> {
    const row = await this.#one(
      'SELECT * FROM idempotency_receipts WHERE tenant_id = $1 AND actor_id = $2 AND operation = $3 AND key = $4',
      [this.tenantId, actorId, operation, key],
    );
    if (!row) return null;
    return {
      tenantId: str(row, 'tenant_id'),
      actorId: str(row, 'actor_id'),
      operation: str(row, 'operation'),
      key: str(row, 'key'),
      requestHash: str(row, 'request_hash'),
      response: json(row, 'response'),
      createdAt: str(row, 'created_at'),
      expiresAt: str(row, 'expires_at'),
    };
  }

  async insertReceipt(r: IdempotencyReceipt): Promise<void> {
    await this.#exec(
      `INSERT INTO idempotency_receipts (tenant_id, actor_id, operation, key, request_hash, response, created_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        r.tenantId,
        r.actorId,
        r.operation,
        r.key,
        r.requestHash,
        JSON.stringify(r.response),
        r.createdAt,
        r.expiresAt,
      ],
    );
  }

  async appendAudit(e: AuditEvent): Promise<void> {
    await this.#exec(
      `INSERT INTO audit_events (tenant_id, id, actor_type, actor_id, event_type, resource_type, resource_id, revision, correlation_id,
         metadata, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        e.tenantId,
        e.id,
        e.actorType,
        e.actorId,
        e.eventType,
        e.resourceType,
        e.resourceId,
        e.revision,
        e.correlationId,
        JSON.stringify(e.metadata),
        e.createdAt,
      ],
    );
  }

  async listAudit(page: PageRequest, filter: { resourceId?: string }): Promise<Page<AuditEvent>> {
    const params: unknown[] = [this.tenantId, page.limit + 1];
    const where = ['tenant_id = $1'];
    if (filter.resourceId) {
      params.push(filter.resourceId);
      where.push(`resource_id = $${params.length}`);
    }
    if (page.cursor) {
      const [createdAt, id] = decodeCursor(page.cursor, 2);
      params.push(asString(createdAt), asString(id));
      where.push(
        `(created_at, id::text COLLATE "C") < ($${params.length - 1}::timestamptz, $${params.length} COLLATE "C")`,
      );
    }
    const rows = (
      await this.#rows(
        `SELECT * FROM audit_events WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id::text COLLATE "C" DESC LIMIT $2`,
        params,
      )
    ).map(auditFrom);
    return pageOf(rows, page.limit, (e) => [e.createdAt, e.id]);
  }

  async enqueueOutbox(e: OutboxEvent): Promise<void> {
    await this.#exec(
      `INSERT INTO outbox (tenant_id, id, event_type, subject_type, subject_id, payload, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        e.tenantId,
        e.id,
        e.eventType,
        e.subjectType,
        e.subjectId,
        JSON.stringify(e.payload),
        e.createdAt,
      ],
    );
  }

  // Members ---------------------------------------------------------------------
  async listMembers(): Promise<Member[]> {
    return (
      await this.#rows(
        `SELECT m.*, u.email, u.display_name FROM memberships m JOIN users u ON u.id = m.user_id
         WHERE m.tenant_id = $1 ORDER BY u.display_name, m.user_id`,
        [this.tenantId],
      )
    ).map(memberFrom);
  }

  async getMember(userId: string, opts?: { forUpdate?: boolean }): Promise<Member | null> {
    const row = await this.#one(
      `SELECT m.*, u.email, u.display_name FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.tenant_id = $1 AND m.user_id = $2${opts?.forUpdate ? ' FOR UPDATE OF m' : ''}`,
      [this.tenantId, userId],
    );
    return row ? memberFrom(row) : null;
  }

  async updateMember(m: Member): Promise<void> {
    await this.#mustUpdate(
      `UPDATE memberships SET role = $3, status = $4, updated_at = $5, revoked_at = $6, revoked_by = $7
       WHERE tenant_id = $1 AND user_id = $2`,
      [m.tenantId, m.userId, m.role, m.status, m.updatedAt, m.revokedAt, m.revokedBy],
    );
  }
}

function memberFrom(r: Row): Member {
  return {
    tenantId: str(r, 'tenant_id'),
    userId: str(r, 'user_id'),
    email: strOrNull(r, 'email'),
    displayName: str(r, 'display_name'),
    role: oneOf(r, 'role', ROLES),
    status: oneOf(r, 'status', ['active', 'revoked'] as const),
    createdAt: str(r, 'created_at'),
    updatedAt: str(r, 'updated_at'),
    revokedAt: strOrNull(r, 'revoked_at'),
    revokedBy: strOrNull(r, 'revoked_by'),
  };
}
