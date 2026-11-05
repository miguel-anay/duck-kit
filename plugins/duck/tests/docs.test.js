const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// --- the README hook table is the inventory: hooks.json may not run a script it does not list ---

test('the plugin README lists every script hooks.json runs', () => {
  const leer = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
  const scripts = [...new Set(leer('hooks', 'hooks.json').match(/scripts\/[\w-]+\.js/g))];
  const readme = leer('README.md');
  assert.deepEqual(scripts.filter((s) => !readme.includes(s)), []);
});
