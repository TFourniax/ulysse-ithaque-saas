# Ajouter un connecteur de source

Statut : seul le connecteur **fictif** `fixture-crm` existe. Ce guide décrit comment intégrer une source réelle (UL-008) sans présumer de son API. Décision d'architecture : [ADR-0008](adr/0008-contrat-connecteur.md).

## Préalables (à obtenir, pas à supposer)

- Source choisie et accès autorisé par son responsable (Q-002) ; pour Stratégie, contrat d'API documenté (Q-003). Ne jamais déduire un endpoint, un schéma, un accès base de données ou un droit d'usage du nom du produit.
- Compte de test de la source, périmètre de données autorisé, quotas, politique de suppression et de révocation.
- Dictionnaire des champs (nom, type, unité, sémantique de l'absence et du null) validé avec la source.

## Étapes

1. **Définition** dans `packages/connectors/src/<provider>.ts` : identifiant, capacités (lecture incrémentale, suppressions, taille de page), dictionnaire de champs, portées demandées (minimum nécessaire, lecture seule).
2. **Lecture paginée** par curseur opaque : renvoyer les enregistrements avec leur identifiant externe, leur version fournisseur et leur date de modification, les suppressions (tombstones) et le curseur suivant. Aucune écriture vers la source.
3. **Erreurs** : convertir chaque erreur du fournisseur en `ConnectorError` (`auth_revoked`, `permission_denied`, `misconfigured` → définitives ; `rate_limited`, `quota_exceeded`, `transient`, `provider_unavailable` → réessayées ; `invalid_cursor`). Respecter `Retry-After`.
4. **Normalisation** : projeter vers les champs connus en distinguant `present`, `empty` et `unavailable` ; convertir les unités (montants en décimal + devise) ; ignorer les champs inconnus. Le contenu source reste une donnée non fiable : il n'entre ni dans les journaux, ni dans l'audit, ni dans une instruction.
5. **Credentials** : concevoir le stockage chiffré et la rotation (DEBT-011) ; seule une référence est stockée sur la connexion ; jamais renvoyée par l'API ni transmise au modèle. Révocation = arrêt immédiat des lectures puis purge.
6. **Enregistrement** dans le registre du worker (`apps/worker/src/main.ts`), activé par configuration explicite.
7. **Tests** : passer `defineConnectorContract` (suite réutilisable) avec un double de la source ; tests de normalisation sur des exemples **fictifs** ; puis preuve sur le compte de test réel (authentification, pagination complète, quotas, suppressions, révocation) consignée dans un journal, sans données réelles dans le dépôt.
8. **Documentation** : dictionnaire et limites dans ce dossier, mise à jour de STATUS/BACKLOG, ADR si le contrat évolue.

## Ce qu'un connecteur ne fait pas

Il ne décide ni des propositions ni des priorités (règles et doctrine dans le domaine), n'écrit rien dans la source dans la V1 de référence, et ne contourne pas les contrôles d'entreprise : le worker l'appelle avec un contexte de service limité à une connexion d'une entreprise.
