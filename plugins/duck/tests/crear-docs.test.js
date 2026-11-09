// Tests de la skill estructura-docs: detecta el layout y crea la carpeta de docs sin pisar nada.
const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'skills', 'estructura-docs', 'scripts', 'crear-docs.js');
const temporales = [];
afterEach(() => { while (temporales.length) fs.rmSync(temporales.pop(), { recursive: true, force: true }); });

function tmp() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'duck-docs-'));
  temporales.push(d);
  return d;
}
const repo = (d) => fs.mkdirSync(path.join(d, '.git'), { recursive: true });
const correr = (cwd, ...args) => {
  const r = spawnSync('node', [SCRIPT, ...args], { cwd, encoding: 'utf8' });
  return { ...r, json: r.stdout ? JSON.parse(r.stdout) : null };
};

test('repo chico sin workspaces: docs/ dentro del repo', () => {
  const d = tmp(); repo(d);
  const r = correr(d);
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.json.layout, 'repo');
  for (const f of ['README.md', 'PRD.md', 'TECH-DESIGN.md', 'SECURITY.md', 'DEPLOY.md', 'CHANGELOG.md', 'adr/0000-plantilla.md']) {
    assert.ok(fs.existsSync(path.join(d, 'docs', f)), f);
  }
  assert.ok(r.json.creados.includes('docs/README.md'));
});

test('monorepo (pnpm-workspace.yaml): docs/ en la raiz con la serie completa', () => {
  const d = tmp(); repo(d);
  fs.writeFileSync(path.join(d, 'pnpm-workspace.yaml'), 'packages: []\n');
  const r = correr(d);
  assert.strictEqual(r.json.layout, 'monorepo');
  for (const f of ['README.md', 'PRD.md', 'TECH-DESIGN.md', 'SECURITY.md', 'DEPLOY.md', 'CHANGELOG.md', 'adr/0000-plantilla.md']) {
    assert.ok(fs.existsSync(path.join(d, 'docs', f)), f);
  }
});

test('conjunto de repos: doc/ hermana con adr, changelog/<repo>.md, convenciones y odd', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, 'api', '.git'), { recursive: true });
  fs.mkdirSync(path.join(d, 'web', '.git'), { recursive: true });
  const r = correr(d);
  assert.strictEqual(r.json.layout, 'multi-repo');
  for (const f of ['README.md', 'adr/0000-plantilla.md', 'changelog/api.md', 'changelog/web.md', 'convenciones', 'odd']) {
    assert.ok(fs.existsSync(path.join(d, 'doc', f)), f);
  }
});

test('conjunto de repos: el repo doc/ no lleva changelog propio', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, 'api', '.git'), { recursive: true });
  fs.mkdirSync(path.join(d, 'doc', '.git'), { recursive: true });
  const r = correr(d, '--dry-run');
  assert.ok(r.json.creados.includes('doc/changelog/api.md'));
  assert.ok(!r.json.creados.includes('doc/changelog/doc.md'));
});

test('nunca pisa un archivo existente', () => {
  const d = tmp(); repo(d);
  fs.mkdirSync(path.join(d, 'docs'));
  fs.writeFileSync(path.join(d, 'docs', 'README.md'), 'mio');
  const r = correr(d);
  assert.strictEqual(fs.readFileSync(path.join(d, 'docs', 'README.md'), 'utf8'), 'mio');
  assert.ok(r.json.existentes.includes('docs/README.md'));
  assert.ok(!r.json.creados.includes('docs/README.md'));
  assert.ok(fs.existsSync(path.join(d, 'docs', 'CHANGELOG.md')));
});

test('--dry-run informa el plan y no escribe nada', () => {
  const d = tmp(); repo(d);
  const r = correr(d, '--dry-run');
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.json.dryRun, true);
  assert.ok(r.json.creados.length > 0);
  assert.ok(!fs.existsSync(path.join(d, 'docs')));
});

test('conjunto de repos: avisa si doc/ no es un repo git', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, 'api', '.git'), { recursive: true });
  let r = correr(d);
  assert.ok(r.json.advertencias.some((a) => /git/.test(a)));
  repo(path.join(d, 'doc'));
  r = correr(d);
  assert.deepStrictEqual(r.json.advertencias, []);
});

test('sin repo ni subrepos: sale con error y no crea nada', () => {
  const d = tmp();
  const r = correr(d);
  assert.strictEqual(r.status, 1);
  assert.deepStrictEqual(fs.readdirSync(d), []);
});
