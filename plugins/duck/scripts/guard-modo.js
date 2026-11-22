// Hook PreToolUse sobre Write y Edit, y PostToolUse sobre Bash, Write y Edit: el agente no activa
// el modo flujo a mano.
//
// El modo flujo lo marca modo-elegido.js cuando la persona lo elige, junto con "flujoAutorizado".
// Visto en un proyecto real: terminada la serie, el agente volvio a modo tarea y despues quiso
// reactivar el flujo para mergear un PR que la serie no cubria. Dos redes:
//
//   Antes (Write, Edit): deniega escribir "modo": "flujo" en el estado de una sesion
//     (.claude/estado/sesiones/<id>.json). Volver a "modo": "tarea" pasa.
//   Despues (Bash, Write, Edit): mira como QUEDO el estado de la sesion, sin importar con que
//     comando se escribio. Un "modo": "flujo" sin la autorizacion vuelve a "tarea" y se avisa; y
//     cuando la sesion sale del flujo, la autorizacion se retira: volver a entrar exige que la
//     persona lo elija otra vez.
//
// Un comando de Bash no se deniega: hay demasiadas formas de escribir un archivo para reconocerlas
// por el texto, y negarlas a ojo frenaba lecturas y la vuelta a modo tarea. Para Bash vale la red de
// despues, y guard-git.js igual no toma por flujo un modo sin autorizacion (config.js, enFlujo).
//
// La unica escritura de flujo a mano que pasa es la de /duck:tomar … desde-spike flujo: la sesion
// sigue en spike y modo-elegido.js anoto hace poco que la persona pidio flujo.
//
// No es un sandbox: quien copie tambien "flujoAutorizado" se lo salta. Es la red para el descuido.

const path = require('path');
const { hook, leerSesion, guardarSesion, leerPedido, borrarPedido } = require('./config');

const MODO_FLUJO = /["']modo["']\s*:\s*["']flujo["']/;
const COMO_SE_ACTIVA =
  'El modo flujo no lo activa el agente: lo marca duck cuando la persona lo elige en la pregunta de /duck:tomar, o con '
  + '`flujo` como argumento de ese comando. Si hace falta mergear algo que la serie no cubria, pedile a la persona el '
  + 'merge de ESE PR (mergear-pr.js --a-pedido) o que corra /duck:tomar <clave> flujo.';

hook((evento, cfg) => {
  const sesion = evento?.session_id;
  const conSesion = Boolean(sesion) && /^[A-Za-z0-9_-]+$/.test(sesion);
  const despues = evento?.hook_event_name === 'PostToolUse' || evento?.tool_response !== undefined;

  if (despues) {
    if (conSesion) revisarComoQuedo(cfg, sesion);
    return;
  }
  if (!escribeFlujo(evento, cfg) || (conSesion && saleDeSpike(cfg, sesion))) return;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: COMO_SE_ACTIVA },
    })
  );
});

// Write, Edit o MultiEdit que dejan "modo": "flujo" en el estado de una sesion.
function escribeFlujo(evento, cfg) {
  const entrada = evento?.tool_input ?? {};
  if (!['Write', 'Edit', 'MultiEdit'].includes(evento?.tool_name) || !entrada.file_path) return false;
  // La ruta se resuelve: sesiones/../sesiones y estado//sesiones son el mismo archivo.
  const archivo = path.resolve(evento.cwd || cfg.raiz, String(entrada.file_path));
  if (path.dirname(archivo) !== path.resolve(cfg.dirEstado) || !/^[A-Za-z0-9_-]+\.json$/.test(path.basename(archivo))) return false;
  if (/-(?:vista|historia)\.json$/.test(archivo)) return false; // los del panel no guardan el modo

  if (evento.tool_name === 'Write') return MODO_FLUJO.test(String(entrada.content ?? ''));
  const nuevos = [entrada.new_string, ...(Array.isArray(entrada.edits) ? entrada.edits.map((e) => e?.new_string) : [])];
  // El par completo, o la palabra sola (tarea -> flujo). «flujo-de-caja» como tema de un spike no.
  return nuevos.some((texto) => MODO_FLUJO.test(String(texto ?? '')) || /^["']?flujo["']?$/.test(String(texto ?? '').trim()));
}

// Saliendo de un spike con /duck:tomar … desde-spike flujo: la persona lo pidio hace poco.
function saleDeSpike(cfg, sesion) {
  return leerSesion(cfg, sesion).modo === 'spike' && leerPedido(cfg, sesion) === 'flujo';
}

function revisarComoQuedo(cfg, sesion) {
  const { flujoAutorizado, ...almacen } = leerSesion(cfg, sesion);
  if (almacen.modo === 'spike') return; // el pedido sigue esperando a que /duck:tomar salga del spike

  // Fuera del spike el pedido se gasta: sirve una vez, para la salida que la persona pidio.
  const pedido = leerPedido(cfg, sesion);
  borrarPedido(cfg, sesion);

  if (almacen.modo !== 'flujo') {
    // Fuera del flujo no queda nada con que volver a entrar.
    if (flujoAutorizado) guardarSesion(cfg, sesion, almacen);
    return;
  }
  if (flujoAutorizado) return;
  if (pedido === 'flujo') {
    // Salio del spike en flujo, como la persona pidio: el pedido pasa a ser la autorizacion.
    guardarSesion(cfg, sesion, { ...almacen, flujoAutorizado: new Date().toISOString() });
    return;
  }
  guardarSesion(cfg, sesion, { ...almacen, modo: 'tarea' });
  const aviso = `duck: el estado de la sesión decía "modo": "flujo" sin que la persona lo eligiera, y volvió a "tarea". ${COMO_SE_ACTIVA}`;
  process.stdout.write(JSON.stringify({ systemMessage: aviso, hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: aviso } }));
}
