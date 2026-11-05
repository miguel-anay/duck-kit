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

const { execFileSync } = require('child_process');
const { hook, partirEnTramos, pushDe } = require('./config');

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

// La rama local que se empuja, si es de trabajo (cfg.git.prefijos).
function leerPush(tramo, cwd, cfg) {
  const push = pushDe(tramo, cwd);
  if (!push) return null;
  const rama = push.origen === 'HEAD' ? git(push.dir, ['rev-parse', '--abbrev-ref', 'HEAD']) : push.origen;
  if (!rama || !cfg.git.prefijos.some((p) => rama.startsWith(`${p}/`))) return null;
  return { dir: push.dir, remoto: push.remoto, rama };
}

function revisar({ dir, remoto, rama }, base) {
  // Sin red o sin repo no se puede comprobar nada: no se inventa un bloqueo, pero se avisa.
  const sinComprobar = {
    avisar: true,
    texto: `Aviso: no se pudo comprobar ${remoto}/${base} (sin red o sin acceso); ${rama} sale sin revisar si está al día.`,
  };
  if (git(dir, ['fetch', '--quiet', remoto, base], 20000) === null) return sinComprobar;

  const enRemoto = git(dir, ['ls-remote', '--heads', remoto, rama], 20000);
  if (enRemoto === null) return sinComprobar;
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
