---
name: estructura-docs
description: Usar cuando se vaya a crear o ubicar documentación de un proyecto (ADR, PRD, specs, manuales, guías, agentes de IA, changelog, diseño técnico, seguridad, despliegue) o a armar su carpeta de docs. Decide dónde van los documentos según el layout del proyecto y crea la estructura sin pisar nada.
---

# Estructura de docs del proyecto

Antes de escribir un ADR, PRD, changelog, diseño, documento de seguridad o de despliegue, decidir **dónde vive** según qué es la carpeta raíz.

## 1. Layout

Los tres layouts reciben **la misma serie**; cambia dónde vive y la forma del changelog.

| Detección | Dónde van los docs | Además |
|---|---|---|
| Raíz es un repo git, sin workspaces | `docs/` dentro del repo | `CHANGELOG.md` |
| Raíz es un repo git con `pnpm-workspace.yaml`, `turbo.json`, `nx.json` (o `workspaces` en `package.json`) | `docs/` en la raíz | `CHANGELOG.md` |
| Raíz no es un repo y sus subcarpetas sí lo son | carpeta hermana `doc/`, que tiene que ser **su propio repo git** (el script avisa si no lo es) | `changelog/<repo>.md`, `repositorios.md` |

## 2. Qué va en cada lugar

| Ruta | Qué responde |
|---|---|
| `README.md` | Índice de los docs. |
| `PRD.md` | Qué se construye y para quién. |
| `TECH-DESIGN.md` | Cómo se construye. |
| `adr/NNNN-titulo.md` | Una decisión de arquitectura por archivo; copiar `adr/0000-plantilla.md`. |
| `specs/NNN-slug/spec.md` | Cada cambio antes del código, con criterios de aceptación; copiar `plantillas/spec.md`. |
| `SECURITY.md` | Amenazas y controles. |
| `DEPLOY.md` | Cómo se despliega y se revierte. |
| `guias/` | Ejecución local, entornos y flujo de trabajo. |
| `manuales/` | `usuario.html` y `tecnico.html`: salen del código real y describen lo que hay, nunca lo que debería haber. Sin código funcionando, esperan. |
| `convenciones/` | Reglas del proyecto, con su motivo. |
| `ia/` | `CLAUDE.md` base y `agentes/` del proyecto; copiar `plantillas/agente-ia.md`. |
| `plantillas/` | Plantillas de spec y de agente. |
| `CHANGELOG.md` o `changelog/<repo>.md` | Cambios visibles por versión. |
| `repositorios.md` (varios repos) | Inventario de repos, rama base y qué contiene cada uno. |
| `odd/` | Documentos de tareas de ODD, cuando el proyecto los versiona (`odd.versionado: true`, con `odd.tareas` apuntando acá). |

Orden de escritura: `PRD.md`, `TECH-DESIGN.md`, `adr/`, `SECURITY.md`; después, una spec por cambio. Si el proyecto usa `odd.diseno` de duck, conviene apuntarlo a `specs/{historia}/spec.md`.

## 3. Crear la estructura

1. Calcular el plan: `node "${CLAUDE_PLUGIN_ROOT}/skills/estructura-docs/scripts/crear-docs.js" --dry-run [directorio]` (por defecto el directorio actual).
2. Mostrar el plan al usuario y esperar su conformidad.
3. Ejecutar sin `--dry-run`.

La salida es JSON: `layout`, `destino`, `creados`, `existentes`, `advertencias`. **Nunca sobrescribe**: lo que ya existe queda como está y se lista en `existentes`. Si hay `advertencias`, informarlas al usuario.

## 4. Conectar con duck

Si el proyecto tiene `.claude/duck.json`, proponer agregarle `"adr"` con la carpeta de ADR creada (`docs/adr`, o `doc/adr` con varios repos): sin esa clave, `guard-adr.js` no cuida los ADR aceptados. Se muestra el cambio y se espera conformidad, como en `/duck:iniciar`.
