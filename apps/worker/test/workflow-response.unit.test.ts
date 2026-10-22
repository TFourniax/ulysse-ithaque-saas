import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pendingWorkflow } from '@ulysse/domain';
import { z } from 'zod';
import {
  inspectWorkflowCompletion,
  inspectBuyerCitations,
  workflowRepairPrompt,
  workflowResponseFormat,
  retainSupportedBuyerSections,
} from '../src/workflow-response.ts';

const base = pendingWorkflow('buyer', [], 'Fixture structurée');
const completion = (content: unknown, finish_reason = 'stop') => ({
  choices: [{ finish_reason, message: { content } }],
});

test('partial review keeps bilateral rows, removes dependent conclusions and never invents a missing citation', () => {
  const evidence = {
    references: ['own', 'rival'],
    offerReferences: ['own'],
    competitorReferences: ['rival'],
  };
  const reviewed = {
    ...base,
    outcome: 'draft' as const,
    summary: 'Unsupported global superiority',
    questions: ['Accusation from removed row?'],
    buyerQuestions: ['Unknown cost?'],
    findings: [
      { topic: 'Offer', analysis: 'Description supported by own source', references: ['own'] },
      { topic: 'Invented', analysis: 'Unretrieved', references: ['foreign'] },
    ],
    benchmark: [
      { topic: 'Supported', analysis: 'Two described offers', references: ['own', 'rival'] },
      { topic: 'Unilateral', analysis: 'Missing own evidence', references: ['rival'] },
      {
        topic: 'Unknown',
        analysis: 'Citation outside allowed texts',
        references: ['own', 'foreign'],
      },
    ],
    uniqueness: {
      verdict: 'plausible' as const,
      reason: 'Unsupported uniqueness',
      references: ['own', 'rival'],
    },
  };
  const partial = retainSupportedBuyerSections(reviewed, evidence);
  assert.ok(partial);
  assert.deepEqual(partial.benchmark, [reviewed.benchmark[0]]);
  assert.deepEqual(partial.findings, [reviewed.findings[0]]);
  assert.equal(partial.uniqueness?.verdict, 'insufficient_evidence');
  assert.deepEqual(partial.questions, []);
  assert.deepEqual(partial.buyerQuestions, []);
  assert.ok(!JSON.stringify(partial).includes('Unsupported'));
  assert.match(partial.summary, /partiel/);
  assert.equal(inspectBuyerCitations(partial, evidence), null);
  assert.equal(
    retainSupportedBuyerSections({ ...reviewed, benchmark: reviewed.benchmark.slice(1) }, evidence),
    null,
  );
  assert.equal(retainSupportedBuyerSections({ ...reviewed, findings: [] }, evidence), null);
});

test('review checks each bilateral comparison and affirmative uniqueness, not merely a global own-offer citation', () => {
  const own = 'source:own:r1';
  const rival = 'source:rival:r1';
  const result = {
    ...base,
    outcome: 'draft' as const,
    findings: [{ topic: 'Offre', analysis: 'Documentée', references: [own] }],
    benchmark: [{ topic: 'Concurrent', analysis: 'Comparaison', references: [rival] }],
    uniqueness: {
      verdict: 'not_differentiated' as const,
      reason: 'Similitude',
      references: [rival],
    },
  };
  const evidence = {
    references: [own, rival],
    offerReferences: [own],
    competitorReferences: [rival],
  };
  const diagnostic = inspectBuyerCitations(result, evidence);
  assert.equal(diagnostic?.code, 'result_evidence_invalid');
  assert.deepEqual(
    diagnostic.issues.map((i) => i.path),
    ['benchmark.0.references', 'uniqueness.references'],
  );
  assert.ok(!JSON.stringify(diagnostic).includes(rival));
  const corrected = {
    ...result,
    benchmark: [{ ...result.benchmark[0]!, references: [own, rival] }],
    uniqueness: { ...result.uniqueness, references: [own, rival] },
  };
  assert.equal(inspectBuyerCitations(corrected, evidence), null);
  assert.equal(
    inspectBuyerCitations(corrected, { ...evidence, references: [own] })?.issues[0]?.code,
    'unretrieved_citation',
  );
});

test('native response schema is closed, kind-specific, bounded and restricts citations to supplied evidence', () => {
  const ref = 'source:fixture:r1';
  const properties = z.object({
    kind: z.object({ const: z.string() }),
    summary: z.object({ minLength: z.number(), maxLength: z.number() }),
    findings: z.object({
      items: z.object({
        additionalProperties: z.literal(false),
        properties: z.object({
          references: z.object({
            minItems: z.literal(1),
            maxItems: z.literal(12),
            items: z.object({ enum: z.array(z.string()) }),
          }),
        }),
      }),
    }),
    content: z.object({ type: z.literal('null') }),
  });
  const buyer = workflowResponseFormat('buyer', [ref, ref]);
  assert.equal(buyer.type, 'json_schema');
  assert.equal(buyer.json_schema.strict, true);
  assert.equal(buyer.json_schema.schema.additionalProperties, false);
  assert.deepEqual(buyer.json_schema.schema.required?.toSorted(), Object.keys(base).toSorted());
  const p = properties.parse(buyer.json_schema.schema.properties);
  assert.equal(p.kind.const, 'buyer');
  assert.equal(p.summary.minLength, 1);
  assert.equal(p.summary.maxLength, 2000);
  assert.deepEqual(p.findings.items.properties.references.items.enum, [ref]);
  const content = workflowResponseFormat('content', ['source:another:r2']);
  assert.ok(!JSON.stringify(content).includes(ref));
  const c = z
    .object({
      kind: z.object({ const: z.literal('content') }),
      uniqueness: z.object({ type: z.literal('null') }),
      benchmark: z.object({ maxItems: z.literal(0) }),
      buyerQuestions: z.object({ maxItems: z.literal(0) }),
    })
    .safeParse(content.json_schema.schema.properties);
  assert.ok(c.success);
  assert.throws(() => workflowResponseFormat('buyer', []), /workflow_evidence_missing/);
});

test('workflow format accepts valid JSON and fences but leaves tool continuations alone', () => {
  for (const text of [JSON.stringify(base), `\`\`\`json\n${JSON.stringify(base)}\n\`\`\``])
    assert.equal(
      inspectWorkflowCompletion(completion(text), 'buyer')?.diagnostics.code,
      'validated',
    );
  assert.equal(
    inspectWorkflowCompletion(
      {
        choices: [
          {
            message: { content: null, tool_calls: [{ function: { name: 'read_company_source' } }] },
          },
        ],
      },
      'buyer',
    ),
    null,
  );
});

test('workflow diagnostic separates truncation, invalid JSON, closed schema and conditional invariants', () => {
  const cases: [unknown, string, string][] = [
    ['{"version":', 'stop', 'result_json_invalid'],
    ['{"version":', 'length', 'result_truncated'],
    ['x'.repeat(20001), 'stop', 'result_too_large'],
    [JSON.stringify({ ...base, findings: { offre: 'text' } }), 'stop', 'result_schema_invalid'],
    [JSON.stringify({ ...base, limits: [''] }), 'stop', 'result_schema_invalid'],
    [JSON.stringify({ ...base, private_field: 'private value' }), 'stop', 'result_schema_invalid'],
    [JSON.stringify({ ...base, kind: 'content' }), 'stop', 'result_kind_invalid'],
    [JSON.stringify({ ...base, outcome: 'draft' }), 'stop', 'result_semantics_invalid'],
    [JSON.stringify({ ...base, outcome: 'needs_context' }), 'stop', 'result_semantics_invalid'],
  ];
  for (const [content, finish, code] of cases) {
    const inspected = inspectWorkflowCompletion(completion(content, finish), 'buyer');
    assert.equal(inspected?.diagnostics.code, code);
    assert.ok(!JSON.stringify(inspected.diagnostics).includes('private'));
  }
});

test('duplicate citations cannot pass format repair validation', () => {
  const value = {
    ...base,
    outcome: 'draft',
    findings: [
      {
        topic: 'Offre',
        analysis: 'Fixture',
        references: ['source:fixture:r1', 'source:fixture:r1'],
      },
    ],
    uniqueness: {
      verdict: 'insufficient_evidence',
      reason: 'Fixture',
      references: ['source:fixture:r1'],
    },
  };
  assert.equal(
    inspectWorkflowCompletion(completion(JSON.stringify(value)), 'buyer')?.diagnostics.code,
    'result_semantics_invalid',
  );
});

test('provider refusals never trigger repair; opaque reasoning is replayed without entering diagnostic metadata', () => {
  const refusal = inspectWorkflowCompletion(
    {
      choices: [
        { finish_reason: 'content_filter', message: { content: null, refusal: 'private refusal' } },
      ],
    },
    'buyer',
  );
  assert.equal(refusal?.diagnostics.code, 'result_refused');
  assert.equal(refusal.repairable, false);
  const reasoning_details = [{ type: 'reasoning.encrypted', data: 'private-opaque-replay' }];
  const inspected = inspectWorkflowCompletion(
    {
      choices: [
        {
          finish_reason: 'stop',
          message: {
            content: '{bad',
            reasoning_details,
          },
        },
      ],
    },
    'buyer',
  );
  assert.ok(inspected);
  assert.deepEqual(inspected.assistant.reasoning_details, reasoning_details);
  assert.ok(!JSON.stringify(inspected.diagnostics).includes('private'));
  assert.ok(!workflowRepairPrompt(inspected.diagnostics, 'buyer').includes('private'));
});
