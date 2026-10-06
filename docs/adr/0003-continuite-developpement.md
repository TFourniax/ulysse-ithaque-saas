# ADR-0003 — Suivi versionné et reprise

Date : 2026-10-06. Statut : mise en œuvre du besoin de co-développement.

Contexte : les personnes et agents changent entre sessions ; le chat n'est pas une source de vérité suffisante.
Décision : PRODUCT pour exigences, BLUEPRINT/ADR pour choix, BACKLOG pour tâches, STATUS pour état actuel, journal par session pour preuves et passation. PR par objectif cohérent ; pas de fusion automatique.

Ne pas multiplier les statuts : BACKLOG reste canonique jusqu'à migration explicite vers GitHub Issues. Chaque décision distingue confirmé, proposé et inconnu. Les sources privées ne sont pas copiées dans le dépôt public.

Conséquences : mise à jour de suivi dans chaque PR, coordination sur contrats/migrations, journal distinct pour éviter les écrasements. Aucun nombre fixe d'agents n'est imposé.

Condition de succès : un nouveau contributeur peut exécuter les contrôles et trouver la prochaine tâche avec le dépôt seul.
