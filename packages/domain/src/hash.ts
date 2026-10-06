import { createHash } from 'node:crypto';

/** Deterministic JSON: object keys sorted recursively, undefined members dropped. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const member = (value as Record<string, unknown>)[key];
      if (member !== undefined) out[key] = normalize(member);
    }
    return out;
  }
  return value;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function fingerprintOf(value: unknown): string {
  return sha256(canonicalJson(value));
}
