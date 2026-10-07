# Exploitation

## UL-016 — stack et budgets agentiques

Voir [DEMO-AGENTIQUE](DEMO-AGENTIQUE.md) pour les commandes PowerShell avec arrêt après échec et la mise à niveau additive, [rapport](VALIDATION-UL-016.md) pour les validations réellement observées. `scripts/demo-agentique.ps1` construit l'application, applique 0009/0010, enrichit les fixtures et démarre le mode demandé, sans supprimer les volumes. L'overlay `infra/hermes.compose.yaml` ajoute le service privé Python/Hermes et son réseau interne. PostgreSQL 18.6/Keycloak 26.8 restent inchangés.

Live : clé OpenRouter et secret Hermes dans `.env` ignoré par Git ; modèle fixe `openai/gpt-4.1-mini`, budgets explicites 0,25 USD/run, 2 USD/session, 10 USD/tenant/mois, session identifiée. 8 appels modèle retries compris, 12 outils, 90 secondes, un run/tenant, deux au total. Les fonctions de réservation sous verrou global évitent une dépense concurrente du même solde. Les coûts inconnus ne valent jamais zéro ; une issue incertaine conserve la réservation. L'ancienne formulation payante sans réservation est désactivée dans l'entrée du worker.

Le worker ne maintient aucune transaction longue pendant le modèle. Les runs/events sont durables et bornés, les entrées déjà publiées dédupliquées. La maintenance reprend les leases expirées ; les décisions idempotentes et révisions humaines existantes sont conservées. Aucun fallback automatique. Retour au mode historique : `.\scripts\demo-agentique.ps1 -Mode rules`.

Mis à jour : 2026-10-06 (UL-011). Ce document décrit comment démarrer, configurer, surveiller, sauvegarder, restaurer et révoquer. Il ne désigne **aucune infrastructure de production** : l'hébergement, la région, le fournisseur d'identité et les objectifs de reprise restent à décider (OPEN-QUESTIONS Q-007, Q-008, Q-013). Ne pas installer Ulysse sur un serveur partagé existant sans inventaire préalable de ses services, ressources, sauvegardes et périmètre.

Toutes les commandes ci-dessous ont été exécutées sur la stack locale avec des données fictives, sauf mention « non vérifié ». Les preuves sont consignées dans [le journal UL-011](journal/2026-10-06-UL-011-exploitation.md).

## 1. Composants

| Processus | Commande dans l'image | Rôle PostgreSQL | Exposé |
| --- | --- | --- | --- |
| API + interface web compilée | `node apps/api/dist/src/main.js` | `ulysse_app` | HTTP 3000 (seul port public) |
| Worker (pg-boss, outbox, synchronisations, analyses, purges) | `node apps/worker/dist/src/main.js` | `ulysse_worker` | santé/métriques sur 127.0.0.1:3001 dans le conteneur |
| Initialisation (rôles, base, migrations, files) | `node packages/database/dist/src/cli.js bootstrap` puis `migrate` | admin puis `ulysse_migrator` | — (job ponctuel) |
| Seed de démonstration fictif | `node apps/worker/dist/src/dev/seed.js` | `ulysse_migrator` + `ulysse_worker` | — (refusé si `NODE_ENV=production`) |
| PostgreSQL 18.6 | image `postgres:18.6-alpine` | — | 127.0.0.1:55432 en local |
| Keycloak 26.8.0 (développement uniquement) | `start-dev --import-realm` | — | 127.0.0.1:8080 en local |

Une seule image (`Dockerfile`, Node 24.21.0 Alpine, utilisateur `node`, sans outils de développement) porte l'API, le worker et les jobs. Les conteneurs applicatifs de `infra/compose.yaml` tournent en lecture seule, sans capacités Linux et avec `no-new-privileges`.

## 2. Démarrer

### Développement depuis les sources

```sh
cp .env.example .env && cp infra/.env.example infra/.env   # puis remplacer chaque secret
docker compose -f infra/compose.yaml --env-file infra/.env up -d postgres keycloak
npm ci
npm run db:bootstrap && npm run db:migrate && npm run db:seed
npm run build -w @ulysse/web
node --env-file=.env --conditions=ulysse-source apps/api/src/main.ts      # terminal 1
node --env-file=.env --conditions=ulysse-source apps/worker/src/main.ts   # terminal 2
```

Ouvrir http://localhost:3000 et se connecter avec un compte fictif de [infra/keycloak/README.md](../infra/keycloak/README.md).

### Stack complète conteneurisée (profil `app`)

```sh
docker build -t ulysse-app:local .
# Derrière un proxy TLS d'entreprise uniquement : --secret id=extra_ca,src=<bundle CA> (jamais copié dans l'image)
docker compose -f infra/compose.yaml --env-file .env --env-file infra/.env --profile app up -d
node scripts/smoke.mjs --user alice --password ulysse-demo-alice --expect-recommendations 1
```

Ordre garanti par Compose : PostgreSQL sain → `db-init` (rôles, base `ulysse_stack`, migrations, files) → `demo-seed`, API (après Keycloak sain) et worker. Le worker lance la première synchronisation fictive sans action utilisateur ; les propositions apparaissent en quelques secondes.

Cette stack utilise `NODE_ENV=development` parce qu'elle sert en HTTP sur localhost : en `production`, l'API refuse HTTP non chiffré vers l'IdP, les cookies non `Secure`, une origine non HTTPS et le connecteur fictif ; le worker refuse aussi le connecteur fictif. Un environnement pilote exige donc TLS, un IdP dédié et une source réelle autorisée.

`scripts/smoke.mjs` vérifie de l'extérieur : santé, connexion OIDC réelle par le formulaire de l'IdP, `/v1/me`, liste des propositions. `--session-file` puis `--reuse-session` vérifient qu'une session survit à un redémarrage.

## 3. Configuration

Toutes les entrées sont validées au démarrage (Zod) ; une valeur manquante ou invalide arrête le processus avec un message explicite. Référence complète : [.env.example](../.env.example).

| Variable | Processus | Secret | Notes |
| --- | --- | --- | --- |
| `ULYSSE_DB_HOST`, `ULYSSE_DB_PORT`, `ULYSSE_DB_NAME`, `ULYSSE_DB_SSLMODE` | tous | non | `sslmode` à exiger hors poste local |
| `ULYSSE_DB_ADMIN_USER/PASSWORD` | bootstrap, sauvegarde, tests | **oui** | jamais fourni à l'API ni au worker |
| `ULYSSE_DB_MIGRATOR_PASSWORD` | migrate, admin, seed | **oui** | jamais fourni à l'API ni au worker |
| `ULYSSE_DB_APP_PASSWORD` | API | **oui** | |
| `ULYSSE_DB_WORKER_PASSWORD` | worker | **oui** | |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID` | API | non | |
| `OIDC_CLIENT_SECRET` | API | **oui** | |
| `OIDC_INTERNAL_BASE_URL` | API | non | URL interne de l'IdP quand elle diffère de l'émetteur public |
| `OIDC_ALLOW_INSECURE_HTTP` | API | non | interdit en production |
| `PUBLIC_ORIGIN`, `API_HOST`, `API_PORT`, `COOKIE_SECURE`, `WEB_DIST_DIR` | API | non | HTTPS + `COOKIE_SECURE=true` obligatoires en production |
| `SESSION_SECRET` | API | **oui** | ≥ 32 caractères ; dérive les jetons CSRF |
| `SESSION_IDLE_MINUTES` (120), `SESSION_ABSOLUTE_HOURS` (12) | API | non | |
| `RATE_LIMIT_PER_MINUTE` (300) | API | non | par adresse ; `/auth/*` a une limite propre plus basse |
| `METRICS_TOKEN` | API, worker | **oui** | jeton Bearer de `/metrics` ; sans lui `/metrics` répond 404 |
| `WORKER_CONCURRENCY`, `WORKER_TENANT_CONCURRENCY`, `SYNC_PAGE_SIZE`, `SYNC_MAX_PAGES_PER_JOB`, `OUTBOX_POLL_MS`, `SYNC_DISPATCH_CRON`, `MAINTENANCE_CRON` | worker | non | une entreprise ne peut pas saturer les autres (concurrence par entreprise) |
| `ENABLE_FIXTURE_CONNECTOR` | API, worker | non | CRM fictif ; interdit en production |
| `MODEL_PROVIDER` (`none`), `OPENROUTER_API_KEY`, `MODEL_ID`, `MODEL_TIMEOUT_MS`, `MODEL_MAX_OUTPUT_TOKENS`, `MODEL_TENANT_MONTHLY_BUDGET_USD` (0) | worker | clé : **oui** | formulation assistée optionnelle (ADR 0009) |
| `BACKUP_ENCRYPTION_KEY` | sauvegarde/restauration | **oui** | 32 octets aléatoires en base64 (`openssl rand -base64 32`) |
| `ULYSSE_PG_EXEC` | sauvegarde/restauration | non | préfixe pour exécuter `pg_dump`/`pg_restore` dans le conteneur PostgreSQL |
| `LOG_LEVEL` | API, worker | non | |

Les secrets vont dans un gestionnaire de secrets ou des fichiers hors dépôt (`.env` et `infra/.env` sont ignorés par Git et par le contexte de build Docker). Aucun secret dans une variable `VITE_*`.

## 4. Base de données et migrations

- Comptes séparés ([ADR 0004](adr/0004-postgresql-roles-rls.md)) : le migrateur possède le schéma ; l'API et le worker n'ont que des droits DML sous RLS forcée ; les fonctions d'administration et de maintenance sont des `SECURITY DEFINER` possédées par un rôle sans connexion.
- `npm run db:migrate` (ou le job `db-init`) applique les fichiers `packages/database/migrations/*.sql` dans l'ordre, chacun dans sa transaction, sous verrou consultatif, puis installe les files pg-boss. Un fichier déjà appliqué dont le contenu a changé est refusé (somme de contrôle) : on ajoute toujours une **nouvelle** migration.
- Retour arrière : les migrations sont en avant uniquement. Procédure : (1) sauvegarde chiffrée avant toute migration en environnement partagé ; (2) si la nouvelle version échoue, redéployer l'image précédente tant que le schéma reste compatible (migrations additives), sinon restaurer la sauvegarde dans une nouvelle base et y repointer `ULYSSE_DB_NAME`. Chaque migration destructive future devra documenter sa compatibilité dans sa PR.
- Rotation des mots de passe des rôles : relancer `npm run db:bootstrap` avec les nouvelles valeurs (il exécute `ALTER ROLE … PASSWORD`), puis redémarrer chaque processus avec son nouveau mot de passe.

## 5. Provisionnement des entreprises et des accès

L'API ne crée ni entreprise ni utilisateur. Un opérateur disposant du mot de passe migrateur utilise :

```sh
npm run admin -- admin:tenant --slug acme-pilote --name "Nom affiché"          # idempotent, affiche l'id
npm run admin -- admin:user --issuer <émetteur OIDC> --subject <sub> --name "Nom" [--email e]
npm run admin -- admin:member --tenant <id> --user <id> --role owner|reviewer|viewer
```

Le `sub` est celui de l'IdP. Une identité non provisionnée est refusée à la connexion. Les owners gèrent ensuite les rôles des membres existants depuis l'interface (sans pouvoir retirer le dernier owner).

## 6. Révocation

| Situation | Action | Effet vérifié |
| --- | --- | --- |
| Retirer un utilisateur d'une entreprise | `admin:member … --status revoked` ou interface Membres | accès perdu à la requête suivante (test API) |
| Désactiver un utilisateur | `npm run admin -- admin:user-status --user <id> --status disabled` | session refusée à la requête suivante, connexion refusée (tests API) |
| Révoquer une connexion source | interface Sources → Révoquer | plus aucune lecture ; purge des enregistrements, opportunités et faits de cette connexion (tests worker) |
| Compte IdP compromis | désactiver dans l'IdP **et** `admin:user-status … disabled` | |
| Secret client OIDC compromis | régénérer dans l'IdP, mettre à jour `OIDC_CLIENT_SECRET`, redémarrer l'API | |

Les propositions et décisions déjà enregistrées, avec les valeurs de preuve recopiées au moment de la proposition, restent dans l'historique d'audit : leur durée de conservation après révocation est une décision à prendre (Q-013).

## 7. Rotation des secrets

| Secret | Procédure | Conséquence |
| --- | --- | --- |
| `SESSION_SECRET` | remplacer puis redémarrer l'API | les sessions restent valides (jetons stockés hachés) ; les jetons CSRF changent : l'interface les relit via `/v1/me` |
| `OIDC_CLIENT_SECRET` | nouveau secret dans l'IdP puis redémarrage de l'API | connexions en cours à refaire |
| Mots de passe PostgreSQL | section 4 | |
| `METRICS_TOKEN` | remplacer côté Ulysse et côté collecteur | |
| `OPENROUTER_API_KEY` | révoquer chez le fournisseur, remplacer, redémarrer le worker | sans clé, formulation déterministe |
| `BACKUP_ENCRYPTION_KEY` | nouvelle clé pour les nouvelles sauvegardes ; **conserver l'ancienne** tant que des sauvegardes chiffrées avec elle sont retenues | chaque manifeste porte l'empreinte de sa clé |

## 8. Sauvegarde et restauration

```sh
export BACKUP_ENCRYPTION_KEY=...     # depuis le gestionnaire de secrets, jamais dans le dépôt
export ULYSSE_PG_EXEC="docker compose -f infra/compose.yaml --env-file infra/.env exec -T postgres"
npm run db:backup -- --database ulysse_stack --out /chemin/hors-depot
npm run db:restore -- --file /chemin/ulysse_stack-<horodatage>.dump.enc --target ulysse_restored_<date>
```

- Sauvegarde : `pg_dump` au format custom, dans un **snapshot exporté** ; le manifeste (`.manifest.json`) contient, pour ce même snapshot, les migrations et le nombre de lignes par table, l'empreinte de la clé et la somme SHA-256 du fichier chiffré. Chiffrement AES-256-GCM authentifié ; fichiers créés en mode 600, refus d'écraser un fichier existant.
- Restauration : toujours dans une **nouvelle** base (refus si elle existe). Contrôles : empreinte de clé, somme du fichier, authentification GCM avant tout `pg_restore`, restauration en une transaction, puis mêmes migrations et mêmes comptes de lignes que le manifeste, RLS forcée sur chaque table portant `tenant_id`, et aucune ligne visible par le rôle de l'API sans contexte d'entreprise. Bascule : repointer `ULYSSE_DB_NAME` et redémarrer API et worker.
- Exercice : `--target ulysse_test_restore_drill --drop-after` restaure, vérifie puis supprime la base d'exercice. Exercice réalisé le 2026-10-06 sur la stack locale (36 tables, 235 lignes, 17 tables sous RLS forcée), puis API démarrée sur la base restaurée et connexion OIDC réussie avec 3 propositions visibles.
- `pg_dump`/`pg_restore` doivent avoir la version majeure du serveur : `ULYSSE_PG_EXEC` les exécute dans le conteneur PostgreSQL.
- Non décidé (Q-013) : fréquence, rétention, stockage hors site, RPO/RTO. Proposition de départ révisable : sauvegarde quotidienne, rétention 30 jours, copie chiffrée hors du serveur, exercice de restauration mensuel. Les sauvegardes contiennent des données client : même niveau de protection que la base.

## 9. Redémarrage et reprise

- Arrêt : `SIGTERM` → l'API termine les requêtes en cours ; le worker cesse de prendre des jobs et attend jusqu'à 30 s les jobs actifs (`stop_grace_period: 45s`).
- Vérifié sur la stack conteneurisée : `docker compose restart api worker` → services sains, la session ouverte avant le redémarrage reste valide, les propositions sont intactes, le worker reprend ses cycles.
- Un arrêt brutal pendant une synchronisation reprend au dernier curseur persistant ; seules des pages complètes sont enregistrées ; l'outbox garantit qu'un événement est soit en attente, soit en file (tests d'intégration worker).

## 10. Supervision et alertes

- Santé : `GET /health/live` (processus) et `GET /health/ready` (base joignable ; pour le worker, files démarrées). Utilisés par les healthchecks Compose.
- Métriques Prometheus : `GET /metrics` avec `Authorization: Bearer $METRICS_TOKEN` (API sur son port, worker sur 127.0.0.1:3001). Jobs de scrape attendus : `ulysse-api`, `ulysse-worker`. Libellés sans contenu utilisateur.
- Règles d'alerte : [infra/observability/alerts.yml](../infra/observability/alerts.yml), validées par `promtool check rules` (Prometheus 3.5.0). Les seuils sont des points de départ, pas des SLO mesurés. Aucun Prometheus/Alertmanager n'est déployé par ce dépôt.

<a id="api-ou-worker-indisponible"></a>

### API ou worker indisponible

1. `docker compose … ps` puis `logs --tail 200 api worker`. 2. `/health/ready` : base injoignable → vérifier PostgreSQL, ses identifiants et l'espace disque. 3. Erreur de configuration au démarrage : le message nomme la variable. 4. Redémarrer le service ; les sessions et les données survivent.

<a id="erreurs-serveur"></a>

### Erreurs serveur ou lenteur

Corréler par `correlationId` (renvoyé dans chaque erreur et présent dans les journaux). Vérifier la saturation du pool PostgreSQL et la latence base. Les erreurs métier (4xx) ne déclenchent pas cette alerte.

<a id="travaux-en-retard"></a>

### Travaux en retard (outbox, files, échecs de jobs)

`ulysse_outbox_pending` qui monte : le worker ne relaie plus → vérifier qu'il tourne et ses journaux `outbox relay failed`. `ulysse_queue_backlog` élevé : augmenter `WORKER_CONCURRENCY` ou chercher une source lente. Échecs répétés d'une file : l'historique de synchronisation de la connexion (interface Sources) donne le code d'erreur ; une erreur définitive (autorisation, configuration) passe la connexion en état `error` au lieu de réessayer ; une erreur transitoire est réessayée avec un délai croissant borné.

<a id="source-perimee"></a>

### Source périmée

`ulysse_connection_data_age_seconds` > 24 h : la connexion n'a plus de photographie confirmée. Les propositions dépendantes ne peuvent plus être approuvées (fraîcheur revérifiée à la décision) et l'analyse s'abstient (`stale_source`). Relancer une synchronisation depuis l'interface ; si l'erreur persiste, vérifier l'accès chez le fournisseur. Le seuil de 24 h est une hypothèse de démonstration (Q-005).

<a id="formulation-assistee-indisponible"></a>

### Formulation assistée indisponible

Sans effet sur le parcours : les propositions gardent la formulation déterministe. Vérifier la clé, le budget mensuel (`model_usage`) et l'état du fournisseur.

## 11. Rétention et purge

| Donnée | Règle actuelle | Mécanisme |
| --- | --- | --- |
| Sessions | expiration (inactivité 2 h, absolue 12 h) ; purge des sessions expirées ou révoquées depuis 1 jour | maintenance worker toutes les 5 min |
| Tentatives de connexion OIDC | 10 min ; purge après expiration | idem |
| Reçus d'idempotence | 24 h ; purge après expiration | idem |
| Données d'une connexion révoquée | purge des enregistrements source, opportunités et faits | job de purge à la révocation |
| Propositions, décisions, révisions, audit | conservés (tables en ajout seul) | durée à décider (Q-013) |
| Compteurs d'usage modèle | conservés (aucun prompt ni réponse stockés) | durée à décider |
| Journaux applicatifs | sans corps de requête, jeton, cookie, code OIDC ni contenu source ; chemins sans paramètres | dépend de l'hébergement |

## 12. Limites connues

- Aucun environnement pilote ni de production n'existe ; TLS, IdP de production, stockage des sauvegardes hors site et collecte des métriques ne sont pas vérifiés.
- Keycloak est configuré en mode développement avec des comptes et un secret fictifs publics : il ne doit protéger aucun environnement réel.
- L'appel réel à OpenRouter n'est pas vérifié (aucune clé ; sortie réseau refusée dans l'environnement de développement).
- Le budget modèle s'appuie sur le coût déclaré par le fournisseur ; un appel sans coût déclaré compte pour 0 (DEBT-014).
