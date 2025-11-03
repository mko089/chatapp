#!/usr/bin/env bash
set -euo pipefail

# Dev-friendly defaults: open IPs, public endpoints, auth disabled, local API URL
export ALLOWED_IPS=${ALLOWED_IPS:-192.168.2.145,192.168.4.170}
export AUTH_PUBLIC_PATHS=${AUTH_PUBLIC_PATHS:-"GET /health,GET /mcp/tools,GET /sessions,GET /metrics/cost"}
export KEYCLOAK_ENABLED=${KEYCLOAK_ENABLED:-false}
export VITE_KEYCLOAK_ENABLED=${VITE_KEYCLOAK_ENABLED:-false}
export VITE_CHATAPI_URL=${VITE_CHATAPI_URL:-http://localhost:4025}
export RBAC_ENABLED=${RBAC_ENABLED:-true}
export RBAC_OWNER_USERS=${RBAC_OWNER_USERS:-marcin,marcin@garden.local}

echo "Starting dev stack with:"
echo "  ALLOWED_IPS=$ALLOWED_IPS"
echo "  AUTH_PUBLIC_PATHS=$AUTH_PUBLIC_PATHS"
echo "  KEYCLOAK_ENABLED=$KEYCLOAK_ENABLED"
echo "  VITE_KEYCLOAK_ENABLED=$VITE_KEYCLOAK_ENABLED"
echo "  VITE_CHATAPI_URL=$VITE_CHATAPI_URL"

docker compose up --build
