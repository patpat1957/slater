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


# ─────────────────────────────────────────────────────────────
# ML Position Analysis (for Optimizer Table integration)
# ─────────────────────────────────────────────────────────────

class PositionAnalysisRequest(BaseModel):
    game_type: str = Field(..., description="Game type: powerball, mega_millions, pick3, fantasy5, etc.")
    pool_size: int = Field(..., ge=3, le=80, description="Number pool size (e.g. 69 for Powerball, 70 for Mega Millions)")
    num_balls: int = Field(..., ge=2, le=10, description="Balls per draw (e.g. 5 for Powerball main)")
    bonus_pool: int = Field(default=0, ge=0, le=50, description="Bonus ball pool size (e.g. 26 for Powerball, 25 for Mega Millions)")
    draws: List[Dict[str, Any]] = Field(
        ...,
        description="Draw history: [{date, numbers: [int], bonus?: int}]",
    )


@router.post("/position-analysis", summary="ML-powered position analysis for Optimizer Table")
async def ml_position_analysis(request: PositionAnalysisRequest):
    """
    Compute ML probability scores for every number in the pool, designed to
    overlay on the Optimizer Position Table.

    Flow:
    1. If a trained model exists for this game_type, use it.
    2. Otherwise, auto-train a lightweight model from the provided draws.
    3. Return per-number probability rankings + confidence tiers + position recommendations.

    Response includes:
    - `predictions`: ranked list of {ball_number, probability, rank, confidence_tier}
    - `hot_numbers`: top predicted numbers (ML says most likely)
    - `cold_numbers`: bottom predicted numbers (ML says least likely)
    - `position_recommendations`: for each position (P1..Pn), top ML-recommended numbers
    - `bonus_predictions`: if bonus_pool > 0, ML predictions for bonus ball
    - `model_info`: which model was used and its metrics
    """
    draws = request.draws
    if len(draws) < 20:
        raise HTTPException(
            status_code=400,
            detail=f"Need at least 20 draws for ML analysis. Got {len(draws)}.",
        )

    registry = get_registry()
    fe = get_feature_engineer()

    # ── 1. Find or auto-train model ──
    model_id = None
    model_info = {}

    # Check for existing active model
    active_models = [
        m for m in registry.list_models()
        if m.get("game_type") == request.game_type
        and m.get("is_active", True)
    ]
    if active_models:
        active_models.sort(key=lambda m: m.get("created_at", ""), reverse=True)
        model_id = active_models[0]["model_id"]
        model_info = {
            "model_id": model_id,
            "model_type": active_models[0].get("model_type"),
            "source": "existing",
            "metrics": active_models[0].get("metrics", {}),
            "training_rows": active_models[0].get("training_rows"),
        }
        logger.info(f"Using existing model {model_id} for {request.game_type}")
    else:
        # Auto-train from provided draws
        if len(draws) < 50:
            # Not enough for training — use statistical fallback
            logger.info(f"Only {len(draws)} draws, using statistical ML fallback")
            return _statistical_ml_fallback(request)

        logger.info(f"Auto-training model for {request.game_type} from {len(draws)} draws...")
        try:
            df = fe.compute_features_from_draws(
                draws=draws,
                game_type=request.game_type,
                pool_size=request.pool_size,
                num_balls=request.num_balls,
            )
            trainer = get_trainer()
            result = trainer.train(
                df=df,
                game_type=request.game_type,
                state_code="ALL",
                model_types=["random_forest"],
                test_size=0.2,
            )
            model_id = result.get("models", [{}])[0].get("model_id") if result.get("models") else None
            if model_id:
                model_info = {
                    "model_id": model_id,
                    "model_type": "random_forest",
                    "source": "auto_trained",
                    "metrics": result.get("models", [{}])[0].get("metrics", {}),
                    "training_rows": df.shape[0],
                }
        except Exception as e:
            logger.warning(f"Auto-training failed: {e}, using statistical fallback")
            return _statistical_ml_fallback(request)

    if not model_id:
        return _statistical_ml_fallback(request)

    # ── 2. Compute features for prediction ──
    try:
        df = fe.compute_features_from_draws(
            draws=draws,
            game_type=request.game_type,
            pool_size=request.pool_size,
            num_balls=request.num_balls,
        )
        candidate_df = df.tail(request.pool_size)
    except Exception as e:
        logger.warning(f"Feature computation failed: {e}, using statistical fallback")
        return _statistical_ml_fallback(request)

    # ── 3. Predict ──
    predictor = get_predictor()
    try:
        predictions = predictor.predict_next_draw(
            model_id=model_id,
            draw_features=candidate_df,
            top_n=request.pool_size,  # get ALL numbers ranked
        )
    except Exception as e:
        logger.warning(f"Prediction failed: {e}, using statistical fallback")
        return _statistical_ml_fallback(request)

    # ── 4. Build position recommendations ──
    # For each draw position, compute which numbers ML recommends
    position_recs = _compute_position_recommendations(
        draws, request.num_balls, request.pool_size, predictions
    )

    # ── 5. Bonus ball predictions ──
    bonus_predictions = []
    if request.bonus_pool > 0:
        bonus_predictions = _compute_bonus_predictions(
            draws, request.bonus_pool
        )

    # ── 6. Categorize numbers ──
    hot_numbers = [p for p in predictions if p["confidence_tier"] == "high"][:10]
    cold_numbers = sorted(predictions, key=lambda p: p["probability"])[:10]

    return {
        "status": "success",
        "game_type": request.game_type,
        "pool_size": request.pool_size,
        "num_balls": request.num_balls,
        "total_draws_analyzed": len(draws),
        "predictions": predictions,
        "hot_numbers": hot_numbers,
        "cold_numbers": cold_numbers,
        "position_recommendations": position_recs,
        "bonus_predictions": bonus_predictions,
        "model_info": model_info,
        "analysis_date": date.today().isoformat(),
    }


def _statistical_ml_fallback(request) -> Dict:
    """
    When ML training isn't possible (too few draws), use enhanced statistical
    methods that mimic ML scoring: frequency decay, recency weighting, and
    positional analysis to produce probability-like scores for each number.
    """
    draws = request.draws
    pool_size = request.pool_size
    num_balls = request.num_balls

    # Compute frequency with temporal decay
    freq = np.zeros(pool_size + 1)  # 1-indexed
    recency = np.zeros(pool_size + 1)
    total = len(draws)

    for i, d in enumerate(draws):
        weight = np.exp(-0.02 * (total - 1 - i))  # temporal decay
        for n in d.get("numbers", []):
            if isinstance(n, (int, float)) and 1 <= int(n) <= pool_size:
                freq[int(n)] += weight
                recency[int(n)] = max(recency[int(n)], i + 1)

    # Normalize to probabilities
    total_freq = freq.sum()
    if total_freq > 0:
        probs = freq / total_freq
    else:
        probs = np.ones(pool_size + 1) / pool_size

    # Combine with recency score
    max_recency = recency.max() if recency.max() > 0 else 1
    recency_score = recency / max_recency

    # Combined score: 60% frequency + 40% recency
    combined = 0.6 * probs + 0.4 * recency_score / (recency_score.sum() or 1)
    combined = combined / (combined.sum() or 1)  # renormalize

    # Build predictions list
    predictions = []
    for ball in range(1, pool_size + 1):
        prob = float(combined[ball])
        predictions.append({
            "ball_number": ball,
            "probability": round(prob, 6),
            "confidence_tier": "high" if prob >= np.percentile(combined[1:], 80) else
                              "medium" if prob >= np.percentile(combined[1:], 50) else "low",
        })

    predictions.sort(key=lambda p: p["probability"], reverse=True)
    for rank, p in enumerate(predictions, 1):
        p["rank"] = rank
        p["percentile"] = round(rank / pool_size * 100, 1)

    # Position recommendations
    position_recs = _compute_position_recommendations(
        draws, num_balls, pool_size, predictions
    )

    # Bonus predictions
    bonus_predictions = []
    if request.bonus_pool > 0:
        bonus_predictions = _compute_bonus_predictions(draws, request.bonus_pool)

    hot_numbers = [p for p in predictions if p["confidence_tier"] == "high"][:10]
    cold_numbers = sorted(predictions, key=lambda p: p["probability"])[:10]

    return {
        "status": "success",
        "game_type": request.game_type,
        "pool_size": pool_size,
        "num_balls": num_balls,
        "total_draws_analyzed": len(draws),
        "predictions": predictions,
        "hot_numbers": hot_numbers,
        "cold_numbers": cold_numbers,
        "position_recommendations": position_recs,
        "bonus_predictions": bonus_predictions,
        "model_info": {
            "model_id": None,
            "model_type": "statistical_fallback",
            "source": "statistical",
            "metrics": {"method": "temporal_decay_frequency + recency_weighting"},
        },
        "analysis_date": date.today().isoformat(),
    }


def _compute_position_recommendations(
    draws: List[Dict], num_balls: int, pool_size: int, predictions: List[Dict]
) -> List[Dict]:
    """
    For each draw position (P1..Pn), combine positional frequency with
    ML probability to recommend the best numbers at each position.
    """
    # Build probability lookup
    prob_map = {p["ball_number"]: p["probability"] for p in predictions}

    # Compute per-position frequency
    pos_freq = [np.zeros(pool_size + 1) for _ in range(num_balls)]
    total = len(draws)

    for i, d in enumerate(draws):
        nums = d.get("numbers", [])
        weight = np.exp(-0.015 * (total - 1 - i))  # lighter decay for positions
        for pi in range(min(len(nums), num_balls)):
            n = int(nums[pi]) if isinstance(nums[pi], (int, float, str)) and str(nums[pi]).isdigit() else 0
            if 1 <= n <= pool_size:
                pos_freq[pi][n] += weight

    position_recs = []
    for pi in range(num_balls):
        # Normalize position frequency
        pf = pos_freq[pi]
        pf_sum = pf.sum()
        if pf_sum > 0:
            pf_norm = pf / pf_sum
        else:
            pf_norm = np.zeros_like(pf)

        # Combined score: 50% positional frequency + 50% ML probability
        scored = []
        for ball in range(1, pool_size + 1):
            ml_score = prob_map.get(ball, 0)
            pos_score = float(pf_norm[ball])
            combined = 0.5 * pos_score + 0.5 * ml_score
            scored.append({
                "ball_number": ball,
                "ml_score": round(ml_score, 6),
                "positional_score": round(pos_score, 6),
                "combined_score": round(combined, 6),
            })

        scored.sort(key=lambda x: x["combined_score"], reverse=True)
        # Add rank
        for rank, s in enumerate(scored, 1):
            s["rank"] = rank

        position_recs.append({
            "position": pi + 1,
            "top_picks": scored[:15],  # top 15 per position
        })

    return position_recs


def _compute_bonus_predictions(draws: List[Dict], bonus_pool: int) -> List[Dict]:
    """
    Compute ML-style predictions for the bonus ball using temporal decay frequency.
    """
    freq = np.zeros(bonus_pool + 1)
    total = 0

    for i, d in enumerate(draws):
        bonus = d.get("bonus")
        if bonus is not None:
            try:
                b = int(bonus)
                if 1 <= b <= bonus_pool:
                    weight = np.exp(-0.02 * (len(draws) - 1 - i))
                    freq[b] += weight
                    total += 1
            except (ValueError, TypeError):
                pass

    # Normalize
    freq_sum = freq.sum()
    if freq_sum > 0:
        probs = freq / freq_sum
    else:
        probs = np.ones(bonus_pool + 1) / bonus_pool

    predictions = []
    for ball in range(1, bonus_pool + 1):
        prob = float(probs[ball])
        predictions.append({
            "ball_number": ball,
            "probability": round(prob, 6),
            "confidence_tier": "high" if prob >= np.percentile(probs[1:], 80) else
                              "medium" if prob >= np.percentile(probs[1:], 50) else "low",
        })

    predictions.sort(key=lambda p: p["probability"], reverse=True)
    for rank, p in enumerate(predictions, 1):
        p["rank"] = rank

    return predictions
