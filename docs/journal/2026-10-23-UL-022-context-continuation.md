# UL-022 — Continuation native après lecture de sources

Responsable : Codex. Date : 23 octobre 2026. Dette : DEBT-040.

## Observation et correction

Le relevé VPS confirme la révision `85736cb` et un premier appel Anthropic réussi, suivi d'une lecture de source. La passerelle refuse le tour suivant à 19 h 59 UTC pour `INVALID_INPUT:context limit`; Hermes le remonte ensuite comme HTTP 422. La limite interne était de 80 000 octets, avec 63 550 octets déjà utilisés au premier tour. La taille exacte du second tour historique n'a pas été conservée. Ce défaut n'est pas une preuve d'indisponibilité du fournisseur.

Le profil Anthropic fourni autorise désormais 256 000 octets de conversation, avec 320 000 octets maximum au transport HTTP. La sélection initiale reste allouée à 56 000 octets au plus; les preuves obligatoires ne sont pas tronquées. Les autres profils fournis restent à 80 000 et les profils personnalisés sont respectés. Aucun changement des instructions, du contrat v6, de la boucle Hermes ou des budgets monétaires.

Le dépassement conserve une cause fixe `context_limit` et des compteurs numériques dans le run avant le retour HTTP à Hermes. Le diagnostic expose ces compteurs et le plafond actif. L'interface fournit une explication compréhensible. Aucun texte source, raisonnement signé ou corps fournisseur n'est ajouté aux logs ou à ces métadonnées.

## Vérification et limites

Régressions ajoutées : démarrage sous 80 000 octets puis lecture groupée dépassant les anciennes limites de contexte et HTTP, préfixe/signature conservés, relecture et publication des trois alternatives; profil personnalisé limité et corps HTTP excessif refusés sans appel fournisseur supplémentaire, motif conservé malgré un HTTP 422 ultérieur; réservations libérées et absence de texte privé dans les métadonnées. La boucle Hermes épinglée reçoit aussi des réponses d'outils volumineuses avec signature liée au préfixe.

Contrôles locaux réussis : `npm run verify` (146 tests unitaires, format, lint, types, cycles, OpenAPI et liens), 17 tests Python avec la boucle Hermes épinglée et 14 tests du script VPS; syntaxe shell vérifiée. La CI PostgreSQL et les stacks conteneurisées seront suivies sur la révision publiée. Les fournisseurs de test sont scriptés : un nouvel essai sur le VPS reste nécessaire, sans recréer la collecte ni saisir à nouveau la clé. Aucun accès direct au VPS ou appel réel à Anthropic depuis cet environnement.

Premier passage PostgreSQL : le nouveau scénario publie son brouillon comparatif après continuation, mais son assertion finale utilisait `buyerEvidenceReview` au lieu de la métadonnée existante `buyerReview`. Un test historique attendait encore le motif secondaire `required_source_unread` après dépassement, désormais correctement conservé comme `context_limit`. Ces assertions sont corrigées, avec vérification ajoutée du refus de la requête préparée avant tout appel. La suite complète est relancée sur la révision suivante.
