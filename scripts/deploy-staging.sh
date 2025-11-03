#!/usr/bin/env bash
set -euo pipefail

# ChatApp staging deploy helper (MicroK8s-friendly)
# - Builds backend/frontend images (unless SKIP_BUILD=1)
# - Pushes to local registry (default: localhost:32000)
# - Helm upgrade/install to namespace chat with staging values
#
# Usage:
#   OPENAI_API_KEY=sk-... ALLOWED_IPS="1.2.3.4,5.6.7.8" \
#   REGISTRY=localhost:32000 VERSION=v0.1.0 \
#   bash chatapp/scripts/deploy-staging.sh
#
# Env vars:
#   REGISTRY           Image registry (default: localhost:32000)
#   VERSION            Base version tag (default: v0.1.0)
#   BACKEND_TAG        Backend image tag (default: $VERSION)
#   FRONTEND_TAG       Frontend image tag (default: ${VERSION}-staging)
#   OPENAI_API_KEY     Secret passed to backend as Helm --set
#   ALLOWED_IPS        Comma-separated IPs for backend access (optional)
#   SKIP_BUILD         When set to 1, skips docker build/push

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

# Load optional envs
# 1) project .env (ignored by git)
if [[ -f "${ROOT_DIR}/.env" ]]; then
  set +u
  # shellcheck disable=SC1090
  source "${ROOT_DIR}/.env"
  set -u
fi
# 2) shared deploy env (ignored by git)
if [[ -f "${ROOT_DIR}/scripts/deploy.env" ]]; then
  # shellcheck disable=SC1090
  source "${ROOT_DIR}/scripts/deploy.env"
fi

REGISTRY=${REGISTRY:-localhost:32000}
VERSION=${VERSION:-v0.1.0}
BACKEND_TAG=${BACKEND_TAG:-${VERSION}}
FRONTEND_TAG=${FRONTEND_TAG:-${VERSION}-staging}

HELM_VALUES="${ROOT_DIR}/deploy/helm/values-staging.yaml"
CHART_PATH="${ROOT_DIR}/deploy/helm/chatapp"
RELEASE_NAME="chatapp-staging"
NAMESPACE="chat"

need_bin() {
  command -v "$1" >/dev/null 2>&1 || { echo "[err] Missing dependency: $1" >&2; exit 1; }
}

pick_helm() {
  if command -v microk8s >/dev/null 2>&1 && microk8s helm3 version >/dev/null 2>&1; then
    echo "microk8s helm3"
  else
    echo "helm"
  fi
}

pick_kubectl() {
  if command -v microk8s >/dev/null 2>&1 && microk8s kubectl version --client >/dev/null 2>&1; then
    echo "microk8s kubectl"
  else
    echo "kubectl"
  fi
}

HELM_BIN=$(pick_helm)
KUBECTL_BIN=$(pick_kubectl)

echo "[i] Using HELM_BIN=${HELM_BIN} KUBECTL_BIN=${KUBECTL_BIN}"

if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  need_bin docker
  echo "[i] Building backend: ${REGISTRY}/chatapp-backend:${BACKEND_TAG}"
  docker build -t "${REGISTRY}/chatapp-backend:${BACKEND_TAG}" -f "${ROOT_DIR}/backend/Dockerfile" "${ROOT_DIR}"
  docker push "${REGISTRY}/chatapp-backend:${BACKEND_TAG}"

  echo "[i] Building frontend: ${REGISTRY}/chatapp-frontend:${FRONTEND_TAG}"
  docker build -t "${REGISTRY}/chatapp-frontend:${FRONTEND_TAG}" -f "${ROOT_DIR}/frontend/Dockerfile" "${ROOT_DIR}"
  docker push "${REGISTRY}/chatapp-frontend:${FRONTEND_TAG}"
else
  echo "[i] SKIP_BUILD=1 → skipping docker build/push"
fi

HELM_SET=(
  "--set" "image.registry=${REGISTRY}"
  "--set" "image.backend.tag=${BACKEND_TAG}"
  "--set" "image.frontend.tag=${FRONTEND_TAG}"
)

if [[ -z "${OPENAI_API_KEY:-}" && -n "${OPENAI_API_KEY_FROM_ENV:-}" ]]; then
  OPENAI_API_KEY="${OPENAI_API_KEY_FROM_ENV}"
fi
if [[ -n "${OPENAI_API_KEY:-}" ]]; then
  HELM_SET+=("--set-string" "backend.secretEnv.OPENAI_API_KEY=${OPENAI_API_KEY}")
else
  echo "[warn] OPENAI_API_KEY not set – backend może nie działać w pełni (staging)." >&2
fi

if [[ -z "${ALLOWED_IPS:-}" && -n "${ALLOWED_IPS_DEFAULT:-}" ]]; then
  ALLOWED_IPS="${ALLOWED_IPS_DEFAULT}"
fi
if [[ -n "${ALLOWED_IPS:-}" ]]; then
  ALLOWED_IPS_ESCAPED="${ALLOWED_IPS//,/\\,}"
  HELM_SET+=("--set-string" "backend.secretEnv.ALLOWED_IPS=${ALLOWED_IPS_ESCAPED}")
fi

echo "[i] Deploying ${RELEASE_NAME} to namespace ${NAMESPACE}"
${HELM_BIN} upgrade --install "${RELEASE_NAME}" "${CHART_PATH}" -n "${NAMESPACE}" --create-namespace -f "${HELM_VALUES}" "${HELM_SET[@]}"

echo "[i] Waiting for rollout..."
${KUBECTL_BIN} rollout status deploy/${RELEASE_NAME}-chatapp-backend -n "${NAMESPACE}" --timeout=120s || true
${KUBECTL_BIN} rollout status deploy/${RELEASE_NAME}-chatapp-frontend -n "${NAMESPACE}" --timeout=120s || true

echo "[i] Services:"
${KUBECTL_BIN} get svc -n "${NAMESPACE}"

echo "[i] Ingress:"
${KUBECTL_BIN} get ingress -n "${NAMESPACE}"

echo "[ok] Done. Test: curl http://chat-staging.garden/api/health"
