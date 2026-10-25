import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Fictitious CSV, real browser/API/outbox/worker; Hermes and its provider depend on the CI lane.
const origin = process.env.ULYSSE_SMOKE_ORIGIN ?? 'http://localhost:3000';
const output = process.env.ULYSSE_EVIDENCE_DIR ?? 'test-results/ul016';
const expectedMode = process.env.ULYSSE_EXPECT_MODE ?? 'simulated';
await mkdir(output, { recursive: true });
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const browser = await chromium.launch({
  headless: true,
  ...(executablePath ? { executablePath } : {}),
});
const context = await browser.newContext({ storageState: `${output}/session.json` });
const page = await context.newPage();
async function json(path) {
  const response = await context.request.get(`${origin}${path}`);
  assert.ok(response.ok(), path);
  return response.json();
}
async function until(probe) {
  const deadline = Date.now() + 300000;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('CSV-to-agent smoke condition timeout');
}
try {
  await page.goto(`${origin}/imports`);
  await page.getByLabel('Déposer un fichier CSV', { exact: true }).setInputFiles({
    name: 'proposition-fictive.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'Titre;Entreprise;Notes\nProjet CSV fictif;Atelier CSV fictif;Le client demande de clarifier les critères de décision et le calendrier.',
    ),
  });
  const preview = page.getByRole('region', { name: 'Vérifier l’import' });
  await preview.getByRole('button', { name: /^Importer 1 affaire/ }).click();
  await page.getByText('Import confirmé.', { exact: false }).waitFor();
  const opportunity = await until(async () =>
    (await json('/v1/opportunities?limit=100')).items.find((o) => o.name === 'Projet CSV fictif'),
  );
  // No explicit analyze request: the imported source event must reach the configured engine.
  const run = await until(async () => {
    const runs = (await json('/v1/agent-runs')).runs.filter((r) => r.subject_id === opportunity.id);
    const failed = runs.find((r) =>
      ['failed', 'budget_reached', 'interrupted', 'abstained'].includes(r.status),
    );
    assert.ok(!failed, `CSV analysis did not publish: ${failed?.error_code ?? failed?.status}`);
    return runs.find((r) => r.status === 'completed');
  });
  assert.equal(run.mode, expectedMode);
  assert.ok(run.tool_calls >= 7, 'imported documents were actually read');
  assert.ok(run.retrieved.some((r) => r.startsWith('material:')));
  if (expectedMode === 'simulated') assert.equal(run.model_calls, 0);
  else assert.ok(run.model_calls >= 2, 'real Hermes model/tool loop');
  const proposal = (await json(`/v1/opportunities/${opportunity.id}`)).recommendations.find(
    (r) => r.status === 'pending',
  );
  assert.ok(proposal, 'human-reviewable proposal exists');
  const detail = await json(`/v1/recommendations/${proposal.id}`);
  assert.ok(detail.evidence.some((e) => e.factType === 'commercial_context'));
  await page.goto(`${origin}/recommendations/${proposal.id}`);
  await page.getByRole('button', { name: 'Approuver', exact: true }).waitFor();
  await page.evaluate(async () => {
    await Promise.all(
      globalThis.document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => {})),
    );
  });
  const accessibility = await new AxeBuilder({ page }).analyze();
  assert.deepEqual(
    accessibility.violations
      .filter((v) => ['serious', 'critical'].includes(v.impact))
      .map((v) => v.id),
    [],
  );
  await page.screenshot({ path: `${output}/crm-proposal.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
    ),
  );
  await page.screenshot({ path: `${output}/crm-proposal-mobile.png`, fullPage: true });
  await writeFile(
    `${output}/crm-import-proof.json`,
    JSON.stringify(
      {
        testedCommit: process.env.GITHUB_SHA ?? null,
        mode: run.mode,
        opportunityId: opportunity.id,
        runId: run.id,
        proposalId: proposal.id,
        toolCalls: run.tool_calls,
        modelCalls: run.model_calls,
        doctrineOrigin: run.snapshot.doctrineOrigin,
        status: proposal.status,
        externalWrites: 0,
      },
      null,
      2,
    ),
  );
  console.log(`UL026_CSV_TO_${expectedMode.toUpperCase().replace('-', '_')}_PROPOSAL=passed`);
} finally {
  await context.close();
  await browser.close();
}
