#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_PARENT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
APP_ROOT_DEFAULT="$REPO_PARENT/metersapp/apps/meters-mcp"
APP_ROOT="${METERS_MCP_PATH:-$APP_ROOT_DEFAULT}"

if [[ ! -d "$APP_ROOT" ]]; then
  echo "Meters MCP directory not found: $APP_ROOT" >&2
  exit 1
fi

cd "$APP_ROOT"

NODE_BIN="${NODE_BIN_OVERRIDE:-$(command -v node || true)}"
if [[ -z "$NODE_BIN" ]]; then
  echo "Unable to locate node binary" >&2
  exit 1
fi

# Prefer built JS if available
if [[ -f dist/server.js ]]; then
  exec "$NODE_BIN" dist/server.js
fi

# Attempt to build if package.json present
if [[ -f package.json ]]; then
  # Try a quick install/build; ignore failures to fall back to tsx
  npm run build >/dev/null 2>&1 || true
fi

if [[ -f dist/server.js ]]; then
  exec "$NODE_BIN" dist/server.js
fi

# Try local repo tsx first
if [[ -f node_modules/tsx/dist/cli.mjs ]]; then
  exec "$NODE_BIN" node_modules/tsx/dist/cli.mjs src/server.ts
fi

# Fallback: use chatapp's tsx if available
CHATAPP_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FALLBACK_TSX="$CHATAPP_ROOT/node_modules/tsx/dist/cli.mjs"
if [[ -f "$FALLBACK_TSX" ]]; then
  exec "$NODE_BIN" "$FALLBACK_TSX" src/server.ts
fi

echo "Unable to run meters MCP (no dist build or tsx runtime). Run 'npm install && npm run build' in $APP_ROOT" >&2
exit 1

