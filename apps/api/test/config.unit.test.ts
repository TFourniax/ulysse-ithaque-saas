import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/config.ts';

const base = {
  NODE_ENV: 'production',
  PUBLIC_ORIGIN: 'https://ulysse.example.test',
  OIDC_ISSUER: 'https://idp.example.test/realms/ulysse',
  OIDC_CLIENT_ID: 'ulysse-web',
  OIDC_CLIENT_SECRET: 'not-a-real-secret',
  SESSION_SECRET: 'x'.repeat(48),
  COOKIE_SECURE: 'true',
};

test('production settings refuse insecure or fictional configurations', () => {
  assert.equal(loadConfig(base).NODE_ENV, 'production');
  for (const [override, message] of [
    [{ OIDC_ALLOW_INSECURE_HTTP: 'true' }, /OIDC_ALLOW_INSECURE_HTTP/],
    [{ COOKIE_SECURE: 'false' }, /COOKIE_SECURE/],
    [{ PUBLIC_ORIGIN: 'http://ulysse.example.test' }, /https/],
    [{ ENABLE_FIXTURE_CONNECTOR: 'true' }, /ENABLE_FIXTURE_CONNECTOR/],
    [{ SESSION_SECRET: 'too-short' }, /SESSION_SECRET|too_small|32/],
  ] as const)
    assert.throws(() => loadConfig({ ...base, ...override }), message);
});
