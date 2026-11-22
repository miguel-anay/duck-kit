// Run: node --test plugins/duck/tests/*.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { temporales, GITHUB, JIRA, proyecto, correr, contexto, git, repo, bash, negado, commit, SPEC } = require('./helpers');

// --- push-con-issue: no push or PR of a work branch without its issue ---

// Single-repo project whose origin is a local bare repo, on branch `rama`.
function conOrigen(duck, rama) {
  const raiz = proyecto(duck);
  repo(raiz, rama);
  const remoto = fs.mkdtempSync(path.join(os.tmpdir(), 'duck-origen-'));
  temporales.push(remoto);
  git(raiz, 'init', '-q', '--bare', remoto);
  git(raiz, 'remote', 'add', 'origin', remoto);
  return raiz;
}

// Stand-in for `ticket.js ver`: prints `issue` as JSON, or fails with `error` on stderr.
function ticketVer(raiz, { issue, error }) {
  const script = path.join(raiz, 'ticket-ver.js');
  fs.writeFileSync(
    script,
    error
      ? `console.error(${JSON.stringify('ticket.js: ' + error)}); process.exit(1);\n`
      : `console.log(${JSON.stringify(JSON.stringify(issue))});\n`
  );
  return { env: { DUCK_TICKET_JS: script } };
}

const ISSUE_OK = { clave: 'org/app#12', abierto: true, padre: 'org/app#3' };
const pushCon = (raiz, comando, cwd = raiz, opciones = ticketVer(raiz, { issue: ISSUE_OK })) =>
  correr('push-con-issue.js', raiz, bash(comando, cwd), opciones);
const motivo = (r) => JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason;

test('push-con-issue denies pushing a work branch without its issue number, in every push form', () => {
  const raiz = conOrigen(GITHUB, 'feat/release-signing');
  for (const c of ['git push -u origin feat/release-signing', 'git push', 'git push origin HEAD', 'git push origin HEAD:refs/heads/feat/sin-issue']) {
    const r = pushCon(raiz, c);
    assert.ok(negado(r), c);
    assert.match(motivo(r), /git branch -m/);
  }
});

test('push-con-issue reads the branch of git -C <dir> push in a multi-repo project', () => {
  const raiz = proyecto({ ...GITHUB, git: { ...GITHUB.git, repos: { app: 'org/app' } } });
  const app = path.join(raiz, 'app');
  fs.mkdirSync(app);
  repo(app, 'fix/arreglo');
  assert.ok(negado(pushCon(raiz, 'git -C app push -u origin fix/arreglo')));
});

test('push-con-issue lets through a keyed branch with an open issue under an HU, spikes, other branches and the base', () => {
  const raiz = conOrigen(GITHUB, 'feat/12-release-signing');
  for (const c of [
    'git push -u origin feat/12-release-signing',
    'git push origin HEAD:refs/heads/feat/12-release-signing',
    'git push origin spike/probar',
    'git push origin chore/x',
    'git push origin main',
  ]) {
    assert.ok(!negado(pushCon(raiz, c)), c);
  }
});

test('push-con-issue (github) denies an issue that is missing, closed or has no HU, and fails open when gh fails', () => {
  const raiz = conOrigen(GITHUB, 'feat/12-x');
  const comando = 'git push -u origin feat/12-x';
  for (const [caso, falso] of [
    ['missing', { error: 'no existe el issue org/app#12' }],
    ['missing (gh)', { error: "GraphQL: Could not resolve to an Issue with the number of 12. (repository.issue)" }],
    ['closed', { issue: { ...ISSUE_OK, abierto: false } }],
    ['Task with no HU', { issue: { ...ISSUE_OK, tipo: 'Task', padre: null } }],
  ]) {
    assert.ok(negado(pushCon(raiz, comando, raiz, ticketVer(raiz, falso))), caso);
  }
  const sinGh = pushCon(raiz, comando, raiz, ticketVer(raiz, { error: 'gh: command not found' }));
  assert.ok(!negado(sinGh));
  assert.match(contexto(sinGh), /no se pudo verificar el issue \S*#12/);
});

test('push-con-issue (github) lets a top-level Bug, Feature or untyped issue out without an HU', () => {
  const raiz = conOrigen(GITHUB, 'fix/12-x');
  for (const tipo of ['Bug', 'Feature', null]) {
    const r = pushCon(raiz, 'git push -u origin fix/12-x', raiz, ticketVer(raiz, { issue: { ...ISSUE_OK, tipo, padre: null } }));
    assert.ok(!negado(r), String(tipo));
  }
});

// A docs repo of a GitHub project: its origin reads as github.com/org/docs but resolves to a local bare repo.
function repoDocs(raiz) {
  const docs = path.join(raiz, 'docs');
  fs.mkdirSync(docs);
  repo(docs, 'docs/96-bitacora');
  const remoto = fs.mkdtempSync(path.join(os.tmpdir(), 'duck-origen-'));
  temporales.push(remoto);
  git(docs, 'init', '-q', '--bare', remoto);
  git(docs, 'remote', 'add', 'origin', 'https://github.com/org/docs.git');
  git(docs, 'config', `url.${remoto}.insteadOf`, 'https://github.com/org/docs.git');
  return docs;
}

// Stand-in for `ticket.js ver` that only knows the issues in `abiertos`.
function ticketsDe(raiz, abiertos) {
  const script = path.join(raiz, 'ticket-ver.js');
  fs.writeFileSync(
    script,
    `const abiertos = ${JSON.stringify(abiertos)}; const clave = process.argv[3];\n` +
      "if (!abiertos[clave]) { console.error('ticket.js: no existe el issue ' + clave); process.exit(1); }\n" +
      'console.log(JSON.stringify({ clave, abierto: true, ...abiertos[clave] }));\n'
  );
  return { env: { DUCK_TICKET_JS: script } };
}

test('push-con-issue (github) accepts a docs branch keyed by the story of the session when it lives in another repo', () => {
  const duck = { ...GITHUB, git: { ...GITHUB.git, prefijos: ['feat', 'fix', 'docs'], repos: { app: 'app', docs: 'docs' } } };
  const historia = (clave) => ({ historias: [{ historia: { clave, titulo: '' }, subtareas: [] }] });
  const sesiones = (raiz) => path.join(raiz, '.claude', 'estado', 'sesiones');
  const tickets = { 'org/app#96': { tipo: 'Feature', padre: null } };

  // A project with the app repo (origin org/app) and the docs repo, and the story the session is on.
  const con = (clave, tickets) => {
    const raiz = proyecto(duck);
    repoDocs(raiz);
    fs.mkdirSync(path.join(raiz, 'app'));
    repo(path.join(raiz, 'app'), 'main');
    git(path.join(raiz, 'app'), 'remote', 'add', 'origin', 'https://github.com/org/app.git');
    fs.mkdirSync(sesiones(raiz), { recursive: true });
    fs.writeFileSync(path.join(sesiones(raiz), 's1-historia.json'), JSON.stringify(historia(clave)));
    return correr('push-con-issue.js', raiz, bash('git -C docs push -u origin docs/96-bitacora', raiz), ticketsDe(raiz, tickets));
  };

  assert.ok(!negado(con('org/app#96', tickets)));
  assert.ok(!negado(con('ORG/App#96', tickets)));

  const otroNumero = con('org/app#97', tickets);
  assert.ok(negado(otroNumero));
  assert.match(motivo(otroNumero), /org\/docs#96 no existe/);
  // A story in a repo that is not part of the project does not count.
  assert.ok(negado(con('evil/x#96', { 'evil/x#96': { tipo: 'Feature', padre: null } })));
  // Nor does it override an issue of the docs repo that exists and is closed.
  const cerrado = con('org/app#96', { ...tickets, 'org/docs#96': { abierto: false } });
  assert.ok(negado(cerrado));
  assert.match(motivo(cerrado), /org\/docs#96 está cerrado/);
});

test('push-con-issue only warns for a branch already on the remote before the guard existed', () => {
  const raiz = conOrigen(GITHUB, 'feat/release-signing');
  git(raiz, 'push', '-q', 'origin', 'feat/release-signing');
  const r = pushCon(raiz, 'git push');
  assert.ok(!negado(r));
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /feat\/release-signing/);
});

test('push-con-issue (jira) needs the key in the branch and does not ask GitHub', () => {
  const raiz = conOrigen({ ...JIRA, jira: { proyecto: 'ABC' }, git: { ramaBase: 'main', prefijos: ['feature'] } }, 'feature/ABC-5-x');
  const falla = ticketVer(raiz, { error: 'no existe el issue' });
  assert.ok(!negado(pushCon(raiz, 'git push -u origin feature/ABC-5-x', raiz, falla)));
  assert.ok(negado(pushCon(raiz, 'git push origin HEAD:refs/heads/feature/arreglo', raiz, falla)));
});

test('push-con-issue requires gh pr create to reference the issue of its head branch in the body', () => {
  const raiz = conOrigen(GITHUB, 'feat/12-x');
  const cuerpo = path.join(raiz, 'cuerpo.md');
  fs.writeFileSync(cuerpo, 'Resumen\n\nCloses #12\n');
  for (const c of [
    'gh pr create --title "feat: x (#12)" --body "Refs #12"',
    'gh pr create --title "feat: x (#12)" --body "$(cat <<\'EOF\'\nResumen\n\nCloses #12\nEOF\n)"',
    `gh pr create --title "feat: x (#12)" --body-file ${cuerpo}`,
    'gh pr create --head feat/7-y --title "fix: y (#7)" --body "Closes org/app#7"',
    'gh pr create --head spike/z --title "z"',
  ]) {
    assert.ok(!negado(pushCon(raiz, c)), c);
  }
  for (const c of [
    'gh pr create --title "feat: x (#12)" --body "Closes #13"',
    'gh pr create --title "feat: x (#12)" --body "Resumen"',
    'gh pr create --fill',
    'gh pr create --head feat/sin-issue --title "x" --body "Refs #12"',
  ]) {
    assert.ok(negado(pushCon(raiz, c)), c);
  }
});

test('push-con-issue (github) warns, without denying, when a plan PR of a session with several stories does not name them all', () => {
  const duck = { ...GITHUB, git: { ...GITHUB.git, prefijos: ['feat', 'fix', 'docs'], repos: { app: 'app', docs: 'docs' } } };
  const con = (claves, cuerpo) => {
    const raiz = proyecto(duck);
    const docs = repoDocs(raiz);
    git(docs, 'branch', '-m', 'docs/148-plan');
    const sesiones = path.join(raiz, '.claude', 'estado', 'sesiones');
    fs.mkdirSync(sesiones, { recursive: true });
    const historias = claves.map((clave) => ({ historia: { clave, titulo: '' }, subtareas: [] }));
    fs.writeFileSync(path.join(sesiones, 's1-historia.json'), JSON.stringify({ historias }));
    return correr('push-con-issue.js', raiz, bash(`cd docs && gh pr create --title "docs: planes" --body "${cuerpo}"`, raiz));
  };
  const tres = ['org/docs#148', 'org/app#199', 'org/app#200'];

  const falta = con(tres, 'Refs #148\nRefs org/app#199');
  assert.ok(!negado(falta));
  assert.match(contexto(falta), /org\/app#200/);
  assert.doesNotMatch(contexto(falta), /org\/app#199|#148/);
  assert.match(contexto(falta), /Refs org\/app#200/);

  // All named (own repo bare or qualified, any case), one story only, or a branch that is not a story: silent.
  assert.equal(con(tres, 'Refs #148\nRefs org/app#199\nrefs Org/App#200').stdout, '');
  assert.equal(con(tres, 'Refs org/docs#148, Refs org/app#199 y Refs org/app#200').stdout, '');
  assert.equal(con(['org/docs#148'], 'Refs #148').stdout, '');
  assert.equal(con(['org/app#199', 'org/app#200'], 'Refs #148').stdout, '');
});

test('hooks.json runs push-con-issue before Bash commands', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'hooks', 'hooks.json'), 'utf8')).hooks;
  const bash = hooks.PreToolUse.find((h) => h.matcher === 'Bash').hooks;
  assert.ok(bash.some((h) => /push-con-issue\.js/.test(h.command)));
});

test('push-sobre-develop-al-dia blocks the first push of a branch behind origin/<base>, in every push form', () => {
  const raiz = conOrigen(GITHUB, 'main');
  git(raiz, 'push', '-q', 'origin', 'main');
  git(raiz, 'switch', '-q', '-c', 'feat/1-x');
  git(raiz, 'switch', '-q', 'main');
  git(raiz, 'commit', '-q', '--allow-empty', '-m', 'otra tarea');
  git(raiz, 'push', '-q', 'origin', 'main');
  git(raiz, 'switch', '-q', 'feat/1-x');
  for (const c of ['git push -u origin feat/1-x', 'git push', 'git push origin HEAD:feat/1-x', 'git -C . push origin feat/1-x']) {
    assert.ok(negado(correr('push-sobre-develop-al-dia.js', raiz, bash(c, raiz))), c);
  }
  for (const c of ['git push origin :feat/1-x', 'git push origin spike/y']) {
    assert.ok(!negado(correr('push-sobre-develop-al-dia.js', raiz, bash(c, raiz))), c);
  }
});

test('the push hooks follow a cd in the command: the session cwd is not where the push runs', () => {
  // The project root is not a repository; the repo is in app/, as when the agent works from the root.
  const raiz = proyecto({ ...GITHUB, git: { ...GITHUB.git, repos: { app: 'app' } } });
  const app = path.join(raiz, 'app');
  fs.mkdirSync(app);
  repo(app, 'main');
  const remoto = fs.mkdtempSync(path.join(os.tmpdir(), 'duck-origen-'));
  temporales.push(remoto);
  git(app, 'init', '-q', '--bare', remoto);
  git(app, 'remote', 'add', 'origin', remoto);
  git(app, 'push', '-q', 'origin', 'main');
  git(app, 'switch', '-q', '-c', 'feat/sin-issue');
  git(app, 'switch', '-q', 'main');
  git(app, 'commit', '-q', '--allow-empty', '-m', 'otra tarea');
  git(app, 'push', '-q', 'origin', 'main');
  git(app, 'switch', '-q', 'feat/sin-issue');

  for (const c of ['cd app && git push', `cd "${app}" && git add -A && git push -q -u origin HEAD`, 'cd app; git push']) {
    assert.ok(negado(pushCon(raiz, c)), c);
    assert.match(motivo(pushCon(raiz, c)), /feat\/sin-issue no lleva el número/, c);
    assert.ok(negado(correr('push-sobre-develop-al-dia.js', raiz, bash(c, raiz))), c);
  }
  // A cd that leaves the repo again is followed too.
  assert.ok(!negado(pushCon(raiz, 'cd app && cd .. && git push')));
});

test('a cd the hook cannot resolve keeps the directory it had: the push is still checked', () => {
  // The session cwd is the repository; these cd either return to it, stay in it or fail.
  const raiz = conOrigen(GITHUB, 'feat/sin-issue');
  fs.mkdirSync(path.join(raiz, 'sub'));
  for (const c of [
    'cd sub && ls && cd - && git push',
    'cd "$(git rev-parse --show-toplevel)" && git push',
    'cd $CLAUDE_PROJECT_DIR && git push',
    'cd "$PWD" && git push',
    'cd ~/no-existe-duck && git push',
    'cd nope; git push',
    'cd `pwd` && git push',
  ]) {
    assert.ok(negado(pushCon(raiz, c)), c);
  }
});

test('push-sobre-develop-al-dia warns, without blocking, when it cannot reach the remote', () => {
  const raiz = conOrigen(GITHUB, 'feat/1-x');
  git(raiz, 'remote', 'set-url', 'origin', path.join(raiz, 'no-existe'));
  const r = correr('push-sobre-develop-al-dia.js', raiz, bash('git push -u origin feat/1-x', raiz));
  assert.ok(!negado(r));
  assert.match(contexto(r), /no se pudo comprobar/);
});

test('push-con-issue (trabajo propio) needs the template branch and only warns when the spec is missing', () => {
  const raiz = conOrigen(SPEC, 'feature/spec-002-base');
  const falla = ticketVer(raiz, { error: 'no existe el issue' });
  const sinSpec = pushCon(raiz, 'git push -u origin feature/spec-002-base', raiz, falla);
  assert.ok(!negado(sinSpec));
  assert.match(sinSpec.stdout, /no encuentro docs\/specs\/002-base\/spec\.md, la fuente de SPEC-002/);
  fs.mkdirSync(path.join(raiz, 'docs', 'specs', '002-base'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'docs', 'specs', '002-base', 'spec.md'), '# SPEC-002');
  assert.equal(pushCon(raiz, 'git push -u origin feature/spec-002-base', raiz, falla).stdout, '');
  const sinClave = pushCon(raiz, 'git push origin HEAD:refs/heads/feature/arreglo', raiz, falla);
  assert.ok(negado(sinClave));
  assert.match(motivo(sinClave), /\{tipo\}\/spec-\{NNN\}-\{slug\}/);
});
