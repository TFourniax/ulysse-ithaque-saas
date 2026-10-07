# Contrats d'exécution agentique v1

Ce document décrit les contrats implémentés, leur autorité et leurs limites. Le contrat métier canonique est `packages/domain/src/agent.ts` ; les lectures publiques sont documentées dans [OpenAPI](api/openapi.json). Les instructions versionnées sont dans `services/hermes/instructions.txt`. Aucun contrat n'autorise une écriture externe.

## Demande d'analyse privée

`POST http://hermes:8090/v1/runs`, authentifié par le secret de service, corps de 8 192 octets maximum. Version du protocole : chemin `/v1`. Nouvelle instance Hermes dans un sous-processus et un répertoire temporaire par demande.

| Champ | Autorité / valeur |
| --- | --- |
| runId | UUID créé et persisté par le worker avant l'appel |
| subjectId | UUID interne de l'opportunité autorisée, jamais l'identifiant CRM seul |
| capability | Jeton opaque aléatoire de 32 octets, 43 caractères base64url ; seul son hash est conservé |
| mode | `hermes-live` ou `hermes-stub` (vrai Hermes, modèle simulé) ; `simulated` reste une exécution du worker sans Hermes |
| model | `openai/gpt-4.1-mini`, fixé par configuration serveur |
| timeoutMs | 90 000 ms, plafonné par le superviseur ; boucle à 85 s |

Avant chaque demande, le worker lit `GET /health` : `hermesCommit` et `instructionsSha256` doivent égaler le commit épinglé et l'empreinte attendus, sinon le run échoue avec `hermes_version_mismatch` sans appel. Version des instructions enregistrée sur le run : `ulysse-agent-v1+<12 premiers caractères de l'empreinte>`.

Entreprise, périmètre, déclencheur, versions de source/doctrine/contexte, modèle, Hermes, instructions et corrélation sont établis dans PostgreSQL. Hermes n'a aucun champ permettant de choisir une entreprise. La capacité retrouve exclusivement le run actif, non expiré et son entreprise ; chaque outil recontrôle également la source et les versions. Elle expire après 90 s et cesse d'autoriser dès que le run est terminé, révoqué ou interrompu. Elle n'est ni un identifiant utilisateur ni une session navigateur.

## Instructions transmises au modèle

Le plugin Hermes `ulysse` (seul plugin activé, chargé depuis le répertoire temporaire du run) enregistre les sept outils et un middleware officiel `llm_request` qui remplace le prompt générique d'Hermes par `services/hermes/instructions.txt`, seul message système. La date d'analyse figure dans le message utilisateur. La passerelle refuse (`FORBIDDEN:foreign instructions`) toute requête dont le message système n'est pas exactement ces instructions (empreinte sha256, unique message `system`/`developer`, en tête), et (`FORBIDDEN:foreign tools`) toute liste d'outils différente des sept outils Ulysse. Le runner échoue fermé (`ulysse_plugin_not_loaded`) si un autre plugin enregistre hooks, middleware ou commandes.

## Outils et références

`POST http://worker:3001/agent/tools/{name}`, Bearer = capacité du run. Arguments validés côté worker, UUID et document bornés, six éléments maximum par lecture, douze appels maximum par run. Le sujet implicite reste celui du run ; un sujet différent est refusé. Le registre Hermes effectif contient exactement sept outils ; une divergence des noms ou schémas empêche l'exécution.

| Outil | Arguments utiles | Résultat et références |
| --- | --- | --- |
| get_opportunity | subjectId fourni par le serveur | CRM et contraintes de contact ; `opportunity:<uuid>:r<revision>` |
| list_activities | limit facultatif, 1–6 | Échanges, notes, activités ; références material versionnées |
| search_documents | query, 100 caractères maximum ; limit | Métadonnées seulement : une recherche seule ne permet pas de citer le texte |
| read_document_excerpt | documentId borné ; limit | Texte fictif non fiable, auteur/date/version ; `material:<opportunity>:<id>:v<version>:r<revision>` |
| get_company_context | aucun | Contexte et offres ; `context:v<version>` |
| get_active_doctrine | aucun | Doctrine fictive et politique ; `doctrine:<uuid>:v<version>` |
| list_related_recommendations | limit | Propositions/décisions antérieures ; `recommendation:<uuid>:r<revision>` |

Les schémas exposés au modèle sont plus réduits que les arguments facultatifs du worker. `state` distingue `present`, `empty`, `absent` et `unavailable` ; la fraîcheur est recontrôlée avant la lecture et la publication, et une donnée périmée interrompt la lecture. Les extraits ne peuvent pas modifier les outils, permissions ou instructions. Les références effectivement lues sont conservées, pas le contenu des prompts ni le raisonnement interne.

## Résultat fermé

Version `ulysse-agent-v1`. Tous les champs suivants sont obligatoires, aucune clé supplémentaire admise.

| Champ | Valeurs / borne |
| --- | --- |
| version | `ulysse-agent-v1` |
| outcome | `proposals`, `no_signal`, `abstained`, `contradiction`, `technical_error` |
| summary | Texte non vide, 2 000 caractères maximum, explication factuelle destinée à l'utilisateur |
| proposals | Tableau de 0 à 3 propositions ; non vide pour proposals, vide pour no_signal/abstained/technical_error ; clarification possible pour contradiction |

Chaque proposition contient uniquement `action` (follow_up, clarify, meeting, offer_match, wait, internal_review), `title` (300 caractères), `nextStep` et `justification` (2 000 chacun), `references` (1–12 chaînes distinctes de 250 caractères), `assumptions`, `missingInformation`, `limits` (0–8 chaînes de 500 caractères chacune), et `urgency` (normal, soon, urgent). Tous les textes présents doivent être non vides.

Sujet, entreprise, dates, IDs, versions et empreinte sont ajoutés par le serveur. Les deux familles de recommandations historiques limitent actuellement la publication à deux catégories distinctes par run, bien que le contrat accepte trois propositions. La priorité est calculée par Ulysse : 30 points fixes explicitement expliqués ; l'urgence qualitative vient du modèle et reste consultable. Aucun score de confiance.

Le worker vérifie schéma, références réellement récupérées, versions, fraîcheur, connexion, contact interdit/pause, décisions, doublons et volume. Les révisions des décisions consultées sont verrouillées et recontrôlées lors de la publication. Une modification entraîne `obsolete / history_changed`. Le sens des affirmations et les contraintes commerciales exprimées uniquement en langue naturelle exigent aussi la revue sémantique des [scénarios](SCENARIOS-AGENTIQUES.md) ; leur validation live reste attendue.

## Progression, erreurs et usages durables

Les événements sont exposés par `GET /v1/agent-runs/{id}/events`, après identité et autorisation Ulysse. Ils contiennent `sequence`, `kind`, `label`, `references`, `created_at`. Ordre croissant par run, quarante événements maximum, labels factuels : démarrage, outil consulté, validation, publication ou abandon. Aucune chaîne de pensée.

Les statuts persistés sont running, validating, completed, abstained, obsolete, budget_reached, failed et interrupted. Deux tentatives `failed`/`interrupted`/`budget_reached` sur une même entrée et une même session arrêtent les relances automatiques ; une nouvelle version des sources relance l'analyse. Codes d'erreur notables : `hermes_version_mismatch`, `agent_reported_error`, `versions_changed`, `history_changed`, `lease_expired`, `source_purged`. À l'arrêt d'un run, la réservation est ramenée au montant engagé, qui contient chaque transmission incertaine à sa borne haute. L'interface les traduit en français. Les erreurs sont des codes minimisés (`error_code` / `correlation_id`), jamais des secrets ou une réponse brute fournisseur. Les erreurs HTTP du superviseur distinguent accès refusé, concurrence, timeout et échec de l'exécution. Un résultat technique n'est pas une proposition.

La passerelle d'inférence privée compatible OpenAI intercepte chaque transmission, retries compris : huit maximum. En `hermes-live` elle n'appelle qu'OpenRouter (modèle fixe, sans fallback, prix plafonds) ; en `hermes-stub` elle n'appelle que `AGENT_STUB_PROVIDER_URL` (point simulé interne), sans clé, avec une comptabilité séparée du live (`app.reserve_agent_run_budget`, migration 0011). Elle conserve model_calls, tool_calls, input_tokens, output_tokens, reserved_usd, committed_usd et cost_state. `declared` signifie coût fournisseur déclaré, `estimated` borne calculée à partir des tokens/prix plafonds, `unknown` issue incertaine avec réservation conservée. Un appel ultérieur connu ne masque pas un coût antérieur incertain. Réservation atomique avant le premier appel ; plafonds run/session/mois et concurrence contrôlés dans PostgreSQL.

Le navigateur ne connaît ni la capacité, ni le secret Hermes, ni la clé fournisseur. Les traces, résultats et événements sont soumis à la RLS d'entreprise. Les copies ajoutées par l'analyse sont purgées lors de la révocation ; la comptabilité est conservée sans corpus. Les fichiers Hermes temporaires sont supprimés à la fin du sous-processus ; PostgreSQL reste la seule vérité métier.
