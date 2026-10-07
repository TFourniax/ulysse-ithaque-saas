# UL-016 — Intégration Hermes et démonstration agentique fictive

Prise du lot le 2026-10-07. Branche `codex/ul-016-hermes-demo`. Identifiant UL-016 libre dans BACKLOG et les PR consultées.

Base vérifiée : `claude/sweet-tesla-jrnkxs`, commit exact `598f082ab33fb87faf5ff357285dc95b536bb1b3`. La branche contient le socle de `claude/quirky-darwin-v4is1f` et UL-015 livré. PR #1/#2 non fusionnées ; aucune modification de main. Checkout de travail séparé des fichiers synchronisés du projet et de la copie personnelle de Thomas.

Audit : AGENTS, STATUS, BACKLOG, PRODUCT, BLUEPRINT, OPEN-QUESTIONS, SECURITY, OPERATIONS, ACCEPTANCE et ADR du socle consultés. L'analyse actuelle est déterministe et la formulation réelle OpenRouter n'est pas vérifiée. Les couches domaine/API/worker/PostgreSQL et la direction visuelle UL-015 sont conservées.

Exploration Hermes précoce : intégration `AIAgent`, registre de tools, sélection effective, callbacks, timeout/interrupt, usages, retries et persistance inspectés dans la révision officielle `e76fb951a1d207c9596032426e7e0eadfb197bea`. Le runtime officiellement supporté est Python 3.14 ; pas d'installation via un paquet PyPI homonyme. Les registres/caches upstream sont partagés dans un processus : choix d'un sous-processus par run et d'une passerelle d'inférence bornée, sans fork du moteur.

Contraintes de ce poste d'exécution : Docker CLI présent mais accès aux pipes des moteurs refusé ; pas de Python dans PATH ; aucune dépendance npm installée, installation hors ligne incomplète ; sortie réseau terminal vers GitHub refusée. Les fichiers de configuration personnels ont été inspectés uniquement pour la présence des noms de clés : aucune clé OpenRouter n'y est configurée. Aucun secret affiché. La validation live ne peut pas être déclarée acquise.

Première tranche : sources commerciales fictives intégrées au connecteur existant ; contrat pur, capacités, réservations SQL, outils de lecture, service Hermes isolé, analyse worker et publication atomique. API/UI : opportunités ouvrables, sources consultables, analyses/progression, scénarios owner. Publication interdite si versions ou accès changent. Décisions existantes et modifications humaines conservées.

Vérification locale initiale : 47 tests historiques domaine/mémoire passent, puis 3 contrôles agentiques purs passent. `npm run verify` échoue dès `format:check` car Prettier est absent ; aucun verdict tsc/lint/PG/Docker/live n'est inventé. Les vérifications restantes et leurs preuves seront consignées dans le rapport de validation.

PR dédiée [#3](https://github.com/TFourniax/ulysse-ithaque-saas/pull/3), draft, sans fusion. Commits intermédiaires : `a1b7a9b`, `a838146`, `30f70ae`, `02f7a61`. CI : construction du runtime Hermes officiel réussie ; la sélection stricte a détecté la découverte progressive des outils upstream, désactivée via `tools.tool_search.enabled: off`. Le modèle de la passerelle utilise des réponses non streamées ; `model.streaming: false` désactive le streaming upstream. Aucun remplacement par une boucle maison.

Au commit `02f7a61`, tests intégration PostgreSQL 50/50, API 17/17 et worker 17/17 passent, y compris les six cas agentiques et la formulation historique. Le test de compilation signale deux accès potentiellement absents dans le nouveau test ; assertions de présence ajoutées. Au commit `30f70ae`, parcours simulé Alice, ingestion d'un e-mail, évolution de proposition, décision, interdiction viewer et Globex passait avant la reprise ; attente de santé ajoutée après redémarrage. Les tests sont relancés sur le dernier SHA et leurs résultats consolidés dans le rapport.

Configuration, budgets et instructions versionnés ; procédure PowerShell exacte ajoutée. Une matrice CI vérifie le départ neuf et la mise à niveau depuis l'image construite au commit UL-015, sans suppression de volume. La décision fictive enregistrée avant mise à niveau et les identifiants métier doivent survivre.

État courant : **partial**, recette en cours, live absent faute de clé autorisée. Les validations automatisées déportées et la recette live sont distinctes. Aucune approbation produit supposée.

Validation `efaea8e` : vraie boucle Hermes verte, deux instances concurrentes, sept outils exacts, deux requêtes modèle et lecture par run. Streaming désactivé officiellement ; aucune boucle maison. Le parcours simulé neuf passe jusqu'après restart ; captures et preuve JSON conservées. Le modèle endpoint est simulé : aucune recette fournisseur live.

Recette upgrade : décision, session et identifiants antérieurs conservés ; manque de sync immédiate après enrichissement découvert puis corrigé par `ConnectionService.requestSync`, sans écriture directe de recommandation. Coûts estimés et inconnus testés séparément ; réserve incertaine conservée, retries bornés à huit transmissions. Dernière recette et état final détaillés dans VALIDATION.

Le transport du poste s'est fermé après les contrôles locaux ; les corrections restantes sont poursuivies via GitHub. La copie personnelle reste intacte. Aucun accès live fourni ; état du lot partial, aucune approbation de pertinence supposée.

## Consolidation finale

Au head `562cf83e1e46559560f019ffdde0f30e384cd5fd`, checkout PR `65eae5fdeb4df6831d8958fb5f388bb6aede49ce` : cinq jobs CI et quatre jobs UL-016 verts. PostgreSQL 50/50, API 17/17, worker 20/20 (neuf cas agentiques), e2e 12/12 ; builds, backup/reprise, loop Hermes et stacks neuve/upgrade passent. Preuves JSON et captures reliées au SHA dans VALIDATION. L'upgrade ingère immédiatement l'enrichissement du seed et conserve la décision antérieure.

Contrôles d'accessibilité ajoutés aux trois nouveaux parcours : le test initial mesurait le bandeau pendant son animation d'entrée ; attente des animations finies avant axe, sans les désactiver. Axe et largeur mobile passent. Les références des recommandations/décisions consultées sont maintenant versionnées ; une décision concurrente provoque l'abandon du résultat obsolète.

Un Python 3.12 auxiliaire a permis l'analyse AST locale des fichiers ; l'image officielle Python 3.14.4 et son installation scellée ont été construites et réellement testées en CI. La boucle Hermes avec endpoint simulé utilise deux requêtes modèle par processus, sept outils exacts et get_opportunity, en 5,466 s pour deux processus concurrentiels. Ce test ne constitue pas un appel fournisseur réel.

Documentation consolidée : ADR-0012, blueprint, contrat agentique v1, OpenAPI, sécurité/exploitation/acceptance, catalogue, guide PowerShell et parcours de 10–15 minutes. DEBT-014 corrigée et testée pour le pipeline activable ; ancienne formulation payante désactivée. Captures de trois vues actuelles disponibles ; les autres captures historiques restent une dette distincte.

État final **partial**. Aucun fournisseur live appelé, aucune qualité/coût/latence live observée, aucune approbation produit inventée. Clé autorisée absente et Docker Desktop personnel inaccessible. Revue humaine de fidélité aux sources, rapprochement offre/besoin, contradictions et injection encore attendue. La PR reste draft, sans fusion ; les sources/doctrine réelles et le pilote ne sont pas clôturés.

Dernier contrôle : traitement de technical_error séparé de la publication normale, code agent_reported_error durable et propositions existantes conservées. Test PostgreSQL supplémentaire ajouté ; recette relancée. Les anciennes mentions d'un coût inconnu comptant pour zéro dans OPERATIONS sont remplacées par la réservation conservatrice actuelle.

## Reprise (Claude), 2026-10-07

**Départ.** Commit exact `fefba88846ea4956963b71e41bd7c238c89bcb1e` (tête de `codex/ul-016-hermes-demo`, PR #3 draft, CI verte), lui-même sur la base UL-015 `598f082`. Branche de travail désignée `claude/clever-cannon-99ywx2`, repartie de `fefba88` ; PR #4 draft vers `claude/sweet-tesla-jrnkxs`. L'identifiant UL-016 est conservé (même lot).

**Vérification d'Hermes.** Le commit épinglé `e76fb95` est présent sur `main` du dépôt officiel `NousResearch/hermes-agent` (licence MIT), postérieur de 8 834 commits à la release stable `v2026.9.24`, qui ne contient pas l'installateur scellé et exclut Python 3.14 : épinglage conservé, DEBT-020.

**Environnement de l'agent.** Docker 29.8 démarré localement ; Docker Hub limité (429), `quay.io`, `deb.debian.org` et `openrouter.ai` refusés ; images PostgreSQL 18.6, Keycloak 26.8.0, Node 24.21.0 et Python 3.14.4 récupérées au même tag via `mirror.gcr.io`. Node 24.21.0 installé avec contrôle SHA-256. Image Hermes construite par l'installateur scellé officiel à partir d'un export du dépôt officiel au commit épinglé (`apt` indisponible). Aucune clé OpenRouter dans l'environnement ; aucun secret affiché.

**Recette de départ** (avant modification) : `npm run verify` vert ; PostgreSQL 50/50, API 17/17, worker 21/21 ; e2e 12/12 ; `test_integration` Hermes vert hors réseau.

**Constats.** (1) La requête réelle d'Hermes au modèle commençait par ~10,5 Ko de consignes génériques (identité Hermes, terminal/fichiers, chemins de l'hôte, canal « OUT-OF-BAND USER MESSAGE »). (2) Toutes les opportunités Acme partageaient le corpus d'Industries Fictives SA, Globex OPP-002 celui d'OPP-001. (3) La maintenance relançait sans fin un run en échec sur une entrée inchangée, chaque échec gardant 0,25 USD réservé. (4) Le superviseur et la passerelle n'enregistraient aucun motif d'échec. (5) La boucle Hermes n'était testée qu'avec des outils simulés.

**Changements.** Plugin Hermes officiel `ulysse` (outils + middleware `llm_request`), blocs génériques coupés par configuration, contrôles fail-closed ; passerelle vérifiant l'empreinte des instructions et la liste d'outils ; `/health` versionné et `hermes_version_mismatch` ; tentatives bornées (`MAX_ATTEMPTS=2`) et réservations réconciliées ; mode `hermes-stub` (migration 0011, `model_stub.py`, profil `agent-stub`, job CI `hermes-stack`) ; corpus par opportunité avec décisions consignées, migration du corpus hérité par le seed ; urgence et limites de l'agent dans le détail d'une proposition ; sujet de chaque analyse, état « analyse en attente », icône et libellés CRM ; `scripts/live-validation.mjs` ; script PowerShell à quatre modes ; documentation (ADR-0012 révisée, contrat, sécurité, exploitation, guide, catalogue, rapport). Dépendance `zod` déclarée pour le worker.

**Résultats.** Local : verify vert ; PostgreSQL 50/50, API 17/17, worker 23/23 ; e2e 12/12 ; Hermes 2/2 hors réseau ; stack `hermes-stub` : parcours navigateur, accessibilité/mobile, viewer, Globex, redémarrage ; répétition live 6/6 analyses, invariants respectés ; mise à niveau depuis `fefba88` avec décision conservée ; `demo-agentique.ps1` exécuté sous PowerShell 7.5.4 (constructions d'images substituées par leurs équivalents compatibles avec le proxy). CI au `c578fba` : 10/10 jobs verts dont `hermes-stack`. Preuves au `c85282c` dans `docs/evidence`.

**Risques et dettes.** Live non exécuté : pertinence, coût réel et latence inconnus. DEBT-020 (épinglage hors release), DEBT-021 (urgence/limites non portées par la recommandation). Le lancement sur le Docker Desktop de Thomas reste à confirmer.

**Suite.** Thomas : `demo-agentique.ps1 -Mode hermes-stub`, `live-validation.mjs --dry-run`, puis `-Mode hermes-live` et `live-validation.mjs` avec décision humaine ; joindre le rapport relu à la PR. UL-016 passera à done seulement après ces preuves et la revue de pertinence.
