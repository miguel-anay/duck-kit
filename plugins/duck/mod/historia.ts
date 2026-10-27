// Parseo PURO de <proyecto>/.claude/estado/sesiones/<session_id>-historia.json — lo que el panel dibuja de
// Jira. Lo escriben /duck:estado, el hook de transicion (estado-tarea.js) y el
// propio panel cuando consulta Jira con acli (ver fusionarConJira).
//
// No llama a $ — un hooks module no puede pasar $ a traves de un import.
// register.ts es quien corre $.fs.read y le pasa el texto a parsearHistoria.

// Donde esta el codigo de una sub-tarea: en una rama sin mergear, ya en
// la rama base (el valor es siempre 'develop', sea cual sea su nombre), o sin rama todavia. Lo calcula inventario.js --claves.
export type UbicacionGit = 'develop' | 'rama' | 'sin-rama'

export type GitSubtarea = {
  ubicacion: UbicacionGit
  repos: string[]
  ramas: string[]
}

export type SubtareaHistoria = {
  clave: string
  prefijo: string
  titulo: string
  estado: string
  responsable: string
  esMio?: boolean
  // Opcional: un archivo de historia anterior a este campo sigue siendo valido.
  git?: GitSubtarea
}

// La categoria de estado de Jira (statusCategory.key), no el nombre: el flujo
// de la historia tiene nombres propios ("Diseño/Desarrollo") y Jira la colorea
// por categoria.
export type CategoriaEstado = 'new' | 'indeterminate' | 'done'

// Una historia con sus sub-tareas: lo que el panel dibuja como un bloque.
export type BloqueHistoria = {
  // estado y categoria son opcionales: un archivo anterior sigue valido.
  historia: { clave: string; titulo: string; estado?: string; categoria?: CategoriaEstado }
  subtareas: SubtareaHistoria[]
}

// El archivo de la sesion: varias historias en orden, y las alertas una sola vez.
export type Historia = {
  actualizado: string
  historias: BloqueHistoria[]
  alertas: string[]
}

function esGit(valor: unknown): valor is GitSubtarea {
  if (typeof valor !== 'object' || valor === null) return false
  const v = valor as Record<string, unknown>
  return (
    (v.ubicacion === 'develop' || v.ubicacion === 'rama' || v.ubicacion === 'sin-rama') &&
    Array.isArray(v.repos) &&
    v.repos.every((x) => typeof x === 'string') &&
    Array.isArray(v.ramas) &&
    v.ramas.every((x) => typeof x === 'string')
  )
}

function esSubtarea(valor: unknown): valor is SubtareaHistoria {
  if (typeof valor !== 'object' || valor === null) return false
  const v = valor as Record<string, unknown>
  return (
    typeof v.clave === 'string' &&
    typeof v.prefijo === 'string' &&
    typeof v.titulo === 'string' &&
    typeof v.estado === 'string' &&
    typeof v.responsable === 'string' &&
    (v.esMio === undefined || typeof v.esMio === 'boolean') &&
    (v.git === undefined || esGit(v.git))
  )
}

function esBloqueValido(valor: unknown): valor is BloqueHistoria {
  if (typeof valor !== 'object' || valor === null) return false
  const v = valor as Record<string, unknown>

  const cabecera = v.historia
  if (typeof cabecera !== 'object' || cabecera === null) return false
  const hv = cabecera as Record<string, unknown>
  if (typeof hv.clave !== 'string' || typeof hv.titulo !== 'string') return false
  if (hv.estado !== undefined && typeof hv.estado !== 'string') return false
  if (
    hv.categoria !== undefined &&
    hv.categoria !== 'new' &&
    hv.categoria !== 'indeterminate' &&
    hv.categoria !== 'done'
  ) {
    return false
  }

  return Array.isArray(v.subtareas) && v.subtareas.every(esSubtarea)
}

// Acepta la forma nueva ({ historias: [...] }) y la anterior de una sola
// historia ({ historia, subtareas }), que se envuelve en un arreglo de un
// elemento: un archivo viejo sigue andando. La validacion es estricta por
// elemento: uno solo roto invalida el archivo entero.
function normalizar(valor: unknown): Historia | null {
  if (typeof valor !== 'object' || valor === null) return null
  const v = valor as Record<string, unknown>
  if (typeof v.actualizado !== 'string') return null
  if (!Array.isArray(v.alertas) || !v.alertas.every((a) => typeof a === 'string')) return null

  const historias: unknown[] = Array.isArray(v.historias)
    ? v.historias
    : [{ historia: v.historia, subtareas: v.subtareas }]
  if (!historias.every(esBloqueValido)) return null

  return { actualizado: v.actualizado, historias: historias as BloqueHistoria[], alertas: v.alertas }
}

// Lo que acli devuelve por item (`workitem search --json`), solo los campos
// que se piden.
type ItemJira = {
  key: string
  fields: {
    summary?: string
    status?: { name?: string; statusCategory?: { key?: string } }
    assignee?: { displayName?: string } | null
  }
}

function esItemJira(valor: unknown): valor is ItemJira {
  if (typeof valor !== 'object' || valor === null) return false
  const v = valor as Record<string, unknown>
  return typeof v.key === 'string' && typeof v.fields === 'object' && v.fields !== null
}

function categoriaDe(item: ItemJira): CategoriaEstado | undefined {
  const k = item.fields.status?.statusCategory?.key
  return k === 'new' || k === 'indeterminate' || k === 'done' ? k : undefined
}

// Lo que imprime `ticket.js ver` (proveedor github), solo lo que se usa.
type TicketGithub = { clave: string; titulo?: string; abierto?: boolean; estado?: string | null; asignados?: string[]; hijas?: unknown }

function esTicketGithub(valor: unknown): valor is TicketGithub {
  return typeof valor === 'object' && valor !== null && typeof (valor as Record<string, unknown>).clave === 'string'
}

// Pasa la salida de `ticket.js ver <claveHistoria>` a lo que devolveria acli (la historia y sus
// hijas como ItemJira), para que fusionarConJira no distinga proveedores. Sin opcion de estado
// en el Project, el estado sale de abierto/cerrado. La categoria: finalizado o cerrado -> done;
// pendiente o backlog (github.estados) -> new; el resto -> indeterminate. ticket.js da claves
// completas (owner/repo#N); si el archivo trae la historia como #N (repo sin origin de GitHub),
// la historia conserva esa clave y las hijas del mismo repo tambien quedan cortas. Salida rota
// o vacia -> '' (la historia queda como estaba).
export function textoDesdeTicket(
  salida: string,
  claveHistoria: string,
  estados: { finalizado: string; pendiente: string; backlog?: string },
): string {
  let datos: unknown
  try {
    datos = JSON.parse(salida)
  } catch {
    return ''
  }
  if (!esTicketGithub(datos)) return ''
  const repo = datos.clave.slice(0, datos.clave.indexOf('#'))
  const clave = (c: string) => (claveHistoria.startsWith('#') && c.startsWith(`${repo}#`) ? c.slice(repo.length) : c)
  const hijas = Array.isArray(datos.hijas) ? datos.hijas : []
  const item = (t: TicketGithub, key: string): ItemJira => {
    const cerrado = t.abierto === false
    const nombre = t.estado ?? (cerrado ? estados.finalizado : estados.pendiente)
    const categoria =
      cerrado || nombre === estados.finalizado ? 'done' : nombre === estados.pendiente || nombre === estados.backlog ? 'new' : 'indeterminate'
    return {
      key,
      fields: {
        summary: t.titulo,
        status: { name: nombre, statusCategory: { key: categoria } },
        assignee: t.asignados?.[0] ? { displayName: t.asignados[0] } : null,
      },
    }
  }
  return JSON.stringify([item(datos, claveHistoria), ...hijas.filter(esTicketGithub).map((h) => item(h, clave(h.clave)))])
}

// "[BE] Ampliar el esquema..." -> prefijo "[BE]", titulo "Ampliar el esquema...".
function partirResumen(resumen: string): { prefijo: string; titulo: string } {
  const m = resumen.match(/^\s*(\[[^\]]+\])\s*(.*)$/)
  return m ? { prefijo: m[1], titulo: m[2] } : { prefijo: '', titulo: resumen.trim() }
}

// Combina UN bloque con lo que acli devolvio para SU consulta
// (`key = H OR parent = H`): todos los items de la respuesta son de esta
// historia, asi que no hace falta el campo parent (acli no lo permite en
// --fields, verificado el 2026-10-13). Jira manda en el estado, el titulo, el
// responsable y en que sub-tareas existen; del archivo se conservan solo `git`
// y `esMio`, que Jira no conoce. Si la respuesta no parsea o no trae la
// historia misma, devuelve null: no se confia en datos a medias.
function fusionarBloque(actual: BloqueHistoria, texto: string): BloqueHistoria | null {
  let datos: unknown
  try {
    datos = JSON.parse(texto)
  } catch {
    return null
  }
  if (!Array.isArray(datos)) return null
  const items = datos.filter(esItemJira)
  const propia = items.find((i) => i.key === actual.historia.clave)
  if (!propia) return null
  const hijos = items.filter((i) => i.key !== actual.historia.clave)

  const previas = new Map(actual.subtareas.map((s) => [s.clave, s]))
  const nuevas: SubtareaHistoria[] = hijos.map((i) => {
    const previa = previas.get(i.key)
    const { prefijo, titulo } = partirResumen(i.fields.summary ?? '')
    const subtarea: SubtareaHistoria = {
      clave: i.key,
      prefijo: prefijo || previa?.prefijo || '',
      titulo: titulo || previa?.titulo || '',
      estado: i.fields.status?.name ?? previa?.estado ?? '',
      responsable: i.fields.assignee?.displayName ?? '',
    }
    if (previa?.esMio !== undefined) subtarea.esMio = previa.esMio
    if (previa?.git !== undefined) subtarea.git = previa.git
    return subtarea
  })

  // Mismo orden que el archivo para las que ya estaban; las nuevas, al final.
  const orden = new Map(actual.subtareas.map((s, i) => [s.clave, i]))
  nuevas.sort(
    (a, b) =>
      (orden.get(a.clave) ?? Number.MAX_SAFE_INTEGER) - (orden.get(b.clave) ?? Number.MAX_SAFE_INTEGER) ||
      a.clave.localeCompare(b.clave, undefined, { numeric: true }),
  )

  return {
    historia: {
      clave: actual.historia.clave,
      titulo: propia.fields.summary ?? actual.historia.titulo,
      estado: propia.fields.status?.name ?? actual.historia.estado,
      categoria: categoriaDe(propia) ?? actual.historia.categoria,
    },
    subtareas: nuevas,
  }
}

// Combina las historias del archivo con lo que Jira dice AHORA. `textos` trae,
// en el mismo orden que `actual.historias`, la salida de acli de la consulta de
// cada historia (o null si esa consulta fallo). Una historia cuya consulta
// fallo o no trajo su propia clave queda como estaba. Si ninguna se pudo
// refrescar devuelve null, para que el archivo no se reescriba en vano.
export function fusionarConJira(actual: Historia, textos: (string | null)[], ahoraIso: string): Historia | null {
  let refrescadas = 0
  const historias = actual.historias.map((b, i) => {
    const texto = textos[i]
    const fusion = texto == null || texto === '' ? null : fusionarBloque(b, texto)
    if (fusion === null) return b
    refrescadas++
    return fusion
  })
  if (refrescadas === 0) return null
  return { ...actual, actualizado: ahoraIso, historias }
}

// Si el texto no parsea o no tiene la forma esperada, el panel sigue con las
// secciones locales: la vista decide que mostrar en su lugar (nunca aca), y
// nunca se inventa una historia a partir de datos a medias.
export function parsearHistoria(texto: string): Historia | null {
  try {
    const datos: unknown = JSON.parse(texto)
    return normalizar(datos)
  } catch {
    return null
  }
}
