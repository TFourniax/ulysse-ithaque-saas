/**
 * Typed accessors for rows read from our own schema. Columns are constrained by
 * the migrations; these helpers still check runtime types so that a schema drift
 * fails loudly instead of propagating malformed values.
 */
export type Row = Record<string, unknown>;

export class RowShapeError extends Error {
  constructor(column: string, expected: string) {
    super(`unexpected database value for ${column} (expected ${expected})`);
    this.name = 'RowShapeError';
  }
}

export function str(row: Row, column: string): string {
  const v = row[column];
  if (typeof v !== 'string') throw new RowShapeError(column, 'string');
  return v;
}

export function strOrNull(row: Row, column: string): string | null {
  const v = row[column];
  if (v === null) return null;
  if (typeof v !== 'string') throw new RowShapeError(column, 'string|null');
  return v;
}

export function int(row: Row, column: string): number {
  const v = row[column];
  if (typeof v === 'number' && Number.isInteger(v)) return v;
  if (typeof v === 'string' && /^-?\d+$/.test(v)) return Number(v);
  throw new RowShapeError(column, 'integer');
}

export function intOrNull(row: Row, column: string): number | null {
  return row[column] === null ? null : int(row, column);
}

export function num(row: Row, column: string): number {
  const v = row[column];
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  throw new RowShapeError(column, 'number');
}

export function bool(row: Row, column: string): boolean {
  const v = row[column];
  if (typeof v !== 'boolean') throw new RowShapeError(column, 'boolean');
  return v;
}

export function strArray(row: Row, column: string): string[] {
  const v = row[column];
  if (!Array.isArray(v)) throw new RowShapeError(column, 'text[]');
  return v.map((x: unknown) => {
    if (typeof x !== 'string') throw new RowShapeError(column, 'text[]');
    return x;
  });
}

/** JSON columns written by this application; the domain re-validates where it matters. */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- typed read of a trusted jsonb column
export function json<T>(row: Row, column: string): T {
  const v = row[column];
  if (v === undefined) throw new RowShapeError(column, 'json');
  return v as T;
}

export function oneOf<T extends string>(row: Row, column: string, values: readonly T[]): T {
  const v = str(row, column);
  if (!(values as readonly string[]).includes(v)) throw new RowShapeError(column, values.join('|'));
  return v as T;
}
