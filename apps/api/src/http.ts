import type { ErrorCode } from '@ulysse/contracts';
import type { Principal, PrincipalMembership } from '@ulysse/database';
import type { Context, DomainErrorCode, Permission } from '@ulysse/domain';
import { can, DomainError, permissionsOf } from '@ulysse/domain';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { SessionRecord, SessionStore } from './auth/sessions.ts';
import { safeEqual } from './auth/sessions.ts';
import type { ApiConfig } from './config.ts';

export class HttpError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly detail: string | undefined;

  constructor(status: number, code: ErrorCode, message: string, detail?: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

/** Stable mapping of business errors to transport (docs/DATA-API.md). */
export function httpErrorFromDomain(error: DomainError): HttpError {
  const map: Record<DomainErrorCode, [number, ErrorCode, string]> = {
    INVALID_INPUT: [422, 'VALIDATION', 'Entrée invalide.'],
    INVALID_CONTEXT: [403, 'FORBIDDEN', 'Contexte invalide.'],
    INVALID_ROLE: [403, 'FORBIDDEN', 'Rôle invalide.'],
    INVALID_TIMESTAMP: [422, 'VALIDATION', 'Date invalide.'],
    INVALID_VERSION: [422, 'VALIDATION', 'Version invalide.'],
    INVALID_POLICY: [422, 'VALIDATION', 'Paramètres de doctrine invalides.'],
    INVALID_DECISION: [422, 'VALIDATION', 'Décision invalide.'],
    INVALID_REVISION: [422, 'VALIDATION', 'Révision attendue invalide.'],
    INVALID_TIMELINE: [409, 'CONFLICT', 'Chronologie incohérente.'],
    INVALID_TRANSITION: [
      409,
      'INVALID_TRANSITION',
      "Cette transition n'est pas permise dans l'état actuel.",
    ],
    FORBIDDEN: [403, 'FORBIDDEN', 'Permission insuffisante.'],
    NOT_FOUND: [404, 'NOT_FOUND', 'Ressource introuvable.'],
    TENANT_MISMATCH: [404, 'NOT_FOUND', 'Ressource introuvable.'],
    FUTURE_SOURCE: [422, 'VALIDATION', 'Donnée source datée dans le futur.'],
    SOURCE_VERSION_REGRESSION: [409, 'CONFLICT', 'Version source antérieure.'],
    SOURCE_VERSION_CONFLICT: [409, 'CONFLICT', 'Version source en conflit.'],
    SOURCE_TIME_REGRESSION: [409, 'CONFLICT', 'Observation antérieure à la précédente.'],
    REVISION_CONFLICT: [
      409,
      'REVISION_CONFLICT',
      'La proposition a changé depuis son affichage : rechargez-la avant de décider.',
    ],
    IDEMPOTENCY_CONFLICT: [
      409,
      'IDEMPOTENCY_CONFLICT',
      "Clé d'idempotence déjà utilisée pour une autre requête.",
    ],
    ALREADY_DECIDED: [409, 'ALREADY_DECIDED', 'Une décision a déjà été enregistrée.'],
    EXPIRED: [409, 'EXPIRED', 'La proposition a expiré : elle ne peut plus être approuvée.'],
    STALE_EVIDENCE: [
      409,
      'STALE_EVIDENCE',
      'Les preuves ont changé ou ne sont plus assez fraîches : approbation bloquée.',
    ],
    CONNECTION_INACTIVE: [409, 'CONNECTION_INACTIVE', "La connexion n'est pas active."],
    DOCTRINE_NOT_VALIDATED: [409, 'DOCTRINE_NOT_VALIDATED', "La doctrine n'est pas validée."],
    DOCTRINE_RIGHTS: [422, 'DOCTRINE_RIGHTS', "Droits d'usage de doctrine incompatibles."],
  };
  const [status, code, message] = map[error.code];
  return new HttpError(status, code, message, error.detail);
}

export type Authenticated = Readonly<{
  token: string;
  session: SessionRecord;
  principal: Principal;
  membership: PrincipalMembership | null;
}>;

export function sessionCookieName(config: ApiConfig): string {
  return config.COOKIE_SECURE ? '__Host-ulysse_session' : 'ulysse_session';
}

export function loginCookieName(config: ApiConfig): string {
  return config.COOKIE_SECURE ? '__Host-ulysse_login' : 'ulysse_login';
}

export function cookieOptions(config: ApiConfig, maxAgeSeconds: number) {
  return {
    path: '/',
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: 'lax' as const,
    maxAge: maxAgeSeconds,
  };
}

export function contextFor(auth: Authenticated, correlationId: string): Context {
  if (!auth.membership)
    throw new HttpError(403, 'NO_ACTIVE_TENANT', 'Sélectionnez une entreprise.');
  return {
    tenantId: auth.membership.tenantId,
    actor: { kind: 'user', userId: auth.principal.userId, role: auth.membership.role },
    correlationId,
  };
}

export function permissionsFor(auth: Authenticated): string[] {
  return auth.membership ? permissionsOf(auth.membership.role) : [];
}

export function ensurePermission(ctx: Context, permission: Permission): void {
  if (!can(ctx, permission)) throw new HttpError(403, 'FORBIDDEN', 'Permission insuffisante.');
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Mutations require the session-bound CSRF token and, when the browser sends them,
 * a same-origin Origin / Sec-Fetch-Site. SameSite=Lax cookies are a second layer.
 */
export function checkCsrf(
  request: FastifyRequest,
  token: string,
  sessions: SessionStore,
  config: ApiConfig,
): void {
  if (!MUTATING.has(request.method)) return;
  const origin = request.headers.origin;
  if (origin !== undefined && origin !== new URL(config.PUBLIC_ORIGIN).origin) {
    throw new HttpError(403, 'CSRF', 'Origine refusée.');
  }
  const site = request.headers['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin' && site !== 'none')
    throw new HttpError(403, 'CSRF', 'Requête inter-sites refusée.');
  const header = request.headers['x-csrf-token'];
  if (typeof header !== 'string' || !safeEqual(header, sessions.csrfTokenFor(token))) {
    throw new HttpError(403, 'CSRF', 'Jeton anti-CSRF manquant ou invalide.');
  }
}

export function sendError(
  reply: FastifyReply,
  error: HttpError,
  correlationId: string,
): FastifyReply {
  return reply.status(error.status).send({
    error: {
      code: error.code,
      message: error.message,
      correlationId,
      ...(error.detail ? { detail: error.detail } : {}),
    },
  });
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}

/** Same-site relative path only: blocks open redirects such as //evil.example or /\\evil. */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string' || value.length > 512) return '/';
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
  try {
    const parsed = new URL(value, 'http://local.invalid');
    return parsed.origin === 'http://local.invalid' ? parsed.pathname + parsed.search : '/';
  } catch {
    return '/';
  }
}
