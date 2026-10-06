import { ensure } from './errors.ts';
import { fingerprintOf } from './hash.ts';

export const DOCTRINE_STATUSES = ['draft', 'validated', 'retired'] as const;
export type DoctrineStatus = (typeof DOCTRINE_STATUSES)[number];

/**
 * - fixture: fictional doctrine for demos/tests, never business guidance;
 * - customer: written and validated by the tenant itself;
 * - licensed: derived from a shared doctrine explicitly granted to the tenant.
 */
export const DOCTRINE_ORIGINS = ['fixture', 'customer', 'licensed'] as const;
export type DoctrineOrigin = (typeof DOCTRINE_ORIGINS)[number];

export const USAGE_RIGHTS = ['demo-only', 'tenant-internal', 'licensed-shared'] as const;
export type UsageRights = (typeof USAGE_RIGHTS)[number];

export type RuleConfig = Readonly<{
  ruleId: string;
  enabled: boolean;
  parameters: Readonly<Record<string, number>>;
}>;

export type DoctrinePolicy = Readonly<{
  /** Maximum age of the confirmed source snapshot to publish or approve. */
  maxSourceAgeHours: number;
  /** Time-to-live of a pending recommendation. */
  recommendationLifetimeHours: number;
  /** Cap of simultaneously open (draft/pending) recommendations per tenant. */
  maxOpenRecommendations: number;
  /** After a human rejection, the same subject/kind is not re-proposed during this period. */
  rejectionCooldownDays: number;
}>;

export type DoctrineContent = Readonly<{
  rules: readonly RuleConfig[];
  policy: DoctrinePolicy;
}>;

export type Doctrine = Readonly<{
  tenantId: string;
  id: string;
  key: string;
  version: number;
  status: DoctrineStatus;
  title: string;
  origin: DoctrineOrigin;
  usageRights: UsageRights;
  content: DoctrineContent;
  contentHash: string;
  createdBy: string | null;
  createdAt: string;
  validatedBy: string | null;
  validatedAt: string | null;
  validationNote: string | null;
  retiredAt: string | null;
}>;

export type DoctrineRef = Readonly<{
  id: string;
  key: string;
  version: number;
  origin: DoctrineOrigin;
  fictional: boolean;
}>;

/** Parameter contract published by each rule; enforced when a doctrine is drafted. */
export type ParameterSpec = Readonly<{ name: string; min: number; max: number; integer: boolean }>;

export function validatePolicy(input: unknown): DoctrinePolicy {
  ensure(typeof input === 'object' && input !== null, 'INVALID_POLICY');
  const p = input as Record<string, unknown>;
  const bounded = (key: string, min: number, max: number): number => {
    const v = p[key];
    ensure(
      typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max,
      'INVALID_POLICY',
      key,
    );
    return v;
  };
  return {
    maxSourceAgeHours: bounded('maxSourceAgeHours', 1, 24 * 30),
    recommendationLifetimeHours: bounded('recommendationLifetimeHours', 1, 24 * 90),
    maxOpenRecommendations: Math.trunc(bounded('maxOpenRecommendations', 1, 500)),
    rejectionCooldownDays: bounded('rejectionCooldownDays', 0, 365),
  };
}

export function validateDoctrineContent(
  input: unknown,
  specs: ReadonlyMap<string, readonly ParameterSpec[]>,
): DoctrineContent {
  ensure(typeof input === 'object' && input !== null, 'INVALID_POLICY', 'content');
  const raw = input as { rules?: unknown; policy?: unknown };
  ensure(
    Array.isArray(raw.rules) && raw.rules.length > 0 && raw.rules.length <= 50,
    'INVALID_POLICY',
    'rules',
  );
  const seen = new Set<string>();
  const rules = raw.rules.map((candidate: unknown): RuleConfig => {
    ensure(typeof candidate === 'object' && candidate !== null, 'INVALID_POLICY', 'rule');
    const rule = candidate as { ruleId?: unknown; enabled?: unknown; parameters?: unknown };
    ensure(typeof rule.ruleId === 'string', 'INVALID_POLICY', 'ruleId');
    const spec = specs.get(rule.ruleId);
    ensure(spec !== undefined, 'INVALID_POLICY', `unknown rule ${rule.ruleId}`);
    ensure(!seen.has(rule.ruleId), 'INVALID_POLICY', `duplicate rule ${rule.ruleId}`);
    seen.add(rule.ruleId);
    ensure(typeof rule.enabled === 'boolean', 'INVALID_POLICY', 'enabled');
    ensure(
      typeof rule.parameters === 'object' && rule.parameters !== null,
      'INVALID_POLICY',
      'parameters',
    );
    const params = rule.parameters as Record<string, unknown>;
    const parameters: Record<string, number> = {};
    for (const p of spec) {
      const v = params[p.name];
      ensure(
        typeof v === 'number' &&
          Number.isFinite(v) &&
          v >= p.min &&
          v <= p.max &&
          (!p.integer || Number.isInteger(v)),
        'INVALID_POLICY',
        `${rule.ruleId}.${p.name}`,
      );
      parameters[p.name] = v;
    }
    ensure(
      Object.keys(params).every((k) => spec.some((p) => p.name === k)),
      'INVALID_POLICY',
      'unknown parameter',
    );
    return { ruleId: rule.ruleId, enabled: rule.enabled, parameters };
  });
  return { rules, policy: validatePolicy(raw.policy) };
}

export function doctrineContentHash(content: DoctrineContent): string {
  return fingerprintOf(content);
}

export function doctrineRef(d: Doctrine): DoctrineRef {
  return {
    id: d.id,
    key: d.key,
    version: d.version,
    origin: d.origin,
    fictional: d.origin === 'fixture',
  };
}

/** A doctrine may drive analysis only once validated and while its rights allow it. */
export function assertUsableForAnalysis(d: Doctrine): void {
  ensure(d.status === 'validated', 'DOCTRINE_NOT_VALIDATED', `${d.key}@${d.version}`);
  ensure(d.usageRights !== 'demo-only' || d.origin === 'fixture', 'DOCTRINE_RIGHTS');
}

export function validateDoctrine(
  d: Doctrine,
  validatorId: string,
  note: string | null,
  now: string,
): Doctrine {
  ensure(d.status === 'draft', 'INVALID_TRANSITION', `doctrine ${d.status} -> validated`);
  ensure(note === null || note.length <= 2000, 'INVALID_INPUT', 'note');
  return {
    ...d,
    status: 'validated',
    validatedBy: validatorId,
    validatedAt: now,
    validationNote: note,
  };
}

export function retireDoctrine(d: Doctrine, now: string): Doctrine {
  ensure(
    d.status === 'validated' || d.status === 'draft',
    'INVALID_TRANSITION',
    `doctrine ${d.status} -> retired`,
  );
  return { ...d, status: 'retired', retiredAt: now };
}
