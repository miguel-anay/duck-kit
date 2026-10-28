// Hook PreToolUse: ninguna rama de trabajo nace sin pasar por /duck:tomar.
//
// /duck:tomar le pregunta a la persona el modo (tarea o flujo) y recien entonces crea la rama
// con la clave, anteponiendo DUCK_MODO=<modo> al comando. Este guardia deniega cualquier otra
// creacion de rama (switch -c, checkout -b, worktree add -b) en un repositorio de git.repos:
// sin clave en el nombre, o sin la marca del modo. Un hook no puede preguntar; la denegacion
// obliga al agente a hacerlo.
//
// Pasan las ramas spike/ (las cuida guard-spike.js) y lo que cae fuera de git.repos. Igual que
// guard-git.js compara texto literal del comando: es una red, no un sandbox.

const path = require('path');
const { hook, partirEnTramos, claveDeRama, ramaQueSeCrea } = require('./config');

const MARCA = /(?:^|\s)DUCK_MODO=(?:tarea|flujo)\s/;

hook((evento, cfg) => {
  if (evento?.tool_name !== 'Bash') return;
  let cwd = evento?.cwd || cfg.raiz;
  for (const tramo of partirEnTramos(evento?.tool_input?.command ?? '')) {
    // cd app && git switch -c ...: la rama cae en la carpeta del cd.
    const cd = tramo.match(/^cd\s+["']?([^"'\s]+)/);
    if (cd) cwd = path.resolve(cwd, cd[1]);
    const nueva = ramaQueSeCrea(tramo, cwd, cfg);
    if (!nueva?.repo || nueva.rama.startsWith('spike/')) continue;
    if (claveDeRama(nueva.rama, cfg, nueva.dir) && MARCA.test(tramo)) continue;
    return denegar(nueva.rama);
  }
});

function denegar(rama) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          `Rama ${rama} sin tarea tomada. Antes de empezar una historia o una tarea, preguntale a la `
          + 'persona con un menu de dos opciones: modo tarea (un issue o sub-tarea suelta) o modo flujo '
          + '(la historia entera, sub-tarea por sub-tarea). Despues corre /duck:tomar <clave> con ese '
          + 'modo: es el que crea la rama. Para explorar sin ticket: /duck:spike.',
      },
    })
  );
  process.exit(0);
}
