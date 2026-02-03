#!/usr/bin/env bash
set -euo pipefail

# Bump version across all files that contain a version string.
#
# Usage:
#   ./scripts/bump-version.sh 1.2.0        # set explicit version
#   ./scripts/bump-version.sh patch         # 1.1.3 -> 1.1.4
#   ./scripts/bump-version.sh minor         # 1.1.3 -> 1.2.0
#   ./scripts/bump-version.sh major         # 1.1.3 -> 2.0.0

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ $# -ne 1 ]; then
  echo "Usage: $0 <version|patch|minor|major>"
  exit 1
fi

# Read current version from package.json
CURRENT=$(node -p "require('$ROOT/package.json').version")

ARG="$1"
if [[ "$ARG" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  NEW_VERSION="$ARG"
elif [[ "$ARG" =~ ^(patch|minor|major)$ ]]; then
  IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"
  case "$ARG" in
    patch) PATCH=$((PATCH + 1)) ;;
    minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
    major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
  esac
  NEW_VERSION="$MAJOR.$MINOR.$PATCH"
else
  echo "Error: argument must be a semver version (e.g. 1.2.0) or bump type (patch|minor|major)"
  exit 1
fi

if [ "$CURRENT" = "$NEW_VERSION" ]; then
  echo "Version is already $CURRENT"
  exit 0
fi

echo "Bumping version: $CURRENT -> $NEW_VERSION"

# 1. package.json
sed -i "s/\"version\": \"$CURRENT\"/\"version\": \"$NEW_VERSION\"/" "$ROOT/package.json"

# 2. .claude-plugin/plugin.json
sed -i "s/\"version\": \"$CURRENT\"/\"version\": \"$NEW_VERSION\"/" "$ROOT/.claude-plugin/plugin.json"

# 3. .claude-plugin/marketplace.json
sed -i "s/\"version\": \"$CURRENT\"/\"version\": \"$NEW_VERSION\"/" "$ROOT/.claude-plugin/marketplace.json"

# 4. MCP server version in source
sed -i "s/version: '$CURRENT'/version: '$NEW_VERSION'/" "$ROOT/src/mcp/index.ts"

echo "Updated files:"
echo "  package.json"
echo "  .claude-plugin/plugin.json"
echo "  .claude-plugin/marketplace.json"
echo "  src/mcp/index.ts"
echo ""
echo "Version is now $NEW_VERSION"
