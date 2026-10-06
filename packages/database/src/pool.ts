import pg from 'pg';

const { builtins } = pg.types;

function isoInstant(value: string): string {
  return new Date(value).toISOString();
}

/** Timestamps cross the boundary as canonical UTC ISO strings, never as local Date objects. */
const types: pg.CustomTypesConfig = {
  getTypeParser: (oid, format) => {
    if (oid === builtins.TIMESTAMPTZ) return isoInstant;
    if (oid === builtins.TIMESTAMP) return (value: string) => isoInstant(`${value}Z`);
    // Delegation to the library default parser for every other type.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return pg.types.getTypeParser(oid, format);
  },
};

export type PoolOptions = Readonly<{
  connectionString: string;
  applicationName: string;
  max?: number;
  statementTimeoutMs?: number;
}>;

export function createPool(options: PoolOptions): pg.Pool {
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    application_name: options.applicationName,
    max: options.max ?? 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: options.statementTimeoutMs ?? 15_000,
    types,
  });
  // An idle client error must not crash the process; the next checkout gets a fresh client.
  pool.on('error', () => undefined);
  return pool;
}

export type { Pool, PoolClient } from 'pg';
