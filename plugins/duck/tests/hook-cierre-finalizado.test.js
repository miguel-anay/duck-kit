// Run: node --test plugins/duck/tests/*.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { GITHUB, JIRA, proyecto, correr, contexto, git, repo, leerSesion, mover, merge } = require('./helpers');

// --- cierre-finalizado ---


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
