/**
 * Stable business error codes. API and worker adapters map them to transport
 * statuses (see docs/DATA-API.md). Codes are part of the public contract:
 * rename only with a migration note in the ADR log.
 */
export const DOMAIN_ERROR_CODES = [
  'INVALID_INPUT',
  'INVALID_CONTEXT',
  'INVALID_ROLE',
  'INVALID_TIMESTAMP',
  'INVALID_VERSION',
  'INVALID_POLICY',
  'INVALID_DECISION',
  'INVALID_REVISION',
  'INVALID_TIMELINE',
  'INVALID_TRANSITION',
  'FORBIDDEN',
  'NOT_FOUND',
  'TENANT_MISMATCH',
  'FUTURE_SOURCE',
  'SOURCE_VERSION_REGRESSION',
  'SOURCE_VERSION_CONFLICT',
  'SOURCE_TIME_REGRESSION',
  'REVISION_CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'ALREADY_DECIDED',
  'EXPIRED',
  'STALE_EVIDENCE',
  'CONNECTION_INACTIVE',
  'DOCTRINE_NOT_VALIDATED',
  'DOCTRINE_RIGHTS',
] as const;

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly detail: string | undefined;

  constructor(code: DomainErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'DomainError';
    this.code = code;
    this.detail = detail;
  }
}

export function ensure(
  condition: unknown,
  code: DomainErrorCode,
  detail?: string,
): asserts condition {
  if (!condition) throw new DomainError(code, detail);
}

export function isDomainError(value: unknown, code?: DomainErrorCode): value is DomainError {
  return value instanceof DomainError && (code === undefined || value.code === code);
}
