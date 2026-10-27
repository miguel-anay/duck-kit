// Tickets de GitHub (Issues + Project v2) para el proveedor 'github'. Hace lo que en Jira hacen
// la JQL y la transicion, con la convencion de GitHub: clave #N (repo actual) u owner/repo#N.
//
//   node ticket.js ver <clave>             JSON: titulo, tipo, estado del Project, padre, sub-issues
//   node ticket.js mover <clave> <estado>  pone el campo de estado; <estado> es una clave de
//                                          github.estados (enProceso...) o el nombre de la opcion
//
// Va por `gh api graphql`: necesita `gh` con el scope project (`gh auth refresh -s project`).
// Sin transiciones: en un Project el estado se escribe directo.

const { execFileSync } = require('child_process');

const CONSULTA = `query($owner: String!, $repo: String!, $n: Int!, $campo: String!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $n) {
      id number title state url
      repository { nameWithOwner }
      issueType { name }
      assignees(first: 10) { nodes { login } }
      parent { number repository { nameWithOwner } }
      projectItems(first: 10) { nodes {
        id
        project { id number owner { ... on Organization { login } ... on User { login } }
          field(name: $campo) { ... on ProjectV2SingleSelectField { id options { id name } } } }
        fieldValueByName(name: $campo) { ... on ProjectV2ItemFieldSingleSelectValue { name } }
      } }
      subIssues(first: 50) { nodes {
        number title state
        repository { nameWithOwner }
        assignees(first: 10) { nodes { login } }
        projectItems(first: 10) { nodes {
          project { number owner { ... on Organization { login } ... on User { login } } }
          fieldValueByName(name: $campo) { ... on ProjectV2ItemFieldSingleSelectValue { name } }
        } }
      } }
    }
  }
}`;

const MUTACION = `mutation($p: ID!, $i: ID!, $f: ID!, $o: String!) {
  updateProjectV2ItemFieldValue(input: { projectId: $p, itemId: $i, fieldId: $f, value: { singleSelectOptionId: $o } }) {
    projectV2Item { id }
  }
}`;

// '#12' o '12' contra el repo actual (owner/repo); 'owner/repo#12' tal cual.
function parsearClave(clave, repoPorDefecto) {
  // Con owner/repo el # es obligatorio: sin el, owner/repo12 se leeria como repo1#2.
  const m = String(clave).trim().match(/^(?:([\w.-]+)\/([\w.-]+)#|#?)(\d+)$/);
  if (!m) throw new Error(`clave invalida: ${clave} (se espera #N u owner/repo#N)`);
  if (m[1]) return { owner: m[1], repo: m[2], numero: Number(m[3]) };
  if (!repoPorDefecto) throw new Error(`sin repositorio de GitHub para resolver ${clave}: usa owner/repo#N`);
  const [owner, repo] = repoPorDefecto.split('/');
  return { owner, repo, numero: Number(m[3]) };
}

// owner/repo de una URL de remoto de GitHub (https o ssh), o null.
function repoDeRemoto(url) {
  const m = String(url || '').trim().match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

function repoActual() {
  try {
    return repoDeRemoto(execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch {
    return null;
  }
}

// El item del Project configurado; sin proyecto en la configuracion, el unico que haya. Una
// configuracion a medias es un error: caer al «unico» podria escribir en otro Project.
// ponytail: lee los primeros 10 projects del issue y 50 sub-issues, sin paginar.
function elegirItem(items, cfg) {
  const { owner, numero } = cfg.github.proyecto;
  if (Boolean(owner) !== Boolean(numero)) throw new Error('github.proyecto necesita owner y numero, o ninguno');
  if (owner) {
    const login = String(owner).toLowerCase();
    return (
      items.find((it) => it.project?.number === Number(numero) && it.project?.owner?.login?.toLowerCase() === login) || null
    );
  }
  return items.length === 1 ? items[0] : null;
}

const claveDe = (nodo) => `${nodo.repository.nameWithOwner}#${nodo.number}`;
const logins = (nodo) => (nodo.assignees?.nodes || []).map((a) => a.login);
const estadoEn = (nodo, cfg) => elegirItem(nodo.projectItems?.nodes || [], cfg)?.fieldValueByName?.name ?? null;

function resumir(issue, cfg) {
  return {
    clave: claveDe(issue),
    titulo: issue.title,
    tipo: issue.issueType?.name ?? null,
    abierto: issue.state === 'OPEN',
    estado: estadoEn(issue, cfg),
    asignados: logins(issue),
    url: issue.url,
    padre: issue.parent ? claveDe(issue.parent) : null,
    hijas: (issue.subIssues?.nodes || []).map((h) => ({
      clave: claveDe(h),
      titulo: h.title,
      abierto: h.state === 'OPEN',
      estado: estadoEn(h, cfg),
      asignados: logins(h),
    })),
  };
}

// Opcion del campo de estado: por clave del flujo (github.estados) o por nombre de la opcion.
function elegirOpcion(campo, estado, cfg) {
  if (!campo?.options) {
    throw new Error(`el Project no tiene un campo de seleccion unica "${cfg.github.campoEstado}" (github.campoEstado)`);
  }
  const estados = cfg.github.estados || {};
  const nombre = String(Object.hasOwn(estados, estado) ? estados[estado] : estado).toLowerCase();
  const opcion = campo.options.find((o) => o.name.toLowerCase() === nombre);
  if (!opcion) {
    const hay = campo.options.map((o) => o.name).join(', ');
    throw new Error(`el campo de estado no tiene la opcion "${estado}". Opciones: ${hay}`);
  }
  return opcion;
}

// gh api graphql con variables: -f para texto, -F para numeros.
// Un error de gh se reduce a su stderr: el mensaje de execFileSync repite la consulta entera.
function ghReal(args) {
  try {
    return JSON.parse(execFileSync('gh', ['api', 'graphql', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch (e) {
    throw new Error(String(e.stderr || e.message).trim());
  }
}

function buscar(clave, { cfg, repoActual: actual, gh }) {
  const { owner, repo, numero } = parsearClave(clave, actual);
  const r = gh(['-f', `query=${CONSULTA}`, '-f', `owner=${owner}`, '-f', `repo=${repo}`, '-F', `n=${numero}`, '-f', `campo=${cfg.github.campoEstado}`]);
  const issue = r?.data?.repository?.issue;
  if (!issue) throw new Error(`no existe el issue ${owner}/${repo}#${numero}`);
  return issue;
}

function ver(clave, deps) {
  return resumir(buscar(clave, deps), deps.cfg);
}

function mover(clave, estado, deps) {
  const issue = buscar(clave, deps);
  const item = elegirItem(issue.projectItems?.nodes || [], deps.cfg);
  if (!item) throw new Error(`${claveDe(issue)} no esta en el Project configurado (github.proyecto): agregalo primero`);
  const opcion = elegirOpcion(item.project.field, estado, deps.cfg);
  deps.gh(['-f', `query=${MUTACION}`, '-f', `p=${item.project.id}`, '-f', `i=${item.id}`, '-f', `f=${item.project.field.id}`, '-f', `o=${opcion.id}`]);
  return `Issue (${claveDe(issue)}) movido a (${opcion.name})`;
}

module.exports = { parsearClave, repoDeRemoto, resumir, elegirItem, elegirOpcion, ver, mover };

if (require.main === module) {
  const cfg = require('./config').cargar();
  const [accion, clave, estado] = process.argv.slice(2);
  try {
    if (!cfg) throw new Error('no hay .claude/duck.json en este proyecto');
    const deps = { cfg, repoActual: repoActual(), gh: ghReal };
    if (accion === 'ver' && clave) console.log(JSON.stringify(ver(clave, deps), null, 2));
    else if (accion === 'mover' && clave && estado) console.log(mover(clave, estado, deps));
    else throw new Error('uso: ticket.js ver <clave> | ticket.js mover <clave> <estado>');
  } catch (e) {
    console.error(`ticket.js: ${e.message}`);
    process.exit(1);
  }
}
