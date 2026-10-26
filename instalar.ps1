# Instala el plugin duck en esta maquina. Idempotente: sobre una maquina ya armada solo verifica y reporta.
#
# Uso (PowerShell 5.1 o 7):   pwsh -File instalar.ps1      (o:  powershell -File instalar.ps1)
#
# Hace tres cosas:
#   1. Registra este directorio como marketplace «duck-kit» e instala el plugin duck@duck-kit
#      (hooks, comandos /duck:..., skills, agentes y el panel).
#   2. Pone el «statusLine» en ~/.claude/settings.json, porque un plugin NO puede declararlo.
#      Lee y reescribe el JSON conservando todas las demas claves, sin BOM.
#   3. Te recuerda configurar cada proyecto con /duck:iniciar.
#
# Necesita: claude (Claude Code >= 2.1.287) y node en el PATH. No toca ningun proyecto.

$ErrorActionPreference = 'Stop'

$kit = $PSScriptRoot
$plugin = Join-Path $kit 'plugins\duck'
$sticker = (Join-Path $plugin 'scripts\sticker.js') -replace '\\', '/'
$ajustes = Join-Path $env:USERPROFILE '.claude\settings.json'

function Paso($texto) { Write-Host "`n== $texto" -ForegroundColor Cyan }

# --- 0. Requisitos ---------------------------------------------------------------------------------
Paso 'Requisitos'
foreach ($programa in 'claude', 'node') {
    if (-not (Get-Command $programa -ErrorAction SilentlyContinue)) {
        throw "No encuentro '$programa' en el PATH. Instalalo y volve a correr este script."
    }
}
Write-Host ("claude: " + (& claude --version))
Write-Host ("node:   " + (& node --version))
if (-not (Test-Path (Join-Path $plugin '.claude-plugin\plugin.json'))) {
    throw "No encuentro $plugin\.claude-plugin\plugin.json: ¿se movio el script fuera de duck-kit?"
}

# --- 1. Marketplace y plugin -----------------------------------------------------------------------
Paso '1. Marketplace y plugin'
$marketplaces = (& claude plugin marketplace list 2>&1 | Out-String)
if ($marketplaces -match 'duck-kit') {
    Write-Host "El marketplace duck-kit ya esta registrado: se deja como esta."
} else {
    & claude plugin marketplace add $kit
    if ($LASTEXITCODE -ne 0) { throw "Fallo 'claude plugin marketplace add' (codigo $LASTEXITCODE)." }
}

$plugins = (& claude plugin list 2>&1 | Out-String)
if ($plugins -match 'duck@duck-kit') {
    Write-Host "El plugin duck@duck-kit ya esta instalado: se deja como esta."
    Write-Host "(Para traer cambios del kit:  claude plugin marketplace update duck-kit  y despues  claude plugin update duck@duck-kit)"
} else {
    & claude plugin install duck@duck-kit
    if ($LASTEXITCODE -ne 0) { throw "Fallo 'claude plugin install' (codigo $LASTEXITCODE)." }
}

# --- 2. statusLine ---------------------------------------------------------------------------------
Paso '2. statusLine en ~/.claude/settings.json'

# Se usa node para leer y reescribir el JSON: conserva el orden y el contenido de las demas claves
# (ConvertTo-Json de Windows PowerShell 5.1 las reformatea y escapa caracteres) y escribe UTF-8 sin BOM.
$editor = @'
const fs = require('fs');
const path = require('path');
const [, , ruta, comando] = process.argv;
let datos = {};
if (fs.existsSync(ruta)) {
  const texto = fs.readFileSync(ruta, 'utf8').replace(/^﻿/, '');
  if (texto.trim() !== '') datos = JSON.parse(texto); // si no parsea, aborta sin tocar nada
}
const nuevo = { type: 'command', command: comando, refreshInterval: 10, padding: 0 };
const actual = datos.statusLine;
if (actual && JSON.stringify(actual) === JSON.stringify(nuevo)) {
  console.log('IGUAL');
  process.exit(0);
}
if (actual) console.log('REEMPLAZA ' + JSON.stringify(actual));
if (fs.existsSync(ruta)) fs.copyFileSync(ruta, ruta + '.bak-duck'); // una copia, la primera vez
fs.mkdirSync(path.dirname(ruta), { recursive: true });
datos.statusLine = nuevo;
fs.writeFileSync(ruta, JSON.stringify(datos, null, 2) + '\n');
console.log('ESCRITO');
'@
$temporal = Join-Path $env:TEMP 'duck-instalar-statusline.js'
[System.IO.File]::WriteAllText($temporal, $editor, (New-Object System.Text.UTF8Encoding($false)))
try {
    $comando = "node `"$sticker`""
    $resultado = & node $temporal $ajustes $comando
    if ($LASTEXITCODE -ne 0) { throw "No pude actualizar $ajustes (¿JSON invalido?). No se toco nada." }
    $resultado | ForEach-Object { Write-Host $_ }
    if ($resultado -contains 'IGUAL') {
        Write-Host "El statusLine ya apuntaba a este kit."
    } else {
        Write-Host "statusLine -> $comando"
        Write-Host "Copia del original (si existia): $ajustes.bak-duck"
    }
} finally {
    Remove-Item $temporal -ErrorAction SilentlyContinue
}

# --- 3. Recordatorio -------------------------------------------------------------------------------
Paso '3. Falta una cosa por proyecto'
Write-Host @"
duck no hace nada en un proyecto que no tenga .claude/duck.json (los hooks salen sin ruido).
Para activarlo en un proyecto:

  1. Abri una sesion de Claude Code en el proyecto y corre  /duck:iniciar  : detecta repos, rama
     base y Jira, te pregunta lo propio del proyecto, y escribe .claude/duck.json y sus convenciones.
  2. /reload-plugins (o una sesion nueva) para que los hooks y el panel lean la configuracion.

  A mano: copia $kit\plugins\duck\plantillas\duck.ejemplo.json a <proyecto>\.claude\duck.json.

La referencia de cada campo esta en $kit\plugins\duck\README.md.
"@
Write-Host "Listo." -ForegroundColor Green
