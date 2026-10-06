# Ulysse Ithaque SaaS

Ulysse transforme les données autorisées d'une entreprise en propositions commerciales prioritaires, expliquées et soumises à une décision humaine. Les propositions apparaissent après ingestion et analyse en arrière-plan : la valeur ne dépend pas d'une question posée à un chatbot.

**État : fondation de développement, pas une alpha déployable.** Le code actuel est une tranche métier hors ligne, avec une règle fictive. Il n'y a pas encore d'interface, d'identification de production, de PostgreSQL, de planificateur ni de connecteur réel.

## Commencer

Node.js 24 LTS, version 24.16.0 ou ultérieure de la branche 24.

    npm test
    npm run demo
    npm run check

Ces commandes ne nécessitent aucun service externe, secret ou dépendance npm. Node exécute les fichiers TypeScript par suppression des annotations ; cela ne remplace pas un contrôle de types. Le contrôle TypeScript strict est une tâche ouverte du prochain lot.

La démo ingère une opportunité CRM **fictive**, détecte dix jours sans interaction ni prochaine étape, produit une proposition avec provenance, enregistre une validation humaine fictive et affiche le journal. Elle n'envoie aucun message.

## Reprendre le projet

1. Lire [AGENTS.md](AGENTS.md), les [exigences](docs/PRODUCT.md) et le [blueprint](docs/BLUEPRINT.md).
2. Lire [l'état courant](docs/STATUS.md), le [backlog](docs/BACKLOG.md) et les [questions ouvertes](docs/OPEN-QUESTIONS.md).
3. Appliquer le [prompt Work](docs/WORK-PROMPT.md) pour une nouvelle session de développement.
4. Suivre [CONTRIBUTING.md](CONTRIBUTING.md) ; consigner les changements et validations dans [le journal](docs/journal/2026-10-06-foundation.md).

## Organisation

| Emplacement | Responsabilité | État |
| --- | --- | --- |
| packages/domain | Règles, recommandations, décisions et adaptateur mémoire de référence | Implémenté, tests métier |
| apps/demo | Démo CLI fictive et reproductible | Implémentée |
| apps/web | Interface React/Vite | Prévue |
| apps/api | API Fastify, identité et contrôle des permissions | Prévue |
| apps/worker | Ingestion, analyse et tâches de fond | Prévu |
| packages/connectors | Contrats et adaptateurs aux sources autorisées | Prévus |
| packages/database | Migrations PostgreSQL, RLS et dépôts transactionnels | Prévus |
| packages/ai | Fournisseurs de modèles, sorties structurées et évaluations | Prévus |
| docs | Cadrage, architecture, suivi et passation | Présent |

Les chemins « prévus » sont des frontières d'architecture, pas des composants déjà livrés.

## Limites de confiance

Le Context du moteur est construit par un appelant de confiance. Le futur serveur devra vérifier l'identité et l'appartenance avant de le construire ; le tenant envoyé par un navigateur ne suffit pas. L'adaptateur mémoire n'offre ni durabilité ni transactions distribuées. Sa décision approved n'est jamais une autorisation d'envoi.

Le dépôt public n'accueille que des exemples fictifs. Les données clients, secrets, transcriptions, documents contractuels et contenus propriétaires de doctrine doivent être gérés dans des espaces privés autorisés. Aucune licence de redistribution n'est choisie dans cette fondation.
