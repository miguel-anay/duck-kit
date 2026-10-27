// Status line: el sticker de la tarea de Jira de ESTA sesion.
//
// Un plugin NO puede declarar el statusLine: se instala a mano en ~/.claude/settings.json
// (instalar.ps1 lo hace). Como el status line es de usuario, corre en TODOS los proyectos;
// en los que no tienen .claude/duck.json no imprime nada.
//
// Todo lo que pinta esta acotado a la sesion que lo pide. Un sticker compartido
// entre sesiones no es un sticker: es un cartel en la pared, y le cuelga a una
// sesion el ticket de otra.
//
// Tres fuentes, en este orden de confianza:
//   1. <proyecto>/.claude/estado/sesiones/<session_id>.json — lo que Jira confirmo, via el
//      hook de la transicion. Es un hecho, no una intencion.
//   2. el NOMBRE de la sesion — se bautiza con el ticket ("618 detalle registro",
//      "Paginas 631 y 632"). Es lo que declaro que esta haciendo, y llega mucho antes
//      que la transicion.
//   3. la rama del repositorio donde esta parada la sesion (una rama por tarea).
//
// Cada fuente se pinta distinto a proposito: el color dice cuanto hay que creerle.
//
// De paso deja en cache el texto plano para el hook del titulo, que corre en
// Stop y ahi NO recibe el nombre de la sesion.

const fs = require('fs');
const path = require('path');
const { cargar, ramaDe, ponerTituloTerminal, tareasVigentes, estadosDe, claveDeRama, clavesEnTexto } = require('./config');

let entrada = '';
process.stdin.on('data', (c) => (entrada += c));
process.stdin.on('end', () => {
  const cfg = cargar();
  if (!cfg) process.exit(0); // proyecto sin duck.json: ni una palabra

  let contexto = {};
  try {
    contexto = JSON.parse(entrada || '{}');
  } catch {
    /* sin contexto se dibuja igual */
  }

  const e = estadosDe(cfg);
  const COLOR = {
    [e.enProceso]: { fondo: 214, texto: 232, marca: '*' },
    [e.finalizado]: { fondo: 35, texto: 232, marca: 'v' },
    [e.pendiente]: { fondo: 244, texto: 232, marca: '.' },
    nombre: { fondo: 30, texto: 231, marca: '#' },
    rama: { fondo: 24, texto: 254, marca: '~' },
  };

  const fichas = reunir(contexto, cfg, COLOR);
  guardarVista(contexto, fichas, cfg, COLOR);
  ponerTitulo(contexto, fichas, cfg, COLOR);
  process.stdout.write(pintar(fichas, COLOR));
});

// El titulo de la pestaña lo escribe tambien Claude Code, y gana el ultimo que
// escribe. Un hook en Stop lo pone una vez por turno y puede perder; esto corre
// con cada refresco del status line, asi que se repone solo a los 10 segundos.
function ponerTitulo(contexto, { modo, fichas, spike }, cfg, COLOR) {
  const base = contexto?.session_name || path.basename(contexto?.cwd || cfg.raiz);
  const insignia = modo === 'flujo' ? '[FLUJO] ' : modo === 'spike' ? `[SPIKE ${spike?.tema || ''}] ` : '';
  const tickets = fichas.map((f) => `${f.clave} ${COLOR[f.origen].marca}`).join('  ');
  ponerTituloTerminal(`${insignia}${base}${tickets ? ' — ' + tickets : ''}`);
}

// Devuelve [{clave, origen}] sin repetir, en orden de confianza.
function reunir(contexto, cfg, COLOR) {
  const fichas = [];
  const puestas = new Set();
  const sumar = (clave, origen) => {
    if (clave && !puestas.has(clave)) {
      puestas.add(clave);
      fichas.push({ clave, origen });
    }
  };

  const almacen = leerEstado(contexto.session_id, cfg);
  for (const [clave, dato] of Object.entries(almacen.tareas).sort(
    (a, b) => Date.parse(a[1].desde) - Date.parse(b[1].desde)
  )) {
    if (COLOR[dato.estado]) sumar(clave, dato.estado);
  }

  const desde = contexto?.workspace?.current_dir || contexto?.cwd;
  for (const clave of ticketsDelNombre(contexto.session_name, cfg, desde)) sumar(clave, 'nombre');
  sumar(ticketDeLaRama(contexto, cfg), 'rama');

  return { modo: almacen.modo, fichas, spike: almacen.spike };
}

function pintar({ modo, fichas, spike }, COLOR) {
  // El spike no tiene ticket: el sticker lleva el tema, y no se mezcla con las fichas.
  if (modo === 'spike') return ficha(`🧪 spike ${spike?.tema || ''}`.trim(), { fondo: 97, texto: 231 });
  if (!fichas.length) return tenue('sin tarea activa');
  const insignia = modo === 'flujo' ? ficha('FLUJO', { fondo: 134, texto: 231 }) + ' ' : '';
  return insignia + fichas.map((f) => ficha(f.clave, COLOR[f.origen])).join(' ');
}

function ficha(texto, { fondo, texto: tinta, marca }) {
  const cuerpo = marca ? `${texto} ${marca}` : texto;
  return `\x1b[48;5;${fondo}m\x1b[38;5;${tinta}m\x1b[1m ${cuerpo} \x1b[0m`;
}

function tenue(texto) {
  return `\x1b[2m${texto}\x1b[0m`;
}

// El hook del titulo corre en Stop, donde el contexto no trae session_name.
// Esta cache es el unico modo de que el titulo vea lo mismo que el sticker.
function guardarVista(contexto, { modo, fichas }, cfg, COLOR) {
  const sesion = contexto?.session_id;
  if (!sesion) return;
  const texto = fichas.map((f) => `${f.clave} ${COLOR[f.origen].marca}`).join('  ');
  try {
    fs.mkdirSync(cfg.dirEstado, { recursive: true });
    fs.writeFileSync(
      path.join(cfg.dirEstado, `${sesion}-vista.json`),
      JSON.stringify({ texto, modo, nombre: contexto.session_name || '', actualizado: Date.now() })
    );
  } catch {
    /* la cache es una comodidad, no un requisito */
  }
}

function leerEstado(sesion, cfg) {
  const vacio = { tareas: {}, modo: 'tarea' };
  if (!sesion) return vacio;
  try {
    const almacen = { ...vacio, ...JSON.parse(fs.readFileSync(path.join(cfg.dirEstado, `${sesion}.json`), 'utf8')) };
    // Lo vencido no se pinta aunque siga en el archivo: el hook lo borra en la proxima anotacion.
    return { ...almacen, tareas: tareasVigentes(almacen.tareas) };
  } catch {
    return vacio;
  }
}

// "618 detalle registro" -> PROY-618.  "Paginas 631 y 632" -> PROY-631, PROY-632.
// Tambien acepta la clave escrita entera. Pide 3 o 4 digitos para no confundir
// un numero suelto de otra cosa con un ticket. Sin jira.proyecto no hay prefijo con el
// que completar un numero suelto: solo se reconocen las claves enteras.
// GitHub: solo #N y owner/repo#N escritos enteros; el numero suelto queda para Jira.
function ticketsDelNombre(nombre, cfg, desde) {
  if (!nombre) return [];
  if (cfg.tickets.proveedor === 'github') return clavesEnTexto(nombre, cfg, desde);
  const claves = [];
  for (const m of String(nombre).matchAll(/\b([A-Z][A-Z0-9]+)-(\d+)\b/gi)) {
    claves.push(`${m[1].toUpperCase()}-${m[2]}`);
  }
  if (cfg.jira.proyecto) {
    const limpio = String(nombre).replace(/\b[A-Z][A-Z0-9]+-\d+\b/gi, ' ');
    for (const m of limpio.matchAll(/\b(\d{3,4})\b/g)) claves.push(`${cfg.jira.proyecto}-${m[1]}`);
  }
  return [...new Set(claves)];
}

// Solo el repositorio donde esta parada ESTA sesion. Barrer todos los repos del
// proyecto es justamente lo que hacia que una sesion mostrara el ticket de otra.
function ticketDeLaRama(contexto, cfg) {
  const desde = contexto?.workspace?.current_dir || contexto?.cwd;
  if (!desde) return null;
  return claveDeRama(ramaDe(desde), cfg, desde);
}
