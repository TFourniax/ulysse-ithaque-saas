import type { Me } from '@ulysse/contracts';
import { createContext, use } from 'react';

export type Session = Me & { activeTenant: NonNullable<Me['activeTenant']> };

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = use(SessionContext);
  if (!session) throw new Error('useSession outside an authenticated layout');
  return session;
}

/** Display-only permission hint: the API re-checks every permission server-side. */
export function can(session: Session, permission: string): boolean {
  return session.activeTenant.permissions.includes(permission);
}
