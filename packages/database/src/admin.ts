import type { Role } from '@ulysse/domain';
import pg from 'pg';

/**
 * Administrative provisioning executed with the migrator credentials through
 * definer functions (migration 0005). Not exposed by the API.
 */
export class AdminClient {
  readonly #client: pg.Client;

  private constructor(client: pg.Client) {
    this.#client = client;
  }

  static async connect(migratorUrl: string): Promise<AdminClient> {
    const client = new pg.Client({
      connectionString: migratorUrl,
      application_name: 'ulysse-admin',
    });
    await client.connect();
    return new AdminClient(client);
  }

  async provisionTenant(slug: string, name: string): Promise<string> {
    const result = await this.#client.query<{ id: string }>(
      'SELECT app.provision_tenant($1, $2) AS id',
      [slug, name],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error('tenant provisioning returned no id');
    return id;
  }

  async provisionUser(input: {
    issuer: string;
    subject: string;
    email: string | null;
    displayName: string;
  }): Promise<string> {
    const result = await this.#client.query<{ id: string }>(
      'SELECT app.provision_user($1, $2, $3, $4) AS id',
      [input.issuer, input.subject, input.email, input.displayName],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error('user provisioning returned no id');
    return id;
  }

  async setMembership(
    tenantId: string,
    userId: string,
    role: Role,
    status: 'active' | 'revoked' = 'active',
  ): Promise<void> {
    await this.#client.query('SELECT app.set_membership($1, $2, $3, $4)', [
      tenantId,
      userId,
      role,
      status,
    ]);
  }

  async setUserStatus(userId: string, status: 'active' | 'disabled'): Promise<void> {
    await this.#client.query('SELECT app.set_user_status($1, $2)', [userId, status]);
  }

  async close(): Promise<void> {
    await this.#client.end();
  }
}
