---
description: Arranca un spike — desarrollo local para ver si es lo que se quiere, sin Jira ni remoto — rama spike/<tema> desde la rama base al día
argument-hint: <tema-en-kebab-case> [carpeta-de-repo ...]
allowed-tools: Bash, Read, Write, Glob, Grep
---

Arranque de un spike. Argumentos tal cual los pasó quien llama: `$ARGUMENTS`.

> **Configuración.** `<base>` es la rama base (`git.ramaBase` de `.claude/duck.json`, por defecto `develop`) y los repositorios son las carpetas de `git.repos`.

**Separalos vos:** la primera palabra es el **tema** (de acá en adelante, `<tema>`) y las siguientes son los **repositorios** (las carpetas de `git.repos` en `.claude/duck.json`). No confíes en los argumentos posicionales numerados: el 2026-10-13 el runtime corrió los índices y el tema salió como «backend».

Es el **modo spike** de `METODO.md`: probar antes de comprometer. Esto es **preparación**: al terminar, la rama local existe y la sesión está marcada en spike. No escribas código todavía y no toques Jira.

Los pasos corren en orden. Al primer tropiezo, **PARÁ y reportá**.

## 1. Validar el tema

`<tema>` debe ser kebab-case: `^[a-z0-9]+(-[a-z0-9]+)*$`, sin acentos ni mayúsculas. **PARÁ si:**

- viene vacío, o no cumple el patrón — proponé uno derivado de lo que pidió la persona;
- contiene la clave del proyecto o cualquier clave de Jira (`[A-Za-z]+-\d+`): el spike no lleva clave, una clave inventada choca después con la real.

## 2. Elegir repositorios

Los que la persona nombró (carpetas de `git.repos`). Si no nombró ninguno y no se deduce del pedido, hacé **una sola pregunta** y esperá. Esto no es spike de una sola clave: puede abarcar varios repositorios, y en todos va el mismo nombre.

## 3. Base limpia y al día; crear la rama

Para cada repositorio, en el orden de `git.repos`:

```bash
git -C <repo> status --porcelain
git -C <repo> fetch origin --prune
git -C <repo> branch -a --list "spike/<tema>"
git -C <repo> switch -c spike/<tema> origin/<base>
```

**PARÁ si** el árbol tiene cambios sin commitear (no se arrastran al spike ni se guardan solos), o si `spike/<tema>` ya existe (reportá en qué estado está; no la recrees). `switch -c … origin/<base>` parte de `<base>` al día sin tocar tu `<base>` local. Si falla en el segundo repositorio, reportá cuál quedó creado.

## 4. Marcar la sesión en spike

El estado de esta sesión es `.claude/estado/sesiones/<session_id>.json`: el `.json` **más reciente** de esa carpeta que **no** termine en `-vista.json` (si no existe, crealo con `{"tareas":{},"modo":"tarea"}`). Leelo y poné, sin tocar `tareas`:

```json
"modo": "spike",
"spike": { "tema": "<tema>", "repos": [<los repositorios elegidos en el paso 2>], "desde": "<ISO ahora>" }
```

Esto es lo que activa el guardia (`guard-spike.js`) y pinta «🧪 spike» en el status line.

## 5. Reportar, en pocas líneas

- Rama `spike/<tema>`, repositorios y commit de `origin/<base>` desde el que parte.
- Qué queda **prohibido mientras dura**, y el guardia lo hace cumplir:
  1. Nada remoto: ni `git push`, ni PR, ni merge.
  2. Nada en Jira: ni crear, editar, transicionar ni comentar (leer sí).
  3. Ni clave de Jira en la rama ni en los commits.
- Cómo se sale:
  - **«Es lo que quiero»** → borrador de tickets, se publican con autorización, y después `/duck:tomar <clave> desde-spike`.
  - **«Descartar el spike»** → ver abajo.

## Descartar el spike

El guardia de git prohíbe `git branch -D` y **no se debilita**. Entonces:

1. Volvé a `<base>` (`git switch <base>`) y devolvé `"modo": "tarea"` en el estado de la sesión, borrando la clave `spike`.
2. `git branch -d spike/<tema>`. Si la rama **está sin mergear** —lo normal en un spike— `-d` se va a negar: **PARÁ**. No fuerces. Decile a la persona que la borre ella (`git branch -D spike/<tema>` en su terminal) o que autorice explícitamente el borrado.
3. En Jira no hay nada que limpiar: el spike nunca escribió ahí.

Terminá ahí. No empieces a implementar sin que te lo pidan.
