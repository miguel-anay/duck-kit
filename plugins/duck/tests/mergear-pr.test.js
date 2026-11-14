// Run: node --test plugins/duck/tests/*.test.js
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'mergear-pr.js');
const SHA = 'a'.repeat(40);
const temporales = [];
const VERDE = [{ name: 'test', status: 'completed', conclusion: 'success' }];
const SIN_STATUS = { state: 'pending', total_count: 0, statuses: [] };

// Fake GitHub API: the PR is open on main with head SHA, check runs and combined status come
// from the env, and every request URL is logged to MERGES_LOG (PUT lines start with "PUT ").
const FETCH_FALSO = `
const fs = require('fs');
globalThis.fetch = async (url, opts = {}) => {
  fs.appendFileSync(process.env.MERGES_LOG, (opts.method === 'PUT' ? 'PUT ' : 'GET ') + url + '\\n');
  let body;
  if (opts.method === 'PUT') body = { merged: true, sha: 'b'.repeat(40) };
  else if (url.endsWith('/check-runs')) body = JSON.parse(process.env.CHECK_RUNS);
  else if (url.endsWith('/status')) body = JSON.parse(process.env.STATUS);
  else body = { base: { ref: 'main' }, state: 'open', head: { sha: '${SHA}', ref: 'fix/9-x' } };
  return { json: async () => body };
};
`;

function repoGit(dir, origen) {
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q', dir]);
  execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', origen]);
}

// Runs mergear-pr.js against the fake API. `preparar(raiz)` lays out repos before the run.
function mergear({
  checkRuns = VERDE,
  status = SIN_STATUS,
  duck = { git: { ramaBase: 'main', orgGithub: 'org', repos: { api: 'api' } } },
  carpeta = 'api',
  preparar = () => {},
} = {}) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'duck-mergear-'));
  temporales.push(raiz);
  preparar(raiz);
  fs.mkdirSync(path.join(raiz, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(raiz, '.claude', 'duck.json'), JSON.stringify(duck));
  const preload = path.join(raiz, '.claude', 'fetch.js');
  fs.writeFileSync(preload, FETCH_FALSO);
  const log = path.join(raiz, '.claude', 'merges.log');
  fs.writeFileSync(log, '');
  const r = spawnSync(process.execPath, ['--require', preload, SCRIPT, carpeta, '7', SHA], {
    cwd: raiz,
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: raiz,
      CHECK_RUNS: JSON.stringify(Array.isArray(checkRuns) ? { total_count: checkRuns.length, check_runs: checkRuns } : checkRuns),
      STATUS: JSON.stringify(status),
      MERGES_LOG: log,
      GIT_TERMINAL_PROMPT: '0',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'credential.helper',
      GIT_CONFIG_VALUE_0: '!f() { echo username=x; echo password=token; }; f',
    },
  });
  const pedidos = fs.readFileSync(log, 'utf8');
  return { codigo: r.status, salida: r.stdout, error: r.stderr, pedidos, merges: pedidos.split('\n').filter((l) => l.startsWith('PUT ')) };
}

afterEach(() => {
  while (temporales.length) fs.rmSync(temporales.pop(), { recursive: true, force: true });
});

test('a skipped check run does not block the merge', () => {
  const r = mergear({ checkRuns: [...VERDE, { name: 'Build and push image to GHCR', status: 'completed', conclusion: 'skipped' }] });
  assert.equal(r.codigo, 0, r.error);
  assert.match(r.salida, /^api #7 mergeado: b{40} \(fix\/9-x\)$/m);
  assert.deepEqual(r.merges, ['PUT https://api.github.com/repos/org/api/pulls/7/merge']);
});

// Regression: anything else that is not success still refuses, without merging.
test('a failed or pending check run still refuses the merge', () => {
  for (const run of [
    { name: 'test', status: 'completed', conclusion: 'failure' },
    { name: 'test', status: 'completed', conclusion: 'neutral' },
    { name: 'test', status: 'in_progress', conclusion: null },
  ]) {
    const r = mergear({ checkRuns: [run] });
    assert.equal(r.codigo, 1);
    assert.match(r.error, /checks sin éxito: test:/);
    assert.deepEqual(r.merges, []);
  }
});

test('a mono-repo (git.repos empty) merges with folder "." and the repo of its origin', () => {
  const r = mergear({
    duck: { git: { ramaBase: 'main', orgGithub: 'org' } },
    carpeta: '.',
    preparar: (raiz) => repoGit(raiz, 'https://github.com/Owner/App.git'),
  });
  assert.equal(r.codigo, 0, r.error);
  assert.deepEqual(r.merges, ['PUT https://api.github.com/repos/owner/app/pulls/7/merge']);
  assert.match(r.salida, /^app #7 mergeado: /m);
});

test('the docs folder of duck.json merges when it is its own repo, and other folders still refuse', () => {
  const duck = { docs: 'docs', git: { ramaBase: 'main', orgGithub: 'org', repos: { api: 'api' } } };
  const preparar = (raiz) => repoGit(path.join(raiz, 'docs'), 'git@github.com:org/proj.docs.git');
  const r = mergear({ duck, carpeta: 'docs', preparar });
  assert.equal(r.codigo, 0, r.error);
  assert.deepEqual(r.merges, ['PUT https://api.github.com/repos/org/proj.docs/pulls/7/merge']);

  const otra = mergear({ duck, carpeta: 'web', preparar });
  assert.equal(otra.codigo, 1);
  assert.match(otra.error, /carpeta «web» no permitida; use una de: api, docs/);
  assert.equal(otra.pedidos, '');
});

test('a check-runs API error or a failing combined status refuses; no CI at all merges with a notice', () => {
  const error = mergear({ checkRuns: { message: 'Bad credentials' } });
  assert.equal(error.codigo, 1);
  assert.match(error.error, /no se pudieron leer los checks: Bad credentials/);
  assert.deepEqual(error.merges, []);

  for (const state of ['failure', 'error', 'pending']) {
    const r = mergear({ status: { state, total_count: 1, statuses: [{ context: 'ci/legacy', state }] } });
    assert.equal(r.codigo, 1, state);
    assert.match(r.error, new RegExp(`status del commit: ${state} \\(ci/legacy:${state}\\)`));
    assert.deepEqual(r.merges, []);
  }

  const statusError = mergear({ status: { message: 'Not Found' } });
  assert.equal(statusError.codigo, 1);
  assert.match(statusError.error, /no se pudo leer el status del commit: Not Found/);

  const sinCi = mergear({ checkRuns: [] });
  assert.equal(sinCi.codigo, 0, sinCi.error);
  assert.match(sinCi.error, /aviso: el commit no tiene checks ni statuses/);
  assert.equal(sinCi.merges.length, 1);
});

test('all check runs in success and a green status merge', () => {
  const r = mergear({ status: { state: 'success', total_count: 1, statuses: [{ context: 'ci/legacy', state: 'success' }] } });
  assert.equal(r.codigo, 0, r.error);
  assert.equal(r.error, '');
  assert.equal(r.merges.length, 1);
});
