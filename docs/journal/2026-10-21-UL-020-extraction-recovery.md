# UL-020 — extraction sourcée, coûts et reprise après refus fournisseur

Date : 21 octobre 2026. Responsable : Codex. Objectif : corriger les fragilités révélées par la première collecte Paitite et reprendre ses extractions sans recommencer la découverte. Branche `codex/ul-020-web-research`, PR #8, base du correctif `c6aee46`.

## Preuve live fournie

Le diagnostic SQL en lecture seule exécuté sur le VPS confirme : Mistral Small 4 Europe/ZDR, sortie maximale 3 000 tokens, raisonnement désactivé et Brave configuré. La campagne créée à 13 h 24 (Europe/Paris) est en pause après 429, avec 31 recherches réussies, 47 lectures tentées dont 40 pages sauvegardées. Les extractions comptent 5 tâches terminées, 9 en `research_schema_invalid`, 25 en `research_step_failed` et 1 en attente après 429. Paitite dispose de 22 faits sur 15 pages; les autres fiches sont 1 annuaire et 346 non qualifiées, sans fait.

Le registre comprend 39 tentatives d’extraction Mistral, trois tentatives d’extraction GLM et un plan GLM. Les 13 appels incertains restent provisionnés. Les coûts modèle déclarés totalisent 0,048220 USD, Brave est estimé à 0,155000 USD, les provisions inconnues à 0,085168 USD, soit 0,288388 USD engagés au sens applicatif. Cela ne constitue pas une facture fournisseur finale.

Les anciennes erreurs génériques ne distinguent pas citations non retrouvées, liens non observés, JSON mal formé et erreurs de publication. Aucune réponse brute n’est disponible pour les attribuer rétroactivement. L’inspection de code établit deux fragilités : validation de tous les faits/liens en bloc et perte de l’usage retourné quand le décodage échoue. Les tests reproduisent ces cas sans utiliser de données du tenant.

## Changement

- `research-evidence.ts` et `research-model.ts` : protocole `research-v2`, passages exacts bornés et liens identifiés. Le modèle sélectionne des identifiants et rédige les résumés; la citation et l’URL sont reprises des données lues. Huit faits courts demandés, sans hausse de tokens. Validation stricte de l’identité/qualification, rejet individuel des faits et liens invalides, refus des réponses tronquées. La validation de domaine exacte reste active et la revue humaine conserve la responsabilité de vérifier la pertinence sémantique.
- `research-runtime.ts` : coût connu conservé en cas d’erreur de résultat, plafond toujours vérifié, code et métadonnées techniques par tentative. Les erreurs d’extraction apparaissent aussi sur la fiche concernée, puis sont retirées après réussite de cette page. Aucun contenu fournisseur ou collecté ajouté aux logs.
- `agent-errors.ts`, `research-store.ts`, `runtime.ts` : lecture bornée de `Retry-After`; deux reprises automatiques au maximum sur 429/503 recherche, délai de 60 puis 120 secondes allongé par le fournisseur, pause manuelle au-delà de 900 secondes. Compteur et délai persistés dans le résumé de tâche, outbox différée, garde du délai à la prise de tâche. Réservations, versions, autorisation, bail et isolation conservés. Pas de fallback de modèle ni de modification de la politique buyer/content.
- Interface recherche : message d’attente/refus explicite et reprise sans hausse automatique de budget après erreur. Le bouton d’extension demeure sur les limites de budget/collecte. Les recherches réussies et pages sauvegardées sont réutilisées.
- Script VPS : diagnostic par appel ajouté, sans déployer ni exposer de payload. Aucun changement de profil, route, prix, migration ou clé. [ADR](../adr/0016-recherche-publique-et-benchmark.md).

## Vérification et limites

`npm run verify` est vert : format, lint typé strict, TypeScript, cycles, OpenAPI, 115 tests unitaires et contrôle de 62 fichiers Markdown. Les 25 tests unitaires worker comprennent les passages exacts, Unicode et limites, l’élément invalide isolé, la référence inventée, JSON/schéma/troncature avec coût conservé et Retry-After. Syntaxe Bash et neuf tests du script VPS également verts.

Code publié : **`2aa3d7e03a210ceff6ef4a8b6c8b91d53a949b32`**. [CI applicative 5/5](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/39600654182) et [Hermes/mises à niveau 6/6](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/39600654513) vertes, dont PostgreSQL 50/50, API 18/18, worker 39/39 et navigateur 15/15. La construction, le redémarrage, la sauvegarde/restauration et la mise à niveau depuis UL-016 avec session et historique conservés sont également verts. Les commits documentaires suivants épinglent ce SHA; ils ne modifient pas son code.

Les trois nouveaux tests d’intégration PostgreSQL vérifient : adaptateur réel avec réponses fournisseur scriptées, qualification de dix domaines fictifs, reprise d’une extraction sans nouveau crawl/recherche, erreurs par tentative, temporisation persistante et bornée malgré duplication/redémarrage, et dépassement de provision connu. Le test navigateur vérifie la reprise après erreur sans champ de hausse de limites. Ces résultats proviennent de la CI avec PostgreSQL et Keycloak réels; les réponses modèle et web restent scriptées.

Aucun appel d’inférence depuis cet environnement, aucune réussite live annoncée pour le nouveau protocole. La cause précise de chaque ancien refus reste inconnue. Les anciennes provisions ne peuvent pas être corrigées sans preuve de facturation. La couverture et la qualité du benchmark Paitite doivent être relues après mise à niveau et reprise de la campagne existante.

## Reprise sur le VPS

La [procédure](../RESEARCH-OPERATIONS.md) épingle le code vérifié et conserve Mistral, Brave et les plafonds actifs. Après déploiement réussi, recharger Recherche et benchmark puis **Reprendre la collecte** sur la campagne existante créée à 13 h 24. Son plafond reste 1 USD; les étapes en échec sont réessayées et les extractions reprennent les pages sauvegardées. Les 13 provisions historiques restent visibles. Le script déployé `ulysse-research.sh diagnose-research` expose les nouveaux résultats techniques par appel. Recette suivante : qualification concurrentielle, fidélité des résumés aux citations et revue d’un échantillon Paitite, DEBT-024.
