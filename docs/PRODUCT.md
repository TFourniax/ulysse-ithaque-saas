# Produit : exigences de référence

Établi le 6 octobre 2026 à partir du cadrage utilisateur confirmé. La pièce jointe fournie à l'ouverture n'a pas pu être lue. Ce document n'atteste donc pas sa conformité intégrale ; une réconciliation du document est inscrite au backlog. Les détails d'implémentation sont des propositions techniques.

## Objectif

Donner spontanément aux équipes commerciales et au dirigeant une liste courte de décisions possibles, fondées sur les données autorisées et le contexte de leur entreprise. Ulysse croise données commerciales, contexte d'entreprise et doctrine métier versionnée. Il explique les faits, les hypothèses et la raison du signal, puis demande une décision humaine.

Le premier périmètre est commercial/Biz Dev. Le produit doit être utile avec des données CRM suffisantes, même sans toutes les couches de l'écosystème d'origine.

## Exigences et recette

| ID | Exigence | Preuve attendue |
| --- | --- | --- |
| REQ-001 | Valeur sans saisie d'une question quotidienne | Nouveau signal après une ingestion planifiée ou événementielle |
| REQ-002 | Connexions autorisées et alimentation en arrière-plan | Connexion, synchronisation, état de fraîcheur, révocation et reprise |
| REQ-003 | Recommandations contextualisées et priorisées | Liste limitée, raison, opportunité concernée, prochaine décision possible |
| REQ-004 | Justification traçable | Faits cités avec source/version/dates et doctrine utilisée |
| REQ-005 | Humain décide avant action | Approuver/rejeter/modifier, identité, contrôle de concurrence, historique |
| REQ-006 | Cloisonnement par entreprise et par permission | Tests API/DB/jobs/retrieval/stockage avec deux entreprises |
| REQ-007 | Gestion honnête des inconnues et données périmées | Avertissement, abstention, revalidation après changement |
| REQ-008 | Extensibilité des sources sans couplage métier | Contrat connecteur commun et tests de contrat |
| REQ-009 | Suivi et reprise par différents contributeurs | Backlog, ADR, journal, preuve et procédure d'exécution |
| REQ-010 | Fonctionnement sans dépendance à toutes les briques partenaires | Parcours fictif autonome puis pilote avec une source suffisante |
| REQ-011 | Exploitation observable et maîtrisée | Jobs, erreurs, coûts, alertes, sauvegarde/restauration vérifiées |
| REQ-012 | Mesure de valeur du pilote | Panel de recommandations annotées et mesures observées, pas ROI inventé |

## Parcours V1

1. Un administrateur crée l'entreprise, invite ses utilisateurs et configure les accès.
2. Il autorise une source et définit les données accessibles. Ulysse affiche scopes et fréquence visée.
3. Une synchronisation initiale établit faits et fraîcheur ; les suivantes s'exécutent en arrière-plan.
4. L'analyse détecte un signal commercial utile et publie une proposition.
5. L'utilisateur voit priorité, faits, source, date d'observation, raison, hypothèses et conséquence attendue.
6. Il approuve ou rejette ; la modification d'un brouillon crée une nouvelle révision à valider.
7. L'historique attribue la décision. La V1 de référence ne réalise aucune écriture externe.
8. Une nouvelle donnée rend une proposition obsolète si nécessaire ; une décision ancienne ne suffit jamais à autoriser une nouvelle action.

## Premiers cas à valider

- Opportunité ouverte sans prochaine étape et sans interaction récente.
- Prochaine étape commerciale échue.
- Demande client qui appelle une prise en charge humaine, si une boîte mail autorisée est disponible.
- Risque commercial signalé par une contradiction ou un manque de données, sans inventer un chiffre d'affaires ou une probabilité.

La règle « sept jours sans interaction » du code est une fixture technique configurable, **pas** une règle de doctrine validée. D'autres cas ne deviennent pas inclus par simple présence dans cette liste.

## Hors périmètre initial

Autonomie d'envoi, publications sociales, décisions financières/RH, agents salariés, web scraping général, enregistrement live de réunion, place de marché d'agents, modèles entraînés par client, déploiements on-prem spécifiques et facturation automatique. Ces pistes restent possibles après arbitrage explicite et preuve de valeur de la V1.

## Limites et responsabilité

Une recommandation est une aide à décider. Distinguer fait source, inférence et hypothèse ; ne pas afficher une « confiance 93 % » sans calibration. Présenter les données manquantes. Ne promettre ni leads, ni conversion, ni temps réel universel. La fraîcheur est déterminée par usage et par connecteur.

Les rôles, données et écrans doivent être adaptés au pilote. Le périmètre payé, la propriété intellectuelle, les prix et les responsabilités commerciales ne sont pas définis par ce dépôt.
