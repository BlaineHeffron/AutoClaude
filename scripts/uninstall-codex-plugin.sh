#!/usr/bin/env bash

set -euo pipefail

CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
SKILL_NAME="autoclaude-codex"
SKILL_DEST="$CODEX_HOME/skills/$SKILL_NAME"
MCP_NAME="autoclaude-memory"

if command -v codex >/dev/null 2>&1; then
  if codex mcp get "$MCP_NAME" >/dev/null 2>&1; then
    codex mcp remove "$MCP_NAME" >/dev/null
    echo "Removed MCP server: $MCP_NAME"
  fi
fi

if [ -d "$SKILL_DEST" ]; then
  rm -rf "$SKILL_DEST"
  echo "Removed Codex skill: $SKILL_DEST"
fi

echo "Done."
