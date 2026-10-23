# Connecter la démo à Anthropic

Ulysse utilise le fournisseur natif Anthropic d’Hermes, via la passerelle privée qui vérifie les autorisations et comptabilise les appels. La véritable clé API reste dans le worker. Cette route est distincte d’OpenRouter Europe/ZDR. Voir [ADR-0017](adr/0017-anthropic-native.md).

## 1. Enregistrer la clé sur le VPS

Utiliser une clé de l’organisation Anthropic où les crédits sont disponibles. Ne pas coller la clé dans une conversation, un brief, Git ou une commande en clair. Depuis `hermesadmin` sur `hermes-prospection-prod` :

```bash
sudo -Hu ulysse bash <<'KEY'
set -Eeuo pipefail
set +x
umask 077
cd /
[[ $(hostname) == hermes-prospection-prod && $(id -u) == 10002 ]] || exit 1
ULYSSE_KEY_FILE=/var/lib/ulysse/home/private/anthropic.key
ULYSSE_KEY_TMP=$(mktemp /var/lib/ulysse/home/private/anthropic-key.XXXXXX)
trap 'rm -f "$ULYSSE_KEY_TMP"' EXIT
printf 'Collez la clé API Anthropic, puis Entrée (saisie masquée) : ' >/dev/tty
IFS= read -r -s ULYSSE_API_SECRET </dev/tty
printf '\n' >/dev/tty
[[ "$ULYSSE_API_SECRET" == sk-ant-* && ${#ULYSSE_API_SECRET} -ge 24 && ${#ULYSSE_API_SECRET} -le 500 ]] || exit 1
printf '%s' "$ULYSSE_API_SECRET" > "$ULYSSE_KEY_TMP"
unset ULYSSE_API_SECRET
chmod 600 "$ULYSSE_KEY_TMP"
mv -fT "$ULYSSE_KEY_TMP" "$ULYSSE_KEY_FILE"
printf 'Clé enregistrée sans affichage.\n'
KEY
```

## 2. Déployer et activer

La révision ci-dessous a passé les 13 contrôles CI, dont la vraie boucle Hermes et les stacks Anthropic neuve/mise à niveau avec fournisseur scripté. Depuis le même compte `hermesadmin` :

```bash
sudo -Hu ulysse bash <<'UPDATE'
set -Eeuo pipefail
set +x
umask 077
cd /
[[ $(hostname) == hermes-prospection-prod && $(id -u) == 10002 ]] || exit 1

ULYSSE_REPO=/var/lib/ulysse/home/projects/ulysse-ul016
ULYSSE_REVISION=6d4882c29782f37a1113946325e5a28c363724f8
ULYSSE_SCRIPT=/var/lib/ulysse/home/private/ulysse-anthropic.sh

git -C "$ULYSSE_REPO" fetch origin \
  refs/heads/codex/ul-021-anthropic-native:refs/remotes/origin/codex/ul-021-anthropic-native
git -C "$ULYSSE_REPO" show \
  "$ULYSSE_REVISION:scripts/ulysse-vps-europe.sh" > "$ULYSSE_SCRIPT"
bash -n "$ULYSSE_SCRIPT"
bash "$ULYSSE_SCRIPT" deploy "$ULYSSE_REVISION" \
  --anthropic /var/lib/ulysse/home/private/anthropic.key
bash "$ULYSSE_SCRIPT" status
UPDATE
```

Le script construit les images, vérifie l’accès au modèle, sauvegarde et reprend la procédure de bascule. Il conserve recherches, corpus, historique et session. Il configure `AGENT_PROVIDER_ROUTE=anthropic`, `AGENT_MODEL_ID=claude-sonnet-5-5`, aucun secours OpenRouter et les enveloppes autorisées 2/20/100 USD. Une connexion au catalogue ne consomme pas d’inférence et ne prouve pas un solde de crédits positif. Ne pas poursuivre après une erreur.

Si Anthropic est déjà actif, la même mise à jour se lance avec `deploy "$ULYSSE_REVISION"` sans l’option `--anthropic` : la clé et la configuration actives sont conservées.

La démo reste disponible pendant la construction; une courte interruption intervient à la bascule. [Preuves CI et limites](journal/2026-10-23-UL-021-anthropic-native.md).

## 3. Vérifier les parcours

Le statut doit afficher la route `anthropic`, le profil `claude-sonnet55-direct`, la présence de clé et des services sains. Dans la démo, produire un nouveau diagnostic à partir des sources/recherches conservées, relire ses références, créer un contenu lié, puis lancer une analyse d’affaire. Le diagnostic en lecture seule se lance avec `bash "$ULYSSE_SCRIPT" diagnose`; `diagnose-research` vérifie la collecte. Ces relevés ne doivent jamais afficher une clé.

La clé peut être remplacée avec le premier bloc, puis `bash "$ULYSSE_SCRIPT" anthropic /var/lib/ulysse/home/private/anthropic.key`. Cette commande valide avant la bascule et conserve les données. Pour revenir à la configuration sauvegardée, `bash "$ULYSSE_SCRIPT" rollback`. Le modèle et le fournisseur ne sont jamais un réglage demandé au dirigeant dans son parcours.

## Continuité après un outil

La révision ci-dessus inclut le contrat d’exécution v6 : le contexte initial appartient à la conversation Hermes et reste stable après chaque outil. Les corrections conservent aussi les blocs signés et les définitions d’outils. Voir [le journal du correctif](journal/2026-10-23-UL-021-native-prefix.md).

Après mise à jour, reprendre le même brief et lancer un nouveau diagnostic acheteur, puis créer un contenu lié. Une sonde simple HTTP 200 ne valide pas à elle seule la conversation avec outils. Le diagnostic en lecture seule reste `bash /var/lib/ulysse/home/private/ulysse-anthropic.sh diagnose`; le code `provider_signature_mismatch` identifie désormais un refus explicite de liaison de signature sans exposer le message fournisseur.
