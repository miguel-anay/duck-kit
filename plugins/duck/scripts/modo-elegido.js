// Hook PostToolUse sobre AskUserQuestion y UserPromptSubmit: el modo de la sesion (tarea o flujo)
// lo marca la eleccion de la persona, no el agente.
//
// El modo flujo quita la puerta de una serie entera (METODO.md §3): el agente hace push, abre el PR
// y mergea sin volver a preguntar. Antes lo activaba el propio agente editando el estado de la
// sesion, y nada le impedia volver a activarlo despues. Ahora hay dos senales, las dos de la persona:
//
//   1. La respuesta a la pregunta de modo de /duck:tomar: la que ofrece «Modo tarea» y «Modo flujo».
//   2. `flujo` o `tarea` como argumento de /duck:tomar (<clave> flujo, <clave> desde-spike flujo).
//
// Con el modo flujo deja al lado "flujoAutorizado": es lo que hace valer ese modo (config.js,
// enFlujo), y guard-modo.js lo retira cuando la sesion sale del flujo. Desde un spike el modo no se
// toca aca (lo cuida guard-spike.js hasta que /duck:tomar … desde-spike termina de sacar el
// codigo): se deja anotado lo pedido, y guard-modo.js deja que ese comando lo aplique una vez.
//
// Compara texto, como los demas guardias: reconoce la eleccion, no prueba quien la tecleo.

const { hook, leerSesion, guardarSesion } = require('./config');

hook((evento, cfg) => {
  const sesion = evento?.session_id;
  if (!sesion || !/^[A-Za-z0-9_-]+$/.test(sesion)) return;
  const modo = typeof evento?.prompt === 'string' ? delPrompt(evento.prompt) : deLaRespuesta(evento);
  if (!modo) return;

  const ahora = new Date().toISOString();
  const { modoPedido, flujoAutorizado, ...almacen } = leerSesion(cfg, sesion);
  if (almacen.modo === 'spike') {
    guardarSesion(cfg, sesion, { ...almacen, modoPedido: { modo, fecha: ahora } });
    return;
  }
  guardarSesion(cfg, sesion, { ...almacen, modo, ...(modo === 'flujo' ? { flujoAutorizado: ahora } : {}) });
});

const palabraDeModo = (texto) => String(texto ?? '').toLowerCase().replace(/[.,;:!]+$/, '');

// /duck:tomar <clave> [desde-spike] <flujo|tarea>: el modo en su lugar de argumento, y solo cuando
// el mensaje ES el comando. «…pero no en flujo todavia» o el comando citado en una frase no cuentan.
function delPrompt(prompt) {
  const [comando, , ...resto] = prompt.trim().split(/\s+/);
  if (comando !== '/duck:tomar') return null;
  const argumento = palabraDeModo(resto[0] === 'desde-spike' ? resto[1] : resto[0]);
  return argumento === 'flujo' || argumento === 'tarea' ? argumento : null;
}

// Lo que la persona eligio en la pregunta de modo. Cuenta solo la respuesta a una pregunta que
// ofrecia «Modo flujo», y solo si EMPIEZA por el modo (la etiqueta elegida) o es la palabra sola:
// «No quiero modo flujo» o «Modo tarea, nada de flujo» no activan el flujo.
function deLaRespuesta(evento) {
  if (evento?.tool_name !== 'AskUserQuestion') return null;
  const preguntas = Array.isArray(evento.tool_input?.questions) ? evento.tool_input.questions : [];
  const dadas = evento.tool_response?.answers ?? evento.tool_input?.answers;
  if (!dadas || typeof dadas !== 'object') return null;
  for (const pregunta of preguntas) {
    const opciones = Array.isArray(pregunta?.options) ? pregunta.options : [];
    if (!opciones.some((o) => /^\s*modo\s+flujo\b/i.test(String(o?.label ?? '')))) continue;
    const respuesta = String(dadas[pregunta.question] ?? '').trim();
    const m = respuesta.match(/^modo\s+(flujo|tarea)\b/i);
    if (m) return m[1].toLowerCase();
    const sola = palabraDeModo(respuesta);
    if (sola === 'flujo' || sola === 'tarea') return sola;
  }
  return null;
}
