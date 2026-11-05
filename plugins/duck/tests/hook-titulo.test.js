// Run: node --test plugins/duck/tests/*.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { GITHUB, JIRA, proyecto, correr, repo, escribirSesion } = require('./helpers');

// --- titulo ---

test('titulo (github) shows recorded and branch #N keys with GitHub states', () => {
  const raiz = proyecto(GITHUB);
  repo(raiz, 'feat/12-login');
  escribirSesion(raiz, 's1', { tareas: { 'org/app#7': { estado: 'In Progress', desde: new Date().toISOString() } } });
  const r = correr('titulo.js', raiz, { session_id: 's1', cwd: raiz }, { env: { TITULO_DEBUG: '1' } });
  assert.match(r.stdout, /org\/app#7 \*  #12 ~/);
});

test('titulo (jira) still shows the branch key', () => {
  const raiz = proyecto(JIRA);
  repo(raiz, 'feature/ABC-1-x');
  const r = correr('titulo.js', raiz, { session_id: 's1', cwd: raiz }, { env: { TITULO_DEBUG: '1' } });
  assert.match(r.stdout, /ABC-1 ~/);
});
