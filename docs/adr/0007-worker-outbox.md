# ADR-0007 — Travaux de fond : pg-boss, outbox transactionnelle et budgets par entreprise

Date : 2026-10-06. Statut : accepté pour la V1 (UL-004), vérifié par tests d'intégration et stack conteneurisée.

## Contexte

La valeur doit apparaître sans action de l'utilisateur : synchronisations planifiées, analyse, expiration et purge. Une seule base pour les données et les files (ADR-0001). Aucun événement ne doit être perdu ni dupliqué entre une transaction métier et la file.

## Décision

- **Outbox transactionnelle** : les services métier écrivent leurs événements (`connection.sync_requested`, `recommendation.generated`, `doctrine.changed`, `context.changed`…) dans la même transaction que leurs données. Le worker réclame les événements (`FOR UPDATE SKIP LOCKED`), les envoie à pg-boss **dans la même transaction** puis les marque publiés : un événement est soit en attente, soit en file.
- **Files pg-boss 12** coalescées par entreprise/connexion (`singletonKey`), concurrence limitée **par entreprise** (`group`), budget de pages par job avec job de continuation : une grande entreprise ne bloque pas les autres.
- **Planification** : un cron pg-boss distribue les connexions dues (`due_connections`) et la maintenance (expiration, purge des sessions/reçus, âge des données).
- **Reprise** : curseur et début de passe persistés avec chaque page ; arrêt brutal → reprise au dernier curseur ; arrêt gracieux → la page en cours se termine.
- **Erreurs** : erreurs de connecteur typées ; transitoires réessayées avec délai exponentiel borné ; définitives → connexion en état `error`, visible dans l'interface.
- **Moindre privilège** : chaque job construit un contexte de service limité (entreprise, portée `source:ingest`, `analysis:run`, `recommendation:maintain` ou `connection:operate`) ; un job forgé ne peut pas lire une connexion d'une autre entreprise. L'API n'a aucun accès à pg-boss.

## Options écartées

Redis/BullMQ (service supplémentaire, pas de transaction commune avec les données) ; envoi direct à la file depuis l'API (perte possible entre commit et envoi).

## Preuves

Tests worker : ingestion sans action utilisateur, rejeu sans doublon, crash avant/après commit, retry/backoff et erreurs définitives, révocation et purge via l'outbox, job forgé inter-entreprises, équité entre entreprises, arrêt gracieux, jauge de files. Stack conteneurisée : propositions générées en arrière-plan après le seed, reprise après redémarrage.
