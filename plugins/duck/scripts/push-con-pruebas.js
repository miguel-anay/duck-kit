// Hook PreToolUse sobre Bash: AVISA, no bloquea, cuando sale un push de una rama a la que le
// faltan agentes de pruebas de los que su repositorio pide en pruebas (METODO.md §9).
//
// Que agentes corrieron lo anota pruebas-anota.js. Este hook sabe que el agente se lanzo, no que
// se arreglo lo que encontro: eso sigue siendo criterio de quien revisa.
//
// No bloquea porque todavia hay saltos legitimos que no puede ver: con pruebas.revision 'auto', la
// revision de gentle-ai reemplaza a duck:adversario. Por eso deja un aviso al agente y otro a la
// persona, y el push sigue. Una rama que solo toca documentacion no pide nada.

const { execFileSync } = require('child_process');
const { hook, partirEnTramos, pushDe, ramaDe, carpetaDe, pruebasDe, revisionDe, leerPruebas, AGENTES_PRUEBA } = require('./config');

const PASIVO = /\.(md|mdx|txt|rst|adoc|png|jpe?g|gif|svg|webp|pdf)$/i;

hook((evento, cfg) => {
  const avisos = [];
  for (const tramo of partirEnTramos(evento?.tool_input?.command ?? '')) {
    const aviso = revisar(tramo, evento?.cwd || cfg.raiz, cfg);
    if (aviso && !avisos.includes(aviso)) avisos.push(aviso);
  }
  if (avisos.length) avisar(avisos.join('\n\n'));
});

function revisar(tramo, cwd, cfg) {
  const push = pushDe(tramo, cwd);
  if (!push || !push.origen) return null;
  const carpeta = carpetaDe(push.dir, cfg);
  if (carpeta === null) return null;
  const pedidos = pruebasDe(cfg, carpeta);
  if (!pedidos.length) return null;

  const rama = push.origen === 'HEAD' ? ramaDe(push.dir) : push.origen;
  if (!rama || [cfg.git.ramaBase, 'main', 'master'].includes(rama)) return null;
  if (!tocaCodigo(push.dir, rama, cfg.git.ramaBase)) return null;

  const corridos = leerPruebas(cfg)[rama] || {};
  const faltan = pedidos.filter((tipo) => !corridos[tipo]);
  if (!faltan.length) return null;

  const lineas = [
    `duck: la rama ${rama} sale sin estos agentes de pruebas que ${carpeta === '.' ? 'el proyecto' : `el repo ${carpeta}`} ` +
      `pide en pruebas (METODO.md §9): ${faltan.map((tipo) => AGENTES_PRUEBA[tipo]).join(', ')}.`,
    'Es un aviso: el push sigue. Si se saltearon a proposito, decile a la persona cuales y por que.',
  ];
  if (faltan.includes('adversarial') && revisionDe(cfg) === 'auto' && cfg.odd && cfg.odd.tareas) {
    lineas.push('duck:adversario no hace falta si este cambio paso por la revision nativa de gentle-ai o por Judgment Day.');
  }
  return lineas.join('\n');
}

// Si el cambio de la rama toca algo que no sea documentacion o imagenes. Sin poder saberlo
// (no hay base contra la que comparar), cuenta como codigo: mejor un aviso de mas.
function tocaCodigo(dir, rama, base) {
  for (const desde of [`origin/${base}`, base]) {
    try {
      const archivos = execFileSync('git', ['diff', '--name-only', `${desde}...${rama}`], {
        cwd: dir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .split('\n')
        .filter(Boolean);
      return archivos.some((archivo) => !PASIVO.test(archivo));
    } catch {
      /* esa base no existe aca: se prueba la siguiente */
    }
  }
  return true;
}

function avisar(texto) {
  process.stdout.write(
    JSON.stringify({
      systemMessage: texto,
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: texto },
    })
  );
}
