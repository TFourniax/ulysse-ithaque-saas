# UL-016 — Intégration Hermes et démonstration agentique fictive

Prise du lot le 2026-10-07. Branche `codex/ul-016-hermes-demo`. Identifiant UL-016 libre dans BACKLOG et les PR consultées.

Base vérifiée : `claude/sweet-tesla-jrnkxs`, commit exact `598f082ab33fb87faf5ff357285dc95b536bb1b3`. La branche contient le socle de `claude/quirky-darwin-v4is1f` et UL-015 livré. PR #1/#2 non fusionnées ; aucune modification de main. Checkout de travail séparé des fichiers synchronisés du projet et de la copie personnelle de Thomas.

Audit : AGENTS, STATUS, BACKLOG, PRODUCT, BLUEPRINT, OPEN-QUESTIONS, SECURITY, OPERATIONS, ACCEPTANCE et ADR du socle consultés. L'analyse actuelle est déterministe et la formulation réelle OpenRouter n'est pas vérifiée. Les couches domaine/API/worker/PostgreSQL et la direction visuelle UL-015 sont conservées.

Exploration Hermes précoce : intégration `AIAgent`, registre de tools, sélection effective, callbacks, timeout/interrupt, usages, retries et persistance inspectés dans la révision officielle `e76fb951a1d207c9596032426e7e0eadfb197bea`. Le runtime officiellement supporté est Python 3.14 ; pas d'installation via un paquet PyPI homonyme. Les registres/caches upstream sont partagés dans un processus : choix d'un sous-processus par run et d'une passerelle d'inférence bornée, sans fork du moteur.

Contraintes de ce poste d'exécution : Docker CLI présent mais accès aux pipes des moteurs refusé ; pas de Python dans PATH ; aucune dépendance npm installée, installation hors ligne incomplète ; sortie réseau terminal vers GitHub refusée. Les fichiers de configuration personnels ont été inspectés uniquement pour la présence des noms de clés : aucune clé OpenRouter n'y est configurée. Aucun secret affiché. La validation live ne peut pas être déclarée acquise.

Première tranche : sources commerciales fictives intégrées au connecteur existant ; contrat pur, capacités, réservations SQL, outils de lecture, service Hermes isolé, analyse worker et publication atomique. API/UI : opportunités ouvrables, sources consultables, analyses/progression, scénarios owner. Publication interdite si versions ou accès changent. Décisions existantes et modifications humaines conservées.

Vérification locale initiale : 47 tests historiques domaine/mémoire passent, puis 3 contrôles agentiques purs passent. `npm run verify` échoue dès `format:check` car Prettier est absent ; aucun verdict tsc/lint/PG/Docker/live n'est inventé. Les vérifications restantes et leurs preuves seront consignées dans le rapport de validation.

État courant : in progress. Les validations automatisées déportées et la recette live sont distinctes. Aucune approbation produit supposée.
