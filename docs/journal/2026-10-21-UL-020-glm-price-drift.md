# UL-020 — tarif GLM refusé avant déploiement

Date : 21 octobre 2026. Responsable : Codex. Objectif : débloquer la mise à niveau UL-020 sans contourner le contrôle financier ni changer de modèle.

## Constat VPS

Thomas transmet la sortie de `deploy 375bfe5d28e849f7392d05210a263a1603081383` : les images application et Hermes sont construites, les migrations historiques correspondent, mais le précontrôle s’arrête sur `Tarif fournisseur superieur au plafond epingle`. Le pointeur actif affiché est celui d’UL-019 `bb34064`; la coupure des services et les migrations additives sont après ce contrôle dans le script. Aucun rollback n’est requis pour cet arrêt. Le diagnostic ne prouve pas une nouvelle vérification de santé après l’arrêt.

## Vérification du tarif

Le 21 octobre vers 11 h 47 (Europe/Paris), lecture sans clé ni prompt du [registre ZDR](https://openrouter.ai/api/v1/endpoints/zdr) et des [endpoints GLM](https://openrouter.ai/api/v1/models/z-ai/glm-5.3-flash/endpoints). L’endpoint exact `inceptron/fp8`, modèle `z-ai/glm-5.3-flash`, est actif (`status=0`) et annonce entrée `0.000000175`, sortie `0.00000069` USD/token. La [fiche officielle, section Europe](https://openrouter.ai/z-ai/glm-5.3-flash) confirme **0,175 / 0,69 USD par million**. Le profil embarqué était **0,10 / 0,69**. La date précise du changement fournisseur n’est pas établie.

## Changement

- `apps/worker/src/agent-model-profiles.json` : seul le plafond d’entrée GLM passe à 0,175. Identifiant, fournisseur exclusif, Europe/ZDR, paramètres et limites de génération inchangés.
- `apps/worker/src/agent-provider-check.ts` : le refus affiche désormais les deux prix observés et leurs plafonds avec l’identité du profil configuré. Pas de texte libre fournisseur ni de secret. Le contrôle reste bloquant et ne relève aucun plafond automatiquement.
- `apps/worker/test/agent.unit.test.ts` : reproduction avec ancien profil explicite, acceptation du tarif vérifié, refus d’une hausse supplémentaire d’entrée ou de sortie, réservations et limite haute du run vérifiées. Un profil administrateur prioritaire reste conservé, même s’il est trop bas.
- Documentation d’état, profil et déploiement mise à jour. Aucune migration, modification de session ou remise à zéro de comptabilité. Les plafonds rapportés de 0,25 USD/run, 2 USD/session et 10 USD/mois sont conservés.

## Vérification et suite

Tests ciblés, `npm run verify` et CI à consigner avant de publier la révision à déployer. Aucun accès SSH, appel d’inférence ni changement de configuration VPS effectué depuis cet environnement. La recette de recherche Brave/GLM reste ouverte en DEBT-024. Les tests scriptés ne remplacent pas le nouveau précontrôle réel sur le VPS, ni la revue de qualité métier après activation.
