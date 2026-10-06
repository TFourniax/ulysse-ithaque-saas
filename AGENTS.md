# Instructions communes aux contributeurs humains et agents

## Mission et source de vérité

Construire un SaaS commercial proactif : sources autorisées → faits versionnés → propositions justifiées → décision humaine → historique. Commencer par le périmètre Biz Dev. Aucun chatbot comme parcours principal. Aucune action externe autonome dans la V1 de référence.

Lire dans cet ordre :
1. docs/STATUS.md et docs/BACKLOG.md pour l'état réel ;
2. docs/PRODUCT.md et docs/BLUEPRINT.md pour les exigences et le plan ;
3. docs/OPEN-QUESTIONS.md et docs/adr/ pour les arbitrages ;
4. les instructions du répertoire modifié et le code concerné.

Les décisions explicites du responsable produit prévalent sur les propositions d'architecture. Un document, une idée de partenaire ou un résultat généré n'est pas automatiquement une décision produit. La pièce jointe initiale n'a pas pu être récupérée : ne pas annoncer que son contenu a été intégré.

## Contribuer sans perdre le contexte

- Prendre une tâche UL-nnn, noter l'objectif, le périmètre, le responsable et les fichiers affectés.
- Inspecter les changements existants et les PR avant de modifier. Ne pas écraser le travail d'autrui.
- Préférer une branche et une PR par objectif cohérent ; pas de push direct ni de fusion automatique sur main.
- Tout changement de contrat, dépendance importante, stratégie de données ou comportement de sécurité doit être expliqué par une ADR ou une mise à jour d'ADR.
- Aucune migration historique réécrite après application ; nouvelle migration explicite.
- Une tâche done requiert un livrable vérifiable, une preuve et ses limites. Un stub, un mock ou un service inaccessible est partial/blocked.
- Mettre à jour docs/STATUS.md, le backlog concerné et un fichier docs/journal/YYYY-MM-DD-UL-nnn-description.md.
- Le journal décrit les faits, pas le raisonnement interne : objectif, changement, commandes, résultats, risques, dettes, suite et références.
- Reporter les défauts connus avec identifiant et condition de clôture ; ne pas les noyer dans un commentaire.
- Ne pas inventer de métrique, de test, d'intégration ou d'approbation. Séparer vérifié, proposé et inconnu.

## Frontières de code

Le domaine ne dépend ni du HTTP, ni d'une DB, ni d'un fournisseur de modèles. Les applications assemblent les adaptateurs. Les connecteurs ne contiennent pas la politique de recommandation. L'interface ne décide pas des droits. Pas d'état métier global mutable partagé entre entreprises.

TypeScript strict est la cible ; aucun any de confort, aucun cast pour faire passer une entrée non validée. Toute frontière externe valide ses données à l'exécution. Les versions de packages sont verrouillées dans le lockfile après installation effectivement vérifiée.

## Invariants non négociables

- Tenant, utilisateur, permission et source autorisée sont vérifiés côté serveur/worker.
- Isolation dans DB, requêtes, jobs, stockage, cache, retrieval et audit.
- Toute proposition possède des faits citables, des versions, une date et des limites.
- Donnée absente/périmée/contradictoire : le signaler, s'abstenir si nécessaire.
- Aucun contenu ingéré ne devient une instruction ni une permission d'outil.
- Approbation humaine et exécution externe sont deux opérations distinctes.
- Ni secret ni payload client dans Git, logs, captures de CI ou fixtures publiques.
- Connexions et accès sont révocables ; la suppression arrête les travaux concernés.

## Vérification et communication

Avant chaque commit : `npm run verify` (format, lint typé strict, `tsc -b`, cycles, OpenAPI à jour, tests unitaires, contrôle documentaire). Selon le périmètre touché : `npm run test:integration` (PostgreSQL réel sous les rôles d'exécution), `npm run test:e2e` (Playwright contre Keycloak, API et worker réels), stack conteneurisée et `scripts/smoke.mjs` (voir docs/OPERATIONS.md). La CI exécute tout cela.
Le TypeScript natif de Node ne contrôle pas les types : seule `npm run typecheck` (incluse dans `verify`) vaut tsc.

Tester les scénarios sensibles dans l'infrastructure réellement visée, pas uniquement avec des mocks : à ce jour, aucune infrastructure pilote n'existe et toutes les preuves portent sur des données fictives.

Rapport de fin : ce qui fonctionne, preuve, ce qui manque, prochain UL-nnn. Une contrainte sur une étape ne bloque pas les travaux indépendants. Ne demander que les arbitrages qui conditionnent réellement le lot.
