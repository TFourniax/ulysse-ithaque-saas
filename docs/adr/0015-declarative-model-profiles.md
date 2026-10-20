# ADR-0015 — Profils déclaratifs, GLM et contrat d'exécution normalisé

Date : 2026-10-20. Responsable : Codex. Lot UL-019 demandé par Thomas ; base UL-018. Statut : implémenté, recette fournisseur attendue.

## Problème

UL-018 a isolé les paramètres et tarifs mais gardait une union de modèles TypeScript, une condition Haiku et une liste Python. Chaque essai imposait plusieurs modifications. GLM-5.3-Flash exige aussi le raisonnement, incompatible avec sa désactivation systématique dans le runner.

## Décision

- Catalogue JSON versionné dans le worker ; schéma strict Zod v1. Profils GLM, GPT mini, Haiku et Mistral Small 4 en Europe, plus GPT historique pour compatibilité. Aucun changement de modèle implicite lors d'une lecture du catalogue.
- Option administrateur AGENT_MODEL_PROFILE_JSON : un profil externe peut remplacer les paramètres du modèle sélectionné sans reconstruction. Aucune URL, clé, option de fallback, plugin ou route globale dans un profil externe. Le modèle doit correspondre exactement à AGENT_MODEL_ID.
- Adaptateur OpenRouter fixe : domaine européen, endpoint exclusif, ZDR, non-collecte, prix maximaux, paramètres obligatoires, pas de redirection. La configuration ne devient jamais une permission fournie par une source métier.
- GLM : inceptron/fp8, 0,10/0,69 USD par million de tokens au 20 octobre ; raisonnement low activé, temperature 1/top_p 0,95, 8 192 tokens de sortie totale. Précontrôle modèle autorisé, endpoint ZDR actif, prix, paramètres et niveaux de raisonnement annoncés. Les niveaux absents du catalogue ne sont pas inventés comme preuve de compatibilité : la recette live reste requise.
- Contrat privé ulysse-execution-v2 exposé par la santé Hermes. AgentExecutor porte modelSettings : limite de sortie et mode/effort de raisonnement. Le superviseur vérifie syntaxe et limites ; le worker garde l'autorité sur le modèle réellement appelé. Aucun catalogue Python dupliqué.
- Snapshot du profil normalisé et empreinte SHA-256 dans les runs deal/buyer/content. Le gateway refuse un profil différent de celui réservé, même si le modèle n'a pas changé. Aucune migration.
- Les tokens de raisonnement font partie de completion_tokens et de la réservation totale. Les appels incertains restent engagés, les plafonds et sessions restent inchangés. Ni raisonnement brut ni nouvelle trajectoire persistée.
- Le transport custom Hermes retire les champs de raisonnement. Le middleware officiel llm_execution du plugin Ulysse restitue les champs OpenRouter exacts associés aux appels d'outils depuis une mémoire propre au processus, bornée à huit réponses de 80 000 octets. Le worker recontrôle le contexte et le coût après restitution. Le runner refuse le résultat si cette conservation échoue ; aucune modification du moteur amont et aucun retry supplémentaire.
- Les capacités multimodales déclarées sont des métadonnées, pas une autorisation. Le gateway accepte uniquement le contrat de messages texte actuellement comptabilisé. Un nouveau protocole, une nouvelle modalité ou tarification appelle un adaptateur/contrat testé.

## Exploitation et limites

Le script reconstruit les deux images une fois, sur le seul projet rootless Ulysse ; reprend la configuration active et sauvegarde avant bascule. Ensuite model MODEL_ID ou model /profil.json effectue précontrôle, arrêt gracieux et redémarrage sans rebuild. Le retour conserve les données et neutralise le moteur d'une ancienne route globale.

Hermes upstream sait gérer plusieurs fournisseurs et la vision ; son intégration Ulysse volontairement bornée conserve les seuls outils de lecture, réseau privé, prompt, sources et droits métier. Aucune activation automatique de vision auxiliaire, navigation ou délégation.

Une comparaison de prix ne démontre pas la qualité. Pas d'accès SSH ni de génération payante depuis l'environnement de développement. Voir [procédure et limites](../MODEL-PROFILES.md) et [journal](../journal/2026-10-20-UL-019-model-profiles.md).
