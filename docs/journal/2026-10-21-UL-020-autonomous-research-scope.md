# UL-020 — Correction du cadrage de l'acquisition d'informations

Date : 2026-10-21 (Europe/Paris). Responsable : Codex. Branche locale : codex/ul-020-web-research, depuis 9e0d520. Objectif : intégrer la clarification de Thomas après la première réussite GLM. Périmètre de cette modification : PRODUCT, NOVEMBER-WORKFLOWS, STATUS, BACKLOG, WEB-RESEARCH-BENCHMARK et ce journal. Aucun code applicatif ni configuration du VPS modifié.

## Décision produit

L'agent doit rechercher lui-même les informations manquantes accessibles, notamment les concurrents et leurs offres, par noms, mots-clés, besoins, marchés, secteurs et zones géographiques. Il découvre largement, qualifie, dédoublonne et enrichit avant de soumettre ses résultats à validation. La suggestion précédente de faire constituer manuellement le benchmark par Thomas ne correspond pas à cette cible.

Le chargement manuel de sources reste une possibilité de la version livrée, pas la façon dont l'utilisateur doit alimenter au quotidien le moteur concurrentiel. L'utilisateur arbitre les faits importants et les choix métier ; il n'est pas l'opérateur de collecte. Des données privées non accessibles peuvent toujours nécessiter une question ciblée.

## État vérifié du code

Lecture de WORKFLOW_TOOLS dans `apps/worker/src/workflow-runtime.ts` : uniquement get_workflow_context, list_company_sources et read_company_source. `CreateWorkflowBody` borne sourceIds à huit ; la sortie borne benchmark à huit entrées. Le prompt versionné n'autorise aucun outil web et la publication exige des références déjà lues. Aucun pipeline de découverte web n'est raccordé.

## Livrable et limites

Exigences REQ-013 à REQ-017 et critères de recette UL-020 ajoutés. Le document décrit le passage à des campagnes progressives, faits versionnés, comparaison et revue humaine. Cette livraison est un cadrage local, pas une implémentation ni une preuve de collecte autonome. Le compte rendu UL-019 précédemment bloqué à la publication est conservé ; aucune nouvelle tentative de publication distante n'est incluse.

## Vérification et suite

Vérifications effectuées : formatage Prettier des six fichiers de cadrage, `npm run check` réussi (34 documents requis, 55 fichiers Markdown et liens internes), `git diff --check` réussi. Aucune modification du code exécutable ; pas de nouvelle recette applicative prétendue.

La suite technique est le choix du connecteur de recherche et les contrats de campagne/faits/revue, puis l'implémentation avec recette réelle. La recherche web à développer ne doit pas être remplacée par un benchmark préparé manuellement depuis cette conversation.
