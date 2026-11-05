// Run: node --test plugins/duck/tests/*.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { temporales, GITHUB, JIRA, proyecto, correr, git, repo, leerSesion, escribirSesion, bash, repoGithub, commit } = require('./helpers');

// --- tarea-por-commit: a commit on a task branch records the task in the session ---



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
