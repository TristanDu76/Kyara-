'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../booster-core.js');

function fixture(stock = 10) {
  const state = { stock, selected: 1, clicks: [], records: [], enabled: true, route: true, reveals: 0, waits: [], label: null };
  const adapter = {
    active: () => state.enabled, onRoute: () => state.route, ready: async () => {}, stock: () => state.stock,
    button: () => ({ textContent: state.label ?? (state.selected === 1 ? `Ouvrir Gratuit · ${state.stock} restants` : `Ouvrir ×${state.selected} ${state.selected} gratuits`), disabled: false }),
    quantity: async (quantity) => { state.selected = quantity; },
    open: () => { const quantity = state.selected; state.clicks.push(quantity); state.stock -= quantity; return Promise.resolve(Array.from({ length: quantity * 5 }, () => ({ id: '1' }))); },
    confirm: async (before, quantity) => { if (!core.consumptionConfirmed(before, state.stock, quantity)) throw new Error('Compteur non confirmé'); },
    reveal: async () => { state.reveals++; }, rewards: async (response) => response,
    record: (cards, quantity) => state.records.push({ cards, quantity }),
    cleanup: () => {}, status: () => {}, sleep: async (ms) => { state.waits.push(ms); },
  };
  return { state, adapter };
}

test('aucune ouverture avant le seuil, même avec neuf gratuits pour un lot de dix', async () => {
  for (const stock of [null, 0, 1, 9]) {
    const { state, adapter } = fixture(stock);
    assert.equal((await core.runBatch(adapter, { size: 10 })).opened, 0); assert.deepEqual(state.clicks, []);
  }
});
test('un lot complet de dix utilise ×10 et mémorise cinquante cartes', async () => {
  const { state, adapter } = fixture(10);
  assert.equal((await core.runBatch(adapter, { size: 10 })).opened, 10);
  assert.deepEqual(state.clicks, [10]); assert.equal(state.stock, 0);
  assert.equal(state.records[0].quantity, 10); assert.equal(state.records[0].cards.length, 50); assert.deepEqual(state.waits, []);
});
test('un lot de cinq utilise ×5 et laisse le surplus disponible', async () => {
  const { state, adapter } = fixture(8);
  assert.equal((await core.runBatch(adapter, { size: 5 })).opened, 5);
  assert.deepEqual(state.clicks, [5]); assert.equal(state.stock, 3);
});
test('un lot de sept utilise ×5 puis deux ×1 et espace seulement ces actions', async () => {
  const { state, adapter } = fixture(7);
  assert.equal((await core.runBatch(adapter, { size: 7, spacingMs: 2000 })).opened, 7);
  assert.deepEqual(state.clicks, [5, 1, 1]); assert.deepEqual(state.waits, [2000, 2000]);
  assert.equal(state.records.reduce((total, entry) => total + entry.quantity, 0), 7);
});
test('toutes les tailles de 1 à 10 ouvrent exactement le lot et refusent un stock inférieur', async () => {
  for (let size = 1; size <= 10; size++) {
    const ready = fixture(10);
    assert.equal((await core.runBatch(ready.adapter, { size })).opened, size);
    assert.equal(ready.state.clicks.reduce((sum, n) => sum + n, 0), size);
    assert.ok(ready.state.clicks.every((n) => [1, 5, 10].includes(n)));
    const waiting = fixture(size - 1);
    await core.runBatch(waiting.adapter, { size }); assert.deepEqual(waiting.state.clicks, []);
  }
});
test('le dernier booster 1 → 0 est confirmé et enregistré', async () => {
  const { state, adapter } = fixture(1);
  assert.equal((await core.runBatch(adapter, { size: 1 })).opened, 1);
  assert.deepEqual(state.clicks, [1]); assert.equal(state.records[0].cards.length, 5);
});
test('les cycles se répètent après recharge sans désactiver l’automatisation', async () => {
  const { state, adapter } = fixture(5);
  await core.runBatch(adapter, { size: 5 }); state.stock = 4; await core.runBatch(adapter, { size: 5 });
  assert.deepEqual(state.clicks, [5]); state.stock = 5; await core.runBatch(adapter, { size: 5 });
  assert.deepEqual(state.clicks, [5, 5]); assert.equal(state.enabled, true);
});
test('Ouvrir un autre et Ouvrir encore réinitialisent sans consommer un booster', async () => {
  for (const label of ['Ouvrir un autre Gratuit · 2 restants', 'Ouvrir encore ×5 5 gratuits']) {
    const { state, adapter } = fixture(5); let resets = 0; state.label = label;
    adapter.reset = async () => { resets++; state.label = null; };
    await core.runBatch(adapter, { size: 5 }); assert.equal(resets, 1); assert.deepEqual(state.clicks, [5]);
  }
});
test('un retour au menu affichant un prix après ×5 permet de sélectionner ×1 sans achat', async () => {
  const { state, adapter } = fixture(7);
  const open = adapter.open;
  let resets = 0;
  adapter.open = () => { const response = open(); state.label = `Ouvrir encore ×${state.selected} ${state.stock} gratuits + 700 ◆`; return response; };
  adapter.reset = async () => { resets++; state.label = null; };
  assert.equal((await core.runBatch(adapter, { size: 7 })).opened, 7);
  assert.deepEqual(state.clicks, [5,1,1]); assert.equal(resets, 2);
});
test('un bouton payant, mixte, ambigu ou annonçant moins de gratuits est bloqué', async () => {
  for (const label of ['Ouvrir 150 ◆', 'Ouvrir ×5 1 gratuit + 700 ◆', 'Ouvrir Gratuit · 5 restants 0 ◆', 'Ouvrir', 'Ouvrir ×5 4 gratuits']) {
    const { state, adapter } = fixture(5); state.label = label;
    await core.runBatch(adapter, { size: 5 }); assert.deepEqual(state.clicks, []);
  }
});
test('arrêter pendant un lot empêche l’action suivante', async () => {
  const { state, adapter } = fixture(7);
  adapter.record = (cards, quantity) => { state.records.push({ cards, quantity }); state.enabled = false; };
  await core.runBatch(adapter, { size: 7 }); assert.deepEqual(state.clicks, [5]);
});
test('changer de page pendant le réglage de quantité empêche tout clic', async () => {
  const { state, adapter } = fixture(5); adapter.quantity = async () => { state.route = false; };
  await core.runBatch(adapter, { size: 5 }); assert.deepEqual(state.clicks, []);
});
test('une baisse différente de la quantité attendue suspend les tentatives', async () => {
  const { state, adapter } = fixture(5);
  adapter.open = () => { state.clicks.push(5); state.stock--; return Promise.resolve([]); };
  const result = await core.runBatch(adapter, { size: 5 });
  assert.deepEqual(state.clicks, [5]); assert.equal(result.uncertain, true); assert.equal(state.records.length, 0);
});
test('une panne du résumé ne relance pas une ouverture confirmée', async () => {
  const { state, adapter } = fixture(5); adapter.rewards = async () => { throw new Error('JSON inconnu'); };
  assert.equal((await core.runBatch(adapter, { size: 5 })).opened, 5);
  assert.equal(state.records[0].quantity, 5); assert.deepEqual(state.records[0].cards, []);
});
test('les doublons dans les résultats de lots sont conservés', () => {
  assert.deepEqual(core.cardIdsInReward(JSON.stringify({ results: [{ cards: [{ id: 1 }, { id: 1 }] }, { cards: [{ id: 2 }] }] })), ['1', '1', '2']);
  assert.deepEqual(core.cardIdsInReward('not-json'), []);
});
test('le prochain réveil attend un nouveau gratuit tant que le seuil n’est pas atteint', () => {
  assert.equal(core.nextWakeAt({ count: 9, seconds: 60 }, 1000, 10), 61750);
  assert.equal(core.nextWakeAt({ count: 10, seconds: 600 }, 1000, 10), 1000);
  assert.equal(core.nextWakeAt({ count: 4, seconds: null }, 1000, 5), 31000);
  assert.equal(core.parseFreeStock('11/10 boosters gratuits'), null);
});
test('le garde-fou réseau exige le bon type, la bonne quantité et maxChakra exactement à zéro', () => {
  const permit = { type: 'shonen', quantity: 5 }, path = '/api/packs/shonen/open-many';
  assert.equal(core.freeRequestAllowed(path, '{"count":5,"maxChakra":0}', permit), true);
  for (const body of [{ count: 5 }, { count: 5, maxChakra: 1 }, { count: 5, maxChakra: '0' }, { count: 10, maxChakra: 0 }]) {
    assert.equal(core.freeRequestAllowed(path, JSON.stringify(body), permit), false);
  }
  assert.equal(core.freeRequestAllowed('/api/packs/waifu/open-many', '{"count":5,"maxChakra":0}', permit), false);
  assert.equal(core.freeRequestAllowed(path, 'not-json', permit), false);
  assert.equal(core.freeRequestAllowed('/api/packs/shonen/open', '{"maxChakra":0}', { type: 'shonen', quantity: 1 }), true);
});
