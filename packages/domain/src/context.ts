import { DomainError, ensure } from './errors.ts';

export const ROLES = ['owner', 'reviewer', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'recommendation:read',
  'recommendation:decide',
  'recommendation:revise',
  'opportunity:read',
  'connection:read',
  'connection:manage',
  'connection:sync',
  'audit:read',
  'member:read',
  'member:manage',
  'doctrine:read',
  'doctrine:manage',
  'doctrine:validate',
  'context:read',
  'context:manage',
  'analysis:read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Capabilities a background service identity may hold for one tenant (and optionally one connection). */
export const SERVICE_SCOPES = [
  'source:ingest',
  'analysis:run',
  'recommendation:maintain',
  'connection:operate',
] as const;
export type ServiceScope = (typeof SERVICE_SCOPES)[number];

export type UserActor = Readonly<{ kind: 'user'; userId: string; role: Role }>;
export type ServiceActor = Readonly<{
  kind: 'service';
  serviceId: string;
  scopes: readonly ServiceScope[];
  /** When set, the identity is restricted to this connection for ingestion. */
  connectionId?: string;
}>;
export type Actor = UserActor | ServiceActor;

/**
 * Internal representation of checks already performed by a trusted adapter
 * (API after session + membership lookup, worker after job validation).
 * Never deserialize it from a browser request.
 */
export type Context = Readonly<{
  tenantId: string;
  actor: Actor;
  correlationId: string;
}>;

const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set(PERMISSIONS),
  reviewer: new Set<Permission>([
    'recommendation:read',
    'recommendation:decide',
    'recommendation:revise',
    'opportunity:read',
    'connection:read',
    'connection:sync',
    'audit:read',
    'member:read',
    'doctrine:read',
    'context:read',
    'analysis:read',
  ]),
  viewer: new Set<Permission>([
    'recommendation:read',
    'opportunity:read',
    'connection:read',
    'doctrine:read',
    'context:read',
    'analysis:read',
  ]),
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

export function assertContext(ctx: Context): void {
  // Runtime check of a value typed by the caller: adapters may still pass malformed data.
  const raw: unknown = ctx;
  ensure(typeof raw === 'object' && raw !== null, 'INVALID_CONTEXT');
  const candidate = raw as { tenantId?: unknown; correlationId?: unknown; actor?: unknown };
  ensure(isUuid(candidate.tenantId), 'INVALID_CONTEXT', 'tenantId');
  ensure(
    typeof candidate.correlationId === 'string' && candidate.correlationId.length <= 128,
    'INVALID_CONTEXT',
  );
  ensure(
    typeof candidate.actor === 'object' && candidate.actor !== null,
    'INVALID_CONTEXT',
    'actor',
  );
  const actor = candidate.actor as {
    kind?: unknown;
    userId?: unknown;
    role?: unknown;
    serviceId?: unknown;
    scopes?: unknown;
    connectionId?: unknown;
  };
  if (actor.kind === 'user') {
    ensure(isUuid(actor.userId), 'INVALID_CONTEXT', 'userId');
    ensure((ROLES as readonly unknown[]).includes(actor.role), 'INVALID_ROLE');
  } else if (actor.kind === 'service') {
    ensure(
      typeof actor.serviceId === 'string' && /^[a-z][a-z0-9-]{1,63}$/.test(actor.serviceId),
      'INVALID_CONTEXT',
    );
    ensure(
      Array.isArray(actor.scopes) &&
        actor.scopes.every((s: unknown) => (SERVICE_SCOPES as readonly unknown[]).includes(s)),
      'INVALID_CONTEXT',
    );
    ensure(actor.connectionId === undefined || isUuid(actor.connectionId), 'INVALID_CONTEXT');
  } else {
    throw new DomainError('INVALID_CONTEXT', 'actor.kind');
  }
}

export function can(ctx: Context, permission: Permission): boolean {
  return ctx.actor.kind === 'user' && ROLE_PERMISSIONS[ctx.actor.role].has(permission);
}

export function requirePermission(ctx: Context, permission: Permission): UserActor {
  assertContext(ctx);
  ensure(ctx.actor.kind === 'user', 'FORBIDDEN', permission);
  ensure(can(ctx, permission), 'FORBIDDEN', permission);
  return ctx.actor;
}

export function requireScope(
  ctx: Context,
  scope: ServiceScope,
  connectionId?: string,
): ServiceActor {
  assertContext(ctx);
  const actor = ctx.actor;
  ensure(actor.kind === 'service', 'FORBIDDEN', scope);
  ensure(actor.scopes.includes(scope), 'FORBIDDEN', scope);
  if (connectionId !== undefined && actor.connectionId !== undefined) {
    ensure(actor.connectionId === connectionId, 'FORBIDDEN', 'connection scope');
  }
  return actor;
}

export function permissionsOf(role: Role): Permission[] {
  return PERMISSIONS.filter((p) => ROLE_PERMISSIONS[role].has(p));
}

/** Stable audit identifier: `user:<uuid>` or `service:<id>`. */
export function actorRef(actor: Actor): { type: 'user' | 'service'; id: string } {
  return actor.kind === 'user'
    ? { type: 'user', id: actor.userId }
    : { type: 'service', id: actor.serviceId };
}
