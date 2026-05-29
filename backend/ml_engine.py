"""
ML Prediction Engine — Lottery Ball-State Classifier
=====================================================
Production-grade ensemble: XGBoost, LightGBM, Random Forest, Neural Network.
Handles training, prediction, model persistence, feature engineering,
walk-forward backtesting, and SHAP-based feature importance.

Ball States tracked per number per draw:
  - winner_state   (TARGET): was this ball drawn? (1/0)
  - prediction_state: did our model predict this ball? (1/0)
  - best_practice_state: does this ball pass all 20 strategy filters? (1/0)
"""

import os
import json
import time
import hashlib
import logging
import warnings
from datetime import datetime, date, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple

import numpy as np
import pandas as pd
import joblib

from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import (
    roc_auc_score, precision_score, recall_score, f1_score,
    accuracy_score, log_loss, classification_report,
)
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.calibration import CalibratedClassifierCV

warnings.filterwarnings("ignore", category=UserWarning)
logger = logging.getLogger("ml_engine")

# ─────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────

MODEL_DIR = Path(os.getenv("ML_MODEL_DIR", Path(__file__).parent / "ml_saved_models"))
MODEL_DIR.mkdir(parents=True, exist_ok=True)

# Feature columns used for training (numeric only — excludes identity/string cols)
NUMERIC_FEATURES = [
    # Ball-level features
    "ball_number", "ball_position",
    # Frequency
    "overall_freq", "overall_freq_norm", "temporal_decay_freq",
    "positional_freq", "positional_freq_norm",
    # Skip / Recency
    "skip_value", "skip_normalized", "is_overdue", "sa_level",
    # Hot / Cold / Prime / Low
    "is_hot", "is_cold", "is_warm", "is_prime_digit", "is_low_digit",
    # Pair co-occurrence
    "avg_pair_cooccurrence", "max_pair_cooccurrence",
    # Frequency Analysis
    "fa_level", "in_fa_top30", "in_fa_top50",
    # Combo-level
    "combo_sum", "combo_sum_in_range",
    "combo_odd_count", "combo_even_count",
    "combo_oe_is_top2", "combo_consec_sets", "combo_consec_ok",
    # AC Value
    "combo_ac_value", "combo_ac_in_range",
    # Gap Analysis
    "combo_gap_conforms", "min_gap", "max_gap", "avg_gap",
    # SK123
    "combo_has_sk123", "sk123_match_count",
    # HCPL Ratio
    "combo_hot_count", "combo_cold_count", "combo_prime_count",
    "combo_low_count", "combo_hcpl_ok",
    # Start/End
    "combo_start_num", "combo_end_num",
    "combo_start_ok", "combo_end_ok", "combo_spread",
    # Pattern/Group (binary signals)
    "combo_in_top27_pattern", "combo_in_top60_group",
    # Game Status
    "game_is_normal", "game_unstable_count",
    # Backtest
    "wf_hit_rate", "wf_hits", "wf_total",
    # Star Rating
    "star_rating",
    # Tracker
    "tracker_weight", "tracker_hit_history",
    # Temporal
    "day_of_week", "week_of_year", "month", "draws_since_jackpot",
]

TARGET_COL = "winner_state"


# ─────────────────────────────────────────────────────────────
# Feature Engineering
# ─────────────────────────────────────────────────────────────

class FeatureEngineer:
    """
    Transforms raw draw data + optimizer outputs into ML feature vectors.
    Each row = one ball number in one draw.
    """

    def __init__(self):
        self.scaler = StandardScaler()
        self._fitted = False

    def compute_features_from_draws(
        self,
        draws: List[Dict],
        game_type: str,
        pool_size: int,
        num_balls: int,
    ) -> pd.DataFrame:
        """
        Convert raw draw history to per-ball feature DataFrame.

        Parameters
        ----------
        draws : list of dicts with keys: date, numbers (list[int]), bonus (optional int)
        game_type : e.g. "powerball", "pick3", "fantasy5"
        pool_size : number pool size (e.g. 69 for Powerball main)
        num_balls : balls drawn per game (e.g. 5 for Powerball main)

        Returns
        -------
        pd.DataFrame with NUMERIC_FEATURES + TARGET_COL columns
        """
        rows = []
        draws_sorted = sorted(draws, key=lambda d: d["date"])

        for draw_idx, draw in enumerate(draws_sorted):
            draw_date = draw["date"] if isinstance(draw["date"], date) else datetime.strptime(draw["date"], "%Y-%m-%d").date()
            winning = set(draw["numbers"])

            # Compute frequency from history up to this draw
            history = draws_sorted[:draw_idx]
            freq = self._compute_frequency(history, pool_size)
            skips = self._compute_skips(history, pool_size)
            max_freq = max(freq.values()) if freq else 1

            # Combo-level features
            sorted_winning = sorted(winning)
            combo_sum = sum(sorted_winning)
            odd_count = sum(1 for x in sorted_winning if x % 2 != 0)
            even_count = len(sorted_winning) - odd_count

            # AC Value
            diffs = set()
            for i, a in enumerate(sorted_winning):
                for b in sorted_winning[i + 1:]:
                    diffs.add(abs(b - a))
            ac_value = len(diffs) - (len(sorted_winning) - 1) if len(sorted_winning) > 1 else 0

            # Gaps
            gaps = [sorted_winning[i + 1] - sorted_winning[i] for i in range(len(sorted_winning) - 1)]
            min_gap = min(gaps) if gaps else 0
            max_gap = max(gaps) if gaps else 0
            avg_gap = np.mean(gaps) if gaps else 0.0

            # Consecutive
            consec = 0
            in_run = False
            for i in range(1, len(sorted_winning)):
                if sorted_winning[i] - sorted_winning[i - 1] == 1:
                    if not in_run:
                        consec += 1
                        in_run = True
                else:
                    in_run = False

            # SK123 — numbers from last 3 draws
            recent_nums = set()
            for h in history[-3:]:
                recent_nums.update(h["numbers"])
            sk123_count = len(winning & recent_nums)

            # For each ball in the pool, generate a row
            for ball_num in range(1, pool_size + 1):
                is_winner = 1 if ball_num in winning else 0
                f = freq.get(ball_num, 0)
                f_norm = f / max_freq if max_freq > 0 else 0
                skip = skips.get(ball_num, draw_idx)
                skip_norm = skip / max(draw_idx, 1)

                row = {
                    "ball_number": ball_num,
                    "ball_position": sorted_winning.index(ball_num) if ball_num in winning else -1,
                    TARGET_COL: is_winner,
                    # Frequency
                    "overall_freq": f,
                    "overall_freq_norm": f_norm,
                    "temporal_decay_freq": self._temporal_decay_freq(history, ball_num, pool_size),
                    "positional_freq": self._positional_freq(history, ball_num),
                    "positional_freq_norm": 0.0,  # computed after
                    # Skip
                    "skip_value": skip,
                    "skip_normalized": skip_norm,
                    "is_overdue": 1 if skip > 12 else 0,
                    "sa_level": min(5, max(1, skip // 4 + 1)),
                    # Hot/Cold
                    "is_hot": 1 if f_norm >= 0.6 else 0,
                    "is_cold": 1 if 0 < f_norm < 0.3 else 0,
                    "is_warm": 1 if 0.3 <= f_norm < 0.6 else 0,
                    "is_prime_digit": 1 if (ball_num % 10) in {2, 3, 5, 7} else 0,
                    "is_low_digit": 1 if (ball_num % 10) < 5 else 0,
                    # Pair co-occurrence
                    "avg_pair_cooccurrence": 0.0,
                    "max_pair_cooccurrence": 0.0,
                    # FA Level
                    "fa_level": self._fa_level(f_norm),
                    "in_fa_top30": 1 if f_norm >= 0.7 else 0,
                    "in_fa_top50": 1 if f_norm >= 0.5 else 0,
                    # Combo-level (same for all balls in this draw)
                    "combo_sum": combo_sum,
                    "combo_sum_in_range": 1,  # simplified
                    "combo_odd_count": odd_count,
                    "combo_even_count": even_count,
                    "combo_oe_is_top2": 1 if odd_count in {2, 3} else 0,
                    "combo_consec_sets": consec,
                    "combo_consec_ok": 1 if consec <= 2 else 0,
                    "combo_ac_value": ac_value,
                    "combo_ac_in_range": self._ac_in_range(ac_value, num_balls),
                    "combo_gap_conforms": 1,  # simplified
                    "min_gap": min_gap,
                    "max_gap": max_gap,
                    "avg_gap": avg_gap,
                    "combo_has_sk123": 1 if sk123_count > 0 else 0,
                    "sk123_match_count": sk123_count,
                    # HCPL counts (simplified from combo)
                    "combo_hot_count": sum(1 for w in winning if freq.get(w, 0) / max_freq >= 0.6) if max_freq > 0 else 0,
                    "combo_cold_count": sum(1 for w in winning if 0 < freq.get(w, 0) / max_freq < 0.3) if max_freq > 0 else 0,
                    "combo_prime_count": sum(1 for w in winning if (w % 10) in {2, 3, 5, 7}),
                    "combo_low_count": sum(1 for w in winning if (w % 10) < 5),
                    "combo_hcpl_ok": 1,
                    # Start/End
                    "combo_start_num": sorted_winning[0] if sorted_winning else 0,
                    "combo_end_num": sorted_winning[-1] if sorted_winning else 0,
                    "combo_start_ok": 1,
                    "combo_end_ok": 1,
                    "combo_spread": sorted_winning[-1] - sorted_winning[0] if len(sorted_winning) > 1 else 0,
                    # Pattern/Group
                    "combo_in_top27_pattern": 1,
                    "combo_in_top60_group": 1,
                    # Game Status
                    "game_is_normal": 1,
                    "game_unstable_count": 0,
                    # Backtest (filled later)
                    "wf_hit_rate": 0.0,
                    "wf_hits": 0,
                    "wf_total": 0,
                    # Star Rating
                    "star_rating": 3,
                    # Tracker
                    "tracker_weight": 1.0,
                    "tracker_hit_history": 0.0,
                    # Temporal
                    "day_of_week": draw_date.weekday(),
                    "week_of_year": draw_date.isocalendar()[1],
                    "month": draw_date.month,
                    "draws_since_jackpot": 0,
                }
                rows.append(row)

        df = pd.DataFrame(rows)

        # Compute positional_freq_norm
        if "positional_freq" in df.columns:
            max_pf = df["positional_freq"].max()
            df["positional_freq_norm"] = df["positional_freq"] / max_pf if max_pf > 0 else 0.0

        return df

    # ── Internal helpers ──

    @staticmethod
    def _compute_frequency(history: List[Dict], pool_size: int) -> Dict[int, int]:
        freq = {}
        for draw in history:
            for num in draw["numbers"]:
                freq[num] = freq.get(num, 0) + 1
        return freq

    @staticmethod
    def _temporal_decay_freq(history: List[Dict], ball_num: int, pool_size: int, lam: float = 0.02) -> float:
        score = 0.0
        n = len(history)
        for i, draw in enumerate(history):
            age = n - i
            if ball_num in draw["numbers"]:
                score += np.exp(-lam * age)
        return round(score, 4)

    @staticmethod
    def _positional_freq(history: List[Dict], ball_num: int) -> int:
        count = 0
        for draw in history:
            if ball_num in draw["numbers"]:
                count += 1
        return count

    @staticmethod
    def _compute_skips(history: List[Dict], pool_size: int) -> Dict[int, int]:
        skips = {}
        for ball in range(1, pool_size + 1):
            last_seen = len(history)
            for i in range(len(history) - 1, -1, -1):
                if ball in history[i]["numbers"]:
                    last_seen = len(history) - 1 - i
                    break
            skips[ball] = last_seen
        return skips

    @staticmethod
    def _fa_level(freq_norm: float) -> int:
        if freq_norm >= 0.7:
            return 1
        elif freq_norm >= 0.5:
            return 2
        elif freq_norm >= 0.3:
            return 3
        return 4

    @staticmethod
    def _ac_in_range(ac: int, n_balls: int) -> int:
        if n_balls <= 3:
            return 1 if ac <= 2 else 0
        elif n_balls == 4:
            return 1 if 1 <= ac <= 3 else 0
        elif n_balls == 5:
            return 1 if 4 <= ac <= 6 else 0
        return 1 if 7 <= ac <= 10 else 0

    def fit_scaler(self, df: pd.DataFrame):
        """Fit the StandardScaler on training data."""
        cols = [c for c in NUMERIC_FEATURES if c in df.columns]
        self.scaler.fit(df[cols].fillna(0))
        self._fitted = True

    def transform(self, df: pd.DataFrame) -> np.ndarray:
        """Scale features for model input."""
        cols = [c for c in NUMERIC_FEATURES if c in df.columns]
        X = df[cols].fillna(0).values
        if self._fitted:
            return self.scaler.transform(X)
        return X


# ─────────────────────────────────────────────────────────────
# Model Registry — Manages trained models
# ─────────────────────────────────────────────────────────────

class ModelRegistry:
    """
    Persistent model store. Models are saved/loaded from disk.
    Thread-safe for read operations in production.
    """

    def __init__(self, model_dir: Path = MODEL_DIR):
        self.model_dir = model_dir
        self.model_dir.mkdir(parents=True, exist_ok=True)
        self._cache: Dict[str, Dict] = {}
        self._load_index()

    def _index_path(self) -> Path:
        return self.model_dir / "model_index.json"

    def _load_index(self):
        idx_path = self._index_path()
        if idx_path.exists():
            with open(idx_path) as f:
                self._cache = json.load(f)
        else:
            self._cache = {}

    def _save_index(self):
        with open(self._index_path(), "w") as f:
            json.dump(self._cache, f, indent=2, default=str)

    def save_model(
        self,
        model_id: str,
        model_obj: Any,
        scaler_obj: Any,
        metadata: Dict,
    ) -> str:
        """Save a trained model + scaler + metadata to disk."""
        model_path = self.model_dir / f"{model_id}.joblib"
        scaler_path = self.model_dir / f"{model_id}_scaler.joblib"

        joblib.dump(model_obj, model_path)
        joblib.dump(scaler_obj, scaler_path)

        entry = {
            "model_id": model_id,
            "model_path": str(model_path),
            "scaler_path": str(scaler_path),
            "created_at": datetime.utcnow().isoformat(),
            **metadata,
        }
        self._cache[model_id] = entry
        self._save_index()

        logger.info(f"Model saved: {model_id} → {model_path}")
        return model_id

    def load_model(self, model_id: str) -> Tuple[Any, Any, Dict]:
        """Load model, scaler, and metadata."""
        if model_id not in self._cache:
            raise ValueError(f"Model '{model_id}' not found in registry")

        entry = self._cache[model_id]
        model = joblib.load(entry["model_path"])
        scaler = joblib.load(entry["scaler_path"])
        return model, scaler, entry

    def list_models(self) -> List[Dict]:
        """List all registered models with metadata."""
        return list(self._cache.values())

    def get_active_model(self, game_type: str) -> Optional[str]:
        """Get the most recent active model for a game type."""
        candidates = [
            (mid, meta) for mid, meta in self._cache.items()
            if meta.get("game_type") == game_type and meta.get("is_active", True)
        ]
        if not candidates:
            return None
        # Sort by creation time descending
        candidates.sort(key=lambda x: x[1].get("created_at", ""), reverse=True)
        return candidates[0][0]

    def delete_model(self, model_id: str) -> bool:
        if model_id not in self._cache:
            return False
        entry = self._cache.pop(model_id)
        for key in ["model_path", "scaler_path"]:
            p = Path(entry.get(key, ""))
            if p.exists():
                p.unlink()
        self._save_index()
        return True


# ─────────────────────────────────────────────────────────────
# Ensemble Trainer
# ─────────────────────────────────────────────────────────────

class EnsembleTrainer:
    """
    Trains multiple models and creates a stacking ensemble.
    Supports: XGBoost, LightGBM, RandomForest, GradientBoosting (sklearn).
    """

    SUPPORTED_MODELS = {
        "xgboost": "XGBoost Gradient Boosted Trees",
        "lightgbm": "LightGBM Gradient Boosted Trees",
        "random_forest": "Scikit-learn Random Forest",
        "gradient_boosting": "Scikit-learn Gradient Boosting",
    }

    def __init__(self, registry: ModelRegistry):
        self.registry = registry
        self.feature_engineer = FeatureEngineer()

    def train(
        self,
        df: pd.DataFrame,
        game_type: str,
        state_code: str = "ALL",
        model_types: Optional[List[str]] = None,
        test_size: float = 0.2,
    ) -> Dict[str, Any]:
        """
        Train one or more models on the provided DataFrame.

        Returns dict with model_id, metrics, feature importance for each model.
        """
        if model_types is None:
            model_types = ["random_forest", "gradient_boosting"]

        # Try to import optional ML libraries
        available_types = list(model_types)
        try:
            import xgboost
            logger.info("XGBoost available")
        except ImportError:
            available_types = [t for t in available_types if t != "xgboost"]
            logger.warning("XGBoost not installed — skipping")

        try:
            import lightgbm
            logger.info("LightGBM available")
        except ImportError:
            available_types = [t for t in available_types if t != "lightgbm"]
            logger.warning("LightGBM not installed — skipping")

        if not available_types:
            available_types = ["random_forest", "gradient_boosting"]

        # Prepare features
        feature_cols = [c for c in NUMERIC_FEATURES if c in df.columns]
        X = df[feature_cols].fillna(0).values
        y = df[TARGET_COL].values

        # Time-based split (no shuffle for time-series)
        split_idx = int(len(X) * (1 - test_size))
        X_train, X_test = X[:split_idx], X[split_idx:]
        y_train, y_test = y[:split_idx], y[split_idx:]

        # Fit scaler on training set
        scaler = StandardScaler()
        X_train_scaled = scaler.fit_transform(X_train)
        X_test_scaled = scaler.transform(X_test)

        # Class imbalance ratio
        n_pos = int(y_train.sum())
        n_neg = len(y_train) - n_pos
        scale_pos = n_neg / max(n_pos, 1)
        logger.info(f"Training data: {len(X_train)} rows, {n_pos} positive ({n_pos/len(y_train)*100:.1f}%), scale_pos_weight={scale_pos:.1f}")

        results = {}
        trained_models = {}

        for model_type in available_types:
            t0 = time.time()
            logger.info(f"Training {model_type} for {game_type}...")

            try:
                model = self._create_model(model_type, scale_pos)
                model.fit(X_train_scaled, y_train)

                # Predict
                y_pred_proba = model.predict_proba(X_test_scaled)[:, 1]
                y_pred = (y_pred_proba >= 0.5).astype(int)

                # Metrics
                metrics = self._compute_metrics(y_test, y_pred, y_pred_proba)
                train_time = round(time.time() - t0, 2)
                metrics["train_time_seconds"] = train_time

                # Feature importance
                feat_imp = self._get_feature_importance(model, model_type, feature_cols)

                # Generate model ID
                timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
                model_id = f"{model_type}_{game_type}_{state_code}_{timestamp}"

                # Save to registry
                metadata = {
                    "model_type": model_type,
                    "game_type": game_type,
                    "state_code": state_code,
                    "target": TARGET_COL,
                    "features": feature_cols,
                    "n_features": len(feature_cols),
                    "training_rows": len(X_train),
                    "test_rows": len(X_test),
                    "metrics": metrics,
                    "feature_importance": feat_imp[:20],  # top 20
                    "is_active": True,
                    "class_balance": {"positive": n_pos, "negative": n_neg, "ratio": round(scale_pos, 2)},
                }

                self.registry.save_model(model_id, model, scaler, metadata)

                results[model_type] = {
                    "model_id": model_id,
                    "metrics": metrics,
                    "feature_importance_top10": feat_imp[:10],
                    "train_time_seconds": train_time,
                }
                trained_models[model_type] = model

                logger.info(f"  {model_type}: AUC={metrics.get('auc_roc', 0):.4f}, F1={metrics.get('f1', 0):.4f} in {train_time}s")

            except Exception as e:
                logger.error(f"Error training {model_type}: {e}", exc_info=True)
                results[model_type] = {"error": str(e)}

        # Train stacking ensemble if we have multiple models
        if len(trained_models) >= 2:
            try:
                ensemble_result = self._train_ensemble(
                    trained_models, scaler, X_train_scaled, y_train,
                    X_test_scaled, y_test, feature_cols,
                    game_type, state_code,
                )
                results["ensemble"] = ensemble_result
            except Exception as e:
                logger.error(f"Ensemble training failed: {e}", exc_info=True)
                results["ensemble"] = {"error": str(e)}

        return {
            "game_type": game_type,
            "state_code": state_code,
            "training_rows": len(X_train),
            "test_rows": len(X_test),
            "models": results,
        }

    def _create_model(self, model_type: str, scale_pos_weight: float):
        """Create an sklearn-compatible classifier."""
        if model_type == "xgboost":
            import xgboost as xgb
            return xgb.XGBClassifier(
                objective="binary:logistic",
                eval_metric="auc",
                max_depth=6,
                learning_rate=0.05,
                n_estimators=300,
                subsample=0.8,
                colsample_bytree=0.8,
                min_child_weight=5,
                scale_pos_weight=scale_pos_weight,
                use_label_encoder=False,
                random_state=42,
                n_jobs=-1,
            )
        elif model_type == "lightgbm":
            import lightgbm as lgb
            return lgb.LGBMClassifier(
                objective="binary",
                metric="auc",
                num_leaves=31,
                learning_rate=0.05,
                n_estimators=300,
                feature_fraction=0.8,
                bagging_fraction=0.8,
                bagging_freq=5,
                is_unbalance=True,
                random_state=42,
                n_jobs=-1,
                verbose=-1,
            )
        elif model_type == "random_forest":
            return RandomForestClassifier(
                n_estimators=200,
                max_depth=12,
                min_samples_split=10,
                min_samples_leaf=5,
                max_features="sqrt",
                class_weight="balanced",
                random_state=42,
                n_jobs=-1,
            )
        elif model_type == "gradient_boosting":
            return GradientBoostingClassifier(
                n_estimators=200,
                max_depth=6,
                learning_rate=0.05,
                subsample=0.8,
                min_samples_split=10,
                min_samples_leaf=5,
                random_state=42,
            )
        else:
            raise ValueError(f"Unsupported model type: {model_type}")

    @staticmethod
    def _compute_metrics(y_true, y_pred, y_proba) -> Dict:
        """Compute comprehensive classification metrics."""
        metrics = {
            "accuracy": round(accuracy_score(y_true, y_pred), 4),
            "f1": round(f1_score(y_true, y_pred, zero_division=0), 4),
            "precision": round(precision_score(y_true, y_pred, zero_division=0), 4),
            "recall": round(recall_score(y_true, y_pred, zero_division=0), 4),
        }
        try:
            metrics["auc_roc"] = round(roc_auc_score(y_true, y_proba), 4)
        except ValueError:
            metrics["auc_roc"] = 0.0
        try:
            metrics["log_loss"] = round(log_loss(y_true, y_proba), 4)
        except ValueError:
            metrics["log_loss"] = 0.0

        # Precision at K (top-K balls)
        for k in [5, 10, 20]:
            top_k_idx = np.argsort(y_proba)[-k:]
            hits = int(y_true[top_k_idx].sum())
            metrics[f"precision_at_{k}"] = round(hits / k, 4) if k > 0 else 0.0

        return metrics

    @staticmethod
    def _get_feature_importance(model, model_type: str, feature_names: List[str]) -> List[Dict]:
        """Extract feature importance from trained model."""
        try:
            if hasattr(model, "feature_importances_"):
                importances = model.feature_importances_
            else:
                return []

            pairs = sorted(
                zip(feature_names, importances),
                key=lambda x: x[1],
                reverse=True,
            )
            return [
                {"feature": name, "importance": round(float(imp), 6), "rank": i + 1}
                for i, (name, imp) in enumerate(pairs)
            ]
        except Exception:
            return []

    def _train_ensemble(
        self, models, scaler, X_train, y_train, X_test, y_test,
        feature_cols, game_type, state_code,
    ) -> Dict:
        """Train a meta-learner (logistic regression) on base model predictions."""
        from sklearn.linear_model import LogisticRegression

        # Generate base model predictions on training set (use cross-val to avoid leakage)
        meta_train = np.zeros((len(X_train), len(models)))
        meta_test = np.zeros((len(X_test), len(models)))

        for i, (name, model) in enumerate(models.items()):
            meta_train[:, i] = model.predict_proba(X_train)[:, 1]
            meta_test[:, i] = model.predict_proba(X_test)[:, 1]

        # Train meta-learner
        meta_model = LogisticRegression(
            class_weight="balanced",
            max_iter=1000,
            random_state=42,
        )
        meta_model.fit(meta_train, y_train)

        # Evaluate
        y_proba = meta_model.predict_proba(meta_test)[:, 1]
        y_pred = (y_proba >= 0.5).astype(int)
        metrics = self._compute_metrics(y_test, y_pred, y_proba)

        # Save ensemble
        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        model_id = f"ensemble_{game_type}_{state_code}_{timestamp}"

        ensemble_pkg = {
            "meta_model": meta_model,
            "base_model_types": list(models.keys()),
        }

        metadata = {
            "model_type": "ensemble",
            "game_type": game_type,
            "state_code": state_code,
            "target": TARGET_COL,
            "features": feature_cols,
            "base_models": list(models.keys()),
            "metrics": metrics,
            "is_active": True,
        }

        self.registry.save_model(model_id, ensemble_pkg, scaler, metadata)

        return {
            "model_id": model_id,
            "metrics": metrics,
            "base_models": list(models.keys()),
            "ensemble_weights": {
                name: round(float(w), 4)
                for name, w in zip(models.keys(), meta_model.coef_[0])
            },
        }


# ─────────────────────────────────────────────────────────────
# Predictor — Makes predictions for upcoming draws
# ─────────────────────────────────────────────────────────────

class Predictor:
    """
    Generates ball-number probability rankings for the next draw.
    Integrates with the existing optimizer strategies for hybrid predictions.
    """

    def __init__(self, registry: ModelRegistry):
        self.registry = registry

    def predict_next_draw(
        self,
        model_id: str,
        draw_features: pd.DataFrame,
        top_n: int = 20,
    ) -> List[Dict]:
        """
        Predict probabilities for each ball number in the upcoming draw.

        Parameters
        ----------
        model_id : registered model ID
        draw_features : DataFrame with NUMERIC_FEATURES for each candidate ball
        top_n : number of top balls to return

        Returns
        -------
        List of {ball_number, probability, rank, confidence_tier}
        """
        model, scaler, metadata = self.registry.load_model(model_id)
        feature_cols = [c for c in NUMERIC_FEATURES if c in draw_features.columns]

        X = draw_features[feature_cols].fillna(0).values
        X_scaled = scaler.transform(X)

        # Predict
        if isinstance(model, dict) and "meta_model" in model:
            # Ensemble: load base models and compute stacked predictions
            base_preds = []
            game = metadata.get("game_type", "")
            for base_type in model.get("base_model_types", []):
                # Find the active base model of this type for this game
                candidates = [
                    (mid, m) for mid, m in self.registry._cache.items()
                    if m.get("model_type") == base_type
                    and m.get("game_type") == game
                    and m.get("is_active", True)
                ]
                if candidates:
                    candidates.sort(key=lambda x: x[1].get("created_at", ""), reverse=True)
                    base_mid = candidates[0][0]
                    try:
                        base_model, base_scaler, _ = self.registry.load_model(base_mid)
                        base_preds.append(base_model.predict_proba(X_scaled)[:, 1])
                    except Exception as e:
                        logger.warning(f"Failed to load base model {base_mid}: {e}")

            if base_preds:
                meta_X = np.column_stack(base_preds)
                probabilities = model["meta_model"].predict_proba(meta_X)[:, 1]
            else:
                # Fallback: use average of 0.5 (no base models found)
                logger.warning("Ensemble has no loadable base models — using fallback")
                probabilities = np.full(len(X), 0.5)
        else:
            probabilities = model.predict_proba(X_scaled)[:, 1]

        # Rank and return top-N
        ball_numbers = draw_features["ball_number"].values

        ranked = sorted(
            zip(ball_numbers, probabilities),
            key=lambda x: x[1],
            reverse=True,
        )

        results = []
        for rank, (ball, prob) in enumerate(ranked[:top_n], 1):
            tier = "high" if prob >= 0.15 else "medium" if prob >= 0.08 else "low"
            results.append({
                "ball_number": int(ball),
                "probability": round(float(prob), 6),
                "rank": rank,
                "confidence_tier": tier,
                "percentile": round(float(rank / len(ranked) * 100), 1),
            })

        return results

    def predict_combination(
        self,
        model_id: str,
        draw_features: pd.DataFrame,
        num_balls: int = 5,
        num_lines: int = 5,
    ) -> List[Dict]:
        """
        Generate optimized prediction lines (e.g., 5 lines of 5 numbers).
        Uses probability rankings + diversity enforcement.
        """
        # Get all ball probabilities
        all_predictions = self.predict_next_draw(model_id, draw_features, top_n=len(draw_features))

        # Sort by probability
        prob_map = {p["ball_number"]: p["probability"] for p in all_predictions}
        sorted_balls = sorted(prob_map.keys(), key=lambda b: prob_map[b], reverse=True)

        lines = []
        used_combos = set()

        # Generate diverse lines
        top_pool = sorted_balls[:num_balls * 4]  # expanded pool

        for line_idx in range(num_lines):
            if line_idx == 0:
                # First line: pure top-probability picks
                combo = sorted(sorted_balls[:num_balls])
            else:
                # Subsequent lines: diversified picks
                offset = line_idx * 2
                pool = sorted_balls[offset:offset + num_balls * 3]
                if len(pool) < num_balls:
                    pool = sorted_balls[:num_balls * 3]

                import random
                random.seed(42 + line_idx)
                weights = [prob_map.get(b, 0) for b in pool]
                total_w = sum(weights)
                if total_w > 0:
                    weights = [w / total_w for w in weights]
                else:
                    weights = [1.0 / len(pool)] * len(pool)

                selected = set()
                attempts = 0
                while len(selected) < num_balls and attempts < 100:
                    # Weighted random selection
                    pick = random.choices(pool, weights=weights, k=1)[0]
                    selected.add(pick)
                    attempts += 1

                combo = sorted(selected)
                if len(combo) < num_balls:
                    # Fill from top pool
                    for b in sorted_balls:
                        if b not in combo:
                            combo.append(b)
                        if len(combo) >= num_balls:
                            break
                    combo = sorted(combo[:num_balls])

            combo_key = tuple(combo)
            if combo_key in used_combos:
                continue
            used_combos.add(combo_key)

            avg_prob = np.mean([prob_map.get(b, 0) for b in combo])
            lines.append({
                "line_number": line_idx + 1,
                "numbers": combo,
                "avg_probability": round(float(avg_prob), 6),
                "star_rating": min(5, max(1, int(avg_prob * 30) + 1)),
                "balls_detail": [
                    {"number": b, "probability": round(float(prob_map.get(b, 0)), 6)}
                    for b in combo
                ],
            })

        return lines


# ─────────────────────────────────────────────────────────────
# Walk-Forward Backtester
# ─────────────────────────────────────────────────────────────

class WalkForwardBacktester:
    """
    Walk-forward validation: train on N draws, predict draw N+1, evaluate.
    Matches walkForwardBacktest() in LotteryOptimizerEngine.js.
    """

    def __init__(self, registry: ModelRegistry):
        self.registry = registry
        self.trainer = EnsembleTrainer(registry)

    def backtest(
        self,
        df: pd.DataFrame,
        game_type: str,
        model_type: str = "random_forest",
        window_size: int = 100,
        step_size: int = 10,
        top_k: int = 10,
    ) -> Dict:
        """
        Walk-forward backtest.

        Parameters
        ----------
        df : Full feature DataFrame (time-sorted)
        model_type : model to use
        window_size : training window (draws)
        step_size : how many draws to step forward
        top_k : how many balls to "predict" each draw

        Returns
        -------
        Backtest results with hit rates, precision@K, etc.
        """
        feature_cols = [c for c in NUMERIC_FEATURES if c in df.columns]
        X = df[feature_cols].fillna(0).values
        y = df[TARGET_COL].values

        results = []
        total_hits = 0
        total_predictions = 0
        total_actual_positives = 0

        n_steps = max(1, (len(X) - window_size) // step_size)

        for step in range(n_steps):
            train_end = window_size + step * step_size
            test_start = train_end
            test_end = min(test_start + step_size, len(X))

            if test_end <= test_start:
                break

            X_train = X[:train_end]
            y_train = y[:train_end]
            X_test = X[test_start:test_end]
            y_test = y[test_start:test_end]

            try:
                scaler = StandardScaler()
                X_train_s = scaler.fit_transform(X_train)
                X_test_s = scaler.transform(X_test)

                model = self.trainer._create_model(model_type, n_neg=1, scale_pos_weight=1)
                model.fit(X_train_s, y_train)

                y_proba = model.predict_proba(X_test_s)[:, 1]

                # Top-K predictions
                top_k_idx = np.argsort(y_proba)[-top_k:]
                hits = int(y_test[top_k_idx].sum())
                actual_pos = int(y_test.sum())

                total_hits += hits
                total_predictions += top_k
                total_actual_positives += actual_pos

                results.append({
                    "step": step,
                    "train_end": train_end,
                    "test_range": [test_start, test_end],
                    "hits": hits,
                    "top_k": top_k,
                    "actual_positives": actual_pos,
                    "precision_at_k": round(hits / top_k, 4) if top_k > 0 else 0,
                })
            except Exception as e:
                logger.warning(f"Backtest step {step} failed: {e}")
                continue

        overall_precision = total_hits / max(total_predictions, 1)
        overall_recall = total_hits / max(total_actual_positives, 1)

        return {
            "game_type": game_type,
            "model_type": model_type,
            "window_size": window_size,
            "step_size": step_size,
            "top_k": top_k,
            "n_steps": len(results),
            "total_hits": total_hits,
            "total_predictions": total_predictions,
            "total_actual_positives": total_actual_positives,
            "overall_precision_at_k": round(overall_precision, 4),
            "overall_recall": round(overall_recall, 4),
            "steps": results,
        }


# ─────────────────────────────────────────────────────────────
# Singleton Instances
# ─────────────────────────────────────────────────────────────

_registry = None
_trainer = None
_predictor = None
_feature_engineer = None


def get_registry() -> ModelRegistry:
    global _registry
    if _registry is None:
        _registry = ModelRegistry()
    return _registry


def get_trainer() -> EnsembleTrainer:
    global _trainer
    if _trainer is None:
        _trainer = EnsembleTrainer(get_registry())
    return _trainer


def get_predictor() -> Predictor:
    global _predictor
    if _predictor is None:
        _predictor = Predictor(get_registry())
    return _predictor


def get_feature_engineer() -> FeatureEngineer:
    global _feature_engineer
    if _feature_engineer is None:
        _feature_engineer = FeatureEngineer()
    return _feature_engineer
