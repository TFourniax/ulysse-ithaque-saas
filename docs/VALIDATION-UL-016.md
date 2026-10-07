# Rapport de validation UL-016

Date : 2026-10-07. **partial** : intégration et parcours simulé vérifiés ; validation fournisseur live et revue humaine de pertinence non réalisées faute de clé autorisée. PR [#3](https://github.com/TFourniax/ulysse-ithaque-saas/pull/3), branche `codex/ul-016-hermes-demo`, base exacte `598f082ab33fb87faf5ff357285dc95b536bb1b3`.

## Preuves au commit vérifié

Code et contrats vérifiés au head `562cf83e1e46559560f019ffdde0f30e384cd5fd`. Checkout de recette PR `65eae5fdeb4df6831d8958fb5f388bb6aede49ce`. [CI applicative, cinq jobs verts](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/37651082514), [recette UL-016, quatre jobs verts](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/37651082522). Les preuves ci-dessous portent sur ce SHA. Une protection supplémentaire des résultats techniques a ensuite été ajoutée : une erreur de l'agent est enregistrée sans fermer les propositions existantes. Le SHA et la recette complémentaire sont consignés dans le journal.

| Contrôle | Résultat observé | Portée |
| --- | --- | --- |
| `npm run verify` | Passe ; CI statique directe Windows et Ubuntu verte | Format, lint, types, cycles, OpenAPI, tests et règles du dépôt |
| `npm run test:integration` / PostgreSQL | 50/50 database, 17/17 API, 20/20 worker | Vrais rôles RLS, migrations, privilèges, identité, CSRF, décisions, conflits |
| Contrôles agentiques worker | 9/9, inclus dans les 20 | Isolation OPP-001 entre entreprises, pause/opposition/manque, capacités, budget concurrent, source modifiée, coûts/retries, lease/replay, citation inventée, décision concurrente |
| `npm run test:e2e` | 12/12, 36,2 s | Non-régression UL-015, clavier, thèmes, axe et mobile |
| Stack historique | Passe | Image compilée, seed, propositions, reprise, sauvegarde/restauration |
| Image Hermes et Python | Construction reproductible et contrôles Python passent | Commit officiel épinglé, installateur scellé, Python 3.14.4 |
| Vraie boucle Hermes / endpoint modèle simulé | Passe, deux processus simultanés ; test en 5,466 s | Deux transmissions modèle et get_opportunity réellement exécuté par run ; exactement sept outils ; capacités séparées |
| Stack agentique simulée neuve | Passe | Alice, détail/source, ingestion d'un événement, évolution matérielle, outils, preuves, décision, restart, Vera et Globex |
| Mise à niveau depuis UL-015 | Passe | Ancienne image construite au SHA de base, mêmes volumes ; session, opportunités et décision conservées ; données enrichies ingérées et parcours complet après migration |
| Accessibilité des nouveaux parcours | Passe | Axe sans violation sérieuse/critique sur sources, analyses et décision ; pas de débordement à 390 px |

Les contrôles de passerelle vérifient les coûts déclarés, estimés et inconnus, la conservation de 0,25 USD lors d'une issue incertaine, huit transmissions maximum retries compris, réservations atomiques, reprise avant publication et refus d'une citation inventée. Une décision humaine consultée qui change pendant l'analyse produit obsolete/history_changed. Le replay après publication et avant confirmation du job conserve la même proposition.

La boucle Hermes utilise les véritables classes et le dispatcher upstream. Le faux endpoint ne remplace pas cette boucle. Son résultat scripté est une preuve d'intégration, jamais une proposition live. Le mode agentique simulé du worker n'appelle aucun fournisseur et est affiché comme tel.

## Parcours et captures

Preuves structurées versionnées : [base neuve](evidence/ul016-simulated-fresh.json), [mise à niveau](evidence/ul016-simulated-upgrade.json). Chaque parcours évolué comporte dix événements durables, sept outils, origine simulée, zéro appel modèle et une approbation de test. Ce geste de recette automatisée n'est pas une approbation produit de Thomas.

Captures obtenues dans la stack réellement construite et testée : [sources, analyses et décision — base neuve](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/37651082522/artifacts/11496657473), [mêmes vues après mise à niveau](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/37651082522/artifacts/11495889041). Les cookies de session ne sont pas inclus dans les artifacts. Les références et décisions restent dans PostgreSQL ; les preuves JSON ci-dessus restent dans le dépôt.

Durée des événements de l'analyse simulée évoluée : 72 ms (neuve), 45 ms (mise à niveau). Ces durées d'un moteur simulé ne préjugent pas de la latence d'un modèle. Le test de boucle Hermes avec faux endpoint dure 5,466 s pour les deux processus, démarrage inclus.

## Limites de l'environnement

Installation npm locale hors ligne incomplète : la vérification initiale s'arrête sur Prettier absent. Docker CLI présent mais pipes Docker Desktop refusés. Sortie réseau du terminal refusée. Le transport du poste d'exécution s'est ensuite fermé ; les corrections et preuves finales sont publiées via GitHub et vérifiées par CI. La copie personnelle, ses volumes, Hermes personnel, Thomas Brain et les autres serveurs sont restés intacts.

La recette Linux CI ne prouve pas un lancement sur le Docker Desktop personnel de Thomas. Les vérifications TypeScript passent aussi sous Windows ; la procédure PowerShell a été analysée syntaxiquement, mais son exécution Docker Desktop reste à confirmer. Aucun volume supprimé.

## Live — non exécuté

Aucune clé OpenRouter autorisée trouvée dans les fichiers prévus ou l'environnement inspecté. **Aucun appel payant, usage, coût ou latence live observé.** Modèle fixe préparé : `openai/gpt-4.1-mini`, compatible outils/JSON selon le catalogue officiel ; qualité et latence dans Ulysse non mesurées. Les prix configurés 0,40 USD/M entrants et 1,60 USD/M sortants sont des plafonds de réservation, pas des coûts observés.

Suivre [DEMO-AGENTIQUE](DEMO-AGENTIQUE.md) pour la clé ignorée par Git, le service privé et les plafonds 0,25 USD/run, 2 USD/session, 10 USD/entreprise/mois. Recette restante : principal, évolution après ingestion, pause, contradiction ou insuffisance, opposition. Pour le principal : appels fournisseur/outils, références, publication serveur et décision humaine ; pour l'évolution : changement matériel des sources et de la prochaine étape.

La revue humaine attendue porte précisément sur la pertinence commerciale, la fidélité des justifications aux sources, la résistance sémantique à l'injection, le rapprochement offre/besoin et la prudence face aux contradictions, selon [SCENARIOS](SCENARIOS-AGENTIQUES.md). Les droits, versions et références ne prouvent pas à eux seuls le sens d'une affirmation. Les contraintes exprimées uniquement en langue naturelle ne bénéficient pas d'une validation sémantique acquise. Aucun verdict humain ni pourcentage de confiance inventé.

UL-016 ne remplit donc pas ses conditions done. UL-008 (sources réelles), UL-009 réel et UL-012c (pilote) restent ouverts.
