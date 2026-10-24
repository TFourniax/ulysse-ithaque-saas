import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DomainError } from '@ulysse/domain';
import {
  fetchAgentCompletion,
  ProviderCallError,
  workflowFailure,
  providerGatewayFailure,
} from '../src/agent-errors.ts';

test('a native prefix signature refusal has a fixed diagnostic without upstream client text', async () => {
  await assert.rejects(
    fetchAgentCompletion('https://example.invalid', {}, async () =>
      Response.json(
        {
          error: {
            message:
              'messages.1.content.0: Invalid `signature` in `thinking` block. The block is bound to a different conversation. private fixture',
          },
        },
        { status: 400 },
      ),
    ),
    (error: unknown) =>
      error instanceof ProviderCallError &&
      error.code === 'provider_signature_mismatch' &&
      error.httpStatus === 400 &&
      !JSON.stringify(error).includes('private fixture'),
  );
});

test('Hermes receives real transient statuses and sanitized Retry-After; permission failures stay closed', () => {
  for (const status of [429, 500, 502, 503, 504]) {
    const failure = providerGatewayFailure(
      new ProviderCallError(`provider_http_${status}`, status, 30),
    );
    assert.equal(failure.status, status);
    assert.equal(failure.body.error.code, status);
    if (status === 429) assert.equal(failure.headers['retry-after'], '30');
  }
  assert.equal(providerGatewayFailure(new ProviderCallError('provider_http_429', 200)).status, 429);
  assert.equal(providerGatewayFailure(new ProviderCallError('provider_timeout', null)).status, 504);
  const refused = providerGatewayFailure(new Error('private-client-value'));
  assert.equal(refused.status, 403);
  assert.ok(!JSON.stringify(refused).includes('private-client-value'));
});

test('an oversized HTTP 200 stream is cancelled before unbounded allocation or JSON parsing', async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(512001));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    fetchAgentCompletion('https://example.invalid', {}, async () => new Response(stream)),
    /provider_response_too_large/,
  );
  assert.equal(cancelled, true);
});

test('a timeout while reading an HTTP 200 body remains recoverable and never exposes the exception text', async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new DOMException('private-provider-detail', 'TimeoutError'));
    },
  });
  await assert.rejects(
    fetchAgentCompletion('https://example.invalid', {}, async () => new Response(stream)),
    (error: unknown) =>
      error instanceof ProviderCallError &&
      error.code === 'provider_timeout' &&
      !String(error).includes('private'),
  );
});

test('provider refusals retain a safe status and never the response message or metadata', async () => {
  for (const status of [400, 401, 402, 403, 429, 502, 503]) {
    let calls = 0;
    const request: typeof fetch = async () => {
      calls++;
      return Response.json(
        {
          error: { code: status, message: 'private-client-text', metadata: { raw: 'private-key' } },
        },
        { status },
      );
    };
    await assert.rejects(
      fetchAgentCompletion('https://example.invalid', {}, request),
      (e: unknown) => {
        assert.ok(e instanceof ProviderCallError);
        assert.equal(e.code, `provider_http_${status}`);
        assert.equal(e.httpStatus, status);
        assert.ok(!JSON.stringify(e).includes('private'));
        assert.ok(!String(e).includes('private'));
        return true;
      },
    );
    assert.equal(calls, 1);
  }
});
test('the regional plan refusal is recognized without returning the upstream text', async () => {
  const request: typeof fetch = async () =>
    Response.json(
      {
        error: {
          code: 403,
          message: 'Regional routing requires a Business or Enterprise plan. private-text',
        },
      },
      { status: 403 },
    );
  await assert.rejects(
    fetchAgentCompletion('https://example.invalid', {}, request),
    /provider_region_plan_required/,
  );
});
test('rate limits preserve a numeric Retry-After without exposing provider data', async () => {
  for (const [header, expected] of [
    ['120', 120],
    ['-1', null],
    ['private-header', null],
    ['999999', 999999],
  ] as const) {
    await assert.rejects(
      fetchAgentCompletion('https://example.invalid', {}, async () =>
        Response.json(
          { error: { message: 'private' } },
          { status: 429, headers: { 'retry-after': header } },
        ),
      ),
      (error: unknown) => {
        assert.ok(error instanceof ProviderCallError);
        assert.equal(error.retryAfterSeconds, expected);
        assert.ok(!JSON.stringify(error).includes('private'));
        return true;
      },
    );
  }
  const future = new Date(Date.now() + 120000).toUTCString();
  await assert.rejects(
    fetchAgentCompletion(
      'https://example.invalid',
      {},
      async () => new Response('', { status: 503, headers: { 'retry-after': future } }),
    ),
    (error: unknown) => {
      assert.ok(error instanceof ProviderCallError);
      assert.ok(
        error.retryAfterSeconds !== null &&
          error.retryAfterSeconds >= 119 &&
          error.retryAfterSeconds <= 120,
      );
      return true;
    },
  );
});
test('HTML and oversized error bodies retain HTTP status; error reads are bounded', async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode('s'.repeat(16385)));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    fetchAgentCompletion(
      'https://example.invalid',
      {},
      async () => new Response(stream, { status: 503 }),
    ),
    /provider_http_503/,
  );
  assert.equal(cancelled, true);
  await assert.rejects(
    fetchAgentCompletion(
      'https://example.invalid',
      {},
      async () => new Response('<html>private</html>', { status: 502 }),
    ),
    /provider_http_502/,
  );
});
test('HTTP 200 errors are refused, malformed success is explicit, and success usage is preserved', async () => {
  await assert.rejects(
    fetchAgentCompletion('https://example.invalid', {}, async () =>
      Response.json({ error: { code: 429, message: 'private' } }),
    ),
    /provider_http_429/,
  );
  await assert.rejects(
    fetchAgentCompletion('https://example.invalid', {}, async () =>
      Response.json({ error: { message: 'private' } }),
    ),
    /provider_response_error/,
  );
  await assert.rejects(
    fetchAgentCompletion('https://example.invalid', {}, async () => new Response('invalid')),
    /provider_invalid_response/,
  );
  const result = { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.001 } };
  assert.deepEqual(
    await fetchAgentCompletion('https://example.invalid', {}, async () => Response.json(result)),
    result,
  );
});
test('transport and timeout errors are classified without leaking exception details or retrying', async () => {
  for (const name of ['TypeError', 'TimeoutError']) {
    let calls = 0;
    const request: typeof fetch = () => {
      calls++;
      const error = new Error('private-key');
      error.name = name;
      return Promise.reject(error);
    };
    await assert.rejects(
      fetchAgentCompletion('https://example.invalid', {}, request),
      new RegExp(name === 'TimeoutError' ? 'provider_timeout' : 'provider_transport_error'),
    );
    assert.equal(calls, 1);
  }
});
test('workflow diagnostics distinguish execution, schema and evidence without arbitrary details', () => {
  assert.equal(
    workflowFailure(
      new DomainError('INVALID_INPUT', 'available research benchmark ignored'),
      'publication',
    ),
    'benchmark_missing',
  );
  assert.equal(
    workflowFailure(new DomainError('INVALID_INPUT', 'incomplete brief'), 'publication'),
    'brief_incomplete',
  );
  assert.equal(workflowFailure(new Error('hermes_http_504'), 'execution'), 'hermes_http_504');
  assert.equal(workflowFailure(new Error('private-key'), 'execution'), 'hermes_execution_failed');
  assert.equal(workflowFailure(new Error('private-output'), 'result'), 'result_invalid');
  assert.equal(
    workflowFailure(new DomainError('INVALID_INPUT', 'required source unread'), 'publication'),
    'required_source_unread',
  );
  assert.equal(
    workflowFailure(new DomainError('INVALID_INPUT', 'private-output'), 'publication'),
    'publication_refused',
  );
  assert.equal(
    workflowFailure(new DomainError('STALE_EVIDENCE'), 'publication'),
    'versions_changed',
  );
});
