# Lotto Extraction REST API - User Guide

**Version:** 1.1.0
**API Spec:** `/docs` (Swagger UI) | `/redoc` (ReDoc) | `/openapi.json` (OpenAPI 3.0)

---

## Table of Contents

1. [Overview](#1-overview)
2. [Setup & Installation](#2-setup--installation)
3. [Running the Server](#3-running-the-server)
4. [Authentication & Rate Limits](#4-authentication--rate-limits)
5. [API Endpoints Reference](#5-api-endpoints-reference)
   - [Info & Health](#info--health)
   - [Lottery Discovery](#lottery-discovery)
   - [Data Extraction](#data-extraction)
   - [Scoreboard API](#scoreboard-api)
6. [Request & Response Examples](#6-request--response-examples)
7. [California (CA) — Quick-Start Guide](#california-ca--quick-start-guide)
8. [Supported States & Lottery IDs](#7-supported-states--lottery-ids)
9. [Response Field Reference](#8-response-field-reference)
10. [Error Handling](#9-error-handling)
11. [CSV Export](#10-csv-export)
12. [Data Sources & Coverage](#11-data-sources--coverage)
13. [Production Deployment](#12-production-deployment)
14. [Environment Variables](#13-environment-variables)
15. [Troubleshooting](#14-troubleshooting)

---

## 1. Overview

The **Lotto Extraction API** provides **real US lottery draw results** from official public sources. No simulated or random numbers are ever generated.

**Key features:**

- **46 US states** with 280+ lottery games supported
- **Date range queries** up to 10 years of historical data
- **JSON and CSV** output formats
- **Multi-lottery queries** in a single request
- **Location-based discovery** by state code or IP geolocation
- **Real-time scoreboard** for Pick 3/4/5, Powerball, and Mega Millions across all states
- **7 data sources** including official government APIs, state lottery websites, and public archives
- **Zero authentication** required - public API
- **Production-ready** with rate limiting, security headers, metrics, and health probes

---

## 2. Setup & Installation

### Prerequisites

- **Python 3.9+** (tested on 3.11)
- **pip** (Python package manager)
- **Node.js 18+** and **npm** (for frontend build only)

### Backend Setup

```bash
# Clone the repository
git clone <repository-url>
cd webapp

# Install Python dependencies
cd backend
pip install -r requirements.txt
```

**Required Python packages** (installed via requirements.txt):

| Package | Purpose |
|---|---|
| `fastapi` | Web framework |
| `uvicorn` | ASGI server |
| `httpx` | Async HTTP client for scraping |
| `requests` | HTTP client (Louisiana CSV needs it) |
| `beautifulsoup4` | HTML parsing for lottery sites |
| `lxml` | Fast HTML/XML parser |
| `pydantic` | Request/response validation |
| `stripe` | Payment processing (optional) |

If `requirements.txt` is missing, install manually:

```bash
pip install fastapi uvicorn httpx requests beautifulsoup4 lxml pydantic stripe
```

### Frontend Setup (Optional)

The frontend is a React app for the lottery optimizer UI. It's optional for API-only use.

```bash
cd frontend
npm install
npm run build

# Copy build output to backend static directory
cp -r build/* ../backend/static/ 2>/dev/null || true
```

---

## 3. Running the Server

### Development Mode

```bash
cd backend

# Start with auto-reload (development)
uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# Start without reload (production-like)
uvicorn main:app --host 0.0.0.0 --port 8000
```

The API will be available at `http://localhost:8000`.

### Verify the Server is Running

```bash
# Health check
curl http://localhost:8000/health
# Expected: {"status":"healthy","timestamp":"...","version":"1.1.0"}

# Readiness check (verifies config + scrapers loaded)
curl http://localhost:8000/health/ready
# Expected: {"status":"ready","checks":{"lottery_config":{"status":"ok",...},...}}

# API info
curl http://localhost:8000/api/info
```

### Production Mode (with Gunicorn)

```bash
pip install gunicorn

# Run with multiple workers
gunicorn main:app -w 4 -k uvicorn.workers.UvicornWorker \
  --bind 0.0.0.0:8000 \
  --timeout 120 \
  --access-logfile -
```

### Using PM2 (Node.js process manager)

```bash
npm install -g pm2

# Create ecosystem config
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: "lotto-api",
    script: "uvicorn",
    args: "main:app --host 0.0.0.0 --port 8000",
    cwd: "./backend",
    interpreter: "none",
    env: {
      ALLOWED_ORIGINS: "https://yourdomain.com",
      RATE_LIMIT_REQUESTS: "60",
      RATE_LIMIT_WINDOW: "60"
    }
  }]
};
EOF

pm2 start ecosystem.config.js
pm2 status
pm2 logs lotto-api
```

---

## 4. Authentication & Rate Limits

| Setting | Value |
|---|---|
| Authentication | None required (public API) |
| Rate limit | **60 requests per 60 seconds per IP** |
| Rate limit response | HTTP `429 Too Many Requests` + `Retry-After: 60` header |
| Max date range per request | **10 years (3,653 days)** |
| Future dates | Automatically capped to today |
| CORS | Configurable via `ALLOWED_ORIGINS` env var (defaults to `*`) |

---

## 5. API Endpoints Reference

### Info & Health

---

#### `GET /api/info`

Returns API metadata, version, supported data sources, and full endpoint listing.

```bash
curl http://localhost:8000/api/info
```

**Response:**
```json
{
  "name": "Lotto Extraction API",
  "version": "1.1.0",
  "endpoints": { "GET /extract": "...", "POST /extract": "...", ... },
  "supported_states": 46,
  "total_lotteries": 281
}
```

---

#### `GET /health`

Liveness probe. Returns 200 if the process is alive.

```bash
curl http://localhost:8000/health
```

---

#### `GET /health/ready`

Readiness probe. Returns 200 if lottery config and scrapers are loaded. Returns 503 if not ready.

```bash
curl http://localhost:8000/health/ready
```

---

#### `GET /metrics`

Runtime performance metrics: request counts, error rates, response times, uptime.

```bash
curl http://localhost:8000/metrics
```

**Response:**
```json
{
  "version": "1.1.0",
  "uptime_seconds": 86400,
  "requests": {
    "total": 1500,
    "success": 1420,
    "error": 80,
    "4xx": 75,
    "5xx": 5,
    "success_rate_pct": 94.7
  },
  "records_served": 125000,
  "response_time_ms": { "avg": 850, "p95": 3200, "p99": 8500 },
  "rate_limit": { "requests_per_window": 60, "window_seconds": 60 }
}
```

---

### Lottery Discovery

---

#### `GET /lotteries/all-states`

Returns all 51 US states/territories with their available lottery games.

```bash
curl http://localhost:8000/lotteries/all-states
```

**Response:**
```json
{
  "total_states": 51,
  "states_with_lottery": 46,
  "states": [
    {
      "state_code": "VA",
      "state_name": "Virginia",
      "lottery_count": 8,
      "lotteries": [
        { "id": "powerball",    "name": "Powerball",    "type": "multistate" },
        { "id": "mega_millions","name": "Mega Millions","type": "multistate" },
        { "id": "va_cash5",     "name": "Cash 5",       "type": "state" },
        { "id": "va_pick3",     "name": "Pick 3 Night", "type": "state" },
        ...
      ]
    },
    ...
  ]
}
```

---

#### `GET /lotteries/by-state/{state_code}`

Returns all lottery games available in a specific state.

| Parameter | Type | Required | Example |
|---|---|---|---|
| `state_code` | path string | Yes | `VA`, `NY`, `CA`, `FL` |

> State codes are case-insensitive (`va` and `VA` both work).

```bash
curl http://localhost:8000/lotteries/by-state/VA
```

**Response:**
```json
{
  "state_code": "VA",
  "state_name": "Virginia",
  "lottery_count": 8,
  "lotteries": [
    { "id": "va_cash5",     "name": "Cash 5",       "type": "state" },
    { "id": "va_pick3",     "name": "Pick 3 Night", "type": "state" },
    { "id": "va_pick3_day", "name": "Pick 3 Day",   "type": "state" },
    { "id": "va_pick4",     "name": "Pick 4 Night", "type": "state" },
    { "id": "va_pick4_day", "name": "Pick 4 Day",   "type": "state" },
    { "id": "va_cash4life", "name": "Cash4Life",    "type": "multistate" },
    { "id": "powerball",    "name": "Powerball",    "type": "multistate" },
    { "id": "mega_millions","name": "Mega Millions","type": "multistate" }
  ]
}
```

**Error responses:**
- `404` - State code not found (e.g., `ZZ`)
- For states without lotteries (AL, AK, HI, NV, UT), returns `lotteries: []` with a message

---

#### `GET /lotteries/detect-location`

Auto-detect state from IP address and return available lotteries.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ip` | query string | No | IP address for geolocation (auto-detected if omitted) |
| `state_code` | query string | No | Override with a known state code |

```bash
# Auto-detect from IP
curl http://localhost:8000/lotteries/detect-location

# Override with known state
curl "http://localhost:8000/lotteries/detect-location?state_code=VA"
```

---

#### `GET /lotteries/sources`

Returns detailed information about all data sources used by the API.

```bash
curl http://localhost:8000/lotteries/sources
```

---

### Data Extraction

---

#### `GET /extract`

Retrieve lottery draw results as JSON via query parameters.

| Parameter | Type | Required | Description | Example |
|---|---|---|---|---|
| `state_code` | string | Yes | 2-letter US state code | `VA` |
| `lottery_ids` | string | Yes | Comma-separated lottery IDs | `va_cash5,va_pick3` |
| `from_date` | string | Yes | Start date `YYYY-MM-DD` | `2025-01-01` |
| `to_date` | string | Yes | End date `YYYY-MM-DD` | `2025-12-31` |

```bash
curl "http://localhost:8000/extract?state_code=VA&lottery_ids=va_cash5&from_date=2025-05-01&to_date=2025-05-26"
```

**Response:**
```json
{
  "state_code": "VA",
  "state_name": "Virginia",
  "lotteries": ["Cash 5"],
  "from_date": "2025-05-01",
  "to_date": "2025-05-26",
  "total_records": 26,
  "data": [
    {
      "Date": "2025-05-26",
      "Lotto_Name": "Cash 5",
      "State": "Virginia",
      "Lottery_ID": "va_cash5",
      "Ball_1": "04",
      "Ball_2": "05",
      "Ball_3": "25",
      "Ball_4": "28",
      "Ball_5": "36"
    },
    ...
  ],
  "csv_filename": "Virginia_Cash_5_20250501_20250526.csv",
  "errors": [],
  "warnings": [],
  "data_sources": [
    "NY Open Data (data.ny.gov) - Official government data",
    "lotto.net / lottery.net - Historical results archives",
    "lotteryusa.com - Recent draw results"
  ]
}
```

**Validation rules:**
- `state_code` must be a valid 2-letter US state code
- States without lotteries (AL, AK, HI, NV, UT) return `400`
- Unknown `state_code` returns `404`
- Unknown `lottery_ids` are skipped with a warning
- Cross-state lottery requests are allowed with a warning (e.g., requesting `va_cash5` under `CA`)
- `from_date` must be before `to_date`
- Maximum date range: 10 years per request
- Future dates are automatically capped to today

---

#### `POST /extract`

Same as `GET /extract` but accepts a JSON request body.

```bash
curl -X POST http://localhost:8000/extract \
  -H "Content-Type: application/json" \
  -d '{
    "state_code": "NY",
    "lottery_ids": ["powerball", "mega_millions", "ny_take5"],
    "from_date": "2025-01-01",
    "to_date": "2025-12-31"
  }'
```

---

#### `GET /extract/csv`

Same parameters as `GET /extract` but returns a downloadable CSV file.

```bash
curl -O -J "http://localhost:8000/extract/csv?state_code=VA&lottery_ids=va_cash5&from_date=2025-01-01&to_date=2025-12-31"
```

**Response headers:**
```
Content-Type: text/csv
Content-Disposition: attachment; filename="Virginia_Cash_5_20250101_20251231.csv"
X-Total-Records: 365
X-State: Virginia
X-Lotteries: Cash 5
X-From-Date: 2025-01-01
X-To-Date: 2025-12-31
```

---

#### `POST /extract/csv`

Same as `GET /extract/csv` but accepts a JSON request body.

---

### Scoreboard API

The Scoreboard API provides real-time multi-state results for pick games, Powerball, and Mega Millions. Results are cached for 5 minutes to avoid hammering upstream sources.

---

#### `GET /api/scoreboard`

Returns the latest draw results for all participating states for a given game type.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `game` | string | No | `pick3` | Game type: `pick3`, `pick4`, `pick5`, `powerball`, `megamillions` |
| `draw` | string | No | `evening` | Draw time: `evening`, `midday`, `night` |
| `target_date` | string | No | today | Target date `YYYY-MM-DD` |

```bash
# Get Pick 3 evening results for all states
curl "http://localhost:8000/api/scoreboard?game=pick3&draw=evening"

# Get Powerball results
curl "http://localhost:8000/api/scoreboard?game=powerball&draw=evening"

# Get Pick 4 midday results for a specific date
curl "http://localhost:8000/api/scoreboard?game=pick4&draw=midday&target_date=2025-05-20"
```

**Response:**
```json
{
  "game": "pick3",
  "draw": "evening",
  "target_date": "2025-05-26",
  "fetched_at": "2025-05-26T23:45:00.000000",
  "entries": [
    {
      "state": "VA",
      "lottery_id": "va_pick3",
      "lottery_name": "Pick 3 Night",
      "date": "2025-05-26",
      "balls": ["3", "7", "9"],
      "extra": "2",
      "status": "confirmed"
    },
    {
      "state": "NY",
      "lottery_id": "ny_numbers",
      "lottery_name": "Numbers",
      "date": "2025-05-26",
      "balls": ["1", "4", "8"],
      "extra": "",
      "status": "confirmed"
    },
    ...
  ],
  "total_states": 25,
  "errors": [],
  "cache_ttl_seconds": 300
}
```

**Scoreboard game coverage:**

| Game | States | Draw Types |
|---|---|---|
| `pick3` | 25 states | evening, midday, night |
| `pick4` | 19 states | evening, midday, night |
| `pick5` | 5 states | evening, midday |
| `powerball` | 1 (US) | evening |
| `megamillions` | 1 (US) | evening |

---

#### `GET /api/scoreboard/games`

Returns available scoreboard game types with their state counts and draw types.

```bash
curl http://localhost:8000/api/scoreboard/games
```

**Response:**
```json
{
  "games": {
    "pick3":       { "states": 25, "draws": ["evening", "midday", "night"] },
    "pick4":       { "states": 19, "draws": ["evening", "midday", "night"] },
    "pick5":       { "states": 5,  "draws": ["evening", "midday"] },
    "powerball":   { "states": 1,  "draws": ["evening"] },
    "megamillions":{ "states": 1,  "draws": ["evening"] }
  }
}
```

---

## 6. Request & Response Examples

### curl - Get Virginia lottery IDs

```bash
curl http://localhost:8000/lotteries/by-state/VA
```

### curl - Extract Powerball results

```bash
curl "http://localhost:8000/extract?state_code=NY&lottery_ids=powerball&from_date=2025-01-01&to_date=2025-12-31"
```

### curl - POST multiple lotteries

```bash
curl -X POST http://localhost:8000/extract \
  -H "Content-Type: application/json" \
  -d '{
    "state_code": "NY",
    "lottery_ids": ["powerball", "mega_millions", "ny_take5"],
    "from_date": "2025-01-01",
    "to_date": "2025-12-31"
  }'
```

### curl - Download CSV

```bash
curl -O -J "http://localhost:8000/extract/csv?state_code=VA&lottery_ids=va_cash5&from_date=2025-01-01&to_date=2025-12-31"
```

### Python - Extract and process results

```python
import requests

BASE_URL = "http://localhost:8000"  # Change to your production URL

# Step 1: Discover lotteries for Virginia
resp = requests.get(f"{BASE_URL}/lotteries/by-state/VA")
lotteries = resp.json()["lotteries"]
print(f"Virginia has {len(lotteries)} lotteries:")
for lot in lotteries:
    print(f"  {lot['id']:20s} - {lot['name']} ({lot['type']})")

# Step 2: Extract draw results
resp = requests.post(f"{BASE_URL}/extract", json={
    "state_code": "VA",
    "lottery_ids": ["va_cash5", "va_pick3"],
    "from_date": "2025-05-01",
    "to_date": "2025-05-26"
})
data = resp.json()
print(f"\nTotal records: {data['total_records']}")
print(f"Warnings: {data['warnings']}")
for row in data["data"][:5]:
    balls = [row.get(f"Ball_{i}", "") for i in range(1, 6)]
    print(f"  {row['Date']} {row['Lotto_Name']:15s} -> {' '.join(balls)}")

# Step 3: Download CSV
resp = requests.get(f"{BASE_URL}/extract/csv", params={
    "state_code": "VA",
    "lottery_ids": "va_cash5",
    "from_date": "2025-01-01",
    "to_date": "2025-12-31"
})
filename = resp.headers.get("Content-Disposition", "").split("filename=")[-1].strip('"')
with open(filename or "results.csv", "wb") as f:
    f.write(resp.content)
print(f"\nSaved CSV: {filename}")
```

### JavaScript (fetch) - Extract results

```javascript
const BASE_URL = "http://localhost:8000"; // Change to your production URL

// Discover lotteries
const stateResp = await fetch(`${BASE_URL}/lotteries/by-state/VA`);
const stateData = await stateResp.json();
console.log(`Virginia lotteries: ${stateData.lottery_count}`);

// Extract results
const response = await fetch(`${BASE_URL}/extract`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    state_code: "VA",
    lottery_ids: ["va_cash5", "va_pick3"],
    from_date: "2025-05-01",
    to_date: "2025-05-26"
  })
});
const data = await response.json();
console.log(`Total records: ${data.total_records}`);
data.data.forEach(row => {
  const balls = [1,2,3,4,5].map(i => row[`Ball_${i}`] || "").join(" ");
  console.log(`${row.Date} ${row.Lotto_Name} -> ${balls}`);
});
```

### Scoreboard - Get Pick 3 results for all states

```bash
# Evening draw
curl "http://localhost:8000/api/scoreboard?game=pick3&draw=evening"

# Midday draw
curl "http://localhost:8000/api/scoreboard?game=pick3&draw=midday"

# Specific date
curl "http://localhost:8000/api/scoreboard?game=pick3&draw=evening&target_date=2025-05-20"
```

---

## California (CA) — Quick-Start Guide

California has **7 lottery games** available through the API. This section shows you exactly how to discover, extract, and download CA lottery data.

### Step 1: Discover CA Lottery Games

```bash
curl http://localhost:8000/lotteries/by-state/CA
```

**Response:**
```json
{
  "state_code": "CA",
  "state_name": "California",
  "lotteries": [
    { "id": "powerball",          "name": "Powerball",          "type": "multistate" },
    { "id": "mega_millions",      "name": "Mega Millions",      "type": "multistate" },
    { "id": "ca_superlotto_plus", "name": "SuperLotto Plus",     "type": "state" },
    { "id": "ca_fantasy5",        "name": "Fantasy 5",           "type": "state" },
    { "id": "ca_daily4",          "name": "Daily 4",             "type": "state" },
    { "id": "ca_daily3",          "name": "Daily 3 Evening",     "type": "state" },
    { "id": "ca_midday3",         "name": "Daily 3 Midday",      "type": "state" }
  ],
  "lottery_count": 7
}
```

### Step 2: Extract Results (JSON)

#### Single game — Powerball

```bash
curl "http://localhost:8000/extract?state_code=CA&lottery_ids=powerball&from_date=2025-05-01&to_date=2025-05-27"
```

#### Single game — SuperLotto Plus (CA-only game)

```bash
curl "http://localhost:8000/extract?state_code=CA&lottery_ids=ca_superlotto_plus&from_date=2025-05-01&to_date=2025-05-27"
```

#### Multiple games in one request

```bash
curl "http://localhost:8000/extract?state_code=CA&lottery_ids=powerball,mega_millions,ca_superlotto_plus,ca_fantasy5&from_date=2025-05-01&to_date=2025-05-27"
```

#### All 7 CA games at once

```bash
curl "http://localhost:8000/extract?state_code=CA&lottery_ids=powerball,mega_millions,ca_superlotto_plus,ca_fantasy5,ca_daily4,ca_daily3,ca_midday3&from_date=2025-05-01&to_date=2025-05-27"
```

#### POST method (JSON body)

```bash
curl -X POST http://localhost:8000/extract \
  -H "Content-Type: application/json" \
  -d '{
    "state_code": "CA",
    "lottery_ids": ["powerball", "mega_millions", "ca_superlotto_plus", "ca_fantasy5", "ca_daily4", "ca_daily3", "ca_midday3"],
    "from_date": "2025-01-01",
    "to_date": "2025-05-27"
  }'
```

### Step 3: Download CSV

```bash
# Single game CSV
curl -O -J "http://localhost:8000/extract/csv?state_code=CA&lottery_ids=ca_fantasy5&from_date=2025-01-01&to_date=2025-05-27"

# Multiple games CSV
curl -O -J "http://localhost:8000/extract/csv?state_code=CA&lottery_ids=powerball,ca_superlotto_plus,ca_fantasy5&from_date=2025-01-01&to_date=2025-05-27"
```

Downloaded files are named automatically:
- `California_Fantasy_5_20250101_20250527.csv`
- `California_Powerball_SuperLotto_Plus_Fantasy_5_20250101_20250527.csv`

### CA Game Reference — Lottery IDs & Response Fields

| Game | Lottery ID | Ball Columns | Bonus Columns | Type |
|------|-----------|-------------|--------------|------|
| **Powerball** | `powerball` | `Ball_1`–`Ball_5` | `Powerball`, `Power_Play` | multistate |
| **Mega Millions** | `mega_millions` | `Ball_1`–`Ball_5` | `Mega_Ball`, `Megaplier` | multistate |
| **SuperLotto Plus** | `ca_superlotto_plus` | `Ball_1`–`Ball_5` | `Mega` | state |
| **Fantasy 5** | `ca_fantasy5` | `Ball_1`–`Ball_5` | — | state |
| **Daily 4** | `ca_daily4` | `Ball_1`–`Ball_4` | — | state (Pick 4) |
| **Daily 3 Evening** | `ca_daily3` | `Ball_1`–`Ball_3` | — | state (Pick 3) |
| **Daily 3 Midday** | `ca_midday3` | `Ball_1`–`Ball_3` | — | state (Pick 3) |

> **Number formatting:**
> - **Powerball / Mega Millions / SuperLotto Plus / Fantasy 5**: Zero-padded 2-digit (`"07"`, `"42"`)
> - **Daily 3 / Daily 4**: Single digit (`"0"`–`"9"`)

### Python Example — Full CA Workflow

```python
import requests

BASE_URL = "http://localhost:8000"  # Change to your production URL

# 1. Discover CA games
resp = requests.get(f"{BASE_URL}/lotteries/by-state/CA")
ca = resp.json()
print(f"California has {ca['lottery_count']} games:")
for g in ca["lotteries"]:
    print(f"  {g['id']:25s} {g['name']:25s} ({g['type']})")

# 2. Extract SuperLotto Plus results (CA-only game)
resp = requests.post(f"{BASE_URL}/extract", json={
    "state_code": "CA",
    "lottery_ids": ["ca_superlotto_plus"],
    "from_date": "2025-05-01",
    "to_date": "2025-05-27"
})
data = resp.json()
print(f"\n{data['state_name']} — {data['lotteries'][0]}")
print(f"Total draws: {data['total_records']}")
for row in data["data"][:5]:
    balls = " ".join(row.get(f"Ball_{i}", "") for i in range(1, 6))
    mega = row.get("Mega", "")
    print(f"  {row['Date']}  {balls}  Mega={mega}")

# 3. Extract ALL CA games for a month
resp = requests.post(f"{BASE_URL}/extract", json={
    "state_code": "CA",
    "lottery_ids": [
        "powerball", "mega_millions", "ca_superlotto_plus",
        "ca_fantasy5", "ca_daily4", "ca_daily3", "ca_midday3"
    ],
    "from_date": "2025-05-01",
    "to_date": "2025-05-27"
})
data = resp.json()
print(f"\nAll CA games: {data['total_records']} total records")
print(f"Games returned: {data['lotteries']}")

# 4. Download CSV
resp = requests.get(f"{BASE_URL}/extract/csv", params={
    "state_code": "CA",
    "lottery_ids": "ca_fantasy5",
    "from_date": "2025-01-01",
    "to_date": "2025-05-27"
})
fname = resp.headers.get("Content-Disposition", "").split("filename=")[-1].strip('"')
with open(fname or "ca_results.csv", "wb") as f:
    f.write(resp.content)
print(f"\nSaved: {fname} ({resp.headers.get('X-Total-Records')} records)")
```

### JavaScript Example — CA Extraction

```javascript
const BASE_URL = "http://localhost:8000"; // Change to your production URL

// Discover CA games
const disco = await fetch(`${BASE_URL}/lotteries/by-state/CA`);
const ca = await disco.json();
console.log(`California: ${ca.lottery_count} games`);
ca.lotteries.forEach(g => console.log(`  ${g.id} — ${g.name} (${g.type})`));

// Extract SuperLotto Plus + Fantasy 5
const resp = await fetch(`${BASE_URL}/extract`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    state_code: "CA",
    lottery_ids: ["ca_superlotto_plus", "ca_fantasy5"],
    from_date: "2025-05-01",
    to_date: "2025-05-27"
  })
});
const data = await resp.json();
console.log(`Total records: ${data.total_records}`);
data.data.forEach(row => {
  const balls = [1,2,3,4,5].map(i => row[`Ball_${i}`] || "").filter(Boolean).join(" ");
  const bonus = row.Mega ? ` Mega=${row.Mega}` : "";
  console.log(`${row.Date} ${row.Lotto_Name.padEnd(18)} ${balls}${bonus}`);
});
```

### Common CA Queries

```bash
# Recent Powerball draws (last 30 days)
curl "http://localhost:8000/extract?state_code=CA&lottery_ids=powerball&from_date=2025-04-27&to_date=2025-05-27"

# Full year of SuperLotto Plus
curl "http://localhost:8000/extract?state_code=CA&lottery_ids=ca_superlotto_plus&from_date=2025-01-01&to_date=2025-12-31"

# Daily 3 Evening + Midday together
curl "http://localhost:8000/extract?state_code=CA&lottery_ids=ca_daily3,ca_midday3&from_date=2025-05-01&to_date=2025-05-27"

# Historical data (up to 10 years back)
curl "http://localhost:8000/extract?state_code=CA&lottery_ids=powerball&from_date=2016-01-01&to_date=2025-12-31"

# CSV download — all CA games for 2025
curl -O -J "http://localhost:8000/extract/csv?state_code=CA&lottery_ids=powerball,mega_millions,ca_superlotto_plus,ca_fantasy5,ca_daily4,ca_daily3,ca_midday3&from_date=2025-01-01&to_date=2025-12-31"
```

---

## 7. Supported States & Lottery IDs

> Use `GET /lotteries/by-state/{state_code}` to get exact IDs for any state.

**States without lotteries:** Alabama (AL), Alaska (AK), Hawaii (HI), Nevada (NV), Utah (UT)

| State | Code | Games | Key Lottery IDs |
|---|---|---|---|
| **Arizona** | `AZ` | 4 | `powerball`, `mega_millions`, `az_fantasy5`, `az_pick3` |
| **Arkansas** | `AR` | 5 | `powerball`, `mega_millions`, `ar_natural_state_jackpot`, `ar_cash3`, `ar_cash3_midday` |
| **California** | `CA` | 7 | `powerball`, `mega_millions`, `ca_superlotto_plus`, `ca_fantasy5`, `ca_daily4`, `ca_daily3`, `ca_midday3` |
| **Colorado** | `CO` | 5 | `powerball`, `mega_millions`, `co_lotto`, `co_cash5`, `co_pick3` |
| **Connecticut** | `CT` | 6 | `powerball`, `mega_millions`, `ct_lotto`, `ct_cash5`, `ct_play3`, `ct_play4` |
| **Delaware** | `DE` | 9 | `powerball`, `mega_millions`, `de_play3_day`, `de_play3_night`, `de_multi_win`, ... |
| **Florida** | `FL` | 11 | `powerball`, `mega_millions`, `fl_lotto`, `fl_fantasy5`, `fl_pick3`, `fl_cash4life`, ... |
| **Georgia** | `GA` | 12 | `powerball`, `mega_millions`, `ga_fantasy5`, `ga_cash3`, `ga_cash_pop`, ... |
| **Idaho** | `ID` | 7 | `powerball`, `mega_millions`, `id_cash`, `id_pick3_day`, `id_pick3_night`, ... |
| **Illinois** | `IL` | 10 | `powerball`, `mega_millions`, `il_lotto`, `il_lucky_day_lotto_evening`, ... |
| **Indiana** | `IN` | 6 | `powerball`, `mega_millions`, `in_hoosier_lotto`, `in_cash5`, `in_daily3`, `in_daily4` |
| **Iowa** | `IA` | 6 | `powerball`, `mega_millions`, `ia_pick3_evening`, `ia_pick3_midday`, ... |
| **Kansas** | `KS` | 5 | `powerball`, `mega_millions`, `ks_pick3_evening`, `ks_pick3_midday`, `ks_super_cash` |
| **Kentucky** | `KY` | 8 | `powerball`, `mega_millions`, `ky_pick3_evening`, `ky_cash_ball`, `ky_cash_pop`, ... |
| **Louisiana** | `LA` | 7 | `powerball`, `mega_millions`, `la_lotto`, `la_easy5`, `la_pick3`, `la_pick4`, `la_pick5` |
| **Maine** | `ME` | 5 | `powerball`, `mega_millions`, `me_megabucks_plus`, `me_pick3`, `me_pick4` |
| **Maryland** | `MD` | 10 | `powerball`, `mega_millions`, `md_multimatch`, `md_cash4life`, `md_pick3`, ... |
| **Massachusetts** | `MA` | 6 | `powerball`, `mega_millions`, `ma_megabucks_doubler`, `ma_masscash`, `ma_numbers`, ... |
| **Michigan** | `MI` | 9 | `powerball`, `mega_millions`, `mi_lotto47`, `mi_fantasy5`, `mi_daily3`, `mi_keno`, ... |
| **Minnesota** | `MN` | 5 | `powerball`, `mega_millions`, `mn_northstar_cash`, `mn_gopher5`, `mn_pick3` |
| **Mississippi** | `MS` | 6 | `powerball`, `mega_millions`, `ms_cash3`, `ms_cash3_midday`, `ms_cash4`, `ms_cash4_midday` |
| **Missouri** | `MO` | 5 | `powerball`, `mega_millions`, `mo_show_me_cash`, `mo_pick3`, `mo_pick4` |
| **Montana** | `MT` | 3 | `powerball`, `mega_millions`, `mt_montana_cash` |
| **Nebraska** | `NE` | 4 | `powerball`, `mega_millions`, `ne_pick3`, `ne_pick5` |
| **New Hampshire** | `NH` | 5 | `powerball`, `mega_millions`, `nh_gimme5`, `nh_pick3`, `nh_pick4` |
| **New Jersey** | `NJ` | 7 | `powerball`, `mega_millions`, `nj_jersey_cash5`, `nj_cash4life`, `nj_pick3`, `nj_pick4`, `nj_pick6` |
| **New Mexico** | `NM` | 4 | `powerball`, `mega_millions`, `nm_roadrunner_cash`, `nm_pick3` |
| **New York** | `NY` | 8 | `powerball`, `mega_millions`, `ny_lotto`, `ny_numbers`, `ny_win4`, `ny_take5`, `ny_cash4life`, `ny_pick10` |
| **North Carolina** | `NC` | 5 | `powerball`, `mega_millions`, `nc_cash5`, `nc_pick3`, `nc_pick4` |
| **North Dakota** | `ND` | 3 | `powerball`, `mega_millions`, `nd_2by2` |
| **Ohio** | `OH` | 7 | `powerball`, `mega_millions`, `oh_classic_lotto`, `oh_rolling_cash5`, `oh_pick3`, `oh_pick4`, `oh_pick5` |
| **Oklahoma** | `OK` | 4 | `powerball`, `mega_millions`, `ok_cash5`, `ok_pick3` |
| **Oregon** | `OR` | 5 | `powerball`, `mega_millions`, `or_megabucks`, `or_win_for_life`, `or_pick4` |
| **Pennsylvania** | `PA` | 9 | `powerball`, `mega_millions`, `pa_cash5`, `pa_match6`, `pa_pick2`, `pa_pick3`, `pa_pick4`, `pa_pick5`, `pa_cash4life` |
| **Rhode Island** | `RI` | 4 | `powerball`, `mega_millions`, `ri_wild_money`, `ri_numbers` |
| **South Carolina** | `SC` | 5 | `powerball`, `mega_millions`, `sc_palmetto_cash5`, `sc_pick3`, `sc_pick4` |
| **South Dakota** | `SD` | 4 | `powerball`, `mega_millions`, `sd_dakota_cash`, `sd_pick3` |
| **Tennessee** | `TN` | 6 | `powerball`, `mega_millions`, `tn_cash4life`, `tn_tennessee_cash`, `tn_pick3`, `tn_pick4` |
| **Texas** | `TX` | 8 | `powerball`, `mega_millions`, `tx_lotto_texas`, `tx_texas_two_step`, `tx_cash5`, `tx_pick3`, `tx_daily4`, `tx_all_or_nothing` |
| **Vermont** | `VT` | 5 | `powerball`, `mega_millions`, `vt_gimme5`, `vt_pick3`, `vt_pick4` |
| **Virginia** | `VA` | 8 | `powerball`, `mega_millions`, `va_cash5`, `va_pick3`, `va_pick3_day`, `va_pick4`, `va_pick4_day`, `va_cash4life` |
| **Washington** | `WA` | 6 | `powerball`, `mega_millions`, `wa_lotto`, `wa_hit5`, `wa_match4`, `wa_daily_game` |
| **Washington D.C.** | `DC` | 3 | `powerball`, `mega_millions`, `dc_lottery` |
| **West Virginia** | `WV` | 5 | `powerball`, `mega_millions`, `wv_cash25`, `wv_daily3`, `wv_daily4` |
| **Wisconsin** | `WI` | 6 | `powerball`, `mega_millions`, `wi_badger5`, `wi_supercash`, `wi_pick3`, `wi_pick4` |
| **Wyoming** | `WY` | 3 | `powerball`, `mega_millions`, `wy_cowboy_draw` |

---

## 8. Response Field Reference

### JSON Extract Response

| Field | Type | Description |
|---|---|---|
| `state_code` | string | 2-letter state code (e.g., `"VA"`) |
| `state_name` | string | Full state name (e.g., `"Virginia"`) |
| `lotteries` | string[] | Human-readable lottery names returned |
| `from_date` | string | Query start date `YYYY-MM-DD` |
| `to_date` | string | Query end date `YYYY-MM-DD` |
| `total_records` | integer | Number of draw records returned |
| `data` | object[] | Array of draw result rows |
| `csv_filename` | string | Suggested filename for CSV export |
| `errors` | string[] | Per-lottery fetch errors (empty `[]` = all OK) |
| `warnings` | string[] | Validation warnings (e.g., cross-state lottery requests) |
| `data_sources` | string[] | Data sources used for this response |

### Draw Result Row

| Field | Type | Always Present | Description |
|---|---|---|---|
| `Date` | string | Yes | Draw date `YYYY-MM-DD` |
| `Lotto_Name` | string | Yes | Human-readable game name |
| `State` | string | Yes | Full state name |
| `Lottery_ID` | string | Yes | Machine-readable game ID |
| `Ball_1` ... `Ball_N` | string | Yes | Winning numbers (zero-padded for standard games, single digit for Pick 3/4/5) |
| `Powerball` | string | No | Powerball number |
| `Power_Play` | string | No | Power Play multiplier |
| `Mega_Ball` | string | No | Mega Millions bonus ball |
| `Megaplier` | string | No | Megaplier multiplier |
| `Mega` | string | No | SuperLotto Plus Mega ball |
| `Bonus` | string | No | General bonus ball |
| `Bonus_Ball` | string | No | Alternate bonus ball column |
| `Fireball` | string | No | Fireball bonus (Pick games) |
| `Cash_Ball` | string | No | Cash4Life Cash Ball |
| `Extra_Shot` | string | No | IL Lotto Extra Shot |
| `Multiplier` | string | No | General multiplier |

> **Number formatting:**
> - Standard lotto games: zero-padded 2-digit strings (e.g., `"07"`, `"12"`, `"44"`)
> - Pick 3/4/5 games: single digit strings (`"0"` through `"9"`)

---

## 9. Error Handling

### HTTP Status Codes

| Status | Meaning | Resolution |
|---|---|---|
| `200` | Success | Request completed successfully |
| `400` | Bad Request | Invalid parameters, no-lottery state, or no valid lottery IDs |
| `404` | Not Found | Unknown state code, or no data found for CSV export |
| `422` | Validation Error | Missing required parameters or invalid format |
| `429` | Rate Limited | Wait for `Retry-After` seconds and retry |
| `500` | Server Error | Internal error; check `/health` endpoint |
| `503` | Not Ready | Service not ready; check `/health/ready` |

### Error Response Formats

**400 - Invalid state:**
```json
{
  "detail": "State 'ZZ' not found. Use a valid 2-letter US state code (e.g., 'NY', 'CA', 'TX')."
}
```

**400 - No state lottery:**
```json
{
  "detail": "Alabama (AL) does not have a state lottery."
}
```

**400 - Invalid lottery IDs:**
```json
{
  "detail": "None of the provided lottery_ids are valid for Virginia (VA). Available: ['powerball', 'mega_millions', 'va_cash5', ...]"
}
```

**400 - Bad date format:**
```json
{
  "detail": "Invalid from_date: '2025-13-01'. Use YYYY-MM-DD format."
}
```

**429 - Rate limited:**
```json
{
  "detail": "Too many requests. Limit: 60/min per IP."
}
```

**422 - Missing parameters (FastAPI validation):**
```json
{
  "detail": [
    {
      "loc": ["query", "from_date"],
      "msg": "field required",
      "type": "value_error.missing"
    }
  ]
}
```

---

## 10. CSV Export

### Filename Format

```
{State}_{Lottery_Name}_{FromYYYYMMDD}_{ToYYYYMMDD}.csv
```

Examples:
- `Virginia_Cash_5_20250101_20251231.csv`
- `New_York_Powerball_Mega_Millions_20250101_20251231.csv`

### Column Order

```
Date, Lotto_Name, State, Lottery_ID, Ball_1, Ball_2, ..., Ball_N, [Bonus columns]
```

Only columns that apply to the requested games are included.

### Example CSV Content

```csv
Date,Lotto_Name,State,Lottery_ID,Ball_1,Ball_2,Ball_3,Ball_4,Ball_5,Powerball,Power_Play
2025-05-26,Powerball,New York,powerball,13,47,52,64,67,25,02
2025-05-24,Powerball,New York,powerball,12,18,28,48,52,05,03
2025-05-21,Powerball,New York,powerball,09,29,31,34,43,02,02
```

### Response Headers for CSV

| Header | Description |
|---|---|
| `Content-Disposition` | Filename for download |
| `X-Total-Records` | Number of records in the file |
| `X-State` | State name |
| `X-Lotteries` | Comma-separated lottery names |
| `X-From-Date` | Query start date |
| `X-To-Date` | Query end date |

---

## 11. Data Sources & Coverage

The API uses **7 data sources** with automatic fallback:

| Source | Type | Coverage | Used For |
|---|---|---|---|
| **NY Open Data** (`data.ny.gov`) | Official Government API | NY games + Powerball/Mega Millions (2010+) | Primary source for NY state games |
| **lotto.net** | Public Historical Archive | Powerball, Mega Millions, SuperLotto, FL/TX/MI/WA/OR/NJ/IL Lotto | Major multi-state and big-state games |
| **lottery.net** | Public Historical Archive | 150+ games across all 46 lottery states | Primary source for most state games |
| **lotteryusa.com** | Public Results Archive | Recent ~50 draws for major games | Fast fallback when lottery.net is blocked |
| **Louisiana Lottery** | Official State CSV | LA Pick 3/4/5, Easy 5, Lotto | Direct CSV download from state |
| **Kansas Lottery** | Official State Website | KS Pick 3, Super Cash | CSRF form + HTML scraping |
| **Kentucky Lottery** | Official State JSON API | KY Pick 3/4, Cash Ball, Cash Pop | Real-time API via IGT/AWC |

### Fallback Strategy

The API automatically tries multiple sources for each game:

1. **Official source** (government API or state website) - tried first
2. **lotteryusa.com** - reliable, fast (~50 recent draws)
3. **lottery.net** - full historical archive (may rate-limit)
4. **lotto.net** - supplementary archive

If the primary source returns 403 (rate-limited), the API automatically falls back to the next source. Rate-limited sources are cached for 10 minutes to avoid repeated failures.

### Coverage Notes

- **Powerball / Mega Millions** - available from 2010 onward (NY Open Data) with lotto.net fallback
- **Most state games** - available from 2015 onward via lottery.net
- **NY state games** - deepest history via official Open Data API
- **All data is real** - sourced exclusively from official or verified public archives

---

## 12. Production Deployment

### Recommended Architecture

```
Client -> Nginx/Caddy (reverse proxy) -> Uvicorn/Gunicorn -> FastAPI App
```

### Nginx Configuration

```nginx
server {
    listen 80;
    server_name api.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}
```

### Docker Deployment

```dockerfile
FROM python:3.11-slim

WORKDIR /app
COPY backend/ ./backend/
COPY frontend/build/ ./frontend/build/

RUN pip install --no-cache-dir -r backend/requirements.txt

EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### Security Checklist for Production

- [ ] Set `ALLOWED_ORIGINS` to your specific domain(s) (not `*`)
- [ ] Put behind a reverse proxy with HTTPS (Nginx/Caddy)
- [ ] Configure appropriate rate limits via env vars
- [ ] Monitor `/metrics` endpoint for error rates
- [ ] Use `/health/ready` for load balancer health checks
- [ ] Review `X-Forwarded-For` header handling for accurate rate limiting behind proxy

### Security Headers (Automatic)

Every API response includes:

| Header | Value |
|---|---|
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `X-XSS-Protection` | `1; mode=block` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Cache-Control` | `no-store` |
| `X-Request-ID` | Unique 8-char UUID per request |

---

## 13. Environment Variables

| Variable | Default | Description |
|---|---|---|
| `ALLOWED_ORIGINS` | `*` | Comma-separated CORS allowed origins |
| `RATE_LIMIT_REQUESTS` | `60` | Max requests per rate limit window |
| `RATE_LIMIT_WINDOW` | `60` | Rate limit window in seconds |
| `STRIPE_SECRET_KEY` | (none) | Stripe API key for billing (optional) |
| `STRIPE_WEBHOOK_SECRET` | (none) | Stripe webhook signing secret (optional) |

**Example: Restrict CORS for production:**

```bash
ALLOWED_ORIGINS="https://yourdomain.com,https://app.yourdomain.com" \
  uvicorn main:app --host 0.0.0.0 --port 8000
```

---

## 14. Troubleshooting

### Server won't start

```bash
# Check Python version
python3 --version  # Needs 3.9+

# Check dependencies
pip install fastapi uvicorn httpx requests beautifulsoup4 lxml pydantic

# Check if port 8000 is in use
lsof -i :8000
```

### No data returned for a game

1. Check the game ID is correct: `curl http://localhost:8000/lotteries/by-state/{STATE}`
2. External data sources may be temporarily blocked (403). The API caches 403s for 10 minutes.
3. Try a shorter date range (recent month) first to verify the game works.
4. Check `/metrics` for error counts.

### Rate limited (429 response)

Wait 60 seconds before retrying. The rate limit is per-IP, 60 requests per 60-second window. For batch processing, add delays between requests:

```python
import time
for state in states:
    resp = requests.get(f"{BASE_URL}/extract?...")
    time.sleep(1.1)  # Stay under rate limit
```

### Scoreboard shows empty entries

The scoreboard looks back 7 days for the latest draw. If no data is found within that window, the state won't appear in results. This typically means the upstream source is temporarily blocked.

### CORS errors in browser

Set `ALLOWED_ORIGINS` to include your frontend domain:

```bash
ALLOWED_ORIGINS="http://localhost:3000,https://yourdomain.com" uvicorn main:app --host 0.0.0.0 --port 8000
```

---

*Lotto Extraction API v1.1.0 - Real lottery data from official US public sources.*
