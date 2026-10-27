// Hook PostToolUse sobre Bash: detecta cuando un PR se mergeo de verdad y deja
// el recordatorio de transicionar Jira en el contexto de la conversacion.
//
// Lo que el harness garantiza es que este proceso corrio y vio el comando bash
// y su salida real. Lo que NO puede hacer es transicionar el ticket: es un
// proceso de shell, sin acceso al MCP de Atlassian, que vive del lado del
// agente. Por eso el hook solo inyecta un additionalContext con el
// recordatorio; la transicion de verdad la ejecuta el agente despues, con
// listJiraIssueTransitions + transitionJiraIssue.
//
// Con tickets.proveedor = 'github' la clave es #N y la instruccion es mover el issue con
// ticket.js. El #N del PR (Merge pull request #28 from org/fix/27-x) NO es el issue: ese sale
// de la rama (#27).

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { hook, escapar, claveDeRama, clavesEnTexto, TICKET_JS } = require('./config');

hook((evento, cfg) => procesar(evento, cfg));

function procesar(evento, cfg) {
  const comando = evento?.tool_input?.command || '';

  // El merge se hace con curl contra la API de GitHub: ese patron de URL es
  // la unica forma confiable de reconocer el hecho desde un proceso de shell.
  const org = cfg.git.orgGithub ? escapar(cfg.git.orgGithub) : '[\\w.-]+';
  const match = comando.match(new RegExp(`https://api\\.github\\.com/repos/${org}/([\\w.-]+)/pulls/(\\d+)/merge`));
  if (!match) return; // no es un merge de PR, no hay nada que anotar

  const [, repo, numero] = match;
  const respuesta = aTexto(evento?.tool_response);

  // Intentado no es lo mismo que logrado: un merge fallido no es un cierre.
  if (!fueMergeExitoso(respuesta)) return;

  const clave = buscarClave(comando, respuesta, repo, numero, cfg);
  if (!clave) return; // sin clave no se inventa una, se sale en silencio

  anotarEstadoSesion(evento?.session_id, clave, cfg);
  if (cfg.tickets.proveedor === 'github') return emitir(textoGithub(repo, numero, clave, cfg));

  const e = cfg.jira.estados;
  const ids = cfg.jira.transiciones.finalizado;
  const conocida = ids.length ? ` aunque la conocida es ${ids.map((i) => `"${i}"`).join(' / ')}, ` : ' ';
  const texto =
    `El PR ${repo}#${numero} se mergeo. ${clave} tiene que pasar a ${e.finalizado}. ` +
    'La transicion se hace con listJiraIssueTransitions sobre el issue y usando ' +
    'el id real que devuelva esa consulta: los ids difieren entre tipos de ' +
    `issue,${conocida}eso sirve ` +
    'para reconocerla, no para saltarse la consulta. Si el cambio toca varios ' +
    'repositorios, transicionar recien cuando entro el ultimo. Excepcion: si ' +
    `${clave} es una Historia (un PR de spec o de bitacora del diseño lleva la ` +
    `clave de la historia), NO pasa a ${e.finalizado}: la historia sigue a sus ` +
    `sub-tareas (${e.historiaDesarrollo}, y ${e.historiaPruebas} cuando solo quedan ${cfg.jira.prefijoAnalisis}).`;

  emitir(texto);
}

function textoGithub(repo, numero, clave, cfg) {
  const fin = cfg.github.estados.finalizado;
  return (
    `El PR ${repo}#${numero} se mergeo. ${clave} tiene que pasar a ${fin}. Un Closes ${clave} en el PR ` +
    `puede haberlo movido ya por el workflow del Project: relee con \`node "${TICKET_JS}" ver ${clave}\` ` +
    `y, si no esta en ${fin}, movelo con \`node "${TICKET_JS}" mover ${clave} finalizado\`. Si el ` +
    'cambio toca varios repositorios, mover recien cuando entro el ultimo. Excepcion: si ' +
    `${clave} es la historia (el issue padre), solo pasa a ${fin} cuando todas sus sub-issues ` +
    'estan cerradas.'
  );
}

function emitir(texto) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: texto,
      },
    })
  );
}

function aTexto(toolResponse) {
  if (typeof toolResponse === 'string') return toolResponse;
  // La respuesta de un Bash llega como objeto con stdout: hay que leer ese
  // campo crudo. Pasarlo por JSON.stringify escapa las comillas y rompe los
  // patrones que buscan \"merged\": true en el cuerpo de GitHub.
  if (typeof toolResponse?.stdout === 'string') return toolResponse.stdout;
  try {
    return JSON.stringify(toolResponse ?? '');
  } catch {
    return '';
  }
}

// La senal de exito viene de GitHub, no de que el comando haya salido en 0:
// curl puede devolver 0 y traer igual un cuerpo de error.
function fueMergeExitoso(respuesta) {
  return (
    /"merged"\s*:\s*true/i.test(respuesta) ||
    /pull request successfully merged/i.test(respuesta)
  );
}

// Orden de busqueda de la clave: el propio comando, despues la respuesta de
// GitHub (trae titulo y rama del PR), y como ultimo recurso la rama actual
// del repositorio en disco. Con GitHub primero la rama (en el comando, en la respuesta, la
// actual) y despues el #N del texto; se descarta el #N que es el numero del PR, y el #N
// suelto se completa con el repo de la carpeta del PR (owner/repo#N).
function buscarClave(comando, respuesta, repo, numero, cfg) {
  // Carpeta del proyecto cuyo repo de GitHub se llama asi.
  const nombre = Object.keys(cfg.git.repos).find((c) => cfg.git.repos[c] === repo) ?? (cfg.git.carpetas.includes('.') ? '.' : null);
  const carpeta = nombre === null ? null : path.join(cfg.raiz, nombre);
  const valida = (c) => !(cfg.tickets.proveedor === 'github' && c.split('#')[1] === numero);
  const en = (texto) => clavesEnTexto(texto, cfg, carpeta).find(valida);
  if (cfg.tickets.proveedor !== 'github') return en(comando) || en(respuesta) || buscarClaveEnRamaActual(carpeta, cfg);
  // Con GitHub manda la rama (feat/N-slug): un #N suelto del comando puede ser solo un Refs.
  const rama = (texto) => {
    for (const m of String(texto).matchAll(/(?:^|[\s"'\/:])([\w-]+\/\d+[\w.-]*)/g)) {
      const clave = claveDeRama(m[1], cfg, carpeta);
      if (clave && valida(clave)) return clave;
    }
    return null;
  };
  return rama(comando) || rama(respuesta) || buscarClaveEnRamaActual(carpeta, cfg) || en(comando) || en(respuesta);
}

function buscarClaveEnRamaActual(carpeta, cfg) {
  if (!carpeta) return null;
  try {
    const rama = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: carpeta,
      encoding: 'utf8',
    }).trim();
    return claveDeRama(rama, cfg, carpeta);
  } catch {
    return null; // sin repo local o sin git, no es motivo para fallar
  }
}

// Mismo formato y misma carpeta que estado-tarea.js, para que el sticker
// pueda leer el hecho aunque Jira todavia no lo refleje.
function anotarEstadoSesion(sesion, clave, cfg) {
  if (!sesion) return;
  try {
    const ruta = path.join(cfg.dirEstado, `${sesion}.json`);
    let almacen = { tareas: {}, modo: 'tarea' };
    try {
      almacen = { ...almacen, ...JSON.parse(fs.readFileSync(ruta, 'utf8')) };
    } catch {
      // primera anotacion de esta sesion
    }
    almacen.tareas[clave] = { estado: 'Mergeado', desde: new Date().toISOString() };

    fs.mkdirSync(cfg.dirEstado, { recursive: true });
    fs.writeFileSync(ruta, JSON.stringify(almacen, null, 2) + '\n');
  } catch {
    // el sticker es un adorno; no vale la pena romper el hook por el
  }
}
