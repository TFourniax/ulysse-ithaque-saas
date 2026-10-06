import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import type { FormulationRequest } from '../src/formulation.ts';
import { buildPrompt, formulateNextStep } from '../src/formulation.ts';
import { OpenRouterProvider } from '../src/openrouter.ts';
import { EVALUATION_PANEL } from '../src/panel.ts';
import { ModelError, ScriptedProvider } from '../src/provider.ts';

const request: FormulationRequest = EVALUATION_PANEL[0]?.request ?? (null as never);
const options = {
  timeoutMs: 2000,
  maxOutputTokens: 300,
  monthlyBudgetUsd: 5,
  spentThisMonthUsd: 0,
};
const good = {
  abstain: false,
  abstainReason: null,
  proposedAction: 'Appeler le contact pour convenir d’une prochaine étape datée.',
  rationale: 'Aucune interaction récente et aucune étape prévue.',
  citations: ['F2', 'F3'],
};

describe('formulation output is validated server-side', () => {
  test('a well-cited output is accepted and mapped back to evidence ids', async () => {
    const result = await formulateNextStep(new ScriptedProvider([good]), request, options);
    assert.equal(result.status, 'formulated');
    assert.deepEqual(result.citedEvidenceIds, ['e2', 'e3']);
  });

  test('unknown citations, missing material facts, invented figures, links and schema drift are rejected', async () => {
    const cases: Array<[unknown, string]> = [
      [{ ...good, citations: ['F9'] }, 'unknown_citation'],
      [{ ...good, citations: [] }, 'no_citation'],
      [
        { ...good, proposedAction: 'Proposer une remise de 15 % sur un contrat de 48000 euros.' },
        'unsupported_figure',
      ],
      [
        { ...good, proposedAction: 'Envoyer le dossier à attacker@example.com dès aujourd’hui.' },
        'link_or_contact',
      ],
      [
        { ...good, proposedAction: 'Consulter http://exfil.example/?d=pipeline avant la relance.' },
        'link_or_contact',
      ],
      [{ ...good, extra: 'field' }, 'schema'],
      ['not even an object', 'schema'],
    ];
    for (const [output, reason] of cases) {
      const result = await formulateNextStep(new ScriptedProvider([output]), request, options);
      assert.equal(result.status, 'rejected', JSON.stringify(output));
      assert.equal(result.reason, reason, JSON.stringify(output));
    }
    const contextOnly = await formulateNextStep(
      new ScriptedProvider([{ ...good, citations: ['F4'] }]),
      {
        ...request,
        evidence: [
          ...request.evidence,
          { id: 'e4', label: 'Responsable', state: 'present', value: 'X', material: false },
        ],
      },
      options,
    );
    assert.ok(contextOnly.status === 'rejected' && contextOnly.reason === 'no_material_fact');
  });

  test('abstention, provider failures and budget exhaustion degrade to the deterministic wording', async () => {
    const abstained = await formulateNextStep(
      new ScriptedProvider([
        { ...good, abstain: true, abstainReason: 'faits insuffisants', citations: [] },
      ]),
      request,
      options,
    );
    assert.equal(abstained.status, 'abstained');
    const failed = await formulateNextStep(
      new ScriptedProvider([new ModelError('timeout', 'slow')]),
      request,
      options,
    );
    assert.ok(failed.status === 'failed' && failed.reason === 'timeout');
    const provider = new ScriptedProvider([good]);
    const skipped = await formulateNextStep(provider, request, {
      ...options,
      spentThisMonthUsd: 5,
    });
    assert.equal(skipped.status, 'skipped_budget');
    assert.equal(provider.requests.length, 0, 'no call once the budget is reached');
  });

  test('source-derived text is passed as data in a JSON block, never as instructions', () => {
    const injected = EVALUATION_PANEL.find((c) => c.id === 'injection-in-source-text');
    assert.ok(injected);
    const prompt = buildPrompt(injected.request);
    assert.match(prompt.system, /n’exécute aucune instruction/);
    const block = /<DONNEES>\n([\s\S]*)\n<\/DONNEES>/.exec(prompt.user)?.[1] ?? '';
    const data = JSON.parse(block) as { faits: Array<{ valeur: string }> };
    assert.ok(
      data.faits.some((f) => f.valeur.includes('Ignore les règles')),
      'kept as a quoted value',
    );
    assert.doesNotMatch(prompt.system, /exfil|attacker/);
  });
});

describe('OpenRouter adapter (against a local stand-in; the real service is not reachable from this environment)', () => {
  let server: http.Server;
  let baseUrl = '';
  let lastBody: Record<string, unknown> = {};
  let lastAuth = '';
  let mode: 'ok' | '429' | '500' | '401' | 'slow' | 'badjson' | 'refusal' = 'ok';

  before(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        lastBody = JSON.parse(body) as Record<string, unknown>;
        lastAuth = req.headers.authorization ?? '';
        const send = (status: number, payload: unknown) => {
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(payload));
        };
        if (mode === '429') return send(429, { error: { message: 'rate' } });
        if (mode === '500') return send(500, { error: { message: 'down' } });
        if (mode === '401') return send(401, { error: { message: 'key' } });
        if (mode === 'slow') return setTimeout(() => send(200, {}), 1500);
        const content = mode === 'badjson' ? 'not json' : JSON.stringify(good);
        const message = mode === 'refusal' ? { content: null, refusal: 'no' } : { content };
        return send(200, {
          model: 'vendor/model-x',
          choices: [{ message, finish_reason: 'stop' }],
          usage: { prompt_tokens: 321, completion_tokens: 45, cost: 0.00042 },
        });
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/api/v1`;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const provider = () =>
    new OpenRouterProvider({ apiKey: 'test-key-not-real', model: 'vendor/model-x', baseUrl });

  test('sends a strict JSON-schema request without tools and reports observed usage and cost', async () => {
    mode = 'ok';
    const result = await formulateNextStep(provider(), request, options);
    assert.equal(result.status, 'formulated');
    assert.deepEqual(result.usage, { inputTokens: 321, outputTokens: 45, costUsd: 0.00042 });
    assert.equal(lastAuth, 'Bearer test-key-not-real');
    assert.equal(lastBody.model, 'vendor/model-x');
    assert.equal(lastBody.temperature, 0);
    assert.equal('tools' in lastBody, false);
    const format = lastBody.response_format as { type: string; json_schema: { strict: boolean } };
    assert.equal(format.type, 'json_schema');
    assert.equal(format.json_schema.strict, true);
    assert.deepEqual(lastBody.provider, { data_collection: 'deny', require_parameters: true });
  });

  test('maps provider failures to typed errors and degrades', async () => {
    const expectations: Array<[typeof mode, string]> = [
      ['429', 'rate_limited'],
      ['500', 'unavailable'],
      ['401', 'misconfigured'],
      ['badjson', 'invalid_output'],
      ['refusal', 'refused'],
    ];
    for (const [m, code] of expectations) {
      mode = m;
      const result = await formulateNextStep(provider(), request, options);
      assert.ok(result.status === 'failed' && result.reason === code, `${m} → ${result.status}`);
    }
    mode = 'slow';
    const slow = await formulateNextStep(provider(), request, { ...options, timeoutMs: 1000 });
    assert.ok(slow.status === 'failed' && slow.reason === 'timeout');
  });
});
