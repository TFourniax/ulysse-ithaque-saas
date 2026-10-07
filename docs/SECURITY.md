# Sécurité et protection des données

## UL-016 — frontière agentique

Hermes est privé, authentifié par secret de service, sans port publié ni réseau public. Il reçoit une capacité bornée au run, expirant en 90 secondes et stockée sous empreinte seulement. Le modèle ne choisit pas le tenant. Le worker reconstruit l'autorisation depuis PostgreSQL à chaque outil/appel modèle ; la révocation du connecteur bloque immédiatement les nouvelles lectures et la publication. Les fixtures respectent les droits d'entreprise existants : aucune ACL fine de dossier n'est revendiquée (DEBT-010).

Seuls sept outils Ulysse de lecture sont sélectionnés et vérifiés dans le runtime réel. Aucun terminal, fichier, navigateur, mémoire, historique partagé, délégation ou écriture. Un prompt ne constitue pas ce contrôle : l'allowlist et le réseau l'imposent. Un processus par run isole les registres, plugins et caches ; mémoire et contextes locaux étrangers désactivés. Les documents/e-mails restent des données non fiables et ne changent aucune permission ou doctrine.

Les résultats fermés sont revalidés (références réellement lues, versions, doctrine, fraîcheur, suppression, décisions et volume). Les copies nouvelles de contenu sont purgées avec la source ; la comptabilité minimisée demeure pour empêcher un reset des budgets par effacement. Les répertoires temporaires Hermes sont supprimés ; ni prompts bruts, ni réponses complètes, ni chaîne de pensée conservés. Progression : faits d'exécution seulement.

Les commandes de scénarios exigent un owner, CSRF/session/membership actuels, connecteur fixture actif et activation explicite hors production. Elles changent une source fictive et demandent une ingestion ; aucune recommandation finale directe. Les viewers ne peuvent ni les exécuter ni décider. Une approbation écrit uniquement une décision Ulysse.

Statut : exigences et critères de revue. Mise à jour 2026-10-06 : la V1 met en œuvre les contrôles marqués ci-dessous, vérifiés par tests ; les autres restent à faire.

## État de mise en œuvre (V1)

| Contrôle | État | Preuve / référence |
| --- | --- | --- |
| Session serveur, membership relue à chaque requête, tenant/rôle navigateur ignorés | fait | tests API ; [ADR-0006](adr/0006-identite-oidc-bff.md) |
| OIDC : signature, émetteur, audience, expiration, nonce, PKCE, anti login-CSRF | fait | tests API avec IdP de test |
| CSRF sur mutations + contrôle d'origine ; cookies HttpOnly/SameSite, `__Host-`/Secure en production | fait | tests API, garde de configuration |
| RLS forcée USING/WITH CHECK, rôles sans BYPASSRLS, compte de migration distinct, non-fuite du pool | fait | tests PostgreSQL ; [ADR-0004](adr/0004-postgresql-roles-rls.md) |
| Identité de service des jobs limitée à une entreprise/connexion | fait | tests worker (job forgé) ; [ADR-0007](adr/0007-worker-outbox.md) |
| Révocation membership / utilisateur / connexion, purge des données de connexion | fait | tests API, worker, domaine |
| Contenu source non fiable, aucun outil fourni au modèle, sorties validées côté serveur | fait (simulation) | tests `packages/ai` ; [ADR-0009](adr/0009-formulation-assistee.md) |
| Journaux sans jeton, cookie, code OIDC, corps ni contenu source | fait | tests observability, vérification des journaux |
| Limites de débit, tailles de corps, budget modèle par entreprise | fait | tests API et worker |
| Sauvegardes chiffrées et authentifiées, restauration vérifiée | fait (local, CI) | [OPERATIONS](OPERATIONS.md) §8 |
| Connecteur fictif interdit en production | fait | tests de configuration API/worker |
| ACL par source/dossier | à faire | DEBT-010, Q-006 |
| Stockage chiffré des credentials de connecteurs, rotation OAuth | à faire | DEBT-011, UL-008 |
| Stockage de fichiers (S3), URL signées | non nécessaire en V1 | aucun fichier stocké |
| Protection SSRF des connecteurs réels | à faire avec le premier connecteur | UL-008 |
| TLS, IdP de production, secrets en coffre, alerting | à faire | UL-011b, UL-014 |

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
