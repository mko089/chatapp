#!/usr/bin/env bash
set -euo pipefail

BASE=${BASE:-http://192.168.14.55:4025}
VIEWER_TOKEN=${VIEWER_TOKEN:-}
ADMIN_TOKEN=${ADMIN_TOKEN:-}

echo "== Smoke: readiness and metrics =="
curl -fsS "$BASE/ready" | jq . || curl -i "$BASE/ready" || true
curl -fsS "$BASE/metrics" | head -n 20 || true

if [[ -z "${VIEWER_TOKEN}" || -z "${ADMIN_TOKEN}" ]]; then
  echo "WARN: set VIEWER_TOKEN and ADMIN_TOKEN to test auth-protected endpoints" >&2
  exit 0
fi

echo "\n== Smoke: viewer read projects (200) =="
curl -i -H "Authorization: Bearer ${VIEWER_TOKEN}" "$BASE/projects" | sed -n '1,8p'

echo "\n== Smoke: viewer create project (403) =="
curl -i -X POST -H "Authorization: Bearer ${VIEWER_TOKEN}" \
  -H 'Content-Type: application/json' -d '{"name":"Test"}' "$BASE/projects" | sed -n '1,12p'

echo "\n== Smoke: admin idempotent create (200 then replay) =="
IDK=${IDK:-demo-$RANDOM}
curl -i -X POST -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H 'Content-Type: application/json' -H "Idempotency-Key: ${IDK}" \
  -d '{"name":"Demo"}' "$BASE/projects" | sed -n '1,20p'

echo "\n-- Replay same body (Idempotent-Replay: true) --"
curl -i -X POST -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H 'Content-Type: application/json' -H "Idempotency-Key: ${IDK}" \
  -d '{"name":"Demo"}' "$BASE/projects" | sed -n '1,20p'

echo "\n-- Conflict with different body (409) --"
curl -i -X POST -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H 'Content-Type: application/json' -H "Idempotency-Key: ${IDK}" \
  -d '{"name":"Inne"}' "$BASE/projects" | sed -n '1,20p'

echo "\n== Done =="

