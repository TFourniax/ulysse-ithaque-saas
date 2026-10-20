import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  AGENT_INSTRUCTIONS_SHA256,
  WORKFLOW_INSTRUCTIONS_SHA256,
  agentConfig,
} from '../src/agent-runtime.ts';
import {
  agentProvider,
  MAX_AGENT_CONTEXT_BYTES,
  MAX_AGENT_OUTPUT_TOKENS,
} from '../src/agent-provider.ts';
import { checkEuropeanProvider } from '../src/agent-provider-check.ts';

const hermesEnv = {
  ENABLE_FIXTURE_CONNECTOR: 'true',
  HERMES_SERVICE_TOKEN: 'x'.repeat(32),
  AGENT_MODEL_ID: 'openai/gpt-4.1-mini',
  AGENT_RUN_BUDGET_USD: '0.25',
  AGENT_SESSION_BUDGET_USD: '2',
  AGENT_MONTH_BUDGET_USD: '10',
  AGENT_SESSION_ID: 'unit-test-session',
};

test('Europe is an explicit closed route; Haiku can never use the global route', () => {
  const env = { ...hermesEnv, AGENT_MODEL_ID: 'anthropic/claude-haiku-5.5' };
  assert.throws(() => agentConfig(env), /Haiku requires/);
  assert.throws(() => agentConfig({ ...env, AGENT_PROVIDER_ROUTE: 'https://example.com' }));
  assert.throws(() => agentConfig({ ...env, AGENT_MODEL_ID: 'unreviewed/model' }));
  const config = agentConfig({ ...env, AGENT_PROVIDER_ROUTE: 'openrouter-eu-zdr' });
  assert.equal(config.AGENT_MODEL_ID, 'anthropic/claude-haiku-5.5');
  const route = agentProvider('anthropic/claude-haiku-5.5', config.AGENT_PROVIDER_ROUTE);
  assert.equal(new URL(route.url).hostname, 'eu.openrouter.ai');
  assert.deepEqual(route.provider.only, ['amazon-bedrock/eu-west-1']);
  assert.equal(route.provider.zdr, true);
  assert.equal(route.provider.data_collection, 'deny');
  assert.equal(route.provider.allow_fallbacks, false);
  assert.equal(route.provider.require_parameters, true);
  assert.equal(route.parameters.temperature, undefined);
  assert.equal(route.parameters.reasoning.enabled, false);
  // An entire eight-call run at the largest allowed input fits in the existing run cap.
  assert.ok(MAX_AGENT_CONTEXT_BYTES + 2048 < 100000);
  assert.ok(route.estimate(MAX_AGENT_CONTEXT_BYTES + 2048, MAX_AGENT_OUTPUT_TOKENS) * 8 < 0.25);
  assert.equal(route.estimate(10000, 2000), 0.0022);
  assert.equal(agentProvider('openai/gpt-4.1-mini', 'openrouter').estimate(10000, 2000), 0.0072);
  assert.equal(
    agentProvider('openai/gpt-4.1-mini', 'openrouter-eu-zdr').estimate(10000, 2000),
    0.00792,
  );
});

test('European preflight sends no inference, fails closed, and keeps credentials off the public registry', async () => {
  const model = 'anthropic/claude-haiku-5.5';
  const endpoint = {
    model_id: model,
    tag: 'amazon-bedrock/eu-west-1',
    status: 0,
    pricing: { prompt: '0.00000011', completion: '0.00000055' },
    supported_parameters: ['tools', 'tool_choice', 'max_tokens', 'reasoning'],
  };
  let calls = 0;
  let status = 200;
  const request: typeof fetch = async (url, init) => {
    calls++;
    assert.ok(init);
    assert.equal(typeof url, 'string');
    if (typeof url !== 'string') throw new Error('Expected fixed URL');
    assert.equal(init.redirect, 'error');
    assert.equal(init.body, undefined);
    if (url.endsWith('/models/user')) {
      assert.equal(new URL(url).hostname, 'eu.openrouter.ai');
      assert.equal(new Headers(init.headers).get('authorization'), 'Bearer private-test-key');
      return Response.json({ data: [{ id: model }] }, { status });
    }
    assert.equal(url, 'https://openrouter.ai/api/v1/endpoints/zdr');
    assert.equal(new Headers(init.headers).get('authorization'), null);
    return Response.json({ data: [endpoint] });
  };
  assert.equal(
    (await checkEuropeanProvider(model, 'private-test-key', request)).endpoint,
    endpoint.tag,
  );
  assert.equal(calls, 2);
  status = 403;
  await assert.rejects(checkEuropeanProvider(model, 'private-test-key', request), /HTTP 403/);
  assert.equal(calls, 3);
  status = 200;
  endpoint.tag = 'amazon-bedrock/us-east-1';
  await assert.rejects(checkEuropeanProvider(model, 'private-test-key', request), /absent/);
  endpoint.tag = 'amazon-bedrock/eu-west-1';
  endpoint.pricing.completion = '0.00000275';
  await assert.rejects(checkEuropeanProvider(model, 'private-test-key', request), /Tarif/);
});

test('live activation is explicit and fails closed before any network call', () => {
  assert.equal(agentConfig({}).ULYSSE_ANALYSIS_MODE, 'rules');
  assert.equal(
    agentConfig({ ULYSSE_ANALYSIS_MODE: 'simulated' }).ULYSSE_ANALYSIS_MODE,
    'simulated',
  );
  assert.throws(() => agentConfig({ ULYSSE_ANALYSIS_MODE: 'hermes-live' }));
  assert.throws(() => agentConfig({ ULYSSE_ANALYSIS_MODE: 'invalid' }));
  // Live needs the provider key; budgets above the demo ceilings are refused.
  assert.throws(() => agentConfig({ ...hermesEnv, ULYSSE_ANALYSIS_MODE: 'hermes-live' }));
  assert.throws(() =>
    agentConfig({
      ...hermesEnv,
      ULYSSE_ANALYSIS_MODE: 'hermes-live',
      OPENROUTER_API_KEY: 'test-only-never-transmitted',
      AGENT_RUN_BUDGET_USD: '1',
    }),
  );
  assert.throws(() =>
    agentConfig({
      ...hermesEnv,
      ULYSSE_ANALYSIS_MODE: 'hermes-live',
      OPENROUTER_API_KEY: 'test-only-never-transmitted',
      NODE_ENV: 'production',
    }),
  );
});

test('a simulated model endpoint is reserved to hermes-stub and never labelled live', () => {
  const stub = 'http://model-stub:8091/v1/chat/completions';
  assert.equal(
    agentConfig({
      ...hermesEnv,
      ULYSSE_ANALYSIS_MODE: 'hermes-stub',
      AGENT_STUB_PROVIDER_URL: stub,
    }).ULYSSE_ANALYSIS_MODE,
    'hermes-stub',
  );
  assert.throws(() => agentConfig({ ...hermesEnv, ULYSSE_ANALYSIS_MODE: 'hermes-stub' }));
  assert.throws(() =>
    agentConfig({
      ...hermesEnv,
      ULYSSE_ANALYSIS_MODE: 'hermes-stub',
      AGENT_STUB_PROVIDER_URL: 'https://example.com/v1/chat/completions',
    }),
  );
  assert.throws(() =>
    agentConfig({
      ...hermesEnv,
      ULYSSE_ANALYSIS_MODE: 'hermes-live',
      OPENROUTER_API_KEY: 'test-only-never-transmitted',
      AGENT_STUB_PROVIDER_URL: stub,
    }),
  );
});

test('the gateway expects exactly the versioned instructions shipped to Hermes', async () => {
  const text = await readFile(
    new URL('../../../services/hermes/instructions.txt', import.meta.url),
    'utf8',
  );
  assert.equal(createHash('sha256').update(text).digest('hex'), AGENT_INSTRUCTIONS_SHA256);
});

test('the workflow gateway expects its own shipped prompt', async () => {
  const text = await readFile(
    new URL('../../../services/hermes/workflows.txt', import.meta.url),
    'utf8',
  );
  assert.equal(createHash('sha256').update(text).digest('hex'), WORKFLOW_INSTRUCTIONS_SHA256);
});
