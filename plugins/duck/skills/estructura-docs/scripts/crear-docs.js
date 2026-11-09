// Crea la carpeta de docs del proyecto segun su layout, sin pisar nada.
// Uso: node crear-docs.js [--dry-run] [directorio]   (por defecto, el directorio actual)
// Imprime un JSON { layout, destino, dryRun, creados, existentes, advertencias }.
// Standalone: solo usa plantillas/ junto a este script, sin hooks ni duck.json.

const fs = require('fs');
const path = require('path');

const PLANTILLAS = path.join(__dirname, '..', 'plantillas');
const MARCAS_MONOREPO = ['pnpm-workspace.yaml', 'turbo.json', 'nx.json'];

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const raiz = path.resolve(args.find((a) => !a.startsWith('--')) || process.cwd());

const esRepo = (d) => fs.existsSync(path.join(d, '.git'));

function esMonorepo() {
  if (MARCAS_MONOREPO.some((m) => fs.existsSync(path.join(raiz, m)))) return true;
  try {
    return !!JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8')).workspaces;
  } catch {
    return false;
  }
}

function subrepos() {
  return fs.readdirSync(raiz, { withFileTypes: true })
    .filter((e) => e.isDirectory() && esRepo(path.join(raiz, e.name)))
    .map((e) => e.name);
}

// Cada entrada: [ruta relativa al destino, plantilla | null]. Una ruta terminada en / es carpeta vacia.
function plan() {
  const adr = ['adr/0000-plantilla.md', 'adr-0000.md'];
  if (esRepo(raiz)) {
    // A single repo, small or monorepo, keeps the full series inside: it depends on no other docs.
    const serie = ['README.md', 'PRD.md', 'TECH-DESIGN.md', 'SECURITY.md', 'DEPLOY.md', 'CHANGELOG.md'].map((f) => [f, f]);
    return { layout: esMonorepo() ? 'monorepo' : 'repo', destino: 'docs', items: [...serie, adr] };
  }
  const repos = subrepos();
  if (!repos.length) return null;
  return {
    layout: 'multi-repo',
    destino: 'doc',
    items: [['README.md', 'README.md'], adr, ...repos.map((r) => [`changelog/${r}.md`, 'CHANGELOG.md']), ['convenciones/.gitkeep', null], ['odd/.gitkeep', null]],
  };
}

const p = plan();
if (!p) {
  console.error('No hay layout: ni la carpeta es un repo git ni tiene subcarpetas que lo sean.');
  process.exit(1);
}

const base = path.join(raiz, p.destino);
const creados = [];
const existentes = [];
for (const [rel, plantilla] of p.items) {
  const destino = path.join(base, rel);
  const nombre = path.posix.join(p.destino, rel);
  if (fs.existsSync(destino)) { existentes.push(nombre); continue; }
  creados.push(nombre);
  if (dryRun) continue;
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, plantilla ? fs.readFileSync(path.join(PLANTILLAS, plantilla), 'utf8') : '', { flag: 'wx' });
}

const advertencias = [];
if (p.layout === 'multi-repo' && !esRepo(base)) {
  advertencias.push('doc/ no es un repo git: haga git init para versionarlo, o se pierde el historial de los docs.');
}

console.log(JSON.stringify({ layout: p.layout, destino: p.destino, dryRun, creados, existentes, advertencias }, null, 2));
