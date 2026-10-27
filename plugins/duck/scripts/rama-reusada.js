// Hook PreToolUse sobre Bash: AVISA, no bloquea, cuando se crea una rama cuya
// clave de Jira ya se uso con otro nombre.
//
// La convencion pide una rama por tarea, y el MISMO nombre en todos los repos que
// toque el cambio (METODO.md, «Una rama por tarea»). La alerta de /duck:estado ve los
// reusos meses despues; este hook los ve en el unico momento en que todavia se puede
// elegir otro nombre o abrir la sub-tarea.
//
// No bloquea porque hay reusos legitimos: un defecto que aparece dentro de la tarea y
// la destraba. Por eso deja un aviso al agente y otro a la persona, y la llamada sigue.
//
// La deny de lo prohibido sin excepcion vive aparte, en guard-git.js.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { hook, partirEnTramos, escapar, claveDeRama, referenciaIssue } = require('./config');

hook((evento, cfg) => {
  const aviso = revisar(evento?.tool_input?.command ?? '', evento?.cwd || cfg.raiz, cfg);
  if (aviso) avisar(aviso);
});

function revisar(comando, cwd, cfg) {
  const avisos = [];
  for (const tramo of partirEnTramos(comando)) {
    const nueva = ramaQueSeCrea(tramo, cwd, cfg);
    if (!nueva) continue;
    const clave = claveDeRama(nueva.rama, cfg);
    if (!clave) continue;
    const aviso = compararConLoExistente(clave, nueva, cfg);
    if (aviso) avisos.push(aviso);
  }
  return avisos.join('\n\n');
}

// Reconoce las formas de crear una rama y en que repositorio:
//   git [-C dir] switch -c|-C|--create <rama>
//   git [-C dir] checkout -b|-B <rama>
//   git [-C dir] worktree add ... -b|-B <rama> ...
// `git branch <rama>` a secas se deja fuera: es raro y choca con sus
// muchos otros usos (listar, -d, --list).
function ramaQueSeCrea(tramo, cwd, cfg) {
  const partes = tramo.split(/\s+/).map((p) => p.replace(/^["']|["']$/g, ''));
  const iGit = partes.findIndex((p) => p === 'git' || /[\\/]git(\.exe)?$/.test(p));
  if (iGit < 0) return null;

  let dir = cwd;
  let i = iGit + 1;
  while (partes[i] === '-C' && partes[i + 1]) {
    dir = path.resolve(dir, partes[i + 1]);
    i += 2;
  }

  const sub = partes[i];
  const resto = partes.slice(i + 1);
  let banderas;
  if (sub === 'switch') banderas = ['-c', '-C', '--create'];
  else if (sub === 'checkout') banderas = ['-b', '-B'];
  else if (sub === 'worktree' && resto[0] === 'add') banderas = ['-b', '-B'];
  else return null;

  const iBandera = resto.findIndex((p) => banderas.includes(p));
  let rama = iBandera >= 0 ? resto[iBandera + 1] : null;
  const pegada = resto.find((p) => p.startsWith('--create='));
  if (!rama && pegada) rama = pegada.slice('--create='.length);
  if (!rama) return null;

  return { rama, repo: repoDe(dir, cfg) };
}

// Carpeta del proyecto (una de cfg.git.carpetas) en que cae el directorio.
function repoDe(dir, cfg) {
  const relativo = path.relative(path.resolve(cfg.raiz), path.resolve(dir)).split(path.sep)[0];
  if (cfg.git.carpetas.includes(relativo)) return relativo;
  return cfg.git.carpetas.includes('.') ? '.' : null;
}

function slug(rama, cfg) {
  const sinOrigen = rama.replace(/^origin\//, '');
  const prefijo = cfg.git.prefijosSlug.find((p) => sinOrigen.startsWith(`${p}/`));
  return prefijo ? sinOrigen.slice(prefijo.length + 1) : sinOrigen;
}

function compararConLoExistente(clave, nueva, cfg) {
  // GitHub: la rama no lleva el # (feat/12-slug), asi que se la reconoce por claveDeRama; en la
  // base cuenta un commit cuyo mensaje (no solo el asunto) referencia el issue como en inventario
  // (Refs #12, Fixes #12, (#12)...: referenciaIssue); mencionar #12 al pasar no cuenta.
  const github = cfg.tickets.proveedor === 'github';
  const exacta = new RegExp(`${escapar(clave)}(?!\\d)`);
  const esDeLaClave = (rama) => (github ? claveDeRama(rama, cfg) === clave : exacta.test(rama));
  const patrones = github ? [`*/${clave.slice(1)}-*`, `*/${clave.slice(1)}`] : [`*${clave}*`];
  const base = cfg.git.ramaBase;
  const otras = []; // { repo, rama } con otro slug
  const enBase = [];
  let mismoNombre = false; // la misma rama ya existe (en este u otro repo)

  for (const repo of cfg.git.carpetas) {
    const cwd = path.join(cfg.raiz, repo);
    if (!fs.existsSync(cwd)) continue;

    for (const rama of correr(cwd, ['branch', '-a', '--format=%(refname:short)', '--list', ...patrones])) {
      const limpia = rama.replace(/^origin\//, '');
      if (!esDeLaClave(limpia) || limpia === 'HEAD') continue;
      if (slug(limpia, cfg) === slug(nueva.rama, cfg)) {
        mismoNombre = true; // mismo nombre en otro repo: lo que pide la convencion
        continue;
      }
      if (!otras.some((o) => o.repo === repo && o.rama === limpia)) otras.push({ repo, rama: limpia });
    }

    // Las ramas mergeadas se borran (paso 11), pero su rastro queda en la rama base.
    const grep = ['log', `origin/${base}`, '--no-merges', '-E', `--grep=${escapar(clave)}([^0-9]|$)`];
    const asuntos = github
      ? correr(cwd, [...grep, '--format=%B%x00']).join('\n').split('\0').filter((m) => referenciaIssue(m, clave.slice(1)))
      : correr(cwd, [...grep, '--format=%s']).filter((s) => exacta.test(s));
    if (asuntos.length) enBase.push(`${repo} (${asuntos.length} commits)`);
  }

  // Si la misma rama ya existe, lo que hay en la base es esa misma tarea
  // (el cambio que cruza repos), no un reuso.
  if (mismoNombre) enBase.length = 0;
  if (!otras.length && !enBase.length) return null;

  const lineas = [`Aviso de rama: ${clave} ya se uso antes de esta rama nueva (${nueva.rama}).`];
  if (otras.length) {
    lineas.push('Ramas existentes con otro nombre:');
    for (const o of otras) lineas.push(`  - ${o.repo}: ${o.rama}`);
  }
  if (enBase.length) lineas.push(`Ya hay trabajo de ${clave} en ${base}: ${enBase.join(', ')}.`);
  lineas.push(
    'La convencion pide una rama por tarea y el mismo nombre en todos los repos. Antes de seguir: ' +
      '¿es la misma tarea (usar el mismo nombre de rama), o es otro trabajo (abrir su propia sub-tarea)? ' +
      'Si es un reuso deliberado, decirlo en el reporte. Esto es un aviso: el comando sigue.'
  );
  return lineas.join('\n');
}

function correr(cwd, args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 4000 })
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

// additionalContext le llega al agente; systemMessage, a la persona. Sin
// permissionDecision la llamada sigue el flujo normal de permisos.
function avisar(texto) {
  process.stdout.write(
    JSON.stringify({
      systemMessage: texto,
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: texto },
    })
  );
}
