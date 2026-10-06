/**
 * Reusable connector contract suite. Any new provider adapter must pass it with a
 * sandbox or recorded source before being declared usable (see docs/CONNECTORS.md).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Connector, ConnectorContext } from './contract.ts';
import { ConnectorError } from './contract.ts';

export type ContractHarness = Readonly<{
  connector: Connector;
  context: ConnectorContext;
  /** Number of live (non-deleted) records the source currently holds. */
  expectedRecords: number;
}>;

export function defineConnectorContract(
  name: string,
  makeHarness: () => Promise<ContractHarness>,
): void {
  describe(`connector contract: ${name}`, () => {
    test('definition declares capabilities, scopes, field semantics and validates configuration', async () => {
      const { connector } = await makeHarness();
      const d = connector.definition;
      assert.match(d.provider, /^[a-z0-9][a-z0-9-]{1,63}$/);
      assert.ok(d.capabilities.maxPageSize > 0);
      assert.ok(d.authorization.scopes.length > 0, 'a connector declares the scopes it needs');
      assert.ok(Object.keys(d.fields).length > 0, 'a connector documents field semantics');
      assert.throws(() => d.validateConfig({ unexpected: true }), ConnectorError);
    });

    test('a full pass terminates, yields opaque string cursors and every record once', async () => {
      const { connector, context, expectedRecords } = await makeHarness();
      const seen = new Set<string>();
      let cursor: string | null = null;
      for (let page = 0; page < 1000; page += 1) {
        const result = await connector.pullPage(context, { cursor, pageSize: 2 });
        for (const raw of result.records) {
          assert.ok(!seen.has(raw.externalId), `duplicate ${raw.externalId} within a pass`);
          seen.add(raw.externalId);
        }
        assert.ok(result.nextCursor === null || typeof result.nextCursor === 'string');
        cursor = result.nextCursor;
        if (result.complete) break;
      }
      assert.ok(seen.size >= expectedRecords);
    });

    test('normalization is deterministic and never leaks unknown payload members', async () => {
      const { connector, context } = await makeHarness();
      const { records } = await connector.pullPage(context, {
        cursor: null,
        pageSize: connector.definition.capabilities.maxPageSize,
      });
      for (const raw of records) {
        const a = connector.normalize(raw);
        const b = connector.normalize(structuredClone(raw));
        assert.deepEqual(a, b);
        if (a.ok && a.record.fields) {
          assert.deepEqual(Object.keys(a.record.fields).sort(), [
            'amount',
            'lastInteractionAt',
            'name',
            'nextStep',
            'nextStepDueAt',
            'ownerName',
            'segment',
            'stage',
          ]);
        }
      }
    });

    test('a malformed cursor is reported as invalid_cursor, not as data', async () => {
      const { connector, context } = await makeHarness();
      await assert.rejects(
        connector.pullPage(context, { cursor: '%%not-a-cursor%%', pageSize: 2 }),
        (e: unknown) => e instanceof ConnectorError && e.code === 'invalid_cursor',
      );
    });
  });
}
