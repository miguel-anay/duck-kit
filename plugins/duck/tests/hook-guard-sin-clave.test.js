// Run: node --test plugins/duck/tests/*.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { temporales, GITHUB, JIRA, proyecto, correr, git, repo } = require('./helpers');

// --- guard-sin-clave ---

const negadoPor = (r) => (r.stdout ? JSON.parse(r.stdout).hookSpecificOutput?.permissionDecision === 'deny' : false);
const crear = (raiz, command) => ({ session_id: 's1', tool_name: 'Bash', cwd: raiz, tool_input: { command } });

test('guard-sin-clave blocks a work branch created without /duck:tomar', () => {
  const raiz = proyecto({ ...GITHUB, git: { ...GITHUB.git, repos: { app: 'org/app' } } });
  fs.mkdirSync(path.join(raiz, 'app'));
  for (const c of [
    'git -C app switch -c feat/whatsapp-land',
    'git -C app switch -c feat/11-whatsapp-land',
    'git -C app checkout -b fix/12-x',
    'cd app && git worktree add ../w -b feat/13-y',
  ]) {
    const r = correr('guard-sin-clave.js', raiz, crear(raiz, c));
    assert.ok(negadoPor(r), c);
    assert.match(JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason, /modo tarea.*modo flujo/s);
  }
});

test('guard-sin-clave lets /duck:tomar, spikes, other git commands and folders outside the repos through', () => {
  const raiz = proyecto({ ...GITHUB, git: { ...GITHUB.git, repos: { app: 'org/app' } } });
  fs.mkdirSync(path.join(raiz, 'app'));
  for (const c of [
    'DUCK_MODO=tarea git -C app switch -c feat/11-whatsapp-land',
    'DUCK_MODO=flujo git -C app switch -c fix/12-x',
    'git -C app switch -c spike/probar-algo',
    'git -C app switch main',
    'git -C app checkout -- archivo.php',
    'git -C otro switch -c cualquier-cosa',
  ]) {
    assert.ok(!negadoPor(correr('guard-sin-clave.js', raiz, crear(raiz, c))), c);
  }
});

test('guard-sin-clave (jira) needs the key and the mode marker too', () => {
  const raiz = proyecto(JIRA);
  assert.ok(negadoPor(correr('guard-sin-clave.js', raiz, crear(raiz, 'git switch -c feature/arreglo'))));
  assert.ok(negadoPor(correr('guard-sin-clave.js', raiz, crear(raiz, 'git switch -c feature/ABC-5-x'))));
  assert.ok(!negadoPor(correr('guard-sin-clave.js', raiz, crear(raiz, 'DUCK_MODO=tarea git switch -c feature/ABC-5-x'))));
});

test('guard-sin-clave (single-repo project) ignores repos outside the root and checks the marker itself', () => {
  const raiz = proyecto(GITHUB);
  const fuera = fs.mkdtempSync(path.join(os.tmpdir(), 'duck-fuera-'));
  temporales.push(fuera);
  assert.ok(!negadoPor(correr('guard-sin-clave.js', raiz, crear(raiz, `git -C ${fuera} switch -c cualquier-cosa`))));
  for (const c of [
    'DUCK_MODO=otro git switch -c feat/11-x',
    'DUCK_MODO=tarea true && git switch -c feat/11-x',
    'git switch --create=feat/11-x',
  ]) {
    assert.ok(negadoPor(correr('guard-sin-clave.js', raiz, crear(raiz, c))), c);
  }
});
