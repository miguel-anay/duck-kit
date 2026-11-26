// Run: node --test plugins/duck/tests/*.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JIRA, proyecto, correr, leerSesion, escribirSesion, bash } = require('./helpers');

const sesiones = (raiz) => path.join(raiz, '.claude', 'estado', 'sesiones');
const HORA = 3600 * 1000;
const DIA = 24 * HORA;
function envejecer(raiz, archivo, ms) {
  const cuando = new Date(Date.now() - ms);
  fs.utimesSync(path.join(sesiones(raiz), archivo), cuando, cuando);
}
const edad = (raiz, archivo) => Date.now() - fs.statSync(path.join(sesiones(raiz), archivo)).mtimeMs;
// What another session of the same project does on every turn: it saves its own state.
const otraSesionEscribe = (raiz) => correr('modo-elegido.js', raiz, { session_id: 'otra', hook_event_name: 'UserPromptSubmit', prompt: '/duck:tomar ABC-9 tarea' });

// --- the sweep of the sessions folder ---

test('a session that has not written its state for a day is not swept by another session', () => {
  const raiz = proyecto(JIRA);
  escribirSesion(raiz, 'larga', { tareas: {}, modo: 'flujo', flujoAutorizado: 'x' });
  fs.writeFileSync(path.join(sesiones(raiz), 'larga-historia.json'), '{"historias":[]}');
  for (const archivo of ['larga.json', 'larga-historia.json']) envejecer(raiz, archivo, 30 * HORA);

  otraSesionEscribe(raiz);
  assert.equal(leerSesion(raiz, 'larga').modo, 'flujo');
  assert.ok(fs.existsSync(path.join(sesiones(raiz), 'larga-historia.json')));
});

test('state nobody touched for two weeks is still swept, so the folder does not grow forever', () => {
  const raiz = proyecto(JIRA);
  escribirSesion(raiz, 'muerta', { tareas: {}, modo: 'tarea' });
  envejecer(raiz, 'muerta.json', 15 * DIA);
  otraSesionEscribe(raiz);
  assert.equal(fs.existsSync(path.join(sesiones(raiz), 'muerta.json')), false);
});

test('every hook run of a session refreshes its own state files, and only its own', () => {
  const raiz = proyecto(JIRA);
  for (const id of ['s1', 'ajena']) {
    escribirSesion(raiz, id, { tareas: {}, modo: 'tarea' });
    fs.writeFileSync(path.join(sesiones(raiz), `${id}-historia.json`), '{"historias":[]}');
    for (const archivo of [`${id}.json`, `${id}-historia.json`]) envejecer(raiz, archivo, 13 * DIA);
  }
  // Any hook of session s1: here a harmless Bash command through guard-git.
  correr('guard-git.js', raiz, bash('git status', raiz));
  assert.ok(edad(raiz, 's1.json') < HORA);
  assert.ok(edad(raiz, 's1-historia.json') < HORA);
  assert.ok(edad(raiz, 'ajena.json') > 12 * DIA);
  // Refreshing does not create a state file for a session that had none.
  correr('guard-git.js', raiz, { ...bash('git status', raiz), session_id: 'nueva' });
  assert.equal(fs.existsSync(path.join(sesiones(raiz), 'nueva.json')), false);
});

test('a session active for weeks keeps its flow mode: its own hooks keep the state fresh', () => {
  const raiz = proyecto(JIRA);
  escribirSesion(raiz, 's1', { tareas: {}, modo: 'flujo', flujoAutorizado: 'x' });
  envejecer(raiz, 's1.json', 13 * DIA);
  correr('guard-git.js', raiz, bash('git status', raiz));
  // Three more days pass for everyone else; without the refresh the file would now be 16 days old.
  otraSesionEscribe(raiz);
  assert.equal(leerSesion(raiz, 's1').modo, 'flujo');
});
