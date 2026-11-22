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
// codigo): se deja anotado lo pedido en <sesion>.pedido, y guard-modo.js deja que ese comando lo aplique una vez.
//
// Compara texto, como los demas guardias: reconoce la eleccion, no prueba quien la tecleo.

const path = require('path');
const { hook, leerSesion, guardarSesion, guardarPedido } = require('./config');

hook((evento, cfg) => {
  const sesion = evento?.session_id;
  if (!sesion || !/^[A-Za-z0-9_-]+$/.test(sesion)) return;
  const modo = typeof evento?.prompt === 'string' ? delPrompt(evento.prompt) : deLaRespuesta(evento);
  if (!modo) return;

  const { flujoAutorizado, ...almacen } = leerSesion(cfg, sesion);
  const estado = path.relative(cfg.raiz, path.join(cfg.dirEstado, `${sesion}.json`));
  if (almacen.modo === 'spike') {
    guardarPedido(cfg, sesion, modo);
    return decir(evento, `duck: la persona pidió salir del spike en modo ${modo}. El estado de ESTA sesión es ${estado}.`);
  }
  guardarSesion(cfg, sesion, { ...almacen, modo, ...(modo === 'flujo' ? { flujoAutorizado: new Date().toISOString() } : {}) });
  decir(evento, `duck: modo ${modo} marcado por elección de la persona. El estado de ESTA sesión es ${estado}; no lo busques como «el más reciente» de la carpeta, que puede ser de otra sesión.`);
});

// El agente necesita saber cual es SU archivo: el mas reciente de la carpeta puede ser de otra
// sesion abierta sobre el mismo proyecto.
function decir(evento, texto) {
  const hookEventName = typeof evento?.prompt === 'string' ? 'UserPromptSubmit' : 'PostToolUse';
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext: texto } }));
}

const palabraDeModo = (texto) => String(texto ?? '').toLowerCase().replace(/[.,;:!]+$/, '');

// /duck:tomar <clave> [desde-spike] <flujo|tarea>: el modo en su lugar de argumento, sin nada
// detras, y solo cuando el mensaje ES el comando. «… flujo no», «…pero no en flujo todavia» o el
// comando citado en una frase no cuentan.
function delPrompt(prompt) {
  const [comando, , ...resto] = prompt.trim().split(/\s+/);
  if (comando !== '/duck:tomar') return null;
  const argumentos = resto[0] === 'desde-spike' ? resto.slice(1) : resto;
  if (argumentos.length !== 1) return null;
  const argumento = palabraDeModo(argumentos[0]);
  return argumento === 'flujo' || argumento === 'tarea' ? argumento : null;
}

// Lo que la persona eligio en la pregunta de modo: la que ofrece una opcion «Modo tarea» y otra
// «Modo flujo». Cuenta la opcion elegida tal cual (su etiqueta), o la palabra sola si la persona
// la escribio: «Modo flujo no, gracias» o «No quiero modo flujo» no son ninguna de las dos.
function deLaRespuesta(evento) {
  if (evento?.tool_name !== 'AskUserQuestion') return null;
  const preguntas = Array.isArray(evento.tool_input?.questions) ? evento.tool_input.questions : [];
  const dadas = evento.tool_response?.answers ?? evento.tool_input?.answers;
  if (!dadas || typeof dadas !== 'object') return null;
  const modoDe = (etiqueta) => String(etiqueta ?? '').trim().match(/^modo\s+(flujo|tarea)\b/i)?.[1].toLowerCase() ?? null;
  for (const pregunta of preguntas) {
    const etiquetas = (Array.isArray(pregunta?.options) ? pregunta.options : []).map((o) => String(o?.label ?? '').trim());
    const modos = etiquetas.map(modoDe);
    if (!modos.includes('flujo') || !modos.includes('tarea')) continue;
    const respuesta = String(dadas[pregunta.question] ?? '').trim();
    const elegida = etiquetas.find((e) => e.toLowerCase() === respuesta.toLowerCase());
    if (elegida && modoDe(elegida)) return modoDe(elegida);
    const sola = palabraDeModo(respuesta);
    if (sola === 'flujo' || sola === 'tarea') return sola;
  }
  return null;
}
