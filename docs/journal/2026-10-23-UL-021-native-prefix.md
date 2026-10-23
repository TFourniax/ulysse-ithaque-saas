# UL-021 — Continuité du contexte Anthropic natif

Date : 2026-10-23. Responsable : Codex. Dette : DEBT-038. Branche : `codex/ul-021-anthropic-native`, PR #9.

## Objectif et constat

Stabiliser le passage du premier appel modèle au résultat d’outil et à la correction native. Sur le VPS, le run du 23 octobre à 14 h 47 (Europe/Paris) échoue en HTTP 400 au deuxième appel après `list_company_sources`. Les deux sondes suivantes, simple et schéma acheteur, renvoient HTTP 200. La clé et le schéma seuls ne reproduisent pas l’échec. Le message du refus historique n’a pas été conservé.

Le code recalculait les preuves et leur catalogue selon la place restante, puis les réinsérait avant l’historique signé. Une correction retirait aussi les définitions d’outils et perdait les blocs natifs signés. Ces modifications contredisent la liaison du préfixe documentée par Anthropic.

## Changement

Contrat v6 : preuves initiales autorisées remises une fois à Hermes, qui conserve sa conversation. Le worker recalcule seulement pour vérifier égalité, droits et fraîcheur; il ne modifie plus le préfixe natif. Réparation avec blocs signés, outils conservés et `tool_choice: none`. Relecture indépendante inchangée. Aucun transcript partagé, aucun contournement des signatures, aucune migration ou modification des budgets. Refus de signature reconnaissable par un code fixe sans texte client.

Fichiers : contrat domaine, runtime workflow et passerelle, adaptateur Anthropic, supervision/runner Hermes, fournisseur scripté, tests worker/Hermes, script VPS et documentation.

## Vérification

`npm run verify` réussit : format, lint typé, TypeScript, cycles, OpenAPI, 143 tests unitaires et contrôle documentaire. Les 14 tests du script VPS et les 5 tests Python du contrat et des signatures passent localement. Les 16 tests Hermes passent ensuite localement avec le commit amont épinglé et ses dépendances scellées (Python 3.14.8, chemin de checkout adapté uniquement dans le lanceur de test). Code de déploiement : `6d4882c29782f37a1113946325e5a28c363724f8`.

- [CI applicative](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/39966656734) : 5/5 réussis, dont PostgreSQL 50/50, API 18/18, worker 55/55 et navigateur 15/15.
- [Hermes et mises à niveau](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/39966656636) : 8/8 réussis, y compris la compatibilité OpenRouter et les mises à niveau historiques. Les 16 tests dans l’image Hermes passent. Les stacks Anthropic neuve et mise à niveau UL-016 aboutissent au diagnostic comparatif cité, à sa relecture/correction et au contenu lié; décisions, session et données survivent au redémarrage.

Les tests utilisent des données et signatures fictives; ils ne prouvent pas la qualité du modèle réel. Le fournisseur scripté rejette une modification du système, des outils ou des preuves avant un bloc signé et tolère les marqueurs de cache. La recette couvre aussi le raisonnement omis, le résultat d’outil, la correction et les limites du contrat privé.

## Limites et suite

Pas d’accès SSH au VPS ni de clé utilisée ici. Après déploiement, relancer un diagnostic acheteur puis créer un contenu lié. La prochaine action et la collecte doivent également être relues avant clôture d’UL-021. L’attribution exacte du HTTP 400 historique demeure inconnue; ne pas déduire la facture réelle de la provision des appels incertains.

Première CI du correctif `5984f95` : deux défauts des nouveaux tests ont été corrigés. Le fournisseur scripté distinguait le raccourci texte et le bloc texte unique, équivalents dans l’API Messages; il les normalise désormais avant de vérifier le préfixe. Le contrôle des compteurs buyer lisait la liste des runs d’affaires; il interroge maintenant le run workflow sous le rôle et tenant de test. Le scénario natif avec outil et réparation avait déjà abouti avant cette dernière assertion. Aucun contrôle d’intégrité du contenu n’est retiré.
