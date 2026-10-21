# UL-020 — résultat structuré natif et benchmark sur recherche en pause

Date : 21 octobre 2026. Responsable : Codex. Statut : correctif en validation; recette fournisseur ouverte.

## Constat et objectif

La capture transmise par Thomas montre le diagnostic acheteur du 21 octobre à 21 h 19 (Europe/Paris), interrompu avec `result_schema_invalid`. Ni le champ rejeté, ni le profil, ni le SHA réellement déployé ne sont visibles. Le code déclare une capacité de sortie structurée dans les profils, mais les appels buyer/content ne transmettent aucun `response_format`. Ce manque est confirmé; il ne permet pas de reconstituer la réponse fautive.

Objectif : fournir le contrat au décodeur du fournisseur et vérifier le chemin complet du benchmark avec les données conservées d’une recherche en pause, sous les contrôles existants.

## Changements

- `workflow-response.ts` génère le schéma natif depuis le contrat Zod partagé, ferme les objets, fixe le parcours et n’autorise que les références effectivement fournies/lues.
- `agent-runtime.ts` le transmet aussi pendant les lectures et la correction unique, compte ses octets dans le contexte et le coût, conserve seulement le booléen d’activation dans les métadonnées.
- `agent-provider.ts` exige les capacités annoncées par le fournisseur régional pour les profils structurés. Les profils non structurés gardent le contrôle final et la correction existants.
- Les tests worker couvrent buyer et contenu lié, preuves non lues/étrangères, correction bornée et benchmark depuis une recherche en pause. Ce dernier passe maintenant par la passerelle d’inférence et vérifie que l’énumération des citations s’élargit après la lecture réelle du concurrent, puis impose la revue des faits avant approbation.
- Le fournisseur simulé et le smoke novembre vérifient la réception du schéma dans la vraie boucle Hermes. Le script VPS `research7-schema` ajoute `native_response_schema` au diagnostic en lecture seule.

## Vérification

Validation locale et CI en cours; aucune réussite live annoncée. Les schémas buyer/content ont également été compilés en JSON Schema Draft 7 avec le validateur déjà installé : brouillons structurés acceptés, champs inconnus, longueur excessive, mauvais type de parcours, limite vide et référence non lue refusés. Aucun paquet ajouté.

Références officielles consultées le 21 octobre : [OpenRouter structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs), [Mistral structured outputs](https://docs.mistral.ai/studio/conversations/structured-output/custom), [métadonnées du modèle Mistral](https://openrouter.ai/api/v1/models/mistralai/mistral-small-2603/endpoints). L’endpoint `mistral/eu` annonce `response_format`, `structured_outputs`, `tools` et `tool_choice`. Cela valide la compatibilité déclarée, pas l’exécution d’un appel réel depuis cet environnement.

## Limites et suite

DEBT-032 reste ouverte pour la recette réelle. Tests avec fournisseur scripté : ils prouvent la transmission et les contrôles, pas la fidélité métier d’une réponse Mistral. Après publication et déploiement, reprendre le brief depuis le diagnostic existant; la recherche peut rester en pause. Relire le benchmark et ses citations. Si une erreur persiste, `diagnose` fournit le code, les chemins de champs et le booléen du schéma natif sans exposer la réponse ou les sources. Aucun reset de données, de session ou de coût; plafonds actifs conservés.
