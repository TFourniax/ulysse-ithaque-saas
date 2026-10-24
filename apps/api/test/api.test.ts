import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createRegistry, FixtureConnector, MemoryFixtureStore } from '@ulysse/connectors';
import type { Pool } from '@ulysse/database';
import { AdminClient, createPool, IdentityRepository, PgUnitOfWork } from '@ulysse/database';
import { PgCrmImportStore } from '@ulysse/database';
import type { CrmAdjustmentsDto, CrmPreviewDto } from '@ulysse/contracts';
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

describe('UL-017 workspace authorization and provenance', () => {
  test('owner imports a source, viewer cannot write, another tenant cannot use it, and CSRF remains required', async () => {
    const alice = await signedIn('alice');
    const viewer = await signedIn('vera');
    const gina = await signedIn('gina');
    const body = {
      kind: 'offer',
      title: 'Offre test UL-017',
      url: null,
      text: 'Extrait de test sans donnée client.',
      observedAt: new Date().toISOString(),
      origin: 'company',
    };
    const headers = { cookie: alice.cookie, 'x-csrf-token': alice.csrf };
    const noCsrf = await app.inject({
      method: 'POST',
      url: '/v1/workspace/sources',
      headers: { cookie: alice.cookie },
      payload: body,
    });
    assert.equal(noCsrf.statusCode, 403);
    const forbidden = await app.inject({
      method: 'POST',
      url: '/v1/workspace/sources',
      headers: { cookie: viewer.cookie, 'x-csrf-token': viewer.csrf },
      payload: body,
    });
    assert.equal(forbidden.statusCode, 403);
    const created = await app.inject({
      method: 'POST',
      url: '/v1/workspace/sources',
      headers,
      payload: body,
    });
    assert.equal(created.statusCode, 201, created.body);
    const source = created.json<{ id: string; revision: number }>();
    const brief = {
      offer: 'Offre',
      target: 'Cible',
      phase: 'exploration',
      objective: 'Comprendre',
      channel: 'Site',
      constraints: '',
      buyerRunId: null,
    };
    const request = {
      kind: 'buyer',
      brief,
      sourceIds: [source.id],
      requestKey: crypto.randomUUID(),
    };
    const foreign = await app.inject({
      method: 'POST',
      url: '/v1/workflows',
      headers: { cookie: gina.cookie, 'x-csrf-token': gina.csrf },
      payload: request,
    });
    assert.equal(foreign.statusCode, 404, foreign.body);
    const run = await app.inject({
      method: 'POST',
      url: '/v1/workflows',
      headers,
      payload: request,
    });
    assert.equal(run.statusCode, 202, run.body);
    const replay = await app.inject({
      method: 'POST',
      url: '/v1/workflows',
      headers,
      payload: request,
    });
    assert.deepEqual(replay.json(), run.json());
    const other = await app.inject({
      method: 'GET',
      url: '/v1/workflows',
      headers: { cookie: gina.cookie },
    });
    assert.deepEqual(other.json(), []);
    const invented = await app.inject({
      method: 'POST',
      url: '/v1/workspace/sources',
      headers,
      payload: { ...body, kind: 'consumer_query', origin: 'simulated' },
    });
    assert.equal(invented.statusCode, 422);
    const future = await app.inject({
      method: 'POST',
      url: '/v1/workspace/sources',
      headers,
      payload: { ...body, observedAt: new Date(Date.now() + 86400000).toISOString() },
    });
    assert.equal(future.statusCode, 422);
    const retired = await app.inject({
      method: 'DELETE',
      url: `/v1/workspace/sources/${source.id}`,
      headers,
      payload: { revision: source.revision },
    });
    assert.equal(retired.statusCode, 200, retired.body);
    const runs = await app.inject({ method: 'GET', url: '/v1/workflows', headers });
    assert.equal(runs.json<Array<{ status: string }>>()[0]?.status, 'obsolete');
  });
});

describe('reviewed CRM CSV imports through authenticated API and worker roles', () => {
  test('review corrections are validated, replace only the preview and persist with provenance after confirmation', async () => {
    const owner = await signedIn('alice');
    const headers = { cookie: owner.cookie, 'x-csrf-token': owner.csrf };
    const csv =
      'Titre;Entreprise;Montant;Prochaine action\nRévision fictive A;Atelier fictif A;1,234;Appeler\nRévision fictive B;Atelier fictif B;inconnu;Écrire';
    const propose = (adjustments?: CrmAdjustmentsDto) =>
      app.inject({
        method: 'POST',
        url: '/v1/crm/imports/preview',
        headers,
        payload: {
          filename: 'corrections.csv',
          text: csv,
          connectionId: null,
          ...(adjustments ? { adjustments } : {}),
        },
      });
    const first = await propose();
    assert.equal(first.statusCode, 201, first.body);
    const invalid = first.json<CrmPreviewDto>();
    assert.ok(invalid.rows.every((r) => r.action === 'invalid'));
    const malformed = await propose({ cells: [{ row: 100, column: 2, value: '20' }] });
    assert.equal(malformed.statusCode, 422);
    const corrected = await propose({
      numberFormat: 'en',
      defaultCurrency: 'EUR',
      cells: [
        { row: 3, column: 2, value: '' },
        { row: 2, column: 3, value: 'Préparer une réunion' },
      ],
    });
    assert.equal(corrected.statusCode, 201, corrected.body);
    const p = corrected.json<CrmPreviewDto>();
    assert.ok(p.rows.every((r) => r.action === 'create'));
    assert.ok(p.rows[0]?.details.some((d) => d.value === '1234 EUR'));
    assert.equal(p.rows[1]?.editableCells?.find((c) => c.column === 2)?.original, 'inconnu');
    const obsolete = await app.inject({
      method: 'POST',
      url: `/v1/crm/imports/${invalid.id}/confirm`,
      headers,
      payload: { resolutions: [] },
    });
    assert.equal(obsolete.statusCode, 409, obsolete.body);
    const workerPool = createPool({
      connectionString: db.workerUrl,
      applicationName: 'csv-corrections-worker',
      max: 2,
    });
    try {
      const ctx = serviceContext(tenants.A ?? '');
      const uow = new PgUnitOfWork(workerPool);
      const before = await uow.run(ctx, (tx) =>
        tx.listOpportunitiesForAnalysis(new Date(0).toISOString()),
      );
      assert.ok(
        !before.some((o) => o.fields.name === 'Révision fictive A'),
        'review is not an import',
      );
      const accepted = await app.inject({
        method: 'POST',
        url: `/v1/crm/imports/${p.id}/confirm`,
        headers,
        payload: { resolutions: [] },
      });
      assert.equal(accepted.statusCode, 202, accepted.body);
      const { connectionId } = accepted.json<{ connectionId: string }>();
      await new PgCrmImportStore(workerPool).apply(ctx, connectionId);
      const all = await uow.run(ctx, (tx) =>
        tx.listOpportunitiesForAnalysis(new Date(0).toISOString()),
      );
      const imported = all.filter((o) => o.connectionId === connectionId);
      assert.equal(imported.length, 2);
      assert.deepEqual(
        imported.find((o) => o.fields.name === 'Révision fictive A')?.fields.amount,
        { state: 'present', value: { amount: '1234', currency: 'EUR' } },
      );
      assert.deepEqual(
        imported.find((o) => o.fields.name === 'Révision fictive B')?.fields.amount,
        { state: 'empty' },
      );
      assert.ok(
        imported.every((o) =>
          o.fields.commercial?.materials.some((m) => m.title === 'Corrections à l’import'),
        ),
      );
    } finally {
      await workerPool.end();
    }
  });
  test('preview → confirmation → worker import; replay, update and missing rows preserve identifiers', async () => {
    const s = await signedIn('alice');
    const headers = { cookie: s.cookie, 'x-csrf-token': s.csrf };
    const workerPool = createPool({
      connectionString: db.workerUrl,
      applicationName: 'csv-test-worker',
      max: 2,
    });
    const worker = new PgCrmImportStore(workerPool);
    const ctx = serviceContext(tenants.A ?? '');
    const uow = new PgUnitOfWork(workerPool);
    let connectionId: string | null = null;
    const preview = async (text: string) => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/crm/imports/preview',
        headers,
        payload: { filename: 'fictif.csv', text, connectionId },
      });
      assert.equal(response.statusCode, 201, response.body);
      const p = response.json<CrmPreviewDto>();
      assert.ok(
        !('fields' in (p.rows[0] ?? {})),
        'response must not leak the full commercial payload',
      );
      return p;
    };
    const confirm = async (p: CrmPreviewDto) => {
      const r = await app.inject({
        method: 'POST',
        url: `/v1/crm/imports/${p.id}/confirm`,
        headers,
        payload: { resolutions: [] },
      });
      assert.equal(r.statusCode, 202, r.body);
      const value = r.json<{ connectionId: string }>();
      connectionId = value.connectionId;
      return value;
    };
    const csv =
      'Titre;Entreprise;Prochaine action;Notes\nPilote A;Fictive A;Préciser les critères;Le client demande un exemple.\nPilote B;Fictive B;;Pas de prochaine étape décidée.';
    try {
      const first = await preview(csv);
      assert.deepEqual(
        first.rows.map((r) => r.action),
        ['create', 'create'],
      );
      const firstConfirmed = await confirm(first);
      await worker.apply(ctx, firstConfirmed.connectionId);
      const before = await uow.run(ctx, (tx) =>
        tx.listOpportunitiesForAnalysis(new Date(0).toISOString()),
      );
      const original = before.filter((o) => o.connectionId === firstConfirmed.connectionId);
      assert.equal(original.length, 2);
      assert.ok(original[0]?.fields.commercial?.materials.length);
      const replay = await confirm(first);
      assert.equal(replay.connectionId, firstConfirmed.connectionId);
      const alteredReplay = await app.inject({
        method: 'POST',
        url: `/v1/crm/imports/${first.id}/confirm`,
        headers,
        payload: { resolutions: [{ row: 2, target: 'skip' }] },
      });
      assert.equal(alteredReplay.statusCode, 409, alteredReplay.body);
      await worker.apply(ctx, firstConfirmed.connectionId);
      const second = await preview(csv);
      assert.deepEqual(
        second.rows.map((r) => r.action),
        ['unchanged', 'unchanged'],
      );
      await confirm(second);
      const beforeUnchangedImport = await preview(csv);
      await worker.apply(ctx, firstConfirmed.connectionId);
      const olderConfirmation = await app.inject({
        method: 'POST',
        url: `/v1/crm/imports/${beforeUnchangedImport.id}/confirm`,
        headers,
        payload: { resolutions: [] },
      });
      assert.equal(olderConfirmation.statusCode, 409, olderConfirmation.body);
      const changed = await preview(
        'Titre;Entreprise;Prochaine action;Notes\nPilote A;Fictive A;Préparer une réunion;Le client demande un exemple.',
      );
      assert.equal(changed.rows[0]?.action, 'update');
      assert.equal(changed.missing, 1);
      await confirm(changed);
      await worker.apply(ctx, firstConfirmed.connectionId);
      const after = await uow.run(ctx, (tx) =>
        tx.listOpportunitiesForAnalysis(new Date(0).toISOString()),
      );
      const current = after.filter((o) => o.connectionId === firstConfirmed.connectionId);
      assert.deepEqual(current.map((o) => o.id).sort(), original.map((o) => o.id).sort());
      for (const o of original)
        assert.equal(
          current.find((c) => c.id === o.id)?.revision,
          o.revision + (o.fields.name === 'Pilote A' ? 1 : 0),
        );
      const conn = await uow.run(ctx, (tx) => tx.getConnection(firstConfirmed.connectionId));
      assert.equal(
        conn?.nextSyncAt,
        null,
        'a file is never periodically made fresh without another upload',
      );
      const history = await app.inject({ url: '/v1/crm/imports', headers });
      const imported =
        history.json<
          Array<{ id: string; result: { created: number; updated: number; unchanged: number } }>
        >();
      assert.equal(imported.find((r) => r.id === changed.id)?.result.updated, 1);
      const revoked = await app.inject({
        method: 'DELETE',
        url: `/v1/connections/${replay.connectionId}`,
        headers,
      });
      assert.equal(revoked.statusCode, 200, revoked.body);
      await assert.rejects(() =>
        worker.preview(
          userContext(tenants.A ?? '', users.alice?.id ?? '', 'owner'),
          'bad.csv',
          { columns: [], rows: [], delimiter: ',' },
          firstConfirmed.connectionId,
        ),
      );
      const copies = await worker.transaction(
        ctx,
        async (_tx, sql) =>
          (
            await sql.query<{ preview: unknown }>(
              'SELECT preview FROM crm_import_batches WHERE connection_id=$1',
              [connectionId],
            )
          ).rows,
      );
      assert.ok(copies.every((r) => r.preview === null));
    } finally {
      await workerPool.end();
    }
  });
  test('tenant, permissions, CSRF, ambiguous matches and invalid rows are enforced before confirmation', async () => {
    const alice = await signedIn('alice'),
      gina = await signedIn('gina'),
      viewer = await signedIn('vera');
    const payload = {
      filename: 'fictif.csv',
      connectionId: null,
      text: 'Titre;Entreprise\nMême affaire;Fictive\nMême affaire;Fictive',
    };
    const h = { cookie: alice.cookie, 'x-csrf-token': alice.csrf };
    const noCsrf = await app.inject({
      method: 'POST',
      url: '/v1/crm/imports/preview',
      headers: { cookie: alice.cookie },
      payload,
    });
    assert.equal(noCsrf.statusCode, 403);
    const denied = await app.inject({
      method: 'POST',
      url: '/v1/crm/imports/preview',
      headers: { cookie: viewer.cookie, 'x-csrf-token': viewer.csrf },
      payload,
    });
    assert.equal(denied.statusCode, 403);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/crm/imports/preview',
      headers: h,
      payload,
    });
    assert.equal(response.statusCode, 201, response.body);
    const p = response.json<CrmPreviewDto>();
    assert.ok(p.rows.every((r) => r.action === 'choose'));
    const confirm = (headers: Record<string, string>, resolutions: unknown[] = []) =>
      app.inject({
        method: 'POST',
        url: `/v1/crm/imports/${p.id}/confirm`,
        headers,
        payload: { resolutions },
      });
    assert.equal(
      (await confirm({ cookie: gina.cookie, 'x-csrf-token': gina.csrf })).statusCode,
      404,
    );
    assert.equal((await confirm(h)).statusCode, 422);
    const done = await confirm(h, [
      { row: 2, target: 'new' },
      { row: 3, target: 'skip' },
    ]);
    assert.equal(done.statusCode, 202, done.body);
    const other = await app.inject({ url: '/v1/crm/imports', headers: { cookie: gina.cookie } });
    assert.deepEqual(other.json(), []);
    const foreign = await app.inject({
      method: 'POST',
      url: '/v1/crm/imports/preview',
      headers: { cookie: gina.cookie, 'x-csrf-token': gina.csrf },
      payload: { ...payload, connectionId: done.json<{ connectionId: string }>().connectionId },
    });
    assert.equal(foreign.statusCode, 404);
    const cleanup = await app.inject({
      method: 'DELETE',
      url: `/v1/connections/${done.json<{ connectionId: string }>().connectionId}`,
      headers: h,
    });
    assert.equal(cleanup.statusCode, 200);
    const invalid = await app.inject({
      method: 'POST',
      url: '/v1/crm/imports/preview',
      headers: h,
      payload: { ...payload, text: 'Titre;Limiter la vue à ..\nPrivée;Équipe secrète' },
    });
    const rejected = invalid.json<CrmPreviewDto>();
    assert.equal(rejected.rows[0]?.action, 'invalid');
    const forced = await app.inject({
      method: 'POST',
      url: `/v1/crm/imports/${rejected.id}/confirm`,
      headers: h,
      payload: { resolutions: [{ row: 2, target: 'new' }] },
    });
    assert.equal(forced.statusCode, 422);
  });
});
