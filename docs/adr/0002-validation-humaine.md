# ADR-0002 — Décision et exécution distinctes

Date : 2026-10-06. Statut : invariant de référence issu du cadrage confirmé.

Contexte : le SaaS propose des décisions commerciales et l'humain conserve le contrôle.
Décision : approved/rejected enregistre une décision versionnée et attribuée. La V1 ne dispose d'aucune action externe. Idempotence, révision et preuves fraîches sont contrôlées avant approbation.

Conséquences : une approbation n'envoie aucun e-mail et ne modifie aucun CRM. Une évolution d'exécution nécessite une capacité distincte, un manifeste précis approuvé et une revalidation ; ni l'IA ni une ancienne approbation ne créent des droits.

Preuve actuelle : tests métier de rôle, concurrence, retries, expiration et source changée ; demo avec zéro action externe. Preuve durable PostgreSQL à réaliser dans UL-003.
