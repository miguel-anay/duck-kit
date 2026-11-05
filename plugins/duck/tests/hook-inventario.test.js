// Run: node --test plugins/duck/tests/*.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { GITHUB, JIRA, proyecto, correr, contexto, git, repo, mover, merge, commit } = require('./helpers');

// --- inventario ---

test('inventario (github) maps #N keys to branches and to Refs/Closes/(#N) or merge-from-branch in the base', () => {
  const raiz = proyecto(GITHUB);
  repo(raiz, 'main', [
    'feat: a\n\nRefs #13',
    'fix: b (#14)',
    'Merge pull request #28 from org/fix/27-x',
    'chore: c\n\nmenciona #15 al pasar',
  ]);
  git(raiz, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(raiz, 'checkout', '-q', '-b', 'feat/12-login');
  fs.writeFileSync(path.join(raiz, 'wip.txt'), 'wip');
  git(raiz, 'add', 'wip.txt');
  git(raiz, 'commit', '-q', '-m', 'wip');
  const r = correr('inventario.js', raiz, {}, { args: ['--claves', '#12,org/app#13,#14,#27,#28,#15'] });
  const c = JSON.parse(r.stdout).claves;
  assert.equal(c['#12'].ubicacion, 'rama');
  assert.equal(c['org/app#13'].ubicacion, 'develop');
  assert.equal(c['#14'].ubicacion, 'develop');
  assert.equal(c['#27'].ubicacion, 'develop');
  assert.equal(c['#28'].ubicacion, 'sin-rama');
  assert.equal(c['#15'].ubicacion, 'sin-rama');
  const todo = JSON.parse(correr('inventario.js', raiz, {}).stdout);
  assert.equal(todo.repos['.'].clave, '#12');
  assert.deepEqual(Object.keys(todo.ramasPorClave), ['#12']);
});

test('inventario (github) recognizes every GitHub closing keyword, case-insensitively', () => {
  const raiz = proyecto(GITHUB);
  const palabras = ['close', 'closed', 'fix', 'FIXES', 'fixed', 'resolve', 'Resolves', 'resolved'];
  repo(raiz, 'main', palabras.map((p, i) => `feat: x\n\n${p} #${20 + i}`));
  git(raiz, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  const claves = palabras.map((_, i) => `#${20 + i}`);
  const c = JSON.parse(correr('inventario.js', raiz, {}, { args: ['--claves', claves.join(',')] }).stdout).claves;
  for (const k of claves) assert.equal(c[k].ubicacion, 'develop', k);
});

test('inventario (jira) still maps keys by scope and merge subject', () => {
  const raiz = proyecto(JIRA);
  repo(raiz, 'main', ['feat(ABC-3): x']);
  git(raiz, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(raiz, 'checkout', '-q', '-b', 'feature/ABC-1-x');
  fs.writeFileSync(path.join(raiz, 'wip.txt'), 'wip');
  git(raiz, 'add', 'wip.txt');
  git(raiz, 'commit', '-q', '-m', 'wip');
  const c = JSON.parse(correr('inventario.js', raiz, {}, { args: ['--claves', 'ABC-1,ABC-3,#4'] }).stdout).claves;
  assert.deepEqual(Object.keys(c), ['ABC-1', 'ABC-3']);
  assert.equal(c['ABC-1'].ubicacion, 'rama');
  assert.equal(c['ABC-3'].ubicacion, 'develop');
});

test('historia-sigue-subtareas (github) is switched by github.historiaSigueSubtareas, not the jira flag', () => {
  const evento = mover('Issue (org/app#12) movido a (In Progress)\n');
  const conJira = proyecto({ ...GITHUB, jira: { historiaSigueSubtareas: false } });
  assert.match(contexto(correr('historia-sigue-subtareas.js', conJira, evento)), /org\/app#12 paso a In Progress/);
  const apagado = proyecto({ ...GITHUB, github: { historiaSigueSubtareas: false } });
  assert.equal(correr('historia-sigue-subtareas.js', apagado, evento).stdout, '');
});

test('inventario (github) matches owner/repo#N against git.repos regardless of case', () => {
  const raiz = proyecto({ ...GITHUB, git: { ...GITHUB.git, repos: { '.': 'App' } } });
  repo(raiz, 'main', ['feat: a\n\nRefs #13']);
  git(raiz, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  const c = JSON.parse(correr('inventario.js', raiz, {}, { args: ['--claves', 'org/app#13'] }).stdout).claves;
  assert.equal(c['org/app#13'].ubicacion, 'develop');
});

test('inventario (github) --claves takes mixed-case owner/repo#N under its canonical lowercase key', () => {
  const raiz = proyecto({ ...GITHUB, git: { ...GITHUB.git, repos: { '.': 'app' } } });
  repo(raiz, 'main', ['feat: a\n\nRefs #13']);
  git(raiz, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  const c = JSON.parse(correr('inventario.js', raiz, {}, { args: ['--claves', 'Org/App#13'] }).stdout).claves;
  assert.deepEqual(Object.keys(c), ['org/app#13']);
  assert.equal(c['org/app#13'].ubicacion, 'develop');
});

test('sesion-inicio (odd) default keeps the local, unversioned execution log', () => {
  const raiz = proyecto({ ...JIRA, odd: { tareas: 'odd/tasks' } });
  const texto = contexto(correr('sesion-inicio.js', raiz, {}));
  assert.match(texto, /local y sin versionar/);
  assert.match(texto, /<feature> es su clave/);
  assert.match(texto, /single-pr/);
  assert.match(texto, /duck:escritor/);
});

test('sesion-inicio (odd.versionado) treats the feature document as versioned and archived', () => {
  const raiz = proyecto({ ...JIRA, odd: { tareas: 'doc/odd/tasks', versionado: true } });
  const texto = contexto(correr('sesion-inicio.js', raiz, {}));
  assert.match(texto, /versionado en el repositorio que contiene esa carpeta/);
  assert.match(texto, /se archiva, no se descarta/);
  assert.doesNotMatch(texto, /sin versionar/);
  assert.doesNotMatch(texto, /<feature> es su clave/);
  assert.doesNotMatch(texto, /single-pr/);
  assert.match(texto, /duck:escritor/);
});
