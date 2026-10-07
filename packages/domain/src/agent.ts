import type { CompanyContext } from './company-context.ts';
import type { CommercialData } from './commercial.ts';
import { boundedText, closed, record } from './commercial.ts';
import type { Doctrine } from './doctrine.ts';
import { ensure } from './errors.ts';
import { fingerprintOf } from './hash.ts';
import type { Opportunity } from './opportunity.ts';

export const AGENT_VERSION = 'ulysse-agent-v1';
export const AGENT_RULE_ID = 'ulysse.agent.v1';
export const AGENT_ACTIONS = [
  'follow_up',
  'clarify',
  'meeting',
  'offer_match',
  'wait',
  'internal_review',
] as const;
export type AgentProposal = Readonly<{
  action: (typeof AGENT_ACTIONS)[number];
  title: string;
  nextStep: string;
  justification: string;
  references: readonly string[];
  assumptions: readonly string[];
  missingInformation: readonly string[];
  limits: readonly string[];
  urgency: 'normal' | 'soon' | 'urgent';
}>;
export type AgentResult = Readonly<{
  version: typeof AGENT_VERSION;
  outcome: 'proposals' | 'no_signal' | 'abstained' | 'contradiction' | 'technical_error';
  summary: string;
  proposals: readonly AgentProposal[];
}>;

function strings(value: unknown, max: number, size: number): string[] {
  ensure(Array.isArray(value) && value.length <= max, 'INVALID_INPUT');
  return value.map((v: unknown) => boundedText(v, size));
}
export function validateAgentResult(input: unknown): AgentResult {
  const raw = record(input);
  closed(raw, ['version', 'outcome', 'summary', 'proposals']);
  ensure(raw.version === AGENT_VERSION, 'INVALID_VERSION');
  ensure(
    raw.outcome === 'proposals' ||
      raw.outcome === 'no_signal' ||
      raw.outcome === 'abstained' ||
      raw.outcome === 'contradiction' ||
      raw.outcome === 'technical_error',
    'INVALID_INPUT',
  );
  ensure(Array.isArray(raw.proposals) && raw.proposals.length <= 3, 'INVALID_INPUT');
  const proposals = raw.proposals.map((input: unknown): AgentProposal => {
    const p = record(input);
    closed(p, [
      'action',
      'title',
      'nextStep',
      'justification',
      'references',
      'assumptions',
      'missingInformation',
      'limits',
      'urgency',
    ]);
    ensure((AGENT_ACTIONS as readonly unknown[]).includes(p.action), 'INVALID_INPUT');
    ensure(
      p.urgency === 'normal' || p.urgency === 'soon' || p.urgency === 'urgent',
      'INVALID_INPUT',
    );
    const references = strings(p.references, 12, 250);
    ensure(
      references.length > 0 && new Set(references).size === references.length,
      'INVALID_INPUT',
    );
    return {
      action: p.action as AgentProposal['action'],
      title: boundedText(p.title, 300),
      nextStep: boundedText(p.nextStep, 2000),
      justification: boundedText(p.justification, 2000),
      references,
      assumptions: strings(p.assumptions, 8, 500),
      missingInformation: strings(p.missingInformation, 8, 500),
      limits: strings(p.limits, 8, 500),
      urgency: p.urgency,
    };
  });
  ensure(
    raw.outcome === 'proposals'
      ? proposals.length > 0
      : raw.outcome === 'contradiction' || proposals.length === 0,
    'INVALID_INPUT',
  );
  return {
    version: AGENT_VERSION,
    outcome: raw.outcome,
    summary: boundedText(raw.summary, 2000),
    proposals,
  };
}
export function agentInputHash(o: Opportunity, d: Doctrine, c: CompanyContext | null): string {
  return fingerprintOf({
    tenant: o.tenantId,
    subject: o.id,
    fields: o.fields,
    deleted: o.deletedAt,
    doctrine: [d.id, d.version, d.contentHash],
    context: c?.version ?? null,
  });
}
export function agentFingerprint(
  o: Opportunity,
  d: Doctrine,
  c: CompanyContext | null,
  kind: string,
): string {
  return fingerprintOf({ input: agentInputHash(o, d, c), kind, version: AGENT_VERSION });
}
export function validateAgentPublication(
  p: AgentProposal,
  retrieved: ReadonlySet<string>,
  data: CommercialData | undefined,
  now: number,
): void {
  ensure(
    p.references.every((r) => retrieved.has(r)),
    'INVALID_INPUT',
    'unretrieved citation',
  );
  if (p.action !== 'wait' && p.action !== 'internal_review') {
    ensure(data !== undefined, 'INVALID_INPUT', 'contact policy unavailable');
    ensure(!data.contactPolicy.opposed, 'INVALID_INPUT', 'opposition');
    ensure(
      data.contactPolicy.pauseUntil === null || Date.parse(data.contactPolicy.pauseUntil) <= now,
      'INVALID_INPUT',
      'pause',
    );
  }
}
export interface AgentExecutor {
  execute(
    request: Readonly<{
      runId: string;
      capability: string;
      subjectId: string;
      mode: 'simulated' | 'hermes-live' | 'hermes-stub';
      model: string;
      timeoutMs: number;
    }>,
    signal?: AbortSignal,
  ): Promise<unknown>;
}
