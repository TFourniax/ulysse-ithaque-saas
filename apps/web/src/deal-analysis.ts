import type { AgentRunDto } from '@ulysse/contracts';

const READINESS: Record<string, string> = {
  no_validated_doctrine:
    'Aucune doctrine validée ne peut guider cette analyse. Vérifiez la doctrine dans Administration.',
  doctrine_rights: 'Les droits d’utilisation de la doctrine ne permettent pas cette analyse.',
  stale_source:
    'Les données dépassent la durée de validité définie pour cette analyse. Déposez un export à jour.',
  source_not_supported: 'Cette source ne peut pas encore alimenter les propositions.',
  source_inactive: 'La source de cette affaire n’est plus active.',
};

export function dealAnalysisIssue(run: AgentRunDto): string | null {
  const readiness = run.error_code ? READINESS[run.error_code] : undefined;
  if (readiness) return readiness;
  if (run.status === 'budget_reached')
    return 'L’analyse a atteint une limite de dépenses ou d’exécutions simultanées.';
  if (run.status === 'failed' || run.status === 'interrupted')
    return 'L’analyse n’a pas abouti. Consultez son détail pour connaître le motif.';
  return null;
}
