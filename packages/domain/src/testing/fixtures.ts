import type { Context, Role, ServiceScope } from '../context.ts';
import type { DraftDoctrineInput } from '../services/governance.ts';
import type { ConnectorCatalog } from '../services/connections.ts';
import { ensure } from '../errors.ts';
import type { NormalizedRecord, OpportunityFields } from '../opportunity.ts';
import { empty, present, unavailable } from '../opportunity.ts';

/**
 * FICTIONAL test doctrine. Thresholds are technical examples chosen for tests
 * and demos; they are not Néreis/Odyssée doctrine and carry no business validation.
 */
export const FIXTURE_DOCTRINE: DraftDoctrineInput = {
  key: 'fixture-commercial-hygiene',
  title: 'Doctrine de démonstration (fictive) — hygiène du pipeline',
  origin: 'fixture',
  usageRights: 'demo-only',
  content: {
    rules: [
      { ruleId: 'fixture.stalled-opportunity', enabled: true, parameters: { inactivityDays: 7 } },
      { ruleId: 'fixture.overdue-next-step', enabled: true, parameters: { graceDays: 2 } },
    ],
    policy: {
      maxSourceAgeHours: 24,
      recommendationLifetimeHours: 72,
      maxOpenRecommendations: 20,
      rejectionCooldownDays: 14,
    },
  },
};

export const FIXTURE_CONTEXT = {
  activity: 'Entreprise fictive de services B2B utilisée pour les démonstrations.',
  offers: ['Offre fictive A', 'Offre fictive B'],
  objectives: ['Objectif fictif : ne laisser aucune opportunité ouverte sans prochaine étape.'],
  targetSegments: ['ETI industrielles'],
  constraints: ['Données fictives uniquement.'],
  salesProcess: 'Processus fictif : qualification, proposition, négociation, clôture.',
};

export const fixtureCatalog: ConnectorCatalog = {
  describe(provider) {
    if (provider !== 'fixture-crm') return null;
    return {
      provider: 'fixture-crm',
      kind: 'fixture',
      scopes: ['opportunities:read'],
      defaultSyncIntervalMinutes: 15,
      validateConfig(config) {
        ensure(typeof config === 'object' && config !== null, 'INVALID_INPUT', 'config');
        const dataset = (config as { dataset?: unknown }).dataset;
        ensure(
          typeof dataset === 'string' && /^[a-z0-9-]{1,40}$/.test(dataset),
          'INVALID_INPUT',
          'dataset',
        );
        return { dataset };
      },
    };
  },
};

export function userContext(
  tenantId: string,
  userId: string,
  role: Role,
  correlationId = 'test-correlation',
): Context {
  return { tenantId, actor: { kind: 'user', userId, role }, correlationId };
}

export function serviceContext(
  tenantId: string,
  scopes: readonly ServiceScope[] = [
    'source:ingest',
    'analysis:run',
    'recommendation:maintain',
    'connection:operate',
  ],
  connectionId?: string,
): Context {
  return {
    tenantId,
    actor: {
      kind: 'service',
      serviceId: 'test-worker',
      scopes,
      ...(connectionId ? { connectionId } : {}),
    },
    correlationId: 'test-worker-correlation',
  };
}

export function opportunityFields(overrides: Partial<OpportunityFields> = {}): OpportunityFields {
  return {
    name: 'Opportunité fictive 001',
    stage: 'open',
    lastInteractionAt: present('2026-09-26T14:00:00.000Z'),
    nextStep: empty,
    nextStepDueAt: empty,
    amount: present({ amount: '12000.00', currency: 'EUR' }),
    ownerName: present('Commercial fictif'),
    segment: unavailable,
    ...overrides,
  };
}

export function record(
  externalId: string,
  overrides: Partial<OpportunityFields> = {},
  meta: Partial<Omit<NormalizedRecord, 'fields' | 'externalId'>> = {},
): NormalizedRecord {
  return {
    entityType: 'opportunity',
    externalId,
    providerVersion: null,
    etag: null,
    sourceModifiedAt: '2026-10-06T13:00:00.000Z',
    deleted: false,
    fields: opportunityFields(overrides),
    ...meta,
  };
}

export function tombstone(
  externalId: string,
  sourceModifiedAt = '2026-10-06T13:30:00.000Z',
): NormalizedRecord {
  return {
    entityType: 'opportunity',
    externalId,
    providerVersion: null,
    etag: null,
    sourceModifiedAt,
    deleted: true,
    fields: null,
  };
}
