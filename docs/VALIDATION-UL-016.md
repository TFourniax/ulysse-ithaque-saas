# Rapport de validation UL-016

Date : 2026-10-07. Lot **partial** : validation live et revue de pertinence encore nécessaires. PR [#3](https://github.com/TFourniax/ulysse-ithaque-saas/pull/3), branche `codex/ul-016-hermes-demo`, base exacte `598f082ab33fb87faf5ff357285dc95b536bb1b3`.

## Contrôles automatiques observés

| Contrôle | Résultat vérifié | Périmètre / preuve |
| --- | --- | --- |
| Domaine et workflows mémoire locaux | 50/50 passent | Non-régression + contrat agent, citations, opposition/pause, corpus non fiable |
| Vérification applicative CI | Passe après formatage et génération OpenAPI | [run 37640483312](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/37640483312), `a838146fa8a43e32cf4a62a3c6cdab8f2f6f5d88`, `npm run verify` dans application |
| TypeScript / ESLint CI | Passent | [run 37640483305](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/37640483305), même SHA ; job ensuite arrêté sur formatage, récupéré depuis la génération CI |
| Migrations sur base neuve | Passent | Même run, rôle migrator, versions PostgreSQL/Keycloak conservées |
| PostgreSQL historique | 49/50 au point intermédiaire | Le contrôle de privilèges attendait l'ancien catalogue de fonctions ; catalogue corrigé, recette suivante requise |
| Stack historique complète | Passe | Image, Keycloak/PG/API/worker, seed, propositions, session/données après restart, sauvegarde/restauration ; même run |
| Navigateur historique | Passe | `npm run test:e2e`, même run ; clavier/mobile/axe du socle UL-015 |
| Image Hermes officielle | Construction réussie | Hermes `e76fb951a1d207c9596032426e7e0eadfb197bea`, Python 3.14.4, installateur scellé |
| Boucle Hermes, endpoint simulé | Échec intermédiaire, correction en recette | Probe metadata `/api/show` upstream, pas un appel modèle ; réponse 404 et diagnostic minimisé ajoutés. Attendre le job vert |
| Syntaxe Python locale | 3 fichiers analysés par AST | Python auxiliaire 3.12 hors PATH ; ne vaut pas compatibilité Hermes 3.14 |
| Agent PostgreSQL / parcours simulé | Ajoutés, CI en cours | Isolation, capacités, budgets, coût inconnu, décisions, source obsolète, replay ; Alice/Vera/Gina et évolution dans l'UI |

Le commit de recette suivant est `30f70aea4da427b82658c59ddd1cc4eda2fbeff3`. Les résultats seront complétés après inspection des jobs et des preuves. Un échec intermédiaire n'est pas une preuve finale.

## Limites locales

Installation npm hors ligne incomplète ; `npm run verify` s'arrête sur Prettier absent. Docker CLI existe, mais accès aux pipes Docker Desktop refusé. Sortie réseau terminal refusée. La CI du dépôt effectue les vérifications possibles à distance, sans revendiquer un succès local Windows.

La mise à niveau d'une base UL-015 existante avec ses volumes doit être vérifiée séparément du démarrage neuf. Aucune suppression de volume. Les captures simulées sont produites depuis la stack CI réelle et reliées au SHA du run.

## Live — non exécuté

Aucune clé OpenRouter autorisée configurée dans les fichiers prévus. Aucun secret affiché, ajouté au dépôt ou emprunté à un autre système. **Aucun appel payant, coût ou latence live observé.** `openai/gpt-4.1-mini` est vérifié dans le catalogue officiel pour outils/sortie structurée ; qualité, latence et coût dans l'application non mesurés.

La [procédure](DEMO-AGENTIQUE.md) prépare le vrai service Hermes et la passerelle OpenRouter. Recette restante : principal, évolution, pause, contradiction/insuffisance, opposition, puis revue sémantique avec les [critères](SCENARIOS-AGENTIQUES.md). Collecter appels modèle/outils, références, publication contrôlée, décision humaine et différence matérielle après ingestion.

La revue humaine de pertinence et l'approbation produit **ne sont pas acquises**. Une approbation de test prouve une transition métier, pas une validation par Thomas.
