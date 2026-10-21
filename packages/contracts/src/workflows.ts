import { z } from 'zod';
const text = (max: number) => z.string().trim().min(1).max(max);
export const WorkflowKind = z.enum(['buyer', 'content']);
export const WorkflowBrief = z
  .object({
    offer: z.string().max(2000),
    target: z.string().max(1500),
    phase: z.enum(['unknown', 'exploration', 'comparison', 'decision', 'adoption']),
    objective: z.string().max(1500),
    channel: z.string().max(200),
    constraints: z.string().max(2000),
    buyerRunId: z.uuid().nullable(),
  })
  .strict();
export const WorkspaceSourceBody = z
  .object({
    kind: z.enum([
      'website',
      'offer',
      'competitor',
      'content',
      'consumer_query',
      'buyer_hypothesis',
    ]),
    title: text(200),
    url: z
      .url()
      .refine((u) => u.startsWith('https://'), 'URL HTTPS requise')
      .nullable(),
    text: text(6000),
    observedAt: z.iso.datetime(),
    origin: z.enum(['observed', 'company', 'simulated']),
  })
  .strict()
  .refine(
    (s) => s.kind !== 'consumer_query' || s.origin === 'observed',
    'Une requête consommateur doit être observée',
  )
  .refine(
    (s) => s.kind !== 'buyer_hypothesis' || s.origin === 'simulated',
    'Une hypothèse acheteur est simulée',
  );
export const WorkspaceSource = WorkspaceSourceBody.safeExtend({
  id: z.uuid(),
  revision: z.number().int().positive(),
});
export const CreateWorkflowBody = z
  .object({
    kind: WorkflowKind,
    brief: WorkflowBrief,
    sourceIds: z.array(z.uuid()).min(1).max(8),
    requestKey: z.uuid(),
    researchId: z.uuid().optional(),
  })
  .strict();
const Finding = z
  .object({ topic: text(200), analysis: text(1800), references: z.array(text(250)).min(1).max(12) })
  .strict();
export const WorkflowResult = z
  .object({
    version: z.literal('november-v1'),
    kind: WorkflowKind,
    outcome: z.enum(['draft', 'needs_context', 'abstained']),
    summary: text(2000),
    questions: z.array(text(1000)).max(10),
    findings: z.array(Finding).max(8),
    benchmark: z.array(Finding).max(8),
    buyerQuestions: z.array(text(1000)).max(8),
    uniqueness: z
      .object({
        verdict: z.enum(['plausible', 'not_differentiated', 'insufficient_evidence']),
        reason: text(1800),
        references: z.array(text(250)).min(1).max(12),
      })
      .strict()
      .nullable(),
    content: z
      .object({
        title: text(300),
        body: text(8000),
        callToAction: text(500),
        rationale: text(1500),
        references: z.array(text(250)).min(1).max(12),
      })
      .strict()
      .nullable(),
    limits: z.array(text(1000)).max(10),
  })
  .strict();
export const WorkflowRun = z.object({
  id: z.uuid(),
  kind: WorkflowKind,
  brief: WorkflowBrief,
  sourceIds: z.array(z.uuid()),
  revision: z.number().int().positive(),
  status: z.enum([
    'queued',
    'running',
    'draft',
    'needs_context',
    'abstained',
    'approved',
    'rejected',
    'obsolete',
    'failed',
  ]),
  mode: z.enum(['rules', 'simulated', 'hermes-live', 'hermes-stub']),
  result: WorkflowResult.nullable(),
  errorCode: z.string().nullable(),
  createdAt: z.iso.datetime(),
  inputHash: z.string().nullable(),
  agentRunId: z.uuid().nullable(),
  stale: z.boolean(),
  researchId: z.uuid().nullable(),
});
export const WorkflowReviewBody = z
  .object({ revision: z.number().int().positive(), decision: z.enum(['approve', 'reject']) })
  .strict();
export type WorkflowBriefDto = z.infer<typeof WorkflowBrief>;
export type WorkspaceSourceDto = z.infer<typeof WorkspaceSource>;
export type WorkflowRunDto = z.infer<typeof WorkflowRun>;
export type WorkflowResultDto = z.infer<typeof WorkflowResult>;
