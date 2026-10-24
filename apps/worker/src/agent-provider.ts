import { createHash } from 'node:crypto';
import { z } from 'zod';
import profiles from './agent-model-profiles.json' with { type: 'json' };

export const MAX_AGENT_CONTEXT_BYTES = 256000;
// Private HTTP framing has separate overhead; the normalized model request is
// still bounded by its selected profile before any inference is transmitted.
export const MAX_AGENT_REQUEST_BYTES = MAX_AGENT_CONTEXT_BYTES + 64000;
export const MAX_AGENT_OUTPUT_TOKENS = 16384;
export const ModelId = z
  .string()
  .max(160)
  .regex(/^(?:[a-zA-Z0-9][a-zA-Z0-9_.-]*\/)?[a-zA-Z0-9][a-zA-Z0-9_.-]*$/);
export type AgentRoute = 'openrouter' | 'openrouter-eu-zdr' | 'anthropic';
export const ModelProfile = z
  .object({
    version: z.literal(1),
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
    model: ModelId,
    protocol: z.enum(['openai-chat-completions', 'anthropic-messages']),
    route: z.enum(['openrouter', 'openrouter-eu-zdr', 'anthropic']),
    endpoint: z
      .string()
      .max(120)
      .regex(/^[a-z0-9][a-z0-9/_-]*$/),
    prices: z
      .object({
        prompt: z.number().positive().max(100),
        completion: z.number().positive().max(100),
        cacheWrite: z.number().positive().max(100).optional(),
        cacheRead: z.number().nonnegative().max(100).optional(),
      })
      .strict(),
    // Declared model capabilities are metadata, never permission to ingest or transmit media.
    capabilities: z
      .object({
        input: z
          .array(z.enum(['text', 'image', 'audio', 'video', 'file']))
          .min(1)
          .max(5),
        output: z
          .array(z.enum(['text', 'image', 'audio', 'video']))
          .min(1)
          .max(4),
        tools: z.boolean(),
        structuredOutput: z.boolean(),
      })
      .strict(),
    generation: z
      .object({
        maxOutputTokens: z.number().int().min(256).max(MAX_AGENT_OUTPUT_TOKENS),
        tokenParameter: z.enum(['max_tokens', 'max_completion_tokens']),
        temperature: z.number().min(0).max(2).optional(),
        topP: z.number().positive().max(1).optional(),
        reasoning: z.enum(['omit', 'disabled', 'low', 'medium', 'high', 'max']),
      })
      .strict(),
    maxContextBytes: z.number().int().min(1024).max(MAX_AGENT_CONTEXT_BYTES),
  })
  .strict()
  .refine((p) =>
    p.route === 'anthropic'
      ? p.protocol === 'anthropic-messages' &&
        /^claude-[a-z0-9-]+$/.test(p.model) &&
        p.endpoint === 'anthropic' &&
        p.prices.cacheWrite !== undefined &&
        p.prices.cacheRead !== undefined &&
        p.generation.tokenParameter === 'max_tokens' &&
        ['low', 'medium', 'high', 'max'].includes(p.generation.reasoning) &&
        p.generation.temperature === undefined &&
        p.generation.topP === undefined
      : p.protocol === 'openai-chat-completions' &&
        p.model.includes('/') &&
        p.prices.cacheWrite === undefined &&
        p.prices.cacheRead === undefined,
  );
export type AgentModelProfile = z.infer<typeof ModelProfile>;

const bundled = z.array(ModelProfile).parse(profiles);
export function modelProfiles(): AgentModelProfile[] {
  return structuredClone(bundled.filter((p) => p.route !== 'openrouter'));
}
export function parseModelProfile(json: string): AgentModelProfile {
  try {
    if (Buffer.byteLength(json) > 16384) throw new Error('size');
    const profile = ModelProfile.parse(JSON.parse(json));
    // Custom administrator profiles cannot open a global/third-party URL or add request fields.
    if (!['openrouter-eu-zdr', 'anthropic'].includes(profile.route)) throw new Error('route');
    return profile;
  } catch {
    // Never echo arbitrary JSON, including accidentally pasted credentials.
    throw new Error('Profil modele JSON invalide : verifier le schema v1 et la route autorisee.');
  }
}

/** Model differences are data. Routing policy and financial authority stay in this adapter. */
export function agentProvider(model: string, route: AgentRoute, profileJson?: string) {
  const profile = profileJson
    ? parseModelProfile(profileJson)
    : bundled.find((p) => p.model === model && p.route === route);
  if (!profile || profile.model !== model || profile.route !== route)
    throw new Error(
      'Profil modele absent ou incompatible avec AGENT_MODEL_ID/AGENT_PROVIDER_ROUTE',
    );
  if (
    !profile.capabilities.tools ||
    !profile.capabilities.input.includes('text') ||
    !profile.capabilities.output.includes('text')
  )
    throw new Error('Le harness Ulysse exige texte et appels outils.');
  const europe = route === 'openrouter-eu-zdr';
  const anthropic = route === 'anthropic';
  const g = profile.generation;
  const parameters: Record<string, unknown> = { [g.tokenParameter]: g.maxOutputTokens };
  const requiredParameters = ['tools', 'tool_choice', g.tokenParameter];
  if (profile.capabilities.structuredOutput)
    requiredParameters.push('response_format', 'structured_outputs');
  if (g.temperature !== undefined) {
    parameters.temperature = g.temperature;
    requiredParameters.push('temperature');
  }
  if (g.topP !== undefined) {
    parameters.top_p = g.topP;
    requiredParameters.push('top_p');
  }
  if (g.reasoning !== 'omit') {
    parameters.reasoning =
      g.reasoning === 'disabled' ? { enabled: false } : { enabled: true, effort: g.reasoning };
    requiredParameters.push('reasoning');
  }
  return {
    profile,
    profileHash: createHash('sha256').update(JSON.stringify(profile)).digest('hex'),
    url: anthropic
      ? 'https://api.anthropic.com/v1/messages'
      : europe
        ? 'https://eu.openrouter.ai/api/v1/chat/completions'
        : 'https://openrouter.ai/api/v1/chat/completions',
    prices: profile.prices,
    provider: {
      allow_fallbacks: false,
      require_parameters: true,
      max_price: profile.prices,
      ...(europe
        ? {
            only: [profile.endpoint],
            order: [profile.endpoint],
            data_collection: 'deny' as const,
            zdr: true,
          }
        : {}),
    },
    parameters,
    requiredParameters,
    executionSettings: {
      maxOutputTokens: g.maxOutputTokens,
      reasoning: g.reasoning,
      ...(anthropic ? { protocol: 'anthropic-messages' as const } : {}),
    },
    reserve: (inputTokens: number, outputTokens: number) =>
      (inputTokens * Math.max(profile.prices.prompt, profile.prices.cacheWrite ?? 0) +
        outputTokens * profile.prices.completion) /
      1_000_000,
    estimate: (inputTokens: number, outputTokens: number) =>
      (inputTokens * profile.prices.prompt + outputTokens * profile.prices.completion) / 1_000_000,
  };
}

/** Media need authorized ingestion and modality-aware cost accounting before this boundary opens. */
export function assertTextMessages(messages: Record<string, unknown>[]): void {
  const fields = new Set([
    'role',
    'content',
    'name',
    'tool_call_id',
    'tool_calls',
    'reasoning',
    'reasoning_content',
    'reasoning_details',
    'refusal',
  ]);
  for (const message of messages) {
    if (Object.keys(message).some((key) => !fields.has(key)))
      throw new Error('unsupported_message_field');
    if (!['system', 'developer', 'user', 'assistant', 'tool'].includes(String(message.role)))
      throw new Error('unsupported_message_role');
    const content = message.content;
    if (content === null || typeof content === 'string' || content === undefined) continue;
    const textParts = z.array(z.object({ type: z.literal('text'), text: z.string() }).strict());
    if (!textParts.safeParse(content).success) throw new Error('unsupported_content_modality');
  }
}
