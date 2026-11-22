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
const { hook, tramosConCwd, pushDe, ramaDe, carpetaDe, pruebasDe, revisionDe, cuandoDe, leerPruebas, AGENTES_PRUEBA } = require('./config');

// Lo que nunca cambia el comportamiento. Un .txt puede ser requirements.txt o CMakeLists.txt, y un
// .svg puede llevar script: cuentan como codigo.
const PASIVO = /\.(md|mdx|rst|adoc|png|jpe?g|gif|webp|pdf)$/i;

hook((evento, cfg) => {
  const avisos = [];
  for (const { tramo, cwd } of tramosConCwd(evento?.tool_input?.command ?? '', evento?.cwd || cfg.raiz)) {
    const aviso = revisar(tramo, cwd, cfg);
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
  const motivo = motivoDe(push.dir, rama, cfg);
  if (!motivo) return null;

  const corridos = leerPruebas(cfg, rama);
  const faltan = pedidos.filter((tipo) => !corridos[tipo]);
  if (!faltan.length) return null;

  const lineas = [
    `duck: la rama ${rama} sale sin estos agentes de pruebas que ${carpeta === '.' ? 'el proyecto' : `el repo ${carpeta}`} ` +
      `pide en pruebas (METODO.md §9): ${faltan.map((tipo) => AGENTES_PRUEBA[tipo]).join(', ')}.`,
    'Es un aviso: el push sigue. Si se saltearon a proposito, decile a la persona cuales y por que.',
  ];
  if (motivo !== true) lineas.splice(1, 0, `Motivo: ${motivo}.`);
  if (faltan.includes('adversarial') && revisionDe(cfg) === 'auto' && cfg.odd && cfg.odd.tareas) {
    lineas.push('duck:adversario no hace falta si este cambio paso por la revision nativa de gentle-ai o por Judgment Day.');
  }
  return lineas.join('\n');
}

// Nombres de ruta y codigo que suelen llevar el riesgo que estos agentes buscan: validar, parsear,
// calcular plata, decidir permisos, recibir datos de afuera. Es una heuristica, no un analisis: lo
// que el proyecto sabe que es delicado y no cae aca se nombra en pruebas.riesgo.
const RUTA_DE_RIESGO =
  /(valid|sanitiz|pars(e|er|ing)|auth|permis|polic(y|ies)|guard|pago|payment|precio|price|monto|amount|factur|invoice|impuesto|tax|calc|import|upload|webhook|schema|serializ|crypt|password|secret|token|migrat)/i;
const CODIGO_DE_RIESGO =
  /(JSON\.parse|parseInt|parseFloat|new RegExp|\beval\(|child_process|innerHTML|req\.(body|query|params)|\$_(GET|POST|REQUEST)|request\.(json|form|args|input)|\b(validate|sanitize|authorize)\w*\(|\b(SELECT|INSERT INTO|UPDATE|DELETE FROM)\b)/;

// Por que este push pide las pruebas: null = no las pide; true = las pide sin mas (cuando 'siempre');
// un texto = el motivo, con cuando 'riesgo'. Sin poder comparar con la base las pide: mejor un
// aviso de mas.
function motivoDe(dir, rama, cfg) {
  const base = baseDe(dir, rama, cfg.git.ramaBase);
  const soloSiRiesgo = cuandoDe(cfg) === 'riesgo';
  if (!base) return soloSiRiesgo ? 'no se pudo comparar la rama con la base' : true;

  const codigo = git(dir, ['diff', '--name-only', `${base}...${rama}`]).split('\n').filter((a) => a && !PASIVO.test(a));
  if (!codigo.length) return null; // solo documentacion o imagenes
  if (!soloSiRiesgo) return true;

  const propias = (Array.isArray(cfg.pruebas.riesgo) ? cfg.pruebas.riesgo : []).filter((f) => typeof f === 'string' && f.trim());
  for (const archivo of codigo) {
    const ruta = archivo.toLowerCase();
    if (propias.some((f) => ruta.includes(f.trim().toLowerCase()))) return `${archivo} esta en pruebas.riesgo`;
  }
  const porRuta = codigo.find((archivo) => RUTA_DE_RIESGO.test(archivo));
  if (porRuta) return `toca ${porRuta}`;
  for (const archivo of codigo) {
    const agregado = git(dir, ['diff', '-U0', `${base}...${rama}`, '--', archivo])
      .split('\n')
      .filter((l) => l.startsWith('+') && !l.startsWith('+++'));
    const senal = agregado.map((l) => l.match(CODIGO_DE_RIESGO)).find(Boolean);
    if (senal) return `${archivo} agrega ${senal[0].trim()}`;
  }
  return null;
}

// La base contra la que se compara la rama: la del remoto si esta, o la local. null = ninguna.
function baseDe(dir, rama, base) {
  for (const desde of [`origin/${base}`, base]) {
    try {
      git(dir, ['merge-base', desde, rama]);
      return desde;
    } catch {
      /* esa base no existe aca: se prueba la siguiente */
    }
  }
  return null;
}

// Un repo lento no deja el push sin revisar: vencido el tiempo, hook() avisa que no pudo.
function git(dir, args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 });
}

function avisar(texto) {
  process.stdout.write(
    JSON.stringify({
      systemMessage: texto,
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: texto },
    })
  );
}
