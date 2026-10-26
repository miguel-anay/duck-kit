// Interpretacion PURA del modo spike: estado de la sesion, tiempo transcurrido
// y hechos de git por repo. No llama a $; register.ts lee y pasa los textos.

import { UMBRAL_SPIKE_HORAS } from './nombres'

export type EstadoSpike = {
  tema: string
  repos: string[]
  desde: number // ms epoch
}

// Lo que register.ts lee de git para un repo del spike, crudo.
export type SalidaGitSpike = {
  repo: string
  rama: string
  estado: string
  commits: string
  deriva: string
}

export type HechosSpikeRepo = {
  repo: string
  disponible: boolean
  rama: string
  enRamaSpike: boolean
  // null = la rama spike/<tema> no existe o no se pudo comparar.
  commits: number | null
  limpio: boolean
  deriva: number | null
}

export function ramaSpike(tema: string): string {
  return `spike/${tema}`
}

// Solo si la sesion esta en modo spike y el estado es usable; cualquier otra cosa
// (archivo roto, tema raro, fecha invalida) devuelve null y no se dibuja nada.
// El tema entra a nombres de rama y comandos git: se valida antes. `reposDelProyecto` son las
// carpetas de duck.json: un repo que el proyecto no declara no entra.
export function parsearSpike(contenido: string, reposDelProyecto: string[]): EstadoSpike | null {
  try {
    const datos = JSON.parse(contenido) as { modo?: unknown; spike?: { tema?: unknown; repos?: unknown; desde?: unknown } }
    if (datos?.modo !== 'spike' || !datos.spike) return null
    const { tema, repos, desde } = datos.spike
    if (typeof tema !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._\/-]*$/.test(tema) || tema.includes('..')) return null
    if (!Array.isArray(repos)) return null
    const validos = repos.filter((r): r is string => typeof r === 'string' && reposDelProyecto.includes(r))
    const ms = typeof desde === 'string' ? Date.parse(desde) : NaN
    if (Number.isNaN(ms)) return null
    return { tema, repos: validos, desde: ms }
  } catch {
    return null
  }
}

// "3 h 20 min", "45 min", "2 h"; menos de un minuto o reloj adelantado: "0 min".
export function formatearTranscurrido(ms: number): string {
  const minutos = Math.max(0, Math.floor(ms / 60000))
  const horas = Math.floor(minutos / 60)
  const resto = minutos % 60
  if (horas === 0) return `${resto} min`
  return resto === 0 ? `${horas} h` : `${horas} h ${resto} min`
}

export function pasoElUmbral(ms: number): boolean {
  return ms > UMBRAL_SPIKE_HORAS * 3600000
}

function numero(salida: string): number | null {
  return /^\d+$/.test(salida) ? Number(salida) : null
}

// `ignorar`: rutas que no cuentan como «sucio» (config.ignorarEnStatus), p. ej. capturas generadas.
export function construirHechosSpike(s: SalidaGitSpike, tema: string, ignorar: string[]): HechosSpikeRepo {
  if (s.rama === '') {
    return { repo: s.repo, disponible: false, rama: '', enRamaSpike: false, commits: null, limpio: false, deriva: null }
  }
  const sucias = s.estado.split(/\r?\n/).filter((l) => l.trim() !== '' && !ignorar.some((r) => l.includes(r)))
  return {
    repo: s.repo,
    disponible: true,
    rama: s.rama,
    enRamaSpike: s.rama === ramaSpike(tema),
    commits: numero(s.commits),
    limpio: sucias.length === 0,
    deriva: numero(s.deriva),
  }
}
