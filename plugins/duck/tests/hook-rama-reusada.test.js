// Run: node --test plugins/duck/tests/*.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { GITHUB, JIRA, proyecto, correr, contexto, git, repo, bash, commit } = require('./helpers');

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
