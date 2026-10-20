# UL-017 — Assemblage des trois parcours de novembre

Objectif confirmé le 20 octobre : assembler client synthétique → crash test de l'unicité, contenus contextualisés et prochaine interaction par affaire avant de charger une entreprise fictive.

Responsable : Codex. Branche : `codex/ul-017-november-workflows`, base UL-016 `0282c198d9b21e2ccaaf37f42d29ca0600c6cc6b`. PR UL-016 #3 ouverte et draft ; aucune fusion ni modification du VPS.

Périmètre : domaine, contrats, migration additive, API, worker/Hermes, interface, tests et documentation. Les PDFs privés ne sont pas publiés. Aucun tenant de démonstration supplémentaire n'est chargé par la migration.

[PR draft #5](https://github.com/TFourniax/ulysse-ithaque-saas/pull/5), empilée sur UL-016. Première version publiée : `80a13274229a9ae5b84821568d3e16a32773ca8b`.

Validation locale : `npm run verify`, `npm run build`, compilation Python. Docker et PostgreSQL locaux indisponibles ; Chromium non téléchargeable ici. La validation complète est exécutée dans la CI du dépôt.

[CI application du premier head](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/39449505513) : cinq jobs verts (Linux, Windows, PostgreSQL/API/worker, navigateur, stack et sauvegarde/restauration). PostgreSQL 50/50, API 18/18, worker 25/25. Les contrôles nouveaux couvrent le chaînage buyer → content, les questions préalables, le rejeu, le retrait concurrent, la péremption, les rôles et l'isolation tenant. La boucle Hermes officielle avec endpoint modèle simulé est également verte dans [UL-016 validation](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/39449505529).

Finition : les principes métier deviennent éditables et visibles dans la doctrine ; les instructions de prochaine interaction portent leur propre version dans l'empreinte des analyses afin qu'un changement de consignes ne réutilise pas un ancien run. Captures navigateur desktop/mobile conservées par la CI.

Limites : aucune inférence fournisseur live ni validation de pertinence métier ; collecte et veille web automatiques non raccordées ; le VPS déclaré par Thomas n'a pas été inspecté ni modifié. Les sources privées ne sont pas publiées. Le scénario d'entreprise fictive décrit dans le guide constitue la prochaine recette métier, sans préchargement sur le VPS.


## Consolidation

Head fonctionnel `05abe528b59034ef33230e8074b445754e6ea2b8` : [CI cinq jobs verts](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/39450174383) et [quatre jobs Hermes/stack/upgrade verts](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/39450174358). Les 14 parcours navigateur passent sur desktop/mobile, sans violation sérieuse ou critique détectée par axe sur les nouveaux écrans. Les [captures](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/39450174383/artifacts/12278086101) ont été relues : correction finale des styles des champs URL et date. Les contrôles locaux comptent 78 tests unitaires réussis.

Prêt pour installer la branche en environnement de démonstration et poursuivre la recette métier sur l'entreprise fictive. Restent explicitement hors validation : fournisseur live, qualité métier, collecte/veille web automatique et état du VPS. Le lot reste partial pour ces raisons ; aucune demande d'approbation ni décision métier n'est inventée.
