# Recherche publique — activation et recette UL-020

État : code local, intégration et activation live à vérifier. Ne pas déployer avant les contrôles CI PostgreSQL, navigateur, stack et compatibilité Hermes. [ADR-0016](adr/0016-recherche-publique-et-benchmark.md), [critères produit](WEB-RESEARCH-BENCHMARK.md).

## Préparer et déployer

La branche est `codex/ul-020-web-research`, issue d’UL-019. Publier la branche et retenir le SHA complet dont les contrôles sont verts. La migration additive 0014 conserve les données existantes. L’application et Hermes doivent être reconstruits ensemble : les outils de lecture par lots et l’empreinte du prompt évoluent. Le script conserve le modèle européen, les clés, la session et les plafonds actifs.

Sur le VPS, exécuter en tant qu’utilisateur `ulysse` avec le script provenant du SHA retenu, selon la procédure [modèles Europe](MODEL-EU.md). Le script vérifie l’hôte, l’UID, le Docker rootless, la configuration active et l’absence de dérive. Il n’est pas destiné à un autre Docker ou serveur.

```bash
# Dans la session ulysse sur le VPS, après publication et CI verte.
: "${ULYSSE_REVISION:?Renseigner le SHA complet verifie de la branche UL-020}"
ULYSSE_REPO=/var/lib/ulysse/home/projects/ulysse-ul016
ULYSSE_SCRIPT=/var/lib/ulysse/home/private/ulysse-research.sh
umask 077
git -C "$ULYSSE_REPO" fetch origin \
  refs/heads/codex/ul-020-web-research:refs/remotes/origin/codex/ul-020-web-research
git -C "$ULYSSE_REPO" show "$ULYSSE_REVISION:scripts/ulysse-vps-europe.sh" > "$ULYSSE_SCRIPT"
bash -n "$ULYSSE_SCRIPT"
bash "$ULYSSE_SCRIPT" deploy "$ULYSSE_REVISION"
```

## Brancher la recherche

Créer une clé Brave Search API dans le compte choisi par l’exploitant. La placer **sur le serveur**, dans `/var/lib/ulysse/home/private/brave-search.key`, fichier régulier appartenant à `ulysse`, permissions `600`. Ne pas la transmettre dans un chat, une commande enregistrée, une capture, Git ou le navigateur applicatif. Le script lit le fichier; les copies de configuration restent dans le répertoire privé.

```bash
bash /var/lib/ulysse/home/private/ulysse-research.sh research brave
bash /var/lib/ulysse/home/private/ulysse-research.sh status
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

## Retour arrière

`research off` coupe les nouveaux appels de recherche et conserve les données. Le retrait de l’autorisation applicative arrête aussi les campagnes et invalide les dépendances concernées. `rollback` réactive la configuration précédente enregistrée par le script; les migrations et l’historique restent en place. Après une opération de configuration isolée, ce retour concerne cette opération, pas automatiquement le déploiement applicatif antérieur. Consulter la configuration privée active avant toute opération d’exploitation.
