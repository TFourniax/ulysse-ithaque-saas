import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const origin = process.env.ULYSSE_SMOKE_ORIGIN ?? 'http://localhost:3000';
const output = process.env.ULYSSE_EVIDENCE_DIR ?? 'test-results/ul016';
const resume = process.argv.includes('--resume');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext(resume ? { storageState: `${output}/session.json` } : {});
const page = await context.newPage();
async function json(path) {
  const response = await context.request.get(`${origin}${path}`);
  assert.equal(response.ok(), true, path);
  return response.json();
}
async function until(probe, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('agent smoke condition timeout');
}
async function login(username) {
  await page.goto(origin);
  await page.getByRole('link', { name: 'Se connecter', exact: true }).click();
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(`ulysse-demo-${username}`);
  await page.locator('#kc-login').click();
  await page.waitForURL(`${origin}/recommendations`);
}
try {
  if (resume) {
    await until(async () => {
      try { return (await context.request.get(`${origin}/health/ready`)).ok(); }
      catch { return false; }
    });
    const evidence = JSON.parse(await readFile(`${output}/proof.json`, 'utf8'));
    await page.goto(`${origin}/recommendations/${evidence.recommendationId}`);
    await page.getByText('Proposition approuvée', { exact: false }).first().waitFor();
    const detail = await json(`/v1/recommendations/${evidence.recommendationId}`);
    assert.equal(detail.recommendation.status, 'approved');
    console.log('UL016_RESTART_PERSISTENCE=passed');
  } else {
    await login('alice');
    const o = await until(async () =>
      (await json('/v1/opportunities?limit=100')).items.find((o) => o.externalId === 'OPP-001'),
    );
    await page.goto(`${origin}/opportunities`);
    await page.getByRole('link', { name: o.name, exact: true }).click();
    await page.getByRole('heading', { name: o.name, exact: true }).waitFor();
    await page.getByText('Note atelier fictive', { exact: false }).first().click();
    await page.getByText('Les capteurs existent déjà', { exact: false }).first().waitFor();
    const initial = await until(async () => {
      const s = await json('/v1/agent-runs');
      return s.runs.find((r) => r.subject_id === o.id && r.status === 'completed');
    });
    assert.equal(initial.mode, 'simulated');
    assert.ok(initial.tool_calls >= 6);
    assert.equal(initial.model_calls, 0);
    const baseline = (await json(`/v1/opportunities/${o.id}`)).recommendations.find(
      (r) => r.status === 'pending',
    );
    assert.ok(baseline);
    const before = (await json(`/v1/recommendations/${baseline.id}`)).recommendation.proposedAction;
    await page.screenshot({ path: `${output}/sources.png`, fullPage: true });
    await page.getByLabel('Événement source').selectOption('positive_reply');
    await page.getByRole('button', { name: 'Injecter et synchroniser' }).click();
    const evolved = await until(async () =>
      (await json('/v1/agent-runs')).runs.find(
        (r) => r.subject_id === o.id && r.id !== initial.id && r.status === 'completed',
      ),
    );
    const next = (await json(`/v1/opportunities/${o.id}`)).recommendations.find(
      (r) => r.status === 'pending',
    );
    assert.ok(next);
    const detail = await json(`/v1/recommendations/${next.id}`);
    assert.notEqual(detail.recommendation.proposedAction, before);
    assert.ok(detail.evidence.some((e) => e.factType === 'commercial_context'));
    await page.goto(`${origin}/analyses#${evolved.id}`);
    await page.getByText('Agentique simulé', { exact: false }).first().waitFor();
    await page.screenshot({ path: `${output}/analyses.png`, fullPage: true });
    await page.goto(`${origin}/recommendations/${next.id}`);
    await page.getByRole('button', { name: 'Approuver', exact: true }).click();
    await page
      .getByText('Décision enregistrée : proposition approuvée', { exact: false })
      .waitFor();
    await page.screenshot({ path: `${output}/decision.png`, fullPage: true });
    await context.storageState({ path: `${output}/session.json` });
    // Evidence excludes session cookies, prompts and internal reasoning.
    const events = await json(`/v1/agent-runs/${evolved.id}/events`);
    await writeFile(
      `${output}/proof.json`,
      JSON.stringify(
        {
          testedCommit: process.env.GITHUB_SHA ?? null,
          mode: 'simulated',
          hermesVersion: evolved.hermes_version,
          modelCalls: evolved.model_calls,
          opportunityId: o.id,
          recommendationId: next.id,
          initialRun: initial.id,
          evolvedRun: evolved.id,
          sourceRevision: evolved.snapshot.sourceRevision,
          events,
          decision: 'approved',
          externalWrites: 0,
        },
        null,
        2,
      ),
    );
    console.log('UL016_SIMULATED_JOURNEY=passed');
    const viewer = await browser.newContext();
    const viewerPage = await viewer.newPage();
    await viewerPage.goto(origin);
    await viewerPage.getByRole('link', { name: 'Se connecter', exact: true }).click();
    await viewerPage.locator('#username').fill('vera');
    await viewerPage.locator('#password').fill('ulysse-demo-vera');
    await viewerPage.locator('#kc-login').click();
    await viewerPage.waitForURL(`${origin}/recommendations`);
    await viewerPage.goto(`${origin}/opportunities/${o.id}`);
    assert.equal(
      await viewerPage.getByRole('button', { name: 'Injecter et synchroniser' }).count(),
      0,
    );
    await viewerPage.goto(`${origin}/recommendations/${next.id}`);
    assert.equal(
      await viewerPage.getByRole('button', { name: 'Approuver', exact: true }).count(),
      0,
    );
    await viewer.close();
    const globex = await browser.newContext();
    const g = await globex.newPage();
    await g.goto(origin);
    await g.getByRole('link', { name: 'Se connecter', exact: true }).click();
    await g.locator('#username').fill('gina');
    await g.locator('#password').fill('ulysse-demo-gina');
    await g.locator('#kc-login').click();
    await g.waitForURL(`${origin}/recommendations`);
    const denied = await globex.request.get(`${origin}/v1/opportunities/${o.id}`);
    assert.equal(denied.status(), 404);
    const own = await (await globex.request.get(`${origin}/v1/opportunities?limit=100`)).json();
    assert.ok(own.items.some((item) => item.externalId === 'OPP-001' && item.id !== o.id));
    await globex.close();
    console.log('UL016_VIEWER_AND_TENANT_ISOLATION=passed');
  }
} finally {
  await context.close();
  await browser.close();
}
