import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { agentConfig } from '../src/agent-runtime.ts';
import { agentProvider } from '../src/agent-provider.ts';
import { checkAnthropicProvider } from '../src/agent-provider-check.ts';
import {
  acceptAnthropicRequest,
  anthropicRequest,
  anthropicCompletion,
  nativeResult,
  anthropicSchema,
} from '../src/anthropic-provider.ts';
import { createResearchModel, ResearchModelError } from '../src/research-model.ts';
import { inspectWorkflowCompletion } from '../src/workflow-response.ts';

const profile = agentProvider('claude-sonnet-5-5', 'anthropic');
const env = {
  ENABLE_FIXTURE_CONNECTOR: 'true',
  ULYSSE_ANALYSIS_MODE: 'hermes-live',
  HERMES_SERVICE_TOKEN: 'x'.repeat(32),
  ANTHROPIC_API_KEY: 'sk-ant-fixture-not-a-real-key',
  AGENT_MODEL_ID: 'claude-sonnet-5-5',
  AGENT_PROVIDER_ROUTE: 'anthropic',
  AGENT_RUN_BUDGET_USD: '2',
  AGENT_SESSION_BUDGET_USD: '20',
  AGENT_MONTH_BUDGET_USD: '100',
  AGENT_SESSION_ID: 'native-test',
};
const use = { type: 'tool_use', id: 'tool_1', name: 'get_workflow_context', input: {} };
const blocks = [
  { type: 'thinking', thinking: 'test-only', signature: 'opaque-unchanged' },
  use,
  { type: 'redacted_thinking', data: 'opaque-redacted' },
];
const native = {
  model: profile.profile.model,
  max_tokens: 2,
  system: 'Instructions',
  messages: [
    { role: 'user', content: 'Request' },
    { role: 'assistant', content: blocks },
    {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: use.id, content: 'Untrusted data' }],
    },
  ],
  tools: [
    {
      name: use.name,
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
    },
  ],
};

test('Anthropic activation requires its own key, native model/profile and fixed URL; no cross-provider fallback', () => {
  const c = agentConfig(env);
  assert.equal(c.OPENROUTER_API_KEY, undefined);
  assert.equal(profile.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(profile.executionSettings.protocol, 'anthropic-messages');
  for (const patch of [
    { ANTHROPIC_API_KEY: '', OPENROUTER_API_KEY: 'wrong-provider-key' },
    { AGENT_FALLBACK_MODEL_ID: 'mistralai/mistral-small-2603' },
    { AGENT_PROVIDER_ROUTE: 'openrouter-eu-zdr' },
    { AGENT_MODEL_ID: 'anthropic/claude-sonnet-5-5' },
    { AGENT_MODEL_PROFILE_JSON: JSON.stringify({ ...profile.profile, endpoint: 'example' }) },
  ])
    assert.throws(() => agentConfig({ ...env, ...patch }));
});

test('native block order and signatures survive authorization normalization, tools and server-owned limits', () => {
  const normalized = acceptAnthropicRequest(native);
  const sent = anthropicRequest(profile.profile, {
    messages: z.array(z.record(z.string(), z.unknown())).parse(normalized.messages),
    tools: normalized.tools,
  });
  assert.deepEqual(sent.messages, native.messages);
  assert.equal(sent.max_tokens, 16384);
  assert.equal(sent.provider, undefined);
  assert.equal(sent.response_format, undefined);
  assert.equal(sent.temperature, undefined);
  assert.deepEqual(sent.thinking, { type: 'adaptive' });
  assert.deepEqual(sent.output_config, { effort: 'medium' });
  assert.deepEqual(JSON.parse(JSON.stringify(sent.tools)), native.tools);
  for (const patch of [
    { stream: true },
    { metadata: { user_id: 'not-authorized' } },
    { tools: [{ type: 'web_search_20250305', name: 'web_search' }] },
    {
      messages: [
        {
          role: 'user',
          content: [{ type: 'image', source: { type: 'url', url: 'https://example.com/private' } }],
        },
      ],
    },
    { system: [{ type: 'text', text: 'x', cache_control: { type: 'ephemeral', ttl: '1h' } }] },
  ])
    assert.throws(
      () => acceptAnthropicRequest({ ...native, ...patch }),
      /provider_protocol_invalid/,
    );
});

test('native format repair keeps empty signed thinking and tool definitions while disabling new tool calls', () => {
  const content = [
    { type: 'thinking', thinking: '', signature: 'prefix-bound-fixture' },
    { type: 'text', text: 'invalid-json', citations: null },
  ];
  const inspected = inspectWorkflowCompletion(
    anthropicCompletion(
      {
        content,
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 10 },
      },
      profile.profile,
    ),
    'buyer',
  );
  assert.equal(inspected?.diagnostics.code, 'result_json_invalid');
  assert.deepEqual(
    inspected.assistant.anthropic_content,
    content.map(({ citations: _ignored, ...b }) => b),
  );
  const normalized = acceptAnthropicRequest(native);
  const sent = anthropicRequest(profile.profile, {
    messages: z.array(z.record(z.string(), z.unknown())).parse(normalized.messages),
    tools: normalized.tools,
    disableTools: true,
  });
  assert.deepEqual(sent.tool_choice, { type: 'none' });
  assert.deepEqual(JSON.parse(JSON.stringify(sent.tools)), native.tools);
});

test('native usage accounts input/output and both cache operations without claiming API-reported USD', () => {
  const raw = {
    id: 'msg_fixture',
    type: 'message',
    role: 'assistant',
    model: profile.profile.model,
    content: blocks,
    stop_reason: 'tool_use',
    usage: {
      input_tokens: 1000,
      output_tokens: 500,
      cache_creation_input_tokens: 2000,
      cache_read_input_tokens: 3000,
    },
  };
  const normalized = anthropicCompletion(raw, profile.profile);
  assert.equal(nativeResult(normalized), raw);
  assert.deepEqual(normalized.usage, {
    prompt_tokens: 6000,
    completion_tokens: 500,
    estimated_cost: 0.0123,
  });
  assert.ok(profile.reserve(6000, 500) >= 0.0123);
  const output = anthropicCompletion(
    { ...raw, content: [{ type: 'text', text: '{}', citations: null }], stop_reason: 'refusal' },
    profile.profile,
  );
  assert.equal(
    z.object({ choices: z.array(z.object({ finish_reason: z.string() })) }).parse(output).choices[0]
      ?.finish_reason,
    'content_filter',
  );
});

test('native decoder receives supported constraints; original field limits remain available as descriptions', () => {
  const input = {
    type: 'object',
    properties: {
      maxLength: { type: 'string', maxLength: 80 },
      points: { type: 'array', maxItems: 5, items: { type: 'integer', minimum: 1 } },
    },
    additionalProperties: false,
  };
  const normalized = anthropicSchema(input);
  const text = JSON.stringify(normalized);
  assert.ok(text.includes('Constraints checked by Ulysse'));
  const parsed = z
    .object({
      properties: z.object({
        maxLength: z
          .object({ type: z.literal('string') })
          .strict()
          .extend({ description: z.string() }),
      }),
      additionalProperties: z.literal(false),
    })
    .parse(normalized);
  assert.equal(parsed.properties.maxLength.type, 'string');
  assert.equal(input.properties.maxLength.maxLength, 80);
});

test('Anthropic preflight checks the selected model with no inference and sanitized failures', async () => {
  let calls = 0;
  const request: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(url, 'https://api.anthropic.com/v1/models/claude-sonnet-5-5');
    assert.equal(init?.body, undefined);
    assert.equal(init?.redirect, 'error');
    assert.equal(new Headers(init.headers).get('x-api-key'), env.ANTHROPIC_API_KEY);
    assert.equal(new Headers(init.headers).get('authorization'), null);
    return Response.json({ id: profile.profile.model });
  };
  assert.equal(
    (await checkAnthropicProvider(profile.profile.model, env.ANTHROPIC_API_KEY, request)).route,
    'anthropic',
  );
  assert.equal(calls, 1);
  await assert.rejects(
    checkAnthropicProvider(profile.profile.model, env.ANTHROPIC_API_KEY, async () =>
      Response.json({ error: { message: env.ANTHROPIC_API_KEY } }, { status: 401 }),
    ),
    /^ProviderCallError: provider_http_401$/,
  );
});

test('research uses native structured output without unsupported forced tools; malformed output retains token costs', async (t) => {
  let malformed = false;
  t.mock.method(globalThis, 'fetch', async (url: unknown, init: RequestInit) => {
    assert.equal(url, profile.url);
    assert.equal(new Headers(init.headers).get('x-api-key'), env.ANTHROPIC_API_KEY);
    const body = z
      .object({
        system: z.string(),
        output_config: z.object({ format: z.object({ type: z.literal('json_schema') }) }),
        tools: z.undefined().optional(),
        tool_choice: z.undefined().optional(),
      })
      .parse(JSON.parse(z.string().parse(init.body)));
    assert.ok(!body.system.includes('via submit_research'));
    return Response.json({
      type: 'message',
      content: [
        {
          type: 'text',
          text: malformed
            ? 'bad-json'
            : JSON.stringify({
                queries: ['name', 'offer', 'need', 'market', 'sector', 'geography'].map((axis) => ({
                  axis,
                  query: 'audit CRM PME France ' + axis,
                })),
              }),
        },
      ],
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 50 },
    });
  });
  const model = createResearchModel(agentConfig(env));
  assert.ok(model);
  const input = {
    kind: 'plan' as const,
    profile: {
      enabled: true,
      companyName: 'Fixture',
      website: 'https://own.example/',
      offers: ['Audit'],
      market: 'Services',
      target: 'PME',
      geography: 'France',
      keywords: [],
      budgetUsd: 3,
      maxPages: 120,
      maxSearches: 24,
      maxAgeDays: 30,
    },
  };
  const result = await model.generate(input, AbortSignal.timeout(1000));
  assert.equal(result.usage?.state, 'estimated');
  assert.equal(result.usage.cost, 0.0007);
  malformed = true;
  await assert.rejects(
    model.generate(input, AbortSignal.timeout(1000)),
    (error: unknown) => error instanceof ResearchModelError && error.usage?.cost === 0.0007,
  );
});
