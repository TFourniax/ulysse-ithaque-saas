import { ensure } from './errors.ts';
import type { CommercialData } from './commercial.ts';
import { validateCommercialData } from './commercial.ts';
import { fingerprintOf } from './hash.ts';
import { isInstant, parseInstant } from './time.ts';

/**
 * Distinguishes a value the source returned (`present`), an explicit empty value
 * (`empty`, e.g. the CRM field exists and is blank) and information the
 * connector cannot know (`unavailable`: field not exposed, not granted, or not
 * part of the provider's model). Rules must never treat `unavailable` as empty.
 */
export type FieldValue<T> =
  | Readonly<{ state: 'present'; value: T }>
  | Readonly<{ state: 'empty' }>
  | Readonly<{ state: 'unavailable' }>;

export const present = <T>(value: T): FieldValue<T> => ({ state: 'present', value });
export const empty: FieldValue<never> = Object.freeze({ state: 'empty' });
export const unavailable: FieldValue<never> = Object.freeze({ state: 'unavailable' });

export const STAGES = ['open', 'won', 'lost'] as const;
export type Stage = (typeof STAGES)[number];

/** Decimal amount kept as a string (never a float) with an ISO 4217 currency. */
export type Money = Readonly<{ amount: string; currency: string }>;

export type OpportunityFields = Readonly<{
  name: string;
  stage: Stage;
  lastInteractionAt: FieldValue<string>;
  nextStep: FieldValue<string>;
  nextStepDueAt: FieldValue<string>;
  amount: FieldValue<Money>;
  ownerName: FieldValue<string>;
  segment: FieldValue<string>;
  commercial?: CommercialData;
}>;

/** Connector output after normalization; provider identifiers stay distinct from internal IDs. */
export type NormalizedRecord = Readonly<{
  entityType: 'opportunity';
  externalId: string;
  /** Opaque provider version (string, number or timestamp rendered as text). */
  providerVersion: string | null;
  etag: string | null;
  sourceModifiedAt: string | null;
  deleted: boolean;
  fields: OpportunityFields | null;
}>;

export type Opportunity = Readonly<{
  tenantId: string;
  id: string;
  connectionId: string;
  externalId: string;
  sourceRecordId: string;
  /** Normalized monotonic revision established by Ulysse (not the provider version). */
  revision: number;
  fields: OpportunityFields;
  sourceModifiedAt: string | null;
  observedAt: string;
  ingestedAt: string;
  deletedAt: string | null;
}>;

export type SourceHead = Readonly<{
  sourceRecordId: string;
  revision: number;
  contentHash: string;
  providerVersion: string | null;
  sourceModifiedAt: string | null;
  observedAt: string;
  deletedAt: string | null;
}>;

export type SourceChange =
  | Readonly<{ kind: 'create'; revision: 1; contentHash: string }>
  | Readonly<{ kind: 'revise'; revision: number; contentHash: string; restored: boolean }>
  | Readonly<{ kind: 'unchanged' }>
  | Readonly<{ kind: 'stale' }>
  | Readonly<{ kind: 'delete'; revision: number }>
  | Readonly<{ kind: 'ignore_delete' }>;

const MAX_TEXT = 2000;
const MAX_ID = 200;
const CLOCK_SKEW_MS = 5 * 60_000;

function text(value: unknown, max = MAX_TEXT): value is string {
  return typeof value === 'string' && value.length <= max;
}

function nonblank(value: unknown, max = MAX_ID): value is string {
  return text(value, max) && value.trim().length > 0;
}

function field<T>(value: unknown, check: (v: unknown) => v is T, name: string): FieldValue<T> {
  ensure(typeof value === 'object' && value !== null, 'INVALID_INPUT', name);
  const candidate = value as { state?: unknown; value?: unknown };
  if (candidate.state === 'empty') return empty;
  if (candidate.state === 'unavailable') return unavailable;
  ensure(candidate.state === 'present' && check(candidate.value), 'INVALID_INPUT', name);
  return present(candidate.value);
}

const isMoney = (v: unknown): v is Money =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as Money).amount === 'string' &&
  /^-?\d{1,15}(\.\d{1,4})?$/.test((v as Money).amount) &&
  typeof (v as Money).currency === 'string' &&
  /^[A-Z]{3}$/.test((v as Money).currency);

/** Projects known fields only: arbitrary raw payload members are dropped. */
export function validateFields(input: unknown): OpportunityFields {
  ensure(typeof input === 'object' && input !== null, 'INVALID_INPUT', 'fields');
  const raw = input as Record<string, unknown>;
  ensure(nonblank(raw.name, 300), 'INVALID_INPUT', 'name');
  ensure((STAGES as readonly unknown[]).includes(raw.stage), 'INVALID_INPUT', 'stage');
  const fields: OpportunityFields = {
    name: raw.name,
    stage: raw.stage as Stage,
    lastInteractionAt: field(raw.lastInteractionAt, isInstant, 'lastInteractionAt'),
    nextStep: field(raw.nextStep, (v): v is string => nonblank(v, MAX_TEXT), 'nextStep'),
    nextStepDueAt: field(raw.nextStepDueAt, isInstant, 'nextStepDueAt'),
    amount: field(raw.amount, isMoney, 'amount'),
    ownerName: field(raw.ownerName, (v): v is string => nonblank(v, 200), 'ownerName'),
    segment: field(raw.segment, (v): v is string => nonblank(v, 100), 'segment'),
    ...(raw.commercial === undefined ? {} : { commercial: validateCommercialData(raw.commercial) }),
  };
  return fields;
}

export function validateNormalizedRecord(input: unknown): NormalizedRecord {
  ensure(typeof input === 'object' && input !== null, 'INVALID_INPUT', 'record');
  const raw = input as Record<string, unknown>;
  ensure(raw.entityType === 'opportunity', 'INVALID_INPUT', 'entityType');
  ensure(nonblank(raw.externalId), 'INVALID_INPUT', 'externalId');
  ensure(raw.providerVersion === null || nonblank(raw.providerVersion), 'INVALID_VERSION');
  ensure(raw.etag === null || nonblank(raw.etag, 500), 'INVALID_INPUT', 'etag');
  ensure(raw.sourceModifiedAt === null || isInstant(raw.sourceModifiedAt), 'INVALID_TIMESTAMP');
  ensure(typeof raw.deleted === 'boolean', 'INVALID_INPUT', 'deleted');
  const fields = raw.deleted ? null : validateFields(raw.fields);
  return {
    entityType: 'opportunity',
    externalId: raw.externalId,
    providerVersion: raw.providerVersion,
    etag: raw.etag,
    sourceModifiedAt: raw.sourceModifiedAt,
    deleted: raw.deleted,
    fields,
  };
}

/** Hash of business content only; provider metadata (etag, version) does not create a revision. */
export function contentHash(fields: OpportunityFields): string {
  return fingerprintOf(fields);
}

/**
 * Pure ingestion policy shared by every storage adapter.
 * - identical content → `unchanged` (observation is refreshed, no new revision);
 * - older provider modification date → `stale` (out-of-order page, ignored);
 * - same provider version with different content → SOURCE_VERSION_CONFLICT;
 * - deletion → tombstone revision.
 */
export function planSourceChange(
  head: SourceHead | null,
  incoming: NormalizedRecord,
  observedAt: string,
  now: number,
): SourceChange {
  const observedMs = parseInstant(observedAt);
  ensure(observedMs <= now + CLOCK_SKEW_MS, 'FUTURE_SOURCE');
  if (incoming.sourceModifiedAt !== null) {
    ensure(parseInstant(incoming.sourceModifiedAt) <= observedMs + CLOCK_SKEW_MS, 'FUTURE_SOURCE');
  }
  if (head !== null) {
    ensure(observedMs >= parseInstant(head.observedAt), 'SOURCE_TIME_REGRESSION');
    if (
      head.sourceModifiedAt !== null &&
      incoming.sourceModifiedAt !== null &&
      parseInstant(incoming.sourceModifiedAt) < parseInstant(head.sourceModifiedAt)
    ) {
      return { kind: 'stale' };
    }
  }
  if (incoming.deleted) {
    if (head === null || head.deletedAt !== null) return { kind: 'ignore_delete' };
    return { kind: 'delete', revision: head.revision + 1 };
  }
  ensure(incoming.fields !== null, 'INVALID_INPUT', 'fields');
  const hash = contentHash(incoming.fields);
  if (head === null) return { kind: 'create', revision: 1, contentHash: hash };
  if (head.deletedAt === null && head.contentHash === hash) return { kind: 'unchanged' };
  if (
    head.deletedAt === null &&
    head.providerVersion !== null &&
    incoming.providerVersion !== null &&
    head.providerVersion === incoming.providerVersion
  ) {
    ensure(false, 'SOURCE_VERSION_CONFLICT', incoming.externalId);
  }
  return {
    kind: 'revise',
    revision: head.revision + 1,
    contentHash: hash,
    restored: head.deletedAt !== null,
  };
}

export const FACT_TYPES = [
  'name',
  'stage',
  'last_interaction_at',
  'next_step',
  'next_step_due_at',
  'amount',
  'owner_name',
  'segment',
  'commercial_context',
] as const;
export type FactType = (typeof FACT_TYPES)[number];

export type FactValue = Readonly<{
  factType: FactType;
  state: FieldValue<unknown>['state'];
  value: unknown;
  /** Path of the normalized field; never a raw payload excerpt. */
  locator: string;
}>;

function asFact(factType: FactType, locator: string, v: FieldValue<unknown>): FactValue {
  return { factType, locator, state: v.state, value: v.state === 'present' ? v.value : null };
}

/** Citable facts derived from one normalized revision. */
export function factsOf(fields: OpportunityFields): FactValue[] {
  return [
    asFact('name', 'fields.name', present(fields.name)),
    asFact('stage', 'fields.stage', present(fields.stage)),
    asFact('last_interaction_at', 'fields.lastInteractionAt', fields.lastInteractionAt),
    asFact('next_step', 'fields.nextStep', fields.nextStep),
    asFact('next_step_due_at', 'fields.nextStepDueAt', fields.nextStepDueAt),
    asFact('amount', 'fields.amount', fields.amount),
    asFact('owner_name', 'fields.ownerName', fields.ownerName),
    asFact('segment', 'fields.segment', fields.segment),
    ...(fields.commercial === undefined ? [] : [asFact('commercial_context', 'fields.commercial', present(fields.commercial))]),
  ];
}
