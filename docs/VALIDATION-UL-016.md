# Rapport de validation UL-016

Date : 2026-10-07. Statut : **partial** — intégration, stack Hermes réelle et outillage live vérifiés ; **validation fournisseur live et revue humaine de pertinence non réalisées** (aucune clé autorisée ; `openrouter.ai` refusé par la politique réseau de l'environnement d'exécution de l'agent). Branche `claude/clever-cannon-99ywx2`, [PR #4](https://github.com/TFourniax/ulysse-ithaque-saas/pull/4), qui contient la [PR #3](https://github.com/TFourniax/ulysse-ithaque-saas/pull/3) de Codex. Base UL-015 `598f082ab33fb87faf5ff357285dc95b536bb1b3`.

Trois niveaux de preuve, jamais confondus :

| Niveau | Ce qui est réel | Ce qui est simulé | Ce que cela prouve |
| --- | --- | --- | --- |
| Agentique simulé (`simulated`) | Worker, outils, PostgreSQL, publication, interface | Le raisonnement (règles explicites du worker), pas d'Hermes | Pipeline, droits, budgets, reprises, interface |
| Hermes réel, modèle simulé (`hermes-stub`) | **Image Hermes officielle épinglée, boucle Hermes, plugin Ulysse**, passerelle, outils, PostgreSQL, publication, interface | Les réponses du modèle (point OpenAI-compatible scripté) | Intégration Hermes de bout en bout dans la stack ; jamais la pertinence |
| Live (`hermes-live`) | Tout, dont un vrai modèle via OpenRouter | — | **Non exécuté** |

## Reprise — preuves au commit `c85282c54422a04356c6630d4bda3e7eceddb9f3`

Constats de la reprise et corrections : voir la révision d'[ADR-0012](adr/0012-hermes-analyse-agentique.md) (prompt générique Hermes remplacé et vérifié, concordance des versions, tentatives bornées, réservations réconciliées, mode `hermes-stub`, corpus par opportunité).

### Environnement local de l'agent (Linux, Docker 29.8, Node 24.21.0, Python 3.14.4 dans l'image)

| Contrôle | Résultat |
| --- | --- |
| `npm run verify` | vert (format, lint strict, `tsc -b`, cycles, OpenAPI, unitaires dont connecteurs 12 et worker 4, documentation) |
| `npm run test:integration` (PostgreSQL 18.6, rôles réels) | database 50/50, API 17/17, worker 23/23 (dont instructions/outils étrangers refusés sans transmission, tentatives bornées et réservation libérée) |
| `npm run test:e2e` (Keycloak 26.8, Chromium) | 12/12, non-régression UL-015 |
| Image Hermes : commit officiel `e76fb95…` exporté du dépôt officiel, installateur scellé officiel | construite ; `test_integration` 2/2 **hors réseau** (`--network none`) : vraie boucle, deux processus concurrents, sept outils, message système = instructions Ulysse uniquement, tolérance au seul bloc de code autour du JSON final |
| Requête réellement envoyée au modèle par Hermes (capturée sur l'image) | avant : ~10,5 Ko de consignes génériques Hermes puis les instructions ; après : un seul message système = instructions Ulysse (3 220 caractères), message utilisateur avec la date, sept outils ; première requête 12,8 Ko → 5,5 Ko |
| Stack complète `hermes-stub` (`scripts/agent-smoke.mjs`) | Alice, sources, injection d'une nouvelle réponse, analyse **par Hermes** (4 appels modèle, 7 lectures décidées en cours d'exécution), proposition modifiée, preuves, approbation, accessibilité et mobile, Vera sans décision ni injection, Globex isolé, persistance après redémarrage : tout vert. [Preuve](evidence/ul016-hermes-stub-fresh.json), captures [sources](evidence/08-ul016-hermes-sources.png), [analyses](evidence/09-ul016-hermes-analyses.png), [décision](evidence/10-ul016-hermes-decision.png) |
| Répétition de la validation live (`scripts/live-validation.mjs --dry-run`) sur `hermes-stub` | 6 analyses Hermes, 21 appels au modèle simulé, 39 lectures, 52 381/2 808 jetons, 0 USD déclaré, ≤ 7 s par analyse ; invariants respectés ; décision enregistrée par l'automate de répétition (pas une décision produit). [Rapport](evidence/ul016-live-rehearsal.md) |
| Défaut trouvé par la stack Hermes | une image Hermes construite avant la mise à jour des instructions a été refusée par la passerelle (fail-closed attendu) mais sans diagnostic : ajout de `/health` versionné, du contrôle `hermes_version_mismatch` et de journaux de refus |
| Mise à niveau depuis la version Codex `fefba88` (même base, mode simulé, décision approuvée avant) | migration 0011 seule appliquée ; corpus partagé hérité remplacé pour chaque opportunité (Globex OPP-001 inchangée) ; analyses antérieures conservées ; nouvelles analyses Hermes ; **décision conservée** |
| `scripts/demo-agentique.ps1` exécuté sous PowerShell 7.5.4 (Linux) | `hermes-stub` démarré ; `hermes-live` sans clé refusé **avant toute construction** (« Missing in .env: OPENROUTER_API_KEY ») ; retour `rules` (Hermes et modèle simulé arrêtés). Seules les deux constructions d'images ont été substituées par leurs équivalents compatibles avec le proxy de cet environnement |

Limites de cet environnement : `openrouter.ai`, `deb.debian.org`, `quay.io` et Docker Hub (limite 429) inaccessibles ; images de base PostgreSQL, Keycloak, Node et Python récupérées au même tag via `mirror.gcr.io` ; source Hermes exportée du dépôt officiel au commit épinglé faute d'`apt` dans le conteneur de construction. La CI construit l'image Hermes par le `Dockerfile` réel.

### CI GitHub au commit `c578fbaf7272462750ec1ef1b947bf97e561fb60`

[ci (pull request)](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/37660447047) : statique Ubuntu/Windows, intégration PostgreSQL, e2e, stack/sauvegarde/redémarrage — 5/5 verts. [ul016-validation](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/37660446972) : `application`, `hermes-loop` (Dockerfile réel), `simulated-stack` neuve et mise à niveau UL-015, et **`hermes-stack`** (image Hermes officielle construite en CI, parcours navigateur et redémarrage sur la vraie boucle) — 5/5 verts. Au commit de code final `d1082f3a1170cba58c6422fb8a8c2804b0b973c8` (urgence et limites de l'agent dans le détail d'une proposition, `GET /v1/agent-runs/:id`, journaux de refus sans les sondes `GET`, version d'instructions réservée aux runs Hermes) : [ci](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/37663298995) 5/5 et [ul016-validation](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/37663298961) 5/5 dont `hermes-stack`, verts ; stack `hermes-stack` locale, redémarrage et répétition live rejoués sur ce même commit, invariants respectés. Les commits ultérieurs ne modifient que la documentation.

## Live — non exécuté

Aucun appel fournisseur, usage, coût ou latence live observé. La procédure exacte est prête : [DEMO-AGENTIQUE](DEMO-AGENTIQUE.md) §4, `node scripts/live-validation.mjs`, avec décision humaine dans l'interface. Modèle préparé : `openai/gpt-4.1-mini` (0,40/1,60 USD par million de jetons, utilisés comme plafonds) ; avec des requêtes de 5 à 12 Ko et trois ou quatre tours par analyse, le coût attendu est de l'ordre du centième de dollar par analyse, bien sous le plafond de 0,25 USD (estimation, non observée).

Revue humaine attendue sur les sorties live : pertinence commerciale, fidélité des justifications aux sources, prudence face aux contradictions et à l'insuffisance, respect de la pause et de l'opposition, résistance sémantique à l'injection, rapprochement besoin/offre — selon [SCENARIOS](SCENARIOS-AGENTIQUES.md). Aucun verdict humain ni pourcentage de confiance n'est inventé.

## Première révision (Codex) — rappel

Au head `562cf83e1e46559560f019ffdde0f30e384cd5fd` : CI [applicative](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/37651082514) et [UL-016](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/37651082522) vertes, PostgreSQL 50/50, API 17/17, worker 20/20, e2e 12/12, vraie boucle Hermes avec outils et modèle simulés, stacks neuve et mise à niveau UL-015 en mode simulé, captures en artefacts CI, preuves [neuve](evidence/ul016-simulated-fresh.json) et [mise à niveau](evidence/ul016-simulated-upgrade.json). Ces preuves restent valides pour leur périmètre ; la revue de la reprise a montré qu'elles ne couvraient ni le prompt effectivement transmis au modèle, ni la boucle Hermes dans la stack.

UL-016 ne remplit donc pas ses conditions **done** : validation live et revue humaine manquantes. UL-008 (sources réelles), UL-009 réel et UL-012c (pilote) restent ouverts.
