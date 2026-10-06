import { OpenRouterProvider } from './openrouter.ts';
import type { ModelProvider } from './provider.ts';

export type ModelSettings = Readonly<{
  provider: ModelProvider | null;
  timeoutMs: number;
  maxOutputTokens: number;
  monthlyBudgetUsd: number;
}>;

/**
 * Model use is opt-in: without MODEL_PROVIDER the product runs on deterministic
 * wording only (degraded mode is the default, not an error).
 */
export function modelSettingsFromEnv(env: NodeJS.ProcessEnv = process.env): ModelSettings {
  const timeoutMs = Number(env.MODEL_TIMEOUT_MS ?? 15_000);
  const maxOutputTokens = Number(env.MODEL_MAX_OUTPUT_TOKENS ?? 400);
  const monthlyBudgetUsd = Number(env.MODEL_TENANT_MONTHLY_BUDGET_USD ?? 0);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60_000)
    throw new Error('MODEL_TIMEOUT_MS must be between 1000 and 60000');
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 50 || maxOutputTokens > 2000)
    throw new Error('MODEL_MAX_OUTPUT_TOKENS must be between 50 and 2000');
  if (!Number.isFinite(monthlyBudgetUsd) || monthlyBudgetUsd < 0)
    throw new Error('MODEL_TENANT_MONTHLY_BUDGET_USD must be >= 0');
  let provider: ModelProvider | null = null;
  if (env.MODEL_PROVIDER === 'openrouter') {
    const apiKey = env.OPENROUTER_API_KEY ?? '';
    const model = env.MODEL_ID ?? '';
    if (!apiKey || !model)
      throw new Error('MODEL_PROVIDER=openrouter requires OPENROUTER_API_KEY and MODEL_ID');
    provider = new OpenRouterProvider({
      apiKey,
      model,
      ...(env.OPENROUTER_BASE_URL ? { baseUrl: env.OPENROUTER_BASE_URL } : {}),
    });
  } else if (env.MODEL_PROVIDER && env.MODEL_PROVIDER !== 'none') {
    throw new Error(`unknown MODEL_PROVIDER ${env.MODEL_PROVIDER}`);
  }
  return { provider, timeoutMs, maxOutputTokens, monthlyBudgetUsd };
}
