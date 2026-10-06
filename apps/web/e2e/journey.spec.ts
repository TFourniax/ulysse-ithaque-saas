import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { login, newSession, waitForProposals } from './support.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ACME_TOP = 'Renouvellement — Client Témoin';
const ACME_STALLED = 'Modernisation atelier — Industries Fictives SA';
const ACME_OVERDUE = 'Contrat de maintenance — Démo Logistique';
const GLOBEX = 'Déploiement CRM — Globex fictive';

test.describe.configure({ mode: 'serial' });

let acmeRecommendationUrl = '';

test('proposals appear from background ingestion, prioritized and explained, without any question', async ({
  page,
}) => {
  await login(page, 'bruno');
  await waitForProposals(page, 3);
  const cards = page.getByRole('list', { name: 'Liste des propositions' }).getByRole('listitem');
  await expect(cards.first()).toContainText(ACME_TOP);
  await expect(cards.first()).toContainText('Priorité 80');
  await expect(page.getByText('Fictif').first()).toBeVisible();
  await page.getByRole('link', { name: `Définir la prochaine étape : ${ACME_STALLED}` }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(ACME_STALLED);
  acmeRecommendationUrl = page.url();
  const facts = page.getByRole('table');
  await expect(facts).toContainText('Dernière interaction');
  await expect(facts).toContainText('Déterminant');
  await expect(facts).toContainText('Révision 1');
  await expect(page.getByRole('heading', { name: 'Hypothèses et limites' })).toBeVisible();
  await expect(page.getByText('Segment « ETI industrielles » prioritaire')).toBeVisible();
  await expect(page.getByText('Proposition générée')).toBeVisible();
});

test('keyboard navigation reaches every action and pages have no serious accessibility violation', async ({
  page,
}) => {
  await login(page, 'alice');
  await page.goto('/recommendations');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Propositions' })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Aller au contenu' })).toBeFocused();
  const firstCardLink = page
    .getByRole('list', { name: 'Liste des propositions' })
    .getByRole('link')
    .first();
  await firstCardLink.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Décision' })).toBeVisible();
  const reject = page.getByRole('button', { name: 'Rejeter' });
  await reject.focus();
  await expect(reject).toBeFocused();
  for (const url of [
    '/recommendations',
    page.url(),
    '/connections',
    '/opportunities',
    '/admin',
    '/history',
    '/measure',
  ]) {
    await page.goto(url);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const serious = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(
      serious.map((v) => `${v.id}: ${v.nodes.length}`),
      url,
    ).toEqual([]);
  }
});

test('approval is recorded, attributed, persistent and executes nothing externally', async ({
  page,
}) => {
  await login(page, 'bruno');
  await page.goto(acmeRecommendationUrl);
  await page.getByLabel('Motif (facultatif)').fill('Relance prévue avec le contact fictif.');
  const evaluation = page.getByLabel('Évaluation de la proposition (facultatif)');
  await evaluation.selectOption({ label: 'Doublon' });
  await expect(page.getByRole('button', { name: 'Approuver' })).toBeDisabled();
  await evaluation.selectOption({ label: 'Utile' });
  await expect(page.getByRole('button', { name: 'Rejeter' })).toBeDisabled();
  await page.getByRole('button', { name: 'Approuver' }).click();
  await expect(page.getByText('Décision enregistrée : proposition approuvée')).toBeVisible();
  await page.reload();
  await expect(page.locator('.detail-head .badge').first()).toHaveText('Approuvée');
  await expect(page.getByText('Proposition approuvée')).toBeVisible();
  await expect(page.getByText(/Bruno Leroy/).first()).toBeVisible();
  await expect(page.getByText('évaluation : Utile')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approuver' })).toHaveCount(0);

  await page.getByRole('link', { name: 'Mesure' }).click();
  await expect(page.getByRole('heading', { name: 'Mesure' })).toBeVisible();
  const evaluations = page.getByRole('table', { name: 'Évaluations des décideurs' });
  await expect(evaluations.getByRole('row', { name: /^Utile/ })).toContainText('1');
  await expect(page.getByRole('heading', { name: /Décisions : \d+/ })).toBeVisible();
});

test('a viewer reads proposals and evidence but cannot decide', async ({ page }) => {
  await login(page, 'vera');
  await waitForProposals(page, 2);
  await page.getByRole('link', { name: new RegExp(ACME_TOP) }).click();
  await expect(page.getByText('Votre rôle permet la consultation uniquement')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approuver' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Historique' })).toHaveCount(0);
});

test('companies are isolated, even with a copied URL', async ({ page }) => {
  await login(page, 'gina');
  await waitForProposals(page, 1);
  await expect(page.getByRole('link', { name: new RegExp(GLOBEX) })).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(ACME_TOP) })).toHaveCount(0);
  await page.goto(acmeRecommendationUrl);
  await expect(page.getByText('Proposition introuvable ou non accessible')).toBeVisible();
});

test('two reviewers deciding at the same time: the second gets an explicit conflict', async ({
  browser,
}) => {
  const bruno = await newSession(browser, 'bruno');
  const alice = await newSession(browser, 'alice');
  await waitForProposals(bruno, 2);
  await bruno.getByRole('link', { name: new RegExp(ACME_TOP) }).click();
  await alice.goto(bruno.url());
  await expect(alice.getByRole('button', { name: 'Rejeter' })).toBeVisible();
  await alice.getByLabel('Motif (facultatif)').fill('Client en pause (fictif).');
  await alice.getByRole('button', { name: 'Rejeter' }).click();
  await expect(alice.getByText('Décision enregistrée : proposition rejetée')).toBeVisible();
  await bruno.getByRole('button', { name: 'Approuver' }).click();
  await expect(bruno.getByText(/La proposition a été rechargée/)).toBeVisible();
  await expect(bruno.locator('.detail-head .badge').first()).toHaveText('Rejetée');
  await bruno.context().close();
  await alice.context().close();
});

test('editing the proposed step creates a revision that needs its own approval', async ({
  page,
}) => {
  await login(page, 'bruno');
  await waitForProposals(page, 1);
  await page.getByRole('link', { name: new RegExp(ACME_OVERDUE) }).click();
  await page.getByRole('button', { name: 'Modifier' }).click();
  await page
    .getByLabel('Prochaine étape proposée')
    .fill('Appeler le contact fictif jeudi pour confirmer la proposition révisée.');
  await page.getByRole('button', { name: 'Soumettre la révision' }).click();
  await expect(page.locator('.proposed')).toHaveText(
    'Appeler le contact fictif jeudi pour confirmer la proposition révisée.',
  );
  await expect(page.getByRole('heading', { name: 'Versions du contenu' })).toBeVisible();
  await page.getByRole('button', { name: 'Approuver' }).click();
  await expect(page.getByText('Décision enregistrée : proposition approuvée')).toBeVisible();
});

test('a user of two companies chooses one and switches without mixing data', async ({ page }) => {
  await login(page, 'dan');
  await expect(page.getByRole('heading', { name: 'Choisissez une entreprise' })).toBeVisible();
  await page.getByRole('button', { name: /Globex Services/ }).click();
  await waitForProposals(page, 1);
  await expect(page.getByRole('link', { name: new RegExp(GLOBEX) })).toBeVisible();
  await page.getByLabel('Entreprise active').selectOption({ label: 'Acme Industrie (fictive)' });
  await expect(page.getByText(/Lecteur/)).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(GLOBEX) })).toHaveCount(0);
});

test('a change at the source produces a new proposal through the background pipeline', async ({
  page,
}) => {
  // Simulate a change in the fictional CRM (outside Ulysse), then let the worker sync.
  execSync('npm run fixture:crm -- stall globex-demo OPP-002 15', {
    cwd: root,
    env: { ...process.env, ULYSSE_DB_NAME: 'ulysse_e2e' },
    stdio: 'ignore',
  });
  await login(page, 'gina');
  await page.getByRole('link', { name: 'Connexions' }).click();
  await page.getByRole('button', { name: 'Synchroniser maintenant' }).click();
  await expect(page.getByText('Synchronisation demandée')).toBeVisible();
  await waitForProposals(page, 2);
  await expect(
    page.getByRole('link', { name: /Formation équipe — Exemple Conseil/ }),
  ).toBeVisible();
});

test('@mobile the dashboard is usable on a small screen without horizontal scrolling', async ({
  page,
}) => {
  await login(page, 'alice');
  await page.goto('/recommendations');
  await expect(page.getByRole('heading', { name: 'Propositions' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Navigation principale' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test('logout ends the server session', async ({ page }) => {
  await login(page, 'alice');
  await expect(page.getByRole('heading', { name: 'Propositions' })).toBeVisible();
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  // Without an id_token_hint Keycloak asks for a confirmation; the Ulysse session is already revoked.
  await page.waitForURL((url) => url.port === '8080' || url.pathname === '/');
  if (new URL(page.url()).port === '8080')
    await page.getByRole('button', { name: /Logout|Déconnexion/ }).click();
  await expect(page.getByRole('link', { name: 'Se connecter' })).toBeVisible({ timeout: 20_000 });
  const me = await page.request.get('/v1/me');
  expect(me.status()).toBe(401);
});
