#!/usr/bin/env bash
set -euo pipefail

# Set Keycloak realm Frontend URL via Admin REST (works with Quarkus KC).
# Usage:
#   KEYCLOAK_BASE="http://192.168.14.55:8080" \
#   KC_USER="admin" KC_PASS="$KEYCLOAK_ADMIN_PASSWORD" \
#   REALM="garden" FRONTEND_URL="https://chat.garden/auth" \
#   bash scripts/keycloak/set_realm_frontend_url.sh

KEYCLOAK_BASE=${KEYCLOAK_BASE:-"http://192.168.14.55:8080"}
KC_USER=${KC_USER:-admin}
KC_PASS=${KC_PASS:-""}
REALM=${REALM:-garden}
FRONTEND_URL=${FRONTEND_URL:-"https://chat.garden/auth"}

if [[ -z "$KC_PASS" ]]; then
  echo "KC_PASS is required" >&2
  exit 1
fi

echo "[kc] Getting admin token from ${KEYCLOAK_BASE} ..."
TOKEN=$(curl -sS \
  -d grant_type=password \
  -d client_id=admin-cli \
  -d username="${KC_USER}" \
  -d password="${KC_PASS}" \
  "${KEYCLOAK_BASE}/realms/master/protocol/openid-connect/token" | jq -r .access_token)

if [[ -z "$TOKEN" || "$TOKEN" == "null" ]]; then
  echo "[kc] Failed to get admin token" >&2
  exit 1
fi

echo "[kc] Current realm settings (frontendUrl before):"
curl -sS -H "Authorization: Bearer ${TOKEN}" "${KEYCLOAK_BASE}/admin/realms/${REALM}" | jq '.frontendUrl // null'

echo "[kc] Updating realm frontendUrl to ${FRONTEND_URL} ..."
curl -sS -X PUT \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  --data "{\"frontendUrl\":\"${FRONTEND_URL}\"}" \
  "${KEYCLOAK_BASE}/admin/realms/${REALM}" -o /dev/null -w "%{http_code}\n"

echo "[kc] Verifying issuer after update:"
curl -sS "${FRONTEND_URL%/}/realms/${REALM}/.well-known/openid-configuration" | jq '{issuer, authorization_endpoint, token_endpoint}'

echo "[kc] Done. If issuer is still not https://chat.garden/auth/realms/${REALM}, check reverse proxy headers and KC hostname settings."

