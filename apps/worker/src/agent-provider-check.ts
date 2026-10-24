import { z } from 'zod';
import { agentProvider } from './agent-provider.ts';
import { anthropicHeaders } from './anthropic-provider.ts';
import { fetchAgentCompletion } from './agent-errors.ts';

/** Uses the authenticated model endpoint only; never consumes inference credits. */
export async function checkAnthropicProvider(
  model: string,
  key: string,
  request: typeof fetch = fetch,
  profileJson?: string,
) {
  const p = agentProvider(model, 'anthropic', profileJson);
  const result = await fetchAgentCompletion(
    `https://api.anthropic.com/v1/models/${encodeURIComponent(model)}`,
    {
      headers: anthropicHeaders(key),
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
    },
    request,
  );
  if (result.id !== model)
    throw new Error('Modele Anthropic absent ou different du profil epingle.');
  return {
    model,
    profile: p.profile.id,
    profileHash: p.profileHash,
    route: 'anthropic',
    endpoint: 'api.anthropic.com',
    prices: p.prices,
    pricingVerifiedByCatalog: false,
    dataPolicy: 'Anthropic direct; Europe/ZDR non attestes par ce controle',
  };
}

const Catalog = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      reasoning: z
        .object({
          mandatory: z.boolean().optional(),
          supported_efforts: z.array(z.string()).nullable().optional(),
        })
        .optional(),
    }),
  ),
});
const Endpoints = z.object({
  data: z.array(
    z.object({
      model_id: z.string(),
      tag: z.string(),
      status: z.number(),
      pricing: z.object({
        prompt: z.coerce.number().nonnegative(),
        completion: z.coerce.number().nonnegative(),
      }),
      supported_parameters: z.array(z.string()),
    }),
  ),
});

/** Read-only preflight: no client text, paid inference, raw response, or key in diagnostics. */
export async function checkEuropeanProvider(
  model: string,
  key: string,
  request: typeof fetch = fetch,
  profileJson?: string,
) {
  const route = agentProvider(model, 'openrouter-eu-zdr', profileJson);
  const options = { redirect: 'error' as const, signal: AbortSignal.timeout(20000) };
  const catalog = await request('https://eu.openrouter.ai/api/v1/models/user', {
    ...options,
    headers: { authorization: `Bearer ${key}` },
  });
  if (!catalog.ok)
    throw new Error(
      `Catalogue Europe HTTP ${catalog.status} : verifier la cle, le plan Business/Enterprise et les restrictions du compte.`,
    );
  const entry = Catalog.parse(await catalog.json()).data.find((m) => m.id === model);
  if (!entry) throw new Error('Modele absent du catalogue autorise pour cette cle en Europe.');
  const reasoning = route.profile.generation.reasoning;
  if (entry.reasoning?.mandatory && ['omit', 'disabled'].includes(reasoning))
    throw new Error('Ce modele exige le raisonnement ; profil incompatible.');
  if (
    !['omit', 'disabled'].includes(reasoning) &&
    entry.reasoning?.supported_efforts &&
    !entry.reasoning.supported_efforts.includes(reasoning)
  )
    throw new Error('Niveau de raisonnement absent du catalogue fournisseur.');
  // Public policy metadata only; no credential or company content goes to this global URL.
  const registry = await request('https://openrouter.ai/api/v1/endpoints/zdr', {
    redirect: 'error',
    signal: AbortSignal.timeout(20000),
  });
  if (!registry.ok) throw new Error(`Registre ZDR indisponible (HTTP ${registry.status}).`);
  const endpoint = Endpoints.parse(await registry.json()).data.find(
    (e) => e.model_id === model && route.provider.only?.includes(e.tag) && e.status === 0,
  );
  if (!endpoint) throw new Error('Endpoint europeen epingle absent du registre ZDR actif.');
  const observedPrices = {
    prompt: endpoint.pricing.prompt * 1_000_000,
    completion: endpoint.pricing.completion * 1_000_000,
  };
  if (
    observedPrices.prompt > route.prices.prompt + 1e-9 ||
    observedPrices.completion > route.prices.completion + 1e-9
  )
    // Only validated numeric prices and the configured profile identity; never raw provider data.
    throw new Error(
      `Tarif fournisseur superieur au plafond epingle pour ${route.profile.model} (${route.profile.endpoint}), USD par million de tokens : ` +
        `entree ${observedPrices.prompt} (plafond ${route.prices.prompt}), ` +
        `sortie ${observedPrices.completion} (plafond ${route.prices.completion}). ` +
        'Verifier puis mettre a jour le profil ; aucun plafond modifie automatiquement.',
    );
  if (!route.requiredParameters.every((p) => endpoint.supported_parameters.includes(p)))
    throw new Error('Endpoint incompatible avec les parametres Ulysse.');
  return {
    model,
    profile: route.profile.id,
    profileHash: route.profileHash,
    route: 'openrouter-eu-zdr',
    endpoint: endpoint.tag,
    prices: route.prices,
  };
}
