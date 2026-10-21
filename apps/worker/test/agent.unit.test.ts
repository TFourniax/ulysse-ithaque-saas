import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  AGENT_INSTRUCTIONS_SHA256,
  WORKFLOW_INSTRUCTIONS_SHA256,
  EXECUTION_CONTRACT,
  HERMES_COMMIT,
  HermesExecutor,
  agentConfig,
} from '../src/agent-runtime.ts';
import {
  agentProvider,
  MAX_AGENT_CONTEXT_BYTES,
  assertTextMessages,
  modelProfiles,
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

test('GLM keeps reasoning enabled, reserves its full output allowance and has a stable profile', () => {
  const route = agentProvider('z-ai/glm-5.3-flash', 'openrouter-eu-zdr');
  assert.deepEqual(route.parameters, {
    max_tokens: 8192,
    temperature: 1,
    top_p: 0.95,
    reasoning: { enabled: true, effort: 'low' },
  });
  assert.deepEqual(route.provider.only, ['inceptron/fp8']);
  assert.equal(route.estimate(10000, 2000), 0.00313);
  assert.ok(route.estimate(MAX_AGENT_CONTEXT_BYTES + 2048, 8192) * 8 < 0.25);
  const profile = structuredClone(route.profile);
  // A model unknown to this release needs configuration only, not another code allowlist.
  profile.model = 'example/next-model';
  const json = JSON.stringify(profile);
  const config = agentConfig({
    ...hermesEnv,
    AGENT_MODEL_ID: profile.model,
    AGENT_PROVIDER_ROUTE: profile.route,
    AGENT_MODEL_PROFILE_JSON: json,
  });
  const next = agentProvider(profile.model, profile.route, config.AGENT_MODEL_PROFILE_JSON);
  assert.equal(next.profile.model, profile.model);
  assert.notEqual(next.profileHash, route.profileHash);
  profile.generation.reasoning = 'high';
  assert.notEqual(
    agentProvider(profile.model, profile.route, JSON.stringify(profile)).profileHash,
    next.profileHash,
  );
  assert.equal(
    agentProvider(route.profile.model, route.profile.route, JSON.stringify(route.profile))
      .profileHash,
    route.profileHash,
  );
  assert.ok(modelProfiles().every((p) => p.route === 'openrouter-eu-zdr'));
  profile.capabilities.structuredOutput = false;
  const unstructured = agentProvider(profile.model, profile.route, JSON.stringify(profile));
  assert.ok(!unstructured.requiredParameters.includes('response_format'));
  assert.ok(!unstructured.requiredParameters.includes('structured_outputs'));
});

test('administrator profiles cannot smuggle secrets, URLs, plugins, fallbacks or unbounded settings', () => {
  const base = agentProvider('z-ai/glm-5.3-flash', 'openrouter-eu-zdr').profile;
  for (const invalid of [
    { ...base, baseUrl: 'https://example.com' },
    { ...base, apiKey: 'accidentally-pasted-secret' },
    { ...base, provider: { zdr: false } },
    { ...base, plugins: [{ id: 'web' }] },
    { ...base, route: 'openrouter' },
    { ...base, prices: { prompt: -1, completion: 0 } },
    { ...base, maxContextBytes: 80001 },
    { ...base, generation: { ...base.generation, maxOutputTokens: 16385 } },
    { ...base, protocol: 'unimplemented-protocol' },
  ]) {
    assert.throws(
      () => agentProvider(base.model, base.route, JSON.stringify(invalid)),
      (e: unknown) =>
        e instanceof Error &&
        e.message.startsWith('Profil modele JSON invalide') &&
        !e.message.includes('secret'),
    );
  }
  assert.throws(
    () => agentProvider('example/different', base.route, JSON.stringify(base)),
    /incompatible/,
  );
  assert.throws(
    () =>
      agentProvider(
        base.model,
        base.route,
        JSON.stringify({ ...base, capabilities: { ...base.capabilities, tools: false } }),
      ),
    /outils/,
  );
  assert.throws(() => agentProvider(base.model, base.route, '{broken'), /JSON invalide/);
});

test('declaring vision does not bypass the text-only harness or its cost boundary', () => {
  assertTextMessages([
    { role: 'user', content: 'text' },
    { role: 'assistant', content: null },
    { role: 'user', content: [{ type: 'text', text: 'excerpt' }] },
  ]);
  for (const content of [
    [{ type: 'image_url', image_url: { url: 'https://example.com/client.png' } }],
    [{ type: 'input_audio', input_audio: { data: 'AA==' } }],
    { arbitrary: 'object' },
  ])
    assert.throws(
      () => assertTextMessages([{ role: 'user', content }]),
      /unsupported_content_modality/,
    );
});

test('GLM preflight checks reasoning support, ZDR, parameters and pinned prices without inference', async () => {
  const p = agentProvider('z-ai/glm-5.3-flash', 'openrouter-eu-zdr');
  const reasoning = { mandatory: true, supported_efforts: ['low', 'high', 'max'] };
  const endpoint = {
    model_id: p.profile.model,
    tag: 'inceptron/fp8',
    status: 0,
    pricing: { prompt: '0.000000175', completion: '0.00000069' },
    supported_parameters: [...p.requiredParameters],
  };
  const request: typeof fetch = async (url, init) => {
    assert.equal(init?.body, undefined);
    if (typeof url !== 'string') throw new Error('Expected fixed URL');
    return Response.json(
      url.endsWith('/models/user')
        ? { data: [{ id: p.profile.model, reasoning }] }
        : { data: [endpoint] },
    );
  };
  assert.equal(
    (await checkEuropeanProvider(p.profile.model, 'fake-key', request)).profileHash,
    p.profileHash,
  );
  // Reproduce the VPS refusal with the previous administrator profile. A deployed override
  // must stay explicit, even when the bundled profile has been updated to the verified price.
  const oldProfile = JSON.stringify({
    ...p.profile,
    prices: { ...p.prices, prompt: 0.1 },
  });
  await assert.rejects(
    checkEuropeanProvider(p.profile.model, 'fake-key', request, oldProfile),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /entree 0\.175 \(plafond 0\.1\)/);
      assert.match(error.message, /sortie 0\.69 \(plafond 0\.69\)/);
      assert.ok(!error.message.includes('fake-key'));
      return true;
    },
  );
  // Both price dimensions remain hard routing limits, rather than being raised automatically.
  for (const field of ['prompt', 'completion'] as const) {
    const previous = endpoint.pricing[field];
    endpoint.pricing[field] = field === 'prompt' ? '0.000000176' : '0.0000007';
    await assert.rejects(checkEuropeanProvider(p.profile.model, 'fake-key', request), /Tarif/);
    endpoint.pricing[field] = previous;
  }
  assert.deepEqual(p.provider.max_price, { prompt: 0.175, completion: 0.69 });
  for (const missing of ['tools', 'response_format', 'structured_outputs']) {
    endpoint.supported_parameters = p.requiredParameters.filter((x) => x !== missing);
    await assert.rejects(checkEuropeanProvider(p.profile.model, 'fake-key', request), /parametres/);
  }
  endpoint.supported_parameters = [...p.requiredParameters];
  const disabled = JSON.stringify({
    ...p.profile,
    generation: { ...p.profile.generation, reasoning: 'disabled' },
  });
  await assert.rejects(
    checkEuropeanProvider(p.profile.model, 'fake-key', request, disabled),
    /exige le raisonnement/,
  );
  reasoning.supported_efforts = ['high', 'max'];
  await assert.rejects(checkEuropeanProvider(p.profile.model, 'fake-key', request), /Niveau/);
  reasoning.supported_efforts = ['low'];
  endpoint.status = -2;
  await assert.rejects(checkEuropeanProvider(p.profile.model, 'fake-key', request), /absent/);
});

test('Europe is an explicit closed route; Haiku can never use the global route', () => {
  const env = { ...hermesEnv, AGENT_MODEL_ID: 'anthropic/claude-haiku-5.5' };
  assert.throws(() => agentConfig(env), /Profil modele/);
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
  assert.deepEqual(route.parameters.reasoning, { enabled: false });
  // An entire eight-call run at the largest allowed input fits in the existing run cap.
  assert.ok(MAX_AGENT_CONTEXT_BYTES + 2048 < 100000);
  assert.ok(
    route.estimate(MAX_AGENT_CONTEXT_BYTES + 2048, route.profile.generation.maxOutputTokens) * 8 <
      0.25,
  );
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
    supported_parameters: [
      'tools',
      'tool_choice',
      'max_tokens',
      'reasoning',
      'response_format',
      'structured_outputs',
    ],
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
      AGENT_RUN_BUDGET_USD: '2.01',
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

test('authorized operating envelopes accept 2/20/100 USD and reject larger or invalid settings', () => {
  const env = {
    ...hermesEnv,
    ULYSSE_ANALYSIS_MODE: 'hermes-live',
    OPENROUTER_API_KEY: 'test-only-never-transmitted',
    AGENT_RUN_BUDGET_USD: '2',
    AGENT_SESSION_BUDGET_USD: '20',
    AGENT_MONTH_BUDGET_USD: '100',
  };
  const c = agentConfig(env);
  assert.deepEqual(
    [c.AGENT_RUN_BUDGET_USD, c.AGENT_SESSION_BUDGET_USD, c.AGENT_MONTH_BUDGET_USD],
    [2, 20, 100],
  );
  assert.equal(c.AGENT_SESSION_ID, hermesEnv.AGENT_SESSION_ID);
  for (const [name, limit] of [
    ['AGENT_RUN_BUDGET_USD', 2],
    ['AGENT_SESSION_BUDGET_USD', 20],
    ['AGENT_MONTH_BUDGET_USD', 100],
  ] as const)
    for (const value of ['0', '-1', 'NaN', 'Infinity', String(limit + 0.01)])
      assert.throws(() => agentConfig({ ...env, [name]: value }));
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

test('worker refuses a Hermes image that does not implement the normalized execution contract', async (t) => {
  let contract = 'ulysse-execution-v1';
  let posts = 0;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posts++;
      return Response.json({ outcome: 'abstained' });
    }
    return Response.json({
      hermesCommit: HERMES_COMMIT,
      executionContract: contract,
      instructionsSha256: AGENT_INSTRUCTIONS_SHA256,
      workflowInstructionsSha256: WORKFLOW_INSTRUCTIONS_SHA256,
    });
  });
  const executor = new HermesExecutor(agentConfig(hermesEnv));
  const request = {
    runId: 'fixture',
    subjectId: 'fixture',
    capability: 'fixture',
    model: 'z-ai/glm-5.3-flash',
    mode: 'hermes-live' as const,
    timeoutMs: 90000,
  };
  await assert.rejects(executor.execute(request), /hermes_version_mismatch/);
  assert.equal(posts, 0);
  contract = EXECUTION_CONTRACT;
  await executor.execute(request);
  assert.equal(posts, 1);
});
