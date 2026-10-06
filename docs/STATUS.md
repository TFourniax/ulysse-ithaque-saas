# État actuel

Mis à jour : 2026-10-06. Stade : M0, fondation de développement.

## Livré dans cette proposition

- PRODUCT et BLUEPRINT : exigences et architecture cible, sources techniques.
- WORK-PROMPT : reprise autonome détaillée dans Work.
- AGENTS/CONTRIBUTING/ADR : règles et continuité entre contributeurs.
- BACKLOG/OPEN-QUESTIONS/ACCEPTANCE : tâches, dettes, arbitrages et preuves attendues.
- Kernel TypeScript + adaptateur mémoire fictif : faits CRM → proposition expliquée → décision humaine → audit.
- Démo hors ligne et tests métier.

## Vérifié

Windows, Node 24.16.0, npm 11.13.0.
npm test : **22/22 tests PASS**.
npm run demo : exécuté, proposition puis décision et 3 événements d'audit, zéro action externe.
npm run check : 16 documents requis et 17 fichiers Markdown vérifiés ; liens internes résolus.
Lockfile minimal généré hors ligne ; aucune dépendance de framework installée.
CI distante : succès Windows/Linux sur le commit 4a117dc51a1bca75188ddd274c3f5f19f3b938cf ; tests, liens/docs et démo exécutés dans les deux jobs.
Preuve : [GitHub Actions 37483460691](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/37483460691).
PR de démarrage : [#1](https://github.com/TFourniax/ulysse-ithaque-saas/pull/1), brouillon non fusionné.

## Non livré

Authentification réelle, API, UI, PostgreSQL/RLS, durabilité, worker planifié, connecteurs live, doctrine métier validée, intégration modèle, hébergement, contrôle tsc et recette pilote.

## Prochaine étape

UL-002 : outils stricts, API et identité/memberships.
UL-003 : migrations et décisions transactionnelles avec compte PostgreSQL réel.
UL-013 : réconciliation du cahier joint dès qu'il est lisible ; ne bloque pas les fixtures.

## Source et publication

Base observée de main : 0596cde596c53ad3eb218e97ae681c0c76b7d5a4 (README initial).
Travail proposé via branche dédiée et PR ; aucune fusion ni déploiement automatique.
La pièce jointe initiale n'a pas pu être récupérée. Le cadrage repose sur les exigences utilisateur confirmées, pas sur une lecture prétendue du fichier.

Journal : [2026-10-06-foundation](journal/2026-10-06-foundation.md).
