import type { Context } from '../context.ts';
import { actorRef } from '../context.ts';
import { ensure } from '../errors.ts';
import type { IdGenerator, TenantTx, UnitOfWork } from '../ports.ts';
import type { AuditEvent, OutboxEvent, OutboxEventType } from '../records.ts';
import type { RuleRegistry } from '../rules.ts';
import type { Clock } from '../time.ts';

export type ServiceDeps = Readonly<{
  uow: UnitOfWork;
  clock: Clock;
  ids: IdGenerator;
  rules: RuleRegistry;
  /** Retention of idempotency receipts. Expiry never makes a decision reversible. */
  receiptTtlHours?: number;
}>;

export const DEFAULT_RECEIPT_TTL_HOURS = 24;

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,128}$/;

export function validateIdempotencyKey(key: unknown): string {
  ensure(typeof key === 'string' && IDEMPOTENCY_KEY.test(key), 'INVALID_INPUT', 'Idempotency-Key');
  return key;
}

export function audit(
  ctx: Context,
  ids: IdGenerator,
  at: string,
  event: {
    eventType: string;
    resourceType: string;
    resourceId: string;
    revision?: number | null;
    metadata?: AuditEvent['metadata'];
  },
): AuditEvent {
  const ref = actorRef(ctx.actor);
  return {
    tenantId: ctx.tenantId,
    id: ids.next(),
    actorType: ref.type,
    actorId: ref.id,
    eventType: event.eventType,
    resourceType: event.resourceType,
    resourceId: event.resourceId,
    revision: event.revision ?? null,
    correlationId: ctx.correlationId,
    metadata: event.metadata ?? {},
    createdAt: at,
  };
}

export function outbox(
  ctx: Context,
  ids: IdGenerator,
  at: string,
  eventType: OutboxEventType,
  subject: { type: string; id: string },
  payload: OutboxEvent['payload'] = {},
): OutboxEvent {
  return {
    tenantId: ctx.tenantId,
    id: ids.next(),
    eventType,
    subjectType: subject.type,
    subjectId: subject.id,
    payload,
    createdAt: at,
  };
}

export async function recordAudit(tx: TenantTx, event: AuditEvent): Promise<void> {
  ensure(event.tenantId === tx.tenantId, 'TENANT_MISMATCH');
  await tx.appendAudit(event);
}
