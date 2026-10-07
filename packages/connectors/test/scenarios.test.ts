import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateCommercialData } from '@ulysse/domain';
import { commercialFixture, DEMO_SCENARIOS } from '../src/scenarios.ts';

const OPPORTUNITIES = {
  acme: ['OPP-001', 'OPP-002', 'OPP-003', 'OPP-004', 'OPP-005', 'OPP-006'],
  globex: ['OPP-001', 'OPP-002'],
} as const;
const NOW = Date.parse('2026-10-07T12:00:00.000Z');

test('every fictional opportunity has its own valid corpus for every source event', () => {
  for (const [company, ids] of Object.entries(OPPORTUNITIES) as Array<
    ['acme' | 'globex', readonly string[]]
  >)
    for (const id of ids)
      for (const scenario of DEMO_SCENARIOS) {
        const data = commercialFixture(company, scenario, NOW, id);
        assert.deepEqual(validateCommercialData(data), data, `${company} ${id} ${scenario}`);
      }
});

test('sources of one opportunity never describe another prospect', () => {
  const texts = (company: 'acme' | 'globex', id: string) =>
    JSON.stringify(commercialFixture(company, 'baseline', NOW, id));
  assert.match(texts('acme', 'OPP-001'), /Industries Fictives SA/);
  for (const id of ['OPP-002', 'OPP-003', 'OPP-004', 'OPP-005', 'OPP-006'])
    assert.doesNotMatch(texts('acme', id), /Industries Fictives|atelier|capteurs/, id);
  assert.doesNotMatch(texts('globex', 'OPP-001'), /Industries Fictives|Camille Renard/);
  // A generic event is phrased for the opportunity's own contact.
  const reply = commercialFixture('acme', 'positive_reply', NOW, 'OPP-002').materials.at(-1);
  assert.ok(reply);
  assert.equal(reply.author, 'Hugo Lambert (fictif)');
  assert.doesNotMatch(reply.text, /capteurs|arrêt technique/);
});

test('dates follow the replay time and contact constraints follow the events', () => {
  const later = NOW + 30 * 86400000;
  const first = commercialFixture('acme', 'baseline', NOW, 'OPP-001').materials[0];
  const replay = commercialFixture('acme', 'baseline', later, 'OPP-001').materials[0];
  assert.equal(
    Date.parse(replay?.occurredAt ?? '') - Date.parse(first?.occurredAt ?? ''),
    30 * 86400000,
  );
  assert.equal(commercialFixture('acme', 'opposition', NOW).contactPolicy.opposed, true);
  assert.ok(commercialFixture('acme', 'pause', NOW).contactPolicy.pauseUntil);
  assert.ok(commercialFixture('acme', 'baseline', NOW, 'OPP-006').contactPolicy.pauseUntil);
  assert.equal(commercialFixture('acme', 'insufficient', NOW).materials.length, 0);
  assert.equal(commercialFixture('acme', 'baseline', NOW, 'OPP-005').materials.length, 0);
});
