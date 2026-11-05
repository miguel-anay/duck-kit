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
