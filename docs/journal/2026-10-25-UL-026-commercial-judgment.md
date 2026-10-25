# UL-026 — Jugement commercial et preuves

Responsable : Codex. Branche : `codex/ul-026-commercial-judgment`, base `da49cdde373329b3e8be566f6b9c40b56e1f53db`. Défaut : DEBT-045. PR dédiée, sans fusion automatique.

## Observation et objectif

Deux propositions live transmises le 25 octobre montrent que le raccordement CSV fonctionne. Elles privilégient la remise en ordre du CRM, en présentant comme incompatibles des rôles ou des calendriers qui peuvent coexister. La source du champ commercial et celle du responsable des ventes sont distinctes dans l’import. Les documents conservent les premières dates, même sans activités structurées. Le score affiché 30/100 est fixe et une citation globale ne montre que le nom de l’affaire. Aucune donnée privée, identité réelle ou caractéristique d’offre client ajoutée aux fixtures.

Objectif : préparer du travail commercial étayé et présenter ses preuves sans ajouter un moteur parallèle à Hermes ni corriger silencieusement les données.

## Changement

- Instructions : test de contradiction réelle, blocage limité à l’action concernée, rôles multiples, dates distinctes, offre non documentée, notes et documents lus, questions ou trame immédiatement utilisables, relecture intégrée.
- Outil : références des champs normalisés et indication du périmètre des activités structurées. Publication vers la valeur et l’état exacts du fait cité.
- Réexécution liée au SHA des instructions, empreinte métier inchangée, décisions et rédactions humaines conservées.
- Liste et détail : masquer le score fixe de cette règle, conserver les scores réellement calculés des règles historiques. Date de réception distincte d’une confirmation du contenu.
- Régressions PostgreSQL et smoke navigateur étendus avec des rôles fictifs distincts. Fournisseurs toujours scriptés en CI, dont la vraie boucle Hermes pour Anthropic et OpenRouter.
- Script VPS `2026-10-25.crm4-judgment`. Pas de migration ou réimport nécessaire; paramètres fournisseur et budgets conservés.

## Vérification

Les commandes et résultats sur le commit final seront consignés dans la PR : `npm run verify`, syntaxe et tests du script VPS, PostgreSQL sous rôles réels, navigateur, stack neuve et mise à niveau, vraie boucle Hermes avec fournisseurs scriptés. Aucun accès VPS ni clé fournisseur live dans cet environnement. Ne pas interpréter les assertions de transport/citations comme une preuve de pertinence sémantique.

## Recette live et limites

Après déploiement, la maintenance reprend les affaires admissibles sans nouvel import. Relire les nouvelles propositions en attente :

1. Des personnes dans des rôles différents ne deviennent pas automatiquement des responsables contradictoires; le rôle d’un acteur supplémentaire reste à clarifier.
2. Un report et un projet futur ne sont pas déclarés incompatibles sans preuve; une date atypique reste une hypothèse à vérifier.
3. L’absence d’offre dans le contexte ne conduit ni à l’inventer ni à affirmer qu’elle n’existe pas; les questions neutres sur le besoin et les critères restent préparables.
4. Des dates initiales dans les notes ne sont pas ignorées parce que la liste des activités est vide. La réception récente du CSV n’est pas la date du dernier échange.
5. La proposition prépare des questions précises, une trame ou un brouillon utile, avec résultat observable. Les vérifications secondaires ne deviennent pas un veto global au contact.
6. Les citations montrent les valeurs utilisées. Approbation, rejet, pause, opposition et édition humaine restent respectés; aucun envoi externe.

La qualité des nouvelles réponses réelles n’est pas garantie par les recettes scriptées. Doctrine Denis protégée, suivi d’action et autres lots du [MVP](../MVP-NEXT.md) restent à réaliser.

## Première recette et précision du test de conservation

Au commit `9bf1173`, les citations exactes et le remplacement d’une proposition en attente passent sous PostgreSQL. Trois nouvelles assertions attendaient à tort un run `completed` après approbation, rejet ou édition : le moteur enregistre `abstained` lorsqu’il ne publie aucun remplacement. Les tests attendent désormais explicitement cette abstention sans erreur, une seule réexécution et la conservation de l’état humain. Les protections de production ne sont pas modifiées. CI de cette première tentative : `40221322311`.
