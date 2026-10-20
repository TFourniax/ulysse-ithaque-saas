# Ulysse — Haiku 5.5 en Europe avec ZDR

Correctif UL-018, depuis la démo live UL-017. Le script conserve la clé, les budgets 0,25 USD/run, 2 USD/session, 10 USD/mois et la session. Il ne modifie aucun contenu Paitite ni ne recharge Acme.

## Compte OpenRouter

Dans le compte de la clé Ulysse, passer à **Business** via Settings → Manage plan. Vérifier le tarif affiché avant activation : la documentation annonce sans minimum mensuel et 8 % de frais sur l'achat de crédits.

Dans les réglages de confidentialité, activer ZDR pour Anthropic et OpenAI, désactiver le partage pour entraînement et la journalisation des prompts/réponses. Utiliser les crédits OpenRouter, sans clé fournisseur BYOK dans cet espace. Désactiver les exports d'observabilité/broadcast de contenu. Un guardrail `allowed_data_regions:["europe"]` sur la clé ajoute un contrôle côté compte.

La garantie vise les prompts et réponses des inférences ; elle ne couvre pas toutes les métadonnées de compte/facturation, et certains caches en mémoire restent permis. Les sources et résultats sont conservés normalement dans Ulysse. Voir [ADR-0014](adr/0014-europe-zdr-model.md).

## Déployer

Télécharger [ulysse-vps-europe.sh](../scripts/ulysse-vps-europe.sh) au commit vérifié. Depuis PowerShell :

```powershell
scp -o IdentitiesOnly=yes -i "$env:USERPROFILE\.ssh\hermes_prospection_ed25519" "$env:USERPROFILE\Downloads\ulysse-vps-europe.sh" hermesadmin@51.91.55.14:/tmp/ulysse-vps-europe.sh
ssh -o IdentitiesOnly=yes -i "$env:USERPROFILE\.ssh\hermes_prospection_ed25519" hermesadmin@51.91.55.14
```

Sur le VPS, remplacer `SHA_UL018_VERIFIE` par le SHA complet donné avec le correctif :

```bash
cd /
chmod 644 /tmp/ulysse-vps-europe.sh
sudo -Hu ulysse bash /tmp/ulysse-vps-europe.sh audit
sudo -Hu ulysse bash /tmp/ulysse-vps-europe.sh deploy SHA_UL018_VERIFIE &&
sudo -Hu ulysse bash /tmp/ulysse-vps-europe.sh status
```

Le script vérifie `hermes-prospection-prod`, UID 10002 et `/run/user/10002/docker.sock`. Il construit les deux images puis vérifie catalogue, endpoint ZDR et tarifs avant l'arrêt de l'application. Sauvegarde chiffrée, anciennes migrations et volumes conservés ; seuls les services applicatifs du projet `ulysse` sont remplacés. Aucun `down`, `prune`, seed ou reset.

La nouvelle configuration privée est dans `november-releases`, désignée par `november-active`. Le checkout UL-016 et `stack.env` historique restent à leur place. Ne pas utiliser un ancien `docker compose up` pour appliquer ces réglages : la source de vérité est la configuration active affichée par `status`.

Attendu :

```text
ULYSSE_ANALYSIS_MODE=hermes-live
mode_worker=hermes-live
cle_fournisseur_presente=true
AGENT_MODEL_ID=anthropic/claude-haiku-5.5
AGENT_PROVIDER_ROUTE=openrouter-eu-zdr
AGENT_RUN_BUDGET_USD=0.25
AGENT_SESSION_BUDGET_USD=2
AGENT_MONTH_BUDGET_USD=10
API 200 ...
WORKER 200 ...
```

Le précontrôle ne consomme pas de tokens et ne prouve pas l'inférence. Un HTTP 403 peut indiquer un plan/une clé non autorisés. Endpoint absent, incompatible ou trop cher : arrêt sans bascule. Ne pas contourner en remettant le domaine global.

## Recette Paitite

Se connecter avec le compte qui fonctionne déjà. Vérifier le contexte, la doctrine validée et les sources autorisées de Paitite avant une nouvelle analyse.

1. **Client synthétique** : créer un diagnostic. Contrôler compréhension de l'offre, citations, preuves, hypothèses et manques. Sans sources concurrentes, le benchmark et le verdict d'unicité doivent être limités. Ce changement n'ajoute pas de recherche web.
2. **Contenu** : nouvelle demande « décideur de PME, découverte, obtenir un premier échange, publication LinkedIn, 150 mots maximum », liée au diagnostic. Vérifier objectif, cadrage, français et absence de chiffres/références inventés.
3. **Prochaine interaction** : sur une affaire réelle et ses échanges autorisés, contrôler action utile, interlocuteur, objectif observable et justification. Sans deal réel renseigné, laisser ce test en attente.

Dans **Analyses**, examiner nouvelles exécutions, modèle, statut et coût. Un état de santé vert ne suffit pas. Une abstention justifiée est possible ; une erreur technique doit être diagnostiquée. Éviter les relances répétées : chaque transmission peut être facturée.

Comparer avec GPT‑4.1 mini **en Europe avec ZDR** :

```bash
sudo -Hu ulysse bash /tmp/ulysse-vps-europe.sh model gpt41 &&
sudo -Hu ulysse bash /tmp/ulysse-vps-europe.sh status
```

Créer une nouvelle demande buyer/content avec le même brief et les mêmes versions de sources. Le changement de modèle ne relance pas les analyses terminées ni ne réinitialise les budgets. La déduplication des affaires empêche également de rejouer une entrée déjà traitée : ne pas modifier artificiellement les données pour forcer un comparatif.

Revenir à Haiku :

```bash
sudo -Hu ulysse bash /tmp/ulysse-vps-europe.sh model haiku &&
sudo -Hu ulysse bash /tmp/ulysse-vps-europe.sh status
```

Comparer fidélité, pertinence acheteur, qualité rédactionnelle, action utile, abstentions, échecs, coût total et durée par parcours. Les tarifs seuls ne démontrent pas l'équivalence métier.

## Reprise

```bash
sudo -Hu ulysse bash /tmp/ulysse-vps-europe.sh rollback &&
sudo -Hu ulysse bash /tmp/ulysse-vps-europe.sh status
```

Retour à la configuration précédente de cette opération. Si elle était globale, ses images sont restaurées avec le moteur en `rules`, sans reprise des appels mondiaux. Base et historique conservés. En cas d'échec avant la bascule, l'ancienne configuration est restée active : aucun rollback n'est nécessaire.
