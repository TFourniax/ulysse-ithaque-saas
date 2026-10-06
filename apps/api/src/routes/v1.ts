import {
  Analysis,
  AuditPage,
  ChangeRoleBody,
  CompanyContext as CompanyContextDto,
  Connection as ConnectionDto,
  CreateConnectionBody,
  DecisionBody,
  Doctrine as DoctrineDto,
  DraftDoctrineBody,
  IdempotencyHeaders,
  IdParam,
  ListQuery,
  Me,
  Member,
  MutationResult,
  OpportunityPage,
  RecommendationDetail,
  RecommendationListQuery,
  QualityReport,
  QualityReportQuery,
  RecommendationPage,
  RevisionBody,
  RuleCatalogEntry,
  SelectTenantBody,
  SyncRequestBody,
  SyncRun,
  UpdateContextBody,
  UserIdParam,
  ValidateDoctrineBody,
} from '@ulysse/contracts';
import type { Context, IdGenerator, ServiceDeps } from '@ulysse/domain';
import {
  can,
  CompanyContextService,
  ConnectionService,
  DoctrineService,
  effectiveStatus,
  MemberService,
  QueryService,
  ReviewService,
} from '@ulysse/domain';
import { catalogOf } from '@ulysse/connectors';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { ApiDeps } from '../deps.ts';
import {
  analysisDto,
  auditDto,
  connectionDto,
  contextDto,
  doctrineDto,
  evidenceDto,
  memberDto,
  opportunityDto,
  recommendationDto,
  syncRunDto,
} from '../dto.ts';
import type { Authenticated } from '../http.ts';
import { checkCsrf, contextFor, HttpError, permissionsFor, sessionCookieName } from '../http.ts';

declare module 'fastify' {
  interface FastifyRequest {
    auth: Authenticated | null;
  }
}

const ids: IdGenerator = { next: () => crypto.randomUUID() };

function authOf(request: FastifyRequest): Authenticated {
  if (!request.auth) throw new HttpError(401, 'UNAUTHENTICATED', 'Authentification requise.');
  return request.auth;
}

export async function registerV1Routes(scope: FastifyInstance, deps: ApiDeps): Promise<void> {
  const app = scope.withTypeProvider<ZodTypeProvider>();
  const { config, sessions, identity, uow, registry } = deps;
  const serviceDeps: ServiceDeps = { uow, clock: deps.clock, ids, rules: deps.rules };
  const queries = new QueryService(serviceDeps);
  const review = new ReviewService(serviceDeps);
  const connections = new ConnectionService(serviceDeps, catalogOf(registry));
  const doctrines = new DoctrineService(serviceDeps);
  const contexts = new CompanyContextService(serviceDeps);
  const members = new MemberService(serviceDeps);

  app.decorateRequest('auth', null);
  // Every /v1 call re-reads the session, the user status and the memberships from the
  // database: a revoked membership or disabled user loses access on the next request.
  app.addHook('preHandler', async (request) => {
    const token = request.cookies[sessionCookieName(config)];
    if (!token) throw new HttpError(401, 'UNAUTHENTICATED', 'Authentification requise.');
    const session = await sessions.resolve(token);
    if (!session) throw new HttpError(401, 'UNAUTHENTICATED', 'Session expirée.');
    const principal = await identity.loadPrincipal(session.userId);
    if (!principal || principal.status !== 'active') {
      await sessions.revoke(session.tokenHash);
      throw new HttpError(401, 'UNAUTHENTICATED', 'Compte désactivé.');
    }
    const membership =
      principal.memberships.find((m) => m.tenantId === session.activeTenantId) ?? null;
    if (session.activeTenantId !== null && !membership)
      await sessions.setActiveTenant(session.tokenHash, null);
    checkCsrf(request, token, sessions, config);
    request.auth = {
      token,
      session: { ...session, activeTenantId: membership?.tenantId ?? null },
      principal,
      membership,
    };
  });

  const ctxOf = (request: FastifyRequest): Context => contextFor(authOf(request), request.id);

  async function memberNames(ctx: Context): Promise<Map<string, string>> {
    return uow.run(
      ctx,
      async (tx) => new Map((await tx.listMembers()).map((m) => [m.userId, m.displayName])),
    );
  }

  function me(auth: Authenticated) {
    return {
      user: {
        id: auth.principal.userId,
        displayName: auth.principal.displayName,
        email: auth.principal.email,
      },
      tenants: auth.principal.memberships.map((m) => ({
        id: m.tenantId,
        slug: m.slug,
        name: m.name,
        role: m.role,
      })),
      activeTenant: auth.membership
        ? {
            id: auth.membership.tenantId,
            slug: auth.membership.slug,
            name: auth.membership.name,
            role: auth.membership.role,
            permissions: permissionsFor(auth),
          }
        : null,
      csrfToken: sessions.csrfTokenFor(auth.token),
      session: { expiresAt: auth.session.expiresAt, idleExpiresAt: auth.session.idleExpiresAt },
    };
  }

  // Identity and tenant selection -------------------------------------------------
  app.get('/me', { schema: { tags: ['session'], response: { 200: Me } } }, async (request) =>
    me(authOf(request)),
  );

  app.put(
    '/session/tenant',
    { schema: { tags: ['session'], body: SelectTenantBody, response: { 200: Me } } },
    async (request) => {
      const auth = authOf(request);
      const membership = auth.principal.memberships.find(
        (m) => m.tenantId === request.body.tenantId,
      );
      if (!membership)
        throw new HttpError(403, 'FORBIDDEN', "Vous n'êtes pas membre actif de cette entreprise.");
      await sessions.setActiveTenant(auth.session.tokenHash, membership.tenantId);
      return me({
        ...auth,
        membership,
        session: { ...auth.session, activeTenantId: membership.tenantId },
      });
    },
  );

  // Recommendations ---------------------------------------------------------------
  app.get(
    '/recommendations',
    {
      schema: {
        tags: ['recommendations'],
        querystring: RecommendationListQuery,
        response: { 200: RecommendationPage },
      },
    },
    async (request) => {
      const page = await queries.listRecommendations(ctxOf(request), {
        view: request.query.view ?? 'open',
        limit: request.query.limit ?? 25,
        cursor: request.query.cursor ?? null,
        ...(request.query.kind ? { kind: request.query.kind } : {}),
      });
      return { items: page.items.map(recommendationDto), nextCursor: page.nextCursor };
    },
  );

  app.get(
    '/recommendations/:id',
    {
      schema: {
        tags: ['recommendations'],
        params: IdParam,
        response: { 200: RecommendationDetail },
      },
    },
    async (request) => {
      const ctx = ctxOf(request);
      const detail = await queries.getRecommendation(ctx, request.params.id);
      const names = await memberNames(ctx);
      const rec = detail.recommendation;
      const open = effectiveStatus(rec, deps.clock.now().getTime());
      return {
        recommendation: recommendationDto(rec),
        evidence: detail.evidence.map(evidenceDto),
        evidenceState: detail.evidenceState,
        revisions: detail.revisions.map((r) => ({
          contentRevision: r.contentRevision,
          proposedAction: r.proposedAction,
          note: r.note,
          createdBy: r.createdBy,
          createdAt: r.createdAt,
        })),
        decisions: detail.decisions.map((d) => ({
          id: d.id,
          revision: d.revision,
          contentRevision: d.contentRevision,
          actorId: d.actorId,
          decision: d.decision,
          reason: d.reason,
          quality: d.quality,
          createdAt: d.createdAt,
        })),
        history: detail.history.map((e) => auditDto(e, names)),
        permissions: {
          canDecide:
            can(ctx, 'recommendation:decide') &&
            (open === 'pending' || open === 'draft' || open === 'expired') &&
            (rec.status === 'pending' || rec.status === 'draft'),
          canRevise: can(ctx, 'recommendation:revise') && (open === 'pending' || open === 'draft'),
        },
      };
    },
  );

  app.post(
    '/recommendations/:id/decisions',
    {
      schema: {
        tags: ['recommendations'],
        params: IdParam,
        headers: IdempotencyHeaders,
        body: DecisionBody,
        response: { 200: MutationResult },
      },
    },
    async (request) => {
      const ctx = ctxOf(request);
      const result = await review.decide(
        ctx,
        request.params.id,
        {
          ...request.body,
          reason: request.body.reason ?? null,
          quality: request.body.quality ?? null,
        },
        request.headers['idempotency-key'],
      );
      return {
        recommendation: recommendationDto({
          ...result.recommendation,
          effectiveStatus: effectiveStatus(result.recommendation, deps.clock.now().getTime()),
        }),
        replayed: result.replayed,
      };
    },
  );

  app.post(
    '/recommendations/:id/revisions',
    {
      schema: {
        tags: ['recommendations'],
        params: IdParam,
        headers: IdempotencyHeaders,
        body: RevisionBody,
        response: { 200: MutationResult },
      },
    },
    async (request) => {
      const ctx = ctxOf(request);
      const result = await review.revise(
        ctx,
        request.params.id,
        { ...request.body, note: request.body.note ?? null },
        request.headers['idempotency-key'],
      );
      return {
        recommendation: recommendationDto({
          ...result.recommendation,
          effectiveStatus: effectiveStatus(result.recommendation, deps.clock.now().getTime()),
        }),
        replayed: result.replayed,
      };
    },
  );

  // Context: opportunities, analyses ------------------------------------------------
  app.get(
    '/opportunities',
    {
      schema: {
        tags: ['context'],
        querystring: ListQuery.extend({ includeDeleted: z.enum(['true', 'false']).optional() }),
        response: { 200: OpportunityPage },
      },
    },
    async (request) => {
      const page = await queries.listOpportunities(ctxOf(request), {
        limit: request.query.limit ?? 50,
        cursor: request.query.cursor ?? null,
        includeDeleted: request.query.includeDeleted === 'true',
      });
      return { items: page.items.map(opportunityDto), nextCursor: page.nextCursor };
    },
  );

  app.get(
    '/analyses',
    {
      schema: {
        tags: ['context'],
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(100).optional() }),
        response: { 200: z.array(Analysis) },
      },
    },
    async (request) => {
      return (await queries.listAnalyses(ctxOf(request), request.query.limit ?? 20)).map(
        analysisDto,
      );
    },
  );

  app.get(
    '/reports/quality',
    {
      schema: {
        tags: ['context'],
        querystring: QualityReportQuery,
        response: { 200: QualityReport },
      },
    },
    async (request) =>
      queries.qualityReport(ctxOf(request), {
        from: request.query.from ?? null,
        to: request.query.to ?? null,
      }),
  );

  // Connections -----------------------------------------------------------------------
  app.get('/connectors', { schema: { tags: ['connections'] } }, async (request) => {
    ctxOf(request);
    return [...registry.values()].map((c) => ({
      provider: c.definition.provider,
      displayName: c.definition.displayName,
      kind: c.definition.kind,
      scopes: [...c.definition.authorization.scopes],
      authorization: c.definition.authorization.type,
      capabilities: { ...c.definition.capabilities },
      fields: c.definition.fields,
    }));
  });

  app.get(
    '/connections',
    { schema: { tags: ['connections'], response: { 200: z.array(ConnectionDto) } } },
    async (request) => {
      return (await connections.list(ctxOf(request))).map((c) => connectionDto(c, registry));
    },
  );

  app.post(
    '/connections',
    {
      schema: {
        tags: ['connections'],
        body: CreateConnectionBody,
        response: { 201: ConnectionDto },
      },
    },
    async (request, reply) => {
      const created = await connections.create(ctxOf(request), request.body);
      return reply.status(201).send(connectionDto(created, registry));
    },
  );

  app.post(
    '/connections/:id/sync',
    {
      schema: {
        tags: ['connections'],
        params: IdParam,
        body: SyncRequestBody.optional(),
        response: { 202: z.object({ queued: z.literal(true) }) },
      },
    },
    async (request, reply) => {
      const result = await connections.requestSync(ctxOf(request), request.params.id, {
        replay: request.body?.replay ?? false,
      });
      return reply.status(202).send(result);
    },
  );

  app.delete(
    '/connections/:id',
    { schema: { tags: ['connections'], params: IdParam, response: { 200: ConnectionDto } } },
    async (request) => {
      return connectionDto(await connections.revoke(ctxOf(request), request.params.id), registry);
    },
  );

  app.get(
    '/connections/:id/sync-runs',
    { schema: { tags: ['connections'], params: IdParam, response: { 200: z.array(SyncRun) } } },
    async (request) => {
      return (await connections.syncRuns(ctxOf(request), request.params.id)).map(syncRunDto);
    },
  );

  // Audit -----------------------------------------------------------------------------
  app.get(
    '/audit',
    {
      schema: {
        tags: ['audit'],
        querystring: ListQuery.extend({ resourceId: z.string().max(100).optional() }),
        response: { 200: AuditPage },
      },
    },
    async (request) => {
      const ctx = ctxOf(request);
      const page = await queries.listAudit(ctx, {
        limit: request.query.limit ?? 50,
        cursor: request.query.cursor ?? null,
        ...(request.query.resourceId ? { resourceId: request.query.resourceId } : {}),
      });
      const names = await memberNames(ctx);
      return { items: page.items.map((e) => auditDto(e, names)), nextCursor: page.nextCursor };
    },
  );

  // Doctrine and company context -------------------------------------------------------
  app.get(
    '/rules',
    { schema: { tags: ['doctrine'], response: { 200: z.array(RuleCatalogEntry) } } },
    async (request) => {
      ctxOf(request);
      return [...deps.rules.values()].map((r) => ({
        id: r.id,
        version: r.version,
        kind: r.kind,
        label: r.label,
        fictional: r.fictional,
        parameters: r.parameters.map((p) => ({ ...p })),
      }));
    },
  );

  app.get(
    '/doctrines',
    { schema: { tags: ['doctrine'], response: { 200: z.array(DoctrineDto) } } },
    async (request) => {
      return (await doctrines.list(ctxOf(request))).map(doctrineDto);
    },
  );

  app.post(
    '/doctrines',
    { schema: { tags: ['doctrine'], body: DraftDoctrineBody, response: { 201: DoctrineDto } } },
    async (request, reply) => {
      const body = request.body;
      const draft = await doctrines.draft(ctxOf(request), {
        key: body.key,
        title: body.title,
        origin: body.origin,
        usageRights: body.usageRights,
        content: body.content,
      });
      return reply.status(201).send(doctrineDto(draft));
    },
  );

  app.post(
    '/doctrines/:id/validate',
    {
      schema: {
        tags: ['doctrine'],
        params: IdParam,
        body: ValidateDoctrineBody,
        response: { 200: DoctrineDto },
      },
    },
    async (request) => {
      return doctrineDto(
        await doctrines.validate(ctxOf(request), request.params.id, request.body.note ?? null),
      );
    },
  );

  app.post(
    '/doctrines/:id/retire',
    { schema: { tags: ['doctrine'], params: IdParam, response: { 200: DoctrineDto } } },
    async (request) => {
      return doctrineDto(await doctrines.retire(ctxOf(request), request.params.id));
    },
  );

  app.get(
    '/context',
    {
      schema: {
        tags: ['doctrine'],
        response: { 200: z.object({ context: CompanyContextDto.nullable() }) },
      },
    },
    async (request) => {
      const current = await contexts.current(ctxOf(request));
      return { context: current ? contextDto(current) : null };
    },
  );

  app.put(
    '/context',
    {
      schema: { tags: ['doctrine'], body: UpdateContextBody, response: { 200: CompanyContextDto } },
    },
    async (request) => {
      return contextDto(
        await contexts.update(ctxOf(request), {
          content: request.body.content,
          note: request.body.note ?? null,
        }),
      );
    },
  );

  // Members -------------------------------------------------------------------------------
  app.get(
    '/members',
    { schema: { tags: ['admin'], response: { 200: z.array(Member) } } },
    async (request) => {
      return (await members.list(ctxOf(request))).map(memberDto);
    },
  );

  app.patch(
    '/members/:userId',
    {
      schema: {
        tags: ['admin'],
        params: UserIdParam,
        body: ChangeRoleBody,
        response: { 200: Member },
      },
    },
    async (request) => {
      return memberDto(
        await members.changeRole(ctxOf(request), request.params.userId, request.body.role),
      );
    },
  );

  app.delete(
    '/members/:userId',
    { schema: { tags: ['admin'], params: UserIdParam, response: { 200: Member } } },
    async (request) => {
      return memberDto(await members.revoke(ctxOf(request), request.params.userId));
    },
  );
}
