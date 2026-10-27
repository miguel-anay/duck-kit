// Escribe el ticket en curso en el titulo de la terminal, a la derecha del nombre.
//
// El status line vive dentro de Claude Code; el titulo se ve en la pestaña o en la
// barra de la ventana, asi que sirve cuando hay varias terminales abiertas y una
// esta tapada por otra.
//
// En Windows el titulo NO se puede mandar por stdout: ese stdout se lo queda
// Claude Code. Hay que escribirle al dispositivo de consola (CONOUT$), que es el
// que comparten el proceso padre y sus hijos (ver ponerTituloTerminal en config.js).
//
// Corre en Stop (al cerrar cada turno, por si algo piso el titulo) y despues de
// cada sesion que arranca.

const fs = require('fs');
const path = require('path');
const { hook, ramaDe, ponerTituloTerminal, estadosDe, claveDeRama } = require('./config');

hook((contexto, cfg, entrada) => {
  const volcado = path.join(cfg.raiz, '.claude', 'estado', 'ultimo-contexto-stop.json');
  try {
    fs.mkdirSync(path.dirname(volcado), { recursive: true });
    fs.writeFileSync(volcado, entrada || '{}');
  } catch {
    /* el volcado es de diagnostico: que no rompa nada */
  }
  try {
    const titulo = componer(contexto, cfg);
    if (process.env.TITULO_DEBUG) console.log(titulo);
    else ponerTituloTerminal(titulo);
  } catch {
    /* un titulo no puede voltear un turno */
  }
});

// El contexto de Stop NO trae session_name (solo session_id, cwd, permission_mode,
// last_assistant_message...). Por eso lo primero que se mira es la cache que deja el
// status line, que si lo recibe y ya resolvio los tickets con las tres fuentes.
function componer(contexto, cfg) {
  const carpeta = contexto?.cwd || contexto?.workspace?.current_dir || cfg.raiz;
  const vista = leerVista(contexto?.session_id, cfg);

  const base = vista?.nombre || path.basename(carpeta);
  const insignia = vista?.modo === 'flujo' ? '[FLUJO] ' : '';
  const tickets = vista ? vista.texto : tareasDe(contexto?.session_id, carpeta, cfg).join('  ');

  return tickets ? `${insignia}${base} — ${tickets}` : `${insignia}${base}`;
}

// La cache vale mientras el status line la este refrescando (cada 10 s). Si esta
// vieja, la sesion ya no existe o se apago el status line: mejor recomponer.
function leerVista(sesion, cfg) {
  if (!sesion) return null;
  try {
    const ruta = path.join(cfg.dirEstado, `${sesion}-vista.json`);
    const vista = JSON.parse(fs.readFileSync(ruta, 'utf8'));
    return Date.now() - vista.actualizado < 10 * 60 * 1000 ? vista : null;
  } catch {
    return null;
  }
}

function tareasDe(sesion, carpeta, cfg) {
  const e = estadosDe(cfg);
  const marca = { [e.enProceso]: '*', [e.finalizado]: 'v', [e.pendiente]: '.' };
  const etiquetas = [];
  const puestos = new Set();

  try {
    const ruta = path.join(cfg.dirEstado, `${sesion}.json`);
    const almacen = JSON.parse(fs.readFileSync(ruta, 'utf8'));
    for (const [clave, dato] of Object.entries(almacen.tareas || {}).sort(
      (a, b) => Date.parse(a[1].desde) - Date.parse(b[1].desde)
    )) {
      if (!marca[dato.estado]) continue;
      puestos.add(clave);
      etiquetas.push(`${clave} ${marca[dato.estado]}`);
    }
  } catch {
    /* sin estado de sesion queda el respaldo de la rama */
  }

  const deRama = claveDeRama(ramaDe(carpeta), cfg, carpeta);
  if (deRama && !puestos.has(deRama)) etiquetas.push(`${deRama} ~`);
  return etiquetas;
}
