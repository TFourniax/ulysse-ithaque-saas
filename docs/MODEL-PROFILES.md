# UL-019 — GLM 5.3 Flash et profils de modèles

Demande de Thomas le 20 octobre 2026 : tester GLM-5.3-Flash sur Paitite, changer ensuite de modèle sans modifier le moteur, préparer une évolution multimodale. Code préparé pour la démo existante ; aucune connexion SSH ni inférence payante effectuée depuis cet environnement.

## Configuration retenue

| Réglage | Valeur |
| --- | --- |
| Mode | hermes-live |
| AGENT_MODEL_ID | z-ai/glm-5.3-flash |
| AGENT_PROVIDER_ROUTE | openrouter-eu-zdr |
| Profil inclus | glm53flash-eu |
| Fournisseur autorisé | inceptron/fp8 uniquement |
| Tarifs plafonds USD / million | entrée 0,10 ; sortie 0,69 |
| Sortie maximale par appel | 8 192 tokens, raisonnement inclus |
| Raisonnement | activé, effort low |
| Échantillonnage | temperature 1 ; top_p 0,95 |
| Plafonds existants | conservés : au plus 0,25 USD/run, 2 USD/session, 10 USD/entreprise/mois |
| Contexte / appels / durée | au plus 80 000 octets, 8 appels modèle, 90 secondes par run |

GLM impose le raisonnement. Le niveau low est un choix de recette pour les contraintes de délai/coût, à évaluer sur les tâches métier ; ce n'est pas le réglage max des benchmarks de l'éditeur. Les 8 192 tokens remplacent les 3 000 du profil sans raisonnement. La réservation comprend tous les tokens de sortie ; completion_tokens inclut le raisonnement et n'est pas additionné une deuxième fois à reasoning_tokens. Un coût absent ou une issue incertaine reste conservé à sa borne haute.

Prérequis : compte OpenRouter Business/Enterprise donnant accès au domaine européen, crédits partagés sans BYOK ni export/broadcast de contenu. Le script teste le catalogue de la clé et l'endpoint ZDR sans prompt avant l'arrêt de la démo. Aucun nouvel abonnement ni nouvelle clé n'est créé par le script. Les prix, paramètres et niveaux de raisonnement disponibles sont vérifiés ; une incompatibilité arrête la procédure.

OpenRouter appelle « Europe » UE/EEE + Royaume-Uni + Suisse. Le domaine européen et l'endpoint exclusif empêchent le repli global ; ils ne prouvent pas une résidence limitée à l'UE stricte. ZDR concerne les prompts/réponses ; caches temporaires en mémoire et métadonnées de compte/facturation sont distincts. Les sources et résultats Ulysse restent conservés sur le VPS selon les règles de l'application. Les outils web tiers ne sont pas activés.

## Déployer sur le VPS existant

Dans PowerShell :

~~~powershell
ssh -o IdentitiesOnly=yes -i "$env:USERPROFILE\.ssh\hermes_prospection_ed25519" hermesadmin@51.91.55.14
~~~

Puis, sur le VPS, utiliser le **SHA complet de code vérifié fourni dans la livraison** :

~~~bash
cd /
ULYSSE_REVISION=REMPLACER_PAR_LE_SHA_COMPLET_VERIFIE

sudo -Hu ulysse git \
  -C /var/lib/ulysse/home/projects/ulysse-ul016 \
  fetch origin \
  refs/heads/codex/ul-019-model-profiles:refs/remotes/origin/codex/ul-019-model-profiles &&
sudo -Hu ulysse git \
  -C /var/lib/ulysse/home/projects/ulysse-ul016 \
  show "$ULYSSE_REVISION:scripts/ulysse-vps-europe.sh" > /tmp/ulysse-vps-europe.sh &&
chmod 644 /tmp/ulysse-vps-europe.sh &&
sudo -Hu ulysse bash /tmp/ulysse-vps-europe.sh deploy "$ULYSSE_REVISION" &&
sudo -Hu ulysse bash /tmp/ulysse-vps-europe.sh status
~~~

La procédure part de la configuration réellement active, y compris live.json UL-017 ou deploy.json UL-018. Elle ne réapplique pas l'ancien Compose depuis le checkout historique. Compte ulysse UID 10002, socket /run/user/10002/docker.sock, projet ulysse ; autres projets du VPS exclus. Application ET adaptateur Hermes reconstruits ensemble. Les images sont construites et le précontrôle passé avant la coupure. Sauvegarde chiffrée, migrations historiques intactes, aucun seed/reset, tenant Paitite et comptes conservés. Clé déjà active, session et budgets conservés, y compris des plafonds inférieurs aux maxima.

Le statut doit afficher le modèle GLM, la route Europe, le profil/empreinte, API/worker sains et le contrat Hermes compatible. Cela ne prouve pas encore la réussite d'une génération.

Si le catalogue répond 403 : vérifier Business/Enterprise, la clé et les restrictions du compte. La bascule n'a pas commencé ; la démo précédente reste active. Ne pas contourner ce refus avec le domaine global.

Retour arrière, si nécessaire :

~~~bash
sudo -Hu ulysse bash /tmp/ulysse-vps-europe.sh rollback
~~~

Les images/configurations précédentes sont restaurées ; données et migrations conservées. Si la configuration précédente utilisait la route globale, son moteur est remis en rules pour ne pas reprendre les appels globaux. Sur une version Europe précédente, le moteur live peut être conservé.

## Changer de modèle après cette mise à niveau

Un modèle inclus se sélectionne sans reconstruction d'image :

~~~bash
sudo -Hu ulysse bash /tmp/ulysse-vps-europe.sh model z-ai/glm-5.3-flash
sudo -Hu ulysse bash /tmp/ulysse-vps-europe.sh status
~~~

Remplacer l'identifiant par openai/gpt-4.1-mini, anthropic/claude-haiku-5.5 ou mistralai/mistral-small-2603 pour sélectionner leur profil Europe. Le changement redémarre API/worker après précontrôle et arrêt gracieux ; il ne réinitialise ni la session ni la comptabilité. Les profils fournis ne sont pas des certifications de qualité métier ; seul GLM est choisi pour cette recette.

Lister les profils JSON inclus (sans secret) :

~~~bash
sudo -Hu ulysse bash /tmp/ulysse-vps-europe.sh models
~~~

Pour un modèle futur utilisant le même protocole, créer un fichier JSON administrateur à partir d'un profil listé, adapter identifiant, endpoint ZDR, tarifs plafonds, capacités et génération ; l'enregistrer sous /var/lib/ulysse/home/private/ avec permissions 600. Puis :

~~~bash
sudo -Hu ulysse bash /tmp/ulysse-vps-europe.sh model \
  /var/lib/ulysse/home/private/modele-test.json
~~~

Le script copie le contenu dans AGENT_MODEL_PROFILE_JSON de la configuration de release. Aucun montage modifiable à chaud, aucun secret dans ce JSON. Le schéma v1 refuse les champs inconnus, URL arbitraire, clé, plugins, fallback, route globale et dépassement des limites. Changer seulement AGENT_MODEL_ID vers un identifiant inconnu sans profil reste refusé : un modèle doit avoir des paramètres et tarifs explicitement configurés.

La modification d'un modèle compatible se fait donc par **configuration + validation + recette**, sans patch TypeScript/Python. Un protocole nouveau, une nouvelle tarification non couverte (par seconde/image, frais par requête, paliers non bornés) ou une nouvelle modalité exige encore un adaptateur et des tests. Le catalogue ne choisit ni le modèle ni une configuration de sécurité automatiquement.

## Tester sur Paitite

Dans https://demo-ulysse.paitite.com, avec le compte Denis déjà fonctionnel et l'entreprise Paitite :

1. Conserver les sources et décisions existantes. Vérifier que le contexte et la doctrine actifs sont ceux attendus ; la doctrine de démonstration n'est pas automatiquement devenue la doctrine Néreis réelle.
2. **Client synthétique** : créer une nouvelle analyse sur une offre Paitite, avec cible et sources choisies. Attendre un résultat ou des questions explicites. Vérifier les références, les objections, la distinction bénéfice/fonctionnalité et l'absence de concurrents inventés. La collecte web automatique n'est toujours pas raccordée.
3. **Contenu** : partir du diagnostic, préciser cible, phase, canal et objectif. Vérifier fidélité, français et appel à l'action. Relire le brouillon ; aucune publication externe.
4. **Prochaine interaction** : utiliser une vraie affaire autorisée avec ses échanges. Si aucune n'est chargée, ce volet reste à tester ; ne pas réinjecter Acme. Le changement de modèle ne rejoue pas une affaire déjà traitée sur des sources inchangées et ne contourne pas les décisions humaines.
5. Dans les analyses, vérifier le modèle, les événements d'outils, le résultat, l'état du coût et les tokens. Un statut de santé vert ne suffit pas. Signaler l'identifiant d'analyse et son code d'erreur si elle échoue, sans transmettre clé ni données privées dans les logs.

Pour comparer deux modèles, lancer des demandes buyer/content séparées avec exactement le même contexte et les mêmes sources/version, noter le modèle et l'empreinte du profil, le délai, le coût et la qualité relue. Ne pas approuver deux propositions incompatibles. Le budget commun reste actif pour tous les essais.

## Hermes et multimodalité

Hermes prend en charge les modèles compatibles OpenAI, des fournisseurs multiples et la vision. La source épinglée conserve cette architecture ; ce lot ne met pas à jour Hermes et n'active pas ses outils auxiliaires par défaut. Notre service Hermes n'a plus de liste de marques : il reçoit un modèle et des paramètres d'exécution normalisés, puis passe par la passerelle Ulysse pour l'inférence.

Le port AgentExecutor sépare déjà la boucle agentique du domaine. Les profils séparent désormais fournisseur, paramètres, capacités et prix de cette boucle. Chaque run enregistre le profil validé et son empreinte ; une modification en cours de run, même sur le même identifiant de modèle, est refusée.

La présence de image dans les capacités d'un profil décrit le modèle. **Ulysse reste un harness texte dans ce lot.** Les blocs image/audio/vidéo/fichier et les champs multimodaux hors contrat sont refusés avant transmission. Pour activer la vision : ingestion privée avec tenant/permissions/provenance, récupération des médias autorisés, limites MIME/taille, comptabilité des tokens/images et transport multimodal testé ; les appels auxiliaires Hermes devront aussi passer par cette passerelle. Pour l'audio, ajouter le traitement/transcription et les coûts spécifiques. Une interface fournisseur compatible ne réalise pas ces contrôles à elle seule.

## Références et preuves

- [Profils versionnés](../apps/worker/src/agent-model-profiles.json)
- [Schéma et adaptateur](../apps/worker/src/agent-provider.ts)
- [ADR-0015](adr/0015-declarative-model-profiles.md)
- [Journal UL-019](journal/2026-10-20-UL-019-model-profiles.md)
- [GLM : capacités et paramètres](https://docs.z.ai/guides/vlm/glm-5.3-flash)
- [Catalogue européen OpenRouter](https://openrouter.ai/business/eu/)
- [Raisonnement et tokens](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens)
- [Vision Hermes](https://hermes-agent.nousresearch.com/docs/user-guide/features/vision/)
