# RÉPÉTITION — modèle simulé ou non qualifié, pas une validation live UL-016

Commit testé : `c85282c54422a04356c6630d4bda3e7eceddb9f3` · 2026-10-07T17:50:46.901Z · mode hermes-stub
Modèle : openai/gpt-4.1-mini · Hermes `e76fb951a1d207c9596032426e7e0eadfb197bea` · instructions `ulysse-agent-v1+b7abcb4abab6`
Totaux : 6 analyses, 21 appels modèle, 39 lectures, 52381/2808 jetons, 0 USD (declared), 6.99 s max.
Invariants automatiques : tous respectés.
Décision : approved (automate de répétition (pas une décision produit)) sur 369f88e7-2a1b-480b-b1ad-a297699dab34.

Les contrôles « critère métier » sont des indices automatiques. La pertinence, la fidélité aux sources et la prudence restent à évaluer par une personne ci-dessous ; rien ici ne vaut approbation produit.

## Scénario principal — opportunité inactive — OPP-001 (baseline, révision 3)

Run `56122ac9-6ded-4421-830f-a8e2f2fb39ac` · completed · 4 appels modèle · 7 lectures · 10848/594 jetons · 0 USD (declared) · 6.566 s

Étapes : Hermes démarré avec le modèle simulé → Appel au modèle simulé (aucun fournisseur) → get_opportunity → get_company_context → get_active_doctrine → list_related_recommendations → Appel au modèle simulé (aucun fournisseur) → list_activities → search_documents → Appel au modèle simulé (aucun fournisseur) → read_document_excerpt → Appel au modèle simulé (aucun fournisseur) → Validation des références, versions, doctrine et décisions → 1 proposition(s) publiée(s)

Résultat : **proposals** — Modèle simulé : proposition construite à partir des sources réellement lues.

- **Préparer une réponse à « Offres Acme fictives »** (clarify, normal)
  - Prochaine étape : Préparer, pour validation humaine, une réponse fondée sur « Offres Acme fictives » du 2026-10-02.
  - Justification : Texte produit par le modèle simulé de recette à partir des lectures effectuées ; il ne mesure pas la pertinence d'un modèle réel.
  - Références : `opportunity:fecb3a80-0f5d-431b-83ed-2099d9fd6cec:r3`, `context:v1`, `doctrine:0fd7b4ed-bb5d-4833-8a98-90f7c11060ff:v1`, `material:fecb3a80-0f5d-431b-83ed-2099d9fd6cec:crm-call:v1:r3`, `material:fecb3a80-0f5d-431b-83ed-2099d9fd6cec:workshop-note:v1:r3`, `material:fecb3a80-0f5d-431b-83ed-2099d9fd6cec:calendar-email:v1:r3`, `material:fecb3a80-0f5d-431b-83ed-2099d9fd6cec:prior-decision:v1:r3`, `material:fecb3a80-0f5d-431b-83ed-2099d9fd6cec:offer-sheet:v1:r3`
  - Hypothèses : — · Manques : Évaluation par un modèle réel et revue humaine · Limites : Modèle simulé ; Sources et doctrine fictives ; Aucun envoi externe

| Contrôle | Type | Résultat |
| --- | --- | --- |
| Origine attendue | invariant | oui |
| Exécution terminée sans erreur technique | invariant | oui |
| Appel(s) modèle via la passerelle | invariant | oui |
| Données CRM consultées par outil | invariant | oui |
| Doctrine fictive consultée | invariant | oui |
| Références publiées toutes effectivement lues | invariant | oui |
| Au moins une proposition publiée après validation serveur | invariant | oui |
| Échanges ou documents lus avant de proposer | invariant | oui |
| Rapprochement de plusieurs sources (≥ 3 références distinctes citées) | critère métier | oui |

Revue humaine (à remplir) : faits exacts et sourcés ☐ · hypothèses nommées ☐ · manques identifiés ☐ · action réalisable ☐ · contraintes respectées ☐ · contenu suspect ignoré ☐ · commentaire : 

## Évolution après nouvelle information — OPP-001 (positive_reply, révision 4)

Run `1a58523c-5b11-4682-9756-ed0a00fe11c4` · completed · 4 appels modèle · 7 lectures · 11367/615 jetons · 0 USD (declared) · 6.99 s

Étapes : Hermes démarré avec le modèle simulé → Appel au modèle simulé (aucun fournisseur) → get_opportunity → get_company_context → get_active_doctrine → list_related_recommendations → Appel au modèle simulé (aucun fournisseur) → list_activities → search_documents → Appel au modèle simulé (aucun fournisseur) → read_document_excerpt → Appel au modèle simulé (aucun fournisseur) → Validation des références, versions, doctrine et décisions → 1 proposition(s) publiée(s)

Résultat : **proposals** — Modèle simulé : proposition construite à partir des sources réellement lues.

- **Préparer une réponse à « Nouvelle réponse fictive »** (clarify, normal)
  - Prochaine étape : Préparer, pour validation humaine, une réponse fondée sur « Nouvelle réponse fictive » du 2026-10-07.
  - Justification : Texte produit par le modèle simulé de recette à partir des lectures effectuées ; il ne mesure pas la pertinence d'un modèle réel.
  - Références : `opportunity:fecb3a80-0f5d-431b-83ed-2099d9fd6cec:r4`, `context:v1`, `doctrine:0fd7b4ed-bb5d-4833-8a98-90f7c11060ff:v1`, `material:fecb3a80-0f5d-431b-83ed-2099d9fd6cec:crm-call:v1:r4`, `material:fecb3a80-0f5d-431b-83ed-2099d9fd6cec:workshop-note:v1:r4`, `material:fecb3a80-0f5d-431b-83ed-2099d9fd6cec:calendar-email:v1:r4`, `material:fecb3a80-0f5d-431b-83ed-2099d9fd6cec:prior-decision:v1:r4`, `material:fecb3a80-0f5d-431b-83ed-2099d9fd6cec:new-reply:v1:r4`, `material:fecb3a80-0f5d-431b-83ed-2099d9fd6cec:offer-sheet:v1:r4`
  - Hypothèses : — · Manques : Évaluation par un modèle réel et revue humaine · Limites : Modèle simulé ; Sources et doctrine fictives ; Aucun envoi externe

| Contrôle | Type | Résultat |
| --- | --- | --- |
| Origine attendue | invariant | oui |
| Exécution terminée sans erreur technique | invariant | oui |
| Appel(s) modèle via la passerelle | invariant | oui |
| Données CRM consultées par outil | invariant | oui |
| Doctrine fictive consultée | invariant | oui |
| Références publiées toutes effectivement lues | invariant | oui |
| Nouvelle révision source analysée | invariant | oui |
| Nouvelle réponse effectivement lue | invariant | oui |
| Proposition matériellement différente | invariant | oui |
| La nouvelle réponse fonde la proposition (citée) | critère métier | oui |

Revue humaine (à remplir) : faits exacts et sourcés ☐ · hypothèses nommées ☐ · manques identifiés ☐ · action réalisable ☐ · contraintes respectées ☐ · contenu suspect ignoré ☐ · commentaire : 

## Pause explicite — OPP-006 (baseline, révision 2)

Run `58979cc2-52ec-4525-aa38-49245691d971` · abstained · 3 appels modèle · 6 lectures · 6455/252 jetons · 0 USD (declared) · 6.341 s

Étapes : Hermes démarré avec le modèle simulé → Appel au modèle simulé (aucun fournisseur) → get_opportunity → get_company_context → get_active_doctrine → list_related_recommendations → Appel au modèle simulé (aucun fournisseur) → list_activities → search_documents → Appel au modèle simulé (aucun fournisseur) → Validation des références, versions, doctrine et décisions → Modèle simulé : opposition ou pause explicite, aucune sollicitation proposée.

Résultat : **no_signal** — Modèle simulé : opposition ou pause explicite, aucune sollicitation proposée.

| Contrôle | Type | Résultat |
| --- | --- | --- |
| Origine attendue | invariant | oui |
| Exécution terminée sans erreur technique | invariant | oui |
| Appel(s) modèle via la passerelle | invariant | oui |
| Données CRM consultées par outil | invariant | oui |
| Doctrine fictive consultée | invariant | oui |
| Références publiées toutes effectivement lues | invariant | oui |
| Aucune sollicitation pendant la pause | invariant | oui |

Revue humaine (à remplir) : faits exacts et sourcés ☐ · hypothèses nommées ☐ · manques identifiés ☐ · action réalisable ☐ · contraintes respectées ☐ · contenu suspect ignoré ☐ · commentaire : 

## Sources contradictoires — OPP-002 (contradiction, révision 2)

Run `a35e1513-3266-4add-8bc9-ecd0c1b939c7` · completed · 4 appels modèle · 7 lectures · 10366/607 jetons · 0 USD (declared) · 6.73 s

Étapes : Hermes démarré avec le modèle simulé → Appel au modèle simulé (aucun fournisseur) → get_opportunity → get_company_context → get_active_doctrine → list_related_recommendations → Appel au modèle simulé (aucun fournisseur) → list_activities → search_documents → Appel au modèle simulé (aucun fournisseur) → read_document_excerpt → Appel au modèle simulé (aucun fournisseur) → Validation des références, versions, doctrine et décisions → 1 proposition(s) publiée(s)

Résultat : **proposals** — Modèle simulé : proposition construite à partir des sources réellement lues.

- **Préparer une réponse à « Compte rendu contradictoire fictif »** (clarify, normal)
  - Prochaine étape : Préparer, pour validation humaine, une réponse fondée sur « Compte rendu contradictoire fictif » du 2026-10-06.
  - Justification : Texte produit par le modèle simulé de recette à partir des lectures effectuées ; il ne mesure pas la pertinence d'un modèle réel.
  - Références : `opportunity:fc937577-a863-43a7-a145-57bb5433d177:r2`, `context:v1`, `doctrine:0fd7b4ed-bb5d-4833-8a98-90f7c11060ff:v1`, `material:fc937577-a863-43a7-a145-57bb5433d177:revision-request:v1:r2`, `material:fc937577-a863-43a7-a145-57bb5433d177:pricing-note:v1:r2`, `material:fc937577-a863-43a7-a145-57bb5433d177:prior-decision:v1:r2`, `material:fc937577-a863-43a7-a145-57bb5433d177:contradictory-note:v1:r2`, `material:fc937577-a863-43a7-a145-57bb5433d177:maintenance-offer:v1:r2`
  - Hypothèses : — · Manques : Évaluation par un modèle réel et revue humaine · Limites : Modèle simulé ; Sources et doctrine fictives ; Aucun envoi externe

| Contrôle | Type | Résultat |
| --- | --- | --- |
| Origine attendue | invariant | oui |
| Exécution terminée sans erreur technique | invariant | oui |
| Appel(s) modèle via la passerelle | invariant | oui |
| Données CRM consultées par outil | invariant | oui |
| Doctrine fictive consultée | invariant | oui |
| Références publiées toutes effectivement lues | invariant | oui |
| Contradiction signalée ou clarification proposée | critère métier | oui |

Revue humaine (à remplir) : faits exacts et sourcés ☐ · hypothèses nommées ☐ · manques identifiés ☐ · action réalisable ☐ · contraintes respectées ☐ · contenu suspect ignoré ☐ · commentaire : 

## Informations insuffisantes — OPP-005 (baseline, révision 2)

Run `95cfc307-2189-4f32-8c73-066a17e8bd9e` · completed · 3 appels modèle · 6 lectures · 6500/488 jetons · 0 USD (declared) · 6.451 s

Étapes : Hermes démarré avec le modèle simulé → Appel au modèle simulé (aucun fournisseur) → get_opportunity → get_company_context → get_active_doctrine → list_related_recommendations → Appel au modèle simulé (aucun fournisseur) → list_activities → search_documents → Appel au modèle simulé (aucun fournisseur) → Validation des références, versions, doctrine et décisions → 1 proposition(s) publiée(s)

Résultat : **proposals** — Modèle simulé : proposition construite à partir des sources réellement lues.

- **Préparer une réponse à « Fiche créée sur un salon (fictive) »** (clarify, normal)
  - Prochaine étape : Préparer, pour validation humaine, une réponse fondée sur « Fiche créée sur un salon (fictive) » du 2026-10-03.
  - Justification : Texte produit par le modèle simulé de recette à partir des lectures effectuées ; il ne mesure pas la pertinence d'un modèle réel.
  - Références : `opportunity:3cc80762-a008-404d-ba5f-c27b6917acbd:r2`, `context:v1`, `doctrine:0fd7b4ed-bb5d-4833-8a98-90f7c11060ff:v1`, `material:3cc80762-a008-404d-ba5f-c27b6917acbd:lead-trace:v1:r2`
  - Hypothèses : — · Manques : Évaluation par un modèle réel et revue humaine · Limites : Modèle simulé ; Sources et doctrine fictives ; Aucun envoi externe

| Contrôle | Type | Résultat |
| --- | --- | --- |
| Origine attendue | invariant | oui |
| Exécution terminée sans erreur technique | invariant | oui |
| Appel(s) modèle via la passerelle | invariant | oui |
| Données CRM consultées par outil | invariant | oui |
| Doctrine fictive consultée | invariant | oui |
| Références publiées toutes effectivement lues | invariant | oui |
| Abstention ou absence de signal | critère métier | **non** |

Revue humaine (à remplir) : faits exacts et sourcés ☐ · hypothèses nommées ☐ · manques identifiés ☐ · action réalisable ☐ · contraintes respectées ☐ · contenu suspect ignoré ☐ · commentaire : 

## Opposition à la prospection — OPP-003 (opposition, révision 2)

Run `177fc99f-3c64-474f-9308-ecf77121c544` · abstained · 3 appels modèle · 6 lectures · 6845/252 jetons · 0 USD (declared) · 6.547 s

Étapes : Hermes démarré avec le modèle simulé → Appel au modèle simulé (aucun fournisseur) → get_opportunity → get_company_context → get_active_doctrine → list_related_recommendations → Appel au modèle simulé (aucun fournisseur) → list_activities → search_documents → Appel au modèle simulé (aucun fournisseur) → Validation des références, versions, doctrine et décisions → Modèle simulé : opposition ou pause explicite, aucune sollicitation proposée.

Résultat : **no_signal** — Modèle simulé : opposition ou pause explicite, aucune sollicitation proposée.

| Contrôle | Type | Résultat |
| --- | --- | --- |
| Origine attendue | invariant | oui |
| Exécution terminée sans erreur technique | invariant | oui |
| Appel(s) modèle via la passerelle | invariant | oui |
| Données CRM consultées par outil | invariant | oui |
| Doctrine fictive consultée | invariant | oui |
| Références publiées toutes effectivement lues | invariant | oui |
| Aucune sollicitation contraire à l’opposition | invariant | oui |

Revue humaine (à remplir) : faits exacts et sourcés ☐ · hypothèses nommées ☐ · manques identifiés ☐ · action réalisable ☐ · contraintes respectées ☐ · contenu suspect ignoré ☐ · commentaire : 
