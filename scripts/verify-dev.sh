#!/usr/bin/env bash
set -euo pipefail

# Quick preflight for local dev. Validates .env + runtime-config.js and Keycloak reachability.
# Usage: bash scripts/verify-dev.sh

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
RC_FILE="$ROOT_DIR/frontend/public/runtime-config.js"

function read_env() {
  local key="$1"
  # shellcheck disable=SC2162
  grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | tail -n1 | cut -d'=' -f2-
}

function read_rc() {
  local key="$1"
  # Cheap parse (OK for our static format). Extract value after `${key}:` and strip quotes/comma.
  grep -E "^[[:space:]]*${key}:" "$RC_FILE" 2>/dev/null | head -n1 | sed -E "s/.*${key}:[[:space:]]*//; s/[',]\s*$//; s/'//g; s/\r$//"
}

echo "[i] Checking files:"
echo " - $ENV_FILE"
echo " - $RC_FILE"

ENV_URL=$(read_env VITE_KEYCLOAK_URL || true)
ENV_REALM=$(read_env VITE_KEYCLOAK_REALM || true)
ENV_CLIENT=$(read_env VITE_KEYCLOAK_CLIENT_ID || true)
ENV_REQUIRE=$(read_env VITE_REQUIRE_AUTH || echo "true")

RC_URL=$(read_rc url || true)
RC_REALM=$(read_rc realm || true)
RC_CLIENT=$(read_rc clientId || true)

pick() {
  local a="$1"; shift || true
  if [ -n "${a// /}" ]; then echo "$a"; return; fi
  for v in "$@"; do
    if [ -n "${v// /}" ]; then echo "$v"; return; fi
  done
  echo ""
}

EFF_URL=$(pick "$RC_URL" "$ENV_URL")
EFF_REALM=$(pick "$RC_REALM" "$ENV_REALM")
EFF_CLIENT=$(pick "$RC_CLIENT" "$ENV_CLIENT")

echo "[i] Resolved config (runtime -> env fallbacks):"
printf "  keycloak.url     = %s\n" "${EFF_URL:-<empty>}"
printf "  keycloak.realm   = %s\n" "${EFF_REALM:-<empty>}"
printf "  keycloak.client  = %s\n" "${EFF_CLIENT:-<empty>}"
printf "  requireAuth      = %s\n" "${ENV_REQUIRE:-true}"

FAIL=0
if [ "${ENV_REQUIRE:-true}" != "false" ] && { [ -z "${EFF_URL// /}" ] || [ -z "${EFF_REALM// /}" ] || [ -z "${EFF_CLIENT// /}" ]; }; then
  echo "[FAIL] Missing Keycloak config while requireAuth is enabled."
  FAIL=1
fi

if [ $FAIL -eq 0 ] && [ -n "${EFF_URL// /}" ] && [ -n "${EFF_REALM// /}" ]; then
  OIDC_URL="${EFF_URL%/}/realms/${EFF_REALM}/.well-known/openid-configuration"
  echo "[i] Probing OpenID configuration: $OIDC_URL"
  if curl -fsSL --max-time 3 "$OIDC_URL" >/dev/null; then
    echo "[OK] Keycloak reachable."
  else
    echo "[WARN] Keycloak not reachable (curl failed). Check URL or container."
  fi
fi

echo "[i] Recommendations:"
echo " - Ensure Keycloak client 'chatapp-frontend' has Redirect URI: http://<DEV-IP>:4225/* and Web Origins: http://<DEV-IP>:4225"
echo " - If using runtime-config, do not leave keycloak.url/realm/clientId empty"

if [ $FAIL -ne 0 ]; then
  exit 1
fi
echo "[OK] verify-dev completed."
