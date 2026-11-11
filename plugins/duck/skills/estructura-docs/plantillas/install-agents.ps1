# Installs the project's agents: copies ai/agents/*.md to <root>/.claude/agents/, where Claude reads them.
# ai/agents is the versioned source; running it again refreshes the copy (overwrites it) after a change or a
# new agent. The root is the folder that holds the docs folder: the repo, or the parent folder of several repos.
# Usage: powershell -ExecutionPolicy Bypass -File ai/install-agents.ps1
$ErrorActionPreference = 'Stop'
$target = Join-Path (Split-Path (Split-Path $PSScriptRoot)) '.claude/agents'
New-Item -ItemType Directory -Force -Path $target | Out-Null
$agents = Get-ChildItem -Path (Join-Path $PSScriptRoot 'agents') -Filter *.md -File
if (-not $agents) { Write-Output 'ai/agents has no agents (*.md)'; exit 0 }
foreach ($f in $agents) {
  $copy = Join-Path $target $f.Name
  if (-not (Test-Path $copy)) { $state = 'new' }
  elseif ((Get-FileHash $f.FullName).Hash -eq (Get-FileHash $copy).Hash) { $state = 'unchanged' }
  else { $state = 'updated' }
  Copy-Item $f.FullName $copy -Force
  Write-Output "$state  $($f.Name)"
}
Write-Output "Agents in $target. Start a new Claude session so it loads them."
