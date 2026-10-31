// Hook PostToolUse sobre Bash: cuando `gh pr create` abrio un PR de verdad, pasa a In Review los
// issues que ese PR CIERRA (METODO.md, «Al abrir el PR»). Solo con tickets.proveedor = 'github':
// con Jira el hook no tiene el MCP, y la transicion sigue siendo del agente.
//
// Los issues salen de closingIssuesReferences del PR (Closes/Fixes/Resolves), no de la rama: un PR
// parcial lleva Refs #N y su issue, por ejemplo una HU con sub-issues abiertos, no esta listo para
// revision. Leerlo de la rama paso la HU factufacil-docs#41 a In Review con un PR de documentacion
// (visto 2026-10-31). Es la misma regla que el workflow «Pull request linked to issue» del Project;
// fijar la misma opcion otra vez no cambia nada.
//
// La prueba de que el PR existe es la URL que imprime gh, no el comando: intentado no es abierto.

const { execFileSync } = require('child_process');
const { hook, leerSesion, guardarSesion, TICKET_JS } = require('./config');

const CIERRA = 'query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){closingIssuesReferences(first:20){nodes{number repository{nameWithOwner}}}}}}';

hook((evento, cfg) => {
  if (cfg.tickets.proveedor !== 'github') return;
  if (!/\bgh\s+pr\s+create\b/.test(evento?.tool_input?.command || '')) return;
  const r = evento?.tool_response;
  const salida = typeof r === 'string' ? r : [r?.stdout, r?.output].filter((t) => typeof t === 'string').join('\n');
  const pr = salida.match(/https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/);
  if (!pr) return;

  let claves;
  try {
    const respuesta = execFileSync(
      process.env.DUCK_GH || 'gh',
      ['api', 'graphql', '-f', `query=${CIERRA}`, '-f', `o=${pr[1]}`, '-f', `r=${pr[2]}`, '-F', `n=${pr[3]}`],
      { encoding: 'utf8', timeout: 20000 }
    );
    claves = JSON.parse(respuesta).data.repository.pullRequest.closingIssuesReferences.nodes.map(
      (i) => `${i.repository.nameWithOwner}#${i.number}`.toLowerCase()
    );
  } catch (e) {
    return emitir(`PR abierto, pero no se pudo leer que issues cierra (${String(e.message).split('\n')[0]}). Si cierra alguno, movelo a In Review con \`node "${TICKET_JS}" mover <clave> enRevision\`.`);
  }
  if (!claves.length) return; // PR parcial (Refs): ningun issue esta listo para revision

  const lineas = claves.map((clave) => {
    try {
      const linea = execFileSync('node', [process.env.DUCK_TICKET_JS || TICKET_JS, 'mover', clave, 'enRevision'], {
        encoding: 'utf8',
        timeout: 20000,
      }).trim();
      anotar(evento, cfg, linea);
      return linea;
    } catch (e) {
      return `No se pudo mover ${clave} a ${cfg.github.estados.enRevision} (${String(e.message).split('\n')[0]}). Movelo con \`node "${TICKET_JS}" mover ${clave} enRevision\`.`;
    }
  });
  emitir(`PR abierto: ${lineas.join(' ')}`);
});

// El sticker y el titulo leen la sesion; esta movida no pasa por un Bash que estado-tarea vea.
function anotar(evento, cfg, linea) {
  const movida = linea.match(/^Issue \(([^)]+)\) movido a \(([^)]+)\)$/m);
  if (!movida || !/^[A-Za-z0-9_-]+$/.test(evento?.session_id || '')) return;
  const almacen = leerSesion(cfg, evento.session_id);
  almacen.tareas[movida[1]] = { estado: movida[2], desde: new Date().toISOString() };
  guardarSesion(cfg, evento.session_id, almacen);
}

function emitir(texto) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: texto } }));
}
