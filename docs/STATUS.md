# État actuel

Mis à jour : 2026-10-07. Stade : **V1 de démonstration complète sur données fictives** (Résultat A). Pas de pilote réel : aucune source réelle, doctrine validée, utilisateur pilote ni environnement d'hébergement n'est disponible (Résultat B partiel).

## Ce qui fonctionne

- **Parcours** : une source autorisée (CRM fictif) est synchronisée en arrière-plan ; les faits normalisés produisent des propositions priorisées, expliquées et sourcées, sans question à un chatbot ; un humain approuve, rejette ou modifie ; tout est historisé et audité ; aucune action externe n'est exécutée.
- **Identité** : connexion OIDC réelle (Keycloak de développement) côté serveur, sessions serveur, CSRF, deux entreprises fictives, rôles owner/reviewer/viewer relus à chaque requête ([ADR-0006](adr/0006-identite-oidc-bff.md)).
- **Données** : PostgreSQL 18.6, 8 migrations, rôles séparés (le compte de migration n'est jamais le compte applicatif), RLS forcée, clés composites, tables en ajout seul ([ADR-0004](adr/0004-postgresql-roles-rls.md)).
- **Worker** : pg-boss, outbox transactionnelle, synchronisations planifiées, analyse, expiration, purge, reprise sur crash, équité entre entreprises ([ADR-0007](adr/0007-worker-outbox.md)).
- **Connecteurs** : contrat versionné et suite de tests de contrat ; seul le connecteur **fictif** existe ([ADR-0008](adr/0008-contrat-connecteur.md)).
- **Doctrine et contexte** : doctrine fictive versionnée (brouillon → validation par un owner → retrait), contexte d'entreprise versionné ; une nouvelle version remplace les propositions concernées.
- **Interface** : React/Vite accessible (clavier, axe, mobile) : propositions, détail et preuves, décisions, révisions, sources, opportunités, analyses, audit, doctrine, contexte, membres. Direction visuelle « tech minimaliste » (UL-015) : thèmes clair et sombre, police auto-hébergée, jauges de priorité, transitions respectant `prefers-reduced-motion`.
- **Mesure** : évaluation facultative de chaque décision (utile, non actionnable, doublon, obsolète, non fondée, hors périmètre) et page « Mesure » calculée uniquement à partir des données enregistrées ([ADR-0011](adr/0011-mesure-pilote.md)).
- **Formulation assistée** optionnelle (désactivée par défaut), validée côté serveur, budgétée, avec mode dégradé ([ADR-0009](adr/0009-formulation-assistee.md)) — **appel réel non vérifié**.
- **Exploitation** : image Docker unique, stack Compose complète, sauvegarde chiffrée et restauration vérifiée, commandes d'administration, règles d'alerte, runbooks ([OPERATIONS](OPERATIONS.md), [ADR-0010](adr/0010-image-et-sauvegardes.md)).

## Vérifié

Branche `claude/quirky-darwin-v4is1f`, [PR #2](https://github.com/TFourniax/ulysse-ithaque-saas/pull/2). Au commit `a3160dc` : [CI run 37543605537](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/37543605537) (push) et [run 37543609256](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/37543609256) (pull request), 5 jobs verts chacun. Les commits suivants ne modifient que la documentation.

| Contrôle | Résultat | Où |
| --- | --- | --- |
| Format, lint typé strict, `tsc -b`, cycles, fraîcheur OpenAPI, contrôle documentaire | vert | CI Ubuntu et Windows (`npm run verify` en local) |
| Tests unitaires | domain 47, connectors 9, observability 3, ai 6, database 3, api 1, worker 1 | CI Ubuntu et Windows |
| Intégration PostgreSQL 18.6 sous les vrais rôles | database 50, api 17, worker 11 | CI `integration-postgres` et local |
| Recette navigateur (Keycloak réel, API, worker, Chromium) | 12/12, dont accessibilité axe et mobile | CI `e2e-browser` et local |
| Image + stack Compose : connexion OIDC, propositions en arrière-plan, redémarrage, sauvegarde/restauration | vert | CI `container-stack` et local |
| Démo hors ligne (`npm run demo`) | vert | CI |

Captures de l'interface (données fictives) : [docs/evidence](evidence/), antérieures à la refonte UL-015 (DEBT-019). Correspondance critère par critère : [ACCEPTANCE](ACCEPTANCE.md).

## Non vérifié, partiel ou bloqué

| Sujet | État | Dépendance |
| --- | --- | --- |
| Source réelle (CRM, Stratégie, e-mail…) | bloqué (UL-008) | choix de source, accès autorisé et contrat (Q-002, Q-003) |
| Doctrine Néreis/Odyssée réelle | bloqué (UL-009) | fournie et validée par ses responsables métier (Q-004, Q-011) |
| Utilisateurs pilotes et mesure de valeur réelle | bloqué (UL-007, UL-012c) | Q-001, Q-010 ; l'outil de mesure est prêt (UL-012b) |
| Appel réel à un modèle (OpenRouter) | non vérifié (UL-010) | clé, conditions de traitement (Q-008) ; sortie réseau refusée ici |
| Environnement pilote/production, TLS, IdP de production, alerting déployé, sauvegardes hors site | non défini (UL-011b, UL-014) | Q-007, Q-008, Q-013 |
| Pièce jointe initiale | bloqué (UL-013) | fichier lisible ; son contenu n'a pas été lu |
| Licence du code et de la doctrine, contrat, prix | non décidé (UL-014) | responsables ; rien n'est supposé dans ce dépôt |

## Prochaine étape

Les lots réalisables sans nouvel accès sont livrés. La suite dépend des réponses listées dans [PILOT](PILOT.md) : UL-008 (première source réelle, dès qu'un accès est fourni), UL-009 (doctrine validée), UL-011b (environnement), puis UL-012c (pilote). En attendant : DEBT-013 (traces) ou DEBT-017 (autres navigateurs) si le pilote l'exige.

## Source et publication

Base : `codex/ul-001-foundation` ([PR #1](https://github.com/TFourniax/ulysse-ithaque-saas/pull/1), non fusionnée). Travail sur `claude/quirky-darwin-v4is1f` ([PR #2](https://github.com/TFourniax/ulysse-ithaque-saas/pull/2)). Aucune fusion sur `main`, aucun déploiement.

Journaux : [fondation](journal/2026-10-06-foundation.md), [UL-002 à UL-010](journal/2026-10-06-UL-002-v1-demo.md), [UL-011](journal/2026-10-06-UL-011-exploitation.md), [UL-012b](journal/2026-10-06-UL-012b-mesure.md), [UL-015](journal/2026-10-07-UL-015-interface.md).

Refonte visuelle UL-015 sur `claude/sweet-tesla-jrnkxs`, basée sur `claude/quirky-darwin-v4is1f` : [CI run 37628909866](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/37628909866) au commit `2364d93`, 5 jobs verts (recette Playwright 12/12, axe et mobile compris) ; captures validées par le responsable produit.
