# UL-020 — diagnostic acheteur et interruption conservant les résultats

Responsable : Codex. Objectif : permettre à Thomas de tester le diagnostic avec les preuves déjà collectées, sans ordre d’actions particulier ni nouvelle collecte forcée.

## Évidence utilisateur

Capture recherche du 21 octobre : 359 acteurs, 36 qualifiés, 31 recherches, 81 lectures, 0,3754 USD engagés/réservés sur 1 USD, 16 appels incertains. La capture suivante montre un diagnostic acheteur lié à une recherche mais refusé `result_invalid`. Elle prouve un refus du format, pas son champ exact ni la revue des 36 qualifications. Aucun contenu privé ni capture n’est ajouté au dépôt.

## Changements

- Interrompre devient une pause avec conservation; les baux en vol sont invalidés, les diagnostics en attente réveillés. Compatibilité des anciennes interruptions manuelles.
- La campagne sélectionnée est transmise au nouveau diagnostic et conservée lorsque le brief est repris. Contrôles tenant, autorisation, versions et fraîcheur maintenus.
- Prompt de résultat fermé, types et limites explicites, synthèse courte. Application et Hermes doivent être reconstruits ensemble pour la nouvelle empreinte.
- Inspection des réponses finales buyer/content : JSON, schéma et invariants de domaine. Une seule correction, si contexte/temps/appels/coût le permettent; pas d’outil dans cette correction.
- Usage des tentatives conservé; erreur finale et diagnostic de champs bornés sans contenu dans `agent_runs.snapshot`. Le diagnostic VPS `diagnose` les affiche en lecture seule. Aucun appel réseau de diagnostic.

Périmètre : contrats/API, stores PostgreSQL, UI recherche/parcours, passerelle worker, prompt Hermes, script VPS, tests et ADR-0013/0016. Dépendance interne contracts ajoutée au worker et verrouillée. Aucun nouveau fournisseur, plafond, secret ou migration.

## Vérification

Code applicatif `127598650f70520a2db429e425d7ae9360c527e5`, scénario de test corrigé et code à déployer **`d9ed2dfacfbe3f3490343b9c770d48b57e46bf99`**. `npm run verify` vert : 119 tests unitaires, format, lint typé, compilation, cycles, OpenAPI et liens documentaires. `bash -n` et neuf tests VPS verts. [CI applicative réussie](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/39615691601) : 119 tests unitaires, PostgreSQL 50/50, API 18/18, worker 41/41, navigateur 15/15, sauvegarde/restauration. Les étapes des six scénarios [Hermes/mises à niveau](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/39615691671) sont toutes terminées avec succès ou ignorées selon la matrice; buyer/content, redémarrage et conservation de l’historique passent. Au dernier relevé, le statut global de ce second workflow reste `in_progress` : ne pas le présenter comme clôturé. Les scénarios ajoutés couvrent format terminal, absence de fuite dans les métadonnées, une seule correction, coût cumulé, 429 pendant correction, citation inventée refusée, pause/reprise face à une réponse tardive, conservation des faits, réutilisation de campagne et refus cross-tenant/révocation. Le navigateur vérifie la sélection de la campagne depuis Recherche.

La première exécution du scénario de corpus partiel cherchait à approuver aussi les acteurs sans faits : le serveur a correctement refusé. Le test corrigé vérifie ce refus puis approuve uniquement les fiches qualifiées. Aucune validation de production n’a été relâchée. Les tests finaux confirment également la sélection explicite d’une ancienne campagne malgré une nouvelle campagne en attente, la reprise des anciennes interruptions et le refus après révocation.

## Limites et suite

Les tests utilisent des fournisseurs scriptés. Aucun correctif ne garantit la qualité du prochain résultat réel. La cause historique `result_invalid` n’est pas reconstituée. La correction peut ne pas être tentée si le budget, le contexte ou le bail restant est insuffisant; les limites ne sont pas relevées. Les interruptions ne remboursent pas un appel déjà transmis. DEBT-028 suit l’interruption; DEBT-029 suit le format et la recette réelle.

Après les vérifications ci-dessus : déployer les deux images, interrompre la collecte si elle tourne, préparer le diagnostic depuis la campagne ou reprendre le brief en échec, puis vérifier les citations concurrentes et relire les faits avant approbation. Thomas exécute la commande VPS; pas d’accès SSH depuis cet environnement.
