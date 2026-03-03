#!/usr/bin/env bash

set -euo pipefail

CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
SKILL_NAME="autoclaude-codex"
SKILL_DEST="$CODEX_HOME/skills/$SKILL_NAME"
MCP_NAME="autoclaude-memory"

if ! command -v codex >/dev/null 2>&1; then
  echo "Error: codex CLI is not installed or not on PATH."
  exit 1
fi

if codex mcp get "$MCP_NAME" >/dev/null 2>&1; then
  codex mcp remove "$MCP_NAME" >/dev/null
  echo "Removed legacy MCP server: $MCP_NAME"
fi

if [ -d "$SKILL_DEST" ]; then
  rm -rf "$SKILL_DEST"
  echo "Removed legacy Codex skill: $SKILL_DEST"
fi

echo
echo "Codex no longer needs AutoClaude memory wiring."
echo "No Codex MCP server or skill was installed."
echo "Restart Codex if it is currently running."
