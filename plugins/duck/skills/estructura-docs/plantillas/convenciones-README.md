# Convenciones

Reglas del proyecto que se cumplen siempre. Una regla por línea, con su motivo y con quién la hace cumplir.

| # | Regla | Por qué | Quién la hace cumplir |
|---|---|---|---|
| R1 | Todo cambio empieza con su spec en `specs/`. | El alcance y los criterios se acuerdan antes del código. | Revisión del PR |
| R2 | Nadie empuja ni mergea a mano sobre la rama base. | El merge pasa por el PR y su revisión. | GitHub (protección de rama); duck (`guard-git`) en sesiones de Claude |

## Quién hace cumplir cada regla

- **duck**: un hook del plugin, nombrado por su script (`guard-git`, `push-con-issue`, `guard-adr`…). Solo frena a una sesión de Claude: una persona en su terminal no pasa por él.
- **git**: un hook de git del proyecto (`commit-msg`, `pre-commit`), versionado en `convenciones/hooks/` y con su instalación en las guías. Frena a cualquiera que tenga el hook instalado.
- **GitHub**: protección de rama, revisiones obligatorias, checks requeridos. Frena a todos.
- **Revisión del PR**: nadie la automatiza; la cuida quien revisa.

Una regla que solo cuida duck es una regla que una persona puede saltear. Si tiene que valer para todos, lleva también git o GitHub.
