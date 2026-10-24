import AxeBuilder from '@axe-core/playwright';
import type { WorkflowRunDto } from '@ulysse/contracts';
import { expect, test } from '@playwright/test';
import { login } from './support.ts';

// UI fixture only: no model call and no claim of a live publication.
const body =
  'Un processus à simplifier ?\n\nRepérez les ressaisies entre vos outils.\n1. Choisissez une tâche.\n2. Examinez ses étapes.\n\nParlons de votre organisation.';
const run: WorkflowRunDto = {
  id: 'a9000000-0000-4000-8000-000000000023',
  kind: 'content',
  brief: {
    offer: 'Accompagnement fictif',
    target: 'Dirigeants fictifs',
    phase: 'comparison',
    objective: 'Examiner un processus',
    channel: 'Publication LinkedIn',
    constraints: '',
    buyerRunId: null,
  },
  sourceIds: [],
  revision: 1,
  status: 'draft',
  mode: 'hermes-live',
  result: {
    version: 'november-v1',
    kind: 'content',
    outcome: 'draft',
    summary: 'Synthèse interne de préparation.',
    questions: [],
    findings: [
      {
        topic: 'Angle éditorial',
        analysis: 'Justification interne du choix éditorial.',
        references: ['context:v1'],
      },
    ],
    benchmark: [],
    buyerQuestions: [],
    uniqueness: null,
    content: {
      title: 'Un processus à simplifier ?',
      body,
      callToAction: 'Objectif interne du lecteur.',
      rationale: 'Motif interne de rédaction.',
      references: ['context:v1'],
    },
    limits: ['Limite interne à vérifier avant diffusion.'],
  },
  errorCode: null,
  createdAt: '2026-10-24T12:00:00.000Z',
  inputHash: null,
  agentRunId: null,
  stale: false,
  researchId: null,
};

test('content is readable first, copies only the publication and keeps evidence accessible @mobile', async ({
  page,
  context,
}, testInfo) => {
  await login(page, 'alice');
  await page.route('**/v1/workflows', (route) => route.fulfill({ json: [run] }));
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/content');
  const result = page.locator(`article[id="${run.id}"]`);
  const preview = result.getByRole('region', { name: 'Texte de la publication' });
  await expect(preview).toBeVisible();
  await expect(preview.locator('.publication-preview-body')).toHaveText(body);
  await expect(preview.locator('.publication-preview-body')).toHaveCSS('white-space', 'pre-wrap');
  await expect(result.getByText(run.brief.target, { exact: true })).not.toBeVisible();
  await expect(result.getByRole('heading', { name: 'Angle éditorial' })).not.toBeVisible();
  await preview.getByRole('button', { name: 'Copier le texte' }).click();
  await expect(preview.getByRole('status')).toHaveText(
    'Texte copié. Relisez-le avant de le diffuser.',
  );
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(body);
  const toggle = result
    .locator('summary')
    .filter({ hasText: 'Comprendre ce contenu et vérifier les sources' });
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(result.getByRole('heading', { name: 'Angle éditorial' })).toBeVisible();
  await expect(result.getByText('Limite interne à vérifier avant diffusion.')).toBeVisible();
  await expect(result.getByText('Motif interne de rédaction.')).toBeVisible();
  await expect(result.getByRole('heading', { name: 'Pourquoi ce contenu' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(result.getByRole('heading', { name: 'Angle éditorial' })).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(
    accessibility.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'),
  ).toEqual([]);
  await result.screenshot({ path: `test-results/content-preview-${testInfo.project.name}.png` });
});

test('clipboard refusal offers manual copy while stale content stays visibly warned @mobile', async ({
  page,
}) => {
  await login(page, 'alice');
  await page.route('**/v1/workflows', (route) =>
    route.fulfill({ json: [{ ...run, stale: true }] }),
  );
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new Error('Copy denied for test')) },
    });
  });
  await page.goto('/content');
  const result = page.locator(`article[id="${run.id}"]`);
  await expect(
    result.getByText(/Des sources, le contexte ou la doctrine ont changé/),
  ).toBeVisible();
  await expect(result.getByRole('button', { name: 'Valider le brouillon' })).toBeDisabled();
  await result.getByRole('button', { name: 'Copier le texte' }).click();
  await expect(
    result.getByRole('region', { name: 'Texte de la publication' }).getByRole('alert'),
  ).toContainText('La copie automatique est indisponible.');
  const fallback = result.getByLabel('Texte à copier manuellement');
  await expect(fallback).toHaveValue(body);
  await fallback.focus();
  expect(
    await fallback.evaluate(
      (element: HTMLTextAreaElement) => element.selectionEnd - element.selectionStart,
    ),
  ).toBe(body.length);
  await expect(result.getByRole('status')).not.toHaveText(/Texte copié/);
});
