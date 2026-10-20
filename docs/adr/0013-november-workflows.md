# ADR-0013 — Trois parcours de novembre et sources communes

Date : 2026-10-20. Lot : UL-017. Décision produit confirmée par Thomas : la bêta comporte le client synthétique, les contenus contextualisés et la prochaine interaction par affaire.

Le client synthétique simule un acheteur : compréhension de l'offre, bénéfices et preuves, comparaison avec les alternatives documentées, objections, questions et crash test de l'unicité. Une simulation ne prouve ni une demande réelle ni la validation de la valeur par un client. Le verdict d'unicité reste limité au corpus comparé.

Les contenus réutilisent le contexte versionné de l'entreprise, ses sources autorisées, les contenus existants et un diagnostic synthétique identifié. Cible, phase de décision, objectif, offre et canal composent le brief. Les informations manquantes produisent des questions ; aucune rédaction exploitable avant un brief suffisant. Les requêtes observées et les questions simulées restent typées séparément.

Les recommandations par affaire conservent leur pipeline et leur revue humaine. Leur objectif devient explicite : progression attendue du client, action observable, question utile, preuve de réussite et échéance proposée ou convenue. Aucune tâche interne ne vaut validation du client.

Implémentation : nouvelles tables tenant sous RLS forcée pour sources et demandes de parcours ; versionnement optimiste, outbox, worker, capacité Hermes et budget communs. Le schéma existant est étendu par migration additive. Les sorties sont des brouillons soumis à revue et restent reliées aux versions des sources, du contexte et de la doctrine. Une source retirée invalide et efface les sorties dérivées. Les anciens runs par affaire restent compatibles.

Le corpus privé n'est pas copié dans ce dépôt public. L'import des documents autorisés se fait dans l'espace privé de chaque entreprise. L'acquisition initiale du corpus est explicite : textes et URLs documentées ; aucun moteur de recherche ou connecteur de demande consommateur n'est supposé disponible. Les sources renseignées sont vérifiées pour leur fraîcheur, et les limites de couverture sont affichées.

Aucune dépendance de production supplémentaire. La configuration Hermes live explicite et ses plafonds restent applicables ; l'absence de modèle configuré ne doit pas produire un faux diagnostic. Les tests simulés vérifient le circuit ; la pertinence des analyses live nécessite une recette distincte.
