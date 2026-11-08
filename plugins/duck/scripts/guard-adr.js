// Hook PreToolUse (Write|Edit): un ADR aceptado no se edita. Solo puede cambiar su linea Status
// (Accepted -> Superseded by NNNN / Deprecated); una decision que cambia lleva un ADR nuevo que
// reemplaza o enmienda al anterior.
//
// Aceptado quiere decir aceptado en la rama base (origin/HEAD), no en el archivo de trabajo: un ADR
// nuevo, o Proposed en la base, sigue editable dentro de su PR aunque ya diga Accepted. Visto en un
// proyecto real: un ADR escrito Accepted en un PR sin mergear quedo trabado cuando su dueño cambio la
// decision. Sin git (no es repo, no hay origin/HEAD) decide el archivo de trabajo. La base es la
// referencia local: sin fetch, un ADR recien mergeado todavia se ve editable.
//
// El ADR es un NNNN-titulo.md dentro de la carpeta adr de duck.json (doc/adr). Dentro de un repo se
// compara la ruta relativa al repo con el final de esa carpeta, asi que un worktree del repo de docs
// tambien queda cuidado. Sin adr, o sin .claude/duck.json, no hace nada.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { hook, textoResultante } = require('./config');

const NOMBRE = /^\d{4}-[^/\\]+\.md$/;
const STATUS = /^\s*-?\s*Status:/i;
const ACEPTADO = /^\s*-?\s*Status:\s*Accepted\b/im;

hook((evento, cfg) => {
  const entrada = evento?.tool_input ?? {};
  if (!cfg.adr || !entrada.file_path || !NOMBRE.test(path.basename(entrada.file_path))) return;

  let actual;
  try {
    actual = fs.readFileSync(entrada.file_path, 'utf8');
  } catch {
    return; // ADR nuevo
  }
  if (!ACEPTADO.test(actual)) return;

  const archivo = fs.realpathSync(entrada.file_path);
  const dir = path.dirname(archivo);
  const repo = git(dir, ['rev-parse', '--show-toplevel']);
  const relativa = repo && barras(path.relative(fs.realpathSync(repo), archivo));
  const carpeta = barras(cfg.adr).replace(/^\.?\/|\/$/g, '');
  const enCarpeta = relativa
    ? `/${carpeta}`.endsWith(`/${path.posix.dirname(relativa)}`)
    : barras(dir).endsWith(`/${carpeta}`);
  if (!enCarpeta || !aceptadoEnBase(dir, relativa, actual)) return;

  const nuevo = textoResultante(evento.tool_name, entrada);
  if (nuevo === null || sinStatus(nuevo) === sinStatus(actual)) return;

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          `${path.basename(archivo)} está Accepted en la rama base: un ADR aceptado no se edita. `
          + 'Solo puede cambiar su línea Status (Superseded by NNNN / Deprecated). Un detalle '
          + '(etiquetas, vistas, comandos, rutas) va a la documentación del proyecto; una decisión que '
          + 'cambia lleva un ADR nuevo que reemplaza o enmienda a este. Una errata la corrige a mano su dueño.',
      },
    })
  );
});

// Si el ADR esta Accepted en origin/HEAD. Sin repo o sin origin/HEAD decide el archivo de trabajo.
function aceptadoEnBase(dir, relativa, actual) {
  const base = relativa && git(dir, ['rev-parse', '--abbrev-ref', 'origin/HEAD']);
  if (!base) return true; // actual ya dice Accepted
  return ACEPTADO.test(git(dir, ['show', `${base}:${relativa}`]) ?? '');
}

function sinStatus(texto) {
  return texto.split(/\r?\n/).filter((l) => !STATUS.test(l)).join('\n').trimEnd();
}

function barras(ruta) {
  return String(ruta).replace(/\\/g, '/');
}

function git(cwd, args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim();
  } catch {
    return null;
  }
}
