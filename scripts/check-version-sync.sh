#!/usr/bin/env bash
set -euo pipefail

# Verify all version strings are in sync.
# Used as a pre-commit hook to prevent version drift.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

PKG=$(node -p "require('$ROOT/package.json').version")
PLUGIN=$(node -p "require('$ROOT/.claude-plugin/plugin.json').version")
MARKETPLACE=$(node -p "require('$ROOT/.claude-plugin/marketplace.json').plugins[0].version")
MCP=$(grep -oP "version: '\K[0-9]+\.[0-9]+\.[0-9]+" "$ROOT/src/mcp/index.ts" | head -1)

ERRORS=0

if [ "$PKG" != "$PLUGIN" ]; then
  echo "Version mismatch: package.json ($PKG) != .claude-plugin/plugin.json ($PLUGIN)"
  ERRORS=1
fi

if [ "$PKG" != "$MARKETPLACE" ]; then
  echo "Version mismatch: package.json ($PKG) != .claude-plugin/marketplace.json ($MARKETPLACE)"
  ERRORS=1
fi

if [ "$PKG" != "$MCP" ]; then
  echo "Version mismatch: package.json ($PKG) != src/mcp/index.ts ($MCP)"
  ERRORS=1
fi

if [ "$ERRORS" -ne 0 ]; then
  echo ""
  echo "Run ./scripts/bump-version.sh <version> to sync all version strings."
  exit 1
fi
