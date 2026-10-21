# ADR-0013 — Trois parcours de novembre et sources communes

Date : 2026-10-20. Lot : UL-017. Décision produit confirmée par Thomas : la bêta comporte le client synthétique, les contenus contextualisés et la prochaine interaction par affaire.

Le client synthétique simule un acheteur : compréhension de l'offre, bénéfices et preuves, comparaison avec les alternatives documentées, objections, questions et crash test de l'unicité. Une simulation ne prouve ni une demande réelle ni la validation de la valeur par un client. Le verdict d'unicité reste limité au corpus comparé.

Les contenus réutilisent le contexte versionné de l'entreprise, ses sources autorisées, les contenus existants et un diagnostic synthétique identifié. Cible, phase de décision, objectif, offre et canal composent le brief. Les informations manquantes produisent des questions ; aucune rédaction exploitable avant un brief suffisant. Les requêtes observées et les questions simulées restent typées séparément.

Les recommandations par affaire conservent leur pipeline et leur revue humaine. Leur objectif devient explicite : progression attendue du client, action observable, question utile, preuve de réussite et échéance proposée ou convenue. Aucune tâche interne ne vaut validation du client.

Implémentation : nouvelles tables tenant sous RLS forcée pour sources et demandes de parcours ; versionnement optimiste, outbox, worker, capacité Hermes et budget communs. Le schéma existant est étendu par migration additive. Les sorties sont des brouillons soumis à revue et restent reliées aux versions des sources, du contexte et de la doctrine. Une source retirée invalide et efface les sorties dérivées. Les anciens runs par affaire restent compatibles.

Le corpus privé n'est pas copié dans ce dépôt public. L'import des documents autorisés se fait dans l'espace privé de chaque entreprise. L'acquisition initiale du corpus est explicite : textes et URLs documentées ; aucun moteur de recherche ou connecteur de demande consommateur n'est supposé disponible. Les sources renseignées sont vérifiées pour leur fraîcheur, et les limites de couverture sont affichées.

Aucune dépendance de production supplémentaire. La configuration Hermes live explicite et ses plafonds restent applicables ; l'absence de modèle configuré ne doit pas produire un faux diagnostic. Les tests simulés vérifient le circuit ; la pertinence des analyses live nécessite une recette distincte.

## Compatibilité avec la démo existante

La lignée UL-016 `5a7cf27` est intégrée lors de la préparation VPS. Le mode `hermes-stub` et sa migration historique restent disponibles, y compris pour lire les anciens runs. Une migration 0013 additive étend le mode aux nouveaux parcours. Le plugin Hermes sélectionne sept outils pour les affaires, trois pour buyer/content ; la passerelle impose le prompt exact du parcours avant tout appel. Les réservations utilisent la fonction UL-016 séparant les modes simulé et live. Le modèle scripté lit les sources des nouveaux parcours puis s’abstient explicitement ; seule une recette live avec revue humaine évalue leur pertinence.

## Révision UL-020 : format final et correction bornée

Le 21 octobre, un diagnostic lié à la recherche est refusé `result_invalid`. Sans réponse historique conservée, son champ fautif ne peut pas être identifié. Le prompt rappelle désormais les types, champs conditionnels et tailles exactes, avec une synthèse courte adaptée au plafond actif.

La passerelle inspecte les réponses terminales buyer/content, sans traiter les appels d’outils intermédiaires comme des résultats. Elle utilise le schéma partagé `@ulysse/contracts` (dépendance interne 0.1.0 ajoutée au worker, aucun nouveau paquet externe), puis la validation de domaine. Une seule correction du format est permise par run si temps, contexte, nombre d’appels et réservation restants le permettent. Le marqueur atomique persisté empêche une boucle de réparation. La correction repasse par la passerelle habituelle, sans outils; elle ne peut élargir les accès. Le fournisseur, la région, les tokens et les budgets restent inchangés. Un refus fournisseur ne déclenche pas de correction.

## Libération des enveloppes inutilisées — 21 octobre 2026

La comptabilité des parcours buyer/content applique la règle déjà utilisée pour les affaires : chaque transmission réserve sa borne supérieure dans `committed_usd` avant l’appel réseau; l’usage reçu remplace ensuite cette provision. À la fin d’un parcours, y compris en échec, obsolète ou expiré, `reserved_usd` rejoint `committed_usd`. Les transmissions incertaines et encore en vol restent donc couvertes; seule la partie de l’enveloppe qui n’a jamais été engagée est libérée. Une réponse tardive ajuste aussi la réservation d’un run déjà arrêté, sans rouvrir sa capacité ni permettre une publication tardive.

Avant de réserver une nouvelle analyse, le worker corrige sous le contexte du tenant les enveloppes résiduelles de ses anciens parcours buyer/content terminés et clôt les baux expirés. Il ne réduit aucun engagement, compteur ou coût inconnu, ne change ni session ni plafond et ne modifie ni sources ni décisions. Aucun changement de schéma ou migration historique; le verrou budgétaire et le contrôle de concurrence existants restent obligatoires. Le diagnostic opérateur `diagnose-budget` ne fait que lire les montants; une marge session/mois ne prouve pas à elle seule la disponibilité d’un créneau d’exécution.

Les usages des deux appels restent comptés, y compris si le résultat demeure invalide. Les erreurs HTTP de la correction restent visibles. Les contrôles de publication (lectures requises, citations lues, preuves de l’offre et du benchmark, versions et bail) restent obligatoires après correction. Aucune normalisation silencieuse ni preuve inventée n’est acceptée. Le texte invalide et les métadonnées opaques de raisonnement ne sont pas persistés; ils peuvent être retransmis au même modèle pour cette correction. Seuls code fixe, raison de fin bornée, chemins de champs connus et types d’erreur sont conservés dans l’instantané technique existant. Pas de migration.
