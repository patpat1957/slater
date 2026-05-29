# ML Lottery Ball-State Prediction Guide

> **Machine-Learning–Ready Pipeline for Lottery Number Prediction**
> Using XGBoost, Random Forest, LightGBM, and Neural Networks
>
> Version 1.0.0 · May 2025

---

## Table of Contents

1.  [Overview](#1-overview)
2.  [The Three Core Ball States](#2-the-three-core-ball-states)
3.  [Feature Engineering — 60+ Features from 20 Optimizer Strategies](#3-feature-engineering)
4.  [Artifact Inventory](#4-artifact-inventory)
5.  [CSV Training Data — How to Use](#5-csv-training-data)
6.  [JSON Schema — Data Contracts](#6-json-schema)
7.  [Database Schema — PostgreSQL Setup](#7-database-schema)
8.  [PowerPoint Deck — Presentation Overview](#8-powerpoint-deck)
9.  [Model 1 — XGBoost (Gradient Boosted Trees)](#9-xgboost)
10. [Model 2 — Random Forest](#10-random-forest)
11. [Model 3 — LightGBM](#11-lightgbm)
12. [Model 4 — Neural Network (Feedforward)](#12-neural-network)
13. [Handling Class Imbalance](#13-class-imbalance)
14. [Training Pipeline — Step by Step](#14-training-pipeline)
15. [Walk-Forward Backtesting](#15-walk-forward-backtesting)
16. [Ensemble Strategy — Stacking Multiple Models](#16-ensemble-strategy)
17. [Feature Importance & SHAP Analysis](#17-feature-importance)
18. [Integration with Lotto Extraction API](#18-api-integration)
19. [Quick-Start Code Examples](#19-quick-start-code)
20. [Best Practices & Pitfalls](#20-best-practices)
21. [File Reference](#21-file-reference)

---

## 1. Overview

This guide explains how to turn lottery draw data and the **20 optimizer strategies** from `LotteryOptimizerEngine.js` into a **machine-learning–ready pipeline**. The system tracks every ball number across every draw using three binary states:

| State | Meaning | Source |
|-------|---------|--------|
| **Winner ON/OFF** | Was this ball actually drawn? | Lotto Extraction API |
| **Prediction ON/OFF** | Did our model predict this ball? | Model output / Optimizer |
| **Best Practice ON/OFF** | Does this ball pass all strategy filters? | `checkCombination()` |

From these states plus 20 analytical strategies, we engineer **60+ numeric features** per ball per draw, then train binary classifiers to predict `winner_state = 1` (ball will be drawn).

### Why ML for Lottery?

Lottery draws are random by design — no model can predict individual outcomes with certainty. However, ML can:

- **Rank balls** by probability to focus selection on higher-signal numbers
- **Filter combinations** that violate statistical patterns (eliminating "bad" combos)
- **Learn from temporal patterns** — hot/cold streaks, positional bias, skip patterns
- **Ensemble multiple strategies** — combine 20 optimizer rules into a single probability score
- **Automate the optimizer** — replace manual strategy weights with learned weights

The goal is **improved selection quality**, not guaranteed wins.

---

## 2. The Three Core Ball States

Every ball number in every draw is assigned three binary (ON/OFF) states:

### 2.1 Winner State (Target Variable)

```
winner_state = 1  →  Ball was drawn in the actual result (ON)
winner_state = 0  →  Ball was NOT drawn (OFF)
```

**This is the ML target** — what we're trying to predict. For Powerball (pick 5 from 69), only ~7.25% of balls are ON per draw.

### 2.2 Prediction State

```
prediction_state = 1  →  Our model predicted this ball for this draw (ON)
prediction_state = 0  →  Model did NOT predict this ball (OFF)
```

This tracks the **model's own output** from the previous prediction cycle. It feeds back into the next training iteration — the model can learn "when I predicted X and it won vs. didn't win."

### 2.3 Best Practice State

```
best_practice_state = 1  →  Ball passes ALL 20 strategy filters (ON)
best_practice_state = 0  →  Ball fails at least one filter (OFF)
```

This comes from `checkCombination()` in `LotteryOptimizerEngine.js`, which runs all 20 strategies. A combination passes only if it has 0 fails across:

- AC Value range ✓
- Skip Analysis (SA1–SA5) ✓
- Consecutive limits ✓
- Gap conformance (98%) ✓
- SK123 rule ✓
- Hot/Cold/Prime/Low ratios ✓
- Start/End field coverage ✓
- Pattern/Group membership ✓
- Star rating threshold ✓
- Normal/Unstable status ✓

### 2.4 State Interaction Matrix

| Winner | Prediction | Best Practice | Classification |
|--------|-----------|---------------|----------------|
| ON | ON | ON | **Perfect Hit** — predicted + good strategy + won |
| ON | ON | OFF | **Lucky Hit** — predicted + won but broke rules |
| ON | OFF | ON | **Missed Winner** — good strategy but wasn't predicted |
| ON | OFF | OFF | **Random Winner** — not predicted, broke rules |
| OFF | ON | ON | **False Positive** — predicted + good strategy but lost |
| OFF | ON | OFF | **Bad Prediction** — predicted, broke rules, lost |
| OFF | OFF | ON | **Filtered Out** — good strategy, not predicted, lost |
| OFF | OFF | OFF | **Correctly Avoided** — bad strategy, not predicted, lost |

The ML model aims to maximize **Perfect Hits** and minimize **Missed Winners**.

---

## 3. Feature Engineering

All 60+ features are derived from the 20 optimizer strategies in `LotteryOptimizerEngine.js` and the tracking in `PredictionTracker.js`.

### 3.1 Feature Categories

#### A. Identity Features (Not used in training — for grouping/filtering only)

| Feature | Type | Description |
|---------|------|-------------|
| `draw_id` | string | Unique draw identifier `{state}_{game}_{date}_{drawtime}` |
| `draw_date` | date | Draw date YYYY-MM-DD |
| `state_code` | string | 2-letter US state code |
| `game_type` | string | pick3/pick4/pick5/powerball/megamil/fantasy5/superlotto |
| `draw_time` | string | midday or evening |
| `ball_position` | int | 0-based position in draw (which slot this ball occupied) |
| `ball_number` | int | The actual ball number value |

#### B. Ball State Features (Target + Meta)

| Feature | Type | Source | Description |
|---------|------|--------|-------------|
| `winner_state` | binary | API results | **TARGET** — 1 if drawn, 0 if not |
| `prediction_state` | binary | Previous model | 1 if model predicted this ball |
| `best_practice_state` | binary | checkCombination() | 1 if passes all 20 strategies |

#### C. Frequency Features (Strategy 2 — Frequency Analysis)

| Feature | Type | Strategy | Description |
|---------|------|----------|-------------|
| `overall_freq` | float | computeFreqFromEntries | Raw count across all history |
| `overall_freq_norm` | float | — | Normalized 0–1 (÷ max) |
| `temporal_decay_freq` | float | λ=0.02 exponential | Recent draws weighted more |
| `positional_freq` | float | computeFreqFromEntries | Frequency in this specific position |
| `positional_freq_norm` | float | — | Normalized positional frequency |

#### D. Skip / Recency Features (Strategy 3 — Skip Analysis SA1–SA5)

| Feature | Type | Strategy | Description |
|---------|------|----------|-------------|
| `skip_value` | int | computeDetailedSkips | Draws since last appearance |
| `skip_normalized` | float | — | Skip ÷ max_pool_size |
| `is_overdue` | binary | SA threshold | 1 if skip > expected_skip × 1.5 |
| `sa_level` | int (1-5) | computeSALevels | Skip Analysis level bucket |

#### E. Hot/Cold/Prime/Low Classification (Strategy 6)

| Feature | Type | Strategy | Description |
|---------|------|----------|-------------|
| `is_hot` | binary | computeIdealHCPL | Appears ≥ median frequency |
| `is_cold` | binary | computeIdealHCPL | Appears < median frequency |
| `is_warm` | binary | — | Between hot and cold thresholds |
| `is_prime_digit` | binary | — | Ball number is prime |
| `is_low_digit` | binary | — | Ball < pool_size / 2 |

#### F. Pair Co-occurrence Features

| Feature | Type | Description |
|---------|------|-------------|
| `avg_pair_cooccurrence` | float | Average times this ball appeared with other recent winners |
| `max_pair_cooccurrence` | float | Maximum co-occurrence count with any single ball |

#### G. FA Level Features (Frequency Analysis)

| Feature | Type | Strategy | Description |
|---------|------|----------|-------------|
| `fa_level` | int (1-5) | computeFALevels | Frequency Analysis bucket |
| `in_fa_top30` | binary | — | Ball is in top 30% by frequency |
| `in_fa_top50` | binary | — | Ball is in top 50% by frequency |

#### H. Combo-Level Features (Computed per combination, attached to each ball)

| Feature | Type | Strategy | Description |
|---------|------|----------|-------------|
| `combo_sum` | int | computeSumStats | Sum of all numbers in combo |
| `combo_sum_in_range` | binary | Strategy 9 | Sum within historical range |
| `combo_odd_count` | int | computeOEStats | Count of odd numbers |
| `combo_even_count` | int | computeOEStats | Count of even numbers |
| `combo_oe_pattern` | string | — | e.g. "3O/2E" |
| `combo_oe_is_top2` | binary | — | O/E ratio matches top 2 patterns |
| `combo_consec_sets` | int | countConsecutiveSets | Sets of consecutive numbers |
| `combo_consec_ok` | binary | Strategy 3b | Consecutive sets ≤ limit |

#### I. AC Value Features (Strategy 1)

| Feature | Type | Strategy | Description |
|---------|------|----------|-------------|
| `combo_ac_value` | int | computeACValue | Arithmetic complexity value |
| `combo_ac_in_range` | binary | — | AC value within expected range |

AC Value = count of unique absolute differences between all pairs minus (pickSize - 1). Higher AC = more diverse spread of numbers.

#### J. Gap Analysis Features (Strategy 4)

| Feature | Type | Strategy | Description |
|---------|------|----------|-------------|
| `combo_gap_conforms` | binary | checkGapConformance | Gaps match historical profile (98%) |
| `min_gap` | int | — | Minimum gap between sorted numbers |
| `max_gap` | int | — | Maximum gap between sorted numbers |
| `avg_gap` | float | — | Average gap between sorted numbers |

#### K. SK123 Features (Strategy 5)

| Feature | Type | Strategy | Description |
|---------|------|----------|-------------|
| `combo_has_sk123` | binary | checkSK123Rule | Combo contains recent SK1/SK2/SK3 numbers |
| `sk123_match_count` | int | — | How many SK123 numbers present |

SK123 = the most recent 3 draws' winning numbers. Strategy checks if at least one repeat appears.

#### L. HCPL Features (Strategy 6 — Hot/Cold/Prime/Low Ratio)

| Feature | Type | Strategy | Description |
|---------|------|----------|-------------|
| `combo_hot_count` | int | computeIdealHCPL | Hot numbers in combo |
| `combo_cold_count` | int | — | Cold numbers in combo |
| `combo_prime_count` | int | — | Prime numbers in combo |
| `combo_low_count` | int | — | Low numbers in combo |
| `combo_hcpl_ok` | binary | — | HCPL ratio within ideal range |

#### M. Start/End Field Coverage (Strategy 7)

| Feature | Type | Strategy | Description |
|---------|------|----------|-------------|
| `combo_start_num` | int | computeStartEndCoverage | Lowest number in combo |
| `combo_end_num` | int | — | Highest number in combo |
| `combo_start_ok` | binary | — | Start field within range |
| `combo_end_ok` | binary | — | End field within range |
| `combo_spread` | int | — | end_num - start_num |

#### N. Pattern/Group Features (Strategy 8)

| Feature | Type | Strategy | Description |
|---------|------|----------|-------------|
| `combo_pattern` | string | computeTopPatterns | Decade pattern e.g. "0,1,2,3,4" |
| `combo_in_top27_pattern` | binary | — | Pattern matches top 27% |
| `combo_group` | string | computeTopGroups | Number group classification |
| `combo_in_top60_group` | binary | — | Group matches top 60% |

#### O. Game Status Features (Strategy 10)

| Feature | Type | Strategy | Description |
|---------|------|----------|-------------|
| `game_is_normal` | binary | computeEnhancedStatus | Game in normal statistical state |
| `game_unstable_count` | int | — | Count of unstable indicators |

#### P. Walk-Forward Backtest Features

| Feature | Type | Strategy | Description |
|---------|------|----------|-------------|
| `wf_hit_rate` | float | walkForwardBacktest | Historical hit rate over last N windows |
| `wf_hits` | int | — | Number of hits in backtest |
| `wf_total` | int | — | Total predictions in backtest |

#### Q. Star Rating (Strategy 9)

| Feature | Type | Strategy | Description |
|---------|------|----------|-------------|
| `star_rating` | int (0-5) | computeEnhancedStarRating | Composite quality score |

The star rating aggregates multiple strategy checks into a single 0–5 score.

#### R. Tracker Learning Features (from PredictionTracker.js)

| Feature | Type | Strategy | Description |
|---------|------|----------|-------------|
| `tracker_weight` | float | computeLearningWeights | Adaptive weight from prediction history |
| `tracker_hit_history` | float | — | Running hit rate for this ball |

#### S. Temporal Features

| Feature | Type | Description |
|---------|------|-------------|
| `day_of_week` | int (0-6) | 0=Monday, 6=Sunday |
| `week_of_year` | int (1-53) | Week number |
| `month` | int (1-12) | Month |
| `draws_since_jackpot` | int | Draws since last jackpot hit (resets cycle) |

### 3.2 Feature Count Summary

| Category | Count | Examples |
|----------|-------|---------|
| Identity (excluded from training) | 7 | draw_id, game_type, state_code |
| Ball States | 3 | winner_state (target), prediction_state, best_practice_state |
| Frequency | 5 | overall_freq, temporal_decay_freq |
| Skip/Recency | 4 | skip_value, sa_level |
| Hot/Cold/Prime/Low | 5 | is_hot, is_cold, is_prime_digit |
| Pair Co-occurrence | 2 | avg_pair_cooccurrence |
| FA Level | 3 | fa_level, in_fa_top30 |
| Combo-Level | 8 | combo_sum, combo_oe_pattern |
| AC Value | 2 | combo_ac_value, combo_ac_in_range |
| Gap Analysis | 4 | combo_gap_conforms, min_gap |
| SK123 | 2 | combo_has_sk123, sk123_match_count |
| HCPL | 5 | combo_hot_count, combo_hcpl_ok |
| Start/End | 5 | combo_start_num, combo_spread |
| Pattern/Group | 4 | combo_pattern, combo_in_top27_pattern |
| Game Status | 2 | game_is_normal, game_unstable_count |
| Walk-Forward | 3 | wf_hit_rate, wf_hits |
| Star Rating | 1 | star_rating |
| Tracker Learning | 2 | tracker_weight, tracker_hit_history |
| Temporal | 4 | day_of_week, month |
| **Total** | **64** | |

---

## 4. Artifact Inventory

All generated files live in the `ml_models/` directory:

| File | Format | Size | Purpose |
|------|--------|------|---------|
| `ml_training_data.csv` | CSV | ~2.3 MB | 8,800 example training rows (5 game types × 200 draws × ~8.8 balls) |
| `ml_training_schema.json` | JSON | 16 KB | JSON Schema for training data + model configs |
| `ml_training_features.json` | JSON | 12 KB | Feature definitions with dtypes, categories, descriptions |
| `ml_database_schema.sql` | SQL | 12 KB | PostgreSQL schema — 7 tables + 3 views |
| `ml_lottery_pipeline_deck.pptx` | PPTX | 46 KB | 15-slide PowerPoint deck covering full pipeline |
| `generate_ml_artifacts.py` | Python | 57 KB | Script that generates all above files |

---

## 5. CSV Training Data — How to Use

### 5.1 File Structure

The CSV file `ml_training_data.csv` contains **8,800 rows** of example training data across 5 game types:

- **pick3** (3 balls from 10) × 200 draws
- **pick4** (4 balls from 10) × 200 draws
- **pick5** (5 balls from 39) × 200 draws
- **powerball** (5 balls from 69) × 200 draws
- **megamil** (5 balls from 70) × 200 draws

Each row represents **one ball number in one draw** with its winner_state label and all 60+ features.

### 5.2 Loading the CSV

```python
import pandas as pd

# Load full dataset
df = pd.read_csv('ml_models/ml_training_data.csv')
print(f"Shape: {df.shape}")  # (8800, 64)
print(f"Games: {df['game_type'].unique()}")
print(f"Winner ratio: {df['winner_state'].mean():.4f}")

# Filter to one game type
pb = df[df['game_type'] == 'powerball'].copy()
print(f"Powerball rows: {len(pb)}, Winner rate: {pb['winner_state'].mean():.4f}")
```

### 5.3 Preparing Features for Training

```python
# Identity columns — EXCLUDE from training features
IDENTITY_COLS = ['draw_id', 'draw_date', 'state_code', 'game_type',
                 'draw_time', 'ball_position', 'ball_number']

# Target column
TARGET = 'winner_state'

# String/categorical columns that need encoding
CAT_COLS = ['combo_oe_pattern', 'combo_pattern', 'combo_group']

# All numeric feature columns (auto-detected)
feature_cols = [c for c in df.columns
                if c not in IDENTITY_COLS + [TARGET] + CAT_COLS]

print(f"Numeric features: {len(feature_cols)}")
# → ~55 numeric features

# One-hot encode categoricals
df_encoded = pd.get_dummies(df[feature_cols + CAT_COLS], columns=CAT_COLS)

# Final feature matrix and target
X = df_encoded.values
y = df[TARGET].values
```

### 5.4 Train/Test Split Strategy

**Critical**: Do NOT use random split for time-series lottery data. Use **temporal split**:

```python
# Temporal split — train on older draws, test on newer
df_sorted = df.sort_values('draw_date')
split_date = df_sorted['draw_date'].quantile(0.8)  # 80/20 split

train = df_sorted[df_sorted['draw_date'] <= split_date]
test  = df_sorted[df_sorted['draw_date'] > split_date]

print(f"Train: {len(train)} rows, Test: {len(test)} rows")
```

---

## 6. JSON Schema — Data Contracts

### 6.1 ml_training_schema.json

This file defines the **complete data contract** for the ML pipeline:

- **metadata**: Version, source, supported games, ball state definitions
- **record**: Per-row schema with all 64 fields, types, and constraints
- **model_configs**: Pre-configured hyperparameters for all 4 model types
- **evaluation_metrics**: Required metrics (AUC, accuracy, F1, precision, recall)

Use it to validate data before training:

```python
import json
from jsonschema import validate

with open('ml_models/ml_training_schema.json') as f:
    schema = json.load(f)

# Get model configs
xgb_config = schema['properties']['model_configs']['properties']['xgboost']
print(json.dumps(xgb_config, indent=2))
```

### 6.2 ml_training_features.json

This file defines each of the **64 features** with:

- `name`: Column name
- `dtype`: Data type (int, float, binary, string, date)
- `description`: Human-readable explanation
- `category`: Feature group (identity, ball_state, frequency, skip, combo, etc.)
- `strategy_source`: Which of the 20 strategies generates this feature

Use it to build feature documentation or auto-generate preprocessing code:

```python
with open('ml_models/ml_training_features.json') as f:
    features = json.load(f)

# Get all frequency features
freq_features = [f for f in features['features']
                 if f['category'] == 'frequency']
print(f"Frequency features: {[f['name'] for f in freq_features]}")
```

---

## 7. Database Schema — PostgreSQL Setup

### 7.1 Schema Overview

The SQL file `ml_database_schema.sql` creates 7 tables and 3 views:

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│    draws     │───→│  ball_states │    │  ml_models   │
│  (raw data)  │    │ (3 states)   │    │  (trained)   │
└──────────────┘    └──────────────┘    └──────┬───────┘
       │                                       │
       ├───────────────────┐                   │
       ▼                   ▼                   ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ ml_features  │    │ prediction_  │    │  feature_    │
│ (60+ cols)   │    │  outcomes    │    │ importance   │
└──────────────┘    └──────────────┘    └──────────────┘
                           ▲
                    ┌──────┴───────┐
                    │ml_predictions│
                    │(model output)│
                    └──────────────┘
```

### 7.2 Table Details

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `draws` | Raw draw results from API | draw_id, numbers[], bonus_number |
| `ball_states` | 3 core states per ball per draw | winner_state, prediction_state, best_practice_state |
| `ml_features` | Full 60+ feature vector | All features from Section 3 |
| `ml_models` | Trained model metadata | model_type, hyperparameters, metrics (JSONB) |
| `ml_predictions` | Model outputs for future draws | predicted_probability, confidence_tier |
| `prediction_outcomes` | Actual vs predicted comparison | was_correct, actual_state |
| `feature_importance` | Per-model feature rankings | importance_score, importance_type |

### 7.3 Views

| View | Purpose |
|------|---------|
| `v_ball_state_summary` | Aggregated stats per ball: win_rate, prediction_precision, recall |
| `v_model_performance` | Model comparison by AUC, F1, accuracy |
| `v_ml_training_data` | Join features + draws for easy export |

### 7.4 Setup

```bash
# Create database
createdb lottery_ml

# Apply schema
psql lottery_ml < ml_models/ml_database_schema.sql

# Import CSV training data
psql lottery_ml -c "\COPY ml_features FROM 'ml_models/ml_training_data.csv' CSV HEADER"
```

---

## 8. PowerPoint Deck — Presentation Overview

The 15-slide deck `ml_lottery_pipeline_deck.pptx` covers:

| Slide | Title | Content |
|-------|-------|---------|
| 1 | Title Slide | ML Lottery Ball-State Prediction Pipeline |
| 2 | The Three Ball States | Winner/Prediction/Best Practice ON/OFF explanation |
| 3 | Feature Engineering | 60+ features from 20 optimizer strategies |
| 4 | XGBoost Config | Binary logistic, scale_pos_weight, hyperparameters |
| 5 | Random Forest Config | Balanced class_weight, n_estimators, hyperparameters |
| 6 | LightGBM Config | is_unbalance, num_leaves, feature_fraction |
| 7 | Neural Network Config | 128→64→32→1 architecture, focal loss, dropout |
| 8 | Pipeline Architecture | Data flow diagram: API → Features → Train → Predict |
| 9 | Training Strategy | Temporal split, walk-forward, cross-validation |
| 10 | Class Imbalance Solutions | scale_pos_weight, SMOTE, threshold tuning, focal loss |
| 11 | Feature Importance | Top features, SHAP values, category rankings |
| 12 | Ensemble Strategy | Weighted average, stacking, rank fusion |
| 13 | Integration with API | FastAPI endpoints, real-time prediction flow |
| 14 | Quick Start | 5 steps to get up and running |
| 15 | Contact / Repo | Links to artifacts, documentation |

Use this deck for stakeholder presentations, team onboarding, or project reviews.

---

## 9. Model 1 — XGBoost (Gradient Boosted Trees)

### 9.1 Why XGBoost?

- Best-in-class for **tabular data** with mixed feature types
- Handles missing values natively
- Built-in `scale_pos_weight` for class imbalance
- Feature importance via gain/weight/cover
- Fast inference for real-time predictions

### 9.2 Recommended Hyperparameters

```python
import xgboost as xgb

params = {
    'objective':        'binary:logistic',
    'eval_metric':      'auc',
    'max_depth':        6,
    'learning_rate':    0.05,
    'n_estimators':     500,
    'subsample':        0.8,
    'colsample_bytree': 0.8,
    'min_child_weight': 5,
    'gamma':            0.1,
    'reg_alpha':        0.1,
    'reg_lambda':       1.0,
    'scale_pos_weight': 12.8,  # ≈ (n_negative / n_positive) for Powerball
    'random_state':     42,
    'n_jobs':           -1,
    'early_stopping_rounds': 50
}

model = xgb.XGBClassifier(**params)
```

### 9.3 scale_pos_weight Calculation

For different games:

| Game | Pick | Pool | Positive Rate | scale_pos_weight |
|------|------|------|--------------|-----------------|
| pick3 | 3 | 10 | 30.0% | 2.3 |
| pick4 | 4 | 10 | 40.0% | 1.5 |
| pick5 | 5 | 39 | 12.8% | 6.8 |
| powerball | 5 | 69 | 7.2% | 12.8 |
| megamil | 5 | 70 | 7.1% | 13.0 |
| fantasy5 | 5 | 39 | 12.8% | 6.8 |
| superlotto | 5 | 47 | 10.6% | 8.4 |

### 9.4 Training Example

```python
import xgboost as xgb
import pandas as pd
from sklearn.metrics import roc_auc_score, classification_report

# Load data
df = pd.read_csv('ml_models/ml_training_data.csv')
pb = df[df['game_type'] == 'powerball'].copy()

# Prepare features
IDENTITY = ['draw_id','draw_date','state_code','game_type','draw_time','ball_position','ball_number']
CAT = ['combo_oe_pattern','combo_pattern','combo_group']
TARGET = 'winner_state'

features = [c for c in pb.columns if c not in IDENTITY + [TARGET] + CAT]
pb_encoded = pd.get_dummies(pb[features + CAT], columns=CAT)

# Temporal split
pb_sorted = pb.sort_values('draw_date')
split_idx = int(len(pb_sorted) * 0.8)
train_idx = pb_sorted.index[:split_idx]
test_idx  = pb_sorted.index[split_idx:]

X_train = pb_encoded.loc[train_idx]
X_test  = pb_encoded.loc[test_idx]
y_train = pb.loc[train_idx, TARGET]
y_test  = pb.loc[test_idx, TARGET]

# Train
model = xgb.XGBClassifier(
    objective='binary:logistic', eval_metric='auc',
    max_depth=6, learning_rate=0.05, n_estimators=500,
    scale_pos_weight=12.8, subsample=0.8, colsample_bytree=0.8,
    min_child_weight=5, early_stopping_rounds=50, random_state=42
)
model.fit(X_train, y_train,
          eval_set=[(X_test, y_test)],
          verbose=50)

# Evaluate
y_pred_prob = model.predict_proba(X_test)[:, 1]
auc = roc_auc_score(y_test, y_pred_prob)
print(f"AUC: {auc:.4f}")

# Rank balls for next draw
# Use top-K probability balls as predictions
top_k = 5  # Pick top 5 for Powerball
ranked = pd.DataFrame({
    'ball_number': pb.loc[test_idx, 'ball_number'],
    'probability': y_pred_prob
}).sort_values('probability', ascending=False)

print("Top predicted balls:")
print(ranked.head(top_k))
```

### 9.5 Saving the Model

```python
import joblib

# Save model
joblib.dump(model, 'ml_models/xgb_powerball_v1.joblib')

# Load model
model = joblib.load('ml_models/xgb_powerball_v1.joblib')
```

---

## 10. Model 2 — Random Forest

### 10.1 Why Random Forest?

- **Robust to overfitting** with bagging + feature subsampling
- **Feature importance** via impurity or permutation
- **No gradient required** — stable training
- Good **baseline model** to compare against boosted methods
- Built-in `class_weight='balanced'` for imbalanced data

### 10.2 Recommended Hyperparameters

```python
from sklearn.ensemble import RandomForestClassifier

model = RandomForestClassifier(
    n_estimators=500,
    max_depth=12,
    min_samples_split=10,
    min_samples_leaf=5,
    max_features='sqrt',
    class_weight='balanced',
    random_state=42,
    n_jobs=-1,
    oob_score=True
)
```

### 10.3 class_weight='balanced' Explained

Sklearn automatically adjusts weights inversely proportional to class frequency:

```
weight_class_k = n_samples / (n_classes × n_samples_with_class_k)

For Powerball (7.2% positive):
  weight_0 = 8800 / (2 × 8166) ≈ 0.54
  weight_1 = 8800 / (2 × 634)  ≈ 6.94
```

This gives the minority class (winners) ~13× more weight during training.

### 10.4 Training Example

```python
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import roc_auc_score, classification_report
import pandas as pd

# (Load and prepare data same as XGBoost example above)

model = RandomForestClassifier(
    n_estimators=500, max_depth=12,
    min_samples_split=10, min_samples_leaf=5,
    max_features='sqrt', class_weight='balanced',
    random_state=42, n_jobs=-1, oob_score=True
)
model.fit(X_train, y_train)

# Evaluate
y_pred_prob = model.predict_proba(X_test)[:, 1]
auc = roc_auc_score(y_test, y_pred_prob)
print(f"AUC: {auc:.4f}")
print(f"OOB Score: {model.oob_score_:.4f}")

# Feature importance
importances = pd.Series(
    model.feature_importances_,
    index=X_train.columns
).sort_values(ascending=False)
print("\nTop 10 Features:")
print(importances.head(10))
```

---

## 11. Model 3 — LightGBM

### 11.1 Why LightGBM?

- **Fastest** gradient boosting framework
- **Leaf-wise tree growth** — often better accuracy than XGBoost
- **Native categorical support** — no one-hot encoding needed
- **`is_unbalance=True`** — automatic class imbalance handling
- Lower memory usage for large datasets

### 11.2 Recommended Hyperparameters

```python
import lightgbm as lgb

params = {
    'objective':        'binary',
    'metric':           'auc',
    'boosting_type':    'gbdt',
    'num_leaves':       63,
    'learning_rate':    0.05,
    'n_estimators':     500,
    'feature_fraction': 0.8,
    'bagging_fraction': 0.8,
    'bagging_freq':     5,
    'min_child_samples': 20,
    'lambda_l1':        0.1,
    'lambda_l2':        1.0,
    'is_unbalance':     True,
    'random_state':     42,
    'n_jobs':           -1,
    'verbose':          -1
}

model = lgb.LGBMClassifier(**params)
```

### 11.3 Categorical Feature Handling

LightGBM can handle categoricals directly without one-hot encoding:

```python
# Tell LightGBM which columns are categorical
cat_features = ['combo_oe_pattern', 'combo_pattern', 'combo_group']

# Convert to category dtype
for col in cat_features:
    X_train[col] = X_train[col].astype('category')
    X_test[col]  = X_test[col].astype('category')

model.fit(
    X_train, y_train,
    eval_set=[(X_test, y_test)],
    categorical_feature=cat_features,
    callbacks=[lgb.early_stopping(50), lgb.log_evaluation(50)]
)
```

### 11.4 Training Example

```python
import lightgbm as lgb
from sklearn.metrics import roc_auc_score

model = lgb.LGBMClassifier(
    objective='binary', metric='auc', boosting_type='gbdt',
    num_leaves=63, learning_rate=0.05, n_estimators=500,
    feature_fraction=0.8, bagging_fraction=0.8, bagging_freq=5,
    min_child_samples=20, is_unbalance=True, random_state=42, verbose=-1
)

model.fit(
    X_train, y_train,
    eval_set=[(X_test, y_test)],
    callbacks=[lgb.early_stopping(50)]
)

y_pred_prob = model.predict_proba(X_test)[:, 1]
auc = roc_auc_score(y_test, y_pred_prob)
print(f"LightGBM AUC: {auc:.4f}")
```

---

## 12. Model 4 — Neural Network (Feedforward)

### 12.1 Why Neural Network?

- **Learns non-linear feature interactions** automatically
- **Focal loss** for extreme class imbalance
- **Embedding layers** for categorical features
- Can be extended to **sequence models** (LSTM/Transformer) for temporal patterns
- **Batch normalization** + dropout for regularization

### 12.2 Architecture

```
Input (55 features)
    │
    ▼
Dense(128) + BatchNorm + ReLU + Dropout(0.3)
    │
    ▼
Dense(64) + BatchNorm + ReLU + Dropout(0.3)
    │
    ▼
Dense(32) + BatchNorm + ReLU + Dropout(0.2)
    │
    ▼
Dense(1) + Sigmoid
    │
    ▼
Output: P(winner_state = 1)
```

### 12.3 Focal Loss (for Extreme Imbalance)

Standard binary cross-entropy treats all samples equally. **Focal loss** down-weights easy negatives and focuses on hard examples:

```python
import torch
import torch.nn as nn
import torch.nn.functional as F

class FocalLoss(nn.Module):
    def __init__(self, alpha=0.25, gamma=2.0):
        super().__init__()
        self.alpha = alpha   # Weight for positive class
        self.gamma = gamma   # Focusing parameter

    def forward(self, inputs, targets):
        bce = F.binary_cross_entropy_with_logits(inputs, targets, reduction='none')
        p_t = torch.exp(-bce)
        focal_weight = self.alpha * (1 - p_t) ** self.gamma
        return (focal_weight * bce).mean()
```

- `alpha=0.25` — weight for positive class (winners)
- `gamma=2.0` — focusing parameter (higher = more focus on hard examples)

### 12.4 PyTorch Implementation

```python
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset

class LotteryNet(nn.Module):
    def __init__(self, input_dim):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(input_dim, 128),
            nn.BatchNorm1d(128),
            nn.ReLU(),
            nn.Dropout(0.3),

            nn.Linear(128, 64),
            nn.BatchNorm1d(64),
            nn.ReLU(),
            nn.Dropout(0.3),

            nn.Linear(64, 32),
            nn.BatchNorm1d(32),
            nn.ReLU(),
            nn.Dropout(0.2),

            nn.Linear(32, 1)
        )

    def forward(self, x):
        return self.net(x).squeeze(-1)

# Prepare data
X_train_tensor = torch.FloatTensor(X_train.values)
y_train_tensor = torch.FloatTensor(y_train.values)
X_test_tensor  = torch.FloatTensor(X_test.values)
y_test_tensor  = torch.FloatTensor(y_test.values)

train_ds = TensorDataset(X_train_tensor, y_train_tensor)
train_dl = DataLoader(train_ds, batch_size=256, shuffle=True)

# Model
model = LotteryNet(input_dim=X_train.shape[1])
criterion = FocalLoss(alpha=0.25, gamma=2.0)
optimizer = torch.optim.Adam(model.parameters(), lr=0.001, weight_decay=1e-4)
scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(optimizer, patience=10)

# Train
for epoch in range(100):
    model.train()
    epoch_loss = 0
    for xb, yb in train_dl:
        optimizer.zero_grad()
        out = model(xb)
        loss = criterion(out, yb)
        loss.backward()
        optimizer.step()
        epoch_loss += loss.item()

    # Validate
    model.eval()
    with torch.no_grad():
        val_out = model(X_test_tensor)
        val_prob = torch.sigmoid(val_out).numpy()
        val_auc = roc_auc_score(y_test, val_prob)

    if epoch % 10 == 0:
        print(f"Epoch {epoch}: loss={epoch_loss/len(train_dl):.4f}, AUC={val_auc:.4f}")

    scheduler.step(epoch_loss)
```

### 12.5 Sklearn Alternative (MLPClassifier)

For a simpler implementation without PyTorch:

```python
from sklearn.neural_network import MLPClassifier

model = MLPClassifier(
    hidden_layer_sizes=(128, 64, 32),
    activation='relu',
    solver='adam',
    alpha=0.0001,
    batch_size=256,
    learning_rate='adaptive',
    learning_rate_init=0.001,
    max_iter=200,
    early_stopping=True,
    validation_fraction=0.15,
    random_state=42
)
model.fit(X_train, y_train)
```

Note: Sklearn's MLP doesn't support focal loss — use PyTorch for that.

---

## 13. Handling Class Imbalance

Lottery prediction has **severe class imbalance**: in Powerball, only 5 of 69 balls (~7.2%) are winners per draw. This means 92.8% of training samples are negatives.

### 13.1 Strategies Comparison

| Strategy | Model Support | How It Works | Pros | Cons |
|----------|--------------|--------------|------|------|
| `scale_pos_weight` | XGBoost | Multiplies positive class loss | Simple, effective | May over-predict |
| `class_weight='balanced'` | Random Forest, Sklearn | Auto-adjusts sample weights | No extra code | Less fine-grained |
| `is_unbalance=True` | LightGBM | Auto-adjusts internally | Simple flag | Less control |
| **SMOTE** | Any model | Synthetic minority oversampling | Creates new samples | Can create noise |
| **Focal Loss** | Neural Network | Down-weights easy negatives | Focuses on hard cases | Needs custom loss |
| **Threshold Tuning** | Any model | Adjust decision threshold | Flexible | Requires calibration |
| **Ranking Approach** | Any model | Rank by probability, pick top-K | No threshold needed | No binary prediction |

### 13.2 SMOTE Example

```python
from imblearn.over_sampling import SMOTE

smote = SMOTE(random_state=42, k_neighbors=5)
X_resampled, y_resampled = smote.fit_resample(X_train, y_train)

print(f"Before SMOTE: {y_train.value_counts().to_dict()}")
print(f"After SMOTE:  {pd.Series(y_resampled).value_counts().to_dict()}")
# Before: {0: 6500, 1: 500}
# After:  {0: 6500, 1: 6500}
```

### 13.3 Threshold Tuning

Instead of the default 0.5 threshold, find the optimal threshold:

```python
from sklearn.metrics import precision_recall_curve

precision, recall, thresholds = precision_recall_curve(y_test, y_pred_prob)

# Find threshold that maximizes F1
f1_scores = 2 * (precision * recall) / (precision + recall + 1e-8)
best_idx = f1_scores.argmax()
best_threshold = thresholds[best_idx]

print(f"Best threshold: {best_threshold:.4f}")
print(f"Best F1: {f1_scores[best_idx]:.4f}")

# Apply custom threshold
y_pred = (y_pred_prob >= best_threshold).astype(int)
```

### 13.4 Ranking Approach (Recommended)

Instead of binary classification, treat it as a **ranking problem**:

```python
# Get probability for every ball number (1-69 for Powerball)
ball_probs = pd.DataFrame({
    'ball_number': range(1, 70),
    'probability': model.predict_proba(X_next_draw)[:, 1]
})

# Rank and select top K
K = 5  # Powerball picks 5 numbers
top_balls = ball_probs.nlargest(K, 'probability')
print("Predicted numbers:", top_balls['ball_number'].tolist())
print("Probabilities:", top_balls['probability'].round(4).tolist())
```

---

## 14. Training Pipeline — Step by Step

### Full Pipeline Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    ML TRAINING PIPELINE                       │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Step 1: DATA COLLECTION                                      │
│  ┌──────────────────────────────────────────┐                │
│  │ Lotto Extraction API → /v1/extract/{st}/{game}            │
│  │ → Raw draw results (numbers, dates, sums)                 │
│  │ → Store in PostgreSQL `draws` table                       │
│  └──────────────────────────────────────────┘                │
│                          │                                    │
│  Step 2: BALL STATE ASSIGNMENT                                │
│  ┌──────────────────────────────────────────┐                │
│  │ For each ball (1..pool_size) in each draw:                │
│  │   winner_state = 1 if ball in drawn_numbers else 0        │
│  │   prediction_state = 1 if model predicted it else 0       │
│  │   best_practice_state = checkCombination() pass/fail      │
│  │ → Store in `ball_states` table                            │
│  └──────────────────────────────────────────┘                │
│                          │                                    │
│  Step 3: FEATURE ENGINEERING                                  │
│  ┌──────────────────────────────────────────┐                │
│  │ Run 20 optimizer strategies:                              │
│  │   computeFreqFromEntries → frequency features             │
│  │   computeDetailedSkips → skip/recency features            │
│  │   computeACValue → AC features                            │
│  │   checkGapConformance → gap features                      │
│  │   checkSK123Rule → SK123 features                         │
│  │   computeIdealHCPL → HCPL features                        │
│  │   computeStartEndCoverage → start/end features            │
│  │   computeTopPatterns/Groups → pattern features            │
│  │   computeEnhancedStarRating → star_rating                 │
│  │   computeEnhancedStatus → status features                 │
│  │   walkForwardBacktest → backtest features                 │
│  │   computeLearningWeights → tracker features               │
│  │ → Store in `ml_features` table                            │
│  └──────────────────────────────────────────┘                │
│                          │                                    │
│  Step 4: PREPROCESSING                                        │
│  ┌──────────────────────────────────────────┐                │
│  │ • Remove identity columns                                 │
│  │ • Encode categoricals (one-hot or native)                 │
│  │ • Handle missing values (impute or flag)                  │
│  │ • Normalize/scale if needed (for NN)                      │
│  │ • Apply SMOTE if chosen                                   │
│  └──────────────────────────────────────────┘                │
│                          │                                    │
│  Step 5: TEMPORAL TRAIN/TEST SPLIT                            │
│  ┌──────────────────────────────────────────┐                │
│  │ Sort by draw_date                                         │
│  │ Train: first 80% of draws                                 │
│  │ Test: last 20% of draws                                   │
│  │ NEVER random shuffle (data leakage!)                      │
│  └──────────────────────────────────────────┘                │
│                          │                                    │
│  Step 6: MODEL TRAINING                                       │
│  ┌──────────────────────────────────────────┐                │
│  │ Train all 4 models:                                       │
│  │   ① XGBoost (scale_pos_weight)                            │
│  │   ② Random Forest (class_weight='balanced')               │
│  │   ③ LightGBM (is_unbalance=True)                         │
│  │   ④ Neural Network (focal loss)                           │
│  │ → Save to `ml_models` table                               │
│  └──────────────────────────────────────────┘                │
│                          │                                    │
│  Step 7: EVALUATION                                           │
│  ┌──────────────────────────────────────────┐                │
│  │ Metrics: AUC, F1, Precision, Recall, Accuracy             │
│  │ Threshold tuning (precision-recall curve)                 │
│  │ Feature importance (SHAP / gain)                          │
│  │ → Store in `feature_importance` table                     │
│  └──────────────────────────────────────────┘                │
│                          │                                    │
│  Step 8: ENSEMBLE & PREDICTION                                │
│  ┌──────────────────────────────────────────┐                │
│  │ Combine probabilities from all 4 models                   │
│  │ Weighted average or stacking                              │
│  │ Rank balls by final score                                 │
│  │ Select top-K as prediction                                │
│  │ → Store in `ml_predictions` table                         │
│  └──────────────────────────────────────────┘                │
│                          │                                    │
│  Step 9: OUTCOME TRACKING                                     │
│  ┌──────────────────────────────────────────┐                │
│  │ After draw results available:                             │
│  │ Compare predictions vs actuals                            │
│  │ Update prediction_state for next cycle                    │
│  │ → Store in `prediction_outcomes` table                    │
│  │ → Feed back to Step 2 for next iteration                  │
│  └──────────────────────────────────────────┘                │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### Step-by-Step Python Code

```python
#!/usr/bin/env python3
"""Complete ML Training Pipeline for Lottery Ball State Prediction."""

import pandas as pd
import numpy as np
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import roc_auc_score, classification_report
import xgboost as xgb
from sklearn.ensemble import RandomForestClassifier
import lightgbm as lgb
import joblib

# ── STEP 1: Load Data ──────────────────────────────────────
df = pd.read_csv('ml_models/ml_training_data.csv')

# Filter to target game (train separate models per game)
GAME = 'powerball'
game_df = df[df['game_type'] == GAME].copy()
print(f"Game: {GAME}, Rows: {len(game_df)}, "
      f"Winner rate: {game_df['winner_state'].mean():.4f}")

# ── STEP 2: Prepare Features ───────────────────────────────
IDENTITY = ['draw_id', 'draw_date', 'state_code', 'game_type',
            'draw_time', 'ball_position', 'ball_number']
CAT = ['combo_oe_pattern', 'combo_pattern', 'combo_group']
TARGET = 'winner_state'

# Numeric features
num_features = [c for c in game_df.columns
                if c not in IDENTITY + [TARGET] + CAT]

# One-hot encode categoricals
game_encoded = pd.get_dummies(game_df[num_features + CAT], columns=CAT)
feature_cols = game_encoded.columns.tolist()

# ── STEP 3: Temporal Split ──────────────────────────────────
game_df_sorted = game_df.sort_values('draw_date').reset_index(drop=True)
game_encoded = game_encoded.loc[game_df_sorted.index]

split_idx = int(len(game_df_sorted) * 0.8)
X_train = game_encoded.iloc[:split_idx]
X_test  = game_encoded.iloc[split_idx:]
y_train = game_df_sorted[TARGET].iloc[:split_idx]
y_test  = game_df_sorted[TARGET].iloc[split_idx:]

pos_rate = y_train.mean()
spw = (1 - pos_rate) / pos_rate
print(f"Train: {len(X_train)}, Test: {len(X_test)}, SPW: {spw:.1f}")

# ── STEP 4: Train All Models ───────────────────────────────
models = {}

# 4a. XGBoost
print("\n--- XGBoost ---")
models['xgboost'] = xgb.XGBClassifier(
    objective='binary:logistic', eval_metric='auc',
    max_depth=6, learning_rate=0.05, n_estimators=500,
    scale_pos_weight=spw, subsample=0.8, colsample_bytree=0.8,
    min_child_weight=5, random_state=42, n_jobs=-1
)
models['xgboost'].fit(X_train, y_train,
                       eval_set=[(X_test, y_test)], verbose=0)

# 4b. Random Forest
print("--- Random Forest ---")
models['random_forest'] = RandomForestClassifier(
    n_estimators=500, max_depth=12, min_samples_split=10,
    min_samples_leaf=5, class_weight='balanced',
    random_state=42, n_jobs=-1
)
models['random_forest'].fit(X_train, y_train)

# 4c. LightGBM
print("--- LightGBM ---")
models['lightgbm'] = lgb.LGBMClassifier(
    objective='binary', metric='auc', num_leaves=63,
    learning_rate=0.05, n_estimators=500, is_unbalance=True,
    feature_fraction=0.8, bagging_fraction=0.8, bagging_freq=5,
    random_state=42, verbose=-1
)
models['lightgbm'].fit(X_train, y_train,
                        eval_set=[(X_test, y_test)],
                        callbacks=[lgb.early_stopping(50)])

# ── STEP 5: Evaluate ───────────────────────────────────────
print("\n=== MODEL COMPARISON ===")
predictions = {}
for name, model in models.items():
    y_prob = model.predict_proba(X_test)[:, 1]
    predictions[name] = y_prob
    auc = roc_auc_score(y_test, y_prob)
    print(f"  {name:20s} AUC = {auc:.4f}")

# ── STEP 6: Ensemble ───────────────────────────────────────
# Weighted average (adjust weights based on AUC)
weights = {'xgboost': 0.40, 'random_forest': 0.25, 'lightgbm': 0.35}
ensemble_prob = sum(predictions[m] * w for m, w in weights.items())
ensemble_auc = roc_auc_score(y_test, ensemble_prob)
print(f"  {'ENSEMBLE':20s} AUC = {ensemble_auc:.4f}")

# ── STEP 7: Save Models ────────────────────────────────────
for name, model in models.items():
    joblib.dump(model, f'ml_models/{name}_{GAME}_v1.joblib')
print("\nModels saved to ml_models/")

# ── STEP 8: Generate Predictions ────────────────────────────
# For the test set, rank balls and select top-K
K = 5  # Powerball picks 5
test_results = pd.DataFrame({
    'ball_number': game_df_sorted['ball_number'].iloc[split_idx:].values,
    'draw_id': game_df_sorted['draw_id'].iloc[split_idx:].values,
    'actual_winner': y_test.values,
    'ensemble_prob': ensemble_prob
})

# Per-draw ranking
for draw_id in test_results['draw_id'].unique():
    draw_mask = test_results['draw_id'] == draw_id
    draw_balls = test_results[draw_mask].nlargest(K, 'ensemble_prob')
    predicted = set(draw_balls['ball_number'])
    actual = set(test_results[draw_mask & (test_results['actual_winner'] == 1)]['ball_number'])
    hits = predicted & actual
    if hits:
        print(f"  {draw_id}: predicted {sorted(predicted)}, "
              f"actual {sorted(actual)}, HITS: {sorted(hits)}")
```

---

## 15. Walk-Forward Backtesting

Walk-forward backtesting simulates how the model would have performed in real time:

### 15.1 How It Works

```
Window 1: Train on draws 1-100,   predict draw 101,  record hit/miss
Window 2: Train on draws 1-101,   predict draw 102,  record hit/miss
Window 3: Train on draws 1-102,   predict draw 103,  record hit/miss
...
Window N: Train on draws 1-(99+N), predict draw (100+N), record hit/miss
```

### 15.2 Implementation

```python
from sklearn.metrics import roc_auc_score
import xgboost as xgb

def walk_forward_backtest(df, feature_cols, target, model_class, model_params,
                          initial_train_size=100, step=1, top_k=5):
    """Walk-forward backtest returning per-draw hit rates."""
    draws = df['draw_id'].unique()
    results = []

    for i in range(initial_train_size, len(draws), step):
        train_draws = draws[:i]
        test_draw = draws[i]

        train_mask = df['draw_id'].isin(train_draws)
        test_mask = df['draw_id'] == test_draw

        X_train = df.loc[train_mask, feature_cols]
        y_train = df.loc[train_mask, target]
        X_test = df.loc[test_mask, feature_cols]
        y_test = df.loc[test_mask, target]

        if len(X_test) == 0:
            continue

        model = model_class(**model_params)
        model.fit(X_train, y_train, verbose=0) if hasattr(model, 'verbose') \
            else model.fit(X_train, y_train)

        probs = model.predict_proba(X_test)[:, 1]
        top_idx = probs.argsort()[-top_k:]
        predicted = set(df.loc[test_mask].iloc[top_idx]['ball_number'])
        actual = set(df.loc[test_mask & (df[target] == 1)]['ball_number'])
        hits = len(predicted & actual)

        results.append({
            'draw_id': test_draw,
            'hits': hits,
            'predicted': sorted(predicted),
            'actual': sorted(actual),
            'hit_rate': hits / top_k
        })

    results_df = pd.DataFrame(results)
    print(f"Walk-Forward Results:")
    print(f"  Total draws tested: {len(results_df)}")
    print(f"  Average hit rate: {results_df['hit_rate'].mean():.4f}")
    print(f"  Draws with ≥1 hit: {(results_df['hits'] > 0).mean():.2%}")
    return results_df

# Usage
wf_results = walk_forward_backtest(
    game_encoded_with_ids, feature_cols, 'winner_state',
    xgb.XGBClassifier,
    {'objective': 'binary:logistic', 'scale_pos_weight': 12.8,
     'max_depth': 6, 'n_estimators': 200, 'random_state': 42},
    initial_train_size=100, step=5, top_k=5
)
```

---

## 16. Ensemble Strategy — Stacking Multiple Models

### 16.1 Simple Weighted Average

```python
# Combine predictions from all models
weights = {
    'xgboost':       0.35,  # Typically best for tabular data
    'lightgbm':      0.30,  # Fast, competitive accuracy
    'random_forest':  0.20,  # Robust baseline
    'neural_net':     0.15   # Captures non-linear interactions
}

ensemble_prob = sum(
    model_predictions[name] * weight
    for name, weight in weights.items()
)
```

### 16.2 Stacking (Meta-Learner)

Train a second-level model on the first-level predictions:

```python
from sklearn.linear_model import LogisticRegression

# First level: get out-of-fold predictions from each model
from sklearn.model_selection import cross_val_predict

meta_features = pd.DataFrame()
for name, model in models.items():
    oof_preds = cross_val_predict(model, X_train, y_train,
                                   cv=5, method='predict_proba')[:, 1]
    meta_features[name] = oof_preds

# Second level: train meta-learner on out-of-fold predictions
meta_model = LogisticRegression(class_weight='balanced', random_state=42)
meta_model.fit(meta_features, y_train)

# For test set
test_meta = pd.DataFrame()
for name, model in models.items():
    test_meta[name] = model.predict_proba(X_test)[:, 1]

stacked_prob = meta_model.predict_proba(test_meta)[:, 1]
stacked_auc = roc_auc_score(y_test, stacked_prob)
print(f"Stacked AUC: {stacked_auc:.4f}")
```

### 16.3 Rank Fusion

Instead of averaging probabilities, average the **ranks**:

```python
def rank_fusion(predictions_dict, top_k=5):
    """Combine model predictions via rank fusion."""
    rank_df = pd.DataFrame()
    for name, probs in predictions_dict.items():
        rank_df[name] = pd.Series(probs).rank(ascending=False)

    # Average rank across models
    rank_df['avg_rank'] = rank_df.mean(axis=1)

    # Select top-K by lowest average rank
    top_balls = rank_df.nsmallest(top_k, 'avg_rank').index
    return top_balls

predicted_positions = rank_fusion(predictions, top_k=5)
```

---

## 17. Feature Importance & SHAP Analysis

### 17.1 XGBoost Built-in Importance

```python
import matplotlib.pyplot as plt

# Three types of importance
for imp_type in ['weight', 'gain', 'cover']:
    importance = model.get_booster().get_score(importance_type=imp_type)
    sorted_imp = sorted(importance.items(), key=lambda x: x[1], reverse=True)
    print(f"\nTop 10 by {imp_type}:")
    for feat, score in sorted_imp[:10]:
        print(f"  {feat}: {score:.4f}")
```

### 17.2 SHAP Values (Model-Agnostic)

```python
import shap

# Create SHAP explainer
explainer = shap.TreeExplainer(models['xgboost'])
shap_values = explainer.shap_values(X_test)

# Summary plot
shap.summary_plot(shap_values, X_test, max_display=20)

# Per-feature impact
shap.summary_plot(shap_values, X_test, plot_type="bar", max_display=20)

# Single prediction explanation
shap.force_plot(explainer.expected_value, shap_values[0], X_test.iloc[0])
```

### 17.3 Expected Top Features

Based on the 20 optimizer strategies, these features typically rank highest:

| Rank | Feature | Category | Why Important |
|------|---------|----------|--------------|
| 1 | `temporal_decay_freq` | Frequency | Captures recent hot/cold trends |
| 2 | `skip_value` | Skip | Overdue numbers more likely to appear |
| 3 | `overall_freq_norm` | Frequency | Base frequency signal |
| 4 | `fa_level` | FA | Frequency analysis bucket |
| 5 | `sa_level` | Skip | Skip analysis bucket |
| 6 | `star_rating` | Composite | Aggregates multiple strategies |
| 7 | `tracker_weight` | Learning | Adaptive from prediction history |
| 8 | `combo_sum_in_range` | Combo | Sum constraint |
| 9 | `combo_ac_in_range` | AC | Diversity constraint |
| 10 | `best_practice_state` | Ball State | Strategy filter signal |

---

## 18. Integration with Lotto Extraction API

### 18.1 Data Collection from API

```python
import requests

API_BASE = "https://lotto-api.onrender.com"  # or localhost:8000

def fetch_draw_data(state: str, game: str, count: int = 200):
    """Fetch historical draws from API."""
    url = f"{API_BASE}/v1/extract/{state}/{game}"
    params = {"last": count, "format": "json"}
    resp = requests.get(url, params=params)
    resp.raise_for_status()
    return resp.json()

# Fetch Powerball data for California
data = fetch_draw_data("ca", "powerball", count=200)
print(f"Fetched {len(data['draws'])} draws")
```

### 18.2 Real-Time Prediction Flow

```python
def predict_next_draw(state, game, model_path, feature_pipeline):
    """Generate predictions for the next draw."""
    # 1. Fetch latest draws
    recent_data = fetch_draw_data(state, game, count=50)

    # 2. Engineer features for all possible balls
    features = feature_pipeline.transform(recent_data)

    # 3. Load trained model
    model = joblib.load(model_path)

    # 4. Predict probabilities
    probs = model.predict_proba(features)[:, 1]

    # 5. Rank and select
    K = GAME_CONFIGS[game]['pickSize']
    top_k_idx = probs.argsort()[-K:][::-1]
    predictions = features.iloc[top_k_idx]['ball_number'].tolist()

    return {
        'state': state,
        'game': game,
        'predicted_numbers': sorted(predictions),
        'probabilities': probs[top_k_idx].tolist(),
        'model': model_path,
        'timestamp': pd.Timestamp.now().isoformat()
    }
```

### 18.3 Automated Pipeline Schedule

```python
# Example: Cron-based daily pipeline
# crontab: 0 8 * * * python /path/to/ml_pipeline.py

def daily_pipeline():
    """Run daily: collect data, retrain, predict, store."""
    GAMES = ['powerball', 'megamil', 'pick3', 'pick4', 'pick5']
    STATES = ['ca', 'ny', 'tx', 'fl']

    for state in STATES:
        for game in GAMES:
            try:
                # Collect latest draws
                data = fetch_draw_data(state, game, count=500)

                # Engineer features
                features_df = engineer_features(data)

                # Retrain model (incremental or full)
                model = train_model(features_df, game)

                # Generate predictions for next draw
                predictions = predict_next_draw(state, game, model)

                # Store predictions
                store_predictions(predictions)

                print(f"  {state}/{game}: {predictions['predicted_numbers']}")
            except Exception as e:
                print(f"  {state}/{game}: ERROR - {e}")
```

---

## 19. Quick-Start Code Examples

### 19.1 Minimal XGBoost Training (10 lines)

```python
import pandas as pd, xgboost as xgb
from sklearn.metrics import roc_auc_score

df = pd.read_csv('ml_models/ml_training_data.csv')
pb = df[df['game_type']=='powerball']
drop = ['draw_id','draw_date','state_code','game_type','draw_time',
        'ball_position','ball_number','combo_oe_pattern','combo_pattern','combo_group']
X, y = pb.drop(columns=drop+['winner_state']), pb['winner_state']
n = int(len(X)*0.8)
m = xgb.XGBClassifier(scale_pos_weight=12.8, eval_metric='auc', n_estimators=300)
m.fit(X[:n], y[:n], eval_set=[(X[n:], y[n:])], verbose=0)
print(f"AUC: {roc_auc_score(y[n:], m.predict_proba(X[n:])[:,1]):.4f}")
```

### 19.2 Full Pipeline with All 4 Models

See the complete code in [Section 14](#14-training-pipeline).

### 19.3 Load Pre-Generated Artifacts

```python
import pandas as pd
import json

# Load training data
df = pd.read_csv('ml_models/ml_training_data.csv')

# Load feature definitions
with open('ml_models/ml_training_features.json') as f:
    features = json.load(f)

# Load schema with model configs
with open('ml_models/ml_training_schema.json') as f:
    schema = json.load(f)

# Get XGBoost config from schema
xgb_params = schema['properties']['model_configs']['properties']['xgboost']
print(json.dumps(xgb_params, indent=2))
```

---

## 20. Best Practices & Pitfalls

### 20.1 DO ✅

| Practice | Why |
|----------|-----|
| **Train separate models per game type** | Different pool sizes = different distributions |
| **Use temporal split** (NOT random) | Prevents data leakage from future draws |
| **Handle class imbalance** explicitly | 93% negative class will dominate otherwise |
| **Use AUC as primary metric** | Accuracy is misleading with imbalanced data |
| **Walk-forward backtest** | Simulates real-world performance |
| **Ensemble multiple models** | Reduces variance, improves robustness |
| **Track prediction outcomes** | Feed back into training (prediction_state) |
| **Normalize features** for neural networks | NNs sensitive to feature scales |
| **Use early stopping** | Prevents overfitting on limited data |
| **Version your models** | Track which model generated which predictions |

### 20.2 DON'T ❌

| Pitfall | Why It's Wrong |
|---------|---------------|
| **Random train/test split** | Future data leaks into training |
| **Ignoring class imbalance** | Model predicts all zeros (92.8% "accuracy") |
| **Using accuracy as metric** | Predicting all 0s gives 92.8% accuracy |
| **Training on all games combined** | Different game mechanics dilute signal |
| **Using identity columns as features** | ball_number → memorization, not learning |
| **Expecting high accuracy** | Lottery is fundamentally random |
| **Over-interpreting AUC** | AUC of 0.55 is only slightly better than random |
| **Training on < 100 draws** | Insufficient data for meaningful patterns |
| **Ignoring feature importance** | Some features may add noise |
| **Skipping walk-forward test** | Backtest != real-world performance |

### 20.3 Realistic Expectations

| Metric | Random Baseline | Good Model | Excellent Model |
|--------|----------------|------------|-----------------|
| AUC | 0.500 | 0.55–0.62 | 0.62–0.70 |
| Hit Rate (5/69) | 7.2% per ball | 8–10% per ball | 10–14% per ball |
| Draws with ≥1 hit | 30% | 35–45% | 45–55% |
| Expected matches (per draw) | 0.36 | 0.5–0.7 | 0.7–1.0 |

**Remember**: Even the best model cannot overcome fundamental randomness. The value is in **consistent small edges** over many draws, not individual predictions.

---

## 21. File Reference

### Generated Artifacts (in `ml_models/`)

| File | Description | Usage |
|------|-------------|-------|
| `ml_training_data.csv` | 8,800-row example training dataset with 64 columns | Load with pandas, use for training |
| `ml_training_schema.json` | JSON Schema defining data contract + model configs | Validate data, get hyperparameters |
| `ml_training_features.json` | Feature definitions with types and categories | Auto-generate preprocessing code |
| `ml_database_schema.sql` | PostgreSQL schema: 7 tables + 3 views | `psql db < ml_database_schema.sql` |
| `ml_lottery_pipeline_deck.pptx` | 15-slide PowerPoint presentation | Stakeholder presentations |
| `generate_ml_artifacts.py` | Python script that generates all above files | `python generate_ml_artifacts.py` |

### Source Files (referenced)

| File | Description |
|------|-------------|
| `frontend/src/components/LotteryOptimizerEngine.js` | All 20 optimizer strategies, game configs, scoring |
| `frontend/src/components/PredictionTracker.js` | Prediction tracking, learning weights |
| `backend/main.py` | FastAPI with 15 endpoints for data extraction |
| `REST_API_USER_GUIDE.md` | API usage guide with examples |

### Dependencies

```bash
# Training dependencies
pip install pandas numpy scikit-learn xgboost lightgbm shap joblib

# For neural network
pip install torch

# For SMOTE
pip install imbalanced-learn

# For artifact generation
pip install python-pptx openpyxl

# For API data collection
pip install requests
```

---

## Appendix A: Game Configurations

From `OPTIMIZER_GAME_CONFIGS` in `LotteryOptimizerEngine.js`:

| Game | pickSize | poolSize | bonusPool | scale_pos_weight |
|------|----------|----------|-----------|-----------------|
| pick3 | 3 | 10 | — | 2.3 |
| pick4 | 4 | 10 | — | 1.5 |
| pick5 | 5 | 39 | — | 6.8 |
| powerball | 5 | 69 | 26 | 12.8 |
| megamil | 5 | 70 | 25 | 13.0 |
| fantasy5 | 5 | 39 | — | 6.8 |
| superlotto | 5 | 47 | 27 | 8.4 |
| cash5 | 5 | 35 | — | 6.0 |
| lotto | 6 | 54 | — | 8.0 |

## Appendix B: The 20 Optimizer Strategies

| # | Strategy | Function | Features Generated |
|---|----------|----------|-------------------|
| 1 | AC Value | `computeACValue()` | combo_ac_value, combo_ac_in_range |
| 2 | Frequency Analysis | `computeFreqFromEntries()`, `computeFALevels()` | overall_freq, temporal_decay_freq, fa_level |
| 3 | Skip Analysis (SA1-SA5) | `computeDetailedSkips()`, `computeSALevels()` | skip_value, sa_level, is_overdue |
| 3b | Consecutive Limits | `countConsecutiveSets()` | combo_consec_sets, combo_consec_ok |
| 4 | Gap Analysis | `checkGapConformance()` | combo_gap_conforms, min/max/avg_gap |
| 5 | SK123 Repetition | `checkSK123Rule()` | combo_has_sk123, sk123_match_count |
| 6 | HCPL Ratio | `computeIdealHCPL()` | hot/cold/prime/low counts, combo_hcpl_ok |
| 7 | Start/End Coverage | `computeStartEndCoverage()` | start/end_num, spread, start/end_ok |
| 8 | Pattern Filtering | `computeTopPatterns()` | combo_pattern, combo_in_top27_pattern |
| 8b | Group Filtering | `computeTopGroups()` | combo_group, combo_in_top60_group |
| 9 | Star Rating | `computeEnhancedStarRating()` | star_rating (0-5) |
| 9b | Sum Analysis | `computeSumStats()` | combo_sum, combo_sum_in_range |
| 9c | Odd/Even Analysis | `computeOEStats()` | odd/even_count, oe_pattern, oe_is_top2 |
| 10 | Normal/Unstable | `computeEnhancedStatus()` | game_is_normal, unstable_count |
| 11 | Walk-Forward | `walkForwardBacktest()` | wf_hit_rate, wf_hits, wf_total |
| 12 | Pair Co-occurrence | custom | avg/max_pair_cooccurrence |
| 13 | Positional Freq | computeFreqFromEntries | positional_freq, positional_freq_norm |
| 14 | Temporal Features | derived | day_of_week, month, week_of_year |
| 15 | Tracker Learning | `computeLearningWeights()` | tracker_weight, tracker_hit_history |
| 16 | Jackpot Cycle | derived | draws_since_jackpot |

---

*Generated by the Lotto Extraction ML Pipeline · May 2025*
*Source: LotteryOptimizerEngine.js (20 strategies) + PredictionTracker.js*
