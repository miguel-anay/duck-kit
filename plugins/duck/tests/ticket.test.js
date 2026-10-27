// Run: node --test plugins/duck/tests/*.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { parsearClave, repoDeRemoto, resumir, elegirItem, elegirOpcion, ver, mover } = require('../scripts/ticket');

const CFG = {
  github: {
    proyecto: { owner: 'org', numero: 5 },
    campoEstado: 'Status',
    estados: { pendiente: 'Ready', enProceso: 'In Progress', finalizado: 'Done' },
  },
};

test('parsearClave resolves #N against the current repo and owner/repo#N as is', () => {
  assert.deepEqual(parsearClave('#12', 'org/api'), { owner: 'org', repo: 'api', numero: 12 });
  assert.deepEqual(parsearClave('12', 'org/api'), { owner: 'org', repo: 'api', numero: 12 });
  assert.deepEqual(parsearClave('org/docs#3', 'org/api'), { owner: 'org', repo: 'docs', numero: 3 });
  assert.throws(() => parsearClave('#12', null), /repositorio/);
  assert.throws(() => parsearClave('ABC-1', 'org/api'), /clave/);
});

test('repoDeRemoto reads https and ssh GitHub remotes', () => {
  assert.equal(repoDeRemoto('https://github.com/factufacil-pe/FacturadorPro9.git'), 'factufacil-pe/FacturadorPro9');
  assert.equal(repoDeRemoto('git@github.com:org/repo.git'), 'org/repo');
  assert.equal(repoDeRemoto('https://github.com/org/repo'), 'org/repo');
  assert.equal(repoDeRemoto('https://gitlab.com/org/repo.git'), null);
});

// A GraphQL issue as the query returns it.
function issue(extra = {}) {
  return {
    id: 'I_1',
    number: 15,
    title: 'Rollout',
    state: 'OPEN',
    url: 'https://github.com/org/docs/issues/15',
    repository: { nameWithOwner: 'org/docs' },
    issueType: { name: 'Feature' },
    assignees: { nodes: [{ login: 'ana' }] },
    parent: null,
    projectItems: {
      nodes: [
        {
          id: 'PVTI_old',
          project: { id: 'P_4', number: 4, owner: { login: 'org' }, field: null },
          fieldValueByName: { name: 'Done' },
        },
        {
          id: 'PVTI_1',
          project: {
            id: 'P_5',
            number: 5,
            owner: { login: 'org' },
            field: { id: 'F_1', options: [{ id: 'o1', name: 'Ready' }, { id: 'o2', name: 'In Progress' }, { id: 'o3', name: 'Done' }] },
          },
          fieldValueByName: { name: 'In Review' },
        },
      ],
    },
    subIssues: {
      nodes: [
        {
          number: 22,
          title: '[ANALISIS] Labels',
          state: 'CLOSED',
          repository: { nameWithOwner: 'org/api' },
          assignees: { nodes: [] },
          projectItems: { nodes: [{ project: { number: 5, owner: { login: 'org' } }, fieldValueByName: { name: 'Done' } }] },
        },
      ],
    },
    ...extra,
  };
}

test('elegirItem picks the configured project item, or the only one', () => {
  assert.equal(elegirItem(issue().projectItems.nodes, CFG).id, 'PVTI_1');
  const sinProyecto = { github: { ...CFG.github, proyecto: { owner: null, numero: null } } };
  assert.equal(elegirItem([issue().projectItems.nodes[1]], sinProyecto).id, 'PVTI_1');
  assert.equal(elegirItem(issue().projectItems.nodes, sinProyecto), null);
});

test('resumir returns full keys, project status, parent and sub-issues', () => {
  const r = resumir(issue({ parent: { number: 1, repository: { nameWithOwner: 'org/docs' } } }), CFG);
  assert.deepEqual(r, {
    clave: 'org/docs#15',
    titulo: 'Rollout',
    tipo: 'Feature',
    abierto: true,
    estado: 'In Review',
    asignados: ['ana'],
    url: 'https://github.com/org/docs/issues/15',
    padre: 'org/docs#1',
    hijas: [{ clave: 'org/api#22', titulo: '[ANALISIS] Labels', abierto: false, estado: 'Done', asignados: [] }],
  });
});

test('elegirOpcion accepts a flow key or a Status option name, case-insensitive', () => {
  const campo = issue().projectItems.nodes[1].project.field;
  assert.equal(elegirOpcion(campo, 'enProceso', CFG).id, 'o2');
  assert.equal(elegirOpcion(campo, 'in progress', CFG).id, 'o2');
  assert.equal(elegirOpcion(campo, 'Done', CFG).name, 'Done');
  assert.throws(() => elegirOpcion(campo, 'Shipped', CFG), /Ready, In Progress, Done/);
});

// gh stub: records calls, answers the query with `respuesta` and mutations with ok.
function ghFalso(respuesta) {
  const llamadas = [];
  const gh = (args) => {
    llamadas.push(args);
    const consulta = args.find((a) => a.startsWith('query='));
    if (consulta.includes('mutation')) return { data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: 'x' } } } };
    return respuesta;
  };
  return { gh, llamadas };
}

test('ver queries the issue and summarizes it', () => {
  const { gh, llamadas } = ghFalso({ data: { repository: { issue: issue() } } });
  assert.equal(ver('#15', { cfg: CFG, repoActual: 'org/docs', gh }).clave, 'org/docs#15');
  assert.ok(llamadas[0].includes('owner=org') && llamadas[0].includes('repo=docs') && llamadas[0].includes('n=15'));
  assert.ok(llamadas[0].includes('campo=Status'));
});

test('ver fails clearly when the issue does not exist', () => {
  const { gh } = ghFalso({ data: { repository: { issue: null } } });
  assert.throws(() => ver('#99', { cfg: CFG, repoActual: 'org/docs', gh }), /org\/docs#99/);
});

test('mover sets the Status option and prints a parseable line', () => {
  const { gh, llamadas } = ghFalso({ data: { repository: { issue: issue() } } });
  const linea = mover('org/docs#15', 'enProceso', { cfg: CFG, repoActual: null, gh });
  assert.equal(linea, 'Issue (org/docs#15) movido a (In Progress)');
  const mutacion = llamadas[1];
  for (const a of ['p=P_5', 'i=PVTI_1', 'f=F_1', 'o=o2']) assert.ok(mutacion.includes(a), a);
});

test('mover refuses an issue that is not in the project', () => {
  const { gh, llamadas } = ghFalso({ data: { repository: { issue: issue({ projectItems: { nodes: [] } }) } } });
  assert.throws(() => mover('org/docs#15', 'Done', { cfg: CFG, repoActual: null, gh }), /Project/);
  assert.equal(llamadas.length, 1);
});
