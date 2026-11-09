---
name: estructura-docs
description: Usar cuando se vaya a crear o ubicar documentación de un proyecto (ADR, PRD, changelog, diseño técnico, seguridad, despliegue) o a armar su carpeta de docs. Decide dónde van los documentos según el layout del proyecto y crea la estructura sin pisar nada.
---

# Estructura de docs del proyecto

Antes de escribir un ADR, PRD, changelog, diseño, documento de seguridad o de despliegue, decidir **dónde vive** según qué es la carpeta raíz.

## 1. Layout

| Detección | Dónde van los docs |
|---|---|
| Raíz es un repo git, sin workspaces | `docs/` dentro del repo, con la serie completa |
| Raíz es un repo git con `pnpm-workspace.yaml`, `turbo.json`, `nx.json` (o `workspaces` en `package.json`) | `docs/` en la raíz con la serie completa |
| Raíz no es un repo y sus subcarpetas sí lo son | carpeta hermana `doc/` con `adr/`, `changelog/<repo>.md`, `convenciones/` y `odd/` |

En el caso de varios repos, `doc/` tiene que ser **su propio repo git**; el script avisa si no lo es.

## 2. Qué va en cada lugar

- `README.md`: índice de los docs.
- `PRD.md` → `TECH-DESIGN.md` → `adr/` → `SECURITY.md`: en ese orden se escriben. Un repo, chico o monorepo, lleva la serie completa adentro.
- `adr/NNNN-titulo.md`: una decisión por archivo; copiar `adr/0000-plantilla.md`.
- `CHANGELOG.md` (o `changelog/<repo>.md` con varios repos): cambios visibles por versión.
- `DEPLOY.md`: cómo se despliega y se revierte.
- `convenciones/` y `odd/` (varios repos): reglas compartidas y documentos de tareas.

## 3. Crear la estructura

1. Calcular el plan: `node "${CLAUDE_PLUGIN_ROOT}/skills/estructura-docs/scripts/crear-docs.js" --dry-run [directorio]` (por defecto el directorio actual).
2. Mostrar el plan al usuario y esperar su conformidad.
3. Ejecutar sin `--dry-run`.

La salida es JSON: `layout`, `destino`, `creados`, `existentes`, `advertencias`. **Nunca sobrescribe**: lo que ya existe queda como está y se lista en `existentes`. Si hay `advertencias`, informarlas al usuario.

## 4. Conectar con duck

Si el proyecto tiene `.claude/duck.json`, proponer agregarle `"adr"` con la carpeta de ADR creada (`docs/adr`, o `doc/adr` con varios repos): sin esa clave, `guard-adr.js` no cuida los ADR aceptados. Se muestra el cambio y se espera conformidad, como en `/duck:iniciar`.
