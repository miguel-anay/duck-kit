// Hook PreToolUse sobre Write, Edit y Bash: el agente no activa el modo flujo a mano.
//
// El modo flujo lo marca modo-elegido.js cuando la persona lo elige. Este guardia deniega que el
// agente escriba "modo": "flujo" en el estado de una sesion (.claude/estado/sesiones/<id>.json).
// Visto en un proyecto real: terminada la serie, el agente volvio a modo tarea y despues quiso
// reactivar el flujo para mergear un PR que la serie no cubria.
//
// Volver a "modo": "tarea" pasa, igual que leer el archivo y que los archivos -vista y -historia
// del panel. La unica escritura de flujo que pasa es la de /duck:tomar … desde-spike flujo: la
// sesion sigue en spike y modo-elegido.js anoto hace poco que la persona pidio flujo.
//
// Compara el texto literal de la llamada, como guard-git.js: es una red, no un sandbox.

const { hook, leerSesion } = require('./config');

const DE_SESION = /[\\/]estado[\\/]sesiones[\\/](?![^\\/]*-(?:vista|historia)\.json)[A-Za-z0-9_-]+\.json/;
const MODO_FLUJO = /["']?modo["']?\s*[:=]\s*\\?["']flujo/;
const ESCRIBE = /(>|\btee\b|\bsed\b[^|;&]*\s-[a-z]*i|\bperl\b[^|;&]*\s-[a-z]*i|writeFile|\bnode\b[^|;&]*\s-e\b|\bpython3?\b|\bmv\b|\bcp\b|\bdd\b)/;
const VIGENCIA_PEDIDO_MS = 30 * 60 * 1000;

hook((evento, cfg) => {
  if (!activaFlujo(evento) || laPersonaLoPidio(evento, cfg)) return;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          'El modo flujo no lo activa el agente: lo marca duck cuando la persona lo elige en la pregunta de '
          + '/duck:tomar, o con `flujo` como argumento de ese comando. Si hace falta mergear algo que la serie no '
          + 'cubria, pedile a la persona el merge de ESE PR (mergear-pr.js --a-pedido) o que corra /duck:tomar <clave> flujo.',
      },
    })
  );
});

function activaFlujo(evento) {
  const entrada = evento?.tool_input ?? {};
  if (evento?.tool_name === 'Bash') {
    const comando = String(entrada.command ?? '');
    return DE_SESION.test(comando) && /flujo/.test(comando) && ESCRIBE.test(comando);
  }
  if (!DE_SESION.test(String(entrada.file_path ?? ''))) return false;
  if (evento.tool_name === 'Write') return MODO_FLUJO.test(String(entrada.content ?? ''));
  // Edit o MultiEdit: alcanza con que el texto nuevo traiga la palabra (tarea -> flujo).
  const nuevos = [entrada.new_string, ...(Array.isArray(entrada.edits) ? entrada.edits.map((e) => e?.new_string) : [])];
  return nuevos.some((texto) => /flujo/.test(String(texto ?? '')));
}

// Saliendo de un spike con /duck:tomar … desde-spike flujo.
function laPersonaLoPidio(evento, cfg) {
  const sesion = evento?.session_id;
  if (!sesion || !/^[A-Za-z0-9_-]+$/.test(sesion)) return false;
  const { modo, modoPedido } = leerSesion(cfg, sesion);
  return modo === 'spike' && modoPedido?.modo === 'flujo' && Date.now() - Date.parse(modoPedido.fecha) < VIGENCIA_PEDIDO_MS;
}
