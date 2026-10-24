# UL-022 — Sélection des alternatives et bilan de comparaison

Responsable : Codex. Date : 24 octobre 2026. Dette : DEBT-041.

## Observation

Thomas transmet un diagnostic live achevé à 02 h 34 (Europe/Paris). Le résultat compare deux alternatives, cite une troisième fiche pour expliquer son exclusion et affiche quarante fiches disponibles. Le bilan ne distingue pas suffisamment ces périmètres. Les comparaisons restent partielles, dont une offre destinée surtout aux grandes entreprises; du vocabulaire interne subsiste. Le contenu client n'est pas recopié dans les tests. La révision déployée et les traces de lecture ne sont pas présentes dans ce texte; il ne démontre pas une fiabilité générale ni l'exactitude des sources.

Le lot précédent `2417ef5de8ae9705988cbb3465ec09665679d252` a passé [5 contrôles applicatifs](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/40032411022) et [8 contrôles Hermes/mises à niveau](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/40032411253), dont la continuation volumineuse. Ces contrôles utilisent des fournisseurs scriptés.

## Changements

- Priorité aux candidats ayant un besoin et une clientèle documentés en commun, puis à leur relation concurrentielle provisoire, avant le volume de mots-clés. Les autres candidats restent disponibles et l'ordre ne vaut pas validation sémantique.
- Premier lot jusqu'à six textes intégraux, au plus 32 000 octets et avec une réserve pour le catalogue, dans la même enveloppe initiale. Hermes conserve les outils et sa boucle pour approfondir ou remplacer les fiches faibles.
- Bilan déterministe : fiches disponibles, fournies à l'analyse, citées et utilisées dans les comparaisons. Les doublons, sources propres et références étrangères ne gonflent pas les comptes. Une fiche d'exclusion reste citée, sans être comptée dans la comparaison. Une même fiche pouvant décrire plusieurs offres, le libellé compte explicitement les fiches, jamais un nombre d'offres déduit. Le nombre de fiches à vérifier porte sur toutes les citations, y compris les exclusions, conformément au contrôle d'approbation. Les limites historiques ne sont pas accumulées à chaque recalcul.
- Instructions de génération et relecture : lectures complémentaires quand les premières offres sont hors cible ou incohérentes, attribution précise des articles multi-fournisseurs, bénéfices attendus reliés au besoin sans gain inventé, réserves regroupées et vocabulaire courant. Aucun quota bloquant ni nouveau schéma de résultat.
- Références du brief et de la méthode commerciale nommées lisiblement. La synthèse dérivée des fiches ne contient plus le libellé « digest ». Les faits, les citations et l'historique ne sont pas réécrits.

## Vérification et suite

Tests ciblés : prestataire adapté face à un comparatif riche en mots-clés et à un acteur mal qualifié; six textes complets et bornés; distinction citation d'exclusion/comparaison, traçage des fiches fournies, doublons et recalcul. `npm run verify` réussi (146 tests unitaires, types, lint, format, cycles, OpenAPI et liens), 17 tests avec la boucle Hermes épinglée et 14 tests du script VPS réussis localement. Le test PostgreSQL de publication vérifie aussi la présence des comptes tracés; la CI complète sera suivie sur la révision publiée. La pertinence des nouvelles comparaisons devra être relue sur un nouvel essai réel. Une modification de la synthèse dérivée peut rendre l'empreinte d'un ancien brouillon périmée; reprendre le brief régénère le résultat, sans relancer la collecte.
