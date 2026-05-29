# ─────────────────────────────────────────────────────────────
#  Lotto Extraction API v2.0 — Production Docker Image
#  Multi-stage build: API + ML Engine
#  Includes: scikit-learn, numpy, pandas for ML predictions
# ─────────────────────────────────────────────────────────────

# ── Stage 1: Build dependencies ──
FROM python:3.12-slim AS builder

WORKDIR /build

# Install build tools for compiled ML packages (numpy, scikit-learn)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ── Stage 2: Production image ──
FROM python:3.12-slim AS production

# Prevent Python from writing .pyc files and enable unbuffered stdout
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    ENV=production \
    ML_ENABLED=true \
    ML_MODEL_DIR=/app/backend/ml_saved_models

WORKDIR /app

# Copy installed Python packages from builder
COPY --from=builder /install /usr/local

# Copy backend source
COPY backend/ ./backend/

# Copy pre-built frontend
COPY frontend/build/ ./frontend/build/

# Copy standalone scoreboard fallback
COPY lotto-scoreboard.html ./lotto-scoreboard.html

# Copy start script
COPY start.sh ./start.sh
RUN chmod +x ./start.sh

# Copy ML models directory + artifacts
COPY ml_models/ ./ml_models/

# Create ML model storage directory
RUN mkdir -p /app/backend/ml_saved_models

# Non-root user for security
RUN adduser --disabled-password --no-create-home appuser && \
    chown -R appuser:appuser /app/backend/ml_saved_models
USER appuser

# Expose the API port
EXPOSE 8000

# Health check — includes ML subsystem check
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD python -c "import httpx; r=httpx.get('http://localhost:8000/health'); exit(0 if r.status_code==200 else 1)"

# Backend imports use bare names (from lottery_config import ...)
# so we must run from inside backend/ directory
WORKDIR /app/backend

# Production: use gunicorn with uvicorn workers for better process management
CMD ["gunicorn", "main:app", \
     "--bind", "0.0.0.0:8000", \
     "--workers", "2", \
     "--worker-class", "uvicorn.workers.UvicornWorker", \
     "--timeout", "120", \
     "--graceful-timeout", "30", \
     "--keep-alive", "5", \
     "--access-logfile", "-", \
     "--error-logfile", "-", \
     "--forwarded-allow-ips", "*", \
     "--proxy-protocol"]
