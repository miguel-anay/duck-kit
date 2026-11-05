// Run: node --test plugins/duck/tests/*.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { GITHUB, JIRA, proyecto, correr, contexto, repo, mover, transicionJira, merge } = require('./helpers');

// --- historia-sigue-subtareas ---

test('historia-sigue-subtareas (github) reminds to move the parent issue', () => {
  const raiz = proyecto(GITHUB);
  const enProceso = contexto(correr('historia-sigue-subtareas.js', raiz, mover('Issue (org/app#12) movido a (In Progress)\n')));
  assert.match(enProceso, /^org\/app#12 paso a In Progress/);
  assert.match(enProceso, /mover <padre> enProceso/);
  const fin = contexto(correr('historia-sigue-subtareas.js', raiz, mover('Issue (org/app#12) movido a (Done)\n')));
  assert.match(fin, /todas sus hijas estan cerradas/);
  assert.match(fin, /Closes/);
});

test('historia-sigue-subtareas (github) sends the parent to Testing, not Done, when every child is closed', () => {
  const raiz = proyecto(GITHUB);
  const fin = contexto(correr('historia-sigue-subtareas.js', raiz, mover('Issue (org/app#12) movido a (Done)\n')));
  assert.match(fin, /mover <padre> pruebas`/);
  assert.doesNotMatch(fin, /mover <padre> finalizado/);
  assert.match(fin, /Done lo decide una persona/);
});

test('cierre-finalizado (github) sends an HU with sub-issues to Testing, not Done', () => {
  const raiz = proyecto(GITHUB);
  repo(raiz, 'fix/27-x');
  const texto = contexto(correr('cierre-finalizado.js', raiz, merge('{"merged": true}')));
  assert.match(texto, /pasa a Testing/);
  assert.match(texto, /Done lo decide una persona/);
});

test('historia-sigue-subtareas (jira) still reminds on En Proceso', () => {
  const raiz = proyecto(JIRA);
  assert.match(contexto(correr('historia-sigue-subtareas.js', raiz, transicionJira('{"status":"En Proceso"}'))), /^ABC-5 paso a En Proceso/);
});
