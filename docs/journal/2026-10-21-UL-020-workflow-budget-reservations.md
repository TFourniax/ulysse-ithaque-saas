# UL-020 — réservation budgétaire après échec du diagnostic

Responsable : Codex. Objectif : permettre la reprise du diagnostic acheteur sans que les enveloppes inutilisées des essais précédents consomment artificiellement les plafonds. Périmètre : comptabilité des workflows et des réponses tardives, diagnostic VPS, message utilisateur, intégration PostgreSQL et documentation. Aucune hausse de budget, nouveau fournisseur ou migration.

## Constat

La capture du diagnostic acheteur du 21 octobre à 17 h 46 (Europe/Paris) montre `budget_reached`. Elle ne montre ni les totaux de session/mois, ni les réservations, ni le profil actif. Elle ne prouve donc pas que le réglage Mistral à 6 000 tokens a été appliqué ou qu’un nouvel appel fournisseur a été effectué.

Le code confirme un défaut distinct : les chemins d’échec et d’expiration de buyer/content ne libéraient pas le reliquat de `reserved_usd`; une réussite avec coût incertain conservait aussi toute l’enveloppe. La réservation suivante additionne `greatest(reserved_usd,committed_usd)` aux appels de recherche. Des essais peu coûteux peuvent ainsi bloquer la session de 2 USD en retenant chacun l’enveloppe entière de 0,25 USD. Ces deux plafonds proviennent du dernier diagnostic transmis, pas de la nouvelle capture. La contribution exacte du défaut au refus VPS reste à mesurer.

## Correction

- Fin, échec, obsolescence et expiration libèrent seulement l’enveloppe inutilisée. Chaque appel transmis garde sa provision supérieure déjà enregistrée dans `committed_usd` si son coût reste inconnu.
- Une nouvelle analyse réconcilie les anciennes enveloppes terminales buyer/content de son tenant avant la réservation, avec maintien des coûts, erreurs et historiques. Aucun reset de session, de recherche ou de dépenses.
- Un usage reçu après l’arrêt ajuste les montants engagés et réservés sans autoriser la publication du résultat tardif.
- `diagnose-budget` affiche en lecture seule les plafonds actifs, engagements, réservations inutilisées, appels incertains, analyse récente et concurrence. Les agrégats suivent les contrôles de réservation existants; les éventuelles dépenses historiques inconnues restent comptées au plafond mensuel. Aucun secret, contenu métier, appel modèle ou redémarrage.
- Le message du diagnostic explique le refus de réservation et rappelle que les données de recherche sont conservées.

Décision et invariants : [ADR-0013](../adr/0013-november-workflows.md). Dette : DEBT-030.

## Vérification et limites

Scénarios ajoutés : anciennes enveloppes connues/incertaines et bail expiré, reprise sous le même plafond, isolation entre tenants, refus d’un run qui ne tient toujours pas après récupération, provision en vol et coût déclaré tardivement sans publication. Les tests existants de correction du format vérifient désormais aussi les réservations finales, y compris après 429. La requête du diagnostic VPS est exécutée telle qu’extraite du script dans le scénario PostgreSQL.

`npm run verify` réussi : format, lint typé strict, compilation, cycles, OpenAPI, 119 tests unitaires et liens documentaires. Contrôles Bash et neuf tests de configuration VPS réussis. CI PostgreSQL/Hermes à exécuter avant proposition de déploiement : Docker et PostgreSQL ne sont pas disponibles localement. Aucun accès SSH ni génération réelle depuis cet environnement. Le budget peut rester bloquant si les engagements connus ou incertains atteignent réellement un plafond; la correction ne contourne pas ce refus.
