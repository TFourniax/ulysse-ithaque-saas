import { ensure } from './errors.ts';

/**
 * Tenant-private business context. It may influence priority and wording for
 * this tenant only; it never becomes shared doctrine or advice for another tenant.
 */
export type CompanyContextContent = Readonly<{
  activity: string;
  offers: readonly string[];
  objectives: readonly string[];
  targetSegments: readonly string[];
  constraints: readonly string[];
  salesProcess: string;
}>;

export const CONTEXT_SOURCES = ['manual', 'fixture'] as const;
export type ContextSource = (typeof CONTEXT_SOURCES)[number];

export type CompanyContext = Readonly<{
  tenantId: string;
  id: string;
  version: number;
  content: CompanyContextContent;
  source: ContextSource;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
}>;

function list(value: unknown, name: string): string[] {
  ensure(Array.isArray(value) && value.length <= 30, 'INVALID_INPUT', name);
  return value.map((item: unknown) => {
    ensure(
      typeof item === 'string' && item.trim().length > 0 && item.length <= 300,
      'INVALID_INPUT',
      name,
    );
    return item.trim();
  });
}

function paragraph(value: unknown, name: string): string {
  ensure(typeof value === 'string' && value.length <= 4000, 'INVALID_INPUT', name);
  return value.trim();
}

export function validateContextContent(input: unknown): CompanyContextContent {
  ensure(typeof input === 'object' && input !== null, 'INVALID_INPUT', 'context');
  const raw = input as Record<string, unknown>;
  return {
    activity: paragraph(raw.activity, 'activity'),
    offers: list(raw.offers, 'offers'),
    objectives: list(raw.objectives, 'objectives'),
    targetSegments: list(raw.targetSegments, 'targetSegments'),
    constraints: list(raw.constraints, 'constraints'),
    salesProcess: paragraph(raw.salesProcess, 'salesProcess'),
  };
}

export function isTargetSegment(context: CompanyContext | null, segment: string): boolean {
  if (!context) return false;
  const needle = segment.trim().toLowerCase();
  return context.content.targetSegments.some((s) => s.toLowerCase() === needle);
}
