# UL-020 — implémentation de la recherche publique

Ce journal décrit la phase locale. La publication, le correctif de privilège PostgreSQL et les 11 contrôles CI verts au `375bfe5` sont consignés dans le [journal suivant](2026-10-21-UL-020-publication-ci.md).

Date : 21 octobre 2026. Responsable : Codex. Branche locale : `codex/ul-020-web-research`, base `9e0d520` (UL-019 et constat du premier diagnostic GLM). Objectif : préparer un corpus concurrentiel qualifié et un benchmark sans saisie manuelle de concurrents, puis les soumettre à revue humaine.

## Changements

- Domaine et contrats de profil public, campagne, acteur, offre, fait, page et décision. Requêtes multi-axes, URL canonique, contrôle des citations exactes et des liens réellement lus; comparaisons sans classement arbitraire des prix.
- Adaptateurs Brave et lecteur HTML public : DNS vérifié et adresse épinglée, redirections contrôlées, robots, délais et tailles bornés, aucun cookie ni secret envoyé aux pages. Résultats du moteur utilisés comme pistes, jamais comme preuves.
- Migration additive 0014 : RLS forcée, clés tenant, tâches persistées, pages et revues versionnées, réservations financières partagées avec les appels existants. Reprise et annulation conservent les dépenses; les réponses devenues obsolètes ne sont pas publiées.
- Worker : découverte, pagination, lectures, extraction structurée, qualification, enrichissement et nouvelles pistes. Modèle européen configuré conservé, fonction de réponse unique, contenu web traité comme donnée non fiable. Chaque fait reste une déclaration attribuée, même après revue.
- Diagnostic acheteur : collecte déclenchée depuis le profil autorisé, attente asynchrone, sources paginées et lectures par lots. Corpus de recherche indépendant des huit sources manuelles. Références provisoires explicites et approbation refusée avant leur revue; changements de campagne invalidant les dérivés.
- API et écran Recherche et benchmark : progression, enveloppe, arrêt/reprise, matrice filtrable, citations et texte collecté, corrections distinctes des preuves, décisions individuelles/groupées et historique. Liens de diagnostic vers une fiche précise, y compris hors première page.
- Script VPS : activation Brave depuis un fichier privé, arrêt du connecteur, précontrôle sans appel fournisseur, conservation du modèle européen/session/budgets et contrôle de dérive de configuration. Reconstruction conjointe application/Hermes requise.

Fichiers principaux : `packages/domain/src/research.ts`, `packages/contracts/src/research.ts`, `packages/connectors/src/web-research.ts`, `packages/database/migrations/0014_web_research.sql`, `packages/database/src/research-store.ts`, `apps/worker/src/research-*.ts`, `apps/api/src/routes/research.ts`, `apps/web/src/pages/Research.tsx`, contrats/outbox/workflows associés et plugin Hermes. [ADR-0016](../adr/0016-recherche-publique-et-benchmark.md), [activation et recette](../RESEARCH-OPERATIONS.md).

## Vérification et portée des preuves

Les tests unitaires ajoutés couvrent URL et identité conservatrice, citations inventées refusées, plusieurs offres, prix non assimilés, HTML bruité, robots/redirections, résultats Brave validés, extraction structurée et erreurs fournisseur. Les tests de configuration VPS vérifient la conservation des paramètres existants, l’activation uniquement côté worker, les clés privées et le rejet des liens symboliques.

Quatre scénarios d’intégration PostgreSQL sont ajoutés : découverte de dix domaines sans import, corpus dépassant huit sources et reprise idempotente; annulation en vol/isolation/revue versionnée; réservations incertaines conservées et budgets; déclenchement acheteur et invalidation après revue. Un scénario Playwright contre la vraie stack est ajouté pour l’autorisation, la persistance et le statut fournisseur absent. **Ces scénarios d’intégration ne sont pas exécutés localement.**

PostgreSQL et Docker ne sont pas disponibles dans le conteneur de travail. Une tentative avec PostgreSQL embarqué a confirmé l’impossibilité de démarrer sous un utilisateur non privilégié dans cet environnement (mappage limité à UID/GID 0); aucun contournement de cette restriction effectué. La migration et les rôles doivent donc être vérifiés en CI avant déploiement.

Un contrôle Chromium de l’interface construite, avec réponses HTTP fictives, a affiché treize fiches, exécuté une validation groupée, ouvert une preuve et vérifié le rendu desktop/mobile : aucune erreur JavaScript ni débordement horizontal du document. Ce contrôle visuel ne prouve ni PostgreSQL/Keycloak réels ni la qualité du fournisseur.

Vérifications locales : `npm run verify` vert (format, lint strict, types, cycles, OpenAPI, 111 tests unitaires et liens documentaires); `npm run build -w @ulysse/web` vert; `python3 scripts/test-vps-europe.py` 9/9; `bash -n scripts/ulysse-vps-europe.sh` et `git diff --check` verts. Le scénario PostgreSQL de collecte inclut une page expirant en lecture : les autres domaines doivent continuer, avec erreur visible et reprise possible. Ces preuves ne remplacent pas les tests d’intégration encore non exécutés.

## Limites et suite

Lot **partial**, pas de déploiement VPS ni d’appel Brave/GLM réel pour cette recherche. Publier le candidat, exécuter la CI PostgreSQL/Keycloak/Hermes/stack, puis activer la clé serveur et le profil public avant la recette Paitite. Relever coût, durée, couverture et qualité d’un échantillon de preuves; aucune affirmation d’exhaustivité.

DEBT-024 : intégration et preuve live. DEBT-025 : alias entre domaines et corroboration indépendante. DEBT-026 : report des décisions entre campagnes et correction structurée de qualification. Les PDF, sites uniquement JavaScript et pages authentifiées restent signalés non exploitables. Les prix restent assortis des conditions extraites. La veille planifiée hors demande de diagnostic est distincte de cette implémentation. Le repli automatique après HTTP 429 demeure DEBT-023 et n’est pas ajouté par ce lot.
