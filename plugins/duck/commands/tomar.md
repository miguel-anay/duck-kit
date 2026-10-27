---
description: Arranca una tarea de Jira o un issue de GitHub (modo tarea) o una historia entera (modo flujo) — lee el ticket, revisa el otro carril, crea la rama y la pone En Proceso
argument-hint: <CLAVE>-nnn | #N | owner/repo#N [slug]
allowed-tools: Bash, Read, Write, Glob, Grep, mcp__atlassian__searchJiraIssuesUsingJql, mcp__atlassian__transitionJiraIssue, mcp__atlassian__discover, mcp__atlassian__executeRead
---

Arranque de `$1`. Slug propuesto por quien llama: `$2` — puede venir vacío.

> **Configuración.** Los valores propios del proyecto salen de `.claude/duck.json`: `<CLAVE>` es la clave de Jira (`jira.proyecto`), `<base>` la rama base (`git.ramaBase`, por defecto `<base>`), los repositorios son las carpetas de `git.repos`, y los nombres de estado, los de `jira.estados`. Lo propio de cada proyecto —qué repositorio y prefijo corresponde a cada tipo de ticket, el orden de la serie, si exige plan o spec mergeada— está en el archivo `convenciones` de `duck.json`, si lo hay: leelo antes de empezar.

> **Con GitHub.** Si `duck.json` tiene `"tickets": {"proveedor": "github"}`, los pasos son los mismos pero cada operación de Jira se hace como dice la sección «Proveedor GitHub», al final.

Esto es **preparación, no implementación**. Al terminar, la rama existe y el ticket está `En Proceso`. No escribas código, no edites archivos del proyecto, no abras un PR.

Los pasos corren en orden. Cada uno tiene condiciones de parada: al primer tropiezo, **PARÁ y reportá** — no sigas al siguiente ni "arreglés sobre la marcha".

## 0. ¿Tarea o historia? Eso decide el modo

Los dos modos son los de `METODO.md` (tarea y flujo). **Lo decide el `issuetype` del ticket**, no quien llama:

| `issuetype` | Modo | Qué hace este comando |
|---|---|---|
| `Sub-task`, `Task`, `Bug` | **tarea** | Los pasos 1 a 8 de abajo, sobre `$1` |
| `Historia` | **flujo** | La sección «Modo flujo» de abajo, y después los pasos 1 a 8 sobre **la primera** sub-tarea de la serie |
| `Epic` u otro | — | **PARÁ**: una épica no se toma entera. Pedí una historia o una sub-tarea |

Pasar la clave de una historia **es** la activación explícita del modo flujo que exige `METODO.md` («se activa diciéndolo, nombrando el conjunto»): nombra la serie. Tomar una sub-tarea suelta vuelve al modo tarea.

## Modo flujo: cuando `$1` es una Historia

### F1. Leer la historia y sus sub-tareas

- `searchJiraIssuesUsingJql` con `jql: "key = $1"`, `view: "full"`: `summary`, `status`, `assignee`, `issuelinks`.
- `searchJiraIssuesUsingJql` con `jql: "parent = $1 ORDER BY key"`, `view: "full"`, `fields: ["summary","status","assignee","issuelinks"]`: todas las sub-tareas.

**PARÁ si:**

- la historia está `jira.estados.historiaCerrada` o no tiene sub-tareas — no hay serie que tomar; si faltan, eso es Fase 4 (proponerlas y crearlas con la skill de redacción del proyecto, si la tiene), no este comando;
- `odd.diseno` está definido y el plan de `$1` no existe en `origin/<base>` (`git -C <repo> ls-tree --name-only origin/<base> <carpeta>/`): sin plan no se implementa;
- las convenciones del proyecto exigen la spec mergeada antes de implementar, y el plan existe solo en una rama `spec/$1-*`, no en `<base>`;
- alguna sub-tarea está `En Proceso` en manos de **otra** persona.

### F2. Armar la serie

Entran las sub-tareas `Pendiente` asignadas a la persona que corre el comando (la cuenta de `atlassianUserInfo`), en este orden:

1. El orden por tipo que fijen las convenciones del proyecto (por ejemplo, backend antes que frontend: un cambio de contrato se despliega primero en la API).
2. Dentro de cada grupo, respetando dependencias: un enlace *is blocked by*, o el bloque «De qué depende» de la descripción, que nombra otra sub-tarea de la serie. Lo que no tiene dependencia va por número de clave.

**Quedan fuera, y se dicen con el motivo** — no se omiten en silencio:

- Las de `jira.prefijoAnalisis` y `jira.prefijoBloqueo`: las decide una persona, no se implementan.
- Las que exigen una operación remota que el modo flujo no cubre (desplegar a otro ambiente, tocar una base compartida): se reconocen en su descripción («De qué depende»).
- Las bloqueadas por un ticket **de fuera** de la serie que no esté `Finalizado`.
- Las asignadas a otra persona, y las que ya están `Finalizado`.
- Las que el plan de la historia dice que no pertenecen a ella.

### F3. Marcar el modo flujo y tomar la primera

1. Corré los **pasos 1 a 7** de abajo sobre la **primera** sub-tarea de la serie. Solo esa pasa a `En Proceso`: las demás pasan cuando se toma cada una, porque el otro carril mira Jira y un `En Proceso` adelantado le miente.
2. Pasá la **historia** `$1` a `jira.estados.historiaDesarrollo` si todavía no está ahí (`listJiraIssueTransitions` sobre la historia y la que aterriza en ese estado; el id se consulta, no se adivina).
3. Marcá el modo flujo para el sticker: el `PostToolUse` de la transición del paso 7 acaba de escribir el estado de esta sesión en `.claude/estado/sesiones/<session_id>.json`. Es el `.json` **más reciente** de esa carpeta que **no** termina en `-vista.json` ni en `-historia.json`: leelo, poné `"modo": "flujo"`, y guardalo sin tocar `tareas`.
4. En vez del reporte del paso 8, reportá:
   - `$1` — el `summary` de la historia, y que corre en **modo flujo**.
   - La serie, en orden, una línea por sub-tarea: clave, prefijo y título.
   - Lo que quedó fuera, con su motivo.
   - La primera tomada: rama, repositorio y commit de `<base>`, y la transición usada.
   - Lo que encontró el radar.

Terminá ahí. El flujo en sí —implementar, PR, merge y cierre de cada sub-tarea, encadenando con `git fetch` y rama nueva desde `<base>` al día— lo corre la sesión según `METODO.md`, y para al primer rojo. **El modo flujo termina con la serie**: al cerrar la última, devolvé `"modo": "tarea"` en el mismo archivo, y si de la historia solo quedan sub-tareas `[ANALISIS]` sin finalizar, pasá la historia a `jira.estados.historiaPruebas` (transición consultada, no adivinada). Con todo finalizado tampoco se cierra sola: `jira.estados.historiaCerrada` lo decide una persona.

## Salir de un spike: `/duck:tomar <clave> desde-spike`

Cuando `$2` es `desde-spike` (opcionalmente `flujo` en `$3`), `$1` es el ticket **ya creado** y se trae el código de una rama `spike/<tema>` (ver `/duck:spike`). Es la salida del «Modo spike» de `METODO.md`.

**PARÁ si:**

- el ticket no existe todavía: los tickets se redactan como borrador y se publican **con autorización de la persona**, antes de este comando. Este comando no los crea;
- la sesión no está en spike (`"modo": "spike"` en su estado) o `spike/<tema>` no existe en el repositorio que corresponde;
- el árbol tiene cambios sin commitear.

Corré los pasos 1 a 4 de abajo normalmente (leer el ticket, repositorio y prefijo, plan, radar). Después, en vez de los pasos 5 y 6:

```bash
git -C <repo> fetch origin --prune
git -C <repo> switch <base>
git -C <repo> merge --ff-only origin/<base>
git -C <repo> switch -c <prefijo>/$1-<slug>
git -C <repo> cherry-pick --no-commit origin/<base>..spike/<tema>
```

Salí del spike en el estado de la sesión (párrafo «Antes del paso 7», más abajo) y recién entonces un commit convencional **con la clave**: `git -C <repo> commit -m "feat($1): …"`.

**Por qué `cherry-pick --no-commit` y no `merge --squash`:** `guard-git.js` prohíbe todo `git merge` salvo `--ff-only origin/…`, y no se debilita. Además los commits del spike no llevan clave, y la regla exige que los de `feature|bugfix` sí: aplicar los cambios sin commitear y commitear una vez con la clave los reescribe sin necesitar `rebase -i`. Si hay un conflicto, `cherry-pick --abort` y PARÁ.

No hay nada que enmendar de lo compartido: el spike nunca se empujó, así que reescribir su historia es seguro. La rama `spike/<tema>` queda como respaldo hasta que la tarea esté mergeada; después se borra con `-d` si se deja (nunca `-D`; si se niega, que la borre la persona).

**Antes del paso 7**, en el estado de la sesión poné `"modo": "tarea"` (o `"flujo"` si la persona lo pidió, nombrando la serie) y **borrá la clave `spike`**: mientras siga en spike el guardia deniega la transición, el push y los commits con clave. Hacelo antes del commit con clave, que también lo bloquearía.

Después seguí con el paso 7 (transición a `En Proceso`: esa es la primera vez que Jira se entera) y el 8.

## 1. Leer el ticket

`searchJiraIssuesUsingJql` con `jql: "key = $1"` y `view: "full"` — `view` completo es lo único que trae `parent` e `issuelinks`. (En modo flujo, `$1` es aquí la sub-tarea elegida en F3, no la historia.)

No uses `getJiraIssue`: algunas organizaciones lo bloquean por política, y la JQL alcanza.

De la respuesta quedate con: `summary`, `issuetype`, `status`, `assignee`, `parent`, `issuelinks`.

**PARÁ si:**

- la clave no existe, o no es del proyecto de Jira configurado (`jira.proyecto`);
- el ticket ya está `Finalizado` — algo no cuadra, y crear una rama encima lo empeora;
- el `assignee` no es la persona que corre el comando (`atlassianUserInfo`). Puede ser deliberado, pero lo decide una persona, no vos;
- un `issuelink` de tipo *is blocked by* apunta a un ticket que **no** está `Finalizado`. Esa dependencia es información que alguien cargó a propósito: respetala.

## 2. Decidir repositorios y prefijo de rama

Del prefijo del `summary` y del `issuetype`, con la tabla de las convenciones del proyecto (tipo de ticket → repositorio y prefijo de rama). Sin convenciones: si `git.repos` tiene un solo repositorio, es ese; si tiene varios, preguntá. El prefijo es `bugfix/` para un Bug y `feature/` para lo demás.

**Una sub-tarea nombra un solo repositorio, y eso no se negocia.** Partir una historia en sub-tareas por repositorio (por ejemplo, una de backend y otra de frontend) existe justamente para que cada clave apunte a uno. Si el ticket es de backend y descubrís que el cambio necesita frontend, **PARÁ**: lo que falta es la otra sub-tarea, no una rama más con la misma clave. Un commit de frontend con clave de backend rompe la trazabilidad en silencio — nadie puede decir después qué sub-tarea entregó esa pantalla.

Lo de *«mismo nombre en cada repositorio que toque»* aplica cuando la clave es de una **historia o un Task** que de verdad cruza repositorios, no de una sub-tarea. En ese caso el orden es el de las convenciones del proyecto (típicamente backend → frontend).

**El slug.** Si `$2` vino, ese manda. Si no, derivalo del `summary` sin el prefijo entre corchetes: kebab-case, sin acentos, cuatro palabras como mucho. Si la clave cruza repositorios, el mismo slug en todos.

Nombre final: `<prefijo>/$1-<slug>`.

## 3. El plan de la historia

Si `odd.diseno` está definido, toda historia lleva plan en esa ruta (con `{historia}` reemplazado), y es **por historia, no por sub-tarea**. Si el ticket tiene `parent`, la clave del plan es la del padre. Sin `odd.diseno`, este paso no aplica.

Comprobá si el archivo existe. Si falta, **no lo crees**: avisá en el reporte que la historia no tiene plan y que eso es Fase 4 pendiente.

## 4. Radar del otro carril

Dos personas desarrollan en paralelo. Antes de crear nada, averiguá si este trabajo ya existe o está en curso.

```bash
git -C <repo> fetch origin --prune
git -C <repo> log origin/<base> --grep=$1 --oneline
```

En paralelo, una JQL por las sub-tareas hermanas:

```
parent = <clave-del-padre> AND updated >= -1d
```

**PARÁ si** algún commit de `origin/<base>` ya menciona `$1`, o si una sub-tarea hermana está `En Proceso` en manos de otra persona y pisa lo mismo. Reportá qué encontraste y esperá: encadenar sobre trabajo ajeno a medio hacer es la forma barata de romper dos tareas en vez de una.

**Clave reusada.** Además, buscá `$1` en todos los repositorios de `git.repos` y en todos los prefijos, no solo en el que corresponde a esta sub-tarea:

```bash
git -C <repo> branch -a --list "*$1*"   # uno por cada carpeta de git.repos
```

**Lo que distingue un reuso de un cambio legítimo es el nombre completo de la rama, no el repositorio:**

- **Mismo prefijo y mismo slug en varios repositorios: está bien.** Es lo que pide la convención para un cambio que toca más de uno — por ejemplo `feature/<CLAVE>-527-activar-valores` en `api/` y en `docs/`, porque la bitácora del diseño viaja con el código que la justifica.
- **Otro prefijo, u otro slug: PARÁ y reportá.** Ahí hay dos trabajos distintos bajo una sola clave, y la trazabilidad se rompe en silencio: después nadie puede decir qué entregó esa clave.

## 5. Base limpia y al día

Para cada repositorio que toque, en orden:

```bash
git -C <repo> status --porcelain
git -C <repo> switch <base>
git -C <repo> merge --ff-only origin/<base>
```

**PARÁ si** el árbol tiene cambios sin commitear, o si el `--ff-only` se niega: `<base>` local divergió, y eso se investiga antes de ramificar, no después.

## 6. Crear la rama

```bash
git -C <repo> switch -c <prefijo>/$1-<slug>
```

**Antes, verificá que no exista ya**, local ni remota: `git -C <repo> branch -a --list "*$1*"`. Si existe, no la recrees — reportá que ya estaba y en qué estado. Un `+` delante en `git branch` significa que está tomada por otro worktree; ahí tampoco toques nada.

## 7. Poner el ticket En Proceso

Lo mueve el agente solo, sin pedir permiso: es uno de los dos momentos que `METODO.md` autoriza («el estado en Jira sigue al trabajo»).

Pedí las transiciones reales del issue con `listJiraIssueTransitions` — si no la tenés como herramienta, `discover` con *list issue transitions* y después `executeRead`. Elegí la que **aterriza en `jira.estados.enProceso`** y usá su `id`.

**Nunca adivines el id.** Los conocidos están en `jira.transiciones.enProceso` de `duck.json`, pero sirven para reconocer la transición correcta, no para saltarse la consulta: los ids difieren entre tipos de issue.

Transicionar sí; escribir texto en Jira, no. Nada de comentarios ni de editar la descripción acá.

## 8. Reportar, y parar

Cinco líneas, no más:

- `$1` — el `summary`, sin el prefijo entre corchetes.
- Rama creada, en qué repositorios, y sobre qué commit de `<base>`.
- Estado en Jira: `En Proceso`, con el nombre de la transición que usaste.
- El plan: ruta del diseño, o el aviso de que falta.
- Lo que encontró el radar, aunque haya sido nada.

Terminá ahí. No empieces a implementar sin que te lo pidan.

## Proveedor GitHub

Con `"tickets": {"proveedor": "github"}` se sigue la convención de GitHub (la `gestion-github.md` del proyecto, si la hay), no una traducción de Jira. Los pasos de arriba valen con estas equivalencias; lo que no aparece acá queda igual. `ticket.js` es `node "${CLAUDE_PLUGIN_ROOT}/scripts/ticket.js"`.

**Antes de cada escritura, leé el estado actual.** `/tbd` mueve las mismas tarjetas: si el issue ya está donde va, no lo muevas otra vez. Este comando no crea ni cierra issues, ni toca el Project, etiquetas o campos.

| Paso | Con GitHub |
|---|---|
| Clave | `#N` (mismo repo) o `owner/repo#N`. duck la guarda como `owner/repo#N` en minúsculas. Sin prefijos tipo `EPIC-NNN` |
| 0. Modo | `ticket.js ver $1` → `tipo` e `hijas`. `Feature` o `Bug` **con** sub-issues → **flujo**; `Task`, o `Feature`/`Bug` sin sub-issues → **tarea**. Sin tipo u otro tipo: PARÁ y preguntá |
| 1 y F1. Leer | `ticket.js ver <clave>`: `titulo`, `tipo`, `abierto`, `estado` (opción del campo Status del Project), `asignados`, `padre`, `hijas` con su estado. Una llamada trae la HU y sus sub-issues. Quién corre el comando: `gh api user --jq .login`. Dependencias, si la org las usa: `gh api repos/<owner>/<repo>/issues/<N>/dependencies/blocked_by` |
| PARÁ si | `abierto: false` o estado `github.estados.finalizado`; no está asignado a quien corre; está en `github.estados.bloqueado`; lo bloquea un issue abierto. En flujo: la HU cerrada o sin sub-issues (crearlos es de `/tbd` o de una persona, con autorización) |
| F2. Serie | Sub-issues abiertos, asignados a quien corre, en `github.estados.pendiente` (o Backlog). No hay `[ANALISIS]` ni `[BLOQ]`: lo bloqueado es el estado `Blocked`, y queda fuera con el motivo de su último comentario |
| F3. HU | `ticket.js mover <HU> enProceso` si no está ahí. Al cerrar la serie: la HU pasa a `finalizado` **solo** con todos sus sub-issues cerrados (`ver <HU>`, `hijas[].abierto`). Cerrar el issue de la HU no lo hace el agente |
| 2. Repo y prefijo | El repo es el del issue (`owner/repo` → la carpeta de `git.repos` con ese origin). Rama `<prefijo>/N-<slug>`, solo el número: `fix/` para un `Bug`, `feat/` para lo demás (tienen que estar en `git.prefijos`). Una HU de varios repos vive en el repo de documentación: en cada repo de código se ramifica con el número de **su** sub-issue `Task`, no con el de la HU |
| 3. Plan | `odd.diseno` con `{historia}` = el número de la HU (`N`, sin `owner/repo#`). El *qué* está en el documento de feature que enlaza el bloque de referencia de la HU (`Change:`) |
| 4. Radar | `git -C <repo> log origin/<base> --oneline -E --grep="#N([^0-9]\|$)"`, `git -C <repo> branch -a --list "*/N-*"`, y las hermanas con `ticket.js ver <HU>` (una `In Progress` de otra persona es la misma parada) |
| 5 y 6. Base | `<base>` es la troncal (`main`, trunk-based) |
| 7. En Proceso | `ticket.js mover $1 enProceso`. Imprime `Issue (owner/repo#N) movido a (In Progress)`, que es lo que leen los hooks: no lo muevas con `gh project item-edit`. No hay ids de transición: la opción se fija directo. Mover sí; comentar, no |
| Spike | Rama `<prefijo>/N-<slug>`; el commit con la clave es `git commit -m "feat(<alcance>): …" -m "Refs #N"` |
| 8. Reporte | «Estado en el Project: In Progress», con la línea que imprimió `ticket.js mover` |

Lo que sigue después del arranque, también según la convención: el cuerpo de cada commit termina con `Refs #N`; el título del PR es un Conventional Commit terminado en el `(#N)` de la HU; `Closes #N` solo en el PR que termina el issue o su sub-issue, los parciales `Refs #N`. El resto (In Review, Done, Blocked, merge) está en la sección 8 de `METODO.md`.
