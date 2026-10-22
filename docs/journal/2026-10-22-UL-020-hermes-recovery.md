# UL-020 — reprise native Hermes et fiabilité du diagnostic

Responsable : Codex. Périmètre : DEBT-035, passerelle worker, adaptateur Hermes épinglé, relecture buyer, bornes HTTP, migration additive 0017, configuration VPS et tests du parcours complet. Pas de fusion sur main, aucun déploiement VPS depuis cet environnement.

## Incident et constats vérifiés

Les captures utilisateur du 22 octobre, 15 h 01 puis 15 h 16 Europe/Paris, montrent `provider_http_429` puis `result_evidence_invalid`. Leur SHA et leur modèle actifs ne sont pas connus. Le 429 vient du fournisseur; la seconde erreur est celle de notre vérification des références. Les captures ne montrent pas les champs exacts refusés.

Dans le code précédent, la passerelle renvoyait HTTP 403 pour **toutes** les erreurs, masquant les refus transitoires à Hermes. Le secours Hermes était explicitement désactivé. Une seule réparation était partagée entre génération et relecture. Le scénario de stack produisait finalement une abstention : sa réussite ne démontrait pas la publication d'un diagnostic comparatif puis d'un contenu lié.

La documentation officielle [Hermes fallback](https://hermes-agent.nousresearch.com/docs/user-guide/features/fallback-providers) et le code du commit épinglé `e76fb951a1d207c9596032426e7e0eadfb197bea` (`run_agent.py`, `agent/chat_completion_helpers.py`, `agent/route_binding.py`) confirment la bascule native sur une route custom avec URL et clé explicites. [OpenRouter](https://openrouter.ai/docs/guides/routing/provider-selection) documente séparément les contraintes de destination régionale, ZDR et sélection d'endpoint. Utiliser le connecteur OpenRouter direct ne supprime pas les limites du fournisseur et déplacerait la frontière des secrets et sorties réseau. La passerelle est conservée; Hermes effectue le changement de modèle au travers de sa route custom officielle.

## Changements

- Secours optionnel configuré par l'administrateur, distinct du principal, Europe/ZDR uniquement; précontrôle de ses paramètres et tarifs avant activation. Même capacité limitée au run, aucun secret fournisseur dans le processus Hermes.
- Statuts HTTP transitoires corrects, bascule autorisée seulement après refus observé, profil et autorisations revérifiés. Le modèle effectif, le motif de bascule et le profil primaire sont tracés; coûts connus et incertains conservés.
- Continuité des outils dans la conversation Hermes; les signatures opaques de l'ancien modèle ne sont pas envoyées au nouveau. Pas de fork, nouvelle dépendance, outil supplémentaire ni accès public Hermes.
- Une réparation par phase, délai et file cohérents; douze appels maximum buyer/content, huit pour les affaires, enveloppes financières inchangées. Migration additive 0017.
- Après réparation des références, conservation possible des sections déjà relues et correctement référencées. Diagnostic explicitement partiel, retrait des conclusions transversales; au moins un constat sur l'offre propre et une comparaison bilatérale requis. Aucun brouillon initial non relu publié en secours.
- Lecture des réponses HTTP 200 bornée à 512 000 octets. Les contrôles de fraîcheur, retrait de source, tenant et publication restent actifs.
- Recette renforcée : panne après un outil, vraie bascule Hermes, diagnostic avec deux alternatives citées, réparation de relecture et contenu lié. Fournisseur toujours scripté en CI, sans preuve sémantique live.

## Vérification

`npm run verify` exécuté avec succès localement (format, lint strict, types, cycles, OpenAPI, tests unitaires et liens documentaires). Huit tests Python locaux sans moteur installé et douze tests des transformations du script VPS réussis. Les gates PostgreSQL, API, worker, navigateur, vraie image Hermes et stacks neuves/mises à niveau sont requis avant de recommander le déploiement. Les résultats et liens de CI seront inscrits après leur exécution.

## Limites et clôture

Pas de clé fournisseur ni d'accès SSH dans cet environnement. Une panne généralisée d'OpenRouter, un problème de compte ou l'indisponibilité des deux routes restent possibles. Les profils doivent être compatibles avec le catalogue du compte au moment de l'activation. Le secours couvre buyer/content; la collecte/extraction de recherche garde sa reprise existante et reste hors de cette bascule.

La relecture automatique et les citations contrôlées ne prouvent pas la justesse sémantique. DEBT-034 reste ouverte jusqu'à une revue humaine du benchmark live; DEBT-035 jusqu'à la recette de l'analyse complète sur le corpus conservé. Aucun effacement de données collectées ni réinitialisation des dépenses.
