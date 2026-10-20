# UL-019 — Diagnostic des refus live

Date : 2026-10-20. Responsable : Codex. Branche : codex/ul-019-model-profiles, PR #7. Objectif : diagnostiquer la recette GLM sans masquer les erreurs derrière result_refused.

## Faits rapportés par Thomas

Le code e793f24a est déployé sur le seul Docker rootless Ulysse, services sains, profil glm53flash-eu. La première analyse échoue avant toute lecture d'outil ; un appel technique sur le VPS reçoit HTTP 403, plan Business/Enterprise requis. Thomas annonce l'activation Business puis transmet une nouvelle analyse interrompue à 23 h 07. La cause de ce second échec reste inconnue. Aucun appel fournisseur ni accès SSH effectué depuis cet environnement.

## Changements

- Adaptateur d'erreur commun : statuts HTTP, refus de plan régional, erreurs dans une réponse HTTP 200, réseau et délai ; aucun retry ou changement de routage.
- Corps d'erreur HTTP borné à 16 384 octets ; seuls codes fixes et statut HTTP conservés, aucun message libre ni payload fournisseur dans les logs ou la base.
- La passerelle enregistre la première cause ; les erreurs secondaires Hermes ne l'écrasent plus. Les parcours distinguent exécution, format et preuves. Une réussite validée efface le code temporaire.
- Messages explicites côté interface. Compatibilité des anciens codes, schéma métier et budgets conservés. Aucune migration.
- Précontrôle documenté comme contrôle de catalogue, non comme autorisation d'inférence.
- Commande diagnose du script VPS : journaux techniques filtrés et métadonnées des trois derniers parcours, tenant sélectionné, SQL en lecture seule. Compatible avec la version déjà déployée, sans rebuild ni appel modèle.

## Vérification

Contrôles locaux avant publication : npm run verify (format, lint typé, types, cycles, OpenAPI, tests et contrôle documentaire), 18 tests unitaires worker dont six nouveaux ; bash -n et cinq tests Python du script VPS. Tests ajoutés : confidentialité des erreurs, réponses HTTP 200 en erreur, bornes de lecture, timeout sans retry, propagation PostgreSQL de la première cause, distinction format/preuves. Docker absent ici : intégration PostgreSQL et parcours conteneurisés exécutés par la CI de la PR, résultats à consulter avant déploiement des images.

## Limites et suite

Ce correctif rend la cause visible ; il n'établit pas la cause du second essai et ne prouve pas la qualité métier de GLM. Les détails du premier échec ont été identifiés par le test technique de Thomas ; les erreurs historiques restent génériques. DEBT-022 reste partielle jusqu'à validation du correctif et recette VPS. Aucun déploiement, reset de données, appel payant ni fusion réalisé ici.
