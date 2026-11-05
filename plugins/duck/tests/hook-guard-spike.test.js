// Run: node --test plugins/duck/tests/*.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { GITHUB, JIRA, proyecto, correr, git, repo, escribirSesion, mover, bash, negado, commit } = require('./helpers');

// --- guard-spike ---

function spike(duck) {
  const raiz = proyecto(duck);
  escribirSesion(raiz, 's1', { modo: 'spike', tareas: {} });
  return raiz;
}

test('guard-spike blocks GitHub ticket writes during a spike', () => {
  const raiz = spike(GITHUB);
  for (const c of [
    'node /x/scripts/ticket.js mover #12 enProceso',
    'gh issue comment 12 --body hola',
    'gh issue create --title x',
    'gh project item-edit --id 1',
    "gh api graphql -f query='mutation { x }'",
    'gh issue transfer 12 org/otro',
    'gh issue lock 12',
    'gh issue unlock 12',
    'gh issue pin 12',
    'gh issue unpin 12',
    'gh issue develop 12 --checkout',
    'gh issue develop 12 --name "x -l"',
    "gh issue develop 12 --base 'a --list'",
    'gh project item-add 5 --owner org --url x',
    'gh project item-delete 5 --id 1',
    'gh project item-archive 5 --id 1',
  ]) {
    assert.ok(negado(correr('guard-spike.js', raiz, bash(c))), c);
  }
  for (const c of ['gh issue view 12', 'gh issue develop 12 --list', 'gh issue develop -l 12', "gh api graphql -f query='query { x }'", 'node /x/ticket.js ver #12']) {
    assert.ok(!negado(correr('guard-spike.js', raiz, bash(c))), c);
  }
});

test('guard-spike (github) blocks gh with global flags and gh api REST writes, not reads', () => {
  const raiz = spike(GITHUB);
  for (const c of [
    'gh -R org/app issue comment 12 --body x',
    'gh --repo=org/app issue edit 12 --add-label x',
    'gh api -X POST repos/org/app/issues/12/comments -f body=x',
    'gh api --method PATCH /repos/org/app/issues/12 -f state=closed',
    'gh api repos/org/app/issues -f title=x',
    'gh api -XDELETE repos/org/app/issues/comments/9',
    'gh api -X POST orgs/org/projectsV2/5/items -F x=1',
  ]) {
    assert.ok(negado(correr('guard-spike.js', raiz, bash(c))), c);
  }
  for (const c of ['gh api repos/org/app/issues/12', 'gh -R org/app issue view 12', 'gh api -X GET repos/org/app/issues -f state=open']) {
    assert.ok(!negado(correr('guard-spike.js', raiz, bash(c))), c);
  }
});

test('guard-spike blocks a commit with a #N key on a spike branch (github)', () => {
  const raiz = spike(GITHUB);
  fs.mkdirSync(path.join(raiz, '.git'));
  fs.writeFileSync(path.join(raiz, '.git', 'HEAD'), 'ref: refs/heads/spike/x\n');
  assert.ok(negado(correr('guard-spike.js', raiz, bash('git commit -m "feat: x (#12)"', raiz))));
  assert.ok(!negado(correr('guard-spike.js', raiz, bash('git commit -m "feat: x"', raiz))));
});

test('guard-spike (jira) still blocks Jira MCP writes and lets gh issue through', () => {
  const raiz = spike(JIRA);
  assert.ok(negado(correr('guard-spike.js', raiz, { session_id: 's1', tool_name: 'mcp__atlassian__editJiraIssue' })));
  assert.ok(!negado(correr('guard-spike.js', raiz, bash('gh issue comment 12 --body x'))));
  assert.ok(!negado(correr('guard-spike.js', raiz, bash('gh -R org/app issue comment 12 --body x'))));
  assert.ok(!negado(correr('guard-spike.js', raiz, bash('gh api -X POST repos/org/app/issues -f title=x'))));
});
