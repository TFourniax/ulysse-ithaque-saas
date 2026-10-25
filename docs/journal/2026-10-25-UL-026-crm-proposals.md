# UL-026 — Propositions après import CRM

Responsable : Codex. Branche : `codex/ul-026-crm-proposals`, base `7da79856287e72c26c1ef1bd6a2340811cea1b15` (corrections d’import UL-024). Défaut : DEBT-044.

## Observation et objectif

Thomas confirme l’import privé puis montre l’absence de proposition et une date d’analyse vieille de plusieurs jours. Inspection : le worker refuse encore les sources autres que `fixture-crm` et les doctrines non fictives avant de tracer l’exécution. L’import et son événement sont présents; le test d’import antérieur utilisait le moteur de règles. Objectif : une proposition préparée par le moteur configuré à partir d’une affaire importée, ou un motif visible et exploitable.

## Changement

- Sources CRM autorisées et doctrine validée utilisable acceptées, origine honnêtement transmise à Hermes. Droits, fraîcheur, versions et approbation humaine conservés.
- Blocages connus sans appel modèle tracés et dédupliqués; reprise après résolution sans nouvel import.
- Simulation capable de consulter les documents CSV sans activité structurée; lots suivants non bloqués par les douze premières affaires.
- Plafond de cinq minutes par affaire, appels de 90 secondes, ordonnancement borné sous le bail de dix minutes.
- Page Propositions raccordée aux exécutions agentiques et à leurs blocages; langage ne qualifiant plus toutes les sources de fictives.
- Tests PostgreSQL et UI, nouvelle recette CSV → vraie stack → proposition, exécutée en modes simulé et Hermes avec protocoles Anthropic/OpenRouter, sur installations neuves et mises à niveau.
- Script VPS `2026-10-25.crm3-proposals` épinglé à la branche de ce lot. Configuration fournisseur existante conservée.

## Vérification

`npm run verify` réussi : format, lint typé, TypeScript, cycles, contrat OpenAPI, 157 tests unitaires et contrôle documentaire. `bash -n` et les 14 tests du script VPS réussissent; les fichiers Python modifiés compilent. PostgreSQL, navigateur et stack Hermes sont vérifiés dans la CI conteneurisée, pas disponibles localement. Les résultats CI seront consignés dans la PR. Aucun appel fournisseur réel ni accès VPS dans cet environnement. Aucun fichier client brut ajouté au dépôt.

## Limites et suite

La maintenance configurée par défaut toutes les cinq minutes doit reprendre les affaires importées encore admissibles, sans les réimporter. Elle ne renouvelle pas la fraîcheur d’un fichier. Une source trop ancienne ou une doctrine manquante restent des blocages explicites.

Recette live requise après déploiement : lire une première proposition et ses sources. La qualité commerciale, le suivi effectué/reporté/écarté et les autres conditions [MVP](../MVP-NEXT.md) restent à valider; ce correctif ne déclare pas le MVP terminé.

## Première recette CI et correction comptable

Sur `395f5c3`, les trois nouveaux tests PostgreSQL passent (CSV → proposition avec doctrine d’entreprise, blocage/reprise, treizième affaire et fraîcheur). Un test Anthropic préexistant révèle un résidu d’arrondi de 0,000001 USD : la réservation est stockée en `numeric(12,6)` mais sa libération soustrait l’estimation non arrondie. Le nouveau texte des instructions change la taille qui déclenche ce cas. La passerelle arrondit désormais la réservation par excès au millionième avant son écriture et réutilise exactement ce montant pour la libération, comme la recherche. Le test conserve des assertions de coût exact et couvre deux tailles de conversation. Aucun tarif ou budget n’est modifié. Référence : CI PostgreSQL `40154236573`.
