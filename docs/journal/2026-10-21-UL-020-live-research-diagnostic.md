# UL-020 — découverte live et diagnostic de la qualification bloquée

Date : 21 octobre 2026. Responsable : Codex. Objectif : identifier les étapes en échec dans la première campagne Paitite, sans nouvel appel payant ni modification du VPS.

## Observations transmises par Thomas

Le terminal transmis confirme l’installation de `51f0f7f515d2fbca83a64cf9e95e60daaf480381`, la santé API/worker, le contrat Hermes compatible et l’activation de Brave. Cette activation seule ne testait pas la clé auprès du moteur.

Les captures montrent une campagne créée à 13 h 24 (Europe/Paris). Un premier arrêt `provider_http_429` survient après trois lectures et aucune recherche, pour 0,0107 USD consommés ou réservés sur 0,75 USD et un appel incertain. Une commande de bascule vers le profil inclus Mistral Small 4 est proposée; aucune sortie de cette commande n’a été transmise. Ne pas attribuer les appels suivants à Mistral sans consulter leur identité enregistrée.

La collecte reprise passe par 60, 203 puis 347 acteurs repérés, avec 7, 21 puis 31 requêtes tentées. La dernière capture montre **347 acteurs, 31 requêtes, 47 lectures tentées, zéro concurrent qualifié, 0,2884 USD consommés ou réservés sur 1 USD, 13 appels incertains**, puis un nouvel arrêt `provider_http_429`. Les identifiants d’acteurs, données collectées, détails de la facturation et codes d’erreur des autres étapes ne sont pas visibles.

Ces observations étayent la découverte publique, pas la qualité du benchmark. Les pages tentées ne sont pas toutes des pages sauvegardées. L’arrêt est sous le plafond affiché; augmenter ce plafond ne traite pas le 429. Le modèle actif et la cause du zéro qualifié restent à établir.

## Changement livré

`scripts/ulysse-vps-europe.sh` ajoute `diagnose-research [tenant-slug]`. Les gardes hôte/UID/socket/projet et le contrôle d’unicité des conteneurs restent actifs. La commande utilise les images existantes et consulte uniquement des champs techniques explicites, agrégats et métadonnées d’identité sélectionnées, dans une transaction répétable en lecture seule avec un délai SQL borné. Aucun appel réseau fournisseur, changement de données, redémarrage ou déploiement.

Le rapport distingue les modèles enregistrés dans les appels, les recherches, lectures et extractions, les tâches terminées/échouées/en attente, la qualification et le nombre de faits. Il précise que le code d’une tâche rejoint à un ancien appel est son état actuel, pas une preuve de l’erreur historique de cet appel. Les pages, citations, requêtes, noms, clés, réponses fournisseur et métadonnées brutes ne sortent pas.

Les documents d’état, backlog et exploitation reflètent désormais la réussite du déploiement et le blocage de qualification réellement rapportés. Aucun code du moteur, profil, tarif, budget, contrat ou schéma n’est modifié dans ce lot.

## Défaut indépendant et limites

La lecture de `research-model.ts` montre que l’usage est décodé avant le résultat, mais retourné seulement après sa validation. Si le JSON ou le schéma du résultat est rejeté, le runtime ne reçoit pas cet usage et conserve la réservation inconnue. DEBT-027 enregistre ce défaut; les captures seules ne prouvent pas qu’il explique les treize appels incertains. Les erreurs de preuves après retour de `generate` sont différentes : leur usage a déjà pu être enregistré.

Le diagnostic ne permet pas de récupérer rétroactivement des réponses qui n’ont pas été conservées. Il doit d’abord déterminer quelles catégories d’erreur dominent. Le 429 ne prouve ni une panne générale du modèle ni une limite précise du compte. La correction de la reprise bornée reste DEBT-023; la qualification live et la revue métier restent DEBT-024.

## Vérification et suite

Vérifications locales réussies : `bash -n scripts/ulysse-vps-europe.sh`, `python3 scripts/test-vps-europe.py` (9/9) et `npm run verify` (format, lint, types, cycles, OpenAPI, 111 tests unitaires, 61 documents Markdown et liens internes). L’exécution des nouvelles requêtes contre la base VPS reste à effectuer par Thomas; aucun accès SSH ni appel fournisseur depuis cet environnement pour cette intervention. Ces contrôles ne prouvent pas l’exécution SQL sur PostgreSQL réel ni la résolution de l’incident.

Suite : exécuter le diagnostic, examiner le modèle réellement employé et les catégories d’erreurs, corriger les défauts établis avec des cas de reproduction, puis reprendre la même campagne avec des budgets conservés. Ne pas valider un diagnostic acheteur sans preuves concurrentielles qualifiées.
