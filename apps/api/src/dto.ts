import type { ConnectorRegistry } from '@ulysse/connectors';
import type {
  Analysis,
  AuditEvent,
  CompanyContext,
  Connection,
  Doctrine,
  EvidenceLink,
  Member,
  Opportunity,
  RecommendationSummary,
  SyncRun,
} from '@ulysse/domain';

/** Connection DTO: credential references and cursors never leave the server. */
export function connectionDto(c: Connection, registry: ConnectorRegistry) {
  return {
    id: c.id,
    provider: c.provider,
    kind: registry.get(c.provider)?.definition.kind ?? ('live' as const),
    displayName: c.displayName,
    status: c.status,
    config: c.config,
    grantedScopes: [...c.grantedScopes],
    syncIntervalMinutes: c.syncIntervalMinutes,
    lastSyncStartedAt: c.lastSyncStartedAt,
    lastSuccessAt: c.lastSuccessAt,
    dataAsOf: c.dataAsOf,
    lastErrorCode: c.lastErrorCode,
    lastErrorAt: c.lastErrorAt,
    consecutiveFailures: c.consecutiveFailures,
    nextSyncAt: c.nextSyncAt,
    createdAt: c.createdAt,
    revokedAt: c.revokedAt,
  };
}

export function syncRunDto(r: SyncRun) {
  return {
    id: r.id,
    trigger: r.trigger,
    status: r.status,
    startedAt: r.startedAt,
    completedAt: r.completedAt,
    pages: r.pages,
    seen: r.seen,
    created: r.created,
    revised: r.revised,
    unchanged: r.unchanged,
    deleted: r.deleted,
    stale: r.stale,
    rejected: r.rejected,
    errorCode: r.errorCode,
    errorDetail: r.errorDetail,
  };
}

export function recommendationDto(r: RecommendationSummary) {
  return {
    id: r.id,
    subject: { ...r.subject },
    kind: r.kind,
    ruleId: r.ruleId,
    ruleVersion: r.ruleVersion,
    doctrine: { ...r.doctrine },
    contextVersion: r.contextVersion,
    analysisId: r.analysisId,
    status: r.status,
    effectiveStatus: r.effectiveStatus,
    revision: r.revision,
    contentRevision: r.contentRevision,
    priority: { score: r.priority.score, reasons: r.priority.reasons.map((x) => ({ ...x })) },
    title: r.title,
    whyNow: r.whyNow,
    proposedAction: r.proposedAction,
    assumptions: [...r.assumptions],
    missingInformation: [...r.missingInformation],
    formulation: r.formulation,
    generatedAt: r.generatedAt,
    expiresAt: r.expiresAt,
    dataAsOf: r.dataAsOf,
    maxSourceAgeHours: r.maxSourceAgeHours,
    closedAt: r.closedAt,
    closedReason: r.closedReason,
    supersedesId: r.supersedesId,
    supersededById: r.supersededById,
    updatedAt: r.updatedAt,
  };
}

export function evidenceDto(e: EvidenceLink) {
  return {
    id: e.id,
    factType: e.factType,
    label: e.label,
    state: e.state,
    value: e.value,
    locator: e.locator,
    material: e.material,
    sourceRevision: e.sourceRevision,
    connectionId: e.connectionId,
    sourceAvailable: e.factId !== '',
    observedAt: e.observedAt,
    sourceModifiedAt: e.sourceModifiedAt,
  };
}

export function auditDto(e: AuditEvent, names: ReadonlyMap<string, string>) {
  return {
    id: e.id,
    actorType: e.actorType,
    actorId: e.actorId,
    actorName: e.actorType === 'user' ? (names.get(e.actorId) ?? null) : `Service ${e.actorId}`,
    eventType: e.eventType,
    resourceType: e.resourceType,
    resourceId: e.resourceId,
    revision: e.revision,
    correlationId: e.correlationId,
    metadata: { ...e.metadata },
    createdAt: e.createdAt,
  };
}

export function opportunityDto(o: Opportunity) {
  const { name, stage, commercial, ...rest } = o.fields;
  return {
    id: o.id,
    connectionId: o.connectionId,
    externalId: o.externalId,
    revision: o.revision,
    name,
    stage,
    fields: Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, { ...v }])),
    ...(commercial ? { commercial } : {}),
    sourceModifiedAt: o.sourceModifiedAt,
    observedAt: o.observedAt,
    deletedAt: o.deletedAt,
  };
}

export function doctrineDto(d: Doctrine) {
  return {
    id: d.id,
    key: d.key,
    version: d.version,
    status: d.status,
    title: d.title,
    origin: d.origin,
    usageRights: d.usageRights,
    content: {
      rules: d.content.rules.map((r) => ({
        ruleId: r.ruleId,
        enabled: r.enabled,
        parameters: { ...r.parameters },
      })),
      policy: { ...d.content.policy },
    },
    contentHash: d.contentHash,
    createdBy: d.createdBy,
    createdAt: d.createdAt,
    validatedBy: d.validatedBy,
    validatedAt: d.validatedAt,
    validationNote: d.validationNote,
    retiredAt: d.retiredAt,
  };
}

export function contextDto(c: CompanyContext) {
  return {
    id: c.id,
    version: c.version,
    content: {
      activity: c.content.activity,
      offers: [...c.content.offers],
      objectives: [...c.content.objectives],
      targetSegments: [...c.content.targetSegments],
      constraints: [...c.content.constraints],
      salesProcess: c.content.salesProcess,
    },
    source: c.source,
    note: c.note,
    createdBy: c.createdBy,
    createdAt: c.createdAt,
  };
}

export function memberDto(m: Member) {
  return {
    userId: m.userId,
    displayName: m.displayName,
    email: m.email,
    role: m.role,
    status: m.status,
    updatedAt: m.updatedAt,
    revokedAt: m.revokedAt,
  };
}

export function analysisDto(a: Analysis) {
  return {
    id: a.id,
    trigger: a.trigger,
    status: a.status,
    doctrineId: a.doctrineId,
    doctrineVersion: a.doctrineVersion,
    ruleVersions: { ...a.ruleVersions },
    contextVersion: a.contextVersion,
    formulation: { ...a.formulation },
    startedAt: a.startedAt,
    completedAt: a.completedAt,
    evaluated: a.evaluated,
    generated: a.generated,
    unchanged: a.unchanged,
    closed: a.closed,
    abstentions: { ...a.abstentions },
    usage: a.usage ? { ...a.usage } : null,
    errorCode: a.errorCode,
  };
}
