// Run: node --test plugins/duck/tests/*.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { JIRA, proyecto, correr, leerSesion, escribirSesion, bash, negado } = require('./helpers');

const TAREAS = { 'ABC-1': { estado: 'enProceso', desde: new Date().toISOString() } };
const respondio = (respuesta, pregunta = '¿Cómo tomamos ABC-1: modo tarea o modo flujo?') => ({
  session_id: 's1',
  hook_event_name: 'PostToolUse',
  tool_name: 'AskUserQuestion',
  tool_input: { questions: [{ question: pregunta, options: [{ label: 'Modo tarea' }, { label: 'Modo flujo' }] }] },
  tool_response: { questions: [], answers: { [pregunta]: respuesta } },
});
const escribio = (prompt) => ({ session_id: 's1', hook_event_name: 'UserPromptSubmit', prompt });
const sesionDe = (raiz) => path.join(raiz, '.claude', 'estado', 'sesiones', 's1.json');

// --- modo-elegido: the person's own choice turns flow mode on ---

test('modo-elegido marks flow or task mode from the answer to the mode question, keeping the tasks', () => {
  const raiz = proyecto(JIRA);
  escribirSesion(raiz, 's1', { tareas: TAREAS, modo: 'tarea' });
  correr('modo-elegido.js', raiz, respondio('Modo flujo (Recomendado)'));
  assert.equal(leerSesion(raiz, 's1').modo, 'flujo');
  assert.deepEqual(Object.keys(leerSesion(raiz, 's1').tareas), ['ABC-1']);
  correr('modo-elegido.js', raiz, respondio('modo tarea'));
  assert.equal(leerSesion(raiz, 's1').modo, 'tarea');
});

test('modo-elegido ignores an answer that names no mode, an unrelated question and a mode merely mentioned', () => {
  const sinCambio = [
    respondio('Todavía no, esperá'),
    respondio('No quiero modo flujo'),
    { ...respondio('Modo flujo'), tool_name: 'Bash' },
    { ...respondio('Sí, como en modo flujo', '¿Mergeo el PR 40?'), tool_input: { questions: [{ question: '¿Mergeo el PR 40?', options: [{ label: 'Sí' }, { label: 'No' }] }] } },
  ];
  for (const evento of sinCambio) {
    const raiz = proyecto(JIRA);
    escribirSesion(raiz, 's1', { tareas: TAREAS, modo: 'tarea' });
    correr('modo-elegido.js', raiz, evento);
    assert.equal(leerSesion(raiz, 's1').modo, 'tarea', JSON.stringify(evento.tool_response));
  }
});

test('modo-elegido takes the mode the answer starts with, and a bare flujo typed as the answer', () => {
  for (const [respuesta, modo] of [
    ['Modo tarea, nada de modo flujo todavía', 'tarea'],
    ['flujo', 'flujo'],
    ['MODO FLUJO', 'flujo'],
  ]) {
    const raiz = proyecto(JIRA);
    escribirSesion(raiz, 's1', { tareas: TAREAS, modo: modo === 'flujo' ? 'tarea' : 'flujo', flujoAutorizado: 'x' });
    correr('modo-elegido.js', raiz, respondio(respuesta));
    assert.equal(leerSesion(raiz, 's1').modo, modo, respuesta);
  }
});

test('modo-elegido reads the mode only as the argument of /duck:tomar, in any case, never from prose', () => {
  for (const [prompt, modo] of [
    ['/duck:tomar ABC-1 flujo', 'flujo'],
    ['/duck:tomar ABC-1 Flujo', 'flujo'],
    ['/duck:tomar ABC-1 flujo.', 'flujo'],
    ['/duck:tomar ABC-1 desde-spike flujo', 'flujo'],
    ['/duck:tomar ABC-1', 'tarea'],
    ['/duck:tomar ABC-1 pero no en flujo todavia', 'tarea'],
    ['pasá la sesión a modo flujo y mergeá', 'tarea'],
    ['explicame /duck:tomar ABC-1 flujo', 'tarea'],
  ]) {
    const raiz = proyecto(JIRA);
    escribirSesion(raiz, 's1', { tareas: TAREAS, modo: 'tarea' });
    correr('modo-elegido.js', raiz, escribio(prompt));
    assert.equal(leerSesion(raiz, 's1').modo, modo, prompt);
  }
});

test('modo-elegido leaves its authorization next to flow mode and removes it with task mode', () => {
  const raiz = proyecto(JIRA);
  escribirSesion(raiz, 's1', { tareas: TAREAS, modo: 'tarea' });
  correr('modo-elegido.js', raiz, respondio('Modo flujo'));
  assert.ok(leerSesion(raiz, 's1').flujoAutorizado);
  correr('modo-elegido.js', raiz, respondio('Modo tarea'));
  assert.equal('flujoAutorizado' in leerSesion(raiz, 's1'), false);
});

// --- guard-modo: the agent cannot turn flow mode on by hand ---

const editar = (archivo, nuevo, viejo = '"modo": "tarea"') => ({
  session_id: 's1',
  tool_name: 'Edit',
  tool_input: { file_path: archivo, old_string: viejo, new_string: nuevo },
});
const escribir = (archivo, contenido) => ({ session_id: 's1', tool_name: 'Write', tool_input: { file_path: archivo, content: contenido } });

const despues = (evento) => ({ ...evento, hook_event_name: 'PostToolUse', tool_response: {} });

test('guard-modo denies Write and Edit that put flow mode into a session state file, however the path is spelled', () => {
  const raiz = proyecto(JIRA);
  const archivo = sesionDe(raiz);
  const intentos = [
    escribir(archivo, '{ "tareas": {}, "modo": "flujo" }'),
    escribir(archivo, '{"modo":"flujo"}'),
    escribir(archivo.replace('sesiones', 'sesiones/../sesiones'), '{"modo":"flujo"}'),
    escribir(archivo.replace('estado/sesiones', 'estado//sesiones'), '{"modo":"flujo"}'),
    editar(archivo, '"modo": "flujo"'),
    editar(archivo, 'flujo', 'tarea'),
    { session_id: 's1', tool_name: 'MultiEdit', tool_input: { file_path: archivo, edits: [{ old_string: 'tarea', new_string: 'flujo' }] } },
  ];
  for (const evento of intentos) {
    const r = correr('guard-modo.js', raiz, evento);
    assert.ok(negado(r), JSON.stringify(evento.tool_input));
    assert.match(r.stdout, /\/duck:tomar/);
  }
});

test('guard-modo lets through task mode, a spike theme that contains the word, other files and the panel files', () => {
  const raiz = proyecto(JIRA);
  const archivo = sesionDe(raiz);
  const permitidos = [
    escribir(archivo, '{ "tareas": {}, "modo": "tarea" }'),
    editar(archivo, '"modo": "tarea"', '"modo": "flujo"'),
    editar(archivo, '"modo": "spike", "spike": { "tema": "flujo-de-caja" }'),
    editar(path.join(raiz, 'docs', 'METODO.md'), 'el modo flujo termina con la serie'),
    escribir(archivo.replace('s1.json', 's1-historia.json'), '{"historias":[{"historia":{"titulo":"modo flujo"}}]}'),
  ];
  for (const evento of permitidos) {
    assert.ok(!negado(correr('guard-modo.js', raiz, evento)), JSON.stringify(evento.tool_input));
  }
});

test('guard-modo never denies a Bash command: reads and the return to task mode run', () => {
  const raiz = proyecto(JIRA);
  const archivo = sesionDe(raiz);
  for (const comando of [
    `sed -i 's/"modo": "flujo"/"modo": "tarea"/' ${archivo}`,
    `jq '.modo="tarea"' ${archivo} > /tmp/x && mv /tmp/x ${archivo} # fin del flujo`,
    `grep '"modo": "flujo"' ${archivo} 2>/dev/null`,
    `python3 -c "import json;print(json.load(open('${archivo}'))['modo']=='flujo')"`,
  ]) {
    assert.ok(!negado(correr('guard-modo.js', raiz, bash(comando, raiz))), comando);
  }
});

test('guard-modo puts the session back in task mode when flow mode appears without the person choosing it', () => {
  const raiz = proyecto(JIRA);
  // However it was written: a variable path, a cd, a temp file moved in. Only the result is checked.
  escribirSesion(raiz, 's1', { tareas: TAREAS, modo: 'flujo' });
  const r = correr('guard-modo.js', raiz, despues(bash('f=$(ls -t .claude/estado/sesiones/*.json | head -1); jq \'.modo="flujo"\' "$f" > /tmp/x && mv /tmp/x "$f"', raiz)));
  assert.equal(leerSesion(raiz, 's1').modo, 'tarea');
  assert.deepEqual(Object.keys(leerSesion(raiz, 's1').tareas), ['ABC-1']);
  assert.match(r.stdout, /\/duck:tomar/);
});

test('guard-modo keeps the flow mode the person chose, and forgets the authorization once the session leaves it', () => {
  const raiz = proyecto(JIRA);
  escribirSesion(raiz, 's1', { tareas: TAREAS, modo: 'tarea' });
  correr('modo-elegido.js', raiz, respondio('Modo flujo'));
  assert.equal(correr('guard-modo.js', raiz, despues(bash('git status', raiz))).stdout, '');
  assert.equal(leerSesion(raiz, 's1').modo, 'flujo');

  // The series ends: the agent returns to task mode by hand, then tries to turn flow back on.
  escribirSesion(raiz, 's1', { ...leerSesion(raiz, 's1'), modo: 'tarea' });
  correr('guard-modo.js', raiz, despues(bash('git status', raiz)));
  assert.equal('flujoAutorizado' in leerSesion(raiz, 's1'), false);
  escribirSesion(raiz, 's1', { ...leerSesion(raiz, 's1'), modo: 'flujo' });
  correr('guard-modo.js', raiz, despues(bash('git status', raiz)));
  assert.equal(leerSesion(raiz, 's1').modo, 'tarea');
});

// --- leaving a spike in flow mode ---

test('from a spike, modo-elegido only notes the request and guard-modo lets /duck:tomar apply it once', () => {
  const raiz = proyecto(JIRA);
  const archivo = sesionDe(raiz);
  escribirSesion(raiz, 's1', { tareas: {}, modo: 'spike', spike: { tema: 'x' } });
  assert.ok(negado(correr('guard-modo.js', raiz, escribir(archivo, '{"tareas":{},"modo":"flujo"}'))));

  correr('modo-elegido.js', raiz, escribio('/duck:tomar ABC-1 desde-spike flujo'));
  assert.equal(leerSesion(raiz, 's1').modo, 'spike');
  assert.equal(leerSesion(raiz, 's1').modoPedido.modo, 'flujo');
  assert.ok(!negado(correr('guard-modo.js', raiz, escribir(archivo, '{"tareas":{},"modo":"flujo"}'))));

  // /duck:tomar leaves the spike in flow mode: the request becomes the authorization, once.
  escribirSesion(raiz, 's1', { tareas: {}, modo: 'flujo', modoPedido: leerSesion(raiz, 's1').modoPedido });
  correr('guard-modo.js', raiz, despues(escribir(archivo, '{}')));
  assert.equal(leerSesion(raiz, 's1').modo, 'flujo');
  assert.ok(leerSesion(raiz, 's1').flujoAutorizado);
  assert.equal('modoPedido' in leerSesion(raiz, 's1'), false);

  escribirSesion(raiz, 's1', { tareas: {}, modo: 'tarea', modoPedido: { modo: 'flujo', fecha: new Date().toISOString() } });
  assert.ok(negado(correr('guard-modo.js', raiz, escribir(archivo, '{"tareas":{},"modo":"flujo"}'))));

  const hace1h = new Date(Date.now() - 3600 * 1000).toISOString();
  escribirSesion(raiz, 's1', { tareas: {}, modo: 'spike', modoPedido: { modo: 'flujo', fecha: hace1h } });
  assert.ok(negado(correr('guard-modo.js', raiz, escribir(archivo, '{"tareas":{},"modo":"flujo"}'))));
});
