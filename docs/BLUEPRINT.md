# Blueprint technique Ulysse

## Extension UL-016 — analyse proactive par agent

[ADR-0012](adr/0012-hermes-analyse-agentique.md) étend explicitement ADR-0009 : Hermes choisit les lectures autorisées, rapproche sources, contexte et doctrine, et propose une prochaine action. Le modèle n'est plus limité à reformuler un signal détecté par règles. Le mode historique reste disponible.

Web → API pour identité/permissions/lectures/décisions ; PostgreSQL pour état canonique, versions, runs, audit et usages ; worker pour ingestion, jobs/reprise, réservations et publication ; Hermes privé pour la boucle ; plugin/adaptateur Ulysse pour les sept outils et le contrat fermé. Le domaine ne dépend pas d'Hermes, Python, Fastify ou d'un fournisseur. Le navigateur ne contacte aucun de ces services d'inférence.

Une capacité opaque expirante fixe tenant/sujet côté serveur. Chaque lecture et chaque publication recontrôlent permissions, sources actives, versions et fraîcheur. Les appels modèle sont hors transaction PostgreSQL et transitent par une passerelle financière. Les registres/plugins/caches d'Hermes sont isolés par processus et ses fichiers temporaires supprimés ; PostgreSQL demeure l'unique base métier.

Modes : `rules`, `simulated`, `hermes-live`. Activation live explicite, aucune configuration absente ne lance un appel payant, aucune double publication par les règles en mode agentique, aucun repli invisible. Sources et doctrine de ce lot entièrement fictives. Voir [scénarios](SCENARIOS-AGENTIQUES.md) et [validation](VALIDATION-UL-016.md).

Statut : architecture cible proposée pour démarrer le développement ; composants livrés décrits dans STATUS. Référence produit : PRODUCT. Les interfaces externes non documentées restent des contrats à obtenir. Aucune intégration partenaire n'est supposée fonctionnelle.

## 1. Architecture et responsabilités

Un monorepo, un domaine métier modulaire et trois applications : web, API et worker. Le worker s'exécute séparément de l'API pour que les synchronisations et analyses ne bloquent pas les interactions. Les modules restent dans le même dépôt ; pas de microservices par cas d'usage.

| Couche | Choix cible | Rôle |
| --- | --- | --- |
| Runtime | Node.js 24 LTS | API, worker, outils et tests |
| Langage | TypeScript strict, ESM | Contrats partagés, logique métier |
| Gestion de dépendances | npm workspaces, lockfile versionné | Installation reproductible |
| Web | React + Vite, TanStack Query, composants accessibles | File de recommandations, détails, décisions et connexions |
| Validation | Zod aux frontières, OpenAPI | Entrées externes validées, API documentée |
| API | Fastify, Pino | Endpoints métier, authentification, contrôle d'accès |
| Identité | OIDC ; Keycloak comme référence de développement | Connexion, sessions, révocation, MFA de production |
| Données | PostgreSQL 18 | Modèle métier, audit, idempotence, outbox |
| Jobs | pg-boss sur PostgreSQL | Planification, reprise, quotas et tâches asynchrones |
| Recherche | PostgreSQL full-text ; pgvector si le besoin d'embeddings est démontré | Retrieval filtré par tenant et ACL |
| Fichiers | Stockage compatible S3, bucket privé | Sources et extraits volumineux |
| Modèles | Interface fournisseur ; adaptateur OpenRouter optionnel | Extraction/rédaction structurée ; règles gardent l'autorité |
| Observabilité | Pino, OpenTelemetry, métriques et alertes | Diagnostic, fraîcheur, coûts, latences et erreurs |
| Tests | node:test au départ ; tsc, tests d'intégration, Playwright ensuite | Invariants, DB/API/jobs, parcours utilisateur |
| Déploiement | Docker Compose, proxy TLS, services privés | Développement local puis environnement européen à choisir |

Les versions exactes de packages doivent être vérifiées et verrouillées lors de leur première installation. La fondation n'a pas installé ni testé ces bibliothèques. Éviter la DB supplémentaire, un broker Redis et une base vectorielle séparée avant justification par une mesure.

### Schéma cible

~~~mermaid
flowchart TD
  S["Sources autorisées"] --> C["Connecteurs et worker"]
  C --> D["Faits et provenance"]
  K["Doctrine et contexte versionnés"] --> R["Règles et analyse"]
  D --> R
  R --> P["Propositions justifiées"]
  P --> A["API avec contrôle des droits"]
  A --> W["Tableau de bord et décision"]
  W --> A
  A --> J["Historique et audit"]
~~~

Le stockage de faits, les propositions et l'audit sont des modules PostgreSQL, pas nécessairement des services indépendants.

## 2. Arborescence cible

- apps/web : routes, interface, état de navigation, API client généré, accessibilité.
- apps/api : assemblage Fastify, sessions, authorizers, limites de taille, OpenAPI.
- apps/worker : jobs, planificateur, renouvellement des autorisations et pipeline.
- packages/domain : entités, politiques et transitions pures ou ports de stockage.
- packages/contracts : schémas versionnés d'entrée/sortie, erreurs, événements.
- packages/database : migrations, dépôts, unités de travail, contexte RLS.
- packages/connectors : protocole, adaptateurs, fixtures et tests de contrat.
- packages/ai : client fournisseur, prompts versionnés, schémas, budgets, évaluation.
- packages/observability : corrélation, champs de logs autorisés, mesures.
- infra : Compose, exemples d'environnement sans secret et procédures.
- docs : produit, architecture, ADR, API/données, sécurité, opérations et journal.

Domaine → contrats métier ; adaptateurs → domaine ; applications → adaptateurs.
Le domaine n'importe jamais Fastify, React, pg-boss ni un SDK de modèle.
Aucun appel modèle depuis le navigateur. Aucune bibliothèque d'interface dans le worker.

## 3. Modèle de données

Voir DATA-API pour les tables et contraintes. Tous les objets clients portent tenant_id, identifiant stable, version et dates UTC. Les relations utilisent des clés composites tenant_id/id pour éviter une référence inter-entreprises accidentelle. Les comptes utilisateurs et appartenances déterminent les droits ; le tenant d'une requête n'est jamais une preuve d'appartenance.

Sources brutes privées et minimisées ; faits normalisés destinés au domaine. Conserver la distinction source_modified_at, observed_at, ingested_at et analyzed_at. Une correction produit une nouvelle version et invalide les propositions affectées. La rétention et la suppression doivent couvrir les pièces, chunks, embeddings, caches et backups selon les politiques retenues.

La doctrine porte scope (commun licencié ou propre à l'entreprise), version, statut draft/validated/retired, origine, droits d'usage, auteur et date de validation. Une doctrine globale n'est lisible que si elle a explicitement été publiée pour cet usage. Le contexte et les observations d'un client ne deviennent jamais une doctrine globale par apprentissage implicite.

## 4. Connecteurs et pipeline

Contrat commun : capabilities, authorize, validateConnection, pullPage(cursor), normalize, revoke.
Le contrat d'un fournisseur décrit séparément pagination, quotas, versions/ETag, suppressions, backfill, reprises et événements. Chaque connexion appartient à une entreprise ; les scopes réels sont visibles.

Pipeline :
1. Job limité au tenant et à la connexion, avec clé de déduplication.
2. Vérification connexion active, permission et scope avant lecture.
3. Lecture paginée ; retry borné avec backoff/jitter pour timeout/429/5xx.
4. Normalisation et validation. Rejet/quarantaine traçable sans fuite du payload.
5. Upsert de version de source et de faits, événement outbox dans la même transaction.
6. Avancement du checkpoint après persistance ; rejouer une page ne double pas les faits.
7. Analyse déclenchée par événements ou cadence ; coalescer les changements d'un même dossier.
8. Publication seulement après contrôle des preuves et de la politique.
9. Actualisation de last_success_at et de la fraîcheur ; afficher une erreur actionnable en cas d'échec.

Sémantique pratique : livraison au moins une fois, consommation idempotente. Les garanties éventuelles de pg-boss ne suffisent pas à promettre exactement une exécution d'un effet externe. Tests de crash avant/après commit et checkpoint obligatoires.

L'API de Stratégie est un contrat externe à obtenir : auth, endpoints, entités, pagination, fraîcheur, droits et propriétaire. Son MongoDB éventuel reste derrière son API ; aucune connexion directe présumée. Un adaptateur fictif ne doit pas être présenté comme cette intégration. Les dépendances au fournisseur historique restent explicites, sans rôle de développement supposé.

Commencer par un connecteur fixture pour deux entreprises. Puis implémenter une source réelle de pilote quand son accès et son contrat existent. Gmail/Microsoft/CRM/Pennylane sont des possibilités ; ne pas créer quatre intégrations pour combler une information absente.

## 5. Génération et explications

Séparer détection d'un signal et formulation de la proposition.

Détection déterministe initiale : règles versionnées, politique configurable, fenêtres de fraîcheur, suppression des doublons, fermeture ou changement de dossier, limite de volume et priorité explicable.

Formulation facultative par modèle : faits déjà autorisés, doctrine validée, contexte minimisé, schéma de sortie fermé. Le modèle retourne type, justification, références, hypothèses, données manquantes, brouillon et limites. Il ne reçoit aucun outil d'écriture ou secret de connecteur.

Avant publication :
- Sources citées existantes et accessibles, versions/dates cohérentes.
- Aucun fait essentiel sans support.
- Aucun mélange d'entreprise ni de permission.
- Données assez fraîches pour l'usage.
- Règle et doctrine applicables et versionnées.
- Budget, délai, volume et schéma de sortie respectés.
- Abstention ou signal de données insuffisantes si ces conditions échouent.

L'explanation enregistrée est une justification factuelle adaptée à l'utilisateur, pas une chaîne de pensée interne. Ne pas fabriquer une confiance statistique. Le score initial est un score de priorité selon une formule affichable ; ajouter un score calibré seulement après évaluation.

Fingerprint cible : tenant + sujet + type de signal + version de règle/doctrine + faits matériels. Une simple synchronisation de métadonnées ne doit pas reposter le même signal. Les suggestions supplantées restent liées à leur remplaçante. La suppression/rejet humain dispose d'une durée et d'une raison définies avant régénération.

## 6. Validation humaine et action

V1 : pending → approved ou rejected. L'API accepte expected_revision et Idempotency-Key. Une transaction compare la version, vérifie droit et fraîcheur, écrit décision et audit. Deux utilisateurs concurrents : une décision gagne ; l'autre reçoit un conflit.

Évolution cible : draft, pending, approved, rejected, expired, superseded. Modification matérielle du brouillon = nouvelle révision à réapprouver. Expiration ou changement de source invalide la proposition. Révocation d'accès invalide la possibilité de consulter ou approuver les informations concernées.

Aucune exécution externe dans cette V1. Une future capacité d'envoi devra être un lot séparé : manifeste d'action avec destinataire, contenu et hash exacts ; approbation liée à ce manifeste ; revalidation finale ; identifiant externe ; traitement des statuts incertains ; pas de retry aveugle d'un envoi. Un statut approved d'Ulysse ne suffit pas à autoriser un envoi ultérieur.

## 7. Interface

Navigation : Recommandations, Opportunités/Contexte, Connexions, Historique, Administration.
Accueil : propositions priorisées, statut, âge des données, source et motif.
Détail : résumé, faits et références ouvrables sous contrôle de droits, hypothèses, manque de données, raison de priorité, options et historique.

États requis : première synchronisation, absence de signal, sources absentes, fraîcheur insuffisante, service modèle indisponible, permission insuffisante, conflit de version, proposition obsolète. Ne jamais afficher un écran vide qui masque une erreur.

Décisions : boutons clairs, navigation clavier, état désactivé expliqué, feedback de conflit, rejet avec raison facultative. Un brouillon est modifiable mais doit conserver la provenance et les revisions. Pas de chat indispensable au parcours. Pas de compteur de ROI fondé sur des hypothèses déguisées en résultats.

## 8. Sécurité, opérations et qualité

Voir SECURITY, ACCEPTANCE et CONTRIBUTING. Tous les composants doivent propager un tenant vérifié. La recherche vectorielle applique tenant/ACL avant et après retrieval. Les ACL et tombstones sont revalidés au moment de la restitution.

DB : compte applicatif non propriétaire, sans BYPASSRLS ; RLS avec USING et WITH CHECK ; FORCE quand pertinent ; SET LOCAL tenant dans une transaction puis libération du pool. La RLS ne remplace ni l'authentification ni les droits métier.

Exploitation : readiness/liveness distinctes, migration contrôlée, rotation secrets, arrêt gracieux worker, retries plafonnés, dead-letter et replay autorisé, dashboard de jobs, sauvegarde chiffrée et restauration prouvée. Aucun endpoint admin ouvert publiquement. Installer des alertes sur erreurs, backlog, fraîcheur et coûts.

## 9. Roadmap sans promesse de calendrier

- M0 : fondation documentée et tranche métier fictive. État présent.
- M1 : strict typing, API/identité, schéma PostgreSQL/RLS et décisions durables.
- M2 : worker et fixture planifiée, reprise/checkpoint/outbox ; UI utile de bout en bout.
- M3 : une source réelle autorisée et une doctrine initiale validée ; qualité et droits.
- M4 : analyse assistée par modèle si elle apporte une valeur mesurée ; budget et évaluation.
- M5 : pilote mesurable, exploitation, restauration, audit et critères d'alpha.

Les lots sont détaillés dans BACKLOG avec dépendances et preuves. Pas de dates client ni de promesse de production sans validation sur données et infrastructure réelles.

## 10. Sources techniques consultées le 6 octobre 2026

- Node LTS : https://nodejs.org/en/about/previous-releases
- Exécution TypeScript native : https://nodejs.org/api/typescript.html
- Vite : https://vite.dev/guide/
- Fastify : https://fastify.dev/docs/latest/Reference/LTS/
- PostgreSQL RLS : https://www.postgresql.org/docs/current/ddl-rowsecurity.html
- PostgreSQL sélection/verrouillage : https://www.postgresql.org/docs/current/sql-select.html
- pg-boss : https://github.com/timgit/pg-boss
- OIDC Keycloak : https://www.keycloak.org/securing-apps/oidc-layers
- Sorties structurées OpenRouter : https://openrouter.ai/docs/guides/features/structured-outputs

Ces documentations fondent les choix proposés. Elles ne prouvent pas que les composants sont installés ni leur compatibilité de bout en bout ; la première installation doit vérifier ces points.

Contrats d'exécution, outils, résultats, progression et usages : [AGENT-CONTRACT](AGENT-CONTRACT.md).
