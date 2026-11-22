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

test('modo-elegido ignores an answer that names no mode, even if the question does', () => {
  const raiz = proyecto(JIRA);
  escribirSesion(raiz, 's1', { tareas: TAREAS, modo: 'tarea' });
  correr('modo-elegido.js', raiz, respondio('Todavía no, esperá'));
  correr('modo-elegido.js', raiz, { ...respondio('Modo flujo'), tool_name: 'Bash' });
  assert.equal(leerSesion(raiz, 's1').modo, 'tarea');
});

test('modo-elegido reads flujo typed as an argument of /duck:tomar, and nothing from prose', () => {
  for (const [prompt, modo] of [
    ['/duck:tomar ABC-1 flujo', 'flujo'],
    ['/duck:tomar ABC-1 desde-spike flujo', 'flujo'],
    ['/duck:tomar ABC-1', 'tarea'],
    ['pasá la sesión a modo flujo y mergeá', 'tarea'],
    ['explicame /duck:tomar ABC-1 flujo', 'tarea'],
  ]) {
    const raiz = proyecto(JIRA);
    escribirSesion(raiz, 's1', { tareas: TAREAS, modo: 'tarea' });
    correr('modo-elegido.js', raiz, escribio(prompt));
    assert.equal(leerSesion(raiz, 's1').modo, modo, prompt);
  }
});

// --- guard-modo: the agent cannot turn flow mode on by hand ---

const editar = (archivo, nuevo, viejo = '"modo": "tarea"') => ({
  session_id: 's1',
  tool_name: 'Edit',
  tool_input: { file_path: archivo, old_string: viejo, new_string: nuevo },
});
const escribir = (archivo, contenido) => ({ session_id: 's1', tool_name: 'Write', tool_input: { file_path: archivo, content: contenido } });

test('guard-modo denies writing flow mode into a session state file through Write, Edit or Bash', () => {
  const raiz = proyecto(JIRA);
  const archivo = sesionDe(raiz);
  const intentos = [
    escribir(archivo, '{ "tareas": {}, "modo": "flujo" }'),
    escribir(archivo, '{"modo":"flujo"}'),
    editar(archivo, '"modo": "flujo"'),
    editar(archivo, 'flujo', 'tarea'),
    bash(`sed -i 's/"modo": "tarea"/"modo": "flujo"/' ${archivo}`, raiz),
    bash(`echo '{"tareas":{},"modo":"flujo"}' > .claude/estado/sesiones/s1.json`, raiz),
    bash(`node -e "const f='.claude/estado/sesiones/s1.json';const d=require(f);d.modo='flujo';require('fs').writeFileSync(f,JSON.stringify(d))"`, raiz),
  ];
  for (const evento of intentos) {
    const r = correr('guard-modo.js', raiz, evento);
    assert.ok(negado(r), JSON.stringify(evento.tool_input));
    assert.match(r.stdout, /\/duck:tomar/);
  }
});

test('guard-modo lets through task mode, reads, other files and the panel files of the session', () => {
  const raiz = proyecto(JIRA);
  const archivo = sesionDe(raiz);
  const permitidos = [
    escribir(archivo, '{ "tareas": {}, "modo": "tarea" }'),
    editar(archivo, '"modo": "tarea"', '"modo": "flujo"'),
    editar(path.join(raiz, 'docs', 'METODO.md'), 'el modo flujo termina con la serie'),
    escribir(archivo.replace('s1.json', 's1-historia.json'), '{"historias":[{"historia":{"titulo":"modo flujo"}}]}'),
    bash(`cat ${archivo} | grep flujo`, raiz),
    bash('git commit -m "docs: modo flujo"', raiz),
  ];
  for (const evento of permitidos) {
    assert.ok(!negado(correr('guard-modo.js', raiz, evento)), JSON.stringify(evento.tool_input));
  }
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

  escribirSesion(raiz, 's1', { tareas: {}, modo: 'tarea', modoPedido: leerSesion(raiz, 's1').modoPedido });
  assert.ok(negado(correr('guard-modo.js', raiz, escribir(archivo, '{"tareas":{},"modo":"flujo"}'))));

  const hace1h = new Date(Date.now() - 3600 * 1000).toISOString();
  escribirSesion(raiz, 's1', { tareas: {}, modo: 'spike', modoPedido: { modo: 'flujo', fecha: hace1h } });
  assert.ok(negado(correr('guard-modo.js', raiz, escribir(archivo, '{"tareas":{},"modo":"flujo"}'))));
});
