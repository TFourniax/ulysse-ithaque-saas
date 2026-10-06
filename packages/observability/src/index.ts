import { randomUUID } from 'node:crypto';
import type { Logger, LoggerOptions } from 'pino';
import { pino } from 'pino';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/**
 * Technical logs are minimized: identifiers, codes, counters and durations.
 * Secrets, cookies, tokens and source content are redacted even if a caller
 * passes them by mistake. Business audit lives in the database, not in logs.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.idToken',
  '*.clientSecret',
  '*.secret',
  '*.apiKey',
  '*.code_verifier',
  '*.payload',
  '*.body',
  '*.content',
];

/** Drops query strings: they may carry OAuth codes, state values or user-entered filters. */
export function pathOnly(url: unknown): string {
  return typeof url === 'string' ? (url.split('?')[0] ?? '') : '';
}

type RequestLike = { method?: unknown; url?: unknown; routeOptions?: { url?: unknown } };

export function createLogger(
  service: string,
  options: { level?: string; pretty?: boolean } = {},
): Logger {
  const config: LoggerOptions = {
    level: options.level ?? process.env.LOG_LEVEL ?? 'info',
    base: { service },
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: {
      req: (req: RequestLike) => ({ method: req.method, path: pathOnly(req.url), route: req.routeOptions?.url }),
    },
  };
  return pino(config);
}

const CORRELATION_ID = /^[A-Za-z0-9._:-]{8,128}$/;

/** Accepts a caller-provided correlation id only when well-formed; otherwise generates one. */
export function correlationIdFrom(header: unknown): string {
  return typeof header === 'string' && CORRELATION_ID.test(header) ? header : randomUUID();
}

export type Metrics = ReturnType<typeof createMetrics>;

/** Prometheus metrics. Labels never contain user content; tenant ids are opaque UUIDs. */
export function createMetrics(service: string) {
  const registry = new Registry();
  registry.setDefaultLabels({ service });
  collectDefaultMetrics({ register: registry });
  return {
    registry,
    httpRequests: new Counter({
      name: 'ulysse_http_requests_total',
      help: 'HTTP requests by route and status class',
      labelNames: ['method', 'route', 'status'],
      registers: [registry],
    }),
    httpDuration: new Histogram({
      name: 'ulysse_http_request_duration_seconds',
      help: 'HTTP request duration',
      labelNames: ['method', 'route'],
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
      registers: [registry],
    }),
    domainErrors: new Counter({
      name: 'ulysse_domain_errors_total',
      help: 'Business errors returned to callers by code',
      labelNames: ['code'],
      registers: [registry],
    }),
    jobs: new Counter({
      name: 'ulysse_jobs_total',
      help: 'Background jobs by queue and outcome',
      labelNames: ['queue', 'outcome'],
      registers: [registry],
    }),
    jobDuration: new Histogram({
      name: 'ulysse_job_duration_seconds',
      help: 'Background job duration',
      labelNames: ['queue'],
      buckets: [0.05, 0.1, 0.5, 1, 5, 15, 60, 300],
      registers: [registry],
    }),
    syncRecords: new Counter({
      name: 'ulysse_sync_records_total',
      help: 'Source records processed by outcome',
      labelNames: ['provider', 'outcome'],
      registers: [registry],
    }),
    dataAge: new Gauge({
      name: 'ulysse_connection_data_age_seconds',
      help: 'Age of the last confirmed source snapshot per connection',
      labelNames: ['tenant', 'connection', 'provider'],
      registers: [registry],
    }),
    queueBacklog: new Gauge({
      name: 'ulysse_queue_backlog',
      help: 'Queued jobs per queue',
      labelNames: ['queue'],
      registers: [registry],
    }),
    outboxBacklog: new Gauge({
      name: 'ulysse_outbox_pending',
      help: 'Unpublished outbox events',
      registers: [registry],
    }),
    timeToRecommendation: new Histogram({
      name: 'ulysse_time_to_recommendation_seconds',
      help: 'Delay between source observation and recommendation generation',
      buckets: [1, 5, 15, 60, 300, 900, 3600, 21600, 86400],
      registers: [registry],
    }),
    modelCalls: new Counter({
      name: 'ulysse_model_calls_total',
      help: 'Model provider calls by provider and outcome',
      labelNames: ['provider', 'model', 'outcome'],
      registers: [registry],
    }),
    modelTokens: new Counter({
      name: 'ulysse_model_tokens_total',
      help: 'Model tokens consumed (observed, as reported by the provider)',
      labelNames: ['provider', 'model', 'direction'],
      registers: [registry],
    }),
    modelCostUsd: new Counter({
      name: 'ulysse_model_cost_usd_total',
      help: 'Model cost in USD as reported by the provider (absent when not reported)',
      labelNames: ['provider', 'model'],
      registers: [registry],
    }),
  };
}

export type { Logger } from 'pino';
