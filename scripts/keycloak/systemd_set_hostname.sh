#!/usr/bin/env bash
set -euo pipefail

# Configure Keycloak (Quarkus) hostname/proxy settings via systemd override.
# Requires: sudo/root.
#
# Usage (examples):
#   sudo KC_HOST=chat.garden KC_PATH=/ bash scripts/keycloak/systemd_set_hostname.sh
#   sudo KC_HOST=chat.garden KC_PATH=/auth bash scripts/keycloak/systemd_set_hostname.sh
#
# Variables (with defaults):
KC_HOST=${KC_HOST:-chat.garden}
KC_PATH=${KC_PATH:-/}
SERVICE=${SERVICE:-keycloak}

echo "[kc] Creating systemd override for ${SERVICE} …"
DIR="/etc/systemd/system/${SERVICE}.service.d"
FILE="${DIR}/override.conf"
mkdir -p "${DIR}"
cat > "${FILE}" <<EOF
[Service]
Environment=KC_PROXY_HEADERS=xforwarded
Environment=KC_HOSTNAME=${KC_HOST}
Environment=KC_HOSTNAME_STRICT_HTTPS=true
Environment=KC_HTTP_RELATIVE_PATH=${KC_PATH}
# If running legacy/Wildfly Keycloak, uncomment:
# Environment=PROXY_ADDRESS_FORWARDING=true
EOF

echo "[kc] Written: ${FILE}"
systemctl daemon-reload
echo "[kc] Restarting ${SERVICE} …"
systemctl restart "${SERVICE}"
echo "[kc] ${SERVICE} restarted."

echo "[kc] Tip: verify discovery now matches expected host/scheme. For example:"
echo "  curl -ks https://${KC_HOST}${KC_PATH%/}/realms/garden/.well-known/openid-configuration | jq '{issuer,authorization_endpoint,token_endpoint}'"

