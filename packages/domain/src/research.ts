import { ensure } from './errors.ts';
import { fingerprintOf } from './hash.ts';

/** Explicitly public context: CRM notes and private workflow briefs never enter search queries. */
export type ResearchProfile = {
  enabled: boolean;
  companyName: string;
  website: string;
  offers: string[];
  target: string;
  market: string;
  geography: string;
  keywords: string[];
  budgetUsd: number;
  maxSearches: number;
  maxPages: number;
  maxAgeDays: number;
};
export const RESEARCH_DIMENSIONS = [
  'offer',
  'target',
  'price',
  'delivery',
  'integrations',
  'proof',
  'support',
  'limits',
] as const;
export type ResearchDimension = (typeof RESEARCH_DIMENSIONS)[number];
export type ResearchAxis =
  'name' | 'offer' | 'need' | 'market' | 'sector' | 'geography' | 'alternative' | 'enrichment';
export type ResearchQuery = { axis: ResearchAxis; query: string; page: number };
export type ResearchFact = {
  id: string;
  offer: string;
  dimension: ResearchDimension;
  value: string;
  quote: string;
  pageId: string;
  /** A claim on a vendor page stays a claim after human approval. */
  quality: 'observed' | 'vendor_claim';
};
export type ResearchPage = {
  id: string;
  url: string;
  title: string;
  text: string;
  hash: string;
  retrievedAt: string;
  publishedAt: string | null;
  truncated: boolean;
  links: { url: string; label: string }[];
};
export type ResearchCandidate = {
  id: string;
  campaignId: string;
  domain: string;
  name: string;
  revision: number;
  own: boolean;
  relevance: 'unqualified' | 'direct' | 'indirect' | 'substitute' | 'irrelevant' | 'directory';
  reason: string;
  facts: ResearchFact[];
  pages: Omit<ResearchPage, 'text' | 'links'>[];
  errors: { url: string; code: string }[];
  review: 'pending' | 'approved' | 'excluded';
  note: string;
  /** Corrections are attributed human notes, never substituted into a source quotation. */
  corrections: { factId: string; value: string }[];
};
export type ResearchCampaign = {
  id: string;
  revision: number;
  profile: ResearchProfile;
  profileRevision: number;
  contextVersion: number;
  status: 'queued' | 'running' | 'paused' | 'completed' | 'cancelled' | 'failed';
  stopReason: string | null;
  createdAt: string;
  updatedAt: string;
  searches: number;
  pages: number;
  modelCalls: number;
  committedUsd: number;
  uncertainCalls: number;
  candidateCount: number;
  qualifiedCount: number;
  pendingTasks: number;
};
export type ResearchTaskBody =
  | { kind: 'search'; search: ResearchQuery }
  | { kind: 'read'; url: string; depth: number }
  | { kind: 'extract'; pageId: string; candidateId: string }
  | { kind: 'plan' };
export type ResearchTask = {
  id: string;
  campaignId: string;
  body: ResearchTaskBody;
  attempt: number;
  lease: string;
};
export type ResearchExtraction = {
  name: string;
  relevance: ResearchCandidate['relevance'];
  reason: string;
  facts: Omit<ResearchFact, 'id' | 'pageId' | 'quality'>[];
  /** Only links actually read in the page may be followed. */
  competitorLinks: string[];
};
export const normalizeEvidence = (s: string): string => s.replace(/\s+/gu, ' ').trim();
export const researchProfileHash = (p: ResearchProfile, contextVersion: number): string =>
  fingerprintOf({ p, contextVersion });

/** Domain identity is conservative: do not conflate brands, subdomains or homonyms. */
export function researchDomain(url: string): string {
  return new URL(url).hostname.toLowerCase().replace(/^www\./u, '');
}
export function canonicalResearchUrl(raw: string): string {
  const u = new URL(raw);
  ensure(
    u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443'),
    'INVALID_INPUT',
    'public HTTPS URL required',
  );
  ensure(u.href.length <= 2000 && u.hostname.includes('.'), 'INVALID_INPUT', 'invalid URL');
  u.hash = '';
  for (const key of [...u.searchParams.keys()])
    if (/^(utm_|fbclid$|gclid$)/u.test(key)) u.searchParams.delete(key);
  u.searchParams.sort();
  return u.href;
}
export function initialResearchQueries(p: ResearchProfile): ResearchQuery[] {
  const queries: { axis: ResearchAxis; query: string }[] = [
    { axis: 'name', query: `${p.companyName} concurrents alternatives` },
    { axis: 'market', query: `${p.market} ${p.target} prestataires solutions` },
    { axis: 'sector', query: `${p.market} ${p.target} comparatif offres` },
    { axis: 'geography', query: `${p.market} ${p.geography} entreprises` },
  ];
  for (const offer of p.offers) {
    queries.push({ axis: 'offer', query: `${offer} ${p.target}` });
    queries.push({ axis: 'need', query: `${offer} problèmes besoins ${p.target}` });
    queries.push({ axis: 'alternative', query: `${offer} alternatives logiciels agences` });
  }
  for (const word of p.keywords)
    queries.push({ axis: 'offer', query: `${word} ${p.geography} ${p.target}` });
  return [
    ...new Map(
      queries.map((q) => [
        normalizeEvidence(q.query),
        { ...q, query: normalizeEvidence(q.query).slice(0, 350), page: 0 },
      ]),
    ).values(),
  ];
}
/** Exact excerpts ground every cell. Model text and page instructions cannot grant tool authority. */
export function validateResearchExtraction(result: ResearchExtraction, page: ResearchPage): void {
  const haystack = normalizeEvidence(page.text);
  ensure(
    result.facts.every(
      (f) =>
        normalizeEvidence(f.quote).length >= 12 && haystack.includes(normalizeEvidence(f.quote)),
    ),
    'INVALID_INPUT',
    'ungrounded research fact',
  );
  const links = new Set(page.links.map((l) => l.url));
  ensure(
    result.competitorLinks.every((url) => links.has(url)),
    'INVALID_INPUT',
    'unread discovery link',
  );
  ensure(result.relevance !== 'unqualified', 'INVALID_INPUT', 'unqualified extraction');
}
export type ResearchCell = {
  dimension: ResearchDimension;
  state: 'documented' | 'different_claims' | 'not_found' | 'inaccessible';
  facts: ResearchFact[];
};
export function researchMatrix(
  candidate: ResearchCandidate,
): { offer: string; cells: ResearchCell[] }[] {
  const offers = [...new Set(candidate.facts.map((f) => f.offer))];
  return (offers.length ? offers : ['Offre non identifiée']).map((offer) => ({
    offer,
    cells: RESEARCH_DIMENSIONS.map((dimension) => {
      const facts = candidate.facts.filter((f) => f.offer === offer && f.dimension === dimension);
      // Different prices may be tiers/conditions, never silently rank them or resolve a conflict.
      const distinct = new Set(facts.map((f) => normalizeEvidence(f.value).toLowerCase()));
      return {
        dimension,
        facts,
        state: facts.length
          ? distinct.size > 1
            ? 'different_claims'
            : 'documented'
          : candidate.pages.length
            ? 'not_found'
            : 'inaccessible',
      };
    }),
  }));
}
