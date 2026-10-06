# ADR-0011 — Mesure de la valeur : évaluation des décisions et rapport observé

Date : 2026-10-06. Statut : accepté (UL-012b), vérifié par tests domaine/PostgreSQL/API et recette navigateur. Les catégories reprennent celles proposées dans ACCEPTANCE ; leur adoption pour un pilote reste à confirmer par son responsable (Q-010).

## Contexte

La valeur réelle d'Ulysse ne peut être qualifiée qu'avec un pilote (UL-012c). Sans donnée structurée, le motif libre des décisions ne permet pas de mesurer la part de propositions utiles ni les causes de rejet (DEBT-009). Il ne faut ni métrique décorative, ni estimation présentée comme observée.

## Décision

- Chaque décision peut porter une **évaluation facultative** : `useful` (avec une approbation) ou, pour un rejet, `not_actionable`, `duplicate`, `outdated`, `unfounded`, `out_of_scope`. La cohérence est vérifiée dans le domaine et par une contrainte SQL ; l'évaluation est incluse dans l'empreinte d'idempotence et dans l'audit (`metadata.quality`).
- Migration **additive** `0008_decision_quality.sql` (colonne nullable, contraintes, index de période) : les décisions existantes restent « non évaluées » ; vérifiée sur une base déjà peuplée.
- **Rapport** `GET /v1/reports/quality?from&to` (permission `analysis:read`, donc lisible par tous les rôles de l'entreprise) : calculé par une fonction pure du domaine à partir de projections minimales (propositions générées et décisions de la période, dernière analyse). Bornes incluses, période par défaut 30 jours, 366 jours au plus, 10 000 lignes au plus par catégorie avec indicateur `truncated`.
- Contenu : propositions par type et par état actuel, décisions approuvées/rejetées, évaluations, délai médian génération → décision, abstentions par motif **à la dernière analyse** (les abstentions ne sont pas additionnées entre analyses, qui reportent les mêmes sujets).
- Page « Mesure » de l'interface : tableaux uniquement, mention explicite que les chiffres viennent de ce qui a été enregistré et sont fictifs en démonstration.

## Options écartées

Sommer les abstentions de toutes les analyses (double compte) ; un score de qualité agrégé ou un « gain de temps » estimé (non observable sans mesure avant/après) ; agrégats SQL spécifiques à chaque adaptateur (risque de divergence avec l'adaptateur mémoire).

## Conséquences

- Couverture (cas éligibles manqués) et gain de temps restent à mesurer avec l'équipe pilote (ACCEPTANCE).
- Pour des volumes supérieurs aux limites, prévoir des agrégats SQL ou une table de statistiques ; la suite de scénarios partagée devra alors couvrir les deux adaptateurs.
