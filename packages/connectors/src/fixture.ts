import type { FieldValue, NormalizedRecord, OpportunityFields } from '@ulysse/domain';
import { empty, isInstant, present, unavailable, validateNormalizedRecord } from '@ulysse/domain';
import { z } from 'zod';
import type {
  Connector,
  ConnectorContext,
  ConnectorDefinition,
  NormalizationResult,
  PullRequest,
  PullResult,
  RawRecord,
} from './contract.ts';
import { ConnectorError } from './contract.ts';

/**
 * FIXTURE connector: a simulated CRM used for tests and demos. It is NOT an
 * integration with any real provider (and in particular not with Stratégie, whose
 * API contract is still unknown). Its payload shape is deliberately provider-like
 * (cents, nested objects, extra statuses, missing keys) to exercise normalization.
 */
export const FIXTURE_PROVIDER = 'fixture-crm';

/** One item of the simulated provider: the latest state of an opportunity and its change sequence. */
export type FixtureItem = Readonly<{
  seq: number;
  externalId: string;
  version: number;
  modifiedAt: string;
  deleted: boolean;
  payload: unknown;
}>;

export interface FixtureStore {
  /** Items whose change sequence is strictly greater than `afterSeq`, ordered by sequence. */
  changesSince(dataset: string, afterSeq: number, limit: number): Promise<FixtureItem[]>;
  datasetExists(dataset: string): Promise<boolean>;
}

const PayloadSchema = z.object({
  id: z.string().min(1).max(200),
  title: z.string().min(1).max(300),
  status: z.enum(['open', 'on_hold', 'won', 'lost']),
  last_activity: z.string().nullable().optional(),
  next_action: z
    .object({ label: z.string().min(1).max(2000), due: z.string().nullable().optional() })
    .nullable()
    .optional(),
  amount_cents: z.number().int().nonnegative().max(1e15).nullable().optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  owner: z
    .object({ name: z.string().min(1).max(200) })
    .nullable()
    .optional(),
  segment: z.string().min(1).max(100).nullable().optional(),
  commercial: z.unknown().optional(),
});

/**
 * Distinguishes a key absent from the payload (`unavailable`: the provider did not
 * expose it), an explicit null (`empty`) and a value (`present`).
 */
function fieldOf<T>(
  payload: Record<string, unknown>,
  key: string,
  map: (value: unknown) => T | undefined,
): FieldValue<T> {
  if (!(key in payload)) return unavailable;
  const value = payload[key];
  if (value === null || value === undefined) return empty;
  const mapped = map(value);
  return mapped === undefined ? unavailable : present(mapped);
}

function centsToDecimal(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const rest = String(cents % 100).padStart(2, '0');
  return `${String(whole)}.${rest}`;
}

const DEFINITION: ConnectorDefinition = {
  provider: FIXTURE_PROVIDER,
  displayName: 'CRM fictif (fixture)',
  kind: 'fixture',
  capabilities: {
    entities: ['opportunity'],
    pagination: 'cursor',
    incremental: true,
    deletions: 'tombstone',
    versioning: 'version',
    maxPageSize: 100,
    requestsPerMinute: null,
  },
  authorization: { type: 'none', scopes: ['opportunities:read'] },
  defaultSyncIntervalMinutes: 15,
  fields: {
    name: { source: 'title', meaning: "Libellé de l'opportunité" },
    stage: { source: 'status', meaning: 'open et on_hold → open ; won ; lost' },
    lastInteractionAt: {
      source: 'last_activity',
      meaning: 'Dernière activité enregistrée ; null = aucune ; clé absente = non exposée',
    },
    nextStep: { source: 'next_action.label', meaning: 'Prochaine action ; null = aucune' },
    nextStepDueAt: { source: 'next_action.due', meaning: 'Échéance de la prochaine action' },
    amount: {
      source: 'amount_cents + currency',
      meaning: 'Montant estimé',
      unit: 'centimes convertis en décimal',
    },
    ownerName: { source: 'owner.name', meaning: 'Responsable commercial' },
    segment: { source: 'segment', meaning: 'Segment client' },
  },
  validateConfig(config) {
    const parsed = z
      .object({ dataset: z.string().regex(/^[a-z0-9-]{1,40}$/) })
      .strict()
      .safeParse(config);
    if (!parsed.success)
      throw new ConnectorError('misconfigured', 'fixture connector requires { dataset }');
    return { dataset: parsed.data.dataset };
  },
};

export class FixtureConnector implements Connector {
  readonly definition = DEFINITION;
  readonly #store: FixtureStore;

  constructor(store: FixtureStore) {
    this.#store = store;
  }

  #dataset(ctx: ConnectorContext): string {
    const dataset = ctx.config.dataset;
    if (typeof dataset !== 'string') throw new ConnectorError('misconfigured', 'missing dataset');
    return dataset;
  }

  async validateConnection(ctx: ConnectorContext) {
    try {
      const dataset = this.#dataset(ctx);
      if (!(await this.#store.datasetExists(dataset))) {
        return {
          ok: false as const,
          error: new ConnectorError('misconfigured', 'unknown fixture dataset'),
        };
      }
      return { ok: true as const, detail: `fixture dataset ${dataset}` };
    } catch (error) {
      if (error instanceof ConnectorError) return { ok: false as const, error };
      throw error;
    }
  }

  async pullPage(ctx: ConnectorContext, request: PullRequest): Promise<PullResult> {
    if (ctx.signal.aborted) throw new ConnectorError('transient', 'aborted');
    const afterSeq = request.cursor === null ? 0 : Number(request.cursor);
    if (!Number.isSafeInteger(afterSeq) || afterSeq < 0)
      throw new ConnectorError('invalid_cursor', 'malformed cursor');
    const limit = Math.min(Math.max(request.pageSize, 1), DEFINITION.capabilities.maxPageSize);
    const items = await this.#store.changesSince(this.#dataset(ctx), afterSeq, limit);
    const last = items.at(-1);
    const complete = items.length < limit;
    return {
      records: items.map((item) => ({
        externalId: item.externalId,
        providerVersion: String(item.version),
        etag: null,
        modifiedAt: item.modifiedAt,
        deleted: item.deleted,
        payload: item.payload,
      })),
      // Incremental: the checkpoint after a complete pass is the last change sequence read.
      nextCursor: last ? String(last.seq) : request.cursor,
      complete,
    };
  }

  normalize(raw: RawRecord): NormalizationResult {
    if (raw.deleted) {
      return {
        ok: true,
        record: {
          entityType: 'opportunity',
          externalId: raw.externalId,
          providerVersion: raw.providerVersion,
          etag: raw.etag,
          sourceModifiedAt: raw.modifiedAt,
          deleted: true,
          fields: null,
        },
      };
    }
    const parsed = PayloadSchema.safeParse(raw.payload);
    if (!parsed.success) return { ok: false, reason: 'payload_schema' };
    const p = parsed.data;
    if (p.id !== raw.externalId) return { ok: false, reason: 'identifier_mismatch' };
    const bag = raw.payload as Record<string, unknown>;
    const instantOrUndefined = (v: unknown) => (isInstant(v) ? v : undefined);
    const nextAction = p.next_action;
    const fields: OpportunityFields = {
      name: p.title,
      stage: p.status === 'on_hold' ? 'open' : p.status,
      lastInteractionAt: fieldOf(bag, 'last_activity', instantOrUndefined),
      nextStep: !('next_action' in bag)
        ? unavailable
        : nextAction
          ? present(nextAction.label)
          : empty,
      nextStepDueAt: !('next_action' in bag)
        ? unavailable
        : nextAction?.due
          ? isInstant(nextAction.due)
            ? present(nextAction.due)
            : unavailable
          : empty,
      amount: !('amount_cents' in bag)
        ? unavailable
        : p.amount_cents === null || p.amount_cents === undefined
          ? empty
          : p.currency
            ? present({ amount: centsToDecimal(p.amount_cents), currency: p.currency })
            : unavailable,
      ownerName: fieldOf(bag, 'owner', () => p.owner?.name),
      segment: fieldOf(bag, 'segment', (v) => (typeof v === 'string' ? v : undefined)),
    };
    const candidate: NormalizedRecord = {
      entityType: 'opportunity',
      externalId: raw.externalId,
      providerVersion: raw.providerVersion,
      etag: raw.etag,
      sourceModifiedAt: raw.modifiedAt,
      deleted: false,
      fields,
    };
    try {
      return { ok: true, record: validateNormalizedRecord({ ...candidate, fields: { ...fields, ...(p.commercial === undefined ? {} : { commercial: p.commercial }) } }) };
    } catch {
      return { ok: false, reason: 'normalized_validation' };
    }
  }

  async revoke(): Promise<void> {
    // Fixture source holds no provider-side grant.
  }
}

export type InjectedFault = Readonly<{ onCall: number; error: ConnectorError }>;

/** In-memory simulated provider with deterministic fault injection for contract tests. */
export class MemoryFixtureStore implements FixtureStore {
  readonly #items = new Map<string, Map<string, FixtureItem>>();
  #seq = 0;
  #calls = 0;
  #faults: InjectedFault[] = [];

  upsert(dataset: string, externalId: string, payload: unknown, modifiedAt: string): FixtureItem {
    return this.#write(dataset, externalId, payload, modifiedAt, false);
  }

  remove(dataset: string, externalId: string, modifiedAt: string): FixtureItem {
    return this.#write(dataset, externalId, null, modifiedAt, true);
  }

  injectFault(fault: InjectedFault): void {
    this.#faults.push(fault);
  }

  get calls(): number {
    return this.#calls;
  }

  #write(
    dataset: string,
    externalId: string,
    payload: unknown,
    modifiedAt: string,
    deleted: boolean,
  ): FixtureItem {
    const items = this.#items.get(dataset) ?? new Map<string, FixtureItem>();
    this.#items.set(dataset, items);
    const previous = items.get(externalId);
    this.#seq += 1;
    const item: FixtureItem = {
      seq: this.#seq,
      externalId,
      version: (previous?.version ?? 0) + 1,
      modifiedAt,
      deleted,
      payload,
    };
    items.set(externalId, item);
    return item;
  }

  async datasetExists(dataset: string): Promise<boolean> {
    return this.#items.has(dataset);
  }

  async changesSince(dataset: string, afterSeq: number, limit: number): Promise<FixtureItem[]> {
    this.#calls += 1;
    const fault = this.#faults.find((f) => f.onCall === this.#calls);
    if (fault) throw fault.error;
    return [...(this.#items.get(dataset)?.values() ?? [])]
      .filter((i) => i.seq > afterSeq)
      .sort((a, b) => a.seq - b.seq)
      .slice(0, limit);
  }
}
