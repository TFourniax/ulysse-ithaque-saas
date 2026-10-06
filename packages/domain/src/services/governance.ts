import type { CompanyContext, ContextSource } from '../company-context.ts';
import { validateContextContent } from '../company-context.ts';
import type { Context, Role } from '../context.ts';
import { requirePermission, ROLES } from '../context.ts';
import type { Doctrine, DoctrineOrigin, UsageRights } from '../doctrine.ts';
import {
  DOCTRINE_ORIGINS,
  doctrineContentHash,
  retireDoctrine,
  USAGE_RIGHTS,
  validateDoctrine,
  validateDoctrineContent,
} from '../doctrine.ts';
import { ensure } from '../errors.ts';
import type { Member } from '../records.ts';
import { parameterSpecs } from '../rules.ts';
import { toInstant } from '../time.ts';
import type { ServiceDeps } from './shared.ts';
import { audit, outbox } from './shared.ts';

export type DraftDoctrineInput = Readonly<{
  key: string;
  title: string;
  origin: DoctrineOrigin;
  usageRights: UsageRights;
  content: unknown;
}>;

export class DoctrineService {
  readonly #deps: ServiceDeps;

  constructor(deps: ServiceDeps) {
    this.#deps = deps;
  }

  async list(ctx: Context): Promise<Doctrine[]> {
    requirePermission(ctx, 'doctrine:read');
    return this.#deps.uow.run(ctx, (tx) => tx.listDoctrines());
  }

  /** Versions are immutable: a change is a new draft version that must be validated again. */
  async draft(ctx: Context, input: DraftDoctrineInput): Promise<Doctrine> {
    const actor = requirePermission(ctx, 'doctrine:manage');
    ensure(
      typeof input.key === 'string' && /^[a-z0-9][a-z0-9.-]{1,63}$/.test(input.key),
      'INVALID_INPUT',
      'key',
    );
    ensure(
      typeof input.title === 'string' && input.title.trim().length > 0 && input.title.length <= 200,
      'INVALID_INPUT',
      'title',
    );
    ensure(
      (DOCTRINE_ORIGINS as readonly string[]).includes(input.origin),
      'INVALID_INPUT',
      'origin',
    );
    ensure(
      (USAGE_RIGHTS as readonly string[]).includes(input.usageRights),
      'INVALID_INPUT',
      'usageRights',
    );
    // Only fixtures may be demo-only; licensed content must come from an explicit grant (not implemented: UL-009).
    ensure(
      input.origin !== 'licensed',
      'DOCTRINE_RIGHTS',
      'licensed doctrines require a shared grant',
    );
    ensure((input.usageRights === 'demo-only') === (input.origin === 'fixture'), 'DOCTRINE_RIGHTS');
    const content = validateDoctrineContent(input.content, parameterSpecs(this.#deps.rules));
    const { uow, clock, ids } = this.#deps;
    return uow.run(ctx, async (tx) => {
      const at = toInstant(clock.now());
      const versions = (await tx.listDoctrines())
        .filter((d) => d.key === input.key)
        .map((d) => d.version);
      const doctrine: Doctrine = {
        tenantId: ctx.tenantId,
        id: ids.next(),
        key: input.key,
        version: versions.length ? Math.max(...versions) + 1 : 1,
        status: 'draft',
        title: input.title.trim(),
        origin: input.origin,
        usageRights: input.usageRights,
        content,
        contentHash: doctrineContentHash(content),
        createdBy: actor.userId,
        createdAt: at,
        validatedBy: null,
        validatedAt: null,
        validationNote: null,
        retiredAt: null,
      };
      await tx.insertDoctrine(doctrine);
      await tx.appendAudit(
        audit(ctx, ids, at, {
          eventType: 'doctrine.drafted',
          resourceType: 'doctrine',
          resourceId: doctrine.id,
          revision: doctrine.version,
          metadata: { key: doctrine.key },
        }),
      );
      return doctrine;
    });
  }

  /**
   * Validation by an owner activates the version and retires the previously
   * validated one. Open recommendations are reconciled by the next analysis
   * (superseded or expired with reason `doctrine_changed`).
   */
  async validate(ctx: Context, doctrineId: string, note: string | null): Promise<Doctrine> {
    const actor = requirePermission(ctx, 'doctrine:validate');
    const { uow, clock, ids } = this.#deps;
    return uow.run(ctx, async (tx) => {
      const doctrine = await tx.getDoctrine(doctrineId, { forUpdate: true });
      ensure(doctrine !== null, 'NOT_FOUND');
      const at = toInstant(clock.now());
      const validated = validateDoctrine(doctrine, actor.userId, note, at);
      const previous = await tx.getActiveDoctrine();
      if (previous && previous.id !== doctrine.id) {
        await tx.updateDoctrine(retireDoctrine(previous, at));
        await tx.appendAudit(
          audit(ctx, ids, at, {
            eventType: 'doctrine.retired',
            resourceType: 'doctrine',
            resourceId: previous.id,
            revision: previous.version,
          }),
        );
      }
      await tx.updateDoctrine(validated);
      await tx.appendAudit(
        audit(ctx, ids, at, {
          eventType: 'doctrine.validated',
          resourceType: 'doctrine',
          resourceId: doctrine.id,
          revision: doctrine.version,
          metadata: { key: doctrine.key },
        }),
      );
      await tx.enqueueOutbox(
        outbox(
          ctx,
          ids,
          at,
          'doctrine.changed',
          { type: 'doctrine', id: doctrine.id },
          { version: doctrine.version },
        ),
      );
      return validated;
    });
  }

  async retire(ctx: Context, doctrineId: string): Promise<Doctrine> {
    requirePermission(ctx, 'doctrine:validate');
    const { uow, clock, ids } = this.#deps;
    return uow.run(ctx, async (tx) => {
      const doctrine = await tx.getDoctrine(doctrineId, { forUpdate: true });
      ensure(doctrine !== null, 'NOT_FOUND');
      const at = toInstant(clock.now());
      const retired = retireDoctrine(doctrine, at);
      await tx.updateDoctrine(retired);
      await tx.appendAudit(
        audit(ctx, ids, at, {
          eventType: 'doctrine.retired',
          resourceType: 'doctrine',
          resourceId: doctrine.id,
          revision: doctrine.version,
        }),
      );
      await tx.enqueueOutbox(
        outbox(
          ctx,
          ids,
          at,
          'doctrine.changed',
          { type: 'doctrine', id: doctrine.id },
          { version: doctrine.version },
        ),
      );
      return retired;
    });
  }
}

export class CompanyContextService {
  readonly #deps: ServiceDeps;

  constructor(deps: ServiceDeps) {
    this.#deps = deps;
  }

  async current(ctx: Context): Promise<CompanyContext | null> {
    requirePermission(ctx, 'context:read');
    return this.#deps.uow.run(ctx, (tx) => tx.getCurrentContext());
  }

  /** Each update is a new immutable version with provenance; analyses reference the version used. */
  async update(
    ctx: Context,
    input: { content: unknown; source?: ContextSource; note?: string | null },
  ): Promise<CompanyContext> {
    const actor = requirePermission(ctx, 'context:manage');
    const content = validateContextContent(input.content);
    const note = input.note ?? null;
    ensure(
      note === null || (typeof note === 'string' && note.length <= 1000),
      'INVALID_INPUT',
      'note',
    );
    const { uow, clock, ids } = this.#deps;
    return uow.run(ctx, async (tx) => {
      const at = toInstant(clock.now());
      const current = await tx.getCurrentContext();
      const next: CompanyContext = {
        tenantId: ctx.tenantId,
        id: ids.next(),
        version: (current?.version ?? 0) + 1,
        content,
        source: input.source ?? 'manual',
        note,
        createdBy: actor.userId,
        createdAt: at,
      };
      await tx.insertContext(next);
      await tx.appendAudit(
        audit(ctx, ids, at, {
          eventType: 'context.updated',
          resourceType: 'company_context',
          resourceId: next.id,
          revision: next.version,
        }),
      );
      await tx.enqueueOutbox(
        outbox(
          ctx,
          ids,
          at,
          'context.changed',
          { type: 'company_context', id: next.id },
          { version: next.version },
        ),
      );
      return next;
    });
  }
}

export class MemberService {
  readonly #deps: ServiceDeps;

  constructor(deps: ServiceDeps) {
    this.#deps = deps;
  }

  async list(ctx: Context): Promise<Member[]> {
    requirePermission(ctx, 'member:read');
    return this.#deps.uow.run(ctx, (tx) => tx.listMembers());
  }

  async changeRole(ctx: Context, userId: string, role: Role): Promise<Member> {
    requirePermission(ctx, 'member:manage');
    ensure((ROLES as readonly string[]).includes(role), 'INVALID_ROLE');
    return this.#mutate(
      ctx,
      userId,
      (member, at) => {
        ensure(member.status === 'active', 'INVALID_TRANSITION', 'membership revoked');
        return { ...member, role, updatedAt: at };
      },
      'membership.role_changed',
    );
  }

  /** Takes effect on the member's next request: the API re-reads memberships for every call. */
  async revoke(ctx: Context, userId: string): Promise<Member> {
    const actor = requirePermission(ctx, 'member:manage');
    return this.#mutate(
      ctx,
      userId,
      (member, at) => {
        ensure(member.status === 'active', 'INVALID_TRANSITION', 'already revoked');
        return {
          ...member,
          status: 'revoked',
          revokedAt: at,
          revokedBy: actor.userId,
          updatedAt: at,
        };
      },
      'membership.revoked',
    );
  }

  async #mutate(
    ctx: Context,
    userId: string,
    change: (m: Member, at: string) => Member,
    eventType: string,
  ): Promise<Member> {
    const { uow, clock, ids } = this.#deps;
    return uow.run(ctx, async (tx) => {
      const member = await tx.getMember(userId, { forUpdate: true });
      ensure(member !== null, 'NOT_FOUND');
      const at = toInstant(clock.now());
      const next = change(member, at);
      const owners = (await tx.listMembers()).filter(
        (m) => m.status === 'active' && m.role === 'owner' && m.userId !== userId,
      );
      ensure(
        owners.length > 0 || (next.status === 'active' && next.role === 'owner'),
        'INVALID_TRANSITION',
        'a tenant keeps at least one active owner',
      );
      await tx.updateMember(next);
      await tx.appendAudit(
        audit(ctx, ids, at, {
          eventType,
          resourceType: 'membership',
          resourceId: userId,
          metadata: { role: next.role, status: next.status },
        }),
      );
      return next;
    });
  }
}
