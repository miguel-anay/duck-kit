// Hook PostToolUse sobre la transicion de Jira: cuando una sub-tarea pasa a
// En Proceso o a Finalizado, recuerda mover la historia padre segun la regla
// «la historia sigue a sus sub-tareas» (METODO.md, «El estado en Jira sigue al trabajo»):
//
//   - primera sub-tarea de desarrollo En Proceso -> historia a estados.historiaDesarrollo;
//   - todas las de desarrollo Finalizado y solo quedan las de analisis -> historia a estados.historiaPruebas;
//   - la historia cerrada nunca la decide el agente.
//
// Existe porque, sin esto, la historia quedaba en Backlog durante toda una serie de
// sub-tareas y habia que pedir a mano que pasara a Pruebas.
//
// Como los otros hooks del conjunto, no puede consultar Jira: es un proceso de
// shell sin acceso al MCP. Inyecta la instruccion y la resuelve el agente, que
// si puede leer el parent y las hermanas. La respuesta de transitionJiraIssue
// no trae el tipo de issue, asi que la instruccion empieza por comprobarlo.
//
// Convive con estado-tarea.js (anota el hecho) y panel-al-cerrar.js (pide la
// vista) en el mismo evento. Un hook, un trabajo. Se apaga con
// jira.historiaSigueSubtareas = false en duck.json.
//
// Con tickets.proveedor = 'github' el hecho es un Bash con `ticket.js mover` y la historia es el
// issue padre (sub-issues): pasa a En Proceso con su primera hija, y a Done solo cuando todas sus
// hijas estan cerradas.

const { hook, deducirEstado, movidasDeGithub, TICKET_JS } = require('./config');

hook((evento, cfg) => {
  if (cfg.jira.historiaSigueSubtareas === false) return;
  if (cfg.tickets.proveedor === 'github') {
    const textos = movidasDeGithub(evento, cfg).map((m) => textoGithub(m, cfg)).filter(Boolean);
    if (textos.length) emitir(textos.join('\n\n'));
    return;
  }
  const clave = (evento?.tool_input?.issueIdOrKey || '').toUpperCase();
  if (!cfg.jira.reClaveExacta.test(clave)) return;

  const e = cfg.jira.estados;
  const analisis = cfg.jira.prefijoAnalisis;
  // Las transiciones de historia (desarrollo, pruebas, cierre) no se leen como estados de
  // sub-tarea: es lo que evita que el hook se responda a si mismo.
  const estado = deducirEstado(evento, cfg, { soloSubtareas: true });
  let texto = null;

  if (estado === e.enProceso) {
    texto =
      `${clave} paso a ${e.enProceso}. Si es una sub-tarea, resolve su historia padre ` +
      `(searchJiraIssuesUsingJql con key = ${clave} y view "full" para leer parent) y, ` +
      `si la historia no esta en ${e.historiaDesarrollo}, pasala ahi: listJiraIssueTransitions ` +
      `sobre la historia y la transicion que aterriza en ${e.historiaDesarrollo}, sin adivinar ` +
      'el id. Si la clave es la historia misma o no tiene parent, no hagas nada.';
  } else if (estado === e.finalizado) {
    texto =
      `${clave} paso a ${e.finalizado}. Si es una sub-tarea, lee su historia padre y las ` +
      `hermanas (parent = <padre>). Si todas las sub-tareas que no son ${analisis} estan ` +
      `${e.finalizado} y queda al menos una ${analisis} sin finalizar, pasa la historia a ` +
      `${e.historiaPruebas} (transicion consultada con listJiraIssueTransitions, no adivinada). Si ` +
      `quedan sub-tareas de desarrollo abiertas, la historia sigue en ${e.historiaDesarrollo}. ` +
      `Si todo esta ${e.finalizado}, no la cierres: ${e.historiaCerrada} lo decide una persona; ` +
      'decilo en una linea. Si la clave es la historia misma, no hagas nada.';
  }

  if (!texto) return;
  emitir(texto);
});

function textoGithub({ clave, estado }, cfg) {
  const g = cfg.github.estados;
  const es = (nombre) => estado.toLowerCase() === String(nombre).toLowerCase();
  const ver = `\`node "${TICKET_JS}" ver`;
  if (es(g.enProceso)) {
    return (
      `${clave} paso a ${g.enProceso}. Si tiene padre (${ver} ${clave}\`, campo padre) y el padre no ` +
      `esta en ${g.enProceso}, movelo con \`node "${TICKET_JS}" mover <padre> enProceso\`. Si no ` +
      'tiene padre, no hagas nada.'
    );
  }
  if (es(g.finalizado)) {
    return (
      `${clave} paso a ${g.finalizado}. Si tiene padre, lee el padre con ${ver} <padre>\`: solo si ` +
      `todas sus hijas estan cerradas (abierto: false), movelo con \`node "${TICKET_JS}" mover <padre> ` +
      `finalizado\`; si queda alguna abierta, el padre sigue en ${g.enProceso}. Un Closes #N al ` +
      'mergear puede haberlo movido ya por el workflow del Project: relee antes de mover. Si no ' +
      'tiene padre, no hagas nada.'
    );
  }
  return null;
}

function emitir(texto) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: texto,
      },
    })
  );
}
