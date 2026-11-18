// Enlaza la unidad de trabajo propia del proyecto (SPEC-002, ver trabajo en duck.json) con el
// ticket de Jira que la sigue (GPDEV-123). Lo corre /duck:tomar cuando la spec declara `jira:`.
//
//   node enlace.js <unidad> <jira>   imprime «Enlace SPEC-002 -> GPDEV-123»
//
// No escribe nada: la linea de exito es el hecho que estado-tarea.js anota en la sesion, como con
// las transiciones. Un script no sabe en que sesion corre; el hook si.
const { cargar } = require('./config');

const [unidad, jira] = process.argv.slice(2);
const cfg = cargar();
if (!cfg?.trabajo.propio) fallar('el proyecto no declara trabajo en duck.json: la unidad ya es el ticket');
if (!cfg.trabajo.reClaveExacta.test(unidad ?? '')) fallar(`${unidad ?? '(nada)'} no es una clave de ${cfg.trabajo.clave}`);
if (!cfg.jira.reClaveExacta.test(jira ?? '') || cfg.trabajo.reClaveExacta.test(jira)) fallar(`${jira ?? '(nada)'} no es una clave de Jira`);
console.log(`Enlace ${unidad} -> ${jira}`);

function fallar(motivo) {
  console.error(`enlace.js: ${motivo}. Uso: node enlace.js <unidad> <jira>`);
  process.exit(1);
}
