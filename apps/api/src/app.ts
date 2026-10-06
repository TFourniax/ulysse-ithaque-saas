import { existsSync } from 'node:fs';
import path from 'node:path';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import { API_VERSION, Health } from '@ulysse/contracts';
import { correlationIdFrom } from '@ulysse/observability';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import type { ApiDeps } from './deps.ts';
import { HttpError, httpErrorFromDomain, isDomainError, sendError } from './http.ts';
import { registerAuthRoutes } from './routes/auth.ts';
import { registerV1Routes } from './routes/v1.ts';

export type { ApiDeps } from './deps.ts';

const BODY_LIMIT_BYTES = 64 * 1024;

export async function buildApp(deps: ApiDeps): Promise<FastifyInstance> {
  const { config, metrics } = deps;
  const loggerInstance: FastifyBaseLogger = deps.logger;
  const app = Fastify({
    loggerInstance,
    bodyLimit: BODY_LIMIT_BYTES,
    trustProxy: config.NODE_ENV === 'production',
    genReqId: (req) => correlationIdFrom(req.headers['x-correlation-id']),
    requestIdLogLabel: 'correlationId',
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cookie);
  await app.register(rateLimit, {
    global: true,
    max: config.RATE_LIMIT_PER_MINUTE,
    timeWindow: '1 minute',
    // Per session when authenticated, otherwise per client address.
    keyGenerator: (req) => {
      const token = req.cookies[config.COOKIE_SECURE ? '__Host-ulysse_session' : 'ulysse_session'];
      return token ? `s:${token.slice(0, 16)}` : `ip:${req.ip}`;
    },
    errorResponseBuilder: (req, ctx) => ({
      statusCode: 429,
      error: {
        code: 'RATE_LIMITED',
        message: `Trop de requêtes, réessayez dans ${String(Math.ceil(ctx.ttl / 1000))} s.`,
        correlationId: req.id,
      },
    }),
  });
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Ulysse API',
        version: API_VERSION,
        description:
          'API v1 : session OIDC côté serveur (cookie HttpOnly), entreprise active choisie côté serveur, CSRF requis sur les mutations.',
      },
      components: {
        securitySchemes: {
          session: { type: 'apiKey', in: 'cookie', name: 'ulysse_session' },
          csrf: { type: 'apiKey', in: 'header', name: 'X-CSRF-Token' },
        },
      },
    },
    transform: jsonSchemaTransform,
  });

  app.addHook('onRequest', async (request, reply) => {
    void reply.header('x-correlation-id', request.id);
  });
  app.addHook('onSend', async (request, reply, payload) => {
    void reply.header('x-content-type-options', 'nosniff');
    void reply.header('referrer-policy', 'same-origin');
    void reply.header('x-frame-options', 'DENY');
    void reply.header(
      'content-security-policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
    );
    if (request.url.startsWith('/v1') || request.url.startsWith('/auth'))
      void reply.header('cache-control', 'no-store');
    return payload;
  });
  app.addHook('onResponse', async (request, reply) => {
    const route = request.routeOptions.url ?? 'unmatched';
    metrics.httpRequests.inc({
      method: request.method,
      route,
      status: `${String(Math.floor(reply.statusCode / 100))}xx`,
    });
    metrics.httpDuration.observe({ method: request.method, route }, reply.elapsedTime / 1000);
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) return sendError(reply, error, request.id);
    if (isDomainError(error)) {
      metrics.domainErrors.inc({ code: error.code });
      return sendError(reply, httpErrorFromDomain(error), request.id);
    }
    if (hasZodFastifySchemaValidationErrors(error)) {
      const detail = error.validation
        .slice(0, 5)
        .map((issue) => `${issue.instancePath || '/'} ${issue.message ?? ''}`.trim())
        .join('; ');
      return sendError(
        reply,
        new HttpError(422, 'VALIDATION', 'Requête invalide.', detail),
        request.id,
      );
    }
    const code = (error as { code?: unknown }).code;
    if (code === 'FST_ERR_CTP_BODY_TOO_LARGE')
      return sendError(
        reply,
        new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Requête trop volumineuse.'),
        request.id,
      );
    if (
      code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' ||
      code === 'FST_ERR_CTP_EMPTY_JSON_BODY' ||
      code === 'FST_ERR_CTP_INVALID_JSON_BODY'
    ) {
      return sendError(
        reply,
        new HttpError(422, 'VALIDATION', 'Corps de requête invalide.'),
        request.id,
      );
    }
    if ((error as { statusCode?: unknown }).statusCode === 429) {
      return sendError(reply, new HttpError(429, 'RATE_LIMITED', 'Trop de requêtes.'), request.id);
    }
    if (
      typeof code === 'string' &&
      (code.startsWith('08') || code === 'ECONNREFUSED' || code === '57P01')
    ) {
      request.log.error({ err: { code } }, 'database unavailable');
      return sendError(
        reply,
        new HttpError(503, 'UNAVAILABLE', 'Service temporairement indisponible.'),
        request.id,
      );
    }
    request.log.error({ err: error }, 'unhandled error');
    return sendError(reply, new HttpError(500, 'INTERNAL', 'Erreur interne.'), request.id);
  });

  app.get('/health/live', { schema: { hide: true } }, async () => ({ status: 'ok' }));
  app.get(
    '/health/ready',
    { schema: { response: { 200: Health, 503: Health } } },
    async (_request, reply) => {
      try {
        await deps.identity.ping();
        return { status: 'ok' as const, checks: { database: 'ok' as const } };
      } catch {
        return reply
          .status(503)
          .send({ status: 'unavailable' as const, checks: { database: 'failed' as const } });
      }
    },
  );
  app.get('/metrics', { schema: { hide: true } }, async (request, reply) => {
    const expected = config.METRICS_TOKEN;
    if (!expected || request.headers.authorization !== `Bearer ${expected}`) {
      return reply
        .status(404)
        .send({ error: { code: 'NOT_FOUND', message: 'Not found', correlationId: request.id } });
    }
    return reply.type(metrics.registry.contentType).send(await metrics.registry.metrics());
  });
  app.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger());

  await app.register(async (scope) => registerAuthRoutes(scope, deps));
  await app.register(async (scope) => registerV1Routes(scope, deps), { prefix: '/v1' });

  const webDist = config.WEB_DIST_DIR ? path.resolve(config.WEB_DIST_DIR) : null;
  if (webDist && existsSync(path.join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: '/',
      index: ['index.html'],
      // Hashed build assets are immutable; the HTML entry point is always revalidated.
      setHeaders: (res, filePath) => {
        void res.header(
          'cache-control',
          filePath.includes(`${path.sep}assets${path.sep}`)
            ? 'public, max-age=31536000, immutable'
            : 'no-cache',
        );
      },
    });
    app.setNotFoundHandler((request, reply) => {
      const isApi =
        request.url.startsWith('/v1') ||
        request.url.startsWith('/auth') ||
        request.url.startsWith('/health');
      if (request.method === 'GET' && !isApi && request.headers.accept?.includes('text/html')) {
        return reply.type('text/html').sendFile('index.html');
      }
      return sendError(
        reply,
        new HttpError(404, 'NOT_FOUND', 'Ressource introuvable.'),
        request.id,
      );
    });
  } else {
    app.setNotFoundHandler((request, reply) =>
      sendError(reply, new HttpError(404, 'NOT_FOUND', 'Ressource introuvable.'), request.id),
    );
  }
  return app;
}
