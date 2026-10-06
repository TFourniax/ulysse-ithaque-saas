/**
 * Provider-neutral model interface. Implementations receive only the messages
 * built by Ulysse (no tools, no connector secret, no write capability) and must
 * return a JSON value matching the requested schema; Ulysse validates it again.
 */
export type ModelRequest = Readonly<{
  system: string;
  user: string;
  schema: Readonly<{ name: string; jsonSchema: Readonly<Record<string, unknown>> }>;
  maxOutputTokens: number;
  timeoutMs: number;
  signal?: AbortSignal;
}>;

export type ModelUsageReport = Readonly<{
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
}>;

export type ModelResponse = Readonly<{
  output: unknown;
  usage: ModelUsageReport;
  model: string;
  latencyMs: number;
}>;

export const MODEL_ERROR_CODES = [
  'timeout',
  'rate_limited',
  'unavailable',
  'misconfigured',
  'invalid_request',
  'invalid_output',
  'refused',
] as const;
export type ModelErrorCode = (typeof MODEL_ERROR_CODES)[number];

export class ModelError extends Error {
  readonly code: ModelErrorCode;
  readonly usage: ModelUsageReport | null;

  constructor(code: ModelErrorCode, message: string, usage: ModelUsageReport | null = null) {
    super(message);
    this.name = 'ModelError';
    this.code = code;
    this.usage = usage;
  }
}

export interface ModelProvider {
  readonly name: string;
  readonly model: string;
  complete(request: ModelRequest): Promise<ModelResponse>;
}

/** Deterministic provider for tests and offline evaluation: returns scripted outputs in order. */
export class ScriptedProvider implements ModelProvider {
  readonly name = 'scripted';
  readonly model: string;
  readonly requests: ModelRequest[] = [];
  readonly #script: Array<unknown>;

  /** Each entry is an output value, a ModelError to throw, or a function of the request. */
  constructor(script: ReadonlyArray<unknown>, model = 'scripted-model') {
    this.#script = [...script];
    this.model = model;
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    const next = this.#script.shift();
    if (next instanceof ModelError) throw next;
    const output =
      typeof next === 'function' ? (next as (r: ModelRequest) => unknown)(request) : next;
    return {
      output,
      usage: {
        inputTokens: Math.ceil((request.system.length + request.user.length) / 4),
        outputTokens: 40,
        costUsd: 0,
      },
      model: this.model,
      latencyMs: 1,
    };
  }
}
