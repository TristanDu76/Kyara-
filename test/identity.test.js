'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
test('un onglet dupliqué ne copie pas l’identité du pilote', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'kyara-plus.js'), 'utf8');
  const declaration = source.slice(source.indexOf('  const TAB_ID ='), source.indexOf('  const TIMING ='));
  const copied = new Map([['kp-tab-id', 'original-tab']]);
  let id = 0;
  const environment = {
    crypto: { randomUUID: () => `document-${++id}` },
    sessionStorage: { getItem: (key) => copied.get(key), setItem: (key, value) => copied.set(key, value) },
  };
  const original = vm.runInNewContext(declaration + '\nTAB_ID;', { ...environment });
  const duplicated = vm.runInNewContext(declaration + '\nTAB_ID;', { ...environment });
  assert.notEqual(original, duplicated);
});
