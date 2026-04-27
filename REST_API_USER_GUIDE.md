# 🎰 Lotto Extraction REST API — User Guide

**Version:** 1.1.0
**Base URL:** `https://8000-ixjsexmoiuawxwrh4ut4w-c07dda5e.sandbox.novita.ai`
**Interactive Docs (Swagger UI):** `https://8000-ixjsexmoiuawxwrh4ut4w-c07dda5e.sandbox.novita.ai/docs`
**Clean Docs (ReDoc):** `https://8000-ixjsexmoiuawxwrh4ut4w-c07dda5e.sandbox.novita.ai/redoc`
**OpenAPI JSON Spec:** `https://8000-ixjsexmoiuawxwrh4ut4w-c07dda5e.sandbox.novita.ai/openapi.json`

---

## 📋 Table of Contents

1. [Overview](#1-overview)
2. [Quick Start](#2-quick-start)
3. [Authentication & Rate Limits](#3-authentication--rate-limits)
4. [Endpoints Reference](#4-endpoints-reference)
   - [Lottery Discovery](#lottery-discovery)
   - [Data Extraction](#data-extraction)
   - [Health & Monitoring](#health--monitoring)
5. [Request & Response Examples](#5-request--response-examples)
6. [Supported States & Lottery IDs](#6-supported-states--lottery-ids)
7. [Response Field Reference](#7-response-field-reference)
8. [Error Codes](#8-error-codes)
9. [CSV Export](#9-csv-export)
10. [Data Sources & Coverage](#10-data-sources--coverage)
11. [All Links](#11-all-links)

---

## 1. Overview

The **Lotto Extraction API** provides **real US lottery draw results** from official public sources — no simulated or random numbers. It supports:

- ✅ **46 US states**, 200+ lottery games
- ✅ **Date range queries** up to 5 years
- ✅ **JSON and CSV** output formats
- ✅ **Multi-lottery queries** in a single request
- ✅ **Location-based** lottery discovery by state
- ✅ **Zero authentication** required — public API

---

## 2. Quick Start

### Step 1 — Find lotteries for your state

```
GET /lotteries/by-state/VA
```

### Step 2 — Extract draw results as JSON

```
GET /extract?state_code=VA&lottery_ids=va_cash5&from_date=2025-01-01&to_date=2025-12-31
```

### Step 3 — Download as CSV

```
GET /extract/csv?state_code=VA&lottery_ids=va_cash5&from_date=2025-01-01&to_date=2025-12-31
```

---

## 3. Authentication & Rate Limits

| Setting | Value |
|---|---|
| Authentication | None required (public API) |
| Rate limit | **60 requests per 60 seconds per IP** |
| Exceeded limit response | HTTP `429 Too Many Requests` + `Retry-After` header |
| Max date range per request | **5 years (1,825 days)** |
| Future dates | Automatically capped to today |

---

## 4. Endpoints Reference

### Lottery Discovery

---

#### `GET /lotteries/all-states`

Returns all 50 US states and their available lottery games.

**No parameters required.**

**Response example:**
```json
{
  "total_states": 50,
  "states_with_lotteries": 46,
  "states": [
    {
      "state_code": "VA",
      "state_name": "Virginia",
      "lottery_count": 8,
      "lotteries": [...]
    }
  ]
}
```

---

#### `GET /lotteries/by-state/{state_code}`

Returns all lottery games available in a specific state.

**Path parameter:**

| Parameter | Type | Required | Example |
|---|---|---|---|
| `state_code` | string | ✅ Yes | `VA`, `NY`, `CA`, `FL` |

> **Note:** State code must be 2-letter uppercase (e.g. `VA` not `va`).

**Response example:**
```json
{
  "state_code": "VA",
  "state_name": "Virginia",
  "lottery_count": 8,
  "lotteries": [
    { "id": "va_cash5",     "name": "Cash 5",        "type": "state" },
    { "id": "va_pick3",     "name": "Pick 3 Night",   "type": "state" },
    { "id": "va_pick3_day", "name": "Pick 3 Day",     "type": "state" },
    { "id": "va_pick4",     "name": "Pick 4 Night",   "type": "state" },
    { "id": "va_pick4_day", "name": "Pick 4 Day",     "type": "state" },
    { "id": "va_cash4life", "name": "Cash4Life",      "type": "multistate" },
    { "id": "powerball",    "name": "Powerball",      "type": "multistate" },
    { "id": "mega_millions","name": "Mega Millions",  "type": "multistate" }
  ]
}
```

---

#### `GET /lotteries/detect-location`

Auto-detects your US state from your IP address and returns local lotteries.

**Query parameters (all optional):**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ip` | string | No | IP address to look up (auto-detected if omitted) |
| `state_code` | string | No | Override with a known state code |

---

#### `GET /lotteries/sources`

Returns details about all data sources used by the API, including URLs and disclaimers.

---

### Data Extraction

---

#### `GET /extract`

Retrieve lottery draw results as **JSON**.

**Query parameters:**

| Parameter | Type | Required | Description | Example |
|---|---|---|---|---|
| `state_code` | string | ✅ Yes | Two-letter US state code | `VA` |
| `lottery_ids` | string | ✅ Yes | Comma-separated lottery IDs | `va_cash5,va_pick3` |
| `from_date` | string | ✅ Yes | Start date in `YYYY-MM-DD` format | `2025-01-01` |
| `to_date` | string | ✅ Yes | End date in `YYYY-MM-DD` format | `2025-12-31` |

**Example request:**
```
GET /extract?state_code=VA&lottery_ids=va_cash5,va_pick3&from_date=2025-12-29&to_date=2025-12-31
```

**Example response:**
```json
{
  "state_code": "VA",
  "state_name": "Virginia",
  "lotteries": ["Cash 5"],
  "from_date": "2025-12-29",
  "to_date": "2025-12-31",
  "total_records": 3,
  "data": [
    {
      "Date": "2025-12-31",
      "Lotto_Name": "Cash 5",
      "State": "Virginia",
      "Lottery_ID": "va_cash5",
      "Ball_1": "12",
      "Ball_2": "20",
      "Ball_3": "37",
      "Ball_4": "40",
      "Ball_5": "44"
    },
    {
      "Date": "2025-12-30",
      "Lotto_Name": "Cash 5",
      "State": "Virginia",
      "Lottery_ID": "va_cash5",
      "Ball_1": "07",
      "Ball_2": "12",
      "Ball_3": "20",
      "Ball_4": "31",
      "Ball_5": "33"
    },
    {
      "Date": "2025-12-29",
      "Lotto_Name": "Cash 5",
      "State": "Virginia",
      "Lottery_ID": "va_cash5",
      "Ball_1": "14",
      "Ball_2": "19",
      "Ball_3": "20",
      "Ball_4": "44",
      "Ball_5": "45"
    }
  ],
  "csv_filename": "Virginia_Cash_5_20251229_20251231.csv",
  "errors": [],
  "data_sources": [
    "NY Open Data (data.ny.gov) - Official government data",
    "lotto.net - Historical results archive"
  ]
}
```

---

#### `POST /extract`

Same as `GET /extract` but accepts a **JSON request body** — ideal when selecting many lottery IDs or when using tools that prefer POST requests.

**Request body:**
```json
{
  "state_code": "NY",
  "lottery_ids": ["powerball", "mega_millions", "ny_take5"],
  "from_date": "2025-01-01",
  "to_date": "2025-12-31"
}
```

**Response:** Same format as `GET /extract`.

---

#### `GET /extract/csv`

Same parameters as `GET /extract` but returns a **downloadable CSV file**.

**Query parameters:** Same as `GET /extract`.

**Response headers:**
```
Content-Type: text/csv
Content-Disposition: attachment; filename="Virginia_Cash_5_20251229_20251231.csv"
```

**CSV format example:**
```
Date,Lotto_Name,State,Lottery_ID,Ball_1,Ball_2,Ball_3,Ball_4,Ball_5
2025-12-31,Cash 5,Virginia,va_cash5,12,20,37,40,44
2025-12-30,Cash 5,Virginia,va_cash5,07,12,20,31,33
2025-12-29,Cash 5,Virginia,va_cash5,14,19,20,44,45
```

---

#### `POST /extract/csv`

Same as `GET /extract/csv` but accepts a **JSON request body**.

**Request body:** Same format as `POST /extract`.

**Response:** Downloadable CSV file.

---

### Health & Monitoring

---

#### `GET /health`

Liveness check — confirms the API process is running.

**Response:**
```json
{
  "status": "healthy",
  "version": "1.1.0",
  "timestamp": "2026-03-06T12:00:00.000000"
}
```

---

#### `GET /health/ready`

Readiness check — confirms lottery configuration and scrapers are fully loaded and ready to serve requests.

**Response:**
```json
{
  "status": "ready",
  "checks": {
    "lottery_config": "ok",
    "scrapers": "ok"
  }
}
```

---

#### `GET /metrics`

Runtime performance metrics for monitoring and observability.

**Response:**
```json
{
  "version": "1.1.0",
  "uptime_seconds": 890643,
  "start_time": "2026-02-23T22:53:13.711291",
  "requests": {
    "total": 359,
    "success": 324,
    "error": 35,
    "4xx": 35,
    "5xx": 0,
    "success_rate_pct": 90.3
  },
  "records_served": 66477,
  "response_time_ms": {
    "avg": 1422,
    "p95": 6301,
    "p99": 14221
  },
  "rate_limit": {
    "requests_per_window": 60,
    "window_seconds": 60
  }
}
```

---

#### `GET /api/info`

Returns API name, version, description, and full list of available endpoints.

---

## 5. Request & Response Examples

### curl — Get VA lottery IDs
```bash
curl https://8000-ixjsexmoiuawxwrh4ut4w-c07dda5e.sandbox.novita.ai/lotteries/by-state/VA
```

### curl — Extract NY Powerball for all of 2025
```bash
curl "https://8000-ixjsexmoiuawxwrh4ut4w-c07dda5e.sandbox.novita.ai/extract?state_code=NY&lottery_ids=powerball&from_date=2025-01-01&to_date=2025-12-31"
```

### curl — POST multiple lotteries
```bash
curl -X POST https://8000-ixjsexmoiuawxwrh4ut4w-c07dda5e.sandbox.novita.ai/extract \
  -H "Content-Type: application/json" \
  -d '{
    "state_code": "NY",
    "lottery_ids": ["powerball", "mega_millions", "ny_take5"],
    "from_date": "2025-01-01",
    "to_date": "2025-12-31"
  }'
```

### curl — Download CSV file
```bash
curl -O -J "https://8000-ixjsexmoiuawxwrh4ut4w-c07dda5e.sandbox.novita.ai/extract/csv?state_code=VA&lottery_ids=va_cash5&from_date=2025-01-01&to_date=2025-12-31"
```

### Python — Extract and parse results
```python
import requests

BASE_URL = "https://8000-ixjsexmoiuawxwrh4ut4w-c07dda5e.sandbox.novita.ai"

# Step 1: Get lottery IDs for Virginia
resp = requests.get(f"{BASE_URL}/lotteries/by-state/VA")
lotteries = resp.json()["lotteries"]
lottery_ids = [l["id"] for l in lotteries]
print("VA lottery IDs:", lottery_ids)

# Step 2: Extract draw results
resp = requests.post(f"{BASE_URL}/extract", json={
    "state_code": "VA",
    "lottery_ids": ["va_cash5", "va_pick3"],
    "from_date": "2025-12-01",
    "to_date": "2025-12-31"
})
data = resp.json()
print(f"Total records: {data['total_records']}")
for row in data["data"]:
    print(row)
```

### JavaScript (fetch) — Extract results
```javascript
const BASE_URL = "https://8000-ixjsexmoiuawxwrh4ut4w-c07dda5e.sandbox.novita.ai";

const response = await fetch(`${BASE_URL}/extract`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    state_code: "VA",
    lottery_ids: ["va_cash5", "va_pick3"],
    from_date: "2025-12-01",
    to_date: "2025-12-31"
  })
});

const data = await response.json();
console.log(`Total records: ${data.total_records}`);
data.data.forEach(row => console.log(row));
```

---

## 6. Supported States & Lottery IDs

> 💡 **Always call `GET /lotteries/by-state/{state_code}` to get exact IDs for your state — IDs are case-sensitive.**

| State | Code | Lottery IDs |
|---|---|---|
| **New York** | `NY` | `powerball`, `mega_millions`, `ny_lotto`, `ny_numbers`, `ny_win4`, `ny_take5`, `ny_cash4life`, `ny_pick10` |
| **Virginia** | `VA` | `powerball`, `mega_millions`, `va_cash5`, `va_pick3`, `va_pick3_day`, `va_pick4`, `va_pick4_day`, `va_cash4life` |
| **California** | `CA` | `powerball`, `mega_millions`, `ca_superlotto_plus`, `ca_fantasy5`, `ca_daily4`, `ca_daily3`, `ca_midday3` |
| **Florida** | `FL` | `powerball`, `mega_millions`, `fl_lotto`, `fl_fantasy5`, `fl_pick3`, `fl_pick3_midday`, `fl_pick4`, `fl_pick4_midday`, `fl_pick5`, `fl_pick5_midday`, `fl_cash4life` |
| **Arizona** | `AZ` | `powerball`, `mega_millions`, `az_pick3`, `az_fantasy5` |
| **Texas** | `TX` | `powerball`, `mega_millions`, `tx_lotto_texas` + more |
| **New Jersey** | `NJ` | `powerball`, `mega_millions`, `nj_pick6`, `nj_jersey_cash5` + more |
| **Illinois** | `IL` | `powerball`, `mega_millions`, `il_lotto` + more |
| **Pennsylvania** | `PA` | `powerball`, `mega_millions` + 7 more (9 total) |
| **Ohio** | `OH` | `powerball`, `mega_millions` + 5 more (7 total) |
| **Michigan** | `MI` | `powerball`, `mega_millions` + 5 more (7 total) |
| **Maryland** | `MD` | `powerball`, `mega_millions` + 5 more (7 total) |
| **Louisiana** | `LA` | `powerball`, `mega_millions` + 5 more (7 total) |
| **Georgia** | `GA` | `powerball`, `mega_millions` + 4 more (6 total) |
| **Connecticut** | `CT` | `powerball`, `mega_millions` + 4 more (6 total) |
| **Indiana** | `IN` | `powerball`, `mega_millions` + 4 more (6 total) |
| **Washington** | `WA` | `powerball`, `mega_millions` + 4 more (6 total) |
| **Wisconsin** | `WI` | `powerball`, `mega_millions` + 4 more (6 total) |
| **Tennessee** | `TN` | `powerball`, `mega_millions` + 4 more (6 total) |
| **North Carolina** | `NC` | `powerball`, `mega_millions` + 3 more (5 total) |
| **Colorado** | `CO` | `powerball`, `mega_millions` + 3 more (5 total) |
| **Kentucky** | `KY` | `powerball`, `mega_millions` + 3 more (5 total) |
| **Massachusetts** | `MA` | `powerball`, `mega_millions` + 3 more (5 total) |
| **Maine** | `ME` | `powerball`, `mega_millions` + 3 more (5 total) |
| **Minnesota** | `MN` | `powerball`, `mega_millions` + 3 more (5 total) |
| **Missouri** | `MO` | `powerball`, `mega_millions` + 3 more (5 total) |
| **New Hampshire** | `NH` | `powerball`, `mega_millions` + 3 more (5 total) |
| **Oregon** | `OR` | `powerball`, `mega_millions` + 3 more (5 total) |
| **South Carolina** | `SC` | `powerball`, `mega_millions` + 3 more (5 total) |
| **Vermont** | `VT` | `powerball`, `mega_millions` + 3 more (5 total) |
| **West Virginia** | `WV` | `powerball`, `mega_millions` + 3 more (5 total) |
| **Arkansas** | `AR` | `powerball`, `mega_millions` + 2 more (4 total) |
| **Delaware** | `DE` | `powerball`, `mega_millions` + 2 more (4 total) |
| **Iowa** | `IA` | `powerball`, `mega_millions` + 2 more (4 total) |
| **Idaho** | `ID` | `powerball`, `mega_millions` + 2 more (4 total) |
| **Kansas** | `KS` | `powerball`, `mega_millions` + 2 more (4 total) |
| **Mississippi** | `MS` | `powerball`, `mega_millions` + 2 more (4 total) |
| **Nebraska** | `NE` | `powerball`, `mega_millions` + 2 more (4 total) |
| **New Mexico** | `NM` | `powerball`, `mega_millions` + 2 more (4 total) |
| **Oklahoma** | `OK` | `powerball`, `mega_millions` + 2 more (4 total) |
| **Rhode Island** | `RI` | `powerball`, `mega_millions` + 2 more (4 total) |
| **South Dakota** | `SD` | `powerball`, `mega_millions` + 2 more (4 total) |
| **Washington D.C.** | `DC` | `powerball`, `mega_millions` + 1 more (3 total) |
| **Montana** | `MT` | `powerball`, `mega_millions` + 1 more (3 total) |
| **North Dakota** | `ND` | `powerball`, `mega_millions` + 1 more (3 total) |
| **Wyoming** | `WY` | `powerball`, `mega_millions` + 1 more (3 total) |

---

## 7. Response Field Reference

### JSON Extract Response Fields

| Field | Type | Description |
|---|---|---|
| `state_code` | string | Two-letter state code (e.g. `"VA"`) |
| `state_name` | string | Full state name (e.g. `"Virginia"`) |
| `lotteries` | array | List of lottery names returned |
| `from_date` | string | Start date of query `YYYY-MM-DD` |
| `to_date` | string | End date of query `YYYY-MM-DD` |
| `total_records` | integer | Total number of draw records returned |
| `data` | array | Array of draw result objects (see below) |
| `csv_filename` | string | Suggested filename for CSV export |
| `errors` | array | Per-lottery errors; empty `[]` means all OK |
| `data_sources` | array | Data sources used for this response |

### Draw Result Row Fields

| Field | Type | Description |
|---|---|---|
| `Date` | string | Draw date in `YYYY-MM-DD` format |
| `Lotto_Name` | string | Human-readable game name (e.g. `"Cash 5"`) |
| `State` | string | Full state name (e.g. `"Virginia"`) |
| `Lottery_ID` | string | Machine-readable game ID (e.g. `"va_cash5"`) |
| `Ball_1` … `Ball_N` | string | Winning ball numbers, zero-padded (e.g. `"07"`) |
| `Bonus` | string | Bonus / Powerball number (only if game has one) |
| `Fireball` | string | Fireball number (Pick 3 / Pick 4 games only) |

> **Note:** Ball numbers are always returned as **zero-padded two-digit strings** (e.g. `"07"`, `"12"`, `"44"`). Only columns that apply to a given game are included.

---

## 8. Error Codes

| HTTP Status | Meaning | Resolution |
|---|---|---|
| `200 OK` | Success | — |
| `404 Not Found` | State code or lottery ID not found | Verify state code is 2-letter uppercase; use `/lotteries/by-state/{code}` to get valid IDs |
| `422 Unprocessable Entity` | Invalid request parameters | Check `from_date`/`to_date` format (`YYYY-MM-DD`); ensure all required params are provided |
| `429 Too Many Requests` | Rate limit exceeded | Check `Retry-After` response header; wait before retrying |
| `500 Internal Server Error` | Server-side error | Retry after a moment; use `/health` to check status |

### Error Response Format (422):
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

### Rate Limit Response (429):
```json
{
  "detail": "Rate limit exceeded. Try again in 42 seconds.",
  "retry_after": 42
}
```

### Validation Rules
- `state_code` — 2-letter uppercase US state code (e.g. `VA`, `NY`)
- `lottery_ids` — comma-separated, case-sensitive IDs from `/lotteries/by-state/{code}`
- `from_date` / `to_date` — format `YYYY-MM-DD`; `to_date` must be ≥ `from_date`
- **Max date range:** 5 years (1,825 days) per request
- **Future dates:** automatically capped to today's date

---

## 9. CSV Export

### Filename Format
```
{State}_{Lottery_Name}_{FromYYYYMMDD}_{ToYYYYMMDD}.csv
```

**Examples:**
- `Virginia_Cash_5_20250101_20251231.csv`
- `New_York_Powerball_20200101_20251231.csv`
- `Florida_Pick_3_Evening_20250101_20251231.csv`

### Column Order
```
Date, Lotto_Name, State, Lottery_ID, Ball_1, Ball_2, ..., Ball_N, [Bonus], [Fireball]
```

Columns are only included if they apply to the game being exported. Bonus/Fireball columns are omitted for games that do not have them.

### Download with curl
```bash
# Save with auto-generated filename from Content-Disposition header
curl -O -J "https://8000-ixjsexmoiuawxwrh4ut4w-c07dda5e.sandbox.novita.ai/extract/csv?state_code=VA&lottery_ids=va_cash5&from_date=2025-01-01&to_date=2025-12-31"
```

### Download with Python
```python
import requests

BASE_URL = "https://8000-ixjsexmoiuawxwrh4ut4w-c07dda5e.sandbox.novita.ai"

resp = requests.get(f"{BASE_URL}/extract/csv", params={
    "state_code": "VA",
    "lottery_ids": "va_cash5,va_pick3",
    "from_date": "2025-01-01",
    "to_date": "2025-12-31"
})

# Get filename from response header
filename = resp.headers.get("Content-Disposition", "").split("filename=")[-1].strip('"')
filename = filename or "lottery_results.csv"

with open(filename, "wb") as f:
    f.write(resp.content)

print(f"Saved to {filename}")
```

---

## 10. Data Sources & Coverage

| Source | Games Covered | Historical Range |
|---|---|---|
| **NY Open Data** (`data.ny.gov`) | All New York State lottery games | 2010 – present |
| **lottery.net** | CA, AZ, FL, VA, TX, NJ, IL and more | ~2015 – present |
| **lotto.net** | Powerball, Mega Millions, multi-state games | 2010 – present |

### Coverage Notes
- **Powerball / Mega Millions** — available from 2010 onward
- **Most state games** — available from approximately 2015 onward
- **NY lottery.net fallback** — automatically used when NY Open Data returns HTTP 403
- **Real data only** — all results sourced from official government or verified historical archives; no random or simulated numbers

### Security Headers (all responses)
Every API response includes the following security headers:

| Header | Value |
|---|---|
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `X-XSS-Protection` | `1; mode=block` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Cache-Control` | `no-store` |
| `X-Request-ID` | Unique UUID per request |

---

## 11. All Links

| Resource | URL |
|---|---|
| **Base URL** | `https://8000-ixjsexmoiuawxwrh4ut4w-c07dda5e.sandbox.novita.ai` |
| **Swagger UI (interactive)** | `https://8000-ixjsexmoiuawxwrh4ut4w-c07dda5e.sandbox.novita.ai/docs` |
| **ReDoc (clean docs)** | `https://8000-ixjsexmoiuawxwrh4ut4w-c07dda5e.sandbox.novita.ai/redoc` |
| **OpenAPI JSON spec** | `https://8000-ixjsexmoiuawxwrh4ut4w-c07dda5e.sandbox.novita.ai/openapi.json` |
| **Health check** | `https://8000-ixjsexmoiuawxwrh4ut4w-c07dda5e.sandbox.novita.ai/health` |
| **Readiness probe** | `https://8000-ixjsexmoiuawxwrh4ut4w-c07dda5e.sandbox.novita.ai/health/ready` |
| **Metrics** | `https://8000-ixjsexmoiuawxwrh4ut4w-c07dda5e.sandbox.novita.ai/metrics` |
| **API Info** | `https://8000-ixjsexmoiuawxwrh4ut4w-c07dda5e.sandbox.novita.ai/api/info` |
| **All States** | `https://8000-ixjsexmoiuawxwrh4ut4w-c07dda5e.sandbox.novita.ai/lotteries/all-states` |
| **VA Lotteries** | `https://8000-ixjsexmoiuawxwrh4ut4w-c07dda5e.sandbox.novita.ai/lotteries/by-state/VA` |
| **NY Lotteries** | `https://8000-ixjsexmoiuawxwrh4ut4w-c07dda5e.sandbox.novita.ai/lotteries/by-state/NY` |
| **Sample Extract (VA Cash 5)** | `https://8000-ixjsexmoiuawxwrh4ut4w-c07dda5e.sandbox.novita.ai/extract?state_code=VA&lottery_ids=va_cash5&from_date=2025-12-29&to_date=2025-12-31` |

---

*Lotto Extraction API v1.1.0 — Real lottery data from official US public sources.*
