# Recherche publique — activation et recette UL-020

État : correctif **`5d70f9feb3d9a4a8d97298bd9366c110516698f3`**, qui transmet le schéma JSON natif buyer/content au fournisseur compatible, après la capture `result_schema_invalid` du 21 octobre à 21 h 19. Les références sont limitées aux preuves fournies/lues et les octets du schéma sont comptés. Code **`5d70f9feb3d9a4a8d97298bd9366c110516698f3`** publié : [CI applicative 5/5](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/39663581025) et [Hermes/mises à niveau 6/6](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/39663581019), deux workflows terminés avec succès. `npm run verify` réussi (120 tests unitaires), PostgreSQL 50/50, API 18/18, worker 45/45, navigateur 15/15, neuf tests VPS et quatre tests Python ciblés. La vraie boucle Hermes confirme la réception du schéma pour buyer et contenu sur stack neuve et après mise à niveau depuis UL-016, avec historique/session conservés et redémarrage vérifié; modèle scripté. [Preuves et limites](journal/2026-10-21-UL-020-native-result-schema.md). La capture ne confirme ni le SHA ni le profil actif sur le VPS; le prochain diagnostic Paitite reste à tester et relire. Ce code conserve les correctifs de [preuves obligatoires](journal/2026-10-21-UL-020-required-evidence.md), de [réservation](journal/2026-10-21-UL-020-workflow-budget-reservations.md), de [pause et format](journal/2026-10-21-UL-020-buyer-format-and-pause.md). La [limite de sortie Mistral](journal/2026-10-21-UL-020-mistral-output-limit.md) reste celle du profil actif. [ADR-0016](adr/0016-recherche-publique-et-benchmark.md), [critères produit](WEB-RESEARCH-BENCHMARK.md).

Le tarif d’entrée du profil GLM de `375bfe5` a été refusé par le catalogue réel le 21 octobre. Le correctif remet le plafond à 0,175 USD/M, tarif officiel constaté, sans modifier les budgets. La tentative a été arrêtée avant migration et arrêt des services; pas de rollback à effectuer pour ce refus. [Incident et correctif](journal/2026-10-21-UL-020-glm-price-drift.md).

## Préparer et déployer

La branche est `codex/ul-020-web-research`, issue d’UL-019, [PR #8](https://github.com/TFourniax/ulysse-ithaque-saas/pull/8). La commande ci-dessous épingle le code vérifié par les tests cités dans le journal; les commits documentaires suivants ne changent pas ce code. Les migrations additives 0014 et 0015 conservent les données existantes. L’application et Hermes doivent être reconstruits ensemble : la préparation des preuves et l’empreinte du prompt évoluent. Le script conserve le modèle européen, les clés, la session et les plafonds actifs. Il vérifie une sauvegarde chiffrée avant migration. Prévoir une brève interruption pendant le remplacement des services.

Sur le VPS, depuis le terminal `hermesadmin`, exécuter ce bloc qui utilise le compte `ulysse`, selon la procédure [modèles Europe](MODEL-EU.md). Le script vérifie l’hôte, l’UID, le Docker rootless, la configuration active et l’absence de dérive. Il n’est pas destiné à un autre Docker ou serveur. En cas d’arrêt sur erreur, conserver le message et ne pas passer à l’activation.

```bash
sudo -Hu ulysse bash <<'UPDATE'
set -Eeuo pipefail
umask 077
cd /
[[ $(hostname) == hermes-prospection-prod && $(id -u) == 10002 ]] || exit 1
ULYSSE_REPO=/var/lib/ulysse/home/projects/ulysse-ul016
ULYSSE_REVISION=5d70f9feb3d9a4a8d97298bd9366c110516698f3
ULYSSE_SCRIPT=/var/lib/ulysse/home/private/ulysse-research.sh
git -C "$ULYSSE_REPO" fetch origin \
  refs/heads/codex/ul-020-web-research:refs/remotes/origin/codex/ul-020-web-research
git -C "$ULYSSE_REPO" show "$ULYSSE_REVISION:scripts/ulysse-vps-europe.sh" > "$ULYSSE_SCRIPT"
bash -n "$ULYSSE_SCRIPT"
bash "$ULYSSE_SCRIPT" deploy "$ULYSSE_REVISION"
UPDATE
```

Pour la démo déjà configurée, ce déploiement conserve la clé Brave, Mistral, son profil personnalisé éventuel et les plafonds actifs. La première nouvelle analyse libère les anciennes enveloppes inutilisées de son tenant avant de demander sa réservation; elle conserve les coûts connus et incertains. Le diagnostic en lecture seule décrit plus bas permet de comparer les montants avant et après cet essai. Après réussite : recharger la page, ouvrir la campagne existante et cliquer **Interrompre** si elle collecte encore, puis **Préparer le diagnostic acheteur**. Les pages, faits, décisions et dépenses restent conservés; ce bouton sélectionne explicitement cette campagne. Pour le diagnostic en échec déjà visible, **Reprendre ce brief** conserve les champs, sources manuelles et campagne associée. Il suffit de relancer le diagnostic; aucune nouvelle recherche n’est nécessaire pour réutiliser ce corpus. Les résultats provisoires restent à relire avant approbation.

**Reprendre la collecte** reste une action distincte, sans hausse du plafond après une erreur. Un appel déjà transmis lors de l’interruption peut encore être facturé, sans publication tardive de ses données. Les anciennes interruptions manuelles sont également réutilisables si l’autorisation et les versions restent valides. L’étape de branchement ci-dessous concerne une première configuration ou un remplacement de clé.

Le diagnostic `diagnose` affiche désormais `automatically_supplied_sources` et `automatically_supplied_references` pour les nouveaux appels. Un nombre d’outils nul ne signifie plus que les sources obligatoires ont été omises : leurs textes sont fournis par la passerelle. Les lectures supplémentaires de concurrents restent tracées comme outils. Ces compteurs ne prouvent pas la justesse de la comparaison.

## Refus temporaire : reprise automatique

Pour `provider_http_429` ou `provider_http_503`, le correctif de reprise décrit dans le [journal dédié](journal/2026-10-21-UL-020-provider-retry.md) reprend le même appel buyer/content au plus deux fois, avec attente affichée. Il respecte le délai fournisseur, ou attend 30 puis 60 secondes en son absence. Les reprises partagent le plafond de huit appels et les budgets actifs; les transmissions refusées gardent leur provision. Un délai supérieur à deux minutes ou incompatible avec le temps restant arrête le diagnostic. Le bail total passe à trois minutes; une limite durable de compte ou de fournisseur peut toujours provoquer un échec. `diagnose` ajoute le compteur `provider_retries` et les métadonnées techniques `provider_retry`, sans texte fournisseur. L’application et Hermes doivent être mis à jour ensemble.

## Réponse tronquée : ajuster le plafond Mistral

`result_truncated` indique une réponse terminale arrêtée avec `finish_reason=length`. Le dernier diagnostic transmis indiquait Mistral à 3 000 tokens de sortie; la correction de format conserve ce même plafond. La capture seule ne prouve pas le profil actuellement actif ni qu’une correction a été tentée.

Sur cette démo, le bloc suivant vérifie le profil actif puis passe Mistral de 3 000 à 6 000 tokens avec la commande `model` existante. Il conserve les autres paramètres, les tarifs plafonds, le routage Europe/ZDR, les clés, les données et les budgets. Il arrête l’opération si le modèle, le plafond ou le budget ne correspondent pas. Aucun rebuild ni migration; prévoir un bref redémarrage API/worker. Le précontrôle du script vérifie le catalogue fournisseur sans générer de réponse.

```bash
sudo -Hu ulysse bash <<'TOKENS'
set -Eeuo pipefail
set +x
umask 077
cd /
[[ $(hostname) == hermes-prospection-prod && $(id -u) == 10002 ]] || exit 1
ULYSSE_SCRIPT=/var/lib/ulysse/home/private/ulysse-research.sh
bash -n "$ULYSSE_SCRIPT"
ULYSSE_PROFILE=$(mktemp /var/lib/ulysse/home/private/ulysse-mistral-6000.XXXXXX)
trap 'rm -f -- "$ULYSSE_PROFILE"' EXIT
docker --host unix:///run/user/10002/docker.sock exec --workdir /app ulysse-worker-1 \
  node --input-type=module -e '
import { agentProvider } from "./apps/worker/dist/src/agent-provider.js";
const e = process.env;
const active = agentProvider(e.AGENT_MODEL_ID, e.AGENT_PROVIDER_ROUTE, e.AGENT_MODEL_PROFILE_JSON);
const p = structuredClone(active.profile);
if (p.model !== "mistralai/mistral-small-2603" || p.route !== "openrouter-eu-zdr" || p.generation.maxOutputTokens !== 3000 || p.generation.reasoning !== "disabled")
  throw new Error("ARRET : profil actif different du Mistral Europe attendu a 3000 tokens.");
p.id = "mistral-small4-eu-6000";
p.generation.maxOutputTokens = 6000;
const next = agentProvider(p.model, p.route, JSON.stringify(p));
const budget = Number(e.AGENT_RUN_BUDGET_USD);
if (!Number.isFinite(budget) || budget <= 0 || 8 * next.estimate(p.maxContextBytes + 2048, 6000) > budget)
  throw new Error("ARRET : reservation maximale incompatible avec le budget existant.");
console.log(JSON.stringify(next.profile));
' > "$ULYSSE_PROFILE"
bash "$ULYSSE_SCRIPT" model "$ULYSSE_PROFILE"
bash "$ULYSSE_SCRIPT" status
TOKENS
```

Après réussite, le statut doit afficher `profil=mistral-small4-eu-6000`, `sortie_max=6000` et `raisonnement=disabled`. Recharger le diagnostic en échec, cliquer **Reprendre ce brief**, puis relancer; la campagne associée et son corpus restent réutilisés, sans reprendre la collecte. Ce réglage affecte les prochains appels du modèle actif, y compris la recherche si elle est reprise. Il autorise des réponses plus longues et peut augmenter leur coût ou leur durée dans les budgets conservés; il ne garantit pas le succès du prochain diagnostic. Les limites de temps, de contexte, de taille finale et de preuves restent contrôlées. En cas de nouvel échec, utiliser `diagnose` ci-dessous pour connaître le code et l’éventuelle correction avant un autre ajustement.

## Brancher la recherche

Créer une clé [Brave Search API](https://api-dashboard.search.brave.com/login) dans le compte choisi par l’exploitant. La placer **sur le serveur**, dans `/var/lib/ulysse/home/private/brave-search.key`, fichier régulier appartenant à `ulysse`, permissions `600`. Ne pas la transmettre dans un chat, une commande enregistrée, une capture, Git ou le navigateur applicatif. Le script lit le fichier; les copies de configuration restent dans le répertoire privé.

```bash
# Depuis le terminal hermesadmin du VPS. La cle est saisie sans affichage.
sudo -Hu ulysse bash <<'RESEARCH'
set -Eeuo pipefail
set +x
umask 077
cd /
[[ $(hostname) == hermes-prospection-prod && $(id -u) == 10002 ]] || exit 1
ULYSSE_KEY_FILE=$(mktemp /var/lib/ulysse/home/private/brave-search.key.XXXXXX)
trap 'rm -f -- "$ULYSSE_KEY_FILE"' EXIT
read -r -s -p 'Cle Brave Search API : ' ULYSSE_BRAVE_KEY </dev/tty
printf '\n' >/dev/tty
[[ ${#ULYSSE_BRAVE_KEY} -ge 16 ]] || exit 1
printf '%s\n' "$ULYSSE_BRAVE_KEY" > "$ULYSSE_KEY_FILE"
unset ULYSSE_BRAVE_KEY
mv -Tf -- "$ULYSSE_KEY_FILE" /var/lib/ulysse/home/private/brave-search.key
bash /var/lib/ulysse/home/private/ulysse-research.sh research brave
bash /var/lib/ulysse/home/private/ulysse-research.sh status
RESEARCH
```

L’action valide la configuration sans requête payante, puis redémarre seulement le worker. Le premier appel réel intervient lorsqu’une campagne autorisée s’exécute. Une campagne déjà autorisée et en cours peut donc reprendre au redémarrage. Pour désactiver le connecteur : même commande avec `research off`. Dans l’application, **Arrêter les recherches automatiques** révoque l’autorisation et annule les campagnes actives; un appel déjà transmis peut encore être facturé, sans publication de sa réponse.

Le connecteur est désactivé par défaut. `RESEARCH_SEARCH_PROVIDER=brave`, `BRAVE_SEARCH_API_KEY` et `RESEARCH_SEARCH_PRICE_USD` sont des paramètres du worker. Le coût configuré par requête est une estimation à vérifier dans le compte fournisseur. Les modèles conservent leur profil OpenRouter Europe/ZDR; cette garantie n’est pas étendue à Brave. Seul le profil public et ses déclinaisons sont envoyés au moteur.

## Parcours de recette Paitite

1. Ouvrir **Recherche et benchmark** avec le rôle owner. Vérifier le nom, le site officiel, les offres, acheteurs, marché, zone et mots-clés publics. Les suggestions issues du contexte doivent être relues avant autorisation.
2. Autoriser une première collecte, sans importer de concurrents. L’enveloppe initiale proposée est de 0,75 USD, 24 requêtes et 120 lectures; ces plafonds ne garantissent aucun nombre de concurrents. Les limites session/mois existantes peuvent arrêter la campagne plus tôt.
3. Observer les différentes familles de requêtes, nouveaux domaines, fiches exclues, erreurs et raison d’arrêt. Vérifier plus de huit sources réellement lues et la consultation des pages suivantes de la matrice. Une reprise conserve les coûts connus et incertains; elle ne réinitialise pas les plafonds de session/mois.
4. Sur un échantillon d’au moins cinq acteurs, dont des exclusions et un substitut, relire la pertinence pour l’offre et la cible. Contrôler les citations exactes, leurs URLs et dates, l’association à l’offre, les prix et leurs conditions. Vérifier un cas d’information inaccessible, une promesse non prouvée et des valeurs divergentes. Les déclarations commerciales ne sont pas des résultats corroborés.
5. Corriger ou écarter des fiches, valider une sélection, recharger la page et consulter l’historique. Les citations d’origine doivent subsister. Les décisions ne sont pas encore reportées automatiquement vers une nouvelle campagne.
6. Lancer le diagnostic acheteur. Vérifier qu’il attend la campagne si nécessaire, utilise des concurrents collectés et cite des fiches accessibles depuis le texte. Un diagnostic citant une fiche provisoire ne peut pas être approuvé. Après revue ou modification de la campagne, régénérer le diagnostic pour utiliser les nouvelles versions.
7. Tester l’arrêt pendant une étape, une reprise bornée et le changement du profil public. Relever le coût, les appels incertains, le délai, les acteurs pertinents et les erreurs. Ne pas publier de captures contenant les données privées du tenant.

Consigner les résultats dans un journal de recette, en distinguant qualité métier, fonctionnement technique et couverture. Aucun benchmark n’est annoncé exhaustif. Les pages JavaScript seules, PDF, authentifiées ou interdites par robots restent non exploitées dans cette version. Une absence dans les pages lues ne prouve pas une absence de fonctionnalité.

## Diagnostiquer une collecte sans appel payant

Depuis `2026-10-21.research2-diagnostic`, le script propose `diagnose-research [tenant-slug]`, avec `acme-demo` par défaut comme pour `diagnose`. La version publiée ci-dessus, `2026-10-21.research7-schema`, conserve les résultats techniques par tentative, le relevé budgétaire et indique si le schéma natif a été envoyé. Pour diagnostiquer sans déployer, extraire le script publié dans un fichier privé distinct et vérifier sa syntaxe avec `bash -n` : il fonctionne avec les images UL-020 déjà en service, sans rebuild, redémarrage, migration ou changement de configuration.

```bash
sudo -Hu ulysse bash /var/lib/ulysse/home/private/ulysse-research.sh diagnose-research
```

La commande affiche la configuration technique du modèle actif puis, en transaction PostgreSQL `READ ONLY`, les trois dernières campagnes du tenant, les étapes/erreurs de la dernière, le nombre de pages et de faits conservés, les coûts regroupés par modèle/étape et les douze derniers appels modèle. Ni clé, contenu de page, nom d’acteur, URL, requête de recherche ou réponse fournisseur ne sont affichés. Les erreurs associées aux appels sont l’état **actuel** de leur tâche, pas un historique reconstitué de chaque tentative. L’identité enregistrée dans chaque appel permet de distinguer un ancien modèle du modèle actif.

`provider_http_429` vient du modèle; `search_http_429` viendrait du moteur Brave. Le code seul ne distingue pas une limite de compte d’une limite de l’endpoint modèle. Une pause sous le plafond n’est pas résolue par une hausse de budget. Des acteurs découverts sans faits qualifiés ne constituent pas un benchmark; examiner les étapes `read` et `extract` avant de multiplier les reprises.

Le correctif d’extraction `research-v2` ajoute un résultat technique **par appel** au diagnostic, distinct du dernier état de sa tâche : `call_outcome`, `finish_reason` et nombres d’éléments rejetés. Les anciens appels n’ont pas ces données. Une réponse invalide dont l’usage est reçu conserve ce coût connu; les provisions historiques inconnues ne sont pas effacées.

Avec ce correctif, **Reprendre la collecte** après une erreur conserve le plafond et réessaie les étapes en échec. Les recherches réussies et les pages sauvegardées ne sont pas refaites pour réextraire des faits. **Poursuivre · plafond…** étend l’enveloppe seulement après une limite de budget/collecte. Les 429/503 modèle attendent 60 puis 120 secondes avant au maximum deux reprises automatiques; `Retry-After` peut allonger ces délais, jusqu’à 15 minutes, au-delà la campagne reste en pause. Les réservations s’additionnent et les limites session/mois restent bloquantes. L’interruption ou la révocation restent possibles pendant l’attente.

Pour un échec du **diagnostic acheteur**, utiliser `diagnose` (et non `diagnose-research`) :

```bash
sudo -Hu ulysse bash /var/lib/ulysse/home/private/ulysse-research.sh diagnose
```

La sortie ajoute `native_response_schema` (pour les nouveaux appels), `format_repair_attempted`, `format_code`, `finish_reason` et `format_issues` pour les nouveaux appels. Ces champs techniques décrivent le refus sans exposer la réponse. Les anciens échecs `result_invalid` ne sont pas reconstitués. Une correction n’est tentée qu’une fois, si les plafonds et le temps restant le permettent.

## Diagnostiquer le budget

Pour un refus `budget_reached`, le script `2026-10-21.research5-budget` ajoute un relevé compatible avec les images UL-020 déjà en service :

```bash
sudo -Hu ulysse bash /var/lib/ulysse/home/private/ulysse-research.sh diagnose-budget
```

Il ne modifie rien et n’appelle aucun fournisseur. Il affiche le profil actif, les plafonds session/mois, l’enveloppe nécessaire au prochain run, les engagements, les réservations et le reliquat inutilisé des parcours terminés. `room_for_next_run` décrit la marge budgétaire au moment du relevé; la concurrence est affichée séparément. Les appels incertains restent provisionnés, y compris les coûts historiques inconnus qui bloquent le plafond mensuel. La session interne, les clés, les prompts, les sources et les réponses ne sont pas imprimés. Après la correction [des réservations](journal/2026-10-21-UL-020-workflow-budget-reservations.md), la première nouvelle analyse réconcilie les anciennes enveloppes inutilisées de son tenant avant de demander son budget. Le relevé seul ne fait pas cette réconciliation.

## Retour arrière

`research off` coupe les nouveaux appels de recherche et conserve les données. Le retrait de l’autorisation applicative arrête aussi les campagnes et invalide les dépendances concernées. `rollback` réactive la configuration précédente enregistrée par le script; les migrations et l’historique restent en place. Après une opération de configuration isolée, ce retour concerne cette opération, pas automatiquement le déploiement applicatif antérieur. Consulter la configuration privée active avant toute opération d’exploitation.
