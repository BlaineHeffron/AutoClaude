#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
SKILL_NAME="autoclaude-codex"
SKILL_SRC="$REPO_ROOT/codex-skill/$SKILL_NAME"
SKILL_DEST="$CODEX_HOME/skills/$SKILL_NAME"
MCP_NAME="autoclaude-memory"
MCP_ENTRY="$REPO_ROOT/dist/mcp/index.js"

if ! command -v codex >/dev/null 2>&1; then
  echo "Error: codex CLI is not installed or not on PATH."
  exit 1
fi

if [ ! -d "$SKILL_SRC" ]; then
  echo "Error: missing skill folder at $SKILL_SRC"
  exit 1
fi

echo "Building AutoClaude..."
npm run build >/dev/null

if [ ! -f "$MCP_ENTRY" ]; then
  echo "Error: MCP entrypoint was not built at $MCP_ENTRY"
  exit 1
fi

mkdir -p "$CODEX_HOME/skills"
rm -rf "$SKILL_DEST"
cp -R "$SKILL_SRC" "$SKILL_DEST"
echo "Installed Codex skill: $SKILL_DEST"

if codex mcp get "$MCP_NAME" >/dev/null 2>&1; then
  codex mcp remove "$MCP_NAME" >/dev/null
fi

codex mcp add "$MCP_NAME" -- node "$MCP_ENTRY" >/dev/null
echo "Configured MCP server: $MCP_NAME -> $MCP_ENTRY"

echo
echo "Done. Restart Codex to load the new skill."
