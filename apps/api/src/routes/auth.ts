import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { ApiDeps } from '../deps.ts';
import {
  calculatePKCECodeChallenge,
  OidcError,
  randomNonce,
  randomPKCECodeVerifier,
  randomState,
} from '../auth/oidc.ts';
import { randomToken } from '../auth/sessions.ts';
import {
  checkCsrf,
  cookieOptions,
  HttpError,
  loginCookieName,
  safeReturnTo,
  sessionCookieName,
} from '../http.ts';

const AUTH_RATE_LIMIT = { max: 30, timeWindow: '1 minute' };

/**
 * Authorization Code + PKCE + state + nonce, run by the backend (BFF). Tokens from
 * the identity provider never reach the browser; only an opaque session cookie does.
 */
export async function registerAuthRoutes(scope: FastifyInstance, deps: ApiDeps): Promise<void> {
  const app = scope.withTypeProvider<ZodTypeProvider>();
  const { config, sessions, oidc, identity } = deps;
  const callbackUrl = new URL('/auth/callback', config.PUBLIC_ORIGIN).toString();
  const failure = (reason: string) => `/?login_error=${reason}`;

  app.get(
    '/auth/login',
    {
      config: { rateLimit: AUTH_RATE_LIMIT },
      schema: {
        tags: ['auth'],
        querystring: z.object({ returnTo: z.string().max(512).optional() }),
      },
    },
    async (request, reply) => {
      const state = randomState();
      const nonce = randomNonce();
      const codeVerifier = randomPKCECodeVerifier();
      const binding = randomToken();
      await sessions.startLogin(
        { codeVerifier, nonce, returnTo: safeReturnTo(request.query.returnTo) },
        state,
        binding,
      );
      void reply.setCookie(loginCookieName(config), binding, cookieOptions(config, 600));
      const url = oidc.authorizationUrl({
        redirectUri: callbackUrl,
        state,
        nonce,
        codeChallenge: await calculatePKCECodeChallenge(codeVerifier),
      });
      return reply.redirect(url.toString(), 302);
    },
  );

  app.get(
    '/auth/callback',
    {
      config: { rateLimit: AUTH_RATE_LIMIT },
      schema: {
        tags: ['auth'],
        querystring: z.object({
          code: z.string().max(2048).optional(),
          state: z.string().max(512).optional(),
          error: z.string().max(200).optional(),
        }),
      },
    },
    async (request, reply) => {
      const loginCookie = request.cookies[loginCookieName(config)];
      void reply.clearCookie(loginCookieName(config), { path: '/' });
      if (request.query.error) return reply.redirect(failure('denied'), 302);
      const { code, state } = request.query;
      if (!code || !state) return reply.redirect(failure('invalid_request'), 302);
      const attempt = await sessions.consumeLogin(state, loginCookie);
      if (!attempt) return reply.redirect(failure('expired'), 302);
      let verified;
      try {
        verified = await oidc.exchange(new URL(request.url, config.PUBLIC_ORIGIN), {
          state,
          nonce: attempt.nonce,
          codeVerifier: attempt.codeVerifier,
        });
      } catch (error) {
        if (error instanceof OidcError) {
          const cause =
            error.cause instanceof Error
              ? `${error.cause.name}: ${error.cause.message}`
              : undefined;
          request.log.warn(
            { reason: error.message, cause },
            'login rejected: identity token not verified',
          );
          return reply.redirect(failure('invalid_token'), 302);
        }
        throw error;
      }
      const user = await identity.findUserBySubject(verified.issuer, verified.subject);
      if (!user) {
        request.log.warn('login rejected: identity not provisioned');
        return reply.redirect(failure('not_provisioned'), 302);
      }
      if (user.status !== 'active') return reply.redirect(failure('disabled'), 302);
      await identity.recordLogin(user.id, {
        email: verified.email,
        displayName: verified.displayName,
      });
      const principal = await identity.loadPrincipal(user.id);
      const only = principal?.memberships.length === 1 ? principal.memberships[0] : undefined;
      const { token } = await sessions.create(user.id, only?.tenantId ?? null);
      void reply.setCookie(
        sessionCookieName(config),
        token,
        cookieOptions(config, config.SESSION_ABSOLUTE_HOURS * 3600),
      );
      request.log.info({ userId: user.id }, 'session created');
      return reply.redirect(attempt.returnTo, 302);
    },
  );

  app.post(
    '/auth/logout',
    { schema: { tags: ['auth'], response: { 200: z.object({ redirectTo: z.string() }) } } },
    async (request, reply) => {
      const token = request.cookies[sessionCookieName(config)];
      if (token) {
        const session = await sessions.resolve(token);
        if (session) {
          checkCsrf(request, token, sessions, config);
          await sessions.revoke(session.tokenHash);
        }
      } else {
        throw new HttpError(401, 'UNAUTHENTICATED', 'Session absente.');
      }
      void reply.clearCookie(sessionCookieName(config), { path: '/' });
      const endSession = oidc.endSessionUrl(new URL('/', config.PUBLIC_ORIGIN).toString());
      return { redirectTo: endSession?.toString() ?? '/' };
    },
  );
}
