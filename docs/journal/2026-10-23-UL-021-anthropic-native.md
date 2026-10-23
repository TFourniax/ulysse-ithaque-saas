# UL-021 — Fournisseur Anthropic natif dans Hermes/Ulysse

Responsable : Codex. État : partial, intégration vérifiée en CI, recette fournisseur réelle restante. Objectif demandé par Thomas : utiliser sa clé API Anthropic et les crédits de son organisation dans les trois parcours, avec Hermes comme moteur. Aucun secret ni donnée client ajouté au dépôt.

## Changement

Route native Messages et profil Sonnet 5.5, contrat Hermes v5, transport natif enregistré via l’extension officielle pour conserver les signatures derrière la passerelle privée. Le worker reste responsable des permissions, preuves, budgets et de la seule véritable clé. Recherche et relecture raccordées; coût cache estimé; erreur 529 traitée comme surcharge transitoire. Aucun secours OpenRouter automatique.

Script VPS : saisie privée documentée, déploiement et activation en une commande, précontrôle Anthropic sans inférence, rotation de clé, rollback, conservation du corpus, des campagnes et de l’historique. Enveloppes existantes 2/20/100, aucun reset de consommation. Pas de changement de schéma de données. L’extra Anthropic 0.87.0 déjà verrouillé en amont est ajouté à l’image scellée.

Fichiers : worker fournisseur/runtime/recherche/précontrôle, contrats partagés et redaction, service/plugin/transport Hermes, script et tests VPS, overlay privé, tests unitaires/intégration, CI et documentation. [Architecture](../adr/0017-anthropic-native.md), [procédure](../ANTHROPIC.md).

## Vérifications

Révision déployable **`35e1113384ab59c03157686efae5af166ce9a99a`**, [PR #9](https://github.com/TFourniax/ulysse-ithaque-saas/pull/9). Deux workflows terminés avec succès sur cette révision : [CI applicative 5/5](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/39948259246) et [Hermes/mises à niveau 8/8](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/39948259249).

- `npm run verify` réussi : format, lint, TypeScript, cycles, OpenAPI, contrôle documentaire et 141 tests unitaires, dont 47 worker. Quatorze tests de transformation VPS réussis; syntaxe Python, script VPS et blocs opérateur Bash contrôlée.
- CI avec infrastructure réelle : PostgreSQL 50/50, API 18/18, worker 54/54, navigateur 15/15; quatorze tests dans l’image Hermes épinglée avec sa vraie boucle et le SDK Anthropic installé.
- Stacks neuves et mises à niveau UL-016 : parcours prochaine action, diagnostic comparatif avec relecture/correction, contenu lié, droits/isolation et persistance après redémarrage. Les routes OpenRouter existante et Anthropic native passent chacune la recette. Sauvegarde/restauration, session, historique et décisions sont conservés dans les scénarios vérifiés.

Les données et réponses fournisseurs sont fictives/scriptées; ces contrôles démontrent l’intégration, pas la qualité sémantique ni la disponibilité d’Anthropic réel. La première CI a détecté l’absence de l’extra Anthropic dans l’image de base : le SDK natif était verrouillé mais pas installé. Ajout de `--extra anthropic --sealed` et d’un contrôle d’import/version à la construction. Les fixtures lisent les sources obligatoires et vérifient le comportement de secours attendu pour chaque route, sans modifier les contrôles métier.

## Limites et suite

Pas de clé locale, pas d’appel Anthropic réel, pas de déploiement VPS effectué par Codex. Le catalogue vérifie seulement clé/modèle, les prix sont versionnés d’après la documentation. Les garanties Europe/ZDR ne sont pas transférées à cette route. Clôture UL-021 : trois parcours réels relus et coûts/délais observés après activation par Thomas, puis recette recherche.
