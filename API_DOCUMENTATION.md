# Lotto Extraction API Documentation

## Base URL

```
https://lotto-api-b4yk.onrender.com
```

## Quick Start

Your API is **open** (no API key required) and supports **CORS from any origin**, so any app, website, or mobile app can call it directly.

---

## Interactive Docs (Swagger UI)

Visit the built-in interactive documentation to test endpoints in your browser:

- **Swagger UI:** https://lotto-api-b4yk.onrender.com/docs
- **ReDoc:** https://lotto-api-b4yk.onrender.com/redoc
- **OpenAPI JSON:** https://lotto-api-b4yk.onrender.com/openapi.json

---

## Rate Limiting

- **60 requests per minute** per IP address
- Exceeded requests receive HTTP `429 Too Many Requests`
- Response header `Retry-After: 60` indicates when to retry

---

## Authentication

Currently **no authentication required**. All endpoints are public.

If you want to restrict access later, you can set the `ALLOWED_ORIGINS` environment variable on Render to limit which domains can call your API.

---

## Core Endpoints

### 1. Extract Lottery Data

Get lottery draw results for any state and game.

#### `POST /extract`

```bash
curl -X POST https://lotto-api-b4yk.onrender.com/extract \
  -H "Content-Type: application/json" \
  -d '{
    "state_code": "NY",
    "lottery_ids": ["mega_millions"],
    "from_date": "2026-05-01",
    "to_date": "2026-05-29"
  }'
```

**Request Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `state_code` | string | Yes | Two-letter state code (e.g. "NY", "CA", "TX") |
| `lottery_ids` | array | Yes | Array of game IDs (see Game IDs table below) |
| `from_date` | string | No | Start date "YYYY-MM-DD" (default: 30 days ago) |
| `to_date` | string | No | End date "YYYY-MM-DD" (default: today) |

**Response:**
```json
{
  "data": [
    {
      "Date": "2026-05-26",
      "Lotto_Name": "Mega Millions",
      "State": "New York",
      "Lottery_ID": "mega_millions",
      "Ball_1": "01",
      "Ball_2": "05",
      "Ball_3": "49",
      "Ball_4": "51",
      "Ball_5": "59",
      "Mega_Ball": "07"
    }
  ],
  "total": 8,
  "state": "NY",
  "lotteries": ["mega_millions"],
  "from_date": "2026-05-01",
  "to_date": "2026-05-29"
}
```

#### `GET /extract`

Same as POST but with query parameters:

```bash
curl "https://lotto-api-b4yk.onrender.com/extract?state_code=NY&lottery_ids=mega_millions&from_date=2026-05-01&to_date=2026-05-29"
```

---

### 2. Export as CSV

#### `POST /extract/csv`

Same request body as `/extract` but returns a downloadable CSV file.

```bash
curl -X POST https://lotto-api-b4yk.onrender.com/extract/csv \
  -H "Content-Type: application/json" \
  -d '{"state_code":"NY","lottery_ids":["powerball"],"from_date":"2026-05-01","to_date":"2026-05-29"}' \
  -o results.csv
```

---

### 3. List Available Lotteries

#### `GET /lotteries/by-state/{state_code}`

```bash
curl https://lotto-api-b4yk.onrender.com/lotteries/by-state/NY
```

**Response:**
```json
{
  "state_code": "NY",
  "state_name": "New York",
  "lotteries": [
    {"id": "mega_millions", "name": "Mega Millions", "balls": 5, "pool": 70, "bonus_pool": 25, "bonus_label": "Mega Ball"},
    {"id": "powerball", "name": "Powerball", "balls": 5, "pool": 69, "bonus_pool": 26, "bonus_label": "Powerball"},
    {"id": "lotto", "name": "New York Lotto", "balls": 6, "pool": 59}
  ]
}
```

#### `GET /lotteries/all-states`

Returns all 50 states and their available lottery games.

---

## Machine Learning Endpoints

### 4. ML Position Analysis (for Optimizer Table)

Get ML-predicted probabilities for every number in the pool, per-position recommendations, and bonus ball predictions.

#### `POST /ml/position-analysis`

```bash
curl -X POST https://lotto-api-b4yk.onrender.com/ml/position-analysis \
  -H "Content-Type: application/json" \
  -d '{
    "game_type": "mega_millions",
    "pool_size": 70,
    "num_balls": 5,
    "bonus_pool": 25,
    "draws": [
      {"date": "2026-05-26", "numbers": [1, 5, 49, 51, 59], "bonus": 7},
      {"date": "2026-05-23", "numbers": [3, 12, 33, 40, 67], "bonus": 15},
      {"date": "2026-05-20", "numbers": [7, 22, 31, 45, 62], "bonus": 3}
    ]
  }'
```

**Request Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `game_type` | string | Yes | Game type: `powerball`, `mega_millions`, `fantasy5`, `pick3`, etc. |
| `pool_size` | int | Yes | Number pool size (69 for Powerball, 70 for Mega Millions) |
| `num_balls` | int | Yes | Balls per draw (5 for Powerball/MM) |
| `bonus_pool` | int | No | Bonus ball pool (26 for Powerball, 25 for MM). Default: 0 |
| `draws` | array | Yes | **Minimum 20 draws.** Each: `{date, numbers: [int], bonus?: int}` |

**Response:**
```json
{
  "status": "success",
  "game_type": "mega_millions",
  "pool_size": 70,
  "num_balls": 5,
  "total_draws_analyzed": 42,
  "predictions": [
    {"ball_number": 3, "probability": 0.0272, "confidence_tier": "high", "rank": 1, "percentile": 1.4},
    {"ball_number": 5, "probability": 0.0264, "confidence_tier": "high", "rank": 2, "percentile": 2.9}
  ],
  "hot_numbers": [...],
  "cold_numbers": [...],
  "position_recommendations": [
    {
      "position": 1,
      "top_picks": [
        {"ball_number": 3, "ml_score": 0.0272, "positional_score": 0.15, "combined_score": 0.0893, "rank": 1}
      ]
    }
  ],
  "bonus_predictions": [
    {"ball_number": 4, "probability": 0.0601, "rank": 1}
  ],
  "model_info": {
    "model_id": null,
    "model_type": "statistical_fallback",
    "source": "statistical",
    "metrics": {"method": "temporal_decay_frequency + recency_weighting"}
  },
  "analysis_date": "2026-05-29"
}
```

---

### 5. ML Predict Next Draw

#### `POST /ml/predict`

```bash
curl -X POST https://lotto-api-b4yk.onrender.com/ml/predict \
  -H "Content-Type: application/json" \
  -d '{
    "game_type": "powerball",
    "state_code": "NY",
    "recent_draws": [
      {"date": "2026-05-28", "numbers": [5, 12, 33, 44, 67], "bonus": 15}
    ]
  }'
```

---

### 6. ML Generate Prediction Lines

#### `POST /ml/predict/lines`

Generate optimized number combinations using ML.

```bash
curl -X POST https://lotto-api-b4yk.onrender.com/ml/predict/lines \
  -H "Content-Type: application/json" \
  -d '{
    "game_type": "mega_millions",
    "state_code": "NY",
    "num_lines": 5,
    "recent_draws": [
      {"date": "2026-05-26", "numbers": [1, 5, 49, 51, 59], "bonus": 7}
    ]
  }'
```

---

### 7. Train ML Model

#### `POST /ml/train/from-api`

Train a model using data from the extraction API.

```bash
curl -X POST https://lotto-api-b4yk.onrender.com/ml/train/from-api \
  -H "Content-Type: application/json" \
  -d '{
    "game_type": "mega_millions",
    "state_code": "NY",
    "from_date": "2025-01-01",
    "to_date": "2026-05-29"
  }'
```

---

### 8. List ML Models

#### `GET /ml/models`

```bash
curl https://lotto-api-b4yk.onrender.com/ml/models
```

---

### 9. ML Backtest

#### `POST /ml/backtest`

Run walk-forward backtesting to evaluate model performance.

---

### 10. ML Features

#### `GET /ml/features`

List all 60+ ML features and their descriptions.

```bash
curl https://lotto-api-b4yk.onrender.com/ml/features
```

---

### 11. ML Health

#### `GET /ml/health`

```bash
curl https://lotto-api-b4yk.onrender.com/ml/health
```

---

## Game IDs Reference

| Game ID | Game Name | Balls | Pool | Bonus Pool | Bonus Label |
|---------|-----------|-------|------|------------|-------------|
| `mega_millions` | Mega Millions | 5 | 70 | 25 | Mega Ball |
| `powerball` | Powerball | 5 | 69 | 26 | Powerball |
| `lotto` | State Lotto | 6 | varies | - | - |
| `cash4life` | Cash4Life | 5 | 60 | 4 | Cash Ball |
| `pick3` | Pick 3 | 3 | 10 | - | - |
| `pick4` | Pick 4 | 4 | 10 | - | - |
| `fantasy5` | Fantasy 5 | 5 | varies | - | - |
| `numbers` | Numbers | 3 | 10 | - | - |
| `win4` | Win 4 | 4 | 10 | - | - |
| `take5` | Take 5 | 5 | 39 | - | - |

---

## Supported States

All 50 US states are supported. Use two-letter state codes: `NY`, `CA`, `TX`, `FL`, `PA`, `OH`, `IL`, `GA`, `NJ`, `MI`, etc.

Get the full list with: `GET /lotteries/all-states`

---

## Integration Examples

### JavaScript (Frontend)

```javascript
// Fetch Mega Millions results
const response = await fetch('https://lotto-api-b4yk.onrender.com/extract', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    state_code: 'NY',
    lottery_ids: ['mega_millions'],
    from_date: '2026-05-01',
    to_date: '2026-05-29'
  })
});
const data = await response.json();
console.log(data.data); // Array of draw results
```

### Python

```python
import requests

# Get Powerball results
resp = requests.post('https://lotto-api-b4yk.onrender.com/extract', json={
    'state_code': 'NY',
    'lottery_ids': ['powerball'],
    'from_date': '2026-05-01',
    'to_date': '2026-05-29'
})
draws = resp.json()['data']
for draw in draws:
    print(f"{draw['Date']}: {draw['Ball_1']}-{draw['Ball_2']}-{draw['Ball_3']}-{draw['Ball_4']}-{draw['Ball_5']} + {draw['Powerball']}")
```

### Python (ML Predictions)

```python
import requests

# Get draws first
draws_resp = requests.post('https://lotto-api-b4yk.onrender.com/extract', json={
    'state_code': 'NY',
    'lottery_ids': ['mega_millions'],
    'from_date': '2026-01-01',
    'to_date': '2026-05-29'
})
raw_draws = draws_resp.json()['data']

# Convert to ML format
draws = [{
    'date': d['Date'],
    'numbers': [int(d[f'Ball_{i}']) for i in range(1, 6)],
    'bonus': int(d.get('Mega_Ball', 0))
} for d in raw_draws]

# Run ML analysis
ml_resp = requests.post('https://lotto-api-b4yk.onrender.com/ml/position-analysis', json={
    'game_type': 'mega_millions',
    'pool_size': 70,
    'num_balls': 5,
    'bonus_pool': 25,
    'draws': draws
})
result = ml_resp.json()
print(f"Top ML picks: {[p['ball_number'] for p in result['predictions'][:5]]}")
print(f"Top bonus balls: {[b['ball_number'] for b in result['bonus_predictions'][:3]]}")
```

### React Native / Mobile App

```javascript
const API_BASE = 'https://lotto-api-b4yk.onrender.com';

// Get available games for a state
const games = await fetch(`${API_BASE}/lotteries/by-state/CA`).then(r => r.json());

// Get results
const results = await fetch(`${API_BASE}/extract`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    state_code: 'CA',
    lottery_ids: ['mega_millions', 'powerball'],
    from_date: '2026-05-01',
    to_date: '2026-05-29'
  })
}).then(r => r.json());
```

### cURL (Command Line)

```bash
# Quick test - get Powerball results
curl -s https://lotto-api-b4yk.onrender.com/extract \
  -H "Content-Type: application/json" \
  -d '{"state_code":"NY","lottery_ids":["powerball"],"from_date":"2026-05-01","to_date":"2026-05-29"}' | jq .

# Get all available states
curl -s https://lotto-api-b4yk.onrender.com/lotteries/all-states | jq .

# Health check
curl -s https://lotto-api-b4yk.onrender.com/health | jq .
```

---

## Response Headers

Every response includes:
| Header | Description |
|--------|-------------|
| `X-Request-ID` | Unique request tracking ID |
| `X-Total-Records` | Number of records returned |
| `X-State` | State code processed |
| `X-Lotteries` | Lottery games queried |
| `X-From-Date` | Date range start |
| `X-To-Date` | Date range end |

---

## Error Responses

| Code | Meaning | Example |
|------|---------|---------|
| `400` | Bad request / invalid params | `{"detail": "Need at least 20 draws for ML analysis. Got 5."}` |
| `404` | Endpoint not found | `{"detail": "API path not found: /invalid"}` |
| `429` | Rate limited | `{"detail": "Too many requests. Limit: 60/min per IP."}` |
| `500` | Server error | `{"detail": "Internal server error"}` |

---

## How to Share With Another App

### Option A: Direct API Calls (Recommended)

Any app can call your API directly — no setup needed:

```
Base URL: https://lotto-api-b4yk.onrender.com
```

- CORS is enabled for all origins (`*`)
- No authentication required
- JSON request/response format
- Rate limit: 60 req/min per IP

### Option B: Share the Swagger UI Link

Send developers this link for interactive exploration:

```
https://lotto-api-b4yk.onrender.com/docs
```

### Option C: Share the OpenAPI Spec

Other apps can auto-generate client code from your OpenAPI spec:

```
https://lotto-api-b4yk.onrender.com/openapi.json
```

Tools like **Postman**, **Insomnia**, or code generators (openapi-generator) can import this directly.

### Option D: Embed in Postman

1. Open Postman
2. Click **Import**
3. Paste: `https://lotto-api-b4yk.onrender.com/openapi.json`
4. All endpoints will be auto-configured

---

## Hosting & Uptime

- **Hosted on:** Render (Free tier)
- **Cold starts:** First request after idle may take 30-60 seconds
- **Auto-deploy:** Pushes to `main` branch auto-deploy
- **GitHub:** `github.com/patpat1957/slater`

---

## Version

- **API Version:** 2.0.0
- **ML Engine:** scikit-learn (RandomForest + GradientBoosting, 60+ features)
- **Last Updated:** 2026-05-29
