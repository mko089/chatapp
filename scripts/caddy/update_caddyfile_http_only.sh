#!/usr/bin/env bash
set -euo pipefail

# Write HTTP-only Caddyfile for chat.garden (LAN), no TLS, with API/KC routing and static frontend.
# Usage: sudo BIND_IP=192.168.14.55 DIST_DIR=/home/ubuntu/Projects/chatapp/frontend/dist KC_UPSTREAM=192.168.14.55:8080 bash scripts/caddy/update_caddyfile_http_only.sh

BIND_IP=${BIND_IP:-192.168.14.55}
DIST_DIR=${DIST_DIR:-/home/ubuntu/Projects/chatapp/frontend/dist}
KC_UPSTREAM=${KC_UPSTREAM:-192.168.14.55:8080}

SRC=/etc/caddy/Caddyfile
BAK=/etc/caddy/Caddyfile.bak.$(date +%Y%m%d-%H%M%S)

if [[ $EUID -ne 0 ]]; then
  echo "Run as root: sudo BIND_IP=$BIND_IP bash $0" >&2
  exit 1
fi

cp -v "$SRC" "$BAK" || true

cat > "$SRC" <<EOF
http://chat.garden {
  bind ${BIND_IP}

  encode zstd gzip

  @api path /api/*
  handle @api {
    uri strip_prefix /api
    reverse_proxy 127.0.0.1:3025
  }

  @kc path /auth*
  handle @kc {
    uri strip_prefix /auth
    reverse_proxy ${KC_UPSTREAM}
  }

  @kc2 path /realms/*
  handle @kc2 {
    reverse_proxy ${KC_UPSTREAM}
  }

  handle {
    root * ${DIST_DIR}
    try_files {path} /index.html
    file_server
  }
}
EOF

caddy validate --config "$SRC"
systemctl reload caddy
echo "[ok] HTTP-only Caddyfile applied. Test: curl -I http://chat.garden ; curl -s http://chat.garden/api/health"

