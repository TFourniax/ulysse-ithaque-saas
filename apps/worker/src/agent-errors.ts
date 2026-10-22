import { isDomainError } from '@ulysse/domain';
import type { ReadableStreamReadResult } from 'node:stream/web';

/** Only fixed codes cross the log/database boundary; provider messages may contain client text. */
export class ProviderCallError extends Error {
  readonly code: string;
  readonly httpStatus: number | null;
  readonly retryAfterSeconds: number | null;
  constructor(code: string, httpStatus: number | null, retryAfterSeconds: number | null = null) {
    super(code);
    this.name = 'ProviderCallError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}
function providerError(
  status: number,
  payload: unknown,
  retryAfter: string | null,
): ProviderCallError {
  const error = object(object(payload)?.error);
  const code =
    status === 200 &&
    typeof error?.code === 'number' &&
    Number.isInteger(error.code) &&
    error.code >= 400 &&
    error.code <= 599
      ? error.code
      : status;
  // Recognize this documented refusal without storing or returning the upstream message.
  if (
    code === 403 &&
    typeof error?.message === 'string' &&
    error.message.startsWith('Regional routing requires a Business or Enterprise plan.')
  )
    return new ProviderCallError('provider_region_plan_required', status);
  return new ProviderCallError(
    code >= 400 ? `provider_http_${code}` : 'provider_response_error',
    status,
    [429, 503].includes(code) ? retryAfterSeconds(retryAfter) : null,
  );
}
function retryAfterSeconds(raw: string | null): number | null {
  if (!raw || raw.length > 100) return null;
  const value = /^\d+$/u.test(raw) ? Number(raw) : (Date.parse(raw) - Date.now()) / 1000;
  return Number.isFinite(value) && value >= 0 ? Math.ceil(value) : null;
}
async function boundedBody(response: Response, maximum: number): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  let size = 0;
  let text = '';
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const part: ReadableStreamReadResult<unknown> = await reader.read();
      if (part.done) break;
      const value = part.value;
      if (!(value instanceof Uint8Array)) return null;
      size += value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw new ProviderCallError('provider_response_too_large', response.status);
      }
      text += decoder.decode(value, { stream: true });
    }
    const value: unknown = JSON.parse(text + decoder.decode());
    return value;
  } catch (error) {
    if (error instanceof ProviderCallError) throw error;
    if (error instanceof SyntaxError) return null;
    throw new ProviderCallError(
      error instanceof Error && error.name === 'TimeoutError'
        ? 'provider_timeout'
        : 'provider_transport_error',
      response.status,
    );
  } finally {
    reader.releaseLock();
  }
}

/** Single transmission, no retry or fallback. The caller retains its financial reservation. */
export async function fetchAgentCompletion(
  url: string,
  init: RequestInit,
  request: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await request(url, init);
  } catch (error) {
    throw new ProviderCallError(
      error instanceof Error && error.name === 'TimeoutError'
        ? 'provider_timeout'
        : 'provider_transport_error',
      null,
    );
  }
  if (!response.ok)
    throw providerError(
      response.status,
      await boundedBody(response, 16384).catch(() => null),
      response.headers.get('retry-after'),
    );
  // Includes opaque reasoning. Bound even an HTTP 200 body before JSON parsing.
  const value = await boundedBody(response, 512000);
  const payload = object(value);
  if (!payload) throw new ProviderCallError('provider_invalid_response', response.status);
  if (payload.error !== undefined && payload.error !== null)
    throw providerError(response.status, payload, response.headers.get('retry-after'));
  return payload;
}

/** Preserve transient HTTP semantics for Hermes, without exposing upstream text. */
export function providerGatewayFailure(error: unknown) {
  const statuses: Record<string, number> = {
    provider_http_429: 429,
    provider_http_500: 500,
    provider_http_502: 502,
    provider_http_503: 503,
    provider_http_504: 504,
    provider_timeout: 504,
    provider_transport_error: 502,
  };
  const status = error instanceof ProviderCallError ? (statuses[error.code] ?? 403) : 403;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (error instanceof ProviderCallError && status === 429 && error.retryAfterSeconds !== null)
    headers['retry-after'] = String(error.retryAfterSeconds);
  return {
    status,
    headers,
    body: {
      error: {
        code: status,
        message:
          status === 403
            ? 'execution unavailable, invalid or limited'
            : 'provider temporarily unavailable',
        type:
          status === 429
            ? 'rate_limit_error'
            : status === 403
              ? 'permission_error'
              : 'server_error',
      },
    },
  };
}

export type WorkflowStage = 'execution' | 'result' | 'publication';
export function workflowFailure(error: unknown, stage: WorkflowStage): string {
  if (isDomainError(error, 'STALE_EVIDENCE')) return 'versions_changed';
  if (stage === 'result') return 'result_invalid';
  if (stage === 'publication') {
    if (isDomainError(error)) {
      const reasons: Record<string, string> = {
        'required source unread': 'required_source_unread',
        'unretrieved citation': 'unretrieved_citation',
        'offer evidence required': 'offer_evidence_missing',
        'competitor evidence required': 'competitor_evidence_missing',
        'comparison offer evidence required': 'comparison_evidence_missing',
        'uniqueness without benchmark': 'uniqueness_without_benchmark',
      };
      return Object.hasOwn(reasons, error.detail ?? '')
        ? (reasons[error.detail ?? ''] ?? 'publication_refused')
        : 'publication_refused';
    }
    return 'workflow_internal_error';
  }
  if (error instanceof ProviderCallError) return error.code;
  if (error instanceof Error) {
    if (/^hermes_http_[1-5]\d{2}$|^hermes_version_mismatch$/.test(error.message))
      return error.message;
    if (error.name === 'TimeoutError') return 'hermes_timeout';
  }
  return 'hermes_execution_failed';
}
