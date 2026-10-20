import {
  CreateWorkflowBody,
  IdParam,
  WorkflowRun,
  WorkspaceSource,
  WorkspaceSourceBody,
  WorkflowReviewBody,
} from '@ulysse/contracts';
import type { Context } from '@ulysse/domain';
import { requirePermission } from '@ulysse/domain';
import { PgWorkspaceStore } from '@ulysse/database';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { ApiDeps } from '../deps.ts';

export function registerWorkflowRoutes(
  scope: FastifyInstance,
  deps: ApiDeps,
  ctxOf: (req: FastifyRequest) => Context,
): void {
  const app = scope.withTypeProvider<ZodTypeProvider>();
  const store = new PgWorkspaceStore(deps.pool);
  app.get(
    '/workspace/sources',
    { schema: { tags: ['workspace'], response: { 200: z.array(WorkspaceSource) } } },
    async (req) => {
      const ctx = ctxOf(req);
      requirePermission(ctx, 'context:read');
      return z.array(WorkspaceSource).parse(await store.sources(ctx));
    },
  );
  app.post(
    '/workspace/sources',
    {
      schema: {
        tags: ['workspace'],
        body: WorkspaceSourceBody,
        response: { 201: WorkspaceSource },
      },
    },
    async (req, reply) => {
      const source = await store.saveSource(ctxOf(req), req.body);
      return reply.status(201).send(WorkspaceSource.parse(source));
    },
  );
  app.put(
    '/workspace/sources/:id',
    {
      schema: {
        tags: ['workspace'],
        params: IdParam,
        body: z
          .object({ revision: z.number().int().positive(), source: WorkspaceSourceBody })
          .strict(),
        response: { 200: WorkspaceSource },
      },
    },
    async (req) =>
      WorkspaceSource.parse(
        await store.saveSource(ctxOf(req), req.body.source, {
          id: req.params.id,
          revision: req.body.revision,
        }),
      ),
  );
  app.delete(
    '/workspace/sources/:id',
    {
      schema: {
        tags: ['workspace'],
        params: IdParam,
        body: z.object({ revision: z.number().int().positive() }).strict(),
        response: { 200: z.object({ status: z.literal('withdrawn') }) },
      },
    },
    async (req) => {
      await store.withdraw(ctxOf(req), req.params.id, req.body.revision);
      return { status: 'withdrawn' as const };
    },
  );
  app.get(
    '/workflows',
    { schema: { tags: ['workflows'], response: { 200: z.array(WorkflowRun) } } },
    async (req) => z.array(WorkflowRun).parse(await store.listWorkflows(ctxOf(req))),
  );
  app.post(
    '/workflows',
    {
      schema: {
        tags: ['workflows'],
        body: CreateWorkflowBody,
        response: { 202: z.object({ id: z.uuid() }) },
      },
    },
    async (req, reply) => {
      const id = await store.create(ctxOf(req), req.body, deps.config.ULYSSE_ANALYSIS_MODE);
      return reply.status(202).send({ id });
    },
  );
  app.post(
    '/workflows/:id/review',
    {
      schema: {
        tags: ['workflows'],
        params: IdParam,
        body: WorkflowReviewBody,
        response: { 200: z.object({ status: z.literal('recorded') }) },
      },
    },
    async (req) => {
      await store.review(ctxOf(req), req.params.id, req.body.revision, req.body.decision);
      return { status: 'recorded' as const };
    },
  );
}
