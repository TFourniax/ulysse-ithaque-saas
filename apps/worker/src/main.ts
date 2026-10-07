import http from 'node:http';
import { modelSettingsFromEnv } from '@ulysse/ai';
import type { Connector } from '@ulysse/connectors';
import { createRegistry, FixtureConnector, PgFixtureStore } from '@ulysse/connectors';
import { createPool, databaseUrl } from '@ulysse/database';
import { defaultRules, systemClock } from '@ulysse/domain';
import { createLogger, createMetrics } from '@ulysse/observability';
import { loadWorkerConfig } from './config.ts';
import { agentConfig, AgentRuntime } from './agent-runtime.ts';
import { noCredentialStore, WorkerRuntime } from './runtime.ts';

const config = loadWorkerConfig();
const logger = createLogger('ulysse-worker', { level: config.LOG_LEVEL });
const metrics = createMetrics('ulysse-worker');
const connectionString = databaseUrl('worker');
const pool = createPool({
  connectionString,
  applicationName: 'ulysse-worker',
  max: config.WORKER_CONCURRENCY * 2 + 4,
});

const connectors: Connector[] = [];
const agentSettings = agentConfig();
if (
  process.env.MODEL_PROVIDER &&
  process.env.MODEL_PROVIDER !== 'none' &&
  agentSettings.ULYSSE_ANALYSIS_MODE === 'rules'
)
  throw new Error('Legacy paid wording is disabled: use the bounded hermes-live execution path');
const agent =
  agentSettings.ULYSSE_ANALYSIS_MODE === 'rules'
    ? undefined
    : new AgentRuntime(pool, agentSettings);
if (config.ENABLE_FIXTURE_CONNECTOR)
  connectors.push(new FixtureConnector(new PgFixtureStore(pool)));

const runtime = new WorkerRuntime({
  config,
  pool,
  connectionString,
  registry: createRegistry(connectors),
  credentials: noCredentialStore,
  rules: defaultRules,
  clock: systemClock,
  logger,
  metrics,
  model: agent ? undefined : modelSettingsFromEnv(),
  agent,
});

let ready = false;
const server = http.createServer((req, res) => {
  if (req.url?.startsWith('/agent/') && agent) {
    void agent.handleHttp(req, res);
    return;
  }
  const send = (status: number, body: string, type = 'application/json') => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(body);
  };
  if (req.url === '/health/live') return send(200, '{"status":"ok"}');
  if (req.url === '/health/ready') {
    void pool
      .query('SELECT 1')
      .then(() =>
        send(
          ready ? 200 : 503,
          JSON.stringify({
            status: ready ? 'ok' : 'unavailable',
            checks: { database: 'ok', jobs: ready ? 'ok' : 'failed' },
          }),
        ),
      )
      .catch(() => send(503, '{"status":"unavailable","checks":{"database":"failed"}}'));
    return undefined;
  }
  if (
    req.url === '/metrics' &&
    config.METRICS_TOKEN &&
    req.headers.authorization === `Bearer ${config.METRICS_TOKEN}`
  ) {
    void metrics.registry.metrics().then((body) => send(200, body, metrics.registry.contentType));
    return undefined;
  }
  return send(404, '{"error":"not_found"}');
});

let closing = false;
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  ready = false;
  logger.info({ signal }, 'worker shutting down (waiting for active jobs)');
  const timer = setTimeout(() => process.exit(1), 45_000);
  timer.unref();
  await runtime.stop(30_000);
  server.close();
  await pool.end();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

server.listen(config.WORKER_HTTP_PORT, config.WORKER_HTTP_HOST);
await runtime.start();
ready = true;
logger.info({ connectors: connectors.map((c) => c.definition.provider) }, 'worker started');
