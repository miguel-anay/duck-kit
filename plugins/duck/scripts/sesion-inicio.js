// Hook SessionStart: al arrancar la sesion, deja en contexto que trabajo quedo
// abierto, para no repetir "en que estaba" cada vez.
//
// Restriccion de diseno, a proposito: este hook es un proceso de shell, SIN
// acceso al MCP de Atlassian -- no puede consultar Jira. Lo unico que puede
// hacer es (a) juntar los hechos locales que si puede ver -- ramas con clave en
// los repos del proyecto, y los merges que cierre-finalizado.js ya anoto
// pero que todavia no se transicionaron -- y (b) pedirle al agente que complete
// con Jira lo que solo el puede traer. Por eso la salida termina siempre en una
// instruccion para el agente, nunca en una conclusion sobre el estado real del
// ticket: ese estado solo lo tiene Jira.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { hook } = require('./config');

const VIGENCIA_HORAS = 16; // mismo criterio que estado-tarea.js: un merge de ayer ya no es noticia

hook((_evento, cfg) => procesar(cfg));

function procesar(cfg) {
  const ramas = ramasAbiertas(cfg);
  const pendientes = pendientesDeCerrar(cfg);
  const odd = reglaOdd(cfg);

  // Sesion limpia y sin regla de ODD: nada de ruido en el contexto.
  if (!ramas.length && !pendientes.length && !odd.length) return;

  const lineas = [...odd];
  if (!ramas.length && !pendientes.length) {
    escribir(lineas);
    return;
  }
  for (const { repo, rama, clave } of ramas) {
    lineas.push(`${repo}: ${rama} -> ${clave}`);
  }
  if (pendientes.length) {
    lineas.push(
      `Mergeado segun esta maquina pero sin transicionar en Jira todavia: ${pendientes.join(', ')}.`
    );
  }
  const proyecto = cfg.jira.proyecto ? `project = ${cfg.jira.proyecto} AND ` : '';
  lineas.push(
    `Corre la JQL ${proyecto}assignee = currentUser() AND status = "${cfg.jira.estados.enProceso}" ` +
      'con searchJiraIssuesUsingJql y reporta en una linea que tareas estan abiertas, ' +
      'senalando cualquier ticket abierto que no tenga rama local (puede estar abandonado).'
  );

  escribir(lineas);
}

function escribir(lineas) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: lineas.join('\n'),
      },
    })
  );
}

// ODD de gentle-ai se instala en el CLAUDE.md global, que gentle-ai reescribe en cada sync: no se
// puede ajustar ahi. Este hook es el canal que si sobrevive, y le dice al orquestador como encaja
// ODD con duck (METODO.md §7). Sin odd.tareas en duck.json, no dice nada y ODD corre tal cual.
//
// La ruta se da ABSOLUTA a proposito: ODD resuelve odd/tasks/ desde el cwd de la sesion, y una sesion
// abierta dentro de un repo lo crearia ahi, versionado.
function reglaOdd(cfg) {
  const tareas = cfg.odd && cfg.odd.tareas;
  if (!tareas) return [];
  const carpeta = path.join(cfg.raiz, tareas);
  const diseno = cfg.odd.diseno;
  return [
    'ODD con duck (METODO.md §7). Prevalece sobre las rutas por defecto de ODD:',
    `- El documento de feature de ODD va SIEMPRE en ${carpeta}${path.sep}<feature>.md, sin importar ` +
      'el cwd: nunca dentro de un repositorio. Es la bitacora de ejecucion, local y sin versionar. ' +
      'Con historia de Jira, <feature> es su clave; en un spike, spike-<tema>.',
    ...(diseno
      ? [
          `- No reemplaza al diseño de la historia (${diseno}): las decisiones que cambian el plan se ` +
            'escriben TAMBIEN en su Bitacora de decisiones, que es lo que ve el otro carril.',
        ]
      : []),
    '- Estrategia de entrega de ODD: single-pr por rama de tarea. No se encadenan PR: la rama y el PR ' +
      'los define el modo activo (tarea, flujo, spike o historia).',
    '- ODD decide CUANDO delegar; duck decide A QUIEN: mapear -> duck:explorador, escribir -> ' +
      'duck:escritor, verificador independiente -> duck:verificador, decidir enfoque o escribir el ' +
      'diseño -> duck:analista.',
    '- La rama la crea /duck:tomar con la clave; ODD no crea la suya. Los commits de unidad de ' +
      'trabajo van en esa rama; push, PR y merge siguen el cierre de METODO.md §2 y el modo activo.',
  ];
}

// Rama actual de cada repo, solo si lleva una clave de trabajo: la rama base y
// main nunca son "trabajo abierto", y el regex los descarta solo porque no la tienen.
function ramasAbiertas(cfg) {
  const resultado = [];
  for (const repo of cfg.git.carpetas) {
    try {
      const rama = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: path.join(cfg.raiz, repo),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      const clave = rama.match(cfg.jira.reClave);
      if (clave) resultado.push({ repo, rama, clave: clave[0] });
    } catch {
      // repo ausente o no es un checkout de git: no es trabajo abierto
    }
  }
  return resultado;
}

// Un "Mergeado" en el estado de sesion es un hecho local (lo dejo
// cierre-finalizado.js al ver el merge real, no una promesa del agente) que
// todavia puede no estar reflejado en Jira: la transicion la hace el agente con
// el MCP, que este hook no tiene.
function pendientesDeCerrar(cfg) {
  const limite = Date.now() - VIGENCIA_HORAS * 3600 * 1000;
  const claves = new Set();
  let archivos = [];
  try {
    archivos = fs.readdirSync(cfg.dirEstado).filter((a) => a.endsWith('.json'));
  } catch {
    return []; // sin carpeta de estado no hay pendientes que reportar
  }
  for (const archivo of archivos) {
    try {
      const almacen = JSON.parse(fs.readFileSync(path.join(cfg.dirEstado, archivo), 'utf8'));
      for (const [clave, dato] of Object.entries(almacen?.tareas || {})) {
        // los archivos "-vista.json" del sticker y "-historia.json" del panel no tienen "tareas": el
        // encadenado de arriba simplemente no entra en el for y se ignoran solos
        if (dato?.estado === 'Mergeado' && Date.parse(dato?.desde) > limite) {
          claves.add(clave);
        }
      }
    } catch {
      // archivo que no parsea (corrupto, formato distinto, etc.): se ignora
    }
  }
  return [...claves];
}
