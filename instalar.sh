#!/usr/bin/env bash
# Instala el plugin duck en esta maquina (Linux o macOS). Idempotente: sobre una maquina ya armada
# solo verifica y reporta. Es el equivalente de instalar.ps1, que es solo para Windows.
#
# Uso:   bash instalar.sh
#
# Hace tres cosas:
#   1. Registra este directorio como marketplace «duck-kit» e instala el plugin duck@duck-kit
#      (hooks, comandos /duck:..., skills, agentes y el panel).
#   2. Pone el «statusLine» en ~/.claude/settings.json, porque un plugin NO puede declararlo.
#      Lee y reescribe el JSON conservando todas las demas claves.
#   3. Te recuerda crear .claude/duck.json en cada proyecto (ver ejemplos/).
#
# Necesita: claude (Claude Code >= 2.1.287) y node en el PATH. No toca ningun proyecto.
# DUCK_AJUSTES permite apuntar a otro settings.json (para probar el paso 2 sin tocar el real).

set -euo pipefail

kit="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
plugin="$kit/plugins/duck"
sticker="$plugin/scripts/sticker.js"
ajustes="${DUCK_AJUSTES:-$HOME/.claude/settings.json}"

paso() { printf '\n\033[36m== %s\033[0m\n' "$1"; }
fallar() { printf 'ERROR: %s\n' "$1" >&2; exit 1; }

# --- 0. Requisitos ---------------------------------------------------------------------------------
paso 'Requisitos'
for programa in claude node; do
  command -v "$programa" >/dev/null 2>&1 \
    || fallar "No encuentro '$programa' en el PATH. Instalalo y volve a correr este script."
done
echo "claude: $(claude --version)"
echo "node:   $(node --version)"
[ -f "$plugin/.claude-plugin/plugin.json" ] \
  || fallar "No encuentro $plugin/.claude-plugin/plugin.json: ¿se movio el script fuera de duck-kit?"

# --- 1. Marketplace y plugin -----------------------------------------------------------------------
if [ -z "${DUCK_SOLO_STATUSLINE:-}" ]; then
  paso '1. Marketplace y plugin'
  if claude plugin marketplace list 2>&1 | grep -q 'duck-kit'; then
    echo "El marketplace duck-kit ya esta registrado: se deja como esta."
  else
    claude plugin marketplace add "$kit" || fallar "Fallo 'claude plugin marketplace add'."
  fi

  if claude plugin list 2>&1 | grep -q 'duck@duck-kit'; then
    echo "El plugin duck@duck-kit ya esta instalado: se deja como esta."
    echo "(Para traer cambios del kit:  claude plugin marketplace update duck-kit  y despues  claude plugin update duck@duck-kit)"
  else
    claude plugin install duck@duck-kit || fallar "Fallo 'claude plugin install'."
  fi
fi

# --- 2. statusLine ---------------------------------------------------------------------------------
paso "2. statusLine en $ajustes"

# Se usa node para leer y reescribir el JSON: conserva el contenido de las demas claves.
# Si el archivo existe y no parsea, node aborta antes de escribir: no se toca nada.
comando="node \"$sticker\""
node - "$ajustes" "$comando" <<'JS'
const fs = require('fs');
const path = require('path');
const [, , ruta, comando] = process.argv;
let datos = {};
if (fs.existsSync(ruta)) {
  const texto = fs.readFileSync(ruta, 'utf8').replace(/^﻿/, '');
  if (texto.trim() !== '') datos = JSON.parse(texto);
}
const nuevo = { type: 'command', command: comando, refreshInterval: 10, padding: 0 };
const actual = datos.statusLine;
if (actual && JSON.stringify(actual) === JSON.stringify(nuevo)) {
  console.log('El statusLine ya apuntaba a este kit.');
  process.exit(0);
}
if (actual) console.log('Reemplaza: ' + JSON.stringify(actual));
if (fs.existsSync(ruta) && !fs.existsSync(ruta + '.bak-duck')) {
  fs.copyFileSync(ruta, ruta + '.bak-duck'); // una copia, la primera vez
  console.log('Copia del original: ' + ruta + '.bak-duck');
}
fs.mkdirSync(path.dirname(ruta), { recursive: true });
datos.statusLine = nuevo;
fs.writeFileSync(ruta, JSON.stringify(datos, null, 2) + '\n');
console.log('statusLine -> ' + comando);
JS

# --- 3. Recordatorio -------------------------------------------------------------------------------
paso '3. Falta una cosa por proyecto'
cat <<EOF
duck no hace nada en un proyecto que no tenga .claude/duck.json (los hooks salen sin ruido).
Para activarlo en un proyecto:

  1. Copia un ejemplo de $kit/ejemplos/ a <proyecto>/.claude/duck.json
     (duck.ejemplo.json; ajusta clave de Jira, repos y estados).
     En Linux y macOS, pone  "acli": "acli"  : la ruta del ejemplo es de Windows.
  2. Agrega  .claude/estado/  al .gitignore del proyecto: ahi guardan su estado los hooks.
  3. Abri una sesion de Claude Code en el proyecto. Si el panel no aparece, /reload-plugins.

La referencia de cada campo esta en $plugin/README.md.
EOF
printf '\033[32mListo.\033[0m\n'
