// Hook PostToolUse sobre la transicion de Jira.
//
// No le cree al agente cuando dice "ya la puse En Proceso": este hook escucha el
// hecho real —la llamada a la herramienta— y anota el ticket y el estado en que
// aterrizo. Lo que pinta el sticker sale de aca.
//
// El estado es POR SESION: <proyecto>/.claude/estado/sesiones/<session_id>.json. Una sesion
// no muestra lo que transiciono otra, aunque compartan el proyecto.
//
// Dos caminos llegan al mismo hecho: la herramienta del MCP de Atlassian y el CLI `acli`,
// que se usa cuando el MCP no esta autenticado. El de acli llega como un Bash, y lo que
// prueba la transicion es la linea de exito que imprime, no el comando: un comando
// intentado no es un ticket movido.
//
// Con tickets.proveedor = 'github' el hecho es `ticket.js mover` y su linea de exito
// («Issue (owner/repo#N) movido a (In Progress)»): GitHub no tiene transiciones, el estado se pone.

const fs = require('fs');
const path = require('path');
const { hook, deducirEstado, estadosDe, movidasDeGithub, leerSesion, guardarSesion, heredarSesionAnterior } = require('./config');

hook((evento, cfg) => {
  const transiciones =
    cfg.tickets.proveedor === 'github'
      ? movidasDeSubtarea(evento, cfg)
      : evento?.tool_name === 'Bash'
        ? transicionesDeAcli(evento, cfg)
        : transicionDelMcp(evento, cfg);
  for (const { clave, estado } of transiciones) anotar(evento, cfg, clave, estado);
});

function transicionDelMcp(evento, cfg) {
  const clave = (evento?.tool_input?.issueIdOrKey || '').toUpperCase();
  if (!cfg.jira.reClaveExacta.test(clave)) return [];
  return [{ clave, estado: deducirEstado(evento, cfg) }];
}

// «✓ Work item PROJ-882 has been successfully transitioned to Finalizado», una linea por
// ticket. Solo cuentan los estados de sub-tarea: los de la historia tienen su propio flujo y
// la salida de acli no trae la categoria que necesita el panel.
function transicionesDeAcli(evento, cfg) {
  const comando = evento?.tool_input?.command || '';
  if (!/\bacli\s+jira\s+workitem\s+transition\b/.test(comando)) return [];
  const salida = aTexto(evento?.tool_response);
  const e = cfg.jira.estados;
  const deSubtarea = [e.finalizado, e.enProceso, e.pendiente].filter(Boolean);
  const transiciones = [];
  for (const [, clave, destino] of salida.matchAll(
    /Work item ([A-Z][A-Z0-9]*-\d+) has been successfully transitioned to ([^\r\n"]+)/g
  )) {
    const estado = deSubtarea.find((n) => n.toLowerCase() === destino.trim().toLowerCase());
    if (estado && cfg.jira.reClaveExacta.test(clave)) transiciones.push({ clave, estado });
  }
  return transiciones;
}

// Igual que con acli, solo los estados de sub-tarea, con el nombre de la configuracion.
function movidasDeSubtarea(evento, cfg) {
  const e = estadosDe(cfg);
  const deSubtarea = [e.finalizado, e.enProceso, e.pendiente].filter(Boolean);
  return movidasDeGithub(evento, cfg).flatMap(({ clave, estado }) => {
    const nombre = deSubtarea.find((n) => n.toLowerCase() === estado.trim().toLowerCase());
    return nombre ? [{ clave, estado: nombre }] : [];
  });
}

// La respuesta de un Bash llega como { stdout, stderr }. Se leen los textos tal cual: pasada por
// JSON.stringify, cada salto de linea seria un "\n" literal y la linea de exito no terminaria.
function aTexto(valor) {
  if (valor == null) return '';
  if (typeof valor === 'string') return valor;
  const textos = [valor.stdout, valor.stderr, valor.output].filter((t) => typeof t === 'string');
  return textos.length ? textos.join('\n') : JSON.stringify(valor);
}

function anotar(evento, cfg, clave, estado) {
  const sesion = evento?.session_id;
  if (!sesion) return;

  if (!estado) {
    // Puede ser la historia, cuyos estados no se llaman como los de sub-tarea.
    actualizarHistoria(clave, null, evento, cfg);
    return;
  }

  heredarSesionAnterior(cfg, sesion, evento?.transcript_path);
  const almacen = leerSesion(cfg, sesion);
  almacen.tareas[clave] = { estado, desde: new Date().toISOString() };
  guardarSesion(cfg, sesion, almacen);
  actualizarHistoria(clave, estado, evento, cfg);
}

// El panel del mod solo ve Jira por <session_id>-historia.json, y ese archivo
// lo escribe /duck:estado. Sin esto, una transicion hecha aca no llega al panel
// hasta la proxima corrida del comando. Se parcha solo el archivo de LA SESION
// del evento, nunca el de otra. Y solo lo que esta transicion prueba:
// el estado de esa clave, en la historia que la contenga (como historia o como
// sub-tarea; el archivo puede traer varias). No se toca `actualizado`, que fecha la ultima
// lectura completa de Jira, ni se agregan claves que el archivo no traia.
// Lo que otra persona mueva en el tablero sigue necesitando /duck:estado.
function actualizarHistoria(clave, estado, evento, cfg) {
  const sesion = evento?.session_id;
  if (!sesion || !/^[A-Za-z0-9_-]+$/.test(sesion)) return;
  const HISTORIA = path.join(cfg.dirEstado, `${sesion}-historia.json`);
  let datos;
  try {
    datos = JSON.parse(fs.readFileSync(HISTORIA, 'utf8'));
  } catch {
    return; // sin archivo de historia de esta sesion no hay panel que actualizar
  }
  // Forma nueva: { historias: [ { historia, subtareas } ] }. La anterior, de una
  // sola historia, trae historia y subtareas en la raiz: se trata como un
  // bloque unico, parchado en el lugar para no cambiarle la forma al archivo.
  const bloques = Array.isArray(datos?.historias)
    ? datos.historias
    : datos?.historia && Array.isArray(datos.subtareas)
      ? [datos]
      : null;
  if (!bloques) return;

  let cambio = false;
  for (const bloque of bloques) {
    if (!bloque?.historia || !Array.isArray(bloque.subtareas)) continue;

    const subtarea = bloque.subtareas.find((s) => s?.clave === clave);
    if (estado && subtarea && subtarea.estado !== estado) {
      subtarea.estado = estado;
      cambio = true;
    }

    // La historia tiene su propio flujo ("Diseño/Desarrollo"): los nombres de
    // sub-tarea no le sirven. Solo se actualiza si la respuesta trae la categoria.
    if (bloque.historia.clave === clave) {
      const status = buscarStatus(evento?.tool_response);
      if (status) {
        bloque.historia.estado = status.nombre ?? bloque.historia.estado;
        bloque.historia.categoria = status.categoria;
        cambio = true;
      }
    }
  }

  if (!cambio) return;
  // Escritura atomica: el panel lee cada 2 s y un archivo a medio escribir no
  // parsea, lo que borraria la seccion de historia hasta el refresco siguiente.
  const temporal = `${HISTORIA}.${process.pid}.tmp`;
  fs.writeFileSync(temporal, JSON.stringify(datos, null, 2) + '\n');
  fs.renameSync(temporal, HISTORIA);
}

// Busca un statusCategory.key valido en la respuesta, que puede llegar como
// objeto, como texto JSON o envuelta en bloques de contenido del MCP.
function buscarStatus(valor, profundidad = 0) {
  if (profundidad > 8 || valor == null) return null;
  if (typeof valor === 'string') {
    try {
      return buscarStatus(JSON.parse(valor), profundidad + 1);
    } catch {
      return null;
    }
  }
  if (typeof valor !== 'object') return null;
  const categoria = valor?.statusCategory?.key;
  if (['new', 'indeterminate', 'done'].includes(categoria)) {
    return { categoria, nombre: typeof valor.name === 'string' ? valor.name : undefined };
  }
  for (const hijo of Object.values(valor)) {
    const hallado = buscarStatus(hijo, profundidad + 1);
    if (hallado) return hallado;
  }
  return null;
}
