# Kyara Plus — extension locale

Cette extension charge le script Kyara Plus fourni sur `kyara.games`. Elle utilise uniquement les permissions Chrome `alarms` et `storage` pour réveiller l’onglet Kyara à l’heure prévue et mémoriser ce réveil localement.

La version 2.6.2 apporte un tableau de bord dans la DA de Kyara et un moteur d’ouverture testé. Le bouton **KYARA +** ouvre quatre onglets : Boosters, Historique, Interface et Outils.

## Utiliser l’automatisation

1. Choisir le type de booster dans **Boosters**.
2. Régler le nombre maximum par passage et l’espacement.
3. Cliquer **Activer l’automatisation** et conserver cet onglet ouvert.
4. Revenir dans **Historique** pour le bilan par rareté, les nouvelles cartes et les correspondances de wishlist.

L’extension navigue vers `/ouvrir/{type}`, choisit ×1, clique uniquement sur un bouton explicitement gratuit, confirme la baisse du compteur et révèle les cartes. Après un tirage, **Ouvrir un autre** réinitialise d’abord l’écran ; le clic suivant sur **Ouvrir** consomme le booster. Le moteur distingue ces deux étapes.

Le prochain contrôle est programmé d’après le compte à rebours affiché par Kyara. Un verrou navigateur empêche les ouvertures concurrentes ; l’onglet qui active l’automatisation la pilote. Une pause empêche le clic suivant, et une ouverture dont le compteur reste inchangé suspend l’automatisation pour éviter les tentatives répétées. Chrome et l’onglet doivent rester ouverts : un PC en veille, un onglet suspendu ou une session expirée peuvent interrompre le parcours.

Les détails des cartes sont lus dans l’écran de résultat, avec un repli sur la réponse réseau. Les doublons d’un même tirage sont conservés. Les correspondances wishlist sont mémorisées au tirage ; si la liste d’identifiants n’est pas encore connue, ouvrir la liste d’envies sur Kyara. L’historique conserve les 500 derniers boosters sur ce navigateur et permet de copier le bilan.

## Installation sur un autre ordinateur

Le dépôt est privé : se connecter au compte GitHub autorisé pour le télécharger.

1. Sur [le dépôt GitHub](https://github.com/TristanDu76/Kyara-), choisir **Code → Download ZIP**, puis extraire l’archive dans un dossier permanent.
2. Suivre les étapes Chrome / Edge / Brave ci-dessous et sélectionner le dossier contenant `manifest.json`.

Avec Git, utiliser `git clone https://github.com/TristanDu76/Kyara-.git`, puis sélectionner le dossier `Kyara-` dans le navigateur.

Pour récupérer une mise à jour avec Git, lancer `git pull --ff-only` dans ce dossier, puis recharger l’extension et Kyara. Avec le ZIP, télécharger la nouvelle version et remplacer les fichiers du dossier installé avant de recharger.

GitHub conserve le code. Les réglages et l’historique restent propres à chaque navigateur ; ils ne sont pas synchronisés entre ordinateurs par ce dépôt.

## Chargement dans le navigateur

### Chrome / Edge / Brave

1. Ouvrir `chrome://extensions` (ou `edge://extensions`).
2. Activer le **Mode développeur**.
3. Choisir **Charger l’extension non empaquetée**.
4. Sélectionner ce dossier, celui qui contient `manifest.json`.
5. Recharger les pages Kyara déjà ouvertes.

Pour une mise à jour : **Recharger** l’extension dans cette page, puis recharger Kyara. Une navigation interne de Kyara conserve le code déjà injecté ; elle ne suffit pas à appliquer une nouvelle version.

### Firefox

Le manifeste MV3 utilise `world: "MAIN"` dans un content script déclaré, fonctionnalité prise en charge différemment selon le navigateur et sa version. Si Firefox refuse de charger l’extension ou ne démarre pas le script dans le contexte de page, cette version doit être portée vers un script MAIN injecté par `scripting.executeScript` depuis un background script, avec les permissions d’hôte correspondantes.

## Actions du script

La plupart des fonctions ajoutent des éléments d’interface ou lisent les données du site. Le verrouillage de cartes et les outils de boosters envoient des requêtes qui modifient le compte. L’ouverture automatique de boosters est désactivée par défaut. Vérifier le panneau Kyara Plus avant d’activer ces options.

## Fichiers

- `manifest.json` : déclaration de l’extension.
- `kyara-plus.js` : code applicatif adapté depuis le userscript fourni.
- `booster-core.js` : moteur et règles d’ouverture indépendants du DOM.
- `service-worker.js` : réveils séparés par onglet.
- `bridge.js` : messages entre le contexte du site et l’extension.
- `panel.css` : interface du compagnon.
- `test/` : tests de régression, du pont et de l’ordonnanceur.

Le code s’exécute dans le contexte de page pour observer les appels `fetch` du site. Il ne dispose d’aucune permission d’accès aux cookies ou aux autres sites.

## Vérification locale

Sans dépendance supplémentaire : `node --test test/*.test.js`. Contrôle de syntaxe : `node --check kyara-plus.js`, puis les mêmes contrôles sur `booster-core.js`, `bridge.js` et `service-worker.js`.

Les contrôles DOM dépendent de l’interface actuelle de Kyara. Si elle change, une absence de bouton ou de compteur arrête le passage ; elle n’autorise pas un achat en chakra.
