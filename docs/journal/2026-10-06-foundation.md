# 2026-10-06 — UL-001 — Fondation de développement

Responsable : session Work de démarrage.
Base observée : main, 0596cde596c53ad3eb218e97ae681c0c76b7d5a4.
Objectif : démarrer le dépôt avec un cadrage exploitable, une continuité de développement et une première tranche métier vérifiée.

## Sources et contexte

Dépôt initial inspecté par le connecteur GitHub : README seul. Le fichier joint à la session n'a pas pu être autorisé/récupéré. Un document de contexte connu a pu être lu et a confirmé la nécessité de distinguer propositions et décisions ; il n'est pas recopié dans le dépôt public.

Le clone Git et les transferts réseau depuis le terminal sont indisponibles dans cet environnement. Le travail local est préparé avec les contenus inspectés ; publication via le connecteur GitHub, sans présenter le répertoire comme un clone synchronisé.

## Changements

- Exigences et architecture cible ; règles de reprise et prompt Work.
- Backlog canonique, dettes, questions et critères d'acceptation.
- Kernel avec projection de faits normalisés, versions monotones et dates validées.
- Proposition dédupliquée, expliquée, sourcée et limitée en fraîcheur.
- Review avec rôle, isolation tenant, révision, idempotence et revalidation.
- Audit mémoire attribué, snapshots copiés, aucun outil d'exécution externe.
- Démo et 22 tests métier utiles aux invariants.

## Vérifications exécutées

Environnement : Windows, Node 24.16.0, npm 11.13.0.
npm test : 22 tests passés, 0 échec.
npm run demo : exécuté, une proposition fictive, validation fictive, 3 événements d'audit, zéro action externe.

npm run check : 16 documents requis, 17 fichiers Markdown, liens internes résolus.
npm install --package-lock-only --offline --ignore-scripts --no-audit --no-fund : réussite ; lockfile minimal, aucune dépendance externe.
CI distante : pas encore exécutée ; workflow Windows/Linux préparé, actions épinglées sur SHA vérifiés via les tags officiels. Aucune preuve de tsc, PostgreSQL, API, OIDC, worker réel ou UI n'est revendiquée.

## Décisions et limites

ADR-0001 : stack technique proposée, compatible à vérifier lors de l'installation.
ADR-0002 : validation distincte de toute exécution.
ADR-0003 : sources de vérité versionnées pour la reprise.

Le Context interne est fourni par un appelant de confiance ; ce kernel n'authentifie personne.
La règle est fictive ; ni doctrine validée ni preuve de valeur pilote.
L'adaptateur mémoire est non durable ; aucun service SaaS déployé.

## Suite

UL-002 : installer outils/frameworks, vérifier tsc, construire API/identité.
UL-003 : dépôt PostgreSQL transactionnel et tests RLS avec rôle d'exécution.
UL-013 : récupérer le cahier joint et comparer les exigences.
Détails : BACKLOG, OPEN-QUESTIONS et ACCEPTANCE.
