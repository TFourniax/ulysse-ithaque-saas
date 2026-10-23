# UL-021 — Fournisseur Anthropic natif dans Hermes/Ulysse

Responsable : Codex. État : partial, intégration en vérification. Objectif demandé par Thomas : utiliser sa clé API Anthropic et les crédits de son organisation dans les trois parcours, avec Hermes comme moteur. Aucun secret ni donnée client ajouté au dépôt.

## Changement

Route native Messages et profil Sonnet 5.5, contrat Hermes v5, transport natif enregistré via l’extension officielle pour conserver les signatures derrière la passerelle privée. Le worker reste responsable des permissions, preuves, budgets et de la seule véritable clé. Recherche et relecture raccordées; coût cache estimé; erreur 529 traitée comme surcharge transitoire. Aucun secours OpenRouter automatique.

Script VPS : saisie privée documentée, déploiement et activation en une commande, précontrôle Anthropic sans inférence, rotation de clé, rollback, conservation du corpus, des campagnes et de l’historique. Enveloppes existantes 2/20/100, aucun reset de consommation. Pas de changement de schéma de données ni de dépendance.

Fichiers : worker fournisseur/runtime/recherche/précontrôle, contrats partagés et redaction, service/plugin/transport Hermes, script et tests VPS, overlay privé, tests unitaires/intégration, CI et documentation. [Architecture](../adr/0017-anthropic-native.md), [procédure](../ANTHROPIC.md).

## Vérifications

À ce stade : 47 tests unitaires worker et 14 tests de transformation VPS réussis; syntaxe Python et Bash contrôlée. `npm run verify` complet et contrôles CI de la vraie boucle Hermes, PostgreSQL et stacks neuve/mise à niveau sont en cours. Les tests utilisent uniquement des données et fournisseurs fictifs. Les résultats finaux seront consignés après exécution.

## Limites et suite

Pas de clé locale, pas d’appel Anthropic réel, pas de déploiement VPS effectué par Codex. Le catalogue vérifie seulement clé/modèle, les prix sont versionnés d’après la documentation. Les garanties Europe/ZDR ne sont pas transférées à cette route. Clôture UL-021 : trois parcours réels relus et coûts/délais observés après activation par Thomas, puis recette recherche.
