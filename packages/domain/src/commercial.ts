import { ensure } from './errors.ts';
import { isInstant } from './time.ts';

export type CommercialMaterial = Readonly<{
  id: string;
  version: number;
  type: 'activity' | 'email' | 'note' | 'document';
  title: string;
  text: string;
  author: string;
  occurredAt: string;
}>;
export type CommercialData = Readonly<{
  materials: readonly CommercialMaterial[];
  contactPolicy: Readonly<{ opposed: boolean; pauseUntil: string | null }>;
}>;

export function record(value: unknown): Record<string, unknown> {
  ensure(typeof value === 'object' && value !== null && !Array.isArray(value), 'INVALID_INPUT');
  return value as Record<string, unknown>;
}
export function closed(value: Record<string, unknown>, keys: readonly string[]): void {
  ensure(Object.keys(value).every((key) => keys.includes(key)), 'INVALID_INPUT', 'unknown key');
  ensure(keys.every((key) => key in value), 'INVALID_INPUT', 'missing key');
}
export function boundedText(value: unknown, max: number): string {
  ensure(typeof value === 'string' && value.trim().length > 0 && value.length <= max, 'INVALID_INPUT');
  return value;
}
export function validateCommercialData(input: unknown): CommercialData {
  const raw = record(input);
  closed(raw, ['materials', 'contactPolicy']);
  ensure(Array.isArray(raw.materials) && raw.materials.length <= 12, 'INVALID_INPUT');
  const ids = new Set<string>();
  const materials = raw.materials.map((item: unknown): CommercialMaterial => {
    const m = record(item);
    closed(m, ['id', 'version', 'type', 'title', 'text', 'author', 'occurredAt']);
    const id = boundedText(m.id, 100);
    ensure(/^[a-zA-Z0-9_-]+$/.test(id) && !ids.has(id), 'INVALID_INPUT');
    ids.add(id);
    ensure(typeof m.version === 'number' && Number.isInteger(m.version) && m.version > 0, 'INVALID_INPUT');
    ensure(m.type === 'activity' || m.type === 'email' || m.type === 'note' || m.type === 'document', 'INVALID_INPUT');
    ensure(isInstant(m.occurredAt), 'INVALID_TIMESTAMP');
    return { id, version: m.version, type: m.type, title: boundedText(m.title, 200), text: boundedText(m.text, 4000), author: boundedText(m.author, 100), occurredAt: m.occurredAt };
  });
  const policy = record(raw.contactPolicy);
  closed(policy, ['opposed', 'pauseUntil']);
  ensure(typeof policy.opposed === 'boolean', 'INVALID_INPUT');
  ensure(policy.pauseUntil === null || isInstant(policy.pauseUntil), 'INVALID_TIMESTAMP');
  return { materials, contactPolicy: { opposed: policy.opposed, pauseUntil: policy.pauseUntil } };
}
