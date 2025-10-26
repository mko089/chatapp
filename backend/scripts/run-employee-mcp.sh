#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_PARENT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
APP_ROOT_DEFAULT="$REPO_PARENT/EmployeeApp/apps/employee-mcp"
APP_ROOT="${EMPLOYEE_MCP_PATH:-$APP_ROOT_DEFAULT}"

if [[ ! -d "$APP_ROOT" ]]; then
  echo "Employee MCP directory not found: $APP_ROOT" >&2
  exit 1
fi

cd "$APP_ROOT"

NODE_BIN="${NODE_BIN_OVERRIDE:-$(command -v node || true)}"
if [[ -z "${NODE_BIN}" ]]; then
  echo "Unable to locate node binary" >&2
  exit 1
fi

if [[ -f dist/server.js ]]; then
  exec "$NODE_BIN" dist/server.js
fi

if [[ ! -f node_modules/tsx/dist/cli.mjs ]]; then
  echo "Missing tsx runtime; run 'npm install' inside $APP_ROOT" >&2
  exit 1
fi

exec "$NODE_BIN" node_modules/tsx/dist/cli.mjs src/server.ts
