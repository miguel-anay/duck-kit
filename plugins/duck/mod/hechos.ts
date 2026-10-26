// Interpretacion PURA de los hechos locales de un repo: rama, limpio, al
// dia, commits propios, clave de Jira.
//
// No llama a $ — un hooks module no puede pasar $ a traves de un import (el
// validador lo rechaza: "$ is followed only into a function declared in
// this same file, never across an import"). register.ts es quien corre
// $.process.run y le pasa las salidas ya leidas a construirHechos.

import type { ConfigDuck } from './nombres'

export type HechosRepo = {
  // Carpeta del repo dentro del proyecto (clave de git.repos en duck.json).
  repo: string
  // false cuando el repo no respondio (no existe, no es un git, timeout...).
  // El resto de los campos queda en su valor neutro y la vista lo muestra
  // como "sin datos" en vez de inventar algo.
  disponible: boolean
  rama: string
  clave: string | null
  limpio: boolean
  // null cuando no se pudo comparar contra origin/<base> (rama sin
  // upstream, repo no disponible): es un dato que falta, no un "no" disfrazado.
  alDia: boolean | null
  commitsPropios: number
  libre: boolean
}

export type Hechos = {
  repos: HechosRepo[]
  obtenidoEn: number
}

// Lo que register.ts lee de git para un repo, crudo, antes de interpretarlo.
export type SalidaGitRepo = {
  repo: string
  rama: string
  estado: string
  leftRight: string
  propios: string
}

// "0\t0" (o "0 0") significa al dia en los dos sentidos; cualquier otra cosa
// que no sean dos numeros es un dato que no se pudo leer, no un "atrasado".
function leerAlDia(salida: string): boolean | null {
  if (salida === '') return null
  const partes = salida.split(/\s+/).filter((parte) => parte !== '')
  if (partes.length !== 2) return null
  return partes[0] === '0' && partes[1] === '0'
}

export function construirHechosRepo(salida: SalidaGitRepo, config: ConfigDuck): HechosRepo {
  const disponible = salida.rama !== ''

  if (!disponible) {
    return {
      repo: salida.repo,
      disponible: false,
      rama: '',
      clave: null,
      limpio: false,
      alDia: null,
      commitsPropios: 0,
      libre: false,
    }
  }

  const claveMatch = salida.rama.match(config.patronClave)

  return {
    repo: salida.repo,
    disponible: true,
    rama: salida.rama,
    clave: claveMatch ? claveMatch[0] : null,
    limpio: salida.estado === '',
    alDia: leerAlDia(salida.leftRight),
    commitsPropios: Number(salida.propios) || 0,
    libre: salida.rama === config.ramaBase,
  }
}

export function construirHechos(salidas: SalidaGitRepo[], obtenidoEn: number, config: ConfigDuck): Hechos {
  return { repos: salidas.map((s) => construirHechosRepo(s, config)), obtenidoEn }
}
