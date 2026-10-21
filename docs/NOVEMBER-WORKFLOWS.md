# Bêta de novembre — trois parcours assemblés (UL-017)

Périmètre confirmé par Thomas le 20 octobre 2026 : ces trois capacités sont vendues pour novembre. Elles sont toutes prioritaires. L'entreprise fictive vient après l'assemblage ; aucune entreprise supplémentaire n'est insérée par la migration.

| Parcours | Entrées | Résultat attendu |
| --- | --- | --- |
| Client synthétique | Offre, cible, site et communication, alternatives documentées | Compréhension de l'offre, bénéfices et preuves, objections, benchmark, questions d'achat simulées et crash test de l'unicité |
| Contenu contextualisé | Cible, phase de décision, progression attendue, canal, contraintes, contenus existants, demandes observées, diagnostic acheteur lié | Questions de cadrage si nécessaire, puis texte et appel à l'action expliqués et sourcés |
| Prochaine interaction | Affaire, échanges, rôle des interlocuteurs, contexte et doctrine | Interaction qui fait progresser le client : question utile, résultat observable, preuve attendue, échéance proposée ou convenue |

## Comportement cible confirmé le 21 octobre

Ulysse doit compléter lui-même les informations accessibles : découverte web concurrentielle par plusieurs axes, collecte, qualification, enrichissement, benchmark sourcé puis revue humaine. Le lot [UL-020](WEB-RESEARCH-BENCHMARK.md) est implémenté localement; sa recette d’intégration et live reste ouverte. Le parcours d’import manuel ci-dessous reste celui de la version VPS rapportée par Thomas.

Dans la version UL-020, ouvrir **Recherche et benchmark**, vérifier le profil public prérempli et ajouter le domaine officiel. Une autorisation déclenche la première campagne et permet les recherches suivantes avant un diagnostic lorsque le contexte ou la fraîcheur l’exigent. Aucun concurrent n’est à importer. Les offres sont présentées dans une matrice paginée avec citations, dates, inconnues et erreurs de lecture. Valider, corriger ou écarter les fiches, éventuellement par sélection groupée, puis préparer le diagnostic. Un brouillon utilisant des preuves provisoires doit être régénéré après leur revue, car celle-ci change leur version. Le contenu issu du diagnostic conserve les mêmes dépendances.

La collecte continue dans une enveloppe explicite, avec progression et reprise. Une configuration fournisseur absente apparaît comme une collecte partielle. L’activation serveur, les limites et les contrôles live sont décrits dans [RESEARCH-OPERATIONS](RESEARCH-OPERATIONS.md).

## Parcours dans la version actuellement livrée

1. Renseigner le contexte de l'entreprise et valider une doctrine dans Administration. Les principes métier sont éditables dans une nouvelle version et visibles avant validation. La doctrine de démonstration existante reste fictive ; le corpus privé devra être importé et validé séparément.
2. Dans Sources métier, ajouter des extraits datés : offre/site, concurrents, contenus déjà produits, demandes observées. Une URL est une provenance, pas une collecte automatique. Les questions imaginées ont leur catégorie distincte.
3. Dans Client synthétique, préciser l'offre et la cible, sélectionner au plus huit sources, lancer. Une donnée manquante produit une question ; l'absence de concurrents interdit un verdict positif d'unicité.
4. Depuis un diagnostic actuel, utiliser « Créer un contenu à partir du diagnostic », renseigner phase, canal et progression attendue. Le diagnostic conserve son statut synthétique.
5. Relire les sources, limites et brouillons ; valider ou écarter. La validation ne publie rien à l'extérieur.
6. Les affaires et leurs recommandations continuent dans Opportunités / Prochaine interaction. Le prompt explicite désormais la progression du client, distincte d'une tâche interne du vendeur.

## Exécution et exploitation

La migration `0012_november_workflows.sql` ajoute deux tables sous RLS forcée, une fonction de retrait limitée au tenant et le discriminant des runs. `npm run db:migrate` crée également la file pg-boss `ulysse.workflow-run`. Aucune migration existante n'est modifiée.

L'API écrit une demande et son événement dans une transaction. Le worker lance les outils Hermes du parcours et réserve le budget commun avec les analyses d'affaires. Les droits restent ceux de l'entreprise : lecture pour tous ses membres, demande/revue pour reviewers et owners, corpus modifiable uniquement par owners. Aucun accès inter-entreprises ni outil d'écriture externe.

Modes :

- `rules` : les nouveaux parcours signalent que leur moteur n'est pas activé ; les questions de cadrage restent disponibles.
- `simulated` : le circuit lit les sources et s'abstient explicitement de produire un diagnostic métier. Ce mode ne remplace pas une recette de pertinence.
- `hermes-stub` : vraie boucle Hermes avec modèle scripté, corpus lu puis abstention explicite pour buyer/content ; les analyses par affaire conservent leur scénario UL-016. Aucun appel fournisseur ni validation de pertinence.
- `hermes-live` : moteur préparé, activation explicite et budgets UL-016 inchangés ; réservations et usages partagés. La restriction actuelle de configuration à l'environnement de démonstration demeure. L'ouverture aux données d'entreprises réelles relève de la recette fournisseur et du paramétrage des droits, pas d'une modification silencieuse de ces protections.

Toute mise à jour d'une source, du contexte ou de la doctrine rend les résultats concernés périmés et empêche l'approbation. Le retrait d'une source efface les résultats des parcours buyer/content de cette entreprise, y compris les copies d'exécution : invalidation conservatrice pour couvrir les réutilisations. Les recommandations par affaire restent dans leur circuit de retrait existant.

## Recette suivante, après assemblage

Utiliser une entreprise fictive autorisée, deux offres proches, une promesse différenciante non prouvée, des pages concurrentes, deux contenus déjà publiés, des requêtes consommateurs explicitement marquées comme fictives dans le scénario, et trois affaires (exploration, décision documentée, pause demandée). Ne pas présenter ces fixtures comme des données observées en production.

Vérifier : bénéfice distinct de fonctionnalité ; différence de marché bornée aux preuves ; questions synthétiques non promues en demande mesurée ; contenu conforme au canal, à la phase et à l'objectif ; prochaine interaction respectant le rôle et la pause ; obsolescence après modification ; conservation des décisions après redémarrage. Faire relire les sorties live par une personne métier.

## Limites à traiter avant ouverture de la bêta

- UL-020 raccorde la recherche web et le benchmark dans le code; CI d’intégration, déploiement et recette fournisseur restent à faire. La veille planifiée hors demande de diagnostic, les alias entre domaines et la corroboration indépendante ne sont pas livrés.
- Sources CRM et corpus client réel non raccordés. La doctrine privée reste à importer et à valider dans le tenant.
- Pertinence, qualité rédactionnelle et coût live à mesurer sur la recette fictive ; les tests structurels ne prouvent pas la qualité du raisonnement.
- Déploiement et état du VPS déclaré par Thomas non inspectés dans cette session ; aucun changement sur le serveur.

La branche et la PR contiennent le code déployable et la recette. « Assemblé dans le code » ne signifie pas « déjà activé sur le VPS ».

Compatibilité VPS : la lignée UL-016 `5a7cf27` est réconciliée avec UL-017. Conserver toutes les migrations historiques ; 0013 ajoute le mode stub aux nouveaux parcours sans modifier 0012. Reconstruire l’application ET Hermes/model-stub ensemble. Les outils et le prompt sont contrôlés selon le parcours, les coûts simulés restent séparés des coûts live.
