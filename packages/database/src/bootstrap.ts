import pg from 'pg';

export type BootstrapOptions = Readonly<{
  adminUrl: string;
  database: string;
  passwords: Readonly<{ migrator: string; app: string; worker: string }>;
}>;

const DATABASE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * Creates (idempotently) the cluster roles and the application database.
 * Requires a superuser or a role with CREATEROLE/CREATEDB; run once per environment.
 * Runtime roles are created without BYPASSRLS; only the NOLOGIN definer bypasses RLS.
 */
export async function bootstrap(options: BootstrapOptions): Promise<void> {
  if (!DATABASE_NAME.test(options.database)) throw new Error('invalid database name');
  for (const [name, value] of Object.entries(options.passwords)) {
    if (value.length < 12) throw new Error(`password for ${name} must have at least 12 characters`);
  }
  const admin = new pg.Client({ connectionString: options.adminUrl });
  await admin.connect();
  try {
    const roles: Array<[string, string]> = [
      ['ulysse_runtime', 'NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS'],
      ['ulysse_definer', 'NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS'],
      [
        'ulysse_migrator',
        `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD ${admin.escapeLiteral(options.passwords.migrator)}`,
      ],
      [
        'ulysse_app',
        `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD ${admin.escapeLiteral(options.passwords.app)}`,
      ],
      [
        'ulysse_worker',
        `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD ${admin.escapeLiteral(options.passwords.worker)}`,
      ],
    ];
    for (const [role, attributes] of roles) {
      const exists = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
      await admin.query(`${exists.rowCount ? 'ALTER' : 'CREATE'} ROLE ${role} WITH ${attributes}`);
    }
    await admin.query('GRANT ulysse_runtime TO ulysse_app, ulysse_worker');
    // The migrator must be able to hand function ownership to the definer (PostgreSQL 16+ SET option).
    await admin.query('GRANT ulysse_definer TO ulysse_migrator WITH SET TRUE, INHERIT FALSE');
    const db = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      options.database,
    ]);
    if (!db.rowCount)
      await admin.query(`CREATE DATABASE ${options.database} OWNER ulysse_migrator`);
  } finally {
    await admin.end();
  }
  const url = new URL(options.adminUrl);
  url.pathname = `/${options.database}`;
  const scoped = new pg.Client({ connectionString: url.toString() });
  await scoped.connect();
  try {
    await scoped.query(`REVOKE ALL ON DATABASE ${options.database} FROM PUBLIC`);
    await scoped.query(
      `GRANT CONNECT ON DATABASE ${options.database} TO ulysse_migrator, ulysse_app, ulysse_worker`,
    );
    await scoped.query('ALTER SCHEMA public OWNER TO ulysse_migrator');
    await scoped.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
  } finally {
    await scoped.end();
  }
}

/** Drops a disposable database (tests only). */
export async function dropDatabase(adminUrl: string, database: string): Promise<void> {
  if (!DATABASE_NAME.test(database) || !database.startsWith('ulysse_test_'))
    throw new Error('refusing to drop non-test database');
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}
