// Run: node --test plugins/duck/tests/*.test.js
// Hooks spawned as Claude Code runs them: JSON event on stdin, CLAUDE_PROJECT_DIR on a temp project.
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const SCRIPTS = path.join(__dirname, '..', 'scripts');
const temporales = [];

afterEach(() => {
  delete process.env.CLAUDE_PROJECT_DIR;
  while (temporales.length) fs.rmSync(temporales.pop(), { recursive: true, force: true });
});

const GITHUB = { tickets: { proveedor: 'github' }, git: { prefijos: ['feat', 'fix'], ramaBase: 'main' } };
const JIRA = { git: { ramaBase: 'main' } };

function proyecto(duck) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'duck-hooks-'));
  temporales.push(raiz);
  fs.mkdirSync(path.join(raiz, '.claude'));
  fs.writeFileSync(path.join(raiz, '.claude', 'duck.json'), JSON.stringify(duck));
  return raiz;
}

function correr(script, raiz, evento, { args = [], env = {} } = {}) {
  return spawnSync('node', [path.join(SCRIPTS, script), ...args], {
    input: JSON.stringify(evento),
    cwd: raiz,
    env: { ...process.env, CLAUDE_PROJECT_DIR: raiz, ...env },
    encoding: 'utf8',
  });
}

function contexto(r) {
  return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput?.additionalContext ?? '' : '';
}

const ENV_GIT = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...ENV_GIT }, stdio: ['ignore', 'pipe', 'ignore'] });
}

// A real repo at raiz on branch `rama`, with one commit per message.
function repo(raiz, rama, mensajes = ['inicio']) {
  git(raiz, 'init', '-q', '-b', rama);
  for (const m of mensajes) git(raiz, 'commit', '-q', '--allow-empty', '-m', m);
}

function leerSesion(raiz, sesion) {
  return JSON.parse(fs.readFileSync(path.join(raiz, '.claude', 'estado', 'sesiones', `${sesion}.json`), 'utf8'));
}

function escribirSesion(raiz, sesion, datos) {
  const dir = path.join(raiz, '.claude', 'estado', 'sesiones');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${sesion}.json`), JSON.stringify(datos));
}

const mover = (salida, clave = '#12', estado = 'enProceso') => ({
  session_id: 's1',
  tool_name: 'Bash',
  tool_input: { command: `node "/x/scripts/ticket.js" mover ${clave} ${estado}` },
  tool_response: { stdout: salida, stderr: '' },
});

const transicionJira = (respuesta) => ({
  session_id: 's1',
  tool_name: 'mcp__atlassian__transitionJiraIssue',
  tool_input: { issueIdOrKey: 'abc-5' },
  tool_response: respuesta,
});

// --- config.estadosDe ---

test('estadosDe returns the states of the active provider', () => {
  const { cargar, estadosDe } = require('../scripts/config');
  process.env.CLAUDE_PROJECT_DIR = proyecto(GITHUB);
  assert.equal(estadosDe(cargar()).enProceso, 'In Progress');
  process.env.CLAUDE_PROJECT_DIR = proyecto(JIRA);
  assert.equal(estadosDe(cargar()).enProceso, 'En Proceso');
});

// --- estado-tarea ---

test('estado-tarea records a GitHub move from the ticket.js success line', () => {
  const raiz = proyecto(GITHUB);
  const r = correr('estado-tarea.js', raiz, mover('Issue (org/app#12) movido a (In Progress)\n'));
  assert.equal(r.status, 0);
  assert.equal(leerSesion(raiz, 's1').tareas['org/app#12'].estado, 'In Progress');
});

test('estado-tarea ignores a ticket.js mover that printed no success line', () => {
  const raiz = proyecto(GITHUB);
  correr('estado-tarea.js', raiz, mover(''));
  assert.equal(fs.existsSync(path.join(raiz, '.claude', 'estado', 'sesiones', 's1.json')), false);
});

test('estado-tarea (jira) still records the acli transition line', () => {
  const raiz = proyecto(JIRA);
  correr('estado-tarea.js', raiz, {
    session_id: 's1',
    tool_name: 'Bash',
    tool_input: { command: 'acli jira workitem transition --key ABC-5 --status Finalizado' },
    tool_response: { stdout: '✓ Work item ABC-5 has been successfully transitioned to Finalizado\n' },
  });
  assert.equal(leerSesion(raiz, 's1').tareas['ABC-5'].estado, 'Finalizado');
});

// --- guard-spike ---

function spike(duck) {
  const raiz = proyecto(duck);
  escribirSesion(raiz, 's1', { modo: 'spike', tareas: {} });
  return raiz;
}
const bash = (command, cwd) => ({ session_id: 's1', tool_name: 'Bash', tool_input: { command }, cwd });
const negado = (r) => /"permissionDecision":"deny"/.test(r.stdout);

test('guard-spike blocks GitHub ticket writes during a spike', () => {
  const raiz = spike(GITHUB);
  for (const c of [
    'node /x/scripts/ticket.js mover #12 enProceso',
    'gh issue comment 12 --body hola',
    'gh issue create --title x',
    'gh project item-edit --id 1',
    "gh api graphql -f query='mutation { x }'",
  ]) {
    assert.ok(negado(correr('guard-spike.js', raiz, bash(c))), c);
  }
  for (const c of ['gh issue view 12', "gh api graphql -f query='query { x }'", 'node /x/ticket.js ver #12']) {
    assert.ok(!negado(correr('guard-spike.js', raiz, bash(c))), c);
  }
});

test('guard-spike blocks a commit with a #N key on a spike branch (github)', () => {
  const raiz = spike(GITHUB);
  fs.mkdirSync(path.join(raiz, '.git'));
  fs.writeFileSync(path.join(raiz, '.git', 'HEAD'), 'ref: refs/heads/spike/x\n');
  assert.ok(negado(correr('guard-spike.js', raiz, bash('git commit -m "feat: x (#12)"', raiz))));
  assert.ok(!negado(correr('guard-spike.js', raiz, bash('git commit -m "feat: x"', raiz))));
});

test('guard-spike (jira) still blocks Jira MCP writes and lets gh issue through', () => {
  const raiz = spike(JIRA);
  assert.ok(negado(correr('guard-spike.js', raiz, { session_id: 's1', tool_name: 'mcp__atlassian__editJiraIssue' })));
  assert.ok(!negado(correr('guard-spike.js', raiz, bash('gh issue comment 12 --body x'))));
});

// --- sesion-inicio ---

test('sesion-inicio (github) lists #N branches and asks for gh, not JQL', () => {
  const raiz = proyecto({ ...GITHUB, github: { proyecto: { owner: 'org', numero: 5 } } });
  repo(raiz, 'feat/12-login');
  const texto = contexto(correr('sesion-inicio.js', raiz, {}));
  assert.match(texto, /\.: feat\/12-login -> #12/);
  assert.match(texto, /gh search issues --owner org --assignee @me --state open/);
  assert.doesNotMatch(texto, /JQL/);
});

test('sesion-inicio (jira) still asks for the JQL', () => {
  const raiz = proyecto(JIRA);
  repo(raiz, 'feature/ABC-1-x');
  const texto = contexto(correr('sesion-inicio.js', raiz, {}));
  assert.match(texto, /feature\/ABC-1-x -> ABC-1/);
  assert.match(texto, /Corre la JQL assignee = currentUser\(\) AND status = "En Proceso"/);
});

// --- panel-al-cerrar ---

test('panel-al-cerrar (github) asks for the panel only when the issue reaches Done', () => {
  const raiz = proyecto(GITHUB);
  const texto = contexto(correr('panel-al-cerrar.js', raiz, mover('Issue (org/app#12) movido a (Done)\n')));
  assert.match(texto, /^org\/app#12 acaba de quedar Done/);
  assert.match(texto, /ticket\.js" ver org\/app#12/);
  assert.equal(correr('panel-al-cerrar.js', raiz, mover('Issue (org/app#12) movido a (In Progress)\n')).stdout, '');
});

test('panel-al-cerrar (jira) still fires on a Finalizado transition', () => {
  const raiz = proyecto(JIRA);
  assert.match(contexto(correr('panel-al-cerrar.js', raiz, transicionJira('{"status":"Finalizado"}'))), /^ABC-5 acaba de quedar Finalizado/);
  assert.equal(correr('panel-al-cerrar.js', raiz, mover('Issue (org/app#12) movido a (Done)\n')).stdout, '');
});

// --- historia-sigue-subtareas ---

test('historia-sigue-subtareas (github) reminds to move the parent issue', () => {
  const raiz = proyecto(GITHUB);
  const enProceso = contexto(correr('historia-sigue-subtareas.js', raiz, mover('Issue (org/app#12) movido a (In Progress)\n')));
  assert.match(enProceso, /^org\/app#12 paso a In Progress/);
  assert.match(enProceso, /mover <padre> enProceso/);
  const fin = contexto(correr('historia-sigue-subtareas.js', raiz, mover('Issue (org/app#12) movido a (Done)\n')));
  assert.match(fin, /todas sus hijas estan cerradas/);
  assert.match(fin, /Closes/);
});

test('historia-sigue-subtareas (jira) still reminds on En Proceso', () => {
  const raiz = proyecto(JIRA);
  assert.match(contexto(correr('historia-sigue-subtareas.js', raiz, transicionJira('{"status":"En Proceso"}'))), /^ABC-5 paso a En Proceso/);
});

// --- cierre-finalizado ---

const merge = (respuesta, cmd = 'curl -X PUT https://api.github.com/repos/org/app/pulls/28/merge') => ({
  session_id: 's1',
  tool_name: 'Bash',
  tool_input: { command: cmd },
  tool_response: { stdout: respuesta },
});

test('cierre-finalizado (github) takes the issue from the branch, never the PR #N', () => {
  const raiz = proyecto(GITHUB);
  repo(raiz, 'fix/27-x');
  const texto = contexto(correr('cierre-finalizado.js', raiz, merge('{"merged": true, "message": "Merge pull request #28 from org/fix/27-x"}')));
  assert.match(texto, /^El PR app#28 se mergeo\. #27 tiene que pasar a Done/);
  assert.match(texto, /ticket\.js" mover #27 finalizado/);
  assert.equal(leerSesion(raiz, 's1').tareas['#27'].estado, 'Mergeado');
});

test('cierre-finalizado (jira) still reads the key from the command', () => {
  const raiz = proyecto(JIRA);
  const texto = contexto(correr('cierre-finalizado.js', raiz, merge('{"merged": true}', 'curl https://api.github.com/repos/org/app/pulls/3/merge # ABC-9')));
  assert.match(texto, /^El PR app#3 se mergeo\. ABC-9 tiene que pasar a Finalizado/);
});

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

// --- sticker ---

test('sticker (github) paints #N from the name, the branch and GitHub states', () => {
  const raiz = proyecto(GITHUB);
  repo(raiz, 'feat/12-login');
  escribirSesion(raiz, 's1', { tareas: { 'org/app#7': { estado: 'Done', desde: new Date().toISOString() } } });
  const r = correr('sticker.js', raiz, { session_id: 's1', session_name: '#9 detalle 618', cwd: raiz });
  for (const clave of ['org/app#7 v', '#9 #', '#12 ~']) assert.ok(r.stdout.includes(clave), clave);
  assert.ok(!r.stdout.includes('618'));
});

test('sticker (jira) still completes bare numbers with jira.proyecto', () => {
  const raiz = proyecto({ ...JIRA, jira: { proyecto: 'PROY' } });
  const r = correr('sticker.js', raiz, { session_id: 's1', session_name: '618 detalle', cwd: raiz });
  assert.ok(r.stdout.includes('PROY-618 #'));
});

// --- rama-reusada ---

test('rama-reusada (github) warns when issue #12 already has another branch', () => {
  const raiz = proyecto(GITHUB);
  repo(raiz, 'main');
  git(raiz, 'branch', 'feat/12-viejo');
  const r = correr('rama-reusada.js', raiz, bash('git checkout -b feat/12-nuevo', raiz));
  assert.match(contexto(r), /#12 ya se uso antes de esta rama nueva \(feat\/12-nuevo\)/);
  assert.match(contexto(r), /\.: feat\/12-viejo/);
  assert.equal(correr('rama-reusada.js', raiz, bash('git checkout -b feat/13-otro', raiz)).stdout, '');
});

test('rama-reusada (jira) still warns on a reused key', () => {
  const raiz = proyecto(JIRA);
  repo(raiz, 'main');
  git(raiz, 'branch', 'feature/ABC-1-viejo');
  assert.match(contexto(correr('rama-reusada.js', raiz, bash('git checkout -b feature/ABC-1-nuevo', raiz))), /ABC-1 ya se uso/);
});

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
