import { randomInt } from 'node:crypto';
import type { ProviderCallError } from './agent-errors.ts';

export const WORKFLOW_TIMEOUT_MS = 300_000;
export const WORKFLOW_MODEL_CALLS = 12;
export const WORKFLOW_PROVIDER_RETRIES = 2;

/** Respect the upstream minimum; never shorten a long Retry-After to fit our deadline. */
export function workflowRetryDelay(
  error: ProviderCallError,
  retries: number,
  remainingMs: number,
): number | null {
  if (
    !['provider_http_429', 'provider_http_503', 'provider_http_529'].includes(error.code) ||
    retries >= WORKFLOW_PROVIDER_RETRIES
  )
    return null;
  const delay =
    error.retryAfterSeconds === null
      ? 30_000 * 2 ** retries + randomInt(0, 1001)
      : Math.max(1000, error.retryAfterSeconds * 1000);
  return delay <= 120_000 && delay + 10_000 < remainingMs ? delay : null;
}
