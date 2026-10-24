import AxeBuilder from '@axe-core/playwright';
import type { CrmPreviewDto } from '@ulysse/contracts';
import { expect, test } from '@playwright/test';
import { login } from './support.ts';

const id = 'a9000000-0000-4000-8000-000000000024';
const preview: CrmPreviewDto = {
  id,
  connectionId: null,
  filename: 'affaires.csv',
  expiresAt: '2099-01-01T00:00:00.000Z',
  missing: 0,
  columns: [
    { index: 0, label: 'Titre', role: 'title' },
    { index: 1, label: 'Entreprise', role: 'company' },
    { index: 2, label: 'Notes', role: 'history' },
  ],
  rows: [
    {
      row: 2,
      title: 'Projet fictif A',
      company: 'Atelier fictif',
      errors: [],
      warnings: [],
      action: 'create',
      targetId: null,
      choices: [],
      details: [],
    },
    {
      row: 3,
      title: 'Projet fictif B',
      company: 'Atelier fictif',
      errors: [],
      warnings: ['Vérifier le rapprochement.'],
      action: 'choose',
      targetId: null,
      choices: [],
      details: [],
    },
  ],
};

test('CSV preview is clear, requires resolving ambiguity, confirms only once @mobile', async ({
  page,
}, testInfo) => {
  await login(page, 'alice');
  await page.route('**/v1/connections', (r) => r.fulfill({ json: [] }));
  await page.route('**/v1/crm/imports', (r) => r.fulfill({ json: [] }));
  let confirmed = 0;
  await page.route('**/v1/crm/imports/preview', async (r) => {
    expect(r.request().postDataJSON()).toMatchObject({
      filename: 'affaires.csv',
      text: 'Titre;Entreprise;Notes\nProjet fictif A;Atelier fictif;Information',
    });
    await r.fulfill({ status: 201, json: preview });
  });
  await page.route(`**/v1/crm/imports/${id}/confirm`, async (r) => {
    confirmed++;
    expect(r.request().postDataJSON()).toEqual({
      resolutions: [
        { row: 2, target: 'new' },
        { row: 3, target: 'skip' },
      ],
    });
    await r.fulfill({ status: 202, json: { id, connectionId: id, status: 'queued' } });
  });
  await page.goto('/imports');
  await page.getByLabel('Déposer un fichier CSV', { exact: true }).setInputFiles({
    name: 'affaires.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('Titre;Entreprise;Notes\nProjet fictif A;Atelier fictif;Information'),
  });
  const section = page.getByRole('region', { name: 'Vérifier l’import' });
  await expect(section).toBeVisible();
  await expect(section.getByRole('button', { name: /^Importer/ })).toBeDisabled();
  await section.getByLabel('Choix pour la ligne 3').selectOption('skip');
  await expect(section.getByRole('button', { name: /^Importer 1 affaire/ })).toBeEnabled();
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(
    accessibility.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'),
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: `test-results/november-crm-import-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await section.getByRole('button', { name: /^Importer 1 affaire/ }).click();
  await expect(page.getByText('Import confirmé.', { exact: false })).toBeVisible();
  expect(confirmed).toBe(1);
});
test('CSV errors leave existing data untouched and allow selecting another file @mobile', async ({
  page,
}) => {
  await login(page, 'alice');
  await page.route('**/v1/connections', (r) => r.fulfill({ json: [] }));
  await page.route('**/v1/crm/imports', (r) => r.fulfill({ json: [] }));
  await page.route('**/v1/crm/imports/preview', (r) =>
    r.fulfill({
      status: 422,
      json: {
        error: { code: 'VALIDATION', message: 'Le CSV contient des guillemets mal fermés.' },
      },
    }),
  );
  await page.goto('/imports');
  await page.getByLabel('Déposer un fichier CSV', { exact: true }).setInputFiles({
    name: 'affaires.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('Titre;Entreprise\n"inachevé'),
  });
  await expect(page.getByRole('alert')).toContainText('guillemets mal fermés');
  await expect(page.getByRole('region', { name: 'Vérifier l’import' })).not.toBeVisible();
  await expect(page.getByLabel('Déposer un fichier CSV', { exact: true })).toBeEnabled();
});

test('real CSV corrections unblock review and reach the worker without editing the original file', async ({
  page,
}) => {
  await login(page, 'alice');
  await page.goto('/imports');
  const csv =
    'Titre;Entreprise;Montant;Prochaine action\nImport corrigé fictif A;Atelier fictif A;1,234;Appeler\nImport corrigé fictif B;Atelier fictif B;inconnu;Écrire';
  await page.getByLabel('Déposer un fichier CSV', { exact: true }).setInputFiles({
    name: 'corrections-reelles.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
  const section = page.getByRole('region', { name: 'Vérifier l’import' });
  await expect(section.getByRole('button', { name: /^Importer/ })).toBeDisabled();
  await page.getByLabel('Format des montants', { exact: true }).selectOption('en');
  await page.getByLabel('Devise si elle manque dans le fichier', { exact: true }).fill('EUR');
  await section.getByText('Corriger cette affaire', { exact: true }).nth(1).click();
  await page.getByLabel('Montant — ligne 3', { exact: true }).fill('');
  await section.getByRole('button', { name: 'Appliquer les corrections', exact: true }).click();
  await expect(section.getByRole('button', { name: /^Importer 2 affaire/ })).toBeEnabled();
  await section.getByText('Voir les informations retenues', { exact: true }).first().click();
  await expect(section.getByText('1234 EUR', { exact: true })).toBeVisible();
  await section.getByRole('button', { name: /^Importer 2 affaire/ }).click();
  await expect(page.getByText('Import confirmé.', { exact: false })).toBeVisible();
  await expect(
    page.getByRole('listitem').filter({ hasText: 'corrections-reelles.csv' }),
  ).toContainText('Import terminé', { timeout: 30000 });
  const response = await page.request.get('/v1/opportunities');
  expect(response.ok()).toBe(true);
  expect(await response.text()).toContain('Import corrigé fictif A');
  await page.goto('/connections');
  const importedSource = page.getByRole('listitem').filter({
    has: page.getByRole('heading', { name: 'Affaires importées par fichier', exact: true }),
  });
  await importedSource.getByRole('button', { name: 'Révoquer', exact: true }).click();
  await importedSource
    .getByRole('button', { name: 'Confirmer la révocation', exact: true })
    .click();
  await expect(importedSource.getByText('Révoquée', { exact: true })).toBeVisible();
  await expect(async () => {
    expect(await (await page.request.get('/v1/opportunities')).text()).not.toContain(
      'Import corrigé fictif A',
    );
  }).toPass({ timeout: 30000 });
});

test('edits stay visible after a failed preview and require review before confirmation @mobile', async ({
  page,
}, testInfo) => {
  await login(page, 'alice');
  await page.route('**/v1/connections', (r) => r.fulfill({ json: [] }));
  await page.route('**/v1/crm/imports', (r) => r.fulfill({ json: [] }));
  let attempt = 0;
  const editable: CrmPreviewDto = {
    ...preview,
    columns: [...preview.columns, { index: 3, label: 'Montant', role: 'amount' }],
    rows: preview.rows.map((r) => ({
      ...r,
      action: 'create',
      warnings: [],
      editableCells: [
        { column: 0, original: r.title, value: r.title },
        { column: 3, original: '1,234', value: '1,234' },
      ],
    })),
  };
  await page.route('**/v1/crm/imports/preview', async (r) => {
    attempt++;
    if (attempt === 1) return r.fulfill({ status: 201, json: editable });
    expect(r.request().postDataJSON()).toMatchObject({
      adjustments: {
        numberFormat: 'en',
        defaultCurrency: 'EUR',
        cells: [{ row: 2, column: 3, value: '2500' }],
      },
    });
    if (attempt === 2)
      return r.fulfill({
        status: 503,
        json: { error: { code: 'UNAVAILABLE', message: 'Service temporairement indisponible.' } },
      });
    await r.fulfill({
      status: 201,
      json: {
        ...editable,
        id: 'a9000000-0000-4000-8000-000000000025',
        rows: editable.rows.map((row) => ({
          ...row,
          correctionCount: 1,
          details: [{ label: 'Montant potentiel', value: row.row === 2 ? '2500 EUR' : '1234 EUR' }],
        })),
      },
    });
  });
  await page.goto('/imports');
  await page.getByLabel('Déposer un fichier CSV', { exact: true }).setInputFiles({
    name: 'affaires.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'Titre;Entreprise;Notes;Montant\nProjet fictif A;Atelier fictif;Information;1,234',
    ),
  });
  const section = page.getByRole('region', { name: 'Vérifier l’import' });
  await section.getByLabel('Choix pour la ligne 3').selectOption('skip');
  await page.getByLabel('Format des montants', { exact: true }).selectOption('en');
  await page.getByLabel('Devise si elle manque dans le fichier', { exact: true }).fill('EUR');
  await section.getByText('Corriger cette affaire', { exact: true }).first().click();
  await page.getByLabel('Montant — ligne 2', { exact: true }).fill('2500');
  await expect(section.getByRole('button', { name: /^Importer/ })).toBeDisabled();
  await section.getByRole('button', { name: 'Appliquer les corrections', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('temporairement indisponible');
  await expect(page.getByLabel('Montant — ligne 2', { exact: true })).toHaveValue('2500');
  await expect(section.getByRole('button', { name: /^Importer/ })).toBeDisabled();
  await section.getByRole('button', { name: 'Appliquer les corrections', exact: true }).click();
  await expect(section.getByRole('button', { name: /^Importer 1 affaire/ })).toBeEnabled();
  await expect(section.getByLabel('Choix pour la ligne 3')).toHaveValue('skip');
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(
    accessibility.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'),
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: `test-results/november-crm-corrections-${testInfo.project.name}.png`,
    fullPage: true,
  });
});
