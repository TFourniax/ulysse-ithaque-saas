# UL-020 — preuves obligatoires préparées avant génération

Date : 21 octobre 2026. Responsable : Codex. Branche : `codex/ul-020-web-research`, PR draft #8. Objectif : traiter le refus `required_source_unread` du diagnostic acheteur, sans demander à Thomas de refaire la recherche ou de sélectionner moins de sources.

## Constat

La capture transmise montre « Analyse interrompue » et `required_source_unread` sur le diagnostic du 21 octobre à 20 h 40 (Europe/Paris). La campagne de recherche reste associée au brief. Le SHA, le profil actif, les références manquantes et les coûts de cet essai ne sont pas visibles. L'erreur atteste un refus du contrôle des lectures obligatoires, pas une disparition des données de recherche.

Le code demandait au modèle de choisir les appels `get_workflow_context` et `read_company_source`, puis exigeait toutes les références sélectionnées au contrôle final. Le simple respect du format JSON ne suffisait donc pas à rendre le diagnostic publiable.

## Changement

La passerelle fournit à chaque appel buyer/content les textes sélectionnés et le contexte exacts dans un message de données non fiables. Ce message est contrôlé, chiffré dans la réservation et soumis au plafond de contexte avant toute transmission. Ses références rejoignent le registre existant des preuves consultables. Les sources supplémentaires du benchmark restent à lire par outil et aucune citation non transmise n'est autorisée. La correction de format conserve un seul exemplaire de la préparation et ses limites existantes.

Fichiers : `apps/worker/src/agent-runtime.ts`, `workflow-runtime.ts` et tests worker; prompt, runner, modèle simulé et test Python Hermes; recette `november-smoke.mjs`; diagnostic VPS, documentation et ADR-0013. Pas de dépendance ni migration. Le script `2026-10-21.research6-evidence` affiche les nombres de sources/références fournies automatiquement dans `diagnose`.

## Vérification

- Compilation TypeScript réussie.
- Quatre tests Python ciblés réussis : paramètres, continuité du raisonnement, format final, sources préparées et lecture distincte des concurrents.
- Tests PostgreSQL ajoutés : huit textes effectivement transmis au modèle scripté sans choix de lectures, diagnostic buyer puis contenu lié, source hors sélection et autre tenant absents, citation non transmise refusée. La taille et le budget sont vérifiés avant transmission ou inscription des références; la correction ne double pas le message.
- La recette Hermes de stack exige la preuve de réception automatique des sources dans les deux parcours.
- `npm run verify`, intégration PostgreSQL, navigateur et workflows Hermes : en cours de validation, résultats à consigner après exécution.

Les tests utilisent des données fictives et des fournisseurs scriptés. Aucun appel réel Brave/modèle ni accès au VPS depuis cet environnement.

## Limites et suite

DEBT-031 reste ouverte jusqu'à la validation complète et à la reprise VPS. La transmission du texte n'est pas une preuve de lecture attentive ou de justesse; les citations et le benchmark live restent à relire. Un corpus obligatoire trop volumineux ou une enveloppe réellement insuffisante reste refusé. Les plafonds et les coûts incertains ne sont pas modifiés.

Après publication validée : déployer application et Hermes ensemble, conserver la campagne en pause, recharger puis « Reprendre ce brief » et relancer le diagnostic. Le prochain essai réutilise les données existantes. Si un nouveau refus apparaît, relever le code et les compteurs `diagnose`, sans relancer la collecte ni réinitialiser la session.
