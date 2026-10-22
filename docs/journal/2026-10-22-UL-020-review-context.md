# UL-020 — réparation de la relecture sur corpus volumineux

Responsable : Codex. Dette : DEBT-036. Périmètre : préparation des preuves, correction de relecture, diagnostic opérateur et tests. Branche `codex/ul-020-web-research`, PR draft #8; aucune fusion ou connexion SSH au VPS depuis cet environnement.

## Observation établie

Le diagnostic transmis par Thomas porte sur un run commencé à 14:53 UTC, soit 16:53 Europe/Paris le 22 octobre. Les images `c5618617c51a` sont actives et saines. Modèle Mistral Small, profil à 6 000 tokens, 113,5 secondes, cinq appels, trois outils, 81 248 tokens entrants, 7 831 sortants et 0,017290 USD déclarés. Dix sources et treize références fournies; cinq lignes échouent à `bilateral_evidence_required`. Aucune tentative de correction de relecture, aucun 429 ni coût incertain sur ce run. Aucun secours configuré dans son snapshot. L’hypothèse d’un serveur resté à l’ancienne version est écartée.

Le message générique du navigateur ne permettait pas d’identifier la version serveur. Le correctif précédent était bien installé mais ne suffisait pas à obtenir le résultat demandé.

## Défaut et changement

L’ancienne correction ajoutait la réponse du relecteur après son brouillon initial, puis réinjectait les sources complètes et le schéma. Le message pouvait dépasser les 80 000 octets du profil alors que la première revue tenait; la tentative était alors ignorée, sans motif de taille enregistré. Les réponses historiques ne sont pas stockées : la taille exacte du run réel ne peut pas être calculée rétrospectivement.

La correction remplace désormais le brouillon précédent par la dernière réponse à corriger. Les sources et leurs versions restent complètes et sont revalidées avant toute transmission. Les groupes de citations propres/concurrentes sont explicitement fournis au relecteur. Aucun ajout automatique de citation, assouplissement du contrôle bilatéral ou publication du brouillon initial non relu.

Le snapshot technique indique maintenant la taille du message, son plafond, les nombres de références propres/concurrentes et le motif de décision de réparation. Les motifs sont fixes, sans texte client. Le script VPS affiche également le modèle de secours configuré; une erreur de preuves n’autorise toujours pas sa bascule.

## Vérification et limites

Test de régression sous PostgreSQL : huit sources complètes proches de leur taille maximale, cinq comparaisons unilatérales; l’ancienne requête de réparation dépasse 80 000 octets. Le test exige une correction compacte, la présence exacte de tous les textes sources, la publication de cinq comparaisons bilatérales, la comptabilité des deux appels, le refus après une correction restant invalide et le refus si une source change entre revue et réparation. La correction d’un JSON de revue invalide est également couverte.

`npm run verify` réussi localement (135 tests unitaires), syntaxe du script et douze tests de transformation VPS réussis. Les quatre tests Python de preuves/relecture passent localement. Au commit `56a395c187d92b47559231b17cccc2afafde9729`, [CI applicative 5/5](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/39806287157) réussie : PostgreSQL 50/50, API 18/18, worker 53/53 dont le nouveau scénario volumineux et navigateur 15/15.

Deux adaptations des fixtures ont été nécessaires : le nouveau test utilisait d’abord cinq sources par lecture alors que l’outil en accepte quatre; les lectures sont maintenant groupées par quatre sans modifier cette limite. Le fournisseur scripté de stack détectait une correction par la présence de l’ancien message assistant et supprimait à nouveau une référence après compactage. Il reconnaît désormais la demande de correction et renvoie les références bilatérales de ses seules sources fictives. Un test Python vérifie la correction sans ancien message assistant. Aucun ajout automatique de référence n’a été introduit dans le code live.

Code final **`1d1836ca0ef00d2e4fa2050608b5fe16917a63b6`** : [CI applicative 5/5](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/39806904185) et [Hermes/mises à niveau 6/6](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/39806904218) réussies. 135 tests unitaires, PostgreSQL 50/50, API 18/18, worker 53/53, navigateur 15/15 et douze tests Python dans l’image Hermes. Les marqueurs `UL017_BUYER_HERMES_STUB=passed`, `UL017_CONTENT_HERMES_STUB=passed` et `UL016_RESTART_PERSISTENCE=passed` sont présents dans les recettes neuve et mise à niveau. Le dernier job de simulation a passé du temps à installer Chromium, puis a terminé avec succès. Les fournisseurs sont scriptés dans les tests; aucune inférence réelle ni nouvel essai sur le corpus Paitite n’a été exécuté ici. Les plafonds de contexte, de durée et d’appels restent bornés. Une correction peut encore être refusée si elle ne tient pas ou ne produit pas de preuves exploitables; le motif est désormais observable. DEBT-034/035/036 restent ouvertes jusqu’à la recette live et la revue humaine.
