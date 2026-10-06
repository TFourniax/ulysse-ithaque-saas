# Questions et arbitrages ouverts

Mis à jour : 2026-10-06. Aucune question ci-dessous ne bloque la démonstration fictive ; plusieurs bloquent le pilote (voir [PILOT](PILOT.md)). Les décisions métier appartiennent au responsable produit ; un choix technique par défaut est une proposition révisable, pas un accord contractuel. **Aucune de ces questions n'a reçu de réponse à ce jour.**

| ID | Question | Proposition de départ | Effet de l'absence de réponse |
| --- | --- | --- | --- |
| Q-001 | Quel premier utilisateur, processus et signal commercial mesurer ? | Un portefeuille CRM et décisions de prochaine étape | Empêche la recette de valeur réelle |
| Q-002 | Quelle première source réelle et quel accès ? | Source qui fournit les opportunités et interactions nécessaires | Empêche UL-008, pas les fixtures |
| Q-003 | Quel contrat expose Stratégie ? | API versionnée, tenant, auth, pagination et timestamps | Aucun adaptateur réel supposé |
| Q-004 | Quelle doctrine initiale et quels droits d'usage ? | Quelques règles validées et exemples annotés privés | Les règles restent fictives |
| Q-005 | Quelle fraîcheur par usage ? | Hypothèses de démo : 24 h max ; à valider | Pas de SLA de production annoncé |
| Q-006 | Qui voit quelles sources/dossiers dans une entreprise ? | Owner/reviewer/viewer puis ACL objets explicites | Les données privées par rôle ne doivent pas être chargées sans mapping |
| Q-007 | Quel fournisseur d'identité de production ? | OIDC portable ; Keycloak pour développement | Aucun compte client créé |
| Q-008 | Quelle région/hébergement et quels traitements modèles ? | Infrastructure européenne, budget et fournisseur configurable | Pas de données réelles envoyées |
| Q-009 | Quelle action externe future, si nécessaire ? | V1 sans écriture ; lot distinct après approbation précise | Aucun envoi/publication |
| Q-010 | Qui valide le pilote et ses critères ? | Revue de recommandations annotées + parcours humain | Pas de qualification alpha réelle |
| Q-011 | Quels droits code/doctrine et quelle licence de dépôt ? | Aucun choix de redistribution implicite | Ne pas ajouter MIT/Apache arbitrairement |
| Q-012 | Quel est le contenu exact du cahier joint ? | Relecture et diff des exigences dès disponibilité | UL-013 reste blocked |
| Q-013 | Sauvegardes et rétention : fréquence, durée, stockage hors site, RPO/RTO ; conservation des propositions, décisions, audit et usages modèle, y compris après révocation d'une connexion | Sauvegarde quotidienne chiffrée, 30 jours, copie hors serveur, exercice mensuel ; durées de conservation à fixer avec la protection des données | Pas d'engagement de reprise ; seules les purges automatiques documentées s'appliquent (OPERATIONS §11) |

## Enregistrer une décision

Pour chaque réponse : date, décideur, source de la décision, périmètre, option retenue, conséquence, ADR/tâches modifiées. Conserver les propositions antérieures si elles expliquent le choix, sans les maintenir comme décisions actives.

Aucun prix, répartition commerciale, engagement de maintenance, statut de paiement ou contrat de pilote n'est attesté par le code de ce dépôt.
