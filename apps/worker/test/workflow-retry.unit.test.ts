import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProviderCallError } from '../src/agent-errors.ts';
import { workflowRetryDelay, WORKFLOW_TIMEOUT_MS } from '../src/workflow-retry.ts';

test('workflow retries only 429/503, with increasing waits and a global two-retry ceiling', () => {
  for (const code of [429, 503]) {
    const error = new ProviderCallError(`provider_http_${code}`, code);
    for (const [count, minimum] of [
      [0, 30_000],
      [1, 60_000],
    ] as const) {
      const delay = workflowRetryDelay(error, count, WORKFLOW_TIMEOUT_MS);
      assert.ok(delay !== null && delay >= minimum && delay <= minimum + 1000);
    }
    assert.equal(workflowRetryDelay(error, 2, WORKFLOW_TIMEOUT_MS), null);
  }
  for (const code of [
    'provider_http_400',
    'provider_http_402',
    'provider_http_403',
    'provider_http_500',
    'provider_timeout',
    'provider_transport_error',
    'result_schema_invalid',
  ])
    assert.equal(
      workflowRetryDelay(new ProviderCallError(code, null), 0, WORKFLOW_TIMEOUT_MS),
      null,
    );
});

test('Retry-After is a minimum, never shortened to fit a deadline; leave time for the resumed call', () => {
  const error = (seconds: number) => new ProviderCallError('provider_http_429', 429, seconds);
  assert.equal(workflowRetryDelay(error(60), 0, WORKFLOW_TIMEOUT_MS), 60_000);
  assert.equal(workflowRetryDelay(error(0), 0, WORKFLOW_TIMEOUT_MS), 1000);
  assert.equal(workflowRetryDelay(error(120), 0, WORKFLOW_TIMEOUT_MS), 120_000);
  assert.equal(workflowRetryDelay(error(121), 0, WORKFLOW_TIMEOUT_MS), null);
  assert.equal(workflowRetryDelay(error(3600), 0, WORKFLOW_TIMEOUT_MS), null);
  assert.equal(workflowRetryDelay(error(60), 0, 70_000), null);
  assert.equal(workflowRetryDelay(error(0), 0, 10_000), null);
});
