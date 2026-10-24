# UL-023 — Texte de publication identifiable

Date : 24 octobre 2026. Responsable : Codex. Dette : DEBT-042.

## Objectif et périmètre

Le contenu live transmis par Thomas à 15 h 35 (Europe/Paris) aboutit, mais son corps est présenté après plusieurs explications. Le lot améliore uniquement la hiérarchie de lecture et la copie du contenu. La révision déployée et la trace fournisseur ne sont pas établies par le texte transmis; aucun texte client n'est ajouté au dépôt.

## Changements

- `PublicationPreview.tsx` affiche un encadré nommé « Texte de la publication », préserve les retours à la ligne et copie exactement le corps sur clic. Ni titre, justification, objectif du lecteur, source ni limite ne sont ajoutés au presse-papiers. Un refus propose une zone en lecture seule à sélectionner manuellement; aucun faux succès.
- `Workflows.tsx` place cet encadré en premier, sous le titre et les états. Le brief, les explications et leurs sources restent disponibles dans un volet replié accessible au clavier. Les erreurs et l'obsolescence restent visibles; les contrôles de validation restent identiques. Les résultats sans contenu, dont les diagnostics et demandes de précision, conservent leur présentation.
- `styles.css` reprend les couleurs du thème, un corps de largeur lisible et un en-tête souple sur mobile. Le texte reste du texte React, sans interprétation HTML.
- `content-preview.spec.ts` vérifie copie exacte, sauts de ligne, clavier, sources/limites accessibles, refus du presse-papiers, obsolescence, accessibilité et absence de débordement sur ordinateur et mobile. La sortie de parcours est une fixture UI explicitement fictive; la session et l'application restent celles de la recette navigateur.
- Le script VPS cible la branche UL-023 pour déployer une révision épinglée avec la configuration existante. Aucun changement de profil, de budget, de clé ou de migration.

## Vérification

Vérification locale réussie : `npm run verify` (146 tests unitaires et contrôles statiques/documentaires), construction web, `bash -n` et les 14 tests du script VPS. Les cinq contrôles de [CI sur 9afb255](https://github.com/TFourniax/ulysse-ithaque-saas/actions/runs/40099566268) passent, dont 19 tests navigateur (les quatre scénarios de copie et repli ordinateur/mobile inclus). Le nom des captures est ensuite aligné sur le filtre d’artefacts existant pour permettre leur inspection visuelle; cette dernière vérification est encore en cours. L'environnement local ne dispose pas de navigateur installé; son téléchargement Playwright échoue. La CI vérifiera le rendu et conservera des captures fictives. Aucun appel fournisseur, publication externe ou déploiement VPS depuis cet environnement.

## Recette et limites

Après déploiement, actualiser le contenu déjà généré : aucune nouvelle inférence n'est nécessaire pour bénéficier de cet affichage. Vérifier la copie dans un éditeur et ouvrir le volet de sources avant validation. La copie reste distincte d'une approbation et d'une publication; elle n'altère ni la qualité éditoriale ni les paragraphes enregistrés. Les preuves de qualité métier restent celles des essais live relus par Thomas.
