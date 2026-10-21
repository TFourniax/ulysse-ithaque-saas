import { z } from 'zod';
const text = (max: number) => z.string().trim().min(1).max(max);
const url = z
  .url()
  .max(2000)
  .refine((v) => {
    try {
      const u = new URL(v);
      return (
        u.protocol === 'https:' &&
        u.hostname.includes('.') &&
        !u.username &&
        !u.password &&
        (!u.port || u.port === '443')
      );
    } catch {
      return false;
    }
  }, 'Adresse HTTPS publique requise');
export const ResearchProfile = z
  .object({
    enabled: z.boolean(),
    companyName: text(150),
    website: url,
    offers: z.array(text(200)).min(1).max(10),
    target: text(200),
    market: text(200),
    geography: z.string().max(150),
    keywords: z.array(text(100)).max(20),
    budgetUsd: z.number().min(0.05).max(2),
    maxSearches: z.number().int().min(6).max(100),
    maxPages: z.number().int().min(12).max(500),
    maxAgeDays: z.number().int().min(1).max(90),
  })
  .strict();
export const ResearchPolicy = z
  .object({ revision: z.number().int().positive(), profile: ResearchProfile })
  .nullable();
export const ResearchDimension = z.enum([
  'offer',
  'target',
  'price',
  'delivery',
  'integrations',
  'proof',
  'support',
  'limits',
]);
export const ResearchFact = z.object({
  id: z.uuid(),
  offer: text(160),
  dimension: ResearchDimension,
  value: text(500),
  quote: text(1000),
  pageId: z.uuid(),
  quality: z.enum(['observed', 'vendor_claim']),
});
export const ResearchPage = z.object({
  id: z.uuid(),
  url,
  title: z.string().max(300),
  hash: text(64),
  retrievedAt: z.iso.datetime(),
  publishedAt: z.iso.datetime().nullable(),
  truncated: z.boolean(),
});
export const ResearchCandidate = z.object({
  id: z.uuid(),
  campaignId: z.uuid(),
  domain: text(253),
  name: text(200),
  revision: z.number().int().positive(),
  own: z.boolean(),
  relevance: z.enum(['unqualified', 'direct', 'indirect', 'substitute', 'irrelevant', 'directory']),
  reason: z.string().max(1000),
  facts: z.array(ResearchFact),
  pages: z.array(ResearchPage),
  errors: z.array(z.object({ url: z.string(), code: text(100) })),
  review: z.enum(['pending', 'approved', 'excluded']),
  note: z.string().max(2000),
  corrections: z.array(z.object({ factId: z.uuid(), value: text(500) }).strict()).max(100),
});
export const ResearchCampaign = z.object({
  id: z.uuid(),
  revision: z.number().int().positive(),
  profile: ResearchProfile,
  profileRevision: z.number().int().positive(),
  contextVersion: z.number().int().nonnegative(),
  status: z.enum(['queued', 'running', 'paused', 'completed', 'cancelled', 'failed']),
  stopReason: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  searches: z.number().int().nonnegative(),
  pages: z.number().int().nonnegative(),
  modelCalls: z.number().int().nonnegative(),
  committedUsd: z.number().nonnegative(),
  uncertainCalls: z.number().int().nonnegative(),
  candidateCount: z.number().int().nonnegative(),
  qualifiedCount: z.number().int().nonnegative(),
  pendingTasks: z.number().int().nonnegative(),
});
export const ResearchReview = z
  .object({
    revision: z.number().int().positive(),
    decision: z.enum(['approved', 'excluded', 'pending']),
    note: z.string().max(2000),
    corrections: ResearchCandidate.shape.corrections,
  })
  .strict();
export type ResearchProfileDto = z.infer<typeof ResearchProfile>;
export type ResearchCampaignDto = z.infer<typeof ResearchCampaign>;
export type ResearchCandidateDto = z.infer<typeof ResearchCandidate>;
export type ResearchPolicyDto = z.infer<typeof ResearchPolicy>;
