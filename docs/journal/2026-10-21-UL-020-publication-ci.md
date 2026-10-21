# UL-020 — publication et recette CI

Thomas autorise explicitement la publication et demande la procédure pour mettre à jour la démo. Branche `codex/ul-020-web-research`, [PR draft #8](https://github.com/TFourniax/ulysse-ithaque-saas/pull/8) vers UL-019; aucune fusion ni opération sur le VPS.

Publication initiale : `44470d02b77d3f1e0dbb9c7551913a39db2a52e3`, dont l’arbre `11d1c1ae85196ba555011e023cc95d91f0b18a8a` correspond exactement au commit local vérifié `fddc6fc`. Le connecteur GitHub a publié ce contenu car le terminal ne dispose pas d’identifiants Git d’écriture.

La [première CI](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/39518766780) applique la migration 0014. Contrôles statiques et unitaires Linux/Windows verts; stack applicative, redémarrage et sauvegarde/restauration verts. Les tests PostgreSQL signalent deux corrections nécessaires : le rôle definer ne peut pas verrouiller les campagnes dans `reserve_research_call`, et le test exhaustif des ACL doit inclure cette nouvelle fonction worker. Les autres tests API et worker historiques passent.

Correction : migration additive 0015 accordant seulement `UPDATE(id)` au rôle NOLOGIN definer, contrôle ACL complété. Aucune réécriture de migration appliquée. Le filtre de branches de la recette Hermes est étendu à la base UL-019, pour exécuter aussi la boucle réelle simulée et les scénarios de mise à niveau. Les messages de déploiement indiquent le modèle européen effectivement conservé sans annoncer systématiquement GLM après un changement de profil autorisé.

Vérifications locales avant publication du correctif : `npm run verify`, `python3 scripts/test-vps-europe.py`, `bash -n scripts/ulysse-vps-europe.sh`. Recette CI corrigée et résultat final à consigner après exécution. L’accès réel Brave, la collecte Paitite et sa qualité métier restent à vérifier après activation de la démo; aucune clé n’est publiée.
