#!/bin/sh
# Installs the project's agents: copies ai/agents/*.md to <root>/.claude/agents/, where Claude reads them.
# ai/agents is the versioned source; running it again refreshes the copy (overwrites it) after a change or a
# new agent. The root is the folder that holds the docs folder: the repo, or the parent folder of several repos.
set -eu
ai=$(cd "$(dirname "$0")" && pwd)
target=$(cd "$ai/../.." && pwd)/.claude/agents
mkdir -p "$target"
for f in "$ai"/agents/*.md; do
  [ -e "$f" ] || { echo "ai/agents has no agents (*.md)"; exit 0; }
  name=$(basename "$f")
  if [ ! -e "$target/$name" ]; then state=new
  elif cmp -s "$f" "$target/$name"; then state=unchanged
  else state=updated; fi
  cp "$f" "$target/$name"
  echo "$state  $name"
done
echo "Agents in $target. Start a new Claude session so it loads them."
