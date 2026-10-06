# Sécurité et protection des données

Statut : exigences de mise en œuvre et critères de revue. La fondation mémoire ne met pas en place ces contrôles d'infrastructure.

## Frontières

| Frontière | Contrôle attendu | Test utile |
| --- | --- | --- |
| Navigateur → API | Session vérifiée, membership serveur, rôle et droit objet | Tenant/role/header forgés, membership révoquée |
| API/worker → PostgreSQL | Dépôts scopés + RLS, compte sans bypass | Lecture/écriture A/B, absence de contexte, fuite de pool |
| Job → source | Identité de service, connexion active et scope | Révocation pendant un job, job de B avec référence de A |
| Retrieval → modèle | Filtre tenant et ACL, preuves autorisées | Citation privée, document tombstoné, chunk d'autre tenant |
| Source → pipeline | Schéma, taille, quotas, contenu non fiable | Injection de prompt, payload géant, donnée malformée |
| Utilisateur → décision | Rôle, révision, provenance fraîche, idempotence | Deux validations, retry après timeout, preuve modifiée |
| Fichier → restitution | Bucket privé, clé scopée, URL signée courte | URL/clé d'autre tenant, permission retirée |
| Logs → exploitation | Champs autorisés et identifiants techniques | Aucun token, corps d'e-mail ou document dans les traces |

## Cloisonnement

Propager tenant_id seulement depuis un contexte vérifié. RLS avec USING et WITH CHECK, compte applicatif non propriétaire sans BYPASSRLS et FORCE quand nécessaire. SET LOCAL du tenant dans chaque transaction, rollback avant remise au pool. Aucun compte de migration utilisé par l'application.

Les rôles PostgreSQL peuvent contourner la RLS selon leurs privilèges : tester avec le rôle réel d'exécution, pas le superutilisateur. Les ACL métier par source/dossier restent à vérifier en plus du tenant.

Caches, jobs, fichiers, embeddings, déduplications, métriques et exports incluent le périmètre d'entreprise. Les domaines clients n'autorisent aucune lecture par eux-mêmes. Pas de réutilisation de données d'un client pour en conseiller un autre.

## Modèles et sources non fiables

Traiter mails, documents et transcriptions comme données. Les instructions qu'ils contiennent ne changent ni outils, ni destinataires, ni permissions, ni system prompt. Aucun outil d'exécution externe disponible au moteur de génération. Schémas de sortie fermés, validation des citations et des dates côté serveur.

Fournisseur configurable avec choix documenté de modèle/région/conditions de traitement, budget et minimisation. Ne pas transmettre des données pilotes réelles avant validation de ces conditions. Fixtures et évaluations publiques synthétiques ; documents propriétaires privés.

## Secrets, identité et réseau

Secrets en environnement/vault, jamais VITE_* pour un secret. Référence aux credentials, chiffrement au repos et transport TLS. Tokens OAuth rotatifs si supportés, scopes minimum, révocation testée. Éviter URL arbitraires lues par le worker ; fournisseurs/endpoints autorisés, protection SSRF et pas d'accès metadata cloud.

Rate limits par utilisateur/tenant/connexion, tailles de payload, budgets de jobs et coût de modèles. Compteurs globaux complètent les plafonds par tenant pour empêcher la saturation générale.

## Audit, suppression et reprise

Audit normal append-only, exportable par permission, corrélable et rétention définie. Ne pas annoncer un audit « inviolable » sans mécanisme et menace explicités. Les administrateurs d'infrastructure restent dans le modèle de menace.

Déconnexion arrête les jobs et retire les secrets selon politique. Suppression tenant/data : sources, faits, extraits, indexes, embeddings, caches et tâches ; rétention légitime distincte pour certains événements d'audit. Backups : politique de durée, restauration et réapplication des suppressions documentées.

Les exigences contractuelles/protection des données et les droits sur la doctrine doivent être validés pour le pilote ; ce fichier technique ne tient pas lieu d'avis juridique ni d'accord client.
