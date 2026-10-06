import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadWorkerConfig } from '../src/config.ts';

test('the fictional fixture connector is refused in production', () => {
  assert.throws(
    () => loadWorkerConfig({ NODE_ENV: 'production', ENABLE_FIXTURE_CONNECTOR: 'true' }),
    /forbidden in production/,
  );
  assert.equal(
    loadWorkerConfig({ NODE_ENV: 'development', ENABLE_FIXTURE_CONNECTOR: 'true' })
      .ENABLE_FIXTURE_CONNECTOR,
    true,
  );
  assert.equal(loadWorkerConfig({ NODE_ENV: 'production' }).ENABLE_FIXTURE_CONNECTOR, false);
});
