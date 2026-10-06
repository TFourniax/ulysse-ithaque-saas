# Contrats de données et API cible

Statut : spécification d'origine, conservée pour l'intention. Mise à jour 2026-10-06 : la V1 implémente ce modèle ; la référence exacte est le code (`packages/database/migrations`, `packages/contracts`) et le document [OpenAPI](api/openapi.json) généré et vérifié en CI.

## Mise en œuvre V1 (écarts avec la cible ci-dessous)

- Tables livrées : `tenants`, `users`, `memberships`, `sessions`, `oidc_login_attempts`, `connections`, `sync_runs`, `source_records`, `opportunities`, `facts`, `doctrines`, `company_contexts`, `analyses`, `recommendations`, `evidence_links`, `recommendation_revisions`, `decisions`, `idempotency_receipts`, `audit_events`, `outbox`, `model_usage`, plus le schéma `pgboss`.
- Endpoints livrés (`/v1`) : `GET /me`, `PUT /session/tenant`, `GET /recommendations`, `GET /recommendations/{id}`, `POST /recommendations/{id}/decisions`, `POST /recommendations/{id}/revisions`, `GET /opportunities`, `GET /analyses`, `GET /connectors`, `GET|POST /connections`, `POST /connections/{id}/sync`, `DELETE /connections/{id}` (révocation), `GET /connections/{id}/sync-runs`, `GET /audit`, `GET /rules`, `GET|POST /doctrines`, `POST /doctrines/{id}/validate|retire`, `GET|PUT /context`, `GET /members`, `PATCH|DELETE /members/{userId}` ; authentification `/auth/login|callback|logout` ; santé `/health/live|ready` ; `/metrics` protégé.
- Écarts : pas de `POST /connections/:provider/authorize` (aucun fournisseur OAuth réel : le connecteur fictif se crée par `POST /connections`) ; historique des synchronisations par connexion au lieu de `/operations/sync-runs` ; doctrines par entreprise seulement (DEBT-012) ; aucun stockage de fichiers.

## Tables à implémenter

| Table/module | Colonnes structurantes | Contraintes |
| --- | --- | --- |
| tenants | id, name, status, settings_version | Politique/état d'entreprise |
| users | id, oidc_issuer, oidc_subject | Unique issuer/subject ; ne pas autoriser sur le seul e-mail |
| memberships | tenant_id, user_id, role, status | Unique tenant/user ; révocation effective |
| connections | tenant_id, id, provider, status, credential_ref, granted_scopes | Secret séparé ; scopes explicitement autorisés |
| sync_runs | tenant_id, id, connection_id, cursor, status, started_at, completed_at, last_error_code | Référence tenant/connexion |
| source_records | tenant_id, id, connection_id, external_id, version, content_hash, observed_at, source_modified_at, deleted_at | Unique tenant/connexion/external_id/version |
| facts | tenant_id, id, subject_id, type, value, source_record_id, source_version, valid_at | Provenance obligatoire ; unités explicites |
| opportunities | tenant_id, id, external_id, stage, owner_id, next_step, updated_at | Projection normalisée ; pas une nouvelle source de vérité CRM implicite |
| doctrines | tenant_id/scope autorisé, id, version, status, content_ref, rights, validated_by | Versions immuables ; séparation du savoir commun et privé |
| analyses | tenant_id, id, input_hash, doctrine_version, rule_version, model, prompt_version, status, usage | Coût/trace sans payload privé en logs |
| recommendations | tenant_id, id, subject_id, kind, status, revision, fingerprint, priority, generated_at, expires_at | Unique déduplication ; proposition versionnée |
| evidence_links | tenant_id, recommendation_id, source_record_id, source_version, locator | Toutes les relations dans le même tenant |
| decisions | tenant_id, id, recommendation_id, revision, actor_id, decision, reason, created_at | Historique attribué ; concurrence |
| idempotency_receipts | tenant_id, actor_id, operation, key, request_hash, response_ref, expires_at | Unique tenant/acteur/opération/key |
| audit_events | tenant_id, id, actor_id, event_type, resource_id, revision, correlation_id, created_at | Append-only pour l'application normale |
| outbox | tenant_id, id, event_type, subject_id, payload_ref, published_at | Écrit dans la transaction métier ; consommation idempotente |

Les références inter-tables utilisent (tenant_id, id) vers une clé unique identique. Les vérifications de clé étrangère ne remplacent pas le filtrage d'accès. Les ressources globales autorisées utilisent un modèle et des politiques distincts, pas une exception vague tenant_id = null.

Horodatages : timestamptz UTC. Montants si nécessaires : decimal et devise, pas float. Unités et sémantiques des champs du CRM dans le dictionnaire connecteur. La version du fournisseur n'est pas forcément un entier : l'adaptateur établit une révision normalisée et conserve ETag/curseur séparément. Le sourceVersion entier du kernel n'est qu'un contrat normalisé.

## API v1 envisagée

Base /v1 ; session sécurisée ; org active sélectionnée côté serveur avec vérification membership.
Pagination cursor opaque, limites de page, erreurs structurées {code, message, correlationId}.
Ne pas faire transiter le token fournisseur vers le navigateur.

| Endpoint | Permission | Comportement |
| --- | --- | --- |
| GET /me | Authentifié | Identité et entreprises autorisées |
| GET /recommendations | Lecture autorisée | Liste filtrée, statut et fraîcheur |
| GET /recommendations/:id | Lecture objet/source | Détail et preuves autorisées |
| POST /recommendations/:id/decisions | Reviewer/owner | decision, expectedRevision, Idempotency-Key |
| POST /recommendations/:id/revisions | Reviewer/owner | Nouveau brouillon, version et invalidation |
| GET /connections | Owner/admin de connexion | État, scopes, cadence et dernière réussite |
| POST /connections/:provider/authorize | Owner/admin de connexion | Démarrer OAuth côté serveur avec état anti-CSRF |
| POST /connections/:id/sync | Droit connexion | Demande limitée et idempotente, réponse 202 |
| DELETE /connections/:id | Owner/admin de connexion | Révocation, arrêt jobs, traitement rétention |
| GET /audit | Permission d'audit | Vue minimisée et paginée du tenant |
| GET /operations/sync-runs | Exploitation autorisée | Statuts et erreurs minimisées |

403 : rôle insuffisant. 404 pour ressource hors périmètre, afin d'éviter l'énumération.
409 : conflit de révision/idempotence ou preuve obsolète.
422 : entrée invalide ; 429 : limite ; 503 : dépendance indispensable indisponible.
Le rejet d'une suggestion périmée peut rester permis, l'approbation doit être bloquée.
Une réponse 202 indique une mise en file, jamais un traitement terminé.

## Identité et sessions

OIDC Authorization Code via backend, PKCE/state/nonce selon client. Vérifier signature, issuer, audience, expiration et rotation de clés ; ne jamais seulement décoder un JWT. Session dans cookie HttpOnly, Secure, SameSite adapté ; CSRF sur mutations et rotation à la connexion. La membership DB reste la source des droits d'entreprise et est revalidée sur les opérations sensibles.

Un Context du domaine est une représentation interne de ces vérifications. Aucun endpoint ne doit désérialiser aveuglément le Context envoyé par le client. Les workers possèdent une identité de service avec scopes de tenant/connexion et n'héritent pas d'un owner universel.

## Décisions transactionnelles

Transaction : session et membership → verrou/compare-and-swap recommandation → relecture droits/provenance/fraîcheur → décision → audit → reçu → commit.
Deux appels de même clé et même requête retournent le même résultat ; requête différente avec même clé = conflit.
Un retry après commit sans réponse ne crée pas un nouvel événement.
Les receipts comportent un TTL explicite ; leur suppression ne doit pas rendre une décision réversible.
L'audit mémoire du kernel est une référence fonctionnelle : l'append-only, la durabilité et l'atomicité doivent être prouvées en PostgreSQL.
