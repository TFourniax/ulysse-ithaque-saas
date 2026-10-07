# Backlog canonique

Mis à jour le 7 octobre 2026. Ce fichier fait foi tant qu'un passage documenté vers GitHub Issues n'a pas eu lieu. Pas de calendrier client implicite. Responsable non attribué = un contributeur doit prendre la tâche avant de modifier.

États : **done** (livrable vérifiable + preuve + limites), **partial** (une partie vérifiée, le reste nommé), **blocked** (dépend d'un accès, d'une donnée ou d'un arbitrage absent), **proposed** (proposition non engagée).

| ID | Objectif | État | Dépendances | Condition de clôture / preuve |
| --- | --- | --- | --- | --- |
| UL-001 | Cadrage, règles communes, blueprint et kernel de référence | done | — | Docs de reprise, démo hors ligne ; [journal](journal/2026-10-06-foundation.md) |
| UL-002 | Tooling strict, API et identité/memberships | done | UL-001 | Lockfile, tsc/lint/build en CI ; OIDC BFF, sessions, CSRF, tests droits/membership/révocation ; OpenAPI versionné ([ADR-0005](adr/0005-outillage-et-stack.md), [ADR-0006](adr/0006-identite-oidc-bff.md)) |
| UL-003 | PostgreSQL/RLS et décisions durables | done | UL-002 | Migrations SQL contrôlées (8 à ce jour), tests sous rôles réels, conflits/idempotence/atomicité, redémarrage ([ADR-0004](adr/0004-postgresql-roles-rls.md)) |
| UL-004 | Worker, pg-boss, outbox et synchronisation fixture | done | UL-003 | Ingestion planifiée sans utilisateur, crash/retry/révocation, deux entreprises ([ADR-0007](adr/0007-worker-outbox.md)) |
| UL-005 | Contrat connecteur et normalisation versionnée | done | UL-003 | Capacités, pagination, versions, suppressions, erreurs typées ; fixture et suite de contrat ([ADR-0008](adr/0008-contrat-connecteur.md)) |
| UL-006 | Tableau de bord et décisions de bout en bout | done | UL-002–UL-004 | Liste, détail, provenance, décisions, révisions, historique ; Playwright 12/12 avec axe et mobile en CI |
| UL-007 | Choisir et borner le premier pilote/source | blocked | Décision métier, accès, contrat | Fiche [PILOT](PILOT.md) remplie et signée par le responsable du pilote (Q-001, Q-002, Q-010) |
| UL-008 | Une intégration réelle autorisée | blocked | UL-005, UL-007 | Auth fournisseur, lecture, pagination, quotas, suppressions, révocation et preuve sur la vraie source ; guide [CONNECTORS](CONNECTORS.md) |
| UL-009 | Doctrine initiale validée, analyse et qualité | partial | Doctrine/licence et cas pilotes | Fait : doctrine fictive versionnée et validée par rôle, déduplication par faits matériels, obsolescence, plafond de volume, abstentions. Reste : doctrine réelle privée fournie et validée par ses responsables (Q-004), doctrine partagée sous licence (DEBT-012), panel annoté réel |
| UL-010 | Formulation assistée par modèle | partial | UL-009, Q-008 | Fait : interface neutre, adaptateur OpenRouter, validation, injection, budget, mode dégradé, tests simulés ([ADR-0009](adr/0009-formulation-assistee.md)). Reste : appel réel vérifié, conditions de traitement validées, valeur mesurée contre la formulation déterministe |
| UL-011 | Exploitation, sauvegarde et reprise | partial | UL-003, UL-004 | **UL-011a done** : image, Compose, santé, métriques, règles d'alerte validées, sauvegarde chiffrée et restauration vérifiée (local + CI), redémarrage, commandes d'administration, [runbooks](OPERATIONS.md). **UL-011b blocked** : environnement cible (TLS, IdP, collecte/alerting, stockage hors site, RPO/RTO) — UL-014, Q-013 |
| UL-012 | Recette pilote et alpha contrôlée | partial | UL-006, UL-008, UL-009, UL-011 | **UL-012a done** : [ACCEPTANCE](ACCEPTANCE.md) reliée aux preuves au commit testé (données fictives). **UL-012b done** : évaluation structurée des décisions et rapport de mesure observée ([ADR-0011](adr/0011-mesure-pilote.md)). **UL-012c blocked** : pilote réel annoté |
| UL-013 | Réconcilier la pièce jointe initiale | blocked | Fichier lisible | Lire le document exact, comparer exigences/stack, conserver arbitrages explicites |
| UL-014 | Licence, hébergement et conditions d'exploitation | blocked | Arbitrages responsables | Décisions consignées dans OPEN-QUESTIONS/ADR sans inventer contrat, coûts ou droits ; questions préparées dans [PILOT](PILOT.md) |
| UL-015 | Refonte visuelle « tech minimaliste » de l'interface | done | UL-006 | Jetons clair/sombre, Mona Sans auto-hébergée, rail, jauges, transitions, `TableScroll` ; axe 0 violation sérieuse sur 48 combinaisons ; CSP de production vérifiée ; [CI run 37628909866](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/37628909866) au commit `2364d93` : 5 jobs verts dont recette Playwright 12/12 ; captures validées par le responsable produit le 2026-10-07 ([journal](journal/2026-10-07-UL-015-interface.md)). Captures `docs/evidence` à régénérer : DEBT-019 |

| UL-016 | Intégration Hermes et démonstration agentique fictive | partial | UL-015, clé modèle autorisée | Prise Codex, PR #3 depuis `598f082`. Outils bornés, pipeline PostgreSQL/worker, corpus, opportunités ouvrables, Analyses et décisions intégrés. Recette dans [VALIDATION](VALIDATION-UL-016.md). Clôture : vraie boucle Hermes vérifiée, stack neuve/mise à niveau, tests applicables, puis cinq scénarios live et revue sémantique. Aucun appel live observé faute de clé. |

UL-010 n'est pas un prérequis d'alpha si les règles suffisent au périmètre convenu. Une intégration réelle et des utilisateurs pilotes le sont pour qualifier la valeur réelle.

## Prochain lot à prendre

Priorité de cette branche : terminer la recette UL-016 live et la revue de pertinence selon [DEMO-AGENTIQUE](DEMO-AGENTIQUE.md). Les lots ci-dessous restent indépendants et ne sont pas clôturés par des données fictives.

1. **UL-008** dès qu'une source et un accès sont fournis, en suivant [CONNECTORS](CONNECTORS.md).
2. **UL-009** dès que la doctrine Néreis/Odyssée est fournie et validée par ses responsables.
3. **UL-011b** dès qu'un hébergement est choisi (inventaire préalable, aucune installation sur un serveur partagé existant sans vérification).
4. Sans nouvel accès : DEBT-013 (traces OpenTelemetry) ou DEBT-017 (recette Firefox/WebKit), selon les exigences du pilote.

## Dettes

| Dette | Impact | État / clôture |
| --- | --- | --- |
| DEBT-001 | Aucun tsc/lint | fermée (UL-002) |
| DEBT-002 | Adaptateur mémoire non durable | fermée (UL-003, adaptateur PostgreSQL ; la mémoire reste l'oracle de tests) |
| DEBT-003 | Contexte sans authentification réelle | fermée (UL-002) |
| DEBT-004 | Règles fictives, pas de doctrine métier validée | ouverte — UL-009, Q-004 |
| DEBT-005 | Statuts expired/superseded, suppression, ACL fines | statuts et suppressions fermés (UL-003/UL-004) ; ACL fines déplacées en DEBT-010 |
| DEBT-006 | Déduplication par version entière | fermée (empreinte des faits matériels) |
| DEBT-007 | Pas de worker, source réelle ni interface | worker et interface fermés ; source réelle → UL-008 |
| DEBT-008 | Cahier joint non accessible | ouverte — UL-013 |
| DEBT-009 | Motif de décision en texte libre seulement : pas d'étiquette de qualité exploitable pour mesurer la valeur | fermée — UL-012b (ADR-0011) |
| DEBT-010 | Droits par rôle d'entreprise uniquement ; pas d'ACL par source/dossier | ouverte — Q-006 ; ne pas charger de données à visibilité restreinte avant |
| DEBT-011 | Stockage des credentials de connecteurs réels non conçu (`noCredentialStore`) | ouverte — UL-008 |
| DEBT-012 | Doctrine par entreprise seulement ; pas de doctrine commune sous licence partagée entre entreprises | ouverte — UL-009, Q-011 |
| DEBT-013 | Pas de traces OpenTelemetry ; corrélation par `correlationId` dans journaux et erreurs | ouverte — avant pilote multi-services |
| DEBT-014 | Coût inconnu et concurrence des budgets modèle | corrigée dans UL-016 : reservation atomique avant transmission ; coût estimé/inconnu conservateur, plafonds run/session/mois, tests PG réels ; ancienne formulation payante désactivée. Recette complète de la passerelle à vérifier avant activation live. |
| DEBT-015 | Règles d'alerte non déployées (aucun Prometheus/Alertmanager) | ouverte — UL-011b |
| DEBT-016 | Avertissement de dépréciation Fastify `requestIdLogLabel` (option retirée en Fastify 6) | fermée — `LogController` ; journaux toujours corrélés par `correlationId` |
| DEBT-017 | Recette navigateur sur Chromium seulement | ouverte — ajouter Firefox/WebKit si le pilote l'exige |
| DEBT-018 | Coût de la formulation assistée sur des données réelles inconnu | ouverte — UL-010 |
| DEBT-019 | Captures de `docs/evidence` antérieures à la refonte visuelle | ouverte — UL-015, à régénérer depuis la stack réelle |
