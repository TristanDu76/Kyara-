# Kyara Plus — extension locale

Cette extension charge le script Kyara Plus fourni sur `kyara.games`. Elle utilise uniquement les permissions Chrome `alarms` et `storage` pour réveiller l’onglet Kyara à l’heure prévue et mémoriser ce réveil localement.

La version 2.7.0 prépare Firefox Android avec les mêmes sources que Chrome et améliore les contrôles tactiles sur petit écran. Le bouton **KYARA +** ouvre quatre onglets : Boosters, Historique, Interface et Outils.

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

### Firefox Android — paquet à signer

Firefox Android **142 ou plus récent** est requis. Le ZIP du dépôt et le ZIP généré ne s’installent pas directement : une installation normale exige un **XPI signé par Mozilla**. Chrome Android ne charge pas cette extension.

1. Générer les paquets avec `python scripts/build.py` (Python 3.10+ ; sous Windows, `py -3 scripts/build.py` convient aussi).
2. Avec un compte Mozilla, ouvrir le [portail développeur AMO](https://addons.mozilla.org/developers/addon/submit/distribution), choisir la distribution **On your own / par vos propres moyens**, puis soumettre `dist/kyara-plus-firefox-<version>-unsigned.zip` en remplaçant `<version>` par la valeur `version` de `manifest.json`. Cela transmet le code à Mozilla pour signature, sans fiche publique dans leur catalogue. Aucun identifiant Mozilla n’est stocké dans le dépôt.
3. Après validation, télécharger le **XPI signé** et le transférer sur le téléphone.
4. Dans Firefox Android : **Paramètres → À propos de Firefox → toucher le logo cinq fois rapidement**.
5. Revenir dans **Paramètres → Installer une extension depuis un fichier**, sélectionner le XPI et accepter l’installation et l’accès à Kyara.
6. Ouvrir `https://kyara.games`, se connecter et ouvrir **KYARA +**.

Ne pas renommer le ZIP en XPI : cela ne remplace pas la signature. Pour une mise à jour privée, signer un nouveau paquet avec le même identifiant d’extension et une version supérieure, puis installer le nouveau XPI. Les mises à jour privées ne sont pas automatiques dans cette configuration.

Références : [installation Android depuis un fichier](https://extensionworkshop.com/documentation/publish/install-self-distributed/), [distribution privée et signature](https://extensionworkshop.com/documentation/publish/self-distribution/).

Sur mobile, garder Firefox et l’onglet Kyara ouverts au premier plan pendant une session automatique. Android peut suspendre le navigateur en arrière-plan ou écran verrouillé. Au retour dans l’onglet, le script relit le stock et reprend si l’automatisation est toujours activée. Il n’ouvre aucun booster sans confirmation explicite de sa gratuité. Les réglages et l’historique du PC ne sont pas transférés sur le téléphone.

Pour tester sur Firefox **de bureau 140+**, générer le paquet puis charger `dist/firefox/manifest.json` dans **about:debugging → Ce Firefox → Charger un module complémentaire temporaire**. Ce chargement disparaît au redémarrage du navigateur et ne remplace pas un test sur Android.

## Maintenance Chrome et Android

Une seule base de code et une seule version sont conservées. `manifest.json` reste le manifeste Chrome ; `platforms/firefox.json` décrit seulement les différences Firefox (script d’arrière-plan et paramètres Mozilla). `python scripts/build.py` génère `dist/chrome/`, `dist/firefox/` et leurs ZIP, sans dépendance Python supplémentaire.

Les fichiers générés restent hors Git. Les archives contiennent uniquement les cinq assets du runtime et le manifeste, sans tests, documentation, captures, fichiers locaux ou credentials.

La branche `feat/firefox-android` sert à préparer et valider cette adaptation. La cible est de la fusionner dans `main` après validation mobile, puis de conserver **Chrome et Firefox ensemble dans `main`**. Les prochaines corrections communes seront ainsi présentes dans les deux paquets ; deux branches permanentes imposeraient des reports manuels inutiles.

Pour une livraison : augmenter `version` dans `manifest.json` et `VERSION` dans `kyara-plus.js`, lancer les validations, générer les deux paquets, tester les deux navigateurs, puis faire signer le paquet Firefox. Conserver `browser_specific_settings.gecko.id` pour que Firefox reconnaisse les mises à jour.

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
- `platforms/firefox.json` : différences du manifeste Firefox, y compris Android.
- `scripts/build.py` : génération des deux paquets depuis les mêmes sources.

Le code s’exécute dans le contexte de page pour observer les appels `fetch` du site. Il ne dispose d’aucune permission d’accès aux cookies ou aux autres sites.

## Vérification locale

Sans dépendance supplémentaire : `node --test test/*.test.js`. Contrôle de syntaxe : `node --check kyara-plus.js`, puis les mêmes contrôles sur `booster-core.js`, `bridge.js` et `service-worker.js`.

Tests de génération : `python -m unittest discover -s test -p "*_test.py"`. Ils vérifient les manifestes, l’identité des scripts entre navigateurs, le contenu et l’intégrité des ZIP, la reproductibilité et la conservation des fichiers étrangers au build.

Validation manuelle Android avant diffusion : chargement du panneau, défilement sans débordement à 320–420 px, choix du type, ouverture gratuite ×1, bilan, pause, refus du bouton payant et reprise au retour au premier plan. Une vérification de bureau ou une simulation de largeur mobile ne garantit pas le comportement d’Android en arrière-plan.

### État de validation de la 2.7.0

- 23 tests Node et deux tests Python réussis ; syntaxe des quatre scripts vérifiée.
- Paquet Firefox contrôlé avec le validateur Mozilla `web-ext lint`.
- Firefox de bureau 158.0.1, profil isolé, extension temporaire et site local simulé : choix de Shōnen, réveil via les API réelles de Firefox, deux ouvertures gratuites ×1, stock 2 → 0, dix cartes dans l’historique, aucune dépense et mise en pause.
- Les quatre vues du panneau ont été contrôlées à 320, 390 et 420 pixels sans débordement horizontal ; bouton de fermeture accessible. Pour ce banc uniquement, les motifs d’URL et la vérification d’origine du background ont été adaptés à localhost dans une copie temporaire ; les paquets livrés restent limités à Kyara.
- **À faire : signature Mozilla, installation et validation sur un véritable téléphone Android.** Aucun fonctionnement en arrière-plan sur Android n’est certifié par ces contrôles.

Les contrôles DOM dépendent de l’interface actuelle de Kyara. Si elle change, une absence de bouton ou de compteur arrête le passage ; elle n’autorise pas un achat en chakra.
