import type { Pool } from 'pg';
import pg from 'pg';
import type { FixtureItem, FixtureStore } from './fixture.ts';

/**
 * Simulated provider storage for local demos: a separate `fixture_crm` schema that
 * stands for an external CRM. It is created only by the development seed, never by
 * production migrations, and is read by the worker exactly like a remote API.
 */
export const FIXTURE_SCHEMA_SQL = `
CREATE SCHEMA IF NOT EXISTS fixture_crm;
CREATE SEQUENCE IF NOT EXISTS fixture_crm.change_seq;
CREATE TABLE IF NOT EXISTS fixture_crm.items (
  dataset text NOT NULL,
  external_id text NOT NULL,
  seq bigint NOT NULL,
  version integer NOT NULL,
  modified_at timestamptz NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  payload jsonb,
  PRIMARY KEY (dataset, external_id)
);
CREATE INDEX IF NOT EXISTS fixture_items_seq_idx ON fixture_crm.items (dataset, seq);
GRANT USAGE ON SCHEMA fixture_crm TO ulysse_worker;
GRANT SELECT ON fixture_crm.items TO ulysse_worker;
`;

export class PgFixtureStore implements FixtureStore {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async datasetExists(dataset: string): Promise<boolean> {
    const result = await this.#pool.query(
      'SELECT 1 FROM fixture_crm.items WHERE dataset = $1 LIMIT 1',
      [dataset],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async changesSince(dataset: string, afterSeq: number, limit: number): Promise<FixtureItem[]> {
    const result = await this.#pool.query<{
      seq: string;
      external_id: string;
      version: number;
      modified_at: string;
      deleted: boolean;
      payload: unknown;
    }>(
      `SELECT seq, external_id, version, modified_at, deleted, payload FROM fixture_crm.items
       WHERE dataset = $1 AND seq > $2 ORDER BY seq LIMIT $3`,
      [dataset, afterSeq, limit],
    );
    return result.rows.map((r) => ({
      seq: Number(r.seq),
      externalId: r.external_id,
      version: r.version,
      modifiedAt: new Date(r.modified_at).toISOString(),
      deleted: r.deleted,
      payload: r.payload,
    }));
  }
}

/** Writes to the simulated provider (development CLI / seed only, migrator credentials). */
export class FixtureCrmWriter {
  readonly #client: pg.Client;

  private constructor(client: pg.Client) {
    this.#client = client;
  }

  static async connect(migratorUrl: string): Promise<FixtureCrmWriter> {
    const client = new pg.Client({
      connectionString: migratorUrl,
      application_name: 'ulysse-fixture-crm',
    });
    await client.connect();
    await client.query(FIXTURE_SCHEMA_SQL);
    return new FixtureCrmWriter(client);
  }

  async upsert(
    dataset: string,
    externalId: string,
    payload: unknown,
    modifiedAt: string,
  ): Promise<void> {
    await this.#client.query(
      `INSERT INTO fixture_crm.items (dataset, external_id, seq, version, modified_at, deleted, payload)
       VALUES ($1, $2, nextval('fixture_crm.change_seq'), 1, $3, false, $4)
       ON CONFLICT (dataset, external_id) DO UPDATE SET seq = nextval('fixture_crm.change_seq'),
         version = fixture_crm.items.version + 1, modified_at = EXCLUDED.modified_at, deleted = false, payload = EXCLUDED.payload`,
      [dataset, externalId, modifiedAt, JSON.stringify(payload)],
    );
  }

  async remove(dataset: string, externalId: string, modifiedAt: string): Promise<boolean> {
    const result = await this.#client.query(
      `UPDATE fixture_crm.items SET seq = nextval('fixture_crm.change_seq'), version = version + 1, modified_at = $3,
         deleted = true, payload = NULL WHERE dataset = $1 AND external_id = $2 AND NOT deleted`,
      [dataset, externalId, modifiedAt],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async list(
    dataset: string,
  ): Promise<Array<{ externalId: string; version: number; deleted: boolean }>> {
    const result = await this.#client.query<{
      external_id: string;
      version: number;
      deleted: boolean;
    }>(
      'SELECT external_id, version, deleted FROM fixture_crm.items WHERE dataset = $1 ORDER BY external_id',
      [dataset],
    );
    return result.rows.map((r) => ({
      externalId: r.external_id,
      version: r.version,
      deleted: r.deleted,
    }));
  }

  async close(): Promise<void> {
    await this.#client.end();
  }
}
