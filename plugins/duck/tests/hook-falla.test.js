// Run: node --test plugins/duck/tests/*.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { SCRIPTS, GITHUB, proyecto } = require('./helpers');

// --- a hook that throws fails open, but says so ---

test('a hook that throws lets the command through and tells the person it checked nothing', () => {
  const raiz = proyecto(GITHUB);
  const script = path.join(raiz, 'roto.js');
  fs.writeFileSync(script, `require(${JSON.stringify(path.join(SCRIPTS, 'config.js'))}).hook(() => { throw new Error('boom'); });\n`);
  const r = spawnSync('node', [script], { input: '{}', cwd: raiz, env: { ...process.env, CLAUDE_PROJECT_DIR: raiz }, encoding: 'utf8' });
  assert.equal(r.status, 0);
  const salida = JSON.parse(r.stdout);
  assert.match(salida.systemMessage, /roto\.js falló \(boom\)/);
  assert.equal(salida.hookSpecificOutput, undefined);
});
