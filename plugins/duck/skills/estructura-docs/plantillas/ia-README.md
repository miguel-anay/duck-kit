# IA

Contexto y agentes de IA propios del proyecto, versionados para que todo el equipo trabaje con lo mismo.

- `CLAUDE.md` del proyecto (o su versión base): qué leer antes de cualquier tarea, reglas y comandos.
- [agentes/](agentes/): un archivo por agente, a partir de [plantillas/agente-ia.md](../plantillas/agente-ia.md). Es la fuente versionada.

## Instalar o refrescar los agentes

Claude lee los agentes de `.claude/agents/` en la raíz del proyecto: el repo, o la carpeta madre cuando son varios repos. El instalador copia ahí `agentes/*.md` y dice, por cada uno, si es `nuevo`, `actualizado` o `igual`:

```sh
sh ia/instalar-agentes.sh                                        # Linux, macOS
powershell -ExecutionPolicy Bypass -File ia/instalar-agentes.ps1 # Windows
```

Se corre al clonar el proyecto, al crear un agente y al traer cambios de otro. La copia se pisa: un cambio se hace en `agentes/`, no en `.claude/agents/`. Con una sesión de Claude abierta, abrí una nueva para que cargue los agentes.

La implementación la hace la sesión principal; un agente aporta una mirada independiente (revisar, probar, auditar), no repite a duck (analista, escritor, explorador, verificador).
