#!/bin/sh
# Instala los agentes del proyecto: copia ia/agentes/*.md a <raiz>/.claude/agents/, donde Claude los lee.
# ia/agentes es la fuente versionada; correrlo de nuevo refresca la copia (la pisa) tras un cambio o un
# agente nuevo. La raiz es la carpeta que contiene la de docs: el repo, o la carpeta madre con varios repos.
set -eu
ia=$(cd "$(dirname "$0")" && pwd)
destino=$(cd "$ia/../.." && pwd)/.claude/agents
mkdir -p "$destino"
for f in "$ia"/agentes/*.md; do
  [ -e "$f" ] || { echo "ia/agentes no tiene agentes (*.md)"; exit 0; }
  nombre=$(basename "$f")
  if [ ! -e "$destino/$nombre" ]; then estado=nuevo
  elif cmp -s "$f" "$destino/$nombre"; then estado=igual
  else estado=actualizado; fi
  cp "$f" "$destino/$nombre"
  echo "$estado  $nombre"
done
echo "Agentes en $destino. Abrí una sesión nueva de Claude para que los cargue."
