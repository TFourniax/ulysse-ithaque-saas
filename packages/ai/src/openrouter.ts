import type { ModelProvider, ModelRequest, ModelResponse } from './provider.ts';
import { ModelError } from './provider.ts';

export type OpenRouterOptions = Readonly<{
  apiKey: string;
  model: string;
  /** Override only for tests or an approved gateway. */
  baseUrl?: string;
  appTitle?: string;
  fetchImpl?: typeof fetch;
}>;

type ChatCompletion = {
  model?: unknown;
  choices?: Array<{ message?: { content?: unknown; refusal?: unknown }; finish_reason?: unknown }>;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; cost?: unknown };
};

const numberOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/**
 * OpenRouter chat-completions adapter with JSON-schema structured output.
 * The key stays server-side; requests ask providers not to retain data
 * (`provider.data_collection = deny`), which still has to be validated
 * contractually before any real client data is sent (OPEN-QUESTIONS Q-008).
 */
export class OpenRouterProvider implements ModelProvider {
  readonly name = 'openrouter';
  readonly model: string;
  readonly #options: OpenRouterOptions;

  constructor(options: OpenRouterOptions) {
    if (!options.apiKey) throw new ModelError('misconfigured', 'missing OpenRouter API key');
    this.#options = options;
    this.model = options.model;
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const fetchImpl = this.#options.fetchImpl ?? fetch;
    const started = performance.now();
    const signals = [
      AbortSignal.timeout(request.timeoutMs),
      ...(request.signal ? [request.signal] : []),
    ];
    let response: Response;
    try {
      response = await fetchImpl(
        `${this.#options.baseUrl ?? 'https://openrouter.ai/api/v1'}/chat/completions`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.#options.apiKey}`,
            'content-type': 'application/json',
            'x-title': this.#options.appTitle ?? 'Ulysse',
          },
          body: JSON.stringify({
            model: this.model,
            messages: [
              { role: 'system', content: request.system },
              { role: 'user', content: request.user },
            ],
            response_format: {
              type: 'json_schema',
              json_schema: {
                name: request.schema.name,
                strict: true,
                schema: request.schema.jsonSchema,
              },
            },
            max_tokens: request.maxOutputTokens,
            temperature: 0,
            usage: { include: true },
            provider: { data_collection: 'deny', require_parameters: true },
          }),
          signal: AbortSignal.any(signals),
        },
      );
    } catch (error) {
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError'))
        throw new ModelError('timeout', 'model call timed out');
      throw new ModelError('unavailable', 'model provider unreachable');
    }
    const latencyMs = Math.round(performance.now() - started);
    if (response.status === 429) throw new ModelError('rate_limited', 'model provider rate limit');
    if (response.status === 401 || response.status === 403)
      throw new ModelError('misconfigured', 'model provider rejected the credentials');
    if (response.status >= 500)
      throw new ModelError('unavailable', `model provider error ${String(response.status)}`);
    if (!response.ok)
      throw new ModelError(
        'invalid_request',
        `model provider refused the request (${String(response.status)})`,
      );
    const body = (await response.json().catch(() => null)) as ChatCompletion | null;
    const choice = body?.choices?.[0];
    const usage = {
      inputTokens: numberOr(body?.usage?.prompt_tokens, 0),
      outputTokens: numberOr(body?.usage?.completion_tokens, 0),
      costUsd: typeof body?.usage?.cost === 'number' ? body.usage.cost : null,
    };
    if (!choice) throw new ModelError('invalid_output', 'no completion returned', usage);
    if (typeof choice.message?.refusal === 'string' && choice.message.refusal)
      throw new ModelError('refused', 'model refused the request', usage);
    const content = choice.message?.content;
    if (typeof content !== 'string')
      throw new ModelError('invalid_output', 'completion without text content', usage);
    let output: unknown;
    try {
      output = JSON.parse(content);
    } catch {
      throw new ModelError('invalid_output', 'completion is not valid JSON', usage);
    }
    return {
      output,
      usage,
      model: typeof body.model === 'string' ? body.model : this.model,
      latencyMs,
    };
  }
}
