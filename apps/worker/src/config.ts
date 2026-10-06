import { z } from 'zod';

const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const Schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  WORKER_HTTP_HOST: z.string().default('127.0.0.1'),
  WORKER_HTTP_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
  /** Max concurrent jobs of one tenant across workers: one tenant cannot saturate the others. */
  WORKER_TENANT_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(1),
  SYNC_PAGE_SIZE: z.coerce.number().int().min(1).max(500).default(100),
  /** Pages read by one job before yielding to other tenants with a continuation job. */
  SYNC_MAX_PAGES_PER_JOB: z.coerce.number().int().min(1).max(1000).default(20),
  OUTBOX_POLL_MS: z.coerce.number().int().min(100).max(60_000).default(1000),
  SYNC_DISPATCH_CRON: z.string().default('* * * * *'),
  MAINTENANCE_CRON: z.string().default('*/5 * * * *'),
  ENABLE_FIXTURE_CONNECTOR: bool,
  METRICS_TOKEN: z.string().min(24).optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type WorkerConfig = z.infer<typeof Schema>;

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const config = Schema.parse(env);
  // The fictional CRM must never run next to real data or be mistaken for an integration.
  if (config.NODE_ENV === 'production' && config.ENABLE_FIXTURE_CONNECTOR)
    throw new Error('ENABLE_FIXTURE_CONNECTOR is forbidden in production');
  return config;
}
