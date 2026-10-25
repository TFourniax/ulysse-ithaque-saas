import type { FactType, Opportunity } from '@ulysse/domain';
import { factsOf } from '@ulysse/domain';

export const DEAL_FIELD_LABELS: Record<FactType, string> = {
  name: 'Affaire',
  stage: 'État de l’affaire',
  last_interaction_at: 'Dernière interaction déclarée',
  next_step: 'Objectif ou prochaine étape déclarée',
  next_step_due_at: 'Échéance déclarée',
  amount: 'Montant déclaré',
  owner_name: 'Responsable déclaré dans le champ commercial',
  segment: 'Segment déclaré',
  commercial_context: 'Documents et échanges',
};
export const dealFieldReference = (o: Opportunity, type: FactType): string =>
  `field:${o.id}:${type}:r${String(o.revision)}`;

/** Typed source facts, not interpretations or new commercial claims. */
export function dealFieldEvidence(o: Opportunity) {
  return factsOf(o.fields)
    .filter((f) => f.factType !== 'name' && f.factType !== 'commercial_context')
    .map((f) => ({
      reference: dealFieldReference(o, f.factType),
      field: f.locator.replace('fields.', ''),
      label: DEAL_FIELD_LABELS[f.factType],
      state: f.state,
      value: f.value,
    }));
}
