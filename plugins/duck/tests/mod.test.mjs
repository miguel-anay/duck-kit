// Run: node --experimental-strip-types --test plugins/duck/tests/mod.test.mjs
// Pure logic of the mod (no $): config parsing, keys, and the ticket.js -> ItemJira mapping.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { argvJira, claveValida, parsearConfig } from '../mod/nombres.ts'
import { construirHechosRepo, repoDeConfigGit, resolverRuta } from '../mod/hechos.ts'
import { fusionarConJira, textoDesdeTicket } from '../mod/historia.ts'

const github = (extra = {}) => parsearConfig(JSON.stringify({ tickets: { proveedor: 'GitHub' }, ...extra }))
const rama = (nombre, config) =>
  construirHechosRepo({ repo: '.', rama: nombre, estado: '', leftRight: '0 0', propios: '0' }, config).clave

test('github: provider is case-insensitive and keys are #N or owner/repo#N', () => {
  const config = github()
  assert.equal(config.proveedor, 'github')
  assert.equal(claveValida('#12', config), true)
  assert.equal(claveValida('acme/web.app#3', config), true)
  assert.equal(claveValida('ABC-12', config), false)
  assert.equal(claveValida('#x', config), false)
  assert.equal(claveValida('acme#3', config), false)
  assert.deepEqual(config.estados, { enProceso: 'In Progress', finalizado: 'Done', pendiente: 'Ready', backlog: 'Backlog' })
})

test('github: branch key comes from <prefix>/N-slug with prefijos and prefijosLegados', () => {
  const config = github({ git: { prefijosLegados: ['feat'] } })
  assert.equal(rama('feature/27-alta-de-clientes', config), '#27')
  assert.equal(rama('feat/5', config), '#5')
  assert.equal(rama('release/2026-10', config), null)
  assert.equal(rama('feature/ABC-12-x', config), null)
})

test('github: the branch key is the canonical owner/repo#N of the folder origin, like config.js', () => {
  const config = github()
  const clave = (origen) =>
    construirHechosRepo({ repo: 'web', rama: 'feature/27-x', estado: '', leftRight: '0 0', propios: '0', origen }, config).clave
  assert.equal(clave('acme/web'), 'acme/web#27')
  assert.equal(clave(''), '#27')
  assert.equal(repoDeConfigGit('[core]\n\tbare = false\n[remote "origin"]\n\turl = git@github.com:Acme/Web.App.git\n'), 'acme/web.app')
  assert.equal(repoDeConfigGit('[remote "origin"]\n\turl = https://github.com/acme/web\n[remote "fork"]\n\turl = x'), 'acme/web')
  assert.equal(repoDeConfigGit('[remote "origin"]\n\turl = https://gitlab.com/acme/web.git\n'), null)
  assert.equal(repoDeConfigGit('[remote "fork"]\n\turl = https://github.com/acme/web.git\n'), null)
  assert.equal(resolverRuta('/p/web', '../main/.git/worktrees/w\n'), '/p/web/../main/.git/worktrees/w')
  assert.equal(resolverRuta('/p/web', '/abs/.git'), '/abs/.git')
  assert.equal(resolverRuta('C:/p/web', 'D:\\r\\.git'), 'D:\\r\\.git')
  // Same text pattern as clavesEnTexto: no HTML entity, no key glued to a word.
  assert.equal(config.patronClave.test('a &#123; b'), false)
  assert.equal(config.patronClave.test('x#5'), false)
  assert.equal(config.patronClave.test('ver #5'), true)
})

test('github: Backlog category comes from github.estados.backlog, not a hardcoded name', () => {
  const config = github({ github: { estados: { backlog: 'Icebox' } } })
  assert.equal(github().estados.backlog, 'Backlog')
  const t = { clave: 'acme/docs#1', abierto: true, estado: 'Icebox', hijas: [{ clave: 'acme/docs#2', abierto: true, estado: 'Backlog' }] }
  const items = JSON.parse(textoDesdeTicket(JSON.stringify(t), 'acme/docs#1', config.estados))
  assert.deepEqual(items.map((i) => i.fields.status.statusCategory.key), ['new', 'indeterminate'])
})

const ticket = {
  clave: 'acme/docs#15',
  titulo: '[HU] Alta de clientes',
  tipo: 'Feature',
  abierto: true,
  estado: 'In Progress',
  asignados: ['ana', 'beto'],
  url: 'https://github.com/acme/docs/issues/15',
  padre: null,
  hijas: [
    { clave: 'acme/web#3', titulo: '[BE] Endpoint', abierto: true, estado: 'Ready', asignados: [] },
    { clave: 'acme/web#4', titulo: 'Cerrada sin estado', abierto: false, estado: null, asignados: ['ana'] },
    { clave: 'acme/docs#16', titulo: 'Abierta sin estado', abierto: true, estado: null, asignados: [] },
    { clave: 'acme/docs#17', titulo: 'En backlog', abierto: true, estado: 'Backlog', asignados: [] },
    { clave: 'acme/docs#18', titulo: 'Hecha', abierto: true, estado: 'Done', asignados: [] },
  ],
}

test('github: ticket.js ver JSON maps to acli ItemJira items with statusCategory', () => {
  const config = github()
  const items = JSON.parse(textoDesdeTicket(JSON.stringify(ticket), 'acme/docs#15', config.estados))
  assert.deepEqual(items[0], {
    key: 'acme/docs#15',
    fields: {
      summary: '[HU] Alta de clientes',
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      assignee: { displayName: 'ana' },
    },
  })
  assert.deepEqual(
    items.slice(1).map((i) => [i.key, i.fields.status.name, i.fields.status.statusCategory.key, i.fields.assignee]),
    [
      ['acme/web#3', 'Ready', 'new', null],
      ['acme/web#4', 'Done', 'done', { displayName: 'ana' }],
      ['acme/docs#16', 'Ready', 'new', null],
      ['acme/docs#17', 'Backlog', 'new', null],
      ['acme/docs#18', 'Done', 'done', null],
    ],
  )

  // A bare #N from older state keeps matching its story, and same-repo children stay bare.
  const viejo = JSON.parse(textoDesdeTicket(JSON.stringify(ticket), '#15', config.estados))
  assert.deepEqual(
    viejo.map((i) => i.key),
    ['#15', 'acme/web#3', 'acme/web#4', '#16', '#17', '#18'],
  )

  const actual = {
    actualizado: '2026-10-01T00:00:00.000Z',
    alertas: [],
    historias: [{ historia: { clave: 'acme/docs#15', titulo: 'viejo', estado: 'Ready' }, subtareas: [] }],
  }
  const fusion = fusionarConJira(actual, [textoDesdeTicket(JSON.stringify(ticket), 'acme/docs#15', config.estados)], 'ahora')
  assert.equal(fusion.historias[0].historia.estado, 'In Progress')
  assert.equal(fusion.historias[0].historia.categoria, 'indeterminate')
  assert.equal(fusion.historias[0].subtareas.find((s) => s.clave === 'acme/web#3').prefijo, '[BE]')
  assert.equal(fusion.historias[0].subtareas.length, 5)
})

test('github: a failed ticket.js call leaves the story as it was', () => {
  const config = github()
  const actual = {
    actualizado: '2026-10-01T00:00:00.000Z',
    alertas: [],
    historias: [{ historia: { clave: '#15', titulo: 't', estado: 'Ready' }, subtareas: [] }],
  }
  for (const salida of ['', 'ticket.js: boom', '{"mensaje":"Not Found"}', 'null']) {
    assert.equal(fusionarConJira(actual, [textoDesdeTicket(salida, '#15', config.estados)], 'ahora'), null)
  }
})

test('jira: default config, key pattern, branch key and acli argv are unchanged', () => {
  const config = parsearConfig('{}')
  assert.equal(config.proveedor, 'jira')
  assert.equal(config.patronClave.source, '[A-Z][A-Z0-9]+-\\d+')
  assert.equal(parsearConfig('{"jira":{"proyecto":"ABC"}}').patronClave.source, 'ABC-\\d+')
  assert.deepEqual(config.estados, { enProceso: 'En Proceso', finalizado: 'Finalizado', pendiente: 'Pendiente' })
  assert.equal(claveValida('ABC-12', config), true)
  assert.equal(claveValida('A-1', config), true)
  assert.equal(claveValida('#12', config), false)
  assert.equal(rama('feature/ABC-12-x', config), 'ABC-12')
  assert.equal(rama('feature/27-x', config), null)
  assert.deepEqual(argvJira('acli', 'ABC-1'), [
    'acli', 'jira', 'workitem', 'search', '--jql', 'key = ABC-1 OR parent = ABC-1',
    '--fields', 'key,summary,status,assignee', '--json', '--limit', '100',
  ])
})
