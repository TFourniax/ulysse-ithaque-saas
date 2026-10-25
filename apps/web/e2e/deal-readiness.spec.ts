import AxeBuilder from '@axe-core/playwright';
import type { AgentRunDto, Connection } from '@ulysse/contracts';
import { expect, test } from '@playwright/test';
import { login, settle } from './support.ts';

const id = 'a9000000-0000-4000-8000-000000000026';
const now = new Date().toISOString();
const source: Connection = {
  id,
  provider: 'crm-file',
  kind: 'live',
  displayName: 'Affaires importées par fichier',
  status: 'active',
  config: {},
  grantedScopes: [],
  syncIntervalMinutes: 5,
  lastSyncStartedAt: now,
  lastSuccessAt: now,
  dataAsOf: now,
  lastErrorCode: null,
  lastErrorAt: null,
  consecutiveFailures: 0,
  nextSyncAt: null,
  createdAt: now,
  revokedAt: null,
};
const blocked: AgentRunDto = {
  id,
  subject_id: id,
  subject_label: 'Projet fictif CSV',
  subject_external_id: 'csv-fictif',
  mode: 'hermes-live',
  status: 'abstained',
  trigger: 'source_change',
  snapshot: { preflight: { code: 'no_validated_doctrine' } },
  model: 'configured-model',
  hermes_version: 'fixture',
  instructions_version: 'fixture',
  started_at: now,
  completed_at: now,
  result: null,
  error_code: 'no_validated_doctrine',
  retrieved: [],
  tool_calls: 0,
  model_calls: 0,
  input_tokens: 0,
  output_tokens: 0,
  reserved_usd: 0,
  committed_usd: 0,
  cost_state: 'declared',
  correlation_id: 'fixture',
};

test('imported deals distinguish waiting, readiness block and active analysis @mobile', async ({
  page,
}, testInfo) => {
  await login(page, 'alice');
  let runs: AgentRunDto[] = [];
  await page.route('**/v1/connections', (r) => r.fulfill({ json: [source] }));
  await page.route('**/v1/analyses', (r) => r.fulfill({ json: [] }));
  await page.route('**/v1/agent-runs', (r) =>
    r.fulfill({
      json: { version: 'ulysse-agent-v1', configuredMode: 'hermes-live', demoEnabled: false, runs },
    }),
  );
  await page.route('**/v1/agent-runs/*/events', (r) => r.fulfill({ json: [] }));
  await page.goto('/recommendations');
  await expect(
    page.getByText('Les données ont été importées, mais aucune analyse terminée', { exact: false }),
  ).toBeVisible();
  await expect(page.getByText('analyse(s) en cours.', { exact: false })).not.toBeVisible();
  runs = [blocked];
  await page.reload();
  await expect(
    page.getByText('Aucune doctrine validée ne peut guider cette analyse.', { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText('Les données ont été importées, mais aucune analyse terminée', { exact: false }),
  ).not.toBeVisible();
  await settle(page);
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual(
    [],
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: `test-results/november-deal-readiness-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole('link', { name: 'Voir l’état des analyses', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Analyse à préparer', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('0 outils · 0 appels modèle', { exact: false })).toBeVisible();
  runs = [{ ...blocked, status: 'running', snapshot: {}, error_code: null, completed_at: null }];
  await page.goto('/recommendations');
  await expect(page.getByText('1 analyse(s) en cours.', { exact: false })).toBeVisible();
  await expect(page.getByText('Aucune doctrine validée', { exact: false })).not.toBeVisible();
});
