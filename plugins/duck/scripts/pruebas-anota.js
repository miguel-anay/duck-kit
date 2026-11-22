// Hook PostToolUse sobre Agent: anota que un agente de pruebas corrio (METODO.md §9).
//
// Lo anota el hook al ver el lanzamiento, no el agente: asi push-con-pruebas.js no depende de lo
// que el agente diga de si mismo. Queda por rama, en .claude/estado/pruebas.json.
//
// El lanzamiento no dice sobre que repositorio trabaja el agente. La tarea lleva el mismo nombre
// de rama en todos los repos que toca (METODO.md §1), asi que se anota para la rama de trabajo
// actual de cada repo; la rama base nunca es trabajo y no se anota.

const path = require('path');
const { hook, ramaDe, anotarPrueba, AGENTES_PRUEBA } = require('./config');

hook((evento, cfg) => {
  const agente = String(evento?.tool_input?.subagent_type || '').replace(/^duck:/, '');
  const tipo = Object.keys(AGENTES_PRUEBA).find((t) => AGENTES_PRUEBA[t] === `duck:${agente}`);
  if (!tipo) return;

  const ramas = new Set();
  for (const carpeta of cfg.git.carpetas) {
    const rama = ramaDe(path.join(cfg.raiz, carpeta));
    if (rama && rama !== cfg.git.ramaBase && rama !== 'main' && rama !== 'master') ramas.add(rama);
  }
  for (const rama of ramas) anotarPrueba(cfg, rama, tipo);
});
