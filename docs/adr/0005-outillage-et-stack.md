# ADR-0005 — Outillage strict et versions de la stack V1

Date : 2026-10-06. Statut : accepté pour la V1 (UL-002), vérifié en CI Linux et Windows.

## Contexte

ADR-0001 proposait la stack sans l'avoir installée. Le lot UL-002 devait verrouiller des versions réellement compatibles entre elles et un contrôle de types strict, sans dépendre de `tsc` pour exécuter le code en développement.

## Décision

- **Node 24 LTS** (CI : 24.x ; image : 24.21.0), **npm workspaces** et lockfile versionné.
- **TypeScript 6.0.3** strict (`noUncheckedIndexedAccess`, `noImplicitOverride`, `verbatimModuleSyntax`, `erasableSyntaxOnly`), références de projets `tsc -b`. TypeScript 7 (compilateur natif) a été essayé puis écarté : `typescript-eslint` 8.71.1 exige `<6.1.0`.
- **ESLint 9.39.5** + `typescript-eslint` (règles typées strictes) + `jsx-a11y` ; ESLint 10 écarté car `jsx-a11y` ne le supporte pas encore. **Prettier 3.9.9**. Contrôle maison des cycles d'import (résolution TypeScript).
- Condition d'export `ulysse-source` : en développement et en test, Node exécute les sources `.ts` (suppression des types) ; en production, les paquets exposent `dist/`. Imports relatifs en `.ts` réécrits à la compilation (`rewriteRelativeImportExtensions`).
- API : **Fastify 5** + **Zod 4** (`fastify-type-provider-zod`) ; document **OpenAPI** généré et versionné (`docs/api/openapi.json`), fraîcheur vérifiée en CI.
- Web : **React 19**, **Vite 8**, **TanStack Query 5**, **react-router 8** ; **Playwright 1.63** + axe-core pour la recette navigateur.
- Données et jobs : **PostgreSQL 18.6**, **pg-boss 12** (ADR-0004, ADR-0007). Journaux **Pino**, métriques **prom-client** ; OpenTelemetry non installé à ce stade (dette DEBT-013).
- `npm run verify` regroupe format, lint, types, cycles, OpenAPI, tests unitaires et contrôle documentaire ; il est exécuté avant chaque commit.

## Conséquences

- Montée vers TypeScript 7 conditionnée à la compatibilité de `typescript-eslint`.
- Node exécute les `.ts` sans contrôle de types : seule `npm run typecheck` (ou `verify`) vaut contrôle de types.
- Toute nouvelle dépendance importante passe par une mise à jour de cette ADR ou une nouvelle ADR.

## Preuves

CI `static-and-unit` (Ubuntu et Windows), `integration-postgres`, `e2e-browser`, `container-stack` ; voir STATUS.
