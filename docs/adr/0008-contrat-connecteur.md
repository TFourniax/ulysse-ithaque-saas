# ADR-0008 — Contrat de connecteur, normalisation versionnée et connecteur fictif

Date : 2026-10-06. Statut : accepté pour la V1 (UL-005). Aucune source réelle n'est intégrée (UL-008 bloqué).

## Contexte

La première source réelle n'est pas choisie (Q-002) et l'API de Stratégie n'est pas documentée (Q-003). Il faut pouvoir développer tout le pipeline sans présumer d'aucun endpoint, schéma ou droit.

## Décision

- **Contrat** (`packages/connectors`) : définition déclarant capacités (lecture incrémentale, suppressions, pagination), dictionnaire de champs, et méthodes de lecture paginée par curseur renvoyant enregistrements, versions fournisseur et suppressions (tombstones). Erreurs typées `ConnectorError` : `auth_revoked`, `permission_denied`, `misconfigured`, `rate_limited`, `quota_exceeded`, `transient`, `invalid_cursor`, `provider_unavailable` ; les données invalides sont comptées et ignorées enregistrement par enregistrement.
- **Normalisation** dans le domaine : chaque champ est `present`, `empty` ou `unavailable` (clé absente ≠ valeur nulle) ; révision normalisée distincte de la version fournisseur ; plan de changement (`create`, `revise`, `unchanged`, `stale`, `delete`, `restore`, conflit, date future refusée). Les champs inconnus sont ignorés, le texte source n'entre jamais dans l'audit.
- **Connecteur fictif** (`fixture-crm`) : CRM simulé dans un schéma `fixture_crm` (montants en centimes, nulls explicites), activable seulement hors production (`ENABLE_FIXTURE_CONNECTOR`, refusé en production par l'API et le worker). Il est présenté comme fictif dans l'interface et la documentation, jamais comme une intégration.
- **Suite de contrat réutilisable** (`defineConnectorContract`) que tout futur connecteur réel devra passer, en plus de ses tests contre la vraie source.
- Les secrets de connexion ne sont jamais renvoyés par l'API ni transmis au modèle ; le stockage de credentials réel reste à concevoir avec la première source (DEBT-011).

## Conséquences

Ajouter une source réelle = implémenter le contrat, documenter son dictionnaire et ses droits, passer la suite de contrat, prouver authentification, pagination, quotas, suppressions et révocation sur la vraie source (UL-008).

## Preuves

Tests connecteurs (normalisation, rejet de charge invalide, reprise incrémentale, erreurs typées, catalogue) et suite de contrat sur le connecteur fictif ; tests worker et e2e de bout en bout avec ce connecteur.
