// Dibujado del panel: una o varias historias con sus sub-tareas, repositorios y alertas, en ese
// orden. register.ts arma el Kit (los elementos resueltos por $.ui.resolve
// mas el ancho del cuerpo) y llama a panelPrincipal; todo el calculo de
// texto vive aca.
//
// CUIDADO: ningun identificador de este archivo puede llamarse como la factory del JSX
// classic (una sola letra) ni Fragment, ni siquiera un parametro. El JSX compila a llamadas
// a esa factory resueltas por nombre, asi que un parametro con ese nombre la tapa y el panel
// muere con "is not a function" -- paso exactamente eso con lineaRepo(kit, <esa letra>).
//
// Nota de estilo: la factory y Fragment (el runtime JSX classic) son globals del
// entorno del hooks module — este archivo no los declara ni los importa, y
// no lleva su propio pragma @jsx: el motor ya transpila contra esos globals.

import type { BoxProps, ElementConstructor, RenderElement, TextProps } from 'claude-code'
import type { Hechos, HechosRepo } from './hechos'
import { UMBRAL_SPIKE_HORAS, type ConfigDuck } from './nombres'
import { formatearTranscurrido, pasoElUmbral, ramaSpike, type EstadoSpike, type HechosSpikeRepo } from './spike'
import type { BloqueHistoria, CategoriaEstado, Historia, SubtareaHistoria, UbicacionGit } from './historia'

// Lo que vista.tsx necesita del elemento que $.ui.resolve(e) entrega para la
// superficie en curso, mas el ancho disponible del cuerpo del panel.
export type Kit = {
  ui: {
    Box: ElementConstructor<BoxProps>
    Text: ElementConstructor<TextProps>
  }
  columns: number
  // Los nombres de estado, el prefijo de bloqueo y la rama base salen de .claude/duck.json.
  config: ConfigDuck
}

const ANCHO_BARRA = 25
const ANCHO_TITULO_SUBTAREA = 52

// Colores: claves semanticas del tema de la persona (ThemeKey), que siguen su
// paleta y no se desentonan con claro/oscuro. Nada de hex literales.
//   verde = hecho / sano, amarillo = en curso / ojo, rojo = bloquea / atrasado,
//   inactive = tenue (pendiente, sin dato, libre), suggestion = en rama.
const VERDE = 'success'
const AMARILLO = 'warning'
const ROJO = 'error'
const TENUE = 'inactive'
const AZUL = 'suggestion'
// Violeta del spike: la clave del tema que usa el modo de auto-aceptar.
const VIOLETA = 'autoAccept'

// La cabecera de la historia usa el mismo semaforo que las sub-tareas, por
// categoria de estado de Jira: una sola leyenda para todo el panel. Se probaron
// los hex fijos de Jira y se descartaron: el azul contradecia el 🟡 de la
// leyenda y el fondo blanco no se distinguia con tema claro.
const FONDO_CABECERA: Record<CategoriaEstado, string> = {
  new: TENUE,
  indeterminate: AMARILLO,
  done: VERDE,
}

function colorEstado(kit: Kit, s: SubtareaHistoria): string {
  if (s.estado === kit.config.estados.finalizado) return VERDE
  if (s.prefijo === kit.config.prefijoBloqueo) return ROJO
  if (s.estado === kit.config.estados.enProceso) return AMARILLO
  return TENUE
}

// Iconos: los mismos que el texto de /duck:estado, para que la leyenda sea una
// sola. Acompanan al color, no lo reemplazan (sirven tambien sin color).
function iconoEstado(kit: Kit, s: SubtareaHistoria): string {
  if (s.estado === kit.config.estados.finalizado) return '🟢'
  if (s.prefijo === kit.config.prefijoBloqueo) return '🔴'
  if (s.estado === kit.config.estados.enProceso) return '🟡'
  return '⚪'
}

// 🌱 = brote: el trabajo todavia no tiene rama; 🌿 = ya crecio una rama.
const ICONO_UBICACION: Record<UbicacionGit, string> = {
  develop: '✅',
  rama: '🌿',
  'sin-rama': '🌱',
}

// Solo el primer nombre: la fila no tiene lugar para el nombre completo.
function primerNombre(nombre: string | undefined): string {
  const limpio = (nombre ?? '').trim()
  return limpio === '' ? '—' : limpio.split(/\s+/)[0]
}

function colorUbicacion(u: UbicacionGit): string {
  if (u === 'develop') return VERDE
  if (u === 'rama') return AZUL
  return TENUE
}

// Separador del estilo del mod oficial: una linea de guiones del ancho del
// panel, atenuada.
export function divider(kit: Kit): RenderElement {
  const { Text } = kit.ui
  return (
    <Text dimColor wrap="truncate-end">
      {'─'.repeat(Math.max(1, kit.columns))}
    </Text>
  )
}

function recortar(texto: string, maximo: number): string {
  if (texto.length <= maximo) return texto
  return `${texto.slice(0, Math.max(0, maximo - 1))}…`
}

function barra(finalizadas: number, total: number): string {
  if (total === 0) return '░'.repeat(ANCHO_BARRA)
  const llenas = Math.round((finalizadas / total) * ANCHO_BARRA)
  return '█'.repeat(llenas) + '░'.repeat(ANCHO_BARRA - llenas)
}

function lineaSubtarea(kit: Kit, s: SubtareaHistoria): RenderElement {
  const { Box, Text } = kit.ui
  const marca = s.esMio === true ? '▶ ' : '  '
  const responsable = primerNombre(s.responsable)

  // Solo iconos: la leyenda del pie dice que significa cada uno. Sin dato de
  // git, la celda queda en blanco: no se finge «sin rama».
  const iconoCodigo = s.git ? ICONO_UBICACION[s.git.ubicacion] : '  '

  return (
    <Box>
      <Text>
        {`${marca}${s.clave} ${s.prefijo.padEnd(10)} ${recortar(s.titulo, ANCHO_TITULO_SUBTAREA).padEnd(ANCHO_TITULO_SUBTAREA)}  `}
      </Text>
      <Text color={colorEstado(kit, s)}>{`${iconoEstado(kit, s)} `}</Text>
      <Text color={s.git ? colorUbicacion(s.git.ubicacion) : TENUE}>{`${iconoCodigo} `}</Text>
      <Text dimColor> {responsable}</Text>
    </Box>
  )
}

// Un bloque por historia: cabecera sombreada, barra de avance y sus
// sub-tareas activas; las finalizadas se colapsan en una sola linea.
function bloqueHistoria(kit: Kit, bloque: BloqueHistoria): RenderElement {
  const { Box, Text } = kit.ui
  const total = bloque.subtareas.length
  const activas = bloque.subtareas.filter((s) => s.estado !== kit.config.estados.finalizado)
  const finalizadas = total - activas.length
  // El unico porcentaje de este panel: sub-tareas finalizadas sobre el total
  // de la historia. Nunca un avance inventado de la sub-tarea en curso.
  const porcentaje = total === 0 ? 0 : Math.round((finalizadas / total) * 100)
  const categoria = bloque.historia.categoria
  // Sin categoria (archivo de historia anterior al campo) queda el fondo de antes.
  const fondo = categoria ? FONDO_CABECERA[categoria] : AZUL
  const completa = finalizadas === total && total > 0

  // La historia va sombreada para que no se confunda con las filas de
  // sub-tareas, que van sin fondo; el color es el de su estado en Jira.
  const cabecera = (
    <Text bold backgroundColor={fondo} color="inverseText" wrap="truncate-end">
      {' '}📘 {bloque.historia.clave} — {bloque.historia.titulo}{' '}
    </Text>
  )
  const progreso = (
    <Text>
      <Text color={VERDE}>{barra(finalizadas, total).replace(/░+$/, '')}</Text>
      <Text color={TENUE}>{barra(finalizadas, total).replace(/^█+/, '')}</Text>{' '}
      <Text color={completa ? VERDE : AMARILLO}>
        {completa ? '🟢' : '🟡'} {finalizadas}/{total} ({porcentaje}%)
      </Text>
    </Text>
  )

  // Todas finalizadas: la historia se reduce a una linea, cabecera y barra al 100 %.
  if (completa) {
    return (
      <Box>
        <Box flexShrink={1}>{cabecera}</Box>
        <Text> </Text>
        <Box flexShrink={0}>{progreso}</Box>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      {cabecera}
      {progreso}
      {activas.map((s) => lineaSubtarea(kit, s))}
      {finalizadas > 0 ? (
        <Text color={VERDE}>
          {'  '}🟢 … {finalizadas} finalizadas
        </Text>
      ) : null}
    </Box>
  )
}

function seccionHistorias(kit: Kit, historia: Historia | null): RenderElement {
  const { Box, Text } = kit.ui

  if (historia === null || historia.historias.length === 0) {
    return (
      <Box flexDirection="column">
        <Text dimColor>sin tarea confirmada en esta sesión — corré /duck:tomar (o /duck:estado)</Text>
      </Box>
    )
  }

  return <Box flexDirection="column">{historia.historias.map((b) => bloqueHistoria(kit, b))}</Box>
}

function lineaRepo(kit: Kit, hecho: HechosRepo): RenderElement {
  const { Box, Text } = kit.ui

  if (!hecho.disponible) {
    return (
      <Box>
        <Text dimColor>
          {hecho.repo.padEnd(10)}(sin datos)
        </Text>
      </Box>
    )
  }

  const limpieza = hecho.limpio ? 'limpio' : 'sucio'
  const vigencia = hecho.alDia === null ? 'sin dato' : hecho.alDia ? 'al día' : 'atrasado'
  const avance = hecho.libre ? 'libre' : `${hecho.commitsPropios} commits propios`
  const colorVigencia = hecho.alDia === null ? TENUE : hecho.alDia ? VERDE : ROJO

  return (
    <Box>
      <Text>{hecho.repo.padEnd(10)}</Text>
      <Text color={hecho.libre ? TENUE : undefined}>{hecho.rama.padEnd(44)}</Text>
      <Text color={hecho.limpio ? VERDE : AMARILLO}>
        {hecho.limpio ? '🟢' : '🟡'} {limpieza.padEnd(9)}
      </Text>
      <Text color={colorVigencia}>
        {hecho.alDia === null ? '⚪' : hecho.alDia ? '🟢' : '🔴'} {vigencia.padEnd(10)}
      </Text>
      <Text color={hecho.libre ? TENUE : undefined}>{avance}</Text>
    </Box>
  )
}

function seccionRepositorios(kit: Kit, hechos: Hechos): RenderElement {
  const { Box, Text } = kit.ui
  return (
    <Box flexDirection="column">
      <Text bold>Repositorios</Text>
      {hechos.repos.map((r) => lineaRepo(kit, r))}
    </Box>
  )
}

// Solo se dibuja si hay algo que decidir: la propia estado.md pide omitir la
// seccion entera cuando no hay alertas, no mostrarla vacia.
function seccionAlertas(kit: Kit, historia: Historia | null): RenderElement | null {
  const { Box, Text } = kit.ui
  const alertas = historia?.alertas ?? []
  if (alertas.length === 0) return null

  return (
    <Box flexDirection="column">
      <Text bold color={AMARILLO}>
        ⚠️ Alertas
      </Text>
      {alertas.map((a) => (
        <Text color={AMARILLO}>  ⚠️ {a}</Text>
      ))}
    </Box>
  )
}

function formatearFechaLocal(ms: number): string {
  return new Date(ms).toLocaleString()
}

function seccionPie(hechos: Hechos, historia: Historia | null, kit: Kit): RenderElement {
  const { Box, Text } = kit.ui
  const jira = historia?.actualizado ?? 'sin datos'
  return (
    <Box flexDirection="column">
      <Text>
        <Text dimColor>Jira: </Text>
        <Text color={VERDE}>{`🟢 ${kit.config.estados.finalizado}`}</Text>
        <Text dimColor> · </Text>
        <Text color={AMARILLO}>{`🟡 ${kit.config.estados.enProceso}`}</Text>
        <Text dimColor> · </Text>
        <Text color={TENUE}>{`⚪ ${kit.config.estados.pendiente}`}</Text>
        <Text dimColor> · </Text>
        <Text color={ROJO}>{`🔴 ${kit.config.prefijoBloqueo}`}</Text>
        <Text dimColor>   Código: </Text>
        <Text color={VERDE}>{`✅ en ${kit.config.ramaBase}`}</Text>
        <Text dimColor> · </Text>
        <Text color={AZUL}>🌿 en rama</Text>
        <Text dimColor> · </Text>
        <Text color={TENUE}>🌱 sin rama</Text>
      </Text>
      <Text dimColor>
        Jira: {jira} · Local: {formatearFechaLocal(hechos.obtenidoEn)}
      </Text>
    </Box>
  )
}

function lineaSpikeRepo(kit: Kit, spike: EstadoSpike, repo: HechosSpikeRepo): RenderElement {
  const { Box, Text } = kit.ui
  if (!repo.disponible) {
    return <Text dimColor>{`  ${repo.repo.padEnd(10)}(sin datos)`}</Text>
  }
  const commits = repo.commits === null ? 'sin rama spike' : `${repo.commits} commits`
  const deriva = repo.deriva === null ? `${kit.config.ramaBase} ?` : `${kit.config.ramaBase} +${repo.deriva}`
  const rebasar = repo.deriva !== null && repo.deriva > 0
  const rama = repo.enRamaSpike ? repo.rama : `⚠️ en ${repo.rama}, no ${ramaSpike(spike.tema)}`
  return (
    <Box>
      <Text>{`  ${repo.repo.padEnd(10)}`}</Text>
      <Text color={repo.enRamaSpike ? VIOLETA : ROJO}>{recortar(rama, 40).padEnd(repo.enRamaSpike ? 24 : 40)}</Text>
      <Text>{` ${commits.padEnd(14)}`}</Text>
      <Text color={repo.limpio ? VERDE : AMARILLO}>{(repo.limpio ? 'limpio' : 'sucio').padEnd(8)}</Text>
      <Text color={rebasar ? AMARILLO : TENUE}>{deriva}</Text>
      {rebasar ? <Text color={AMARILLO}> ⚠️ rebasar</Text> : null}
    </Box>
  )
}

// Solo en modo spike: tema, tiempo, un renglon por repo y el recordatorio del guardia.
function seccionSpike(kit: Kit, spike: EstadoSpike | null, hechos: HechosSpikeRepo[], ahora: number): RenderElement | null {
  if (spike === null) return null
  const { Box, Text } = kit.ui
  const transcurrido = ahora - spike.desde
  return (
    <Box flexDirection="column">
      <Text bold color={VIOLETA} wrap="truncate-end">
        {`🧪 SPIKE ${spike.tema} — hace ${formatearTranscurrido(transcurrido)}`}
      </Text>
      {pasoElUmbral(transcurrido) ? (
        <Text color={AMARILLO} wrap="truncate-end">
          {`⚠️ lleva más de ${UMBRAL_SPIKE_HORAS} horas: avisá al resto del equipo (en Jira no se ve que está en curso)`}
        </Text>
      ) : null}
      {hechos.map((repo) => lineaSpikeRepo(kit, spike, repo))}
      <Text dimColor wrap="truncate-end">{'  🔒 sin push · sin PR · sin Jira (guardia activo)'}</Text>
      <Text dimColor wrap="truncate-end">{'  Salir: «es lo que quiero» → /duck:tomar <clave> desde-spike · o descartarlo'}</Text>
      {divider(kit)}
    </Box>
  )
}

export function panelPrincipal(
  kit: Kit,
  hechos: Hechos,
  historia: Historia | null,
  spike: EstadoSpike | null = null,
  hechosSpike: HechosSpikeRepo[] = [],
  ahora: number = 0,
): RenderElement {
  const { Box } = kit.ui

  return (
    <Box flexDirection="column" paddingRight={1}>
      {seccionSpike(kit, spike, hechosSpike, ahora)}
      {seccionHistorias(kit, historia)}
      {divider(kit)}
      {seccionRepositorios(kit, hechos)}
      {seccionAlertas(kit, historia)}
      {divider(kit)}
      {seccionPie(hechos, historia, kit)}
    </Box>
  )
}
