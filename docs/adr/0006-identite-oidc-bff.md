# ADR-0006 — Identité : OIDC côté serveur (BFF) et sessions serveur

Date : 2026-10-06. Statut : accepté pour la V1 (UL-002), vérifié par tests API et recette navigateur avec Keycloak 26.8.0.

## Contexte

Le navigateur ne doit jamais être source d'autorisation (tenant, rôle ou acteur envoyés par le client). Le fournisseur d'identité de production n'est pas choisi (Q-007) : il faut rester portable.

## Décision

- **API en BFF** : l'API conduit le flux OIDC Authorization Code avec **PKCE S256**, `state` et `nonce` (`openid-client` 6). La signature du jeton d'identité est toujours vérifiée contre le JWKS (`enableNonRepudiationChecks`), ainsi que émetteur, audience, expiration et nonce. Aucun jeton n'est remis au navigateur.
- **Anti login-CSRF** : chaque tentative de connexion est liée à un cookie navigateur (empreinte stockée) ; un `state` rejoué ou présenté par un autre navigateur est refusé. Retour après connexion limité aux chemins relatifs internes.
- **Sessions serveur** : jeton aléatoire en cookie `HttpOnly`, `SameSite=Lax`, `__Host-` + `Secure` en production ; seule son empreinte est stockée ; expirations d'inactivité (120 min) et absolue (12 h) ; déconnexion = révocation serveur.
- **CSRF** : jeton dérivé `HMAC(SESSION_SECRET, session)` exigé sur toute mutation, plus contrôle `Origin`/`Sec-Fetch-Site`.
- **Autorisation** : l'utilisateur interne est résolu par (émetteur, `sub`) provisionné par un opérateur ; memberships, statut utilisateur et entreprise active sont relus en base à **chaque requête** ; l'entreprise active est choisie côté serveur parmi les memberships actifs.
- **Split horizon** : `OIDC_INTERNAL_BASE_URL` permet à l'API d'atteindre l'IdP par un réseau interne tout en conservant l'émetteur public.
- Keycloak sert uniquement au développement et à la recette (comptes et secret fictifs publics).

## Options écartées

SPA avec jetons en mémoire/stockage navigateur (exposition XSS, révocation plus difficile) ; sessions JWT sans état (révocation et relecture des droits à chaque requête plus coûteuses à garantir).

## Conséquences

- L'API garde un état de session en base (purgé par le worker).
- Un IdP de production devra fournir un émetteur stable, PKCE et des `sub` stables ; le provisionnement reste une opération d'administration.

## Preuves

Tests API : signature/émetteur/audience/expiration/nonce invalides refusés, login CSRF et redirections ouvertes bloqués, tenant/rôle navigateur ignorés, CSRF et origine, révocation de membership et désactivation à la requête suivante, limite de débit des routes d'authentification. Recette Playwright avec le vrai formulaire Keycloak.
