import type { NormalizedRecord } from '@ulysse/domain';

/**
 * Common connector contract (UL-005). A connector reads an authorized source and
 * normalizes provider records; it never applies recommendation policy, never
 * writes to the provider and never sees another tenant's configuration.
 */
export type ConnectorKind = 'fixture' | 'live';

export type Capabilities = Readonly<{
  entities: readonly 'opportunity'[];
  /** Opaque cursor pagination; cursors are persisted only after the page is stored. */
  pagination: 'cursor';
  /** True when a completed pass returns a checkpoint for change-only reads. */
  incremental: boolean;
  /** How deletions are observed: explicit tombstones, full-scan comparison, or not at all. */
  deletions: 'tombstone' | 'full_scan' | 'none';
  /** What the provider offers to detect changes. */
  versioning: 'version' | 'etag' | 'modified_at' | 'none';
  maxPageSize: number;
  /** Declared provider quota, used to pace requests; null when unknown. */
  requestsPerMinute: number | null;
}>;

export type AuthorizationSpec =
  | Readonly<{ type: 'none'; scopes: readonly string[] }>
  | Readonly<{
      type: 'oauth2';
      scopes: readonly string[];
      authorizationUrl: string;
      tokenUrl: string;
    }>
  | Readonly<{ type: 'api_key'; scopes: readonly string[] }>;

/** Semantics of each normalized field for this provider (units, source field, meaning of empty). */
export type FieldDictionary = Readonly<
  Record<string, Readonly<{ source: string; meaning: string; unit?: string }>>
>;

export type ConnectorDefinition = Readonly<{
  provider: string;
  displayName: string;
  kind: ConnectorKind;
  capabilities: Capabilities;
  authorization: AuthorizationSpec;
  defaultSyncIntervalMinutes: number;
  fields: FieldDictionary;
  /** Validates and returns non-secret configuration. */
  validateConfig(config: unknown): Readonly<Record<string, string | number | boolean>>;
}>;

export type ConnectorContext = Readonly<{
  tenantId: string;
  connectionId: string;
  config: Readonly<Record<string, string | number | boolean>>;
  /** Resolved server-side from `credentialRef`; never sent to a browser or a model. */
  credential: Readonly<{ type: 'none' } | { type: 'secret'; value: string }>;
  signal: AbortSignal;
}>;

/** Provider record as received; kept in memory only long enough to normalize it. */
export type RawRecord = Readonly<{
  externalId: string;
  providerVersion: string | null;
  etag: string | null;
  modifiedAt: string | null;
  deleted: boolean;
  payload: unknown;
}>;

export type PullRequest = Readonly<{ cursor: string | null; pageSize: number }>;

export type PullResult = Readonly<{
  records: readonly RawRecord[];
  /**
   * When `complete` is false: continuation of the current pass.
   * When `complete` is true: checkpoint for the next run (null = next run re-reads everything).
   */
  nextCursor: string | null;
  complete: boolean;
}>;

export type NormalizationResult =
  Readonly<{ ok: true; record: NormalizedRecord }> | Readonly<{ ok: false; reason: string }>;

export const CONNECTOR_ERROR_CODES = [
  'auth_revoked',
  'permission_denied',
  'misconfigured',
  'rate_limited',
  'quota_exceeded',
  'transient',
  'invalid_cursor',
  'provider_unavailable',
] as const;
export type ConnectorErrorCode = (typeof CONNECTOR_ERROR_CODES)[number];

const TERMINAL: ReadonlySet<ConnectorErrorCode> = new Set([
  'auth_revoked',
  'permission_denied',
  'misconfigured',
]);

/** Errors carry an actionable code and no provider payload. */
export class ConnectorError extends Error {
  readonly code: ConnectorErrorCode;
  readonly retryAfterSeconds: number | null;

  constructor(code: ConnectorErrorCode, message: string, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = 'ConnectorError';
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }

  /** Terminal errors need a human (re-authorization, configuration); retrying is pointless. */
  get terminal(): boolean {
    return TERMINAL.has(this.code);
  }
}

export type ConnectionCheck =
  Readonly<{ ok: true; detail: string }> | Readonly<{ ok: false; error: ConnectorError }>;

export interface Connector {
  readonly definition: ConnectorDefinition;
  validateConnection(ctx: ConnectorContext): Promise<ConnectionCheck>;
  pullPage(ctx: ConnectorContext, request: PullRequest): Promise<PullResult>;
  /** Pure and deterministic: same raw record → same normalized record. */
  normalize(raw: RawRecord): NormalizationResult;
  /** Releases provider-side grants when the provider supports it. */
  revoke(ctx: ConnectorContext): Promise<void>;
}
