// Constantes compartidas del panel y la configuracion del proyecto.
// Centralizadas aca para que un cambio de convencion no obligue a tocar cada archivo.
//
// La configuracion sale de <proyecto>/.claude/duck.json (mismo archivo que leen los scripts de
// Node, pero con su propio lector: un mod no puede importar config.js, que usa modulos de
// Node). register.ts lee el texto con $.fs.read y se lo pasa a parsearConfig; aca no hay $.
// Mismos defectos que scripts/config.js — si se cambia uno, se cambia el otro.

// Id del pane y nombre del slash command. El id tambien es la clave bajo la
// que $.store guarda si el panel quedaba abierto entre sesiones.
export const ID_PANEL = 'duck-panel'
export const TITULO_PANEL = 'Duck — mesa de trabajo'
export const NOMBRE_COMANDO = 'duck'
export const DESCRIPCION_COMANDO = 'Panel de la mesa de trabajo Duck'

// Tres ritmos, todos solo mientras el panel esta abierto, cada uno segun lo
// que cuesta:
//   - <session_id>-historia.json cada 2 s: leer un archivo es barato, y asi una transicion
//     hecha aca (que el hook parchea) se ve casi al instante.
//   - git cada 30 s: cuatro comandos por repo.
//   - Jira cada 60 s: una consulta de acli tarda ~1,6 s y va a la red; es lo
//     que trae lo que otra persona mueve en el tablero.
export const TICK_MS = 2000
export const INTERVALO_GIT_MS = 30000
export const INTERVALO_JIRA_MS = 60000

// Donde vive la configuracion del proyecto, relativa a su raiz. Es tambien lo que marca la
// raiz: se sube desde el cwd hasta la carpeta que lo tiene. Sin el archivo, el mod no hace nada.
export const RUTA_CONFIG = '.claude/duck.json'

export type ConfigDuck = {
  // De donde salen los tickets (tickets.proveedor, sin distinguir mayusculas).
  proveedor: 'jira' | 'github'
  // null = cualquier clave tipo ABC-123
  proyecto: string | null
  // Busca una clave en un texto. Jira: ABC-123. GitHub: #N u owner/repo#N.
  patronClave: RegExp
  // La clave en un nombre de rama. Jira: la clave donde aparezca. GitHub: <prefijo>/N-slug,
  // con el numero en el grupo 1 (igual que claveDeRama de config.js).
  patronRama: RegExp
  ramaBase: string
  // Carpetas del proyecto que son repositorios, en el orden en que se muestran.
  repos: string[]
  // «acli» a secas, o una ruta (con %VARIABLES% de Windows) que se resuelve via PowerShell.
  acli: string
  // Los del proveedor activo: jira.estados o github.estados. backlog solo con github: la otra
  // opcion del Project que cuenta como «sin empezar».
  estados: { enProceso: string; finalizado: string; pendiente: string; backlog?: string }
  prefijoBloqueo: string
  // Rutas que no cuentan como «sucio» en el panel de spike.
  ignorarEnStatus: string[]
}

function escapar(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function texto(valor: unknown, porDefecto: string): string {
  return typeof valor === 'string' && valor !== '' ? valor : porDefecto
}

function objeto(valor: unknown): Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor) ? (valor as Record<string, unknown>) : {}
}

function lista(valor: unknown, porDefecto: string[]): string[] {
  return Array.isArray(valor) ? valor.filter((v): v is string => typeof v === 'string') : porDefecto
}

// Un duck.json ilegible o que no es un objeto devuelve null: se trata como «no hay» y el mod
// se queda quieto, igual que los hooks.
export function parsearConfig(contenido: string): ConfigDuck | null {
  let crudo: unknown
  try {
    crudo = JSON.parse(contenido.replace(/^﻿/, ''))
  } catch {
    return null
  }
  if (typeof crudo !== 'object' || crudo === null || Array.isArray(crudo)) return null

  const raiz = crudo as Record<string, unknown>
  const proveedor = String(objeto(raiz.tickets).proveedor).toLowerCase() === 'github' ? 'github' : 'jira'
  const jira = objeto(raiz.jira)
  const git = objeto(raiz.git)
  const estados = objeto(proveedor === 'github' ? objeto(raiz.github).estados : jira.estados)
  const defectos =
    proveedor === 'github'
      ? { enProceso: 'In Progress', finalizado: 'Done', pendiente: 'Ready' }
      : { enProceso: 'En Proceso', finalizado: 'Finalizado', pendiente: 'Pendiente' }

  const proyecto = typeof jira.proyecto === 'string' && jira.proyecto !== '' ? jira.proyecto : null
  const patronJira = new RegExp(proyecto ? `${escapar(proyecto)}-\\d+` : '[A-Z][A-Z0-9]+-\\d+')
  // Patrones y prefijos por defecto copiados de claveDeRama y clavesEnTexto de scripts/config.js
  // (la fuente de verdad): si se cambia alla, se cambia aca.
  const prefijos = [...lista(git.prefijos, ['feature', 'bugfix', 'hotfix', 'spec']), ...lista(git.prefijosLegados, [])]
  const carpetas = Object.keys(objeto(git.repos))
  const ignorar = Array.isArray(git.ignorarEnStatus)
    ? git.ignorarEnStatus.filter((r): r is string => typeof r === 'string')
    : []

  return {
    proveedor,
    proyecto,
    patronClave: proveedor === 'github' ? /(?<![\w&#/.-])(?:[\w.-]+\/[\w.-]+)?#\d+\b/ : patronJira,
    patronRama:
      proveedor === 'github' ? new RegExp(`^(?:${prefijos.map(escapar).join('|')})/(\\d+)(?:-|$)`) : patronJira,
    ramaBase: texto(git.ramaBase, 'develop'),
    repos: carpetas.length > 0 ? carpetas : ['.'],
    acli: texto(raiz.acli, 'acli'),
    estados: {
      enProceso: texto(estados.enProceso, defectos.enProceso),
      finalizado: texto(estados.finalizado, defectos.finalizado),
      pendiente: texto(estados.pendiente, defectos.pendiente),
      ...(proveedor === 'github' ? { backlog: texto(estados.backlog, 'Backlog') } : {}),
    },
    prefijoBloqueo: texto(jira.prefijoBloqueo, '[BLOQ]'),
    ignorarEnStatus: ignorar,
  }
}

// Si la clave de una historia se puede consultar: entra a un argv, se valida antes.
// Jira: la misma expresion de siempre. GitHub: #N u owner/repo#N, completa.
export function claveValida(clave: string, config: ConfigDuck): boolean {
  if (config.proveedor !== 'github') return /^[A-Z][A-Z0-9]*-\d+$/.test(clave)
  return new RegExp(`^${config.patronClave.source}$`).test(clave)
}

// La consulta de acli, a traves de PowerShell cuando la ruta lleva variables de Windows:
// la API de mods no expone el entorno y el PATH de Claude Code no ve una instalacion posterior
// a su arranque. Con «acli» a secas se invoca directo (Linux/macOS). La clave se valida antes de
// interpolarla. Una consulta POR historia: acli no admite el campo parent en --fields
// (verificado el 2026-10-13), asi que no se puede repartir una respuesta combinada.
// OutputEncoding en UTF-8 para que «Diseño/Desarrollo» no llegue roto.
export function argvJira(acli: string, claveHistoria: string): string[] {
  const jql = `key = ${claveHistoria} OR parent = ${claveHistoria}`
  if (acli === 'acli') {
    return ['acli', 'jira', 'workitem', 'search', '--jql', jql, '--fields', 'key,summary,status,assignee', '--json', '--limit', '100']
  }
  const exe = acli.replace(/'/g, "''")
  const script = [
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
    `$a = [Environment]::ExpandEnvironmentVariables('${exe}')`,
    "if (-not (Test-Path $a)) { $a = 'acli' }",
    `& $a jira workitem search --jql '${jql}' --fields 'key,summary,status,assignee' --json --limit 100`,
  ].join('; ')
  return ['powershell', '-NoProfile', '-NonInteractive', '-Command', script]
}

// Donde escribe /duck:estado la historia resuelta de Jira, relativa a la raiz
// del proyecto. Es el unico canal por el que este mod ve Jira, y es POR
// SESION: cada pestana ve solo la historia de lo que ella confirmo. Nunca se
// cae al historia.json global ni al archivo de otra sesion.
export function rutaHistoria(idSesion: string): string {
  return `.claude/estado/sesiones/${idSesion}-historia.json`
}

// Clave en $.store: si el panel quedaba abierto, session.start lo reabre.
export const CLAVE_STORE_ABIERTO = 'panelAbierto'

// Estado de la sesion (tareas, modo, spike): .claude/estado/sesiones/<id>.json,
// relativo a la raiz. Se lee con el ritmo de TICK_MS, como el de historia.
export function rutaSesion(idSesion: string): string {
  return `.claude/estado/sesiones/${idSesion}.json`
}

// Un spike que lleva mas de esto avisa: el otro carril no lo ve en Jira.
export const UMBRAL_SPIKE_HORAS = 4
