# Démonstration agentique fictive — UL-016

État : **partial — validation live non réalisée** (aucune clé autorisée et fournisseur inaccessible depuis l'environnement d'exécution de l'agent). Tout le reste est vérifié, y compris le vrai Hermes dans la stack complète avec un modèle simulé. Voir [rapport](VALIDATION-UL-016.md), [scénarios](SCENARIOS-AGENTIQUES.md), [contrats](AGENT-CONTRACT.md) et [ADR-0012](adr/0012-hermes-analyse-agentique.md). Ce corpus et cette doctrine sont fictifs : ils ne valent ni doctrine réelle ni validation de pilote.

Branche : `claude/clever-cannon-99ywx2`, [PR #4](https://github.com/TFourniax/ulysse-ithaque-saas/pull/4) (reprend tous les commits de la [PR #3](https://github.com/TFourniax/ulysse-ithaque-saas/pull/3) de Codex). Base UL-015 `598f082ab33fb87faf5ff357285dc95b536bb1b3`, interface UL-015 conservée.

## Les quatre modes

| Mode | Ce qui tourne | Coût | Usage |
| --- | --- | --- | --- |
| `rules` | Moteur historique de règles | 0 | Retour arrière, comparaison |
| `simulated` | Simulation agentique dans le worker, sans Hermes ni modèle | 0 | Recette rapide de l'interface |
| `hermes-stub` | **Vrai Hermes**, vrais outils, vraie publication, **modèle simulé** dans la stack | 0 | Répétition générale avant le live |
| `hermes-live` | Vrai Hermes et vrai modèle via OpenRouter | ≤ 0,25 USD/analyse, ≤ 2 USD/session, ≤ 10 USD/entreprise/mois | Démonstration et validation live |

L'origine réelle de chaque analyse est affichée dans **Analyses** et sur chaque proposition. Un résultat simulé n'est jamais présenté comme live.

## 1. Mettre à jour la copie

PowerShell, Docker Desktop en mode conteneurs Linux, Node.js 24 installé :

```powershell
$ErrorActionPreference = 'Stop'
Set-Location C:\Users\33672\Projects\ulysse-ithaque-saas
git status --short
if ($LASTEXITCODE -ne 0) { throw 'git status failed' }
# Des fichiers suivis modifiés ? Les enregistrer sur leur branche avant de changer de branche.
git fetch origin
if ($LASTEXITCODE -ne 0) { throw 'git fetch failed' }
git switch claude/clever-cannon-99ywx2
if ($LASTEXITCODE -ne 0) { git switch --track origin/claude/clever-cannon-99ywx2 }
if ($LASTEXITCODE -ne 0) { throw 'git switch failed' }
git pull --ff-only
if ($LASTEXITCODE -ne 0) { throw 'git pull failed; do not reset or overwrite local work' }
git rev-parse HEAD
if ($LASTEXITCODE -ne 0) { throw 'cannot identify tested version' }
npm ci
if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
npx playwright install chromium
if ($LASTEXITCODE -ne 0) { throw 'playwright install failed' }
```

Les `.env` et `infra/.env` existants sont conservés tels quels (mots de passe compris). Ne copier les exemples que si ces fichiers n'existent pas. PostgreSQL 18.6 et Keycloak 26.8 ne changent pas. Aucun volume n'est supprimé : la mise à niveau applique seulement la migration 0011 (ou 0009 à 0011 depuis UL-015) et remplace le corpus fictif hérité de la première révision UL-016 en conservant les décisions.

## 2. Configurer (une seule fois)

Ajouter au `.env` racine, ignoré par Git (jamais dans le navigateur, une PR, un journal ou une capture) :

```dotenv
HERMES_SERVICE_TOKEN=<secret aléatoire, 32 caractères minimum>
AGENT_MODEL_ID=openai/gpt-4.1-mini
AGENT_RUN_BUDGET_USD=0.25
AGENT_SESSION_BUDGET_USD=2
AGENT_MONTH_BUDGET_USD=10
AGENT_SESSION_ID=ul016-validation-thomas-20261007
# Pour le live seulement : clé dédiée à la démo, avec un plafond côté OpenRouter.
OPENROUTER_API_KEY=<clé OpenRouter autorisée>
```

Le script remplace, pour la stack qu'il démarre, `ULYSSE_ANALYSIS_MODE`, `ENABLE_DEMO_SCENARIOS` et `AGENT_STUB_PROVIDER_URL` (vide hors `hermes-stub`) : inutile de les modifier dans `.env`. `AGENT_SESSION_ID` est un identifiant de comptabilité (pas un secret) ; ne pas le changer pour contourner un budget atteint. Générer le secret Hermes sans l'afficher (PowerShell 5.1 ou 7) :

```powershell
$taskTokenBytes = New-Object byte[] 32
$taskTokenGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $taskTokenGenerator.GetBytes($taskTokenBytes); $taskToken = [Convert]::ToBase64String($taskTokenBytes) }
finally { $taskTokenGenerator.Dispose() }
# Seulement si HERMES_SERVICE_TOKEN n'existe pas déjà dans .env :
Add-Content -LiteralPath .env -Value ("HERMES_SERVICE_TOKEN=" + $taskToken)
Remove-Variable taskToken, taskTokenBytes, taskTokenGenerator
```

Le script vérifie la **présence** de ces variables sans jamais afficher leur valeur, et s'arrête avant toute construction si l'une manque. Le worker refuse aussi le live sans clé, secret, modèle fixe, trois budgets et session, en production ou hors fixtures. L'ancienne formulation payante (`MODEL_PROVIDER=openrouter`) reste désactivée.

Modèle retenu : `openai/gpt-4.1-mini` (outils et sortie JSON pris en charge ; prix catalogue 0,40 USD/M jetons entrants, 1,60 USD/M sortants, utilisés comme plafonds de réservation). Sans fallback de modèle ni de fournisseur. Qualité, coût réel et latence **restent à observer** lors de la validation live.

## 3. Construire et démarrer

```powershell
.\scripts\demo-agentique.ps1 -Mode hermes-stub    # répétition gratuite avec le vrai Hermes
.\scripts\demo-agentique.ps1 -Mode hermes-live    # live, appels payants bornés
```

Le script construit **ensemble** l'image applicative et l'image Hermes (commit officiel épinglé, installateur scellé), applique les migrations, charge les fixtures, démarre Hermes (et le modèle simulé en `hermes-stub`), puis l'API et le worker. Il s'arrête à la première commande en échec. L'application est servie sur `http://localhost:3000` par le conteneur API. Hermes et le modèle simulé n'ont ni port publié ni accès Internet ; seul le worker appelle OpenRouter.

**Vérifier que le live est réellement actif** : dans **Analyses**, le bandeau indique « Hermes live — modèle réel » et chaque analyse terminée affiche au moins un appel modèle, un coût « déclaré » et les lectures. Le tableau de bord OpenRouter montre l'activité correspondante. Le mode configuré seul ne prouve pas un appel réussi.

## 4. Valider le live (≈ 5 minutes, < 0,10 USD attendu, plafond 2 USD)

D'abord la répétition gratuite, puis le live :

```powershell
.\scripts\demo-agentique.ps1 -Mode hermes-stub
node scripts/live-validation.mjs --dry-run --decide=approve
if ($LASTEXITCODE -ne 0) { throw 'rehearsal failed' }
.\scripts\demo-agentique.ps1 -Mode hermes-live
node scripts/live-validation.mjs
if ($LASTEXITCODE -ne 0) { throw 'live invariants failed' }
```

Le script joue les cinq scénarios obligatoires par l'ingestion (principal, évolution après nouvelle réponse, pause, contradiction et insuffisance, opposition). Après l'évolution, **il attend votre décision** : ouvrez l'URL affichée, lisez la proposition et ses preuves, puis approuvez, rejetez, ou modifiez puis approuvez. Il écrit `test-results/ul016-live/report.md` et `report.json` : outils décidés pendant l'exécution, références lues, appels modèle, jetons, coût et état du coût, durée, résultat structuré, contrôles automatiques. Ces contrôles sont des invariants (origine, appels, lectures, références réellement lues, absence de sollicitation sous pause/opposition) ; la pertinence se juge dans la section « Revue humaine » du rapport, à remplir. Joindre le rapport à la PR après relecture (aucun secret ni cookie n'y figure).

## 5. Présentation de 10 à 15 minutes

1. **0–2 min — Contexte.** Connexion `alice` / `ulysse-demo-alice`. Le bandeau rappelle les données fictives. Ulysse travaille en arrière-plan : aucune question n'est posée à un chatbot.
2. **2–4 min — Sources.** Opportunités → **Modernisation atelier — Industries Fictives SA**. Ouvrir l'appel de découverte, la note atelier (besoin), l'échange calendrier (arrêt technique dans trois semaines), la **décision commerciale consignée** (relance générique écartée) et la fiche d'offres (diagnostic et formation, sans capteurs). Administration : doctrine fictive active et contexte de l'entreprise.
3. **4–6 min — Analyse.** En bas de la page ou dans **Analyses** : origine, versions (Hermes, instructions), progression factuelle (« Consultation des données CRM », « Lecture d'un extrait autorisé »…), références consultées, appels modèle, coût. Souligner que l'agent a **choisi** ses lectures ; le corpus n'était pas dans le premier message.
4. **6–8 min — Proposition.** Ouvrir la proposition : prochaine étape, justification, hypothèses, informations manquantes, limites, preuves ouvrables (lien vers les sources). Le cas croise plusieurs sources (besoin + calendrier + décision consignée + offre) : ce qu'un simple « aucune prochaine étape » du moteur de règles ne produit pas.
5. **8–10 min — Décision.** Modifier la prochaine étape si besoin (la révision humaine n'est jamais écrasée par l'agent), puis approuver ou rejeter. La décision est enregistrée dans Ulysse ; rien n'est envoyé.
6. **10–12 min — Évolution.** Sur une opportunité encore non décidée, ou après décision, « Scénarios de démonstration » → **Nouvelle réponse positive** → *Injecter et synchroniser*. Observer « Analyse en attente », la nouvelle révision ingérée, la nouvelle analyse, puis la proposition qui change.
7. **12–14 min — Garde-fous.** **Renouvellement — Client Témoin** (pause en cours) : aucune sollicitation. Injecter **Opposition** sur **Extension de licences — Exemple Santé** : aucune relance. **Pilote IoT — Prototype & Cie** : informations insuffisantes nommées. Injecter **Injection dans un document** : le contenu reste une donnée.
8. **14–15 min — Droits.** `vera` / `ulysse-demo-vera` voit sans décider ni injecter ; `gina` / `ulysse-demo-gina` (Globex) ne voit que son dossier, même identifiant externe OPP-001 compris.

## 6. Recette locale complète

```powershell
npm run verify
if ($LASTEXITCODE -ne 0) { throw 'verify failed' }
npm run test:integration
if ($LASTEXITCODE -ne 0) { throw 'integration failed' }
npm run test:e2e
if ($LASTEXITCODE -ne 0) { throw 'e2e failed' }
docker run --rm --network none --tmpfs /tmp:rw,size=128m,uid=10001,gid=10001 --entrypoint /opt/hermes/.venv/bin/python ulysse-hermes:ul016 -m unittest -v test_integration
if ($LASTEXITCODE -ne 0) { throw 'Hermes loop test failed' }
$env:ULYSSE_EXPECT_MODE = 'hermes-stub'; node scripts/agent-smoke.mjs
if ($LASTEXITCODE -ne 0) { throw 'stack journey failed' }
```

`test:integration` et `test:e2e` lisent `.env` : les lancer avec la configuration de développement (`infra/compose.yaml` seul pour PostgreSQL et Keycloak), pas pendant la stack de démonstration.

## 7. Diagnostiquer un échec

**Analyses** affiche le statut, le code et la corrélation. Les journaux ne contiennent que des codes, jamais la clé, les prompts ou les contenus :

```powershell
$c = @('compose','-f','infra/compose.yaml','-f','infra/hermes.compose.yaml','--env-file','.env','--env-file','infra/.env','--profile','app','--profile','agent')
docker @c ps
docker @c logs --tail=200 worker hermes | Select-String 'agent run not published|agent gateway refused|execution_'
```

| Indice | Cause probable | Action |
| --- | --- | --- |
| `hermes_version_mismatch` | Images applicative et Hermes construites depuis des versions différentes | Relancer `demo-agentique.ps1` (reconstruit les deux) |
| `FORBIDDEN:foreign instructions` | Prompt système différent des instructions versionnées | Idem ; ne jamais éditer `instructions.txt` sans mettre à jour l'empreinte et les tests |
| `INVALID_INPUT:provider failed` | OpenRouter a refusé (clé, crédit, modèle, paramètres) | Vérifier la clé et le crédit côté OpenRouter, puis relancer |
| `FORBIDDEN:budget limit`, statut `budget_reached` | Plafond run/session/mois ou concurrence | Lire les réservations dans Analyses ; ne pas changer de session pour contourner |
| `FORBIDDEN:model limit` | 8 appels modèle atteints | Analyse trop longue : à signaler dans le rapport |
| `execution_timeout` | Analyse au-delà de 90 s | Réseau ou fournisseur lent ; relancer une fois |
| Aucune ligne de refus mais analyses en échec | Hermes injoignable ou en timeout | `docker @c logs hermes` (`execution_failed`, `execution_timeout`) ; les sondes `GET` d'Hermes (`/api/tags`, `/v1/props`) sont refusées sans être journalisées |
| `obsolete` | Source, doctrine ou décision modifiée pendant l'analyse | Normal : l'analyse suivante porte sur la nouvelle version |

Deux échecs sur une même version des sources arrêtent les nouvelles tentatives (budget protégé) ; une nouvelle donnée source relance l'analyse. Une annulation locale ne garantit pas l'absence de facturation : une transmission à l'issue incertaine reste comptée à sa borne haute.

## 8. Revenir au mode historique

```powershell
.\scripts\demo-agentique.ps1 -Mode rules
if ($LASTEXITCODE -ne 0) { throw 'historical startup failed' }
```

Hermes et le modèle simulé sont arrêtés, le worker repasse aux règles ; décisions et historique sont conservés. Les propositions agentiques encore ouvertes expirent normalement ou sont remplacées par la prochaine analyse. Aucun `down -v`, aucune suppression de volume, aucun changement au Hermes personnel, à Thomas Brain ou à un serveur existant. Les sources réelles, la doctrine réelle et le pilote restent des lots distincts (UL-008, UL-009, UL-012c).
