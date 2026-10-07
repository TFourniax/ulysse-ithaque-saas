# UL-016 — Intégration Hermes et démonstration agentique fictive

Prise du lot le 2026-10-07. Branche `codex/ul-016-hermes-demo`. Identifiant UL-016 libre dans BACKLOG et les PR consultées.

Base vérifiée : `claude/sweet-tesla-jrnkxs`, commit exact `598f082ab33fb87faf5ff357285dc95b536bb1b3`. La branche contient le socle de `claude/quirky-darwin-v4is1f` et UL-015 livré. PR #1/#2 non fusionnées ; aucune modification de main. Checkout de travail séparé des fichiers synchronisés du projet et de la copie personnelle de Thomas.

Audit : AGENTS, STATUS, BACKLOG, PRODUCT, BLUEPRINT, OPEN-QUESTIONS, SECURITY, OPERATIONS, ACCEPTANCE et ADR du socle consultés. L'analyse actuelle est déterministe et la formulation réelle OpenRouter n'est pas vérifiée. Les couches domaine/API/worker/PostgreSQL et la direction visuelle UL-015 sont conservées.

Exploration Hermes précoce : intégration `AIAgent`, registre de tools, sélection effective, callbacks, timeout/interrupt, usages, retries et persistance inspectés dans la révision officielle `e76fb951a1d207c9596032426e7e0eadfb197bea`. Le runtime officiellement supporté est Python 3.14 ; pas d'installation via un paquet PyPI homonyme. Les registres/caches upstream sont partagés dans un processus : choix d'un sous-processus par run et d'une passerelle d'inférence bornée, sans fork du moteur.

Contraintes de ce poste d'exécution : Docker CLI présent mais accès aux pipes des moteurs refusé ; pas de Python dans PATH ; aucune dépendance npm installée, installation hors ligne incomplète ; sortie réseau terminal vers GitHub refusée. Les fichiers de configuration personnels ont été inspectés uniquement pour la présence des noms de clés : aucune clé OpenRouter n'y est configurée. Aucun secret affiché. La validation live ne peut pas être déclarée acquise.

Première tranche : sources commerciales fictives intégrées au connecteur existant ; contrat pur, capacités, réservations SQL, outils de lecture, service Hermes isolé, analyse worker et publication atomique. API/UI : opportunités ouvrables, sources consultables, analyses/progression, scénarios owner. Publication interdite si versions ou accès changent. Décisions existantes et modifications humaines conservées.

Vérification locale initiale : 47 tests historiques domaine/mémoire passent, puis 3 contrôles agentiques purs passent. `npm run verify` échoue dès `format:check` car Prettier est absent ; aucun verdict tsc/lint/PG/Docker/live n'est inventé. Les vérifications restantes et leurs preuves seront consignées dans le rapport de validation.

PR dédiée [#3](https://github.com/TFourniax/ulysse-ithaque-saas/pull/3), draft, sans fusion. Commits intermédiaires : `a1b7a9b`, `a838146`, `30f70ae`, `02f7a61`. CI : construction du runtime Hermes officiel réussie ; la sélection stricte a détecté la découverte progressive des outils upstream, désactivée via `tools.tool_search.enabled: off`. Le modèle de la passerelle utilise des réponses non streamées ; `model.streaming: false` désactive le streaming upstream. Aucun remplacement par une boucle maison.

Au commit `02f7a61`, tests intégration PostgreSQL 50/50, API 17/17 et worker 17/17 passent, y compris les six cas agentiques et la formulation historique. Le test de compilation signale deux accès potentiellement absents dans le nouveau test ; assertions de présence ajoutées. Au commit `30f70ae`, parcours simulé Alice, ingestion d'un e-mail, évolution de proposition, décision, interdiction viewer et Globex passait avant la reprise ; attente de santé ajoutée après redémarrage. Les tests sont relancés sur le dernier SHA et leurs résultats consolidés dans le rapport.

Configuration, budgets et instructions versionnés ; procédure PowerShell exacte ajoutée. Une matrice CI vérifie le départ neuf et la mise à niveau depuis l'image construite au commit UL-015, sans suppression de volume. La décision fictive enregistrée avant mise à niveau et les identifiants métier doivent survivre.

État courant : **partial**, recette en cours, live absent faute de clé autorisée. Les validations automatisées déportées et la recette live sont distinctes. Aucune approbation produit supposée.

Validation `efaea8e` : vraie boucle Hermes verte, deux instances concurrentes, sept outils exacts, deux requêtes modèle et lecture par run. Streaming désactivé officiellement ; aucune boucle maison. Le parcours simulé neuf passe jusqu'après restart ; captures et preuve JSON conservées. Le modèle endpoint est simulé : aucune recette fournisseur live.

Recette upgrade : décision, session et identifiants antérieurs conservés ; manque de sync immédiate après enrichissement découvert puis corrigé par `ConnectionService.requestSync`, sans écriture directe de recommandation. Coûts estimés et inconnus testés séparément ; réserve incertaine conservée, retries bornés à huit transmissions. Dernière recette et état final détaillés dans VALIDATION.

Le transport du poste s'est fermé après les contrôles locaux ; les corrections restantes sont poursuivies via GitHub. La copie personnelle reste intacte. Aucun accès live fourni ; état du lot partial, aucune approbation de pertinence supposée.

## Consolidation finale

Au head `562cf83e1e46559560f019ffdde0f30e384cd5fd`, checkout PR `65eae5fdeb4df6831d8958fb5f388bb6aede49ce` : cinq jobs CI et quatre jobs UL-016 verts. PostgreSQL 50/50, API 17/17, worker 20/20 (neuf cas agentiques), e2e 12/12 ; builds, backup/reprise, loop Hermes et stacks neuve/upgrade passent. Preuves JSON et captures reliées au SHA dans VALIDATION. L'upgrade ingère immédiatement l'enrichissement du seed et conserve la décision antérieure.

Contrôles d'accessibilité ajoutés aux trois nouveaux parcours : le test initial mesurait le bandeau pendant son animation d'entrée ; attente des animations finies avant axe, sans les désactiver. Axe et largeur mobile passent. Les références des recommandations/décisions consultées sont maintenant versionnées ; une décision concurrente provoque l'abandon du résultat obsolète.

Un Python 3.12 auxiliaire a permis l'analyse AST locale des fichiers ; l'image officielle Python 3.14.4 et son installation scellée ont été construites et réellement testées en CI. La boucle Hermes avec endpoint simulé utilise deux requêtes modèle par processus, sept outils exacts et get_opportunity, en 5,466 s pour deux processus concurrentiels. Ce test ne constitue pas un appel fournisseur réel.

Documentation consolidée : ADR-0012, blueprint, contrat agentique v1, OpenAPI, sécurité/exploitation/acceptance, catalogue, guide PowerShell et parcours de 10–15 minutes. DEBT-014 corrigée et testée pour le pipeline activable ; ancienne formulation payante désactivée. Captures de trois vues actuelles disponibles ; les autres captures historiques restent une dette distincte.

État final **partial**. Aucun fournisseur live appelé, aucune qualité/coût/latence live observée, aucune approbation produit inventée. Clé autorisée absente et Docker Desktop personnel inaccessible. Revue humaine de fidélité aux sources, rapprochement offre/besoin, contradictions et injection encore attendue. La PR reste draft, sans fusion ; les sources/doctrine réelles et le pilote ne sont pas clôturés.

Dernier contrôle : traitement de technical_error séparé de la publication normale, code agent_reported_error durable et propositions existantes conservées. Test PostgreSQL supplémentaire ajouté ; recette relancée. Les anciennes mentions d'un coût inconnu comptant pour zéro dans OPERATIONS sont remplacées par la réservation conservatrice actuelle.

## Retrait des copies et droits d'exécution

Migration additive 0011 : retrait atomique des extraits agentiques dans evidence_links, des résultats/références/snapshots et événements de runs, avec conservation des réservations et usages. La purge fonctionne aussi après retour au mode règles. Fonction SECURITY DEFINER réservée au worker, entreprise courante et connexion révoquée obligatoires ; aucune écriture sur décisions/révisions/audit.

La recette PostgreSQL générique utilisait le rôle API pour les opérations de service. Elle utilise maintenant le vrai rôle worker pour les contextes service, et le rôle API pour les humains ; les droits de purge ne sont pas étendus au rôle API. Le nouveau test worker vérifie refus sur connexion active, retrait après révocation en mode règles, et conservation des coûts incertains.

Thomas annonce une clé OpenRouter prête. Configuration demandée dans le .env local ignoré par Git. Le terminal est à nouveau accessible, la copie de travail est resynchronisée depuis la PR, mais réseau terminal et Docker Desktop restent refusés ; aucune clé ni coût live n'est affiché ou inventé.
