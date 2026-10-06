import { createRegistry, FixtureConnector } from '@ulysse/connectors';
import type { Connector, FixtureStore } from '@ulysse/connectors';
import { createPool, databaseUrl, IdentityRepository, PgUnitOfWork } from '@ulysse/database';
import { defaultRules, systemClock } from '@ulysse/domain';
import { createLogger, createMetrics } from '@ulysse/observability';
import { buildApp } from './app.ts';
import { createOidcProvider } from './auth/oidc.ts';
import { SessionStore } from './auth/sessions.ts';
import { loadConfig } from './config.ts';

const config = loadConfig();
const logger = createLogger('ulysse-api', { level: config.LOG_LEVEL });
const metrics = createMetrics('ulysse-api');
const pool = createPool({
  connectionString: databaseUrl('app'),
  applicationName: 'ulysse-api',
  max: 20,
});

// The API only needs connector definitions (to authorize a source); it never reads providers.
const definitionsOnly: FixtureStore = {
  changesSince: () => Promise.reject(new Error('the API does not read sources')),
  datasetExists: () => Promise.reject(new Error('the API does not read sources')),
};
const connectors: Connector[] = config.ENABLE_FIXTURE_CONNECTOR
  ? [new FixtureConnector(definitionsOnly)]
  : [];

async function discoverWithRetry() {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await createOidcProvider({
        issuer: config.OIDC_ISSUER,
        clientId: config.OIDC_CLIENT_ID,
        clientSecret: config.OIDC_CLIENT_SECRET,
        allowInsecureHttp: config.OIDC_ALLOW_INSECURE_HTTP,
        ...(config.OIDC_INTERNAL_BASE_URL
          ? { internalBaseUrl: config.OIDC_INTERNAL_BASE_URL }
          : {}),
      });
    } catch (error) {
      if (attempt >= 30) throw error;
      logger.warn({ attempt }, 'identity provider not reachable yet, retrying');
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

const app = await buildApp({
  config,
  pool,
  uow: new PgUnitOfWork(pool),
  identity: new IdentityRepository(pool),
  sessions: new SessionStore(pool, {
    absoluteHours: config.SESSION_ABSOLUTE_HOURS,
    idleMinutes: config.SESSION_IDLE_MINUTES,
    secret: config.SESSION_SECRET,
  }),
  oidc: await discoverWithRetry(),
  registry: createRegistry(connectors),
  rules: defaultRules,
  clock: systemClock,
  logger,
  metrics,
});

let closing = false;
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  logger.info({ signal }, 'shutting down');
  const timer = setTimeout(() => process.exit(1), 15_000);
  timer.unref();
  await app.close();
  await pool.end();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: config.API_HOST, port: config.API_PORT });
