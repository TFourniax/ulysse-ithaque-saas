import { ensure } from './errors.ts';

export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;

/** Injected time source; services never read the system clock directly. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export function fixedClock(
  iso: string,
): Clock & { set(iso: string): void; advance(ms: number): void } {
  let current = parseInstant(iso);
  return {
    now: () => new Date(current),
    set: (next: string) => {
      current = parseInstant(next);
    },
    advance: (ms: number) => {
      current += ms;
    },
  };
}

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

/**
 * Parses a canonical UTC instant (`YYYY-MM-DDTHH:mm:ss(.sss)Z`). Rejects
 * impossible calendar dates (e.g. 2026-02-30) instead of rolling them over.
 */
export function parseInstant(value: unknown): number {
  ensure(typeof value === 'string' && ISO_UTC.test(value), 'INVALID_TIMESTAMP');
  const parsed = Date.parse(value);
  ensure(Number.isFinite(parsed), 'INVALID_TIMESTAMP');
  const roundTrip = new Date(parsed).toISOString();
  const normalized = value.length === 20 ? value.replace('Z', '.000Z') : value;
  ensure(roundTrip === normalized, 'INVALID_TIMESTAMP');
  return parsed;
}

export function isInstant(value: unknown): value is string {
  try {
    parseInstant(value);
    return true;
  } catch {
    return false;
  }
}

export function toInstant(ms: number | Date): string {
  return (typeof ms === 'number' ? new Date(ms) : ms).toISOString();
}
