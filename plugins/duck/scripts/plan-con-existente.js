// Hook PreToolUse (Write|Edit): el plan de la historia (odd.diseno) no se escribe sin la
// seccion «## Lo que ya existe». Antes de proponer algo, el analista busca en los repos si ya
// esta implementado (endpoints, rutas, entidades que nombra el ticket) y deja ahi ruta:linea de
// lo que encontro, o las busquedas que hizo y no encontraron nada.
//
// Visto en un proyecto real: se planifico y escribio un webhook que el backend ya tenia, porque el
// plan nunca miro el codigo. El hook no juzga si la busqueda fue buena: obliga a que exista y la
// deja a la vista de quien revisa el plan.
//
// El plan se reconoce por el final de su ruta: odd.diseno con {historia} como un solo segmento
// (docs/disenos/{historia}.md casa con <repo>/docs/disenos/12.md). Un Edit se revisa sobre el
// archivo como quedaria despues del cambio. Sin odd.diseno, o sin .claude/duck.json, no hace nada.

const fs = require('fs');
const { hook } = require('./config');

const SECCION = /^##\s+Lo que ya existe\s*$/m;

hook((evento, cfg) => {
  const diseno = cfg.odd?.diseno;
  const entrada = evento?.tool_input ?? {};
  if (!diseno || !entrada.file_path) return;
  if (!rutaDePlan(diseno).test(String(entrada.file_path).replace(/\\/g, '/'))) return;

  const texto = textoResultante(evento.tool_name, entrada);
  if (texto === null || SECCION.test(texto)) return;

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          'El plan de la historia necesita la sección «## Lo que ya existe» antes de proponer nada. '
          + 'Buscá en los repos del proyecto lo que nombra el ticket (endpoints, rutas, entidades, '
          + 'integraciones) y anotá ruta:línea de lo que ya está implementado, o las búsquedas que '
          + 'hiciste si no encontraste nada. Lo que ya existe se reusa o se extiende; no se reescribe.',
      },
    })
  );
});

function rutaDePlan(diseno) {
  const [antes, despues = ''] = diseno.replace(/\\/g, '/').replace(/^\.?\//, '').split('{historia}');
  const literal = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|/)${literal(antes)}[^/]+${literal(despues)}$`);
}

// Lo que el archivo diria despues de la herramienta, o null si no se puede saber (Edit sobre un
// archivo ilegible o sin el texto a reemplazar: la herramienta misma va a fallar).
function textoResultante(herramienta, entrada) {
  if (herramienta === 'Write') return String(entrada.content ?? '');
  if (herramienta !== 'Edit') return null;
  let actual;
  try {
    actual = fs.readFileSync(entrada.file_path, 'utf8');
  } catch {
    return null;
  }
  const { old_string: viejo = '', new_string: nuevo = '' } = entrada;
  if (!viejo || !actual.includes(viejo)) return null;
  return entrada.replace_all ? actual.split(viejo).join(nuevo) : actual.replace(viejo, () => nuevo);
}
