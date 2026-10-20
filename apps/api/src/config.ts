import { z } from 'zod';

const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const Schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  /** Origin users load the web app from; used for redirects and Origin checks. */
  PUBLIC_ORIGIN: z.url(),
  OIDC_ISSUER: z.url(),
  OIDC_CLIENT_ID: z.string().min(1),
  OIDC_CLIENT_SECRET: z.string().min(1),
  /** Only for a local HTTP identity provider (Keycloak dev). Refused in production. */
  OIDC_ALLOW_INSECURE_HTTP: bool,
  /** Optional internal base URL for back-channel calls when the API runs in a container network. */
  OIDC_INTERNAL_BASE_URL: z.url().optional(),
  /** HMAC key deriving CSRF tokens from session tokens (>= 32 chars). */
  SESSION_SECRET: z.string().min(32),
  SESSION_ABSOLUTE_HOURS: z.coerce
    .number()
    .positive()
    .max(24 * 7)
    .default(12),
  SESSION_IDLE_MINUTES: z.coerce
    .number()
    .positive()
    .max(24 * 60)
    .default(120),
  COOKIE_SECURE: bool,
  ENABLE_FIXTURE_CONNECTOR: bool,
  ENABLE_DEMO_SCENARIOS: bool,
  ULYSSE_ANALYSIS_MODE: z
    .enum(['rules', 'simulated', 'hermes-live', 'hermes-stub'])
    .default('rules'),
  WEB_DIST_DIR: z.string().optional(),
  METRICS_TOKEN: z.string().min(24).optional(),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(300),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type ApiConfig = z.infer<typeof Schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const config = Schema.parse(env);
  if (config.NODE_ENV === 'production') {
    if (config.OIDC_ALLOW_INSECURE_HTTP)
      throw new Error('OIDC_ALLOW_INSECURE_HTTP is forbidden in production');
    if (!config.COOKIE_SECURE) throw new Error('COOKIE_SECURE must be true in production');
    if (!config.PUBLIC_ORIGIN.startsWith('https://'))
      throw new Error('PUBLIC_ORIGIN must use https in production');
    if (config.ENABLE_FIXTURE_CONNECTOR)
      throw new Error('ENABLE_FIXTURE_CONNECTOR is forbidden in production');
  }
  return config;
}
