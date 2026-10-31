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

test('estado-tarea records a GitHub move when the Bash command failed after ticket.js succeeded', () => {
  // PostToolUseFailure: no tool_response, the output travels in `error`.
  const raiz = proyecto(GITHUB);
  const evento = { ...mover(''), tool_response: undefined, hook_event_name: 'PostToolUseFailure',
    error: 'Exit code 1\nIssue (org/app#12) movido a (In Progress)\n' };
  correr('estado-tarea.js', raiz, evento);
  assert.equal(leerSesion(raiz, 's1').tareas['org/app#12'].estado, 'In Progress');
});

test('hooks.json runs estado-tarea on PostToolUseFailure for Bash', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(SCRIPTS, '..', 'hooks', 'hooks.json'), 'utf8')).hooks;
  const bash = (hooks.PostToolUseFailure || []).find((m) => m.matcher === 'Bash');
  assert.ok(bash && bash.hooks.some((h) => h.command.includes('estado-tarea.js')));
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

test('historia-sigue-subtareas (github) sends the parent to Testing, not Done, when every child is closed', () => {
  const raiz = proyecto(GITHUB);
  const fin = contexto(correr('historia-sigue-subtareas.js', raiz, mover('Issue (org/app#12) movido a (Done)\n')));
  assert.match(fin, /mover <padre> pruebas`/);
  assert.doesNotMatch(fin, /mover <padre> finalizado/);
  assert.match(fin, /Done lo decide una persona/);
});

test('cierre-finalizado (github) sends an HU with sub-issues to Testing, not Done', () => {
  const raiz = proyecto(GITHUB);
  repo(raiz, 'fix/27-x');
  const texto = contexto(correr('cierre-finalizado.js', raiz, merge('{"merged": true}')));
  assert.match(texto, /pasa a Testing/);
  assert.match(texto, /Done lo decide una persona/);
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

// --- tarea-por-commit: a commit on a task branch records the task in the session ---

const commit = (salida, comando = 'git commit -m "feat: x"', extra = {}) => ({
  session_id: 's1',
  tool_name: 'Bash',
  tool_input: { command: comando },
  tool_response: { stdout: salida, stderr: '' },
  ...extra,
});

function repoGithub(raiz, rama) {
  repo(raiz, rama);
  git(raiz, 'remote', 'add', 'origin', 'https://github.com/org/app.git');
}

test('tarea-por-commit (github) records the branch issue of a successful commit as in progress', () => {
  const raiz = proyecto(GITHUB);
  repoGithub(raiz, 'feat/12-algo');
  const r = correr('tarea-por-commit.js', raiz, commit('[feat/12-algo 1a2b3c4] feat: x\n 1 file changed\n', undefined, { cwd: raiz }));
  assert.equal(r.status, 0);
  assert.equal(leerSesion(raiz, 's1').tareas['org/app#12'].estado, 'In Progress');
});

test('tarea-por-commit keeps a recorded state and only refreshes when it was worked on', () => {
  const raiz = proyecto(GITHUB);
  repoGithub(raiz, 'feat/12-algo');
  escribirSesion(raiz, 's1', { tareas: { 'org/app#12': { estado: 'In Review', desde: new Date(Date.now() - 3600e3).toISOString() } }, modo: 'flujo' });
  correr('tarea-por-commit.js', raiz, commit('[feat/12-algo 1a2b3c4] fix: y\n', undefined, { cwd: raiz }));
  const sesion = leerSesion(raiz, 's1');
  assert.equal(sesion.tareas['org/app#12'].estado, 'In Review');
  assert.ok(Date.parse(sesion.tareas['org/app#12'].desde) > Date.now() - 60e3);
  assert.equal(sesion.modo, 'flujo');
});

test('tarea-por-commit ignores a failed commit, a non-commit command and a branch without a key', () => {
  const raiz = proyecto(GITHUB);
  repoGithub(raiz, 'feat/12-algo');
  correr('tarea-por-commit.js', raiz, commit('nothing to commit, working tree clean\n', undefined, { cwd: raiz }));
  correr('tarea-por-commit.js', raiz, commit('[feat/12-algo 1a2b3c4] x\n', 'git log -1', { cwd: raiz }));
  correr('tarea-por-commit.js', raiz, commit('[main 1a2b3c4] chore: x\n', undefined, { cwd: raiz }));
  assert.equal(fs.existsSync(path.join(raiz, '.claude', 'estado', 'sesiones', 's1.json')), false);
});

test('tarea-por-commit reads the repo of a cd or git -C folder, not the session folder', () => {
  const raiz = proyecto(GITHUB);
  const otro = fs.mkdtempSync(path.join(os.tmpdir(), 'duck-otro-'));
  temporales.push(otro);
  repoGithub(otro, 'feat/7-x');
  git(otro, 'remote', 'set-url', 'origin', 'git@github.com:org/api.git');
  correr('tarea-por-commit.js', raiz, commit('[feat/7-x 1a2b3c4] feat: x\n', `cd ${otro} && git add -A && git commit -m "feat: x"`, { cwd: raiz }));
  correr('tarea-por-commit.js', raiz, commit('[feat/7-x 9f8e7d6] feat: y\n', `git -C ${otro} commit -m "feat: y"`, { cwd: raiz }));
  assert.deepEqual(Object.keys(leerSesion(raiz, 's1').tareas), ['org/api#7']);
});

test('tarea-por-commit (jira) records the key of the branch', () => {
  const raiz = proyecto({ ...JIRA, jira: { proyecto: 'ABC' } });
  repo(raiz, 'feature/ABC-5-algo');
  correr('tarea-por-commit.js', raiz, commit('[feature/ABC-5-algo 1a2b3c4] feat(ABC-5): x\n', undefined, { cwd: raiz }));
  assert.equal(leerSesion(raiz, 's1').tareas['ABC-5'].estado, 'En Proceso');
});

test('hooks.json runs tarea-por-commit after Bash commits', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'hooks', 'hooks.json'), 'utf8')).hooks;
  const bash = hooks.PostToolUse.find((h) => h.matcher === 'Bash').hooks;
  assert.ok(bash.some((h) => h.command.includes('tarea-por-commit.js')));
});

// --- continued sessions inherit the previous session's tasks ---

function transcript(raiz, anterior) {
  const ruta = path.join(raiz, 'transcript.jsonl');
  fs.writeFileSync(ruta, JSON.stringify({ type: 'user', message: { content:
    `If you need specific details from before compaction, read the full transcript at: /home/u/.claude/projects/p/${anterior}.jsonl\nContinue the conversation` } }) + '\n');
  return ruta;
}

test('sesion-inicio copies tasks and mode of the session it continues', () => {
  const raiz = proyecto(GITHUB);
  const reciente = new Date().toISOString();
  escribirSesion(raiz, 'vieja-1', { tareas: { 'org/app#12': { estado: 'In Progress', desde: reciente } }, modo: 'flujo' });
  correr('sesion-inicio.js', raiz, { session_id: 'nueva-2', source: 'startup', transcript_path: transcript(raiz, 'vieja-1') });
  const nueva = leerSesion(raiz, 'nueva-2');
  assert.deepEqual(nueva.tareas, { 'org/app#12': { estado: 'In Progress', desde: reciente } });
  assert.equal(nueva.modo, 'flujo');
});

test('a continued session never overwrites its own tasks with the previous ones', () => {
  const raiz = proyecto(GITHUB);
  const reciente = new Date().toISOString();
  escribirSesion(raiz, 'vieja-1', { tareas: { 'org/app#12': { estado: 'In Progress', desde: reciente } } });
  escribirSesion(raiz, 'nueva-2', { tareas: { 'org/app#30': { estado: 'In Review', desde: reciente } }, modo: 'tarea' });
  correr('sesion-inicio.js', raiz, { session_id: 'nueva-2', transcript_path: transcript(raiz, 'vieja-1') });
  assert.deepEqual(Object.keys(leerSesion(raiz, 'nueva-2').tareas), ['org/app#30']);
});

test('tarea-por-commit inherits the previous session first when the summary arrived after the start', () => {
  const raiz = proyecto(GITHUB);
  repoGithub(raiz, 'feat/30-x');
  escribirSesion(raiz, 'vieja-1', { tareas: { 'org/app#12': { estado: 'In Progress', desde: new Date().toISOString() } } });
  correr('tarea-por-commit.js', raiz, commit('[feat/30-x 1a2b3c4] feat: x\n', undefined,
    { session_id: 'nueva-2', cwd: raiz, transcript_path: transcript(raiz, 'vieja-1') }));
  assert.deepEqual(Object.keys(leerSesion(raiz, 'nueva-2').tareas).sort(), ['org/app#12', 'org/app#30']);
});

test('inventario inherits the previous session from the transcript Claude Code keeps for the project', () => {
  const raiz = proyecto(GITHUB);
  const config = fs.mkdtempSync(path.join(os.tmpdir(), 'duck-config-'));
  temporales.push(config);
  const dir = path.join(config, 'projects', fs.realpathSync(raiz).replace(/[^A-Za-z0-9]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(transcript(raiz, 'vieja-1'), path.join(dir, 'nueva-2.jsonl'));
  escribirSesion(raiz, 'vieja-1', { tareas: { 'org/app#12': { estado: 'In Progress', desde: new Date().toISOString() } } });
  const r = spawnSync('node', [path.join(SCRIPTS, 'inventario.js'), 'nueva-2'], {
    cwd: raiz, env: { ...process.env, CLAUDE_PROJECT_DIR: raiz, CLAUDE_CONFIG_DIR: config }, encoding: 'utf8' });
  assert.deepEqual(Object.keys(JSON.parse(r.stdout).sesion), ['org/app#12']);
});

// --- guard-git: first push of the base branch ---

test('guard-git allows the first push of the base branch to an empty remote, and only that one', () => {
  const raiz = proyecto(GITHUB);
  const app = path.join(raiz, 'app');
  const remoto = path.join(raiz, 'remoto.git');
  fs.mkdirSync(app);
  repo(app, 'main');
  git(raiz, 'init', '-q', '--bare', remoto);
  git(app, 'remote', 'add', 'origin', remoto);

  // Empty remote: there is no base to open a PR against, so the first push must pass.
  assert.ok(!negado(correr('guard-git.js', raiz, bash('git -C app push -u origin main', raiz))));
  assert.ok(!negado(correr('guard-git.js', raiz, bash('git push -u origin main', app))));

  // Once the base exists on the remote, pushing to it is blocked again.
  git(app, 'push', '-q', 'origin', 'main');
  assert.ok(negado(correr('guard-git.js', raiz, bash('git -C app push -u origin main', raiz))));
  assert.ok(negado(correr('guard-git.js', raiz, bash('git push origin HEAD:main', app))));
  // Pushing a task branch is still allowed.
  assert.ok(!negado(correr('guard-git.js', raiz, bash('git push -u origin feat/1-x', app))));
});

test('guard-git blocks a push to the base when the remote cannot be read', () => {
  const raiz = proyecto(GITHUB);
  repo(raiz, 'main');
  git(raiz, 'remote', 'add', 'origin', path.join(raiz, 'no-existe.git'));
  assert.ok(negado(correr('guard-git.js', raiz, bash('git push -u origin main', raiz))));
});

// --- guard-git: who may run mergear-pr.js ---

const SHA = 'a'.repeat(40);

test('guard-git lets the agent run mergear-pr.js only in flow mode or with --a-pedido', () => {
  const raiz = proyecto(GITHUB);
  const merge = `node /x/scripts/mergear-pr.js app 7 ${SHA}`;
  // Task mode (no session file): the owner has to ask for this PR.
  assert.ok(negado(correr('guard-git.js', raiz, bash(merge))));
  assert.ok(negado(correr('guard-git.js', raiz, bash(`cd app && ${merge}`))));
  assert.ok(!negado(correr('guard-git.js', raiz, bash(`node /x/scripts/mergear-pr.js --a-pedido app 7 ${SHA}`))));
  // Flow mode: the series was authorized with its merges.
  escribirSesion(raiz, 's1', { modo: 'flujo', tareas: {} });
  assert.ok(!negado(correr('guard-git.js', raiz, bash(merge))));
  // Other commands that only mention the script are not merges.
  escribirSesion(raiz, 's1', { modo: 'tarea', tareas: {} });
  assert.ok(!negado(correr('guard-git.js', raiz, bash('grep -n fallar /x/scripts/mergear-pr.js'))));
});

test('mergear-pr.js ignores --a-pedido when reading its arguments', () => {
  const raiz = proyecto({ ...GITHUB, git: { ...GITHUB.git, orgGithub: 'org', repos: { app: 'app' } } });
  const r = spawnSync('node', [path.join(SCRIPTS, 'mergear-pr.js'), '--a-pedido', 'app', '7', 'corto'], {
    cwd: raiz, env: { ...process.env, CLAUDE_PROJECT_DIR: raiz }, encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /falta el sha completo/);
});

// --- pr-a-revision ---

const prCreado = (cmd, stdout = 'https://github.com/org/app/pull/28\n') => ({
  session_id: 's1',
  tool_name: 'Bash',
  tool_input: { command: cmd },
  tool_response: { stdout },
});

// Stand-in for ticket.js: records its argv and prints the success line of the real one.
function ticketFalso(raiz) {
  const script = path.join(raiz, 'ticket-falso.js');
  fs.writeFileSync(
    script,
    "require('fs').writeFileSync(process.argv[1] + '.args', process.argv.slice(2).join(' '));\n" +
      'console.log(`Issue (${process.argv[3]}) movido a (In Review)`);\n'
  );
  return { env: { DUCK_TICKET_JS: script }, args: () => (fs.existsSync(script + '.args') ? fs.readFileSync(script + '.args', 'utf8') : null) };
}

// Stand-in for gh: answers the PR's closingIssuesReferences with `cierra` (owner/repo#N list).
function ghCierra(raiz, cierra) {
  const script = path.join(raiz, 'gh-cierra.js');
  const nodos = cierra.map((c) => ({ number: Number(c.split('#')[1]), repository: { nameWithOwner: c.split('#')[0] } }));
  fs.writeFileSync(script, '#!/usr/bin/env node\n' +
    `console.log(JSON.stringify({ data: { repository: { pullRequest: { closingIssuesReferences: { nodes: ${JSON.stringify(nodos)} } } } } }))\n`);
  fs.chmodSync(script, 0o755);
  return { DUCK_GH: script };
}

test('pr-a-revision (github) moves the issue the PR closes to In Review', () => {
  const raiz = proyecto(GITHUB);
  repo(raiz, 'fix/27-x');
  const falso = ticketFalso(raiz);
  const r = correr('pr-a-revision.js', raiz, prCreado('gh pr create --fill'), { env: { ...falso.env, ...ghCierra(raiz, ['org/app#27']) } });
  assert.equal(falso.args(), 'mover org/app#27 enRevision');
  assert.match(contexto(r), /Issue \(org\/app#27\) movido a \(In Review\)/);
});

test('pr-a-revision leaves the HU alone on a partial PR that closes nothing, whatever the branch says', () => {
  const raiz = proyecto(GITHUB);
  repo(raiz, 'fix/41-plan');
  const falso = ticketFalso(raiz);
  const r = correr('pr-a-revision.js', raiz, prCreado('gh pr create --head fix/41-plan --fill'), { env: { ...falso.env, ...ghCierra(raiz, []) } });
  assert.equal(falso.args(), null);
  assert.equal(r.stdout, '');
});

test('pr-a-revision does nothing when the PR was not created', () => {
  const raiz = proyecto(GITHUB);
  repo(raiz, 'fix/27-x');
  const falso = ticketFalso(raiz);
  const r = correr('pr-a-revision.js', raiz, prCreado('gh pr create --fill', 'a pull request for branch "fix/27-x" already exists'), { env: falso.env });
  assert.equal(falso.args(), null);
  assert.equal(r.stdout, '');
});

test('pr-a-revision (jira) does nothing', () => {
  const raiz = proyecto(JIRA);
  repo(raiz, 'feature/ABC-1-x');
  const falso = ticketFalso(raiz);
  correr('pr-a-revision.js', raiz, prCreado('gh pr create --fill'), { env: falso.env });
  assert.equal(falso.args(), null);
});

test('hooks.json runs pr-a-revision after a gh pr create', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'hooks', 'hooks.json'), 'utf8')).hooks;
  const bash = hooks.PostToolUse.find((h) => h.matcher === 'Bash').hooks;
  assert.ok(bash.some((h) => /pr-a-revision\.js/.test(h.command) && h.if === 'Bash(*gh*pr*create*)'));
});

// --- the panel follows the issue from the moment it is taken ---

const historiaDe = (raiz, sesion = 's1') => path.join(raiz, '.claude', 'estado', 'sesiones', `${sesion}-historia.json`);

// Stand-in for `ticket.js ver`: prints the issue with the given parent.
function verFalso(raiz, padre) {
  const script = path.join(raiz, 'ver-falso.js');
  fs.writeFileSync(script, `console.log(JSON.stringify({ clave: process.argv[3], padre: ${JSON.stringify(padre)} }))\n`);
  return { DUCK_TICKET_JS: script };
}

test('estado-tarea (github) creates the session story file with the parent issue when one is taken', () => {
  const raiz = proyecto(GITHUB);
  correr('estado-tarea.js', raiz, mover('Issue (org/app#12) movido a (In Progress)\n'), { env: verFalso(raiz, 'org/docs#3') });
  const datos = JSON.parse(fs.readFileSync(historiaDe(raiz), 'utf8'));
  assert.deepEqual(datos.historias, [{ historia: { clave: 'org/docs#3', titulo: '' }, subtareas: [] }]);
  assert.deepEqual(datos.alertas, []);
});

test('estado-tarea (github) uses the issue itself as the story when it has no parent', () => {
  const raiz = proyecto(GITHUB);
  correr('estado-tarea.js', raiz, mover('Issue (org/app#38) movido a (In Progress)\n'), { env: verFalso(raiz, null) });
  assert.equal(JSON.parse(fs.readFileSync(historiaDe(raiz), 'utf8')).historias[0].historia.clave, 'org/app#38');
});

test('estado-tarea keeps an existing session story file', () => {
  const raiz = proyecto(GITHUB);
  escribirSesion(raiz, 's1', { tareas: {} });
  const previo = { actualizado: 'x', alertas: [], historias: [{ historia: { clave: 'org/docs#9', titulo: 'HU' }, subtareas: [] }] };
  fs.writeFileSync(historiaDe(raiz), JSON.stringify(previo));
  correr('estado-tarea.js', raiz, mover('Issue (org/app#12) movido a (In Progress)\n'), { env: verFalso(raiz, 'org/docs#3') });
  assert.deepEqual(JSON.parse(fs.readFileSync(historiaDe(raiz), 'utf8')), previo);
});

test('estado-tarea (github) records an In Review move', () => {
  const raiz = proyecto(GITHUB);
  correr('estado-tarea.js', raiz, mover('Issue (org/app#12) movido a (In Review)\n', '#12', 'enRevision'), { env: verFalso(raiz, null) });
  assert.equal(leerSesion(raiz, 's1').tareas['org/app#12'].estado, 'In Review');
});

test('pr-a-revision records the In Review move in the session', () => {
  const raiz = proyecto(GITHUB);
  const falso = ticketFalso(raiz);
  correr('pr-a-revision.js', raiz, prCreado('gh pr create --fill'), { env: { ...falso.env, ...ghCierra(raiz, ['org/app#27']) } });
  assert.equal(leerSesion(raiz, 's1').tareas['org/app#27'].estado, 'In Review');
});

test('sticker (github) shows an issue that is In Review', () => {
  const raiz = proyecto(GITHUB);
  repo(raiz, 'main');
  escribirSesion(raiz, 's1', { tareas: { 'org/app#12': { estado: 'In Review', desde: new Date().toISOString() } } });
  const r = correr('sticker.js', raiz, { session_id: 's1', cwd: raiz });
  assert.ok(r.stdout.includes('org/app#12 >'), r.stdout);
});

// --- issue-padre ---

const issueCreado = (stdout = 'https://github.com/org/app/issues/5\n', cmd = 'gh issue create -R org/app --title t --body-file b.md') => ({
  session_id: 's1',
  tool_name: 'Bash',
  tool_input: { command: cmd },
  tool_response: { stdout },
});

// Stand-in for gh: logs each call, answers the issue read with `cuerpo` and any write with {}.
function ghFalso(raiz, cuerpo) {
  const script = path.join(raiz, 'gh-falso.js');
  const log = script + '.log';
  fs.writeFileSync(
    script,
    '#!/usr/bin/env node\n' +
    `const a = process.argv.slice(2); require('fs').appendFileSync(${JSON.stringify(log)}, a.join(' ') + '\\n');\n` +
      `console.log(a.includes('POST') ? '{}' : JSON.stringify({ id: 555, body: ${JSON.stringify(cuerpo)} }));\n`
  );
  fs.chmodSync(script, 0o755);
  return { env: { DUCK_GH: script }, llamadas: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []) };
}

test('issue-padre (github) hangs the new issue under the HU named in Part of', () => {
  const raiz = proyecto(GITHUB);
  const gh = ghFalso(raiz, 'Bug text.\n\nPart of: org/docs#41\n');
  const r = correr('issue-padre.js', raiz, issueCreado(), { env: gh.env });
  assert.deepEqual(gh.llamadas(), ['api repos/org/app/issues/5', 'api -X POST repos/org/docs/issues/41/sub_issues -F sub_issue_id=555']);
  assert.match(contexto(r), /org\/app#5 .*sub-issue de org\/docs#41/);
});

test('issue-padre resolves a bare #N in Part of against the new issue repo', () => {
  const raiz = proyecto(GITHUB);
  const gh = ghFalso(raiz, 'Part of #3');
  correr('issue-padre.js', raiz, issueCreado(), { env: gh.env });
  assert.equal(gh.llamadas()[1], 'api -X POST repos/org/app/issues/3/sub_issues -F sub_issue_id=555');
});

test('issue-padre does not link on a mere Related reference', () => {
  const raiz = proyecto(GITHUB);
  const gh = ghFalso(raiz, 'Related: org/docs#41');
  const r = correr('issue-padre.js', raiz, issueCreado(), { env: gh.env });
  assert.equal(gh.llamadas().length, 1);
  assert.equal(r.stdout, '');
});

test('issue-padre does nothing when the issue was not created', () => {
  const raiz = proyecto(GITHUB);
  const gh = ghFalso(raiz, 'Part of: org/docs#41');
  correr('issue-padre.js', raiz, issueCreado('could not create issue: HTTP 422'), { env: gh.env });
  assert.deepEqual(gh.llamadas(), []);
});

test('hooks.json runs issue-padre after a gh issue create', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'hooks', 'hooks.json'), 'utf8')).hooks;
  const bash = hooks.PostToolUse.find((h) => h.matcher === 'Bash').hooks;
  assert.ok(bash.some((h) => /issue-padre\.js/.test(h.command) && h.if === 'Bash(*gh*issue*create*)'));
});

// --- merges that do not go through curl ---

test('cierre-finalizado (github) recognizes duck\'s own mergear-pr.js', () => {
  const raiz = proyecto({ ...GITHUB, git: { ...GITHUB.git, repos: { app: 'app' } } });
  fs.mkdirSync(path.join(raiz, 'app'));
  repo(path.join(raiz, 'app'), 'fix/27-x');
  const evento = { session_id: 's1', tool_name: 'Bash', tool_input: { command: 'node "/x/scripts/mergear-pr.js" app 28 abc123' },
    tool_response: { stdout: 'app #28 mergeado: ' + 'a'.repeat(40) + '\n' } };
  const texto = contexto(correr('cierre-finalizado.js', raiz, evento));
  assert.match(texto, /^El PR app#28 se mergeo\. #27 tiene que pasar a Done/);
  assert.equal(leerSesion(raiz, 's1').tareas['#27'].estado, 'Mergeado');
});

test('cierre-finalizado (github) recognizes gh pr merge', () => {
  const raiz = proyecto(GITHUB);
  repo(raiz, 'fix/27-x');
  const evento = { session_id: 's1', tool_name: 'Bash', tool_input: { command: 'gh pr merge 28 -R org/app --merge' },
    tool_response: { stdout: '', stderr: '✓ Merged pull request org/app#28 (fix: x)\n' } };
  assert.match(contexto(correr('cierre-finalizado.js', raiz, evento)), /^El PR app#28 se mergeo\. #27/);
});

test('cierre-finalizado takes the issue from the branch mergear-pr.js prints, not the local checkout', () => {
  const raiz = proyecto(GITHUB);
  repo(raiz, 'main');
  const evento = { session_id: 's1', tool_name: 'Bash', tool_input: { command: 'node mergear-pr.js . 28 abc' },
    tool_response: { stdout: 'app #28 mergeado: ' + 'a'.repeat(40) + ' (fix/27-x)\n' } };
  assert.match(contexto(correr('cierre-finalizado.js', raiz, evento)), /^El PR app#28 se mergeo\. #27/);
});

test('cierre-finalizado ignores a mergear-pr.js that refused', () => {
  const raiz = proyecto(GITHUB);
  repo(raiz, 'fix/27-x');
  const evento = { session_id: 's1', tool_name: 'Bash', tool_input: { command: 'node mergear-pr.js app 28 abc' },
    tool_response: { stdout: '', stderr: 'mergear-pr: el check build no termino en success\n' } };
  assert.equal(correr('cierre-finalizado.js', raiz, evento).stdout, '');
});

// --- issue-al-project ---

test('issue-al-project (github) adds the new issue to the configured Project', () => {
  const raiz = proyecto({ ...GITHUB, github: { proyecto: { owner: 'org', numero: 5 } } });
  const gh = ghFalso(raiz, '');
  const r = correr('issue-al-project.js', raiz, issueCreado(), { env: gh.env });
  assert.deepEqual(gh.llamadas(), ['project item-add 5 --owner org --url https://github.com/org/app/issues/5']);
  assert.match(contexto(r), /org\/app#5 .*Project/);
});

test('issue-al-project does nothing without a configured Project', () => {
  const raiz = proyecto(GITHUB);
  const gh = ghFalso(raiz, '');
  correr('issue-al-project.js', raiz, issueCreado(), { env: gh.env });
  assert.deepEqual(gh.llamadas(), []);
});

test('hooks.json runs issue-al-project after a gh issue create', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'hooks', 'hooks.json'), 'utf8')).hooks;
  const bash = hooks.PostToolUse.find((h) => h.matcher === 'Bash').hooks;
  assert.ok(bash.some((h) => /issue-al-project\.js/.test(h.command) && h.if === 'Bash(*gh*issue*create*)'));
});
