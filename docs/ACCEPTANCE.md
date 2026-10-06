# Recette et preuves

## Tranche hors ligne M0

| Critère | Vérification | Résultat de fondation |
| --- | --- | --- |
| Faits CRM → proposition sans question | npm test, npm run demo | Vérifié |
| Source/version/date/règle expliquées | Tests métier et sortie démo | Vérifié |
| Filtrage tenant et rôle interne | Tests A/B/viewer | Vérifié dans le kernel seulement |
| Replay sans doublon | Ingestion/génération et retry de décision | Vérifié dans le kernel |
| Concurrence, expiration, preuve changée | Tests de décision | Vérifié dans le kernel |
| Audit attribué et sans corps brut | Tests projection/audit | Vérifié en mémoire |
| Exécution externe absente | Code et démo | Vérifié ; aucune méthode d'exécution |
| Typage strict, auth, durabilité | Nécessitent composants supplémentaires | Non implémentés |

Cette recette ne démontre ni isolation PostgreSQL/RLS, ni authentification, ni fiabilité d'un job réel.

## Parcours SaaS à démontrer avant alpha

1. Deux entreprises, memberships et permissions différentes. Connexion identifiée, tenant falsifié refusé, ressource de l'autre entreprise invisible.
2. Source autorisée : synchronisation initiale, pagination et alimentation suivante sans action utilisateur.
3. Nouvelle donnée → proposition avec source/date/versions, sans ouvrir un chatbot.
4. Priorisation compréhensible et limitation des doublons.
5. Preuve ouvrable seulement pour les utilisateurs autorisés.
6. Modification source avant validation → approbation bloquée ou nouvelle révision.
7. Approbation/rejet durable, acteur et date, retry identique, concurrence explicite.
8. Révocation connexion/membership → arrêt d'accès, jobs et restitution concernés.
9. Redémarrage/crash → reprise checkpoint/outbox sans double décision.
10. Sauvegarde puis restauration vérifiées sur environnement de test.
11. Panne source/modèle/worker → statut visible, alerte et procédure de reprise.
12. Donnée contenant une injection de prompt → aucune modification de permission ni action.
13. Coût/usage et fraîcheur réellement observés ; budgets plafonnés.
14. Parcours clavier, mobile et conflits API testés dans l'interface.
15. Un pilote réel annoté confirme l'utilité des propositions, avec limites documentées.

## Mesure du pilote

Définir avant expérimentation : cas inclus, volume, utilisateurs, période, sources, droits, cadence et critères de succès. Étiquettes suggérées : utile, correcte mais non actionnable, doublon, obsolète, non fondée, hors périmètre.

Mesurer précision des propositions utiles, couverture sur cas éligibles annotés, motifs d'abstention/rejet, délai observation→proposition, décisions prises et coût par analyse. Les seuils et la taille du panel restent à décider avec le responsable du pilote. Un gain de temps doit être mesuré avant/après sur une tâche comparable ; pas extrapolé depuis la démo.

## Gate alpha

Toutes les exigences pertinentes du périmètre pilote disposent d'une preuve au commit testé. Tests critiques verts dans l'infrastructure cible ; revue droits/provenance/révocation ; limites connues ; responsable du pilote ; restauration et runbook. Une check CI verte sur M0 ne remplit pas ce gate.
