# Contribution et passation

## Avant le travail

Lire AGENTS.md et STATUS. Vérifier branche, état de travail, PR ouvertes et contrats. Choisir UL-nnn et un objectif mesurable. Les tâches du fichier BACKLOG font foi tant qu'une migration explicite vers GitHub Issues n'a pas eu lieu : ne pas entretenir deux statuts divergents.

Dans la tâche : responsable, état (todo/in-progress/partial/blocked/done), dépendances, périmètre de fichiers, condition de clôture. En cas de co-développement, annoncer le périmètre et coordonner les fichiers partagés avant modification. La conception doit permettre plusieurs intervenants ; elle ne requiert pas que plusieurs agents soient lancés dans chaque session.

## Pendant le travail

1. Établir le scénario utilisateur et les critères d'acceptation.
2. Modifier le plus petit ensemble cohérent.
3. Vérifier les invariants touchés : tenant, droits, provenance, fraîcheur, idempotence, reprise et validation.
4. Consigner toute décision structurelle dans docs/adr.
5. Garder les migrations, contrats et documentation alignés avec le code.
6. Lier toute dette au lot qui doit la résoudre.

Branches suggérées : feat/UL-nnn-description, fix/UL-nnn-description, docs/UL-nnn-description.
Commits : objectif explicite, identifiant UL-nnn, pas de secret dans les messages.
Les revues portent sur le diff réellement proposé et sur les résultats au même commit.

## Livrer une PR

Décrire : déclencheur/problème, comportement obtenu, périmètre, vérifications et limites.
Utiliser .github/pull_request_template.md.
Ne pas fusionner une PR dont une vérification requise est rouge ou inconnue.
Ne pas considérer « pas de test disponible » comme un résultat vert.
Les changements de production/données clients font l'objet d'un plan adapté avant action.

## Journal de développement

Créer un fichier par session/objectif cohérent ; ne pas remplacer les journaux des autres.
Les fichiers concurrents peuvent avoir des suffixes distincts. Mettre à jour STATUS en coordination.

    # YYYY-MM-DD — UL-nnn — objectif
    Responsable : ...
    Base/branche/commit : ...
    Exigences : ...
    Changements : ...
    Vérifications : commande, environnement, résultat, preuve
    Limites : ...
    Décisions/ADR : ...
    Dette ajoutée/résolue : ...
    Suite : UL-nnn, étapes concrètes, blocages éventuels

Ne pas écrire d'auto-référence de commit impossible : identifier le commit de base et laisser Git/PR fournir celui qui contient le journal.

## Passation minimale

- État réellement exécuté et commandes pour reproduire.
- Tâche suivante et critères de clôture.
- Sources de vérité et ADR pertinentes.
- Questions restantes avec impact, option proposée et décideur.
- Aucun secret ni contenu privé dans la passation publique.
