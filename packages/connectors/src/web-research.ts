import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { createHash, randomUUID } from 'node:crypto';
import ipaddr from 'ipaddr.js';
import { parse, type DefaultTreeAdapterTypes } from 'parse5';
import { createRequire } from 'node:module';
import type { ReadableStreamReadResult } from 'node:stream/web';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { canonicalResearchUrl } from '@ulysse/domain';
import type { ResearchPage, ResearchQuery } from '@ulysse/domain';

export class ResearchWebError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = 'ResearchWebError';
  }
}
export interface SearchProvider {
  readonly name: string;
  readonly costPerCallUsd: number;
  search(
    query: ResearchQuery,
    signal: AbortSignal,
  ): Promise<{ results: { url: string; title: string }[]; more: boolean }>;
}
export interface PublicPageReader {
  read(url: string, signal: AbortSignal): Promise<ResearchPage>;
}
export function isPublicAddress(address: string): boolean {
  try {
    return ipaddr.process(address).range() === 'unicast';
  } catch {
    return false;
  }
}
/** Resolves once and pins the validated address at the socket, including every redirect. */
export async function publicHttps(
  url: string,
  signal: AbortSignal,
  redirects = 0,
  authorizeRedirect?: (url: string) => Promise<void>,
): Promise<{ status: number; url: string; contentType: string; body: string }> {
  let u: URL;
  try {
    u = new URL(canonicalResearchUrl(url));
  } catch {
    throw new ResearchWebError('unsafe_url');
  }
  signal.throwIfAborted();
  if (redirects > 3) throw new ResearchWebError('redirect_limit');
  let cancel = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    cancel = () => reject(new ResearchWebError('read_timeout'));
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
  });
  const addresses = await Promise.race([
    lookup(u.hostname, { all: true }).catch(() => {
      throw new ResearchWebError('dns_failed');
    }),
    aborted,
  ]).finally(() => signal.removeEventListener('abort', cancel));
  if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address)))
    throw new ResearchWebError('private_address');
  const address = addresses[0];
  if (!address) throw new ResearchWebError('dns_failed');
  const response = await new Promise<{
    status: number;
    location: string | undefined;
    contentType: string;
    body: string;
  }>((resolve, reject) => {
    const req = request(
      u,
      {
        method: 'GET',
        agent: false,
        signal,
        family: address.family,
        lookup: (_host, _options, cb) => cb(null, address.address, address.family),
        headers: {
          'user-agent': 'UlysseResearch/1.0',
          accept: 'text/html,text/plain;q=0.8',
          'accept-encoding': 'identity',
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        res.on('data', (part: Buffer) => {
          bytes += part.length;
          if (bytes > 2_000_000) {
            res.destroy();
            req.destroy(new ResearchWebError('page_too_large'));
            return;
          }
          chunks.push(part);
        });
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            location: res.headers.location,
            contentType: res.headers['content-type'] ?? '',
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
        res.on('error', () => reject(new ResearchWebError('read_failed')));
      },
    );
    req.on('error', (err) =>
      reject(
        err instanceof ResearchWebError
          ? err
          : new ResearchWebError(signal.aborted ? 'read_timeout' : 'read_failed'),
      ),
    );
    req.end();
  });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    if (!response.location) throw new ResearchWebError('invalid_redirect');
    const next = canonicalResearchUrl(new URL(response.location, u).href);
    await authorizeRedirect?.(next);
    return publicHttps(next, signal, redirects + 1, authorizeRedirect);
  }
  return { ...response, url: u.href };
}
type Node = DefaultTreeAdapterTypes.Node;
const ignored = new Set(['script', 'style', 'noscript', 'svg', 'template', 'nav', 'footer']);
function nodeText(node: Node): string {
  if (node.nodeName === '#text' && 'value' in node) return node.value;
  if (ignored.has(node.nodeName) || !('childNodes' in node)) return '';
  if (
    'attrs' in node &&
    node.attrs.some((a) => a.name === 'hidden' || (a.name === 'aria-hidden' && a.value === 'true'))
  )
    return '';
  return node.childNodes.map(nodeText).join(' ');
}
export function extractPublicPage(url: string, html: string, now = new Date()): ResearchPage {
  const root = parse(html);
  const links: ResearchPage['links'] = [];
  let title = '';
  let publishedAt: string | null = null;
  const visit = (node: Node) => {
    if (ignored.has(node.nodeName)) return;
    if (node.nodeName === 'title') title = nodeText(node).trim().slice(0, 300);
    if ('attrs' in node) {
      const attr = (name: string) => node.attrs.find((a) => a.name === name)?.value;
      if (
        node.nodeName === 'meta' &&
        ['article:published_time', 'datePublished'].includes(attr('property') ?? attr('name') ?? '')
      ) {
        const date = Date.parse(attr('content') ?? '');
        if (Number.isFinite(date) && date <= now.getTime())
          publishedAt = new Date(date).toISOString();
      }
      if (node.nodeName === 'a' && links.length < 300) {
        try {
          const href = attr('href');
          if (href)
            links.push({
              url: canonicalResearchUrl(new URL(href, url).href),
              label: nodeText(node).replace(/\s+/gu, ' ').trim().slice(0, 200),
            });
        } catch {
          /* Unsafe links are data, never fetch instructions. */
        }
      }
    }
    if ('childNodes' in node) for (const child of node.childNodes) visit(child);
  };
  visit(root);
  const all = nodeText(root).replace(/\s+/gu, ' ').trim();
  if (all.length < 80) throw new ResearchWebError('no_readable_content');
  const text = all.slice(0, 24000);
  return {
    id: randomUUID(),
    url,
    title,
    text,
    hash: createHash('sha256').update(text).digest('hex'),
    retrievedAt: now.toISOString(),
    publishedAt,
    truncated: all.length > text.length,
    links: [...new Map(links.map((l) => [l.url, l])).values()],
  };
}
export class SafePublicPageReader implements PublicPageReader {
  readonly transport: typeof publicHttps;
  constructor(transport: typeof publicHttps = publicHttps) {
    this.transport = transport;
  }
  async allowed(url: string, signal: AbortSignal): Promise<void> {
    const robotsUrl = new URL('/robots.txt', url).href;
    const robots = await this.transport(robotsUrl, signal);
    let seconds = 1;
    if (robots.status !== 404 && robots.status !== 410) {
      if (robots.status !== 200 || robots.body.length > 500000 || /^\s*</u.test(robots.body))
        throw new ResearchWebError('robots_unavailable');
      const factory = z
        .function({ input: [z.string(), z.string()], output: z.unknown() })
        .parse(createRequire(import.meta.url)('robots-parser'));
      const raw: unknown = factory(robotsUrl, robots.body);
      const policy = z
        .object({
          isAllowed: z.function({
            input: [z.string(), z.string()],
            output: z.boolean().optional(),
          }),
          getCrawlDelay: z.function({ input: [z.string()], output: z.number().optional() }),
        })
        .parse(raw);
      if (policy.isAllowed.call(raw, url, 'UlysseResearch') === false)
        throw new ResearchWebError('robots_denied');
      seconds = policy.getCrawlDelay.call(raw, 'UlysseResearch') ?? 1;
    }
    if (seconds > 10) throw new ResearchWebError('crawl_delay_exceeded');
    await delay(Math.max(1, seconds) * 1000, undefined, { signal });
  }
  async read(raw: string, external: AbortSignal): Promise<ResearchPage> {
    const signal = AbortSignal.any([external, AbortSignal.timeout(25000)]);
    const url = canonicalResearchUrl(raw);
    await this.allowed(url, signal);
    const response = await this.transport(url, signal, 0, async (next) => {
      if (
        new URL(next).hostname.replace(/^www\./u, '') !==
        new URL(url).hostname.replace(/^www\./u, '')
      )
        throw new ResearchWebError('domain_redirect_requires_review');
      await this.allowed(next, signal);
    });
    if (response.status !== 200) throw new ResearchWebError(`page_http_${response.status}`);
    if (
      new URL(response.url).hostname.replace(/^www\./u, '') !==
      new URL(url).hostname.replace(/^www\./u, '')
    )
      throw new ResearchWebError('domain_redirect_requires_review');
    if (!/^(text\/html|application\/xhtml\+xml|text\/plain)\b/iu.test(response.contentType))
      throw new ResearchWebError('unsupported_content_type');
    return extractPublicPage(response.url, response.body);
  }
}
const SearchResponse = z.object({
  query: z.object({ more_results_available: z.boolean().optional() }),
  web: z
    .object({
      results: z.array(z.object({ url: z.url().max(2000), title: z.string().max(2000) })).max(100),
    })
    .optional(),
});
export class BraveSearchProvider implements SearchProvider {
  readonly name = 'brave';
  readonly key: string;
  readonly costPerCallUsd: number;
  readonly fetcher: typeof fetch;
  constructor(key: string, costPerCallUsd = 0.005, fetcher: typeof fetch = fetch) {
    this.key = key;
    this.costPerCallUsd = costPerCallUsd;
    this.fetcher = fetcher;
  }
  async search(query: ResearchQuery, signal: AbortSignal) {
    if (!Number.isInteger(query.page) || query.page < 0 || query.page > 9)
      throw new ResearchWebError('search_page_limit');
    const params = new URLSearchParams({
      q: query.query,
      count: '20',
      offset: String(query.page),
      search_lang: 'fr',
      safesearch: 'moderate',
      text_decorations: 'false',
    });
    const response = await this.fetcher(
      `https://api.search.brave.com/res/v1/web/search?${params.toString()}`,
      {
        headers: { 'X-Subscription-Token': this.key, accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new ResearchWebError(`search_http_${response.status}`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new ResearchWebError('search_invalid_response');
    let body = '';
    let bytes = 0;
    try {
      const decoder = new TextDecoder();
      for (;;) {
        const part: ReadableStreamReadResult<unknown> = await reader.read();
        if (part.done) break;
        if (!(part.value instanceof Uint8Array))
          throw new ResearchWebError('search_invalid_response');
        bytes += part.value.length;
        if (bytes > 1_000_000) {
          await reader.cancel();
          throw new ResearchWebError('search_response_too_large');
        }
        body += decoder.decode(part.value, { stream: true });
      }
      body += decoder.decode();
    } finally {
      reader.releaseLock();
    }
    const raw: unknown = JSON.parse(body);
    const data = SearchResponse.parse(raw);
    const results = (data.web?.results ?? []).flatMap((r) => {
      try {
        return [{ url: canonicalResearchUrl(r.url), title: r.title.slice(0, 200) }];
      } catch {
        return [];
      }
    });
    return { results, more: data.query.more_results_available === true };
  }
}
