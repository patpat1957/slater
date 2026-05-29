"""
Production Configuration — Environment-based settings
======================================================
All settings are loaded from environment variables with sensible defaults.
This module provides a single source of truth for all configuration.

Usage:
    from config import settings
    print(settings.PORT)
    print(settings.ML_MODEL_DIR)
"""

import os
from pathlib import Path


class Settings:
    """Application settings loaded from environment variables."""

    # ── Server ──
    PORT: int = int(os.getenv("PORT", "8000"))
    HOST: str = os.getenv("HOST", "0.0.0.0")
    WORKERS: int = int(os.getenv("WEB_CONCURRENCY", os.getenv("WORKERS", "2")))
    ENV: str = os.getenv("ENV", os.getenv("ENVIRONMENT", "production"))
    DEBUG: bool = os.getenv("DEBUG", "false").lower() in ("true", "1", "yes")

    # ── CORS ──
    ALLOWED_ORIGINS: str = os.getenv("ALLOWED_ORIGINS", "*")

    # ── Rate Limiting ──
    RATE_LIMIT_REQUESTS: int = int(os.getenv("RATE_LIMIT_REQUESTS", "60"))
    RATE_LIMIT_WINDOW: int = int(os.getenv("RATE_LIMIT_WINDOW", "60"))

    # ── Machine Learning ──
    ML_ENABLED: bool = os.getenv("ML_ENABLED", "true").lower() in ("true", "1", "yes")
    ML_MODEL_DIR: str = os.getenv("ML_MODEL_DIR", str(Path(__file__).parent / "ml_saved_models"))
    ML_MAX_TRAINING_ROWS: int = int(os.getenv("ML_MAX_TRAINING_ROWS", "1000000"))
    ML_DEFAULT_TEST_SIZE: float = float(os.getenv("ML_DEFAULT_TEST_SIZE", "0.2"))

    # ── Stripe ──
    STRIPE_SECRET_KEY: str = os.getenv("STRIPE_SECRET_KEY", "")
    STRIPE_PUBLISHABLE_KEY: str = os.getenv("STRIPE_PUBLISHABLE_KEY", "")
    STRIPE_WEBHOOK_SECRET: str = os.getenv("STRIPE_WEBHOOK_SECRET", "")
    FRONTEND_URL: str = os.getenv("FRONTEND_URL", "http://localhost:3010")

    # ── Logging ──
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")
    LOG_FORMAT: str = os.getenv("LOG_FORMAT", "%(asctime)s %(levelname)s [%(name)s] %(message)s")

    # ── Security ──
    API_KEY_SECRET: str = os.getenv("API_KEY_SECRET", "")

    # ── Python ──
    PYTHON_VERSION: str = os.getenv("PYTHON_VERSION", "3.12")

    @property
    def is_production(self) -> bool:
        return self.ENV.lower() in ("production", "prod")

    @property
    def is_development(self) -> bool:
        return self.ENV.lower() in ("development", "dev", "local")

    def __repr__(self) -> str:
        return (
            f"Settings(ENV={self.ENV}, PORT={self.PORT}, WORKERS={self.WORKERS}, "
            f"ML_ENABLED={self.ML_ENABLED}, DEBUG={self.DEBUG})"
        )


settings = Settings()
