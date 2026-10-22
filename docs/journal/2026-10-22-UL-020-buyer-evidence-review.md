# UL-020 — Relecture factuelle du diagnostic acheteur

Responsable : Codex. Objectif : corriger les conclusions insuffisamment étayées du diagnostic live transmis par Thomas le 22 octobre à 13 h 10 (Europe/Paris), sans relancer la collecte. Branche `codex/ul-020-web-research`, PR draft #8. DEBT-034; qualité métier globale suivie en DEBT-024.

## Constat

Le texte utilisateur compare quatre acteurs nommés parmi quarante fiches disponibles et affiche les limites. La sélection et la présentation progressent par rapport au diagnostic de 11 h 59. Le texte contient cependant un classement de prix alors que celui de l'entreprise est inconnu, assimile un exemple de projet à une offre tarifée, confond méthode commerciale et résultats démontrés, généralise des absences à tout un site et conclut trop largement sur la différenciation. Les consignes précédentes interdisaient déjà plusieurs de ces inférences : les répéter seules n'apporte pas de contrôle supplémentaire. Le SHA, le modèle actif et le contenu exact des extraits de production ne sont pas établis par le texte transmis.

## Changement

Après un brouillon acheteur, le worker impose une passe de relecture séparée avec le même fournisseur, profil et routage. Elle reçoit le contexte autorisé, les sources obligatoires, les textes des références citées et les autres sources de l'offre déjà consultées. Le catalogue et le raisonnement du premier modèle ne sont pas transmis. Le brouillon reste une donnée non fiable. Les citations inconnues sont refusées avant toute relecture; celle-ci n'élargit pas les accès et ne dispose d'aucun outil.

La relecture corrige le résultat complet : comparabilité des prix, périmètre des constats d'absence, distinction déclaration/exemple/résultat mesuré, pertinence des alternatives, objections formulées en questions et verdict limité aux preuves. Elle conserve les comparaisons étayées. Un contrôle déterministe exige les deux offres dans chaque ligne comparative et dans un verdict d'unicité affirmatif. Ce contrôle ne prouve pas que chaque citation implique l'affirmation.

Les appels passent par les réservations et compteurs existants, avec huit transmissions au maximum, deux reprises fournisseur au total et une seule correction de format/références partagée par tout le run. Le bail acheteur passe à quatre minutes pour laisser une minute supplémentaire à la relecture; l'exécution Hermes reste bornée à trois minutes. Aucun plafond financier ni modèle n'est changé. La publication recontrôle autorisations, versions et fraîcheur. Aucun repli silencieux vers le brouillon non relu si la relecture échoue. Les données de recherche et les anciens diagnostics restent conservés.

Fichiers concernés : worker (`buyer-review`, passerelle, préparation/publication des parcours), domaine (preuves bilatérales), messages d'erreur web, fournisseur scripté Hermes, recette de stack et diagnostic VPS. Aucune migration ni modification du contrat public du résultat. `snapshot.buyerReview` conserve seulement version et état; `diagnose` les expose sans texte métier.

## Vérifications et limites

Code **`fbb44c480ac0a72ff1f7dded7c093d4ea1dac48e`** publié : [CI applicative 5/5](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/39779581152) et [Hermes/mises à niveau 6/6](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/39779581178) réussies; les onze contrôles sont terminés avec succès.

- `npm run verify` réussi : 130 tests unitaires, format, lint typé, TypeScript, cycles, OpenAPI et documentation.
- PostgreSQL 50/50, API 18/18 et worker 50/50 sous les rôles réels. Le nouveau scénario vérifie la transmission des textes sans catalogue/raisonnement précédent, le remplacement du brouillon par le résultat relu, les preuves bilatérales, la correction unique, le rejet persistant, un appel d’outil refusé, une reprise 429, les coûts et le refus de publication après changement d’une source.
- Navigateur 15/15. Sept tests Python ciblés en local et neuf dans l’image Hermes, dont la vraie boucle. Onze tests du script VPS et `bash -n` réussis.
- Stack neuve et mise à niveau depuis UL-016 : Hermes génère le brouillon scripté, le worker exécute la relecture sans outil, puis le modèle simulé s’abstient explicitement. Le script de recette exige la trace de cette seconde passe dans la sortie simulée. Parcours contenu, historique, session, redémarrage et sauvegarde/restauration vérifiés.

[Procédure de mise à jour](../RESEARCH-OPERATIONS.md) épinglée sur ce code. Les commits documentaires suivants ne changent pas le code testé.

Les fixtures vérifient le circuit et les contrôles; elles ne mesurent pas la qualité sémantique d'un modèle réel. Une seconde passe du même modèle peut encore conserver une erreur. Les citations exactes d'une extraction peuvent elles-mêmes manquer de contexte; la corroboration indépendante, la qualification des acteurs et les lacunes de collecte restent ouvertes. Aucun appel fournisseur réel ni déploiement VPS depuis cet environnement. Clôture après déploiement et relecture d'un nouveau diagnostic avec ses preuves, coût et durée.
