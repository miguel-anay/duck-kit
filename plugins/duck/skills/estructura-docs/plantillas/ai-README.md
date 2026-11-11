# AI

The project's own AI context and agents, versioned so the whole team works with the same ones.

- The project's `CLAUDE.md` (or its base version): what to read before any task, rules and commands.
- [agents/](agents/): one file per agent, starting from [templates/ai-agent.md](../templates/ai-agent.md). This is the versioned source.

## Install or refresh the agents

Claude reads agents from `.claude/agents/` at the project root: the repo, or the parent folder when there are several repos. The installer copies `agents/*.md` there and reports each one as `new`, `updated` or `unchanged`:

```sh
sh ai/install-agents.sh                                        # Linux, macOS
powershell -ExecutionPolicy Bypass -File ai/install-agents.ps1 # Windows
```

Run it after cloning the project, after creating an agent and after pulling someone else's changes. The copy is overwritten: a change is made in `agents/`, not in `.claude/agents/`. If a Claude session is open, start a new one so it loads the agents.

The main session does the implementation; an agent brings an independent view (review, test, audit) and does not repeat duck's agents (analista, escritor, explorador, verificador).
