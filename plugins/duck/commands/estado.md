---
description: La mesa de trabajo Duck — extensiones instaladas, dónde está cada repo, y cómo va la historia en curso
allowed-tools: Bash, Read, mcp__atlassian__searchJiraIssuesUsingJql
---

Panel de la mesa de trabajo Duck: qué extensiones hay instaladas, dónde está parado cada repositorio, y cómo va la historia de Jira en curso. Es una vista de **solo lectura**: no transiciona nada, no crea ramas, no publica nada.

> **Configuración.** Necesita `.claude/duck.json` en el proyecto: sin él, `inventario.js` responde `{"sinConfiguracion": true}` y no hay panel que dibujar (decilo en una línea y pará). Los repositorios son las carpetas de `git.repos`, la rama base es `git.ramaBase`, y los estados y el prefijo de bloqueo salen de `jira.estados` y `jira.prefijoBloqueo`. En este texto se usan los valores por defecto (`Finalizado`, `En Proceso`, `Pendiente`, `[BLOQ]`, `Diseño/Desarrollo`) como ejemplo: sustituilos por los del proyecto.

## 1. Inventario local — una sola vez

Corré, desde el proyecto (o cualquier subcarpeta suya):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/inventario.js" <session_id>
```

Pasá el id de la sesión actual como argumento si lo conocés — así el panel puede mostrar la sub-tarea que se está tocando ahora mismo (`sesion` en la salida). Si no lo conocés, corré el comando sin argumento; `sesion` sale `null` y el resto del inventario sigue intacto.

**No reemplaces esto por una ristra de `git status`, `git branch`, `git rev-list` sueltos.** El script existe precisamente para que estos hechos no dependan de que el agente se acuerde de mirarlos todos — y ya resuelve cosas que a mano son fáciles de hacer mal, como descartar el alias `origin/HEAD` al listar ramas. Un solo `inventario.js` y listo.

La salida trae: `piezas` (hooks y statusLine instalados), `comandos` (slash commands disponibles), `skills`, `repos` (rama, limpio, al día, commits propios de cada carpeta de `git.repos`), `sesion` (tareas tocadas en las últimas 16 horas por esta sesión), `ramasPorClave` y `sospechas` (reuso de una clave de Jira bajo nombres de rama distintos).

## 2. Resolver la historia con Jira — solo si hay una clave

**La clave sale ÚNICAMENTE de la sesión.** Es la de mayor `desde` en `sesion` (la salida de `inventario.js <session_id>`): la última tarea que *esta* sesión confirmó con Jira, aunque ya esté mergeada. No se mira la rama de ningún repo (`repos.*.clave`) ni ningún archivo de historia previo: son estado que la sesión no posee, y por ahí una pestaña terminaba mostrando la historia de otra.

Si `sesion` es `null` o no tiene tareas, no hay clave: saltá al paso 3 (escribí igual el archivo de la sesión con `historias: []`) y al paso 4, y mostrá el panel sin sección de historia.

Con esa clave, `searchJiraIssuesUsingJql` con `view: "full"`:

1. `jql: "key = <clave>"` — para sacar el `parent` y el tipo (`issuetype`) de la clave.
   - Si la clave es una **Task sin sub-tareas** cuyo `parent` es una **Épica**, no subas a la épica: la clave misma es la «historia». Los pasos siguientes usan esa clave como `<clave-del-padre>` (`historia.titulo` es su `summary`, y `subtareas` queda vacía si no tiene hijas).
2. `jql: "parent = <clave-del-padre>"`, `fields: ["summary","status","assignee"]` — trae todas las sub-tareas hermanas de la historia.
3. `jql: "key = <clave-del-padre>"`, `fields: ["status"]` — el estado de la **historia**: `status.name` va a `historia.estado` y `status.statusCategory.key` (`new`, `indeterminate` o `done`) a `historia.categoria`. El panel colorea la cabecera por la categoría, no por el nombre: el flujo de la historia tiene nombres propios (`Diseño/Desarrollo`).

Con las sub-tareas de la historia en mano, pedile a git **dónde está el código de cada una** — una sola llamada, sin red:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/inventario.js" <session_id> --claves <CLAVE>-1,<CLAVE>-2,...
```

(las claves de todas las sub-tareas). La salida es `{ "claves": { "<CLAVE>-n": { develop, ramas, ubicacion } } }`: `develop` son los repos donde la clave figura en el **asunto** de un commit de `origin/<base>` (no en el cuerpo: un commit que dice «alias de <CLAVE>-672» no entrega la 672; el campo se llama `develop` aunque la rama base tenga otro nombre), `ramas` son las ramas locales o remotas **sin mergear** que llevan la clave, y `ubicacion` es `"rama"` si hay rama viva (aunque haya algo en develop: trabajo en curso), `"develop"` si hay commits en develop y ninguna rama viva, y `"sin-rama"` si nada. No hace `fetch`: usa lo que haya en `origin/<base>`.

**No uses `getJiraIssue`**: algunas organizaciones lo bloquean por política, y la JQL alcanza.

## 3. Escribir la historia de la sesión para el panel

Terminada la resolución de Jira (haya o no clave — si no la hay, escribí igual el
archivo con `historias: []`, ver abajo), escribí el resultado en
`<raíz del proyecto>/.claude/estado/sesiones/<session_id>-historia.json` (un archivo por sesión: cada pestaña ve solo lo suyo; el `historia.json` global viejo ya no se usa):

```json
{
  "actualizado": "<ahora, ISO 8601>",
  "historias": [
    {
      "historia": { "clave": "<CLAVE>-296", "titulo": "...",
                    "estado": "Diseño/Desarrollo", "categoria": "indeterminate" },
      "subtareas": [
        { "clave": "<CLAVE>-527", "prefijo": "[BE]", "titulo": "...",
          "estado": "En Proceso", "responsable": "...", "esMio": true,
          "git": { "ubicacion": "rama", "repos": [], "ramas": ["feature/<CLAVE>-527-..."] } }
      ]
    },
    { "historia": { "clave": "<CLAVE>-512", "titulo": "..." }, "subtareas": [] }
  ],
  "alertas": ["..."]
}
```

`historias` lleva **una entrada por historia en juego**, en el orden en que se quieren ver (hoy las de las claves que esta sesión confirmó); el panel las dibuja todas, una debajo de otra. `actualizado` y `alertas` son del archivo entero, no de cada historia. El formato anterior, de una sola historia (`historia` y `subtareas` en la raíz), el panel lo sigue leyendo como una lista de un elemento, pero escribilo siempre en la forma nueva.

`esMio: true` va en la sub-tarea que coincide con la clave que se está tocando ahora
mismo (la misma que el paso 4.b marca con `▶`); el resto la omite o la deja en `false`.
`git` es lo que devolvió `inventario.js --claves` para esa sub-tarea: `ubicacion` es `"develop"`, `"rama"` o `"sin-rama"`, `repos` los repos donde ya está en develop y `ramas` los nombres de rama vivos. `alertas` es la lista que arma el paso 4.d — igual de vacía o con contenido que la que
se muestra en el panel de este mismo comando.

Si el paso 2 se saltó por no haber ninguna clave, escribí el archivo igual, con
`"historias": []` y `"alertas": []`: así el mod del panel sabe
que ya se corrió `/duck:estado` y no hay historia que mostrar, en vez de quedarse con
un archivo viejo de una tarea anterior.

**Este archivo es lo que el panel (el mod del plugin duck, carpeta `mod/`) dibuja de Jira**, y
`/duck:estado` es quien lo crea: decide **qué historia** se sigue. Después lo mantienen
al día otros dos: el hook `estado-tarea.js`, que parchea cada transición hecha en esta
máquina, y el propio panel, que con el panel abierto consulta Jira cada 60 s con `acli`
(el CLI oficial de Atlassian, con login por `acli jira auth login --web`), con **una consulta por
historia** (`key = H OR parent = H`; no se junta en una sola porque acli no admite el campo `parent` en
`--fields`, verificado el 2026-10-13), y reescribe estados, títulos, responsables y sub-tareas de cada
una. Una historia cuya consulta falla, o que no devuelve su propia clave, queda como estaba. Sin `acli` o sin sesión, el
panel solo ve lo que dejaron el comando y el hook. Si el archivo no existe, la sección
de historia sale en blanco, con una línea en dim invitando a correr `/duck:tomar` (o `/duck:estado`). Un panel nunca lee el archivo de otra sesión.

## 4. Dibujar el panel

En este orden:

### a) Las historias

Un bloque por cada entrada de `historias`, en el orden del archivo; los puntos a) y b) se repiten por bloque. Si **todas** las sub-tareas de una historia están Finalizadas, el bloque se reduce a una línea: cabecera con la barra al 100 %.

Clave y título de la historia (el `parent`). Una barra de **25 caracteres** hecha con `█` (finalizadas) y `░` (el resto), proporcional a `sub-tareas Finalizado / total`, y al lado el conteo con el porcentaje, con el color por delante: 🟢 si es 100 %, 🟡 si está en curso — por ejemplo `████████████░░░░░░░░░░░░░ 🟡 7/15 (47%)`.

### b) Las sub-tareas

La que coincide con la clave que se está tocando ahora (la clave más reciente de `sesion`) va marcada con `▶` al principio de la línea; el resto, alineadas sin marca. Por cada una: clave, el prefijo entre corchetes tal como aparece en el `summary` (`[BE]`, `[FE]`, `[ANALISIS]`, `[BLOQ]`, etc.), un título recortado, el estado de Jira con su color, **dónde está el código** (columna `git.ubicacion`) y el **primer nombre** del responsable (p. ej. «Miguel», no el nombre completo).

Colores — indicadores fijos, porque la terminal no pinta ANSI en markdown:

- Jira: 🟢 Finalizado · 🟡 En Proceso · ⚪ Pendiente · 🔴 `[BLOQ]` sin finalizar.
- Código: ✅ en la rama base · 🌿 en rama · 🌱 sin rama. Si `git` falta en la sub-tarea, `🌱` no: dejá la celda en blanco.
- Alertas: ⚠️ al principio de cada línea.

La **leyenda** de estos símbolos va **una sola vez, al pie** del panel (ver el ejemplo).

Las `Finalizado` no se listan: se colapsan siempre en una sola línea `… N finalizadas` al final del bloque.

### c) Los repositorios

Una línea por repo (cada carpeta de `git.repos`) con: rama, si está limpio o no, si está al día con la rama base o no, y cuántos commits propios lleva sobre `origin/develop`. Un repo cuya rama es la base se marca como **libre** (no está en medio de ninguna tarea).

### d) Alertas — solo si las hay

Cada línea empieza con ⚠️. Mostrá esta sección únicamente si alguna de estas condiciones aplica; si no hay ninguna, omitila entera:

- Cada string de `sospechas` tal cual la devuelve el inventario. Vienen acotadas a las
  claves en juego hoy —la rama de cada repo y lo anotado en la sesión—, que es cuando
  todavía se puede hacer algo al respecto.
- Si `sospechasFueraDeFoco` es mayor que cero, una sola línea: «N claves fuera de foco
  tienen ramas **sin mergear** con nombres distintos». Solo cuenta ramas vivas: un reuso
  que ya está en la rama base no tiene corrección y no se reporta. Como son ramas vivas, sí
  hay algo que decidir —¿abandonada?, ¿merece su propia sub-tarea?—, y lo decide quien
  hizo la rama, no quien corre el comando.
- Cualquier sub-tarea `[BLOQ]` que no esté `Finalizado`.
- Cualquier sub-tarea de la historia en `En Proceso` cuyo `assignee` sea otra persona (no quien corre el comando).
- Cualquier clave presente en `sesion` con `estado: "Mergeado"` que en Jira **no** figure `Finalizado` todavía — es un merge que falta cerrar en el ticket.

## 5. Qué NO hacer

**No inventes un porcentaje de avance de la sub-tarea individual.** Jira solo tiene tres estados (`Pendiente`, `En Proceso`, `Finalizado`) y git no sabe cuánto falta de una tarea en curso — cualquier número ahí sería inventado. El único porcentaje válido en este panel es el de la **historia completa**, porque ese sí es un hecho contable: sub-tareas finalizadas sobre el total.

Para la tarea que se está tocando ahora, mostrá únicamente hechos observables del inventario — rama creada, si está limpia, si está al día, cuántos commits propios tiene — nunca una estimación de cuánto le falta.

## 6. Terminar ahí

Es una vista. No transiciones nada en Jira, no crees ramas, no publiques comentarios ni edites nada. Mostrá el panel y parate.

---

### Ejemplo de aspecto esperado

Datos **ficticios**, no corresponden a ningún ticket real:

```
PROY-900 — Simulación de cuotas con tope del producto
████████████████░░░░░░░░░ 🟡 8/13 (62%)

▶ PROY-903 [FE] Pantalla de simulación con tope     🟡 En Proceso  🌿 en rama   (vos)
  PROY-904 [BE] Endpoint de recálculo con tope      ⚪ Pendiente   🌱 sin rama   Ana
  PROY-905 [BLOQ] Confirmar redondeo con negocio    🔴 Pendiente   🌱 sin rama   (sin asignar)
  … 8 finalizadas

Repositorios
  docs      develop                                     limpio   al día   libre
  backend   feature/PROY-904-endpoint-recalculo-tope    limpio   al día   3 commits propios
  frontend  feature/PROY-903-pantalla-simulacion-tope   sucio    2 atrás  5 commits propios

Alertas
  ⚠️ PROY-904: dos trabajos bajo una sola clave — feature/PROY-904-endpoint-recalculo-tope, bugfix/PROY-904-ajuste-redondeo
  ⚠️ PROY-905 está [BLOQ] y sigue Pendiente
  ⚠️ PROY-902 está En Proceso y asignado a Ana
  ⚠️ PROY-901 figura Mergeado en esta sesión pero en Jira sigue En Proceso — falta cerrarlo

Jira: 🟢 Finalizado · 🟡 En Proceso · ⚪ Pendiente · 🔴 [BLOQ] sin finalizar   Código: ✅ en develop · 🌿 en rama · 🌱 sin rama
```
