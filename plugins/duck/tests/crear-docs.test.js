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
// The same series in every layout; only the place and the changelog shape change.
// Folder and file names are English.
const SERIE = ['README.md', 'PRD.md', 'TECH-DESIGN.md', 'SECURITY.md', 'DEPLOY.md', 'adr/0000-template.md',
  'specs/README.md', 'templates/spec.md', 'templates/ai-agent.md', 'manuals/README.md', 'ai/README.md',
  'ai/agents', 'ai/install-agents.sh', 'ai/install-agents.ps1', 'guides/README.md', 'conventions/README.md', 'odd'];
const repo = (d) => fs.mkdirSync(path.join(d, '.git'), { recursive: true });
const correr = (cwd, ...args) => {
  const r = spawnSync('node', [SCRIPT, ...args], { cwd, encoding: 'utf8' });
  return { ...r, json: r.stdout ? JSON.parse(r.stdout) : null };
};

test('mono-repo: docs/ dentro del repo', () => {
  const d = tmp(); repo(d);
  const r = correr(d);
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.json.layout, 'mono-repo');
  for (const f of [...SERIE, 'CHANGELOG.md']) {
    assert.ok(fs.existsSync(path.join(d, 'docs', f)), f);
  }
  assert.ok(r.json.creados.includes('docs/README.md'));
});

test('mono-repo con workspaces (pnpm-workspace.yaml): mismo layout, docs/ en la raiz', () => {
  const d = tmp(); repo(d);
  fs.writeFileSync(path.join(d, 'pnpm-workspace.yaml'), 'packages: []\n');
  const r = correr(d);
  assert.strictEqual(r.json.layout, 'mono-repo');
  for (const f of [...SERIE, 'CHANGELOG.md']) {
    assert.ok(fs.existsSync(path.join(d, 'docs', f)), f);
  }
});

test('multi-repo sin carpeta de docs: crea docs/ hermana (no doc/) con la serie y changelog/<repo>.md', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, 'api', '.git'), { recursive: true });
  fs.mkdirSync(path.join(d, 'web', '.git'), { recursive: true });
  const r = correr(d);
  assert.strictEqual(r.json.layout, 'multi-repo');
  for (const f of [...SERIE, 'changelog/api.md', 'changelog/web.md', 'repositories.md']) {
    assert.ok(fs.existsSync(path.join(d, 'docs', f)), f);
  }
  assert.ok(!fs.existsSync(path.join(d, 'doc')));
});

test('multi-repo con docs/ existente: la usa y no la trata como repo de codigo', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, 'api', '.git'), { recursive: true });
  fs.mkdirSync(path.join(d, 'docs', '.git'), { recursive: true });
  const r = correr(d, '--dry-run');
  assert.strictEqual(r.json.destino, 'docs');
  assert.ok(r.json.creados.includes('docs/changelog/api.md'));
  assert.ok(!r.json.creados.some((c) => /changelog\/docs?\.md$/.test(c)));
  assert.ok(!r.json.creados.some((c) => c.startsWith('doc/')));
  assert.deepStrictEqual(r.json.advertencias, []);
});

test('multi-repo con doc/ existente (nombre viejo): la usa, sin changelog/doc.md, y avisa el git mv', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, 'api', '.git'), { recursive: true });
  fs.mkdirSync(path.join(d, 'doc', '.git'), { recursive: true });
  const r = correr(d);
  assert.strictEqual(r.json.destino, 'doc');
  assert.ok(fs.existsSync(path.join(d, 'doc', 'changelog', 'api.md')));
  assert.ok(!fs.existsSync(path.join(d, 'doc', 'changelog', 'doc.md')));
  assert.ok(!fs.existsSync(path.join(d, 'docs')));
  assert.ok(r.json.advertencias.some((a) => /git mv doc docs/.test(a)));
});

const duck = (d, cfg) => {
  fs.mkdirSync(path.join(d, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(d, '.claude', 'duck.json'), JSON.stringify(cfg));
};

test('duck.json docs: la serie va a esa ruta, aunque este fuera del repo', () => {
  const madre = tmp();
  const d = path.join(madre, 'app'); repo(d);
  duck(d, { docs: '../app.docs' });
  const r = correr(d);
  assert.strictEqual(r.json.destino, '../app.docs');
  assert.ok(fs.existsSync(path.join(madre, 'app.docs', 'PRD.md')));
  assert.ok(fs.existsSync(path.join(madre, 'app.docs', 'CHANGELOG.md')));
  assert.ok(!fs.existsSync(path.join(d, 'docs')));
});

test('duck.json docs elegido como doc: se respeta sin avisar el rename', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, 'api', '.git'), { recursive: true });
  fs.mkdirSync(path.join(d, 'doc', '.git'), { recursive: true });
  duck(d, { docs: 'doc' });
  const r = correr(d, '--dry-run');
  assert.strictEqual(r.json.destino, 'doc');
  assert.ok(!r.json.advertencias.some((a) => /git mv/.test(a)));
});

test('duck.json git.repos: changelog solo de los repos listados, nunca de la carpeta de docs', () => {
  const d = tmp();
  for (const r of ['api', 'web', 'base_conocimiento', 'docs']) fs.mkdirSync(path.join(d, r, '.git'), { recursive: true });
  duck(d, { git: { repos: { api: 'api', web: 'web', docs: 'app-docs' } } });
  const r = correr(d, '--dry-run');
  const changelogs = r.json.creados.filter((c) => c.includes('/changelog/')).sort();
  assert.deepStrictEqual(changelogs, ['docs/changelog/api.md', 'docs/changelog/web.md']);
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

test('multi-repo: avisa si docs/ no es un repo git', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, 'api', '.git'), { recursive: true });
  let r = correr(d);
  assert.ok(r.json.advertencias.some((a) => /git/.test(a)));
  repo(path.join(d, 'docs'));
  r = correr(d);
  assert.deepStrictEqual(r.json.advertencias, []);
});

test('sin repo ni subrepos: sale con error y no crea nada', () => {
  const d = tmp();
  const r = correr(d);
  assert.strictEqual(r.status, 1);
  assert.deepStrictEqual(fs.readdirSync(d), []);
});

test('plantillas en ingles: README indice y ADR con la linea Status que lee guard-adr', () => {
  const d = tmp(); repo(d);
  correr(d);
  assert.match(fs.readFileSync(path.join(d, 'docs', 'README.md'), 'utf8'), /^# Documentation/);
  assert.match(fs.readFileSync(path.join(d, 'docs', 'adr', '0000-template.md'), 'utf8'), /^- Status: Proposed/m);
  for (const f of SERIE.filter((f) => f.endsWith('.md'))) {
    assert.doesNotMatch(fs.readFileSync(path.join(d, 'docs', f), 'utf8'), /guias|manuales|convenciones|plantillas|agentes|\bia\//, f);
  }
});

test('carpeta vieja en espanol: no crea la duplicada en ingles y avisa el rename', () => {
  const d = tmp(); repo(d);
  fs.mkdirSync(path.join(d, 'docs', 'guias'), { recursive: true });
  fs.mkdirSync(path.join(d, 'docs', 'ia', 'agentes'), { recursive: true });
  const r = correr(d);
  assert.ok(!fs.existsSync(path.join(d, 'docs', 'guides')));
  assert.ok(!fs.existsSync(path.join(d, 'docs', 'ai')));
  assert.ok(!r.json.creados.some((c) => /docs\/(guides|ai)\//.test(c)));
  assert.ok(r.json.advertencias.some((a) => /docs\/guias.*docs\/guides/.test(a)));
  assert.ok(r.json.advertencias.some((a) => /docs\/ia\b.*docs\/ai\b/.test(a)));
  assert.ok(fs.existsSync(path.join(d, 'docs', 'manuals', 'README.md')), 'the rest of the series is still created');
});

// ai/agents is the versioned source; the installer copies it to <root>/.claude/agents, where Claude reads it.
for (const layout of ['mono-repo', 'multi-repo']) {
  test(`install-agents.sh (${layout}): copia ai/agents a .claude/agents de la raiz y refresca`, () => {
    const d = tmp();
    if (layout === 'mono-repo') repo(d); else fs.mkdirSync(path.join(d, 'api', '.git'), { recursive: true });
    const ia = path.join(d, 'docs', 'ai');
    correr(d);
    const instalar = () => spawnSync('sh', [path.join(ia, 'install-agents.sh')], { cwd: os.tmpdir(), encoding: 'utf8' });
    const copia = path.join(d, '.claude', 'agents', 'seguridad.md');

    fs.writeFileSync(path.join(ia, 'agents', 'seguridad.md'), 'v1\n');
    let r = instalar();
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(fs.readFileSync(copia, 'utf8'), 'v1\n');
    assert.match(r.stdout, /new\s+seguridad\.md/);
    assert.ok(!fs.existsSync(path.join(d, '.claude', 'agents', '.gitkeep')), 'only .md agents are copied');

    fs.writeFileSync(path.join(ia, 'agents', 'seguridad.md'), 'v2\n');
    r = instalar();
    assert.strictEqual(fs.readFileSync(copia, 'utf8'), 'v2\n');
    assert.match(r.stdout, /updated\s+seguridad\.md/);
    assert.match(instalar().stdout, /unchanged\s+seguridad\.md/);
  });
}
