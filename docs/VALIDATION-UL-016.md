# Rapport de validation UL-016

Date : 2026-10-07. **partial** : intégration technique et parcours simulé vérifiés ; fournisseur live et revue de pertinence non réalisés faute de clé autorisée. PR [#3](https://github.com/TFourniax/ulysse-ithaque-saas/pull/3), branche `codex/ul-016-hermes-demo`, base exacte `598f082ab33fb87faf5ff357285dc95b536bb1b3`.

## Preuves au commit vérifié

Head `efaea8ec3bc11047f301eb10b7628e2e36d23ddf`, checkout de recette PR `6eb7035a284859fc06a13cc6f2902c58d40330dd`. [CI applicative](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/37645699638), [recette UL-016](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/37645699691).

| Contrôle | Résultat observé | Portée |
| --- | --- | --- |
| `npm run verify` | Passe dans le job application après génération du formatage | Formatage récupéré et versionné ; recette statique directe à relancer |
| PostgreSQL | 50/50 | RLS, transactions, migration et privilèges sous rôles réels |
| API | 17/17 | Identité, CSRF, droits, décisions et conflits |
| Worker | 17/17 | Six contrôles agentiques, ingestion, budget atomique, isolation, révocation, obsolescence, replay et historique |
| `npm run test:e2e` | Passe | Recette historique conservée, clavier, mobile, axe |
| Stack historique | Passe | Image compilée, seed, propositions, reprise, sauvegarde/restauration |
| Image Hermes | Construction reproductible réussie | Commit officiel épinglé, installateur scellé, Python 3.14.4 |
| Vraie boucle Hermes / modèle simulé | Passe, deux processus simultanés | Deux appels modèle par exécution et `get_opportunity` réellement exécuté ; sept outils exacts, sources séparées ; test en 5,185 s |
| Stack agentique simulée neuve | Passe | Alice, opportunité, sources, injection et ingestion, évolution matérielle, preuves, approbation, restart, Vera et Globex |
| Mise à niveau UL-015 | Contrôles d'état passent ; ingestion immédiate à corriger | Session, identifiants et décision conservés ; synchronisation du seed ajoutée, recette finale requise |

La boucle Hermes utilise ses véritables classes et son dispatcher. Le faux endpoint ne remplace pas la boucle. Son résultat scripté est uniquement une preuve d'intégration, jamais une proposition live. Le mode agentique simulé du worker ne fait aucun appel fournisseur.

[Preuve structurée du parcours](evidence/ul016-simulated-fresh.json) : 10 événements durables, origine simulée, 0 appel modèle, décision de test approuvée. [Captures de la stack CI](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/37645699691/artifacts/11493918048) : sources, analyses et décision. Cette approbation de test n'est pas une approbation produit par Thomas.

Les nouvelles assertions de passerelle vérifient les coûts estimés puis inconnus, la conservation de 0,25 USD lors d'une issue incertaine, huit transmissions maximum, reprise d'une lease expirée et refus d'une citation inventée. Le dernier run doit les confirmer avant activation live.

## Limites de l'environnement

Installation npm locale hors ligne incomplète : `npm run verify` s'arrête sur Prettier absent. Docker CLI présent mais pipes Docker Desktop refusés. Sortie réseau du terminal refusée. Le transport du poste d'exécution s'est ensuite fermé ; les dernières corrections et documents sont publiés via le dépôt et vérifiés par CI. Aucune modification de la copie personnelle, de ses volumes, de Hermes personnel, Thomas Brain ou d'un serveur existant.

La recette Linux CI ne prouve pas un lancement sur le Docker Desktop personnel de Thomas. La procédure PowerShell a été analysée syntaxiquement ; son exécution locale reste à confirmer. Aucun volume supprimé.

## Live — non exécuté

Aucune clé OpenRouter autorisée trouvée dans les fichiers prévus ou l'environnement inspecté. **Aucun appel payant, usage, coût ou latence live observé.** Modèle fixe préparé : `openai/gpt-4.1-mini`, compatible outils/JSON selon le catalogue officiel ; qualité et latence dans Ulysse non mesurées. Le prix configuré est une borne de réservation, pas un coût observé.

Suivre [DEMO-AGENTIQUE](DEMO-AGENTIQUE.md) pour la clé ignorée par Git, le service privé et les plafonds run/session/mois. Recette restante : principal, évolution après ingestion, pause, contradiction ou insuffisance, opposition. Pour le principal : appels modèle/outils, références, publication serveur et décision humaine ; pour l'évolution : changement matériel des sources et de la prochaine étape.

La revue humaine de pertinence, la résistance sémantique à l'injection, la justification offre/besoin et la prudence face aux contradictions sont à évaluer selon [SCENARIOS-AGENTIQUES](SCENARIOS-AGENTIQUES.md). Les contrôles d'accès et de références ne prouvent pas à eux seuls le sens d'une affirmation. Aucun verdict humain ni pourcentage de confiance inventé. UL-008, UL-009 réel et UL-012c restent ouverts.
