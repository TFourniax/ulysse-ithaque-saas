# ADR-0009 — Formulation assistée par modèle, optionnelle et bornée

Date : 2026-10-06. Statut : accepté comme option désactivée par défaut (UL-010) ; fonctionnement réel **non vérifié**.

## Contexte

Les règles déterministes produisent déjà des propositions justifiées. Un modèle peut améliorer la formulation de la prochaine étape, mais les données ingérées sont non fiables, les conditions de traitement par un fournisseur ne sont pas validées (Q-008) et aucune clé n'est disponible.

## Décision

- Interface neutre `ModelProvider` (`packages/ai`) ; adaptateur **OpenRouter** optionnel (`MODEL_PROVIDER=openrouter`) : sortie JSON Schema stricte, température 0, **aucun outil**, `provider.data_collection: deny`, coût demandé dans la réponse.
- Le modèle ne fait que **reformuler la prochaine étape** d'une proposition déjà créée par les règles : il ne crée, ne priorise, n'approuve ni n'envoie rien. Il ne reçoit ni secret, ni identifiant interne, ni outil d'écriture.
- Prompt versionné `next-step-v1` ; les valeurs issues des sources sont passées comme **données** dans un bloc JSON délimité, avec instruction explicite de ne pas exécuter leur contenu.
- Validation serveur indépendante du fournisseur : schéma, citations existantes (F1…), au moins un fait déterminant cité, aucun chiffre absent des faits, aucun lien, e-mail ni téléphone. Sinon : rejet et conservation de la formulation déterministe. Le modèle peut s'abstenir.
- Appliquée seulement à une proposition en attente non modifiée (révision de contenu 1) : jamais par-dessus une modification humaine ; crée une révision machine auditée (`recommendation.formulated`). L'interface indique la provenance de la formulation.
- Appel hors transaction, dans un job déclenché par l'outbox ; panne, délai ou budget atteint → mode dégradé silencieux pour l'utilisateur (formulation déterministe).
- Budget mensuel par entreprise (`MODEL_TENANT_MONTHLY_BUDGET_USD`, 0 par défaut) ; usage (jetons, coût déclaré, latence, issue) enregistré dans `model_usage` sans prompt ni réponse.
- Pas de chaîne de pensée stockée ni affichée ; pas de score de confiance inventé.

## Conséquences et limites

- Testé uniquement avec un fournisseur scripté et un serveur local imitant l'API OpenRouter ; sortie réseau vers openrouter.ai refusée dans l'environnement de développement et aucune clé fournie.
- Avant tout envoi de données réelles : valider fournisseur, modèle, région, conservation et contrat (Q-008) ; mesurer la valeur par rapport à la formulation déterministe sur un panel annoté (UL-010 reste partial).
- DEBT-014 : un appel sans coût déclaré compte pour 0 dans le budget.

## Preuves

Tests `packages/ai` (validation, injection, pannes typées, budget, requête stricte sans outil), scénario domaine (jamais par-dessus une édition humaine), tests worker (formulation en arrière-plan, panne fournisseur → mode dégradé, budget atteint → aucun appel).
