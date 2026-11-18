// Run: node --test plugins/duck/tests/*.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { SPEC, JIRA, proyecto, correr, contexto, leerSesion, escribirSesion, merge } = require('./helpers');

// --- enlace: a project unit (SPEC-002) linked to the Jira issue that tracks it (#42) ---

const enlazar = (stdout, command = 'node "/x/scripts/enlace.js" SPEC-002 GPDEV-123') => ({
  session_id: 's1',
  tool_name: 'Bash',
  tool_input: { command },
  tool_response: { stdout, stderr: '' },
});

const transicion = (clave, estado) => ({
  session_id: 's1',
  tool_name: 'mcp__atlassian__transitionJiraIssue',
  tool_input: { issueIdOrKey: clave },
  tool_response: { status: estado },
});

test('enlace.js prints the link for a unit key and a Jira key, and refuses anything else', () => {
  const raiz = proyecto(SPEC);
  const ok = correr('enlace.js', raiz, {}, { args: ['SPEC-002', 'GPDEV-123'] });
  assert.equal(ok.status, 0);
  assert.equal(ok.stdout.trim(), 'Enlace SPEC-002 -> GPDEV-123');
  for (const args of [['GPDEV-1', 'GPDEV-123'], ['SPEC-002', 'SPEC-3'], ['SPEC-002']]) {
    const r = correr('enlace.js', raiz, {}, { args });
    assert.equal(r.status, 1, args.join(' '));
    assert.equal(r.stdout, '');
  }
  const sinTrabajo = correr('enlace.js', proyecto(JIRA), {}, { args: ['SPEC-002', 'ABC-1'] });
  assert.equal(sinTrabajo.status, 1);
});

test('estado-tarea records the link from the enlace success line, not from the command', () => {
  const raiz = proyecto(SPEC);
  correr('estado-tarea.js', raiz, enlazar(''));
  assert.ok(!fs.existsSync(path.join(raiz, '.claude', 'estado', 'sesiones', 's1.json')));
  correr('estado-tarea.js', raiz, enlazar('Enlace SPEC-002 -> GPDEV-123\n'));
  assert.deepEqual(leerSesion(raiz, 's1').enlaces, { 'SPEC-002': 'GPDEV-123' });
});

test('a Jira transition of a linked issue lands on the unit key', () => {
  const raiz = proyecto(SPEC);
  escribirSesion(raiz, 's1', { tareas: {}, modo: 'tarea', enlaces: { 'SPEC-002': 'GPDEV-123' } });
  correr('estado-tarea.js', raiz, transicion('GPDEV-123', 'En Proceso'));
  const sesion = leerSesion(raiz, 's1');
  assert.equal(sesion.tareas['SPEC-002'].estado, 'En Proceso');
  assert.equal(sesion.tareas['GPDEV-123'], undefined);
  correr('estado-tarea.js', raiz, transicion('GPDEV-9', 'En Proceso'));
  assert.equal(leerSesion(raiz, 's1').tareas['GPDEV-9'].estado, 'En Proceso');
});

test('cierre-finalizado asks to transition the linked Jira issue, and nothing in Jira without a link', () => {
  const raiz = proyecto(SPEC);
  const cmd = 'curl -X PUT https://api.github.com/repos/org/app/pulls/3/merge # SPEC-002';
  assert.equal(contexto(correr('cierre-finalizado.js', raiz, merge('{"merged": true}', cmd))), '');
  assert.equal(leerSesion(raiz, 's1').tareas['SPEC-002'].estado, 'Mergeado');
  escribirSesion(raiz, 's1', { tareas: {}, modo: 'tarea', enlaces: { 'SPEC-002': 'GPDEV-123' } });
  assert.match(contexto(correr('cierre-finalizado.js', raiz, merge('{"merged": true}', cmd))), /^El PR app#3 se mergeo\. GPDEV-123 \(SPEC-002\) tiene que pasar a Finalizado/);
});
