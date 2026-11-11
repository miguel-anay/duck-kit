# Instala los agentes del proyecto: copia ia/agentes/*.md a <raiz>/.claude/agents/, donde Claude los lee.
# ia/agentes es la fuente versionada; correrlo de nuevo refresca la copia (la pisa) tras un cambio o un
# agente nuevo. La raiz es la carpeta que contiene la de docs: el repo, o la carpeta madre con varios repos.
# Uso: powershell -ExecutionPolicy Bypass -File ia/instalar-agentes.ps1
$ErrorActionPreference = 'Stop'
$destino = Join-Path (Split-Path (Split-Path $PSScriptRoot)) '.claude/agents'
New-Item -ItemType Directory -Force -Path $destino | Out-Null
$agentes = Get-ChildItem -Path (Join-Path $PSScriptRoot 'agentes') -Filter *.md -File
if (-not $agentes) { Write-Output 'ia/agentes no tiene agentes (*.md)'; exit 0 }
foreach ($f in $agentes) {
  $copia = Join-Path $destino $f.Name
  if (-not (Test-Path $copia)) { $estado = 'nuevo' }
  elseif ((Get-FileHash $f.FullName).Hash -eq (Get-FileHash $copia).Hash) { $estado = 'igual' }
  else { $estado = 'actualizado' }
  Copy-Item $f.FullName $copia -Force
  Write-Output "$estado  $($f.Name)"
}
Write-Output "Agentes en $destino. Abrí una sesión nueva de Claude para que los cargue."
