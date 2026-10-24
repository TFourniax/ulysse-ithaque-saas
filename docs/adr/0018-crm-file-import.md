# ADR-0018 — Import CRM revu, avant l’API Néréis

24 octobre 2026. Décision d’implémentation UL-024, responsable Codex, à la demande de Thomas. Le dépôt d’un CSV doit alimenter Ulysse sans ressaisie des affaires. Aucun nouvel orchestrateur de modèle.

## Parcours

Le propriétaire ouvre **Importer mes affaires**, dépose un CSV, vérifie l’aperçu et confirme. Reconnaissance des intitulés Néréis et des champs usuels, ajustable dans un volet secondaire. Les champs inconnus ne sont pas stockés sauf choix explicite d’une catégorie. Les séparateurs virgule, point-virgule et tabulation, les champs cités, les lignes multiples et les exports UTF-8/Windows-1252 sont pris en charge. Excel doit être enregistré en CSV UTF-8 : aucun parseur XLSX ni exécution de formule n’est ajouté.

5 Mo, 2 000 lignes et 200 colonnes par dépôt constituent une limite de ressource, pas un objectif de latence. Les lignes invalides restent visibles et exclues; l’utilisateur peut intégrer les autres. Les colonnes explicitement restreintes à un groupe ne sont jamais importées dans l’espace partagé. Un mapping ne peut pas masquer une restriction reconnue.

## Identité et réimport

Chaque affaire reçoit un identifiant Ulysse aléatoire. Le rapprochement conserve séparément un identifiant source, s’il existe; sinon une empreinte entreprise + titre + portefeuille est utilisée. Une correspondance exacte unique propose une mise à jour. Plusieurs correspondances, un doublon dans le fichier ou un titre modifié chez une entreprise connue demandent une décision. Les rapprochements ne sont pas des preuves d’identité universelles. Les identifiants API Néréis pourront compléter ce registre ultérieurement.

Un nouveau dépôt ne signifie jamais une synchronisation exhaustive : les affaires absentes restent conservées. Un champ présent vide diffère d’une colonne non exposée. Une première interaction n’est jamais une dernière interaction. Les objectifs, montants potentiels et hypothèses sont gardés comme déclarations, sans les transformer en chiffre d’affaires réalisé. Les sources de pièces jointes ne sont pas téléchargées implicitement.

## Persistance et exécution

`crm_import_batches` contient l’aperçu, son propriétaire, sa date d’expiration et les choix validés; `crm_import_items` associe les clés de rapprochement aux identifiants internes. RLS forcée, clés composées tenant/connexion et contrôle serveur des permissions. Aucun secret ni contenu client dans l’audit. Un seul import confirmé par connexion est en attente à la fois. Une empreinte des affaires déjà connues interdit de confirmer un aperçu devenu périmé.

La confirmation crée un événement outbox `connection.sync_requested`. Le worker existant traite les connexions `crm-file` en utilisant la même persistance versionnée que les connecteurs : source, opportunité, faits puis `source.changed`. L’analyse suit la configuration active, dont Hermes/Anthropic; ni fournisseur, ni budget, ni prompt ne sont modifiés. La transaction d’import est atomique et rejouable. Une erreur annule ses écritures; une reprise explicite reste possible si aucune intégration ultérieure n’a changé le portefeuille.

Le contenu métier inchangé ne crée pas de nouvelle révision; la date d’arrivée d’un fichier ne suffit pas à modifier un document. Une mise à jour conserve l’identifiant d’affaire et invalide les preuves anciennes via le circuit existant. Les fichiers n’ont aucune resynchronisation périodique : sans nouveau dépôt, leur fraîcheur ne progresse pas. La date observée est celle du dépôt, pas une attestation de la date d’extraction du CRM.

## Minimisation et retrait

Seuls les champs retenus sont conservés dans les matériaux commerciaux normalisés (12 extraits de 4 000 caractères maximum, limite préexistante du moteur). Un dépassement est signalé; aucun tronquage silencieux d’une ligne acceptée. Les informations gardent leur intitulé source. Les matériaux sont des données non fiables comme toute autre source; ils n’autorisent aucun outil et ne modifient jamais la doctrine.

L’aperçu disparaît après intégration ou annulation. Un aperçu abandonné expire au bout de 24 h et est purgé par la maintenance; une tentative échouée expire après sept jours. Le retrait de la connexion efface immédiatement les copies d’import puis déclenche la purge standard des sources et résultats dérivés. Les sauvegardes suivent la politique existante de rétention.

## Limites et suite

Ce lot alimente les affaires et la préparation de leurs prochaines actions. Il ne publie pas les noms ou notes CRM dans un contenu marketing. Le rapprochement contrôlé de ces observations avec les parcours acheteur/contenu, la doctrine de Denis protégée et le suivi d’une action réellement effectuée restent des lots explicites du MVP. Un import et des tests techniques réussis ne constituent pas la recette commerciale du MVP.
