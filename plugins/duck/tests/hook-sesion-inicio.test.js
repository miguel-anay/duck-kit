// Run: node --test plugins/duck/tests/*.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { SCRIPTS, temporales, GITHUB, JIRA, proyecto, correr, contexto, repo, leerSesion, escribirSesion, repoGithub, commit } = require('./helpers');

// --- sesion-inicio ---

test('sesion-inicio (github) lists #N branches and asks for gh, not JQL', () => {
  const raiz = proyecto({ ...GITHUB, github: { proyecto: { owner: 'org', numero: 5 } } });
  repo(raiz, 'feat/12-login');
  const texto = contexto(correr('sesion-inicio.js', raiz, {}));
  assert.match(texto, /\.: feat\/12-login -> #12/);
  assert.match(texto, /gh search issues --owner org --assignee @me --state open/);
  assert.doesNotMatch(texto, /JQL/);
});

test('sesion-inicio (jira) still asks for the JQL', () => {
  const raiz = proyecto(JIRA);
  repo(raiz, 'feature/ABC-1-x');
  const texto = contexto(correr('sesion-inicio.js', raiz, {}));
  assert.match(texto, /feature\/ABC-1-x -> ABC-1/);
  assert.match(texto, /Corre la JQL assignee = currentUser\(\) AND status = "En Proceso"/);
});

test('sesion-inicio names the test agents each repo runs, and only for repos that have any', () => {
  const raiz = proyecto({
    ...JIRA,
    git: { ramaBase: 'main', repos: { api: 'x-api', web: 'x-web', docs: 'x-docs' } },
    pruebas: { defecto: ['adversarial'], repos: { api: ['adversarial', 'propiedades', 'fuzz'], docs: [] } },
  });
  const texto = contexto(correr('sesion-inicio.js', raiz, {}));
  assert.match(texto, /- api: duck:adversario, duck:propiedades, duck:fuzz/);
  assert.match(texto, /- web: duck:adversario$/m);
  assert.doesNotMatch(texto, /- docs:/);
});

test('sesion-inicio says nothing about test agents when no repo has test types', () => {
  const raiz = proyecto({ ...JIRA, pruebas: { defecto: [], repos: { api: [] } } });
  assert.equal(correr('sesion-inicio.js', raiz, {}).stdout, '');
});

test('sesion-inicio tells an ODD project when duck:adversario gives way to a gentle-ai review', () => {
  const conOdd = proyecto({ ...JIRA, odd: { tareas: 'odd/tasks' }, pruebas: { defecto: ['adversarial', 'fuzz'] } });
  const texto = contexto(correr('sesion-inicio.js', conOdd, {}));
  assert.match(texto, /revision nativa de gentle-ai o Judgment Day.*duck:adversario no se lanza/);

  const sinOdd = proyecto({ ...JIRA, pruebas: { defecto: ['adversarial', 'fuzz'] } });
  assert.doesNotMatch(contexto(correr('sesion-inicio.js', sinOdd, {})), /gentle-ai/);

  const sinAdversarial = proyecto({ ...JIRA, odd: { tareas: 'odd/tasks' }, pruebas: { defecto: ['fuzz'] } });
  assert.doesNotMatch(contexto(correr('sesion-inicio.js', sinAdversarial, {})), /Judgment Day/);
});

test('sesion-inicio names the one reviewer the project chose in pruebas.revision', () => {
  const pruebas = { defecto: ['adversarial', 'fuzz'] };
  const deDuck = contexto(correr('sesion-inicio.js', proyecto({ ...JIRA, pruebas: { ...pruebas, revision: 'duck' } }), {}));
  assert.match(deDuck, /- \.: duck:adversario, duck:fuzz/);
  assert.match(deDuck, /la hace duck:adversario.*no inicies la revision nativa de gentle-ai ni Judgment Day/);
  assert.match(deDuck, /gentle-ai review mode disable --scope clone/);

  const deGentle = contexto(correr('sesion-inicio.js', proyecto({ ...JIRA, pruebas: { ...pruebas, revision: 'gentle-ai' } }), {}));
  assert.match(deGentle, /- \.: duck:fuzz$/m);
  assert.doesNotMatch(deGentle, /duck:adversario, /);
  assert.match(deGentle, /la hace gentle-ai.*duck:adversario no se lanza/);
});

test('sesion-inicio still says gentle-ai reviews when adversarial was the only type configured', () => {
  const raiz = proyecto({ ...JIRA, pruebas: { revision: 'gentle-ai', repos: { api: ['adversarial'] } } });
  const texto = contexto(correr('sesion-inicio.js', raiz, {}));
  assert.match(texto, /la hace gentle-ai.*duck:adversario no se lanza/);
  assert.doesNotMatch(texto, /- api:/);

  const sinAdversarial = proyecto({ ...JIRA, pruebas: { revision: 'gentle-ai', defecto: [] } });
  assert.equal(correr('sesion-inicio.js', sinAdversarial, {}).stdout, '');
});

test('sesion-inicio tells a cuando-riesgo project to run the test agents only for risky changes', () => {
  const conRiesgo = proyecto({ ...JIRA, pruebas: { cuando: 'riesgo', defecto: ['fuzz'] } });
  assert.match(contexto(correr('sesion-inicio.js', conRiesgo, {})), /solo si el cambio toca/);
  const siempre = proyecto({ ...JIRA, pruebas: { defecto: ['fuzz'] } });
  assert.doesNotMatch(contexto(correr('sesion-inicio.js', siempre, {})), /solo si el cambio toca/);
});

test('sesion-inicio tells the session the screen-test command of each repo that has one, and nothing otherwise', () => {
  const raiz = proyecto({
    ...JIRA,
    git: { ramaBase: 'main', repos: { web: 'x-web', api: 'x-api' } },
    pruebas: { e2e: { web: { comando: 'npx playwright test', tests: 'e2e' } } },
  });
  const texto = contexto(correr('sesion-inicio.js', raiz, {}));
  assert.match(texto, /Test de pantalla.*METODO\.md §10/);
  assert.match(texto, /- web: npx playwright test \(tests en e2e\)/);
  assert.doesNotMatch(texto, /- api:/);
  assert.equal(correr('sesion-inicio.js', proyecto(JIRA), {}).stdout, '');
});

// --- continued sessions inherit the previous session's tasks ---

function transcript(raiz, anterior) {
  const ruta = path.join(raiz, 'transcript.jsonl');
  fs.writeFileSync(ruta, JSON.stringify({ type: 'user', message: { content:
    `If you need specific details from before compaction, read the full transcript at: /home/u/.claude/projects/p/${anterior}.jsonl\nContinue the conversation` } }) + '\n');
  return ruta;
}

test('sesion-inicio copies tasks and mode of the session it continues', () => {
  const raiz = proyecto(GITHUB);
  const reciente = new Date().toISOString();
  escribirSesion(raiz, 'vieja-1', { tareas: { 'org/app#12': { estado: 'In Progress', desde: reciente } }, modo: 'flujo' });
  correr('sesion-inicio.js', raiz, { session_id: 'nueva-2', source: 'startup', transcript_path: transcript(raiz, 'vieja-1') });
  const nueva = leerSesion(raiz, 'nueva-2');
  assert.deepEqual(nueva.tareas, { 'org/app#12': { estado: 'In Progress', desde: reciente } });
  assert.equal(nueva.modo, 'flujo');
});

test('a continued session never overwrites its own tasks with the previous ones', () => {
  const raiz = proyecto(GITHUB);
  const reciente = new Date().toISOString();
  escribirSesion(raiz, 'vieja-1', { tareas: { 'org/app#12': { estado: 'In Progress', desde: reciente } } });
  escribirSesion(raiz, 'nueva-2', { tareas: { 'org/app#30': { estado: 'In Review', desde: reciente } }, modo: 'tarea' });
  correr('sesion-inicio.js', raiz, { session_id: 'nueva-2', transcript_path: transcript(raiz, 'vieja-1') });
  assert.deepEqual(Object.keys(leerSesion(raiz, 'nueva-2').tareas), ['org/app#30']);
});

test('tarea-por-commit inherits the previous session first when the summary arrived after the start', () => {
  const raiz = proyecto(GITHUB);
  repoGithub(raiz, 'feat/30-x');
  escribirSesion(raiz, 'vieja-1', { tareas: { 'org/app#12': { estado: 'In Progress', desde: new Date().toISOString() } } });
  correr('tarea-por-commit.js', raiz, commit('[feat/30-x 1a2b3c4] feat: x\n', undefined,
    { session_id: 'nueva-2', cwd: raiz, transcript_path: transcript(raiz, 'vieja-1') }));
  assert.deepEqual(Object.keys(leerSesion(raiz, 'nueva-2').tareas).sort(), ['org/app#12', 'org/app#30']);
});

test('inventario inherits the previous session from the transcript Claude Code keeps for the project', () => {
  const raiz = proyecto(GITHUB);
  const config = fs.mkdtempSync(path.join(os.tmpdir(), 'duck-config-'));
  temporales.push(config);
  const dir = path.join(config, 'projects', fs.realpathSync(raiz).replace(/[^A-Za-z0-9]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(transcript(raiz, 'vieja-1'), path.join(dir, 'nueva-2.jsonl'));
  escribirSesion(raiz, 'vieja-1', { tareas: { 'org/app#12': { estado: 'In Progress', desde: new Date().toISOString() } } });
  const r = spawnSync('node', [path.join(SCRIPTS, 'inventario.js'), 'nueva-2'], {
    cwd: raiz, env: { ...process.env, CLAUDE_PROJECT_DIR: raiz, CLAUDE_CONFIG_DIR: config }, encoding: 'utf8' });
  assert.deepEqual(Object.keys(JSON.parse(r.stdout).sesion), ['org/app#12']);
});
