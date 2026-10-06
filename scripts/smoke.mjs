#!/usr/bin/env node
/**
 * Smoke test of a running Ulysse stack through its public HTTP surface only:
 * health, a real OIDC Authorization Code login through the identity provider's
 * login form, the session endpoint and the recommendation list.
 *
 *   node scripts/smoke.mjs --base http://localhost:3000 --user alice --password ... \
 *     [--expect-recommendations 1] [--session-file f] [--reuse-session]
 *
 * --session-file keeps the session cookie so that a second run with
 * --reuse-session can check that a session survives an API restart.
 * Only for fictional development accounts; never pass a real password on a shared shell.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    base: { type: 'string', default: 'http://localhost:3000' },
    user: { type: 'string', default: 'alice' },
    password: { type: 'string' },
    'expect-recommendations': { type: 'string', default: '0' },
    'wait-seconds': { type: 'string', default: '90' },
    'session-file': { type: 'string' },
    'reuse-session': { type: 'boolean', default: false },
  },
});
const base = new URL(values.base);
const expected = Number(values['expect-recommendations']);

/** Minimal cookie jar keyed by host (enough for the API and the identity provider). */
const jar = new Map();
function store(url, response) {
  const host = new URL(url).host;
  const cookies = jar.get(host) ?? new Map();
  for (const line of response.headers.getSetCookie()) {
    const [pair] = line.split(';');
    const index = pair.indexOf('=');
    cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
  }
  jar.set(host, cookies);
}
function cookieHeader(url) {
  const cookies = jar.get(new URL(url).host);
  return cookies ? [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') : '';
}
async function request(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    redirect: 'manual',
    headers: { ...init.headers, cookie: cookieHeader(url) },
  });
  store(url, response);
  return response;
}
function check(condition, message) {
  if (!condition) {
    console.error(`smoke: FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`smoke: ok: ${message}`);
}

const health = await fetch(new URL('/health/ready', base));
check(health.ok, `GET /health/ready → ${health.status}`);

if (values['reuse-session']) {
  const saved = JSON.parse(await readFile(values['session-file'], 'utf8'));
  jar.set(base.host, new Map(saved));
} else {
  check(Boolean(values.password), 'a password is provided for the fictional account');
  const start = await request(new URL('/auth/login?returnTo=/recommendations', base));
  check(start.status === 302, `GET /auth/login redirects to the identity provider`);
  const authorize = start.headers.get('location');
  const form = await request(authorize);
  const html = await form.text();
  const action = /<form[^>]*id="kc-form-login"[^>]*action="([^"]+)"/.exec(html)?.[1];
  check(Boolean(action), 'the identity provider login form is served');
  const posted = await request(action.replaceAll('&amp;', '&'), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: values.user, password: values.password }),
  });
  const callback = posted.headers.get('location') ?? '';
  check(
    posted.status === 302 && callback.startsWith(new URL('/auth/callback', base).href),
    'credentials accepted, redirected to the API callback',
  );
  const done = await request(callback);
  check(
    done.status === 302 && done.headers.get('location') === '/recommendations',
    `callback completes the login (→ ${done.headers.get('location')})`,
  );
  if (values['session-file'])
    await writeFile(values['session-file'], JSON.stringify([...(jar.get(base.host) ?? [])]), {
      mode: 0o600,
    });
}

const me = await request(new URL('/v1/me', base));
check(me.status === 200, `GET /v1/me → ${me.status}`);
const session = await me.json();
check(
  session.activeTenant !== null,
  `signed in as ${session.user.displayName} in ${session.activeTenant?.name} (${session.activeTenant?.role})`,
);

const deadline = Date.now() + Number(values['wait-seconds']) * 1000;
let count = 0;
for (;;) {
  const list = await request(new URL('/v1/recommendations', base));
  if (list.status !== 200) check(false, `GET /v1/recommendations → ${list.status}`);
  count = (await list.json()).items.length;
  if (count >= expected || Date.now() > deadline) break;
  await new Promise((resolve) => setTimeout(resolve, 3000));
}
check(count >= expected, `${count} open proposal(s), expected at least ${expected}`);
