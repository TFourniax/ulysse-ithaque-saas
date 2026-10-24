# Déposer un export CRM

1. Dans Ulysse, ouvrir **Importer mes affaires** (également accessible depuis les opportunités).
2. Sélectionner ou déposer le CSV. Depuis Excel : **Enregistrer sous → CSV UTF-8**, une feuille à la fois.
3. Vérifier le nombre de lignes et, si besoin, le volet **Informations reconnues**. Les colonnes non utilisées ne sont pas enregistrées. Les lignes restreintes ou invalides restent écartées et expliquées.
4. Résoudre les éventuels rapprochements : actualiser une affaire proposée, créer une affaire distincte ou écarter la ligne.
5. Cliquer **Importer … affaires**. Le traitement continue après fermeture de l’écran. L’historique indique le nombre créé, actualisé, inchangé ou écarté.
6. Ouvrir **Voir mes affaires**, puis **Faire avancer mes affaires**. L’analyse utilise la doctrine, le contexte et le mode moteur déjà configurés. Une absence de doctrine validée peut empêcher la préparation d’actions, même si l’import a réussi.

Déposer ensuite un nouvel export dans le même portefeuille. Une affaire connue garde son identifiant Ulysse; celles absentes du fichier restent conservées. Vérifier les rapprochements lorsque titre ou entreprise ont changé. Un export identique ne doit créer ni doublon ni révision commerciale supplémentaire.

Un dépôt accepte 5 Mo, 2 000 affaires, 200 colonnes. Les extraits utiles par affaire sont bornés par le contrat commercial existant; un texte trop long est signalé dans l’aperçu. Aucun lien de pièce jointe n’est ouvert automatiquement, aucune formule n’est exécutée, aucun courriel n’est envoyé. Seul un propriétaire peut importer ou retirer la source.

L’envoi d’une pièce dans la conversation de développement n’importe pas les données dans l’application. Le fichier reste à déposer dans l’espace de l’entreprise après la mise à jour contenant UL-024.

Pour retirer les données, ouvrir **Connexions**, choisir la source **Fichiers CRM**, puis retirer son accès. Les copies d’aperçu sont effacées immédiatement; le worker purge ensuite les données source et les copies d’analyse concernées. Les données déjà sauvegardées suivent la rétention des sauvegardes.

En cas d’échec, **Réessayer cet import** reprend la transaction sans dupliquer les affaires. Si un export plus récent a été intégré, préparer un nouvel aperçu plutôt que réappliquer un ancien état.
