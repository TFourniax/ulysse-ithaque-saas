# UL-024 — Corriger les affaires avant import

24 octobre 2026, responsable Codex, DEBT-043. Thomas rapporte que les trois lignes du CSV sont reconnues mais exclues pour montant/devise. Le contenu exact du CSV exporté n’est pas disponible ici; l’erreur seule ne permet pas d’en attribuer la cause à un séparateur précis. Le contrôle précédent portait sur une conversion locale du XLSX, pas sur cet export réel.

## Changement

Reconnaissance des nombres français et anglais avec groupements contrôlés, choix explicite pour une lecture ambiguë, devise manquante et correction sans conversion. Édition des valeurs retenues dans l’aperçu, y compris les lignes refusées. Application en lot des choix de format et devise; nouvel aperçu obligatoire avant import. Choix de rapprochement conservés s’ils restent valides, données d’édition gardées lors d’un échec HTTP, origine des corrections conservée dans les documents commerciaux. Les restrictions et identifiants de source restent protégés.

Fichiers : domaine et contrats CRM, parseur et lecteur monétaire, route d’aperçu, interface/imports, tests parseur/API/navigateur, script VPS et documentation. Aucune migration, aucun nouveau fournisseur, aucune nouvelle boucle Hermes. Branche depuis `23249f954fed1de05980952cf3b4f93b9e75820d`.

## Vérifications

Tests ajoutés : formats Excel, séparateurs ambigus, montant vide, devise contradictoire, choix explicites, provenance, restrictions non contournables; aperçu corrigé puis import via vrais rôles API/worker; parcours navigateur avec vraie API et worker, plus échec de relecture et conservation des choix sur ordinateur/mobile. Contrôles locaux et CI à terminer avant de proposer le déploiement. Une interruption temporaire de l’environnement de développement a eu lieu; les modifications locales ont été retrouvées intactes. Aucun déploiement ni appel fournisseur réel réalisé ici.

## Suite

Relire le montant interprété lors du nouvel essai du CSV réel. Le statut MVP reste ouvert selon [le plan](../MVP-NEXT.md). La saisie de consignes libres n’est pas implémentée : ce lot fournit des choix explicites et l’édition directe.
