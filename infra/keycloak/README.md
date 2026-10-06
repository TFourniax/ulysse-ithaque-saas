# Keycloak de développement

`ulysse-realm.json` est importé au démarrage du conteneur `keycloak` (Keycloak 26.8.0, mode `start-dev`).

**Tout est fictif et réservé au poste de développement** : utilisateurs, mots de passe (`ulysse-demo-<prénom>`), secret client `dev-only-ulysse-web-client-secret`. Ces valeurs ne protègent aucun environnement et ne doivent jamais être réutilisées pour un pilote ; un environnement pilote utilise son propre fournisseur OIDC et ses propres secrets (voir docs/OPERATIONS.md).

| Utilisateur | Mot de passe | Entreprise fictive et rôle |
| --- | --- | --- |
| alice | ulysse-demo-alice | Acme : owner |
| bruno | ulysse-demo-bruno | Acme : reviewer |
| vera | ulysse-demo-vera | Acme : viewer |
| gina | ulysse-demo-gina | Globex : owner |
| dan | ulysse-demo-dan | Acme : viewer, Globex : reviewer |

Les identifiants Keycloak (`id`) sont fixes : ce sont les `sub` que `npm run db:seed` associe aux utilisateurs internes et à leurs memberships. Une identité Keycloak non provisionnée dans la base est refusée à la connexion.

Client `ulysse-web` : confidentiel, Authorization Code avec PKCE S256 obligatoire, sans flux implicite ni mot de passe direct. URI de retour : `http://localhost:3000/auth/callback` (API servant le web) et `http://localhost:5173/auth/callback` (serveur Vite) et `http://localhost:3100/auth/callback` (recette Playwright).
