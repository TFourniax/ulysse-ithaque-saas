import type { Role } from './context.ts';
import type { FactType, FactValue, OpportunityFields } from './opportunity.ts';

export const CONNECTION_STATUSES = ['active', 'paused', 'error', 'revoked'] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export type Connection = Readonly<{
  tenantId: string;
  id: string;
  provider: string;
  displayName: string;
  status: ConnectionStatus;
  /** Non-secret configuration only. Secrets live behind `credentialRef`. */
  config: Readonly<Record<string, string | number | boolean>>;
  credentialRef: string | null;
  grantedScopes: readonly string[];
  syncIntervalMinutes: number;
  /** Provider checkpoint; advanced only in the transaction that persisted the page. */
  cursor: string | null;
  /** Start of the current, not yet completed, read pass (survives interrupted runs). */
  passStartedAt: string | null;
  lastSyncStartedAt: string | null;
  lastSuccessAt: string | null;
  /** Start time of the last successful complete sync: records are confirmed current as of this instant. */
  dataAsOf: string | null;
  lastErrorCode: string | null;
  lastErrorAt: string | null;
  consecutiveFailures: number;
  nextSyncAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
}>;

export const SYNC_TRIGGERS = ['initial', 'scheduled', 'manual', 'replay'] as const;
export type SyncTrigger = (typeof SYNC_TRIGGERS)[number];

export type SyncRun = Readonly<{
  tenantId: string;
  id: string;
  connectionId: string;
  trigger: SyncTrigger;
  status: 'running' | 'succeeded' | 'failed' | 'cancelled';
  startedAt: string;
  completedAt: string | null;
  pages: number;
  seen: number;
  created: number;
  revised: number;
  unchanged: number;
  deleted: number;
  stale: number;
  rejected: number;
  cursorStart: string | null;
  cursorEnd: string | null;
  /** Minimized, payload-free error code and message. */
  errorCode: string | null;
  errorDetail: string | null;
}>;

export type SourceRecord = Readonly<{
  tenantId: string;
  id: string;
  connectionId: string;
  entityType: 'opportunity';
  externalId: string;
  revision: number;
  providerVersion: string | null;
  etag: string | null;
  contentHash: string | null;
  normalized: OpportunityFields | null;
  sourceModifiedAt: string | null;
  observedAt: string;
  ingestedAt: string;
  deletedAt: string | null;
}>;

export type Fact = Readonly<{
  tenantId: string;
  id: string;
  subjectType: 'opportunity';
  subjectId: string;
  connectionId: string;
  sourceRecordId: string;
  sourceRevision: number;
  factType: FactType;
  state: FactValue['state'];
  value: unknown;
  locator: string;
  observedAt: string;
  sourceModifiedAt: string | null;
  supersededAt: string | null;
}>;

export type AuditEvent = Readonly<{
  tenantId: string;
  id: string;
  actorType: 'user' | 'service';
  actorId: string;
  eventType: string;
  resourceType: string;
  resourceId: string;
  revision: number | null;
  correlationId: string;
  /** Identifiers and counters only: never source content, tokens or free text from sources. */
  metadata: Readonly<Record<string, string | number | boolean | null>>;
  createdAt: string;
}>;

export const OUTBOX_EVENTS = [
  'source.changed',
  'connection.sync_requested',
  'connection.revoked',
  'recommendation.generated',
  'recommendation.decided',
  'doctrine.changed',
  'context.changed',
] as const;
export type OutboxEventType = (typeof OUTBOX_EVENTS)[number];

export type OutboxEvent = Readonly<{
  tenantId: string;
  id: string;
  eventType: OutboxEventType;
  subjectType: string;
  subjectId: string;
  payload: Readonly<Record<string, string | number | boolean | null>>;
  createdAt: string;
}>;

export type AnalysisTrigger = 'source_change' | 'scheduled' | 'manual' | 'doctrine_change';

export type Analysis = Readonly<{
  tenantId: string;
  id: string;
  trigger: AnalysisTrigger;
  status: 'completed' | 'failed' | 'skipped';
  doctrineId: string | null;
  doctrineVersion: number | null;
  ruleVersions: Readonly<Record<string, string>>;
  contextVersion: number | null;
  formulation: Readonly<{ provider: string; model: string | null; promptVersion: string | null }>;
  inputHash: string;
  startedAt: string;
  completedAt: string;
  evaluated: number;
  generated: number;
  unchanged: number;
  closed: number;
  abstentions: Readonly<Record<string, number>>;
  usage: Readonly<{
    inputTokens: number;
    outputTokens: number;
    costUsd: number | null;
    calls: number;
    failures: number;
  }> | null;
  errorCode: string | null;
}>;

export type IdempotencyReceipt = Readonly<{
  tenantId: string;
  actorId: string;
  operation: string;
  key: string;
  requestHash: string;
  response: unknown;
  createdAt: string;
  expiresAt: string;
}>;

export type Member = Readonly<{
  tenantId: string;
  userId: string;
  email: string | null;
  displayName: string;
  role: Role;
  status: 'active' | 'revoked';
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
}>;

export type Page<T> = Readonly<{ items: readonly T[]; nextCursor: string | null }>;
export type PageRequest = Readonly<{ limit: number; cursor: string | null }>;
