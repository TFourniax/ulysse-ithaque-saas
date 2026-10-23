# ADR-0017 — Anthropic direct avec le transport natif Hermes

Date : 2026-10-23. Décision : implémenter la demande explicite de Thomas d’utiliser sa clé API Anthropic et ses crédits, pour les trois parcours et la recherche. Responsable : Codex. Recette fournisseur réelle encore à effectuer.

## Contexte

La passerelle Ulysse imposait Chat Completions/OpenRouter à Hermes. Remplacer seulement la clé ne fonctionne pas avec l’API Messages. Les incidents de schéma, de preuves et de contexte sont distincts des erreurs fournisseur : changer de fournisseur ne démontre pas leur résolution. Le contrôle des données et la publication restent du ressort d’Ulysse, l’exécution agent du ressort d’Hermes.

## Décision

- Ajouter la route explicite `anthropic`, l’URL fixe `https://api.anthropic.com/v1/messages` et un profil `claude-sonnet55-direct` : modèle `claude-sonnet-5-5`, raisonnement adaptatif moyen, sortie maximale 16 384 tokens. Aucun paramètre de sampling ni appel d’outil forcé, incompatibles avec ce modèle. Les plafonds de temps existants sont conservés, aucun nouvel objectif de latence CI.
- Utiliser `AIAgent(provider="anthropic", api_mode="anthropic_messages")` et le SDK 0.87.0 verrouillé par Hermes. Construire explicitement l’extra `anthropic` avec l’installateur scellé; le vérifier par import dans l’image, sans installation au runtime. Une dérivation via le registre public de transports ajuste uniquement la politique de sérialisation pour la passerelle privée, car la version épinglée retire les signatures lorsqu’elle reconnaît un hôte tiers. Pas de fork, de boucle alternative ni de replay OpenRouter sur cette route. Tester cet ajustement à chaque mise à jour d’Hermes.
- Contrat d’exécution v6 : protocole natif explicite; un seul middleware `llm_request` impose le système natif. Le SDK n’obtient qu’une capacité temporaire et reste sur le réseau privé. La clé réelle est uniquement dans le worker.
- La passerelle accepte un sous-ensemble fermé de Messages (texte, outils Ulysse, raisonnement signé); elle refuse média, outils serveur, streaming et métadonnées arbitraires. Tenant, sujet, outils, instructions et version du profil sont vérifiés comme auparavant. Elle renvoie la réponse native intacte à Hermes; la vue commune sert uniquement au contrôle métier et à la comptabilité.
- Buyer, contenu, prochaine action, relecture et recherche passent au même fournisseur. La recherche utilise `output_config.format` JSON Schema sans outil forcé. Les contraintes non supportées par le décodeur sont reportées en descriptions et restent vérifiées par les schémas locaux.
- Compter les tokens d’entrée, sortie, création et lecture de cache. Le coût est **estimé**, jamais présenté comme une facture déclarée par l’API. Les réservations utilisent le tarif d’écriture de cache lorsqu’il est supérieur au tarif d’entrée. Les usages tardifs et incertains restent comptabilisés.
- Aucun secours entre fournisseurs sur cette route. Les reprises déjà bornées de la passerelle incluent la surcharge 529; chaque transmission est comptée. Les mécanismes natifs Hermes restent en place, sans nouveau retry ajouté au SDK.

## Continuité native — DEBT-038

Les preuves buyer/content natives sont fournies une seule fois à Hermes comme premier message utilisateur, explicitement non fiables. Le catalogue est déterminé avec une enveloppe indépendante de la taille de l’historique. À chaque appel, Ulysse vérifie les versions, les droits et l’égalité exacte du message initial, sans réinsérer de contexte. Hermes conserve sa propre conversation; aucun cache de transcript parallèle. Limites du contrat : preuves UTF-8 ≤ 80 000 octets, enveloppe privée ≤ 262 144 octets; limite complète du profil toujours contrôlée avant transmission et comptabilisation.

Une réparation native continue la conversation en conservant les blocs signés, même lorsque `thinking` est vide, et les définitions d’outils. Elle désactive les nouveaux appels avec `tool_choice: none`. La relecture indépendante ouvre une nouvelle conversation. Aucun contournement `drop_block`. Les signatures Anthropic lient aussi le système, les outils et les messages précédents : préserver les blocs seuls ne suffit pas. Le refus explicite de liaison du préfixe devient le code fixe `provider_signature_mismatch`, sans enregistrer le message fournisseur.

Référence officielle : [préservation du raisonnement](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking), consultée le 23 octobre 2026. Le HTTP 400 historique n’a pas conservé son message fournisseur; ce défaut est démontré dans le code, son attribution à ce run reste à confirmer après mise à jour.

## Exploitation et sécurité

### Préparation du benchmark — DEBT-039

Le contexte initial acheteur inclut jusqu'à quatre fiches concurrentes qualifiées issues de la campagne autorisée, classées selon la priorité de lecture existante. Leur texte enregistré est transmis intégralement, dans la place disponible et au plus 24 000 octets supplémentaires. Les sources propres obligatoires ne sont pas retirées. Le catalogue reste une découverte sans autorisation de citation; seuls les textes réellement transmis ou lus autorisent leurs références. Les lectures supplémentaires restent à la disposition d'Hermes.

La sélection native utilise l'enveloppe fixe avant le premier tour; sa reconstruction ultérieure sert au contrôle exact, sans mutation du préfixe. La relecture ne reçoit que des sources déjà fournies ou lues, avec les mêmes versions et droits. Elle partage désormais les critères de publication du domaine : une campagne qualifiée ou des concurrents sélectionnés exigent une comparaison pour un brouillon, mais pas pour une abstention explicite. Le contrôle détecte l'omission et déclenche la correction bornée existante. Aucune citation inventée, approbation automatique ou nouvelle boucle d'agent. La qualification des acteurs et la pertinence des comparaisons demeurent à relire.

La clé est saisie hors historique dans un fichier privé 0600, appartenant au compte Ulysse. Le script refuse symlink, fichier public ou contenu invalide, puis conserve le secret dans la configuration privée du worker. Ce n’est pas un coffre externe : les administrateurs du compte/Docker rootless ont accès au secret. Aucun secret dans le navigateur, Hermes, Git ou les logs.

`deploy SHA --anthropic /chemin/cle` construit, contrôle la clé et l’accès au modèle par le catalogue Anthropic, puis applique la procédure existante de sauvegarde, migrations additives et bascule. Pas de contrôle OpenRouter lors de cette activation. L’historique, les campagnes, les autres clés et la session sont conservés. Les enveloppes déjà autorisées de 2/20/100 USD sont appliquées sans remettre les dépenses à zéro. Un changement de clé ultérieur utilise `anthropic /chemin/cle`. Le rollback restaure la configuration précédente.

La route directe ne garantit pas Europe/ZDR; cette propriété reste propre au routage OpenRouter qualifié. Le contrôle du catalogue vérifie une authentification et un identifiant de modèle, ni les crédits disponibles ni la qualité d’inférence. Les crédits réellement consommables doivent être visibles dans l’organisation Anthropic à laquelle appartient la clé; aucune activation de subvention n’est effectuée par Ulysse.

## Vérification et limites

Tests des formats, coûts/cache, refus de fuite de secret, protocole/scope/empreinte, recherche, boucle Hermes épinglée et stacks neuve/mise à niveau. Fournisseurs scriptés en CI. La validation réelle exige un diagnostic relu, un contenu lié et une proposition d’action sur le VPS avec la clé de Thomas. Pas de promesse de fiabilité live sur la base des tests CI.

Références officielles consultées le 23 octobre 2026 : [Hermes](https://github.com/NousResearch/hermes-agent/tree/e76fb951a1d207c9596032426e7e0eadfb197bea), [Sonnet 5.5](https://platform.claude.com/docs/en/models/sonnet-5-5/migration-guide), [sorties structurées](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), [prix](https://platform.claude.com/docs/en/about-claude/pricing), [versions API](https://platform.claude.com/docs/en/api/versioning). Prix profil USD/M : entrée 2, sortie 10, écriture cache 5 min 2,5, lecture cache 0,1. Ces prix sont versionnés, non déduits du catalogue de modèles.
