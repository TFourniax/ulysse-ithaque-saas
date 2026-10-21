# UL-020 — Recherche et benchmark autonomes

Date : 2026-10-21. Responsable : Codex. Cadrage produit confirmé par Thomas. Première implémentation locale décrite dans l’[ADR-0016](adr/0016-recherche-publique-et-benchmark.md); recette d’intégration et activation VPS encore requises. Les critères ci-dessous décrivent la cible complète. La cible est une recherche proactive à partir du contexte d'entreprise, pas un chatbot ni un benchmark composé manuellement par l'utilisateur.

## Résultat attendu

Une lacune utile déclenche une investigation : informations existantes, recherche accessible, qualification, enrichissement, comparaison, propositions à valider. L'utilisateur reçoit des concurrents et des offres documentés, les raisons de leur pertinence, les différences et les incertitudes. Il confirme, corrige ou écarte des résultats préparés. Il ne saisit pas les textes de chaque concurrent.

| Information manquante | Comportement attendu |
| --- | --- |
| Offre, prix public, concurrent ou caractéristique accessible sur le web | Rechercher et lire les sources pertinentes, puis présenter les preuves |
| Information présente dans une source interne déjà autorisée | Consulter cette source avec les droits du tenant |
| Marge, prix négocié, choix stratégique ou fait interne non accessible | Poser une question ciblée après vérification des sources disponibles |
| Sources contradictoires, page inaccessible ou absence de preuve | Conserver des états distincts, chercher un recoupement, expliciter ce qui reste inconnu |

## 1. Comprendre le périmètre de comparaison

Partir des offres de l'entreprise, de leurs acheteurs, problèmes résolus, usages, zones desservies et contraintes. Une entreprise proposant plusieurs offres peut avoir plusieurs ensembles concurrentiels. Distinguer une ambiguïté à clarifier d'une information que l'agent peut découvrir. Le plan initial et ses changements sont consultables ; les requêtes externes ne reprennent pas les données privées d'une affaire.

## 2. Découvrir largement, par plusieurs axes

- Noms connus, marques, produits, anciens noms et variantes.
- Catégories d'offres, fonctionnalités, mots-clés métier, synonymes et vocabulaire des acheteurs.
- Besoins, problèmes et solutions alternatives ; recherche d'offres de substitution.
- Marché, secteur, segment de clientèle, spécialisation, géographie et langues pertinentes.
- Requêtes de comparaison et pistes apportées par annuaires, partenaires ou pages trouvées ; ces pages orientent la découverte sans devenir automatiquement des preuves.

Les résultats utiles enrichissent le plan : nouvelle catégorie, acteur, expression ou substitut à explorer. Plusieurs formulations d'une même requête ne suffisent pas à démontrer la diversité de la recherche. L'architecture doit permettre plusieurs fournisseurs de recherche ; disposer de plusieurs moteurs n'est pas supposé acquis.

La découverte n'est pas limitée à huit acteurs ni à une première page de résultats. Les nouveaux candidats pertinents par cycle, les axes couverts et non couverts, le coût et la raison d'arrêt sont conservés. Une saturation observée ou un budget atteint borne une campagne ; aucun résultat ne prétend couvrir exhaustivement tout le marché. Les limites sont configurables et une campagne peut reprendre son travail.

## 3. Résoudre les identités et qualifier la pertinence

Résoudre société, marque, produit et domaine sans confondre homonymes, revendeurs et entreprises distinctes. Fusionner les doublons avec des preuves d'identité, conserver les alias et les motifs d'exclusion. Les copies d'un même communiqué ne constituent pas des confirmations indépendantes.

Classer séparément concurrents directs, indirects et substituts. La présence du même mot-clé ne suffit pas : expliciter les recouvrements de besoin, cible, offre et zone desservie. Conserver les acteurs découverts hors périmètre avec leur motif d'exclusion, sans les présenter comme concurrents validés. La profondeur d'enrichissement dépend de cette pertinence.

## 4. Enrichir les offres par des faits traçables

Lire d'abord les pages d'offres, fonctionnalités, prix, documentation, conditions commerciales publiques et cas clients officiels. Recouper les affirmations importantes quand des sources indépendantes pertinentes existent. Un extrait de moteur sert à découvrir une page ; il ne remplace pas sa lecture.

Pour chaque acteur et offre : cible, besoin, périmètre, modalités, intégrations, prix public et conditions associées, promesse, preuves présentées, positionnement, limites et questions non résolues. Les prestations sur mesure et les abonnements ne deviennent pas des prix directement comparables sans leurs unités et conditions.

Chaque fait conserve son URL, son titre, la date de collecte, la date de publication si identifiable, un extrait justificatif limité, la version/empreinte de source et la relation exacte à l'acteur/offre. Distinguer observation, déclaration de l'entreprise, recoupement externe, inférence et hypothèse. La validation de l'utilisateur ne transforme pas une promesse commerciale en résultat mesuré.

Une donnée absente d'une page n'est pas une fonctionnalité inexistante. Prix non publié, information non trouvée, page inaccessible, contradiction et source périmée restent des états différents. Aucun score numérique de confiance sans calibration.

## 5. Construire un benchmark comparable et relisible

Établir une grille commune dérivée de l'offre et des critères d'achat : critères partagés, différences de périmètre, valeur annoncée, preuves, conditions, coûts comparables et inconnues. Chaque cellule contient des faits sourcés ou un état explicite ; aucune moyenne ne comble un prix absent. Les détails sont accessibles depuis la synthèse.

Le corpus complet reste consultable avec recherche, filtres et pagination. La synthèse met en avant les alternatives les plus pertinentes sans effacer les autres candidats ni masquer la couverture. Le diagnostic distingue ressemblances, différences étayées, promesses non prouvées, objections possibles et pistes à vérifier. Le verdict d'unicité demeure borné au périmètre et aux preuves.

## 6. Valider sans imposer une corvée de saisie

Présenter des fiches enrichies et une matrice provisoire avant validation, avec leurs états. L'utilisateur peut confirmer ou exclure un concurrent, corriger une qualification, accepter ou contester des faits, puis valider le diagnostic. Les opérations groupées sont possibles ; aucun clic de confirmation par page collectée n'est requis.

Séparer état de collecte, qualité des preuves et décision humaine. Une découverte non validée peut nourrir un brouillon explicitement provisoire ; elle ne devient pas silencieusement une connaissance d'entreprise approuvée ou une instruction de doctrine. Les décisions sont attribuées, versionnées et réutilisées aux campagnes suivantes. Les contenus dérivés restent soumis à revue avant toute publication.

## 7. Organiser la recherche dans l'application

Proposition d'architecture : une campagne durable s'exécute en arrière-plan via les jobs existants, avec un plan et des étapes séparées de recherche, lecture, extraction, résolution d'identité, qualification et comparaison. Un changement pertinent du contexte ou une lacune déclenche la campagne dans la politique de collecte autorisée. La fraîcheur peut également motiver une nouvelle collecte, sans la configurer comme une automatisation ChatGPT.

Les modèles travaillent sur des lots de preuves ; le stockage canonique conserve l'ensemble des acteurs, offres et faits. La limite actuelle de huit sources et le délai de 90 secondes appartiennent à une analyse UL-017 : ils ne conviennent pas comme plafond global d'une recherche étendue. Étendre les contrats et les références, paginer, puis assembler les résultats intermédiaires sans mettre tout le web dans un seul prompt. Conserver le parcours actuel pendant cette évolution.

Chaque étape doit être idempotente et reprenable après panne, avec déduplication, version des entrées, progression, compteurs et coût. Les budgets recherche/collecte et inférence sont suivis ensemble au niveau de la campagne, sans reset lors d'un retry ou d'un repli modèle. Une modification de source déclenche la revalidation des faits et résultats dépendants ; une décision humaine passée ne vaut pas validation d'un nouveau contenu.

Les nouveaux outils réseau passent par des adaptateurs contrôlés : URL publiques autorisées, redirections et adresses privées vérifiées, formats et tailles bornés, contenu web traité comme donnée non fiable. Aucun secret de connecteur, document interne ou accès inter-tenant n'est donné aux pages consultées. Une restriction d'accès est signalée, pas contournée. L'autorisation de rechercher ne vaut pas autorisation de contacter un concurrent ou de publier.

## Critères de recette

1. Depuis le contexte, l'offre et le domaine d'une entreprise, sans page concurrente importée, produire plusieurs familles de requêtes et découvrir des acteurs pertinents ; présenter les traces et les exclusions.
2. Démontrer le traitement d'un corpus de plus de huit sources par lots, avec dédoublonnage, comparaison sourcée et liens consultables. Le nombre de sources ne constitue pas une preuve de qualité.
3. Tester homonymes, plusieurs produits d'une société, copies de pages, concurrent hors segment, prix publics incomparables, sources contradictoires, page inaccessible et données périmées.
4. Vérifier qu'une information publique manquante déclenche une recherche ; qu'une donnée interne inaccessible produit une question précise ; qu'un échec de collecte n'est pas présenté comme une absence de fonctionnalité.
5. Vérifier la revue humaine et la conservation des exclusions, corrections et faits approuvés ; une nouvelle version doit rendre visible la différence à relire.
6. Tester reprise après panne, budgets, annulation, isolation des tenants, contenu malveillant dans une page et redirections non autorisées ; aucune double publication ni fuite de données privées.
7. Effectuer une recette réelle sur Paitite avec un fournisseur de recherche raccordé, relever coût/délai et faire relire un échantillon de pertinence et de fidélité des faits. Une fixture, un document ou un benchmark réalisé manuellement dans une conversation ne prouve pas l'autonomie du SaaS.

## État et dépendances

Le périmètre produit est confirmé. Contrats, migration additive 0014, jobs, adaptateurs Brave/lecture publique, extraction structurée, matrice, revue et liaison aux diagnostics sont implémentés sur `codex/ul-020-web-research`. Le modèle existant et les contraintes Europe/ZDR sont conservés; Brave reçoit seulement le profil public autorisé et n’est pas présenté comme un fournisseur Europe/ZDR.

Les contrôles locaux n’établissent pas encore la recette PostgreSQL/Keycloak/stack ni la qualité sémantique live. Il reste à activer le fournisseur sur le serveur puis réaliser le cas Paitite. La fusion d’alias entre domaines, les recoupements indépendants, la réutilisation des décisions d’une campagne à l’autre, la correction structurée de qualification et la veille planifiée restent des écarts explicites à la cible. Le benchmark conserve les prix et conditions extraits sans les normaliser ni les classer automatiquement.

Voir [activation et recette](RESEARCH-OPERATIONS.md) et [journal des vérifications](journal/2026-10-21-UL-020-research-implementation.md). Les outils web de cette conversation ne constituent pas le fournisseur de production d’Ulysse.
