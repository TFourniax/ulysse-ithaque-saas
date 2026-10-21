# UL-020 — réponse acheteur tronquée et plafond Mistral

Responsable : Codex. Objectif : permettre un nouvel essai acheteur avec le corpus déjà collecté, après la capture du diagnostic du 21 octobre à 16 h 55 (Europe/Paris). Périmètre : procédure de configuration existante, état/backlog et preuves documentaires; aucun changement de code applicatif ni migration.

## Constat

La capture montre un diagnostic lié à une recherche et refusé `result_truncated`, sans résultat publié. Elle ne révèle ni le profil actif, ni le SHA déployé, ni l’exécution d’une correction. Le contrôle terminal associe ce code à `finish_reason=length`. Le dernier diagnostic VPS transmis indiquait Mistral Small 4 Europe/ZDR, sortie maximale 3 000 tokens, raisonnement désactivé.

La correction de format ajoutée au `d9ed2dfacfbe3f3490343b9c770d48b57e46bf99` réutilise le plafond du profil. Elle peut donc également être tronquée. Ce constat n’explique pas rétroactivement le précédent `result_invalid`.

## Réglage préparé

La [procédure de recherche](../RESEARCH-OPERATIONS.md) inclut un bloc VPS qui lit le profil validé du worker, vérifie Mistral Europe à 3 000 tokens sans raisonnement, le clone et ne change que son identifiant et sa sortie maximale à 6 000. Le mécanisme de profil administrateur existant valide et applique cette configuration sans reconstruction d’image. Un profil inattendu ou une réservation supérieure au budget actif arrête le bloc. Les autres paramètres, clés, tarifs plafonds, budgets, session et données restent conservés.

Le script vérifie le catalogue fournisseur avant le redémarrage gracieux API/worker et dispose du retour arrière existant. Le fichier temporaire, privé, contient uniquement le profil validé, aucun secret. Le réglage concerne tous les nouveaux appels utilisant ce profil, donc également une collecte reprise; il ne démarre pas une nouvelle campagne. Une campagne autorisée déjà en cours peut continuer au redémarrage.

## Vérification

Validation locale par l’adaptateur compilé `agentProvider` : schéma 6 000 accepté, routage et raisonnement identiques, seul `max_tokens` change dans les paramètres transmis. Aux tarifs plafonds du profil inclus, la réservation conservatrice pour huit appels au contexte maximal est de **0,13998336 USD**, inférieure au plafond par run de 0,25 USD transmis précédemment. Ce calcul n’est ni une facture ni une vérification du tarif fournisseur actuel; le bloc recalcule cette condition avec le profil et le budget réellement actifs.

Les deux workflows du code applicatif `d9ed2dfa` sont maintenant terminés avec succès : [CI applicative](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/39615691601) et [Hermes/mises à niveau](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/39615691671). La mention précédente du statut global en cours est actualisée. Ces tests utilisent un fournisseur modèle scripté et ne prouvent pas la réussite live à 6 000 tokens.

Vérification de cette mise à jour documentaire : corps du bloc VPS extrait et contrôlé par `bash -n`; programme Node exact du bloc exécuté localement avec le profil Mistral inclus et un budget de 0,25 USD; comparaison de tous les champs avec le profil d’origine. `npm run verify` réussi : format, lint typé, compilation, cycles, OpenAPI, 119 tests unitaires et liens documentaires. Aucun scénario d’infrastructure supplémentaire n’est requis pour cette modification documentaire.

## Limites et suite

Configuration non appliquée au VPS depuis cet environnement; aucun appel réel modèle. Thomas exécute le bloc puis reprend le brief existant pour réutiliser la campagne liée. Les plafonds de temps, contexte et taille finale restent inchangés. Une sortie plus longue peut coûter davantage et prendre plus de temps, sous les budgets conservés. DEBT-029 reste ouverte jusqu’au diagnostic Paitite sourcé relu; un nouvel échec doit être examiné avec `diagnose`, notamment `format_repair_attempted`, `format_code` et `finish_reason`.
