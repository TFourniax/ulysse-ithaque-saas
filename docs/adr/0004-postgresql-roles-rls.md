# ADR-0004 — PostgreSQL : migrations SQL, rôles séparés et RLS forcée

Date : 2026-10-06. Statut : accepté pour la V1 (UL-003), vérifié par tests d'intégration.

## Contexte

Le SaaS est multi-entreprises. DATA-API et SECURITY exigent un compte applicatif non propriétaire sans BYPASSRLS, des politiques USING/WITH CHECK, un contexte tenant transactionnel sans fuite de pool, et des tests avec le rôle réel d'exécution.

## Décision

- **Migrations SQL versionnées** (`packages/database/migrations/NNNN_*.sql`) appliquées par un exécuteur maison : verrou consultatif, une transaction par fichier, somme SHA-256 enregistrée. Un fichier déjà appliqué et modifié est refusé. Pas d'ORM : les politiques RLS, rôles et grants sont du SQL de toute façon. Options écartées : node-pg-migrate/graphile-migrate (dépendance supplémentaire sans gain sur ce périmètre), ORM (masque les requêtes que la RLS doit contraindre).
- **Rôles** (créés par `npm run db:bootstrap`, idempotent) :
  - `ulysse_migrator` (LOGIN) : propriétaire du schéma, applique les migrations et le provisionnement ;
  - `ulysse_runtime` (NOLOGIN) : porte les privilèges de tables ;
  - `ulysse_app` (LOGIN, membre de runtime) : API ;
  - `ulysse_worker` (LOGIN, membre de runtime) : worker et pg-boss ;
  - `ulysse_definer` (NOLOGIN, BYPASSRLS) : propriétaire de quelques fonctions SECURITY DEFINER étroites.
  Aucun rôle LOGIN n'a BYPASSRLS ni SUPERUSER. Chaque processus ne reçoit que le mot de passe de son rôle.
- **RLS** activée et **forcée** sur toutes les tables métier ; politique `tenant_id = app.current_tenant_id()` en USING et WITH CHECK. Le contexte est posé par `set_config(..., true)` dans chaque transaction (portée locale : remis à zéro au COMMIT/ROLLBACK). Contexte absent → NULL → aucune ligne.
- **Clés composites** `(tenant_id, id)` et clés étrangères composites : une ligne ne peut pas référencer un objet d'une autre entreprise.
- **Exceptions explicites** : `sessions` et `oidc_login_attempts` (infrastructure d'authentification consultée par hachage d'un jeton aléatoire avant tout choix d'entreprise) n'ont pas de RLS et ne sont accessibles qu'au rôle API.
- **Fonctions privilégiées** : `find_user_by_subject` (API, connexion), `due_connections`, `active_tenants`, `claim_outbox`, `mark_outbox_published`, `outbox_backlog`, `purge_expired` (worker), `provision_*`/`set_membership` (migrateur). Elles ne renvoient que des identifiants ou des compteurs. Un test vérifie l'ACL exacte de chacune.
- **Append-only** : `audit_events`, `decisions`, `recommendation_revisions` n'ont que SELECT/INSERT pour le runtime, plus un trigger qui rejette UPDATE/DELETE.
- **pg-boss** est installé par l'étape de migration (rôle migrateur) avec ses files ; le worker reçoit uniquement des droits DML sur le schéma `pgboss`. L'API n'y a aucun accès : elle passe par l'outbox.

## Conséquences

- Le provisionnement d'une entreprise ou d'un utilisateur est une opération d'administration (CLI), pas une API publique.
- Changer un nom de rôle impose une migration et une mise à jour du bootstrap.
- Une purge légale d'audit nécessitera une procédure d'administration documentée (désactivation contrôlée du trigger).
- Défaut corrigé pendant la mise en œuvre : un `REVOKE ... FROM PUBLIC` exécuté après `ALTER FUNCTION ... OWNER` restait sans effet et laissait le rôle API exécuter `provision_tenant`. L'ordre est corrigé et couvert par un test d'ACL.

## Preuves

`npm run test:integration` crée une base jetable, applique les migrations et exécute : la suite de scénarios métier sous `ulysse_app`, les tests RLS (absence de contexte, lecture/écriture croisée, FK composites, non-fuite du pool, append-only, privilèges API/worker), l'idempotence des migrations et le refus d'un historique modifié.
