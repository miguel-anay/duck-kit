// Hook PostToolUse sobre AskUserQuestion y UserPromptSubmit: el modo de la sesion (tarea o flujo)
// lo marca la eleccion de la persona, no el agente.
//
// El modo flujo quita la puerta de una serie entera (METODO.md §3): el agente hace push, abre el PR
// y mergea sin volver a preguntar. Antes lo activaba el propio agente editando el estado de la
// sesion, y nada le impedia volver a activarlo despues. Ahora hay dos senales, las dos de la persona:
//
//   1. La respuesta a la pregunta de modo de /duck:tomar («modo tarea» o «modo flujo»).
//   2. `flujo` o `tarea` escrito como argumento de /duck:tomar.
//
// guard-modo.js deniega que el agente escriba "modo": "flujo" a mano. Desde un spike el modo no se
// toca aca (lo cuida guard-spike.js hasta que /duck:tomar … desde-spike termina de sacar el
// codigo): se deja anotado lo pedido, y guard-modo.js deja que ese comando lo aplique.
//
// Compara texto, como los demas guardias: reconoce la eleccion, no prueba quien la tecleo.

const { hook, leerSesion, guardarSesion } = require('./config');

hook((evento, cfg) => {
  const sesion = evento?.session_id;
  if (!sesion || !/^[A-Za-z0-9_-]+$/.test(sesion)) return;
  const modo = typeof evento?.prompt === 'string' ? delPrompt(evento.prompt) : deLaRespuesta(evento);
  if (!modo) return;

  const almacen = leerSesion(cfg, sesion);
  if (almacen.modo === 'spike') {
    guardarSesion(cfg, sesion, { ...almacen, modoPedido: { modo, fecha: new Date().toISOString() } });
    return;
  }
  const { modoPedido, ...resto } = almacen;
  guardarSesion(cfg, sesion, { ...resto, modo });
});

// /duck:tomar <clave> [desde-spike] [flujo|tarea]: solo como comando, no mencionado en una frase.
function delPrompt(prompt) {
  const palabras = prompt.trim().split(/\s+/);
  if (palabras[0] !== '/duck:tomar') return null;
  return palabras.slice(2).find((p) => p === 'flujo' || p === 'tarea') ?? null;
}

// Lo que la persona eligio, no lo que la pregunta ofrecia: solo cuentan las respuestas.
function deLaRespuesta(evento) {
  if (evento?.tool_name !== 'AskUserQuestion') return null;
  const respuesta = evento.tool_response;
  const dadas = respuesta?.answers ?? evento.tool_input?.answers;
  const textos =
    dadas && typeof dadas === 'object'
      ? Object.values(dadas).map(String)
      : [...String(typeof respuesta === 'string' ? respuesta : '').matchAll(/="([^"]*)"/g)].map((m) => m[1]);
  for (const texto of textos) {
    if (/\bmodo\s+flujo\b/i.test(texto)) return 'flujo';
    if (/\bmodo\s+tarea\b/i.test(texto)) return 'tarea';
  }
  return null;
}
