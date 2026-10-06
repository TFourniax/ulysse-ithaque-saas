import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { PGBOSS_SCHEMA, QUEUE_DEFINITIONS } from './jobs.ts';

export const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../migrations',
);

export type MigrationResult = Readonly<{ applied: string[]; alreadyApplied: string[] }>;

const LOCK_KEY = 728_340_211;

/**
 * Applies SQL migrations in order, each in its own transaction, under an advisory
 * lock. Applied migrations are checksummed: editing a historical file is refused
 * (write a new migration instead).
 */
export async function migrate(
  migratorUrl: string,
  directory = MIGRATIONS_DIR,
): Promise<MigrationResult> {
  const client = new pg.Client({
    connectionString: migratorUrl,
    application_name: 'ulysse-migrate',
  });
  await client.connect();
  const applied: string[] = [];
  const alreadyApplied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations (
      version text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const known = new Map(
      (
        await client.query<{ version: string; checksum: string }>(
          'SELECT version, checksum FROM public.schema_migrations',
        )
      ).rows.map((r) => [r.version, r.checksum]),
    );
    const files = (await readdir(directory))
      .filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f))
      .sort();
    for (const file of files) {
      const sql = await readFile(path.join(directory, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const previous = known.get(file);
      if (previous !== undefined) {
        if (previous !== checksum)
          throw new Error(`migration ${file} was modified after being applied`);
        alreadyApplied.push(file);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO public.schema_migrations (version, checksum) VALUES ($1, $2)',
          [file, checksum],
        );
        await client.query('COMMIT');
        applied.push(file);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(
          `migration ${file} failed: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
    }
    await client.query('REVOKE ALL ON public.schema_migrations FROM PUBLIC');
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
    await client.end();
  }
  await installJobQueues(migratorUrl);
  return { applied, alreadyApplied };
}

/** Installs/updates the pg-boss schema and queues as the migrator, then grants DML to the worker. */
export async function installJobQueues(migratorUrl: string): Promise<void> {
  const boss = new PgBoss({
    connectionString: migratorUrl,
    schema: PGBOSS_SCHEMA,
    application_name: 'ulysse-migrate-jobs',
    supervise: false,
    schedule: false,
    migrate: true,
    createSchema: true,
  });
  boss.on('error', () => undefined);
  await boss.start();
  try {
    const existing = new Set((await boss.getQueues()).map((q) => q.name));
    for (const def of QUEUE_DEFINITIONS) {
      const { name, policy, deadLetter, ...tuning } = def;
      if (existing.has(name))
        await boss.updateQueue(name, { ...tuning, deadLetter: deadLetter ?? null });
      else
        await boss.createQueue(name, { policy, ...tuning, ...(deadLetter ? { deadLetter } : {}) });
    }
  } finally {
    await boss.stop({ graceful: false, close: true });
  }
  const client = new pg.Client({ connectionString: migratorUrl });
  await client.connect();
  try {
    await client.query(`GRANT USAGE ON SCHEMA ${PGBOSS_SCHEMA} TO ulysse_worker`);
    await client.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${PGBOSS_SCHEMA} TO ulysse_worker`,
    );
    await client.query(
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${PGBOSS_SCHEMA} TO ulysse_worker`,
    );
    await client.query(
      `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ${PGBOSS_SCHEMA} TO ulysse_worker`,
    );
    await client.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA ${PGBOSS_SCHEMA} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ulysse_worker`,
    );
  } finally {
    await client.end();
  }
}
