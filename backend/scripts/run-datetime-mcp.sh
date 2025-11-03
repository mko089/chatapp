#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${SCRIPT_DIR}/../apps/datetime-mcp"

NODE_BIN="${NODE_BIN_OVERRIDE:-node}"

exec "$NODE_BIN" "${APP_DIR}/index.js"

