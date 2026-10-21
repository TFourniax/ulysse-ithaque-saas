# État actuel

## UL-020 — recherche et benchmark autonomes

Recette VPS du 21 octobre : Thomas a transmis le déploiement réussi de **`51f0f7f515d2fbca83a64cf9e95e60daaf480381`**, API/worker sains, contrat Hermes compatible et activation Brave. Ce code corrige le refus tarifaire initial, avec [CI applicative 5/5](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/39580898969) et [Hermes/mises à niveau 6/6](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/39580898986) verts. [Incident tarifaire](journal/2026-10-21-UL-020-glm-price-drift.md).

La première campagne Paitite réelle a progressé jusqu’à **347 acteurs repérés, 31 recherches réussies et 47 lectures tentées, mais zéro concurrent qualifié**, puis s’est arrêtée sur `provider_http_429` : 0,288388 USD consommés ou réservés sur 1 USD, 13 appels au coût incertain. Le diagnostic exécuté par Thomas confirme **Mistral Small 4 actif**, 40 pages sauvegardées, 9 tâches d’extraction refusées au schéma et 25 en erreur générique, cinq terminées et une en attente. Paitite possède 22 faits, aucun concurrent n’en possède. [Diagnostic](journal/2026-10-21-UL-020-live-research-diagnostic.md).

Correctif publié **`2aa3d7e03a210ceff6ef4a8b6c8b91d53a949b32`** : sélection de passages/liens numérotés, citations reconstruites depuis le texte sauvegardé, faits invalides écartés individuellement, usage conservé après erreur de décodage, diagnostics par appel, deux reprises différées maximum sur 429/503, reprise manuelle sans hausse du plafond. [CI applicative 5/5](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/39600654182) et [Hermes/mises à niveau 6/6](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/39600654513) vertes : 115 tests unitaires, PostgreSQL 50/50, API 18/18, worker 39/39, navigateur 15/15, sauvegarde/restauration et historique conservé. Les captures suivantes montrent une progression de la recette; le SHA déployé n’y est pas visible. [Journal du correctif](journal/2026-10-21-UL-020-extraction-recovery.md).

Captures du 21 octobre : **359 acteurs, 36 concurrents qualifiés, 31 recherches, 81 lectures, 0,3754 USD engagés/réservés et 16 appels incertains**. La qualification progresse, sans preuve de revue sémantique. Le diagnostic acheteur lié à la recherche échoue ensuite sur **`result_invalid`**. La capture ne révèle pas le champ refusé. Correctif publié **`d9ed2dfacfbe3f3490343b9c770d48b57e46bf99`** : pause conservant les résultats et leur sélection pour le diagnostic, contrôle du format terminal et une seule correction sous les plafonds existants, métadonnées techniques sans contenu. [CI applicative réussie](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/39615691601) : 119 tests unitaires, PostgreSQL 50/50, API 18/18, worker 41/41, navigateur 15/15, sauvegarde/restauration. Le workflow des six scénarios [Hermes/mises à niveau](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/39615691671) est désormais terminé avec succès; buyer/content, redémarrage et conservation de l’historique passent. Le SHA déployé n’est pas confirmé par les captures. [Journal](journal/2026-10-21-UL-020-buyer-format-and-pause.md).

La capture suivante, diagnostic du **21 octobre à 16 h 55 (Europe/Paris)**, montre **`result_truncated`**. La correction de format conserve la limite de sortie du profil; le dernier diagnostic VPS transmis indiquait Mistral à 3 000 tokens. Une procédure de configuration vérifiée localement propose 6 000 tokens, après contrôle du profil et du budget réellement actifs, sans rebuild ni modification des données ou des budgets. Le réglage et son effet live restent à vérifier sur le VPS. Aucun diagnostic comparatif abouti et relu n’est encore observé. [Constat et limites](journal/2026-10-21-UL-020-mistral-output-limit.md), [bloc de configuration](RESEARCH-OPERATIONS.md).

Implémentation publiée sur `codex/ul-020-web-research`, base UL-019, [PR draft #8](https://github.com/TFourniax/ulysse-ithaque-saas/pull/8). Le diagnostic acheteur peut déclencher une campagne durable depuis un profil public autorisé : recherches Brave par plusieurs axes, lecture des pages, extraction avec citations exactes, qualification, enrichissement des offres et matrice paginée. Les sources de recherche sont consultables par lots et ne sont pas limitées aux huit sources importées. Revue individuelle ou groupée, corrections, historique, budgets cumulés, annulation et reprise sont raccordés. Le modèle actif et le routage Europe/ZDR sont conservés.

Code `375bfe5d28e849f7392d05210a263a1603081383` vérifié : [CI applicative 5/5](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/39519287123), [Hermes et mises à niveau 6/6](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/39519287261). Migrations 0014/0015 appliquées, PostgreSQL 50/50, API 18/18, worker 36/36, navigateur 15/15, sauvegarde/restauration et historique conservé. `npm run verify` couvre 111 tests unitaires. La première CI a révélé un droit de verrou manquant, corrigé par la migration additive 0015.

**Partial** : découverte publique observée dans la recette utilisateur, qualification affichée mais aucun diagnostic comparatif abouti et relu dans cette dernière recette. Les lectures tentées ne sont pas toutes des pages exploitables; les coûts incertains ne sont pas des factures définitives. Les fournisseurs de recherche/modèle restent scriptés dans les preuves CI; PostgreSQL, Keycloak et Hermes y sont réels. La fiabilité des appels, la qualification live, la résolution d’alias entre domaines, la corroboration indépendante et le report des décisions entre campagnes restent ouverts.

[Comportement et recette](WEB-RESEARCH-BENCHMARK.md), [architecture](adr/0016-recherche-publique-et-benchmark.md), [activation](RESEARCH-OPERATIONS.md), [journal de publication et CI](journal/2026-10-21-UL-020-publication-ci.md), [journal d’implémentation](journal/2026-10-21-UL-020-research-implementation.md). Le cadrage initial est conservé dans son [journal](journal/2026-10-21-UL-020-autonomous-research-scope.md). Un pipeline implémenté ne constitue pas une preuve de qualité métier live.

## Recette VPS du 21 octobre — premier diagnostic acheteur GLM abouti

Thomas rapporte un diagnostic acheteur complet affiché le **21 octobre 2026 à 00 h 25 (Europe/Paris)**, en `hermes-live`, avec GLM conservé. Le texte transmis contient cinq rubriques d'analyse, des références à cinq sources versionnées, huit questions d'achat explicitement simulées et un verdict d'unicité limité par l'absence de comparaison documentée. C'est une première réussite du parcours rapportée par l'utilisateur, pas une mesure de fiabilité ni une validation indépendante de chaque citation. Le coût, la durée et les compteurs du run réussi n'ont pas été transmis. [Journal de recette](journal/2026-10-21-UL-019-first-buyer-result.md).

Le correctif `bb34064` a déjà rendu visible un HTTP 429 dans les journaux et le run du 20 octobre à 23 h 44 (un appel modèle, aucun outil). DEBT-022 est close pour la remontée d'erreur des nouveaux runs ; la gestion des refus transitoires reste ouverte en DEBT-023. Mistral Small 4 est un profil de secours disponible mais non testé dans cette recette ; aucune bascule automatique n'est implémentée. La revue des citations, le parcours contenu lié au diagnostic et la mesure des essais restent nécessaires ; la priorité produit explicitée ensuite est l'acquisition autonome UL-020. Aucun changement applicatif ou déploiement effectué depuis cet environnement pour ce constat.

## Recette VPS du 20 octobre — diagnostic des erreurs live

Thomas confirme le déploiement du code UL-019 `e793f24a`, GLM Europe/ZDR et les services sains. Le premier essai acheteur échoue avant toute lecture d'outil : un test technique effectué sur le VPS révèle HTTP 403, plan Business/Enterprise requis. Thomas annonce ensuite l'activation Business ; le nouvel essai de 23 h 07 reste en échec avec l'ancien libellé générique. **Cause du second échec non établie** ; ni génération ni qualité métier validée.

Correctif UL-019 `bb34064` validé par les 11 contrôles CI et observé sur le VPS dans les journaux du 20 octobre à 23 h 44 : conservation des codes fournisseur dans les runs et événements, distinction exécution/format/preuves, messages explicites dans l'interface. Pas de corps fournisseur ou de données métier ajoutés aux logs, pas de changement de modèle, de budget ou de routage. Les erreurs des anciens essais ne sont pas reconstituables. [Journal](journal/2026-10-20-UL-019-live-diagnostics.md).

## UL-019 — GLM et profils déclaratifs

Thomas choisit GLM-5.3-Flash le 20 octobre. Code sur `codex/ul-019-model-profiles`, base UL-018 : profils JSON validés, paramètres/tarifs/capacités séparés du moteur, import de profil administrateur sans rebuild, contrat Hermes normalisé et empreinte par run. Le script conserve la configuration active UL-017/018 et cible le seul Docker rootless Ulysse. [Procédure](MODEL-PROFILES.md), [ADR-0015](adr/0015-declarative-model-profiles.md), [journal](journal/2026-10-20-UL-019-model-profiles.md). **Partial** : premier diagnostic acheteur GLM abouti rapporté le 21 octobre ; fidélité des citations, qualité métier, coûts, fiabilité et deux autres parcours restent à évaluer. Aucun déploiement depuis cet environnement. Le harness reste texte ; capacités multimodales décrites, médias non activés.

Code UL-019 `e793f24a` vérifié : [CI applicative 5/5](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/39482271129) et [Hermes/mises à niveau 6/6](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/39482271316) vertes, dont conservation exacte du raisonnement/signatures, stack GLM simulée neuve et mise à niveau depuis UL-016 avec historique préservé. [PR draft #7](https://github.com/TFourniax/ulysse-ithaque-saas/pull/7). Ces preuves ne remplacent pas la recette fournisseur.

## UL-018 — candidat économique Europe + ZDR

Thomas confirme le 20 octobre la démo UL-017 en `hermes-live` avec GPT‑4.1 mini, clé présente et services sains. UL-018 prépare Haiku 5.5 sur OpenRouter Europe / Bedrock Irlande : ZDR et non-collecte forcés, prix régionaux bornés, précontrôle sans prompt, modèles bornés worker/Hermes et script ciblé rootless Ulysse. [Procédure](MODEL-EU.md), [ADR-0014](adr/0014-europe-zdr-model.md), [journal](journal/2026-10-20-UL-018-europe-zdr.md). **Partial** : accès Business, réglages de compte, inférence et pertinence métier à valider. Aucun déploiement VPS effectué depuis cet environnement.

Code UL-018 `857c2aa9` vérifié : [CI applicative 5/5](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/39475316258) et [Hermes/mises à niveau 6/6](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/39475315988), dont stack Haiku simulée et historique conservé. [PR draft #6](https://github.com/TFourniax/ulysse-ithaque-saas/pull/6), sans fusion automatique. Ces preuves ne remplacent pas la recette fournisseur.

## UL-017 — priorité novembre confirmée

Assemblage implémenté sur `codex/ul-017-november-workflows`, [PR draft #5](https://github.com/TFourniax/ulysse-ithaque-saas/pull/5), base UL-016 `0282c19`. Trois parcours assemblés : client synthétique/crash test, contenus contextualisés et prochaine interaction par affaire. Sources métier communes, lien diagnostic → contenu, questions de cadrage, revue, versions et retraits. Voir [guide](NOVEMBER-WORKFLOWS.md), [ADR-0013](adr/0013-november-workflows.md), [journal](journal/2026-10-20-UL-017-november-workflows.md).

Contrôles locaux et première CI applicative verts au `80a1327` (50 tests PostgreSQL, 18 API, 25 worker, navigateur et stack). Finitions fonctionnelles vérifiées au `05abe52` : neuf jobs verts, 14 parcours navigateur, captures desktop/mobile relues. Une harmonisation des champs URL/date complète cette version. Le moteur live, la collecte/veille web automatique et le déploiement VPS ne sont pas validés par ce lot à ce stade. Thomas confirme un VPS et une démo existants ; leur état actuel n'a pas été inspecté ici. Ne pas utiliser l'ancien cadrage « recommandations seulement » pour différer les deux autres priorités.

## Compatibilité de la démo VPS — 20 octobre 2026

La comparaison avec la version VPS documentée `5a7cf27` a révélé deux lignées UL-016 parallèles. UL-017 intègre maintenant cette lignée : mode `hermes-stub`, historique, scénarios enrichis et garde du prompt Ulysse conservés. La migration historique `0011_agent_stub_mode.sql` est restaurée à l’identique ; `0013_november_stub_compatibility.sql` étend uniquement les nouveaux parcours. Les deux moteurs simulés ne prouvent pas la pertinence métier. Vérifications de cette réconciliation consignées dans le journal du 20 octobre. Aucun accès ni déploiement sur le VPS effectué ici.

## UL-016 — analyse agentique fictive

Lot **partial** sur `claude/clever-cannon-99ywx2`, [PR draft #4](https://github.com/TFourniax/ulysse-ithaque-saas/pull/4), qui reprend la [PR #3](https://github.com/TFourniax/ulysse-ithaque-saas/pull/3) de Codex (`fefba88`) depuis la base UL-015 `598f082`. Interface UL-015 conservée. Hermes officiel épinglé `e76fb95` : le modèle ne reçoit plus que les instructions Ulysse (plugin `ulysse`, contrôle d'empreinte à la passerelle) ; corpus fictif propre à chaque opportunité ; mode `hermes-stub` qui exécute **le vrai Hermes dans la stack** contre un modèle simulé. Vérifié localement et en CI : verify, PostgreSQL 50/50, API 17/17, worker 23/23, e2e 12/12, boucle Hermes, parcours navigateur Hermes + redémarrage, mise à niveau depuis UL-015 et depuis la version Codex, répétition de la validation live. **Live non exécuté** (pas de clé ; `openrouter.ai` refusé par la politique réseau de l'environnement de l'agent) ; procédure prête (`scripts/live-validation.mjs`). Voir [guide](DEMO-AGENTIQUE.md), [rapport](VALIDATION-UL-016.md), [journal](journal/2026-10-07-UL-016-hermes-demo.md). Les sources réelles, la doctrine réelle et le pilote restent ouverts.

Socle historique au 2026-10-07 : **V1 de démonstration complète sur données fictives** (Résultat A). La recette VPS Paitite des 20–21 octobre décrite en tête de document complète cet état ; elle ne qualifie pas à elle seule l'ensemble du pilote.

## Ce qui fonctionne

- **Parcours** : une source autorisée (CRM fictif) est synchronisée en arrière-plan ; les faits normalisés produisent des propositions priorisées, expliquées et sourcées, sans question à un chatbot ; un humain approuve, rejette ou modifie ; tout est historisé et audité ; aucune action externe n'est exécutée.
- **Identité** : connexion OIDC réelle (Keycloak de développement) côté serveur, sessions serveur, CSRF, deux entreprises fictives, rôles owner/reviewer/viewer relus à chaque requête ([ADR-0006](adr/0006-identite-oidc-bff.md)).
- **Données** : PostgreSQL 18.6, 11 migrations, rôles séparés (le compte de migration n'est jamais le compte applicatif), RLS forcée, clés composites, tables en ajout seul ([ADR-0004](adr/0004-postgresql-roles-rls.md)).
- **Worker** : pg-boss, outbox transactionnelle, synchronisations planifiées, analyse, expiration, purge, reprise sur crash, équité entre entreprises ([ADR-0007](adr/0007-worker-outbox.md)).
- **Connecteurs** : contrat versionné et suite de tests de contrat ; seul le connecteur **fictif** existe ([ADR-0008](adr/0008-contrat-connecteur.md)).
- **Doctrine et contexte** : doctrine fictive versionnée (brouillon → validation par un owner → retrait), contexte d'entreprise versionné ; une nouvelle version remplace les propositions concernées.
- **Interface** : React/Vite accessible (clavier, axe, mobile) : propositions, détail et preuves, décisions, révisions, sources, opportunités, analyses, audit, doctrine, contexte, membres. Direction visuelle « tech minimaliste » (UL-015) : thèmes clair et sombre, police auto-hébergée, jauges de priorité, transitions respectant `prefers-reduced-motion`.
- **Mesure** : évaluation facultative de chaque décision (utile, non actionnable, doublon, obsolète, non fondée, hors périmètre) et page « Mesure » calculée uniquement à partir des données enregistrées ([ADR-0011](adr/0011-mesure-pilote.md)).
- **Analyse agentique** : modes règles, simulé, Hermes réel avec modèle simulé et Hermes live, explicitement séparés ; service privé remplaçable, plugin Hermes `ulysse` (sept outils de lecture pour les affaires, trois pour buyer/content ; instructions vérifiées par la passerelle), références et versions revalidées, réservations atomiques et tentatives bornées ([ADR-0012](adr/0012-hermes-analyse-agentique.md), [contrats](AGENT-CONTRACT.md)). La formulation payante historique est désactivée au worker. **Premier diagnostic acheteur GLM live abouti rapporté le 21 octobre ; recette des autres parcours et fiabilité ouvertes**.
- **Exploitation** : image Docker unique, stack Compose complète, sauvegarde chiffrée et restauration vérifiée, commandes d'administration, règles d'alerte, runbooks ([OPERATIONS](OPERATIONS.md), [ADR-0010](adr/0010-image-et-sauvegardes.md)).

## Vérifié

Recette UL-016 actuelle : [rapport](VALIDATION-UL-016.md) — trois niveaux distincts (simulé, Hermes réel avec modèle simulé, live non exécuté), PostgreSQL 50/50, API 17/17, worker 23/23, e2e 12/12, stack Hermes réelle en CI (`hermes-stack`) et en local, mise à niveau UL-015 et Codex. Les résultats ci-dessous décrivent le socle historique.

Branche `claude/quirky-darwin-v4is1f`, [PR #2](https://github.com/TFourniax/ulysse-ithaque-saas/pull/2). Au commit `a3160dc` : [CI run 37543605537](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/37543605537) (push) et [run 37543609256](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/37543609256) (pull request), 5 jobs verts chacun. Les commits suivants ne modifient que la documentation.

| Contrôle | Résultat | Où |
| --- | --- | --- |
| Format, lint typé strict, `tsc -b`, cycles, fraîcheur OpenAPI, contrôle documentaire | vert | CI Ubuntu et Windows (`npm run verify` en local) |
| Tests unitaires | domain 47, connectors 9, observability 3, ai 6, database 3, api 1, worker 1 | CI Ubuntu et Windows |
| Intégration PostgreSQL 18.6 sous les vrais rôles | database 50, api 17, worker 11 | CI `integration-postgres` et local |
| Recette navigateur (Keycloak réel, API, worker, Chromium) | 12/12, dont accessibilité axe et mobile | CI `e2e-browser` et local |
| Image + stack Compose : connexion OIDC, propositions en arrière-plan, redémarrage, sauvegarde/restauration | vert | CI `container-stack` et local |
| Démo hors ligne (`npm run demo`) | vert | CI |

Captures et preuves UL-016 actuelles : [rapport](VALIDATION-UL-016.md). Les autres captures [docs/evidence](evidence/) sont antérieures à UL-015 (DEBT-019). Correspondance critère par critère : [ACCEPTANCE](ACCEPTANCE.md).

## Non vérifié, partiel ou bloqué

| Sujet | État | Dépendance |
| --- | --- | --- |
| Source réelle (CRM, Stratégie, e-mail…) | bloqué (UL-008) | choix de source, accès autorisé et contrat (Q-002, Q-003) |
| Doctrine Néreis/Odyssée réelle | bloqué (UL-009) | fournie et validée par ses responsables métier (Q-004, Q-011) |
| Utilisateurs pilotes et mesure de valeur réelle | bloqué (UL-007, UL-012c) | Q-001, Q-010 ; l'outil de mesure est prêt (UL-012b) |
| Appel réel à un modèle (OpenRouter) | diagnostic acheteur GLM abouti rapporté sur VPS (UL-019) | revue des sources, métriques du run réussi, fiabilité et autres parcours à vérifier ; aucun appel payant depuis cet environnement |
| Environnement pilote/production, TLS, IdP de production, alerting déployé, sauvegardes hors site | non défini (UL-011b, UL-014) | Q-007, Q-008, Q-013 |
| Pièce jointe initiale | bloqué (UL-013) | fichier lisible ; son contenu n'a pas été lu |
| Licence du code et de la doctrine, contrat, prix | non décidé (UL-014) | responsables ; rien n'est supposé dans ce dépôt |

## Prochaine étape

Terminer les contrôles UL-017, puis charger l’entreprise fictive pour la recette des trois parcours, dont les scénarios UL-016 avec une clé autorisée, la revue de pertinence et le lancement Docker Desktop. Les lots de pilote réel restent distincts et dépendent des réponses listées dans [PILOT](PILOT.md) : UL-008 (première source réelle, dès qu'un accès est fourni), UL-009 (doctrine validée), UL-011b (environnement), puis UL-012c (pilote). En attendant : DEBT-013 (traces) ou DEBT-017 (autres navigateurs) si le pilote l'exige.

## Source et publication

Base : `codex/ul-001-foundation` ([PR #1](https://github.com/TFourniax/ulysse-ithaque-saas/pull/1), non fusionnée). Travail sur `claude/quirky-darwin-v4is1f` ([PR #2](https://github.com/TFourniax/ulysse-ithaque-saas/pull/2)). Aucune fusion sur `main`, aucun déploiement.

Journaux : [fondation](journal/2026-10-06-foundation.md), [UL-002 à UL-010](journal/2026-10-06-UL-002-v1-demo.md), [UL-011](journal/2026-10-06-UL-011-exploitation.md), [UL-012b](journal/2026-10-06-UL-012b-mesure.md), [UL-015](journal/2026-10-07-UL-015-interface.md).

UL-016 : Codex sur `codex/ul-016-hermes-demo` ([PR #3](https://github.com/TFourniax/ulysse-ithaque-saas/pull/3)), reprise sur `claude/clever-cannon-99ywx2` ([PR #4](https://github.com/TFourniax/ulysse-ithaque-saas/pull/4), contient #3), toutes deux vers `claude/sweet-tesla-jrnkxs`, sans fusion.

Refonte visuelle UL-015 sur `claude/sweet-tesla-jrnkxs`, basée sur `claude/quirky-darwin-v4is1f` : [CI run 37628909866](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/37628909866) au commit `2364d93`, 5 jobs verts (recette Playwright 12/12, axe et mobile compris) ; captures validées par le responsable produit.
