# Backlog canonique

Version de fondation du 6 octobre 2026. Ce fichier fait foi tant qu'un passage documenté vers GitHub Issues n'a pas eu lieu. Pas de calendrier client implicite. Responsable non attribué = un contributeur doit prendre la tâche avant de modifier.

| ID | Objectif | État | Dépendances | Condition de clôture |
| --- | --- | --- | --- | --- |
| UL-001 | Cadrage, règles communes, blueprint et kernel de référence | done | — | Docs de reprise + demo hors ligne + 22 tests métier ; limites explicites |
| UL-002 | Tooling strict, API et identité/memberships | todo | UL-001 | Lockfile, tsc/lint/build ; session OIDC, tests droits/membership/révocation ; API documentée |
| UL-003 | PostgreSQL/RLS et décisions durables | todo | UL-002 | Migrations appliquées, tests sous rôle non privilégié, conflits/idempotence/atomicité et redémarrage prouvés |
| UL-004 | Worker, pg-boss, outbox et synchronisation fixture | todo | UL-003 | Ingestion planifiée sans utilisateur, checkpoints/crash/retry/révocation et deux tenants testés |
| UL-005 | Contrat connecteur et normalisation versionnée | todo | UL-003 | Capability/pagination/version/deletion/scopes/erreurs ; fixture et tests de contrat |
| UL-006 | Tableau de bord et décisions de bout en bout | todo | UL-002, UL-003, UL-004 | Liste/détail/provenance/erreurs/décisions/historique ; Playwright et accessibilité |
| UL-007 | Choisir et borner le premier pilote/source | blocked | Décision métier, accès et contrat | Utilisateur/processus/source, fraîcheur, données et critères de valeur consignés |
| UL-008 | Une intégration réelle autorisée | blocked | UL-005, UL-007 | Auth fournisseur, lecture, pagination, quotas, suppressions, révocation et preuve réelle |
| UL-009 | Doctrine initiale validée, analyse et qualité | partial | Doctrine/licence et cas pilotes | Kernel présent ; doctrine réelle privée/versionnée, déduplication matérielle, obsolescence et panel annoté restent à faire |
| UL-010 | Formulation/extraction assistée par modèle | todo | UL-009, choix traitement données | Adaptateur, budget, schéma, preuves, injection/abstention ; valeur supérieure au baseline mesurée |
| UL-011 | Exploitation, sauvegarde et reprise | todo | UL-003, UL-004 | Compose/services réels, alertes, quotas, secrets, restauration testée et runbooks |
| UL-012 | Recette pilote et alpha contrôlée | todo | UL-006, UL-008, UL-009, UL-011 | ACCEPTANCE avec preuves au commit ; limites et accès pilote explicites |
| UL-013 | Réconcilier la pièce jointe initiale | blocked | Fichier lisible | Lire le document exact, comparer exigences/stack, conserver arbitrages explicites |
| UL-014 | Licence, hébergement et conditions d'exploitation | todo | Arbitrages responsables | Décisions documentées sans inventer contrat, coûts ou droits |

UL-010 n'est pas un prérequis absolu d'alpha si les règles suffisent au périmètre convenu. Une intégration réelle et des utilisateurs pilotes le sont pour qualifier la valeur réelle.

## Premier lot à prendre

UL-002 : installer les outils, exécuter le typage strict du kernel, créer l'API et l'identité locale. Ensuite UL-003 pour passer à des décisions durables. Le kernel reste l'oracle métier pour les invariants ; l'auth et la DB nécessitent leurs propres preuves.

## Dette de fondation

| Dette | Impact | Clôture |
| --- | --- | --- |
| DEBT-001 | Aucun tsc/lint ; TypeScript natif seulement | UL-002 |
| DEBT-002 | Adaptateur mémoire non durable, sans transaction distribuée | UL-003 |
| DEBT-003 | Context de confiance sans authentification réelle | UL-002 |
| DEBT-004 | Règle fictive, pas doctrine métier validée | UL-009 |
| DEBT-005 | Absence de statut persistant expired/superseded, suppression et ACL fines | UL-003/UL-009 |
| DEBT-006 | Déduplication par version entière ; changements non matériels peuvent recréer un signal | UL-009 |
| DEBT-007 | Pas de worker autonome, source réelle ni interface | UL-004/UL-006/UL-008 |
| DEBT-008 | Cahier joint non accessible | UL-013 |

Le kernel peut retourner une proposition existante déjà décidée lors d'une génération rejouée ; le worker/UI cible devra filtrer l'état et l'expiration. La validation finale protège déjà contre expiration et preuve changée. Ne pas présenter l'état pending mémoire comme une preuve de fraîcheur actuelle.
