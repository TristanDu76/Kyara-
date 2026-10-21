'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function fixture(frame = false, namespace = 'chrome') {
  const listeners = {}, sent = [], posted = [];
  const window = { addEventListener(type, fn) { listeners[type] = fn; }, postMessage(value, origin) { posted.push({ value, origin }); } };
  window.top = frame ? {} : window;
  const chrome = { runtime: {
    sendMessage(value) { sent.push(value); return Promise.resolve(); },
    onMessage: { addListener(fn) { listeners.runtime = fn; } },
  } };
  const context = { window, [namespace]: chrome, location: { origin: 'https://kyara.games' } };
  if (namespace === 'browser') context.chrome = new Proxy({}, { get() { throw new Error('API chrome utilisée sur Firefox'); } });
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'bridge.js'), 'utf8'), context);
  return { listeners, sent, posted, window };
}
test('le pont refuse les autres fenêtres et origines', () => {
  const f = fixture(); const initial = f.sent.length;
  const data = { channel: 'kyara-plus:booster-alarm', type: 'schedule', when: 5000 };
  f.listeners.message({ source: {}, origin: 'https://kyara.games', data });
  f.listeners.message({ source: f.window, origin: 'https://example.com', data });
  assert.equal(f.sent.length, initial);
  f.listeners.message({ source: f.window, origin: 'https://kyara.games', data });
  assert.equal(f.sent.length, initial + 1); assert.equal(f.sent.at(-1).when, 5000);
});

test('Firefox utilise browser et transmet la programmation puis le réveil', () => {
  const f = fixture(false, 'browser');
  assert.equal(f.sent[0].type, 'ready');
  f.listeners.message({ source: f.window, origin: 'https://kyara.games', data: { channel: 'kyara-plus:booster-alarm', type: 'schedule', when: 5000 } });
  assert.equal(f.sent.at(-1).when, 5000);
  f.listeners.runtime({ channel: 'kyara-plus:booster-alarm', type: 'wake' });
  assert.equal(f.posted[0].value.type, 'wake');
  assert.equal(Object.keys(fixture(true, 'browser').listeners).length, 0);
});
test('le réveil est transmis à la page et le pont reste absent des iframes', () => {
  const f = fixture();
  f.listeners.runtime({ channel: 'kyara-plus:booster-alarm', type: 'wake' });
  assert.equal(f.posted.length, 1); assert.equal(f.posted[0].value.type, 'wake');
  assert.equal(f.posted[0].origin, 'https://kyara.games');
  const frame = fixture(true); assert.equal(Object.keys(frame.listeners).length, 0);
});
