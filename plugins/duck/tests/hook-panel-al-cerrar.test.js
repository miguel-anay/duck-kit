// Run: node --test plugins/duck/tests/*.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { GITHUB, JIRA, proyecto, correr, contexto, mover, transicionJira } = require('./helpers');

// --- panel-al-cerrar ---

test('panel-al-cerrar (github) asks for the panel only when the issue reaches Done', () => {
  const raiz = proyecto(GITHUB);
  const texto = contexto(correr('panel-al-cerrar.js', raiz, mover('Issue (org/app#12) movido a (Done)\n')));
  assert.match(texto, /^org\/app#12 acaba de quedar Done/);
  assert.match(texto, /ticket\.js" ver org\/app#12/);
  assert.equal(correr('panel-al-cerrar.js', raiz, mover('Issue (org/app#12) movido a (In Progress)\n')).stdout, '');
});

test('panel-al-cerrar (jira) still fires on a Finalizado transition', () => {
  const raiz = proyecto(JIRA);
  assert.match(contexto(correr('panel-al-cerrar.js', raiz, transicionJira('{"status":"Finalizado"}'))), /^ABC-5 acaba de quedar Finalizado/);
  assert.equal(correr('panel-al-cerrar.js', raiz, mover('Issue (org/app#12) movido a (Done)\n')).stdout, '');
});
