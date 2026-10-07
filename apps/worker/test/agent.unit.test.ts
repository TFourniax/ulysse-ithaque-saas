import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agentConfig } from '../src/agent-runtime.ts';

test('live activation is explicit and fails closed before any network call', () => {
  assert.equal(agentConfig({}).ULYSSE_ANALYSIS_MODE, 'rules');
  assert.equal(agentConfig({ ULYSSE_ANALYSIS_MODE: 'simulated' }).ULYSSE_ANALYSIS_MODE, 'simulated');
  assert.throws(() => agentConfig({ ULYSSE_ANALYSIS_MODE: 'hermes-live' }));
  assert.throws(() => agentConfig({ ULYSSE_ANALYSIS_MODE: 'invalid' }));
});
