// Hook PostToolUse sobre Bash: cuando `gh issue create` creo un issue cuyo cuerpo dice
// `Part of: <HU>`, lo cuelga como sub-issue de esa HU (gestion-github: algo con su propio PR o en
// otro repo es sub-issue de la HU). gh no tiene --parent, y un «Related» en el texto no es un
// enlace del tablero: asi quedo suelto facturalo-kmp#38 de su HU.
//
// Solo la senal explicita `Part of` / `Parent`: «Related» no es hijo, y adivinar la HU de la
// sesion colgaria issues donde no van. La prueba de que el issue existe es la URL que imprime gh.

const { execFileSync } = require('child_process');
const { hook } = require('./config');

hook((evento, cfg) => {
  if (cfg.tickets.proveedor !== 'github') return;
  if (!/\bgh\s+issue\s+create\b/.test(evento?.tool_input?.command || '')) return;
  const r = evento?.tool_response;
  const salida = typeof r === 'string' ? r : [r?.stdout, r?.output].filter((t) => typeof t === 'string').join('\n');
  const creado = salida.match(/https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)/);
  if (!creado) return;
  const [, repo, numero] = creado;

  const gh = (...args) => execFileSync(process.env.DUCK_GH || 'gh', args, { encoding: 'utf8', timeout: 20000 });
  let texto;
  try {
    const issue = JSON.parse(gh('api', `repos/${repo}/issues/${numero}`));
    const padre = String(issue.body || '').match(/^\s*(?:part of|parent):?\s+((?:[\w.-]+\/[\w.-]+)?#\d+)\s*$/im)?.[1];
    if (!padre) return;
    const [repoPadre, numPadre] = padre.startsWith('#') ? [repo, padre.slice(1)] : padre.split('#');
    gh('api', '-X', 'POST', `repos/${repoPadre}/issues/${numPadre}/sub_issues`, '-F', `sub_issue_id=${issue.id}`);
    texto = `${repo}#${numero} quedo como sub-issue de ${repoPadre}#${numPadre} (Part of en su cuerpo).`;
  } catch (e) {
    texto =
      `${repo}#${numero} dice Part of en su cuerpo pero no se pudo colgar de la HU (${String(e.message).split('\n')[0]}). ` +
      'Colgalo con `gh api -X POST repos/<owner>/<repo>/issues/<N>/sub_issues -F sub_issue_id=<id>`.';
  }
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: texto } }));
});
