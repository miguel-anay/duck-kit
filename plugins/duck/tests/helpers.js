// Shared by the hook tests: temp projects, spawning a hook as Claude Code does, git and session helpers.
const { afterEach } = require('node:test');
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


const bash = (command, cwd) => ({ session_id: 's1', tool_name: 'Bash', tool_input: { command }, cwd });

const negado = (r) => /"permissionDecision":"deny"/.test(r.stdout);

const merge = (respuesta, cmd = 'curl -X PUT https://api.github.com/repos/org/app/pulls/28/merge') => ({
  session_id: 's1',
  tool_name: 'Bash',
  tool_input: { command: cmd },
  tool_response: { stdout: respuesta },
});

function repoGithub(raiz, rama) {
  repo(raiz, rama);
  git(raiz, 'remote', 'add', 'origin', 'https://github.com/org/app.git');
}

function ticketFalso(raiz) {
  const script = path.join(raiz, 'ticket-falso.js');
  fs.writeFileSync(
    script,
    "require('fs').writeFileSync(process.argv[1] + '.args', process.argv.slice(2).join(' '));\n" +
      'console.log(`Issue (${process.argv[3]}) movido a (In Review)`);\n'
  );
  return { env: { DUCK_TICKET_JS: script }, args: () => (fs.existsSync(script + '.args') ? fs.readFileSync(script + '.args', 'utf8') : null) };
}

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

const issueCreado = (stdout = 'https://github.com/org/app/issues/5\n', cmd = 'gh issue create -R org/app --title t --body-file b.md') => ({
  session_id: 's1',
  tool_name: 'Bash',
  tool_input: { command: cmd },
  tool_response: { stdout },
});

const prCreado = (cmd, stdout = 'https://github.com/org/app/pull/28\n') => ({
  session_id: 's1',
  tool_name: 'Bash',
  tool_input: { command: cmd },
  tool_response: { stdout },
});

const commit = (salida, comando = 'git commit -m "feat: x"', extra = {}) => ({
  session_id: 's1',
  tool_name: 'Bash',
  tool_input: { command: comando },
  tool_response: { stdout: salida, stderr: '' },
  ...extra,
});

function ghCierra(raiz, cierra) {
  const script = path.join(raiz, 'gh-cierra.js');
  const nodos = cierra.map((c) => ({ number: Number(c.split('#')[1]), repository: { nameWithOwner: c.split('#')[0] } }));
  fs.writeFileSync(script, '#!/usr/bin/env node\n' +
    `console.log(JSON.stringify({ data: { repository: { pullRequest: { closingIssuesReferences: { nodes: ${JSON.stringify(nodos)} } } } } }))\n`);
  fs.chmodSync(script, 0o755);
  return { DUCK_GH: script };
}

module.exports = { SCRIPTS, temporales, GITHUB, JIRA, proyecto, correr, contexto, ENV_GIT, git, repo, leerSesion, escribirSesion, mover, transicionJira, bash, negado, merge, repoGithub, ticketFalso, ghFalso, issueCreado, prCreado, commit, ghCierra };
