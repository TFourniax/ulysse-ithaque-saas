/**
 * FICTIONAL development data. Companies, people, opportunities and amounts are
 * invented; they illustrate the product and exercise edge cases (missing fields,
 * explicit nulls, same external id in two tenants). Not customer data.
 */
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();
const daysAhead = (n: number) => new Date(Date.now() + n * DAY).toISOString();

export type FixturePerson = Readonly<{
  subject: string;
  username: string;
  email: string;
  displayName: string;
  memberships: ReadonlyArray<readonly ['acme' | 'globex', 'owner' | 'reviewer' | 'viewer']>;
}>;

/** Subjects match the fixed user ids of infra/keycloak/ulysse-realm.json. */
export const PEOPLE: readonly FixturePerson[] = [
  {
    subject: '0b9f8a10-0000-4000-8000-00000000a001',
    username: 'alice',
    email: 'alice.owner@acme.example',
    displayName: 'Alice Martin (fictive)',
    memberships: [['acme', 'owner']],
  },
  {
    subject: '0b9f8a10-0000-4000-8000-00000000a002',
    username: 'bruno',
    email: 'bruno.reviewer@acme.example',
    displayName: 'Bruno Leroy (fictif)',
    memberships: [['acme', 'reviewer']],
  },
  {
    subject: '0b9f8a10-0000-4000-8000-00000000a003',
    username: 'vera',
    email: 'vera.viewer@acme.example',
    displayName: 'Vera Petit (fictive)',
    memberships: [['acme', 'viewer']],
  },
  {
    subject: '0b9f8a10-0000-4000-8000-00000000b001',
    username: 'gina',
    email: 'gina.owner@globex.example',
    displayName: 'Gina Moreau (fictive)',
    memberships: [['globex', 'owner']],
  },
  {
    subject: '0b9f8a10-0000-4000-8000-00000000c001',
    username: 'dan',
    email: 'dan.dual@example.test',
    displayName: 'Dan Roux (fictif)',
    memberships: [
      ['acme', 'viewer'],
      ['globex', 'reviewer'],
    ],
  },
];

export const COMPANIES = {
  acme: {
    slug: 'acme-demo',
    name: 'Acme Industrie (fictive)',
    dataset: 'acme-demo',
    segments: ['ETI industrielles'],
  },
  globex: {
    slug: 'globex-demo',
    name: 'Globex Services (fictive)',
    dataset: 'globex-demo',
    segments: ['PME de services'],
  },
} as const;

export function datasetItems(
  dataset: string,
): Array<{ id: string; modifiedAt: string; payload: Record<string, unknown> }> {
  if (dataset === 'acme-demo') {
    return [
      {
        id: 'OPP-001',
        modifiedAt: daysAgo(1),
        payload: {
          id: 'OPP-001',
          title: 'Modernisation atelier — Industries Fictives SA',
          status: 'open',
          last_activity: daysAgo(12),
          next_action: null,
          amount_cents: 4_800_000,
          currency: 'EUR',
          owner: { name: 'Bruno Leroy (fictif)' },
          segment: 'ETI industrielles',
        },
      },
      {
        id: 'OPP-002',
        modifiedAt: daysAgo(2),
        payload: {
          id: 'OPP-002',
          title: 'Contrat de maintenance — Démo Logistique',
          status: 'open',
          last_activity: daysAgo(8),
          next_action: { label: 'Envoyer la proposition révisée', due: daysAgo(5) },
          amount_cents: 1_250_000,
          currency: 'EUR',
          owner: { name: 'Alice Martin (fictive)' },
          segment: 'PME de services',
        },
      },
      {
        id: 'OPP-003',
        modifiedAt: daysAgo(1),
        payload: {
          id: 'OPP-003',
          title: 'Extension de licences — Exemple Santé',
          status: 'open',
          last_activity: daysAgo(2),
          next_action: { label: 'Démonstration planifiée', due: daysAhead(3) },
          amount_cents: 900_000,
          currency: 'EUR',
          owner: { name: 'Bruno Leroy (fictif)' },
          segment: 'ETI industrielles',
        },
      },
      {
        id: 'OPP-004',
        modifiedAt: daysAgo(3),
        payload: {
          id: 'OPP-004',
          title: 'Audit énergétique — Société Imaginaire',
          status: 'won',
          last_activity: daysAgo(3),
          next_action: null,
          amount_cents: 300_000,
          currency: 'EUR',
          owner: { name: 'Alice Martin (fictive)' },
        },
      },
      {
        id: 'OPP-005',
        modifiedAt: daysAgo(4),
        // No last_activity key: the source does not expose it → explicit abstention.
        payload: {
          id: 'OPP-005',
          title: 'Pilote IoT — Prototype & Cie',
          status: 'open',
          next_action: null,
          owner: { name: 'Bruno Leroy (fictif)' },
        },
      },
      {
        id: 'OPP-006',
        modifiedAt: daysAgo(1),
        payload: {
          id: 'OPP-006',
          title: 'Renouvellement — Client Témoin',
          status: 'on_hold',
          last_activity: daysAgo(30),
          next_action: null,
          amount_cents: null,
          owner: null,
          segment: 'ETI industrielles',
        },
      },
    ];
  }
  if (dataset === 'globex-demo') {
    return [
      {
        id: 'OPP-001',
        modifiedAt: daysAgo(1),
        payload: {
          id: 'OPP-001',
          title: 'Déploiement CRM — Globex fictive',
          status: 'open',
          last_activity: daysAgo(9),
          next_action: null,
          amount_cents: 2_000_000,
          currency: 'EUR',
          owner: { name: 'Gina Moreau (fictive)' },
          segment: 'PME de services',
        },
      },
      {
        id: 'OPP-002',
        modifiedAt: daysAgo(6),
        payload: {
          id: 'OPP-002',
          title: 'Formation équipe — Exemple Conseil',
          status: 'lost',
          last_activity: daysAgo(20),
          next_action: null,
          amount_cents: 450_000,
          currency: 'EUR',
          owner: { name: 'Gina Moreau (fictive)' },
        },
      },
    ];
  }
  return [];
}
