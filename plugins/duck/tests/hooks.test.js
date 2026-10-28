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
    'gh issue transfer 12 org/otro',
    'gh issue lock 12',
    'gh issue unlock 12',
    'gh issue pin 12',
    'gh issue unpin 12',
    'gh issue develop 12 --checkout',
    'gh issue develop 12 --name "x -l"',
    "gh issue develop 12 --base 'a --list'",
    'gh project item-add 5 --owner org --url x',
    'gh project item-delete 5 --id 1',
    'gh project item-archive 5 --id 1',
  ]) {
    assert.ok(negado(correr('guard-spike.js', raiz, bash(c))), c);
  }
  for (const c of ['gh issue view 12', 'gh issue develop 12 --list', 'gh issue develop -l 12', "gh api graphql -f query='query { x }'", 'node /x/ticket.js ver #12']) {
    assert.ok(!negado(correr('guard-spike.js', raiz, bash(c))), c);
  }
});

test('guard-spike (github) blocks gh with global flags and gh api REST writes, not reads', () => {
  const raiz = spike(GITHUB);
  for (const c of [
    'gh -R org/app issue comment 12 --body x',
    'gh --repo=org/app issue edit 12 --add-label x',
    'gh api -X POST repos/org/app/issues/12/comments -f body=x',
    'gh api --method PATCH /repos/org/app/issues/12 -f state=closed',
    'gh api repos/org/app/issues -f title=x',
    'gh api -XDELETE repos/org/app/issues/comments/9',
    'gh api -X POST orgs/org/projectsV2/5/items -F x=1',
  ]) {
    assert.ok(negado(correr('guard-spike.js', raiz, bash(c))), c);
  }
  for (const c of ['gh api repos/org/app/issues/12', 'gh -R org/app issue view 12', 'gh api -X GET repos/org/app/issues -f state=open']) {
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
  assert.ok(!negado(correr('guard-spike.js', raiz, bash('gh -R org/app issue comment 12 --body x'))));
  assert.ok(!negado(correr('guard-spike.js', raiz, bash('gh api -X POST repos/org/app/issues -f title=x'))));
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

test('cierre-finalizado (github) records the canonical owner/repo#N of the PR folder', () => {
  const raiz = proyecto(GITHUB);
  repo(raiz, 'fix/27-x');
  git(raiz, 'remote', 'add', 'origin', 'https://github.com/org/app.git');
  const texto = contexto(correr('cierre-finalizado.js', raiz, merge('{"merged": true}')));
  assert.match(texto, /ticket\.js" mover org\/app#27 finalizado/);
  assert.equal(leerSesion(raiz, 's1').tareas['org/app#27'].estado, 'Mergeado');
});

test('cierre-finalizado (github) prefers the branch named in the merge over a #N in the command', () => {
  const raiz = proyecto(GITHUB);
  const cmd = 'curl -X PUT https://api.github.com/repos/org/app/pulls/28/merge -d \'{"commit_message":"Refs #5"}\'';
  const texto = contexto(correr('cierre-finalizado.js', raiz, merge('{"merged": true, "message": "Merge pull request #28 from org/fix/27-x"}', cmd)));
  assert.match(texto, /^El PR app#28 se mergeo\. #27 tiene que pasar a Done/);
});

test('cierre-finalizado (github) prefers an explicit reference in the command over a stale current branch', () => {
  const raiz = proyecto(GITHUB);
  repo(raiz, 'fix/27-x');
  for (const ref of ['Refs #5', 'feat: x (#5)', 'Closes #5']) {
    const cmd = `curl -X PUT https://api.github.com/repos/org/app/pulls/28/merge -d '{"commit_message":"${ref}"}'`;
    assert.match(contexto(correr('cierre-finalizado.js', raiz, merge('{"merged": true}', cmd))), /se mergeo\. #5 tiene que pasar a Done/, ref);
  }
});

test('cierre-finalizado (github) prefers the current branch over a #N merely mentioned', () => {
  const raiz = proyecto(GITHUB);
  repo(raiz, 'fix/27-x');
  const cmd = 'curl -X PUT https://api.github.com/repos/org/app/pulls/28/merge -d \'{"commit_message":"see #5"}\'';
  const texto = contexto(correr('cierre-finalizado.js', raiz, merge('{"merged": true}', cmd)));
  assert.match(texto, /^El PR app#28 se mergeo\. #27 tiene que pasar a Done/);
});

test('cierre-finalizado (github) falls back to the #N in the command without a branch', () => {
  const raiz = proyecto(GITHUB);
  const cmd = 'curl -X PUT https://api.github.com/repos/org/app/pulls/28/merge -d \'{"commit_title":"feat: x (#5)"}\'';
  const texto = contexto(correr('cierre-finalizado.js', raiz, merge('{"merged": true}', cmd)));
  assert.match(texto, /^El PR app#28 se mergeo\. #5 tiene que pasar a Done/);
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

test('rama-reusada (github) counts base commits only when they reference the issue like inventario', () => {
  const raiz = proyecto(GITHUB);
  repo(raiz, 'main', ['chore: a\n\nmenciona #12 al pasar']);
  git(raiz, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  assert.equal(correr('rama-reusada.js', raiz, bash('git checkout -b feat/12-nuevo', raiz)).stdout, '');
  git(raiz, 'commit', '-q', '--allow-empty', '-m', 'fix: b\n\nFixes #12');
  git(raiz, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  assert.match(contexto(correr('rama-reusada.js', raiz, bash('git checkout -b feat/12-nuevo', raiz))), /Ya hay trabajo de #12 en main: \. \(1 commits\)/);
});

test('rama-reusada (github) ignores the same #N in a folder of another repo', () => {
  const raiz = proyecto({ ...GITHUB, git: { ...GITHUB.git, repos: { api: 'api', web: 'web' } } });
  for (const [carpeta, url] of [['api', 'https://github.com/org/api.git'], ['web', 'https://github.com/org/web.git']]) {
    fs.mkdirSync(path.join(raiz, carpeta));
    repo(path.join(raiz, carpeta), 'main', ['inicio', 'fix: b\n\nFixes #12']);
    git(path.join(raiz, carpeta), 'remote', 'add', 'origin', url);
    git(path.join(raiz, carpeta), 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  }
  git(path.join(raiz, 'web'), 'branch', 'feat/12-viejo');
  git(path.join(raiz, 'api'), 'commit', '-q', '--allow-empty', '-m', 'x');
  git(path.join(raiz, 'api'), 'update-ref', 'refs/remotes/origin/main', 'HEAD~1');
  const r = contexto(correr('rama-reusada.js', raiz, bash('git checkout -b feat/12-nuevo', path.join(raiz, 'api'))));
  assert.match(r, /org\/api#12 ya se uso/);
  assert.match(r, /Ya hay trabajo de org\/api#12 en main: api \(1 commits\)/);
  assert.doesNotMatch(r, /web/);
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
