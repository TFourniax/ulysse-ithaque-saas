# ADR-0016 — Recherche publique persistante et benchmark à valider

Date : 2026-10-21. Statut : implémentation proposée dans UL-020, recette live requise.

## Problème

Le diagnostic acheteur ne disposait que des sources importées manuellement. L’absence de corpus concurrentiel aboutissait à une abstention, même lorsque les informations existaient sur le web. Thomas demande que la collecte et la qualification soient préparées par Ulysse, puis soumises à revue.

## Décision

Ajouter une campagne de recherche distincte d’un appel Hermes et de la connaissance approuvée. Le propriétaire autorise un profil **public** (nom, site, offres, cible, marché, zone et mots-clés). Les données CRM et le brief privé ne sont pas transmis au moteur de recherche. Une campagne est réutilisée par le diagnostic si son profil, le contexte et sa fraîcheur conviennent; sinon Ulysse en prépare une nouvelle. Les informations privées absentes restent des questions ciblées.

Le worker exécute des étapes persistées dans PostgreSQL : lecture du site, plan de requêtes, découverte, lecture HTML, extraction structurée, qualification et enrichissement. Un job traite une étape puis rend la main. Les requêtes couvrent noms, offres, besoins, marché, secteur, géographie et substitutions; leur pagination continue tant que le fournisseur fournit des résultats et que de nouveaux domaines apparaissent. Les liens de pages réellement lues servent aussi à découvrir des acteurs. Les pages d’offres, de tarifs, d’intégrations et de références sont recherchées et suivies. Les étapes restantes sont conservées lorsqu’une enveloppe est atteinte.

Premier adaptateur : **Brave Web Search**, derrière le port `SearchProvider`. Ses résultats servent à découvrir des URLs; les snippets ne deviennent pas des preuves. Son endpoint fixe reçoit uniquement le profil public et ses déclinaisons. Ne pas présenter ce fournisseur comme un traitement Europe/ZDR : la contrainte Europe/ZDR des modèles reste appliquée séparément par le profil OpenRouter existant. Le tarif de recherche est configurable côté serveur et comptabilisé comme estimation, sans déduire d’éventuels crédits gratuits.

Références du fournisseur consultées le 21 octobre : [API Web Search](https://api-dashboard.search.brave.com/app/documentation/web-search/get-started), [offre API](https://brave.com/search/api/). Pagination documentée : 20 résultats et offsets de 0 à 9; coût affiché de l’offre Search : 5 USD pour 1 000 requêtes. Ces paramètres doivent être recontrôlés lors d’un changement d’offre.

La lecture utilise HTTPS, vérification de toutes les adresses DNS et connexion à une adresse validée, validation de chaque redirection, refus des réseaux privés et protocoles non autorisés, robots.txt, délais et tailles bornés. Aucun cookie, secret applicatif, navigateur exécutant du JavaScript, contournement de connexion ou action externe n’est fourni aux pages. `parse5` 8.0.1 extrait le texte et les liens; `ipaddr.js` 2.5.0 qualifie les adresses; `robots-parser` 3.0.1 lit les règles d’accès. Dépendances directes verrouillées et installées; Zod valide les frontières fournisseur.

L’extraction utilise le modèle configuré et ses règles de routage actuelles, via un appel structuré sans outil réseau. Une seule fonction de réponse est autorisée. Chaque fait cite un extrait exact présent dans le texte lu; chaque lien suggéré doit exister dans la page. Le résultat conserve offre, dimension, valeur, citation, page, empreinte, date de lecture et date de publication quand disponible. Un résultat commercial annoncé reste une déclaration fournisseur, y compris après approbation humaine. Le modèle ne peut pas fabriquer une preuve corroborée ni un score de confiance.

Les domaines sont dédoublonnés de façon conservatrice (`www` normalisé, autres sous-domaines distincts). Les différentes offres et conditions tarifaires restent distinctes. Les fiches hors périmètre et les erreurs de collecte sont conservées. Pas de fusion automatique entre sociétés sur simple similarité de nom. Le corpus complet est consultable et filtrable par pages de 25 fiches. La synthèse acheteur reste courte; les lectures par lots et la pagination des métadonnées remplacent l’assimilation du plafond de huit sources choisies à une limite de collecte.

Les décisions humaines sont versionnées dans une table séparée, avec un instantané des faits relus. Une correction est attribuée à la revue et ne remplace jamais une citation. Les nouvelles preuves remettent la fiche à relire. Toute évolution de la campagne change l’empreinte des diagnostics dérivés. Un brouillon peut utiliser des preuves provisoires identifiées; son approbation exige la revue des preuves de recherche qu’il cite.

La migration additive 0014 crée les politiques, campagnes, tâches, candidats, pages, appels et revues avec RLS forcée et clés composites tenant. Les permissions de l’API et du worker restent distinctes. L’autorisation active du propriétaire et les versions sont revérifiées avant collecte, réservation et publication. L’arrêt de la recherche ne supprime pas son historique; il empêche la publication de la réponse d’un appel déjà en vol.

Les réservations de recherche et de modèle utilisent le même verrou financier que les parcours existants, avec un plafond par campagne, par session et par mois. Une réponse perdue conserve son coût supérieur réservé. Les reprises n’effacent ni appels ni dépenses. Les plafonds historiques de 2 USD/session et 10 USD/mois restent en vigueur. Un changement de fournisseur ne réinitialise pas ces compteurs.

## Limites de cette première implémentation

Les contenus rendus uniquement en JavaScript, PDF et accès authentifiés restent signalés non exploitables. La collecte n’est jamais dite exhaustive. La corroboration indépendante, la résolution automatique d’alias entre domaines, la normalisation tarifaire approfondie et une veille planifiée hors demande de diagnostic restent à compléter. Les prix sont présentés avec les conditions extraites, sans classement automatique. La qualité sémantique de la qualification et du benchmark doit être évaluée sur le cas Paitite avec le fournisseur réel.

Le connecteur doit être activé sur le serveur avec une clé Brave, puis le profil public autorisé dans l’application. Aucun secret n’est demandé dans le chat. L’implémentation locale et les tests avec fournisseurs scriptés ne constituent pas cette recette live.
