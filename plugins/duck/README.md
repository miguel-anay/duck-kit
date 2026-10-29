# duck — el flujo de trabajo, portable

`duck` empaqueta un flujo de trabajo para Claude Code: **una rama por tarea de
Jira, una sola puerta hacia el remoto, un ticket que sigue al trabajo**. Son guardias de git, estado de
Jira por sesión, un panel de la mesa de trabajo, cuatro comandos, una skill y cuatro agentes.

El método está en [`METODO.md`](METODO.md). Este archivo dice qué trae el plugin, cómo se instala y cómo se
configura. **Se configura por proyecto** (`.claude/duck.json`); sin ese archivo, duck no existe: los hooks
salen sin ruido, el panel no se registra, el status line no imprime nada.

## Qué trae

| Pieza | Dónde | Para qué |
|---|---|---|
| `/duck:tomar <clave> [slug]` | `commands/tomar.md` | Arranca una tarea (modo tarea) o una historia (modo flujo): lee el ticket, mira el otro carril, crea la rama, pone el ticket en proceso. También `<clave> desde-spike`. |
| `/duck:estado` | `commands/estado.md` | Panel de solo lectura: historia en curso, sub-tareas, dónde está el código de cada una, repos, alertas. |
| `/duck:iniciar [clave]` | `commands/iniciar.md` | Configura duck en un proyecto: detecta, pregunta y genera `duck.json` y las convenciones. |
| `/duck:spike <tema> [repos]` | `commands/spike.md` | Arranca un spike: rama `spike/<tema>` local, sin Jira ni remoto. |
| Skill `duck:evidencia-de-pruebas` | `skills/evidencia-de-pruebas/` | El comentario de cierre de una sub-tarea (solo lo que otra persona debe saber o hacer). |
| Agentes `duck:analista`, `duck:escritor`, `duck:explorador`, `duck:verificador` | `agents/` | Ruta directa sin SDD: decidir, escribir, mapear, verificar. Leen las convenciones del proyecto (ver abajo). |
| Hook `guard-git` | `scripts/guard-git.js` | Deniega push/merge local a la rama base y `git branch -D`. |
| Hook `rama-reusada` | `scripts/rama-reusada.js` | Avisa al crear una rama con una clave ya usada bajo otro nombre. |
| Hook `push-sobre-develop-al-dia` | `scripts/push-sobre-develop-al-dia.js` | Bloquea el primer push si la base avanzó (rebase antes). Es independiente del nombre de la base. |
| Hook `guard-spike` | `scripts/guard-spike.js` | En spike: sin push, sin PR, sin escrituras en Jira ni en GitHub (issues, Project), sin clave en commits. |
| Hook `estado-tarea` | `scripts/estado-tarea.js` | Anota el estado real que dejó cada transición de Jira (para el sticker y el panel). |
| Hook `tarea-por-commit` | `scripts/tarea-por-commit.js` | Un commit en la rama de una tarea la anota en la sesión: retomar trabajo ya En Proceso también llega al panel. |
| Hook `panel-al-cerrar` | `scripts/panel-al-cerrar.js` | Pide el panel al agente cuando una tarea queda finalizada. |
| Hook `historia-sigue-subtareas` | `scripts/historia-sigue-subtareas.js` | Recuerda mover la historia con sus sub-tareas. |
| Hook `cierre-finalizado` | `scripts/cierre-finalizado.js` | Detecta el merge real de un PR y recuerda transicionar. |
| Hooks `titulo`, `sesion-inicio` | `scripts/titulo.js`, `scripts/sesion-inicio.js` | Título de la terminal con el ticket; qué quedó abierto al arrancar. Una sesión continuada (compactada o retomada) hereda las tareas, el modo y la historia de la anterior. |
| Status line | `scripts/sticker.js` | El sticker de la tarea de esta sesión. **No lo puede declarar un plugin**: lo instala `instalar.ps1`. |
| Mod `/duck` | `mod/` (cargado por `hooks/hooks.json`) | El panel lateral de la mesa de trabajo. |
| Utilidades | `scripts/inventario.js`, `scripts/mergear-pr.js`, `scripts/config.js` | Inventario local para `/duck:estado`; merge de PR por la API; el cargador único de `duck.json`. |

## Instalación

### Con el script

En una máquina nueva, desde el clon de `duck-kit`:

```powershell
pwsh -File instalar.ps1      # Windows
```

```bash
bash instalar.sh            # Linux y macOS
```

Es idempotente. Registra el marketplace `duck-kit`, instala `duck@duck-kit`, pone el `statusLine` en
`~/.claude/settings.json` (conservando el resto de las claves) y recuerda el paso por proyecto.

### A mano

```bash
claude plugin marketplace add <ruta-a-duck-kit>
claude plugin install duck@duck-kit
```

y en `~/.claude/settings.json` (el plugin no puede declarar el status line):

```json
"statusLine": {
  "type": "command",
  "command": "node \"<ruta-a-duck-kit>/plugins/duck/scripts/sticker.js\"",
  "refreshInterval": 10,
  "padding": 0
}
```

### Por proyecto

1. Abrir una sesión de Claude Code en el proyecto y correr **`/duck:iniciar`**: detecta los repos, la rama
   base, la organización y las transiciones de Jira (o el Project de GitHub); pregunta lo que no se puede detectar (tipos de ticket,
   plan, tests por alcance), de a una pregunta; muestra `.claude/duck.json` y `.claude/duck/convenciones.md`
   y los escribe solo con un sí. Sobre un proyecto ya configurado, muestra las diferencias y no pisa nada.
2. `/reload-plugins` (o una sesión nueva).

A mano: copiar [`plantillas/duck.ejemplo.json`](plantillas/duck.ejemplo.json) (Jira) o
[`plantillas/duck.github.ejemplo.json`](plantillas/duck.github.ejemplo.json) (GitHub Projects) a `.claude/duck.json`, ajustarlo
(referencia abajo), y agregar `.claude/estado/` al `.gitignore`.

## Referencia de `.claude/duck.json`

El archivo vive en el proyecto, y **no lleva secretos**. Se busca en `CLAUDE_PROJECT_DIR` (que Claude Code
da a todo hook); sin esa variable —un comando lanzado desde Bash, el status line— se sube desde el cwd. Si
`CLAUDE_PROJECT_DIR` está y no tiene `duck.json`, el proyecto no adoptó duck y no se sigue buscando. Un
`duck.json` que no parsea se trata como «no hay». Todo campo es opcional; lo que falte toma el valor de la
columna «Por defecto». Los objetos se mezclan en profundidad; los arreglos reemplazan.

### `tickets`

| Campo | Por defecto | Qué hace |
|---|---|---|
| `proveedor` | `jira` | De dónde salen los tickets: `jira` (MCP de Atlassian y `acli`) o `github` (Issues + Projects v2). Sin distinguir mayúsculas; cualquier otro valor es `jira`. Con `jira`, la sección `github` se ignora, y al revés. |

### `github`

Solo con `"proveedor": "github"`.

| Campo | Por defecto | Qué hace |
|---|---|---|
| `proyecto.owner` / `numero` | `null` / `null` | El Project v2 donde vive el estado (`mi-org`, `1`). |
| `campoEstado` | `Status` | Campo de selección única del Project que guarda el estado. |
| `historiaSigueSubtareas` | `true` | `false` apaga el recordatorio de mover la HU con sus sub-issues (el de `jira` no aplica con GitHub). |
| `estados.pendiente` / `enProceso` / `enRevision` / `finalizado` / `bloqueado` | `Ready` / `In Progress` / `In Review` / `Done` / `Blocked` | Qué opción de ese campo es cada momento del flujo. |
| `estados.backlog` | `Backlog` | Opción que el panel cuenta como «sin empezar», igual que `pendiente`. Un issue abierto sin opción en el Project se muestra sin estado; uno cerrado, como `finalizado`. |

Con GitHub, `git.prefijos` son los de `<prefijo>/N-slug` (`feat`, `fix`…) y `git.ramaBase` suele ser `main`.
Ejemplo completo: [`plantillas/duck.github.ejemplo.json`](plantillas/duck.github.ejemplo.json).

La convención es la de GitHub, no la de Jira:

- **Clave**: `#N` (issue del repo de la carpeta) u `owner/repo#N` (otro repo); `owner/repo` se guarda en minúsculas.
- **Rama**: `<prefijo>/N-slug`, por ejemplo `feat/12-login`.
- **Commit**: el cuerpo termina con `Refs #N`.
- **PR**: título Conventional Commit terminado en `(#N)`. `Closes #N` solo en el PR que termina el issue; los demás, `Refs #N`.
- **Estado**: se escribe directo en el campo del Project; no hay transiciones.

`scripts/ticket.js` es el adaptador (GraphQL por `gh api graphql`). Se corre desde la carpeta del
proyecto, porque ahí lee `.claude/duck.json` y el `origin` con que completa un `#N` suelto; el `#`
va entre comillas para que la shell no lo tome como comentario:

```bash
node "<plugin>/scripts/ticket.js" ver '#12'                      # JSON: título, tipo, estado, padre, sub-issues
node "<plugin>/scripts/ticket.js" mover 'mi-org/api#12' enProceso  # estado: clave de github.estados o nombre de la opción
```

`<plugin>` es la carpeta del plugin (en hooks y prompts, `${CLAUDE_PLUGIN_ROOT}`). Fuera de un repo con
`origin` de GitHub, usá siempre `owner/repo#N`.

Necesita `gh` con sesión y el scope `project`: `gh auth status` lo muestra; si falta, `gh auth refresh -s project`.

### `jira`

| Campo | Por defecto | Qué hace |
|---|---|---|
| `proyecto` | `null` | Clave del proyecto (`PROJ`). Define qué es una clave (`PROJ-123`) en ramas, commits y respuestas. `null` = cualquier `ABC-123`. También completa un número suelto en el nombre de la sesión (`618` → `PROJ-618`): sin proyecto, eso se desactiva. |
| `transiciones.enProceso` / `finalizado` / `pendiente` | `[]` | Ids de transición que llevan a cada estado. **Solo sirven para reconocer** una transición cuando la respuesta de Jira no dice el estado; nunca para saltarse `listJiraIssueTransitions`. |
| `nombresTransicion.enProceso` / `finalizado` / `pendiente` | `["empezar","en proceso"]` / `["finalizar"]` / `["backlog"]` | Fragmentos (sin distinguir mayúsculas) del nombre de la transición, mismo uso que los ids. |
| `estados.enProceso` / `finalizado` / `pendiente` | `En Proceso` / `Finalizado` / `Pendiente` | Nombres de los estados de **sub-tarea**, tal como los muestra Jira. Los usan el sticker, el título, el panel y los hooks. |
| `estados.historiaDesarrollo` | `Diseño/Desarrollo` | Estado de la **historia** mientras se desarrolla. |
| `estados.historiaPruebas` | `Pruebas` | Estado de la historia cuando solo queda análisis. |
| `estados.historiaOtros` | `["Go Live"]` | Otros estados de la historia que no deben leerse como estados de sub-tarea. |
| `estados.historiaCerrada` | `Historia Cerrada` | Estado final de la historia; **lo decide una persona**. |
| `historiaSigueSubtareas` | `true` | `false` apaga el recordatorio de mover la historia con sus sub-tareas. |
| `prefijoAnalisis` | `[ANALISIS]` | Prefijo del summary de las sub-tareas de análisis, que no cuentan para pasar la historia a pruebas. |
| `prefijoBloqueo` | `[BLOQ]` | Prefijo de las sub-tareas bloqueantes, que el panel pinta en rojo. |

### `git`

| Campo | Por defecto | Qué hace |
|---|---|---|
| `ramaBase` | `develop` | Rama de integración: contra ella se rebasa, se abre el PR y se mide «al día». |
| `prefijos` | `["feature","bugfix","hotfix","spec"]` | Prefijos de rama de trabajo. El hook de push solo mira estas ramas. |
| `prefijosLegados` | `[]` | Prefijos viejos que se reconocen al comparar nombres de rama (para que `docs/x` y `feature/x` sean el mismo slug), pero que ya no se piden. |
| `orgGithub` | `null` | Organización de GitHub. La usan `mergear-pr.js` y `cierre-finalizado.js`. |
| `repos` | `{}` | Mapa **carpeta → nombre del repo en GitHub**. Las carpetas son las que el panel, el inventario y los hooks recorren, en ese orden. Vacío = el proyecto es un solo repo (la carpeta es la raíz). |
| `ignorarEnStatus` | `[]` | Fragmentos de ruta que no cuentan como «sucio» en el panel de spike (capturas generadas, por ejemplo). |

### Raíz

| Campo | Por defecto | Qué hace |
|---|---|---|
| `convenciones` | `null` | Archivo, relativo a la raíz, con lo propio del proyecto que leen los agentes y `/duck:tomar`: ver «Adaptar duck a un proyecto». Los hooks no lo usan. |
| `acli` | `acli` | Cómo invocar el CLI de Atlassian para el refresco de Jira del panel. `acli` a secas se ejecuta directo; una ruta (admite `%VARIABLES%` de Windows) se resuelve con PowerShell, y si no existe se cae a `acli` del PATH. |

### `odd`

| Campo | Por defecto | Qué hace |
|---|---|---|
| `tareas` | `null` | Carpeta del documento de feature de ODD (gentle-ai), relativa a la raíz y **fuera de todo repo**: `odd/tasks`. Con valor, `sesion-inicio.js` le da a ODD esa ruta absoluta, `single-pr` y los agentes de duck. `null` = ODD corre tal cual. Ver `METODO.md` §7. |
| `diseno` | `null` | El plan versionado de la historia, con `{historia}` en el lugar de la clave: `docs/disenos/{historia}.md`. ODD no lo reemplaza: el hook pide escribir ahí también las decisiones que cambian el plan. |
| `versionado` | `false` | `true` cuando el proyecto lleva **un solo** documento de feature versionado en vez de bitácora local + diseño: `tareas` apunta a una carpeta del repo de docs (`doc/odd/tasks`), el nombre lo fijan las convenciones del proyecto (no la clave), al cerrar se archiva, y el hook no impone `single-pr`. Normalmente con `diseno: null`. Ver `METODO.md` §7. |

### Dónde guarda su estado

Todo lo que escriben los hooks va a `<proyecto>/.claude/estado/`:

- `sesiones/<session_id>.json` — tareas que la sesión confirmó con Jira, modo (`tarea`/`flujo`/`spike`).
- `sesiones/<session_id>-historia.json` — lo que el panel dibuja de Jira (lo escribe `/duck:estado`).
- `sesiones/<session_id>-vista.json` — cache del sticker para el título.
- `ultimo-contexto-stop.json` — volcado de diagnóstico del último `Stop`.

Es estado local por máquina: va al `.gitignore`. Las sesiones de más de 16 horas se barren solas.

## Dependencias de la máquina

| Requisito | Para qué | Notas |
|---|---|---|
| **Claude Code ≥ 2.1.287** | Plugins con `modules` en `hooks.json` (el panel) | Verificado con 2.1.295. Con una versión anterior los hooks sirven pero el panel no carga. |
| **node** | Todos los hooks y utilidades | Sin dependencias de npm; se probó con Node 24. |
| **git** | Guardias, inventario, panel | En el PATH. |
| **acli** + login | Refresco de Jira del panel cada 60 s | Opcional. Login: `acli jira auth login --web`, en una ventana aparte. Sin él, el panel solo ve lo que dejaron `/duck:estado` y los hooks. |
| **MCP de Atlassian** | `/duck:tomar`, `/duck:estado` y los hooks de Jira | Los hooks no lo usan (no pueden): le piden las llamadas al agente. |
| **Credencial de git para github.com** | `mergear-pr.js` | Se lee con `git credential fill`; no usa `gh`. |
| **gh** + scope `project` | `ticket.js` y el panel, con `"proveedor": "github"` | `gh auth refresh -s project` agrega el scope. |

Notas de Windows y de otras plataformas:

- El título de la terminal se escribe en `CONOUT$` en Windows (el stdout de un hook se lo queda Claude
  Code). En otros sistemas se intenta `/dev/tty`: **no está probado**, solo Windows lo está.
- El refresco de Jira del panel usa PowerShell cuando `acli` es una ruta con variables de Windows; en Linux o
  macOS, dejar `"acli": "acli"` y tenerlo en el PATH.
- `instalar.ps1` es PowerShell (5.1 o 7) y solo sirve en Windows: usa `USERPROFILE` y `TEMP`. En Linux y macOS, `instalar.sh`.

## Adaptar duck a un proyecto

El kit no sabe nada de ningún proyecto. Lo propio de cada uno vive **en ese proyecto**, no acá:

| Qué | Dónde | Ejemplo |
|---|---|---|
| Clave de Jira, transiciones, estados, rama base, repos | `.claude/duck.json` | `plantillas/duck.ejemplo.json` |
| Qué repositorio y prefijo corresponde a cada tipo de ticket, el orden de la serie, si exige plan o spec mergeada, mapa de carpetas, comandos de test por alcance, reglas de repositorio que no se negocian, trampas de «verde que no es verde», quién lee los comentarios de cierre | El archivo que nombre `convenciones` en `duck.json` | `plantillas/convenciones.ejemplo.md` |
| Skills propias (redactar tickets con los campos obligatorios de ese Jira, por ejemplo) | `.claude/skills/` del proyecto | — |

Los agentes leen el `CLAUDE.md` del repositorio y después ese archivo de convenciones: lo que diga ahí manda
sobre sus ejemplos. Sin convenciones, el método funciona igual con valores genéricos.

## Lo que no es portable, o no se probó

- El status line no se puede declarar desde un plugin: depende de `instalar.ps1`, `instalar.sh` o del paso manual.
- El título de la terminal fuera de Windows (`/dev/tty`) no está probado.
- El panel (`mod/`) no se puede probar de forma automatizada: se valida con `claude plugin validate`, pero su
  dibujado solo se comprueba abriéndolo en una sesión.
- `instalar.ps1` es PowerShell; se ejecutó en Windows el 2026-10-24.
- `instalar.sh` se probó en Git Bash sobre Windows (sintaxis, y el paso del statusLine contra un
  `settings.json` temporal: idempotente, conserva las demás claves, no toca un JSON roto). **No se probó en
  Ubuntu ni macOS.**
- Con GitHub, `ticket.js` lee los primeros 10 Projects de cada issue y los primeros 50 sub-issues (sin paginar),
  y el panel lo invoca con `node`, que tiene que estar en el PATH.
- Los nombres de estado se reconocen por el texto de la respuesta de Jira, con el nombre configurado
  (`En Proceso` también reconoce `EnProceso`). Un estado cuyo nombre contenga el de otro se podría confundir.

## Tests

Sin dependencias, con `node:test`:

```bash
node --test plugins/duck/tests/*.test.js                                  # scripts y hooks
node --experimental-strip-types --test plugins/duck/tests/mod.test.mjs    # mod (TypeScript)
```
