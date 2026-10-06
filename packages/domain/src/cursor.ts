import { ensure } from './errors.ts';

export type CursorKey = readonly (string | number)[];

/** Opaque keyset cursor shared by storage adapters (base64url JSON of sort keys). */
export function encodeCursor(key: CursorKey): string {
  return Buffer.from(JSON.stringify(key), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string, arity: number): CursorKey {
  ensure(cursor.length <= 512 && /^[A-Za-z0-9_-]+$/.test(cursor), 'INVALID_INPUT', 'cursor');
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    parsed = null;
  }
  ensure(
    Array.isArray(parsed) &&
      parsed.length === arity &&
      parsed.every((v) => typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))),
    'INVALID_INPUT',
    'cursor',
  );
  return parsed as CursorKey;
}
