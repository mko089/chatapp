#!/usr/bin/env bash
set -euo pipefail

# Rewrites /etc/caddy/Caddyfile to a minimal config for chat.garden only
# - Removes the default :80 site block
# - Keeps LAN HTTPS vhost with custom cert
# - Proxies /api to backend :3025 and /auth to Keycloak :8080
# - Serves static frontend from frontend/dist for /
#
# Usage:
#   sudo BIND_IP=192.168.14.55 CERT=/etc/ssl/caddy/chat.garden.crt KEY=/etc/ssl/caddy/chat.garden.key \
#     bash scripts/caddy/update_caddyfile_minimal.sh
#
# Defaults (override via env):
BIND_IP=${BIND_IP:-192.168.14.55}
CERT=${CERT:-/etc/ssl/caddy/chat.garden.crt}
KEY=${KEY:-/etc/ssl/caddy/chat.garden.key}
DIST_DIR=${DIST_DIR:-/home/ubuntu/Projects/chatapp/frontend/dist}
KC_UPSTREAM=${KC_UPSTREAM:-192.168.14.55:8080}

if [[ $EUID -ne 0 ]]; then
  echo "[update] Please run as root, e.g. sudo BIND_IP=$BIND_IP bash $0" >&2
  exit 1
fi

if [[ ! -f "$CERT" || ! -f "$KEY" ]]; then
  echo "[update] Missing cert/key: CERT=$CERT, KEY=$KEY" >&2
  exit 1
fi

timestamp=$(date +%Y%m%d-%H%M%S)
src=/etc/caddy/Caddyfile
bak=/etc/caddy/Caddyfile.bak.$timestamp

cp -v "$src" "$bak" || true

cat > "$src" <<EOF
http://chat.garden {
  bind ${BIND_IP}
  redir https://chat.garden{uri} permanent
}

https://chat.garden {
  bind ${BIND_IP}
  tls ${CERT} ${KEY}

  encode zstd gzip

  # API under /api -> backend :3025
  @api path /api/*
  handle @api {
    uri strip_prefix /api
    reverse_proxy 127.0.0.1:3025
  }

  # Keycloak under /auth -> upstream :8080
  @kc path /auth*
  handle @kc {
    uri strip_prefix /auth
    reverse_proxy ${KC_UPSTREAM}
  }

  # Static frontend
  handle {
    root * ${DIST_DIR}
    try_files {path} /index.html
    file_server
  }
}
EOF

echo "[update] Validating Caddyfile..."
caddy validate --config "$src"

echo "[update] Reloading caddy..."
systemctl reload caddy

echo "[update] Done. Test endpoints:"
echo "  curl -kI https://chat.garden"
echo "  curl -ks https://chat.garden/api/health | jq ."

