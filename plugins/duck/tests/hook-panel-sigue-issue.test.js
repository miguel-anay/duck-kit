// Run: node --test plugins/duck/tests/*.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { GITHUB, proyecto, correr, repo, leerSesion, escribirSesion, mover, ticketFalso, prCreado, ghCierra } = require('./helpers');

// --- the panel follows the issue from the moment it is taken ---

const historiaDe = (raiz, sesion = 's1') => path.join(raiz, '.claude', 'estado', 'sesiones', `${sesion}-historia.json`);

// Stand-in for `ticket.js ver`: prints the issue with the given parent.
function verFalso(raiz, padre) {
  const script = path.join(raiz, 'ver-falso.js');
  fs.writeFileSync(script, `console.log(JSON.stringify({ clave: process.argv[3], padre: ${JSON.stringify(padre)} }))\n`);
  return { DUCK_TICKET_JS: script };
}

test('estado-tarea (github) creates the session story file with the parent issue when one is taken', () => {
  const raiz = proyecto(GITHUB);
  correr('estado-tarea.js', raiz, mover('Issue (org/app#12) movido a (In Progress)\n'), { env: verFalso(raiz, 'org/docs#3') });
  const datos = JSON.parse(fs.readFileSync(historiaDe(raiz), 'utf8'));
  assert.deepEqual(datos.historias, [{ historia: { clave: 'org/docs#3', titulo: '' }, subtareas: [] }]);
  assert.deepEqual(datos.alertas, []);
});

test('estado-tarea (github) uses the issue itself as the story when it has no parent', () => {
  const raiz = proyecto(GITHUB);
  correr('estado-tarea.js', raiz, mover('Issue (org/app#38) movido a (In Progress)\n'), { env: verFalso(raiz, null) });
  assert.equal(JSON.parse(fs.readFileSync(historiaDe(raiz), 'utf8')).historias[0].historia.clave, 'org/app#38');
});

test('estado-tarea keeps an existing session story file', () => {
  const raiz = proyecto(GITHUB);
  escribirSesion(raiz, 's1', { tareas: {} });
  const previo = { actualizado: 'x', alertas: [], historias: [{ historia: { clave: 'org/docs#9', titulo: 'HU' }, subtareas: [] }] };
  fs.writeFileSync(historiaDe(raiz), JSON.stringify(previo));
  correr('estado-tarea.js', raiz, mover('Issue (org/app#12) movido a (In Progress)\n'), { env: verFalso(raiz, 'org/docs#3') });
  assert.deepEqual(JSON.parse(fs.readFileSync(historiaDe(raiz), 'utf8')), previo);
});

test('estado-tarea (github) records an In Review move', () => {
  const raiz = proyecto(GITHUB);
  correr('estado-tarea.js', raiz, mover('Issue (org/app#12) movido a (In Review)\n', '#12', 'enRevision'), { env: verFalso(raiz, null) });
  assert.equal(leerSesion(raiz, 's1').tareas['org/app#12'].estado, 'In Review');
});

test('pr-a-revision records the In Review move in the session', () => {
  const raiz = proyecto(GITHUB);
  const falso = ticketFalso(raiz);
  correr('pr-a-revision.js', raiz, prCreado('gh pr create --fill'), { env: { ...falso.env, ...ghCierra(raiz, ['org/app#27']) } });
  assert.equal(leerSesion(raiz, 's1').tareas['org/app#27'].estado, 'In Review');
});

test('sticker (github) shows an issue that is In Review', () => {
  const raiz = proyecto(GITHUB);
  repo(raiz, 'main');
  escribirSesion(raiz, 's1', { tareas: { 'org/app#12': { estado: 'In Review', desde: new Date().toISOString() } } });
  const r = correr('sticker.js', raiz, { session_id: 's1', cwd: raiz });
  assert.ok(r.stdout.includes('org/app#12 >'), r.stdout);
});
