(function () {
  'use strict';

  /* ==========================================================================
   * 1. CONFIG — tout ce qui dépend du site est ici
   * ======================================================================== */

  const VERSION = '2.8.2';
  const BoosterCore = globalThis.KyaraPlusBoosterCore;
  if (!BoosterCore) throw new Error('Kyara+ : booster-core.js doit être chargé avant kyara-plus.js.');
  const IN_FRAME = window.top !== window;
  /** postMessage envoyé par l’iframe invisible (wiki) à la page quand sa requête de verrouillage est terminée. */
  const FRAME_LOCK_DONE = 'kyara-plus:lock-done';
  /** Logs détaillés : localStorage.setItem('kp-debug', '1') puis recharger. Désactivé par défaut. */
  const DEBUG = (() => { try { return localStorage.getItem('kp-debug') === '1'; } catch { return false; } })();
  const TAB_ID = (() => {
    try { return crypto.randomUUID(); }
    catch { return Math.random().toString(36).slice(2); }
  })();

  const TIMING = Object.freeze({
    armed: 4000, hiddenTab: 250, poll: 150, moreGap: 400, ensureRetry: 30000,
    jobsEvery: 30000, jobsFirst: 5000, frameWait: 20000, frameReport: 15000, afterMutation: 1500,
  });
  const NET = Object.freeze({ concurrency: 2, spacing: 120, retries: 2, timeout: 15000, pricesBatch: 60 });

  /** Clés localStorage (confort par navigateur, jamais de secret). Les filtres d’albums / « en double » ne sont PAS stockés. */
  const KEY = Object.freeze({
    wishlist: 'kp-wishlist', wishlistUrl: 'kp-wishlist-url', showChat: 'kp-show-chat',
    lockRequest: 'kp-lock-request', catalogUrl: 'kp-catalog-url', settings: 'kp-settings',
    boosterNext: 'kp-booster-next', boosterLast: 'kp-booster-last',
    boosterHistory: 'kp-booster-history', boosterCount: 'kp-booster-count',
    boosterRefresh: 'kp-booster-refresh', boosterOwner: 'kp-booster-owner', seenOffers: 'kp-seen-offers',
  });

  /** UUID dans un chemin d’API = données d’un AUTRE joueur (à confirmer dans DevTools › Network). */
  const OTHER_PLAYER = /\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}(?=[/?]|$)/i;
  /** POST envoyé par le bouton 🔒 d’une page wiki. */
  const LOCK_URL = /\/api\/(?:[^?]*\/)?pin(?:[/?]|$)/;
  /** Requête de verrouillage telle que vue dans DevTools ; une requête apprise (KEY.lockRequest) a priorité. */
  const LOCK_REQUEST = { url: '/api/me/collection/{id}/pin', stateKey: 'pinned', idKey: null };
  /** URL qui ressemble à l’ouverture d’un booster (résumé des récompenses). */
  const BOOSTER_HINT = /boost|pack|open|draw|gacha|free/i;

  const COLLECTION_URL = '/api/me/collection?lean=1';
  const ALBUM_HASH = 'kp-album=';
  const cardImage = (id) => `/cards/sm/${id}.webp`;

  /** Sélecteurs du site (Svelte : ne jamais s’appuyer sur les classes svelte-xxxx). */
  const SITE = {
    offer: 'li.offer',
    offerList: 'ul.offers',
    offerGiveLink: '.give a.big',
    offerGiveInfo: '.give .gi',
    offerWant: '.want',
    offerThumbs: '.thumbs',
    offerThumb: 'a.thumb',
    offerActionButtons: '.acts button',
    search: '.filters input[type="search"]',
    activeFilter: '.filters [aria-pressed="true"]:not([data-kp-pill])',
    offerFilters: '.filters',
    offerPill: '.filters .pill',
    chat: '.chat-side, .chat-fab',
    chatPage: /^\/marche\/chat/,
    marketPage: /^\/marche/,
    marketTabs: '.tabs[role="tablist"]',
    exchangesTab: /échanges/i,
    myOffersPill: /mes offres/i,
    acceptPill: /accepter/i,
    collectionPage: /^\/collection/,
    collectionSlot: '.cell > a.slot',
    collectionBar: '.mk',
    collectionLockIcon: '.pin',
    wikiLockButton: 'button[aria-pressed]',
    albumList: 'ul.albums',
    album: 'button.album',
    albumName: '.a-name',
    albumMeta: '.a-meta',
    albumRarities: '.a-rar > span',
    albumTools: '.al-tools',
    albumMore: '.more button',
    showMore: /afficher plus/i,
    viewButtons: '.views button',
    profilePage: /^\/profil\/([0-9a-f-]+)/i,
    tradeShelf: '[role="dialog"] .shelf',
    tradeTab: '.tabs [role="tab"]',
    partnerTab: /^\s*cartes de\s/i,
    tradeChips: '.filters .chips',
    tradeSearch: '.filters input[type="search"]',
    tradeChip: 'button.only',
    tradeChipOwned: /je l.ai/i,
    tradeChipMissing: /il me manque/i,
    tradeRarityChip: '.chips button:not(.only)',
    tradeGrid: 'ul.grid:not([data-kp-grid])',
    tradeTile: 'button.tile',
    tradeTilePrice: '.pr',
    cardImageId: /\/(\d+)[^/]*\.webp(?:[?#]|$)/,
    giveLabel: /^Donner\s/,
    lockLabel: /verrouill/i,
  };

  /** Une seule table de raretés (ordre, couleur de l’ombre des images du site, libellés, alias de l’API). */
  const RARITIES = Object.freeze([
    { code: 'C', name: 'Commune',     rgb: [181, 177, 187], aliases: ['common'] },
    { code: 'U', name: 'Peu commune', rgb: [63, 191, 127],  aliases: ['uncommon'] },
    { code: 'R', name: 'Rare',        rgb: [77, 155, 255],  aliases: [] },
    { code: 'E', name: 'Épique',      rgb: [176, 114, 255], aliases: ['epic', 'epique'] },
    { code: 'L', name: 'Légendaire',  rgb: [245, 197, 24],  aliases: ['legendary', 'legendaire'] },
    { code: 'M', name: 'Mythique',    rgb: [255, 77, 46],   aliases: ['mythic'] },
  ]);
  const RARITY_INDEX = new Map(RARITIES.flatMap((r, i) => [r.code, r.name, ...r.aliases].map((k) => [k.toLowerCase(), i])));
  const rarityOf = (value) => (value === undefined || value === null ? null : RARITIES[RARITY_INDEX.get(String(value).trim().toLowerCase())] ?? null);
  const rarityRank = (r) => (r ? RARITIES.indexOf(r) : -1);
  const COLORS = Object.freeze({ duplicate: '#3fbf7f', single: '#ffb02e', wishlist: '#f5c518', danger: '#ff4d2e' });

  /* ==========================================================================
   * 2. UTILS
   * ======================================================================== */

  const logBuffer = [];
  const log = {
    info: (...a) => { if (DEBUG) console.info('[Kyara+]', ...a); },
    warn: (...a) => {
      logBuffer.push(`${new Date().toISOString().slice(11, 19)} ${a.map((x) => (x instanceof Error ? x.message : typeof x === 'string' ? x : '…')).join(' ')}`);
      if (logBuffer.length > 60) logBuffer.shift();
      console.warn('[Kyara+]', ...a);
    },
  };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
  const mergeMap = (a, b) => new Map([...a, ...b]);
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
  const num = (x, fallback = 0) => (x !== null && x !== '' && Number.isFinite(+x) ? +x : fallback);
  const wikiId = (href) => /\/wiki\/(\d+)/.exec(href || '')?.[1] ?? null;
  const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;
  const priceText = (p) => `${Math.round(p).toLocaleString('fr-FR')} ◆`;
  const pathOf = (url) => { const u = new URL(url, location.origin); return u.pathname + u.search; };
  const rgbCss = (rarity) => `rgb(${rarity.rgb.join(',')})`;
  const rarityColor = (rarity) => (rarity ? rgbCss(rarity) : 'var(--line2, #2e2b36)');
  const clock = (ts) => new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const countdown = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

  function expiresText(iso) {
    const ms = Date.parse(iso) - Date.now();
    if (!(ms > 0)) return '';
    const d = Math.floor(ms / 864e5), h = Math.floor((ms % 864e5) / 36e5), m = Math.floor((ms % 36e5) / 6e4);
    return 'expire ' + (d ? `${d} j ${h} h` : h ? `${h} h` : `${m} min`);
  }

  const storage = {
    /** `valid` rejette une valeur corrompue (le script ne plante plus au démarrage). */
    get(key, fallback, valid = () => true) {
      try {
        const raw = localStorage.getItem(key);
        if (raw === null) return fallback;
        const value = JSON.parse(raw);
        return valid(value) ? value : fallback;
      } catch { return fallback; }
    },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* stockage bloqué */ } },
    remove(key) { try { localStorage.removeItem(key); } catch { /* idem */ } },
  };

  const skip = (v) => v === undefined || v === null || v === false;
  /** el('a', { class: 'x', href: '/', text: 'Hi', onClick: fn, '--var': 'red' }, child, …) */
  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (skip(value)) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key.startsWith('--')) node.style.setProperty(key, value);
      else if (/^on[A-Z]/.test(key)) node.addEventListener(key.slice(2).toLowerCase(), value);
      else node.setAttribute(key, value === true ? '' : value);
    }
    node.append(...children.flat().filter((c) => !skip(c)));
    return node;
  }

  /** N’écrit dans le DOM que si la valeur change (limite les re-déclenchements de l’observer). */
  const setText = (node, text) => { if (node.textContent !== text) node.textContent = text; };
  const setAttr = (node, name, value) => {
    if (value === null) { if (node.hasAttribute(name)) node.removeAttribute(name); }
    else if (node.getAttribute(name) !== value) node.setAttribute(name, value);
  };
  const setStyle = (node, prop, value) => { if (node.style.getPropertyValue(prop) !== value) node.style.setProperty(prop, value); };

  /** Classes d’un élément du site, sans l’état « on ». */
  const siteClasses = (node, drop = 'on') => node.className.split(/\s+/).filter((c) => c && c !== drop).join(' ');

  /**
   * Garantit qu’un contrôle injecté (pill, chip, bouton) existe juste après `anchor`.
   * `anchor` absent → tous les contrôles portant `marker` sont retirés.
   */
  function ensureAfter(anchor, marker, create) {
    for (const n of document.querySelectorAll(`[${marker}]`)) if (!anchor || n.previousElementSibling !== anchor) n.remove();
    if (!anchor) return null;
    let node = anchor.nextElementSibling;
    if (!node?.hasAttribute(marker)) { node = create(); node.setAttribute(marker, ''); anchor.after(node); }
    return node;
  }

  /** Notification non bloquante. */
  function toast(text, ms = 4500) {
    if (!document.body) return;
    const node = el('div', { class: 'kp-toast', role: 'status', text });
    document.body.append(node);
    setTimeout(() => node.remove(), ms);
  }

  /** Attend qu’une condition devienne vraie (polling) ou échoue après `timeout` ms. */
  function waitFor(fn, timeout) {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      const tick = () => {
        let value = null;
        try { value = fn(); } catch { /* pas encore prêt */ }
        if (value) resolve(value);
        else if (Date.now() - t0 > timeout) reject(new Error('délai dépassé'));
        else setTimeout(tick, TIMING.poll);
      };
      tick();
    });
  }

  /** Copie dans le presse-papiers (API moderne, sinon textarea). */
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* repli */ }
    const area = el('textarea', { style: 'position:fixed;left:-9999px;top:0' });
    area.value = text;
    document.body.append(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* bloqué */ }
    area.remove();
    return ok;
  }

  /** Navigation interne (SvelteKit intercepte les clics sur les liens : pas de rechargement). */
  function navigate(href) {
    const link = el('a', { href, hidden: true });
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  /* ==========================================================================
   * 3. RÉGLAGES — persistés, éditables depuis le panneau ⚙
   * ======================================================================== */

  const DEFAULT_SETTINGS = Object.freeze({
    features: {}, // nom de feature → false pour la désactiver
    options: { valueDelta: true, confirmGive: true, newOffers: true, autoRefreshOffers: false, notify: false },
    refreshMinutes: 5,
    booster: { enabled: false, batchSize: 10, spacingSec: 4 },
  });

  /** Normalise des réglages quelconques (stockage corrompu, ancienne version) vers un objet valide. */
  function normalizeSettings(raw) {
    const r = isObj(raw) ? raw : {};
    const features = {};
    if (isObj(r.features)) for (const [k, v] of Object.entries(r.features)) if (v === false) features[k] = false;
    const options = { ...DEFAULT_SETTINGS.options };
    if (isObj(r.options)) for (const k of Object.keys(options)) if (typeof r.options[k] === 'boolean') options[k] = r.options[k];
    const b = isObj(r.booster) ? r.booster : {};
    return {
      features,
      options,
      refreshMinutes: clamp(Math.round(num(r.refreshMinutes, 5)), 2, 60),
      booster: {
        enabled: b.enabled === true,
        type: BoosterCore.TYPES.includes(b.type) ? b.type : 'all',
        batchSize: clamp(Math.round(num(b.batchSize ?? b.max, 10)), 1, 10),
        spacingSec: clamp(Math.round(num(b.spacingSec, 4)), 1, 30),
      },
    };
  }

  /* ==========================================================================
   * 4. STORE — source de vérité unique ; toute écriture planifie un rendu
   * ======================================================================== */

  function createStore(initial) {
    const data = { ...initial };
    const versions = {};
    const subscribers = new Set();
    return {
      get: (key) => data[key],
      /** Numéro de version d’une clé (remplace collectionVersion / offersVersion). */
      ver: (key) => versions[key] ?? 0,
      /** Remplacer, jamais muter en place : c’est ce qui permet de détecter le changement. */
      set(key, value) {
        if (Object.is(data[key], value)) return;
        data[key] = value;
        versions[key] = (versions[key] ?? 0) + 1;
        subscribers.forEach((fn) => fn(key, value));
      },
      subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); },
    };
  }

  const store = createStore({
    collection: null, // Map<id, { qty, locked, resaleLocked }>, null tant que non chargée
    wishlist: new Set(storage.get(KEY.wishlist, storage.get('kx-wishlist', [], Array.isArray), Array.isArray).map(String)),
    wishlistKnown: Array.isArray(storage.get(KEY.wishlist, null, Array.isArray)) || Array.isArray(storage.get('kx-wishlist', null, Array.isArray)),
    catalog: new Map(), // Map<id, { name, rarity }>
    serverOffers: [], // offres d’échange ouvertes envoyées par le serveur (le site n’en affiche que 120)
    newOffers: new Set(), // ids d’offres apparues depuis la dernière visite
    prices: new Map(),
    tradeAvailable: new Map(), // Map<userId, Map<cardId, n>>
    dupesOnly: false, // état d’UI partagé entre features
    settings: normalizeSettings(storage.get(KEY.settings, {}, isObj)),
    booster: { running: false, status: '' },
  });

  const getSettings = () => store.get('settings');
  const opt = (name) => getSettings().options[name] === true;
  /** Modifie les réglages : `mutate` reçoit une copie, le résultat est normalisé, persisté et publié. */
  function updateSettings(mutate) {
    const draft = JSON.parse(JSON.stringify(getSettings()));
    mutate(draft);
    const next = normalizeSettings(draft);
    storage.set(KEY.settings, next);
    store.set('settings', next);
  }

  const ownedQty = (id) => store.get('collection')?.get(String(id))?.qty ?? 0;
  /** Exemplaires réellement cédables : une carte verrouillée ne peut pas être échangée du tout. */
  const freeCopies = (id) => {
    const c = store.get('collection')?.get(String(id));
    return !c || c.locked ? 0 : Math.max(0, c.qty - c.resaleLocked);
  };
  const isLockedInData = (id) => !!store.get('collection')?.get(String(id))?.locked;
  const inWishlist = (id) => store.get('wishlist').has(String(id));
  const asksForDuplicate = (ids) => ids.some((id) => ownedQty(id) >= 2);
  function cardInfo(id) {
    const c = store.get('catalog').get(String(id));
    return { name: c?.name || `Carte #${id}`, rarity: c ? c.rarity : null, known: !!c?.name };
  }

  /** Écart de valeur indicative (prix fair-play) si tu acceptes : carte reçue − carte donnée. null si un prix manque. */
  function valueDelta(receivedId, givenId) {
    const prices = store.get('prices');
    const a = prices.get(String(receivedId));
    const b = prices.get(String(givenId));
    return a === undefined || b === undefined ? null : a - b;
  }
  const deltaText = (d) => `${d >= 0 ? '+' : '−'}${priceText(Math.abs(d))}`;

  /* ==========================================================================
   * 5. SCHEMAS — réponses de l’API → données normalisées (fonctions pures, testables)
   *    Tolérant sur l’enveloppe, strict sur le contenu. Un format inattendu est signalé, jamais avalé.
   * ======================================================================== */

  class SchemaError extends Error {}
  const expect = (cond, msg) => { if (!cond) throw new SchemaError(msg); };
  const asId = (x) => (typeof x === 'string' || typeof x === 'number' ? String(x) : null);

  const ID_KEYS = ['characterId', 'character_id', 'charId', 'cardId', 'card_id', 'card', 'character', 'id'];
  const WRAPPERS = ['cards', 'items', 'collection', 'wishlist', 'wishes', 'characters', 'offers', 'data', 'entries', 'ids'];

  function entriesOf(data) {
    if (Array.isArray(data)) return data;
    expect(isObj(data), 'objet ou tableau attendu');
    const known = WRAPPERS.find((k) => Array.isArray(data[k]));
    const key = known ?? Object.keys(data).find((k) => Array.isArray(data[k]));
    expect(key, 'aucune liste trouvée');
    if (!known) log.info('liste trouvée sous une clé inattendue :', key);
    return data[key];
  }

  function entryId(e) {
    if (Array.isArray(e)) return asId(e[0]);
    if (!isObj(e)) return asId(e);
    const raw = ID_KEYS.map((k) => e[k]).find((v) => v !== undefined && v !== null);
    return asId(isObj(raw) ? (raw.id ?? raw.characterId) : raw);
  }

  const parsers = {
    /** [{ characterId, qty, locked, resaleLocked }] → Map. Une collection vide est VALIDE. */
    collection(data) {
      const entries = entriesOf(data);
      const map = new Map();
      for (const e of entries) {
        const id = isObj(e) ? entryId(e) : null;
        if (!id) continue;
        const prev = map.get(id) ?? { qty: 0, locked: false, resaleLocked: 0 };
        prev.qty += num(e.qty ?? e.count ?? e.quantity, 1);
        prev.locked = prev.locked || !!+e.locked;
        prev.resaleLocked += num(e.resaleLocked);
        map.set(id, prev);
      }
      expect(map.size > 0 || entries.length === 0, 'aucune entrée exploitable');
      return map;
    },

    wishlist(data) {
      // /api/me/wishlist peut renvoyer les compteurs par univers, pas les identifiants souhaités.
      if (isObj(data) && isObj(data.all) && Number.isFinite(+data.all.count) && Number.isFinite(+data.all.chance)) return null;
      return new Set(entriesOf(data).map(entryId).filter(Boolean));
    },

    /** [{ id, name, rarity: 'M', … }] → Map<id, { name, rarity }> */
    catalog(data) {
      const map = new Map();
      for (const e of entriesOf(data)) {
        if (!isObj(e)) continue;
        const id = asId(e.id ?? e.characterId);
        const name = e.name ?? e.nom ?? e.title;
        if (id) map.set(id, { name: typeof name === 'string' ? name : null, rarity: rarityOf(e.rarity ?? e.rarete ?? e.rar ?? e.r) });
      }
      expect(map.size > 0, 'catalogue vide');
      return map;
    },

    /** [{ characterId, n }] → Map<id, n> (n = copies échangeables ; 0 reste 0). */
    tradeAvailable(data) {
      const map = new Map();
      for (const e of entriesOf(data)) {
        const id = entryId(e);
        if (id) map.set(id, (map.get(id) ?? 0) + num(isObj(e) ? e.n : undefined, 1));
      }
      return map;
    },

    /** { "28331": 200 } ou [{ id, price }] → Map<id, price>. '' et null sont ignorés. */
    prices(data) {
      expect(data !== null && typeof data === 'object', 'objet attendu');
      const pairs = Array.isArray(data)
        ? data.map((e) => [entryId(e), isObj(e) ? (e.price ?? e.value ?? e.median) : undefined])
        : Object.entries(data);
      const map = new Map();
      for (const [id, price] of pairs) if (id && price !== null && price !== '' && Number.isFinite(+price)) map.set(String(id), +price);
      return map;
    },

    /** Offres d’échange ouvertes, ou null si la réponse n’est pas la liste des échanges (autres API « offers »). */
    offers(data) {
      let list;
      try { list = entriesOf(data); } catch { return null; }
      if (!isObj(list[0]) || !('wantIds' in list[0])) return null;
      const now = Date.now();
      return list.filter((o) => isObj(o) && o.status === 'open' && !o.closedAt && (!o.expiresAt || Date.parse(o.expiresAt) > now));
    },
  };

  /**
   * Offres apparues depuis la dernière visite. Première visite (`seen` absent) : tout est considéré vu.
   * Retourne { fresh, seen } où `seen` est la nouvelle liste à persister (bornée aux 3000 derniers ids).
   */
  function diffOffers(seen, currentIds) {
    const known = new Set(seen ?? currentIds);
    const fresh = seen === null ? [] : currentIds.filter((id) => !known.has(id));
    const merged = [...(seen ?? []), ...currentIds.filter((id) => !known.has(id) || seen === null)];
    return { fresh, seen: [...new Set(merged)].slice(-3000) };
  }

  /** Chaque réponse du site que l’on lit. `exclude` évite d’écraser MES données par celles d’un autre joueur. */
  const HANDLERS = [
    { name: 'collection', match: /\/api\/me\/collection(\?|$)/,
      parse: parsers.collection, apply: (v) => store.set('collection', v) },
    { name: 'offers', match: /\/api\/[^?]*offers(\?|$)/,
      parse: parsers.offers, apply: (v) => store.set('serverOffers', v) },
    { name: 'catalog', match: /\/api\/[^?]*characters(\?|$)/, exclude: OTHER_PLAYER, parse: parsers.catalog,
      apply(v, url) { store.set('catalog', mergeMap(store.get('catalog'), v)); storage.set(KEY.catalogUrl, pathOf(url)); } },
    { name: 'tradeAvailable', match: /\/api\/trades\/available\/([0-9a-f-]+)(?:\?|$)/i, parse: parsers.tradeAvailable,
      apply(v, url) {
        const userId = /\/available\/([0-9a-f-]+)/i.exec(url)[1].toLowerCase();
        store.set('tradeAvailable', new Map(store.get('tradeAvailable')).set(userId, v));
      } },
    { name: 'prices', match: /\/api\/fair-play\/prices\?/,
      parse: parsers.prices, apply: (v) => store.set('prices', mergeMap(store.get('prices'), v)) },
    { name: 'wishlist', match: /\/api\/[^?]*wish/i, exclude: OTHER_PLAYER, parse: parsers.wishlist,
      apply(v, url) { store.set('wishlist', v); store.set('wishlistKnown', true); storage.set(KEY.wishlist, [...v]); storage.set(KEY.wishlistUrl, pathOf(url)); } },
  ];

  /* ==========================================================================
   * 6. RÉSEAU — un hook qui observe, une API qui agit (validée, limitée, avec reprise)
   * ======================================================================== */

  let boosterPermit = null;
  const net = (() => {
    const nativeFetch = window.fetch.bind(window);
    const lastSeen = new Map(); // nom du handler → dernière URL vue (pour rejouer la requête du site)
    const mutationListeners = new Set();
    const boosterRequestIds = new Map(); // expiration à 10 min, au-delà des retries de 2 min du site
    let headersFrom = null; // dernière requête same-origin lue : source des en-têtes

    const isRequest = (x) => typeof Request !== 'undefined' && x instanceof Request;
    const urlOf = (input) => (isRequest(input) ? input.url : String(input ?? ''));
    const methodOf = (input, init) => String(init?.method ?? (isRequest(input) ? input.method : 'GET')).toUpperCase();
    const sameOrigin = (url) => { try { return new URL(url, location.origin).origin === location.origin; } catch { return false; } };

    function ingest(handler, data, url) {
      try {
        const value = handler.parse(data);
        if (value === null) return handler.name === 'wishlist'; // résumé valide, sans liste d’identifiants
        handler.apply(value, url);
        log.info(`${handler.name} reçu`, value.size ?? value.length ?? '');
        return true;
      } catch (err) {
        if (err instanceof SchemaError) log.warn(`format « ${handler.name} » non reconnu : ${err.message}`, JSON.stringify(data).slice(0, 1000));
        else log.warn(`erreur dans le gestionnaire « ${handler.name} »`, err);
        return false;
      }
    }

    /** Lit une COPIE de la réponse. Erreurs réseau / non-JSON : silencieuses. Erreurs de handler : journalisées. */
    function observe(promise, handler, url, snapshot) {
      return promise
        .then(async (res) => {
          if (!res.ok) {
            let body = '';
            try { body = (await res.clone().text()).slice(0, 500); } catch { /* corps indisponible */ }
            log.warn(`API « ${handler.name} » : HTTP ${res.status} ${pathOf(url)}`, body);
            return null;
          }
          return res.clone().json().catch(() => null);
        }, (err) => { log.warn(`API « ${handler.name} » : échec réseau`, err); return null; })
        .then((data) => (data === undefined || data === null ? false : ingest(handler, data, url)))
        .then((ok) => { if (ok) { lastSeen.set(handler.name, url); if (snapshot) headersFrom = snapshot; } return ok; });
    }

    function watch(input, init, promise, copy) {
      const url = urlOf(input);
      if (!sameOrigin(url)) return;
      const method = methodOf(input, init);
      if (method !== 'GET') {
        const body = () => (copy ? copy.text().catch(() => '') : Promise.resolve(typeof init?.body === 'string' ? init.body : undefined));
        for (const fn of mutationListeners) { try { fn({ url, method, promise, body }); } catch (err) { log.warn('écouteur', err); } }
        return;
      }
      const handler = HANDLERS.find((h) => h.match.test(url) && !h.exclude?.test(url));
      if (handler) observe(promise, handler, url, { input: copy ?? input, init, credentials: init?.credentials ?? (isRequest(input) ? input.credentials : 'same-origin') });
    }

    function install() {
      window.fetch = function (input, init) {
        let copy = null;
        try { if (isRequest(input)) copy = input.clone(); } catch { /* corps déjà lu */ } // AVANT l’envoi : après, le corps est consommé
        let promise;
        const permit = boosterPermit;
        const headers = new Headers(init?.headers ?? (isRequest(input) ? input.headers : undefined));
        const requestId = headers.get('x-request-id');
        for (const [id, expires] of boosterRequestIds) if (expires <= Date.now()) boosterRequestIds.delete(id);
        if (requestId && boosterRequestIds.has(requestId)) {
          promise = Promise.reject(new Error('Kyara+ : cette ouverture a déjà été envoyée'));
        } else if (permit && methodOf(input, init) === 'POST' && BOOSTER_HINT.test(urlOf(input))) {
          const sendFree = (body) => {
            if (permit.used || permit.cancelled || !requestId || !sameOrigin(urlOf(input)) || !BoosterCore.freeRequestAllowed(pathOf(urlOf(input)), body, permit)) {
              permit.blocked = 'Requête bloquée : coût nul, quantité ou type non confirmé';
              window.dispatchEvent(new Event('kyara-plus:booster-state'));
              throw new Error(permit.blocked);
            }
            permit.used = true;
            boosterRequestIds.set(requestId, Date.now() + 600000);
            return nativeFetch(input, init);
          };
          try {
            promise = typeof init?.body === 'string' ? sendFree(init.body)
              : copy && init?.body === undefined ? copy.clone().text().then(sendFree) : sendFree(undefined);
          } catch (error) { promise = Promise.reject(error); }
        } else promise = nativeFetch(input, init);
        try { watch(input, init, promise, copy); } catch (err) { log.info('hook ignoré', err); }
        return promise;
      };
    }

    /** Options de session de la dernière requête du site. */
    function siteHeaders() {
      const h = new Headers(isRequest(headersFrom?.input) ? headersFrom.input.headers : undefined);
      new Headers(headersFrom?.init?.headers).forEach((value, key) => h.set(key, value));
      h.delete('if-none-match'); h.delete('if-modified-since');
      return h;
    }

    /** Refuse tout ce qui n’est pas un chemin /api/ de CE site : jamais d’en-têtes envoyés ailleurs. */
    function safePath(path) {
      const u = new URL(path, location.origin);
      if (u.origin !== location.origin || !u.pathname.startsWith('/api/')) throw new Error(`URL refusée : ${path}`);
      return u.pathname + u.search;
    }

    function createLimiter(concurrency, spacing) {
      let active = 0, last = 0;
      const waiting = [];
      const pump = () => {
        while (active < concurrency && waiting.length) {
          const job = waiting.shift();
          active++;
          const delay = Math.max(0, last + spacing - Date.now());
          last = Date.now() + delay;
          setTimeout(() => job().finally(() => { active--; pump(); }), delay);
        }
      };
      return (task) => new Promise((resolve, reject) => { waiting.push(() => task().then(resolve, reject)); pump(); });
    }
    const limited = createLimiter(NET.concurrency, NET.spacing);

    /** Requête vers l’API du site : 2 en parallèle max, délai entre deux, reprise (GET seulement) sur 429 / 5xx / coupure. */
    function request(path, { method = 'GET', body } = {}) {
      let url;
      try { url = safePath(path); } catch (err) { return Promise.reject(err); }
      const retries = method === 'GET' ? NET.retries : 0;
      return limited(async () => {
        for (let attempt = 0; ; attempt++) {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), NET.timeout);
          try {
            const headers = siteHeaders();
            if (body !== undefined) headers.set('content-type', 'application/json');
            const res = await nativeFetch(url, {
              method, headers, credentials: headersFrom?.credentials ?? 'same-origin', cache: 'no-store', signal: ctrl.signal,
              body: body === undefined ? undefined : JSON.stringify(body),
            });
            if (res.status !== 429 && res.status < 500) return res;
            if (attempt >= retries) return res;
            await sleep((Number(res.headers.get('retry-after')) * 1000) || 500 * 2 ** attempt);
          } catch (err) {
            if (attempt >= retries) throw err;
            await sleep(500 * 2 ** attempt);
          } finally { clearTimeout(timer); }
        }
      });
    }

    /** GET + lecture par le handler `name`. Résout true si des données fraîches ont été prises en compte. */
    function get(name, path) {
      const handler = HANDLERS.find((h) => h.name === name);
      return request(path).then(
        (res) => observe(Promise.resolve(res), handler, path, null),
        (err) => { log.warn(`« ${name} » : requête impossible`, err); return false; },
      );
    }

    return {
      install, request, get, safePath,
      hasHeaders: () => headersFrom !== null,
      lastUrl: (name) => lastSeen.get(name),
      onMutation: (fn) => { mutationListeners.add(fn); },
    };
  })();

  /** Chargements à la demande (lecture seule). */
  const pricesAsked = new Set();
  const load = {
    collection: () => net.get('collection', net.lastUrl('collection') ?? COLLECTION_URL),
    offers: () => (net.lastUrl('offers') ? net.get('offers', net.lastUrl('offers')) : Promise.resolve(false)),
    wishlist: () => {
      const url = net.lastUrl('wishlist') ?? storage.get(KEY.wishlistUrl, null, (v) => typeof v === 'string');
      return url ? net.get('wishlist', url) : Promise.resolve(false);
    },
    tradeAvailable: (userId) => net.get('tradeAvailable', `/api/trades/available/${encodeURIComponent(userId)}`),
    catalog: () => (store.get('catalog').size ? Promise.resolve(true) : net.get('catalog', storage.get(KEY.catalogUrl, '/api/characters', (v) => typeof v === 'string'))),
    /** Chaque prix n’est demandé qu’une fois… sauf si la requête a échoué. `onProgress(done, total)` optionnel. */
    async prices(ids, onProgress) {
      const missing = ids.map(String).filter((id) => !store.get('prices').has(id) && !pricesAsked.has(id));
      missing.forEach((id) => pricesAsked.add(id));
      const batches = chunk(missing, NET.pricesBatch);
      let done = 0;
      const results = await Promise.all(batches.map(async (batch) => {
        const ok = await net.get('prices', `/api/fair-play/prices?ids=${batch.join(',')}`);
        if (!ok) batch.forEach((id) => pricesAsked.delete(id));
        onProgress?.(++done, batches.length);
        return ok;
      }));
      return results.every(Boolean);
    },
  };

  /** Relance un chargement au plus une fois toutes les 30 s (évite de marteler l’API si la page ne le fournit pas). */
  const lastTry = {};
  function ensure(key, fn) {
    if (Date.now() - (lastTry[key] ?? 0) < TIMING.ensureRetry) return;
    lastTry[key] = Date.now();
    fn();
  }

  /* ==========================================================================
   * 7. RUNTIME — features « par route », isolées, avec disjoncteur et interrupteur
   * ======================================================================== */

  const features = [];
  const jobs = [];
  let observer = null;

  /**
   * Contrat d’une feature : { name, label?, match(path) → bool, run(path), teardown?() }.
   * `run` doit être idempotente. Hors de sa route (ou désactivée dans ⚙), elle ne tourne pas et est nettoyée.
   * L’ordre de déclaration est l’ordre d’exécution.
   */
  const defineFeature = (feature) => { const f = { active: false, fails: 0, disabled: false, ...feature }; features.push(f); return f; };
  /** Tâche périodique (toutes les 30 s, page principale seulement). */
  const defineJob = (fn) => jobs.push(fn);

  function runFeature(f, path) {
    const enabled = getSettings().features[f.name] !== false;
    try {
      if (enabled && f.match(path)) { f.run(path); f.active = true; f.fails = 0; }
      else if (f.active) { f.active = false; f.teardown?.(); }
    } catch (err) {
      log.warn(`erreur dans « ${f.name} » (${++f.fails}/3)`, err);
      if (f.fails < 3) return;
      f.disabled = true; // disjoncteur : une feature cassée ne spamme plus la console à chaque image
      try { f.teardown?.(); } catch { /* déjà en échec */ }
      toast(`Kyara+ : la fonction « ${f.label || f.name} » est désactivée (voir la console).`);
    }
  }

  function render() {
    if (!document.head || !document.body) return;
    injectStyles();
    for (const f of features) if (!f.disabled) runFeature(f, location.pathname);
    // Nos propres écritures ont généré des mutations : on les jette au lieu de relancer un rendu pour rien.
    observer?.takeRecords();
  }

  let queued = false;
  function scheduleRender() {
    if (queued) return;
    queued = true;
    const go = () => { queued = false; render(); };
    // requestAnimationFrame est suspendu dans un onglet en arrière-plan (ex. album ouvert au clic molette)
    if (document.hidden) setTimeout(go, TIMING.hiddenTab); else requestAnimationFrame(go);
  }

  function whenBodyReady(fn) {
    if (document.body) return fn();
    const mo = new MutationObserver(() => { if (document.body) { mo.disconnect(); fn(); } });
    mo.observe(document, { childList: true, subtree: true });
  }

  function runJobs() {
    for (const job of jobs) { try { const r = job(); if (r && r.catch) r.catch((err) => log.warn('tâche', err)); } catch (err) { log.warn('tâche', err); } }
  }

  function startUi() {
    observer = new MutationObserver(scheduleRender);
    observer.observe(document.documentElement, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'disabled', 'aria-pressed', 'aria-selected'],
    });
    document.addEventListener('input', (e) => { if (e.target.matches?.(SITE.search)) scheduleRender(); }, true);
    for (const method of ['pushState', 'replaceState']) {
      const original = history[method];
      history[method] = function () { const result = original.apply(this, arguments); scheduleRender(); return result; };
    }
    window.addEventListener('popstate', scheduleRender);
    store.subscribe(scheduleRender);
    setInterval(runJobs, TIMING.jobsEvery);
    setTimeout(runJobs, TIMING.jobsFirst);
    scheduleRender();
  }

  /* ==========================================================================
   * 8. STYLES — toute classe / attribut ajouté porte le préfixe kp-
   * ======================================================================== */

  const CSS = `
    /* ---- Offered card: rarity badge, same size as the proposition tiles ---- */
    a[data-kp-rarity] { position: relative !important; display: inline-block; }
    a[data-kp-rarity] img { outline: 3px solid var(--kp-rc); outline-offset: -3px; }
    li.offer .give a.big img { width: 102px !important; height: auto !important; aspect-ratio: 5 / 7; }
    .kp-badge {
      position: absolute; left: 50%; bottom: 3px; transform: translateX(-50%);
      padding: 1px 6px; border-radius: 6px; white-space: nowrap; pointer-events: none; z-index: 5;
      font: 700 10px/1.3 system-ui, sans-serif; color: #111; background: var(--kp-rc);
      box-shadow: 0 1px 3px rgba(0,0,0,.6);
    }
    .kp-owned { font-size: 12px; font-weight: 700; }

    /* ---- Order: wishlist first, then rarest first (CSS order, the site's list is never reordered) ---- */
    li.offer { order: var(--kp-order, 0); }
    li.offer[data-kp-wish], .kp-xoffer.kp-wish { border-color: ${COLORS.wishlist} !important; box-shadow: 0 0 0 1px ${COLORS.wishlist}; }
    .kp-wish-tag { font-size: 12px; font-weight: 700; color: ${COLORS.wishlist}; }
    li.offer.kp-flash { box-shadow: 0 0 0 3px ${COLORS.wishlist} !important; }

    /* ---- Site elements we replace (thumbs, "Donner X" buttons, lock icon) ---- */
    [data-kp-hidden] { display: none !important; }

    /* ---- Proposition grid ---- */
    li.offer .want:has(> .kp-grid), .kp-xoffer .kp-want { flex: 1 1 420px; }
    .kp-grid { display: grid; gap: 8px; grid-template-columns: repeat(5, minmax(0, 1fr)); max-width: 620px; }
    @media (max-width: 480px) { .kp-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
    .kp-tile {
      display: flex; flex-direction: column; gap: 5px; min-width: 0;
      padding: 6px; border-radius: 12px; background: var(--panel2, #17161d); border: 2px solid var(--kp-rc);
    }
    .kp-tile.kp-missing { opacity: .45; border-style: dashed; }
    .kp-tile.kp-missing:hover { opacity: .8; }
    .kp-tile a { display: block; position: relative; }
    .kp-tile img { display: block; width: 100%; aspect-ratio: 5 / 7; object-fit: cover; object-position: 50% 20%; border-radius: 8px; }
    .kp-rar, .kp-cnt {
      position: absolute; padding: 1px 6px; border-radius: 6px;
      font: 700 10px/1.3 system-ui, sans-serif; color: #111; box-shadow: 0 1px 3px rgba(0,0,0,.6);
    }
    .kp-rar { left: 4px; top: 4px; background: var(--kp-rc); }
    .kp-cnt { right: 4px; bottom: 4px; }
    .kp-cnt.kp-dup { background: ${COLORS.duplicate}; }
    .kp-cnt.kp-single { background: ${COLORS.single}; }
    .kp-name {
      font-size: 12px; font-weight: 700; line-height: 1.25; text-align: center; min-height: 2.5em;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere;
    }
    .kp-state { font-size: 11px; text-align: center; color: var(--fg2, #b7b2bd); }
    .kp-give { width: 100%; justify-content: center; }
    .kp-give.kp-warn { background: ${COLORS.single}; border-color: ${COLORS.single}; color: #111; }

    /* ---- Exchanges: refresh button after « Mes offres » (copies the pill's classes) ---- */
    .kp-refresh { display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
    .kp-refresh svg { width: 14px; height: 14px; display: block; }
    .kp-refresh[data-kp-busy] { cursor: wait; opacity: .7; }
    .kp-refresh[data-kp-busy] svg { animation: kp-spin .8s linear infinite; }
    @keyframes kp-spin { to { transform: rotate(360deg); } }

    /* ---- Profile › trade window: « Ses doubles » chip ---- */
    [data-kp-dupes] .kp-n { margin-left: 4px; opacity: .7; }
    [data-kp-dupes][data-kp-busy] { cursor: wait; opacity: .7; }
    .kp-trade-empty { grid-column: 1 / -1; list-style: none; margin: 12px 0; text-align: center; font-size: 13px; color: var(--fg2, #b7b2bd); }
    [data-kp-grid] .kp-adding { opacity: .5; cursor: wait; }

    /* ---- Offers the site does not display ---- */
    .kp-extra { display: flex; flex-direction: column; gap: 10px; margin-top: 18px; }
    .kp-extra.kp-extra-top { margin: 0 0 10px; }
    .kp-extra h3 { margin: 0; font-size: 16px; }
    .kp-extra p { margin: 2px 0 0; font-size: 12px; color: var(--fg2, #b7b2bd); }
    .kp-xlist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
    .kp-xoffer {
      display: flex; flex-direction: column; gap: 10px; padding: 12px 14px;
      border: 1px solid var(--line, #25232c); background: var(--panel, #15141a); border-radius: 14px;
    }
    .kp-xtop { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 18px; }
    .kp-xgive { flex: 1 1 240px; display: flex; align-items: center; gap: 10px; min-width: 0; }
    .kp-xbig { position: relative; display: inline-block; flex: none; }
    .kp-xbig img {
      display: block; width: 102px; aspect-ratio: 5 / 7; object-fit: cover; object-position: 50% 20%;
      border-radius: 10px; outline: 3px solid var(--kp-rc); outline-offset: -3px;
    }
    .kp-xinfo { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .kp-xinfo .kp-sub { font-size: 12px; color: var(--fg2, #b7b2bd); }
    .kp-xarrow { color: var(--fg2, #b7b2bd); font-size: 22px; }
    .kp-xacts { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding-top: 8px; border-top: 1px solid var(--line, #25232c); }

    /* ---- Collection: lock toggle under each owned card ---- */
    .cell > a.slot { position: relative; }
    .kp-lock-icon {
      position: absolute; top: 6px; right: 6px; z-index: 6; pointer-events: none;
      padding: 2px 5px; border-radius: 8px; font-size: 13px; background: rgba(0,0,0,.65);
    }
    /* Small lock toggle next to the site's sell button / label (left untouched) */
    .kp-lock-mini {
      display: inline-grid; place-items: center; width: 26px; height: 26px; padding: 0; cursor: pointer; flex: none;
      border-radius: 999px; border: 1px solid var(--line2, #2e2b36); background: transparent; font-size: 12px;
      opacity: .55;
    }
    .kp-lock-mini:hover { border-color: ${COLORS.wishlist}; opacity: 1; }
    .kp-lock-mini[aria-pressed="true"] { border-color: ${COLORS.wishlist}; background: rgba(0,0,0,.35); opacity: 1; }
    [data-kp-control][data-kp-busy] { opacity: .6; cursor: wait; }
    .kp-hidden-frame {
      position: fixed; left: -10000px; top: 0; width: 1200px; height: 800px; /* desktop size so the site renders its button */
      border: 0; opacity: 0; pointer-events: none;
    }

    /* ---- Collection › Albums: filters ---- */
    .al-tools:has(> .kp-album-filters) { flex-wrap: wrap; }
    .kp-album-filters {
      flex: 1 0 100%; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; margin-top: 8px; padding: 10px 12px;
      border: 1px solid var(--line, #25232c); border-radius: 12px; background: var(--panel, #15141a); font-size: 13px;
    }
    .kp-af-group { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .kp-af-label { color: var(--fg2, #b7b2bd); }
    .kp-af-input {
      height: 28px; padding: 0 8px; border-radius: 8px; border: 1px solid var(--line2, #2e2b36);
      background: transparent; color: var(--fg, #edeae4); font: inherit;
    }
    .kp-af-input[type="number"] { width: 70px; }
    .kp-af-rar {
      position: relative; display: inline-flex; align-items: center; height: 26px; padding: 0 10px; cursor: pointer; user-select: none;
      border-radius: 999px; border: 1px solid var(--kp-rc); color: var(--kp-rc); font-weight: 700;
    }
    .kp-af-rar input { position: absolute; opacity: 0; pointer-events: none; }
    .kp-af-rar:has(input:checked) { background: var(--kp-rc); color: #111; }
    .kp-af-rar:has(input:focus-visible) { outline: 2px solid var(--fg, #edeae4); outline-offset: 2px; }
    .kp-af-count { margin-left: auto; color: var(--fg2, #b7b2bd); }
    .kp-af-reset { height: 28px; padding: 0 10px; border-radius: 999px; border: 1px solid var(--line2, #2e2b36); background: transparent; color: var(--fg3, #c9c5ce); font: inherit; cursor: pointer; }

    /* ---- Comptoir (market chat): hidden unless toggled ---- */
    html:not(.kp-show-chat):not(.kp-chat-page) .chat-side, html:not(.kp-show-chat):not(.kp-chat-page) .chat-fab { display: none !important; }
    html:not(.kp-show-chat):not(.kp-chat-page) .layout:has(.chat-side) { grid-template-columns: minmax(0, 1fr) !important; }
    #kp-chat-toggle {
      position: fixed; left: 16px; bottom: 16px; z-index: 50; padding: 8px 14px; border-radius: 999px; cursor: pointer;
      font: 700 12px system-ui, sans-serif; color: var(--fg, #edeae4); background: var(--panel2, #17161d);
      border: 1px solid var(--line2, #2e2b36); box-shadow: 0 4px 12px rgba(0,0,0,.5);
    }

    /* ---- Kyara+ 2 : toast, écart de valeur, « Donner » armé, offres nouvelles ---- */
    .kp-toast {
      position: fixed; right: 16px; bottom: 16px; z-index: 9999; max-width: 340px; padding: 10px 14px; border-radius: 12px;
      font: 600 13px system-ui, sans-serif; color: var(--fg, #edeae4); background: var(--panel2, #17161d);
      border: 1px solid var(--line2, #2e2b36); box-shadow: 0 4px 12px rgba(0,0,0,.5);
    }
    .kp-delta { font-size: 11px; font-weight: 700; text-align: center; }
    .kp-delta.kp-up { color: ${COLORS.duplicate}; }
    .kp-delta.kp-down { color: ${COLORS.danger}; }
    .kp-give.kp-armed { background: ${COLORS.danger} !important; border-color: ${COLORS.danger} !important; color: #fff !important; }
    li.offer[data-kp-new], .kp-xoffer[data-kp-new] { position: relative; }
    li.offer[data-kp-new]::after, .kp-xoffer[data-kp-new]::after {
      content: 'Nouveau'; position: absolute; top: 8px; right: 10px; padding: 1px 8px; border-radius: 999px;
      font: 700 10px/1.5 system-ui, sans-serif; color: #111; background: ${COLORS.duplicate}; pointer-events: none;
    }

  `;

  function injectStyles() {
    if (document.getElementById('kp-style')) return;
    document.head.appendChild(el('style', { id: 'kp-style', text: CSS }));
  }

  /* ==========================================================================
   * 9. COMPOSANTS — éléments d’interface partagés
   * ======================================================================== */

  function ownedLabel(qty) {
    return qty
      ? { text: `Tu l’as déjà (×${qty})`, color: 'var(--fg2, #b7b2bd)' }
      : { text: 'Tu ne l’as pas encore', color: COLORS.duplicate };
  }

  function countBadge(id, qty) {
    if (!qty) return null;
    const hint = qty >= 2
      ? `Tu en as ${qty} : tu peux l’échanger et en garder une`
      : 'C’est ta seule copie : tu ne l’auras plus après l’échange';
    return el('span', {
      class: `kp-cnt ${qty >= 2 ? 'kp-dup' : 'kp-single'}`,
      text: `×${qty}`,
      title: hint + (isLockedInData(id) ? ' (🔒 verrouillée)' : ''),
    });
  }

  /** Une carte proposée : image, rareté, exemplaires, nom, écart de valeur optionnel, et une action. */
  function cardTile({ id, name, src, rarity, available, qty, delta = null, onOpen, action }) {
    const link = el('a', {
      href: `/wiki/${id}`,
      title: name + (rarity ? ` – ${rarity.name}` : ''),
      onClick: onOpen && ((e) => {
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        onOpen();
      }),
    },
    el('img', { src, alt: name, referrerpolicy: 'no-referrer' }),
    rarity && el('span', { class: 'kp-rar', text: rarity.name }),
    countBadge(id, qty));

    return el('div', { class: 'kp-tile' + (available ? '' : ' kp-missing'), '--kp-rc': rarityColor(rarity) },
      link,
      el('div', { class: 'kp-name', text: name }),
      delta !== null && el('div', {
        class: `kp-delta ${delta >= 0 ? 'kp-up' : 'kp-down'}`,
        title: 'Valeur indicative (prix fair-play) : carte reçue − carte donnée',
        text: deltaText(delta),
      }),
      action);
  }

  const stateText = (text) => el('div', { class: 'kp-state', text });

  /** Clic « armé » : le 1er clic demande confirmation pendant 4 s, le 2e exécute (cas irréversibles seulement). */
  const needsConfirm = ({ qty, rarity }) => qty === 1 || rarityRank(rarity) >= 4;
  function armedClick(button, card, action, always = false) {
    const label = button.textContent;
    let timer = null;
    const disarm = () => { clearTimeout(timer); timer = null; button.textContent = label; button.classList.remove('kp-armed'); };
    button.addEventListener('click', () => {
      if ((always || needsConfirm(card)) && timer === null) {
        button.textContent = 'Confirmer ?';
        button.classList.add('kp-armed');
        timer = setTimeout(disarm, TIMING.armed);
        return;
      }
      disarm();
      action();
    });
    return button;
  }

  /** Icône « actualiser » dessinée en SVG (le site n’a pas de police d’icônes). */
  function refreshIcon() {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
    for (const d of ['M20 12a8 8 0 1 1-2.34-5.66', 'M20 3.5v5h-5']) {
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', d);
      svg.appendChild(path);
    }
    return svg;
  }

  /** Rareté d’après l’ombre colorée que le site pose sur les images de cartes. */
  function rarityFromImg(img) {
    const shadow = img.style.boxShadow || getComputedStyle(img).boxShadow || '';
    const m = shadow.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return null;
    const c = [+m[1], +m[2], +m[3]];
    let best = null, bestD = Infinity;
    for (const r of RARITIES) {
      const d = (r.rgb[0] - c[0]) ** 2 + (r.rgb[1] - c[1]) ** 2 + (r.rgb[2] - c[2]) ** 2;
      if (d < bestD) { bestD = d; best = r; }
    }
    return bestD < 3000 ? best : null; // couleur la plus proche, tolérante aux variations de teinte
  }
  const imgRarityCache = new WeakMap();
  /** Catalogue d’abord (gratuit), sinon couleur de l’image (mémorisée : getComputedStyle une seule fois par image). */
  function rarityOfImg(img, id) {
    const fromCatalog = id ? store.get('catalog').get(String(id))?.rarity : null;
    if (fromCatalog) return fromCatalog;
    const hit = imgRarityCache.get(img);
    if (hit && hit.src === img.src) return hit.rarity;
    const rarity = rarityFromImg(img);
    if (rarity) imgRarityCache.set(img, { src: img.src, rarity });
    return rarity;
  }

  /**
   * Ordre d’affichage d’une offre (plus petit = en premier) : wishlist acceptable, wishlist, puis les autres ;
   * dans chaque groupe, rareté de la carte offerte, Mythique d’abord. Rareté inconnue : dernière de son groupe.
   */
  function offerOrder(wish, rarity) {
    const rank = rarity ? RARITIES.indexOf(rarity) + 1 : 0;
    return -(wish * 10 + rank);
  }

  /* ==========================================================================
   * 10. VERROUILLAGE — requête apprise du site, sinon bouton du site dans une iframe invisible
   * ======================================================================== */

  const validLock = (v) => isObj(v) && typeof v.url === 'string' && v.url.includes('{id}')
    && /^\w+$/.test(v.stateKey) && (v.idKey === null || /^\w+$/.test(v.idKey));
  const learnedLock = () => storage.get(KEY.lockRequest, null, validLock) || LOCK_REQUEST;

  /** Apprend la requête de verrouillage depuis une vraie requête du site (l’id de la carte devient {id}). */
  function learnLockRequest(url, bodyText, cardId) {
    let body = {};
    try { body = bodyText ? JSON.parse(bodyText) : {}; } catch { return log.warn('requête de verrouillage illisible', bodyText); }
    if (!isObj(body)) return log.warn('requête de verrouillage illisible', bodyText);
    const stateKey = Object.keys(body).find((k) => typeof body[k] === 'boolean');
    const idKey = Object.keys(body).find((k) => cardId && String(body[k]) === cardId);
    const path = new URL(url, location.origin).pathname;
    const urlHasId = !!cardId && path.split('/').includes(cardId);
    if (!stateKey || (!urlHasId && !idKey)) return log.warn('requête de verrouillage non comprise', path, body);
    const learned = { url: urlHasId ? path.split('/').map((p) => (p === cardId ? '{id}' : p)).join('/') : path, stateKey, idKey: idKey || null };
    if (!validLock(learned)) return log.warn('requête de verrouillage refusée', learned);
    storage.set(KEY.lockRequest, learned);
    log.info('requête de verrouillage apprise :', `POST ${learned.url}`);
    scheduleRender();
  }

  /** Nouvel état dans la réponse du serveur ({ characterId, pinned: true }…) : true / false, ou null si elle ne le dit pas. */
  function lockStateFromResponse(text) {
    let data;
    try { data = JSON.parse(text); } catch { return null; }
    if (typeof data === 'boolean') return data;
    if (!isObj(data)) return null;
    const isFlag = (v) => typeof v === 'boolean' || v === 0 || v === 1;
    const keys = Object.keys(data);
    const key = keys.find((k) => /pin|lock/i.test(k) && isFlag(data[k]))
      || keys.find((k) => typeof data[k] === 'boolean' && !/^(ok|success)$/i.test(k));
    return key ? !!data[key] : null;
  }

  /** Envoie la requête apprise. Résout { ok, status, response }, ou null si elle n’a pas pu partir. */
  async function sendLearnedLock(id, locked) {
    if (!net.hasHeaders()) return null; // la requête de collection du site n’a pas encore été vue
    const learned = learnedLock();
    const body = { [learned.stateKey]: locked };
    if (learned.idKey) body[learned.idKey] = Number(id);
    const url = learned.url.replace('{id}', id);
    try {
      const res = await net.request(url, { method: 'POST', body });
      const response = await res.text().catch(() => '');
      log.info('verrouillage direct :', `POST ${url}`, JSON.stringify(body), `→ HTTP ${res.status}`, response);
      if (!res.ok) log.warn('verrouillage direct refusé, passage par la page wiki');
      return { ok: res.ok, status: res.status, response };
    } catch (err) {
      log.warn('verrouillage direct impossible, passage par la page wiki', err);
      return null;
    }
  }

  /**
   * Ouvre /wiki/<id> dans une iframe invisible et clique le bouton 🔒 du site si besoin. L’iframe n’est retirée qu’une fois
   * sa requête terminée (le script, injecté dans l’iframe, envoie FRAME_LOCK_DONE : la retirer avant annulerait la requête).
   */
  async function lockThroughWikiFrame(id, locked) {
    const frame = el('iframe', { src: `/wiki/${id}`, class: 'kp-hidden-frame', 'aria-hidden': 'true', tabindex: '-1' });
    let onMessage = null;
    const requestDone = new Promise((resolve) => {
      onMessage = (e) => {
        if (e.source === frame.contentWindow && e.origin === location.origin && e.data && e.data.type === FRAME_LOCK_DONE) resolve(e.data);
      };
      window.addEventListener('message', onMessage);
    });
    document.body.appendChild(frame);

    const lockButton = () => [...frame.contentDocument.querySelectorAll(SITE.wikiLockButton)].find((b) => SITE.lockLabel.test(b.textContent)) || null;
    const isPressed = (b) => b.getAttribute('aria-pressed') === 'true';
    try {
      // La page wiki affiche d’abord son bouton « déverrouillé », avant d’avoir chargé la collection : on attend
      // qu’il montre l’état réel de la carte (l’opposé de celui voulu) avant de cliquer.
      let lastSeen = null;
      let button;
      try {
        button = await waitFor(() => { const b = lockButton(); if (b) lastSeen = b; return b && isPressed(b) !== locked ? b : null; }, TIMING.frameWait);
      } catch (err) {
        if (lastSeen && isPressed(lastSeen) === locked) return null; // la carte est déjà dans l’état voulu
        throw new Error('la page wiki n’a pas répondu à temps');
      }
      button.click();
      const report = await Promise.race([requestDone, sleep(TIMING.frameReport).then(() => null)]);
      if (report && !report.ok) throw new Error(`le site a refusé (HTTP ${report.status})`);
      if (report) {
        log.info('verrouillage via la page wiki : HTTP', report.status, report.response);
      } else {
        log.warn('la page wiki n’a pas confirmé sa requête, on se fie à son bouton');
        await waitFor(() => { const b = lockButton(); return b && isPressed(b) === locked; }, 10000);
        await sleep(2000);
      }
      return report;
    } finally {
      window.removeEventListener('message', onMessage);
      frame.remove();
    }
  }

  /** Verrouille / déverrouille une carte. Résout quand le serveur a accepté, rejette sinon. */
  async function setCardLock(id, locked) {
    const direct = await sendLearnedLock(id, locked);
    if (direct && direct.ok) {
      const result = lockStateFromResponse(direct.response);
      if (result === null || result === locked) return;
      log.warn('le serveur a répondu un autre état que celui demandé : requête apprise oubliée', direct.response);
      storage.remove(KEY.lockRequest);
    }
    const report = await lockThroughWikiFrame(id, locked);
    const result = report ? lockStateFromResponse(report.response) : null;
    if (result !== null && result !== locked) throw new Error('le site indique que la carte n’a pas changé');
  }

  /* ==========================================================================
   * 11. FEATURES
   * ======================================================================== */

  /** Comptoir (chat du marché) masqué, avec un bouton pour le ré-afficher (jamais sur sa propre page). */
  defineFeature({
    name: 'chatToggle',
    label: 'Comptoir masquable',
    match: () => true,
    run() {
      const onChatPage = SITE.chatPage.test(location.pathname);
      document.documentElement.classList.toggle('kp-chat-page', onChatPage);
      const hasChat = !onChatPage && !!document.querySelector(SITE.chat);
      let button = document.getElementById('kp-chat-toggle');
      if (!hasChat) { if (button) button.remove(); return; }
      const shown = storage.get(KEY.showChat, false);
      document.documentElement.classList.toggle('kp-show-chat', shown);
      if (!button) {
        button = el('button', {
          id: 'kp-chat-toggle', type: 'button',
          onClick: () => { storage.set(KEY.showChat, !storage.get(KEY.showChat, false)); scheduleRender(); },
        });
        document.body.appendChild(button);
      }
      setText(button, shown ? 'Masquer le comptoir' : 'Afficher le comptoir');
    },
    teardown() {
      document.getElementById('kp-chat-toggle')?.remove();
      document.documentElement.classList.remove('kp-chat-page');
      document.documentElement.classList.add('kp-show-chat'); // sans la feature, le comptoir redevient visible
    },
  });

  /** Onglets du marché : un onglet « Comptoir » après « Mon activité » (le style des onglets du site est copié). */
  defineFeature({
    name: 'marketChatTab',
    label: 'Onglet « Comptoir » dans le marché',
    match: (p) => SITE.marketPage.test(p),
    run() {
      const tabs = document.querySelector(SITE.marketTabs);
      if (!tabs) return;
      const siteTab = [...tabs.querySelectorAll('button')].find((b) => !b.hasAttribute('data-kp-tab'));
      let tab = tabs.querySelector(':scope > [data-kp-tab]');
      if (!tab) {
        tab = el('button', {
          type: 'button', 'data-kp-tab': '', text: 'Comptoir', title: 'Ouvrir le comptoir (chat du marché)',
          onClick: () => navigate('/marche/chat'),
          onAuxclick: (e) => { if (e.button === 1) { e.preventDefault(); window.open('/marche/chat', '_blank'); } },
        });
        tabs.appendChild(tab);
      }
      const base = siteTab ? siteTab.className.replace(/\bon\b/g, '').trim() : '';
      setAttr(tab, 'class', SITE.chatPage.test(location.pathname) ? `${base} on` : base);
    },
    teardown() { document.querySelectorAll('[data-kp-tab]').forEach((n) => n.remove()); },
  });

  /** Offres du site : rareté, exemplaires possédés, grille de tuiles avec un « Donner » par carte, écart de valeur, wishlist. */
  defineFeature({
    name: 'offerCards',
    label: 'Offres : rareté, ×N possédés, grille « Donner », wishlist en tête',
    match: (p) => SITE.marketPage.test(p),

    run() {
      const offers = [...document.querySelectorAll(SITE.offer)];
      if (opt('valueDelta') && offers.length) this.wantPrices(offers);
      for (const offer of offers) {
        this.decorateGivenCard(offer);
        this.renderGrid(offer);
        this.markWishlist(offer);
      }
    },

    /** Demande en un seul appel les prix de toutes les cartes visibles (par lots, une seule fois chacune). */
    wantPrices(offers) {
      const ids = new Set();
      for (const offer of offers) {
        const give = wikiId(offer.querySelector(SITE.offerGiveLink)?.getAttribute('href'));
        if (give) ids.add(give);
        for (const a of offer.querySelectorAll(`${SITE.offerWant} ${SITE.offerThumb}`)) { const id = wikiId(a.getAttribute('href')); if (id) ids.add(id); }
      }
      if (ids.size) load.prices([...ids]);
    },

    decorateGivenCard(offer) {
      const link = offer.querySelector(SITE.offerGiveLink);
      const info = offer.querySelector(SITE.offerGiveInfo);
      if (!link) return;
      const id = wikiId(link.getAttribute('href'));
      const img = link.querySelector('img');
      const rarity = img && rarityOfImg(img, id);
      if (rarity && link.getAttribute('data-kp-rarity') !== rarity.name) {
        link.setAttribute('data-kp-rarity', rarity.name);
        link.style.setProperty('--kp-rc', rgbCss(rarity));
        if (!link.querySelector('.kp-badge')) link.appendChild(el('span', { class: 'kp-badge' }));
        setText(link.querySelector('.kp-badge'), rarity.name);
      }
      if (info && store.get('collection')) {
        const { text, color } = ownedLabel(ownedQty(id));
        let owned = info.querySelector(':scope > .kp-owned');
        if (!owned) info.appendChild(owned = el('span', { class: 'kp-owned' }));
        setText(owned, text);
        if (owned.style.color !== color) owned.style.color = color;
      }
    },

    renderGrid(offer) {
      const want = offer.querySelector(SITE.offerWant);
      const thumbs = want && want.querySelector(SITE.offerThumbs);
      const links = thumbs ? [...thumbs.querySelectorAll(SITE.offerThumb)] : [];
      if (!links.length) return;

      const giveId = wikiId(offer.querySelector(SITE.offerGiveLink)?.getAttribute('href'));
      const showDelta = opt('valueDelta') && !!giveId;
      // Les boutons « Donner <nom> » du site, associés aux vignettes par le nom (dans l’ordre, pour les homonymes)
      const giveButtons = [...offer.querySelectorAll(SITE.offerActionButtons)].filter((b) => SITE.giveLabel.test(b.textContent.trim()));

      const cards = links.map((a) => {
        const img = a.querySelector('img');
        const name = (img && img.alt) || (a.title || '').replace(/\s*\(tu l.as\)\s*$/, '');
        const i = giveButtons.findIndex((b) => b.textContent.trim() === `Donner ${name}`);
        const button = i >= 0 ? giveButtons.splice(i, 1)[0] : null;
        const id = wikiId(a.getAttribute('href'));
        const have = a.classList.contains('have');
        return {
          a, img, id, name, have, button,
          qty: have ? ownedQty(id) || null : null, // un compteur n’est montré que s’il confirme le « tu l’as » du site
          rarity: img && rarityOfImg(img, id),
          delta: showDelta ? valueDelta(giveId, id) : null,
        };
      });

      const signature = store.ver('collection') + '@' + opt('confirmGive') + '@' + cards.map((c) =>
        [c.id, c.img && c.img.src, c.have, c.button ? (c.button.disabled ? 'd' : 'b') : '', c.rarity && c.rarity.name, c.qty, c.delta].join('|')).join('#');

      let grid = want.querySelector(':scope > .kp-grid');
      if (grid && grid.dataset.signature === signature) return;
      if (!grid) want.appendChild(grid = el('div', { class: 'kp-grid' }));
      grid.dataset.signature = signature;
      grid.replaceChildren(...cards.map((c) => cardTile({
        id: c.id, name: c.name, src: c.img ? c.img.src : cardImage(c.id), rarity: c.rarity, available: c.have, qty: c.qty, delta: c.delta,
        onOpen: () => c.a.click(), // laisse le routeur du site naviguer
        action: c.button ? this.giveButton(c) : stateText(c.have ? 'Tu l’as (pas libre)' : 'Tu ne l’as pas'),
      })));
      thumbs.setAttribute('data-kp-hidden', '');
    },

    /** Notre « Donner » ne fait que cliquer le bouton (masqué) du site ; en deux temps pour les cas irréversibles. */
    giveButton(card) {
      card.button.setAttribute('data-kp-hidden', '');
      const button = el('button', {
        type: 'button',
        class: 'btn btn-acc btn-sm kp-give' + (card.qty === 1 ? ' kp-warn' : ''),
        text: 'Donner',
        title: card.button.textContent.trim(),
        disabled: card.button.disabled,
      });
      const give = () => card.button.click(); // la collection est relue après la réponse du serveur (voir écouteur de mutations)
      if (opt('confirmGive')) return armedClick(button, { qty: card.qty, rarity: card.rarity }, give);
      button.addEventListener('click', give);
      return button;
    },

    /** data-kp-wish "2" = dans la wishlist et acceptable maintenant, "1" = dans la wishlist. Fixe aussi l’ordre d’affichage. */
    markWishlist(offer) {
      const link = offer.querySelector(SITE.offerGiveLink);
      const info = offer.querySelector(SITE.offerGiveInfo);
      if (!link || !info) return;
      const id = wikiId(link.getAttribute('href'));
      const wished = inWishlist(id);
      const wish = wished ? (offer.querySelector('.kp-give') ? 2 : 1) : 0;
      setAttr(offer, 'data-kp-wish', wish ? String(wish) : null);
      const img = link.querySelector('img');
      setStyle(offer, '--kp-order', String(offerOrder(wish, img && rarityOfImg(img, id))));
      const offerId = offer.id && offer.id.startsWith('offre-') ? offer.id.slice('offre-'.length) : null;
      setAttr(offer, 'data-kp-new', opt('newOffers') && offerId && store.get('newOffers').has(offerId) ? '' : null);
      const tag = info.querySelector(':scope > .kp-wish-tag');
      if (wished && !tag) info.appendChild(el('span', { class: 'kp-wish-tag', text: '♥ Dans ta wishlist' }));
      else if (!wished && tag) tag.remove();
    },

    teardown() {
      document.querySelectorAll('.kp-grid, .kp-badge, .kp-owned, .kp-wish-tag').forEach((n) => n.remove());
      document.querySelectorAll(`${SITE.offer} [data-kp-hidden]`).forEach((n) => n.removeAttribute('data-kp-hidden'));
      document.querySelectorAll(SITE.offer).forEach((o) => { o.removeAttribute('data-kp-wish'); o.removeAttribute('data-kp-new'); o.style.removeProperty('--kp-order'); });
      document.querySelectorAll('[data-kp-rarity]').forEach((n) => n.removeAttribute('data-kp-rarity'));
    },
  });

  /** Échanges : pill « Que j’ai en double » après « Que je peux accepter ». Désactivée à chaque chargement de page. */
  defineFeature({
    name: 'duplicateFilter',
    label: 'Filtre « Que j’ai en double »',
    match: (p) => SITE.marketPage.test(p),
    run() {
      const anchor = [...document.querySelectorAll(SITE.offerPill)].find((p) => !p.hasAttribute('data-kp-pill') && SITE.acceptPill.test(p.textContent));
      const pill = ensureAfter(anchor, 'data-kp-pill', () => el('button', {
        type: 'button',
        text: 'Que j’ai en double',
        title: 'N’afficher que les échanges qui demandent une carte que tu as en au moins 2 exemplaires',
        onClick: () => store.set('dupesOnly', !store.get('dupesOnly')),
      }));
      const active = store.get('dupesOnly') && !!store.get('collection'); // l’UI reflète l’état RÉEL du filtre
      if (pill) {
        setAttr(pill, 'class', siteClasses(anchor) + (active ? ' on' : ''));
        setAttr(pill, 'aria-pressed', String(active));
      }
      for (const offer of document.querySelectorAll(SITE.offer)) {
        const ids = [...offer.querySelectorAll(`${SITE.offerWant} ${SITE.offerThumb}`)].map((a) => wikiId(a.getAttribute('href'))).filter(Boolean);
        setAttr(offer, 'data-kp-hidden', active && !asksForDuplicate(ids) ? '' : null);
      }
    },
    teardown() {
      ensureAfter(null, 'data-kp-pill');
      document.querySelectorAll(`${SITE.offer}[data-kp-hidden]`).forEach((o) => o.removeAttribute('data-kp-hidden'));
    },
  });

  const pillLabel = (pill) => pill.textContent.replace(/\d+/g, '').replace(/\s+/g, ' ').trim();

  /**
   * Échanges : bouton « Actualiser » après « Mes offres ». La liste du site ne se recharge que quand sa vue est remontée :
   * on bascule sur un autre onglet du site puis on revient (ses propres boutons). S’il ne recharge pas, on rejoue sa requête.
   */
  defineFeature({
    name: 'offersRefresh',
    label: 'Bouton « Actualiser » des échanges',
    match: (p) => SITE.marketPage.test(p),
    busy: false,

    sitePills() {
      return [...document.querySelectorAll(SITE.offerPill)].filter((p) => !p.hasAttribute('data-kp-pill') && !p.hasAttribute('data-kp-refresh'));
    },

    run() {
      const anchor = this.sitePills().find((p) => SITE.myOffersPill.test(p.textContent));
      const button = ensureAfter(anchor, 'data-kp-refresh', () => el('button', {
        type: 'button', title: 'Actualiser les échanges', 'aria-label': 'Actualiser les échanges', onClick: () => this.refresh(),
      }, refreshIcon()));
      if (!button) return;
      setAttr(button, 'class', `${siteClasses(anchor)} kp-refresh`);
      setAttr(button, 'data-kp-busy', this.busy ? '' : null);
    },

    async refresh() {
      if (this.busy) return;
      this.busy = true;
      scheduleRender();
      const before = store.ver('serverOffers');
      const pressed = this.sitePills().filter((p) => p.getAttribute('aria-pressed') === 'true').map(pillLabel);
      try {
        await this.remountExchanges();
        await waitFor(() => store.ver('serverOffers') > before, 5000);
        log.info('échanges actualisés par le site');
      } catch {
        // Le site n’a pas rechargé sa liste : au moins des données fraîches pour les offres cachées
        if (await load.offers()) log.info('échanges actualisés (requête rejouée)');
        else log.warn('impossible d’actualiser les échanges');
      } finally {
        await this.restorePills(pressed);
        this.busy = false;
        scheduleRender();
      }
    },

    /** Remonter la vue réinitialise les pills du site : on re-clique celles qui étaient actives. */
    async restorePills(labels) {
      if (!labels.length) return;
      try { await waitFor(() => this.sitePills().length, 3000); } catch { return log.warn('filtres du site introuvables après l’actualisation'); }
      for (const label of labels) {
        const pill = this.sitePills().find((p) => pillLabel(p) === label);
        if (pill && pill.getAttribute('aria-pressed') !== 'true') pill.click();
        await sleep(50); // laisse le site se redessiner avant de chercher la pill suivante
      }
    },

    async remountExchanges() {
      const tabs = () => [...document.querySelectorAll(`${SITE.marketTabs} button`)].filter((b) => !b.hasAttribute('data-kp-tab'));
      const exchanges = () => tabs().find((b) => SITE.exchangesTab.test(b.textContent));
      const other = tabs().find((b) => b !== exchanges());
      if (!exchanges() || !other) throw new Error('onglets introuvables');
      other.click();
      await waitFor(() => { const b = exchanges(); return b && !b.classList.contains('on'); }, 3000);
      exchanges().click();
      await waitFor(() => { const b = exchanges(); return b && b.classList.contains('on'); }, 3000);
    },

    teardown() { ensureAfter(null, 'data-kp-refresh'); },
  });

  /** Offres que le serveur envoie mais que le site n’affiche pas (il plafonne sa liste à 120). */
  defineFeature({
    name: 'hiddenOffers',
    label: 'Offres que le site n’affiche pas',
    match: (p) => SITE.marketPage.test(p),

    run() {
      const list = document.querySelector(SITE.offerList);
      const server = store.get('serverOffers');
      if (!list || !server.length || this.filtersActive()) return this.clear();

      const shown = new Set([...list.querySelectorAll(`${SITE.offer}[id^="offre-"]`)].map((li) => li.id.slice('offre-'.length)));
      if (!shown.size) return this.clear();

      // Noms, raretés et possessions : on les charge nous-mêmes si la page ne l’a pas fait (au plus toutes les 30 s)
      if (!store.get('catalog').size) ensure('catalog', load.catalog);
      if (!store.get('collection')) ensure('collection', load.collection);

      const canGive = (o) => (o.wantIds || []).some((w) => freeCopies(w) > 0);
      const rank = (o) => offerOrder(inWishlist(o.characterId) ? (canGive(o) ? 2 : 1) : 0, cardInfo(o.characterId).rarity) * 2 + (canGive(o) ? 0 : 1);
      const duplicatesOnly = store.get('dupesOnly') && !!store.get('collection');
      const missing = server
        .filter((o) => !shown.has(String(o.id)))
        .filter((o) => !duplicatesOnly || asksForDuplicate((o.wantIds || []).map(String)))
        .sort((a, b) => rank(a) - rank(b));

      if (opt('valueDelta') && missing.length) load.prices([...new Set(missing.flatMap((o) => [o.characterId, ...(o.wantIds || [])]))]);

      const signature = [
        missing.map((o) => o.id).join(','), store.ver('collection'), store.ver('wishlist'), store.ver('catalog'),
        opt('valueDelta') ? store.ver('prices') : 0, store.get('newOffers').size, duplicatesOnly,
      ].join('@');
      const bottom = document.getElementById('kp-extra');
      if (bottom && bottom.dataset.signature === signature) return;
      this.clear();
      if (!missing.length) return;

      const wished = missing.filter((o) => inWishlist(o.characterId));
      const others = missing.filter((o) => !inWishlist(o.characterId));
      const help = 'Le site n’affiche que les 120 premières offres. « Ouvrir l’offre » la fait apparaître dans la liste avec ses boutons « Donner ».';
      if (wished.length) list.before(this.section('kp-extra-top', `♥ ${plural(wished.length, 'offre')} de ta wishlist que le site n’affiche pas`, help, wished));
      const section = this.section('kp-extra', `${plural(others.length, 'autre offre')} que le site n’affiche pas`, help, others);
      section.dataset.signature = signature;
      if (!others.length) section.hidden = true;
      list.after(section);
    },

    clear() {
      document.getElementById('kp-extra-top')?.remove();
      document.getElementById('kp-extra')?.remove();
    },
    teardown() { this.clear(); },

    /** Avec une recherche ou un filtre, le site cache des offres exprès : on ne les ré-ajoute pas. */
    filtersActive() {
      const search = document.querySelector(SITE.search);
      return !!((search && search.value.trim()) || document.querySelector(SITE.activeFilter));
    },

    section(id, title, help, offers) {
      return el('div', { id, class: 'kp-extra' + (id === 'kp-extra-top' ? ' kp-extra-top' : '') },
        el('div', {}, el('h3', { text: title }), el('p', { text: help })),
        el('ul', { class: 'kp-xlist' }, offers.map((o) => this.offer(o))));
    },

    offer(o) {
      const give = cardInfo(o.characterId);
      const wished = inWishlist(o.characterId);
      const hasCollection = !!store.get('collection');
      const owned = hasCollection ? ownedLabel(ownedQty(o.characterId)) : null;
      const isNew = opt('newOffers') && store.get('newOffers').has(String(o.id));

      const givenCard = el('div', { class: 'kp-xgive' },
        el('a', { class: 'kp-xbig', href: `/wiki/${o.characterId}`, '--kp-rc': rarityColor(give.rarity) },
          el('img', { src: cardImage(o.characterId), alt: give.name, referrerpolicy: 'no-referrer' }),
          give.rarity && el('span', { class: 'kp-badge', text: give.rarity.name })),
        el('div', { class: 'kp-xinfo' },
          el('b', { text: give.name }),
          el('span', { class: 'kp-sub', text: [give.rarity && give.rarity.name, o.user && `par ${o.user.pseudo}`, expiresText(o.expiresAt)].filter(Boolean).join(' · ') }),
          owned && el('span', { class: 'kp-owned', text: owned.text, style: `color:${owned.color}` }),
          wished && el('span', { class: 'kp-wish-tag', text: '♥ Dans ta wishlist' })));

      const wanted = el('div', { class: 'kp-want' }, el('div', { class: 'kp-grid' }, (o.wantIds || []).map((wid) => {
        const card = cardInfo(wid);
        const qty = ownedQty(wid);
        const free = freeCopies(wid);
        return cardTile({
          id: String(wid), name: card.name, src: cardImage(wid), rarity: card.rarity,
          available: !hasCollection || free > 0, qty: qty || null,
          delta: opt('valueDelta') ? valueDelta(o.characterId, wid) : null,
          action: stateText(!hasCollection ? 'Collection non chargée' : free > 0 ? 'Tu peux la donner' : qty ? 'Tu l’as (pas libre)' : 'Tu ne l’as pas'),
        });
      })));

      const openButton = el('button', {
        type: 'button', class: 'btn btn-acc btn-sm', text: 'Ouvrir l’offre',
        title: 'Cherche cette carte dans la liste du site pour faire apparaître l’offre et ses boutons « Donner »',
        onClick: () => this.openWithSearch(o),
      });

      return el('li', { class: 'kp-xoffer' + (wished ? ' kp-wish' : ''), 'data-kp-new': isNew },
        el('div', { class: 'kp-xtop' }, givenCard, el('div', { class: 'kp-xarrow', text: '⇄' }), wanted),
        el('div', { class: 'kp-xacts' }, openButton));
    },

    /** Fait apparaître une offre cachée dans la vraie liste en tapant le nom de sa carte dans la recherche du site. */
    openWithSearch(o) {
      const search = document.querySelector(SITE.search);
      if (!search) return;
      const card = cardInfo(o.characterId);
      search.value = card.known ? card.name : (o.user && o.user.pseudo) || '';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      search.dispatchEvent(new Event('change', { bubbles: true }));
      let tries = 0;
      const reveal = () => {
        const li = document.getElementById('offre-' + o.id);
        if (li) {
          li.scrollIntoView({ behavior: 'smooth', block: 'center' });
          li.classList.add('kp-flash');
          setTimeout(() => li.classList.remove('kp-flash'), 2500);
        } else if (++tries < 20) setTimeout(reveal, 150);
        else search.scrollIntoView({ behavior: 'smooth', block: 'center' });
      };
      setTimeout(reveal, 150);
    },
  });

  /** Collection : verrouiller / déverrouiller chaque carte sur place (sans ouvrir sa page wiki). */
  const collectionLocks = defineFeature({
    name: 'collectionLocks',
    label: 'Verrou 🔒 depuis la collection',
    match: (p) => SITE.collectionPage.test(p),
    busy: new Set(),
    /** Map<cardId, locked> confirmé par le serveur après nos clics (l’icône du site ne se met à jour qu’au rechargement). */
    confirmed: new Map(),
    queue: Promise.resolve(), // un verrouillage à la fois (l’iframe du site est lourde)

    run() {
      for (const slot of document.querySelectorAll(SITE.collectionSlot)) {
        const cell = slot.parentElement;
        const bar = cell.querySelector(`:scope > ${SITE.collectionBar}`);
        const id = wikiId(slot.getAttribute('href'));
        if (!id || !bar) continue; // carte manquante : rien à verrouiller
        const locked = this.isLocked(id, slot);
        this.renderIcon(slot, locked);
        this.renderControl(bar, id, locked);
      }
    },

    renderIcon(slot, locked) {
      const siteIcon = slot.querySelector(SITE.collectionLockIcon);
      if (siteIcon) setAttr(siteIcon, 'data-kp-hidden', '');
      const icon = slot.querySelector(':scope > .kp-lock-icon');
      if (locked && !icon) slot.appendChild(el('span', { class: 'kp-lock-icon', text: '🔒', title: 'Verrouillée' }));
      else if (!locked && icon) icon.remove();
    },

    /** Petit bouton 🔒 dans la barre de la carte (.mk), à côté de l’élément du site (laissé tel quel). */
    renderControl(bar, id, locked) {
      const busy = this.busy.has(id);
      let control = bar.querySelector(':scope > [data-kp-control]');
      if (!control) bar.appendChild(control = el('button', { type: 'button', class: 'kp-lock-mini', 'data-kp-control': '', onClick: () => this.toggle(id) }));
      setAttr(control, 'data-kp-busy', busy ? '' : null);
      setAttr(control, 'aria-pressed', String(locked));
      setAttr(control, 'aria-label', locked ? 'Déverrouiller cette carte' : 'Verrouiller cette carte');
      setText(control, busy ? '…' : '🔒');
      setAttr(control, 'title', locked
        ? 'Carte verrouillée : clique pour la déverrouiller'
        : 'Verrouiller cette carte : elle ne pourra plus être vendue, échangée ni recyclée');
    },

    /** Vérité : ce que le serveur a confirmé après notre dernier clic, sinon l’icône 🔒 du site (le champ `locked` n’est pas fiable). */
    isLocked(id, slot) {
      if (this.confirmed.has(id)) return this.confirmed.get(id);
      return !!(slot && slot.querySelector(SITE.collectionLockIcon));
    },

    toggle(id) {
      if (this.busy.has(id)) return;
      this.busy.add(id);
      scheduleRender();
      this.queue = this.queue.then(() => this.applyToggle(id));
    },

    async applyToggle(id) {
      const slot = document.querySelector(`${SITE.collectionSlot}[href$="/wiki/${id}"]`);
      const locked = this.isLocked(id, slot);
      try {
        await setCardLock(id, !locked);
        this.confirmed.set(id, !locked);
        load.collection(); // met à jour les compteurs, en arrière-plan
      } catch (err) {
        log.warn('verrouillage impossible', err);
        toast(`Kyara Plus : impossible de ${locked ? 'déverrouiller' : 'verrouiller'} la carte (${err.message}).`);
      } finally {
        this.busy.delete(id);
        scheduleRender();
      }
    },

    /** Verrouille une liste de cartes, une par une (état explicite : sans danger si déjà verrouillées). */
    async lockMany(ids, onProgress) {
      let done = 0, failed = 0;
      for (const id of ids) {
        try { await setCardLock(id, true); this.confirmed.set(String(id), true); } catch (err) { failed++; log.warn('verrouillage en masse', id, err); }
        onProgress?.(++done, ids.length, failed);
        await sleep(NET.spacing);
      }
      scheduleRender();
      return { done, failed };
    },

    teardown() {
      document.querySelectorAll('.kp-lock-icon, [data-kp-control]').forEach((n) => n.remove());
      document.querySelectorAll(`${SITE.collectionSlot} ${SITE.collectionLockIcon}[data-kp-hidden]`).forEach((n) => n.removeAttribute('data-kp-hidden'));
    },
  });

  /**
   * Profil › fenêtre d’échange, onglet « Cartes de <pseudo> » : pastille « Ses doubles ».
   * La grille du site ne montre que 60 cartes : quand la pastille est active, on la remplace par la nôtre, qui liste toutes
   * les cartes que le joueur peut échanger en 2+ exemplaires (n > 1 dans /api/trades/available/<id>). Un clic sur l’une des
   * nôtres tape son nom dans la recherche du site et clique la vraie tuile. En mémoire seulement : désactivée à la fermeture.
   */
  defineFeature({
    name: 'partnerDuplicates',
    label: 'Fenêtre d’échange : « Ses doubles »',
    match: (p) => SITE.profilePage.test(p),
    on: false,
    busy: false,
    adding: null, // id de la carte en cours d’ajout via la recherche du site
    userId: null,

    run() {
      const shelf = document.querySelector(SITE.tradeShelf);
      const profile = SITE.profilePage.exec(location.pathname);
      if (!shelf || !profile) { this.on = false; this.userId = null; return; }
      const userId = profile[1].toLowerCase();
      if (userId !== this.userId) { this.userId = userId; this.on = false; }

      const partnerShown = [...shelf.querySelectorAll(SITE.tradeTab)]
        .some((t) => t.getAttribute('aria-selected') === 'true' && SITE.partnerTab.test(t.textContent));
      const chips = shelf.querySelector(SITE.tradeChips);
      let chip = shelf.querySelector('[data-kp-dupes]');
      if (!partnerShown || !chips) {
        if (chip) chip.remove();
        return this.renderGrid(shelf, null);
      }

      const siteChips = [...chips.querySelectorAll(SITE.tradeChip)].filter((c) => !c.hasAttribute('data-kp-dupes'));
      if (!chip) {
        chip = el('button', {
          type: 'button', 'data-kp-dupes': '',
          title: 'N’afficher que les cartes qu’il peut échanger en au moins 2 exemplaires',
          onClick: () => this.toggle(),
        }, 'Ses doubles', el('span', { class: 'kp-n' }));
        if (siteChips.length) siteChips[siteChips.length - 1].after(chip);
        else chips.prepend(chip);
      }
      const base = siteChips.length ? siteClasses(siteChips[0]) : '';
      setAttr(chip, 'class', (base + (this.on ? ' on' : '')).trim());
      setAttr(chip, 'aria-pressed', String(this.on));
      setAttr(chip, 'data-kp-busy', this.busy ? '' : null);

      const cards = store.get('tradeAvailable').get(userId);
      const count = cards ? [...cards.values()].filter((n) => n > 1).length : null;
      setText(chip.querySelector('.kp-n'), count === null ? '' : String(count));
      this.renderGrid(shelf, this.on && cards ? cards : null);
    },

    tileId(tile) {
      const img = tile.querySelector('img');
      return img && (SITE.cardImageId.exec(img.getAttribute('src') || '') || [])[1];
    },

    /** Les filtres du site, appliqués aussi à notre grille : « Je l’ai », « Il me manque », chips de rareté. */
    siteFilters(shelf) {
      const chips = shelf.querySelector(SITE.tradeChips);
      const pressed = (re) => !!chips && [...chips.querySelectorAll(SITE.tradeChip)]
        .some((c) => !c.hasAttribute('data-kp-dupes') && c.getAttribute('aria-pressed') === 'true' && re.test(c.textContent));
      const rarities = chips ? [...chips.querySelectorAll(SITE.tradeRarityChip)]
        .filter((b) => b.classList.contains('on')).map((b) => rarityOf(b.textContent.trim())).filter(Boolean) : [];
      return { owned: pressed(SITE.tradeChipOwned), missing: pressed(SITE.tradeChipMissing), rarities };
    },

    /** Notre grille de doubles à la place de celle du site (cards = null : retour à la grille du site). */
    renderGrid(shelf, cards) {
      const siteGrid = shelf.querySelector(SITE.tradeGrid);
      let grid = shelf.querySelector('[data-kp-grid]');
      if (siteGrid) setAttr(siteGrid, 'data-kp-hidden', cards ? '' : null);
      if (!cards) { if (grid) grid.remove(); return; }

      // Pendant un ajout, la recherche contient le nom de la carte : on garde la requête de l’utilisateur
      const search = shelf.querySelector(SITE.tradeSearch);
      const query = this.adding ? (grid && grid.dataset.kpQuery) || '' : ((search && search.value) || '').trim().toLowerCase();
      const filters = this.siteFilters(shelf);
      const known = !!store.get('collection'); // sans ma collection, « Je l’ai » / « Il me manque » ne peuvent pas s’appliquer
      const dupes = [...cards].filter(([, n]) => n > 1);
      load.prices(dupes.map(([id]) => id)); // une fois par carte ; re-rendu à l’arrivée
      const prices = store.get('prices');
      const list = dupes
        .map(([id, n]) => ({ id, n, owned: ownedQty(id) > 0, price: prices.has(id) ? priceText(prices.get(id)) : null, ...cardInfo(id) }))
        .filter((c) => !query || c.name.toLowerCase().includes(query))
        .filter((c) => !known || ((!filters.owned || c.owned) && (!filters.missing || !c.owned)))
        .filter((c) => !filters.rarities.length || filters.rarities.includes(c.rarity))
        .sort((a, b) => rarityRank(b.rarity) - rarityRank(a.rarity) || a.name.localeCompare(b.name));
      const filtered = !!(query || filters.owned || filters.missing || filters.rarities.length);

      if (!grid) {
        grid = el('ul', { 'data-kp-grid': '' });
        const bar = shelf.querySelector(SITE.offerFilters);
        if (siteGrid) siteGrid.after(grid);
        else if (bar) bar.after(grid);
        else shelf.appendChild(grid);
      }
      setAttr(grid, 'class', siteGrid ? siteGrid.className : 'grid');

      const signature = [list.map((c) => `${c.id}:${c.n}:${known && c.owned}:${c.price || ''}`).join(','), store.ver('catalog'), query, filtered, this.adding].join('@');
      if (grid.dataset.kpSignature === signature) return;
      grid.dataset.kpSignature = signature;
      grid.dataset.kpQuery = query;

      // Même balisage et mêmes classes que les tuiles du site : img, .r, .nm, .lack, .pr, .have
      const cls = (sel, fallback) => (siteGrid && siteGrid.querySelector(`${SITE.tradeTile} ${sel}`)?.className) || fallback;
      const tileClass = (siteGrid && siteGrid.querySelector(SITE.tradeTile)?.className) || 'tile';
      grid.replaceChildren(...(list.length ? list.map((c) => el('li', { '--rc': rarityColor(c.rarity) },
        el('button', {
          type: 'button',
          class: tileClass + (this.adding === c.id ? ' kp-adding' : ''),
          'aria-label': `Ajouter ${c.name}`,
          title: c.known ? `Ajouter ${c.name}` : 'Nom inconnu : catalogue des cartes non chargé',
          onClick: () => this.add(shelf, c),
        },
        el('img', { alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', class: cls('img', ''), src: cardImage(c.id) }),
        c.rarity && el('span', { class: cls('.r', 'r'), text: c.rarity.code }),
        el('span', { class: cls('.nm', 'nm'), text: c.name }),
        known && !c.owned && el('span', { class: cls('.lack', 'lack'), text: 'Il me manque' }),
        c.price && el('span', { class: cls(SITE.tradeTilePrice, 'pr mono'), text: c.price }),
        el('span', { class: cls('.have', 'have'), text: `×${c.n} dispo` }))))
        : [el('li', { class: 'kp-trade-empty', text: filtered ? 'Aucun double ne correspond à tes filtres.' : 'Aucune carte en double à échanger.' })]));
    },

    /** Ajoute une carte à « Tu reçois » : on la fait venir dans la grille du site par sa recherche, puis on clique sa tuile. */
    async add(shelf, card) {
      if (this.adding) return;
      if (!card.known) return toast('Kyara Plus : nom de la carte inconnu (catalogue non chargé), impossible de la chercher.');
      const search = shelf.querySelector(SITE.tradeSearch);
      if (!search) return;
      const previous = search.value;
      const setSearch = (value) => { search.value = value; search.dispatchEvent(new Event('input', { bubbles: true })); };
      this.adding = card.id;
      scheduleRender();
      try {
        setSearch(card.name);
        const tile = await waitFor(() => [...shelf.querySelectorAll(`${SITE.tradeGrid} ${SITE.tradeTile}`)].find((t) => this.tileId(t) === card.id), 3000);
        tile.click();
      } catch {
        log.warn('carte introuvable dans la liste du site :', card.name);
        toast(`Kyara Plus : « ${card.name} » n’apparaît pas dans la liste du site (un de ses filtres la cache peut-être).`);
      } finally {
        setSearch(previous);
        this.adding = null;
        scheduleRender();
      }
    },

    toggle() {
      this.on = !this.on;
      const userId = this.userId;
      if (this.on && !this.busy && userId && (!store.get('tradeAvailable').has(userId) || !store.get('catalog').size || !store.get('collection'))) {
        this.busy = true;
        Promise.all([
          store.get('tradeAvailable').has(userId) ? true : load.tradeAvailable(userId),
          load.catalog(),
          store.get('collection') ? true : load.collection(), // pour « Il me manque » / « Je l’ai »
        ]).then(([cards, catalog, collection]) => {
          if (!cards) log.warn('impossible de charger les cartes échangeables du joueur');
          if (!catalog) log.warn('impossible de charger le catalogue des cartes');
          if (!collection) log.warn('impossible de charger ta collection');
        }).finally(() => { this.busy = false; scheduleRender(); });
      }
      scheduleRender();
    },

    teardown() {
      this.on = false;
      this.userId = null;
      document.querySelectorAll('[data-kp-dupes], [data-kp-grid]').forEach((n) => n.remove());
      document.querySelectorAll(`${SITE.tradeGrid}[data-kp-hidden]`).forEach((n) => n.removeAttribute('data-kp-hidden'));
    },
  });

  /** Lit un bouton d’album : { name, owned, total, rarities: { c: { owned, total }, … } } (mis en cache tant que son texte ne change pas). */
  const albumCache = new WeakMap();
  function readAlbum(button) {
    const meta = button.querySelector(SITE.albumMeta)?.textContent || '';
    const cached = albumCache.get(button);
    if (cached && cached.meta === meta) return cached;
    const [, owned = 0, total = 0] = /(\d[\d\s]*)\s*\/\s*(\d[\d\s]*)/.exec(meta) || [];
    const rarities = {};
    for (const span of button.querySelectorAll(SITE.albumRarities)) {
      const m = /([CURELM])\s*(\d+)\s*\/\s*(\d+)/.exec(span.textContent);
      if (m) rarities[m[1].toLowerCase()] = { owned: +m[2], total: +m[3] };
    }
    const album = {
      meta,
      name: (button.querySelector(SITE.albumName)?.textContent || '').trim(),
      owned: +String(owned).replace(/\s/g, ''),
      total: +String(total).replace(/\s/g, ''),
      rarities,
    };
    albumCache.set(button, album);
    return album;
  }

  const moreAlbumsButton = () => [...document.querySelectorAll(SITE.albumMore)].find((b) => SITE.showMore.test(b.textContent));

  /**
   * Collection › Albums : taille minimale, « il me manque ≤ N cartes » (albums presque complets) et « il ne me manque que »
   * certaines raretés. Le site affiche 120 albums par page : tant qu’un filtre est actif, on clique « Afficher plus »
   * jusqu’à tout charger (abandon si le chargement ne progresse plus). En mémoire seulement.
   */
  defineFeature({
    name: 'albumFilters',
    label: 'Filtres d’albums (taille, presque complets, raretés)',
    match: (p) => SITE.collectionPage.test(p),
    lastMoreClick: 0,
    lastLoaded: -1,
    stall: 0,
    current: { min: 0, max: 0, miss: [] },

    save(patch) { this.current = { ...this.current, ...patch }; this.stall = 0; scheduleRender(); },
    reset() { this.current = { min: 0, max: 0, miss: [] }; this.stall = 0; },
    isActive(s) { return s.min > 0 || s.max > 0 || s.miss.length > 0; },

    /**
     * Avec des raretés cochées, un album correspond quand les seules cartes qui lui manquent sont de ces raretés.
     * Avec « il me manque ≤ N », il doit lui manquer entre 1 et N cartes (un album complet ne manque de rien).
     */
    matches(album, s) {
      if (album.total < s.min) return false;
      if (s.max > 0) { const missingCount = album.total - album.owned; if (missingCount < 1 || missingCount > s.max) return false; }
      if (!s.miss.length) return true;
      const missing = Object.keys(album.rarities).filter((letter) => album.rarities[letter].owned < album.rarities[letter].total);
      return missing.length > 0 && missing.every((letter) => s.miss.includes(letter));
    },

    run() {
      const list = document.querySelector(SITE.albumList);
      if (!list) return;
      const s = this.current;
      const panel = this.renderPanel(s);

      let shown = 0, loaded = 0;
      for (const button of list.querySelectorAll(SITE.album)) {
        const item = button.closest('li') || button;
        const visible = !this.isActive(s) || this.matches(readAlbum(button), s);
        setAttr(item, 'data-kp-hidden', visible ? null : '');
        loaded++;
        if (visible) shown++;
      }

      // Charger toutes les pages pendant un filtre, sinon il ne voit que les 120 premiers albums
      const more = moreAlbumsButton();
      const loading = this.isActive(s) && !!more && this.stall < 12;
      if (loading) {
        if (Date.now() - this.lastMoreClick > TIMING.moreGap) {
          this.stall = loaded === this.lastLoaded ? this.stall + 1 : 0;
          this.lastLoaded = loaded;
          this.lastMoreClick = Date.now();
          more.click();
        }
        setTimeout(scheduleRender, 450); // on continue même si la page ne change pas entre-temps
      }
      if (panel) {
        const stalled = this.isActive(s) && !!more && !loading;
        setText(panel.querySelector('.kp-af-count'), this.isActive(s)
          ? `${plural(shown, 'album')} sur ${loaded}${loading ? ' · chargement…' : stalled ? ' · chargement interrompu' : ''}`
          : `${plural(loaded, 'album')} chargés`);
      }
    },

    renderPanel(s) {
      const tools = document.querySelector(SITE.albumTools);
      if (!tools) return null;
      let panel = tools.querySelector(':scope > .kp-album-filters');
      if (!panel) {
        const rarityChips = RARITIES.map((rarity) => el('label', {
          class: 'kp-af-rar', '--kp-rc': rgbCss(rarity),
          title: `${rarity.name} : n’afficher que les albums où il ne te manque que les raretés cochées`,
        }, el('input', { type: 'checkbox', value: rarity.code.toLowerCase(), onChange: () => this.saveFromPanel(panel) }), rarity.code));
        panel = el('div', { class: 'kp-album-filters' },
          el('label', { class: 'kp-af-group' },
            el('span', { class: 'kp-af-label', text: 'Min. cartes dans l’album' }),
            el('input', { class: 'kp-af-input', type: 'number', min: '0', step: '1', name: 'min', onInput: () => this.saveFromPanel(panel) })),
          el('label', { class: 'kp-af-group' },
            el('span', { class: 'kp-af-label', text: 'Il me manque ≤' }),
            el('input', { class: 'kp-af-input', type: 'number', min: '0', step: '1', name: 'max', title: 'Albums presque complets : il te manque entre 1 et N cartes', onInput: () => this.saveFromPanel(panel) })),
          el('span', { class: 'kp-af-group' }, el('span', { class: 'kp-af-label', text: 'Il ne me manque que' }), rarityChips),
          el('button', { type: 'button', class: 'kp-af-reset', text: 'Réinitialiser', onClick: () => { this.reset(); this.syncPanel(panel, this.current); scheduleRender(); } }),
          el('span', { class: 'kp-af-count' }));
        tools.appendChild(panel);
        this.syncPanel(panel, s);
      }
      return panel;
    },

    /** Champs du panneau ← réglages (seulement s’ils diffèrent, pour garder le curseur pendant la saisie). */
    syncPanel(panel, s) {
      for (const name of ['min', 'max']) {
        const input = panel.querySelector(`input[name="${name}"]`);
        if (+input.value !== s[name] || (s[name] === 0 && input.value !== '')) input.value = s[name] ? String(s[name]) : '';
      }
      for (const box of panel.querySelectorAll('input[type="checkbox"]')) box.checked = s.miss.includes(box.value);
    },

    saveFromPanel(panel) {
      this.save({
        min: Math.max(0, parseInt(panel.querySelector('input[name="min"]').value, 10) || 0),
        max: Math.max(0, parseInt(panel.querySelector('input[name="max"]').value, 10) || 0),
        miss: [...panel.querySelectorAll('input[type="checkbox"]:checked')].map((b) => b.value),
      });
    },

    teardown() {
      document.querySelectorAll('.kp-album-filters').forEach((n) => n.remove());
      document.querySelectorAll(`${SITE.albumList} [data-kp-hidden]`).forEach((n) => n.removeAttribute('data-kp-hidden'));
    },
  });

  /**
   * Un album s’ouvre dans un nouvel onglet au clic molette (ou Ctrl/Cmd + clic). Les albums sont des boutons, pas des liens :
   * le nouvel onglet reçoit /collection#kp-album=<nom>, y bascule sur la vue Albums, charge des pages jusqu’à le trouver et le clique.
   */
  const albumTabs = defineFeature({
    name: 'albumTabs',
    label: 'Albums : ouverture dans un nouvel onglet',
    match: (p) => SITE.collectionPage.test(p),
    pending: null, // { name, since }
    lastMoreClick: 0,

    /** Installé une fois (voir startUi). */
    install() {
      const enabled = () => getSettings().features.albumTabs !== false;
      const albumOf = (e) => (e.target.closest ? e.target.closest(SITE.album) : null);
      const open = (button) => {
        const { name } = readAlbum(button);
        if (name) window.open(`/collection#${ALBUM_HASH}${encodeURIComponent(name)}`, '_blank');
      };
      document.addEventListener('mousedown', (e) => { if (enabled() && e.button === 1 && albumOf(e)) e.preventDefault(); }, true); // pas d’autoscroll
      document.addEventListener('auxclick', (e) => {
        const button = enabled() && e.button === 1 && albumOf(e);
        if (!button) return;
        e.preventDefault();
        open(button);
      }, true);
      document.addEventListener('click', (e) => {
        const button = enabled() && (e.ctrlKey || e.metaKey) && albumOf(e);
        if (!button) return;
        e.preventDefault();
        e.stopPropagation(); // cet onglet reste comme il est
        open(button);
      }, true);
    },

    run() {
      if (!this.pending && location.hash.startsWith('#' + ALBUM_HASH)) {
        let name = location.hash.slice(1 + ALBUM_HASH.length);
        try { name = decodeURIComponent(name); } catch { /* hash mal formé : on garde le texte brut */ }
        this.pending = { name, since: Date.now() };
      }
      if (!this.pending) return;
      if (Date.now() - this.pending.since > 30000) { log.warn('album introuvable :', this.pending.name); this.pending = null; return; }

      const list = document.querySelector(SITE.albumList);
      if (!list) { // bascule sur la vue Albums
        const albumsView = [...document.querySelectorAll(SITE.viewButtons)].find((b) => /^\s*albums\s*$/i.test(b.textContent));
        if (albumsView && albumsView.getAttribute('aria-pressed') !== 'true') albumsView.click();
        return this.retry();
      }
      const target = [...list.querySelectorAll(SITE.album)].find((b) => readAlbum(b).name === this.pending.name);
      if (target) {
        this.pending = null;
        history.replaceState(history.state, '', location.pathname + location.search); // retire le hash
        target.click();
        return;
      }
      const more = moreAlbumsButton();
      if (more && Date.now() - this.lastMoreClick > TIMING.moreGap) { this.lastMoreClick = Date.now(); more.click(); }
      this.retry();
    },

    /** La page peut ne pas changer pendant qu’on attend : on réessaie un peu plus tard. */
    retry() { setTimeout(scheduleRender, 300); },
  });

  /* ==========================================================================
   * 12. NOUVELLES OFFRES — repérées par différence avec la dernière visite
   * ======================================================================== */

  let notifyNext = false; // vrai seulement pendant une actualisation automatique (sinon l’utilisateur regarde déjà la page)

  function trackOffers() {
    if (!opt('newOffers')) return;
    const offers = store.get('serverOffers');
    const { fresh, seen } = diffOffers(storage.get(KEY.seenOffers, null, Array.isArray), offers.map((o) => String(o.id)));
    storage.set(KEY.seenOffers, seen);
    if (!fresh.length) return;
    store.set('newOffers', new Set([...store.get('newOffers'), ...fresh]));
    const wished = offers.filter((o) => fresh.includes(String(o.id)) && inWishlist(o.characterId));
    if (notifyNext && opt('notify') && wished.length && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try { new Notification('Kyara+', { body: `${plural(wished.length, 'nouvelle offre')} de ta wishlist : ${wished.slice(0, 3).map((o) => cardInfo(o.characterId).name).join(', ')}` }); } catch { /* non supporté */ }
    }
  }
  store.subscribe((key) => { if (key === 'serverOffers') trackOffers(); });

  /** Compteur dans le titre de l’onglet : « (♥2) » = 2 nouvelles offres de ta wishlist, « (5) » = 5 nouvelles offres. */
  defineFeature({
    name: 'titleBadge',
    label: 'Compteur « nouvelles offres » dans l’onglet',
    match: () => true,
    run() {
      const base = document.title.replace(/^\((?:♥\d+|\d+)\) /, '');
      let n = 0, w = 0;
      if (opt('newOffers')) {
        const fresh = store.get('newOffers');
        for (const o of store.get('serverOffers')) if (fresh.has(String(o.id))) { n++; if (inWishlist(o.characterId)) w++; }
      }
      const want = n ? `(${w ? '♥' + w : n}) ${base}` : base;
      if (document.title !== want) document.title = want;
    },
    teardown() { document.title = document.title.replace(/^\((?:♥\d+|\d+)\) /, ''); },
  });

  /** Actualisation automatique des données d’offres (onglet visible, page Marché) : offres cachées + repérage des nouvelles. */
  let lastAutoRefresh = Date.now();
  defineJob(async () => {
    if (!opt('autoRefreshOffers') || document.hidden || !SITE.marketPage.test(location.pathname)) return;
    if (Date.now() - lastAutoRefresh < getSettings().refreshMinutes * 60000) return;
    lastAutoRefresh = Date.now();
    notifyNext = true;
    try { await load.offers(); } finally { notifyNext = false; }
  });

  /** Wishlist, collection et catalogue : chargés au démarrage si la page ne l’a pas fait (la wishlist n’était lue que sur sa page). */
  defineJob(() => {
    if (!net.hasHeaders()) return;
    if (!store.get('collection')) ensure('collection', load.collection);
    if (!store.get('catalog').size) ensure('catalog', load.catalog);
    if (!store.ver('wishlist')) ensure('wishlist', load.wishlist);
  });

  /* ==========================================================================
   * 13. OUTILS — message d’échange, statistiques, verrouillage en masse
   * ======================================================================== */

  /** Message prêt à coller (Discord) : mes doubles cédables par rareté, et ma wishlist non possédée. */
  function buildTradeMessage({ collection, catalog, wishlist, free = freeCopies } = {}) {
    collection = collection ?? store.get('collection');
    catalog = catalog ?? store.get('catalog');
    wishlist = wishlist ?? store.get('wishlist');
    const group = (items) => {
      const byRarity = new Map();
      for (const it of items) { const k = rarityRank(it.rarity); byRarity.set(k, [...(byRarity.get(k) ?? []), it]); }
      return [...byRarity.entries()].sort((a, b) => b[0] - a[0])
        .map(([k, list]) => `• ${k >= 0 ? RARITIES[k].name : 'Rareté inconnue'} : ${list.sort((a, b) => a.name.localeCompare(b.name)).map((i) => (i.n > 1 ? `${i.name} ×${i.n}` : i.name)).join(', ')}`);
    };
    const info = (id) => ({ name: catalog.get(id)?.name || `Carte #${id}`, rarity: catalog.get(id)?.rarity ?? null });
    const spare = [...collection].map(([id, c]) => ({ ...info(id), n: Math.min(c.qty - 1, free(id)) })).filter((x) => x.n > 0);
    const wanted = [...wishlist].filter((id) => !collection.has(id)).map((id) => ({ ...info(id), n: 1 }));
    const lines = [];
    if (spare.length) lines.push(`**Je donne** (doubles) :`, ...group(spare));
    if (wanted.length) lines.push(`**Je cherche** (wishlist) :`, ...group(wanted));
    let text = lines.join('\n');
    if (text.length > 1900) text = text.slice(0, text.lastIndexOf('\n', 1850)) + '\n…(liste tronquée)';
    return text;
  }

  /** Statistiques de collection (à la demande : les prix de toute la collection demandent plusieurs requêtes). */
  async function computeStats(onProgress) {
    await Promise.all([store.get('collection') ? true : load.collection(), store.get('catalog').size ? true : load.catalog()]);
    const col = store.get('collection');
    const cat = store.get('catalog');
    if (!col) throw new Error('collection indisponible');
    const byRarity = RARITIES.map((r) => ({ r, owned: 0, total: 0 }));
    for (const info of cat.values()) if (info.rarity) byRarity[rarityRank(info.rarity)].total++;
    let total = 0, doubles = 0;
    for (const [id, c] of col) {
      total += c.qty;
      if (c.qty > 1) doubles += c.qty - 1;
      const r = cat.get(id)?.rarity;
      if (r) byRarity[rarityRank(r)].owned++;
    }
    await load.prices([...col.keys()], onProgress);
    const prices = store.get('prices');
    let value = 0, unpriced = 0;
    for (const [id, c] of col) { if (prices.has(id)) value += prices.get(id) * c.qty; else unpriced++; }
    return { distinct: col.size, total, doubles, byRarity, value, unpriced };
  }

  function formatStats(s) {
    const pct = (a, b) => (b ? ` (${Math.round((a / b) * 100)} %)` : '');
    return [
      `${plural(s.distinct, 'carte')} différentes · ${s.total} exemplaires · ${plural(s.doubles, 'double')}`,
      ...s.byRarity.filter((x) => x.total).map((x) => `${x.r.name} : ${x.owned}/${x.total}${pct(x.owned, x.total)}`),
      `Valeur estimée : ${priceText(s.value)}${s.unpriced ? ` (${s.unpriced} sans prix)` : ''}`,
    ].join('\n');
  }

  /* ==========================================================================
   * 14. BOOSTERS — moteur testé, commandes du site et historique local
   * ======================================================================== */

  const BOOSTER_TYPES = BoosterCore.TYPES;
  const BOOSTER_LABELS = { all: 'Shōnen Mix', shonen: 'Shōnen', isekai: 'Isekai', seinen: 'Seinen', shojo: 'Shōjo', sport: 'Sport', mecha: 'Mecha', waifu: 'Waifu', husbando: 'Husbando' };
  const BOOSTER_ALARM_CHANNEL = 'kyara-plus:booster-alarm';
  const boosterPath = BoosterCore.routeFor;
  const onBoosterPage = (type) => location.pathname.replace(/\/$/, '') === boosterPath(type);
  const resetOpenButton = (button) => /^\s*Ouvrir\s+(?:un\s+autre|encore)\b/i.test(button?.textContent || '');
  const siteButtons = () => [...document.querySelectorAll('button')].filter((n) => !n.closest('#kp-panel') && n.getClientRects().length);
  const siteOpenButton = () => siteButtons().find((button) => !button.disabled && /^\s*Ouvrir/i.test(button.textContent)) ?? null;
  const revealButton = () => siteButtons().find((button) => !button.disabled && /^tout révéler$/i.test(button.textContent.trim())) ?? null;

  /** Réagit aux mutations même si requestAnimationFrame et les timers sont ralentis. */
  function waitForBooster(fn, timeout) {
    return new Promise((resolve, reject) => {
      let finished = false;
      const cleanup = () => {
        observer.disconnect(); clearTimeout(timer);
        for (const type of ['message', 'storage', 'popstate', 'kyara-plus:booster-state']) window.removeEventListener(type, check);
      };
      const check = () => {
        if (finished) return;
        let value;
        try { value = fn(); } catch { return; }
        if (value) { finished = true; cleanup(); resolve(value); }
      };
      const observer = new MutationObserver(check);
      observer.observe(document, { childList: true, subtree: true, attributes: true, characterData: true });
      const timer = setTimeout(() => { check(); if (!finished) { finished = true; cleanup(); reject(new Error('délai dépassé')); } }, document.hidden ? Math.max(timeout, 180000) : timeout);
      for (const type of ['message', 'storage', 'popstate', 'kyara-plus:booster-state']) window.addEventListener(type, check);
      check();
    });
  }

  async function prepareBoosterAnimation(active) {
    const options = siteButtons().find((button) => button.getAttribute('aria-label') === 'Options d’ouverture');
    if (!options) throw new Error('Options d’ouverture introuvables : animations non confirmées');
    // Les éléments titre/description du site se suivent sans espace dans textContent.
    const animation = () => [...document.querySelectorAll('input[type="checkbox"]')].find((input) => /^Animations/i.test(input.closest('label')?.textContent.trim() || input.getAttribute('aria-label') || ''));
    if (!animation()) options.click();
    await waitForBooster(() => !active() || animation(), 5000);
    if (!active()) return;
    if (animation().checked) animation().click();
    await waitForBooster(() => !active() || animation()?.checked === false, 5000);
    if (options.getAttribute('aria-expanded') === 'true') options.click();
  }

  function freeBoosterIndicator() {
    const nodes = [...document.querySelectorAll('a.pill[href="#boosters"]'), ...document.querySelectorAll('[aria-label]')];
    for (const node of nodes) {
      if (node.closest('#kp-panel')) continue;
      const stock = BoosterCore.parseFreeStock(`${node.getAttribute('aria-label') || ''} ${node.matches('a.pill') ? node.textContent : ''}`);
      if (stock) return { ...stock, node };
    }
    return null;
  }
  const liveFreeBoosterCount = () => freeBoosterIndicator()?.count ?? null;

  function requestBoosterWake(when) {
    if (!IN_FRAME) window.postMessage({ channel: BOOSTER_ALARM_CHANNEL, type: Number.isFinite(when) ? 'schedule' : 'cancel', when }, location.origin);
  }

  function readFreeBoosterCount() {
    const indicator = freeBoosterIndicator();
    if (!indicator) {
      const cached = storage.get(KEY.boosterCount, null, (v) => isObj(v) && Number.isFinite(v.count) && Number.isFinite(v.seenAt));
      return cached ? { ...cached, seconds: Number.isFinite(cached.seconds) ? Math.max(0, cached.seconds - Math.floor((Date.now() - cached.seenAt) / 1000)) : null, estimated: true } : null;
    }
    const source = `${indicator.node.getAttribute('title') || ''} ${indicator.node.textContent || ''}`;
    const match = /(\d{1,2}:\d{2}(?::\d{2})?)/.exec(source);
    const parts = match ? match[1].split(':').map(Number) : null;
    const seconds = parts ? parts.reduce((total, part) => total * 60 + part, 0) : null;
    const seenAt = Date.now();
    const previous = storage.get(KEY.boosterCount, null, isObj);
    // Tant que le stock reste identique, un compteur figé ne repousse pas l'échéance.
    const measuredRefill = seconds === null ? null : seenAt + seconds * 1000;
    const previousRefill = previous?.count === indicator.count && Number.isFinite(previous.refillAt) ? previous.refillAt : null;
    const refillAt = measuredRefill === null ? previousRefill
      : previousRefill !== null ? Math.min(previousRefill, measuredRefill) : measuredRefill;
    const value = { count: indicator.count, max: indicator.max, seconds, seenAt, refillAt };
    storage.set(KEY.boosterCount, value);
    return value;
  }

  function resultCardsFromPage() {
    return [...document.querySelectorAll('button.fan-c')].map((node) => {
      const id = SITE.cardImageId.exec(node.querySelector('img')?.getAttribute('src') || '')?.[1];
      if (!id) return null;
      const label = node.getAttribute('aria-label') || '';
      return {
        id, name: node.querySelector('.tcg-name')?.textContent.trim() || cardInfo(id).name,
        rarity: rarityOf(node.querySelector('.gem')?.textContent)?.code || cardInfo(id).rarity?.code || null,
        wished: inWishlist(id), wishlistKnown: store.get('wishlistKnown'), isNew: /, nouvelle\b/i.test(label),
      };
    }).filter(Boolean);
  }

  function boosterHistory() {
    return storage.get(KEY.boosterHistory, [], Array.isArray).filter((e) => isObj(e) && Number.isFinite(e.at) && Array.isArray(e.cards));
  }
  const historyBoosterCount = (history) => history.reduce((total, entry) => total + (Number.isInteger(entry.quantity) && entry.quantity > 0 ? entry.quantity : 1), 0);
  function rememberBoosterRewards(type, cards, quantity) {
    const history = boosterHistory();
    history.push({ at: Date.now(), type, cards, quantity });
    storage.set(KEY.boosterHistory, history.slice(-500));
    scheduleRender();
  }
  function knownReward(card) {
    const info = cardInfo(card.id);
    return { ...card, name: info.known ? info.name : card.name || info.name, rarity: card.rarity || info.rarity?.code || null, wished: card.wished === true || (card.wishlistKnown !== true && inWishlist(card.id)) };
  }
  function boosterSummary() {
    const history = boosterHistory();
    const cards = history.flatMap((e) => e.cards).map(knownReward);
    return [
      `${historyBoosterCount(history)} booster(s) · ${cards.length} carte(s) reconnue(s)`,
      ...RARITIES.map((r) => `${r.name} : ${cards.filter((c) => c.rarity === r.code).length}`),
      `Wishlist : ${cards.filter((c) => c.wished).length} carte(s)`,
      ...history.slice(-5).reverse().flatMap((e) => e.cards.map(knownReward).map((c) => `${c.wished ? '♥ ' : ''}${c.name} · ${c.rarity || '?'} · ${BOOSTER_LABELS[e.type] || e.type}`)),
    ].join('\n');
  }

  const booster = {
    timer: null,
    generation: 0,
    failures: 0,
    pendingOpen: null,
    nextAt: () => storage.get(KEY.boosterNext, 0, Number.isFinite),
    setStatus(status) { store.set('booster', { ...store.get('booster'), status }); },
    setRunning(running) { store.set('booster', { ...store.get('booster'), running }); },
    schedule(when) {
      const next = Math.max(Date.now() + 1000, when);
      storage.set(KEY.boosterNext, next);
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.tick(), Math.min(2147483647, next - Date.now() + 100));
      requestBoosterWake(next);
      return next;
    },
    stop() {
      this.generation++;
      if (boosterPermit) boosterPermit.cancelled = true;
      clearTimeout(this.timer);
      requestBoosterWake(null);
      this.setStatus('En pause · aucune nouvelle ouverture');
      window.dispatchEvent(new Event('kyara-plus:booster-state'));
    },
    start() {
      this.failures = 0;
      storage.set(KEY.boosterOwner, { id: TAB_ID, until: Date.now() + 120000 });
      updateSettings((d) => { d.booster.enabled = true; });
      storage.set(KEY.boosterNext, Date.now());
      this.tick();
    },
    async tick() {
      if (!getSettings().booster.enabled || IN_FRAME || store.get('booster').running) return;
      const owner = storage.get(KEY.boosterOwner, null, isObj);
      if (owner && owner.id !== TAB_ID && owner.until > Date.now()) {
        this.setStatus('Automatisation pilotée depuis un autre onglet Kyara');
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.tick(), 30000);
        requestBoosterWake(null); // seul l’onglet pilote garde une alarme et la protection du déchargement
        return;
      }
      if (owner?.id === TAB_ID) storage.set(KEY.boosterOwner, { id: TAB_ID, until: Date.now() + 120000 });
      const deadline = this.nextAt();
      if (Date.now() < deadline) { this.schedule(deadline); return; }
      const count = readFreeBoosterCount();
      const target = getSettings().booster.batchSize;
      // L'échéance mémorisée reste valable même si le site ne met plus son DOM à jour.
      if (count && !count.estimated && count.count < target && (count.seconds === 0 || (Number.isFinite(count.refillAt) && count.refillAt <= Date.now()))) {
        const lastRefresh = storage.get(KEY.boosterRefresh, 0, Number.isFinite);
        if (Date.now() - lastRefresh > 60000) {
          storage.set(KEY.boosterRefresh, Date.now());
          this.schedule(Date.now() + 3000);
          location.reload();
          return;
        }
      }
      if (count && !count.estimated && count.count < target) {
        this.setStatus(`En attente du lot · ${count.count}/${target} gratuits · boucle active`);
        this.schedule(BoosterCore.nextWakeAt(count, count.seenAt, target));
        return;
      }
      await this.run({ manual: false });
    },
    async run({ manual = false } = {}) {
      if (IN_FRAME || store.get('booster').running) return;
      if (!navigator.locks) { this.setStatus('Verrou inter-onglets indisponible : ouverture suspendue'); return; }
      const generation = this.generation;
      const cfg = { ...getSettings().booster };
      const active = () => generation === this.generation && cfg.type === getSettings().booster.type && cfg.batchSize === getSettings().booster.batchSize && (manual || (getSettings().booster.enabled && storage.get(KEY.boosterOwner, null, isObj)?.id === TAB_ID));
      this.setRunning(true);
      let result = { opened: 0, reason: '', uncertain: false }, acquired = false;
      try {
        await navigator.locks.request('kyara-plus:free-opening', { ifAvailable: true }, async (lock) => {
          if (!lock) { result.reason = 'Un autre onglet Kyara ouvre les boosters'; return; }
          if (!manual) {
            const owner = storage.get(KEY.boosterOwner, null, isObj);
            if (owner && owner.id !== TAB_ID && owner.until > Date.now()) { result.reason = 'Automatisation pilotée depuis un autre onglet Kyara'; return; }
            storage.set(KEY.boosterOwner, { id: TAB_ID, until: Date.now() + 120000 });
          }
          acquired = true;
          if (!onBoosterPage(cfg.type)) {
            this.setStatus(`Navigation vers ${BOOSTER_LABELS[cfg.type]}…`);
            navigate(boosterPath(cfg.type));
            await waitForBooster(() => !active() || onBoosterPage(cfg.type), 15000);
          }
          if (!active()) return;
          // La wishlist et le catalogue enrichissent le bilan ; ils ne bloquent pas l’ouverture.
          ensure('catalog', load.catalog);
          ensure('wishlist', load.wishlist);
          const ready = async () => {
            await waitForBooster(() => !active() || !onBoosterPage(cfg.type) || siteOpenButton() || revealButton(), 20000);
            if (!active() || !onBoosterPage(cfg.type)) return;
            const reveal = revealButton();
            if (reveal) { reveal.click(); await waitForBooster(() => siteOpenButton() || !active(), 15000); }
          };
          result = await BoosterCore.runBatch({
            active, onRoute: () => onBoosterPage(cfg.type), ready,
            reset: async () => {
              if (!active() || !onBoosterPage(cfg.type)) return;
              const reset = siteOpenButton();
              if (resetOpenButton(reset)) reset.click();
              await waitForBooster(() => {
                const button = siteOpenButton();
                return !active() || (button && !resetOpenButton(button));
              }, 10000);
            },
            stock: liveFreeBoosterCount, button: siteOpenButton,
            quantity: async (quantity) => {
              if (!active() || !onBoosterPage(cfg.type)) return;
              await prepareBoosterAnimation(active);
              if (!active()) return;
              const selector = () => siteButtons().find((n) => n.textContent.trim() === `×${quantity}` && n.hasAttribute('aria-pressed'));
              const choice = selector();
              if (!choice || choice.disabled) throw new Error(`Sélecteur ×${quantity} indisponible`);
              if (choice.getAttribute('aria-pressed') !== 'true') choice.click();
              await waitForBooster(() => selector()?.getAttribute('aria-pressed') === 'true' || !active(), 3000);
            },
            open: (button, quantity) => { boosterPermit = { type: cfg.type, quantity }; const response = this.prepareOpenResponse(); button.click(); return response; },
            confirm: async (before, quantity) => {
              await waitForBooster(() => boosterPermit?.blocked || BoosterCore.consumptionConfirmed(before, liveFreeBoosterCount(), quantity), 120000);
              if (boosterPermit?.blocked) throw new Error(boosterPermit.blocked);
            },
            reveal: async () => {
              await waitForBooster(() => revealButton() || siteOpenButton() || resultCardsFromPage().length, 20000);
              const reveal = revealButton();
              if (reveal) reveal.click();
              await waitForBooster(() => resultCardsFromPage().length || siteOpenButton(), 15000);
            },
            rewards: async (response) => {
              const observed = await Promise.race([response, sleep(2500).then(() => null)]);
              const fromPage = resultCardsFromPage();
              if (fromPage.length >= (observed?.ids?.length || 0)) return fromPage;
              return (observed?.ids || []).map((id) => ({ id, name: cardInfo(id).name, rarity: cardInfo(id).rarity?.code || null, wished: inWishlist(id), wishlistKnown: store.get('wishlistKnown') }));
            },
            record: (cards, quantity) => rememberBoosterRewards(cfg.type, cards, quantity),
            cleanup: () => { this.cancelPendingOpen(); boosterPermit = null; }, status: (text) => this.setStatus(`${BOOSTER_LABELS[cfg.type]} · ${text}`), sleep,
          }, { size: cfg.batchSize, spacingMs: cfg.spacingSec * 1000 });
        });
      } catch (error) { result.reason = error.message || 'Ouverture interrompue'; }
      finally { this.cancelPendingOpen(); this.setRunning(false); }
      const now = Date.now();
      if (result.uncertain) {
        updateSettings((d) => { d.booster.enabled = false; });
        this.stop();
      }
      this.failures = result.opened ? 0 : this.failures + 1;
      if (getSettings().booster.enabled) {
        const count = readFreeBoosterCount();
        const current = getSettings().booster;
        const changed = current.type !== cfg.type || current.batchSize !== cfg.batchSize;
        const wake = changed ? now + 1000 : count && !count.estimated && count.count < current.batchSize
          ? BoosterCore.nextWakeAt(count, now, current.batchSize)
          : result.opened > 0 && count && !count.estimated && count.count >= current.batchSize ? now + current.spacingSec * 1000
          : now + (acquired ? Math.min(300000, 15000 * 2 ** Math.min(this.failures, 4)) : 30000);
        this.schedule(wake);
      }
      storage.set(KEY.boosterLast, { at: now, opened: result.opened, type: cfg.type, reason: result.reason });
      this.setStatus(result.reason || `${plural(result.opened, 'booster')} ${BOOSTER_LABELS[cfg.type]} ouvert${result.opened > 1 ? 's' : ''}`);
      if (result.opened > 0) { toast(`Kyara+ · ${plural(result.opened, 'booster')} ouvert${result.opened > 1 ? 's' : ''}`); load.collection(); }
    },
    prepareOpenResponse() {
      this.cancelPendingOpen();
      return new Promise((resolve) => { this.pendingOpen = { resolve }; });
    },
    cancelPendingOpen() {
      this.pendingOpen?.resolve(null);
      this.pendingOpen = null;
    },
    captureOpenResponse(promise) {
      const pending = this.pendingOpen;
      if (!pending) return;
      this.pendingOpen = null;
      promise.then(async (response) => {
        const text = await response.clone().text().catch(() => '');
        pending.resolve({ ids: response.ok ? BoosterCore.cardIdsInReward(text) : [] });
      }).catch(() => pending.resolve(null));
    },
  };
  defineJob(() => booster.tick());
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== BOOSTER_ALARM_CHANNEL) return;
    if (event.data.type === 'wake') booster.tick();
  });
  window.addEventListener('storage', (event) => {
    if (event.key !== KEY.settings) return;
    const previous = getSettings().booster;
    store.set('settings', normalizeSettings(storage.get(KEY.settings, {}, isObj)));
    const cfg = getSettings().booster;
    if (!cfg.enabled || cfg.type !== previous.type || cfg.batchSize !== previous.batchSize) booster.stop();
    if (cfg.enabled) { storage.set(KEY.boosterNext, Date.now()); booster.tick(); }
  });
  window.addEventListener('online', () => booster.tick());
  window.addEventListener('pagehide', () => {
    if (IN_FRAME) return;
    booster.generation++;
    clearTimeout(booster.timer);
    if (storage.get(KEY.boosterOwner, null, isObj)?.id === TAB_ID) storage.remove(KEY.boosterOwner);
  });
  window.addEventListener('pageshow', (event) => { if (event.persisted && !IN_FRAME) booster.tick(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { scheduleRender(); booster.tick(); } });


  /* ==========================================================================
   * 15. PANNEAU ⚙ — réglages, boosters, outils, diagnostic
   * ======================================================================== */

  let panelOpen = false;
  let panelSig = '';
  let toolOutput = '';
  const dyn = {}; // nœuds mis à jour à chaque rendu sans reconstruire le panneau

  function diagnose() {
    return {
      version: VERSION,
      collection: store.get('collection')?.size ?? null,
      wishlist: store.get('wishlist').size,
      catalog: store.get('catalog').size,
      offers: store.get('serverOffers').length,
      newOffers: store.get('newOffers').size,
      prices: store.get('prices').size,
      features: features.map(({ name, active, disabled, fails }) => ({ name, active, disabled, fails })),
    };
  }
  window.kyaraPlus = { diagnose, version: VERSION };

  function boosterStatusText() {
    const state = store.get('booster');
    const cfg = getSettings().booster;
    const last = storage.get(KEY.boosterLast, null, isObj);
    const lines = [state.running ? state.status : cfg.enabled ? state.status || 'En attente du prochain booster gratuit' : state.status || 'Prêt · active l’automatisation ou lance une ouverture'];
    if (last) lines.push(`Dernier passage à ${clock(last.at)} · ${last.opened || 0} booster(s)`);
    return lines.join('\n');
  }

  let panelView = 'boosters';
  let panelReturnFocus = null;
  function closePanel() {
    panelOpen = false;
    document.getElementById('kp-panel')?.remove();
    document.getElementById('kp-backdrop')?.remove();
    (panelReturnFocus?.isConnected ? panelReturnFocus : document.getElementById('kp-gear'))?.focus();
  }
  function openPanel() {
    panelReturnFocus = document.activeElement;
    panelOpen = true;
    panelSig = '';
    scheduleRender();
  }
  function setAutomatic(enabled) {
    if (enabled) booster.start();
    else { updateSettings((d) => { d.booster.enabled = false; }); booster.stop(); }
  }
  const panelHeading = (eyebrow, title, text) => el('div', {},
    el('div', { class: 'kp-eyebrow', text: eyebrow }), el('h2', { text: title }), el('p', { class: 'kp-lead', text }));
  const panelCard = (title, ...children) => el('section', { class: 'kp-card' }, el('div', { class: 'kp-card-head' }, el('h4', { text: title })), ...children);
  const metric = (label, value, accent = false) => el('div', { class: `kp-metric${accent ? ' kp-accent' : ''}` }, el('b', { text: value }), el('small', { text: label }));

  function buildBoosterDashboard(btn, field) {
    const cfg = getSettings().booster;
    const icons = ['混', '少', '異', '青', '花', '球', '機', '姫', '君'];
    dyn.stock = el('div', { class: 'kp-overview' });
    dyn.booster = el('div', { class: 'kp-status', role: 'status', 'aria-live': 'polite' });
    dyn.auto = btn(cfg.enabled ? 'Mettre en pause' : 'Activer l’automatisation', () => setAutomatic(!getSettings().booster.enabled));
    dyn.auto.classList.add('kp-primary');
    dyn.manual = btn('Ouvrir le lot maintenant', () => { storage.set(KEY.boosterNext, Date.now()); booster.run({ manual: true }); });
    dyn.badge = el('span', { class: 'kp-chip', text: cfg.enabled ? 'ACTIF' : 'EN PAUSE', 'data-active': String(cfg.enabled) });
    const packButtons = BOOSTER_TYPES.map((type, index) => el('button', {
      type: 'button', class: 'kp-pack', 'aria-pressed': String(type === cfg.type), 'aria-label': `Sélectionner ${BOOSTER_LABELS[type]}`,
      onClick: () => {
        if (type === getSettings().booster.type) return;
        booster.stop();
        updateSettings((d) => { d.booster.type = type; });
        if (getSettings().booster.enabled) { storage.set(KEY.boosterNext, Date.now()); booster.tick(); }
      },
    }, el('b', { text: icons[index], 'aria-hidden': 'true' }), BOOSTER_LABELS[type]));
    return [
      panelHeading('Automatisation · 自動', 'Ton lot, en boucle.', 'Choisis le type et la taille du lot. Kyara+ attend le stock complet, ouvre gratuitement, puis attend le lot suivant.'),
      dyn.stock,
      el('section', { class: 'kp-card' },
        el('div', { class: 'kp-card-head' }, el('h4', { text: 'Ouverture automatique' }), dyn.badge),
        el('div', { class: 'kp-btns' }, dyn.auto, dyn.manual), dyn.booster,
        el('p', { class: 'kp-select-label', text: 'TYPE DE BOOSTER' }),
        el('div', { class: 'kp-pack-grid', role: 'group', 'aria-label': 'Type de booster' }, packButtons),
        field('Boosters par lot · seuil à attendre', cfg.batchSize, 1, 10, (v) => { booster.stop(); updateSettings((d) => { d.booster.batchSize = v; }); if (getSettings().booster.enabled) { storage.set(KEY.boosterNext, Date.now()); booster.tick(); } }),
        field('Pause entre actions d’ouverture (s)', cfg.spacingSec, 1, 30, (v) => updateSettings((d) => { d.booster.spacingSec = v; })),
        el('p', { class: 'kp-note', text: 'Exemple : 10 → attendre 10 gratuits, ouvrir ×10, recommencer. 5 → ×5. Les autres lots utilisent ×5 puis ×1. La pause espace les clics successifs si du stock reste disponible ; elle ne sépare pas les boosters d’un clic ×5 ou ×10.' }),
        el('p', { class: 'kp-note', text: 'Zéro dépense : boutons mixtes/payants bloqués et plafond réseau maxChakra = 0 obligatoire. Animations du site désactivées pour fonctionner dans un onglet en arrière-plan. Garde le navigateur ouvert ; veille du PC et suspension Android interrompent les ouvertures.' })),
      panelCard('Ton dernier tirage', dyn.latest = el('div')),
    ];
  }

  function renderHistory(target, entries) {
    target.replaceChildren();
    if (!entries.length) {
      target.appendChild(el('div', { class: 'kp-empty' }, el('b', { text: 'La prochaine carte t’attend.' }), 'Les tirages confirmés apparaîtront ici, avec leur rareté et les favoris obtenus.'));
      return;
    }
    for (const entry of entries) {
      const cards = entry.cards.map(knownReward);
      target.appendChild(el('article', { class: 'kp-history-entry' },
        el('div', { class: 'kp-history-head' }, el('b', { text: `${BOOSTER_LABELS[entry.type] || entry.type} · ×${entry.quantity || 1}` }),
          el('time', { text: new Date(entry.at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }), datetime: new Date(entry.at).toISOString() })),
        cards.length ? el('div', { class: 'kp-loot' }, cards.map((card) => el('a', {
          class: 'kp-loot-card', href: `/wiki/${card.id}`, target: '_blank', rel: 'noopener', title: card.name, '--kp-rc': rarityColor(rarityOf(card.rarity)),
        }, el('img', { src: cardImage(card.id), alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }),
        el('span', { text: card.name }), el('small', { text: `${card.wished ? '♥ Wishlist' : rarityOf(card.rarity)?.name || 'Rareté inconnue'}${card.isNew ? ' · Nouvelle' : ''}` }))))
          : el('p', { class: 'kp-note', text: 'Booster confirmé · détail des cartes indisponible pour ce tirage.' })));
    }
  }
  function buildHistoryView(btn) {
    dyn.historyMetrics = el('div', { class: 'kp-overview' });
    dyn.rarities = el('div', { class: 'kp-rarity-grid' });
    dyn.history = el('div');
    dyn.wishlistNote = el('p', { class: 'kp-note' });
    return [panelHeading('Collection · 記録', 'Chaque tirage compte.', 'Tes ouvertures confirmées sont conservées sur ce navigateur. Les cinq dernières sont détaillées ci-dessous.'),
      dyn.historyMetrics, dyn.rarities, dyn.wishlistNote,
      panelCard('Derniers boosters', dyn.history),
      el('div', { class: 'kp-btns' }, btn('Copier le bilan', async () => toast(await copyText(boosterSummary()) ? 'Kyara+ · bilan copié' : 'Copie impossible')),
        armedClick(btn('Effacer l’historique', null), {}, () => { storage.remove(KEY.boosterHistory); updatePanelLive(); }, true)),
    ];
  }
  function updatePanelLive() {
    const cfg = getSettings().booster;
    const state = store.get('booster');
    const count = readFreeBoosterCount();
    const history = boosterHistory();
    const cards = history.flatMap((e) => e.cards).map(knownReward);
    if (dyn.stock?.isConnected) {
      const sig = `${count?.count}:${count?.seconds}:${count?.estimated}:${history.length}`;
      if (dyn.stock.dataset.sig !== sig) {
        dyn.stock.dataset.sig = sig;
        dyn.stock.replaceChildren(metric('Boosters disponibles', count ? `${count.estimated ? '~' : ''}${count.count}/${count.max}` : '—', true),
          metric('Prochain gratuit', count?.seconds != null ? countdown(count.seconds) : '—'), metric('Boosters ouverts', String(historyBoosterCount(history))));
      }
    }
    if (dyn.booster?.isConnected) setText(dyn.booster, boosterStatusText());
    if (dyn.manual?.isConnected) dyn.manual.disabled = state.running;
    if (dyn.auto?.isConnected) setText(dyn.auto, cfg.enabled ? 'Mettre en pause' : 'Activer l’automatisation');
    if (dyn.badge?.isConnected) { setText(dyn.badge, state.running ? 'OUVERTURE…' : cfg.enabled ? 'ACTIF' : 'EN PAUSE'); setAttr(dyn.badge, 'data-active', String(cfg.enabled || state.running)); }
    const sig = `${history.length}:${history.at(-1)?.at}:${store.ver('catalog')}:${store.ver('wishlist')}`;
    if (dyn.latest?.isConnected && dyn.latest.dataset.sig !== sig) { dyn.latest.dataset.sig = sig; renderHistory(dyn.latest, history.slice(-1)); }
    if (dyn.history?.isConnected && dyn.history.dataset.sig !== sig) {
      dyn.history.dataset.sig = sig;
      dyn.historyMetrics.replaceChildren(metric('Boosters ouverts', String(historyBoosterCount(history)), true), metric('Cartes reconnues', String(cards.length)), metric('Cartes de wishlist', String(cards.filter((c) => c.wished).length)));
      dyn.rarities.replaceChildren(...RARITIES.map((rarity) => el('div', { class: 'kp-rarity-stat', '--kp-rc': rarityColor(rarity) }, el('b', { text: String(cards.filter((c) => c.rarity === rarity.code).length) }), el('small', { text: rarity.name }))));
      renderHistory(dyn.history, history.slice(-5).reverse());
      setText(dyn.wishlistNote, store.get('wishlistKnown') ? '♥ Les correspondances wishlist sont mémorisées au moment du tirage.' : 'Wishlist non chargée : ouvre ta liste d’envies sur Kyara pour permettre les correspondances.');
    }
  }
  document.addEventListener('keydown', (event) => {
    const panel = document.getElementById('kp-panel');
    if (!panelOpen || !panel) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closePanel(); return; }
    if (event.key !== 'Tab') return;
    const focusable = [...panel.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]')].filter((n) => n.getClientRects().length);
    const first = focusable[0], last = focusable.at(-1);
    if (!panel.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }, true);
  setInterval(() => { if (panelOpen) scheduleRender(); }, 1000);

  function buildPanel() {
    const s = getSettings();
    const row = (label, checked, onChange, title) => el('label', { class: 'kp-row', title },
      el('input', { type: 'checkbox', checked, onChange: (e) => onChange(e.target.checked) }), label);
    const btn = (text, onClick, title) => el('button', { type: 'button', class: 'kp-b', text, title, onClick });
    const field = (label, value, min, max, onChange) => el('label', { class: 'kp-row' }, label,
      el('input', { type: 'number', min: String(min), max: String(max), value: String(value), onChange: (e) => onChange(clamp(Math.round(num(e.target.value, value)), min, max)) }));

    const featureRows = features.filter((f) => f.label).map((f) => row(f.label, s.features[f.name] !== false, (on) => {
      updateSettings((d) => { if (on) delete d.features[f.name]; else d.features[f.name] = false; });
      f.disabled = false; f.fails = 0;
    }));

    const optionRows = [
      row('Écart de valeur ◆ sur chaque proposition', s.options.valueDelta, (on) => updateSettings((d) => { d.options.valueDelta = on; }), 'Compare les prix fair-play (carte reçue − carte donnée)'),
      row('« Donner » en deux temps (dernier exemplaire, Légendaire+)', s.options.confirmGive, (on) => updateSettings((d) => { d.options.confirmGive = on; })),
      row('Repérer les nouvelles offres (tag « Nouveau » + compteur d’onglet)', s.options.newOffers, (on) => updateSettings((d) => { d.options.newOffers = on; })),
      row('Actualiser les offres automatiquement', s.options.autoRefreshOffers, (on) => updateSettings((d) => { d.options.autoRefreshOffers = on; }), 'Onglet visible sur le Marché ; met à jour les offres cachées et les nouveautés'),
      field('  … toutes les (min)', s.refreshMinutes, 2, 60, (v) => updateSettings((d) => { d.refreshMinutes = v; })),
      row('Notification pour une nouvelle offre de ma wishlist', s.options.notify, async (on) => {
        if (on && typeof Notification !== 'undefined' && Notification.permission === 'default') { try { await Notification.requestPermission(); } catch { /* refusé */ } }
        updateSettings((d) => { d.options.notify = on; });
      }),
    ];

    const lockLearned = !!storage.get(KEY.lockRequest, null, validLock);
    const boosterBlock = buildBoosterDashboard(btn, field);

    const rarityOptions = RARITIES.slice(2).map((r, i) => el('option', { value: String(i + 2), text: `${r.name} et au-dessus`, selected: r.code === 'L' }));
    const select = el('select', {}, rarityOptions);
    dyn.output = el('pre', { class: 'kp-status', text: toolOutput || 'Aucun résultat.', hidden: !toolOutput });
    const lockAction = async () => {
      if (!lockLearned) return toast('Kyara+ : verrouille d’abord UNE carte à la main (bouton 🔒) pour que je mémorise la requête.');
      await Promise.all([store.get('collection') ? true : load.collection(), store.get('catalog').size ? true : load.catalog()]);
      const min = +select.value;
      const ids = [...(store.get('collection') ?? [])].map(([id]) => id).filter((id) => rarityRank(store.get('catalog').get(id)?.rarity) >= min && !collectionLocks.confirmed.get(id));
      if (!ids.length) return toast('Kyara+ : aucune carte à verrouiller (ou catalogue indisponible).');
      toast(`Kyara+ : verrouillage de ${plural(ids.length, 'carte')}…`);
      const { done, failed } = await collectionLocks.lockMany(ids, (d, t, f) => { toolOutput = `Verrouillage ${d}/${t}${f ? ` · ${f} échec(s)` : ''}`; setText(dyn.output, toolOutput); dyn.output.hidden = false; });
      toolOutput = `${done - failed} carte(s) verrouillée(s)${failed ? `, ${failed} échec(s)` : ''}.`;
      setText(dyn.output, toolOutput);
    };
    const lockBtn = armedClick(btn('Verrouiller…', null, 'Verrouille toutes les cartes de cette rareté (une par une) : 2 clics pour confirmer'), {}, lockAction, true);
    const toolBlock = [
      el('div', { class: 'kp-btns' },
        btn('Copier mon message d’échange', async () => {
          await Promise.all([store.get('collection') ? true : load.collection(), store.get('catalog').size ? true : load.catalog(), store.ver('wishlist') ? true : load.wishlist()]);
          if (!store.get('collection')) return toast('Kyara+ : collection indisponible.');
          const text = buildTradeMessage();
          toast(text && await copyText(text) ? 'Kyara+ : message copié.' : 'Kyara+ : rien à copier (pas de doubles ni de wishlist).');
        }, 'Mes doubles cédables + ma wishlist, au format Discord'),
        btn('Statistiques de collection', async () => {
          toolOutput = 'Calcul en cours…'; setText(dyn.output, toolOutput); dyn.output.hidden = false;
          try { toolOutput = formatStats(await computeStats((d, t) => setText(dyn.output, `Prix ${d}/${t}…`))); } catch (err) { toolOutput = `Échec : ${err.message}`; }
          setText(dyn.output, toolOutput);
        }, 'Complétion par rareté et valeur estimée (plusieurs requêtes de prix)')),
      el('div', { class: 'kp-btns' }, select, lockBtn),
      dyn.output,
      el('div', { class: 'kp-btns' },
        btn('Copier le rapport de diagnostic', async () => {
          const report = { ...diagnose(), ua: navigator.userAgent, path: location.pathname, lockLearned, settings: getSettings(), recent: logBuffer };
          toast(await copyText(JSON.stringify(report, null, 2)) ? 'Kyara+ : rapport copié.' : 'Kyara+ : copie impossible.');
        }, 'À coller dans une issue GitHub'),
        armedClick(btn('Réinitialiser les réglages', null), {}, () => { storage.remove(KEY.settings); location.reload(); }, true)),
    ];

    const views = {
      boosters: boosterBlock,
      history: buildHistoryView(btn),
      interface: [panelHeading('Personnalisation · 設定', 'Ton Kyara, à ta façon.', 'Active les améliorations qui accompagnent ta collection et tes échanges.'), panelCard('Fonctions', ...featureRows), panelCard('Préférences', ...optionRows)],
      tools: [panelHeading('Atelier · 道具', 'Les outils du collectionneur.', 'Statistiques, message d’échange, verrouillage et diagnostic.'), panelCard('Collection & échanges', ...toolBlock)],
    };
    const nav = [['boosters', '箱', 'Boosters'], ['history', '記', 'Historique'], ['interface', '調', 'Interface'], ['tools', '工', 'Outils']];
    return el('div', { id: 'kp-panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'kp-title', tabindex: '-1' },
      el('header', { class: 'kp-header' }, el('div', { class: 'kp-brandmark', 'aria-hidden': 'true', text: 'キ' }),
        el('div', {}, el('div', { class: 'kp-brand' }, el('h3', { id: 'kp-title', text: 'KYARA +' }), el('span', { class: 'kp-version', text: VERSION })), el('p', { class: 'kp-brand-sub', text: 'Le compagnon de ta collection' })),
        el('button', { type: 'button', class: 'kp-close', 'aria-label': 'Fermer Kyara Plus', text: '×', onClick: closePanel })),
      el('div', { class: 'kp-shell' },
        el('nav', { class: 'kp-sidebar', role: 'tablist', 'aria-label': 'Sections Kyara Plus' },
          nav.map(([view, icon, label]) => el('button', { type: 'button', class: 'kp-nav', role: 'tab', id: 'kp-tab-' + view, 'aria-controls': 'kp-view', 'aria-selected': String(panelView === view),
            onClick: () => { panelView = view; panelSig = ''; scheduleRender(); },
            onKeydown: (event) => {
              if (!['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
              event.preventDefault();
              const current = nav.findIndex(([v]) => v === panelView);
              panelView = nav[event.key === 'Home' ? 0 : event.key === 'End' ? nav.length - 1 : (current + (['ArrowDown','ArrowRight'].includes(event.key) ? 1 : -1) + nav.length) % nav.length][0];
              panelSig = ''; scheduleRender();
            },
          }, el('span', { text: icon, 'aria-hidden': 'true' }), label)),
          el('p', { class: 'kp-sidebar-note', text: 'Fait pour les collectionneurs. Les petits détails font les grandes collections.' })),
        el('div', { class: 'kp-content', role: 'tabpanel', id: 'kp-view', 'aria-labelledby': 'kp-tab-' + panelView }, views[panelView])),
      el('footer', { class: 'kp-footer' }, el('span', { text: 'KYARA PLUS · EXTENSION LOCALE' }), el('span', { text: 'ÉCHAP POUR FERMER' })));
  }

  defineFeature({
    name: 'settingsPanel',
    match: () => true,
    run() {
      let gear = document.getElementById('kp-gear');
      if (!gear) {
        gear = el('button', {
          id: 'kp-gear', type: 'button', text: 'KYARA +' , title: 'Réglages Kyara Plus', 'aria-label': 'Réglages Kyara Plus',
          onClick: () => panelOpen ? closePanel() : openPanel(),
        });
        document.body.appendChild(gear);
      }
      setAttr(gear, 'data-active', String(getSettings().booster.enabled));
      setAttr(gear, 'aria-expanded', String(panelOpen));
      const panel = document.getElementById('kp-panel');
      if (!panelOpen) { if (panel) panel.remove(); document.getElementById('kp-backdrop')?.remove(); return; }
      const sig = JSON.stringify([panelView, getSettings(), !!storage.get(KEY.lockRequest, null, validLock), features.map((f) => f.disabled)]);
      if (!panel || sig !== panelSig) {
        panelSig = sig;
        const wasNav = document.activeElement?.classList.contains('kp-nav');
        const focusLabel = document.activeElement?.getAttribute('aria-label');
        const scroll = panel?.querySelector('.kp-content')?.scrollTop || 0;
        if (panel) panel.remove();
        if (!document.getElementById('kp-backdrop')) document.body.appendChild(el('div', { id: 'kp-backdrop', onClick: closePanel }));
        const next = buildPanel(); document.body.appendChild(next);
        updatePanelLive();
        const focus = wasNav ? document.getElementById('kp-tab-' + panelView) : focusLabel ? [...next.querySelectorAll('[aria-label]')].find((n) => n.getAttribute('aria-label') === focusLabel) : null;
        (focus || next.querySelector('.kp-close')).focus({ preventScroll: true });
        next.querySelector('.kp-content').scrollTop = wasNav ? 0 : scroll;
        return;
      }
      updatePanelLive();
    },
    teardown() { closePanel(); document.getElementById('kp-gear')?.remove(); },
  });

  /* ==========================================================================
   * 16. ÉCOUTEURS DE REQUÊTES ET DÉMARRAGE
   * ======================================================================== */

  let afterTimer = null;
  net.onMutation(({ url, method, promise, body }) => {
    // a) Verrouillage : apprendre la requête du site, et (dans l’iframe) prévenir la page quand elle est terminée
    if (method === 'POST' && LOCK_URL.test(url)) {
      const cardId = wikiId(location.pathname);
      const report = (ok, status, response) => { if (IN_FRAME) window.parent.postMessage({ type: FRAME_LOCK_DONE, ok, status, response }, location.origin); };
      // On clone la réponse dans le premier callback, avant que le site ne la lise (un corps ne se lit qu’une fois)
      const result = promise.then((res) => res.clone().text().catch(() => '').then((response) => ({ ok: res.ok, status: res.status, response })));
      Promise.all([result, body()])
        .then(([res, text]) => { if (res.ok) learnLockRequest(url, text, cardId); report(res.ok, res.status, res.response); })
        .catch((err) => { log.warn('lecture de la requête de verrouillage impossible', err); report(false, 0, ''); });
      return;
    }
    if (IN_FRAME || !pathOf(url).startsWith('/api/')) return;
    if (DEBUG) body().then((b) => log.info(`requête ${method}`, pathOf(url), typeof b === 'string' ? b.slice(0, 200) : '')).catch(() => {});
    // b) Réponse d’une ouverture déclenchée par le bouton gratuit du site.
    if (method === 'POST' && BOOSTER_HINT.test(pathOf(url)) && booster.pendingOpen) booster.captureOpenResponse(promise);
    // c) Toute modification réussie côté serveur : on relit la collection peu après (remplace les 2 timers aveugles)
    promise.then((res) => {
      if (!res.ok) return;
      clearTimeout(afterTimer);
      afterTimer = setTimeout(() => load.collection(), TIMING.afterMutation);
    }, () => {});
  });

  net.install(); // dans TOUTES les frames : l’iframe de verrouillage a besoin du hook réseau
  if (!IN_FRAME) whenBodyReady(() => {
    albumTabs.install();
    startUi();
    if (getSettings().booster.enabled) booster.tick();
  }); // …mais seule la page principale installe l’interface
})();
