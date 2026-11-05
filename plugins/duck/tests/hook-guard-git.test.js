// Run: node --test plugins/duck/tests/*.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { SCRIPTS, GITHUB, proyecto, correr, git, repo, escribirSesion, bash, negado, merge } = require('./helpers');

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
