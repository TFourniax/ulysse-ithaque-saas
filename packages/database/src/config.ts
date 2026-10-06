/**
 * Database connection settings built per role. Each process only needs the
 * password of the role it runs as: the API never receives the migrator or
 * worker credentials, the worker never receives the API ones.
 */
export type DatabaseRole = 'admin' | 'migrator' | 'app' | 'worker';

const ROLE_USER: Record<Exclude<DatabaseRole, 'admin'>, string> = {
  migrator: 'ulysse_migrator',
  app: 'ulysse_app',
  worker: 'ulysse_worker',
};

const PASSWORD_ENV: Record<DatabaseRole, string> = {
  admin: 'ULYSSE_DB_ADMIN_PASSWORD',
  migrator: 'ULYSSE_DB_MIGRATOR_PASSWORD',
  app: 'ULYSSE_DB_APP_PASSWORD',
  worker: 'ULYSSE_DB_WORKER_PASSWORD',
};

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim() === '')
    throw new ConfigError(`missing environment variable ${name}`);
  return value;
}

export function databaseUrl(
  role: DatabaseRole,
  env: NodeJS.ProcessEnv = process.env,
  database?: string,
): string {
  const host = env.ULYSSE_DB_HOST ?? '127.0.0.1';
  const port = env.ULYSSE_DB_PORT ?? '55432';
  const name =
    role === 'admin'
      ? (env.ULYSSE_DB_ADMIN_DATABASE ?? 'postgres')
      : (database ?? env.ULYSSE_DB_NAME ?? 'ulysse');
  const user = role === 'admin' ? (env.ULYSSE_DB_ADMIN_USER ?? 'postgres') : ROLE_USER[role];
  const url = new URL(`postgres://${host}:${port}/${name}`);
  url.username = user;
  url.password = requireEnv(env, PASSWORD_ENV[role]);
  if (env.ULYSSE_DB_SSLMODE) url.searchParams.set('sslmode', env.ULYSSE_DB_SSLMODE);
  return url.toString();
}

export function rolePasswords(env: NodeJS.ProcessEnv = process.env): {
  migrator: string;
  app: string;
  worker: string;
} {
  return {
    migrator: requireEnv(env, PASSWORD_ENV.migrator),
    app: requireEnv(env, PASSWORD_ENV.app),
    worker: requireEnv(env, PASSWORD_ENV.worker),
  };
}
