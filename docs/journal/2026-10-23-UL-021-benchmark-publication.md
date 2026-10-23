# UL-021 — Preuves concurrentes et contrôle de publication cohérent

Date : 2026-10-23. Responsable : Codex. Dette : DEBT-039. Branche : `codex/ul-021-anthropic-native`, PR #9.

## Constat et objectif

Le relevé VPS transmis par Thomas confirme le code `6d4882c` installé. L'essai du 23 octobre à 16 h 33 (Europe/Paris) termine après 83,9 s avec `publication_refused` : trois appels modèle, un outil de liste, aucune lecture de fiche, zéro référence concurrente dans la relecture, relecture terminée et format valide. Coût estimé 0,141661 USD, aucun appel incertain. Les appels Anthropic ont abouti sur cet essai; cela ne suffit pas à qualifier toute l'intégration.

Défauts constatés dans le code : les preuves concurrentes dépendaient entièrement du choix de lecture par le modèle; la relecture acceptait un benchmark vide que la publication refusait en présence de recherche qualifiée. Ce refus était masqué par un code générique. Le résultat historique n'est pas conservé et ne peut pas être reconstitué à partir de ce relevé.

Objectif : produire la comparaison demandée à partir du corpus autorisé, corriger les omissions avant publication, conserver les refus de citations inventées et les contrôles de fraîcheur. Aucun changement de fournisseur, budget ou migration.

## Changements

- Premier lot de quatre fiches concurrentes au plus, dans l'ordre de pertinence déjà calculé, avec leurs textes versionnés complets. Enveloppe additionnelle de 24 000 octets maximum et place disponible; une fiche trop volumineuse n'est pas tronquée. Aucune nouvelle recherche payante. Catalogue et lectures complémentaires restent accessibles à Hermes. Sélection lexicale et qualification amont ne prouvent pas la pertinence finale.
- Contexte natif fixé avant l'exécution comme précédemment : le même message initial est recontrôlé, jamais réécrit au milieu de la conversation signée. Sources propres obligatoires conservées. La relecture récupère seulement les fiches réellement fournies ou lues; elle ne transforme pas un aperçu en preuve.
- Une politique de publication commune au domaine et à la relecture contrôle type de parcours, complétude, citations, preuve de l'offre et comparaison bilatérale. Une campagne qualifiée ou des concurrents explicitement sélectionnés exigent un benchmark pour un brouillon. Une omission déclenche la correction existante; une abstention explicite demeure autorisée si aucune comparaison ne peut être justifiée.
- Motifs fixes et étape d'échec diagnostiquables sans enregistrer le texte du modèle ou des sources. Messages UI explicites; `diagnose` expose les nouveaux compteurs et motifs.

Fichiers : domaine workflows, préparation/catalogue, relecture et passerelle worker, erreurs et UI, instructions/fixture Hermes, tests, recette et script VPS.

## Vérification et limites

Tests ciblés de sélection complète bornée, dédoublonnage, citations bilatérales, benchmark oublié et diagnostics. Nouveau scénario PostgreSQL natif : génération avec un outil de liste seulement, omission dans la génération et la relecture, correction comparative ou abstention explicite; une omission persistante reste refusée avec un code précis. La recette de stack provoque aussi une omission, puis exige un benchmark cité et un contenu lié.

Vérification complète et CI à consigner après exécution. Données et fournisseur scriptés. Aucun accès SSH ou appel API réel depuis cet environnement. La validation live et la relecture des offres restent nécessaires; DEBT-039 n'est pas close sur la base de ces tests.
