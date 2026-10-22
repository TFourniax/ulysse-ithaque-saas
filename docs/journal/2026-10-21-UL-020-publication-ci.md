# UL-020 — publication et recette CI

Thomas autorise explicitement la publication et demande la procédure pour mettre à jour la démo. Branche `codex/ul-020-web-research`, [PR draft #8](https://github.com/TFourniax/ulysse-ithaque-saas/pull/8) vers UL-019; aucune fusion ni opération sur le VPS.

Publication initiale : `44470d02b77d3f1e0dbb9c7551913a39db2a52e3`, dont l’arbre `11d1c1ae85196ba555011e023cc95d91f0b18a8a` correspond exactement au commit local vérifié `fddc6fc`. Le connecteur GitHub a publié ce contenu car le terminal ne dispose pas d’identifiants Git d’écriture.

La [première CI](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/39518766780) applique la migration 0014. Contrôles statiques et unitaires Linux/Windows verts; stack applicative, redémarrage et sauvegarde/restauration verts. Les tests PostgreSQL signalent deux corrections nécessaires : le rôle definer ne peut pas verrouiller les campagnes dans `reserve_research_call`, et le test exhaustif des ACL doit inclure cette nouvelle fonction worker. Les autres tests API et worker historiques passent.

Correction : migration additive 0015 accordant seulement `UPDATE(id)` au rôle NOLOGIN definer, contrôle ACL complété. Aucune réécriture de migration appliquée. Le filtre de branches de la recette Hermes est étendu à la base UL-019, pour exécuter aussi la boucle réelle simulée et les scénarios de mise à niveau. Les messages de déploiement indiquent le modèle européen effectivement conservé sans annoncer systématiquement GLM après un changement de profil autorisé.

Vérifications locales avant publication du correctif : `npm run verify` (111 tests unitaires), `python3 scripts/test-vps-europe.py` (9/9), `bash -n scripts/ulysse-vps-europe.sh` et `git diff --check` verts.

## Résultats du code à déployer

Révision exacte : `375bfe5d28e849f7392d05210a263a1603081383`. [CI applicative](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/39519287123) : **5/5**; [Hermes et mises à niveau](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/39519287261) : **6/6**. Tous les jobs sont terminés avec succès, y compris les stacks neuves et les mises à niveau depuis UL-016.

| Contrôle | Preuve |
| --- | --- |
| Statique et unitaire Linux/Windows | Format, lint typé, tsc, cycles, OpenAPI, documentation et 111 tests unitaires verts |
| PostgreSQL réel | 16 migrations appliquées, dont 0014 et 0015; 50/50 tests, ACL exhaustives et rôles d’exécution |
| API et worker réels | 18/18 API, 36/36 worker; quatre scénarios de recherche persistante supplémentaires |
| Navigateur et Keycloak | 15 parcours verts, dont autorisation et persistance de campagne; accessibilité et mobile |
| Stack applicative | Démarrage, redémarrage, sessions, données et restauration de sauvegarde chiffrée |
| Hermes épinglé | Boucle réelle contre modèle scripté; stacks fraîches et mises à niveau, historique préservé |

Les scénarios worker vérifient la découverte de dix domaines sans import manuel, plus de huit pages effectivement lues, le dédoublonnage et la poursuite après une lecture en échec. Ils couvrent aussi la reprise sans double publication, la conservation des coûts incertains, l’annulation en vol, l’isolation tenant et viewer, le déclenchement/réemploi automatique avant diagnostic, le blocage de validation sur des preuves provisoires et la régénération après revue versionnée.

La procédure [RESEARCH-OPERATIONS](../RESEARCH-OPERATIONS.md) épingle cette révision de code. Elle inclut une saisie masquée de la clé dans le terminal du VPS et l’activation du worker. Les changements de documentation postérieurs ne changent pas le code testé. Aucun déploiement VPS ni appel réel Brave/GLM n’a été exécuté depuis cet environnement. L’accès réel Brave, la collecte Paitite, le coût/délai observés et la qualité métier restent à vérifier après activation de la démo; aucune clé n’est publiée. DEBT-024 reste partielle pour cette recette, DEBT-025/026 restent ouvertes pour les limites produit décrites.
