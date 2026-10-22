import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WorkspaceSource } from '@ulysse/domain';
import { workflowResearchCatalog } from '../src/workflow-catalog.ts';

const competitors: WorkspaceSource[] = Array.from({ length: 36 }, (_, i) => ({
  id: `rival-${i}`,
  revision: 1,
  kind: 'competitor',
  title: `Acteur ${i}`,
  url: `https://rival-${i}.example/`,
  text: 'Citation complète seulement accessible par lecture.',
  observedAt: '2026-10-22T10:00:00Z',
  origin: 'observed',
  research: {
    relevance: 'direct',
    reason: 'Besoins communs, disponibilité à vérifier.',
    review: 'pending',
    offers: ['Automatisation'],
    targets: ['PME'],
    dimensions: ['offer', 'target'],
  },
}));
const sources: WorkspaceSource[] = [
  { ...competitors[0]!, id: 'own', kind: 'offer', research: undefined },
  ...competitors,
];

test('automatic catalog exposes more than one page of qualified actors without marking previews as citable evidence', () => {
  const catalog = workflowResearchCatalog(sources, 24000);
  assert.equal(catalog.total, 36);
  assert.equal(catalog.items.length, 36);
  assert.equal(catalog.nextOffset, null);
  assert.ok(catalog.previewOnly);
  assert.ok(!JSON.stringify(catalog).includes('source:'));
  assert.ok(!JSON.stringify(catalog).includes('Citation complète'));
});

test('catalog serialization is bounded and pagination resumes at the first undisplayed source', () => {
  const catalog = workflowResearchCatalog(sources, 1500);
  assert.ok(catalog.items.length > 0 && catalog.items.length < 36);
  assert.ok(Buffer.byteLength(JSON.stringify(catalog)) <= 1500);
  assert.equal(catalog.nextOffset, catalog.items.length + 1);
  assert.equal(sources[catalog.nextOffset]?.id, `rival-${catalog.items.length}`);
  assert.equal(workflowResearchCatalog(sources, 0).items.length, 0);
  assert.equal(workflowResearchCatalog(sources, 0).nextOffset, 1);
});
