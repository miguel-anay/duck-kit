// Run: node --test plugins/duck/tests/*.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { temporales, GITHUB, JIRA, proyecto, correr, contexto, git, repo, bash, negado, commit } = require('./helpers');

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
    ['no HU', { issue: { ...ISSUE_OK, padre: null } }],
  ]) {
    assert.ok(negado(pushCon(raiz, comando, raiz, ticketVer(raiz, falso))), caso);
  }
  const sinGh = pushCon(raiz, comando, raiz, ticketVer(raiz, { error: 'gh: command not found' }));
  assert.ok(!negado(sinGh));
  assert.match(contexto(sinGh), /no se pudo verificar el issue \S*#12/);
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

test('push-sobre-develop-al-dia warns, without blocking, when it cannot reach the remote', () => {
  const raiz = conOrigen(GITHUB, 'feat/1-x');
  git(raiz, 'remote', 'set-url', 'origin', path.join(raiz, 'no-existe'));
  const r = correr('push-sobre-develop-al-dia.js', raiz, bash('git push -u origin feat/1-x', raiz));
  assert.ok(!negado(r));
  assert.match(contexto(r), /no se pudo comprobar/);
});
