# ADR-0001 — Monorepo et socle PostgreSQL

Date : 2026-10-06. Statut : choix technique de départ proposé ; composants majoritairement non installés.
Contexte : construire un SaaS multi-entreprises avec ingestion de fond, recommandations, preuves et reprise par différents contributeurs.

Décision de travail : TypeScript/Node 24, React/Vite, Fastify, PostgreSQL 18, pg-boss, stockage S3 et OIDC. Monorepo et domaine modulaire ; applications API/worker distinctes à l'exécution, mêmes contrats versionnés. npm workspaces et lockfile lors de l'installation.

Options : Next.js tout-en-un ; stack Python ; services distribués ; socle Supabase. Rien dans le cadrage confirmé n'impose l'une de ces options. Le choix vise une seule langue et une DB pour données/jobs, sans multiplication des services. Le fournisseur d'identité reste portable et la destination de production à décider.

Conséquences : besoin d'implémenter les dépôts, autorisations et opérations avec soin ; pas de garanties hébergeur supposées. Le choix sera réévalué si le cahier joint impose une stack différente ou si les preuves de déploiement/compatibilité le demandent.

Preuve requise : installation verrouillée, tsc strict, tests API/DB/RLS/jobs et Compose. La documentation officielle consultée ne suffit pas à déclarer la stack fonctionnelle.
