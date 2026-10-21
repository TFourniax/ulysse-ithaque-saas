# Recherche publique — activation et recette UL-020

État : code `51f0f7f515d2fbca83a64cf9e95e60daaf480381` déployé et Brave activé selon les sorties VPS de Thomas, **11 contrôles CI verts**. Découverte réelle observée, mais qualification bloquée et nouvel arrêt 429; [diagnostic live](journal/2026-10-21-UL-020-live-research-diagnostic.md). [Correctif tarifaire](journal/2026-10-21-UL-020-glm-price-drift.md), [preuves CI initiales](journal/2026-10-21-UL-020-publication-ci.md), [ADR-0016](adr/0016-recherche-publique-et-benchmark.md), [critères produit](WEB-RESEARCH-BENCHMARK.md).

Le tarif d’entrée du profil GLM de `375bfe5` a été refusé par le catalogue réel le 21 octobre. Le correctif remet le plafond à 0,175 USD/M, tarif officiel constaté, sans modifier les budgets. La tentative a été arrêtée avant migration et arrêt des services; pas de rollback à effectuer pour ce refus. [Incident et correctif](journal/2026-10-21-UL-020-glm-price-drift.md).

## Préparer et déployer

La branche est `codex/ul-020-web-research`, issue d’UL-019, [PR #8](https://github.com/TFourniax/ulysse-ithaque-saas/pull/8). La commande ci-dessous épingle le code dont les 11 contrôles sont verts; les commits documentaires suivants ne changent pas ce code. Les migrations additives 0014 et 0015 conservent les données existantes. L’application et Hermes doivent être reconstruits ensemble : les outils de lecture par lots et l’empreinte du prompt évoluent. Le script conserve le modèle européen, les clés, la session et les plafonds actifs. Il vérifie une sauvegarde chiffrée avant migration. Prévoir une brève interruption pendant le remplacement des services.

Sur le VPS, depuis le terminal `hermesadmin`, exécuter ce bloc qui utilise le compte `ulysse`, selon la procédure [modèles Europe](MODEL-EU.md). Le script vérifie l’hôte, l’UID, le Docker rootless, la configuration active et l’absence de dérive. Il n’est pas destiné à un autre Docker ou serveur. En cas d’arrêt sur erreur, conserver le message et ne pas passer à l’activation.

```bash
sudo -Hu ulysse bash <<'UPDATE'
set -Eeuo pipefail
umask 077
cd /
[[ $(hostname) == hermes-prospection-prod && $(id -u) == 10002 ]] || exit 1
ULYSSE_REPO=/var/lib/ulysse/home/projects/ulysse-ul016
ULYSSE_REVISION=51f0f7f515d2fbca83a64cf9e95e60daaf480381
ULYSSE_SCRIPT=/var/lib/ulysse/home/private/ulysse-research.sh
git -C "$ULYSSE_REPO" fetch origin \
  refs/heads/codex/ul-020-web-research:refs/remotes/origin/codex/ul-020-web-research
git -C "$ULYSSE_REPO" show "$ULYSSE_REVISION:scripts/ulysse-vps-europe.sh" > "$ULYSSE_SCRIPT"
bash -n "$ULYSSE_SCRIPT"
bash "$ULYSSE_SCRIPT" deploy "$ULYSSE_REVISION"
UPDATE
```

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

Le script `2026-10-21.research2-diagnostic` ajoute `diagnose-research [tenant-slug]`, avec `acme-demo` par défaut comme pour `diagnose`. Extraire cette version publiée du script dans un fichier privé distinct et vérifier sa syntaxe avec `bash -n`. Il fonctionne avec les images UL-020 déjà en service : aucun rebuild, redémarrage, migration ou changement de configuration requis.

```bash
sudo -Hu ulysse bash /var/lib/ulysse/home/private/ulysse-research-diagnostic.sh diagnose-research
```

La commande affiche la configuration technique du modèle actif puis, en transaction PostgreSQL `READ ONLY`, les trois dernières campagnes du tenant, les étapes/erreurs de la dernière, le nombre de pages et de faits conservés, les coûts regroupés par modèle/étape et les douze derniers appels modèle. Ni clé, contenu de page, nom d’acteur, URL, requête de recherche ou réponse fournisseur ne sont affichés. Les erreurs associées aux appels sont l’état **actuel** de leur tâche, pas un historique reconstitué de chaque tentative. L’identité enregistrée dans chaque appel permet de distinguer un ancien modèle du modèle actif.

`provider_http_429` vient du modèle; `search_http_429` viendrait du moteur Brave. Le code seul ne distingue pas une limite de compte d’une limite de l’endpoint modèle. Une pause sous le plafond n’est pas résolue par une hausse de budget. Des acteurs découverts sans faits qualifiés ne constituent pas un benchmark; examiner les étapes `read` et `extract` avant de multiplier les reprises. Dans l’interface actuelle, « Poursuivre » relève aussi les limites de collecte et le plafond de campagne, même après une erreur fournisseur.

## Retour arrière

`research off` coupe les nouveaux appels de recherche et conserve les données. Le retrait de l’autorisation applicative arrête aussi les campagnes et invalide les dépendances concernées. `rollback` réactive la configuration précédente enregistrée par le script; les migrations et l’historique restent en place. Après une opération de configuration isolée, ce retour concerne cette opération, pas automatiquement le déploiement applicatif antérieur. Consulter la configuration privée active avant toute opération d’exploitation.
