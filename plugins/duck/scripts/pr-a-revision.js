// Hook PostToolUse sobre Bash: cuando `gh pr create` abrio un PR de verdad, pasa el issue de la
// rama a In Review (METODO.md, «Al abrir el PR»). Solo con tickets.proveedor = 'github': con Jira
// el hook no tiene el MCP, y la transicion sigue siendo del agente.
//
// Lo mueve el propio hook, no un recordatorio: era el paso que el agente se olvidaba. El Project
// puede tenerlo ya movido por su workflow «Pull request linked to issue» (con Closes #N); fijar
// la misma opcion otra vez no cambia nada.
//
// La prueba de que el PR existe es la URL que imprime gh, no el comando: intentado no es abierto.
// El issue sale de la rama (--head, o la rama actual del repo del PR), nunca del #N del PR.

const path = require('path');
const { execFileSync } = require('child_process');
const { hook, claveDeRama, ramaDe, TICKET_JS } = require('./config');

hook((evento, cfg) => {
  if (cfg.tickets.proveedor !== 'github') return;
  const comando = evento?.tool_input?.command || '';
  if (!/\bgh\s+pr\s+create\b/.test(comando)) return;

  const r = evento?.tool_response;
  const salida = typeof r === 'string' ? r : [r?.stdout, r?.output].filter((t) => typeof t === 'string').join('\n');
  const pr = salida.match(/https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/\d+/);
  if (!pr) return;

  const nombre = Object.keys(cfg.git.repos).find((c) => cfg.git.repos[c].toLowerCase() === pr[2].toLowerCase()) ?? (cfg.git.carpetas.includes('.') ? '.' : null);
  const carpeta = nombre === null ? null : path.join(cfg.raiz, nombre);
  const head = comando.match(/(?:--head|-H)[=\s]+["']?([\w./-]+)/)?.[1];
  const clave = claveDeRama(head ?? (carpeta && ramaDe(carpeta)), cfg, carpeta);
  if (!clave) return;

  let texto;
  try {
    const linea = execFileSync('node', [process.env.DUCK_TICKET_JS || TICKET_JS, 'mover', clave, 'enRevision'], {
      encoding: 'utf8',
      timeout: 20000,
    }).trim();
    texto = `PR abierto: ${linea}`;
  } catch (e) {
    texto =
      `PR abierto, pero no se pudo mover ${clave} a ${cfg.github.estados.enRevision} (${String(e.message).split('\n')[0]}). ` +
      `Movelo con \`node "${TICKET_JS}" mover ${clave} enRevision\`.`;
  }
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: texto } }));
});
