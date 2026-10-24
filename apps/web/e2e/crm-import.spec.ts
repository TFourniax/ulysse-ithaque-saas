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
