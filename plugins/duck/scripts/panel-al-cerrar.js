// Hook PostToolUse sobre la transicion de Jira: cuando una tarea queda
// Finalizada, pide el panel de /duck:estado sin que nadie se acuerde de pedirlo.
//
// El disparador es la transicion, no el merge. El merge es el hecho que cierra,
// pero el estado es lo que lo vuelve cierto para el resto del equipo: hasta que
// Jira no lo dice, el trabajo sigue abierto para quien mira el tablero. Ademas
// el merge y la transicion ocurren casi juntos, y escuchar los dos mostraria el
// panel dos veces por la misma tarea.
//
// Igual que los otros hooks de este conjunto, no puede consultar Jira: es un
// proceso de shell sin acceso al MCP. Lo que hace es inyectar la instruccion;
// el panel lo arma el agente, que si tiene el MCP y el inventario.
//
// Convive con estado-tarea.js en el mismo evento y el mismo matcher. La
// division es a proposito: aquel anota el hecho para el sticker, este pide la
// vista. Un hook, un trabajo.
//
// Con tickets.proveedor = 'github' el hecho es un Bash con `ticket.js mover` (por eso este hook
// tambien escucha Bash) y la vista se resuelve con `ticket.js ver`.

const path = require('path');
const { hook, deducirEstado, movidasDeGithub, TICKET_JS } = require('./config');

hook((evento, cfg) => {
  if (cfg.tickets.proveedor === 'github') return panelGithub(evento, cfg);
  const clave = (evento?.tool_input?.issueIdOrKey || '').toUpperCase();
  if (!cfg.jira.reClaveExacta.test(clave)) return;

  // Solo el cierre abre el panel. Pasar algo a En Proceso o devolverlo a
  // Pendiente no es un hito que valga interrumpir con una vista.
  if (deducirEstado(evento, cfg) !== cfg.jira.estados.finalizado) return;

  const inventario = path.join(__dirname, 'inventario.js').replace(/\\/g, '/');
  const texto =
    `${clave} acaba de quedar ${cfg.jira.estados.finalizado}. Mostra el panel de la mesa de trabajo ` +
    'siguiendo el comando /duck:estado: corre ' +
    `\`node "${inventario}" <session_id>\` una sola vez, resolve la ` +
    `historia de ${clave} con searchJiraIssuesUsingJql (primero key = ${clave} ` +
    'para sacar el parent, despues parent = <padre> para las hermanas) y dibuja ' +
    'el panel. Es una vista: no transiciones nada mas, no crees ramas y no ' +
    'publiques en Jira. Si la historia quedo completa, decilo en una linea.';

  emitir(texto);
});

function panelGithub(evento, cfg) {
  const fin = cfg.github.estados.finalizado;
  const inventario = path.join(__dirname, 'inventario.js').replace(/\\/g, '/');
  const textos = movidasDeGithub(evento, cfg)
    .filter(({ estado }) => estado.toLowerCase() === fin.toLowerCase())
    .map(
      ({ clave }) =>
        `${clave} acaba de quedar ${fin}. Mostra el panel de la mesa de trabajo siguiendo el ` +
        `comando /duck:estado: corre \`node "${inventario}" <session_id>\` una sola vez, resolve la ` +
        `historia de ${clave} con \`node "${TICKET_JS}" ver ${clave}\` (el campo padre; despues ` +
        '`ver <padre>` para las hermanas, en hijas) y dibuja el panel. Es una vista: no muevas nada ' +
        'mas, no crees ramas y no comentes en GitHub. Si la historia quedo completa, decilo en una linea.'
    );
  if (textos.length) emitir(textos.join('\n\n'));
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
