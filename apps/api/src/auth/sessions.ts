import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Pool } from '@ulysse/database';

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export type SessionRecord = Readonly<{
  tokenHash: string;
  userId: string;
  activeTenantId: string | null;
  expiresAt: string;
  idleExpiresAt: string;
}>;

export type LoginAttempt = Readonly<{ codeVerifier: string; nonce: string; returnTo: string }>;

const LOGIN_TTL_MS = 10 * 60_000;
const TOUCH_INTERVAL_MS = 60_000;

/**
 * Server-side sessions: the browser only holds a random token (HttpOnly cookie);
 * the database stores its SHA-256. Sessions are rotated at every login and can be
 * revoked individually or for a user.
 */
export class SessionStore {
  readonly #pool: Pool;
  readonly #absoluteMs: number;
  readonly #idleMs: number;
  readonly #secret: string;

  constructor(pool: Pool, options: { absoluteHours: number; idleMinutes: number; secret: string }) {
    this.#pool = pool;
    this.#absoluteMs = options.absoluteHours * 3_600_000;
    this.#idleMs = options.idleMinutes * 60_000;
    this.#secret = options.secret;
  }

  /** CSRF token bound to the session token; nothing extra to store. */
  csrfTokenFor(sessionToken: string): string {
    return createHmac('sha256', this.#secret).update(`csrf:${sessionToken}`).digest('base64url');
  }

  async startLogin(attempt: LoginAttempt, state: string, binding: string): Promise<void> {
    await this.#pool.query(
      `INSERT INTO oidc_login_attempts (state_hash, code_verifier, nonce, return_to, binding_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + make_interval(secs => $6))`,
      [
        sha256Hex(state),
        attempt.codeVerifier,
        attempt.nonce,
        attempt.returnTo,
        sha256Hex(binding),
        LOGIN_TTL_MS / 1000,
      ],
    );
  }

  /** Single use: the attempt is deleted whether or not the binding matches. */
  async consumeLogin(state: string, binding: string | undefined): Promise<LoginAttempt | null> {
    const result = await this.#pool.query<{
      code_verifier: string;
      nonce: string;
      return_to: string;
      binding_hash: string;
      expired: boolean;
    }>(
      `DELETE FROM oidc_login_attempts WHERE state_hash = $1
       RETURNING code_verifier, nonce, return_to, binding_hash, expires_at < now() AS expired`,
      [sha256Hex(state)],
    );
    const row = result.rows[0];
    if (
      !row ||
      row.expired ||
      binding === undefined ||
      !safeEqual(row.binding_hash, sha256Hex(binding))
    )
      return null;
    return { codeVerifier: row.code_verifier, nonce: row.nonce, returnTo: row.return_to };
  }

  async create(
    userId: string,
    activeTenantId: string | null,
  ): Promise<{ token: string; record: SessionRecord }> {
    const token = randomToken();
    const result = await this.#pool.query<{ expires_at: string; idle_expires_at: string }>(
      `INSERT INTO sessions (token_hash, user_id, active_tenant_id, expires_at, idle_expires_at)
       VALUES ($1, $2, $3, now() + make_interval(secs => $4), now() + make_interval(secs => $5))
       RETURNING expires_at, idle_expires_at`,
      [sha256Hex(token), userId, activeTenantId, this.#absoluteMs / 1000, this.#idleMs / 1000],
    );
    const row = result.rows[0];
    if (!row) throw new Error('session insert returned no row');
    return {
      token,
      record: {
        tokenHash: sha256Hex(token),
        userId,
        activeTenantId,
        expiresAt: row.expires_at,
        idleExpiresAt: row.idle_expires_at,
      },
    };
  }

  async resolve(token: string): Promise<SessionRecord | null> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const tokenHash = sha256Hex(token);
    const result = await this.#pool.query<{
      user_id: string;
      active_tenant_id: string | null;
      expires_at: string;
      idle_expires_at: string;
      last_seen_at: string;
    }>(
      `SELECT user_id, active_tenant_id, expires_at, idle_expires_at, last_seen_at FROM sessions
       WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now() AND idle_expires_at > now()`,
      [tokenHash],
    );
    const row = result.rows[0];
    if (!row) return null;
    let idleExpiresAt = row.idle_expires_at;
    if (Date.now() - Date.parse(row.last_seen_at) > TOUCH_INTERVAL_MS) {
      const touched = await this.#pool.query<{ idle_expires_at: string }>(
        `UPDATE sessions SET last_seen_at = now(), idle_expires_at = LEAST(expires_at, now() + make_interval(secs => $2))
         WHERE token_hash = $1 RETURNING idle_expires_at`,
        [tokenHash, this.#idleMs / 1000],
      );
      idleExpiresAt = touched.rows[0]?.idle_expires_at ?? idleExpiresAt;
    }
    return {
      tokenHash,
      userId: row.user_id,
      activeTenantId: row.active_tenant_id,
      expiresAt: row.expires_at,
      idleExpiresAt,
    };
  }

  async setActiveTenant(tokenHash: string, tenantId: string | null): Promise<void> {
    await this.#pool.query(
      'UPDATE sessions SET active_tenant_id = $2 WHERE token_hash = $1 AND revoked_at IS NULL',
      [tokenHash, tenantId],
    );
  }

  async revoke(tokenHash: string): Promise<void> {
    await this.#pool.query(
      'UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL',
      [tokenHash],
    );
  }
}
