import type { ReactNode } from 'react';
import { ApiError } from '../api.ts';
import { STATUS_LABELS } from '../format.ts';

export function ErrorBanner({
  error,
  title = 'Une erreur est survenue',
}: {
  error: unknown;
  title?: string;
}) {
  const message = error instanceof Error ? error.message : 'Erreur inconnue.';
  const correlation = error instanceof ApiError ? error.correlationId : null;
  return (
    <div className="banner banner-error" role="alert">
      <strong>{title}</strong>
      <p>{message}</p>
      {correlation && <p className="muted small">Référence de diagnostic : {correlation}</p>}
    </div>
  );
}

export function Banner({
  kind,
  children,
}: {
  kind: 'info' | 'warning' | 'success';
  children: ReactNode;
}) {
  return (
    <div className={`banner banner-${kind}`} role={kind === 'warning' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function Loading({ label = 'Chargement…' }: { label?: string }) {
  return (
    <p className="muted" role="status" aria-live="polite">
      {label}
    </p>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABELS[status] ?? status}</span>;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <section className="empty" aria-label={title}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function FictionalBadge() {
  return (
    <span
      className="badge badge-fictional"
      title="Données ou règles fictives de démonstration, non validées métier"
    >
      Fictif
    </span>
  );
}
