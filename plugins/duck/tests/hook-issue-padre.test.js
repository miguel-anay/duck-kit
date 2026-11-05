// Run: node --test plugins/duck/tests/*.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { GITHUB, proyecto, correr, contexto, repo, bash, ghFalso, issueCreado } = require('./helpers');

// --- issue-padre ---


// Stand-in for gh: logs each call, answers the issue read with `cuerpo` and any write with {}.

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
