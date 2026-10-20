# UL-019 — Profils de modèles et essai GLM 5.3 Flash

Date : 2026-10-20. Responsable : Codex. Demande : Thomas choisit GLM-5.3-Flash et demande une architecture agile pour les essais de modèles et l'évolution multimodale.

Base : codex/ul-018-europe-zdr, 27b6c845. Branche : codex/ul-019-model-profiles. Aucun changement du VPS, aucune fusion de PR ni clé utilisée dans cet environnement.

## Livrable

Profils JSON versionnés et validés, override administrateur sans reconstruction, paramètres/tarifs pilotés par le profil, conservation de l'empreinte par run, garde contre les profils modifiés en cours d'exécution. Contrat normalisé worker/Hermes ; suppression de la liste de marques Python et vérification de compatibilité avant exécution. GLM avec raisonnement low et 8 192 tokens totaux. Passerelle texte explicite avant une future ingestion multimodale.

Procédure [MODEL-PROFILES](../MODEL-PROFILES.md), décision [ADR-0015](../adr/0015-declarative-model-profiles.md). Fichiers concernés : worker (configuration, gateway, workflows, précontrôle, tests), port AgentExecutor, service Hermes, Compose, script VPS et tests, CI et documentation. Aucune migration ni interface utilisateur modifiée.

## Vérifications

- Tests unitaires des profils, refus des paramètres non autorisés, coût GLM, précontrôle sans inférence et frontières texte.
- Tests PostgreSQL ajoutés : profil enregistré, refus d'un changement à modèle identique avant transmission, paramètres GLM et coût incluant le raisonnement.
- Test boucle réelle Hermes étendu : profils historiques, identifiant inconnu au code et préservation du raisonnement à travers un appel d'outil GLM.
- Stacks CI neuve et mise à niveau UL-016 dirigées vers le profil GLM avec modèle simulé privé.
- Tests de transformation VPS : préservation clé/session/budgets/services, rollback, changement par identifiant et profil JSON, JSON invalide.

Vérifié localement : `npm run verify` (format, lint strict, types, cycles, OpenAPI, tests unitaires et liens documentaires), 12 tests unitaires worker, `bash -n scripts/ulysse-vps-europe.sh`, 5 tests Python de transformation VPS, 2 tests Python de paramètres/résultat et compilation des fichiers Python modifiés. Docker est absent de cet environnement ; la boucle Hermes et les stacks sont déléguées à la CI du dépôt, dont le résultat reste attendu à ce commit. Aucun appel fournisseur. Une boucle simulée ne valide pas la qualité GLM sur Paitite.

## Restant

Précontrôle réel avec le compte OpenRouter du VPS, génération GLM et revue des trois parcours. Vision/audio non activés : ingestion autorisée, transport et comptabilité spécifique restent nécessaires. Recherche web automatique et vraie doctrine Néreis non ajoutées. UL-019 partial jusqu'à recette live.
