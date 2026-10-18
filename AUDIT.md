# Audit et refactor — Kyara Plus 2.6.2

## Périmètre

Revue du runtime, du stockage, du hook réseau, des fonctions de collection et d’échange, puis refactor ciblé des boosters et du panneau. L’audit initial a été réalisé avant la création du dépôt Git, à partir d’une copie de la version 2.5. Aucune dépendance ajoutée ni nouveau droit d’accès : les permissions restent `alarms` et `storage`, avec les scripts limités à Kyara.

## Défauts corrigés

| Constat | Correction |
| --- | --- |
| Le passage de 1 à 0 était perdu par un contrôle de valeur vraie | Confirmation booléenne indépendante de la valeur finale du compteur |
| « Ouvrir un autre » était pris pour une ouverture réelle | Retour au menu, puis clic séparé sur « Ouvrir » ; régression reproduite par un test |
| Le mode ×5/×10 du site pouvait dépasser la limite demandée | Sélection et confirmation de ×1 avant chaque ouverture |
| Une pause ou un changement de type pouvait laisser continuer la série | Vérification avant chaque nouveau clic, génération d’exécution invalidée à l’arrêt |
| Plusieurs onglets écrasaient un réveil global | Alarmes séparées et opérations sérialisées par onglet |
| Une annulation pouvait courir avec une programmation encore en cours | File de programmation/annulation et stockage avant création de l’alarme |
| L’échec tardif d’un ancien réveil pouvait effacer une programmation plus récente | Lecture, envoi et annulation du réveil passent par la même file que les programmations |
| Le verrou localStorage n’était pas atomique | Web Locks pour sérialiser les ouvertures, onglet pilote pour l’automatisation |
| La duplication d’un onglet pouvait copier son identité via sessionStorage | Identité neuve par document, libération du pilote à la sortie et reprise au retour du cache de navigation |
| Le cache inventait du stock au passage du temps | Cache affiché comme estimation ; clic autorisé uniquement par le compteur vivant et le bouton gratuit |
| Les doublons étaient dédupliqués dans le bilan | Conservation de chaque occurrence de carte |
| Une réponse tardive pouvait ajouter une seconde entrée à l’historique | La boucle enregistre chaque tirage confirmé une fois ; le hook réseau collecte les données seulement |
| Les noms étaient remplacés par « Carte #… » après rechargement | Nom et rareté du résultat conservés quand le catalogue est absent |
| Le compteur du header pouvait masquer le compte à rebours de l’accueil | Lecture prioritaire de la pill de boosters gratuits |
| Panneau compact regroupant toutes les fonctions | Fenêtre responsive avec onglets, métriques, cartes, navigation clavier et fermeture Échap |

## Validations

- Tests du moteur : dernier booster, série, deux étapes de retour au menu, refus des boutons payants/ambigus, stock absent, pause, changement de route, résultat incertain, panne de résumé et doublons.
- Tests des alarmes : deux onglets, échéance, expéditeur, instant invalide et course programmation/annulation.
- Tests du pont : origine/fenêtre, réveil et exclusion des iframes.
- Manifeste et présence de tous les assets ; contrôles de syntaxe des quatre scripts.
- Banc d’intégration local avec le script complet : remise de ×5 à ×1, trois ouvertures, 15 cartes, stock à zéro, aucune dépense.
- Test réel de la 2.6 sur Kyara : navigation depuis l’accueil, première ouverture Shōnen gratuite confirmée, révélation et cinq cartes détaillées ; solde inchangé. Ce test a reproduit la transition de retour au menu, corrigée en 2.6.1.
- Test réel final de la 2.6.1 : six boosters Shōnen ouverts en série, stock 6/10 → 0/10, 30 cartes ajoutées à l’historique et solde inchangé.
- Reprise accélérée sur le banc local avec le script complet : stock initial nul, attente du compte à rebours, arrivée d’un gratuit, ouverture automatique puis retour à zéro. Une ouverture serveur, aucune dépense et cinq cartes enregistrées, dont un doublon conservé et une carte de wishlist.
- Les quatre vues, la navigation entre onglets avec les flèches, la fermeture Échap avec retour du focus et la pause/reprise à stock nul ont été vérifiées sur le site. Aucune erreur/warning n’a été observé dans les logs capturés pendant le parcours final.
- Résultat des tests automatisés de la 2.6.2 : **21/21 réussis**, dont les régressions de réveil tardif et d’onglet dupliqué reproduites en échec avant correction. Les courses du service worker sont contrôlées par simulation des API Chrome.
- Cycle réel final sous 2.6.2 : attente à stock nul sur l’accueil, arrivée du prochain booster gratuit, ouverture Shōnen et cinq nouvelles cartes inscrites au bilan, solde inchangé. Le bilan cumulé des essais contient **10 boosters et 50 cartes**.
- Revue indépendante finale : deux findings de concurrence reproduits et corrigés ; nouvelle revue sans finding vérifiable ni régression identifiée.

## Limites et propositions

Une disponibilité à 100 % ne peut pas être garantie face à une modification de Kyara, une session expirée ou la mise en veille du navigateur/PC. En cas de résultat incertain, le moteur suspend l’automatisation et affiche la cause.

Évolutions proposées, non activées par ce refactor : bilan par session avec export CSV, notification sur une carte de wishlist ou une Légendaire+, et suggestion du booster le plus intéressant pour la wishlist. Ces ajouts peuvent s’appuyer sur l’historique existant sans multiplier les appels au site.
