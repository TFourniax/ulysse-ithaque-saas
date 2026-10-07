# Démonstration agentique fictive — UL-016

État : **partial, validation live non réalisée**. Voir [rapport](VALIDATION-UL-016.md), [scénarios](SCENARIOS-AGENTIQUES.md) et [ADR-0012](adr/0012-hermes-analyse-agentique.md). Ne pas utiliser ce corpus comme une doctrine réelle ou une validation de pilote.

## Mettre à jour la copie de Thomas

Dans PowerShell, Docker Desktop en mode conteneurs Linux :

```powershell
$ErrorActionPreference = 'Stop'
Set-Location C:\Users\33672\Projects\ulysse-ithaque-saas
git status --short
if ($LASTEXITCODE -ne 0) { throw 'git status failed' }
# Conserver les modifications locales ; si des fichiers suivis sont modifiés,
# les enregistrer sur leur branche avant de changer de branche.
git fetch origin
if ($LASTEXITCODE -ne 0) { throw 'git fetch failed' }
git switch codex/ul-016-hermes-demo
if ($LASTEXITCODE -ne 0) { throw 'git switch failed; create the tracking branch from origin/codex/ul-016-hermes-demo if it does not exist' }
git pull --ff-only
if ($LASTEXITCODE -ne 0) { throw 'git pull failed; do not reset or overwrite local work' }
git rev-parse HEAD
if ($LASTEXITCODE -ne 0) { throw 'cannot identify tested version' }
```

PR [#3](https://github.com/TFourniax/ulysse-ithaque-saas/pull/3), base UL-015 `598f082ab33fb87faf5ff357285dc95b536bb1b3`. Le rapport relie chaque preuve au commit et au run CI. Le lot demeure partial tant que la recette live, la revue sémantique et le démarrage Windows n'ont pas été confirmés.

## Configurer et démarrer

Conserver les `.env` et `infra/.env` actuels et leurs mots de passe. Les exemples ne doivent être copiés que si ces fichiers n'existent pas. Les versions PostgreSQL 18.6 et Keycloak 26.8 sont conservées. Le script ne supprime aucun volume et ne réinitialise pas les fixtures modifiées ; le seed enrichit seulement les données commerciales manquantes et crée une nouvelle version du contexte/doctrine fictifs anciens.

Pour la recette sans dépense :

```powershell
.\scripts\demo-agentique.ps1 -Mode simulated
if ($LASTEXITCODE -ne 0) { throw 'demo startup failed' }
```

L'overlay `infra/hermes.compose.yaml` complète `infra/compose.yaml`. L'interface compilée reste servie par le conteneur API sur `http://localhost:3000`. Le worker est privé. Hermes n'est nécessaire que pour `hermes-live`, sans port publié et sans réseau public.

Pour le live, placer ces valeurs dans le `.env` ignoré par Git à la racine, sans les mettre dans le navigateur, une PR, un journal ou une capture :

```dotenv
MODEL_PROVIDER=none
OPENROUTER_API_KEY=<clé OpenRouter autorisée>
HERMES_SERVICE_TOKEN=<secret aléatoire de 32 caractères minimum>
AGENT_MODEL_ID=openai/gpt-4.1-mini
AGENT_RUN_BUDGET_USD=0.25
AGENT_SESSION_BUDGET_USD=2
AGENT_MONTH_BUDGET_USD=10
AGENT_SESSION_ID=ul016-validation-thomas-20261007
```

Ne pas changer l'identifiant de session pour contourner un budget atteint. Une clé OpenRouter dédiée à la démo avec plafond fournisseur est adaptée. `AGENT_SESSION_ID` est un identifiant de comptabilité, pas un secret. Le secret Hermes peut être généré sans affichage, sous Windows PowerShell 5.1 ou PowerShell 7 :

```powershell
$taskTokenBytes = New-Object byte[] 32
$taskTokenGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
try {
    $taskTokenGenerator.GetBytes($taskTokenBytes)
    $taskToken = [Convert]::ToBase64String($taskTokenBytes)
} finally {
    $taskTokenGenerator.Dispose()
}
# À utiliser uniquement si cette variable n'existe pas déjà dans .env :
Add-Content -LiteralPath .env -Value ("HERMES_SERVICE_TOKEN=" + $taskToken)
Remove-Variable taskToken, taskTokenBytes, taskTokenGenerator
.\scripts\demo-agentique.ps1 -Mode hermes-live
if ($LASTEXITCODE -ne 0) { throw 'live startup failed' }
```

Le worker refuse le live si la clé, le secret, le modèle fixe, les trois budgets ou la session manquent. L'activation est interdite en production et hors fixtures. Une configuration absente reste en mode règles ; une configuration invalide échoue sans appel payant. L'ancien `MODEL_PROVIDER=openrouter` est désactivé à l'entrée du worker : utiliser la passerelle bornée de ce lot.

Modèle retenu pour la prochaine recette : GPT-4.1 mini sur OpenRouter, outils et sortie JSON compatibles selon le catalogue officiel consulté le 2026-10-07, prix plafond 0,40 USD/M tokens entrants et 1,60 USD/M sortants. Qualité et latence **non observées ici**, à mesurer lors de la validation live. Aucun fallback de modèle ou de fournisseur autorisé.

Limites : 8 requêtes d'inférence maximum (retries compris), 12 outils, 90 s, une analyse par entreprise et deux au total, trois propositions maximum dans le contrat ; les catégories historiques regroupent les actions en deux familles dans les recommandations. Priorité Ulysse fixe expliquée 30 ; urgence qualitative proposée par l'agent consultable dans le résultat structuré. Aucun pourcentage de confiance.

## Présentation de 10 à 15 minutes

1. **0–2 min** : connexion `alice` / `ulysse-demo-alice`. Le bandeau indique les données fictives. Ouvrir Opportunités, puis **Modernisation atelier — Industries Fictives SA** (le libellé historique utilise un tiret simple).
2. **2–4 min** : ouvrir l'appel CRM, la note atelier, l'échange calendrier et la fiche d'offres. Consulter Administration pour la doctrine fictive v2 et le contexte de l'entreprise. Expliquer que le modèle n'a pas reçu le corpus dans le premier message.
3. **4–6 min** : scénario « Opportunité inactive », bouton **Injecter et synchroniser**. Observer la révision CRM après ingestion, puis Analyses : origine réelle, statut, outils, références, version Hermes/instructions et coût. En live, exiger au moins un appel modèle et des outils avant publication. « Mode configuré » seul ne prouve pas un appel réussi.
4. **6–8 min** : ouvrir la proposition, sa prochaine étape, ses limites et les liens vers les preuves. Évaluer la pertinence en distinguant faits et hypothèses. Modifier la proposition si nécessaire : la révision humaine n'est pas remplacée automatiquement. Approuver ou rejeter ; la décision reste dans Ulysse, sans envoi.
5. **8–11 min** : si le dossier n'a pas été modifié/rejeté (suppression légitime), injecter « Nouvelle réponse positive ». Le nouvel e-mail est ingéré ; comparer la nouvelle analyse et la prochaine étape. Utiliser un dossier encore non modifié pour une comparaison qui ne contourne pas une décision humaine.
6. **11–13 min** : rejouer « Pause explicite », puis « Opposition » : aucune sollicitation immédiate ne doit être publiée. Une contradiction doit être signalée et clarifiée ; des données insuffisantes doivent conduire à une abstention ou à la nomination des informations manquantes.
7. **13–15 min** : montrer la décision persistée, le refus de mutation pour `vera` / `ulysse-demo-vera`, et le dossier Globex séparé avec `gina` / `ulysse-demo-gina`. Consigner l'évaluation humaine dans le rapport, sans revendiquer une approbation produit automatique.

## Recette et preuves

Avant tout live, exécuter `npm ci`, `npm run verify`, `npm run test:integration`, `npm run test:e2e`, puis les contrôles de [SCENARIOS](SCENARIOS-AGENTIQUES.md). Arrêter après chaque code non nul. Les tests PostgreSQL utilisent `ulysse_app` et `ulysse_worker`, sans BYPASSRLS. La CI historique et le workflow `ul016-validation` distinguent non-régression, parcours simulé et véritable boucle Hermes avec endpoint modèle simulé. Ce dernier test n'est jamais une preuve d'appel fournisseur live.

```powershell
npm ci
if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
npm run verify
if ($LASTEXITCODE -ne 0) { throw 'verify failed' }
npm run test:integration
if ($LASTEXITCODE -ne 0) { throw 'integration failed' }
npm run test:e2e
if ($LASTEXITCODE -ne 0) { throw 'e2e failed' }
docker compose -f infra/compose.yaml -f infra/hermes.compose.yaml --env-file .env --env-file infra/.env --profile agent build hermes
if ($LASTEXITCODE -ne 0) { throw 'Hermes build failed' }
docker run --rm --tmpfs /tmp:rw,size=128m,uid=10001,gid=10001 --entrypoint /opt/hermes/.venv/bin/python ulysse-hermes:ul016 -m unittest -v test_integration
if ($LASTEXITCODE -ne 0) { throw 'Hermes loop test failed' }
```

La recette live minimale comprend le scénario principal, son évolution, une pause, une contradiction/insuffisance et une opposition. Pour chacun : run ID, SHA testé, mode, modèle, versions, outils/références, durée, usages et coût déclaré/estimé/inconnu. Pour le principal : proposition publiée après validation et décision humaine enregistrée. La revue sémantique juge la pertinence à partir des faits ; elle ne compare pas une phrase exacte du modèle à une réponse attendue.

## Diagnostic et retour historique

Analyses expose les codes minimisés, versions et corrélations. Les journaux ne sont pas un lieu pour afficher la clé ou les prompts.

```powershell
docker compose -f infra/compose.yaml -f infra/hermes.compose.yaml --env-file .env --env-file infra/.env --profile app --profile agent ps
if ($LASTEXITCODE -ne 0) { throw 'compose ps failed' }
docker compose -f infra/compose.yaml -f infra/hermes.compose.yaml --env-file .env --env-file infra/.env --profile app --profile agent logs --tail=100 worker hermes
if ($LASTEXITCODE -ne 0) { throw 'logs failed' }
.\scripts\demo-agentique.ps1 -Mode rules
if ($LASTEXITCODE -ne 0) { throw 'historical startup failed' }
```

`budget_reached` : vérifier concurrence, réservations incertaines, session et mois ; ne pas remettre arbitrairement le compteur à zéro. `obsolete` : resynchroniser et laisser la réanalyse s'exécuter. `failed` : consulter l'erreur du service privé et le rapport de tests Hermes ; aucun résultat invalide n'est publié. `interrupted` : la maintenance périodique reprend les leases expirées et les empreintes déjà publiées empêchent les doublons. Une annulation locale ne garantit pas l'absence de facturation : la réservation incertaine reste comptée.

La mise à niveau est additive (migrations 0009/0010). Aucun `down -v`, suppression de volume ou changement arbitraire de PostgreSQL/Keycloak. Aucun changement au Hermes personnel, à Thomas Brain ou à un serveur existant. Les sources réelles, la doctrine réelle et le pilote restent des lots distincts.
