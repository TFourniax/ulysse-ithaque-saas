import type { DecisionKind, QualityLabel, RecommendationStatus } from './recommendation.ts';
import { isOpen, QUALITY_LABELS } from './recommendation.ts';
import type { Analysis } from './records.ts';
import type { RecommendationKind } from './rules.ts';
import { HOUR_MS, parseInstant } from './time.ts';

/** Minimal projection of a recommendation for reporting (no content, no evidence). */
export type RecommendationDigest = Readonly<{
  id: string;
  kind: RecommendationKind;
  status: RecommendationStatus;
  generatedAt: string;
  expiresAt: string;
}>;

/** A decision with the generation time of its recommendation. */
export type DecisionDigest = Readonly<{
  recommendationId: string;
  kind: RecommendationKind;
  decision: DecisionKind;
  quality: QualityLabel | null;
  decidedAt: string;
  generatedAt: string;
}>;

export const REPORT_MAX_DAYS = 366;
export const REPORT_MAX_ROWS = 10_000;

/**
 * Observed figures for one company over a period, computed only from what was
 * recorded (proposals, decisions and their labels, the latest analysis). No
 * estimate, extrapolation or business value is derived here.
 */
export type QualityReport = Readonly<{
  period: Readonly<{ from: string; to: string }>;
  proposals: Readonly<{
    generated: number;
    byKind: Readonly<Record<string, number>>;
    byStatus: Readonly<Record<string, number>>;
  }>;
  decisions: Readonly<{
    total: number;
    approved: number;
    rejected: number;
    byQuality: Readonly<Record<QualityLabel | 'unlabeled', number>>;
    medianHoursToDecision: number | null;
  }>;
  latestAnalysis: Readonly<{
    completedAt: string;
    evaluated: number;
    abstentions: Readonly<Record<string, number>>;
  }> | null;
  /** True when a period holds more rows than REPORT_MAX_ROWS: figures are then partial. */
  truncated: boolean;
}>;

const increment = (counts: Record<string, number>, key: string) => {
  counts[key] = (counts[key] ?? 0) + 1;
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 1
      ? (sorted[middle] ?? 0)
      : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
  return Math.round(value * 10) / 10;
}

export function buildQualityReport(input: {
  from: string;
  to: string;
  now: number;
  recommendations: readonly RecommendationDigest[];
  decisions: readonly DecisionDigest[];
  analyses: readonly Analysis[];
  truncated: boolean;
}): QualityReport {
  const byKind: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  for (const rec of input.recommendations) {
    increment(byKind, rec.kind);
    const expired = isOpen(rec.status) && input.now >= parseInstant(rec.expiresAt);
    increment(byStatus, expired ? 'expired' : rec.status);
  }
  const byQuality = Object.fromEntries(
    [...QUALITY_LABELS, 'unlabeled'].map((label) => [label, 0]),
  ) as Record<QualityLabel | 'unlabeled', number>;
  let approved = 0;
  for (const d of input.decisions) {
    if (d.decision === 'approve') approved += 1;
    byQuality[d.quality ?? 'unlabeled'] += 1;
  }
  const latest = input.analyses.find((a) => a.status === 'completed') ?? null;
  return {
    period: { from: input.from, to: input.to },
    proposals: { generated: input.recommendations.length, byKind, byStatus },
    decisions: {
      total: input.decisions.length,
      approved,
      rejected: input.decisions.length - approved,
      byQuality,
      medianHoursToDecision: median(
        input.decisions.map(
          (d) => (parseInstant(d.decidedAt) - parseInstant(d.generatedAt)) / HOUR_MS,
        ),
      ),
    },
    latestAnalysis: latest
      ? {
          completedAt: latest.completedAt,
          evaluated: latest.evaluated,
          abstentions: latest.abstentions,
        }
      : null,
    truncated: input.truncated,
  };
}
