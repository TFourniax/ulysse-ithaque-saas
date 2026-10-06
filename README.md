# Ulysse Ithaque SaaS

Ulysse transforme les données autorisées d'une entreprise en propositions commerciales prioritaires, expliquées et soumises à une décision humaine. Les propositions apparaissent après ingestion et analyse en arrière-plan : la valeur ne dépend pas d'une question posée à un chatbot. La V1 de référence enregistre les décisions humaines **sans réaliser aucune écriture externe**.

**État : V1 de démonstration complète sur données fictives** (deux entreprises fictives, CRM simulé, doctrine fictive). Pas encore de pilote : aucune source réelle, doctrine validée, utilisateur pilote ni hébergement n'est disponible. Détail et preuves : [STATUS](docs/STATUS.md).

## Démarrer en 5 minutes (stack conteneurisée)

Prérequis : Docker avec Compose v2, Node.js 24 LTS.

```sh
cp .env.example .env && cp infra/.env.example infra/.env   # valeurs locales ; remplacer les secrets hors poste de développement
docker build -t ulysse-app:local .
docker compose -f infra/compose.yaml --env-file .env --env-file infra/.env --profile app up -d --wait postgres keycloak api worker
docker compose -f infra/compose.yaml --env-file .env --env-file infra/.env --profile app run --rm demo-seed
```

Ouvrir http://localhost:3000 et se connecter avec un compte fictif (par exemple `alice` / `ulysse-demo-alice`, owner de l'entreprise fictive Acme ; liste dans [infra/keycloak](infra/keycloak/README.md)). Les propositions apparaissent quelques secondes après le seed, produites par le worker sans action.

Vérification automatique : `npm ci && node scripts/smoke.mjs --user alice --password ulysse-demo-alice --expect-recommendations 1`.

## Développer

```sh
npm ci
docker compose -f infra/compose.yaml --env-file infra/.env up -d postgres keycloak
npm run db:bootstrap && npm run db:migrate && npm run db:seed
npm run build -w @ulysse/web
node --env-file=.env --conditions=ulysse-source apps/api/src/main.ts      # API + web sur :3000
node --env-file=.env --conditions=ulysse-source apps/worker/src/main.ts   # worker
```

Interface en rechargement à chaud : `npm run dev -w @ulysse/web` (port 5173, proxy vers l'API).

| Commande | Rôle |
| --- | --- |
| `npm run verify` | format, lint typé strict, `tsc -b`, cycles, OpenAPI à jour, tests unitaires, contrôle documentaire — **avant chaque commit** |
| `npm run test:integration` | PostgreSQL réel sous les rôles d'exécution (base, API, worker) |
| `npm run test:e2e` | recette navigateur Playwright contre Keycloak, API et worker réels |
| `npm run demo` | démo hors ligne du domaine (adaptateur mémoire) |
| `npm run db:backup` / `db:restore` | sauvegarde chiffrée / restauration vérifiée ([OPERATIONS](docs/OPERATIONS.md)) |
| `npm run admin -- admin:…` | provisionnement des entreprises, utilisateurs et rôles |

Node exécute les sources TypeScript par suppression des types : seul `npm run typecheck` (inclus dans `verify`) contrôle les types.

## Reprendre le projet

1. Lire [AGENTS.md](AGENTS.md), puis [STATUS](docs/STATUS.md) et [BACKLOG](docs/BACKLOG.md).
2. Lire [PRODUCT](docs/PRODUCT.md), [BLUEPRINT](docs/BLUEPRINT.md), [OPEN-QUESTIONS](docs/OPEN-QUESTIONS.md) et les [ADR](docs/adr/).
3. Exploitation : [OPERATIONS](docs/OPERATIONS.md) ; recette : [ACCEPTANCE](docs/ACCEPTANCE.md) ; pilote : [PILOT](docs/PILOT.md) ; sources : [CONNECTORS](docs/CONNECTORS.md).
4. Suivre [CONTRIBUTING.md](CONTRIBUTING.md) ; consigner chaque lot dans `docs/journal/`.

## Organisation

| Emplacement | Responsabilité | État |
| --- | --- | --- |
| packages/domain | Règles, analyse, propositions, décisions, doctrine, contexte ; ports ; adaptateur mémoire et scénarios partagés | livré, testé (mémoire + PostgreSQL) |
| packages/database | Migrations SQL, rôles, RLS, adaptateur transactionnel, sauvegarde/restauration, administration | livré, testé |
| packages/contracts | Schémas Zod de l'API | livré |
| packages/connectors | Contrat connecteur, connecteur **fictif**, suite de contrat | livré ; aucune source réelle |
| packages/ai | Interface modèle neutre, adaptateur OpenRouter, validation, évaluation | livré, appel réel non vérifié |
| packages/observability | Journaux Pino expurgés, métriques Prometheus | livré |
| apps/api | API Fastify (OIDC BFF, sessions, droits), sert l'interface compilée | livré, testé |
| apps/worker | pg-boss, outbox, synchronisations, analyse, maintenance, formulation optionnelle | livré, testé |
| apps/web | Interface React/Vite + recette Playwright | livré, testé |
| apps/demo | Démo hors ligne | livré |
| infra | Compose, Keycloak de développement, règles d'alerte | livré (local) |
| docs | Cadrage, état, ADR, exploitation, recette, journaux | à jour au 2026-10-06 |

## Limites de confiance

Le navigateur n'est jamais source d'autorisation : identité, entreprise active et rôle sont établis côté serveur à chaque requête. Le compte de migration n'est pas le compte applicatif. Le contenu des sources est une donnée non fiable qui ne devient jamais instruction ni permission. Une approbation n'est jamais une autorisation d'envoi.

Le dépôt public n'accueille que des exemples fictifs. Données clients, secrets, transcriptions, documents contractuels et doctrine propriétaire sont gérés dans des espaces privés autorisés. Aucune licence de redistribution n'est choisie (Q-011). La pièce jointe initiale n'a pas pu être récupérée : son contenu n'est pas intégré (UL-013).
