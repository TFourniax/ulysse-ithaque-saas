import { randomBytes } from 'node:crypto';
import { bootstrap, dropDatabase } from './bootstrap.ts';
import { databaseUrl, rolePasswords } from './config.ts';
import { migrate } from './migrate.ts';

export type TestDatabase = Readonly<{
  name: string;
  adminUrl: string;
  migratorUrl: string;
  appUrl: string;
  workerUrl: string;
  drop(): Promise<void>;
}>;

/**
 * Creates a disposable, fully migrated database on the configured cluster.
 * Fails loudly when no database is configured: an absent database is never a green test.
 */
export async function createTestDatabase(
  env: NodeJS.ProcessEnv = process.env,
): Promise<TestDatabase> {
  const name = `ulysse_test_${randomBytes(6).toString('hex')}`;
  const adminUrl = databaseUrl('admin', env);
  await bootstrap({ adminUrl, database: name, passwords: rolePasswords(env) });
  const migratorUrl = databaseUrl('migrator', env, name);
  await migrate(migratorUrl);
  return {
    name,
    adminUrl,
    migratorUrl,
    appUrl: databaseUrl('app', env, name),
    workerUrl: databaseUrl('worker', env, name),
    drop: () => dropDatabase(adminUrl, name),
  };
}
