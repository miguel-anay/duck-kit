// Inventario local de la mesa de trabajo: junta en un solo JSON todo lo que se
// puede saber desde disco (hooks instalados, comandos, skills, estado de los repos
// git del proyecto, sesion activa, ramas por clave de Jira). Lo que solo Jira sabe
// (titulo, estado, asignado de un ticket) NO va aca: eso lo trae el agente con el
// MCP de Atlassian desde el comando /duck:estado. El reparto es deliberado: un script
// determinista no depende de que el agente se acuerde de correr cada comando git suelto.
//
// Uso: node inventario.js [session_id] [--claves A-1,A-2]
// Se corre desde el proyecto (o una subcarpeta): el proyecto se encuentra por su
// .claude/duck.json (ver config.js). Sin duck.json responde {"sinConfiguracion": true}.
//
// Contrato: nunca lanza una excepcion. Cualquier parte que no se puede leer
// sale en null o vacia, pero el JSON completo se imprime siempre y el proceso
// termina en 0 — este script alimenta un panel de lectura, no debe poder
// romper la sesion que lo invoca.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { cargar, escapar, claveDeRama, clavesEnTexto } = require('./config');

const RAIZ_PLUGIN = path.resolve(__dirname, '..');
const cfg = cargar();
const BASE = cfg ? cfg.git.ramaBase : 'develop';
const REPOS = cfg ? cfg.git.carpetas : [];
const RAIZ = cfg ? cfg.raiz : process.cwd();
const GITHUB = cfg?.tickets.proveedor === 'github';

function main() {
  if (!cfg) {
    process.stdout.write(JSON.stringify({ sinConfiguracion: true, ayuda: 'configurar el proyecto con /duck:iniciar' }) + '\n');
    process.exit(0);
  }

  // Modo --claves: solo el estado de git por clave de Jira, sin el resto del
  // inventario. Lo usa /duck:estado para saber donde esta el codigo de cada
  // sub-tarea (en una rama, ya en la base, o sin rama todavia).
  const claves = leerArgClaves(process.argv);
  if (claves !== null) {
    const porClave = intentar(() => gitPorClave(claves), {});
    process.stdout.write(JSON.stringify({ claves: porClave }, null, 2) + '\n');
    process.exit(0);
  }

  const resultado = {
    piezas: intentar(leerPiezas, []),
    comandos: intentar(leerComandos, []),
    skills: intentar(leerSkills, []),
    repos: {},
    sesion: intentar(() => leerSesion(process.argv[2]), null),
  };
  for (const repo of REPOS) resultado.repos[repo] = intentar(() => leerRepo(repo), repoVacio(repo));

  const agrupado = intentar(() => agruparRamasPorClave(), {});
  resultado.ramasPorClave = agrupado;
  const enJuego = intentar(() => clavesEnJuego(resultado), []);
  resultado.sospechas = intentar(() => detectarSospechas(agrupado, enJuego), []);
  // Fuera de foco solo cuentan las ramas SIN mergear: un reuso que ya esta en
  // la base no tiene correccion, y contarlo inflaba la alerta con decenas de
  // claves viejas. En foco se siguen mirando todas, porque el caso que mas
  // importa es una rama nueva que reusa la clave de un trabajo ya mergeado.
  resultado.sospechasFueraDeFoco = intentar(() => {
    const vivas = agruparRamasPorClave(true);
    return detectarSospechas(vivas, Object.keys(vivas).filter((c) => !enJuego.includes(c))).length;
  }, null);

  process.stdout.write(JSON.stringify(resultado, null, 2) + '\n');
  process.exit(0);
}

// Envoltorio generico: una parte rota no puede tumbar el JSON entero.
function intentar(fn, porDefecto) {
  try {
    return fn();
  } catch {
    return porDefecto;
  }
}

function repoVacio(repo) {
  return {
    repo,
    rama: null,
    clave: null,
    limpio: null,
    alDia: null,
    commitsPropios: null,
  };
}

// --- piezas: hooks del plugin (hooks/hooks.json) y el statusLine de ~/.claude/settings.json ---

function leerPiezas() {
  const piezas = [];

  const hooks = JSON.parse(fs.readFileSync(path.join(RAIZ_PLUGIN, 'hooks', 'hooks.json'), 'utf8')).hooks || {};
  for (const evento of Object.keys(hooks)) {
    const grupos = Array.isArray(hooks[evento]) ? hooks[evento] : [];
    for (const grupo of grupos) {
      const matcher = grupo.matcher ?? null;
      const entradas = Array.isArray(grupo.hooks) ? grupo.hooks : [];
      for (const entrada of entradas) {
        const ruta = rutaDelScript(entrada.command);
        piezas.push({ evento, matcher, archivo: ruta ? path.basename(ruta) : null, existe: ruta ? existeArchivo(ruta) : false });
      }
    }
  }

  // El statusLine no lo puede declarar un plugin: vive en la configuracion de usuario.
  const settings = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8'));
  if (settings.statusLine) {
    const ruta = rutaDelScript(settings.statusLine.command);
    piezas.push({ evento: 'statusLine', matcher: null, archivo: ruta ? path.basename(ruta) : null, existe: ruta ? existeArchivo(ruta) : false });
  }

  return piezas;
}

// El command trae la ruta entre comillas ("${CLAUDE_PLUGIN_ROOT}/scripts/x.js" o una absoluta).
function rutaDelScript(command) {
  const match = String(command || '').match(/"([^"]+\.js)"/);
  return match ? match[1].replace('${CLAUDE_PLUGIN_ROOT}', RAIZ_PLUGIN) : null;
}

function existeArchivo(ruta) {
  try {
    return fs.existsSync(ruta);
  } catch {
    return false;
  }
}

// --- comandos: los del plugin (/duck:...) y los del proyecto bajo .claude/commands/ ---

function leerComandos() {
  const delPlugin = nombresMd(path.join(RAIZ_PLUGIN, 'commands')).map((n) => `duck:${n}`);
  const delProyecto = nombresMd(path.join(RAIZ, '.claude', 'commands'));
  return [...new Set([...delPlugin, ...delProyecto])].sort();
}

function nombresMd(base) {
  return listarMdRecursivo(base)
    .map((rutaAbsoluta) => {
      const relativa = path.relative(base, rutaAbsoluta);
      const sinExtension = relativa.slice(0, -path.extname(relativa).length);
      return sinExtension.split(path.sep).join(':');
    })
    .sort();
}

function listarMdRecursivo(dir) {
  let salida = [];
  let entradas;
  try {
    entradas = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return salida;
  }
  for (const entrada of entradas) {
    const completa = path.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      salida = salida.concat(listarMdRecursivo(completa));
    } else if (entrada.isFile() && completa.endsWith('.md')) {
      salida.push(completa);
    }
  }
  return salida;
}

// --- skills: nombres de carpeta del plugin y del proyecto (.claude/skills/) ---

function leerSkills() {
  const nombres = (base, prefijo) => {
    try {
      return fs
        .readdirSync(base, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => prefijo + e.name);
    } catch {
      return [];
    }
  };
  return [...nombres(path.join(RAIZ_PLUGIN, 'skills'), 'duck:'), ...nombres(path.join(RAIZ, '.claude', 'skills'), '')].sort();
}

// --- repos: estado git de cada carpeta de cfg.git.repos ---

function leerRepo(repo) {
  const cwd = path.join(RAIZ, repo);
  const rama = intentar(() => git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']), null);
  return {
    repo,
    rama,
    clave: claveDeRama(rama, cfg, cwd),
    limpio: intentar(() => git(cwd, ['status', '--porcelain']) === '', null),
    alDia: intentar(() => calcularAlDia(cwd), null),
    commitsPropios: intentar(() => calcularCommitsPropios(cwd), null),
  };
}

function calcularAlDia(cwd) {
  const salida = git(cwd, ['rev-list', '--left-right', '--count', `${BASE}...origin/${BASE}`]);
  const partes = salida.split(/\s+/).filter(Boolean);
  if (partes.length !== 2) return null;
  return partes[0] === '0' && partes[1] === '0';
}

function calcularCommitsPropios(cwd) {
  const salida = git(cwd, ['rev-list', '--count', `origin/${BASE}..HEAD`]);
  const numero = parseInt(salida, 10);
  return Number.isNaN(numero) ? null : numero;
}

// execFileSync y no execSync: en Windows execSync pasa por cmd.exe, que se come el ^ de
// origin/<base>^{tree} como caracter de escape, y obliga a citar argumentos a mano.
function git(cwd, args) {
  return gitArgs(cwd, args).trim();
}

// --- sesion: tareas recientes de la sesion actual, si se paso el id ---

function leerSesion(sessionId) {
  // El id puede venir como `--claves`: solo cuenta lo que parece un id de sesion.
  if (!sessionId || !/^[A-Za-z0-9_-]+$/.test(sessionId)) return null;
  const ruta = path.join(cfg.dirEstado, `${sessionId}.json`);
  let contenido;
  try {
    contenido = JSON.parse(fs.readFileSync(ruta, 'utf8'));
  } catch {
    return null; // sin archivo de sesion no hay nada que mostrar, no es un error
  }

  const tareas = contenido.tareas || {};
  const limiteMs = 16 * 60 * 60 * 1000;
  const ahora = Date.now();
  const filtradas = {};
  for (const clave of Object.keys(tareas)) {
    const entrada = tareas[clave];
    const desde = entrada && entrada.desde ? Date.parse(entrada.desde) : NaN;
    if (!Number.isNaN(desde) && ahora - desde <= limiteMs) {
      filtradas[clave] = entrada;
    }
  }
  return filtradas;
}

// --- git por clave: donde esta el codigo de cada clave de Jira ---

// Acepta `--claves A,B,C` o `--claves=A,B,C`. null = el modo no se pidio.
function leerArgClaves(argv) {
  for (let i = 2; i < argv.length; i++) {
    let lista = null;
    if (argv[i] === '--claves') lista = argv[i + 1] || '';
    else if (argv[i].startsWith('--claves=')) lista = argv[i].slice('--claves='.length);
    if (lista !== null) {
      return lista
        .split(',')
        .map((c) => c.trim())
        .filter((c) => (GITHUB ? clavesEnTexto(c, cfg)[0] === c : cfg.jira.reClaveExacta.test(c)));
    }
  }
  return null;
}

// No hace fetch: usa lo que haya en origin/<base> (no fuerza red).
function gitPorClave(claves) {
  const ramasPorRepo = {};
  for (const repo of REPOS) {
    ramasPorRepo[repo] = intentar(() => listarRamasCompletas(path.join(RAIZ, repo)), []);
  }

  const salida = {};
  for (const clave of claves) {
    const repoEnBase = [];
    const ramas = [];
    for (const repo of REPOS) {
      const cwd = path.join(RAIZ, repo);
      if (intentar(() => mergeadaEnBase(cwd, clave, repo), false)) repoEnBase.push(repo);
      for (const rama of ramasPorRepo[repo]) {
        if (ramaDeLaClave(rama, clave, repo) &&!ramas.some((r) => r.repo === repo && r.rama === rama)) {
          ramas.push({ repo, rama });
        }
      }
    }
    // La ubicacion conserva el nombre «develop» aunque la rama base se llame distinto:
    // es un valor del contrato con el panel (UbicacionGit), no el nombre de una rama.
    let ubicacion = 'sin-rama';
    if (ramas.length > 0) ubicacion = 'rama';
    else if (repoEnBase.length > 0) ubicacion = 'develop';
    salida[clave] = { develop: repoEnBase, ramas, ubicacion };
  }
  return salida;
}

// La clave debe estar delimitada: PROY-67 no es PROY-672.
function contieneClave(texto, clave) {
  return new RegExp(escapar(clave) + '(?!\\d)').test(texto);
}

function ramaDeLaClave(rama, clave, repo) {
  if (!GITHUB) return contieneClave(rama, clave);
  const n = numeroEnRepo(clave, repo);
  return n !== null && claveDeRama(rama, cfg) === `#${n}`;
}

// GitHub: el numero del issue si la clave puede vivir en esa carpeta. owner/repo#N solo vale en
// la carpeta de ese repo (git.repos); #N, en cualquiera. Sin git.repos no hay con que comparar.
function numeroEnRepo(clave, repo) {
  const [, nombre, n] = clave.match(/^(?:[\w.-]+\/([\w.-]+))?#(\d+)$/) || [];
  if (!n) return null;
  const deCarpeta = cfg.git.repos[repo];
  return nombre && deCarpeta && deCarpeta !== nombre ? null : n;
}

// Mergeada = la clave aparece en el ASUNTO de un commit de origin/<base>, como
// scope convencional tipo(CLAVE): o en el asunto de un merge commit de PR
// (Merge pull request #n from org/<prefijo>/CLAVE-...). --grep a secas da
// falsos positivos: un commit puede mencionar otra clave en el cuerpo
// («alias de PROY-672»), y eso no es entregar esa tarea.
function mergeadaEnBase(cwd, clave, repo) {
  if (GITHUB) return mergeadaEnBaseGithub(cwd, clave, repo);
  const salida = git(cwd, ['log', `origin/${BASE}`, `--grep=${clave}`, '--format=%s']);
  const reScope = new RegExp('\\(' + escapar(clave) + '\\)');
  const reMerge = new RegExp('^Merge pull request #\\d+ from \\S+/' + escapar(clave) + '(?!\\d)');
  return salida.split('\n').some((asunto) => reScope.test(asunto) || reMerge.test(asunto));
}

// GitHub: el issue se referencia en el mensaje (Refs #N, Closes #N, o (#N) en el asunto), y el
// merge commit de un PR trae el numero del PR, no el del issue: ahi lo que cuenta es la rama de
// origen (Merge pull request #28 from org/fix/27-x es el #27).
function mergeadaEnBaseGithub(cwd, clave, repo) {
  const n = numeroEnRepo(clave, repo);
  if (n === null) return false;
  const salida = git(cwd, ['log', `origin/${BASE}`, '-E', `--grep=#${n}([^0-9]|$)`, `--grep=/${n}(-|$)`, '--format=%B%x00']);
  const ref = `(?:[\\w.-]+/[\\w.-]+)?#${n}(?!\\d)`;
  const reMensaje = new RegExp(`\\b(?:Refs|Closes)\\s+${ref}|\\(${ref}\\)`, 'i');
  const prefijos = cfg.git.prefijosSlug.map(escapar).join('|');
  const reMerge = new RegExp(`^Merge pull request #\\d+ from \\S+?/(?:${prefijos})/${n}(?:-|$)`, 'm');
  return salida.split('\0').some((m) => {
    const mensaje = m.trim();
    return mensaje.startsWith('Merge pull request') ? reMerge.test(mensaje) : reMensaje.test(mensaje);
  });
}

// Ramas VIVAS: locales o remotas aun sin mergear a origin/<base>. Una rama
// mergeada que nadie borro del remoto no es trabajo en curso. La local y su
// remota cuentan una vez. Reutiliza listarRamas (que ya descarta origin/HEAD).
function listarRamasCompletas(cwd) {
  return [...new Set(listarRamas(cwd, true))];
}

// --- ramasPorClave y sospechas: reuso de clave detectado por nombre de rama ---

function agruparRamasPorClave(sinMergear = false) {
  const agrupado = {};

  for (const repo of REPOS) {
    const cwd = path.join(RAIZ, repo);
    let ramas;
    try {
      ramas = listarRamas(cwd, sinMergear);
    } catch {
      continue; // repo no disponible, no aporta ramas pero no rompe el resto
    }

    for (const rama of ramas) {
      const clave = claveDeRama(rama, cfg, cwd);
      if (!clave) continue;
      if (!agrupado[clave]) agrupado[clave] = [];
      const yaEsta = agrupado[clave].some((e) => e.repo === repo && e.rama === rama);
      if (!yaEsta) agrupado[clave].push({ repo, rama });
    }
  }

  return agrupado;
}

// git branch -a trae locales y remotas. Se usa symref para descartar el alias
// "origin" (= origin/HEAD apuntando a la rama por defecto del remoto), que de
// otro modo aparece como si fuera una rama real. El prefijo "origin/" se
// quita para que una rama local y su misma rama remota cuenten como una sola
// cuando se compara el nombre.
function listarRamas(cwd, sinMergear = false) {
  const args = ['branch', '-a'];
  if (sinMergear) args.push('--no-merged', `origin/${BASE}`);
  args.push('--format=%(refname:short)%09%(symref)');
  const salida = gitArgs(cwd, args);

  const nombres = [];
  for (const linea of salida.split('\n')) {
    if (!linea.trim()) continue;
    const [refname, symref] = linea.split('\t');
    if (!refname || refname === 'HEAD') continue;
    if (symref && symref.trim()) continue; // es un alias (origin/HEAD), no una rama
    const sinPrefijo = refname.startsWith('origin/') ? refname.slice('origin/'.length) : refname;
    if (sinPrefijo === 'HEAD') continue;
    if (sinMergear && yaEntregada(cwd, refname)) continue;
    nombres.push(sinPrefijo);
  }
  return nombres;
}

// --no-merged mira los commits, y un squash merge entrega el contenido con
// otro hash: la rama queda "sin mergear" para siempre aunque todo este en
// la base. Esto pregunta por el contenido: si mergear la rama sobre la base deja el
// arbol de la base identico, la rama no aporta nada y ya esta entregada,
// se haya mergeado como se haya mergeado. Ante cualquier error (un conflicto,
// un git viejo sin --write-tree) se la considera viva: mejor un aviso de mas
// que esconder trabajo pendiente.
const arbolBase = new Map();
function yaEntregada(cwd, ref) {
  return aportaNadaALaBase(cwd, ref) || tieneSuSquashEnLaBase(cwd, ref);
}

// Primera prueba: mergear la rama sobre la base deja el arbol identico.
function aportaNadaALaBase(cwd, ref) {
  try {
    if (!arbolBase.has(cwd)) arbolBase.set(cwd, gitArgs(cwd, ['rev-parse', `origin/${BASE}^{tree}`]).trim());
    const arbol = gitArgs(cwd, ['merge-tree', '--write-tree', `origin/${BASE}`, ref]).split('\n')[0].trim();
    return arbol === arbolBase.get(cwd);
  } catch {
    return false; // merge-tree sale con 1 si hay conflicto
  }
}

// Segunda prueba, para el squash que la base siguio editando despues: ahi
// merge-tree da conflicto. El diff ENTERO de la rama (desde su merge-base) es
// lo que el squash metio en un solo commit, asi que se busca un commit de
// la base con el mismo patch-id. Es la idea de git cherry, pero sobre la rama
// completa y no commit por commit.
function tieneSuSquashEnLaBase(cwd, ref) {
  try {
    const base = gitArgs(cwd, ['merge-base', `origin/${BASE}`, ref]).trim();
    const idRama = patchIds(cwd, gitArgs(cwd, ['diff', base, ref]))[0];
    if (!idRama) return false;
    const deLaBase = gitArgs(cwd, ['log', '-p', '--no-merges', `${base}..origin/${BASE}`]);
    return patchIds(cwd, deLaBase).includes(idRama);
  } catch {
    return false;
  }
}

function patchIds(cwd, parche) {
  return execFileSync('git', ['patch-id', '--stable'], { cwd, input: parche, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
    .split('\n')
    .map((l) => l.split(' ')[0])
    .filter(Boolean);
}

function gitArgs(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 });
}

// Sospechosa = la clave tiene mas de un nombre de rama DISTINTO. El mismo
// nombre repetido en varios repositorios no cuenta: es justo lo que pide la
// convencion para un cambio que toca mas de un repositorio. Lo que delata un
// reuso de clave es el SLUG, no el prefijo ni el repositorio: el mismo slug en
// spec/<clave>-<slug> (etapa A) y feature/<clave>-<slug> (etapa B) es legitimo.
// Cuando el slug cambia son dos trabajos distintos bajo una sola clave, y la
// trazabilidad se rompe en silencio: despues nadie puede decir que entrego esa clave.
function detectarSospechas(agrupado, claves) {
  const sospechas = [];
  for (const clave of claves) {
    if (!agrupado[clave]) continue;
    const nombresDistintos = [...new Set(agrupado[clave].map((e) => e.rama))];
    const slugs = [...new Set(nombresDistintos.map(sinPrefijo))];
    if (slugs.length > 1) {
      sospechas.push(`${clave}: dos trabajos bajo una sola clave — ${nombresDistintos.join(', ')}`);
    }
  }
  return sospechas;
}

// Quita el prefijo de etapa para comparar solo clave y slug.
function sinPrefijo(rama) {
  for (const prefijo of cfg.git.prefijosSlug) {
    if (rama.startsWith(`${prefijo}/`)) return rama.slice(prefijo.length + 1);
  }
  return rama;
}

// Las sospechas se miran SOLO sobre las claves en juego hoy: la rama en que
// esta parado cada repo, y lo anotado en el estado de la sesion. Escanear la
// historia entera devuelve decenas de hallazgos -- un ticket con una segunda
// tajada o un fix posterior tiene dos ramas, y eso es normal -- y a ese
// volumen la alerta deja de significar algo. El conteo de lo que queda fuera
// de foco se reporta aparte para no esconderlo en silencio.
function clavesEnJuego(resultado) {
  const claves = new Set();
  for (const repo of Object.values(resultado.repos || {})) {
    if (repo && repo.clave) claves.add(repo.clave);
  }
  for (const clave of Object.keys(resultado.sesion || {})) claves.add(clave);
  return [...claves];
}

main();
