// Hook PreToolUse sobre Bash: una rama de trabajo no sale al remoto sin su issue.
//
//   1. git push de una rama con prefijo de cfg.git.prefijos: la rama que queda en el remoto
//      tiene que llevar su clave (<prefijo>/<N>-<slug> con GitHub, <prefijo>/<CLAVE>-<n>-<slug>
//      con Jira). Con GitHub, ademas, `ticket.js ver` tiene que confirmar que el issue existe,
//      esta abierto y, si es un Task, cuelga de una HU.
//   2. gh pr create (GitHub): el cuerpo referencia el issue de la rama con Closes #N o Refs #N.
//
// Visto en un proyecto real: una rama sin issue se publico con su PR, y renombrarla despues hizo
// que GitHub cerrara el PR. El push es el punto mas barato para corregirlo: un `git branch -m`
// local, sin ningun PR cerrado. guard-sin-clave.js frena la rama al crearla; este hook frena las
// que se le escapan (anteriores, renombradas, creadas por otra via).
//
// Una rama que ya estaba en el remoto antes de este hook no se frena (renombrarla cerraria su PR):
// se avisa. La rama base no es de trabajo: su push lo cuida guard-git.js. spike/ y cualquier rama
// fuera de cfg.git.prefijos pasan. Si gh falla por otra cosa que un issue inexistente, el hook deja
// pasar con un aviso: los guardias fallan abiertos, pero no en silencio.
//
// DUCK_TICKET_JS existe SOLO para las pruebas: reemplaza a ticket.js.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { hook, partirEnTramos, pushDe, claveDeRama, TICKET_JS } = require('./config');

hook((evento, cfg) => {
  const comando = evento?.tool_input?.command ?? '';
  const cwd = evento?.cwd || process.cwd();

  if (/\bgit\b[^\n;&|]*\bpush\b/.test(comando)) {
    for (const tramo of partirEnTramos(comando)) {
      const push = pushDe(tramo, cwd);
      if (!push?.origen) continue;
      const rama = push.destino === 'HEAD' ? git(push.dir, ['rev-parse', '--abbrev-ref', 'HEAD']) : push.destino;
      const veredicto = revisarPush(rama, push, cfg);
      if (veredicto) return responder(veredicto);
    }
  }

  if (cfg.tickets.proveedor === 'github' && /\bgh\b[^\n]*?\bpr\s+create\b/.test(comando)) {
    const motivo = revisarPr(comando, cwd, cfg);
    if (motivo) return responder({ negar: motivo });
  }
});

function deTrabajo(rama, cfg) {
  return Boolean(rama) && cfg.git.prefijos.some((p) => rama.startsWith(`${p}/`));
}

function formaDeRama(cfg) {
  return cfg.tickets.proveedor === 'github' ? '<prefijo>/<N>-<slug>' : '<prefijo>/<CLAVE>-<n>-<slug>';
}

function revisarPush(rama, { dir, remoto }, cfg) {
  if (!deTrabajo(rama, cfg)) return null;
  const clave = claveDeRama(rama, cfg, dir);
  const { problema, aviso } = !clave
    ? { problema: `la rama ${rama} no lleva el número de su issue (${formaDeRama(cfg)})` }
    : cfg.tickets.proveedor === 'github'
      ? revisarIssue(clave, cfg)
      : {};
  if (aviso) return { avisar: aviso };
  if (!problema) return null;

  const enRemoto = git(dir, ['ls-remote', '--heads', remoto, rama], 20000);
  if (enRemoto) {
    return { avisar: `Aviso: ${problema}. Ya estaba publicada, así que no se frena (renombrarla cerraría su PR).` };
  }
  return {
    negar:
      `Push sin issue: ${problema}. Antes de publicar, la rama necesita su issue: si el trabajo no `
      + 'tiene uno, crealo (colgado de su HU) y renombrá la rama con '
      + `\`git branch -m ${rama} <prefijo>/<N>-<slug>\`. Todavía no está en el remoto, así que el `
      + 'renombre es local y no cierra ningún PR.',
  };
}

// { problema } si el issue no sirve, { aviso } si no se pudo consultar, {} si sirve.
function revisarIssue(clave, cfg) {
  let issue;
  try {
    const salida = execFileSync('node', [process.env.DUCK_TICKET_JS || TICKET_JS, 'ver', clave], {
      cwd: cfg.raiz,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15000,
    });
    issue = JSON.parse(salida);
  } catch (e) {
    return /no existe el issue|Could not resolve to an Issue/i.test(String(e.stderr || ''))
      ? { problema: `el issue ${clave} no existe` }
      : { aviso: `Aviso: no se pudo verificar el issue ${clave} en GitHub; el push sale sin esa revisión.` };
  }
  if (!issue.abierto) return { problema: `el issue ${clave} está cerrado` };
  // Un Task es un sub-issue por definicion; un Bug o una Feature sueltos son issues de primer nivel.
  if (!issue.padre && issue.tipo === 'Task') return { problema: `el issue ${clave} es un Task y no cuelga de ninguna HU` };
  return {};
}

// gh pr create: la rama de cabeza (--head, o la actual) y el cuerpo (--body en el comando, o el
// archivo de --body-file) tienen que nombrar el mismo issue. El titulo terminado en (#N) no alcanza.
function revisarPr(comando, cwd, cfg) {
  const cabeza = comando.match(/(?:--head|-H)[=\s]+["']?([^\s"']+)/)?.[1] ?? git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!deTrabajo(cabeza, cfg)) return null;
  const clave = claveDeRama(cabeza, cfg, cwd);
  if (!clave) return `La rama ${cabeza} no lleva el número de su issue (${formaDeRama(cfg)}): renombrala antes de abrir el PR.`;

  const n = clave.split('#')[1];
  let texto = comando;
  const archivo = comando.match(/(?:--body-file|-F)[=\s]+["']?([^\s"']+)/)?.[1];
  if (archivo && archivo !== '-') {
    try {
      texto += '\n' + fs.readFileSync(path.resolve(cwd, archivo), 'utf8');
    } catch {
      /* archivo ilegible: gh tambien va a fallar */
    }
  }
  const referencia = new RegExp(`\\b(?:close[sd]?|refs)\\s+(?:[\\w.-]+/[\\w.-]+)?#${n}(?!\\d)`, 'i');
  if (referencia.test(texto)) return null;
  return `El cuerpo del PR tiene que referenciar el issue de la rama ${cabeza}: \`Closes #${n}\` si el PR `
    + `lo termina, \`Refs #${n}\` si es parcial. Pasalo con --body o --body-file (--fill no lo garantiza).`;
}

function git(cwd, args, timeout = 8000) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout }).trim();
  } catch {
    return null;
  }
}

function responder({ negar, avisar }) {
  const salida = negar
    ? { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: negar } }
    : { systemMessage: avisar, hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: avisar } };
  process.stdout.write(JSON.stringify(salida));
  process.exit(0);
}
