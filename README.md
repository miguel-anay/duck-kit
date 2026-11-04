# duck-kit

Marketplace de Claude Code con un solo plugin, **`duck`**: un flujo de trabajo portable para equipos que
trabajan con Jira (o GitHub Issues + Projects) y git.

- **Una rama por tarea de Jira**, creada desde la rama base al día.
- **Una sola puerta hacia el remoto**: push, PR y merge pasan por un único punto de autorización.
- **El ticket sigue al trabajo**: pasa a «en proceso» al tomarlo y a «finalizado» al mergear.

Trae guardias de git (sin push ni merge local a la rama base, sin `git branch -D`), estado de Jira por
sesión, un panel lateral de la mesa de trabajo, un status line con la tarea en curso, cuatro comandos
(`/duck:tomar`, `/duck:estado`, `/duck:iniciar`, `/duck:spike`), una skill de comentario de cierre y cuatro
agentes (`analista`, `escritor`, `explorador`, `verificador`).

## Instalación

Requisitos: Claude Code ≥ 2.1.287, `node` y `git` en el PATH. Opcionales: el MCP de Atlassian y `acli`.

```bash
git clone https://github.com/miguel-anay/duck-kit.git
cd duck-kit
pwsh -File instalar.ps1   # Windows
bash instalar.sh          # Linux y macOS
```

El script es idempotente: registra el marketplace, instala `duck@duck-kit` y configura el status line.

## Configurar un proyecto

duck no hace nada en un proyecto que no lo adoptó. Para adoptarlo, abrí una sesión de Claude Code en el
proyecto y corré:

```text
/duck:iniciar
```

Detecta los repos, la rama base, la organización y los estados de Jira (por el MCP de Atlassian, o `acli`).
Si el seguimiento vive en GitHub Projects, escribe `"tickets": { "proveedor": "github" }` y la sección `github`
(Project, campo y estados; requiere `gh` con el scope `project`). Pregunta lo que no puede detectar y escribe `.claude/duck.json` y
`.claude/duck/convenciones.md` solo después de mostrarlos. Después: `/reload-plugins` y
`/duck:tomar <clave>`.

## Enlaces de interés

- [Obsidian](https://obsidian.md)
- [Graphify](https://github.com/Graphify-Labs/graphify)

## Documentación

- [`plugins/duck/README.md`](plugins/duck/README.md): qué trae cada pieza, instalación a mano y referencia
  de cada campo de `duck.json`.
- [`plugins/duck/METODO.md`](plugins/duck/METODO.md): el método. Modos tarea, flujo y spike, y la
  secuencia de cierre.
- [`plugins/duck/plantillas/`](plugins/duck/plantillas/): los ejemplos de `duck.json` y de convenciones.
