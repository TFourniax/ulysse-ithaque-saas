/**
 * Offline evaluation of model-assisted wording against the deterministic baseline
 * on the fictional panel. Usage: npm run eval -w @ulysse/ai
 * With MODEL_PROVIDER/OPENROUTER_API_KEY/MODEL_ID set, the real provider is called
 * (costs apply); otherwise only the baseline is reported and the model is "not evaluated".
 */
import { modelSettingsFromEnv } from './config.ts';
import { formulateNextStep } from './formulation.ts';
import { EVALUATION_PANEL } from './panel.ts';

const settings = modelSettingsFromEnv();
const rows: Array<Record<string, unknown>> = [];
let accepted = 0;
let violations = 0;
let cost = 0;
let latency = 0;
for (const panelCase of EVALUATION_PANEL) {
  const baseline = { status: 'template', text: panelCase.request.recommendation.proposedAction };
  if (!settings.provider) {
    rows.push({ case: panelCase.id, baseline: baseline.status, model: 'not evaluated' });
    continue;
  }
  const result = await formulateNextStep(settings.provider, panelCase.request, {
    timeoutMs: settings.timeoutMs,
    maxOutputTokens: settings.maxOutputTokens,
    monthlyBudgetUsd: Number.POSITIVE_INFINITY,
    spentThisMonthUsd: 0,
  });
  const text = result.status === 'formulated' ? result.proposedAction : '';
  const hits = panelCase.forbidden.filter((f) => text.toLowerCase().includes(f.toLowerCase()));
  if (result.status === 'formulated') accepted += 1;
  violations += hits.length;
  cost += result.usage?.costUsd ?? 0;
  latency += result.latencyMs;
  rows.push({
    case: panelCase.id,
    expectation: panelCase.expectation,
    model: result.status,
    reason: 'reason' in result ? result.reason : null,
    forbiddenHits: hits,
  });
}
const report = {
  promptPanel: 'fictional-v1',
  provider: settings.provider
    ? `${settings.provider.name}:${settings.provider.model}`
    : 'none (model not evaluated)',
  cases: rows,
  summary: settings.provider
    ? {
        formulated: accepted,
        total: EVALUATION_PANEL.length,
        forbiddenContentInAcceptedOutputs: violations,
        reportedCostUsd: cost,
        meanLatencyMs: Math.round(latency / EVALUATION_PANEL.length),
      }
    : {
        note: 'Baseline only. Configure an approved provider to measure the model; value must then be compared on a pilot panel annotated by the business owner.',
      },
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
