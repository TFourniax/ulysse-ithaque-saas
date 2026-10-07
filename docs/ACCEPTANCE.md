# Recette et preuves

## Complément UL-016 (2026-10-07)

Les preuves historiques ci-dessous restent applicables. [VALIDATION-UL-016](VALIDATION-UL-016.md) distingue contrôles simulés, véritable boucle Hermes sur endpoint simulé et validation fournisseur live. Cette dernière et la revue humaine de pertinence restent attendues ; le lot est **partial**.

| Invariant | Contrôle du lot |
| --- | --- |
| Schéma fermé, citations récupérées, opposition/pause | `packages/domain/test/agent.test.ts` |
| Rôles réels, capacités, références interentreprises et coût inconnu | `apps/worker/test/worker.test.ts`, migration 0009 et catalogue des privilèges |
| Versions modifiées, rejeu, décisions et révocation | Même suite PostgreSQL ; aucune publication du résultat obsolète |
| Sept outils réels ; registres et homes isolés | `services/hermes/test_integration.py`, vrai AIAgent épinglé, fournisseur simulé |
| Sources, ingestion, évolution, preuves, décision, viewer et Globex | `scripts/agent-smoke.mjs` sur l'image complète, captures CI |
| Mise à niveau et état durable | Matrice fresh/upgrade UL-015 ; `scripts/upgrade-smoke.mjs`, même volume et décision antérieure |
| Pertinence commerciale et résistance sémantique aux injections | Catalogue [SCENARIOS-AGENTIQUES](SCENARIOS-AGENTIQUES.md), revue de sorties live requise |


Mis à jour : 2026-10-06 (UL-012a). Les preuves ci-dessous ont été exécutées sur **données fictives** (deux entreprises fictives, CRM simulé, doctrine fictive, Keycloak de développement). Elles démontrent le comportement du logiciel, pas sa valeur commerciale réelle.

Référence de preuve : commit `a3160dc`, [CI run 37543605537](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/37543605537) (jobs `static-and-unit` Ubuntu/Windows, `integration-postgres`, `e2e-browser`, `container-stack`), plus les exécutions locales consignées dans les journaux. Les suites : `domain` (scénarios exécutés contre l'adaptateur mémoire **et** PostgreSQL), `database`, `api`, `worker`, `ai`, `connectors`, recette navigateur `apps/web/e2e/journey.spec.ts`, test de fumée `scripts/smoke.mjs`.

## Parcours SaaS : correspondance avec les preuves

| # | Critère | Preuves (noms de tests ou commandes) | État |
| --- | --- | --- | --- |
| 1 | Deux entreprises, memberships et permissions ; connexion identifiée ; tenant falsifié refusé ; ressource d'une autre entreprise invisible | api : « browser-supplied tenant ids or roles are ignored; switching to a foreign tenant is refused », « a user with several memberships must pick a tenant… », « a viewer can read but cannot decide (HTTP 403)… » ; database : RLS (« without a tenant context nothing is visible », « a tenant context only sees and writes its own rows », FK composites, non-fuite du pool) ; e2e : « companies are isolated, even with a copied URL », « a user of two companies chooses one and switches without mixing data » | vérifié (fictif) |
| 2 | Source autorisée : synchronisation initiale, pagination, alimentation suivante sans action utilisateur | worker : « authorizing a source leads to synced facts and proposals with no further user action », « a large tenant yields between pages… » ; connectors : « incremental reads resume from the checkpoint and observe updates and deletions » ; stack : propositions générées après le seed sans action | vérifié avec le connecteur **fictif** ; source réelle bloquée (UL-008) |
| 3 | Nouvelle donnée → proposition avec source, date, versions, sans chatbot | e2e : « a change at the source produces a new proposal through the background pipeline », « proposals appear from background ingestion, prioritized and explained, without any question » ; domain : « background facts produce an explained, sourced recommendation without any question » | vérifié (fictif) |
| 4 | Priorisation compréhensible et limitation des doublons | domain : « metadata-only source changes do not re-post the same signal », « the doctrine volume cap keeps only the highest priorities open », « a rejection starts a cooldown… », « a decided proposal is not re-published… » ; pure : « fixture rules are explicit, fictional and explain their priority » | vérifié avec règles **fictives** ; doctrine réelle bloquée (UL-009) |
| 5 | Preuve ouvrable seulement par les utilisateurs autorisés | e2e : isolation par URL copiée, viewer en lecture seule ; database : RLS ; api : réponses de connexion sans credential ni curseur | vérifié (fictif) |
| 6 | Source modifiée avant validation → approbation bloquée ou nouvelle révision | domain : « approval is blocked when the source changed after generation », « approval checks source freshness independently from the TTL », « a material change supersedes the pending proposal and links both » | vérifié (mémoire et PostgreSQL) |
| 7 | Approbation/rejet durables, acteur et date, retry identique, concurrence explicite | api : « approval is idempotent, conflicts are explicit and the history is attributed » ; domain : retries, clés d'idempotence, deux reviewers concurrents ; e2e : « approval is recorded, attributed, persistent and executes nothing externally », « two reviewers deciding at the same time: the second gets an explicit conflict », « editing the proposed step creates a revision that needs its own approval » | vérifié |
| 8 | Révocation connexion/membership → arrêt d'accès, jobs et restitution | api : « a revoked membership loses access on the next request; a disabled user loses the session » ; worker : « revocation stops access and purges source data through the outbox » ; domain : « revoking a connection blocks new syncs, closes its proposals and allows purge », « a revocation committed during a sync stops the next page » | vérifié |
| 9 | Redémarrage/crash → reprise checkpoint/outbox sans double décision | worker : « a crash before commit leaves nothing; a crash after commit resumes from the checkpoint », « replaying a sync job or its events creates no duplicates », « graceful stop lets the current page commit… » ; stack : redémarrage API/worker avec session conservée (local et CI `container-stack`) | vérifié |
| 10 | Sauvegarde puis restauration vérifiées sur environnement de test | `npm run db:backup` / `db:restore` : exercice local (36 tables, 235 lignes, RLS forcée sur 17 tables, rôle API isolé) puis API démarrée sur la base restaurée ; CI `container-stack` ; refus mauvaise clé / fichier modifié ; database : tests du chiffrement authentifié | vérifié sur stack locale et CI ; environnement cible non défini (UL-011b) |
| 11 | Panne source/modèle/worker → statut visible, alerte et procédure | worker : « transient errors are retried with backoff; terminal errors stop and are visible » ; ai/worker : panne fournisseur → formulation déterministe ; santé `/health/ready` ; [règles d'alerte](../infra/observability/alerts.yml) validées par promtool ; [runbooks](OPERATIONS.md) | partiel : alerting non déployé (DEBT-015) |
| 12 | Donnée contenant une injection de prompt → aucune modification de permission ni action | ai : « source-derived text is passed as data in a JSON block, never as instructions », « unknown citations, missing material facts, invented figures, links and schema drift are rejected », panel fictif avec cas d'injection ; aucun outil n'est fourni au modèle ; domain : « unknown raw fields are dropped and source text never reaches the audit log » | vérifié en simulation ; modèle réel non testé (UL-010) |
| 13 | Coût/usage et fraîcheur réellement observés ; budgets plafonnés | worker : usage enregistré dans `model_usage`, « model calls stop when the tenant budget is reached » ; métriques `ulysse_connection_data_age_seconds`, `ulysse_time_to_recommendation_seconds`, `ulysse_model_*` ; limites de débit API | partiel : aucun coût réel observé (pas de clé) ; fraîcheur observée seulement sur la source fictive |
| 14 | Parcours clavier, mobile et conflits API dans l'interface | e2e : « keyboard navigation reaches every action and pages have no serious accessibility violation », « @mobile the dashboard is usable on a small screen without horizontal scrolling », conflit de décision affiché | vérifié sur Chromium (DEBT-017) |
| 15 | Un pilote réel annoté confirme l'utilité des propositions | — | bloqué : UL-007, UL-012c, Q-001, Q-010 |

Contrôles transverses vérifiés : aucune exécution externe (aucune méthode d'envoi n'existe ; tests d'approbation), journaux sans code OIDC, jeton, cookie ni corps de requête (tests observability et vérification des journaux de l'API), en-têtes de sécurité, limites de débit, OpenAPI à jour.

## Mesure du pilote (à exécuter avec un responsable désigné)

Plan proposé, à valider dans [PILOT](PILOT.md) : rien ci-dessous n'est mesuré à ce jour.

- **Avant** : cas inclus, volume, utilisateurs, période, sources, droits, cadence et critères de succès décidés et datés par le responsable du pilote.
- **Pendant** : chaque décision porte une évaluation (utile, correcte mais non actionnable, doublon, obsolète, non fondée, hors périmètre), disponible depuis UL-012b ([ADR-0011](adr/0011-mesure-pilote.md)) ; les abstentions (`missing_data`, `stale_source`, `volume_cap`, `rejection_cooldown`, `already_decided`) sont enregistrées par analyse. La page « Mesure » et `GET /v1/reports/quality` restituent ces chiffres par entreprise et par période.
- **Indicateurs** calculés à partir des données enregistrées : part des propositions jugées utiles, motifs de rejet, abstentions par motif, délai observation → proposition (`ulysse_time_to_recommendation_seconds`), délai proposition → décision, propositions expirées sans décision, coût modèle par proposition si activé.
- **Couverture** : sur un échantillon de cas éligibles annotés par l'équipe pilote, part des cas pour lesquels Ulysse a proposé quelque chose.
- **Gain de temps** : mesuré avant/après sur une tâche comparable ; jamais extrapolé depuis la démonstration fictive. Aucun ROI n'est annoncé par ce dépôt.

## Gate alpha

Toutes les exigences pertinentes du périmètre pilote disposent d'une preuve au commit testé ; tests critiques verts **dans l'infrastructure cible** ; revue droits/provenance/révocation ; limites connues ; responsable du pilote ; restauration et runbook exercés sur l'environnement pilote. État : non atteint — infrastructure cible, source réelle, doctrine validée et responsable du pilote manquent.
