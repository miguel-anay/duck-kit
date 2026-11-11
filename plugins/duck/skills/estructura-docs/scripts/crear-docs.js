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

// Cada entrada: [ruta relativa al destino, plantilla | null]. Sin plantilla, el archivo queda vacio
// (un .gitkeep que versiona la carpeta).
// La misma serie en los tres layouts: cambia donde vive y la forma del changelog. Nombres y contenido en
// ingles, como el resto de los artefactos tecnicos.
const SERIE = [
  ...['README.md', 'PRD.md', 'TECH-DESIGN.md', 'SECURITY.md', 'DEPLOY.md'].map((f) => [f, f]),
  ['adr/0000-template.md', 'adr-template.md'],
  ['specs/README.md', 'specs-README.md'],
  ['templates/spec.md', 'spec.md'],
  ['templates/ai-agent.md', 'ai-agent.md'],
  ['manuals/README.md', 'manuals-README.md'],
  ['ai/README.md', 'ai-README.md'],
  ['ai/agents/.gitkeep', null],
  ['ai/install-agents.sh', 'install-agents.sh'],
  ['ai/install-agents.ps1', 'install-agents.ps1'],
  ['guides/README.md', 'guides-README.md'],
  ['conventions/README.md', 'conventions-README.md'],
  ['odd/.gitkeep', null],
];

// Nombres que la skill uso en espanol. Si el proyecto ya tiene el viejo, no se crea el nuevo al lado:
// se avisa el rename y lo decide la persona.
const LEGADOS = {
  guides: 'guias',
  manuals: 'manuales',
  conventions: 'convenciones',
  ai: 'ia',
  templates: 'plantillas',
  'repositories.md': 'repositorios.md',
  'adr/0000-template.md': 'adr/0000-plantilla.md',
};

function plan() {
  if (esRepo(raiz)) {
    return { layout: esMonorepo() ? 'monorepo' : 'repo', destino: 'docs', items: [...SERIE, ['CHANGELOG.md', 'CHANGELOG.md']] };
  }
  const repos = subrepos().filter((r) => r !== 'doc'); // doc/ es el repo de docs, no un repo de codigo
  if (!repos.length) return null;
  return {
    layout: 'multi-repo',
    destino: 'doc',
    items: [
      ...SERIE,
      ...repos.map((r) => [`changelog/${r}.md`, 'CHANGELOG.md']),
      ['repositories.md', 'repositories.md'],
    ],
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
const legados = new Set();
for (const [rel, plantilla] of p.items) {
  const destino = path.join(base, rel);
  const nombre = path.posix.join(p.destino, rel);
  const nuevo = Object.keys(LEGADOS).find((k) => rel === k || rel.startsWith(`${k}/`));
  if (nuevo && fs.existsSync(path.join(base, LEGADOS[nuevo]))) { legados.add(nuevo); continue; }
  if (fs.existsSync(destino)) { existentes.push(nombre); continue; }
  creados.push(nombre);
  if (dryRun) continue;
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  const contenido = plantilla ? fs.readFileSync(path.join(PLANTILLAS, plantilla), 'utf8') : '';
  fs.writeFileSync(destino, contenido, { flag: 'wx', mode: rel.endsWith('.sh') ? 0o755 : 0o644 });
}

const advertencias = [...legados].map((n) =>
  `${p.destino}/${LEGADOS[n]} tiene el nombre viejo: renombrelo a ${p.destino}/${n} (git mv) y vuelva a correr la skill.`);
if (p.layout === 'multi-repo' && !esRepo(base)) {
  advertencias.push('doc/ no es un repo git: haga git init para versionarlo, o se pierde el historial de los docs.');
}

console.log(JSON.stringify({ layout: p.layout, destino: p.destino, dryRun, creados, existentes, advertencias }, null, 2));
