// Hook PreToolUse sobre Bash: bloquea el PRIMER push de una rama de trabajo si
// origin/<rama base> avanzo desde que la rama se integro.
//
// METODO.md, pasos 2 a 4 del cierre: fetch, rebase sobre la base y suite otra vez,
// ANTES de salir al remoto. Escrito como regla, no alcanza: entre el rebase y el
// push puede entrar otra tarea a la base, y el push sale con la rama atrasada.
// Despues del push ya no se puede rebasar sin forzar.
//
// Por eso la comprobacion va en el ultimo momento posible: justo antes del push.
//   - Primer push de la rama (no existe en origin): si origin/<base> no es
//     ancestro de la rama, se BLOQUEA. El rebase todavia es seguro.
//   - La rama ya esta en origin: no se bloquea (rebasar obligaria a forzar);
//     se avisa, y el CI del PR prueba el resultado integrado.
//
// Solo mira ramas con los prefijos de cfg.git.prefijos. El push a la rama base
// lo bloquea guard-git.js; este hook no lo duplica.

const path = require('path');
const { execFileSync } = require('child_process');
const { hook, partirEnTramos } = require('./config');

hook((evento, cfg) => {
  const comando = evento?.tool_input?.command ?? '';
  const cwd = evento?.cwd || process.cwd();
  if (!/\bgit\b[^\n;&|]*\bpush\b/.test(comando)) return;

  for (const tramo of partirEnTramos(comando)) {
    const push = leerPush(tramo, cwd, cfg);
    if (!push) continue;
    const veredicto = revisar(push, cfg.git.ramaBase);
    if (veredicto?.bloquear) return responder('deny', veredicto.texto);
    if (veredicto?.avisar) return responder(null, veredicto.texto);
  }
});

// git [-C dir] push [opciones] [remoto] [rama | HEAD | local:remota]
function leerPush(tramo, cwd, cfg) {
  const partes = tramo.split(/\s+/).map((p) => p.replace(/^["']|["']$/g, ''));
  const iGit = partes.findIndex((p) => p === 'git' || /[\\/]git(\.exe)?$/.test(p));
  if (iGit < 0) return null;

  let dir = cwd;
  let i = iGit + 1;
  while (partes[i] === '-C' && partes[i + 1]) {
    dir = path.resolve(dir, partes[i + 1]);
    i += 2;
  }
  if (partes[i] !== 'push') return null;

  const posicionales = partes.slice(i + 1).filter((p) => !p.startsWith('-'));
  const remoto = posicionales[0] || 'origin';
  let rama = posicionales[1] || 'HEAD';
  if (rama.includes(':')) rama = rama.split(':')[0];
  if (rama === 'HEAD') rama = git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!rama || !cfg.git.prefijos.some((p) => rama.startsWith(`${p}/`))) return null;

  return { dir, remoto, rama };
}

function revisar({ dir, remoto, rama }, base) {
  // Sin red o sin repo no se puede comprobar nada: no se inventa un bloqueo.
  if (git(dir, ['fetch', '--quiet', remoto, base], 20000) === null) return null;

  const enRemoto = git(dir, ['ls-remote', '--heads', remoto, rama], 20000);
  if (enRemoto === null) return null;
  const yaPublicada = enRemoto.trim() !== '';

  const alDia = git(dir, ['merge-base', '--is-ancestor', `${remoto}/${base}`, rama]) !== null;
  if (alDia) return null;

  const atras = git(dir, ['rev-list', '--count', `${rama}..${remoto}/${base}`]) || '?';
  const commits = (git(dir, ['log', '--format=%h %s', `${rama}..${remoto}/${base}`]) || '')
    .split('\n')
    .filter(Boolean)
    .slice(0, 5)
    .map((l) => `  - ${l}`)
    .join('\n');

  if (!yaPublicada) {
    return {
      bloquear: true,
      texto:
        `${remoto}/${base} se movio: trae ${atras} commit(s) que ${rama} no tiene.\n${commits}\n` +
        `METODO.md, pasos 2 a 4: rebase sobre origin/${base} y suite completa otra vez ANTES del push. ` +
        'La rama todavia no esta en el remoto, asi que el rebase es seguro.',
    };
  }
  return {
    avisar: true,
    texto:
      `Aviso: ${rama} ya esta publicada y ${remoto}/${base} trae ${atras} commit(s) nuevos.\n${commits}\n` +
      'No se rebasa una rama publicada (habria que forzar el push). El CI del PR prueba el resultado ' +
      'integrado; revisar que esos commits no toquen los mismos archivos.',
  };
}

function git(cwd, args, timeout = 8000) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout }).trim();
  } catch {
    return null;
  }
}

function responder(decision, texto) {
  const salida = decision
    ? {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: decision,
          permissionDecisionReason: texto,
        },
      }
    : { systemMessage: texto, hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: texto } };
  process.stdout.write(JSON.stringify(salida));
  process.exit(0);
}
