-- ═══════════════════════════════════════════════════════════════════════════
--  Lottery ML Pipeline — Database Schema (PostgreSQL)
--  Stores: raw draws, ball states, ML features, predictions, model results
--  Compatible with: XGBoost, Random Forest, LightGBM, Neural Networks
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Raw Draw Results (from Lotto Extraction API) ──────────────────────
CREATE TABLE IF NOT EXISTS draws (
    draw_id         TEXT PRIMARY KEY,           -- e.g. "CA_powerball_2025-05-27_evening"
    draw_date       DATE NOT NULL,
    state_code      CHAR(2) NOT NULL,
    game_type       VARCHAR(20) NOT NULL,       -- pick3/pick4/powerball/megamil/etc
    draw_time       VARCHAR(10) NOT NULL,       -- midday/evening
    numbers         INTEGER[] NOT NULL,         -- winning numbers array
    bonus_number    INTEGER,                    -- Powerball/Mega Ball (nullable)
    combo_sum       INTEGER NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(state_code, game_type, draw_date, draw_time)
);

CREATE INDEX idx_draws_date ON draws(draw_date DESC);
CREATE INDEX idx_draws_game ON draws(state_code, game_type);

-- ── 2. Ball States (core tracking: Winner/Prediction/BestPractice ON/OFF) ──
CREATE TABLE IF NOT EXISTS ball_states (
    id              BIGSERIAL PRIMARY KEY,
    draw_id         TEXT REFERENCES draws(draw_id),
    ball_number     INTEGER NOT NULL,
    ball_position   INTEGER,                    -- position in draw (-1 if not drawn)

    -- ═══ THE THREE CORE BALL STATES ═══
    winner_state    SMALLINT NOT NULL DEFAULT 0,    -- 1=drawn, 0=not drawn
    prediction_state SMALLINT NOT NULL DEFAULT 0,   -- 1=predicted, 0=not predicted
    best_practice_state SMALLINT NOT NULL DEFAULT 0,-- 1=passes filters, 0=fails

    -- Derived tracking
    hit_type        VARCHAR(20),                -- 'exact_hit','partial_hit','miss','false_positive'
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ball_states_draw ON ball_states(draw_id);
CREATE INDEX idx_ball_states_number ON ball_states(ball_number);
CREATE INDEX idx_ball_states_winner ON ball_states(winner_state);

-- ── 3. ML Feature Vectors (one row per ball per draw) ────────────────────
CREATE TABLE IF NOT EXISTS ml_features (
    id              BIGSERIAL PRIMARY KEY,
    draw_id         TEXT REFERENCES draws(draw_id),
    ball_number     INTEGER NOT NULL,

    -- Ball States (duplicated for fast queries)
    winner_state    SMALLINT NOT NULL DEFAULT 0,
    prediction_state SMALLINT NOT NULL DEFAULT 0,
    best_practice_state SMALLINT NOT NULL DEFAULT 0,

    -- Frequency features
    overall_freq         REAL,
    overall_freq_norm    REAL,
    temporal_decay_freq  REAL,
    positional_freq      REAL,
    positional_freq_norm REAL,

    -- Skip/Recency
    skip_value      INTEGER,
    skip_normalized REAL,
    is_overdue      SMALLINT DEFAULT 0,
    sa_level        SMALLINT,

    -- Hot/Cold/Prime/Low
    is_hot          SMALLINT DEFAULT 0,
    is_cold         SMALLINT DEFAULT 0,
    is_warm         SMALLINT DEFAULT 0,
    is_prime_digit  SMALLINT DEFAULT 0,
    is_low_digit    SMALLINT DEFAULT 0,

    -- Pair co-occurrence
    avg_pair_cooccurrence REAL,
    max_pair_cooccurrence REAL,

    -- FA level
    fa_level        SMALLINT,
    in_fa_top30     SMALLINT DEFAULT 0,
    in_fa_top50     SMALLINT DEFAULT 0,

    -- Combo-level features
    combo_sum            INTEGER,
    combo_sum_in_range   SMALLINT DEFAULT 0,
    combo_odd_count      SMALLINT,
    combo_even_count     SMALLINT,
    combo_oe_pattern     VARCHAR(10),
    combo_oe_is_top2     SMALLINT DEFAULT 0,
    combo_consec_sets    SMALLINT,
    combo_consec_ok      SMALLINT DEFAULT 0,

    -- AC Value (Strategy 1)
    combo_ac_value       SMALLINT,
    combo_ac_in_range    SMALLINT DEFAULT 0,

    -- Gap Analysis (Strategy 4)
    combo_gap_conforms   SMALLINT DEFAULT 0,
    min_gap              SMALLINT,
    max_gap              SMALLINT,
    avg_gap              REAL,

    -- SK123 (Strategy 5)
    combo_has_sk123      SMALLINT DEFAULT 0,
    sk123_match_count    SMALLINT,

    -- HCPL (Strategy 6)
    combo_hot_count      SMALLINT,
    combo_cold_count     SMALLINT,
    combo_prime_count    SMALLINT,
    combo_low_count      SMALLINT,
    combo_hcpl_ok        SMALLINT DEFAULT 0,

    -- Start/End (Strategy 7)
    combo_start_num      INTEGER,
    combo_end_num        INTEGER,
    combo_start_ok       SMALLINT DEFAULT 0,
    combo_end_ok         SMALLINT DEFAULT 0,
    combo_spread         INTEGER,

    -- Pattern/Group (Strategy 8)
    combo_pattern        VARCHAR(20),
    combo_in_top27_pattern SMALLINT DEFAULT 0,
    combo_group          VARCHAR(30),
    combo_in_top60_group SMALLINT DEFAULT 0,

    -- Game status (Strategy 10)
    game_is_normal       SMALLINT DEFAULT 1,
    game_unstable_count  SMALLINT DEFAULT 0,

    -- Walk-forward backtest
    wf_hit_rate          REAL,
    wf_hits              INTEGER,
    wf_total             INTEGER,

    -- Star rating
    star_rating          SMALLINT,

    -- Tracker learning
    tracker_weight       REAL DEFAULT 1.0,
    tracker_hit_history  REAL DEFAULT 0.0,

    -- Temporal
    day_of_week          SMALLINT,
    week_of_year         SMALLINT,
    month                SMALLINT,
    draws_since_jackpot  INTEGER,

    created_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ml_features_draw ON ml_features(draw_id);
CREATE INDEX idx_ml_features_ball ON ml_features(ball_number);
CREATE INDEX idx_ml_features_winner ON ml_features(winner_state);

-- ── 4. ML Models (track trained models and their performance) ────────────
CREATE TABLE IF NOT EXISTS ml_models (
    model_id        TEXT PRIMARY KEY,           -- e.g. "xgb_powerball_v3_20250527"
    model_name      VARCHAR(100) NOT NULL,      -- "XGBoost Powerball Classifier"
    model_type      VARCHAR(30) NOT NULL,       -- xgboost/random_forest/lightgbm/neural_net
    game_type       VARCHAR(20) NOT NULL,
    state_code      CHAR(2),
    target_column   VARCHAR(50) NOT NULL,       -- "winner_state"
    feature_columns TEXT[] NOT NULL,            -- list of feature column names used
    hyperparameters JSONB NOT NULL,             -- model hyperparameters
    training_rows   INTEGER NOT NULL,
    training_date_range TEXT,                   -- "2024-01-01 to 2025-05-01"
    metrics         JSONB NOT NULL,             -- {"auc": 0.72, "accuracy": 0.68, "f1": 0.55, ...}
    model_blob_path TEXT,                       -- path to saved model file
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    is_active       BOOLEAN DEFAULT TRUE
);

-- ── 5. ML Predictions (model outputs for upcoming draws) ─────────────────
CREATE TABLE IF NOT EXISTS ml_predictions (
    id              BIGSERIAL PRIMARY KEY,
    model_id        TEXT REFERENCES ml_models(model_id),
    target_draw_date DATE NOT NULL,
    state_code      CHAR(2) NOT NULL,
    game_type       VARCHAR(20) NOT NULL,
    draw_time       VARCHAR(10) NOT NULL,
    ball_number     INTEGER NOT NULL,
    predicted_probability REAL NOT NULL,         -- 0.0 to 1.0
    predicted_class SMALLINT NOT NULL,           -- 0 or 1
    confidence_tier VARCHAR(10),                 -- "high"/"medium"/"low"
    prediction_rank INTEGER,                     -- rank within this prediction set
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_predictions_date ON ml_predictions(target_draw_date);
CREATE INDEX idx_predictions_model ON ml_predictions(model_id);

-- ── 6. Prediction Outcomes (compare predictions vs actual) ───────────────
CREATE TABLE IF NOT EXISTS prediction_outcomes (
    id              BIGSERIAL PRIMARY KEY,
    prediction_id   BIGINT REFERENCES ml_predictions(id),
    draw_id         TEXT REFERENCES draws(draw_id),
    was_correct     BOOLEAN NOT NULL,
    actual_state    SMALLINT NOT NULL,           -- actual winner_state
    predicted_prob  REAL NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── 7. Feature Importance (from trained models) ──────────────────────────
CREATE TABLE IF NOT EXISTS feature_importance (
    id              BIGSERIAL PRIMARY KEY,
    model_id        TEXT REFERENCES ml_models(model_id),
    feature_name    VARCHAR(50) NOT NULL,
    importance_score REAL NOT NULL,
    importance_rank INTEGER NOT NULL,
    importance_type VARCHAR(20) DEFAULT 'gain'   -- gain/weight/cover/shap
);

-- ── VIEWS ─────────────────────────────────────────────────────────────────

-- Ball state summary per number (for quick lookups)
CREATE OR REPLACE VIEW v_ball_state_summary AS
SELECT
    ball_number,
    d.game_type,
    d.state_code,
    COUNT(*) as total_draws,
    SUM(bs.winner_state) as times_won,
    SUM(bs.prediction_state) as times_predicted,
    SUM(bs.best_practice_state) as times_best_practice,
    ROUND(AVG(bs.winner_state)::numeric, 4) as win_rate,
    ROUND(AVG(bs.prediction_state)::numeric, 4) as prediction_rate,
    ROUND(AVG(bs.best_practice_state)::numeric, 4) as best_practice_rate,
    -- Precision: when we predicted, how often was it a winner?
    CASE WHEN SUM(bs.prediction_state) > 0
         THEN ROUND(SUM(CASE WHEN bs.winner_state=1 AND bs.prediction_state=1 THEN 1 ELSE 0 END)::numeric
                     / SUM(bs.prediction_state)::numeric, 4)
         ELSE 0 END as prediction_precision,
    -- Recall: of actual winners, how many did we predict?
    CASE WHEN SUM(bs.winner_state) > 0
         THEN ROUND(SUM(CASE WHEN bs.winner_state=1 AND bs.prediction_state=1 THEN 1 ELSE 0 END)::numeric
                     / SUM(bs.winner_state)::numeric, 4)
         ELSE 0 END as prediction_recall
FROM ball_states bs
JOIN draws d ON bs.draw_id = d.draw_id
GROUP BY ball_number, d.game_type, d.state_code;

-- Model performance comparison
CREATE OR REPLACE VIEW v_model_performance AS
SELECT
    m.model_id,
    m.model_name,
    m.model_type,
    m.game_type,
    (m.metrics->>'auc')::real as auc,
    (m.metrics->>'accuracy')::real as accuracy,
    (m.metrics->>'f1')::real as f1_score,
    (m.metrics->>'precision')::real as precision,
    (m.metrics->>'recall')::real as recall,
    m.training_rows,
    m.created_at,
    m.is_active
FROM ml_models m
ORDER BY (m.metrics->>'auc')::real DESC;

-- Training data export view (join everything for ML pipeline)
CREATE OR REPLACE VIEW v_ml_training_data AS
SELECT
    f.*,
    d.numbers as actual_numbers,
    d.bonus_number as actual_bonus
FROM ml_features f
JOIN draws d ON f.draw_id = d.draw_id
ORDER BY d.draw_date DESC, f.ball_number;
