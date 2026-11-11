---
name: estructura-docs
description: Usar cuando se vaya a crear o ubicar documentación de un proyecto (ADR, PRD, specs, manuales, guías, agentes de IA, changelog, diseño técnico, seguridad, despliegue) o a armar su carpeta de docs. Decide dónde van los documentos según el layout del proyecto y crea la estructura sin pisar nada.
---

# Estructura de docs del proyecto

Antes de escribir un ADR, PRD, changelog, diseño, documento de seguridad o de despliegue, decidir **dónde vive** según qué es la carpeta raíz.

## 1. Layout

Hay dos layouts, y los dos reciben **la misma serie**; cambia dónde vive y la forma del changelog.

| Layout | Detección | Dónde van los docs | Además |
|---|---|---|---|
| `mono-repo` | La raíz es un repo git (con o sin workspaces) | `docs/` dentro del repo, o un repo aparte `<repo>.docs` al lado | `CHANGELOG.md` |
| `multi-repo` | La raíz no es un repo y sus subcarpetas sí lo son | carpeta hermana `docs/`, que tiene que ser **su propio repo git** (el script avisa si no lo es); en GitHub, `<carpeta-madre>.docs` | `changelog/<repo>.md`, `repositories.md` |

El nombre es siempre `docs`: es la carpeta que GitHub reconoce (Pages publica desde `/docs`, y `SECURITY.md` y los demás archivos de comunidad se leen de ahí).

**Dónde, en orden:** `docs` de `.claude/duck.json` (ruta relativa a la raíz, la que eligió `/duck:iniciar`); si no está, la carpeta que ya exista, `docs/` o `doc/`; si no hay ninguna, `docs/`. Una `doc/` sin `docs` en `duck.json` se usa igual, y el script avisa el `git mv doc docs`. Los repos de código son los de `git.repos` de `duck.json`, o, sin esa clave, las subcarpetas que son repo; la carpeta de docs nunca cuenta como repo de código.

## 2. Qué va en cada lugar

| Ruta | Qué responde |
|---|---|
| `README.md` | Índice de los docs. |
| `PRD.md` | Qué se construye y para quién. |
| `TECH-DESIGN.md` | Cómo se construye. |
| `adr/NNNN-titulo.md` | Una decisión de arquitectura por archivo; copiar `adr/0000-template.md`. |
| `specs/NNN-slug/spec.md` | Cada cambio antes del código, con criterios de aceptación; copiar `templates/spec.md`. |
| `SECURITY.md` | Amenazas y controles. |
| `DEPLOY.md` | Cómo se despliega y se revierte. |
| `guides/` | Ejecución local, entornos y flujo de trabajo. |
| `manuals/` | `user.html` y `technical.html`: salen del código real y describen lo que hay, nunca lo que debería haber. Sin código funcionando, esperan. |
| `conventions/` | Reglas del proyecto, con su motivo y quién la hace cumplir (duck, git, GitHub o la revisión). Los hooks de git del proyecto van en `conventions/hooks/`; los de duck no se copian: viven en el plugin. |
| `ai/` | `CLAUDE.md` base y `agents/` propios del proyecto; copiar `templates/ai-agent.md`. `install-agents.sh` / `.ps1` los copia a `.claude/agents/` de la raíz (el repo, o la carpeta madre con varios repos); se vuelve a correr al crear o cambiar un agente. Los agentes de duck no se copian: los instala el plugin. |
| `templates/` | Plantillas de spec y de agente. |
| `CHANGELOG.md` o `changelog/<repo>.md` | Cambios visibles por versión. |
| `repositories.md` (varios repos) | Inventario de repos, rama base y qué contiene cada uno. |
| `odd/` | Documentos de tareas de ODD, cuando el proyecto los versiona (`odd.versionado: true`, con `odd.tareas` apuntando acá). |

Orden de escritura: `PRD.md`, `TECH-DESIGN.md`, `adr/`, `SECURITY.md`; después, una spec por cambio. Si el proyecto usa `odd.diseno` de duck, conviene apuntarlo a `specs/{historia}/spec.md`.

## 3. Crear la estructura

1. Calcular el plan: `node "${CLAUDE_PLUGIN_ROOT}/skills/estructura-docs/scripts/crear-docs.js" --dry-run [directorio]` (por defecto el directorio actual).
2. Mostrar el plan al usuario y esperar su conformidad.
3. Ejecutar sin `--dry-run`.

La salida es JSON: `layout`, `destino`, `creados`, `existentes`, `advertencias`. **Nunca sobrescribe**: lo que ya existe queda como está y se lista en `existentes`. Si hay `advertencias`, informarlas al usuario.

Los nombres de carpetas y archivos, y el contenido de las plantillas, están en inglés. Un proyecto que ya tiene la carpeta con el nombre viejo en español (`guias/`, `manuales/`, `convenciones/`, `ia/`, `plantillas/`, `repositorios.md`, `adr/0000-plantilla.md`) no recibe la duplicada: el script lo deja en `advertencias` con el `git mv` que corresponde, y el rename lo decide la persona.

## 4. Conectar con duck

Si el proyecto tiene `.claude/duck.json`, proponer agregarle `"adr"` con la carpeta de ADR creada (`<docs>/adr`): sin esa clave, `guard-adr.js` no cuida los ADR aceptados. Se muestra el cambio y se espera conformidad, como en `/duck:iniciar`.
