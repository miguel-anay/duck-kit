// Hook PostToolUse sobre Agent: anota que un agente de pruebas corrio (METODO.md §9).
//
// Lo anota el hook al ver el lanzamiento, no el agente: asi push-con-pruebas.js no depende de lo
// que el agente diga de si mismo. Queda por rama y tipo, en .claude/estado/pruebas/.
//
// Un agente lanzado en segundo plano todavia no tiene resultado cuando corre este hook: se anota
// igual, porque no hay como saber si va a devolver `blocked`.
//
// El lanzamiento no dice sobre que repositorio trabaja el agente. La tarea lleva el mismo nombre
// de rama en todos los repos que toca (METODO.md §1), asi que se anota para la rama de trabajo
// actual de cada repo; la rama base nunca es trabajo y no se anota.

const path = require('path');
const { hook, ramaDe, anotarPrueba, AGENTES_PRUEBA } = require('./config');

hook((evento, cfg) => {
  // Solo el agente de duck, con su nombre completo: un «fuzz» de otro plugin no es este.
  const agente = String(evento?.tool_input?.subagent_type || '');
  const tipo = Object.keys(AGENTES_PRUEBA).find((t) => AGENTES_PRUEBA[t] === agente);
  if (!tipo) return;
  // Sin libreria o sin arnes el agente devuelve `blocked`: no probo nada, y no se anota.
  if (estadoDevuelto(evento?.tool_response) === 'blocked') return;

  const ramas = new Set();
  for (const carpeta of cfg.git.carpetas) {
    const rama = ramaDe(path.join(cfg.raiz, carpeta));
    if (rama && rama !== cfg.git.ramaBase && rama !== 'main' && rama !== 'master') ramas.add(rama);
  }
  for (const rama of ramas) anotarPrueba(cfg, rama, tipo);
});

// El estado con que el agente cerro su reporte: el ultimo `done`, `partial` o `blocked` que escribio
// entre comillas invertidas, que es como lo pide su contrato. La palabra suelta no cuenta: un
// reporte que dice «la validacion lo dejo blocked» y cierra en `done` es una corrida hecha.
function estadoDevuelto(respuesta) {
  const estados = [...JSON.stringify(respuesta ?? '').matchAll(/`(done|partial|blocked)`/g)];
  return estados.length ? estados[estados.length - 1][1] : null;
}
