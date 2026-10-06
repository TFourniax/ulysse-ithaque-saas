# ADR-0010 — Image unique, stack Compose et sauvegardes chiffrées vérifiées

Date : 2026-10-06. Statut : accepté pour la V1 (UL-011), vérifié sur stack locale et en CI. Aucune infrastructure de production n'est choisie (Q-008, UL-014).

## Contexte

La V1 doit être démarrable, redémarrable et restaurable de façon reproductible, sans supposer d'hébergeur ni installer quoi que ce soit sur un serveur existant.

## Décision

- **Une image** (Dockerfile multi-étapes, Node 24 Alpine, dépendances de production, utilisateur non root) pour l'API (qui sert aussi le web compilé), le worker et les jobs ponctuels ; la commande choisit le processus. Exécution en lecture seule, sans capacités Linux.
- **Compose** (`infra/compose.yaml`) : services de développement (PostgreSQL, Keycloak) et profil `app` complet ; chaque processus ne reçoit que le mot de passe de son rôle PostgreSQL.
- **Sauvegardes logiques** `pg_dump` (format custom) dans un snapshot exporté, chiffrées **AES-256-GCM** (clé de 32 octets hors dépôt, empreinte dans le manifeste) ; restauration **dans une nouvelle base uniquement**, authentification avant `pg_restore`, puis vérifications (migrations, comptes de lignes du snapshot, RLS forcée, isolation du rôle API). Outils PostgreSQL exécutés dans le conteneur serveur pour garantir la même version majeure.
- Options écartées : chiffrement par outil externe (`age`, `gpg`) non garanti sur les postes ; sauvegarde physique/PITR, à reconsidérer avec l'hébergement retenu (elle couvrirait un RPO plus court).

## Conséquences

- La sauvegarde logique ne fournit pas de restauration à un instant arbitraire ; RPO/RTO à décider (Q-013).
- La perte de la clé rend les sauvegardes inutilisables : sa conservation et sa rotation font partie de la procédure (OPERATIONS §7).

## Preuves

Exercice local (sauvegarde pendant l'activité du worker, restauration vérifiée, API démarrée sur la base restaurée avec connexion OIDC réussie), refus d'une mauvaise clé et d'un fichier modifié, tests unitaires du chiffrement authentifié, job CI `container-stack`.
