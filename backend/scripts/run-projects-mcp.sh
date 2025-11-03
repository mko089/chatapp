#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

NODE_BIN="${NODE_BIN_OVERRIDE:-$(command -v node || true)}"
if [[ -z "$NODE_BIN" ]]; then
  echo "Unable to locate node binary" >&2
  exit 1
fi

APP_ROOT="$SCRIPT_DIR/.."
ENTRY="$APP_ROOT/apps/projects-mcp/index.js"

if [[ ! -f "$ENTRY" ]]; then
  echo "Projects MCP entry not found: $ENTRY" >&2
  exit 1
fi

exec "$NODE_BIN" "$ENTRY"

