# ADR-0014 — Modèle économique, routage européen et ZDR

Date : 2026-10-20. Responsable : Codex, demande explicite de Thomas. Statut : implémenté, recette fournisseur et choix métier à confirmer.

## Contexte et décision

Thomas confirme la démo UL-017 `29ee0d2` en `hermes-live` avec GPT‑4.1 mini. Il demande un modèle moins cher, pertinent sur les trois parcours, sans entraînement ni conservation des prompts/réponses et traité en Europe. Les checks de santé transmis prouvent la configuration active, pas une inférence ni sa qualité.

Le modèle était verrouillé dans le worker et le superviseur Python. Ajouter le candidat `anthropic/claude-haiku-5.5` exclusivement avec `AGENT_PROVIDER_ROUTE=openrouter-eu-zdr`. Conserver GPT‑4.1 mini pour compatibilité et comparaison, dont une route européenne explicite.

| Modèle / route | Endpoint autorisé | Entrée / sortie USD par million de tokens |
| --- | --- | --- |
| Haiku 5.5 Europe | `amazon-bedrock/eu-west-1` | 0,11 / 0,55 |
| GPT‑4.1 mini Europe | `azure/swedencentral` | 0,44 / 1,76 |
| GPT‑4.1 mini historique | routage global existant | 0,40 / 1,60 |

Prix consultés dans le registre ZDR OpenRouter le 20 octobre 2026. Business ajoute 8 % à l'achat des crédits ; ces frais de financement ne sont pas des tokens et ne figurent pas dans les plafonds de consommation. Le coût réel dépend aussi des tokens consommés, du cache et des reprises.

La route européenne appelle exclusivement `https://eu.openrouter.ai/api/v1/chat/completions`, avec `provider.only` et `order` sur l'endpoint régional, `zdr:true`, `data_collection:deny`, prix maximaux et paramètres obligatoires. Aucun fallback ou redirection HTTP. Le modèle ne peut remplacer ces choix ni ajouter de plugin serveur. Le profil historique n'est pas qualifié de ZDR ou d'européen.

Haiku refuse `temperature` : le retirer. Désactiver explicitement le thinking, comme le contrat Hermes existant, et conserver 3 000 tokens de sortie, huit appels et 80 000 octets de contexte. La borne d'entrée, avec 2 048 tokens de marge, reste sous le palier tarifaire de 100 000 tokens. Les prix régionaux servent à la réservation et à l'estimation si le coût déclaré manque. Un échec incertain conserve sa borne engagée. Budgets et session ne sont pas réinitialisés.

Le précontrôle lit le catalogue de la clé sur le domaine européen et le registre public ZDR sans clé. Il refuse endpoint absent/inactif, paramètres incompatibles ou hausse de prix, sans envoyer de prompt. La route est historisée dans le snapshot et les événements du run. Le modèle est déjà enregistré.

## Conditions et limites

- Compte OpenRouter Business/Enterprise requis. Utiliser les crédits partagés, sans BYOK : un déploiement BYOK peut sortir de la région malgré le domaine européen. Désactiver exports/broadcast de contenu, logging et partage pour entraînement dans le compte.
- Selon OpenRouter, ZDR concerne les prompts/réponses des endpoints sélectionnés ; certains caches en mémoire restent permis. Facturation, compte et métadonnées opérationnelles peuvent être traités aux États-Unis. Ulysse conserve ses propres sources et résultats sur le VPS.
- La région OpenRouter couvre UE/EEE, Royaume-Uni et Suisse. L'endpoint retenu est nommé Irlande ; ce choix ne constitue pas un audit contractuel des sous-traitants.
- Haiku est un candidat : les évaluations éditeur ne démontrent pas une équivalence métier Ulysse. La configuration sans thinking doit aussi être évaluée.
- Le script vérifie le VPS, l'UID 10002 et le projet rootless `ulysse`. Il conserve migrations, volumes et historiques. Une reprise sur un ancien profil global remet le moteur en `rules`, pour éviter de reprendre des inférences mondiales.

## Sources officielles

- [Haiku 5.5 et évaluations éditeur](https://www.anthropic.com/claude-haiku-5-5)
- [Effort et thinking](https://platform.claude.com/docs/en/build-with-claude/effort)
- [Offre européenne et tarifs](https://openrouter.ai/business/eu/)
- [Routage régional et BYOK](https://openrouter.ai/docs/guides/features/in-region-routing)
- [ZDR](https://openrouter.ai/docs/guides/features/zdr)
- [Sélection des fournisseurs](https://openrouter.ai/docs/guides/routing/provider-selection)
- [Registre ZDR](https://openrouter.ai/api/v1/endpoints/zdr)

Procédure et recette : [MODEL-EU](../MODEL-EU.md).
