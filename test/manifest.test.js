'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));

assert.equal(manifest.manifest_version, 3);
const runtime = fs.readFileSync(path.join(__dirname, '..', 'kyara-plus.js'), 'utf8');
assert.ok(runtime.includes(`const VERSION = '${manifest.version}'`), 'version identique dans le manifeste et le panneau');
assert.equal(manifest.background.service_worker, 'service-worker.js');
assert.deepEqual(manifest.permissions, ['alarms', 'storage']);
assert.deepEqual(manifest.content_scripts[0].js, ['bridge.js']);
assert.deepEqual(manifest.content_scripts[1].js, ['booster-core.js', 'kyara-plus.js']);
assert.deepEqual(manifest.content_scripts[0].css, ['panel.css']);
for (const script of manifest.content_scripts) {
  for (const asset of [...script.js, ...(script.css || [])]) assert.equal(fs.existsSync(path.join(__dirname, '..', asset)), true);
}

console.log('manifest : OK');
