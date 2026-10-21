# Kyara Plus — extension locale

Cette extension charge le script Kyara Plus fourni sur `kyara.games`. Elle utilise uniquement les permissions Chrome `alarms` et `storage` pour réveiller l’onglet Kyara à l’heure prévue et mémoriser ce réveil localement.

La version 2.8.2 ouvre les boosters gratuits par lots complets, en boucle, avec des contrôles de coût avant tout envoi réseau. Chrome et Firefox Android partagent les mêmes sources. Le bouton **KYARA +** ouvre quatre onglets : Boosters, Historique, Interface et Outils.

## Utiliser l’automatisation

1. Choisir le type de booster dans **Boosters**.
2. Régler **Boosters par lot · seuil à attendre**, entre 1 et 10.
3. Cliquer **Activer l’automatisation** et conserver cet onglet ouvert.
4. Revenir dans **Historique** pour le bilan par rareté, les nouvelles cartes et les correspondances de wishlist.

Le nombre choisi est à la fois le seuil de départ et la quantité du lot. Avec 10, l’extension attend 10 gratuits, sélectionne ×10, ouvre le lot et attend à nouveau 10 gratuits. Avec 5, elle utilise ×5. Avec 1, elle utilise ×1 à chaque gratuit. Les autres tailles combinent ×5 puis le complément en ×1 (7 = 5 + 1 + 1). La boucle reste activée jusqu’à la pause, sauf résultat incertain qui demande une reprise manuelle. Les anciens réglages « max par passage » sont migrés vers ce seuil.

**Pause entre actions d’ouverture (s)** espace les clics successifs, par exemple entre ×5 et les deux ×1 d’un lot de 7, ou entre deux lots lorsque le stock permet déjà le suivant. Ce réglage n’attend pas entre les boosters d’un clic ×5 ou ×10 et ne remplace pas l’attente du stock. En arrière-plan, le navigateur peut allonger ce délai minimum. **Ouvrir le lot maintenant** demande aussi un lot complet ; il ne complète jamais avec du chakra.

L’extension navigue vers `/ouvrir/{type}`, vérifie le stock vivant et le bouton gratuit, confirme une baisse correspondant exactement à la quantité demandée, puis révèle les cartes. **Ouvrir un autre** et **Ouvrir encore ×N** réinitialisent d’abord l’écran ; le clic suivant sur **Ouvrir** consomme le lot. Un bouton de retour au menu peut afficher un prix pour l’ancienne quantité : il sert uniquement à revenir au sélecteur, puis la nouvelle quantité et sa gratuité sont contrôlées avant l’ouverture réelle.

Avant un envoi déclenché par l’automatisation, un second garde contrôle l’endpoint, le type, la quantité et exige le plafond serveur **`maxChakra: 0`**. Chaque autorisation ne sert qu’à un envoi et est annulée à la pause. L’identifiant de requête du site est obligatoire ; il reste mémorisé dix minutes pour bloquer les doubles envois et retries tardifs, au-delà de la fenêtre de retry observée de deux minutes. Un bouton payant/mixte, un plafond absent, ambigu ou supérieur à zéro bloque l’ouverture. Si le site change son contrat, l’extension suspend le passage.

Le prochain contrôle est programmé d’après le compte à rebours affiché par Kyara, même quand du stock est présent mais inférieur au seuil. Un verrou navigateur empêche les ouvertures concurrentes ; l’onglet qui active l’automatisation la pilote. Une pause empêche le clic suivant. Une baisse de stock non confirmée suspend l’automatisation pour éviter les tentatives répétées.

### Arrière-plan sur PC

Tu peux utiliser un autre onglet ou jouer à un jeu pendant que le navigateur reste ouvert. L’extension désactive l’option **Animations** de la page d’ouverture, car son animation attend des images `requestAnimationFrame` qui peuvent s’arrêter dans un onglet caché. La confirmation des boosters payants reste inchangée. Cette préférence d’animation est conservée par Kyara ; tu peux la réactiver pour tes ouvertures manuelles.

Les alarmes d’extension réveillent l’onglet sans le sélectionner. Les attentes d’ouverture observent les mutations du DOM, au lieu de dépendre uniquement des timers de la page. Dans Chrome, l’onglet pilote est temporairement protégé contre le déchargement automatique (`autoDiscardable: false`), puis sa valeur initiale est restaurée à la pause. Un onglet malgré tout déchargé est rechargé en arrière-plan au réveil.

Cela ne garde pas un PC éveillé, ne démarre pas un navigateur fermé et ne garantit pas l’exécution d’un onglet gelé par le système ou d’une session expirée. Android peut suspendre Firefox en arrière-plan ; le fonctionnement continu sur écran verrouillé n’est pas garanti.

Les détails des cartes sont lus dans l’écran de résultat, avec un repli sur la réponse réseau si elle contient davantage de cartes. Les doublons d’un même tirage sont conservés. Les correspondances wishlist sont mémorisées au tirage ; si la liste d’identifiants n’est pas encore connue, ouvrir la liste d’envies sur Kyara. L’historique conserve les 500 dernières actions d’ouverture ; chaque entrée indique la quantité de boosters réellement consommée. Les compteurs cumulent ces quantités, y compris pour les anciens tirages ×1, et permettent de copier le bilan.

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

### Test immédiat sur Firefox Nightly Android

Pour essayer la version de développement sans signature Mozilla :

1. Installer **Firefox Nightly pour Android**, version 142 ou supérieure.
2. Se connecter à GitHub avec le compte autorisé, puis ouvrir la [préversion 2.8.2](https://github.com/TristanDu76/Kyara-/releases/tag/v2.8.2).
3. Dans **Assets**, télécharger `kyara-plus-firefox-2.8.2-unsigned.xpi` (pas l’archive **Source code**).
4. Dans Nightly, ouvrir `about:config` et mettre `xpinstall.signatures.required` à `false`. Ce réglage autorise les extensions non signées dans ce navigateur de test ; il ne signe pas le paquet.
5. Dans **Paramètres → À propos de Firefox Nightly**, toucher le logo cinq fois rapidement, puis revenir aux paramètres.
6. Choisir **Installer une extension depuis un fichier**, sélectionner le XPI téléchargé et autoriser l’extension sur Kyara.
7. Ouvrir `https://kyara.games`, se connecter, puis ouvrir **KYARA +** et vérifier la version **2.8.2**. Choisir le type et le seuil du lot, puis activer l’automatisation. Le menu peut ensuite être fermé.

Pour le test de nuit, conserver Firefox et l’onglet Kyara ouverts. Android peut interrompre le navigateur en arrière-plan ou écran éteint ; pour isoler ce problème, le premier essai peut se faire avec Nightly au premier plan et l’écran allumé. Éviter de piloter simultanément le même compte depuis le PC pendant ce test.

Le XPI non signé est le même paquet ZIP Firefox, avec l’extension de fichier attendue pour l’installation. Il reste non signé et n’est pas destiné à Firefox standard. Les réglages et l’historique restent locaux au téléphone.

Références Mozilla : [signature et canaux de développement](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/), [installation depuis un fichier sur Android](https://extensionworkshop.com/documentation/publish/install-self-distributed/).

### Firefox Android standard — paquet à signer

Firefox Android **142 ou plus récent** est requis. Le ZIP du dépôt et le ZIP généré ne s’installent pas directement : une installation normale exige un **XPI signé par Mozilla**. Chrome Android ne charge pas cette extension.

1. Générer les paquets avec `python scripts/build.py` (Python 3.10+ ; sous Windows, `py -3 scripts/build.py` convient aussi).
2. Avec un compte Mozilla, ouvrir le [portail développeur AMO](https://addons.mozilla.org/developers/addon/submit/distribution), choisir la distribution **On your own / par vos propres moyens**, puis soumettre `dist/kyara-plus-firefox-<version>-unsigned.zip` en remplaçant `<version>` par la valeur `version` de `manifest.json`. Cela transmet le code à Mozilla pour signature, sans fiche publique dans leur catalogue. Aucun identifiant Mozilla n’est stocké dans le dépôt.
3. Après validation, télécharger le **XPI signé** et le transférer sur le téléphone.
4. Dans Firefox Android : **Paramètres → À propos de Firefox → toucher le logo cinq fois rapidement**.
5. Revenir dans **Paramètres → Installer une extension depuis un fichier**, sélectionner le XPI et accepter l’installation et l’accès à Kyara.
6. Ouvrir `https://kyara.games`, se connecter et ouvrir **KYARA +**.

Renommer le ZIP en XPI ne remplace pas la signature requise dans Firefox standard. Pour une mise à jour privée, signer un nouveau paquet avec le même identifiant d’extension et une version supérieure, puis installer le nouveau XPI. Les mises à jour privées ne sont pas automatiques dans cette configuration.

Références : [installation Android depuis un fichier](https://extensionworkshop.com/documentation/publish/install-self-distributed/), [distribution privée et signature](https://extensionworkshop.com/documentation/publish/self-distribution/).

Sur mobile, garder Firefox et l’onglet Kyara ouverts au premier plan pour une session automatique continue. Android peut suspendre le navigateur en arrière-plan ou écran verrouillé. Au retour dans l’onglet, le script relit le stock et reprend si l’automatisation est toujours activée. Il n’ouvre aucun booster sans confirmation explicite de sa gratuité. Les réglages et l’historique du PC ne sont pas transférés sur le téléphone.

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

### État de validation de la 2.8.0

- **42 tests Node et deux tests Python réussis**, contrôles de syntaxe et génération des deux paquets réussis. Validateur Mozilla installé : zéro erreur, avertissement ou notice dans le paquet Firefox ; son contrôle de mise à jour de l’outil échoue faute d’accès à son dossier de configuration, sans affecter le lint.
- Tests du seuil et des lots natifs ×5/×10, de la décomposition ×5 + ×1, de la répétition des cycles, de l’arrêt et du comptage de l’historique.
- Les tests réseau vérifient qu’un coût ambigu ou supérieur à zéro n’atteint pas le `fetch` natif ; objets `Request`, endpoint et quantité sont également contrôlés.
- Tests des alarmes Chrome/Firefox, de la protection temporaire de l’onglet pilote, de sa restauration et de la reprise d’un onglet déchargé sans l’activer.
- Firefox de bureau 158.0.1, profil isolé et site local simulé : attente à 4/5, passage dans un onglet réellement caché, deux cycles ×5 successifs après recharges, puis un lot ×10 et un lot de 7 avec retour au menu depuis un libellé mixte et sélection ×1. Le serveur local constate les quantités **[5, 5, 10, 5, 1, 1]**, **27 boosters**, **zéro dépense**. Les quatre vues restent sans débordement à 320, 390 et 420 pixels.
- Revue indépendante : transitions des lots composés, autorisations à usage unique et expiration des identifiants corrigées ; aucun finding restant après vérification.
- Les motifs d’URL et la vérification d’origine du background sont adaptés à localhost uniquement dans la copie de test. Ce parcours local ne constitue pas une validation des lots natifs sur le compte réel, ni d’une exécution prolongée sous Chrome ou Android.
- Vérification dans le Chrome de l’utilisateur après rechargement de la 2.8.0 : seuil 10 enregistré, statut « En attente du lot · 9/10 gratuits · boucle active », zéro ouverture et solde inchangé. Animations du site désactivées et confirmation des boosters payants conservée. Le test est remis en pause ; une ouverture native ×10 sur le site réel reste à confirmer.

### Correctif 2.8.1

- Le libellé réel `AnimationsDésactive-les…` est reconnu malgré l’absence d’espace entre les éléments du site. La frontière de mot utilisée en 2.8.0 provoquait un délai dépassé avant toute ouverture.
- Régression reproduite avant correction ; 43 tests Node et deux tests Python réussis après correction. Syntaxe, génération et lint Mozilla réussis.
- Le parcours Firefox local reprend le balisage sans espace du site : deux cycles ×5 avec le menu Kyara+ fermé et l’onglet caché, un ×10 puis un lot de sept, 27 boosters simulés, zéro dépense. La fermeture du menu conserve l’activation ; l’historique continue d’être enregistré sans panneau présent dans le DOM.
- Chrome réel après chargement de la 2.8.1 : résultat natif Shōnen ×5 et 25 cartes concordant avec le dernier tirage enregistré. Après rechargement de Kyara, l’historique persiste et l’automatisation reste active avec un seuil de cinq, en attente à zéro gratuit, sans nouvelle ouverture. Le solde est stable pendant cette vérification ; il n’a pas été relevé immédiatement avant le lot déjà terminé à la prise en main. La confirmation réelle d’un cycle complet de recharge jusqu’au prochain lot reste à effectuer.

### Correctif 2.8.2

- Une lecture répétée du même délai ne repousse plus l’échéance du prochain gratuit. L’échéance est conservée tant que le stock ne change pas ; un changement du stock permet d’enregistrer la suivante.
- À échéance, si le stock affiché reste inférieur au seuil, l’onglet est rechargé pour relire le stock réel, au maximum une fois par minute. Aucun booster estimé n’autorise une ouverture et les contrôles de gratuité restent obligatoires.
- 45 tests Node et deux tests Python réussis ; syntaxe, génération et lint Mozilla réussis.
- Le banc Firefox local fige désormais le compteur dès que l’onglet est caché : deux cycles ×5 se terminent avec le menu fermé, sans réactiver l’onglet et sans dépense simulée. L’ancien banc actualisait le compteur caché et ne couvrait pas ce défaut.
- La vérification prolongée sur le Chrome réel reste à effectuer après rechargement de la 2.8.2. Les validations précédentes de bureau ne garantissent pas l’exécution en arrière-plan sur Android.

Les contrôles DOM dépendent de l’interface actuelle de Kyara. Si elle change, une absence de bouton ou de compteur arrête le passage ; elle n’autorise pas un achat en chakra.
