/**
 * HTTP contracts of the v1 API, shared by the API (validation, serialization,
 * OpenAPI) and the web client. Response schemas are allow-lists: fields not
 * declared here are stripped before leaving the server (e.g. credential references).
 */
import { z } from 'zod';

export const API_VERSION = '1.0.0';

const uuid = z.uuid();
const instant = z.iso.datetime({ offset: false });
const nullableInstant = instant.nullable();

export const ErrorCode = z.enum([
  'UNAUTHENTICATED',
  'CSRF',
  'NO_ACTIVE_TENANT',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION',
  'CONFLICT',
  'REVISION_CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'ALREADY_DECIDED',
  'STALE_EVIDENCE',
  'EXPIRED',
  'INVALID_TRANSITION',
  'CONNECTION_INACTIVE',
  'DOCTRINE_NOT_VALIDATED',
  'DOCTRINE_RIGHTS',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'UNAVAILABLE',
  'INTERNAL',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ErrorBody = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    correlationId: z.string(),
    detail: z.string().optional(),
  }),
});
export type ErrorBody = z.infer<typeof ErrorBody>;

export const Role = z.enum(['owner', 'reviewer', 'viewer']);

export const Me = z.object({
  user: z.object({ id: uuid, displayName: z.string(), email: z.string().nullable() }),
  tenants: z.array(z.object({ id: uuid, slug: z.string(), name: z.string(), role: Role })),
  activeTenant: z
    .object({
      id: uuid,
      slug: z.string(),
      name: z.string(),
      role: Role,
      permissions: z.array(z.string()),
    })
    .nullable(),
  csrfToken: z.string(),
  session: z.object({ expiresAt: instant, idleExpiresAt: instant }),
});
export type Me = z.infer<typeof Me>;

export const SelectTenantBody = z.object({ tenantId: uuid });

const PriorityReason = z.object({ label: z.string(), points: z.number() });

export const RecommendationStatus = z.enum([
  'draft',
  'pending',
  'approved',
  'rejected',
  'expired',
  'superseded',
]);

export const RecommendationSummary = z.object({
  id: uuid,
  subject: z.object({
    type: z.literal('opportunity'),
    id: uuid,
    externalId: z.string(),
    label: z.string(),
    connectionId: uuid,
  }),
  kind: z.string(),
  ruleId: z.string(),
  ruleVersion: z.string(),
  doctrine: z.object({
    id: uuid,
    key: z.string(),
    version: z.number().int(),
    origin: z.string(),
    fictional: z.boolean(),
  }),
  contextVersion: z.number().int().nullable(),
  analysisId: uuid,
  status: RecommendationStatus,
  effectiveStatus: RecommendationStatus,
  revision: z.number().int(),
  contentRevision: z.number().int(),
  priority: z.object({ score: z.number().int(), reasons: z.array(PriorityReason) }),
  title: z.string(),
  whyNow: z.string(),
  proposedAction: z.string(),
  assumptions: z.array(z.string()),
  missingInformation: z.array(z.string()),
  formulation: z.enum(['template', 'model']),
  generatedAt: instant,
  expiresAt: instant,
  dataAsOf: instant,
  maxSourceAgeHours: z.number(),
  closedAt: nullableInstant,
  closedReason: z.string().nullable(),
  supersedesId: uuid.nullable(),
  supersededById: uuid.nullable(),
  updatedAt: instant,
});
export type RecommendationSummary = z.infer<typeof RecommendationSummary>;

export const Evidence = z.object({
  id: uuid,
  factType: z.string(),
  label: z.string(),
  state: z.enum(['present', 'empty', 'unavailable']),
  value: z.unknown(),
  locator: z.string(),
  material: z.boolean(),
  sourceRevision: z.number().int(),
  connectionId: uuid,
  sourceAvailable: z.boolean(),
  observedAt: instant,
  sourceModifiedAt: nullableInstant,
});

export const AuditEntry = z.object({
  id: uuid,
  actorType: z.enum(['user', 'service']),
  actorId: z.string(),
  actorName: z.string().nullable(),
  eventType: z.string(),
  resourceType: z.string(),
  resourceId: z.string(),
  revision: z.number().int().nullable(),
  correlationId: z.string(),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  createdAt: instant,
});
export type AuditEntry = z.infer<typeof AuditEntry>;

export const RecommendationDetail = z.object({
  recommendation: RecommendationSummary,
  evidence: z.array(Evidence),
  evidenceState: z.enum(['current', 'changed', 'stale', 'connection_inactive', 'doctrine_changed']),
  revisions: z.array(
    z.object({
      contentRevision: z.number().int(),
      proposedAction: z.string(),
      note: z.string().nullable(),
      createdBy: uuid.nullable(),
      createdAt: instant,
    }),
  ),
  decisions: z.array(
    z.object({
      id: uuid,
      revision: z.number().int(),
      contentRevision: z.number().int(),
      actorId: uuid,
      decision: z.enum(['approve', 'reject']),
      reason: z.string().nullable(),
      createdAt: instant,
    }),
  ),
  history: z.array(AuditEntry),
  permissions: z.object({ canDecide: z.boolean(), canRevise: z.boolean() }),
});
export type RecommendationDetail = z.infer<typeof RecommendationDetail>;

export const ListQuery = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const RecommendationListQuery = ListQuery.extend({
  view: z.enum(['open', 'decided', 'closed', 'all']).optional(),
  kind: z.string().max(64).optional(),
});

export function pageOf<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}

export const RecommendationPage = pageOf(RecommendationSummary);

export const DecisionBody = z.object({
  decision: z.enum(['approve', 'reject']),
  expectedRevision: z.number().int().positive(),
  reason: z.string().max(1000).nullable().optional(),
});
export type DecisionBody = z.infer<typeof DecisionBody>;

export const RevisionBody = z.object({
  expectedRevision: z.number().int().positive(),
  proposedAction: z.string().min(1).max(4000),
  note: z.string().max(1000).nullable().optional(),
  submit: z.boolean(),
});
export type RevisionBody = z.infer<typeof RevisionBody>;

export const MutationResult = z.object({
  recommendation: RecommendationSummary,
  replayed: z.boolean(),
});

export const IdempotencyHeaders = z.object({
  'idempotency-key': z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/),
});

export const Connection = z.object({
  id: uuid,
  provider: z.string(),
  kind: z.enum(['fixture', 'live']),
  displayName: z.string(),
  status: z.enum(['active', 'paused', 'error', 'revoked']),
  config: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  grantedScopes: z.array(z.string()),
  syncIntervalMinutes: z.number().int(),
  lastSyncStartedAt: nullableInstant,
  lastSuccessAt: nullableInstant,
  dataAsOf: nullableInstant,
  lastErrorCode: z.string().nullable(),
  lastErrorAt: nullableInstant,
  consecutiveFailures: z.number().int(),
  nextSyncAt: nullableInstant,
  createdAt: instant,
  revokedAt: nullableInstant,
});
export type Connection = z.infer<typeof Connection>;

export const CreateConnectionBody = z.object({
  provider: z.string().max(64),
  displayName: z.string().min(1).max(120),
  config: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  syncIntervalMinutes: z.number().int().min(5).max(10080).optional(),
});

export const SyncRequestBody = z.object({ replay: z.boolean().optional() });

export const SyncRun = z.object({
  id: uuid,
  trigger: z.string(),
  status: z.enum(['running', 'succeeded', 'failed', 'cancelled']),
  startedAt: instant,
  completedAt: nullableInstant,
  pages: z.number().int(),
  seen: z.number().int(),
  created: z.number().int(),
  revised: z.number().int(),
  unchanged: z.number().int(),
  deleted: z.number().int(),
  stale: z.number().int(),
  rejected: z.number().int(),
  errorCode: z.string().nullable(),
  errorDetail: z.string().nullable(),
});

const FieldState = z.object({
  state: z.enum(['present', 'empty', 'unavailable']),
  value: z.unknown().optional(),
});

export const Opportunity = z.object({
  id: uuid,
  connectionId: uuid,
  externalId: z.string(),
  revision: z.number().int(),
  name: z.string(),
  stage: z.enum(['open', 'won', 'lost']),
  fields: z.record(z.string(), z.union([FieldState, z.string()])),
  sourceModifiedAt: nullableInstant,
  observedAt: instant,
  deletedAt: nullableInstant,
});
export const OpportunityPage = pageOf(Opportunity);

export const AuditPage = pageOf(AuditEntry);

export const Doctrine = z.object({
  id: uuid,
  key: z.string(),
  version: z.number().int(),
  status: z.enum(['draft', 'validated', 'retired']),
  title: z.string(),
  origin: z.enum(['fixture', 'customer', 'licensed']),
  usageRights: z.enum(['demo-only', 'tenant-internal', 'licensed-shared']),
  content: z.object({
    rules: z.array(
      z.object({
        ruleId: z.string(),
        enabled: z.boolean(),
        parameters: z.record(z.string(), z.number()),
      }),
    ),
    policy: z.object({
      maxSourceAgeHours: z.number(),
      recommendationLifetimeHours: z.number(),
      maxOpenRecommendations: z.number(),
      rejectionCooldownDays: z.number(),
    }),
  }),
  contentHash: z.string(),
  createdBy: uuid.nullable(),
  createdAt: instant,
  validatedBy: uuid.nullable(),
  validatedAt: nullableInstant,
  validationNote: z.string().nullable(),
  retiredAt: nullableInstant,
});

export const DraftDoctrineBody = z.object({
  key: z.string().max(64),
  title: z.string().min(1).max(200),
  origin: z.enum(['fixture', 'customer', 'licensed']),
  usageRights: z.enum(['demo-only', 'tenant-internal', 'licensed-shared']),
  content: z.unknown(),
});

export const ValidateDoctrineBody = z.object({ note: z.string().max(2000).nullable().optional() });

export const RuleCatalogEntry = z.object({
  id: z.string(),
  version: z.string(),
  kind: z.string(),
  label: z.string(),
  fictional: z.boolean(),
  parameters: z.array(
    z.object({ name: z.string(), min: z.number(), max: z.number(), integer: z.boolean() }),
  ),
});

export const CompanyContextContent = z.object({
  activity: z.string().max(4000),
  offers: z.array(z.string().max(300)).max(30),
  objectives: z.array(z.string().max(300)).max(30),
  targetSegments: z.array(z.string().max(300)).max(30),
  constraints: z.array(z.string().max(300)).max(30),
  salesProcess: z.string().max(4000),
});

export const CompanyContext = z.object({
  id: uuid,
  version: z.number().int(),
  content: CompanyContextContent,
  source: z.enum(['manual', 'fixture']),
  note: z.string().nullable(),
  createdBy: uuid.nullable(),
  createdAt: instant,
});

export const UpdateContextBody = z.object({
  content: CompanyContextContent,
  note: z.string().max(1000).nullable().optional(),
});

export const Member = z.object({
  userId: uuid,
  displayName: z.string(),
  email: z.string().nullable(),
  role: Role,
  status: z.enum(['active', 'revoked']),
  updatedAt: instant,
  revokedAt: nullableInstant,
});

export const ChangeRoleBody = z.object({ role: Role });

export const Analysis = z.object({
  id: uuid,
  trigger: z.string(),
  status: z.enum(['completed', 'failed', 'skipped']),
  doctrineId: uuid.nullable(),
  doctrineVersion: z.number().int().nullable(),
  ruleVersions: z.record(z.string(), z.string()),
  contextVersion: z.number().int().nullable(),
  formulation: z.object({
    provider: z.string(),
    model: z.string().nullable(),
    promptVersion: z.string().nullable(),
  }),
  startedAt: instant,
  completedAt: instant,
  evaluated: z.number().int(),
  generated: z.number().int(),
  unchanged: z.number().int(),
  closed: z.number().int(),
  abstentions: z.record(z.string(), z.number()),
  usage: z
    .object({
      inputTokens: z.number(),
      outputTokens: z.number(),
      costUsd: z.number().nullable(),
      calls: z.number(),
      failures: z.number(),
    })
    .nullable(),
  errorCode: z.string().nullable(),
});

export const IdParam = z.object({ id: uuid });
export const UserIdParam = z.object({ userId: uuid });

export const Health = z.object({
  status: z.enum(['ok', 'unavailable']),
  checks: z.record(z.string(), z.enum(['ok', 'failed'])),
});

export type OpportunityDto = z.infer<typeof Opportunity>;
export type DoctrineDto = z.infer<typeof Doctrine>;
export type MemberDto = z.infer<typeof Member>;
export type AnalysisDto = z.infer<typeof Analysis>;
export type SyncRunDto = z.infer<typeof SyncRun>;
export type CompanyContextDto = z.infer<typeof CompanyContext>;
export type CompanyContextContentDto = z.infer<typeof CompanyContextContent>;
export type RuleCatalogEntryDto = z.infer<typeof RuleCatalogEntry>;
export type EvidenceDto = z.infer<typeof Evidence>;
export type RecommendationPageDto = z.infer<typeof RecommendationPage>;

export type ConnectorInfo = {
  provider: string;
  displayName: string;
  kind: 'fixture' | 'live';
  scopes: string[];
  authorization: string;
  capabilities: Record<string, unknown>;
  fields: Record<string, { source: string; meaning: string; unit?: string }>;
};
