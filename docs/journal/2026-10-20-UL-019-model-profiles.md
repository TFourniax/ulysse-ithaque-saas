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

Vérifié localement : `npm run verify` (format, lint strict, types, cycles, OpenAPI, tests unitaires et liens documentaires), 12 tests unitaires worker, `bash -n scripts/ulysse-vps-europe.sh`, 5 tests Python de transformation VPS, 3 tests Python de paramètres/résultat/restitution du raisonnement et compilation des fichiers Python modifiés. Docker est absent de cet environnement ; les vérifications conteneurisées sont exécutées par la CI du dépôt. Aucun appel fournisseur. Une boucle simulée ne valide pas la qualité GLM sur Paitite.

La première CI de 50dae7e a détecté la suppression du raisonnement par le transport Hermes custom entre appels d'outils. Correction par le middleware officiel llm_execution du plugin Ulysse : restitution exacte des champs OpenRouter depuis une mémoire bornée du processus isolé ; aucune persistance ni modification du moteur amont. Le test exige désormais aussi la conservation d'une signature opaque, avec test unitaire d'isolation, de borne et d'absence de retry implicite. Le modèle simulé des stacks GLM refuse lui aussi une signature manquante.

Code final vérifié : **e793f24a51a437b5b2c27ff6f251c0fe49b04ecf**, branche codex/ul-019-model-profiles, [PR draft #7](https://github.com/TFourniax/ulysse-ithaque-saas/pull/7), sans fusion.

- [CI applicative](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/39482271129) : **5/5 jobs verts**, unités et contrôles Linux/Windows, PostgreSQL, navigateur et stack conteneurisée.
- [Hermes et mises à niveau](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/39482271316) : **6/6 jobs verts**, dont cinq tests Python/boucle Hermes, stacks neuves, reprise UL-015/UL-016, parcours buyer/content GLM simulés, redémarrage et conservation de l'historique.
- La procédure est épinglée à ce SHA de code ; le commit documentaire suivant ne modifie pas les images ou scripts.

## Restant

Précontrôle réel avec le compte OpenRouter du VPS, génération GLM et revue des trois parcours. Vision/audio non activés : ingestion autorisée, transport et comptabilité spécifique restent nécessaires. Recherche web automatique et vraie doctrine Néreis non ajoutées. UL-019 partial jusqu'à recette live.
