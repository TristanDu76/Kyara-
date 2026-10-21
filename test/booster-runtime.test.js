'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../booster-core.js');
const source = fs.readFileSync(path.join(__dirname, '..', 'kyara-plus.js'), 'utf8');

test('relire un délai figé conserve l’échéance initiale jusqu’au changement réel de stock', () => {
  const start = source.indexOf('  function readFreeBoosterCount()');
  const code = source.slice(start, source.indexOf('  function resultCardsFromPage()', start));
  let now = 100000, count = 0, seconds = '00:10', cached;
  const read = vm.runInNewContext(code + '\nreadFreeBoosterCount;', {
    freeBoosterIndicator: () => ({ count, max: 10, node: { getAttribute: () => seconds, textContent: '' } }),
    storage: { get: () => cached, set: (_key, value) => { cached = value; } }, KEY: { boosterCount: 'count' }, isObj: () => true, Date: { now: () => now },
  });
  assert.equal(read().refillAt, 110000);
  now = 120000;
  assert.equal(read().refillAt, 110000);
  assert.equal(core.nextWakeAt(cached, now, 5), 150000);
  count = 1; seconds = '';
  assert.equal(read().refillAt, null);
  seconds = '10:00';
  assert.equal(read().refillAt, 720000);
  assert.equal(core.nextWakeAt(cached, now, 5), 720750);
});

test('un réveil échu rafraîchit le stock même si le compteur DOM est figé en arrière-plan', async () => {
  const start = source.indexOf('    async tick() {', source.indexOf('  const booster ='));
  const code = source.slice(start, source.indexOf('    async run(', start));
  async function tick({ next = 99000, refillAt = 99000, seconds = 300, count = 0, refreshed = 0, enabled = true } = {}) {
    let reloads = 0, runs = 0, wake;
    const values = new Map([['refresh', refreshed]]);
    const runtime = vm.runInNewContext('({' + code + '})', {
      getSettings: () => ({ booster: { enabled, batchSize: 5 } }), IN_FRAME: false,
      store: { get: () => ({ running: false }) }, storage: { get: (key, fallback) => values.get(key) ?? fallback, set: (key, value) => values.set(key, value) },
      KEY: { boosterOwner: 'owner', boosterRefresh: 'refresh' }, isObj: () => true, TAB_ID: 'tab', Date: { now: () => 100000 },
      readFreeBoosterCount: () => ({ count, seconds, seenAt: 100000, refillAt }), BoosterCore: core,
      location: { reload() { reloads++; } },
    });
    await runtime.tick.call({ nextAt: () => next, schedule: (value) => { wake = value; }, setStatus() {}, run: async () => { runs++; } });
    return { reloads, runs, wake };
  }
  assert.deepEqual(await tick(), { reloads: 1, runs: 0, wake: 103000 });
  assert.equal((await tick({ refreshed: 99000 })).reloads, 0);
  assert.equal((await tick({ next: 0, refillAt: 110000 })).reloads, 0);
  assert.equal((await tick({ next: 110000 })).wake, 110000);
  assert.equal((await tick({ count: 5 })).runs, 1);
  assert.equal((await tick({ enabled: false })).reloads, 0);
});

test('les animations sont reconnues même quand le titre et la description sont collés', async () => {
  const code = source.slice(source.indexOf('  async function prepareBoosterAnimation('), source.indexOf('  function freeBoosterIndicator('));
  for (const label of [' AnimationsDésactive-les si ton téléphone rame.', 'Animations Désactive-les si ton téléphone rame.']) {
    for (const checked of [true, false]) {
      let visible = false, clicks = 0;
      const input = { checked, closest: () => ({ textContent: label }), getAttribute: () => null,
        click() { clicks++; this.checked = false; } };
      const paid = { checked: true, closest: () => ({ textContent: 'Prévenir avant un booster payant' }) };
      const options = { getAttribute: (name) => name === 'aria-label' ? 'Options d’ouverture' : String(visible), click() { visible = !visible; } };
      const prepare = vm.runInNewContext(code + '\nprepareBoosterAnimation;', {
        siteButtons: () => [options], document: { querySelectorAll: () => visible ? [input, paid] : [] },
        waitForBooster: async (predicate) => { if (!predicate()) throw new Error('délai dépassé'); },
      });
      await prepare(() => true);
      assert.equal(input.checked, false);
      assert.equal(clicks, checked ? 1 : 0);
      assert.equal(paid.checked, true);
      assert.equal(visible, false);
    }
  }
});

function network() {
  const sent = [];
  let now = 1000;
  const window = { fetch: async (input, init) => { sent.push({ input, init }); return { ok: true }; }, dispatchEvent() {} };
  const code = source.slice(source.indexOf('  let boosterPermit ='), source.indexOf('  /** Chargements à la demande'));
  const context = { window, BoosterCore: core, Request, Headers, Event, URL, location: { origin: 'https://kyara.games' }, BOOSTER_HINT: /boost|pack|open|draw|gacha|free/i,
    pathOf: (url) => { const parsed = new URL(url, 'https://kyara.games'); return parsed.pathname + parsed.search; }, NET: { concurrency: 2, spacing: 120 }, HANDLERS: [], log: { info() {}, warn() {} }, Date: { now: () => now } };
  const runtime = vm.runInNewContext(code + '\nnet.install(); ({ permit(value) { boosterPermit = value; } });', context);
  return { sent, fetch: (input, init) => window.fetch(input, typeof input === 'string' ? { headers: { 'x-request-id': 'request-1' }, ...init } : init), permit: runtime.permit, advance: (ms) => { now += ms; } };
}

test('une requête automatique coûteuse ou ambiguë est arrêtée AVANT le fetch natif', async () => {
  for (const body of ['{"count":5}', '{"count":5,"maxChakra":1}', '{"count":5,"maxChakra":"0"}', 'not-json']) {
    const f = network(); f.permit({ type: 'shonen', quantity: 5 });
    await assert.rejects(f.fetch('/api/packs/shonen/open-many', { method: 'POST', body }), /bloquée/);
    assert.equal(f.sent.length, 0);
  }
});
test('le garde réseau valide le type et la quantité et n’envoie jamais vers un autre site', async () => {
  for (const url of ['/api/packs/waifu/open-many', '/api/packs/shonen/open', 'https://example.com/api/packs/shonen/open-many']) {
    const f = network(); f.permit({ type: 'shonen', quantity: 5 });
    await assert.rejects(f.fetch(url, { method: 'POST', body: '{"count":5,"maxChakra":0}' }), /bloquée/);
    assert.equal(f.sent.length, 0);
  }
});
test('la requête de lot autorisée garde son plafond maxChakra zéro', async () => {
  const f = network(); f.permit({ type: 'shonen', quantity: 5 });
  await f.fetch('/api/packs/shonen/open-many', { method: 'POST', body: '{"count":5,"maxChakra":0}' });
  assert.equal(f.sent.length, 1); assert.equal(JSON.parse(f.sent[0].init.body).maxChakra, 0);
});
test('les objets Request sont contrôlés sans consommer leur corps avant l’envoi', async () => {
  const f = network(); f.permit({ type: 'shonen', quantity: 1 });
  const request = new Request('https://kyara.games/api/packs/shonen/open', { method: 'POST', headers: { 'x-request-id': 'request-1' }, body: '{"maxChakra":0}' });
  await f.fetch(request);
  assert.equal(f.sent.length, 1); assert.equal(await request.text(), '{"maxChakra":0}');
});

test('un permis ne peut pas envoyer deux ouvertures, même après son nettoyage', async () => {
  const f = network(); f.permit({ type: 'shonen', quantity: 5 });
  const init = { method: 'POST', body: '{"count":5,"maxChakra":0}' };
  await f.fetch('/api/packs/shonen/open-many', init);
  await assert.rejects(f.fetch('/api/packs/shonen/open-many', { ...init, headers: { 'x-request-id': 'request-2' } }));
  f.permit(null);
  await assert.rejects(f.fetch('/api/packs/shonen/open-many', init));
  assert.equal(f.sent.length, 1);
});
test('une autorisation annulée ou une requête sans identifiant ne peut pas partir', async () => {
  const f = network(); f.permit({ type: 'shonen', quantity: 5, cancelled: true });
  const init = { method: 'POST', body: '{"count":5,"maxChakra":0}' };
  await assert.rejects(f.fetch('/api/packs/shonen/open-many', init));
  f.permit({ type: 'shonen', quantity: 5 });
  await assert.rejects(f.fetch('/api/packs/shonen/open-many', { ...init, headers: {} }));
  assert.equal(f.sent.length, 0);
});
test('les identifiants expirent après dix minutes, au-delà de la fenêtre de retry du site', async () => {
  const f = network(), init = { method: 'POST', body: '{"count":5,"maxChakra":0}' };
  f.permit({ type: 'shonen', quantity: 5 }); await f.fetch('/api/packs/shonen/open-many', init);
  f.advance(120001); f.permit(null);
  await assert.rejects(f.fetch('/api/packs/shonen/open-many', init));
  f.advance(480000); f.permit({ type: 'shonen', quantity: 5 });
  await f.fetch('/api/packs/shonen/open-many', init); assert.equal(f.sent.length, 2);
});

test('une mutation DOM résout une attente dans un onglet caché sans réveil de timer', async () => {
  const code = source.slice(source.indexOf('  function waitForBooster('), source.indexOf('  async function prepareBoosterAnimation'));
  let mutation, disconnected = false, timerCleared = false, timerDelay, ready = false;
  const listeners = new Map();
  const wait = vm.runInNewContext(code + '\nwaitForBooster;', {
    MutationObserver: class { constructor(callback) { mutation = callback; } observe() {} disconnect() { disconnected = true; } },
    window: { addEventListener(type, fn) { listeners.set(type, fn); }, removeEventListener(type) { listeners.delete(type); } },
    document: { hidden: true }, setTimeout(_fn, delay) { timerDelay = delay; return 1; }, clearTimeout() { timerCleared = true; },
  });
  const pending = wait(() => ready, 3000);
  ready = true; mutation();
  assert.equal(await pending, true); assert.equal(disconnected, true); assert.equal(timerCleared, true);
  assert.equal(listeners.size, 0); assert.equal(timerDelay, 180000);
});

test('l’ancien plafond est migré en seuil et l’historique compte les quantités natives', () => {
  const settings = source.slice(source.indexOf('  function normalizeSettings('), source.indexOf('  /* ==========================================================================', source.indexOf('  function normalizeSettings(')));
  const normalize = vm.runInNewContext(settings + '\nnormalizeSettings;', { isObj: (v) => v && typeof v === 'object', DEFAULT_SETTINGS: { options: {} }, BoosterCore: core,
    clamp: (n, min, max) => Math.max(min, Math.min(max, n)), num: (v, fallback) => Number.isFinite(Number(v)) ? Number(v) : fallback });
  assert.equal(normalize({ booster: { max: 5 } }).booster.batchSize, 5);
  const counter = source.slice(source.indexOf('  const historyBoosterCount ='), source.indexOf('  function rememberBoosterRewards'));
  const total = vm.runInNewContext(counter + '\nhistoryBoosterCount;');
  assert.equal(total([{ cards: [] }, { quantity: 5 }, { quantity: 10 }]), 16);
});

test('les lots suivants respectent la pause choisie et les changements de taille repartent immédiatement', () => {
  const start = source.indexOf('      if (getSettings().booster.enabled) {', source.indexOf('this.failures = result.opened'));
  const code = source.slice(start, source.indexOf('      storage.set(KEY.boosterLast', start));
  const old = { type: 'shonen', batchSize: 1, spacingSec: 2 };
  function next(current, count, opened) {
    let when;
    const choose = vm.runInNewContext('(function () {\n' + code + '\n})', {
      getSettings: () => ({ booster: { ...current, enabled: true } }), readFreeBoosterCount: () => count, cfg: old,
      now: 1000, acquired: true, result: { opened }, BoosterCore: core,
    });
    choose.call({ failures: 0, schedule: (value) => { when = value; } }); return when;
  }
  assert.equal(next(old, { count: 9, seconds: 60 }, 1), 3000);
  assert.equal(next({ ...old, batchSize: 5 }, { count: 5, seconds: 600 }, 0), 2000);
});
