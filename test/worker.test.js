'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture(namespace = 'chrome') {
  const listeners = {}, storage = {}, alarms = new Map(), sent = [], tabProperties = new Map(), updates = [], reloads = [];
  let now = 1000;
  const chrome = {
    runtime: { onMessage: { addListener(fn) { listeners.message = fn; } } },
    alarms: {
      async clear(name) { alarms.delete(name); },
      async create(name, options) { alarms.set(name, options.when); },
      onAlarm: { addListener(fn) { listeners.alarm = fn; } },
    },
    storage: { session: {
      async set(value) { Object.assign(storage, value); },
      async get(key) { return { [key]: storage[key] }; },
      async remove(key) { delete storage[key]; },
    } },
    tabs: {
      async sendMessage(id, message) { sent.push({ id, message }); },
      async get(id) { return { id, autoDiscardable: true, discarded: false, ...tabProperties.get(id) }; },
      async update(id, properties) { tabProperties.set(id, { ...tabProperties.get(id), ...properties }); updates.push({ id, properties }); },
      async reload(id) { reloads.push(id); tabProperties.set(id, { ...tabProperties.get(id), discarded: false }); },
      onRemoved: { addListener(fn) { listeners.removed = fn; } },
    },
  };
  const context = { [namespace]: chrome, Date: { now: () => now }, URL };
  if (namespace === 'browser') context.chrome = new Proxy({}, { get() { throw new Error('API chrome utilisée sur Firefox'); } });
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'service-worker.js'), 'utf8'), context);
  const message = (id, type, when, url = 'https://kyara.games/ouvrir/shonen') => listeners.message({ channel: 'kyara-plus:booster-alarm', type, when }, { tab: { id }, url });
  return { chrome, listeners, storage, alarms, sent, message, tabProperties, updates, reloads, setNow: (value) => { now = value; } };
}
test('deux onglets gardent leurs propres réveils et annulations', async () => {
  const f = fixture();
  await f.message(42, 'schedule', 5000); await f.message(7, 'schedule', 6000);
  assert.equal(f.alarms.size, 2);
  await f.message(42, 'cancel');
  assert.equal(f.alarms.size, 1); assert.equal([...f.alarms.values()][0], 6000);
});

test('Firefox programme, réveille et annule avec les API browser', async () => {
  const f = fixture('browser');
  await f.message(7, 'schedule', 1500);
  await f.message(42, 'schedule', 5000);
  f.setNow(1500);
  await f.listeners.alarm({ name: 'kyara-plus:booster-wake:7' });
  assert.equal(f.sent[0].id, 7);
  await f.message(7, 'cancel');
  assert.equal(f.alarms.size, 1);
  assert.equal(f.alarms.get('kyara-plus:booster-wake:42'), 5000);
});
test('un réveil échu cible uniquement son onglet et jamais avant son échéance', async () => {
  const f = fixture(); await f.message(7, 'schedule', 1);
  const name = [...f.alarms.keys()][0]; assert.equal(f.alarms.get(name), 1500);
  await f.listeners.alarm({ name }); assert.equal(f.sent.length, 0);
  f.setNow(1500); await f.listeners.alarm({ name });
  assert.equal(f.sent.length, 1); assert.equal(f.sent[0].id, 7); assert.equal(f.sent[0].message.type, 'wake');
});
test('un expéditeur externe et un instant invalide sont refusés', async () => {
  const f = fixture();
  await f.message(7, 'schedule', 5000, 'https://example.com/');
  await f.message(7, 'schedule', NaN);
  assert.equal(f.alarms.size, 0);
});
test('une annulation suit une programmation en cours sans recréer le réveil', async () => {
  const f = fixture();
  await Promise.all([f.message(7, 'schedule', 5000), f.message(7, 'cancel')]);
  assert.equal(f.alarms.size, 0); assert.equal(Object.keys(f.storage).length, 0);
});
test('l’échec d’un ancien réveil ne supprime pas la nouvelle programmation', async () => {
  const f = fixture(); await f.message(7, 'schedule', 1); f.setNow(1500);
  const name = [...f.alarms.keys()][0];
  let signalStarted, rejectSend;
  const started = new Promise((resolve) => { signalStarted = resolve; });
  const held = new Promise((resolve, reject) => { rejectSend = reject; });
  f.chrome.tabs.sendMessage = () => { signalStarted(); return held; };
  const wake = f.listeners.alarm({ name });
  await started;
  const next = f.message(7, 'schedule', 5000);
  for (let i = 0; i < 8; i++) await Promise.resolve();
  rejectSend(new Error('Ancien document fermé'));
  await Promise.all([wake, next]);
  assert.equal(f.alarms.get(name), 5000);
});

test('Chrome protège seulement l’onglet pilote du déchargement et restaure sa valeur initiale', async () => {
  const f = fixture();
  await f.message(7, 'schedule', 5000); await f.message(7, 'schedule', 6000);
  assert.equal(f.tabProperties.get(7).autoDiscardable, false);
  await f.message(7, 'cancel'); assert.equal(f.tabProperties.get(7).autoDiscardable, true);
  f.tabProperties.set(42, { autoDiscardable: false });
  await f.message(42, 'schedule', 5000); await f.message(42, 'cancel');
  assert.equal(f.tabProperties.get(42).autoDiscardable, false);
});
test('Firefox ne reçoit pas l’option Chromium autoDiscardable', async () => {
  const f = fixture('browser'); await f.message(7, 'schedule', 5000); await f.message(7, 'cancel');
  assert.equal(f.updates.length, 0);
});
test('un onglet déchargé est rechargé en arrière-plan puis réveillé sans l’activer', async () => {
  const f = fixture(); await f.message(7, 'schedule', 1500); f.setNow(1500);
  f.tabProperties.set(7, { discarded: true, autoDiscardable: false });
  f.chrome.tabs.sendMessage = async () => { throw new Error('Onglet déchargé'); };
  await f.listeners.alarm({ name: 'kyara-plus:booster-wake:7' });
  assert.deepEqual(f.reloads, [7]); assert.equal(f.alarms.get('kyara-plus:booster-wake:7'), 6500);
  assert.ok(f.storage['kyara-plus:booster-wake:7']);
  assert.ok(f.updates.every((update) => !Object.hasOwn(update.properties, 'active')));
});
