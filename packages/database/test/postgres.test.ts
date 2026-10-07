import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { Role } from '@ulysse/domain';
import { fixedClock } from '@ulysse/domain';
import { defineWorkflowScenarios, SCENARIO_START } from '@ulysse/domain/testing';
import pg from 'pg';
import { AdminClient } from '../src/admin.ts';
import { migrate } from '../src/migrate.ts';
import { createPool } from '../src/pool.ts';
import type { TestDatabase } from '../src/testing.ts';
import { createTestDatabase } from '../src/testing.ts';
import { PgUnitOfWork } from '../src/uow.ts';

let db: TestDatabase;
let admin: AdminClient;

before(async () => {
  db = await createTestDatabase();
  admin = await AdminClient.connect(db.migratorUrl);
});

after(async () => {
  await admin.close();
  await db.drop();
});

let tenantCounter = 0;

async function tenant(name: string): Promise<string> {
  tenantCounter += 1;
  return admin.provisionTenant(
    `t-${String(tenantCounter)}-${crypto.randomUUID().slice(0, 8)}`,
    name,
  );
}

async function member(tenantId: string, role: Role, displayName: string): Promise<string> {
  const userId = await admin.provisionUser({
    issuer: 'https://idp.test/realms/ulysse',
    subject: crypto.randomUUID(),
    email: null,
    displayName,
  });
  await admin.setMembership(tenantId, userId, role);
  return userId;
}

defineWorkflowScenarios('postgresql, ulysse_app role', async () => {
  const pool = createPool({ connectionString: db.appUrl, applicationName: 'ulysse-test', max: 6 });
  const uow = new PgUnitOfWork(pool);
  return {
    uow,
    clock: fixedClock(SCENARIO_START),
    createTenant: tenant,
    addMember: member,
    outbox: async (tenantId: string) => {
      // Read through a tenant-scoped transaction like any runtime code.
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
        const rows = await client.query<{
          event_type: string;
          subject_id: string;
          tenant_id: string;
        }>('SELECT tenant_id, event_type, subject_id FROM outbox ORDER BY created_at');
        await client.query('COMMIT');
        return rows.rows.map((r) => ({
          tenantId: r.tenant_id,
          id: '',
          eventType: r.event_type as never,
          subjectType: '',
          subjectId: r.subject_id,
          payload: {},
          createdAt: '',
        }));
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
});

describe('row-level security with the real runtime roles', () => {
  let app: pg.Pool;
  let worker: pg.Pool;
  let tenantA: string;
  let tenantB: string;
  let userA: string;

  before(async () => {
    app = createPool({ connectionString: db.appUrl, applicationName: 'ulysse-rls-test', max: 1 });
    worker = createPool({
      connectionString: db.workerUrl,
      applicationName: 'ulysse-rls-test-worker',
      max: 1,
    });
    tenantA = await tenant('RLS A');
    tenantB = await tenant('RLS B');
    userA = await member(tenantA, 'owner', 'Owner A');
    await member(tenantB, 'owner', 'Owner B');
    // Seed one connection per tenant through the runtime role and its tenant context.
    for (const t of [tenantA, tenantB]) {
      const c = await app.connect();
      try {
        await c.query('BEGIN');
        await c.query("SELECT set_config('app.tenant_id', $1, true)", [t]);
        await c.query(
          `INSERT INTO connections (tenant_id, id, provider, display_name, status, sync_interval_minutes, created_at, updated_at, next_sync_at)
           VALUES ($1, gen_random_uuid(), 'fixture-crm', 'CRM fictif', 'active', 15, now(), now(), now())`,
          [t],
        );
        await c.query('COMMIT');
      } finally {
        c.release();
      }
    }
  });

  after(async () => {
    await app.end();
    await worker.end();
  });

  test('runtime roles are not superusers and cannot bypass RLS', async () => {
    const roles = await app.query<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>(
      "SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname IN ('ulysse_app', 'ulysse_worker', 'ulysse_migrator')",
    );
    assert.equal(roles.rows.length, 3);
    for (const r of roles.rows) {
      assert.equal(r.rolsuper, false, r.rolname);
      assert.equal(r.rolbypassrls, false, r.rolname);
    }
    const owner = await app.query<{ tableowner: string }>(
      "SELECT tableowner FROM pg_tables WHERE tablename = 'recommendations'",
    );
    assert.equal(
      owner.rows[0]?.tableowner,
      'ulysse_migrator',
      'the application role does not own tables',
    );
  });

  test('without a tenant context nothing is visible (fail closed)', async () => {
    for (const table of [
      'connections',
      'recommendations',
      'audit_events',
      'tenants',
      'users',
      'memberships',
      'outbox',
    ]) {
      const result = await app.query(`SELECT count(*)::int AS n FROM ${table}`);
      assert.equal((result.rows[0] as { n: number }).n, 0, table);
    }
  });

  test('a tenant context only sees and writes its own rows', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
      const visible = await c.query<{ tenant_id: string }>('SELECT tenant_id FROM connections');
      assert.deepEqual([...new Set(visible.rows.map((r) => r.tenant_id))], [tenantA]);
      const updated = await c.query(
        "UPDATE connections SET display_name = 'pirate' WHERE tenant_id = $1",
        [tenantB],
      );
      assert.equal(updated.rowCount, 0, 'rows of B are invisible to updates from A');
      await assert.rejects(
        c.query(
          `INSERT INTO connections (tenant_id, id, provider, display_name, status, sync_interval_minutes, created_at, updated_at)
           VALUES ($1, gen_random_uuid(), 'fixture-crm', 'x', 'active', 15, now(), now())`,
          [tenantB],
        ),
        /row-level security/,
      );
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  });

  test('cross-tenant references are impossible through composite keys', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.tenant_id', $1, true)", [tenantB]);
      const bConnection = (await c.query<{ id: string }>('SELECT id FROM connections')).rows[0]?.id;
      await c.query('COMMIT');
      assert.ok(bConnection);
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
      await assert.rejects(
        c.query(
          `INSERT INTO sync_runs (tenant_id, id, connection_id, trigger, status, started_at) VALUES ($1, gen_random_uuid(), $2, 'manual', 'running', now())`,
          [tenantA, bConnection],
        ),
        /foreign key/,
      );
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  });

  test('the tenant context does not leak to the next user of a pooled connection', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
      assert.equal((await c.query('SELECT 1 FROM connections')).rowCount, 1);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
    // max: 1 guarantees the same physical connection is reused.
    const leaked = await app.query<{ tenant: string | null; n: number }>(
      "SELECT current_setting('app.tenant_id', true) AS tenant, (SELECT count(*)::int FROM connections) AS n",
    );
    const row = leaked.rows[0];
    assert.ok(row);
    assert.equal(row.n, 0);
    assert.ok(!row.tenant, 'setting is reset after the transaction');
  });

  test('a user context lists only its own memberships and tenants', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.user_id', $1, true)", [userA]);
      const tenants = await c.query<{ id: string }>('SELECT id FROM tenants');
      assert.deepEqual(
        tenants.rows.map((r) => r.id),
        [tenantA],
      );
      const memberships = await c.query<{ tenant_id: string }>('SELECT tenant_id FROM memberships');
      assert.deepEqual(
        memberships.rows.map((r) => r.tenant_id),
        [tenantA],
      );
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  test('audit events and decisions are append-only for the runtime role', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
      await c.query(
        `INSERT INTO audit_events (tenant_id, id, actor_type, actor_id, event_type, resource_type, resource_id, correlation_id, created_at)
         VALUES ($1, gen_random_uuid(), 'service', 'test', 'test.event', 'test', 'x', 'c', now())`,
        [tenantA],
      );
      await assert.rejects(
        c.query("UPDATE audit_events SET event_type = 'tampered'"),
        /permission denied|append-only/,
      );
      await c.query('ROLLBACK');
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
      await assert.rejects(c.query('DELETE FROM audit_events'), /permission denied|append-only/);
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  });

  test('the API role cannot provision tenants or call worker dispatch functions', async () => {
    await assert.rejects(
      app.query("SELECT app.provision_tenant('evil', 'Evil')"),
      /permission denied/,
      'provision_tenant',
    );
    await assert.rejects(
      app.query('SELECT * FROM app.due_connections(now(), 10)'),
      /permission denied/,
      'due_connections',
    );
    await assert.rejects(
      app.query("INSERT INTO tenants (slug, name) VALUES ('evil', 'Evil')"),
      /permission denied/,
      'insert tenants',
    );
    await assert.rejects(
      app.query('SELECT * FROM pgboss.job LIMIT 1'),
      /permission denied/,
      'pgboss.job',
    );
  });

  test('the worker dispatch function only exposes identifiers of due connections', async () => {
    const due = await worker.query<Record<string, unknown>>(
      "SELECT * FROM app.due_connections(now() + interval '1 minute', 100)",
    );
    assert.ok(due.rows.length >= 2);
    assert.deepEqual(Object.keys(due.rows[0] ?? {}).sort(), [
      'connection_id',
      'provider',
      'tenant_id',
    ]);
    const direct = await worker.query('SELECT count(*)::int AS n FROM connections');
    assert.equal(
      (direct.rows[0] as { n: number }).n,
      0,
      'without context the worker reads nothing directly',
    );
  });

  test('migrations are idempotent and refuse edited history', async () => {
    const again = await migrate(db.migratorUrl);
    assert.equal(again.applied.length, 0);
    assert.ok(again.alreadyApplied.length >= 5);
    const c = new pg.Client({ connectionString: db.migratorUrl });
    await c.connect();
    try {
      await c.query(
        "UPDATE schema_migrations SET checksum = 'tampered' WHERE version = '0001_tenancy_identity.sql'",
      );
      await assert.rejects(migrate(db.migratorUrl), /modified after being applied/);
      await c.query(
        "UPDATE schema_migrations SET checksum = $1 WHERE version = '0001_tenancy_identity.sql'",
        [
          (await import('node:crypto'))
            .createHash('sha256')
            .update(
              await (
                await import('node:fs/promises')
              ).readFile(
                new URL('../migrations/0001_tenancy_identity.sql', import.meta.url),
                'utf8',
              ),
            )
            .digest('hex'),
        ],
      );
    } finally {
      await c.end();
    }
  });
});

describe('definer function privileges', () => {
  test('each SECURITY DEFINER function is executable only by its intended role', async () => {
    const client = new pg.Client({ connectionString: db.migratorUrl });
    await client.connect();
    try {
      const rows = await client.query<{ fn: string; acl: string[] }>(
        `SELECT p.proname AS fn, p.proacl::text[] AS acl FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'app' AND p.prosecdef ORDER BY 1`,
      );
      const expected: Record<string, string> = {
        find_user_by_subject: 'ulysse_app',
        demo_update_source: 'ulysse_app',
        agent_slot_available: 'ulysse_worker',
        reserve_agent_budget: 'ulysse_worker',
        resolve_agent_capability: 'ulysse_worker',
        purge_agent_artifacts: 'ulysse_worker',
        due_connections: 'ulysse_worker',
        active_tenants: 'ulysse_worker',
        claim_outbox: 'ulysse_worker',
        mark_outbox_published: 'ulysse_worker',
        outbox_backlog: 'ulysse_worker',
        purge_expired: 'ulysse_worker',
        provision_tenant: 'ulysse_migrator',
        provision_user: 'ulysse_migrator',
        set_membership: 'ulysse_migrator',
        set_user_status: 'ulysse_migrator',
      };
      assert.deepEqual(rows.rows.map((r) => r.fn).sort(), Object.keys(expected).sort());
      for (const row of rows.rows) {
        const grantees = row.acl
          .map((entry) => entry.split('=')[0])
          .filter((g) => g !== 'ulysse_definer');
        assert.deepEqual(grantees, [expected[row.fn]], `${row.fn}: ${row.acl.join(',')}`);
      }
    } finally {
      await client.end();
    }
  });
});
