// Run: node --test plugins/duck/tests/
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { cargar } = require('../scripts/config');

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

// GitHub provider.

test('github prefixes define the key and map to their repos', () => {
  const cfg = cargarCon({
    tickets: { proveedor: 'github' },
    github: { prefijos: { GH: 'org/repo', API: 'org/api' } },
  });
  assert.equal(cfg.tickets.proveedor, 'github');
  assert.match('feature/GH-12-slug', cfg.jira.reClave);
  assert.match('API-3', cfg.jira.reClaveExacta);
  assert.doesNotMatch('ABC-1', cfg.jira.reClave);
  assert.deepEqual(cfg.github.prefijos, { GH: 'org/repo', API: 'org/api' });
  assert.equal(cfg.github.campoEstado, 'Status');
});

test('claveFuente composes inside larger expressions', () => {
  const cfg = cargarCon({ tickets: { proveedor: 'github' }, github: { prefijos: { GH: 'o/r', API: 'o/a' } } });
  const scope = new RegExp(`\\((${cfg.jira.claveFuente})\\)`);
  assert.equal('feat(API-9): x'.match(scope)[1], 'API-9');
  assert.doesNotMatch('x-API-9', new RegExp(`^${cfg.jira.claveFuente}$`));
});

test('invalid github prefixes are ignored', () => {
  const cfg = cargarCon({
    tickets: { proveedor: 'github' },
    github: { prefijos: { GH: 'org/repo', g: 'org/x', A1: 'org/y', X: 'org/z', BAD: 'no-slash' } },
  });
  assert.deepEqual(cfg.github.prefijos, { GH: 'org/repo' });
  assert.doesNotMatch('A1-3', cfg.jira.reClave);
});

test('github without valid prefixes falls back to any ABC-123 key', () => {
  const cfg = cargarCon({ tickets: { proveedor: 'github' } });
  assert.match('GH-1', cfg.jira.reClaveExacta);
});

test('an unknown provider is treated as jira', () => {
  const cfg = cargarCon({ tickets: { proveedor: 'linear' }, github: { prefijos: { GH: 'o/r' } } });
  assert.equal(cfg.tickets.proveedor, 'jira');
  assert.match('ABC-1', cfg.jira.reClaveExacta);
});
