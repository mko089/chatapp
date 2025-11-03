#!/usr/bin/env bash
set -euo pipefail

# Deploy chat.garden Caddy vhost alongside existing oazadashboard.garden.
# Usage: sudo bash scripts/caddy/deploy_chat_garden.sh

if [[ "${EUID}" -ne 0 ]]; then
  echo "[deploy] Please run as root, e.g.: sudo bash scripts/caddy/deploy_chat_garden.sh" >&2
  exit 1
fi

SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC_FILE="${SRC_DIR}/chat.garden.Caddyfile"
TARGET_MAIN="/etc/caddy/Caddyfile"
TARGET_SITES_DIR="/etc/caddy/sites"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"

if [[ ! -f "${SRC_FILE}" ]]; then
  echo "[deploy] Source file not found: ${SRC_FILE}" >&2
  exit 1
fi

echo "[deploy] Looking for existing oazadashboard config in /etc/caddy..."
grep -R "oazadashboard\.garden" /etc/caddy || true

# Decide mode: sites-enabled style vs monolithic Caddyfile
MODE="main"
if [[ -d "${TARGET_SITES_DIR}" ]] && grep -q "^\s*import\s\+/etc/caddy/sites" "${TARGET_MAIN}" 2>/dev/null; then
  MODE="sites"
fi

echo "[deploy] Detected mode: ${MODE}"

if [[ "${MODE}" == "sites" ]]; then
  DEST_FILE="${TARGET_SITES_DIR}/chat.garden.caddy"
  if [[ -f "${DEST_FILE}" ]]; then
    echo "[deploy] File already exists: ${DEST_FILE}. Aborting to avoid overwrite." >&2
    exit 1
  fi
  cp -v "${SRC_FILE}" "${DEST_FILE}"
else
  # Append to main Caddyfile if no existing chat.garden block
  if grep -q "chat\.garden" "${TARGET_MAIN}" 2>/dev/null; then
    echo "[deploy] chat.garden already present in ${TARGET_MAIN}. Aborting to avoid duplicate." >&2
    exit 1
  fi
  cp -v "${TARGET_MAIN}" "${TARGET_MAIN}.bak.${TIMESTAMP}"
  echo "" >> "${TARGET_MAIN}"
  echo "# --- chat.garden (added ${TIMESTAMP}) ---" >> "${TARGET_MAIN}"
  cat "${SRC_FILE}" >> "${TARGET_MAIN}"
fi

echo "[deploy] Validating Caddy config..."
caddy validate --config "${TARGET_MAIN}"

echo "[deploy] Reloading Caddy..."
systemctl reload caddy

echo "[deploy] Done. Quick checks:"
echo "  curl -I https://chat.garden || true"
echo "  curl -s https://chat.garden/api/health || true"

