import { expect, test } from '@playwright/test';
import { login } from './support.ts';

/** Real BFF, PostgreSQL and background queue. No search provider or model is enabled in CI. */
test('public research authorization starts a durable campaign and exposes missing provider configuration', async ({
  page,
}) => {
  await login(page, 'alice');
  await page.goto('/research');
  await expect(
    page.getByRole('heading', { name: 'Recherche et benchmark', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Nom public', { exact: true }).fill('Entreprise fictive de recette');
  await page.getByLabel('Site officiel', { exact: true }).fill('https://fictive.example/');
  await page.getByLabel('Offres publiques · une par ligne').fill('Intégration de systèmes');
  await page.getByLabel('Acheteurs visés').fill('PME');
  await page.getByLabel('Marché ou secteur').fill('Automatisation métier');
  await page.getByRole('button', { name: 'Autoriser et lancer la recherche' }).click();
  await expect(page.locator('.badge').filter({ hasText: 'Collecte partielle' })).toBeVisible({
    timeout: 30000,
  });
  await expect(
    page.getByText(
      'Le fournisseur de recherche ou le modèle n’est pas encore configuré sur le serveur.',
    ),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Offres et preuves comparables' })).toBeVisible();
  await page.reload();
  await expect(page.locator('.badge').filter({ hasText: 'Collecte partielle' })).toBeVisible();
  const resumed = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/action'));
  await page.getByRole('button', { name: 'Reprendre la collecte', exact: true }).click();
  expect((await resumed).postDataJSON()).not.toHaveProperty('limits');
  await expect(page.locator('.badge').filter({ hasText: 'Collecte partielle' })).toBeVisible();
  await page.getByText('Profil public et autorisation de recherche', { exact: false }).click();
  await page.getByRole('button', { name: 'Arrêter les recherches automatiques' }).click();
  await expect(page.locator('.badge').filter({ hasText: 'Interrompue' })).toBeVisible();
});
