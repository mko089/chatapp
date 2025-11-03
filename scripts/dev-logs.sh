#!/usr/bin/env bash
set -euo pipefail
docker compose logs -f chat-backend chat-frontend

