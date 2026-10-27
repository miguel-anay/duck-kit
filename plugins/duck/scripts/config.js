// Cargador unico de la configuracion de duck, y los pocos helpers que comparten
// los hooks. Cada script del plugin pasa por aca.
//
// La configuracion vive en el PROYECTO, no en el plugin: <proyecto>/.claude/duck.json
// (ver README.md, «Referencia de duck.json»). El plugin es el mismo para todos;
// lo que cambia entre proyectos —clave de Jira, ramas, repositorios— esta en ese archivo.
//
// REGLA CENTRAL: sin duck.json, duck no existe. Todo hook sale con 0 y sin escribir
// nada, para no estorbar a un proyecto que no adopto el flujo. Por eso ningun hook
// arranca por su cuenta: todos entran por hook(), que ya resuelve eso.
//
// Donde se busca el proyecto:
//   1. CLAUDE_PROJECT_DIR, si Claude Code lo puso (los hooks lo reciben siempre).
//      Si esta y no hay duck.json ahi, el proyecto no adopto duck: no se sigue buscando.
//   2. Sin esa variable (un comando lanzado desde Bash, el status line), se sube desde
//      el cwd hasta encontrar .claude/duck.json.

const fs = require('fs');
const path = require('path');

const RELATIVA = path.join('.claude', 'duck.json');

// Lo que vale cuando el archivo existe pero no dice nada. Genericos a proposito: la clave
// de Jira, la organizacion de GitHub y los repositorios no tienen un valor «razonable».
const DEFECTOS = {
  // De donde salen los tickets: 'jira' (MCP de Atlassian y acli) o 'github' (Issues + Projects v2).
  tickets: { proveedor: 'jira' },
  // Solo con proveedor 'github', que sigue la convencion de GitHub y no la de Jira: la clave es
  // #N (u owner/repo#N si el issue vive en otro repo) y la rama es <prefijo>/N-slug.
  // proyecto: el Project v2 cuyo campo campoEstado guarda el estado. estados: que opcion de ese
  // campo es cada momento del flujo (los de gestion-github.md por defecto).
  github: {
    proyecto: { owner: null, numero: null },
    campoEstado: 'Status',
    estados: {
      pendiente: 'Ready',
      enProceso: 'In Progress',
      enRevision: 'In Review',
      finalizado: 'Done',
      bloqueado: 'Blocked',
    },
  },
  jira: {
    proyecto: null, // null = cualquier clave tipo ABC-123
    transiciones: { enProceso: [], finalizado: [], pendiente: [] }, // ids; solo sirven para reconocer
    nombresTransicion: { enProceso: ['empezar', 'en proceso'], finalizado: ['finalizar'], pendiente: ['backlog'] },
    estados: {
      enProceso: 'En Proceso',
      finalizado: 'Finalizado',
      pendiente: 'Pendiente',
      historiaDesarrollo: 'Diseño/Desarrollo',
      historiaPruebas: 'Pruebas',
      historiaOtros: ['Go Live'],
      historiaCerrada: 'Historia Cerrada',
    },
    historiaSigueSubtareas: true, // el recordatorio de mover la historia con sus sub-tareas
    prefijoAnalisis: '[ANALISIS]',
    prefijoBloqueo: '[BLOQ]',
  },
  git: {
    ramaBase: 'develop',
    prefijos: ['feature', 'bugfix', 'hotfix', 'spec'],
    prefijosLegados: [], // se reconocen al comparar nombres de rama, pero no se piden
    orgGithub: null,
    repos: {}, // carpeta -> nombre del repo en GitHub; vacio = el proyecto es un solo repo
    ignorarEnStatus: [], // rutas que no cuentan como «sucio» en el panel de spike
  },
  acli: 'acli',
  // Archivo con lo propio del proyecto que leen agentes y comandos (tipos de ticket, plan, reglas
  // de repositorio), relativo a la raiz. Solo lo leen los prompts; los hooks no lo usan.
  convenciones: null,
  // Convivencia con ODD de gentle-ai (METODO.md §7). tareas: carpeta del documento de feature de
  // ODD, relativa a la raiz y fuera de todo repo (null = ODD corre tal cual). diseno: el plan
  // versionado de la historia, que ODD no reemplaza ({historia} = la clave).
  odd: { tareas: null, diseno: null },
};

function existe(ruta) {
  try {
    return fs.statSync(ruta).isFile();
  } catch {
    return false;
  }
}

// Carpeta del proyecto que adopto duck, o null.
function buscarProyecto() {
  const env = process.env.CLAUDE_PROJECT_DIR;
  if (env) return existe(path.join(env, RELATIVA)) ? path.resolve(env) : null;

  let dir = path.resolve(process.cwd());
  for (let saltos = 0; saltos < 12; saltos++) {
    if (existe(path.join(dir, RELATIVA))) return dir;
    const padre = path.dirname(dir);
    if (padre === dir) return null;
    dir = padre;
  }
  return null;
}

// Mezcla en profundidad los objetos; los arreglos y los escalares del usuario reemplazan.
function mezclar(base, extra) {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return base;
  const salida = { ...base };
  for (const [k, v] of Object.entries(extra)) {
    const b = base[k];
    salida[k] = b && typeof b === 'object' && !Array.isArray(b) ? mezclar(b, v) : v;
  }
  return salida;
}

function escapar(texto) {
  return String(texto).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Un nombre de estado como patron: «En Proceso» tambien reconoce «EnProceso».
function patronNombre(nombre) {
  return new RegExp(escapar(nombre).replace(/\s+/g, '\\s*'), 'i');
}

// Devuelve la configuracion normalizada, o null si no hay duck.json legible.
function cargar() {
  const raiz = buscarProyecto();
  if (!raiz) return null;

  let crudo;
  try {
    crudo = JSON.parse(fs.readFileSync(path.join(raiz, RELATIVA), 'utf8').replace(/^﻿/, ''));
  } catch {
    return null; // un duck.json roto se trata como «no hay»: nunca se bloquea por esto
  }

  const cfg = mezclar(DEFECTOS, crudo);
  const proveedor = cfg.tickets.proveedor === 'github' ? 'github' : 'jira';
  const proyecto = cfg.jira.proyecto ? String(cfg.jira.proyecto) : null;
  const fuente = proyecto ? `${escapar(proyecto)}-\\d+` : '[A-Z][A-Z0-9]+-\\d+';
  const carpetas = Object.keys(cfg.git.repos);

  return {
    ...cfg,
    raiz,
    tickets: { ...cfg.tickets, proveedor },
    jira: {
      ...cfg.jira,
      proyecto,
      claveFuente: fuente, // para armar otras expresiones regulares
      reClave: new RegExp(fuente), // busca una clave dentro de un texto
      reClaveExacta: new RegExp(`^${fuente}$`),
    },
    git: {
      ...cfg.git,
      carpetas: carpetas.length ? carpetas : ['.'],
      prefijosSlug: [...cfg.git.prefijos, ...cfg.git.prefijosLegados],
    },
    dirEstado: path.join(raiz, '.claude', 'estado', 'sesiones'),
  };
}

// Corre fn(evento, cfg, entradaCruda) con el JSON que Claude Code manda por stdin, y sale con 0.
// Sin duck.json no llama a fn: sale con 0 sin escribir nada. Una excepcion en fn tambien se
// traga —un hook de duck no puede romper el comando que observa—; los guardias fallan abiertos.
function hook(fn) {
  let entrada = '';
  process.stdin.on('data', (c) => (entrada += c));
  process.stdin.on('end', () => {
    const cfg = cargar();
    if (!cfg) process.exit(0);
    let evento = {};
    try {
      evento = JSON.parse(entrada || '{}');
    } catch {
      /* JSON ilegible: no es tarea del hook opinar; evento queda vacio */
    }
    try {
      fn(evento, cfg, entrada);
    } catch {
      /* ver arriba */
    }
    process.exit(0);
  });
}

// Un comando compuesto es varios comandos: cada uno se revisa por separado.
function partirEnTramos(comando) {
  return String(comando)
    .split(/&&|\|\||[;|\n]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

// Estado en que aterrizo una transicion de Jira, con los NOMBRES de la configuracion
// (cfg.jira.estados), o null si no se puede saber.
//
// El estado real viene en la respuesta de la herramienta («Returns the status the issue
// actually landed in»); solo si no se puede leer se cae al mapeo de ids y nombres de
// transicion, que puede diferir entre tipos de issue.
//
// soloSubtareas: lo usa el recordatorio de la historia. Las transiciones de la historia
// (Diseño/Desarrollo, Pruebas...) no deben leerse como estados de sub-tarea, que es lo
// que evita que ese hook se responda a si mismo; y Pendiente no le interesa.
function deducirEstado(evento, cfg, { soloSubtareas = false } = {}) {
  const e = cfg.jira.estados;
  const respuesta = JSON.stringify(evento?.tool_response ?? '');

  if (soloSubtareas) {
    const deHistoria = [e.historiaDesarrollo, e.historiaPruebas, ...e.historiaOtros, e.historiaCerrada].filter(Boolean);
    if (deHistoria.some((n) => patronNombre(n).test(respuesta))) return null;
  }
  if (patronNombre(e.finalizado).test(respuesta)) return e.finalizado;
  if (patronNombre(e.enProceso).test(respuesta)) return e.enProceso;
  if (patronNombre(e.pendiente).test(respuesta)) return soloSubtareas ? null : e.pendiente;

  const id = String(evento?.tool_input?.transitionId ?? '');
  const nombre = String(evento?.tool_input?.transitionName ?? '').toLowerCase();
  const t = cfg.jira.transiciones;
  const n = cfg.jira.nombresTransicion;
  const porNombre = (lista) => lista.some((x) => nombre.includes(String(x).toLowerCase()));
  if (t.finalizado.map(String).includes(id) || porNombre(n.finalizado)) return e.finalizado;
  if (t.enProceso.map(String).includes(id) || porNombre(n.enProceso)) return e.enProceso;
  if (!soloSubtareas && (t.pendiente.map(String).includes(id) || porNombre(n.pendiente))) return e.pendiente;
  return null;
}

// Clave del ticket de una rama, o null. Jira: la clave donde aparezca (feature/ABC-12-slug).
// GitHub: el numero que sigue a un prefijo conocido (feat/12-slug -> #12); exigir el prefijo
// evita leer release/2026-10 como el issue #2026.
function claveDeRama(rama, cfg) {
  if (!rama) return null;
  if (cfg.tickets.proveedor !== 'github') return String(rama).match(cfg.jira.reClave)?.[0] ?? null;
  const prefijos = cfg.git.prefijosSlug.map(escapar).join('|');
  const m = String(rama).match(new RegExp(`^(?:${prefijos})/(\\d+)(?:-|$)`));
  return m ? `#${m[1]}` : null;
}

// Claves de ticket en un texto (commit, comando, respuesta), sin repetir y en orden.
// GitHub: #N y owner/repo#N; no cuenta &#123; (entidad HTML) ni x#5 (pegado a una palabra).
function clavesEnTexto(texto, cfg) {
  const patron =
    cfg.tickets.proveedor === 'github'
      ? /(?<![\w&#/.-])(?:[\w.-]+\/[\w.-]+)?#\d+\b/g
      : new RegExp(cfg.jira.claveFuente, 'g');
  return [...new Set(String(texto ?? '').match(patron) || [])];
}

// Nombres de los estados de sub-tarea (enProceso, finalizado, pendiente) del proveedor activo:
// lo que se anota en el estado de sesion y lo que pintan sticker y titulo.
function estadosDe(cfg) {
  return cfg.tickets.proveedor === 'github' ? cfg.github.estados : cfg.jira.estados;
}

// Ruta del adaptador de GitHub para las instrucciones que se le inyectan al agente.
const TICKET_JS = path.join(__dirname, 'ticket.js').replace(/\\/g, '/');

// Movidas de GitHub que prueba un Bash: `ticket.js mover` y su linea de exito, una por issue.
// Como con acli, lo que cuenta es la linea impresa, no el comando: intentado no es movido.
// Devuelve [{clave, estado}] con la clave owner/repo#N y la opcion tal cual la imprimio ticket.js.
function movidasDeGithub(evento, cfg) {
  if (cfg.tickets.proveedor !== 'github' || evento?.tool_name !== 'Bash') return [];
  if (!/\bticket\.js["']?\s+mover\b/.test(evento?.tool_input?.command || '')) return [];
  const r = evento?.tool_response;
  const salida = typeof r === 'string' ? r : [r?.stdout, r?.output].filter((t) => typeof t === 'string').join('\n');
  return [...salida.matchAll(/^Issue \(([\w.-]+\/[\w.-]+#\d+)\) movido a \(([^)\r\n]+)\)\r?$/gm)].map(
    ([, clave, estado]) => ({ clave, estado })
  );
}

// Rama actual de la carpeta (o del repo que la contiene). Lee .git/HEAD directo: un spawn de
// git en cada refresco del status line es caro. Sube por el arbol porque la sesion puede
// estar en un subdirectorio, y contempla worktrees, donde .git es un archivo que apunta al
// directorio real.
function ramaDe(carpeta) {
  let actual = path.resolve(carpeta);
  for (let saltos = 0; saltos < 8; saltos++) {
    try {
      let gitDir = path.join(actual, '.git');
      if (fs.statSync(gitDir).isFile()) {
        const apunta = fs.readFileSync(gitDir, 'utf8').match(/gitdir:\s*(.+)/);
        if (!apunta) return null;
        gitDir = path.resolve(actual, apunta[1].trim());
      }
      const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
      const ref = head.match(/^ref:\s*refs\/heads\/(.+)$/);
      return ref ? ref[1] : null;
    } catch {
      const padre = path.dirname(actual);
      if (padre === actual) return null;
      actual = padre;
    }
  }
  return null;
}

// Escribe el titulo de la terminal (OSC 0). El stdout de un hook o del status line se lo queda
// Claude Code, asi que hay que ir al dispositivo de consola: CONOUT$ en Windows; en el resto
// /dev/tty (NO probado: solo se probo en Windows). Sin consola real no hay titulo que poner.
function ponerTituloTerminal(texto) {
  const secuencia = `\x1b]0;${String(texto).replace(/[\x00-\x1f]/g, ' ')}\x07`;
  const destino = process.platform === 'win32' ? '\\\\.\\CONOUT$' : '/dev/tty';
  try {
    fs.writeFileSync(destino, secuencia);
  } catch {
    /* sin consola real no hay titulo que poner */
  }
}

// Un ticket que no se toco en las ultimas 16 horas ya no es noticia. La aplican el hook que
// anota las transiciones y el sticker que las lee: si solo la aplicara el hook, un ticket de
// ayer seguiria en pantalla hasta la proxima transicion anotada, que puede no llegar nunca.
const VIGENCIA_HORAS = 16;

// Copia de `tareas` sin las que vencieron. Una fecha ilegible cuenta como vencida.
function tareasVigentes(tareas, ahora = Date.now()) {
  const limite = ahora - VIGENCIA_HORAS * 3600 * 1000;
  return Object.fromEntries(
    Object.entries(tareas || {}).filter(([, dato]) => Date.parse(dato?.desde) > limite)
  );
}

module.exports = {
  cargar,
  hook,
  partirEnTramos,
  deducirEstado,
  claveDeRama,
  clavesEnTexto,
  estadosDe,
  movidasDeGithub,
  TICKET_JS,
  ramaDe,
  ponerTituloTerminal,
  escapar,
  VIGENCIA_HORAS,
  tareasVigentes,
};
