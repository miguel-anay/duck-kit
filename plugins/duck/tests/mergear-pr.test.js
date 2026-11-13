// Run: node --test plugins/duck/tests/*.test.js
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'mergear-pr.js');
const SHA = 'a'.repeat(40);
const temporales = [];

// Fake GitHub API: the PR is open on main with head SHA, the check runs come from the env,
// and every merge request is logged to MERGES_LOG.
const FETCH_FALSO = `
const fs = require('fs');
globalThis.fetch = async (url, opts = {}) => {
  let body;
  if (opts.method === 'PUT') {
    fs.appendFileSync(process.env.MERGES_LOG, url + '\\n');
    body = { merged: true, sha: 'b'.repeat(40) };
  } else if (url.includes('/check-runs')) {
    body = { check_runs: JSON.parse(process.env.CHECK_RUNS) };
  } else {
    body = { base: { ref: 'main' }, state: 'open', head: { sha: '${SHA}', ref: 'fix/9-x' } };
  }
  return { json: async () => body };
};
`;

// Runs mergear-pr.js against the fake API with these check runs.
function mergear(checkRuns) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'duck-mergear-'));
  temporales.push(raiz);
  fs.mkdirSync(path.join(raiz, '.claude'));
  fs.writeFileSync(path.join(raiz, '.claude', 'duck.json'), JSON.stringify({
    git: { ramaBase: 'main', orgGithub: 'org', repos: { api: 'api' } },
  }));
  const preload = path.join(raiz, 'fetch.js');
  fs.writeFileSync(preload, FETCH_FALSO);
  const log = path.join(raiz, 'merges.log');
  fs.writeFileSync(log, '');
  const r = spawnSync(process.execPath, ['--require', preload, SCRIPT, 'api', '7', SHA], {
    cwd: raiz,
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: raiz,
      CHECK_RUNS: JSON.stringify(checkRuns),
      MERGES_LOG: log,
      GIT_TERMINAL_PROMPT: '0',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'credential.helper',
      GIT_CONFIG_VALUE_0: '!f() { echo username=x; echo password=token; }; f',
    },
  });
  return { codigo: r.status, salida: r.stdout, error: r.stderr, merges: fs.readFileSync(log, 'utf8') };
}

afterEach(() => {
  while (temporales.length) fs.rmSync(temporales.pop(), { recursive: true, force: true });
});

test('a skipped check run does not block the merge', () => {
  const r = mergear([
    { name: 'test', status: 'completed', conclusion: 'success' },
    { name: 'Build and push image to GHCR', status: 'completed', conclusion: 'skipped' },
  ]);
  assert.equal(r.codigo, 0, r.error);
  assert.match(r.salida, /api #7 mergeado/);
  assert.match(r.merges, /\/pulls\/7\/merge/);
});

// Regression: anything else that is not success still refuses, without merging.
test('a failed or pending check run still refuses the merge', () => {
  for (const run of [
    { name: 'test', status: 'completed', conclusion: 'failure' },
    { name: 'test', status: 'completed', conclusion: 'neutral' },
    { name: 'test', status: 'in_progress', conclusion: null },
  ]) {
    const r = mergear([run]);
    assert.equal(r.codigo, 1);
    assert.match(r.error, /checks sin éxito: test:/);
    assert.equal(r.merges, '');
  }
});

test('all check runs in success merge', () => {
  const r = mergear([{ name: 'test', status: 'completed', conclusion: 'success' }]);
  assert.equal(r.codigo, 0, r.error);
  assert.match(r.merges, /\/pulls\/7\/merge/);
});
