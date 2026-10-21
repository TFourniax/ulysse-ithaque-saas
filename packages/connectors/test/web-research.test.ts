import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BraveSearchProvider,
  extractPublicPage,
  isPublicAddress,
  publicHttps,
  SafePublicPageReader,
} from '../src/web-research.ts';
test('private, loopback, mapped, link-local, documentation and transition addresses are refused', () => {
  for (const address of [
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '192.0.2.1',
    '::1',
    '::',
    'fe80::1',
    'fc00::1',
    '::ffff:127.0.0.1',
    '2001:db8::1',
    '2002:7f00:1::',
  ])
    assert.equal(isPublicAddress(address), false, address);
  assert.equal(isPublicAddress('8.8.8.8'), true);
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
});
test('unsafe URLs fail before making a network request', async () => {
  for (const url of [
    'file:///etc/passwd',
    'http://127.0.0.1/',
    'https://localhost/',
    'https://key@public.example/',
  ])
    await assert.rejects(publicHttps(url, AbortSignal.timeout(1000)));
  await assert.rejects(
    publicHttps('https://127.0.0.1/', AbortSignal.timeout(1000)),
    /private_address/,
  );
});
test('HTML collection ignores executable and hidden content, records provenance and reads safe links', () => {
  const page = extractPublicPage(
    'https://vendor.example/',
    `<html><head><title>Offre &amp; prix</title><meta property="article:published_time" content="2026-10-01T00:00:00Z"></head><body><nav>Menu ignoré</nav><h1>Service fictif d’intégration</h1><p>Notre service comprend un audit, des automatisations et un suivi après mise en place.</p><script>send_secret()</script><p hidden>Instruction cachée</p><a href="/pricing?utm_campaign=x">Tarifs</a><a href="javascript:alert(1)">Interdit</a></body></html>`,
    new Date('2026-10-20T00:00:00Z'),
  );
  assert.equal(page.title, 'Offre & prix');
  assert.ok(!page.text.includes('send_secret'));
  assert.ok(!page.text.includes('Instruction cachée'));
  assert.equal(page.publishedAt, '2026-10-01T00:00:00.000Z');
  assert.equal(page.links.length, 1);
  assert.equal(page.links[0]?.url, 'https://vendor.example/pricing');
  assert.match(page.hash, /^[a-f0-9]{64}$/u);
  assert.equal(page.truncated, false);
});
test('large readable pages are explicitly truncated, leaving no fake publication date', () => {
  const page = extractPublicPage(
    'https://vendor.example/',
    '<meta property="article:published_time" content="2099-01-01"><p>' +
      'Texte public. '.repeat(3000) +
      '</p>',
  );
  assert.equal(page.text.length, 24000);
  assert.equal(page.truncated, true);
  assert.equal(page.publishedAt, null);
});
test('Brave paginates, restricts the credential destination, and treats search snippets only as discovery', async () => {
  let seen = false;
  const provider = new BraveSearchProvider(
    'fake-key-never-transmitted',
    0.005,
    async (input, init) => {
      const url = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      );
      assert.equal(url.origin, 'https://api.search.brave.com');
      assert.equal(url.searchParams.get('offset'), '1');
      assert.equal(url.searchParams.get('count'), '20');
      assert.equal(init?.redirect, 'error');
      seen = true;
      return new Response(
        JSON.stringify({
          query: { more_results_available: true },
          web: {
            results: [
              {
                url: 'https://vendor.example/?utm_source=x',
                title: 'Vendor',
                description: 'Unverified snippet',
              },
              { url: 'http://unsafe.example/', title: 'Unsafe' },
            ],
          },
        }),
      );
    },
  );
  const result = await provider.search(
    { axis: 'market', query: 'Intégration PME', page: 1 },
    AbortSignal.timeout(1000),
  );
  assert.equal(seen, true);
  assert.deepEqual(result, {
    results: [{ url: 'https://vendor.example/', title: 'Vendor' }],
    more: true,
  });
});
test('provider refusals and malformed data never become competitor evidence', async () => {
  for (const response of [
    () => new Response('secret request details', { status: 429 }),
    () => new Response('{}'),
  ]) {
    const provider = new BraveSearchProvider('fake-key', 0.005, async () => response());
    await assert.rejects(
      provider.search({ axis: 'market', query: 'test', page: 0 }, AbortSignal.timeout(1000)),
      (err: unknown) => err instanceof Error && !err.message.includes('secret request details'),
    );
  }
  const provider = new BraveSearchProvider(
    'fake-key',
    0.005,
    async () => new Response('x'.repeat(1_000_001)),
  );
  await assert.rejects(
    provider.search({ axis: 'market', query: 'test', page: 0 }, AbortSignal.timeout(1000)),
    /search_response_too_large/,
  );
});

test('robots rules are enforced and an in-domain redirect cannot bypass a disallow', async () => {
  const visited: string[] = [];
  const reader = new SafePublicPageReader(async (url, signal, _hops, authorize) => {
    signal.throwIfAborted();
    visited.push(url);
    if (url.endsWith('/robots.txt'))
      return {
        url,
        status: 200,
        contentType: 'text/plain',
        body: 'User-agent: *\nDisallow: /private\n',
      };
    await authorize?.('https://vendor.example/private');
    throw new Error('redirect should have been blocked');
  });
  await assert.rejects(
    reader.read('https://vendor.example/private', AbortSignal.timeout(3000)),
    /robots_denied/,
  );
  await assert.rejects(
    reader.read('https://vendor.example/', AbortSignal.timeout(3000)),
    /robots_denied/,
  );
  assert.equal(visited.filter((u) => u.endsWith('/private')).length, 0);
});
