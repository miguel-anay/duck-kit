// Hook PreToolUse: hace cumplir el «Modo spike» (METODO.md) mientras la sesion
// este en spike (estado de la sesion con "modo": "spike").
//
// Mientras dura un spike no hay nada remoto ni nada en Jira:
//   1. git push (cualquier forma)
//   2. crear o mergear un PR   (gh pr, API de GitHub .../pulls, mergear-pr.js)
//   3. git commit con una clave de Jira en el mensaje, estando en una rama spike/
//   4. escrituras en Jira       (las lecturas siguen permitidas)
//   5. con tickets.proveedor = 'github': escrituras de issues y del Project (ticket.js mover,
//      gh issue create|edit|comment|close|reopen|delete, gh project item-edit, aun con flags
//      globales antes (gh -R org/app issue ...), mutaciones por gh api graphql y escrituras REST
//      por gh api a repos/*/issues* o projects), y el commit del punto 3 con una clave #N
//
// Fuera de spike, o sin estado legible, no hace nada: nunca frena el trabajo normal.
// Igual que guard-git.js: lee el JSON del hook por stdin, no usa jq, y compara texto
// literal del comando — por eso lo que se ofusca de verdad (variables, scripts
// ajenos) no se detecta; es una red, no un sandbox. Sin .claude/duck.json no hace nada.
//
// DUCK_ESTADO_DIR existe SOLO para las pruebas: apunta a una carpeta temporal.

const fs = require('fs');
const path = require('path');
const { hook, partirEnTramos, ramaDe, clavesEnTexto } = require('./config');

const SALIDA = 'Para salir: /duck:tomar <clave> desde-spike (cuando la persona diga «es lo que quiero»), '
  + 'o descartar el spike.';

const JIRA_ESCRITURA = new Set([
  'mcp__atlassian__createJiraIssue',
  'mcp__atlassian__editJiraIssue',
  'mcp__atlassian__transitionJiraIssue',
  'mcp__atlassian__addOrEditJiraIssueComment',
  'mcp__atlassian__executeWrite',
  'mcp__atlassian__executeDestructive',
]);

hook((evento, cfg) => {
  const sesiones = process.env.DUCK_ESTADO_DIR || cfg.dirEstado;
  const estado = leerEstado(sesiones, evento?.session_id);
  if (estado?.modo !== 'spike') return;

  const herramienta = evento?.tool_name ?? '';
  if (JIRA_ESCRITURA.has(herramienta)) {
    return denegar(
      `Escribir en Jira (${herramienta.replace('mcp__atlassian__', '')}). En spike no se crea, edita, `
        + 'transiciona ni comenta nada en Jira. ' + SALIDA
    );
  }

  if (herramienta === 'Bash') {
    const comando = evento?.tool_input?.command ?? '';
    if (!comando) return;
    const motivo = revisarComando(comando, evento, estado, cfg);
    if (motivo) return denegar(motivo);
  }
});

function leerEstado(sesiones, sesion) {
  if (!sesion || !/^[A-Za-z0-9_-]+$/.test(sesion)) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(sesiones, `${sesion}.json`), 'utf8'));
  } catch {
    return null; // sin estado legible no se bloquea nada
  }
}

// gh con flags globales antes del subcomando: gh -R org/app issue ..., gh --repo=x issue ...
const GH = String.raw`\bgh(?:\s+(?:-R|--repo)(?:=|\s+)\S+|\s+--?[\w-]+(?:=\S+)?)*\s+`;

// gh api REST que escribe en issues o en un Project: -X/--method POST|PATCH|PUT|DELETE, o campos
// (-f/-F) sin -X, que gh manda como POST. Un GET (sin -X ni campos, o -X GET) pasa.
function apiEscritura(tramo) {
  if (!new RegExp(`${GH}api\\s`).test(tramo) || /\bapi\s+graphql\b/.test(tramo)) return false;
  if (!/\brepos\/\S*\/issues\b|\bprojects/i.test(tramo)) return false;
  const metodo = tramo.match(/(?:\s-X\s*|\s--method(?:=|\s+))['"]?(\w+)/)?.[1];
  if (metodo) return /^(POST|PATCH|PUT|DELETE)$/i.test(metodo);
  return /\s(?:-[fF]|--field|--raw-field|--input)(?:\s|=)/.test(tramo);
}

function revisarComando(comando, evento, estado, cfg) {
  const github = cfg.tickets.proveedor === 'github';
  // La consulta de graphql puede ocupar varias lineas: se mira el comando entero.
  if (github && new RegExp(`${GH}api\\s+graphql\\b`).test(comando) && /\bmutation\b/.test(comando)) {
    return 'Mutacion por gh api graphql. En spike no se escribe nada en GitHub. ' + SALIDA;
  }
  for (const tramo of partirEnTramos(comando)) {
    if (
      github &&
      (/\bticket\.js["']?\s+mover\b/.test(tramo) ||
        new RegExp(`${GH}issue\\s+(create|edit|comment|close|reopen|delete)\\b`).test(tramo) ||
        new RegExp(`${GH}project\\s+item-edit\\b`).test(tramo) ||
        apiEscritura(tramo))
    ) {
      return `Escribir en GitHub (${tramo.split(/\s+/).slice(0, 3).join(' ')}). En spike no se crea, edita, `
        + 'mueve ni comenta ningun issue. ' + SALIDA;
    }
    if (/\bgit(\s+-[Cc]\s+\S+)*\s+push\b/.test(tramo)) {
      return 'git push. En spike no sale nada al remoto. ' + SALIDA;
    }
    if (/\bgh\s+pr\b/.test(tramo)) {
      return 'gh pr. En spike no se abre ni se mergea ningun PR. ' + SALIDA;
    }
    if (/api\.github\.com\/\S*\/pulls\b/.test(tramo) || /mergear-pr\.js/.test(tramo)) {
      return 'PR por la API de GitHub. En spike no se abre ni se mergea ningun PR. ' + SALIDA;
    }
  }

  // El mensaje puede traer ; o | adentro, y un heredoc ocupa varias lineas:
  // por eso la clave se busca en el comando entero, no por tramo.
  const conClave = github ? clavesEnTexto(comando, cfg).length > 0 : /\b[A-Z]{2,}-\d+\b/.test(comando);
  if (/\bgit(\s+-[Cc]\s+\S+)*\s+commit\b/.test(comando) && conClave) {
    if (hayRamaSpike(comando, evento, estado, cfg)) {
      return `git commit con clave de ${github ? 'GitHub' : 'Jira'}. En spike ni la rama ni los commits llevan clave: una clave `
        + 'inventada choca despues con la real. Reescribi el mensaje sin la clave. ' + SALIDA;
    }
  }
  return null;
}

// Carpetas donde puede caer el commit: la del comando (-C / cd), la sesion y los
// repos del spike. Basta con que una este en una rama spike/.
function hayRamaSpike(comando, evento, estado, cfg) {
  const carpetas = new Set();
  const base = evento?.cwd || cfg.raiz;
  carpetas.add(base);
  for (const m of comando.matchAll(/\bgit\s+-C\s+("([^"]+)"|'([^']+)'|(\S+))/g)) {
    carpetas.add(path.resolve(base, m[2] || m[3] || m[4]));
  }
  for (const m of comando.matchAll(/\bcd\s+("([^"]+)"|'([^']+)'|(\S+))/g)) {
    carpetas.add(path.resolve(base, m[2] || m[3] || m[4]));
  }
  for (const repo of estado?.spike?.repos ?? []) carpetas.add(path.resolve(cfg.raiz, String(repo)));

  return [...carpetas].some((c) => (ramaDe(c) || '').startsWith('spike/'));
}

function denegar(motivo) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `Modo spike (METODO.md): ${motivo}`,
      },
    })
  );
  process.exit(0);
}
