# duck-kit

Marketplace de Claude Code con un solo plugin, **`duck`**: un flujo de trabajo portable para equipos que
trabajan con Jira y git.

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

Detecta los repos, la rama base, la organización y los estados de Jira (por el MCP de Atlassian, con `acli`
o GitHub Projects como respaldo), pregunta lo que no puede detectar y escribe `.claude/duck.json` y
`.claude/duck/convenciones.md` solo después de mostrarlos. Después: `/reload-plugins` y
`/duck:tomar <clave>`.

## Herramientas complementarias (opcionales)

duck funciona igual sin ellas. El instalador no las instala ni las comprueba: si las querés, se instalan
aparte, desde su sitio oficial.

| Herramienta | Para qué sirve con duck | Instalación |
|---|---|---|
| [Obsidian](https://obsidian.md) | Leer y navegar lo que escriben duck y los agentes: las bitácoras de ODD (`odd/tasks/`), los diseños y las convenciones. Todo es Markdown; abrí la raíz del proyecto como vault. Para tus notas personales (reuniones, ideas), usá una carpeta fuera de los repos, que enlace hacia la documentación y nunca al revés. | Descargarlo de su sitio. Si lo usás sobre la documentación del equipo, desactivá *Archivos y enlaces → Usar [[Wikilinks]]* y elegí *Ruta relativa al archivo*, para que escriba Markdown estándar. |
| [Graphify](https://github.com/Graphify-Labs/graphify) | Arma un grafo de conocimiento del código (tree-sitter y grafo de llamadas) que el agente consulta en lugar de leer archivo por archivo. Sirve en repos grandes; en uno chico no aporta. **Todavía no está integrado** con `duck:explorador`. | `uv tool install graphifyy`, después `graphify install`, y `/graphify .` en Claude Code. Ver su documentación. |

Si usás Graphify, tené en cuenta dos cosas:

- **El grafo se queda viejo.** Si se commitea `graphify-out/` y nadie lo regenera, el agente navega un mapa
  que ya no es el código.
- **Instala su propio hook** antes de las búsquedas. No se probó junto con los hooks de duck.

## Documentación

- [`plugins/duck/README.md`](plugins/duck/README.md): qué trae cada pieza, instalación a mano y referencia
  de cada campo de `duck.json`.
- [`plugins/duck/METODO.md`](plugins/duck/METODO.md): el método. Modos tarea, flujo y spike, y la
  secuencia de cierre.
- [`plugins/duck/plantillas/`](plugins/duck/plantillas/): los ejemplos de `duck.json` y de convenciones.
