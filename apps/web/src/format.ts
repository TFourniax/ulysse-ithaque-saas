const dateTime = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
const dateOnly = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' });
const relative = new Intl.RelativeTimeFormat('fr-FR', { numeric: 'auto' });

export function formatDateTime(iso: string | null | undefined): string {
  return iso ? dateTime.format(new Date(iso)) : '—';
}

export function formatDate(iso: string | null | undefined): string {
  return iso ? dateOnly.format(new Date(iso)) : '—';
}

export function formatRelative(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return 'jamais';
  const diffSeconds = Math.round((Date.parse(iso) - now) / 1000);
  const abs = Math.abs(diffSeconds);
  if (abs < 60) return relative.format(diffSeconds, 'second');
  if (abs < 3600) return relative.format(Math.round(diffSeconds / 60), 'minute');
  if (abs < 86_400) return relative.format(Math.round(diffSeconds / 3600), 'hour');
  return relative.format(Math.round(diffSeconds / 86_400), 'day');
}

export const STATUS_LABELS: Record<string, string> = {
  draft: 'Brouillon',
  pending: 'À décider',
  approved: 'Approuvée',
  rejected: 'Rejetée',
  expired: 'Expirée',
  superseded: 'Remplacée',
};

export const CLOSED_REASON_LABELS: Record<string, string> = {
  ttl: 'durée de validité dépassée',
  evidence_changed: 'faits modifiés à la source',
  signal_resolved: 'situation résolue à la source',
  source_deleted: 'donnée supprimée à la source',
  connection_revoked: 'source révoquée',
  doctrine_changed: 'doctrine modifiée',
  replaced: 'remplacée',
};

export const KIND_LABELS: Record<string, string> = {
  define_next_step: 'Prochaine étape à définir',
  follow_up_overdue_step: 'Prochaine étape échue',
};

export const ROLE_LABELS: Record<string, string> = {
  owner: 'Responsable',
  reviewer: 'Décideur',
  viewer: 'Lecteur',
};

export const ABSTENTION_LABELS: Record<string, string> = {
  stale_source: 'données trop anciennes',
  missing_data: 'données manquantes à la source',
  volume_cap: 'plafond de propositions atteint',
  rejection_cooldown: 'rejet récent du même sujet',
  already_decided: 'déjà décidé',
  no_validated_doctrine: 'aucune doctrine validée',
};

export const EVENT_LABELS: Record<string, string> = {
  'recommendation.generated': 'Proposition générée',
  'recommendation.approved': 'Proposition approuvée',
  'recommendation.rejected': 'Proposition rejetée',
  'recommendation.revised': 'Proposition modifiée',
  'recommendation.submitted': 'Brouillon soumis',
  'recommendation.expired': 'Proposition close',
  'recommendation.superseded': 'Proposition remplacée',
  'source.synced': 'Synchronisation terminée',
  'connection.created': 'Source autorisée',
  'connection.revoked': 'Source révoquée',
  'connection.purged': 'Données de la source supprimées',
  'connection.sync_requested': 'Synchronisation demandée',
  'connection.sync_failed': 'Échec de synchronisation',
  'doctrine.drafted': 'Doctrine : brouillon créé',
  'doctrine.validated': 'Doctrine validée',
  'doctrine.retired': 'Doctrine retirée',
  'context.updated': "Contexte d'entreprise mis à jour",
  'membership.role_changed': 'Rôle modifié',
  'membership.revoked': 'Accès révoqué',
};

/** Renders a normalized fact value; never guesses a value the source did not provide. */
export function formatFactValue(state: string, value: unknown): string {
  if (state === 'unavailable') return 'Non fourni par la source';
  if (state === 'empty') return 'Vide dans la source';
  if (typeof value === 'string') {
    return /^\d{4}-\d{2}-\d{2}T/.test(value) ? formatDate(value) : value;
  }
  if (value && typeof value === 'object' && 'amount' in value && 'currency' in value) {
    const money = value as { amount: string; currency: string };
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: money.currency }).format(
      Number(money.amount),
    );
  }
  return value === null || value === undefined ? '—' : JSON.stringify(value);
}
