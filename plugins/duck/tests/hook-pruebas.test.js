// Run: node --test plugins/duck/tests/*.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JIRA, proyecto, correr, contexto, git, repo, bash, negado } = require('./helpers');

const PRUEBAS = { defecto: ['adversarial', 'fuzz'] };

// A repo on `rama`, branched from main, whose only change is `archivo`.
function ramaCon(dir, rama, archivo, contenido = 'x\n') {
  fs.mkdirSync(dir, { recursive: true });
  repo(dir, 'main');
  git(dir, 'checkout', '-q', '-b', rama);
  fs.mkdirSync(path.dirname(path.join(dir, archivo)), { recursive: true });
  fs.writeFileSync(path.join(dir, archivo), contenido);
  git(dir, 'add', archivo);
  git(dir, 'commit', '-q', '-m', 'cambio');
}

const lanzar = (agente, respuesta = 'done') => ({
  session_id: 's1',
  tool_name: 'Agent',
  tool_input: { subagent_type: agente, prompt: 'p' },
  tool_response: { content: [{ type: 'text', text: respuesta }] },
});
const dirPruebas = (raiz, rama) => path.join(raiz, '.claude', 'estado', 'pruebas', encodeURIComponent(rama));
// Test types recorded for a branch, sorted.
function anotado(raiz, rama) {
  try {
    return fs.readdirSync(dirPruebas(raiz, rama)).map((f) => f.replace(/\.json$/, '')).sort();
  } catch {
    return [];
  }
}

// --- pruebas-anota ---

test('pruebas-anota records which test agents ran for the current work branch', () => {
  const raiz = proyecto({ ...JIRA, pruebas: PRUEBAS });
  ramaCon(raiz, 'feature/ABC-1-x', 'a.js');
  correr('pruebas-anota.js', raiz, lanzar('duck:adversario'));
  correr('pruebas-anota.js', raiz, lanzar('duck:fuzz'));
  assert.deepEqual(anotado(raiz, 'feature/ABC-1-x'), ['adversarial', 'fuzz']);
});

test('pruebas-anota keeps one file per branch and type, so agents finishing together cannot lose a record', () => {
  const raiz = proyecto({ ...JIRA, pruebas: { defecto: ['adversarial', 'propiedades', 'fuzz'] } });
  ramaCon(raiz, 'feature/ABC-1-x', 'a.js');
  const { spawn } = require('child_process');
  const { SCRIPTS } = require('./helpers');
  const hijos = ['duck:adversario', 'duck:propiedades', 'duck:fuzz', 'duck:adversario'].map(
    (agente) =>
      new Promise((listo) => {
        const hijo = spawn('node', [path.join(SCRIPTS, 'pruebas-anota.js')], { cwd: raiz, env: { ...process.env, CLAUDE_PROJECT_DIR: raiz } });
        hijo.on('close', listo);
        hijo.stdin.end(JSON.stringify(lanzar(agente)));
      })
  );
  return Promise.all(hijos).then(() => assert.deepEqual(anotado(raiz, 'feature/ABC-1-x'), ['adversarial', 'fuzz', 'propiedades']));
});

test('pruebas-anota does not record an agent that returned blocked, nor a same-named agent that is not duck\'s', () => {
  const raiz = proyecto({ ...JIRA, pruebas: PRUEBAS });
  ramaCon(raiz, 'feature/ABC-1-x', 'a.js');
  correr('pruebas-anota.js', raiz, lanzar('duck:fuzz', 'No hay arnes de fuzzing en el repo.\n\n`blocked`'));
  correr('pruebas-anota.js', raiz, lanzar('fuzz'));
  correr('pruebas-anota.js', raiz, lanzar('otro:adversario'));
  assert.deepEqual(anotado(raiz, 'feature/ABC-1-x'), []);
  correr('pruebas-anota.js', raiz, lanzar('duck:fuzz', 'Corri 60 s por objetivo, sin caidas. `done`'));
  assert.deepEqual(anotado(raiz, 'feature/ABC-1-x'), ['fuzz']);
});

test('pruebas-anota records for the work branch of every repo and drops records older than 30 days', () => {
  const raiz = proyecto({ ...JIRA, git: { ramaBase: 'main', repos: { api: 'x-api', web: 'x-web' } }, pruebas: PRUEBAS });
  ramaCon(path.join(raiz, 'api'), 'feature/ABC-1-x', 'a.js');
  ramaCon(path.join(raiz, 'web'), 'feature/ABC-2-y', 'b.js');
  const vieja = path.join(dirPruebas(raiz, 'feature/ABC-0-vieja'), 'fuzz.json');
  fs.mkdirSync(path.dirname(vieja), { recursive: true });
  fs.writeFileSync(vieja, '{}');
  const hace40dias = new Date(Date.now() - 40 * 24 * 3600 * 1000);
  fs.utimesSync(vieja, hace40dias, hace40dias);

  correr('pruebas-anota.js', raiz, lanzar('duck:adversario'));
  assert.deepEqual(anotado(raiz, 'feature/ABC-1-x'), ['adversarial']);
  assert.deepEqual(anotado(raiz, 'feature/ABC-2-y'), ['adversarial']);
  assert.equal(fs.existsSync(vieja), false);
});

test('pruebas-anota ignores other agents and the base branch', () => {
  const raiz = proyecto({ ...JIRA, pruebas: PRUEBAS });
  ramaCon(raiz, 'feature/ABC-1-x', 'a.js');
  correr('pruebas-anota.js', raiz, lanzar('duck:escritor'));
  git(raiz, 'checkout', '-q', 'main');
  correr('pruebas-anota.js', raiz, lanzar('duck:adversario'));
  assert.equal(fs.existsSync(path.join(raiz, '.claude', 'estado', 'pruebas')), false);
});

test('pruebas-anota records a finished run whose report merely uses the word blocked', () => {
  const informes = [
    'The traversal is blocked by the validator; no crash in 60 s. `done`',
    'No blocked requests were found.',
    'Possible states are `blocked` or `partial`; this run covered two of three targets. `partial`',
  ];
  for (const informe of informes) {
    const raiz = proyecto({ ...JIRA, pruebas: PRUEBAS });
    ramaCon(raiz, 'feature/ABC-1-x', 'a.js');
    correr('pruebas-anota.js', raiz, lanzar('duck:fuzz', informe));
    assert.deepEqual(anotado(raiz, 'feature/ABC-1-x'), ['fuzz'], informe);
  }
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

test('push-con-pruebas ignores a record older than 30 days', () => {
  const raiz = proyecto({ ...JIRA, pruebas: { defecto: ['fuzz'] } });
  ramaCon(raiz, 'feature/ABC-6-x', 'a.js');
  correr('pruebas-anota.js', raiz, lanzar('duck:fuzz'));
  assert.equal(correr('push-con-pruebas.js', raiz, bash('git push', raiz)).stdout, '');
  const hace40dias = new Date(Date.now() - 40 * 24 * 3600 * 1000);
  fs.utimesSync(path.join(dirPruebas(raiz, 'feature/ABC-6-x'), 'fuzz.json'), hace40dias, hace40dias);
  assert.match(contexto(correr('push-con-pruebas.js', raiz, bash('git push', raiz))), /duck:fuzz/);
});

test('push-con-pruebas counts requirements.txt and an svg as code, and a branch it cannot compare as code', () => {
  for (const archivo of ['requirements.txt', 'icono.svg']) {
    const raiz = proyecto({ ...JIRA, pruebas: PRUEBAS });
    ramaCon(raiz, 'feature/ABC-7-x', archivo);
    assert.match(contexto(correr('push-con-pruebas.js', raiz, bash('git push', raiz))), /duck:adversario/, archivo);
  }
  const sinBase = proyecto({ ...JIRA, git: { ramaBase: 'develop' }, pruebas: PRUEBAS });
  ramaCon(sinBase, 'feature/ABC-8-x', 'README.md');
  assert.match(contexto(correr('push-con-pruebas.js', sinBase, bash('git push', sinBase))), /duck:adversario/);
});

test('push-con-pruebas checks the branch named in the push, not the one checked out', () => {
  const raiz = proyecto({ ...JIRA, pruebas: PRUEBAS });
  ramaCon(raiz, 'feature/ABC-9-x', 'a.js');
  git(raiz, 'checkout', '-q', 'main');
  assert.match(contexto(correr('push-con-pruebas.js', raiz, bash('git push origin feature/ABC-9-x', raiz))), /feature\/ABC-9-x/);
});

// --- pruebas.cuando: 'riesgo' ---

const RIESGO = { cuando: 'riesgo', defecto: ['adversarial', 'fuzz'] };
const avisoDe = (pruebas, archivo, contenido) => {
  const raiz = proyecto({ ...JIRA, pruebas });
  ramaCon(raiz, 'feature/ABC-1-x', archivo, contenido);
  return correr('push-con-pruebas.js', raiz, bash('git push', raiz));
};

test('with cuando riesgo, push-con-pruebas is silent for a change that touches nothing risky', () => {
  assert.equal(avisoDe(RIESGO, 'src/ui/saludo.js', "export const saludo = 'hola';\n").stdout, '');
  assert.match(contexto(avisoDe({ ...RIESGO, cuando: 'siempre' }, 'src/ui/saludo.js', "export const saludo = 'hola';\n")), /duck:adversario/);
});

test('with cuando riesgo, push-con-pruebas warns and says why: a risky path, risky code, or a project path', () => {
  const porRuta = contexto(avisoDe(RIESGO, 'src/validators/monto.js', 'export const ok = true;\n'));
  assert.match(porRuta, /duck:adversario, duck:fuzz/);
  assert.match(porRuta, /Motivo: .*src\/validators\/monto\.js/);

  const porCodigo = contexto(avisoDe(RIESGO, 'src/util/carga.js', 'export const leer = (t) => JSON.parse(t);\n'));
  assert.match(porCodigo, /Motivo: .*src\/util\/carga\.js.*JSON\.parse/);

  const delProyecto = contexto(avisoDe({ ...RIESGO, riesgo: ['src/mesas'] }, 'src/mesas/abrir.js', 'export const abrir = 1;\n'));
  assert.match(delProyecto, /Motivo: .*src\/mesas\/abrir\.js.*pruebas\.riesgo/);
});

test('with cuando riesgo, a branch that cannot be compared with the base still warns', () => {
  const raiz = proyecto({ ...JIRA, git: { ramaBase: 'develop' }, pruebas: RIESGO });
  ramaCon(raiz, 'feature/ABC-1-x', 'src/ui/saludo.js');
  assert.match(contexto(correr('push-con-pruebas.js', raiz, bash('git push', raiz))), /Motivo: no se pudo comparar/);
});
