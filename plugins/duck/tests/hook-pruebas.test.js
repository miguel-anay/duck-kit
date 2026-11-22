// Run: node --test plugins/duck/tests/*.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JIRA, proyecto, correr, contexto, git, repo, bash, negado } = require('./helpers');

const PRUEBAS = { defecto: ['adversarial', 'fuzz'] };

// A repo on `rama`, branched from main, whose only change is `archivo`.
function ramaCon(dir, rama, archivo) {
  fs.mkdirSync(dir, { recursive: true });
  repo(dir, 'main');
  git(dir, 'checkout', '-q', '-b', rama);
  fs.writeFileSync(path.join(dir, archivo), 'x\n');
  git(dir, 'add', archivo);
  git(dir, 'commit', '-q', '-m', 'cambio');
}

const lanzar = (agente) => ({ session_id: 's1', tool_name: 'Agent', tool_input: { subagent_type: agente, prompt: 'p' } });
const anotado = (raiz) => JSON.parse(fs.readFileSync(path.join(raiz, '.claude', 'estado', 'pruebas.json'), 'utf8'));

// --- pruebas-anota ---

test('pruebas-anota records which test agents ran for the current work branch', () => {
  const raiz = proyecto({ ...JIRA, pruebas: PRUEBAS });
  ramaCon(raiz, 'feature/ABC-1-x', 'a.js');
  correr('pruebas-anota.js', raiz, lanzar('duck:adversario'));
  correr('pruebas-anota.js', raiz, lanzar('fuzz'));
  assert.deepEqual(Object.keys(anotado(raiz)['feature/ABC-1-x']).sort(), ['adversarial', 'fuzz']);
});

test('pruebas-anota ignores other agents and the base branch', () => {
  const raiz = proyecto({ ...JIRA, pruebas: PRUEBAS });
  ramaCon(raiz, 'feature/ABC-1-x', 'a.js');
  correr('pruebas-anota.js', raiz, lanzar('duck:escritor'));
  git(raiz, 'checkout', '-q', 'main');
  correr('pruebas-anota.js', raiz, lanzar('duck:adversario'));
  assert.equal(fs.existsSync(path.join(raiz, '.claude', 'estado', 'pruebas.json')), false);
});

// --- push-con-pruebas ---

test('push-con-pruebas warns, never denies, naming the agents that have not run for the branch', () => {
  const raiz = proyecto({ ...JIRA, pruebas: PRUEBAS });
  ramaCon(raiz, 'feature/ABC-1-x', 'a.js');
  for (const c of ['git push -u origin feature/ABC-1-x', 'git push', 'git push origin HEAD']) {
    const r = correr('push-con-pruebas.js', raiz, bash(c, raiz));
    assert.ok(!negado(r), c);
    assert.match(contexto(r), /feature\/ABC-1-x.*duck:adversario, duck:fuzz/, c);
  }

  correr('pruebas-anota.js', raiz, lanzar('duck:adversario'));
  const falta = contexto(correr('push-con-pruebas.js', raiz, bash('git push', raiz)));
  assert.match(falta, /duck:fuzz/);
  assert.doesNotMatch(falta, /duck:adversario,/);

  correr('pruebas-anota.js', raiz, lanzar('duck:fuzz'));
  assert.equal(correr('push-con-pruebas.js', raiz, bash('git push', raiz)).stdout, '');
});

test('push-con-pruebas is silent for a docs-only branch, the base branch and a project without test types', () => {
  const docs = proyecto({ ...JIRA, pruebas: PRUEBAS });
  ramaCon(docs, 'feature/ABC-2-docs', 'README.md');
  assert.equal(correr('push-con-pruebas.js', docs, bash('git push', docs)).stdout, '');
  assert.equal(correr('push-con-pruebas.js', docs, bash('git push origin main', docs)).stdout, '');

  const sin = proyecto(JIRA);
  ramaCon(sin, 'feature/ABC-3-x', 'a.js');
  assert.equal(correr('push-con-pruebas.js', sin, bash('git push', sin)).stdout, '');
});

test('push-con-pruebas uses the test types of the repo being pushed in a multi-repo project', () => {
  const raiz = proyecto({
    ...JIRA,
    git: { ramaBase: 'main', repos: { api: 'x-api', web: 'x-web' } },
    pruebas: { repos: { api: ['propiedades'], web: [] } },
  });
  ramaCon(path.join(raiz, 'api'), 'feature/ABC-4-x', 'a.js');
  ramaCon(path.join(raiz, 'web'), 'feature/ABC-4-x', 'b.js');
  assert.match(contexto(correr('push-con-pruebas.js', raiz, bash('git -C api push', raiz))), /duck:propiedades/);
  assert.equal(correr('push-con-pruebas.js', raiz, bash('git -C web push', raiz)).stdout, '');
});

test('push-con-pruebas tells an auto project that a gentle-ai review stands in for duck:adversario', () => {
  const raiz = proyecto({ ...JIRA, odd: { tareas: 'odd/tasks' }, pruebas: { defecto: ['adversarial'] } });
  ramaCon(raiz, 'feature/ABC-5-x', 'a.js');
  assert.match(contexto(correr('push-con-pruebas.js', raiz, bash('git push', raiz))), /gentle-ai/);
  const deDuck = proyecto({ ...JIRA, odd: { tareas: 'odd/tasks' }, pruebas: { defecto: ['adversarial'], revision: 'duck' } });
  ramaCon(deDuck, 'feature/ABC-5-x', 'a.js');
  assert.doesNotMatch(contexto(correr('push-con-pruebas.js', deDuck, bash('git push', deDuck))), /gentle-ai/);
});
