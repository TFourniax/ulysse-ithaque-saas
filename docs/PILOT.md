# Fiche de préparation du pilote

Statut : **à remplir par le responsable du pilote** (UL-007, UL-014). Ce document liste ce qui doit être décidé, ce que le logiciel sait déjà faire et ce qui manque. Il ne contient ni contrat, ni prix, ni calendrier, ni engagement : aucun n'a été fourni et aucun ne doit être inventé ici.

## 1. Décisions à prendre (et par qui)

| Sujet | Question | Réf. | Décideur | Réponse datée |
| --- | --- | --- | --- | --- |
| Périmètre | Quels utilisateurs, quel processus commercial, quel signal mesurer en premier ? | Q-001 | responsable produit | à compléter |
| Source | Quelle première source réelle (CRM, Stratégie, autre) ; qui autorise l'accès ; quels champs et quels droits d'usage ? | Q-002, Q-003 | responsable de la source | à compléter |
| Stratégie | Contrat d'API documenté (authentification, entreprise, pagination, horodatages, suppressions) | Q-003 | équipe Stratégie | à compléter — rien n'est présumé |
| Doctrine | Règles Néreis/Odyssée initiales, paramètres, exemples annotés, droits d'usage ; validation par leurs responsables | Q-004, Q-011 | responsables métier de la doctrine | à compléter |
| Visibilité | Qui voit quelles données dans l'entreprise pilote (au-delà des rôles owner/reviewer/viewer) ? | Q-006 | entreprise pilote | à compléter |
| Fraîcheur | Âge maximal acceptable des données par usage (hypothèse de démonstration : 24 h) | Q-005 | responsable produit | à compléter |
| Identité | Fournisseur OIDC de production, comptes pilotes, émetteur et `sub` stables | Q-007 | entreprise pilote / exploitation | à compléter |
| Hébergement | Région, hébergeur, environnement dédié (pas de serveur partagé existant sans inventaire), TLS | Q-008, UL-014 | responsable exploitation | à compléter |
| Modèle | Formulation assistée activée ou non ; fournisseur, modèle, conditions de traitement et de conservation, budget mensuel | Q-008 | responsable produit + protection des données | à compléter (désactivée par défaut) |
| Sauvegardes | Fréquence, rétention, stockage hors site, RPO/RTO, conservation après révocation | Q-013 | responsable exploitation | à compléter |
| Validation | Qui valide le pilote, sur quels critères et à quelle échéance ? | Q-010 | responsable produit | à compléter |
| Cadre | Licence du code et de la doctrine, conditions contractuelles, données personnelles | Q-011, UL-014 | responsables habilités | à compléter |

## 2. Ce qui est prêt (vérifié sur données fictives)

- Parcours complet : synchronisation en arrière-plan → propositions expliquées et sourcées → décision humaine → historique et audit, sans action externe ([ACCEPTANCE](ACCEPTANCE.md)).
- Isolation entre entreprises (RLS forcée, rôles séparés), connexion OIDC côté serveur, révocations effectives à la requête suivante.
- Doctrine et contexte d'entreprise versionnés avec validation par un owner ; abstention explicite quand une donnée manque ou est périmée.
- Exploitation : image, stack Compose, sauvegarde chiffrée et restauration vérifiée, commandes d'administration, runbooks ([OPERATIONS](OPERATIONS.md)).

## 3. Ce qui manque avant un pilote

| Manque | Tâche | Bloquant |
| --- | --- | --- |
| Connecteur de la source réelle choisie, stockage de ses credentials | UL-008, DEBT-011 | oui |
| Doctrine réelle validée (sinon : règles fictives, inutilisables en pilote) | UL-009 | oui |
| Environnement dédié avec TLS, IdP de production, collecte des métriques et alertes, sauvegardes hors site | UL-011b | oui |
| Étiquettes de qualité sur les décisions et rapport de mesure | UL-012b | oui pour mesurer la valeur |
| ACL par source/dossier si toutes les données ne sont pas visibles par tous les membres | DEBT-010 | selon Q-006 |
| Appel réel au modèle vérifié, si la formulation assistée est voulue | UL-010 | non (désactivable) |

## 4. Déroulé proposé (à valider)

1. Remplir la section 1 ; consigner chaque décision dans OPEN-QUESTIONS (date, décideur, source) et l'ADR concernée.
2. Livrer UL-008 sur un compte de test de la source, puis sur le périmètre autorisé du pilote.
3. Charger la doctrine validée ; rejouer le panel d'exemples annotés fourni par ses responsables.
4. Préparer l'environnement (inventaire, TLS, IdP, sauvegardes, exercice de restauration sur place).
5. Provisionner l'entreprise et les comptes (`npm run admin -- admin:tenant|admin:user|admin:member`).
6. Période de pilote : décisions étiquetées, revue hebdomadaire des rejets et abstentions avec l'équipe pilote.
7. Bilan : indicateurs de la section « Mesure du pilote » d'[ACCEPTANCE](ACCEPTANCE.md), limites observées, décision de poursuite par le responsable désigné.

## 5. Données et confidentialité

- Le dépôt public ne reçoit que des données fictives ; les données, la doctrine et les exemples annotés du pilote restent dans des espaces privés autorisés.
- Aucune donnée réelle n'est envoyée à un fournisseur de modèle avant validation des conditions de traitement (Q-008).
- Les journaux ne contiennent ni corps de requête, ni jeton, ni contenu source ; les sauvegardes contiennent des données client et sont chiffrées.
