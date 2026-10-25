# ADR-0019 — Raccorder les fichiers CRM à la préparation agentique

Date : 25 octobre 2026. Statut : accepté dans le périmètre MVP autorisé par Thomas. Responsable : Codex.

## Problème

L’import applique les affaires et émet déjà `source.changed`, mais `AgentRuntime.current()` n’autorise que `fixture-crm` et une doctrine fictive. Le refus survient avant création du run. Le tableau de propositions utilise encore les anciens bilans du moteur de règles et peut laisser penser qu’une analyse suit l’import. Les recettes d’import précédentes ne traversaient pas la boucle agentique.

## Décision

Conserver le chemin import → outbox → worker → Hermes → publication avec validation humaine. Autoriser explicitement les connexions `crm-file` actives et les doctrines validées dont les droits permettent l’analyse. Ne pas élargir à des connecteurs inconnus. Garder la relecture de la connexion sous verrou, les contrôles de fraîcheur et de versions à chaque outil et à la publication. La doctrine reste immuable et séparée des données CRM; aucun texte du fichier ne devient une instruction ou un droit.

Le moteur reçoit l’origine et le caractère fictif de la doctrine. Un document issu du CSV peut constituer une source commerciale consultée même en l’absence d’activité structurée. Le mode simulé doit refléter ce cas. Une date de dépôt ne prouve pas une interaction récente et une correction d’import n’est pas une confirmation du client.

Un refus connu avant exécution (doctrine manquante/inutilisable, source périmée/non prise en charge) est enregistré comme abstention avec un motif explicite. Les versions, identifiants et codes sont conservés, pas le contenu CRM. Aucun appel ni réservation fournisseur. Une empreinte dédiée déduplique ces traces sans bloquer la reprise après correction. Une source révoquée ne recrée pas de trace; le circuit existant de retrait reste appliqué. Les erreurs inconnues continuent à remonter aux mécanismes de reprise du job.

Les propositions affichent l’état des runs de leur moteur actif : attente, exécution, blocage ou échec. La date d’un ancien bilan de règles ne vaut plus preuve d’analyse agentique. Les détails techniques restent accessibles sur la page Analyses. Les listes portent sur les dernières exécutions affichées, pas sur une garantie d’analyse exhaustive de toutes les affaires.

## Temps et lots

Une affaire reçoit un bail de cinq minutes et un appel fournisseur de 90 secondes maximum. Le serveur Hermes applique le même plafond aux trois parcours. Le job a un bail de dix minutes : ne plus commencer de tentative après quatre minutes, douze nouvelles tentatives au plus. Les entrées déjà traitées ne consomment pas ce quota. La maintenance périodique reprend les affaires restantes sans réimport et les empreintes existantes empêchent les doublons. Aucun objectif de latence commerciale ni seuil CI de performance ajouté.

## Preuves et limites

Tests PostgreSQL : documents CSV cités, doctrine d’entreprise validée, blocage sans doctrine puis reprise sans réimport, déduplication, isolation, révocation, treizième affaire et source périmée indépendante. Recette navigateur sur stack réelle : dépôt/confirmation, outbox, moteur actif, proposition à relire avec preuve documentaire. Les lanes Hermes conservent les fournisseurs scriptés Anthropic/OpenRouter. Tests UI des états et vérifications mobiles/accessibilité.

Ces preuves techniques ne valident pas la pertinence commerciale d’une proposition live. La doctrine Denis protégée, la corrélation CRM dans les autres parcours et le suivi effectué/reporté/écarté restent des lots distincts. Aucune migration historique, clé, dépense plafond ou validation humaine n’est modifiée.

## Complément — jugement, provenance et réexécution (DEBT-045)

Hermes reste responsable de l’interprétation commerciale : une différence de rôles ou de dates n’est pas une contradiction par elle-même. Les instructions distinguent opposition/pause, clarification nécessaire et vérification secondaire. Une offre absente du contexte reste non documentée; aucune capacité, aucun prix ou engagement n’est inventé. Le travail préparé doit aider la progression du client, même lorsque certains champs restent à clarifier. Les documents et notes sont consultés avant de conclure à une absence d’échanges. Aucun moteur de jugement parallèle ajouté.

`get_opportunity` fournit des références `field:<opportunity>:<type>:r<revision>` pour les faits normalisés, y compris leur état absent/indisponible. Elles sont enregistrées dans les références réellement consultées, puis résolues exclusivement vers les faits courants de cette affaire lors de la publication. La preuve affiche la valeur du champ cité plutôt que le seul nom de l’affaire. Les sources documentaires gardent leurs références actuelles. Permissions, isolation, versions, pauses et validation humaine inchangées.

L’empreinte d’exécution inclut désormais le SHA des instructions. L’empreinte métier reste inchangée : une mise à jour du texte peut renouveler les propositions en attente mais ne doit pas recréer celles déjà approuvées ou rejetées, ni remplacer une rédaction humaine. Une proposition en attente remplacée sans changement des faits est close avec le motif `replaced`. La maintenance existante réanalyse une fois chaque entrée admissible; aucune nouvelle boucle, migration ou réimport. Cela peut entraîner une nouvelle dépense de modèle, dans les enveloppes déjà configurées.

Le score historique fixe 30 reste stocké pour compatibilité, mais les vues liste/détail de cette règle affichent « sans classement chiffré » / « priorité à apprécier ». Les priorités des règles déterministes ne changent pas. Un classement commercial pertinent reste un travail ultérieur. « Données reçues » désigne la réception et ne prétend pas confirmer la vérité des déclarations.

La recette PostgreSQL couvre les citations exactes et leur état, la transmission des rôles/dates distincts, le renouvellement des propositions en attente et la conservation des décisions/révisions humaines. Le smoke CSV vérifie ces citations et l’affichage sans faux score sur la vraie stack avec fournisseurs scriptés. La pertinence sémantique demande une relecture live séparée.
