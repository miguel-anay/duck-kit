// Run: node --test plugins/duck/tests/*.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { GITHUB, JIRA, proyecto, correr, contexto, repo, mover, bash, ticketFalso, prCreado, ghCierra } = require('./helpers');

// --- pr-a-revision ---


// Stand-in for ticket.js: records its argv and prints the success line of the real one.

// Stand-in for gh: answers the PR's closingIssuesReferences with `cierra` (owner/repo#N list).

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
