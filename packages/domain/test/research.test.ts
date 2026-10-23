import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rankResearchCandidates, researchFactsForDigest } from '../src/research-selection.ts';
import {
  canonicalResearchUrl,
  initialResearchQueries,
  researchDomain,
  researchMatrix,
  validateResearchExtraction,
} from '../src/research.ts';
import type {
  ResearchCandidate,
  ResearchExtraction,
  ResearchPage,
  ResearchProfile,
} from '../src/research.ts';
const profile: ResearchProfile = {
  enabled: true,
  companyName: 'Acme fictive',
  website: 'https://acme.example/',
  offers: ['Automatisation métier'],
  target: 'PME',
  market: 'Intégration',
  geography: 'France',
  keywords: ['ERP', 'no-code'],
  budgetUsd: 0.75,
  maxSearches: 30,
  maxPages: 120,
  maxAgeDays: 30,
};
const page: ResearchPage = {
  id: 'page',
  url: 'https://rival.example/offre',
  title: 'Offre fictive',
  text: 'Notre accompagnement comprend un audit et une mise en place progressive. Prix à partir de 90 EUR par utilisateur et par mois.',
  hash: 'hash',
  retrievedAt: '2026-10-20T12:00:00Z',
  publishedAt: null,
  truncated: false,
  links: [{ url: 'https://autre.example/', label: 'Autre prestataire' }],
};
const extraction: ResearchExtraction = {
  name: 'Rival fictif',
  relevance: 'direct',
  reason: 'Même besoin et cible.',
  facts: [
    {
      offer: 'Service',
      dimension: 'price',
      value: 'À partir de 90 EUR/utilisateur/mois.',
      quote: 'Prix à partir de 90 EUR par utilisateur et par mois.',
    },
  ],
  competitorLinks: [],
};
test('discovery covers name, offer, need, market, sector, geography and alternatives without supplied competitors', () => {
  const plan = initialResearchQueries(profile);
  assert.deepEqual(
    new Set(plan.map((q) => q.axis)),
    new Set(['name', 'offer', 'need', 'market', 'sector', 'geography', 'alternative']),
  );
  assert.ok(plan.some((q) => q.query.includes('no-code')));
  assert.ok(plan.every((q) => q.page === 0));
});
test('canonicalization deduplicates tracking links without conflating companies or subdomains', () => {
  assert.equal(
    canonicalResearchUrl('https://rival.example/price?utm_source=x&b=2&a=1#top'),
    'https://rival.example/price?a=1&b=2',
  );
  assert.equal(researchDomain('https://www.rival.example'), 'rival.example');
  assert.notEqual(
    researchDomain('https://rival.example'),
    researchDomain('https://other.rival.example'),
  );
  for (const url of [
    'http://rival.example/',
    'file:///etc/passwd',
    'https://secret@rival.example/',
    'https://rival.example:8443/',
    'https://localhost/',
  ])
    assert.throws(() => canonicalResearchUrl(url));
});
test('every extracted fact needs an exact read excerpt; discoveries must come from observed links', () => {
  validateResearchExtraction(extraction, page);
  assert.throws(() =>
    validateResearchExtraction(
      {
        ...extraction,
        facts: [
          { ...extraction.facts[0]!, quote: 'Preuve inventée qui ne figure pas dans la page.' },
        ],
      },
      page,
    ),
  );
  assert.throws(() =>
    validateResearchExtraction(
      { ...extraction, competitorLinks: ['https://invented.example/'] },
      page,
    ),
  );
  validateResearchExtraction({ ...extraction, competitorLinks: [page.links[0]!.url] }, page);
});
test('matrix keeps offers separate, flags differing claims and never ranks incomparable prices', () => {
  const candidate: ResearchCandidate = {
    id: 'c',
    campaignId: 'r',
    domain: 'rival.example',
    name: 'Rival',
    revision: 1,
    own: false,
    relevance: 'direct',
    reason: 'Besoin partagé',
    facts: [
      { ...extraction.facts[0]!, id: 'a', pageId: 'page', quality: 'vendor_claim' },
      {
        ...extraction.facts[0]!,
        id: 'b',
        pageId: 'page2',
        value: 'Projet à partir de 3000 EUR HT, maintenance non incluse.',
        quality: 'vendor_claim',
      },
      {
        ...extraction.facts[0]!,
        offer: 'Autre produit',
        id: 'c',
        pageId: 'page3',
        quality: 'vendor_claim',
      },
    ],
    pages: [page],
    errors: [],
    review: 'approved',
    note: '',
    corrections: [],
  };
  const matrix = researchMatrix(candidate);
  assert.equal(matrix.length, 2);
  assert.equal(matrix[0]?.cells.find((c) => c.dimension === 'price')?.state, 'different_claims');
  assert.equal(matrix[0].cells.find((c) => c.dimension === 'support')?.state, 'not_found');
  assert.ok(matrix[0].cells.flatMap((c) => c.facts).every((f) => f.quality === 'vendor_claim'));
  assert.equal(
    researchMatrix({
      ...candidate,
      facts: [],
      pages: [],
      errors: [{ url: page.url, code: 'page_http_403' }],
    })[0]?.cells[0]?.state,
    'inaccessible',
  );
});

test('reading priority promotes documented need and geography beyond the first alphabetic page without excluding remote alternatives', () => {
  const candidate = (domain: string, value: string): ResearchCandidate => ({
    id: domain,
    campaignId: 'r',
    domain,
    name: domain,
    revision: 1,
    own: false,
    relevance: 'direct',
    reason: 'Automatisation métier PME France — qualification non démontrée',
    facts: [
      {
        id: domain,
        pageId: 'page',
        quality: 'vendor_claim',
        offer: 'Offre',
        dimension: 'offer',
        value,
        quote: value,
      },
    ],
    pages: [],
    errors: [],
    review: 'pending',
    note: '',
    corrections: [],
  });
  const alphabetical = Array.from({ length: 30 }, (_, i) =>
    candidate(`a${i}.example`, 'Développement de sites vitrine'),
  );
  const distant = candidate(
    'remote.example',
    'Automatisation métier et intégration pour PME, Canada',
  );
  const local = candidate(
    'z-local.example',
    'Automatisation métier et intégration pour PME en France',
  );
  const ranked = rankResearchCandidates([...alphabetical, distant, local], profile);
  assert.equal(ranked[0]?.id, local.id);
  assert.equal(ranked[1]?.id, distant.id);
  assert.equal(ranked.length, 32);
  assert.equal(alphabetical[0]?.id, 'a0.example');
  assert.equal(local.review, 'pending', 'reading order must not approve evidence');
  const enterprise = candidate('enterprise.example', 'Automatisation métier et intégration');
  enterprise.facts.push({
    ...enterprise.facts[0]!,
    id: 'enterprise-target',
    dimension: 'target',
    value: 'ETI et grandes entreprises',
    quote: 'ETI et grandes entreprises',
  });
  const sme = candidate('sme.example', 'Automatisation métier et intégration');
  sme.facts.push({
    ...sme.facts[0]!,
    id: 'sme-target',
    dimension: 'target',
    value: 'PME',
    quote: 'PME',
  });
  assert.equal(
    rankResearchCandidates([enterprise, sme], profile)[0]?.id,
    sme.id,
    'documented audience fit prioritizes a comparable offer, without excluding others',
  );
  assert.equal(rankResearchCandidates([enterprise, sme], profile).length, 2);
});

test('bounded digests include comparison dimensions before repeated offer copy and preserve exact quotations', () => {
  const repeated = Array.from({ length: 12 }, (_, i) => ({
    id: `offer-${i}`,
    pageId: 'p',
    quality: 'vendor_claim' as const,
    offer: 'Produit',
    dimension: 'offer' as const,
    value: 'Description',
    quote: 'Citation exacte.',
  }));
  const price = {
    ...repeated[0]!,
    id: 'price',
    dimension: 'price' as const,
    value: '90 EUR/utilisateur/mois',
  };
  const target = { ...repeated[0]!, id: 'target', dimension: 'target' as const, value: 'PME' };
  const facts = [...repeated, price, target];
  const digest = researchFactsForDigest(facts);
  assert.deepEqual(
    digest.slice(0, 3).map((f) => f.id),
    ['offer-0', 'target', 'price'],
  );
  assert.equal(digest.length, facts.length);
  assert.ok(
    digest.every((f) => facts.some((original) => original === f)),
    'no invented or rewritten evidence',
  );
});
