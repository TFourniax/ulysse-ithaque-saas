# MVP — conditions de livraison confirmées le 24 octobre 2026

Responsable produit : Thomas. Mise en œuvre : Codex. L’autorisation porte sur les étapes ci-dessous; les diagnostics et contenus déjà fonctionnels sont la base à préserver. Le statut MVP n’est pas acquis par un lot technique isolé.

| Lot | Travail et preuve de clôture | État |
| --- | --- | --- |
| UL-024 | Dépôt CSV, reconnaissance Néréis, identifiants Ulysse, aperçu, réimport idempotent, ambiguïtés, retrait, alimentation des affaires. Tests sous les rôles réels puis essai du fichier privé sur la démo. | En vérification |
| UL-025 | Doctrine Denis de référence protégée, distincte de l’identité d’entreprise et des observations CRM. Sélection d’observations pertinentes et citables dans les trois parcours, sans exposer de données personnelles inutiles dans un contenu public. | À réaliser |
| UL-026 | Prochaine action utile sur les affaires importées : situation, justification, travail préparé et résultat observable attendu. Suivi effectué/reporté/écarté séparé de l’approbation, actualisation avec nouvelles données. | À compléter sur le circuit existant |
| UL-027 | Qualité éditoriale : longueur du brief, voix de l’entreprise et appel à l’action dans le texte copié. Révision de contenu sauvegardée et à réapprouver. | À réaliser |
| UL-028 | Trois entrées de travail compréhensibles, cadrage réutilisé, configuration secondaire, arrêts/reprises avec données conservées. | À finaliser |
| UL-029 | Recette pilote des trois parcours sur cas variés, validation commerciale, contrôle isolation/retrait, restauration sur environnement cible, version épinglée et retour arrière. | À réaliser |

Le MVP peut utiliser un onboarding accompagné. L’API Néréis, les envois automatiques, la facturation en libre-service et l’optimisation fine des coûts ne sont pas requis pour ce premier lot commercial. Les limites de ressources doivent être confortables et explicables; aucun objectif de quelques centaines de millisecondes n’est ajouté à la CI.

L’agent Hermes reste propriétaire de la boucle de raisonnement et d’outils. Les imports, autorisations, versions et décisions humaines appartiennent à Ulysse. Les tests avec fournisseurs scriptés établissent des invariants de fonctionnement, pas la qualité commerciale d’un résultat live.
