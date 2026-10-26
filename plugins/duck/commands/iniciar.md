---
description: Configura duck en este proyecto — detecta repos, rama base y Jira, pregunta lo propio del proyecto, y genera .claude/duck.json y su archivo de convenciones
argument-hint: "[clave-de-jira]"
allowed-tools: Bash, Read, Write, Glob, Grep, mcp__atlassian__searchJiraIssuesUsingJql, mcp__atlassian__getVisibleJiraProjects, mcp__atlassian__discover, mcp__atlassian__executeRead
---

Configuración de duck para el proyecto de esta sesión. Clave de Jira propuesta por quien llama: `$ARGUMENTS` (puede venir vacía).

Al terminar existen dos archivos en la raíz del proyecto (el directorio de esta sesión):

- `.claude/duck.json` — lo que leen los hooks, el panel y los comandos.
- `.claude/duck/convenciones.md` — lo propio del proyecto que leen los agentes y `/duck:tomar`.

Las plantillas son `${CLAUDE_PLUGIN_ROOT}/plantillas/duck.ejemplo.json` y `${CLAUDE_PLUGIN_ROOT}/plantillas/convenciones.ejemplo.md`. La referencia de cada campo está en `${CLAUDE_PLUGIN_ROOT}/README.md`, sección «Referencia de `.claude/duck.json`». Leé las tres cosas antes de empezar.

**Esto es configuración, no trabajo.** No crees ramas, no transiciones, no escribas en Jira ni en ningún repositorio. Lo único que se escribe son esos dos archivos y, si hace falta, una línea en un `.gitignore` (paso 6), y todo **después** de mostrarlo.

## 0. ¿Ya está configurado?

Si `.claude/duck.json` ya existe, **no lo pises**. Leelo, hacé igual los pasos 1 y 2, y en el paso 5 mostrá solo las diferencias entre lo que hay y lo que detectaste, campo por campo. Se escribe únicamente lo que la persona apruebe. Lo mismo con el archivo de convenciones (`convenciones` de `duck.json`, o `.claude/duck/convenciones.md`).

## 1. Detectar lo de git — sin preguntar

Desde la raíz:

```bash
git rev-parse --show-toplevel 2>/dev/null          # ¿la raíz misma es un repo?
for d in */; do git -C "$d" rev-parse --is-inside-work-tree >/dev/null 2>&1 && echo "$d"; done; true
```

- **Repos.** Si la raíz es un repo, el proyecto es un solo repo: `git.repos` queda `{}`. Si no, cada subcarpeta que es repo es **candidata** a `git.repos` (puede haber repos que no son del proyecto, como una base de conocimiento clonada al lado: la lista se confirma en el paso 3), con el nombre del repo en GitHub sacado de su remoto (`git -C <d> remote get-url origin` → la última parte, sin `.git`).
- **Organización.** La parte del dueño en esas URLs. Si hay más de una, no elijas: va al paso 3.
- **Rama base.** Es donde se integra el trabajo, que no siempre es la rama por defecto de GitHub. Si existe `origin/develop` en los repos, proponé `develop`. Si no, `git -C <d> symbolic-ref --short refs/remotes/origin/HEAD` (quitá `origin/`), y si eso no responde, la que exista de `main` o `master`. Siempre se confirma en el paso 3, con lo que viste: «`origin/HEAD` es `main`, pero existe `develop`».
- **Prefijos de rama.** `git -C <d> branch -r --format='%(refname:short)'`, y contá los prefijos (`feature/`, `bugfix/`, `hotfix/`, `spec/`, …). Los que se usan entran en `git.prefijos`.

No hagas `fetch`: alcanza con lo que ya hay. **No leas** archivos de configuración local con secretos (`.env`, `appsettings.local.json` y parecidos).

## 2. Detectar lo de Jira — sin preguntar

Si el MCP de Atlassian no responde, decilo, dejá `jira` con los valores por defecto de la plantilla, y seguí: duck funciona sin Jira configurado, solo pierde el reconocimiento de transiciones.

- **Clave.** Si vino en `$ARGUMENTS`, esa. Si no, buscala en los nombres de rama y en los asuntos de los últimos commits (`git -C <d> log --oneline -50`): el patrón `ABC-123` que más se repite. Confirmala con `getVisibleJiraProjects`. Si no aparece, va al paso 3.
- **Estados y transiciones.** Tomá una sub-tarea reciente del proyecto:
  `searchJiraIssuesUsingJql` con `jql: "project = <CLAVE> AND issuetype in subTaskIssueTypes() ORDER BY updated DESC"`, `maxResults: 5`, `view: "full"`.
  Sobre una de ellas, pedí sus transiciones (`listJiraIssueTransitions`, o `discover` con *list issue transitions* y después `executeRead`). Con eso se completan `jira.transiciones` (ids) y `jira.nombresTransicion` (fragmentos del nombre, en minúsculas), y `jira.estados.enProceso` / `finalizado` / `pendiente` con el nombre del estado al que lleva cada una.
- **Estados de historia.** Lo mismo con una historia (`issuetype = Story` o el nombre local, `Historia`): sus estados llenan `historiaDesarrollo`, `historiaPruebas`, `historiaCerrada` y `historiaOtros`.
- **Prefijos de summary.** En los `summary` de esas sub-tareas, los prefijos entre corchetes (`[BE]`, `[FE]`, `[ANALISIS]`, `[BLOQ]`…). Son la base de la tabla de tipos del paso 3.

**Nunca adivines un id ni un nombre de estado.** Lo que no salga de una respuesta real de Jira queda con el valor por defecto, y en el paso 5 se marca como «sin verificar».

## 3. Preguntar lo que no se puede detectar

**Una pregunta por vez, y esperá la respuesta.** Proponé siempre una respuesta, la que sale de lo detectado, para que alcance con decir «sí». Saltá las que ya quedaron resueltas.

1. **Repos del proyecto y rama base.** Mostrá las carpetas candidatas y la rama propuesta: ¿son estas, y se integra en esa rama? Después, lo que quedó ambiguo: la organización o la clave.
2. **Tipos de ticket.** Con los prefijos encontrados, proponé la tabla «en el ticket → repositorio → prefijo de rama» (por ejemplo `[BE]` → `api/` → `feature/`). ¿Es así?
3. **Orden de la serie.** Si hay más de un tipo de implementación, ¿cuál va primero? (lo típico es backend antes que frontend).
4. **Plan por historia.** ¿Cada historia lleva un plan versionado? ¿En qué ruta? (eso es `odd.diseno`, con `{historia}`; si hay una carpeta como `docs/disenos/` o `docs/design/`, proponela).
5. **Spec antes que código.** ¿La implementación espera a que la spec esté mergeada en la rama base?
6. **Tests mientras se itera.** Por cada repo, el comando para correr solo los tests de lo tocado. Proponelo a partir de lo que veas (`package.json` → `scripts.test`; un `.sln` o `.csproj` → `dotnet test --filter`; `pyproject.toml` → `pytest -k`).
7. **Reglas que no se negocian.** Si los `CLAUDE.md` de los repos ya las tienen, **no las copies**: proponé dejar en convenciones solo lo que no esté ahí. ¿Hay algo más?
8. **Quién lee los comentarios de cierre** en Jira (PM, QA, negocio…).

Si la persona dice «no sé», «después» o «dejalo», esa sección queda fuera del archivo: no la inventes.

## 4. Armar los dos archivos

- **`duck.json`.** Partí de la plantilla, con los valores detectados y respondidos. Agregá `"convenciones": ".claude/duck/convenciones.md"`. **Omití un campo cuando su valor es igual al por defecto**: así el archivo dice solo lo que el proyecto tiene de distinto. Respetá `acli`: `"acli"` salvo que la persona dé una ruta.
- **`convenciones.md`.** Partí de la plantilla y dejá solo las secciones con contenido real del proyecto. Nada inventado. Nada que ya diga un `CLAUDE.md` (citá el archivo en vez de repetirlo).

Validá el JSON antes de mostrarlo: `node -e "JSON.parse(require('fs').readFileSync(0,'utf8'))" < <archivo-temporal>`.

## 5. Mostrar, y esperar

Mostrá los dos archivos completos (o, si ya existían, las diferencias), y debajo:

- Lo **detectado**, con su origen en una línea (por ejemplo: `git.ramaBase = develop` — `origin/HEAD` de los 3 repos).
- Lo **sin verificar**: lo que quedó con el valor por defecto porque no se pudo consultar.

Esperá un «sí» explícito. Una corrección no es un sí: se aplica, se vuelve a mostrar, y se espera otra vez.

## 6. Escribir

1. Los dos archivos.
2. `.claude/estado/` en el `.gitignore` del repo que contenga `.claude/`, si la raíz es un repo y todavía no está. Si la raíz no es un repo, no hace falta.
3. Comprobá que la configuración carga: `node "${CLAUDE_PLUGIN_ROOT}/scripts/inventario.js" <session_id>` no tiene que responder `sinConfiguracion`.

## 7. Reportar

Tres líneas:

- Los archivos escritos.
- Lo que quedó sin verificar, si hay algo.
- El siguiente paso: `/reload-plugins` (o una sesión nueva) para que los hooks y el panel lean la configuración, y después `/duck:tomar <clave>`.
