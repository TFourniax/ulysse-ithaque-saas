import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createRegistry, FixtureConnector, MemoryFixtureStore } from '@ulysse/connectors';
import type { Pool } from '@ulysse/database';
import { AdminClient, createPool, IdentityRepository, PgUnitOfWork } from '@ulysse/database';
import type { TestDatabase } from '@ulysse/database/testing';
import { createTestDatabase } from '@ulysse/database/testing';
import type { ServiceDeps } from '@ulysse/domain';
import {
  AnalysisService,
  CompanyContextService,
  ConnectionService,
  defaultRules,
  DoctrineService,
  IngestionService,
  systemClock,
} from '@ulysse/domain';
import {
  FIXTURE_CONTEXT,
  FIXTURE_DOCTRINE,
  fixtureCatalog,
  record,
  serviceContext,
  userContext,
} from '@ulysse/domain/testing';
import { createLogger, createMetrics } from '@ulysse/observability';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { createOidcProvider } from '../src/auth/oidc.ts';
import { SessionStore } from '../src/auth/sessions.ts';
import { loadConfig } from '../src/config.ts';
import type { CodeSpec, FakeIdp } from './fake-idp.ts';
import { startFakeIdp } from './fake-idp.ts';

const ORIGIN = 'http://ulysse.test';
let db: TestDatabase;
let idp: FakeIdp;
let pool: Pool;
let admin: AdminClient;
let app: FastifyInstance;
const users: Record<string, { id: string; subject: string }> = {};
const tenants: Record<string, string> = {};
let codeCounter = 0;

function cookieFrom(setCookie: string | string[] | undefined, name: string): string | undefined {
  const all = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const match = all.find((c) => c.startsWith(`${name}=`));
  return match?.split(';')[0]?.slice(name.length + 1);
}

async function login(
  userKey: string,
  overrides: Partial<CodeSpec> = {},
  options: { returnTo?: string; dropBinding?: boolean } = {},
) {
  const user = users[userKey];
  const subject = user?.subject ?? userKey;
  codeCounter += 1;
  // Distinct client addresses keep the per-IP authentication rate limit out of the way of functional tests.
  const remoteAddress = `10.0.${String(codeCounter >> 8)}.${String(codeCounter & 255)}`;
  const start = await app.inject({
    method: 'GET',
    url: `/auth/login?returnTo=${encodeURIComponent(options.returnTo ?? '/recommendations')}`,
    remoteAddress,
  });
  assert.equal(start.statusCode, 302);
  const authorize = new URL(String(start.headers.location));
  const binding = cookieFrom(start.headers['set-cookie'], 'ulysse_login');
  assert.ok(binding);
  const state = authorize.searchParams.get('state') ?? '';
  const nonce = authorize.searchParams.get('nonce') ?? '';
  const challenge = authorize.searchParams.get('code_challenge') ?? '';
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(state && nonce && challenge);
  const code = `code-${String(codeCounter)}`;
  idp.registerCode(code, { subject, nonce, codeChallenge: challenge, name: userKey, ...overrides });
  const callback = await app.inject({
    method: 'GET',
    url: `/auth/callback?code=${code}&state=${encodeURIComponent(state)}`,
    headers: options.dropBinding ? {} : { cookie: `ulysse_login=${binding}` },
    remoteAddress,
  });
  const session = cookieFrom(callback.headers['set-cookie'], 'ulysse_session');
  return {
    status: callback.statusCode,
    location: String(callback.headers.location),
    session,
    state,
    code,
    binding,
  };
}

async function signedIn(userKey: string) {
  const result = await login(userKey);
  assert.ok(result.session, `login of ${userKey} should create a session (${result.location})`);
  const cookie = `ulysse_session=${result.session}`;
  const me = await app.inject({ method: 'GET', url: '/v1/me', headers: { cookie } });
  assert.equal(me.statusCode, 200);
  const body = me.json<{
    csrfToken: string;
    activeTenant: { id: string } | null;
    tenants: { id: string }[];
  }>();
  return { cookie, csrf: body.csrfToken, me: body };
}

async function seedTenant(tenantId: string, ownerId: string): Promise<void> {
  const uow = new PgUnitOfWork(pool);
  const deps: ServiceDeps = {
    uow,
    clock: systemClock,
    ids: { next: () => crypto.randomUUID() },
    rules: defaultRules,
  };
  const owner = userContext(tenantId, ownerId, 'owner');
  const doctrines = new DoctrineService(deps);
  const d = await doctrines.draft(owner, FIXTURE_DOCTRINE);
  await doctrines.validate(owner, d.id, 'Validation fictive');
  await new CompanyContextService(deps).update(owner, {
    content: FIXTURE_CONTEXT,
    source: 'fixture',
  });
  const connection = await new ConnectionService(deps, fixtureCatalog).create(owner, {
    provider: 'fixture-crm',
    displayName: 'CRM fictif',
    config: { dataset: 'demo' },
  });
  const worker = serviceContext(tenantId);
  const ingestion = new IngestionService(deps);
  const run = await ingestion.start(worker, connection.id, 'initial');
  const recent = new Date(Date.now() - 20 * 86_400_000).toISOString();
  const modified = new Date(Date.now() - 3_600_000).toISOString();
  await ingestion.applyPage(worker, run.run.id, {
    records: [
      record(
        'OPP-001',
        { lastInteractionAt: { state: 'present', value: recent } },
        { sourceModifiedAt: modified },
      ),
    ],
    rejectedByConnector: 0,
    cursorAfter: '1',
    complete: true,
  });
  await new AnalysisService(deps).run(worker, 'source_change');
}

before(async () => {
  db = await createTestDatabase();
  idp = await startFakeIdp();
  admin = await AdminClient.connect(db.migratorUrl);
  tenants.A = await admin.provisionTenant('acme-test', 'Acme (fictive)');
  tenants.B = await admin.provisionTenant('globex-test', 'Globex (fictive)');
  const people: Array<[string, Array<[string, 'owner' | 'reviewer' | 'viewer']>]> = [
    ['alice', [['A', 'owner']]],
    ['bob', [['A', 'reviewer']]],
    ['carol', [['A', 'reviewer']]],
    ['vera', [['A', 'viewer']]],
    ['gina', [['B', 'owner']]],
    [
      'dual',
      [
        ['A', 'viewer'],
        ['B', 'reviewer'],
      ],
    ],
    ['dave', [['A', 'reviewer']]],
  ];
  for (const [key, memberships] of people) {
    const subject = `sub-${key}-${crypto.randomUUID()}`;
    const id = await admin.provisionUser({
      issuer: idp.issuer,
      subject,
      email: `${key}@example.test`,
      displayName: key,
    });
    users[key] = { id, subject };
    for (const [t, role] of memberships) await admin.setMembership(tenants[t] ?? '', id, role);
  }
  pool = createPool({ connectionString: db.appUrl, applicationName: 'ulysse-api-test', max: 8 });
  await seedTenant(tenants.A, users.alice?.id ?? '');
  await seedTenant(tenants.B, users.gina?.id ?? '');
  const config = loadConfig({
    NODE_ENV: 'test',
    PUBLIC_ORIGIN: ORIGIN,
    OIDC_ISSUER: idp.issuer,
    OIDC_CLIENT_ID: idp.clientId,
    OIDC_CLIENT_SECRET: idp.clientSecret,
    OIDC_ALLOW_INSECURE_HTTP: 'true',
    SESSION_SECRET: 'test-session-secret-with-enough-entropy-0123456789',
    COOKIE_SECURE: 'false',
    ENABLE_FIXTURE_CONNECTOR: 'true',
    LOG_LEVEL: 'silent',
    RATE_LIMIT_PER_MINUTE: '1000',
  });
  app = await buildApp({
    config,
    pool,
    uow: new PgUnitOfWork(pool),
    identity: new IdentityRepository(pool),
    sessions: new SessionStore(pool, {
      absoluteHours: 12,
      idleMinutes: 120,
      secret: config.SESSION_SECRET,
    }),
    oidc: await createOidcProvider({
      issuer: idp.issuer,
      clientId: idp.clientId,
      clientSecret: idp.clientSecret,
      allowInsecureHttp: true,
    }),
    registry: createRegistry([new FixtureConnector(new MemoryFixtureStore())]),
    rules: defaultRules,
    clock: systemClock,
    logger: createLogger('ulysse-api-test', { level: process.env.TEST_LOG_LEVEL ?? 'silent' }),
    metrics: createMetrics('ulysse-api-test'),
  });
  await app.ready();
});

after(async () => {
  await app.close();
  await pool.end();
  await admin.close();
  await idp.close();
  await db.drop();
});

describe('OIDC login (authorization code + PKCE + state + nonce)', () => {
  test('a provisioned user gets an HttpOnly session and lands on the requested page', async () => {
    const result = await login('alice', {}, { returnTo: '/recommendations?view=open' });
    assert.equal(result.status, 302);
    assert.equal(result.location, '/recommendations?view=open');
    assert.ok(result.session);
    const me = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { cookie: `ulysse_session=${result.session}` },
    });
    const body = me.json<{
      user: { displayName: string };
      activeTenant: { id: string; role: string; permissions: string[] };
    }>();
    assert.equal(body.activeTenant.id, tenants.A);
    assert.equal(body.activeTenant.role, 'owner');
    assert.ok(body.activeTenant.permissions.includes('recommendation:decide'));
  });

  test('identity tokens with a bad signature, issuer, audience, expiry or nonce are refused', async () => {
    const defects: Array<Partial<CodeSpec>> = [
      { signWithForeignKey: true },
      { issuer: 'https://evil.example' },
      { audience: 'another-client' },
      { expiresInSeconds: -120 },
      { nonce: 'not-the-nonce' },
    ];
    for (const defect of defects) {
      const result = await login('alice', defect);
      assert.equal(result.location, '/?login_error=invalid_token', JSON.stringify(defect));
      assert.equal(result.session, undefined);
    }
  });

  test('login CSRF, replayed state and open redirects are blocked', async () => {
    const unbound = await login('alice', {}, { dropBinding: true });
    assert.equal(unbound.location, '/?login_error=expired');
    const first = await login('alice');
    const replay = await app.inject({
      method: 'GET',
      url: `/auth/callback?code=${first.code}&state=${encodeURIComponent(first.state)}`,
      headers: { cookie: `ulysse_login=${first.binding}` },
    });
    assert.equal(replay.headers.location, '/?login_error=expired');
    for (const target of ['//evil.example/x', '/\\evil.example', 'https://evil.example']) {
      const redirected = await login('alice', {}, { returnTo: target });
      assert.equal(redirected.location, '/', target);
    }
  });

  test('unknown or disabled identities do not get a session', async () => {
    const unknown = await login('stranger');
    assert.equal(unknown.location, '/?login_error=not_provisioned');
    await admin.setUserStatus(users.dave?.id ?? '', 'disabled');
    const disabled = await login('dave');
    assert.equal(disabled.location, '/?login_error=disabled');
    await admin.setUserStatus(users.dave?.id ?? '', 'active');
  });

  test('logout revokes the server session', async () => {
    const s = await signedIn('bob');
    const out = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { cookie: s.cookie, 'x-csrf-token': s.csrf },
    });
    assert.equal(out.statusCode, 200);
    assert.match(out.json<{ redirectTo: string }>().redirectTo, /\/logout\?/);
    const after = await app.inject({ method: 'GET', url: '/v1/me', headers: { cookie: s.cookie } });
    assert.equal(after.statusCode, 401);
  });
});

describe('authorization enforced server-side', () => {
  test('anonymous calls are refused', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/recommendations' });
    assert.equal(res.statusCode, 401);
    assert.equal(res.json<{ error: { code: string } }>().error.code, 'UNAUTHENTICATED');
    assert.ok(res.headers['x-correlation-id']);
  });

  test('browser-supplied tenant ids or roles are ignored; switching to a foreign tenant is refused', async () => {
    const s = await signedIn('alice');
    const forged = await app.inject({
      method: 'GET',
      url: `/v1/recommendations?tenantId=${tenants.B ?? ''}`,
      headers: { cookie: s.cookie, 'x-tenant-id': tenants.B ?? '', 'x-role': 'owner' },
    });
    assert.equal(forged.statusCode, 200);
    const items = forged.json<{ items: { subject: { externalId: string }; id: string }[] }>().items;
    const bView = await signedIn('gina');
    const bItems = (
      await app.inject({
        method: 'GET',
        url: '/v1/recommendations',
        headers: { cookie: bView.cookie },
      })
    ).json<{ items: { id: string }[] }>().items;
    assert.ok(items.length > 0 && bItems.length > 0);
    assert.ok(
      !items.some((i) => bItems.some((b) => b.id === i.id)),
      'same external id, different tenants, no mixing',
    );
    const switchRes = await app.inject({
      method: 'PUT',
      url: '/v1/session/tenant',
      headers: { cookie: s.cookie, 'x-csrf-token': s.csrf },
      payload: { tenantId: tenants.B },
    });
    assert.equal(switchRes.statusCode, 403);
    const foreign = await app.inject({
      method: 'GET',
      url: `/v1/recommendations/${bItems[0]?.id ?? ''}`,
      headers: { cookie: s.cookie },
    });
    assert.equal(foreign.statusCode, 404);
  });

  test('a user with several memberships must pick a tenant and only sees the selected one', async () => {
    const s = await signedIn('dual');
    assert.equal(s.me.activeTenant, null);
    assert.equal(s.me.tenants.length, 2);
    const none = await app.inject({
      method: 'GET',
      url: '/v1/recommendations',
      headers: { cookie: s.cookie },
    });
    assert.equal(none.json<{ error: { code: string } }>().error.code, 'NO_ACTIVE_TENANT');
    const pick = await app.inject({
      method: 'PUT',
      url: '/v1/session/tenant',
      headers: { cookie: s.cookie, 'x-csrf-token': s.csrf },
      payload: { tenantId: tenants.A },
    });
    assert.equal(pick.statusCode, 200);
    assert.equal(pick.json<{ activeTenant: { role: string } }>().activeTenant.role, 'viewer');
  });

  test('a viewer can read but cannot decide (HTTP 403), even with a valid CSRF token', async () => {
    const s = await signedIn('vera');
    const list = await app.inject({
      method: 'GET',
      url: '/v1/recommendations',
      headers: { cookie: s.cookie },
    });
    const id = list.json<{ items: { id: string }[] }>().items[0]?.id ?? '';
    const res = await app.inject({
      method: 'POST',
      url: `/v1/recommendations/${id}/decisions`,
      headers: { cookie: s.cookie, 'x-csrf-token': s.csrf, 'idempotency-key': 'viewer-attempt-01' },
      payload: { decision: 'approve', expectedRevision: 1 },
    });
    assert.equal(res.statusCode, 403);
    const audit = await app.inject({
      method: 'GET',
      url: '/v1/audit',
      headers: { cookie: s.cookie },
    });
    assert.equal(audit.statusCode, 403);
  });

  test('mutations without the session CSRF token or from another origin are refused', async () => {
    const s = await signedIn('bob');
    const noToken = await app.inject({
      method: 'POST',
      url: '/v1/connections/00000000-0000-4000-8000-000000000000/sync',
      headers: { cookie: s.cookie },
      payload: {},
    });
    assert.equal(noToken.statusCode, 403);
    assert.equal(noToken.json<{ error: { code: string } }>().error.code, 'CSRF');
    const otherOrigin = await app.inject({
      method: 'POST',
      url: '/v1/connections/00000000-0000-4000-8000-000000000000/sync',
      headers: { cookie: s.cookie, 'x-csrf-token': s.csrf, origin: 'https://evil.example' },
      payload: {},
    });
    assert.equal(otherOrigin.json<{ error: { code: string } }>().error.code, 'CSRF');
  });

  test('a revoked membership loses access on the next request; a disabled user loses the session', async () => {
    const s = await signedIn('carol');
    assert.equal(
      (
        await app.inject({
          method: 'GET',
          url: '/v1/recommendations',
          headers: { cookie: s.cookie },
        })
      ).statusCode,
      200,
    );
    await admin.setMembership(tenants.A ?? '', users.carol?.id ?? '', 'reviewer', 'revoked');
    const denied = await app.inject({
      method: 'GET',
      url: '/v1/recommendations',
      headers: { cookie: s.cookie },
    });
    assert.equal(denied.statusCode, 403);
    assert.equal(denied.json<{ error: { code: string } }>().error.code, 'NO_ACTIVE_TENANT');
    const d = await signedIn('dave');
    await admin.setUserStatus(users.dave?.id ?? '', 'disabled');
    assert.equal(
      (await app.inject({ method: 'GET', url: '/v1/me', headers: { cookie: d.cookie } }))
        .statusCode,
      401,
    );
    await admin.setUserStatus(users.dave?.id ?? '', 'active');
    assert.equal(
      (await app.inject({ method: 'GET', url: '/v1/me', headers: { cookie: d.cookie } }))
        .statusCode,
      401,
      'session stays revoked',
    );
  });
});

describe('decisions over HTTP', () => {
  test('approval is idempotent, conflicts are explicit and the history is attributed', async () => {
    const bob = await signedIn('bob');
    const alice = await signedIn('alice');
    const list = await app.inject({
      method: 'GET',
      url: '/v1/recommendations',
      headers: { cookie: bob.cookie },
    });
    const rec = list.json<{ items: { id: string; revision: number; evidence?: unknown }[] }>()
      .items[0];
    assert.ok(rec);
    const detail = await app.inject({
      method: 'GET',
      url: `/v1/recommendations/${rec.id}`,
      headers: { cookie: bob.cookie },
    });
    const d = detail.json<{
      evidenceState: string;
      evidence: unknown[];
      permissions: { canDecide: boolean };
    }>();
    assert.equal(d.evidenceState, 'current');
    assert.ok(d.evidence.length > 0);
    assert.equal(d.permissions.canDecide, true);
    const missingKey = await app.inject({
      method: 'POST',
      url: `/v1/recommendations/${rec.id}/decisions`,
      headers: { cookie: bob.cookie, 'x-csrf-token': bob.csrf },
      payload: { decision: 'approve', expectedRevision: 1 },
    });
    assert.equal(missingKey.statusCode, 422);
    const send = (
      s: { cookie: string; csrf: string },
      key: string,
      decision: 'approve' | 'reject',
    ) =>
      app.inject({
        method: 'POST',
        url: `/v1/recommendations/${rec.id}/decisions`,
        headers: { cookie: s.cookie, 'x-csrf-token': s.csrf, 'idempotency-key': key },
        payload: { decision, expectedRevision: rec.revision },
      });
    const [first, concurrent] = await Promise.all([
      send(bob, 'bob-approval-001', 'approve'),
      send(alice, 'alice-reject-001', 'reject'),
    ]);
    const statuses = [first.statusCode, concurrent.statusCode].sort();
    assert.deepEqual(statuses, [200, 409]);
    const winner =
      first.statusCode === 200
        ? { s: bob, key: 'bob-approval-001', d: 'approve' as const }
        : { s: alice, key: 'alice-reject-001', d: 'reject' as const };
    const retry = await send(winner.s, winner.key, winner.d);
    assert.equal(retry.statusCode, 200);
    assert.equal(retry.json<{ replayed: boolean }>().replayed, true);
    const reuse = await send(winner.s, winner.key, winner.d === 'approve' ? 'reject' : 'approve');
    assert.equal(reuse.json<{ error: { code: string } }>().error.code, 'IDEMPOTENCY_CONFLICT');
    const history = await app.inject({
      method: 'GET',
      url: `/v1/recommendations/${rec.id}`,
      headers: { cookie: bob.cookie },
    });
    const h = history.json<{
      decisions: unknown[];
      history: { eventType: string; actorName: string | null }[];
    }>();
    assert.equal(h.decisions.length, 1);
    const decided = h.history.filter(
      (e) => e.eventType === 'recommendation.approved' || e.eventType === 'recommendation.rejected',
    );
    assert.equal(decided.length, 1);
    assert.ok(decided[0]?.actorName === 'bob' || decided[0]?.actorName === 'alice');
  });
});

describe('pilot measurement', () => {
  test('decision quality labels are validated and the report counts only this company', async () => {
    const gina = await signedIn('gina');
    const list = await app.inject({
      method: 'GET',
      url: '/v1/recommendations',
      headers: { cookie: gina.cookie },
    });
    const rec = list.json<{ items: { id: string; revision: number }[] }>().items[0];
    assert.ok(rec);
    const decide = (key: string, quality: string) =>
      app.inject({
        method: 'POST',
        url: `/v1/recommendations/${rec.id}/decisions`,
        headers: { cookie: gina.cookie, 'x-csrf-token': gina.csrf, 'idempotency-key': key },
        payload: { decision: 'reject', expectedRevision: rec.revision, quality },
      });
    const incoherent = await decide('gina-quality-0001', 'useful');
    assert.equal(incoherent.statusCode, 422);
    assert.equal((await decide('gina-quality-0002', 'excellent')).statusCode, 422);
    assert.equal((await decide('gina-quality-0003', 'not_actionable')).statusCode, 200);
    const detail = await app.inject({
      method: 'GET',
      url: `/v1/recommendations/${rec.id}`,
      headers: { cookie: gina.cookie },
    });
    assert.equal(
      detail.json<{ decisions: { quality: string }[] }>().decisions[0]?.quality,
      'not_actionable',
    );

    type Report = { decisions: { total: number; byQuality: Record<string, number> } };
    const report = await app.inject({
      method: 'GET',
      url: '/v1/reports/quality',
      headers: { cookie: gina.cookie },
    });
    assert.equal(report.statusCode, 200);
    assert.equal(report.json<Report>().decisions.byQuality.not_actionable, 1);
    const vera = await signedIn('vera');
    const other = await app.inject({
      method: 'GET',
      url: '/v1/reports/quality',
      headers: { cookie: vera.cookie },
    });
    assert.equal(other.statusCode, 200, 'a viewer can read the report of its company');
    assert.equal(other.json<Report>().decisions.byQuality.not_actionable, 0);
    const invalid = await app.inject({
      method: 'GET',
      url: '/v1/reports/quality?from=yesterday',
      headers: { cookie: vera.cookie },
    });
    assert.equal(invalid.statusCode, 422);
    const anonymous = await app.inject({ method: 'GET', url: '/v1/reports/quality' });
    assert.equal(anonymous.statusCode, 401);
  });
});

describe('API hygiene', () => {
  test('connection responses never expose credential references or cursors', async () => {
    const s = await signedIn('alice');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/connections',
      headers: { cookie: s.cookie },
    });
    assert.equal(res.statusCode, 200);
    assert.doesNotMatch(res.body, /credential|cursor|passStartedAt/i);
  });

  test('oversized and malformed bodies are rejected with structured errors', async () => {
    const s = await signedIn('alice');
    const big = await app.inject({
      method: 'PUT',
      url: '/v1/context',
      headers: { cookie: s.cookie, 'x-csrf-token': s.csrf, 'content-type': 'application/json' },
      payload: JSON.stringify({ content: { activity: 'x'.repeat(70_000) } }),
    });
    assert.equal(big.statusCode, 413);
    const bad = await app.inject({
      method: 'PUT',
      url: '/v1/context',
      headers: { cookie: s.cookie, 'x-csrf-token': s.csrf },
      payload: { content: { activity: 1 } },
    });
    assert.equal(bad.statusCode, 422);
    assert.equal(
      bad.json<{ error: { code: string; correlationId: string } }>().error.code,
      'VALIDATION',
    );
  });

  test('health, OpenAPI and protected metrics endpoints', async () => {
    assert.equal((await app.inject({ method: 'GET', url: '/health/live' })).statusCode, 200);
    assert.equal(
      (await app.inject({ method: 'GET', url: '/health/ready' })).json<{ status: string }>().status,
      'ok',
    );
    const spec = (await app.inject({ method: 'GET', url: '/openapi.json' })).json<{
      openapi: string;
      paths: Record<string, unknown>;
    }>();
    assert.match(spec.openapi, /^3\./);
    assert.ok(spec.paths['/v1/recommendations/{id}/decisions']);
    assert.equal((await app.inject({ method: 'GET', url: '/metrics' })).statusCode, 404);
  });

  test('authentication endpoints are rate limited per client', async () => {
    let limited = 0;
    for (let i = 0; i < 40; i += 1) {
      const res = await app.inject({
        method: 'GET',
        url: '/auth/login',
        remoteAddress: '203.0.113.9',
      });
      if (res.statusCode === 429) limited += 1;
    }
    assert.ok(limited > 0);
  });
});
