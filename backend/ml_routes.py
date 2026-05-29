"""
ML API Routes — Machine Learning Endpoints for Lottery Prediction
=================================================================
Production REST API for:
  - POST /ml/train         → Train models from CSV or extracted data
  - POST /ml/predict       → Predict next draw (probability rankings)
  - POST /ml/predict/lines → Generate optimized prediction lines (pred5)
  - GET  /ml/models        → List all registered models
  - GET  /ml/models/{id}   → Get model details + metrics
  - DELETE /ml/models/{id} → Delete a model
  - POST /ml/backtest      → Run walk-forward backtesting
  - GET  /ml/health        → ML subsystem health check
  - POST /ml/train/from-api → Train from live Extraction API data
"""

import io
import csv
import logging
import traceback
from datetime import datetime, date, timedelta
from typing import List, Optional, Dict, Any

import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException, UploadFile, File, Query
from pydantic import BaseModel, Field

from ml_engine import (
    get_registry,
    get_trainer,
    get_predictor,
    get_feature_engineer,
    NUMERIC_FEATURES,
    TARGET_COL,
    FeatureEngineer,
    ModelRegistry,
)

logger = logging.getLogger("ml_routes")

router = APIRouter(prefix="/ml", tags=["Machine Learning"])


# ─────────────────────────────────────────────────────────────
# Pydantic Request/Response Models
# ─────────────────────────────────────────────────────────────

class TrainRequest(BaseModel):
    game_type: str = Field(..., description="Game type: powerball, mega_millions, pick3, fantasy5, etc.")
    state_code: str = Field(default="ALL", description="State code or ALL for multi-state")
    model_types: Optional[List[str]] = Field(
        default=None,
        description="Models to train: xgboost, lightgbm, random_forest, gradient_boosting. Defaults to RF + GB.",
    )
    test_size: float = Field(default=0.2, ge=0.05, le=0.5, description="Test split ratio (0.05–0.5)")


class TrainFromAPIRequest(BaseModel):
    state_code: str = Field(..., description="Two-letter US state code")
    lottery_id: str = Field(..., description="Lottery ID (e.g., 'powerball', 'ny_lotto')")
    from_date: str = Field(..., description="Training data start date YYYY-MM-DD")
    to_date: str = Field(..., description="Training data end date YYYY-MM-DD")
    pool_size: int = Field(..., ge=3, le=80, description="Number pool size (e.g. 69 for Powerball)")
    num_balls: int = Field(..., ge=2, le=10, description="Balls drawn per game (e.g. 5 for Powerball main)")
    model_types: Optional[List[str]] = Field(default=None)
    test_size: float = Field(default=0.2, ge=0.05, le=0.5)


class PredictRequest(BaseModel):
    model_id: str = Field(..., description="Registered model ID")
    game_type: str = Field(..., description="Game type")
    pool_size: int = Field(..., ge=3, le=80, description="Number pool size")
    num_balls: int = Field(..., ge=2, le=10, description="Balls per draw")
    recent_draws: Optional[List[Dict[str, Any]]] = Field(
        default=None,
        description="Recent draw history for feature computation. List of {date, numbers: [int]}",
    )
    top_n: int = Field(default=20, ge=5, le=80, description="Top N balls to return")


class PredictLinesRequest(BaseModel):
    model_id: str = Field(..., description="Registered model ID")
    game_type: str = Field(..., description="Game type")
    pool_size: int = Field(..., ge=3, le=80)
    num_balls: int = Field(..., ge=2, le=10)
    num_lines: int = Field(default=5, ge=1, le=20, description="Number of prediction lines")
    recent_draws: Optional[List[Dict[str, Any]]] = Field(default=None)


class BacktestRequest(BaseModel):
    game_type: str = Field(..., description="Game type")
    model_type: str = Field(default="random_forest", description="Model type for backtest")
    window_size: int = Field(default=100, ge=20, le=5000, description="Training window size")
    step_size: int = Field(default=10, ge=1, le=100, description="Step forward size")
    top_k: int = Field(default=10, ge=3, le=50, description="Top K predictions per step")


# ─────────────────────────────────────────────────────────────
# ML Health Check
# ─────────────────────────────────────────────────────────────

@router.get("/health", summary="ML subsystem health check")
async def ml_health():
    """Check ML subsystem status: model registry, dependencies."""
    registry = get_registry()
    models = registry.list_models()

    # Check ML library availability
    libs = {}
    for lib_name in ["sklearn", "numpy", "pandas", "joblib"]:
        try:
            __import__(lib_name)
            libs[lib_name] = "available"
        except ImportError:
            libs[lib_name] = "missing"

    for lib_name in ["xgboost", "lightgbm"]:
        try:
            __import__(lib_name)
            libs[lib_name] = "available"
        except ImportError:
            libs[lib_name] = "optional_missing"

    active_count = sum(1 for m in models if m.get("is_active"))

    return {
        "status": "healthy",
        "ml_ready": all(v != "missing" for v in libs.values()),
        "models_registered": len(models),
        "models_active": active_count,
        "libraries": libs,
        "features_supported": len(NUMERIC_FEATURES),
        "target_variable": TARGET_COL,
        "timestamp": datetime.utcnow().isoformat(),
    }


# ─────────────────────────────────────────────────────────────
# Train from CSV Upload
# ─────────────────────────────────────────────────────────────

@router.post("/train", summary="Train ML models from uploaded CSV")
async def train_from_csv(
    file: UploadFile = File(..., description="CSV file with ML training features"),
    game_type: str = Query(..., description="Game type: powerball, pick3, etc."),
    state_code: str = Query(default="ALL"),
    model_types: Optional[str] = Query(
        default=None,
        description="Comma-separated model types (e.g., 'random_forest,gradient_boosting')",
    ),
    test_size: float = Query(default=0.2, ge=0.05, le=0.5),
):
    """
    Train one or more ML models from an uploaded CSV training file.

    The CSV should contain columns matching the ML training schema
    (see /ml/features for column definitions). At minimum, it needs
    the `winner_state` target column and numeric feature columns.

    Returns trained model IDs, metrics (AUC, F1, precision, recall),
    and feature importance rankings.
    """
    try:
        content = await file.read()
        df = pd.read_csv(io.BytesIO(content))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse CSV: {e}")

    if TARGET_COL not in df.columns:
        raise HTTPException(
            status_code=400,
            detail=f"CSV must contain target column '{TARGET_COL}'. Found columns: {list(df.columns)[:20]}",
        )

    # Parse model types
    types_list = None
    if model_types:
        types_list = [t.strip() for t in model_types.split(",") if t.strip()]

    trainer = get_trainer()

    try:
        result = trainer.train(
            df=df,
            game_type=game_type,
            state_code=state_code,
            model_types=types_list,
            test_size=test_size,
        )
    except Exception as e:
        logger.error(f"Training failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Training failed: {str(e)}")

    return {
        "status": "training_complete",
        **result,
    }


# ─────────────────────────────────────────────────────────────
# Train from Live API Data
# ─────────────────────────────────────────────────────────────

@router.post("/train/from-api", summary="Train models using data from the Extraction API")
async def train_from_api(request: TrainFromAPIRequest):
    """
    Automatically fetch lottery data from the Extraction API,
    engineer features, and train ML models.

    This is the recommended way to train — it uses real draw data
    and computes all 60+ features automatically.
    """
    from scrapers import fetch_lottery_results

    try:
        from_dt = datetime.strptime(request.from_date, "%Y-%m-%d").date()
        to_dt = datetime.strptime(request.to_date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")

    if from_dt > to_dt:
        raise HTTPException(status_code=400, detail="from_date must be before to_date")

    # Determine lottery name
    from lottery_config import LOTTERIES_BY_STATE, LOTTERY_SOURCES
    lottery_name = request.lottery_id.replace("_", " ").title()
    state_name = request.state_code.upper()

    for st_data in LOTTERIES_BY_STATE.values():
        if isinstance(st_data, dict):
            for lot in st_data.get("lotteries", []):
                if lot["id"] == request.lottery_id:
                    lottery_name = lot["name"]
                    state_name = st_data.get("state_name", request.state_code)
                    break

    logger.info(f"Fetching {lottery_name} data for {request.state_code} from {from_dt} to {to_dt}...")

    try:
        raw_results = await fetch_lottery_results(
            request.lottery_id, lottery_name, state_name, from_dt, to_dt,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch lottery data: {str(e)}")

    if not raw_results:
        raise HTTPException(status_code=404, detail="No lottery data found for the specified range.")

    # Convert API results to draw format
    draws = []
    for r in raw_results:
        numbers = []
        for i in range(1, 11):
            key = f"Ball_{i}"
            if key in r and r[key]:
                try:
                    numbers.append(int(r[key]))
                except (ValueError, TypeError):
                    pass
        if numbers:
            draws.append({
                "date": r.get("Date", ""),
                "numbers": numbers[:request.num_balls],
            })

    if len(draws) < 50:
        raise HTTPException(
            status_code=400,
            detail=f"Not enough draw history for training. Found {len(draws)} draws, need at least 50.",
        )

    logger.info(f"Fetched {len(draws)} draws. Computing features...")

    # Feature engineering
    fe = get_feature_engineer()
    df = fe.compute_features_from_draws(
        draws=draws,
        game_type=request.lottery_id,
        pool_size=request.pool_size,
        num_balls=request.num_balls,
    )

    logger.info(f"Feature DataFrame: {df.shape[0]} rows x {df.shape[1]} columns")

    # Train
    trainer = get_trainer()
    result = trainer.train(
        df=df,
        game_type=request.lottery_id,
        state_code=request.state_code,
        model_types=request.model_types,
        test_size=request.test_size,
    )

    return {
        "status": "training_complete",
        "data_source": {
            "lottery": lottery_name,
            "state": request.state_code,
            "date_range": f"{from_dt} to {to_dt}",
            "draws_fetched": len(draws),
            "feature_rows": df.shape[0],
        },
        **result,
    }


# ─────────────────────────────────────────────────────────────
# Predict
# ─────────────────────────────────────────────────────────────

@router.post("/predict", summary="Get ball probability rankings for next draw")
async def predict_next_draw(request: PredictRequest):
    """
    Predict probability rankings for each ball number in the upcoming draw.

    If `recent_draws` is provided, features are computed from that history.
    Otherwise, generates synthetic features based on game configuration.

    Returns top-N balls ranked by predicted probability.
    """
    registry = get_registry()

    if request.model_id not in {m["model_id"] for m in registry.list_models()}:
        raise HTTPException(status_code=404, detail=f"Model '{request.model_id}' not found")

    # Build feature DataFrame for prediction
    fe = get_feature_engineer()

    if request.recent_draws and len(request.recent_draws) >= 10:
        draws = request.recent_draws
        df = fe.compute_features_from_draws(
            draws=draws,
            game_type=request.game_type,
            pool_size=request.pool_size,
            num_balls=request.num_balls,
        )
        # Use only the last draw's candidate balls
        last_draw_rows = df.tail(request.pool_size)
    else:
        # Generate candidate rows for all balls in the pool
        rows = []
        for ball in range(1, request.pool_size + 1):
            row = {col: 0 for col in NUMERIC_FEATURES}
            row["ball_number"] = ball
            row["ball_position"] = -1
            row["is_prime_digit"] = 1 if (ball % 10) in {2, 3, 5, 7} else 0
            row["is_low_digit"] = 1 if (ball % 10) < 5 else 0
            row["overall_freq_norm"] = np.random.uniform(0.1, 0.9)
            row["skip_value"] = np.random.randint(0, 20)
            row["day_of_week"] = date.today().weekday()
            row["month"] = date.today().month
            row["week_of_year"] = date.today().isocalendar()[1]
            rows.append(row)
        last_draw_rows = pd.DataFrame(rows)

    predictor = get_predictor()

    try:
        predictions = predictor.predict_next_draw(
            model_id=request.model_id,
            draw_features=last_draw_rows,
            top_n=request.top_n,
        )
    except Exception as e:
        logger.error(f"Prediction failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Prediction failed: {str(e)}")

    return {
        "model_id": request.model_id,
        "game_type": request.game_type,
        "pool_size": request.pool_size,
        "num_balls": request.num_balls,
        "prediction_date": date.today().isoformat(),
        "predictions": predictions,
    }


@router.post("/predict/lines", summary="Generate optimized prediction lines (pred5)")
async def predict_lines(request: PredictLinesRequest):
    """
    Generate multiple optimized prediction lines (like pred5 in the optimizer).
    Uses ML probability rankings + diversity enforcement.
    """
    registry = get_registry()

    if request.model_id not in {m["model_id"] for m in registry.list_models()}:
        raise HTTPException(status_code=404, detail=f"Model '{request.model_id}' not found")

    fe = get_feature_engineer()

    if request.recent_draws and len(request.recent_draws) >= 10:
        df = fe.compute_features_from_draws(
            draws=request.recent_draws,
            game_type=request.game_type,
            pool_size=request.pool_size,
            num_balls=request.num_balls,
        )
        candidate_df = df.tail(request.pool_size)
    else:
        rows = []
        for ball in range(1, request.pool_size + 1):
            row = {col: 0 for col in NUMERIC_FEATURES}
            row["ball_number"] = ball
            row["ball_position"] = -1
            row["is_prime_digit"] = 1 if (ball % 10) in {2, 3, 5, 7} else 0
            row["is_low_digit"] = 1 if (ball % 10) < 5 else 0
            row["day_of_week"] = date.today().weekday()
            row["month"] = date.today().month
            rows.append(row)
        candidate_df = pd.DataFrame(rows)

    predictor = get_predictor()

    try:
        lines = predictor.predict_combination(
            model_id=request.model_id,
            draw_features=candidate_df,
            num_balls=request.num_balls,
            num_lines=request.num_lines,
        )
    except Exception as e:
        logger.error(f"Prediction lines failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Prediction failed: {str(e)}")

    return {
        "model_id": request.model_id,
        "game_type": request.game_type,
        "prediction_date": date.today().isoformat(),
        "num_lines": len(lines),
        "lines": lines,
    }


# ─────────────────────────────────────────────────────────────
# Model Management
# ─────────────────────────────────────────────────────────────

@router.get("/models", summary="List all registered ML models")
async def list_models(
    game_type: Optional[str] = Query(None, description="Filter by game type"),
    active_only: bool = Query(True, description="Show only active models"),
):
    """List all registered ML models with their metrics and metadata."""
    registry = get_registry()
    models = registry.list_models()

    if game_type:
        models = [m for m in models if m.get("game_type") == game_type]
    if active_only:
        models = [m for m in models if m.get("is_active", True)]

    # Sort by creation time
    models.sort(key=lambda m: m.get("created_at", ""), reverse=True)

    return {
        "total_models": len(models),
        "models": [
            {
                "model_id": m.get("model_id"),
                "model_type": m.get("model_type"),
                "game_type": m.get("game_type"),
                "state_code": m.get("state_code"),
                "metrics": m.get("metrics", {}),
                "training_rows": m.get("training_rows"),
                "n_features": m.get("n_features"),
                "is_active": m.get("is_active", True),
                "created_at": m.get("created_at"),
            }
            for m in models
        ],
    }


@router.get("/models/{model_id}", summary="Get detailed model info")
async def get_model(model_id: str):
    """Get full details for a specific model including metrics, feature importance, and config."""
    registry = get_registry()
    models = registry.list_models()

    model_meta = next((m for m in models if m.get("model_id") == model_id), None)
    if not model_meta:
        raise HTTPException(status_code=404, detail=f"Model '{model_id}' not found")

    return {
        "model_id": model_id,
        **model_meta,
    }


@router.delete("/models/{model_id}", summary="Delete a model")
async def delete_model(model_id: str):
    """Remove a model from the registry and delete its files."""
    registry = get_registry()
    if registry.delete_model(model_id):
        return {"status": "deleted", "model_id": model_id}
    raise HTTPException(status_code=404, detail=f"Model '{model_id}' not found")


# ─────────────────────────────────────────────────────────────
# Feature Info
# ─────────────────────────────────────────────────────────────

@router.get("/features", summary="List all ML features and their descriptions")
async def list_features():
    """
    Returns the complete list of ML features used for training and prediction.
    Includes feature names, categories, and descriptions.
    """
    from ml_engine import NUMERIC_FEATURES

    features = []
    descriptions = {
        "ball_number": "The ball number value",
        "ball_position": "Position in draw (-1 if not drawn)",
        "overall_freq": "Raw frequency count across all history",
        "overall_freq_norm": "Normalized frequency (0-1)",
        "temporal_decay_freq": "Frequency with temporal decay (lambda=0.02)",
        "positional_freq": "Frequency at this specific ball position",
        "positional_freq_norm": "Normalized positional frequency",
        "skip_value": "Draws since last appearance",
        "skip_normalized": "Normalized skip value (0-1)",
        "is_overdue": "1 if skip exceeds SA threshold",
        "sa_level": "Skip Analysis level (1-5)",
        "is_hot": "1 if freq >= 60% of max",
        "is_cold": "1 if freq < 30% of max",
        "is_warm": "1 if between hot and cold",
        "is_prime_digit": "1 if last digit is 2,3,5,7",
        "is_low_digit": "1 if last digit is 0-4",
        "avg_pair_cooccurrence": "Average co-occurrence score",
        "max_pair_cooccurrence": "Max co-occurrence with any number",
        "fa_level": "Frequency Analysis level (1-4)",
        "in_fa_top30": "1 if in top 30% frequency",
        "in_fa_top50": "1 if in top 50% frequency",
        "combo_sum": "Sum of all drawn numbers",
        "combo_ac_value": "Arithmetic Complexity value",
        "star_rating": "1-5 star quality rating",
        "day_of_week": "0=Mon, 6=Sun",
        "month": "Month (1-12)",
        "week_of_year": "Week number (1-52)",
    }

    for i, feat in enumerate(NUMERIC_FEATURES):
        features.append({
            "name": feat,
            "index": i,
            "description": descriptions.get(feat, feat.replace("_", " ").title()),
        })

    return {
        "total_features": len(features),
        "target_variable": TARGET_COL,
        "features": features,
    }


# ─────────────────────────────────────────────────────────────
# Backtest
# ─────────────────────────────────────────────────────────────

@router.post("/backtest", summary="Run walk-forward backtesting")
async def run_backtest(
    file: UploadFile = File(..., description="CSV training data for backtest"),
    game_type: str = Query(...),
    model_type: str = Query(default="random_forest"),
    window_size: int = Query(default=100, ge=20, le=5000),
    step_size: int = Query(default=10, ge=1, le=100),
    top_k: int = Query(default=10, ge=3, le=50),
):
    """
    Walk-forward backtest: train on N draws, predict draw N+1, evaluate.
    Reports precision@K, recall, and hit rates across all steps.
    """
    try:
        content = await file.read()
        df = pd.read_csv(io.BytesIO(content))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse CSV: {e}")

    if TARGET_COL not in df.columns:
        raise HTTPException(status_code=400, detail=f"CSV must contain '{TARGET_COL}' column")

    from ml_engine import WalkForwardBacktester
    registry = get_registry()
    backtester = WalkForwardBacktester(registry)

    try:
        result = backtester.backtest(
            df=df,
            game_type=game_type,
            model_type=model_type,
            window_size=window_size,
            step_size=step_size,
            top_k=top_k,
        )
    except Exception as e:
        logger.error(f"Backtest failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Backtest failed: {str(e)}")

    return {
        "status": "backtest_complete",
        **result,
    }
