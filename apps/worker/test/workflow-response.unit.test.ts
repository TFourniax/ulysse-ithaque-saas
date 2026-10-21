import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pendingWorkflow } from '@ulysse/domain';
import { inspectWorkflowCompletion, workflowRepairPrompt } from '../src/workflow-response.ts';

const base = pendingWorkflow('buyer', [], 'Fixture structurée');
const completion = (content: unknown, finish_reason = 'stop') => ({
  choices: [{ finish_reason, message: { content } }],
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
