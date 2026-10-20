# UL-017 — compatibilité avec la version VPS documentée

## Constat et périmètre

Thomas demande les commandes de mise à jour de sa démo. La version VPS documentée est `5a7cf27`, tandis que la base UL-017 `0282c19` appartient à une lignée parallèle (ancêtre commun `fefba88`). Une mise à jour sans réconciliation aurait retiré le mode hermes-stub, sa migration et plusieurs scénarios déjà déployés.

## Correction

Intégration des deux lignées sur la branche UL-017. Conservation des contrôles et fonctionnalités UL-016, du corpus enrichi, de la migration stub originale, de la purge des sources et des trois parcours novembre. Plugin Hermes adapté aux outils et au prompt propres à chaque parcours. Migration 0013 additive pour le mode des nouveaux parcours. Budget commun aux parcours mais séparé par mode. Le stub lit le corpus et s’abstient de produire un faux diagnostic ou une fausse rédaction.

## Vérification

Contrôle des types, tests unitaires des empreintes, test PostgreSQL de la passerelle des nouveaux parcours, vraie boucle Hermes et recette de mise à niveau depuis `5a7cf27` à exécuter dans la CI avant diffusion de la commande finale. Les résultats seront rapportés au commit effectivement vérifié.

## Limites

Aucun accès SSH ni changement de VPS dans cette session. La configuration privée et les éventuels correctifs locaux doivent être contrôlés sur le VPS avant remplacement. La collecte web et la pertinence du fournisseur réel ne sont pas établies par cette recette technique.
