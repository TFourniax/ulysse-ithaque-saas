/** Closed, reviewed routes. Neither a prompt nor an arbitrary base URL can choose a provider. */
export const AGENT_MODEL_IDS = ['openai/gpt-4.1-mini', 'anthropic/claude-haiku-5.5'] as const;
export type AgentModel = (typeof AGENT_MODEL_IDS)[number];
export type AgentRoute = 'openrouter' | 'openrouter-eu-zdr';
export const MAX_AGENT_CONTEXT_BYTES = 80000;
export const MAX_AGENT_OUTPUT_TOKENS = 3000;

export function agentProvider(model: AgentModel, route: AgentRoute) {
  const europe = route === 'openrouter-eu-zdr';
  const haiku = model === 'anthropic/claude-haiku-5.5';
  if (haiku && !europe) throw new Error('Haiku requires openrouter-eu-zdr');
  // USD per million tokens, including the regional premium (2026-10-20).
  // Haiku's higher price tier starts at 100k input tokens; our bound is <= 82,048.
  const prices = haiku
    ? { prompt: 0.11, completion: 0.55 }
    : europe
      ? { prompt: 0.44, completion: 1.76 }
      : { prompt: 0.4, completion: 1.6 };
  const endpoint = haiku ? 'amazon-bedrock/eu-west-1' : 'azure/swedencentral';
  return {
    url: europe
      ? 'https://eu.openrouter.ai/api/v1/chat/completions'
      : 'https://openrouter.ai/api/v1/chat/completions',
    prices,
    provider: {
      allow_fallbacks: false,
      require_parameters: true,
      max_price: prices,
      ...(europe
        ? { only: [endpoint], order: [endpoint], data_collection: 'deny' as const, zdr: true }
        : {}),
    },
    // Haiku 5.5 rejects sampling parameters. Disable thinking explicitly so the existing
    // bounded, non-reasoning Hermes loop does not lose its JSON output allowance.
    parameters: haiku
      ? { max_tokens: MAX_AGENT_OUTPUT_TOKENS, reasoning: { enabled: false } }
      : { max_completion_tokens: MAX_AGENT_OUTPUT_TOKENS, temperature: 0.2 },
    estimate: (inputTokens: number, outputTokens: number) =>
      (inputTokens * prices.prompt + outputTokens * prices.completion) / 1_000_000,
  };
}
