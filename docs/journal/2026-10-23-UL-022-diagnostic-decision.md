# UL-022 — Diagnostic utile à la décision

Responsable : Codex. Date : 23 octobre 2026.

## Demande et changements

Thomas rapporte un diagnostic live abouti à 20 h 12, puis demande d'améliorer cette étape avant la recette du contenu lié. Le contenu client n'est pas recopié dans les fixtures.

- Priorité de lecture renforcée par les faits documentant la clientèle; aucune exclusion automatique des offres distantes ou partielles.
- Instructions Hermes et relecture : sélection expliquée, limites de comparabilité, décision conditionnelle et prochaine étape sourcées. Pas de ROI calculé sans coûts et gains documentés. Contrat JSON inchangé.
- Couverture calculée côté application : alternatives distinctes citées, fiches disponibles, revue humaine. Les comptes ne sont ni un nombre de fiches lues ni une couverture statistique du marché.
- Interface : comparaison des offres, clarifications pour décider, références du contexte lisibles; identifiants conservés dans un détail accessible.

## Validation

`npm run verify` réussi : 145 tests unitaires, format, lint, types, cycles, contrat OpenAPI et liens documentaires. Construction web réussie. Les tests couvrent la priorité de lecture et les comptes distincts, état partiel/terminé, fiches à vérifier/approuvées. La CI complète sera suivie sur la révision publiée. Les tests utilisent des données fictives et les tests de boucle un fournisseur simulé. La qualité des nouvelles recommandations doit être relue sur un nouvel essai live; les anciens diagnostics ne sont pas réécrits.
