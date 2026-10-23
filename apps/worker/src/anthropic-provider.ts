import { z } from 'zod';
import { ProviderCallError } from './agent-errors.ts';
import type { AgentModelProfile } from './agent-provider.ts';

export const ANTHROPIC_VERSION = '2023-06-01';
const cache = z.object({ type: z.literal('ephemeral'), ttl: z.literal('5m').optional() }).strict();
const text = z
  .object({ type: z.literal('text'), text: z.string(), cache_control: cache.optional() })
  .strict();
const thinking = z
  .object({ type: z.literal('thinking'), thinking: z.string(), signature: z.string().min(1) })
  .strict();
const redacted = z
  .object({ type: z.literal('redacted_thinking'), data: z.string().min(1) })
  .strict();
const toolUse = z
  .object({
    type: z.literal('tool_use'),
    id: z.string().min(1),
    name: z.string().regex(/^[a-z_]+$/),
    input: z.record(z.string(), z.unknown()),
    cache_control: cache.optional(),
  })
  .strict();
const toolResult = z
  .object({
    type: z.literal('tool_result'),
    tool_use_id: z.string().min(1),
    content: z.union([z.string(), z.array(text)]),
    is_error: z.boolean().optional(),
    cache_control: cache.optional(),
  })
  .strict();
const userContent = z.union([z.string(), z.array(z.union([text, toolResult])).min(1)]);
const assistantContent = z.array(z.union([text, thinking, redacted, toolUse])).min(1);
const messages = z
  .array(
    z.discriminatedUnion('role', [
      z.object({ role: z.literal('user'), content: userContent }).strict(),
      z
        .object({ role: z.literal('assistant'), content: z.union([z.string(), assistantContent]) })
        .strict(),
    ]),
  )
  .min(1)
  .max(31);
const nativeTool = z
  .object({
    name: z.string().regex(/^[a-z_]+$/),
    description: z.string().optional(),
    input_schema: z.record(z.string(), z.unknown()),
    cache_control: cache.optional(),
  })
  .strict();
const nativeRequest = z
  .object({
    model: z.string(),
    system: z.union([z.string(), z.array(text).min(1)]),
    messages,
    tools: z.array(nativeTool).max(7).optional(),
    max_tokens: z.number().int().positive(),
    tool_choice: z
      .object({ type: z.literal('auto') })
      .strict()
      .optional(),
    thinking: z
      .object({
        type: z.literal('adaptive'),
        display: z.enum(['summarized', 'omitted']).optional(),
      })
      .strict()
      .optional(),
    output_config: z
      .object({ effort: z.enum(['low', 'medium', 'high', 'max']) })
      .strict()
      .optional(),
    stream: z.literal(false).optional(),
  })
  .strict();

function invalid(): never {
  throw new ProviderCallError('provider_protocol_invalid', null);
}

/** Normalize the envelope for shared authorization; native message blocks stay verbatim. */
export function acceptAnthropicRequest(input: unknown): Record<string, unknown> {
  const parsed = nativeRequest.safeParse(input);
  if (!parsed.success) return invalid();
  const r = parsed.data;
  return {
    model: r.model,
    messages: [
      {
        role: 'system',
        content: typeof r.system === 'string' ? r.system : r.system.map((b) => b.text).join('\n'),
      },
      ...r.messages,
    ],
    ...(r.tools
      ? {
          tools: r.tools.map((t) => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.input_schema },
            ...(t.cache_control ? { cache_control: t.cache_control } : {}),
          })),
        }
      : {}),
  };
}

export function assertAnthropicMessages(input: Record<string, unknown>[]): void {
  if (
    input[0]?.role !== 'system' ||
    typeof input[0].content !== 'string' ||
    !messages.safeParse(input.slice(1)).success
  )
    invalid();
}

/** Remove only constraints unsupported by the native constrained decoder. Local Zod remains strict. */
export function anthropicSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(anthropicSchema);
  if (!value || typeof value !== 'object') return value;
  const schema = value as Record<string, unknown>;
  const unsupported = new Set([
    '$schema',
    'minLength',
    'maxLength',
    'minimum',
    'maximum',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'multipleOf',
    'minItems',
    'maxItems',
    'format',
    'pattern',
  ]);
  const constraints = Object.fromEntries(
    Object.entries(schema).filter(([key]) => key !== '$schema' && unsupported.has(key)),
  );
  const normalized = Object.fromEntries(
    Object.entries(schema)
      .filter(([key]) => !unsupported.has(key))
      .map(([key, item]) =>
        // Property names can themselves be JSON Schema keywords.
        [
          key,
          key === 'properties' && item && typeof item === 'object' && !Array.isArray(item)
            ? Object.fromEntries(
                Object.entries(item).map(([name, property]) => [name, anthropicSchema(property)]),
              )
            : anthropicSchema(item),
        ],
      ),
  );
  if (Object.keys(constraints).length)
    normalized.description = `${typeof schema.description === 'string' ? schema.description + ' ' : ''}Constraints checked by Ulysse: ${JSON.stringify(constraints)}`;
  return normalized;
}

const openaiTool = z.object({
  type: z.literal('function'),
  function: z.object({
    name: z.string(),
    description: z.string().optional(),
    parameters: z.record(z.string(), z.unknown()),
  }),
  cache_control: cache.optional(),
});
export function anthropicRequest(
  profile: AgentModelProfile,
  conversation: {
    messages: Record<string, unknown>[];
    tools?: unknown;
    schema?: unknown;
    disableTools?: boolean;
  },
): Record<string, unknown> {
  assertAnthropicMessages(conversation.messages);
  const tools =
    conversation.tools === undefined
      ? undefined
      : z
          .array(openaiTool)
          .parse(conversation.tools)
          .map((t) => ({
            name: t.function.name,
            description: t.function.description,
            input_schema: t.function.parameters,
            ...(t.cache_control ? { cache_control: t.cache_control } : {}),
          }));
  return {
    model: profile.model,
    system: conversation.messages[0]?.content,
    messages: conversation.messages.slice(1),
    max_tokens: profile.generation.maxOutputTokens,
    stream: false,
    thinking: { type: 'adaptive' },
    output_config: {
      effort: profile.generation.reasoning,
      ...(conversation.schema
        ? { format: { type: 'json_schema', schema: anthropicSchema(conversation.schema) } }
        : {}),
    },
    ...(tools?.length
      ? { tools, tool_choice: { type: conversation.disableTools ? 'none' : 'auto' } }
      : {}),
  };
}

export function anthropicHeaders(key: string): Record<string, string> {
  return {
    'x-api-key': key,
    'anthropic-version': ANTHROPIC_VERSION,
    'content-type': 'application/json',
  };
}

const usageSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  cache_creation_input_tokens: z.number().int().nonnegative().default(0),
  cache_read_input_tokens: z.number().int().nonnegative().default(0),
  cache_creation: z
    .object({ ephemeral_1h_input_tokens: z.number().int().nonnegative().default(0) })
    .optional(),
});

/** View for existing result validators/accounting. The raw native response is returned to Hermes. */
export function anthropicCompletion(
  raw: Record<string, unknown>,
  profile: AgentModelProfile,
): Record<string, unknown> {
  // Output-only metadata (e.g. citations:null/caller) is not a replay instruction.
  const content = z
    .array(z.union([text.strip(), thinking.strip(), redacted.strip(), toolUse.strip()]))
    .min(1)
    .safeParse(raw.content);
  const usage = usageSchema.safeParse(raw.usage);
  const stops: Record<string, string> = {
    end_turn: 'stop',
    stop_sequence: 'stop',
    tool_use: 'tool_calls',
    max_tokens: 'length',
    model_context_window_exceeded: 'length',
    refusal: 'content_filter',
  };
  const blocks = content.success ? content.data : [];
  const stop = typeof raw.stop_reason === 'string' ? stops[raw.stop_reason] : undefined;
  const u = usage.success ? usage.data : undefined;
  return {
    native_response: raw,
    ...(u
      ? {
          usage: {
            prompt_tokens:
              u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens,
            completion_tokens: u.output_tokens,
            // API reports token counts, not a billed USD amount. Keep this explicitly estimated.
            estimated_cost:
              (u.input_tokens * profile.prices.prompt +
                (u.cache_creation_input_tokens -
                  (u.cache_creation?.ephemeral_1h_input_tokens ?? 0)) *
                  (profile.prices.cacheWrite ?? profile.prices.prompt) +
                (u.cache_creation?.ephemeral_1h_input_tokens ?? 0) * profile.prices.prompt * 2 +
                u.cache_read_input_tokens * (profile.prices.cacheRead ?? profile.prices.prompt) +
                u.output_tokens * profile.prices.completion) /
              1_000_000,
          },
        }
      : {}),
    choices: [
      {
        finish_reason: stop ?? 'error',
        message: {
          role: 'assistant',
          content: blocks
            .filter((b) => b.type === 'text')
            .map((b) => b.text)
            .join('\n'),
          ...(blocks.some((b) => b.type === 'tool_use')
            ? {
                tool_calls: blocks
                  .filter((b) => b.type === 'tool_use')
                  .map((b) => ({
                    id: b.id,
                    type: 'function',
                    function: { name: b.name, arguments: JSON.stringify(b.input) },
                  })),
              }
            : {}),
          // Preserve the native assistant blocks through a bounded format-repair turn, too.
          ...(content.success ? { anthropic_content: content.data } : {}),
        },
      },
    ],
  };
}

export function nativeResult(payload: Record<string, unknown>): Record<string, unknown> {
  const native = payload.native_response;
  if (native && typeof native === 'object' && !Array.isArray(native))
    return native as Record<string, unknown>;
  // A locally retained partial review contains only validated final text.
  const result = z
    .object({ choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1) })
    .parse(payload);
  return {
    id: 'msg_ulysse_validated',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: result.choices[0]?.message.content ?? '' }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}
