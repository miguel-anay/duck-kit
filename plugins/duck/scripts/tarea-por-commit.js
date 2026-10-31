// Hook PostToolUse sobre Bash: un commit en la rama de una tarea anota esa tarea en la sesion.
//
// Sin esto, la sesion solo se entera de una tarea cuando la mueve (estado-tarea.js). Quien retoma
// trabajo que ya estaba En Proceso trabaja horas sin que el panel ni /duck:estado sepan en que.
// El commit es trabajo de ESTA sesion, asi que respeta la regla de que la clave sale de la sesion,
// nunca de la rama de otra pestaña.
//
// Lo que prueba el commit es su linea de exito, «[rama sha] asunto», no el comando: un commit
// intentado no es un commit. La clave sale de la rama de esa linea, con el repo de la carpeta
// donde corrio (`cd X &&` o `git -C X`; si no, la de la sesion). Una tarea ya anotada conserva
// su estado y solo renueva `desde`; una nueva entra En Proceso, que es lo que un commit prueba.

const path = require('path');
const { hook, partirEnTramos, claveDeRama, estadosDe, leerSesion, guardarSesion, heredarSesionAnterior } = require('./config');

hook((evento, cfg) => {
  const sesion = evento?.session_id;
  const comando = evento?.tool_input?.command || '';
  if (!sesion || !/^[A-Za-z0-9_-]+$/.test(sesion) || !/\bgit\b[^\n]*\bcommit\b/.test(comando)) return;

  const salida = aTexto(evento?.tool_response);
  const rama = salida.match(/^\[([^\s\]]+)(?: \(root-commit\))? [0-9a-f]{7,}\]/m)?.[1];
  if (!rama) return;

  const clave = claveDeRama(rama, cfg, carpetaDelCommit(comando, evento?.cwd || process.cwd()));
  if (!clave || clave.startsWith('#')) return; // sin repo no hay clave canonica que el panel reconozca

  heredarSesionAnterior(cfg, sesion, evento?.transcript_path);
  const almacen = leerSesion(cfg, sesion);
  const estado = almacen.tareas[clave]?.estado || estadosDe(cfg).enProceso;
  almacen.tareas[clave] = { estado, desde: new Date().toISOString() };
  guardarSesion(cfg, sesion, almacen);
});

// Carpeta donde corrio el commit: `git -C X commit`, o el ultimo `cd X` antes del commit.
function carpetaDelCommit(comando, base) {
  let carpeta = base;
  for (const tramo of partirEnTramos(comando)) {
    const cd = tramo.match(/^cd\s+("[^"]+"|'[^']+'|\S+)/)?.[1];
    if (cd) carpeta = path.resolve(carpeta, sinComillas(cd));
    const conC = tramo.match(/^git\s+-C\s+("[^"]+"|'[^']+'|\S+)[^\n]*\bcommit\b/)?.[1];
    if (conC) return path.resolve(carpeta, sinComillas(conC));
    if (/^git\b[^\n]*\bcommit\b/.test(tramo)) return carpeta;
  }
  return carpeta;
}

function sinComillas(texto) {
  return texto.replace(/^["']|["']$/g, '');
}

function aTexto(valor) {
  if (valor == null) return '';
  if (typeof valor === 'string') return valor;
  return [valor.stdout, valor.stderr, valor.output].filter((t) => typeof t === 'string').join('\n');
}
