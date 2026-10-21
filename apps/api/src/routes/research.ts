import {
  IdParam,
  ResearchCampaign,
  ResearchCandidate,
  ResearchPage,
  ResearchPolicy,
  ResearchProfile,
  ResearchReview,
} from '@ulysse/contracts';
import { PgResearchStore } from '@ulysse/database';
import type { Context } from '@ulysse/domain';
import { requirePermission } from '@ulysse/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { ApiDeps } from '../deps.ts';
export function registerResearchRoutes(
  scope: FastifyInstance,
  deps: ApiDeps,
  ctxOf: (req: FastifyRequest) => Context,
): void {
  const app = scope.withTypeProvider<ZodTypeProvider>();
  const store = new PgResearchStore(deps.pool);
  const read = (req: FastifyRequest) => {
    const ctx = ctxOf(req);
    requirePermission(ctx, 'analysis:read');
    return ctx;
  };
  app.get(
    '/research/policy',
    { schema: { tags: ['research'], response: { 200: ResearchPolicy } } },
    async (req) => {
      const ctx = read(req);
      return ResearchPolicy.parse(
        await store.transaction(ctx, (_tx, sql) => store.policy(sql, ctx.tenantId)),
      );
    },
  );
  app.put(
    '/research/policy',
    {
      schema: {
        tags: ['research'],
        body: z
          .object({ revision: z.number().int().positive().nullable(), profile: ResearchProfile })
          .strict(),
        response: { 200: z.object({ status: z.literal('saved') }) },
      },
    },
    async (req) => {
      await store.savePolicy(ctxOf(req), req.body.profile, req.body.revision);
      return { status: 'saved' as const };
    },
  );
  app.get(
    '/research',
    { schema: { tags: ['research'], response: { 200: z.array(ResearchCampaign) } } },
    async (req) => z.array(ResearchCampaign).parse(await store.campaigns(read(req))),
  );
  app.post(
    '/research',
    {
      schema: {
        tags: ['research'],
        body: z.object({ requestKey: z.uuid() }).strict(),
        response: { 202: z.object({ id: z.uuid().nullable() }) },
      },
    },
    async (req, reply) => {
      const ctx = ctxOf(req);
      requirePermission(ctx, 'context:manage');
      const id = await store.transaction(ctx, async (tx, sql) => {
        await tx.lock('analysis');
        return store.ensureCampaign(ctx, tx, sql, req.body.requestKey);
      });
      return reply.status(202).send({ id });
    },
  );
  const Task = z.object({
    id: z.uuid(),
    body: z.record(z.string(), z.unknown()),
    status: z.string(),
    attempt: z.number(),
    summary: z.record(z.string(), z.unknown()),
    error_code: z.string().nullable(),
  });
  app.get(
    '/research/:id',
    {
      schema: {
        tags: ['research'],
        params: IdParam,
        querystring: z.object({
          offset: z.coerce.number().int().min(0).default(0),
          q: z.string().max(100).default(''),
          candidate: z.uuid().optional(),
        }),
        response: {
          200: z.object({
            campaign: ResearchCampaign,
            candidates: z.array(ResearchCandidate),
            total: z.number(),
            tasks: z.array(Task),
          }),
        },
      },
    },
    async (req) => {
      const ctx = read(req);
      return store.transaction(ctx, async (_tx, sql) => {
        const campaign = await store.campaign(sql, ctx.tenantId, req.params.id);
        const page = await store.candidates(
          sql,
          ctx.tenantId,
          req.params.id,
          req.query.offset,
          req.query.q,
          req.query.candidate,
        );
        const tasks = await sql.query(
          'SELECT id,body,status,attempt,summary,error_code FROM research_tasks WHERE tenant_id=$1 AND campaign_id=$2 ORDER BY created_at DESC,id LIMIT 200',
          [ctx.tenantId, req.params.id],
        );
        return {
          campaign: ResearchCampaign.parse(campaign),
          candidates: z.array(ResearchCandidate).parse(page.items),
          total: page.total,
          tasks: z.array(Task).parse(tasks.rows),
        };
      });
    },
  );
  app.post(
    '/research/:id/action',
    {
      schema: {
        tags: ['research'],
        params: IdParam,
        body: z
          .object({
            revision: z.number().int().positive(),
            action: z.enum(['cancel', 'resume']),
            limits: ResearchProfile.pick({
              budgetUsd: true,
              maxPages: true,
              maxSearches: true,
            }).optional(),
          })
          .strict(),
        response: { 200: z.object({ status: z.literal('recorded') }) },
      },
    },
    async (req) => {
      await store.action(
        ctxOf(req),
        req.params.id,
        req.body.revision,
        req.body.action,
        req.body.limits,
      );
      return { status: 'recorded' as const };
    },
  );
  app.post(
    '/research/candidates/:id/review',
    {
      schema: {
        tags: ['research'],
        params: IdParam,
        body: ResearchReview,
        response: { 200: z.object({ status: z.literal('recorded') }) },
      },
    },
    async (req) => {
      await store.review(ctxOf(req), req.params.id, req.body);
      return { status: 'recorded' as const };
    },
  );
  const History = z.array(
    z.object({
      id: z.uuid(),
      revision: z.number().int(),
      actor_id: z.uuid(),
      created_at: z.string(),
      decision: ResearchReview,
    }),
  );
  app.get(
    '/research/candidates/:id/reviews',
    {
      schema: { tags: ['research'], params: IdParam, response: { 200: History } },
    },
    async (req) => {
      const ctx = read(req);
      return store.transaction(ctx, async (_tx, sql) => {
        await store.candidate(sql, ctx.tenantId, req.params.id);
        const rows = await sql.query(
          'SELECT id,revision,actor_id,created_at,decision FROM research_reviews WHERE tenant_id=$1 AND candidate_id=$2 ORDER BY created_at DESC,id LIMIT 100',
          [ctx.tenantId, req.params.id],
        );
        return History.parse(rows.rows);
      });
    },
  );
  app.get(
    '/research/pages/:id',
    {
      schema: {
        tags: ['research'],
        params: IdParam,
        response: { 200: ResearchPage.extend({ text: z.string().max(24000) }) },
      },
    },
    async (req) => {
      const ctx = read(req);
      return ResearchPage.extend({ text: z.string().max(24000) }).parse(
        await store.transaction(ctx, (_tx, sql) => store.page(sql, ctx.tenantId, req.params.id)),
      );
    },
  );
}
