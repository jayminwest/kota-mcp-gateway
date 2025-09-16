#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-8081}"
PATH_PART="${HEALTH_PATH:-/health}"
if [[ "${PATH_PART}" != /* ]]; then
  PATH_PART="/${PATH_PART}"
fi
URL="${1:-http://localhost:${PORT}${PATH_PART}}"
curl -fsSL "$URL" >/dev/null
echo "healthy"
