// Run: node --test plugins/duck/tests/*.test.js
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { cargar, claveDeRama, clavesEnTexto, repoDe } = require('../scripts/config');

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

test('git.ramaBase defaults to main with GitHub and to develop with Jira; an explicit value wins', () => {
  assert.equal(cargarCon({ tickets: { proveedor: 'github' } }).git.ramaBase, 'main');
  assert.equal(cargarCon({}).git.ramaBase, 'develop');
  assert.equal(cargarCon({ tickets: { proveedor: 'github' }, git: { ramaBase: 'develop' } }).git.ramaBase, 'develop');
  assert.equal(cargarCon({ git: { ramaBase: 'main' } }).git.ramaBase, 'main');
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
  assert.equal(cfg.github.estados.backlog, 'Backlog'); // same default as the mod loader
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

// Canonical GitHub key: a bare #N resolves to owner/repo#N with the folder's origin, read from
// .git/config (no git spawn). Unknown repo keeps #N.

// A folder with a hand-written .git (HEAD + config with origin `url`, if any).
function carpetaGit(url) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duck-repo-'));
  temporales.push(dir);
  fs.mkdirSync(path.join(dir, '.git'));
  fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/feat/12-x\n');
  const origen = url ? `[remote "origin"]\n\turl = ${url}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n` : '';
  fs.writeFileSync(path.join(dir, '.git', 'config'), `[core]\n\tbare = false\n[remote "upstream"]\n\turl = https://github.com/otro/fork.git\n${origen}`);
  return dir;
}

test('repoDe reads an https origin from .git/config', () => {
  assert.equal(repoDe(carpetaGit('https://github.com/org/app.git')), 'org/app');
});

test('repoDe reads an ssh origin from a subfolder', () => {
  const dir = carpetaGit('git@github.com:org/app.git');
  fs.mkdirSync(path.join(dir, 'src'));
  assert.equal(repoDe(path.join(dir, 'src')), 'org/app');
});

test('repoDe follows a worktree to the main repo config', () => {
  const dir = carpetaGit(null);
  fs.rmSync(path.join(dir, '.git'), { recursive: true });
  const run = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  run('init', '-q', '-b', 'main');
  run('remote', 'add', 'origin', 'https://github.com/org/app');
  run('commit', '-q', '--allow-empty', '-m', 'x');
  run('worktree', 'add', '-q', '-b', 'feat/3-x', path.join(dir, 'wt'));
  assert.equal(repoDe(path.join(dir, 'wt')), 'org/app');
});

test('github keys from branch and text get the folder repo; owner/repo#N stays', () => {
  const cfg = cargarCon(GITHUB);
  const dir = carpetaGit('https://github.com/org/app.git');
  assert.equal(claveDeRama('feat/12-x', cfg, dir), 'org/app#12');
  assert.deepEqual(clavesEnTexto('Refs #12, org/app#12 and otro/docs#3', cfg, dir), ['org/app#12', 'otro/docs#3']);
});

test('without a GitHub origin the key stays #N', () => {
  const cfg = cargarCon(GITHUB);
  const dir = carpetaGit('https://gitlab.com/org/app.git');
  assert.equal(repoDe(dir), null);
  assert.equal(claveDeRama('feat/12-x', cfg, dir), '#12');
  assert.deepEqual(clavesEnTexto('Refs #12', cfg, path.join(os.tmpdir(), 'no-existe-duck')), ['#12']);
});

test('github keys lowercase owner/repo, as GitHub ignores its case', () => {
  const cfg = cargarCon(GITHUB);
  const dir = carpetaGit('https://github.com/Org/App.git');
  assert.equal(repoDe(dir), 'org/app');
  assert.equal(claveDeRama('feat/12-x', cfg, dir), 'org/app#12');
  assert.deepEqual(clavesEnTexto('Refs Org/App#12 and #12', cfg, dir), ['org/app#12']);
});

test('jira keys ignore the folder', () => {
  const cfg = cargarCon({});
  const dir = carpetaGit('https://github.com/org/app.git');
  assert.equal(claveDeRama('feature/ABC-1-x', cfg, dir), 'ABC-1');
  assert.deepEqual(clavesEnTexto('ABC-1 #2', cfg, dir), ['ABC-1']);
});

// --- trabajo: the project's own work unit (#42) ---

const SPEC = {
  jira: { proyecto: 'GPDEV' },
  git: { prefijos: ['feature', 'fix', 'hotfix', 'refactor'] },
  trabajo: { id: 'spec', clave: 'SPEC-{NNN}', rama: '{tipo}/spec-{NNN}-{slug}', fuente: 'docs/specs/{NNN}-{slug}/spec.md' },
};

test('trabajo: the branch key is built from the clave template', () => {
  const cfg = cargarCon(SPEC);
  assert.equal(claveDeRama('feature/spec-002-base-servicio-cavali', cfg), 'SPEC-002');
  assert.equal(claveDeRama('refactor/spec-17-x', cfg), 'SPEC-17');
  assert.equal(claveDeRama('feature/foo', cfg), null);
  assert.equal(claveDeRama('chore/spec-002-x', cfg), null); // {tipo} is git.prefijos
  assert.equal(claveDeRama('feature/GPDEV-12-x', cfg), null); // the Jira key is not the unit key
  assert.equal(claveDeRama('feature/spec-002', cfg), null); // {slug} is required by the template
});

test('trabajo: text keys follow the clave template', () => {
  const cfg = cargarCon(SPEC);
  assert.deepEqual(clavesEnTexto('SPEC-002: add base, see SPEC-3 and SPEC-002', cfg), ['SPEC-002', 'SPEC-3']);
  assert.deepEqual(clavesEnTexto('GPDEV-12 #4', cfg), []);
});

test('trabajo: the Jira tracker key stays on jira', () => {
  const cfg = cargarCon(SPEC);
  assert.equal(cfg.jira.reClaveExacta.test('GPDEV-12'), true);
  assert.equal(cfg.jira.reClaveExacta.test('SPEC-002'), false);
  assert.equal(cfg.trabajo.reClaveExacta.test('SPEC-002'), true);
});

test('trabajo: {clave} in the branch template', () => {
  const cfg = cargarCon({ ...SPEC, trabajo: { clave: 'SPEC-{NNN}', rama: '{tipo}/{clave}-{slug}' } });
  assert.equal(claveDeRama('fix/SPEC-9-login', cfg), 'SPEC-9');
  assert.equal(claveDeRama('fix/spec-9-login', cfg), null);
});

test('trabajo: an unknown placeholder disables it and keeps the provider key', () => {
  const cfg = cargarCon({ ...SPEC, trabajo: { ...SPEC.trabajo, rama: '{tipo}/{foo}-{NNN}' } });
  assert.equal(cfg.trabajo.propio, false);
  assert.match(cfg.trabajo.error, /\{foo\}/);
  assert.equal(claveDeRama('feature/GPDEV-12-x', cfg), 'GPDEV-12');
  assert.equal(claveDeRama('feature/spec-002-x', cfg), null);
});

test('trabajo: a branch template without {NNN} or {clave} is rejected', () => {
  const cfg = cargarCon({ ...SPEC, trabajo: { clave: 'SPEC-{NNN}', rama: '{tipo}/{slug}' } });
  assert.equal(cfg.trabajo.propio, false);
  assert.match(cfg.trabajo.error, /\{NNN\}/);
});

test('without trabajo the unit key is the provider key, as before', () => {
  const jira = cargarCon({ jira: { proyecto: 'PROY' } });
  assert.equal(jira.trabajo.propio, false);
  assert.equal(jira.trabajo.error, null);
  assert.equal(claveDeRama('feature/PROY-12-login', jira), 'PROY-12');
  const github = cargarCon(GITHUB);
  assert.equal(github.trabajo.propio, false);
  assert.equal(claveDeRama('feat/12-x', github), '#12');
});
