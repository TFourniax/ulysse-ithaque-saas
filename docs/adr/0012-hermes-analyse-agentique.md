# ADR-0012 — Hermes et analyse agentique bornée

Date : 2026-10-07. Lot : UL-016. État : adopté pour l'implémentation UL-016 ; vraie boucle validée sur endpoint simulé, activation live encore non validée.

Le moteur historique détecte des signaux par règles ; ADR-0009 autorisait seulement une formulation assistée. UL-016 étend explicitement l'analyse : l'agent peut choisir les lectures, rapprocher les données, le contexte et la doctrine, puis proposer une action. La publication et les décisions restent sous contrôle déterministe Ulysse. Le mode historique demeure disponible pour comparaison.

Hermes est épinglé à `e76fb951a1d207c9596032426e7e0eadfb197bea`, depuis le dépôt officiel NousResearch, avec l'installateur scellé et `pm/lock.json` upstream. Python 3.14, licence MIT conservée. Le domaine expose `AgentExecutor` et des validateurs purs, sans dépendance Hermes, Python, HTTP ou fournisseur.

Le worker crée une exécution durable, réserve atomiquement le budget puis appelle le service privé hors transaction SQL. Hermes reçoit un sujet et une capacité opaque expirant après 90 secondes, jamais une entreprise choisie par le modèle. Chaque lecture reconstitue le contexte serveur et recontrôle les versions, le connecteur actif et le périmètre. La capacité n'est stockée que sous empreinte. Aucun outil générique de terminal, fichier, navigateur, mémoire, historique ou délégation n'est sélectionné : l'allowlist réelle est vérifiée à l'initialisation.

Un processus isolé est créé par run pour isoler les registres, caches et plugins upstream. Un répertoire temporaire vide remplace le home Hermes. Mémoire, contexte local, sessions DB, checkpoints, trajectories et revues auxiliaires sont désactivés. La suppression du répertoire couvre les éventuels fichiers de sessions restant créés par upstream. La passerelle du worker est le seul accès réseau d'inférence ; elle contrôle chaque requête, y compris retry/continuation, et ne transmet aucun fallback de modèle.

Les sources commerciales fictives sont des champs normalisés de la fixture CRM : échanges, notes et documents suivent donc la pagination, les révisions canoniques et l'outbox existants. Aucun pipeline OCR, stockage vectoriel ou deuxième base métier. Les dates des scénarios sont relatives à leur injection. Les critères d'évaluation sont séparés des données accessibles au modèle.

La validation impose un schéma fermé, les références effectivement lues, les versions, la fraîcheur, les contraintes de contact, les décisions antérieures et les plafonds. Le modèle propose une urgence qualitative ; Ulysse conserve une priorité fixe expliquée de 30, sans confiance inventée. Une modification humaine supprime le remplacement automatique de ce dossier. La revue humaine conserve les conflits de version existants.

Trois origines sont explicites : règles, agentique simulé, Hermes live. Aucun repli automatique ni double exécution du moteur historique en mode agentique. L'ancienne formulation payante est désactivée dans l'entrée de production du worker, car elle n'avait pas de réservation atomique. Les tests de non-régression de cet adaptateur restent disponibles.

DEBT-014 : un coût historique absent bloque le budget au lieu de compter zéro. Chaque run live réserve au maximum 0,25 USD, session 2 USD, entreprise/mois 10 USD. Le montant réservé reste consommé si le fournisseur ou l'annulation laissent un coût inconnu. Les estimations utilisent les prix maximums du modèle fixe et une borne de contexte en octets. Les usages et les événements structurés sont persistés, sans prompts ou chaîne de pensée.

Limites : ACL par rôle d'entreprise seulement (DEBT-010), corpus exclusivement fictif, évaluation sémantique live encore nécessaire. Les commandes de démonstration sont réservées aux owners et explicitement activées hors production. Aucune écriture externe. UL-008, UL-009 et UL-012c ne sont pas clôturés par ce lot.

Références vérifiées : [intégration Python](https://hermes-agent.nousresearch.com/docs/guides/python-library), [intégration programmatique](https://hermes-agent.nousresearch.com/docs/developer-guide/programmatic-integration), [boucle](https://hermes-agent.nousresearch.com/docs/developer-guide/agent-loop), [plugins](https://hermes-agent.nousresearch.com/docs/user-guide/features/plugins), [source épinglée](https://github.com/NousResearch/hermes-agent/tree/e76fb951a1d207c9596032426e7e0eadfb197bea).
