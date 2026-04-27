# ─────────────────────────────────────────────────────────────
#  Lotto Extraction API — Production Docker Image
#  Multi-stage build: small final image (~120 MB)
# ─────────────────────────────────────────────────────────────
FROM python:3.12-slim AS base

# Prevent Python from writing .pyc files and enable unbuffered stdout
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Install dependencies first (cached layer)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source
COPY backend/ ./backend/

# Copy pre-built frontend (relative to backend: ../frontend/build)
COPY frontend/build/ ./frontend/build/

# Copy standalone scoreboard fallback
COPY lotto-scoreboard.html ./lotto-scoreboard.html

# Copy start script
COPY start.sh ./start.sh

# Non-root user for security
RUN adduser --disabled-password --no-create-home appuser
USER appuser

# Expose the API port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import httpx; r=httpx.get('http://localhost:8000/health'); exit(0 if r.status_code==200 else 1)"

# Backend imports use bare names (from lottery_config import ...)
# so we must run from inside backend/ directory
WORKDIR /app/backend

# Start with production-grade uvicorn settings
CMD ["python", "-m", "uvicorn", "main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--workers", "2", \
     "--proxy-headers", \
     "--forwarded-allow-ips", "*", \
     "--access-log", \
     "--no-server-header"]
