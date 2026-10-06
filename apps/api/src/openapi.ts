/**
 * Writes the OpenAPI document generated from the Zod route schemas.
 * Usage: npm run openapi -w @ulysse/api [-- --check]
 * Builds the app with inert dependencies: no database, identity provider or network access.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRegistry, FixtureConnector, MemoryFixtureStore } from '@ulysse/connectors';
import { createPool, IdentityRepository, PgUnitOfWork } from '@ulysse/database';
import { defaultRules, systemClock } from '@ulysse/domain';
import { createLogger, createMetrics } from '@ulysse/observability';
import { buildApp } from './app.ts';
import { SessionStore } from './auth/sessions.ts';
import { loadConfig } from './config.ts';

const target = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../docs/api/openapi.json',
);
const config = loadConfig({
  NODE_ENV: 'test',
  PUBLIC_ORIGIN: 'https://ulysse.example',
  OIDC_ISSUER: 'https://idp.example/realms/ulysse',
  OIDC_CLIENT_ID: 'ulysse-web',
  OIDC_CLIENT_SECRET: 'unused',
  SESSION_SECRET: 'openapi-generation-only-secret-0123456789',
  LOG_LEVEL: 'silent',
});
const pool = createPool({
  connectionString: 'postgres://unused@127.0.0.1:1/unused',
  applicationName: 'openapi',
});
const app = await buildApp({
  config,
  pool,
  uow: new PgUnitOfWork(pool),
  identity: new IdentityRepository(pool),
  sessions: new SessionStore(pool, {
    absoluteHours: 1,
    idleMinutes: 1,
    secret: config.SESSION_SECRET,
  }),
  oidc: {
    issuer: config.OIDC_ISSUER,
    authorizationUrl: () => new URL(config.OIDC_ISSUER),
    exchange: () => Promise.reject(new Error('unused')),
    endSessionUrl: () => null,
  },
  registry: createRegistry([new FixtureConnector(new MemoryFixtureStore())]),
  rules: defaultRules,
  clock: systemClock,
  logger: createLogger('openapi', { level: 'silent' }),
  metrics: createMetrics('openapi'),
});
await app.ready();
const document = `${JSON.stringify(app.swagger(), null, 2)}\n`;
await app.close();
await pool.end();
if (process.argv.includes('--check')) {
  const current = await readFile(target, 'utf8').catch(() => '');
  if (current !== document) {
    console.error('docs/api/openapi.json is out of date: run `npm run openapi`.');
    process.exitCode = 1;
  }
} else {
  await writeFile(target, document);
  console.warn(`OpenAPI written to ${path.relative(process.cwd(), target)}`);
}
