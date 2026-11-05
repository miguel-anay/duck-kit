// Run: node --test plugins/duck/tests/*.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { GITHUB, proyecto, correr, contexto, bash, ghFalso, issueCreado } = require('./helpers');

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
