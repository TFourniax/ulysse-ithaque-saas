import type { Role } from '@ulysse/domain';
import type { Pool, PoolClient } from 'pg';
import type { Row } from './rows.ts';
import { oneOf, str, strOrNull } from './rows.ts';

export type PrincipalMembership = Readonly<{
  tenantId: string;
  slug: string;
  name: string;
  role: Role;
}>;

export type Principal = Readonly<{
  userId: string;
  displayName: string;
  email: string | null;
  status: 'active' | 'disabled';
  /** Active memberships of active tenants only. */
  memberships: readonly PrincipalMembership[];
}>;

async function asUser<T>(
  pool: Pool,
  userId: string,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Identity lookups for the API role. Users are identified by (issuer, subject);
 * memberships are always re-read from the database, never trusted from a token or
 * the browser.
 */
export class IdentityRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async findUserBySubject(
    issuer: string,
    subject: string,
  ): Promise<{ id: string; status: 'active' | 'disabled' } | null> {
    const result = await this.#pool.query<Row>(
      'SELECT id, status FROM app.find_user_by_subject($1, $2)',
      [issuer, subject],
    );
    const row = result.rows[0];
    return row
      ? { id: str(row, 'id'), status: oneOf(row, 'status', ['active', 'disabled'] as const) }
      : null;
  }

  async recordLogin(
    userId: string,
    profile: { email: string | null; displayName: string | null },
  ): Promise<void> {
    await asUser(this.#pool, userId, async (client) => {
      await client.query(
        `UPDATE users SET last_login_at = now(), email = COALESCE($2, email), display_name = COALESCE(NULLIF($3, ''), display_name)
         WHERE id = $1`,
        [userId, profile.email, profile.displayName?.slice(0, 200) ?? null],
      );
    });
  }

  async loadPrincipal(userId: string): Promise<Principal | null> {
    return asUser(this.#pool, userId, async (client) => {
      const user = (
        await client.query<Row>('SELECT id, display_name, email, status FROM users WHERE id = $1', [
          userId,
        ])
      ).rows[0];
      if (!user) return null;
      const memberships = (
        await client.query<Row>(
          `SELECT m.tenant_id, m.role, t.slug, t.name FROM memberships m JOIN tenants t ON t.id = m.tenant_id
           WHERE m.user_id = $1 AND m.status = 'active' AND t.status = 'active' ORDER BY t.name, t.id`,
          [userId],
        )
      ).rows.map((r) => ({
        tenantId: str(r, 'tenant_id'),
        slug: str(r, 'slug'),
        name: str(r, 'name'),
        role: oneOf(r, 'role', ['owner', 'reviewer', 'viewer'] as const),
      }));
      return {
        userId: str(user, 'id'),
        displayName: str(user, 'display_name'),
        email: strOrNull(user, 'email'),
        status: oneOf(user, 'status', ['active', 'disabled'] as const),
        memberships,
      };
    });
  }

  async ping(): Promise<void> {
    await this.#pool.query('SELECT 1');
  }
}
