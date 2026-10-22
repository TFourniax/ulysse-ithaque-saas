# UL-019 — Première réussite acheteur GLM rapportée sur VPS

Date : 2026-10-21 (Europe/Paris). Responsable : Codex. Branche : codex/ul-019-model-profiles, PR #7. Objectif : consigner la recette transmise par Thomas et distinguer réussite fonctionnelle, qualité et fiabilité. Fichiers affectés : ce journal, STATUS et BACKLOG. Aucun code applicatif, profil, budget, donnée métier ou déploiement modifié.

## Éléments de preuve

- Le 20 octobre à 23 h 44, le diagnostic en lecture seule transmis par Thomas montre `provider_http_429` dans le run et les journaux worker, HTTP 429, un appel modèle, zéro outil, coût inconnu avec provision interne de 0,006444 USD. La première cause reste visible malgré `invalid_final_response` dans Hermes. Les provisions ne sont pas une facturation confirmée.
- L'essai précédent, créé à 23 h 39, a enregistré une réponse fournisseur (1 403 tokens d'entrée, 12 de sortie), aucun outil, puis un échec générique après 90,5 secondes. La cause précise reste inconnue ; le 429 de l'essai suivant ne l'explique pas rétrospectivement.
- Le 21 octobre à 00 h 25, Thomas annonce que GLM a abouti et transmet le diagnostic affiché en `hermes-live`, statut « Brouillon à relire ». Il comporte cinq rubriques, des références à cinq sources en version 1, huit questions d'achat marquées comme hypothèses simulées et un verdict d'unicité « preuves insuffisantes ». Le résultat et les sources métier ne sont pas recopiés dans le dépôt.
- Les métriques et les événements du run réussi n'ont pas été fournis. Aucun accès SSH, appel payant ou contrôle des sources privées effectué depuis cet environnement. La réussite est rapportée par l'utilisateur ; elle ne constitue pas une mesure de disponibilité ni un audit indépendant de fidélité des citations.

## Vérification du rendu et décision

Le code `apps/web/src/pages/Workflows.tsx` place les limites dans un élément `details` fermé par défaut. Le contrat et le domaine refusent les chaînes vides ou composées uniquement d'espaces. Les quatre puces sans texte du copier-coller ne suffisent pas à établir un défaut des données ou du rendu ; ouvrir le panneau dans l'application est la vérification utile. Aucun correctif d'affichage spéculatif.

GLM reste le modèle de la recette rapportée. Le profil Mistral Small 4 proposé comme secours existe, mais aucune bascule ni génération Mistral n'est attestée. Aucun fallback automatique n'est livré. DEBT-022 est close pour la remontée d'erreur des nouveaux runs ; DEBT-023 porte la reprise après refus transitoire et sa validation.

## Suite de la recette

1. Relire le diagnostic avec les sources correspondantes, notamment les affirmations d'absence de preuves. Une information absente du corpus n'est pas nécessairement absente de l'entreprise.
2. Créer un contenu lié à ce diagnostic avec cible, phase, canal et objectif précis ; vérifier que ses promesses n'ajoutent aucun prix, résultat mesuré, témoignage ou délai absent des sources.
3. Compléter le corpus autorisé par des preuves d'offres, cas clients et alternatives comparables, puis observer les différences de diagnostic. Ne pas inventer de benchmark.
4. Relever les compteurs des essais suivants (coût, délai, outils, résultat) avant de conclure sur la fiabilité ou la qualité. Les deux autres parcours et la revue métier demeurent ouverts.

## Validation de cette mise à jour

Changement documentaire uniquement. `npm run verify` réussi avant publication : format, lint strict, typecheck, cycles, OpenAPI, tests unitaires et contrôle des liens internes (53 fichiers Markdown). `git diff --check` réussi. Ces vérifications ne constituent pas une nouvelle inférence GLM ni une recette VPS indépendante.
