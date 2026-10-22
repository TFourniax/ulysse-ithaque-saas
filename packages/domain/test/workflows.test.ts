import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withResearchCoverage } from '../src/research-selection.ts';
import type { WorkflowInput, WorkflowResult } from '../src/workflows.ts';
import {
  pendingWorkflow,
  validateWorkflowPublication,
  validateWorkflowResult,
  workflowInputHash,
  workflowQuestions,
} from '../src/workflows.ts';
import { FIXTURE_CONTEXT } from '../src/testing/fixtures.ts';
const input: WorkflowInput = {
  kind: 'buyer',
  brief: {
    offer: 'Offre de test',
    target: 'Acheteur de test',
    phase: 'exploration',
    objective: 'Comprendre le besoin',
    channel: 'Site',
    constraints: '',
    buyerRunId: null,
  },
  context: {
    tenantId: 't',
    id: 'c',
    version: 1,
    content: FIXTURE_CONTEXT,
    source: 'fixture',
    note: null,
    createdBy: null,
    createdAt: '2026-10-20T00:00:00Z',
  },
  doctrine: null,
  sources: [
    {
      id: 's',
      revision: 1,
      kind: 'offer',
      title: 'Offre de test',
      url: null,
      text: 'Service de test avec accompagnement.',
      observedAt: '2026-10-20T00:00:00Z',
      origin: 'company',
    },
  ],
  buyer: null,
};
const draft: WorkflowResult = {
  ...pendingWorkflow('buyer', [], 'Simulation de test'),
  outcome: 'draft',
  findings: [
    {
      topic: 'Compréhension',
      analysis: 'Accompagnement décrit dans l’offre.',
      references: ['source:s:r1'],
    },
  ],
  uniqueness: {
    verdict: 'insufficient_evidence',
    reason: 'Aucune alternative documentée.',
    references: ['source:s:r1'],
  },
};
test('research coverage counts distinct cited actors, retained partial data and pending reviews without claiming market exhaustiveness', () => {
  const researchInput: WorkflowInput = {
    ...input,
    sources: [
      ...input.sources,
      ...['a', 'b', 'c'].map((id) => ({
        ...input.sources[0]!,
        id,
        kind: 'competitor' as const,
        research: {
          relevance: 'direct' as const,
          reason: '',
          review: 'pending' as const,
          offers: [],
          targets: [],
          dimensions: [],
        },
      })),
    ],
    research: {
      id: 'r',
      revision: 1,
      status: 'paused',
      candidateCount: 100,
      qualifiedCount: 3,
      pendingReferences: ['source:a:r1'],
    },
  };
  const result = withResearchCoverage(
    {
      ...draft,
      benchmark: [
        { topic: 'A', analysis: 'Offre documentée', references: ['source:a:r1', 'source:s:r1'] },
        { topic: 'A autre offre', analysis: 'Autre périmètre', references: ['source:a:r1'] },
      ],
    },
    researchInput,
  );
  assert.match(result.limits[0]!, /1 alternative.*sur 3 fiches/u);
  assert.match(result.limits[0]!, /1 fiche.*revue humaine/u);
  assert.match(result.limits[0]!, /Collecte partielle/u);
  assert.match(result.limits[0]!, /ne représente pas tout le marché/u);
  assert.deepEqual(validateWorkflowResult(result), result);
  assert.equal(withResearchCoverage(draft, input), draft);
});
test('content asks for purpose, target, phase and channel before a draft', () => {
  const questions = workflowQuestions({
    ...input,
    kind: 'content',
    brief: { ...input.brief, target: '', phase: 'unknown', objective: '', channel: '' },
  });
  assert.equal(questions.length, 4);
  assert.throws(() =>
    validateWorkflowPublication(
      {
        ...draft,
        kind: 'content',
        uniqueness: null,
        content: {
          title: 'Titre',
          body: 'Texte',
          callToAction: 'Action',
          rationale: 'Raison',
          references: ['source:s:r1'],
        },
      },
      { ...input, kind: 'content', brief: { ...input.brief, phase: 'unknown' } },
      new Set(['source:s:r1']),
    ),
  );
});
test('a synthetic buyer cannot claim uniqueness without a retrieved competitor comparison', () => {
  validateWorkflowPublication(draft, input, new Set(['source:s:r1']));
  assert.throws(() =>
    validateWorkflowPublication(
      { ...draft, uniqueness: { ...draft.uniqueness!, verdict: 'plausible' } },
      input,
      new Set(['source:s:r1']),
    ),
  );
  assert.throws(() =>
    validateWorkflowPublication(
      {
        ...draft,
        benchmark: [{ topic: 'Invented rival', analysis: 'Cheaper', references: ['source:s:r1'] }],
      },
      input,
      new Set(['source:s:r1']),
    ),
  );
});
test('unread citations, mismatched kinds and mixed output shapes fail closed', () => {
  assert.throws(() => validateWorkflowPublication(draft, input, new Set()));
  assert.throws(() =>
    validateWorkflowPublication({ ...draft, kind: 'content' }, input, new Set(['source:s:r1'])),
  );
  assert.throws(() => validateWorkflowResult({ ...draft, score: 99 }));
  assert.throws(() =>
    validateWorkflowResult({ ...draft, outcome: 'needs_context', questions: ['Question ?'] }),
  );
  assert.deepEqual(validateWorkflowResult(draft), draft);
});
test('source, context and linked diagnosis changes invalidate the shared input fingerprint', () => {
  const baseline = workflowInputHash(input);
  assert.notEqual(
    baseline,
    workflowInputHash({ ...input, sources: [{ ...input.sources[0]!, revision: 2 }] }),
  );
  assert.notEqual(
    baseline,
    workflowInputHash({ ...input, context: { ...input.context!, version: 2 } }),
  );
  assert.notEqual(baseline, workflowInputHash({ ...input, buyer: { id: 'buyer', result: draft } }));
});
