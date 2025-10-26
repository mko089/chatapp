#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_PARENT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
APP_ROOT_DEFAULT="$REPO_PARENT/gardenknowledge/apps/garden-mcp"
APP_ROOT="${GARDEN_MCP_PATH:-$APP_ROOT_DEFAULT}"

if [[ ! -d "$APP_ROOT" ]]; then
  echo "Garden MCP directory not found: $APP_ROOT" >&2
  exit 1
fi

cd "$APP_ROOT"

NODE_BIN="${NODE_BIN_OVERRIDE:-$(command -v node || true)}"
if [[ -z "$NODE_BIN" ]]; then
  echo "Unable to locate node binary" >&2
  exit 1
fi

if [[ ! -f dist/server.js ]]; then
  if [[ -f package.json ]]; then
    npm run build >/dev/null 2>&1 || {
      echo "Failed to build garden MCP server" >&2
      exit 1
    }
  fi
fi

if [[ -f dist/server.js ]]; then
  exec "$NODE_BIN" dist/server.js
fi

if [[ -f node_modules/tsx/dist/cli.mjs ]]; then
  exec "$NODE_BIN" node_modules/tsx/dist/cli.mjs src/server.ts
fi

echo "Unable to locate build artifacts or tsx runtime for garden MCP" >&2
exit 1
