# UL-020 — reprise des refus temporaires pendant un diagnostic

Date : 21 octobre 2026. Responsable : Codex. Statut : correctif `d4e97ec70e6bc86615ecb4f58abe6247ae94bc5b` publié; 11 jobs CI verts; recette réelle ouverte. Dette : DEBT-023; DEBT-032 reste ouverte pour la recette réelle.

## Constat et objectif

La capture du diagnostic de 23 h 11 (Europe/Paris) affiche `provider_http_429`. La capture OpenRouter affiche des appels Mistral Small 4 / Mistral EU acceptés à 23 h 08 et 23 h 12. Elle n’affiche ni identifiant permettant de corréler les lignes au run, ni réponse du refus, ni délai conseillé. Le SHA actif n’est pas visible. On ne peut donc pas attribuer le quota à un composant précis ni conclure que l’ancien problème de schéma est résolu.

Le code confirme que la passerelle lisait déjà `Retry-After`, mais arrêtait buyer/content au premier 429/503. Objectif : poursuivre un appel temporairement refusé sans recommencer le travail déjà accompli et sans modifier le modèle, la route Europe/ZDR, les données ou les plafonds financiers.

## Changements

- `workflow-retry.ts` borne les reprises à deux par run, 30 puis 60 secondes sans indication fournisseur, ou délai indiqué; attente de 120 secondes maximum compatible avec le bail restant.
- `agent-runtime.ts` conserve messages, outils et raisonnement de ce tour; revalide chaque transmission, provisionne chaque tentative et empêche un appel pendant l’attente. Le compteur et les métadonnées techniques sont persistés sous verrou. Annulation/déconnexion interrompent l’attente.
- `workflow-runtime.ts`, la file et le superviseur permettent 180 secondes au parcours; contrat privé v3 pour empêcher le mélange de superviseurs limités à 90 secondes et de nouveaux workers. Affaires inchangées.
- L’interface indique l’attente automatique. Le script `research8-retry` ajoute `provider_retries` et `provider_retry` au diagnostic en lecture seule.
- Le modèle scripté injecte un 429 après des outils; le smoke novembre exige sa reprise dans la vraie boucle Hermes pour buyer et contenu. Tests PostgreSQL : reprise 429/503, payload identique, coût conservé, épuisement, délai trop long, budget, expiration, révocation et annulation.

## Vérification

Code **`d4e97ec70e6bc86615ecb4f58abe6247ae94bc5b`** publié : [CI applicative 5/5](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/39682332894) et [Hermes/mises à niveau 6/6](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/39682333003), deux workflows terminés avec succès. `npm run verify` réussi : 123 tests unitaires. PostgreSQL 50/50, API 18/18, worker 48/48, navigateur 15/15, 11 tests du script VPS et huit tests Python dans l’image Hermes (six ciblés localement). La migration additive 0016 et les enveloppes relevées passent sous les rôles réels. Le modèle scripté refuse une requête après des outils; buyer/content reprend le même tour dans Hermes sur stack neuve et après mise à niveau UL-016. Historique, session, signatures de raisonnement et redémarrage sont vérifiés. Aucun appel fournisseur réel ni déploiement VPS depuis cet environnement.

Premier code `44f8b934d4f9deaae87cdfaea3f1660951aa4efa` : `npm run verify` réussi, 122 tests unitaires, neuf tests VPS et six tests Python ciblés. Le scénario Hermes sur stack neuve réussit la reprise après 429, schéma natif et continuité du raisonnement compris. La CI PostgreSQL a exposé un cas réel : un retrait de source pendant l’attente clôt déjà le run, donc le catch ne libérait pas son reliquat. Le complément libère ce reliquat même après clôture, sans toucher au coût engagé. Le test a été conservé; ce code et les nouveaux plafonds passent dans la CI finale citée ci-dessus.

Références officielles consultées : [OpenRouter limites](https://openrouter.ai/docs/api_reference/limits), [erreurs et Retry-After](https://openrouter.ai/docs/api_reference/errors-and-debugging). Un 429 peut provenir de la plateforme ou du fournisseur amont; les appels acceptés n’établissent pas la disponibilité de tous les appels suivants.

## Limites et suite

Les fournisseurs restent simulés dans les tests. Les reprises bornées absorbent un refus temporaire, pas un quota durablement épuisé. Au-delà des délais, du nombre d’appels ou des budgets, le diagnostic reste en échec avec le code fournisseur; aucun résultat incomplet n’est publié. Le prochain diagnostic réel doit être testé puis relu après déploiement. La recherche existante peut rester en pause. Ni nouveau modèle ni fallback régional ne sont ajoutés par ce lot.

## Priorité et enveloppes révisées pendant l’implémentation

Thomas autorise ensuite un budget raisonnablement plus élevé et précise que l’achèvement utile passe avant les économies de quelques centimes. La configuration préparée devient 2 USD/analyse, 20 USD/session et 100 USD/entreprise/mois, appliquée par `deploy COMMIT --budgets 2 20 100`. L’application valide ces nouvelles bornes; la migration additive 0016 adapte les fonctions de réservation sans modifier les anciennes migrations, les autorisations, les verrous ni l’historique comptable. Sans option, un déploiement garde la configuration active.

La recherche propose 3 USD pour une nouvelle campagne, configurable jusqu’à 10 USD; une extension ajoute un dollar. Les campagnes existantes restent disponibles avec leur enveloppe actuelle. Le contrat HTTP et l’OpenAPI sont alignés. Les tests vérifient la nouvelle configuration, le retour arrière avec les anciens réglages, la réservation workflow à 2 USD et les réservations recherche dans une campagne à 3 USD, puis le refus au-delà des bornes. Ces montants ne sont ni un devis fournisseur ni un prix SaaS.
