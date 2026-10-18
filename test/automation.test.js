'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../booster-core.js');

function fixture(stock = 2) {
  const state = { stock, button: 'Ouvrir Gratuit · 2 restants', clicks: 0, records: [], enabled: true, route: true, reveals: 0 };
  const adapter = {
    active: () => state.enabled,
    onRoute: () => state.route,
    ready: async () => {},
    stock: () => state.stock,
    button: () => ({ textContent: state.button, disabled: false }),
    single: async () => {},
    open: () => { state.clicks++; state.stock--; return Promise.resolve(['1', '1', '2', '3', '4']); },
    confirm: async (before) => { if (!core.consumptionConfirmed(before, state.stock)) throw new Error('Compteur inchangé'); },
    reveal: async () => { state.reveals++; },
    rewards: async (response) => response,
    record: (cards) => state.records.push(cards),
    cleanup: () => {},
    status: () => {},
    sleep: async () => {},
  };
  return { state, adapter };
}

test('le dernier booster 1 → 0 est confirmé et enregistré', async () => {
  const { state, adapter } = fixture(1);
  const result = await core.runBatch(adapter, { max: 10, spacingMs: 0 });
  assert.equal(result.opened, 1);
  assert.equal(state.clicks, 1);
  assert.equal(state.reveals, 1);
  assert.equal(state.records[0].length, 5);
});
test('les ouvertures en série sont révélées et comptées une seule fois', async () => {
  const { state, adapter } = fixture(3);
  assert.equal((await core.runBatch(adapter, { max: 2, spacingMs: 0 })).opened, 2);
  assert.equal(state.clicks, 2);
  assert.equal(state.records.length, 2);
});
test('Ouvrir un autre réinitialise le menu avant le clic qui consomme le booster', async () => {
  const { state, adapter } = fixture(2);
  let resets = 0;
  state.button = 'Ouvrir un autre Gratuit · 2 restants';
  adapter.reset = async () => { resets++; state.button = 'Ouvrir Gratuit · 2 restants'; };
  adapter.open = () => {
    assert.equal(state.button.startsWith('Ouvrir un autre'), false);
    state.clicks++; state.stock--; state.button = 'Ouvrir un autre Gratuit · 1 restant';
    return Promise.resolve([]);
  };
  const result = await core.runBatch(adapter, { max: 2, spacingMs: 0 });
  assert.equal(result.opened, 2); assert.equal(resets, 2); assert.equal(state.clicks, 2);
});
test('un bouton payant ou ambigu ne déclenche aucun clic', async () => {
  for (const label of ['Ouvrir 150 ◆', 'Ouvrir Gratuit · 2 restants 150 ◆', 'Ouvrir']) {
    const { state, adapter } = fixture(); state.button = label;
    await core.runBatch(adapter, { max: 10 });
    assert.equal(state.clicks, 0);
  }
});
test('un stock absent ou nul ne déclenche aucun clic', async () => {
  for (const stock of [null, 0]) {
    const { state, adapter } = fixture(stock);
    await core.runBatch(adapter, { max: 10 }); assert.equal(state.clicks, 0);
  }
});
test('arrêter pendant une série empêche le clic suivant', async () => {
  const { state, adapter } = fixture(3);
  adapter.record = (cards) => { state.records.push(cards); state.enabled = false; };
  await core.runBatch(adapter, { max: 10 }); assert.equal(state.clicks, 1);
});
test('changer de page pendant l’attente empêche tout clic', async () => {
  const { state, adapter } = fixture();
  adapter.single = async () => { state.route = false; };
  await core.runBatch(adapter, { max: 10 }); assert.equal(state.clicks, 0);
});
test('un compteur inchangé arrête les tentatives et signale une ouverture incertaine', async () => {
  const { state, adapter } = fixture();
  adapter.open = () => { state.clicks++; return Promise.resolve([]); };
  const result = await core.runBatch(adapter, { max: 10 });
  assert.equal(state.clicks, 1); assert.equal(result.uncertain, true); assert.equal(state.records.length, 0);
});
test('une panne du résumé ne relance pas une ouverture confirmée', async () => {
  const { state, adapter } = fixture(1);
  adapter.rewards = async () => { throw new Error('JSON inconnu'); };
  const result = await core.runBatch(adapter, { max: 10 });
  assert.equal(result.opened, 1); assert.equal(state.records.length, 1); assert.deepEqual(state.records[0], []);
});
test('les doublons de tirage sont conservés et les erreurs JSON ignorées', () => {
  assert.deepEqual(core.cardIdsInReward(JSON.stringify({ cards: [{ characterId: 1 }, { characterId: 1 }, { character: { id: 2 } }] })), ['1', '1', '2']);
  assert.deepEqual(core.cardIdsInReward('not-json'), []);
});
test('un compteur impossible est rejeté et un délai inconnu utilise une reprise bornée', () => {
  assert.equal(core.parseFreeStock('11/10 boosters gratuits'), null);
  assert.equal(core.nextWakeAt({ count: 0, seconds: null }, 1000), 31000);
});
