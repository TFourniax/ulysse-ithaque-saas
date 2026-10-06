import { z } from 'zod';

/** Job payloads are validated at execution: a malformed or foreign payload never reaches a service. */
export const SyncJob = z.object({
  tenantId: z.uuid(),
  connectionId: z.uuid(),
  trigger: z.enum(['initial', 'scheduled', 'manual', 'replay']),
  /** Set on continuation jobs: resume this run instead of opening a new one. */
  runId: z.uuid().optional(),
});
export type SyncJob = z.infer<typeof SyncJob>;

export const TenantJob = z.object({
  tenantId: z.uuid(),
  trigger: z
    .enum(['source_change', 'scheduled', 'manual', 'doctrine_change'])
    .default('source_change'),
});
export type TenantJob = z.infer<typeof TenantJob>;

export const ConnectionJob = z.object({ tenantId: z.uuid(), connectionId: z.uuid() });
export type ConnectionJob = z.infer<typeof ConnectionJob>;

export const RecommendationJob = z.object({ tenantId: z.uuid(), recommendationId: z.uuid() });
export type RecommendationJob = z.infer<typeof RecommendationJob>;
