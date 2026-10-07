import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { AGENT_INSTRUCTIONS_SHA256, agentConfig } from '../src/agent-runtime.ts';

const hermesEnv = {
  ENABLE_FIXTURE_CONNECTOR: 'true',
  HERMES_SERVICE_TOKEN: 'x'.repeat(32),
  AGENT_MODEL_ID: 'openai/gpt-4.1-mini',
  AGENT_RUN_BUDGET_USD: '0.25',
  AGENT_SESSION_BUDGET_USD: '2',
  AGENT_MONTH_BUDGET_USD: '10',
  AGENT_SESSION_ID: 'unit-test-session',
};

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
