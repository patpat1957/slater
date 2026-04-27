#!/bin/bash
# ─────────────────────────────────────────────────────────────
#  Lotto Extraction API — Production Start Script
# ─────────────────────────────────────────────────────────────
set -e

PORT="${PORT:-8000}"
WORKERS="${WEB_CONCURRENCY:-2}"

echo "Starting Lotto API on port $PORT with $WORKERS workers..."

cd "$(dirname "$0")/backend"

exec python -m uvicorn main:app \
  --host 0.0.0.0 \
  --port "$PORT" \
  --workers "$WORKERS" \
  --proxy-headers \
  --forwarded-allow-ips "*" \
  --access-log \
  --no-server-header
