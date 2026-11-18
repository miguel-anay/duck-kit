// La norma del proyecto de la que salieron trabajo, commits y ramas en duck.json (#42).
//
//   node norma.js hash <archivo>   sha256:<hex> del archivo (relativo a la raiz), sin importar los
//                                  finales de linea. Lo guarda /duck:iniciar en norma.hash.
//   node norma.js revisar          una linea de aviso si la norma cambio o ya no esta; nada si sigue
//                                  igual o duck.json no guarda hash. La corre /duck:estado.
//
// Solo avisa: decidir que cambia en duck.json es de la persona, con /duck:iniciar.
const path = require('path');
const { cargar, hashNorma, derivaDeNorma } = require('./config');

const [accion, archivo] = process.argv.slice(2);
const cfg = cargar();
if (!cfg) process.exit(0);

if (accion === 'hash' && archivo) {
  try {
    console.log(hashNorma(path.resolve(cfg.raiz, archivo)));
  } catch (e) {
    console.error(`norma.js: no se pudo leer ${archivo} (${e.code ?? e.message})`);
    process.exit(1);
  }
} else if (accion === 'revisar') {
  const aviso = derivaDeNorma(cfg);
  if (aviso) console.log(aviso);
} else {
  console.error('Uso: node norma.js hash <archivo> | node norma.js revisar');
  process.exit(1);
}
