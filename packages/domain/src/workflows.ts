import type { CompanyContext } from './company-context.ts';
import type { Doctrine } from './doctrine.ts';
import { boundedText, closed, record } from './commercial.ts';
import { ensure } from './errors.ts';
import { fingerprintOf } from './hash.ts';

export const WORKFLOW_VERSION = 'november-v1';
export const WORKFLOW_KINDS = ['buyer', 'content'] as const;
export type WorkflowKind = (typeof WORKFLOW_KINDS)[number];
export const SOURCE_KINDS = [
  'website',
  'offer',
  'competitor',
  'content',
  'consumer_query',
  'buyer_hypothesis',
] as const;
export type WorkspaceSource = Readonly<{
  id: string;
  revision: number;
  kind: (typeof SOURCE_KINDS)[number];
  title: string;
  url: string | null;
  text: string;
  observedAt: string;
  origin: 'observed' | 'company' | 'simulated';
}>;
export type WorkflowBrief = Readonly<{
  offer: string;
  target: string;
  phase: 'unknown' | 'exploration' | 'comparison' | 'decision' | 'adoption';
  objective: string;
  channel: string;
  constraints: string;
  buyerRunId: string | null;
}>;
export type WorkflowFinding = Readonly<{
  topic: string;
  analysis: string;
  references: readonly string[];
}>;
export type WorkflowResult = Readonly<{
  version: typeof WORKFLOW_VERSION;
  kind: WorkflowKind;
  outcome: 'draft' | 'needs_context' | 'abstained';
  summary: string;
  questions: readonly string[];
  findings: readonly WorkflowFinding[];
  benchmark: readonly WorkflowFinding[];
  buyerQuestions: readonly string[];
  uniqueness: null | Readonly<{
    verdict: 'plausible' | 'not_differentiated' | 'insufficient_evidence';
    reason: string;
    references: readonly string[];
  }>;
  content: null | Readonly<{
    title: string;
    body: string;
    callToAction: string;
    rationale: string;
    references: readonly string[];
  }>;
  limits: readonly string[];
}>;
export type WorkflowInput = Readonly<{
  kind: WorkflowKind;
  brief: WorkflowBrief;
  context: CompanyContext | null;
  doctrine: Doctrine | null;
  sources: readonly WorkspaceSource[];
  buyer: null | Readonly<{ id: string; result: WorkflowResult }>;
  research?: {
    id: string;
    revision: number;
    status: string;
    candidateCount: number;
    qualifiedCount: number;
    pendingReferences: string[];
  };
}>;

export const sourceReference = (s: WorkspaceSource): string => `source:${s.id}:r${s.revision}`;
export const workflowInputHash = (i: WorkflowInput): string =>
  fingerprintOf({
    version: WORKFLOW_VERSION,
    kind: i.kind,
    brief: i.brief,
    context: i.context?.version ?? null,
    doctrine: i.doctrine ? [i.doctrine.id, i.doctrine.version, i.doctrine.contentHash] : null,
    sources: i.sources.map((s) => [s.id, s.revision, s.observedAt]),
    buyer: i.buyer,
    research: i.research,
  });

/** Questions precede drafting; a model cannot turn missing context into invented facts. */
export function workflowQuestions(input: WorkflowInput): string[] {
  const q: string[] = [];
  if (!input.context?.content.activity) q.push('Quelle est l’activité de l’entreprise ?');
  if (!input.brief.offer.trim()) q.push('Quelle offre précise faut-il examiner ou présenter ?');
  if (!input.brief.target.trim())
    q.push('Quel acheteur ou public vise-t-on, et dans quelle situation ?');
  if (!input.sources.some((s) => s.kind === 'offer' || s.kind === 'website'))
    q.push('Quelle page ou présentation décrit l’offre, ses bénéfices et ses preuves ?');
  if (input.kind === 'content') {
    if (input.brief.phase === 'unknown') q.push('À quelle phase de décision se trouve la cible ?');
    if (!input.brief.objective.trim())
      q.push('Que doit comprendre, dire ou faire le lecteur après ce contenu ?');
    if (!input.brief.channel.trim())
      q.push('Sur quel canal et dans quel format ce contenu sera-t-il utilisé ?');
  }
  return q;
}

function texts(input: unknown, max: number, size = 1000): string[] {
  ensure(Array.isArray(input) && input.length <= max, 'INVALID_INPUT');
  return input.map((s: unknown) => boundedText(s, size));
}
function refs(input: unknown): string[] {
  const values = texts(input, 12, 250);
  ensure(
    values.length > 0 && new Set(values).size === values.length,
    'INVALID_INPUT',
    'references',
  );
  return values;
}
function findings(input: unknown): WorkflowFinding[] {
  ensure(Array.isArray(input) && input.length <= 8, 'INVALID_INPUT');
  return input.map((value: unknown) => {
    const f = record(value);
    closed(f, ['topic', 'analysis', 'references']);
    return {
      topic: boundedText(f.topic, 200),
      analysis: boundedText(f.analysis, 1800),
      references: refs(f.references),
    };
  });
}
export function validateWorkflowResult(value: unknown): WorkflowResult {
  const r = record(value);
  closed(r, [
    'version',
    'kind',
    'outcome',
    'summary',
    'questions',
    'findings',
    'benchmark',
    'buyerQuestions',
    'uniqueness',
    'content',
    'limits',
  ]);
  ensure(r.version === WORKFLOW_VERSION, 'INVALID_VERSION');
  ensure(r.kind === 'buyer' || r.kind === 'content', 'INVALID_INPUT');
  ensure(
    r.outcome === 'draft' || r.outcome === 'needs_context' || r.outcome === 'abstained',
    'INVALID_INPUT',
  );
  let uniqueness: WorkflowResult['uniqueness'] = null;
  if (r.uniqueness !== null) {
    const u = record(r.uniqueness);
    closed(u, ['verdict', 'reason', 'references']);
    ensure(
      u.verdict === 'plausible' ||
        u.verdict === 'not_differentiated' ||
        u.verdict === 'insufficient_evidence',
      'INVALID_INPUT',
    );
    uniqueness = {
      verdict: u.verdict,
      reason: boundedText(u.reason, 1800),
      references: refs(u.references),
    };
  }
  let content: WorkflowResult['content'] = null;
  if (r.content !== null) {
    const c = record(r.content);
    closed(c, ['title', 'body', 'callToAction', 'rationale', 'references']);
    content = {
      title: boundedText(c.title, 300),
      body: boundedText(c.body, 8000),
      callToAction: boundedText(c.callToAction, 500),
      rationale: boundedText(c.rationale, 1500),
      references: refs(c.references),
    };
  }
  const result: WorkflowResult = {
    version: WORKFLOW_VERSION,
    kind: r.kind,
    outcome: r.outcome,
    summary: boundedText(r.summary, 2000),
    questions: texts(r.questions, 10),
    findings: findings(r.findings),
    benchmark: findings(r.benchmark),
    buyerQuestions: texts(r.buyerQuestions, 8),
    uniqueness,
    content,
    limits: texts(r.limits, 10),
  };
  ensure(result.outcome !== 'needs_context' || result.questions.length > 0, 'INVALID_INPUT');
  ensure(result.kind !== 'buyer' || content === null, 'INVALID_INPUT');
  ensure(
    result.kind !== 'content' ||
      (uniqueness === null && result.benchmark.length === 0 && result.buyerQuestions.length === 0),
    'INVALID_INPUT',
  );
  ensure(
    result.outcome === 'draft' ||
      (content === null &&
        uniqueness === null &&
        result.findings.length === 0 &&
        result.benchmark.length === 0 &&
        result.buyerQuestions.length === 0),
    'INVALID_INPUT',
  );
  ensure(
    result.outcome !== 'draft' ||
      (result.kind === 'buyer'
        ? uniqueness !== null && result.findings.length > 0
        : content !== null),
    'INVALID_INPUT',
  );
  return result;
}

/** Citations must be read; comparison requires competitor evidence, never a score made up by a persona. */
export function validateWorkflowPublication(
  result: WorkflowResult,
  input: WorkflowInput,
  retrieved: ReadonlySet<string>,
): void {
  ensure(result.kind === input.kind, 'INVALID_INPUT');
  const citations = [
    ...result.findings,
    ...result.benchmark,
    ...(result.uniqueness ? [result.uniqueness] : []),
    ...(result.content ? [result.content] : []),
  ].flatMap((f) => f.references);
  ensure(
    citations.every((r) => retrieved.has(r)),
    'INVALID_INPUT',
    'unretrieved citation',
  );
  if (result.outcome !== 'draft') return;
  ensure(
    input.kind !== 'buyer' || !input.research?.qualifiedCount || result.benchmark.length > 0,
    'INVALID_INPUT',
    'available research benchmark ignored',
  );
  ensure(workflowQuestions(input).length === 0, 'INVALID_INPUT', 'incomplete brief');
  const offerRefs = new Set(
    input.sources.filter((s) => s.kind === 'offer' || s.kind === 'website').map(sourceReference),
  );
  ensure(
    citations.some((r) => offerRefs.has(r)),
    'INVALID_INPUT',
    'offer evidence required',
  );
  const competitors = new Set(
    input.sources.filter((s) => s.kind === 'competitor').map(sourceReference),
  );
  ensure(
    result.benchmark.every((f) => f.references.some((r) => competitors.has(r))),
    'INVALID_INPUT',
    'competitor evidence required',
  );
  if (
    result.uniqueness?.verdict !== undefined &&
    result.uniqueness.verdict !== 'insufficient_evidence'
  ) {
    ensure(
      result.benchmark.length > 0 && result.uniqueness.references.some((r) => competitors.has(r)),
      'INVALID_INPUT',
      'uniqueness without benchmark',
    );
  }
}

export function pendingWorkflow(
  kind: WorkflowKind,
  questions: readonly string[],
  summary: string,
): WorkflowResult {
  return {
    version: WORKFLOW_VERSION,
    kind,
    outcome: questions.length ? 'needs_context' : 'abstained',
    summary,
    questions,
    findings: [],
    benchmark: [],
    buyerQuestions: [],
    uniqueness: null,
    content: null,
    limits: ['Aucune validation par un client réel.'],
  };
}
