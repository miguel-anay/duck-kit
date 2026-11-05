// Run: node --test plugins/duck/tests/*.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { GITHUB, JIRA, proyecto, correr, git, repo, escribirSesion } = require('./helpers');

// --- sticker ---

test('sticker (github) paints #N from the name, the branch and GitHub states', () => {
  const raiz = proyecto(GITHUB);
  repo(raiz, 'feat/12-login');
  escribirSesion(raiz, 's1', { tareas: { 'org/app#7': { estado: 'Done', desde: new Date().toISOString() } } });
  const r = correr('sticker.js', raiz, { session_id: 's1', session_name: '#9 detalle 618', cwd: raiz });
  for (const clave of ['org/app#7 v', '#9 #', '#12 ~']) assert.ok(r.stdout.includes(clave), clave);
  assert.ok(!r.stdout.includes('618'));
});

test('sticker (github) shows an issue once when state, name and branch name it differently', () => {
  const raiz = proyecto(GITHUB);
  repo(raiz, 'feat/12-login');
  git(raiz, 'remote', 'add', 'origin', 'git@github.com:org/app.git');
  escribirSesion(raiz, 's1', { tareas: { 'org/app#12': { estado: 'In Progress', desde: new Date().toISOString() } } });
  const r = correr('sticker.js', raiz, { session_id: 's1', session_name: '#12 login', cwd: raiz });
  assert.ok(r.stdout.includes('org/app#12 *'));
  assert.equal(r.stdout.split('#12').length - 1, 1, r.stdout);
});

test('sticker (jira) still completes bare numbers with jira.proyecto', () => {
  const raiz = proyecto({ ...JIRA, jira: { proyecto: 'PROY' } });
  const r = correr('sticker.js', raiz, { session_id: 's1', session_name: '618 detalle', cwd: raiz });
  assert.ok(r.stdout.includes('PROY-618 #'));
});
