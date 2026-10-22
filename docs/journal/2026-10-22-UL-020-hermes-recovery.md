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

`npm run verify` exécuté avec succès localement (format, lint strict, types, cycles, OpenAPI, tests unitaires et liens documentaires). Huit tests Python locaux sans moteur installé et douze tests des transformations du script VPS réussis. Code final **`c5618617c51a9bfc67669fa408a8720d8509b676`** : [CI applicative 5/5](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/39793544261) et [Hermes/mises à niveau 6/6](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/39793544363) réussies.

| Contrôle | Résultat |
| --- | --- |
| Vérifications locales, Linux et Windows | 135 tests unitaires; format, lint strict, types, cycles, OpenAPI et documentation réussis |
| PostgreSQL et API réels | 50/50 et 18/18 |
| Worker sous les rôles PostgreSQL réels | 52/52, dont bascule autorisée, retrait de source, double réparation et publication partielle |
| Navigateur | 15/15 |
| Image Hermes épinglée | 11/11, dont secours natif après outil et isolation des processus |
| Stack neuve et mise à niveau UL-016 | `UL017_BUYER_HERMES_STUB=passed`, `UL017_CONTENT_HERMES_STUB=passed`, persistance après redémarrage |
| Transformation du script VPS | 12/12, conservation des clés, du principal, de la session, des budgets et du rollback |

Les modèles et fournisseurs sont scriptés dans ces preuves. La recette vérifie la chaîne réelle et ses erreurs injectées; elle ne mesure pas la justesse du benchmark Paitite ni la disponibilité des fournisseurs réels.

## Limites et clôture

Première CI du code `476a75a4` : vraie boucle Hermes réussie (onze tests, dont bascule native après outil), contrôle applicatif local et conteneur, navigateur, stacks simulées réussis. Deux anciennes assertions worker attendaient l'ignorance d'un modèle arbitraire ou le précédent libellé d'erreur de profil; elles sont adaptées au refus explicite des modèles non autorisés. Les vérifications d'absence d'appel sortant, des paramètres Europe/ZDR et des coûts sont conservées. Aucun assouplissement du contrôle pour faire passer les tests. Les scénarios natif/DB et double réparation ajoutés passent dans cette première CI; le nouveau passage complet ci-dessus réussit après cette correction.

Pas de clé fournisseur ni d'accès SSH dans cet environnement. Une panne généralisée d'OpenRouter, un problème de compte ou l'indisponibilité des deux routes restent possibles. Les profils doivent être compatibles avec le catalogue du compte au moment de l'activation. Le secours couvre buyer/content; la collecte/extraction de recherche garde sa reprise existante et reste hors de cette bascule.

La relecture automatique et les citations contrôlées ne prouvent pas la justesse sémantique. DEBT-034 reste ouverte jusqu'à une revue humaine du benchmark live; DEBT-035 jusqu'à la recette de l'analyse complète sur le corpus conservé. Aucun effacement de données collectées ni réinitialisation des dépenses.
