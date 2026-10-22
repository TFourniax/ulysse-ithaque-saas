# UL-020 — secours bloqué par un plafond tarifaire trop serré

Date : 22 octobre 2026. Responsable : Codex. Suivi DEBT-037, branche `codex/ul-020-web-research`, PR #8.

## Constat

Le relevé transmis par Thomas confirme les images `1d1836c` saines, Mistral à 6 000 tokens et les budgets 2/20/100 USD. Le diagnostic démarré à 18 h 15 (Europe/Paris) s’arrête après trois transmissions refusées 429 et deux reprises, sans outil ni relecture. `AGENT_FALLBACK_MODEL_ID` et le secours du run sont vides. La nouvelle commande `fallback auto` révèle ensuite le refus exact : le registre annonce GLM/inceptron à 0,18/0,69 USD/M, contre 0,175/0,69 dans le profil fourni. Le contrôle intervient avant le remplacement des services : le secours n’est pas activé.

## Changement

Profil GLM inclus : plafonds 0,20/0,80 USD/M. Ils servent de maxima de routage et d’estimation conservatrice, pas de prix facturés. Le comportement de précontrôle, les permissions, les budgets globaux, la route européenne, ZDR, l’endpoint et les paramètres de génération restent identiques. La procédure de profil administrateur dans [RESEARCH-OPERATIONS](../RESEARCH-OPERATIONS.md) applique ces valeurs à l’image déjà installée sans rebuild. Aucune modification de données ni migration.

Le test existant du catalogue reproduit le refus 0,18 > 0,175, accepte le nouveau profil et la valeur exacte de chaque borne, et refuse un dépassement sur chaque dimension. Le test comptable utilise les nouvelles bornes sans compter deux fois les tokens de raisonnement.

## Vérification et limites

`npm run verify` réussi : format, lint strict, typecheck, cycles, contrat OpenAPI, 135 tests unitaires et contrôle documentaire. Syntaxe Bash du bloc VPS vérifiée; son extraction du profil exécutée localement et comparée au profil inclus corrigé. La vérification du catalogue utilise un fournisseur scripté. Les CI distantes de ce changement restent à observer après publication. Aucun accès SSH, appel modèle réel, activation du secours ou déploiement effectué ici. Le tarif observé provient de la commande authentifiée exécutée sur le VPS; le nouveau précontrôle vérifiera à nouveau sa compatibilité. L’activation effective et le diagnostic avec preuves relues restent à constater. DEBT-034/035/036/037 restent ouvertes pour la recette réelle.
