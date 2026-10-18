'use strict';

const assert = require('node:assert/strict');
const core = require('../booster-core.js');

assert.deepEqual(core.parseFreeStock('5/10 boosters gratuits'), { count: 5, max: 10 });
assert.deepEqual(core.parseFreeStock('5 boosters gratuits sur 10'), { count: 5, max: 10 });
assert.equal(core.parseFreeStock('Gratuit · 5 restants'), null);
assert.equal(core.freeCountInButton('Ouvrir Gratuit · 5 restants'), 5);
assert.equal(core.freeCountInButton('Ouvrir 150 ◆'), null);
assert.equal(core.routeFor('shonen'), '/ouvrir/shonen');
assert.throws(() => core.routeFor('payant'), /invalide/);
assert.equal(core.nextWakeAt({ count: 0, seconds: 600 }, 1000), 601750);
assert.equal(core.nextWakeAt({ count: 1, seconds: 600 }, 1000), 1000);

console.log('booster-core : OK');
