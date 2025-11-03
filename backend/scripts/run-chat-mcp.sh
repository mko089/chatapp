#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${SCRIPT_DIR}/../apps/chat-mcp"

NODE_BIN="${NODE_BIN_OVERRIDE:-$(command -v node)}"
if [[ -z "$NODE_BIN" ]]; then
  echo "Unable to locate node binary" >&2
  exit 1
fi

exec "$NODE_BIN" "${APP_DIR}/index.js"
