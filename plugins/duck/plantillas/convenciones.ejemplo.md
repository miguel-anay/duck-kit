# Convenciones del proyecto para duck

Lo leen los agentes y `/duck:tomar` (`duck.json` → `convenciones`). Va en el proyecto, no en el kit.
Todo es opcional: borrá lo que no aplique.

## Tipos de ticket

| En el ticket | Repositorio | Prefijo de rama |
|---|---|---|
| `[BE]` | `api/` | `feature/` |
| `[FE]` | `web/` | `feature/` |
| `[ANALISIS]`, `[SPEC]` | `docs/` | `spec/` |
| Bug, `[BUG]`, `[FIX]` | el que toque | `bugfix/` |

- Orden de la serie: `[BE]` antes que `[FE]` (el contrato se despliega primero en la API).
- Plan por historia en `docs/disenos/{historia}.md`, con bitácora de decisiones al final.
- La implementación no empieza hasta que la spec de la historia está mergeada en la rama base.

## Dónde buscar

| Qué | Dónde |
|---|---|
| Reglas de dominio | `api/src/Dominio/` |
| Endpoints | `api/src/Web/` |
| Pantallas | `web/src/app/features/` |
| Llamadas HTTP | `web/src/app/core/api/` |
| Decisiones de arquitectura | `docs/adr/` |

## Reglas de repositorio que no se negocian

- Ningún componente llama HTTP directo: las llamadas van en `web/src/app/core/api/`.
- Cambios de esquema solo por migración.
- Cobertura: global ≥ 75 %, y ≥ 80 % en el código nuevo o modificado.

## Tests por alcance

- Mientras se itera: `dotnet test --filter <clase>` en `api/`; `ng test --include=<ruta>` en `web/`.
- La suite completa, una vez al cerrar.

## Verde que no es verde

- Los tests de integración se saltean sin base de datos y la suite da verde igual.

## Comentario de cierre

- Lo leen la PM, QA y el otro carril.
