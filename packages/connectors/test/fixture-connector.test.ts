import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConnectorError } from '../src/contract.ts';
import type { ConnectorContext, RawRecord } from '../src/contract.ts';
import { FixtureConnector, MemoryFixtureStore } from '../src/fixture.ts';
import { catalogOf, createRegistry } from '../src/registry.ts';
import { defineConnectorContract } from '../src/testing.ts';

const T = '2026-10-06T10:00:00.000Z';

function payload(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    title: `Opportunité fictive ${id}`,
    status: 'open',
    last_activity: '2026-09-20T10:00:00.000Z',
    next_action: null,
    amount_cents: 1250050,
    currency: 'EUR',
    owner: { name: 'Commercial fictif' },
    ...extra,
  };
}

function context(dataset = 'demo'): ConnectorContext {
  return {
    tenantId: '00000000-0000-4000-8000-000000000001',
    connectionId: '00000000-0000-4000-8000-000000000002',
    config: { dataset },
    credential: { type: 'none' },
    signal: new AbortController().signal,
  };
}

function raw(externalId: string, p: unknown, deleted = false): RawRecord {
  return { externalId, providerVersion: '1', etag: null, modifiedAt: T, deleted, payload: p };
}

defineConnectorContract('fixture-crm', async () => {
  const store = new MemoryFixtureStore();
  for (let i = 0; i < 5; i += 1)
    store.upsert('demo', `OPP-${String(i)}`, payload(`OPP-${String(i)}`), T);
  return { connector: new FixtureConnector(store), context: context(), expectedRecords: 5 };
});

test('normalization distinguishes absent keys, explicit nulls and values, and converts units', () => {
  const connector = new FixtureConnector(new MemoryFixtureStore());
  const full = connector.normalize(raw('A', payload('A', { segment: 'ETI industrielles' })));
  assert.ok(full.ok && full.record.fields);
  assert.deepEqual(full.record.fields.amount, {
    state: 'present',
    value: { amount: '12500.50', currency: 'EUR' },
  });
  assert.deepEqual(full.record.fields.nextStep, { state: 'empty' });
  assert.deepEqual(full.record.fields.segment, { state: 'present', value: 'ETI industrielles' });
  const sparse = connector.normalize(
    raw('B', { id: 'B', title: 'Sans détails', status: 'on_hold' }),
  );
  assert.ok(sparse.ok && sparse.record.fields);
  assert.equal(sparse.record.fields.stage, 'open');
  for (const key of [
    'lastInteractionAt',
    'nextStep',
    'nextStepDueAt',
    'amount',
    'ownerName',
    'segment',
  ] as const) {
    assert.deepEqual(sparse.record.fields[key], { state: 'unavailable' }, key);
  }
  const nulls = connector.normalize(
    raw('C', payload('C', { last_activity: null, owner: null, amount_cents: null })),
  );
  assert.ok(nulls.ok && nulls.record.fields);
  assert.deepEqual(nulls.record.fields.lastInteractionAt, { state: 'empty' });
  assert.deepEqual(nulls.record.fields.ownerName, { state: 'empty' });
  assert.deepEqual(nulls.record.fields.amount, { state: 'empty' });
  const noCurrency = connector.normalize(raw('D', { ...payload('D'), currency: undefined }));
  assert.ok(noCurrency.ok && noCurrency.record.fields);
  assert.deepEqual(
    noCurrency.record.fields.amount,
    { state: 'unavailable' },
    'an amount without currency is not guessed',
  );
});

test('invalid payloads are rejected with a reason and never partially stored', () => {
  const connector = new FixtureConnector(new MemoryFixtureStore());
  assert.deepEqual(connector.normalize(raw('E', payload('E', { status: 'maybe' }))), {
    ok: false,
    reason: 'payload_schema',
  });
  assert.deepEqual(connector.normalize(raw('F', payload('other-id'))), {
    ok: false,
    reason: 'identifier_mismatch',
  });
  const injected = connector.normalize(raw('G', payload('G', { title: 'x'.repeat(301) })));
  assert.equal(injected.ok, false);
  const deleted = connector.normalize(raw('H', null, true));
  assert.ok(deleted.ok);
  assert.equal(deleted.record.deleted, true);
  assert.equal(deleted.record.fields, null);
});

test('incremental reads resume from the checkpoint and observe updates and deletions', async () => {
  const store = new MemoryFixtureStore();
  for (let i = 0; i < 5; i += 1)
    store.upsert('demo', `OPP-${String(i)}`, payload(`OPP-${String(i)}`), T);
  const connector = new FixtureConnector(store);
  const first = await connector.pullPage(context(), { cursor: null, pageSize: 3 });
  assert.equal(first.records.length, 3);
  assert.equal(first.complete, false);
  const second = await connector.pullPage(context(), { cursor: first.nextCursor, pageSize: 3 });
  assert.equal(second.records.length, 2);
  assert.equal(second.complete, true);
  const checkpoint = second.nextCursor;
  store.upsert('demo', 'OPP-1', payload('OPP-1', { status: 'won' }), T);
  store.remove('demo', 'OPP-2', T);
  const incremental = await connector.pullPage(context(), { cursor: checkpoint, pageSize: 10 });
  assert.deepEqual(
    incremental.records.map((r) => [r.externalId, r.deleted, r.providerVersion]),
    [
      ['OPP-1', false, '2'],
      ['OPP-2', true, '2'],
    ],
  );
  const idle = await connector.pullPage(context(), {
    cursor: incremental.nextCursor,
    pageSize: 10,
  });
  assert.equal(idle.records.length, 0);
  assert.equal(idle.complete, true);
  assert.equal(idle.nextCursor, incremental.nextCursor);
});

test('provider errors are typed: retryable quota/transient vs terminal authorization', async () => {
  const store = new MemoryFixtureStore();
  store.upsert('demo', 'OPP-1', payload('OPP-1'), T);
  store.injectFault({ onCall: 1, error: new ConnectorError('rate_limited', 'quota', 30) });
  store.injectFault({ onCall: 2, error: new ConnectorError('auth_revoked', 'grant revoked') });
  const connector = new FixtureConnector(store);
  await assert.rejects(
    connector.pullPage(context(), { cursor: null, pageSize: 10 }),
    (e: unknown) => e instanceof ConnectorError && !e.terminal && e.retryAfterSeconds === 30,
  );
  await assert.rejects(
    connector.pullPage(context(), { cursor: null, pageSize: 10 }),
    (e: unknown) => e instanceof ConnectorError && e.terminal,
  );
  const ok = await connector.pullPage(context(), { cursor: null, pageSize: 10 });
  assert.equal(ok.records.length, 1);
  const missing = await connector.validateConnection(context('unknown'));
  assert.equal(missing.ok, false);
});

test('the catalog exposes connectors to the domain and maps configuration errors', () => {
  const catalog = catalogOf(createRegistry([new FixtureConnector(new MemoryFixtureStore())]));
  assert.equal(
    catalog.describe('stratégie'),
    null,
    'no adapter is presumed for undocumented providers',
  );
  const fixture = catalog.describe('fixture-crm');
  assert.ok(fixture);
  assert.equal(fixture.kind, 'fixture');
  assert.deepEqual(fixture.validateConfig({ dataset: 'acme-demo' }), { dataset: 'acme-demo' });
  assert.throws(
    () => fixture.validateConfig({ dataset: 'acme-demo', url: 'http://169.254.169.254' }),
    /INVALID_INPUT/,
  );
});
