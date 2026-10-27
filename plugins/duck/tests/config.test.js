// Run: node --test plugins/duck/tests/*.test.js
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { cargar, claveDeRama, clavesEnTexto } = require('../scripts/config');

const temporales = [];

// Loads the config from a throwaway project whose duck.json is `contenido`.
function cargarCon(contenido) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'duck-config-'));
  temporales.push(raiz);
  fs.mkdirSync(path.join(raiz, '.claude'));
  fs.writeFileSync(path.join(raiz, '.claude', 'duck.json'), JSON.stringify(contenido));
  process.env.CLAUDE_PROJECT_DIR = raiz;
  return cargar();
}

afterEach(() => {
  delete process.env.CLAUDE_PROJECT_DIR;
  while (temporales.length) fs.rmSync(temporales.pop(), { recursive: true, force: true });
});

const GITHUB = { tickets: { proveedor: 'github' }, git: { prefijos: ['feat', 'fix'] } };

// Regression: Jira behavior before the provider existed.

test('without tickets section the provider is jira and any ABC-123 key matches', () => {
  const cfg = cargarCon({});
  assert.equal(cfg.tickets.proveedor, 'jira');
  assert.match('feature/ABC-123-slug', cfg.jira.reClave);
  assert.match('PROY-7', cfg.jira.reClaveExacta);
  assert.doesNotMatch('feature/123-slug', cfg.jira.reClave);
});

test('jira.proyecto restricts the key to that project', () => {
  const cfg = cargarCon({ jira: { proyecto: 'PROY' } });
  assert.equal(cfg.jira.claveFuente, 'PROY-\\d+');
  assert.match('PROY-618', cfg.jira.reClaveExacta);
  assert.doesNotMatch('ABC-618', cfg.jira.reClave);
});

test('jira keys from branch and text use the jira pattern', () => {
  const cfg = cargarCon({ jira: { proyecto: 'PROY' } });
  assert.equal(claveDeRama('feature/PROY-12-login', cfg), 'PROY-12');
  assert.equal(claveDeRama('feat/12-login', cfg), null);
  assert.deepEqual(clavesEnTexto('feat(PROY-3): x, see PROY-4 and PROY-3', cfg), ['PROY-3', 'PROY-4']);
});

test('an unknown provider is treated as jira', () => {
  const cfg = cargarCon({ tickets: { proveedor: 'linear' } });
  assert.equal(cfg.tickets.proveedor, 'jira');
});

// GitHub provider: native convention (#N, owner/repo#N, branches prefix/N-slug).

test('github provider exposes its section with defaults', () => {
  const cfg = cargarCon(GITHUB);
  assert.equal(cfg.tickets.proveedor, 'github');
  assert.equal(cfg.github.campoEstado, 'Status');
  assert.deepEqual(cfg.github.proyecto, { owner: null, numero: null });
});

test('the provider name is case-insensitive', () => {
  assert.equal(cargarCon({ tickets: { proveedor: 'GitHub' } }).tickets.proveedor, 'github');
});

test('github branch key is the issue number after a known prefix', () => {
  const cfg = cargarCon(GITHUB);
  assert.equal(claveDeRama('feat/123-hide-edit', cfg), '#123');
  assert.equal(claveDeRama('fix/7', cfg), '#7');
  assert.equal(claveDeRama('release/2026-10', cfg), null);
  assert.equal(claveDeRama('feat/no-number', cfg), null);
  assert.equal(claveDeRama('main', cfg), null);
  assert.equal(claveDeRama(null, cfg), null);
});

test('github text keys are #N and owner/repo#N, unique, in order', () => {
  const cfg = cargarCon(GITHUB);
  assert.deepEqual(
    clavesEnTexto('fix(sire): harden (#23)\n\nRefs #23\nParent: factufacil-pe/factufacil-docs#12', cfg),
    ['#23', 'factufacil-pe/factufacil-docs#12']
  );
  assert.deepEqual(clavesEnTexto('color: a&#123; x#5 ABC-1', cfg), []);
});
