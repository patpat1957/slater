#!/bin/bash
# ─────────────────────────────────────────────────────────────
#  Lotto Extraction API v2.0 — Production Start Script
#  Supports: gunicorn (production) or uvicorn (development)
# ─────────────────────────────────────────────────────────────
set -e

PORT="${PORT:-8000}"
WORKERS="${WEB_CONCURRENCY:-2}"
ENV="${ENV:-production}"

echo "╔════════════════════════════════════════════════════════╗"
echo "║  Lotto Extraction API v2.0 — ML-Enhanced              ║"
echo "║  Port: $PORT | Workers: $WORKERS | Env: $ENV              ║"
echo "╚════════════════════════════════════════════════════════╝"

cd "$(dirname "$0")/backend"

# Create ML model directory if it doesn't exist
mkdir -p ml_saved_models

# Check ML dependencies
python -c "
import sys
try:
    import sklearn, numpy, pandas, joblib
    print('  ✓ ML core: scikit-learn, numpy, pandas, joblib')
except ImportError as e:
    print(f'  ⚠ ML dependency missing: {e}')

try:
    import xgboost
    print('  ✓ XGBoost available')
except ImportError:
    print('  ○ XGBoost not installed (optional)')

try:
    import lightgbm
    print('  ✓ LightGBM available')
except ImportError:
    print('  ○ LightGBM not installed (optional)')
"

if [ "$ENV" = "production" ] || [ "$ENV" = "prod" ]; then
    echo "Starting production server (gunicorn + uvicorn workers)..."
    exec gunicorn main:app \
      --bind "0.0.0.0:$PORT" \
      --workers "$WORKERS" \
      --worker-class uvicorn.workers.UvicornWorker \
      --timeout 120 \
      --graceful-timeout 30 \
      --keep-alive 5 \
      --access-logfile - \
      --error-logfile - \
      --forwarded-allow-ips "*"
else
    echo "Starting development server (uvicorn)..."
    exec python -m uvicorn main:app \
      --host 0.0.0.0 \
      --port "$PORT" \
      --workers "$WORKERS" \
      --proxy-headers \
      --forwarded-allow-ips "*" \
      --access-log \
      --no-server-header
fi
