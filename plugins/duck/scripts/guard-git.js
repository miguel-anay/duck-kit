// Hook PreToolUse: bloquea las tres prohibiciones absolutas del cierre de tarea
// que METODO.md declara "sin excepcion" pero que la lista de permisos deja pasar.
//
//   1. push directo a la rama base   (METODO.md, paso 10)
//   2. merge local hacia la rama base (METODO.md, paso 10)
//   3. git branch -D                  (METODO.md, paso 11: "-d, nunca -D")
//
// Lee el JSON del hook por stdin y responde con una decision de permiso.
// No usa jq. Sin .claude/duck.json no hace nada (ver config.js).

const { hook, partirEnTramos } = require('./config');

hook((evento, cfg) => {
  const comando = evento?.tool_input?.command ?? '';
  if (!comando) return;

  for (const tramo of partirEnTramos(comando)) {
    const motivo = revisar(tramo, cfg.git.ramaBase);
    if (motivo) return denegar(motivo);
  }
});

// Quita las opciones globales que van entre `git` y el subcomando (`git -C backend push`,
// `git -c clave=valor merge`, `git --no-pager branch -D`). Sin esto, las reglas de abajo
// —que buscan `git push` pegado— dejaban pasar la forma con -C, que es la que se usa
// para trabajar sobre otro repositorio del workspace.
const OPCIONES_GLOBALES = /\bgit((?:\s+(?:-C|-c|--git-dir|--work-tree|--namespace)\s+(?:"[^"]*"|'[^']*'|\S+)|\s+--?[\w-]+(?:=\S+)?)*)\s+(?=\w)/g;

function revisar(tramoOriginal, base) {
  const tramo = tramoOriginal.replace(OPCIONES_GLOBALES, 'git ');
  const argumentos = tramo.split(/\s+/);
  const tiene = (re) => re.test(tramo);

  if (tiene(/\bgit\s+push\b/)) {
    const aBase = argumentos.some((a) => a === base || a.endsWith(`:${base}`));
    if (aBase) {
      return `push directo a ${base}. El merge se hace SOBRE el PR (API de GitHub o boton), `
        + 'nunca con push local — METODO.md, paso 10, "eso no tiene excepcion".';
    }
  }

  // (?![-\w]): git merge-tree y git merge-base son de solo lectura y no
  // mergean nada; con \b a secas el guardia los bloqueaba.
  if (tiene(/\bgit\s+merge(?![-\w])/)) {
    const esAbortar = tiene(/--(abort|continue|quit)\b/);
    const esPonerseAlDia = tiene(/--ff-only\s+origin\//);
    if (!esAbortar && !esPonerseAlDia) {
      return 'merge local. El merge del PR va por la API de GitHub o el boton — METODO.md, paso 10. '
        + 'Lo unico permitido aqui es ponerse al dia: git merge --ff-only origin/<rama> (paso 11).';
    }
  }

  if (tiene(/\bgit\s+branch\b/)) {
    const forzadoCorto = argumentos.some((a) => /^-[a-zA-Z]*D[a-zA-Z]*$/.test(a));
    const forzadoLargo = tiene(/--delete\b/) && tiene(/--force\b/);
    if (forzadoCorto || forzadoLargo) {
      return 'git branch -D borra una rama sin verificar que este mergeada, y esa negativa de -d '
        + 'es la red de seguridad del paso 11. Si -d se niega: PARAR e investigar, nunca forzar.';
    }
  }

  return null;
}

function denegar(motivo) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: motivo,
      },
    })
  );
  process.exit(0);
}
