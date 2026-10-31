// Hook PostToolUse sobre Bash: un issue recien creado con `gh issue create` entra al Project de
// duck.json (github.proyecto). Sin esto el issue quedaba fuera del tablero, sin estado, y ni el
// panel ni ticket.js mover podian seguirlo (la HU factufacil-docs#41, visto 2026-10-30). El estado
// inicial lo pone el workflow «Item added to project» del Project; los sub-issues de una HU que ya
// esta en el tablero los agrega tambien «Auto-add sub-issues to project». Agregar dos veces no
// duplica: gh devuelve el item existente.

const { execFileSync } = require('child_process');
const { hook } = require('./config');

hook((evento, cfg) => {
  if (cfg.tickets.proveedor !== 'github') return;
  const { owner, numero } = cfg.github.proyecto || {};
  if (!owner || !numero) return;
  if (!/\bgh\s+issue\s+create\b/.test(evento?.tool_input?.command || '')) return;
  const r = evento?.tool_response;
  const salida = typeof r === 'string' ? r : [r?.stdout, r?.output].filter((t) => typeof t === 'string').join('\n');
  const creado = salida.match(/https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)/);
  if (!creado) return;

  const clave = `${creado[1]}#${creado[2]}`;
  let texto;
  try {
    execFileSync(process.env.DUCK_GH || 'gh', ['project', 'item-add', String(numero), '--owner', owner, '--url', creado[0]], {
      encoding: 'utf8',
      timeout: 20000,
    });
    texto = `${clave} quedo en el Project ${owner}/${numero}.`;
  } catch (e) {
    texto =
      `${clave} se creo pero no se pudo agregar al Project ${owner}/${numero} (${String(e.message).split('\n')[0]}). ` +
      `Agregalo con \`gh project item-add ${numero} --owner ${owner} --url ${creado[0]}\`.`;
  }
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: texto } }));
});
