// Registro de eventos del panel Duck: cuando abrir, cuando dibujar, cuando
// refrescar.
//
// Todo llamado a $ vive en este archivo a proposito: el validador rechaza
// pasar $ a traves de un import ("$ is followed only into a function
// declared in this same file, never across an import"). hechos.ts y
// historia.ts son interpretacion pura de datos ya leidos; vista.tsx es
// dibujado puro. Aca solo se decide cuando leer y cuando llamar a cada una.
//
// Sin <proyecto>/.claude/duck.json el mod no hace nada: no registra el comando ni dibuja.

import type { EngineInterface, On, Timer } from 'claude-code'
import {
  CLAVE_STORE_ABIERTO,
  DESCRIPCION_COMANDO,
  ID_PANEL,
  INTERVALO_GIT_MS,
  INTERVALO_JIRA_MS,
  NOMBRE_COMANDO,
  RUTA_CONFIG,
  TICK_MS,
  argvJira,
  parsearConfig,
  rutaHistoria,
  rutaSesion,
  TITULO_PANEL,
  type ConfigDuck,
} from './nombres'
import { construirHechos, type Hechos, type SalidaGitRepo } from './hechos'
import { fusionarConJira, parsearHistoria, type Historia } from './historia'
import { construirHechosSpike, parsearSpike, ramaSpike, type EstadoSpike, type HechosSpikeRepo } from './spike'
import { panelPrincipal, type Kit } from './vista'

// Estado del modulo: un timer de refresco a la vez, el proyecto (raiz y
// configuracion, salen de buscarProyecto, nunca hardcodeados) y el ultimo snapshot dibujado.
// Un hot reload del modulo pierde esto — se reconstruye en el proximo
// session.start o command.run, aceptable para una vista de solo lectura.
type Proyecto = { raiz: string; config: ConfigDuck }

let temporizadorRefresco: Timer | null = null
let proyectoActual: Proyecto | null = null
let ultimosHechos: Hechos | null = null
let ultimaHistoria: Historia | null = null
let ultimoSpike: EstadoSpike | null = null
let ultimosHechosSpike: HechosSpikeRepo[] = []
let ticks = 0
let gitEnCurso = false
let jiraEnCurso = false

function detenerRefresco(): void {
  temporizadorRefresco?.cancel()
  temporizadorRefresco = null
}

// Normaliza $.process.run: la forma documentada es { exitCode, stdout,
// stderr } con stdout siempre string, pero igual nos defendemos de otra
// forma — un repo que no responde no debe tumbar el panel entero.
async function correr($: EngineInterface, argv: string[], cwd: string): Promise<string> {
  try {
    const resultado = await $.process.run(argv, { cwd })
    if (typeof resultado === 'string') {
      return resultado.trim()
    }
    if (resultado && typeof resultado === 'object') {
      const posible = resultado as { exitCode?: unknown; stdout?: unknown }
      if (typeof posible.exitCode === 'number' && posible.exitCode !== 0) {
        return ''
      }
      if (typeof posible.stdout === 'string') {
        return posible.stdout.trim()
      }
    }
    return ''
  } catch {
    return ''
  }
}

async function leerSalidaGit($: EngineInterface, proyecto: Proyecto, repo: string): Promise<SalidaGitRepo> {
  const cwd = `${proyecto.raiz}/${repo}`
  const base = proyecto.config.ramaBase
  const rama = await correr($, ['git', 'rev-parse', '--abbrev-ref', 'HEAD'], cwd)

  if (rama === '') {
    return { repo, rama: '', estado: '', leftRight: '', propios: '' }
  }

  const [estado, leftRight, propios] = await Promise.all([
    correr($, ['git', 'status', '--porcelain'], cwd),
    correr($, ['git', 'rev-list', '--left-right', '--count', `${base}...origin/${base}`], cwd),
    correr($, ['git', 'rev-list', '--count', `origin/${base}..HEAD`], cwd),
  ])

  return { repo, rama, estado, leftRight, propios }
}

// Hechos de git de los repos del spike: rama actual, commits propios del spike
// contra origin/<base>, estado y deriva de la base. Sin fetch, como el resto.
async function leerHechosSpike($: EngineInterface, proyecto: Proyecto, spike: EstadoSpike): Promise<HechosSpikeRepo[]> {
  const rama = ramaSpike(spike.tema)
  const base = proyecto.config.ramaBase
  const ignorar = proyecto.config.ignorarEnStatus
  return Promise.all(
    spike.repos.map(async (repo) => {
      const cwd = `${proyecto.raiz}/${repo}`
      const actual = await correr($, ['git', 'rev-parse', '--abbrev-ref', 'HEAD'], cwd)
      if (actual === '') {
        return construirHechosSpike({ repo, rama: '', estado: '', commits: '', deriva: '' }, spike.tema, ignorar)
      }
      const [estado, commits, deriva] = await Promise.all([
        correr($, ['git', 'status', '--porcelain'], cwd),
        correr($, ['git', 'rev-list', '--count', `origin/${base}..${rama}`], cwd),
        correr($, ['git', 'rev-list', '--count', `${rama}..origin/${base}`], cwd),
      ])
      return construirHechosSpike({ repo, rama: actual, estado, commits, deriva }, spike.tema, ignorar)
    }),
  )
}

async function leerHechos($: EngineInterface, proyecto: Proyecto): Promise<Hechos> {
  const salidas = await Promise.all(proyecto.config.repos.map((repo) => leerSalidaGit($, proyecto, repo)))
  const ahora = await $.clock.now()
  return construirHechos(salidas, ahora, proyecto.config)
}

// El id de la sesion se pregunta en cada lectura, no se cachea: un /clear
// cambia el id sin disparar session.start (ver SessionEndInput), y el panel
// tiene que seguir a la sesion vigente. Un id con caracteres raros no entra a
// una ruta. Sin id, la seccion de historia queda vacia.
async function idSesion($: EngineInterface): Promise<string | null> {
  try {
    const id = await $.session.id()
    return /^[A-Za-z0-9_-]+$/.test(id) ? id : null
  } catch {
    return null
  }
}

// Solo lee el archivo de SU sesion: si no existe, es que esta sesion no
// confirmo ninguna tarea, y la seccion sale vacia.
async function leerHistoriaDesdeArchivo($: EngineInterface, raiz: string, id: string | null): Promise<Historia | null> {
  if (id === null) return null
  try {
    const texto = await $.fs.read(`${raiz}/${rutaHistoria(id)}`)
    return parsearHistoria(texto)
  } catch {
    return null
  }
}

// Cada refresco dice si algo cambio respecto de lo ya dibujado, para no
// invalidar el render cuando no hace falta.
async function refrescarHistoria($: EngineInterface, proyecto: Proyecto): Promise<boolean> {
  const historia = await leerHistoriaDesdeArchivo($, proyecto.raiz, await idSesion($))
  const cambio = JSON.stringify(historia) !== JSON.stringify(ultimaHistoria)
  ultimaHistoria = historia
  return cambio
}

async function refrescarHechos($: EngineInterface, proyecto: Proyecto): Promise<boolean> {
  const hechos = await leerHechos($, proyecto)
  const spikes = ultimoSpike ? await leerHechosSpike($, proyecto, ultimoSpike) : []
  const cambio =
    JSON.stringify(hechos) !== JSON.stringify(ultimosHechos) || JSON.stringify(spikes) !== JSON.stringify(ultimosHechosSpike)
  ultimosHechos = hechos
  ultimosHechosSpike = spikes
  return cambio
}

// El estado de la sesion (modo spike) se relee con el mismo ritmo barato que la
// historia. Un archivo ausente o roto es "sin spike". Si el spike aparece,
// cambia o termina, los hechos de git se refrescan ya, sin esperar los 30 s.
async function refrescarSpike($: EngineInterface, proyecto: Proyecto): Promise<boolean> {
  const id = await idSesion($)
  let spike: EstadoSpike | null = null
  if (id !== null) {
    try {
      spike = parsearSpike(await $.fs.read(`${proyecto.raiz}/${rutaSesion(id)}`), proyecto.config.repos)
    } catch {
      spike = null
    }
  }
  const cambio = JSON.stringify(spike) !== JSON.stringify(ultimoSpike)
  ultimoSpike = spike
  if (!cambio) return false
  ultimosHechosSpike = spike === null ? [] : await leerHechosSpike($, proyecto, spike)
  return true
}

async function refrescar($: EngineInterface, proyecto: Proyecto): Promise<boolean> {
  const [cambioHechos, cambioHistoria, cambioSpike] = await Promise.all([
    refrescarHechos($, proyecto),
    refrescarHistoria($, proyecto),
    refrescarSpike($, proyecto),
  ])
  return cambioHechos || cambioHistoria || cambioSpike
}

// Pregunta a Jira, una consulta por historia, por las historias del archivo y sus sub-tareas, y deja el
// resultado en el <session_id>-historia.json de ESTA sesion: asi el archivo
// sigue siendo la unica fuente que se dibuja, y el hook de transicion parchea
// lo mismo que el panel lee. Sin acli, sin sesion o sin red, la consulta sale
// vacia y el archivo no se toca.
async function consultarJira($: EngineInterface, proyecto: Proyecto): Promise<boolean> {
  const id = await idSesion($)
  if (id === null) return false
  const actual = await leerHistoriaDesdeArchivo($, proyecto.raiz, id)
  if (actual === null || actual.historias.length === 0) return false
  // Una consulta por historia, en paralelo; correr() devuelve '' si una falla,
  // y esa historia queda como estaba. Una clave invalida no se consulta.
  const textos = await Promise.all(
    actual.historias.map((b) =>
      /^[A-Z][A-Z0-9]*-\d+$/.test(b.historia.clave)
        ? correr($, argvJira(proyecto.config.acli, b.historia.clave), proyecto.raiz)
        : Promise.resolve(''),
    ),
  )
  const ahora = new Date(await $.clock.now()).toISOString()
  const fusion = fusionarConJira(actual, textos, ahora)
  if (fusion === null) return false
  await $.fs.write(`${proyecto.raiz}/${rutaHistoria(id)}`, JSON.stringify(fusion, null, 2) + '\n')
  ultimaHistoria = fusion
  return true
}

// Un solo temporizador de TICK_MS reparte los tres ritmos de nombres.ts.
// git y Jira corren sin esperarlos, con su propia bandera, para que una
// consulta lenta no frene la relectura del archivo ni se apile sobre si misma.
function iniciarRefresco($: EngineInterface): void {
  detenerRefresco()
  ticks = 0
  temporizadorRefresco = $.clock.every(TICK_MS, async () => {
    if (proyectoActual === null) return
    const proyecto = proyectoActual
    const tick = ticks++

    if (tick % (INTERVALO_JIRA_MS / TICK_MS) === 0 && !jiraEnCurso) {
      jiraEnCurso = true
      consultarJira($, proyecto)
        .then((cambio) => cambio && $.ui.invalidate('ui.render'))
        .catch(() => undefined)
        .finally(() => (jiraEnCurso = false))
    }
    if (tick % (INTERVALO_GIT_MS / TICK_MS) === 0 && !gitEnCurso) {
      gitEnCurso = true
      refrescarHechos($, proyecto)
        .then((cambio) => cambio && $.ui.invalidate('ui.render'))
        .catch(() => undefined)
        .finally(() => (gitEnCurso = false))
    }
    const [cambioHistoria, cambioSpike] = await Promise.all([refrescarHistoria($, proyecto), refrescarSpike($, proyecto)])
    if (cambioHistoria || cambioSpike) $.ui.invalidate('ui.render')
  })
}

// El cwd de la sesion NO es la raiz del proyecto: el agente hace `cd` a una subcarpeta, y si el
// mod se recarga en ese momento session.start llega con esa carpeta. Con eso el panel buscaba el
// archivo de historia donde no existe y no dibujaba nada (visto 2026-10-13). Se sube desde el cwd
// hasta la carpeta que tiene .claude/duck.json, que es la raiz del proyecto. Si ese archivo existe
// pero no se puede leer, el proyecto se trata como «sin duck».
async function subirHastaConfig($: EngineInterface, desde: string): Promise<Proyecto | null> {
  let dir = desde.replace(/[\\/]+$/, '')
  for (let i = 0; i < 12; i++) {
    let texto: string | null = null
    try {
      texto = await $.fs.read(`${dir}/${RUTA_CONFIG}`)
    } catch {
      texto = null
    }
    if (texto !== null) {
      const config = parsearConfig(texto)
      return config === null ? null : { raiz: dir, config }
    }
    const padre = dir.replace(/[\\/][^\\/]+$/, '')
    if (padre === dir || padre === '') break
    dir = padre
  }
  return null
}

// Primero desde el cwd; si no aparece (la sesion se movio con /cd), desde la raiz de la sesion.
async function buscarProyecto($: EngineInterface, cwd: string): Promise<Proyecto | null> {
  const delCwd = await subirHastaConfig($, cwd)
  if (delCwd !== null) return delCwd
  try {
    return await subirHastaConfig($, await $.session.root())
  } catch {
    return null
  }
}

async function proyectoDe($: EngineInterface): Promise<Proyecto | null> {
  if (proyectoActual !== null) return proyectoActual
  proyectoActual = await buscarProyecto($, await $.session.cwd())
  return proyectoActual
}

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    proyectoActual = await buscarProyecto($, e.cwd)

    // Sin .claude/duck.json el proyecto no adopto duck: ni comando ni panel.
    if (proyectoActual === null) {
      return next(e)
    }

    // El nombre puede estar tomado por otro mod; eso no debe romper la sesion.
    try {
      await $.command.register({ name: NOMBRE_COMANDO, description: DESCRIPCION_COMANDO })
    } catch (error) {
      $.ui.log(`duck-panel: no se pudo registrar /${NOMBRE_COMANDO} — ${String(error)}`, { to: 'debug' })
    }

    const quedabaAbierto = await $.store.get(CLAVE_STORE_ABIERTO)
    if (quedabaAbierto === true) {
      await refrescar($, proyectoActual)
      const abierto = await $.ui.open({ id: ID_PANEL, title: TITULO_PANEL })
      if (abierto.isPlaced) {
        iniciarRefresco($)
      }
    }

    return next(e)
  })

  on('command.run', { command: NOMBRE_COMANDO }, async ($, _e, _next) => {
    const panes = await $.ui.panes()
    const yaAbierto = panes.some((p) => p.id === ID_PANEL)

    if (yaAbierto) {
      detenerRefresco()
      await $.ui.close({ id: ID_PANEL })
      await $.store.set(CLAVE_STORE_ABIERTO, false)
      return { text: 'panel Duck cerrado' }
    }

    const proyecto = await proyectoDe($)
    if (proyecto === null) {
      return { text: 'panel Duck: este proyecto no tiene .claude/duck.json (ver ejemplos/ del plugin duck)' }
    }
    await refrescar($, proyecto)

    const abierto = await $.ui.open({ id: ID_PANEL, title: TITULO_PANEL })
    if (!abierto.isPlaced) {
      await $.ui.close({ id: ID_PANEL })
      return { text: `la terminal es muy angosta para el panel Duck (${abierto.reason})` }
    }

    await $.store.set(CLAVE_STORE_ABIERTO, true)
    iniciarRefresco($)

    return { text: 'panel Duck abierto' }
  }).catch(($, _e, next) =>
    next.called ? next(_e) : { text: 'panel Duck: fallo inesperado — probá /duck de nuevo' },
  )

  on('ui.render', { component: 'Pane' }, ($, e, next) => {
    if (e.requestId !== ID_PANEL || proyectoActual === null) {
      return next(e)
    }

    // No hay forma automatizada de probar el dibujado: un fallo aca tiene
    // que quedar a la vista en el log, no tumbar la sesion.
    try {
      const resueltos = $.ui.resolve(e)
      const kit: Kit = {
        ui: { Box: resueltos.Box, Text: resueltos.Text },
        columns: e.props.bodyColumns,
        config: proyectoActual.config,
      }
      const hechos = ultimosHechos ?? { repos: [], obtenidoEn: Date.now() }
      return panelPrincipal(kit, hechos, ultimaHistoria, ultimoSpike, ultimosHechosSpike, Date.now())
    } catch (error) {
      $.ui.log(`duck-panel: fallo el dibujado — ${String(error)}`)
      return next(e)
    }
  })

  // Si $.store.set falla, el .catch de abajo igual deja cerrar el pane: un
  // error de guardado no debe dejarlo trabado abierto.
  on('ui.close', { id: ID_PANEL }, async ($, e, next) => {
    detenerRefresco()
    await $.store.set(CLAVE_STORE_ABIERTO, false)
    return next(e)
  }).catch(($, e, next) => next(e))
}
