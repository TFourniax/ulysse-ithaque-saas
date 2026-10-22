# UL-020 — pertinence et couverture du benchmark acheteur

Date : 22 octobre 2026. Responsable : Codex. Dette : DEBT-033; recette sémantique DEBT-024 toujours ouverte. Statut : implémentation et vérification en cours.

## Constat

Le texte transmis par Thomas montre un diagnostic acheteur live complet à 11 h 59 (Europe/Paris), lié à la campagne existante. Il compare une catégorie d’ESN et une agence située à Montréal pour un acheteur de PME en PACA. Il contient des affirmations générales non établies par ce seul texte et cinq tirets vides à la copie de la rubrique des limites. Le contenu exact des pages citées, le modèle actif et le SHA déployé n’ont pas été consultés ici.

Le code confirme une liste de concurrents ordonnée alphabétiquement, sans résumé d’offre/cible permettant un choix éclairé. Les premiers faits collectés remplissent le digest avant les critères ultérieurs. Les limites sont des chaînes non vides validées mais rendues dans un élément details fermé; la copie seule ne démontre pas des valeurs vides en base.

## Changements

- Priorité de lecture selon les faits et le brief, sans exclure les prestataires distants ni modifier les décisions humaines. Pas de score de confiance.
- Catalogue compact de recherche fourni avant le premier choix d’outil, avec pagination explicite si le contexte ne permet pas tout. Les aperçus ne sont pas citables : lecture réelle toujours exigée. Lots jusqu’à six sources.
- Diversité des dimensions dans les digests et dates de collecte dans les preuves; pas de réécriture des citations.
- Instructions pour comparer plusieurs entreprises/offres nommées selon les mêmes critères, expliquer la pertinence géographique, distinguer catégories/articles, inconnues et défauts prouvés. Pas de remplissage pour atteindre un nombre minimal.
- Couverture du benchmark calculée depuis les citations et affichée parmi les limites, désormais visibles sans déplier une rubrique.

Fichiers : domaine de sélection et workflows, magasins de recherche/workspace, passerelle et runtime worker, prompt et plugin Hermes, carte de diagnostic web, tests unitaires/worker/navigateur. Pas de migration ni de modification des plafonds, modèle, clé ou route active.

## Vérification

Vérifications locales et CI à compléter avant publication. Les tests visent un acteur pertinent après trente domaines alphabétiques, la conservation d’une alternative distante, un catalogue de 36 fiches, une pagination bornée en octets, la diversité des preuves et le comptage exact des citations. Le scénario PostgreSQL existant vérifie la transmission du catalogue sans autoriser une citation avant lecture; la recette navigateur vérifie la visibilité des limites.

## Limites et recette

Le classement lexical et les consignes améliorent l’accès aux données; ils ne prouvent pas la pertinence d’un acteur ni la fidélité sémantique d’une comparaison. Les anciennes extractions restent conservées et peuvent nécessiter exclusion/correction. Aucun appel fournisseur réel ni accès au VPS dans cet environnement.

Après déploiement des deux images, ouvrir le diagnostic existant, choisir Reprendre ce brief puis relancer sur la même campagne en pause. La collecte n’a pas à repartir pour tester ces changements. Relire les acteurs choisis, le recouvrement de besoin/cible/zone, les comparaisons bilatérales, les inconnues et les citations. Ne pas approuver un benchmark contenant une catégorie générique présentée comme société, une absence inférée de pages non lues ou une disponibilité locale supposée.
