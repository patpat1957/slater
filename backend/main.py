"""
Lotto Extraction API - FastAPI Backend
Real lottery data only - no fake/random numbers.
Production-hardened: rate limiting, request tracking, security headers,
structured logging, graceful shutdown, readiness probe, metrics endpoint.
"""

import csv
import io
import json
import logging
import asyncio
import os
import time
import uuid
from collections import defaultdict
from pathlib import Path
from datetime import date, datetime, timedelta
from typing import List, Optional, Dict, Any
from fastapi import FastAPI, Query, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
import httpx

from lottery_config import LOTTERIES_BY_STATE, STATE_NAMES, LOTTERY_SOURCES
from scrapers import fetch_lottery_results, build_csv_rows
from stripe_routes import router as stripe_router

# ──────────────────────────────────────────────
# Structured Logging
# ──────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger(__name__)

# ──────────────────────────────────────────────
# In-memory Metrics
# ──────────────────────────────────────────────
_metrics: Dict[str, Any] = {
    "requests_total": 0,
    "requests_success": 0,
    "requests_error": 0,
    "requests_4xx": 0,
    "requests_5xx": 0,
    "records_served": 0,
    "start_time": datetime.utcnow().isoformat(),
    "by_endpoint": defaultdict(int),
    "response_times_ms": [],          # rolling last 200
}

# ──────────────────────────────────────────────
# Simple In-Process Rate Limiter
# ──────────────────────────────────────────────
_rate_buckets: Dict[str, List[float]] = defaultdict(list)
RATE_LIMIT_REQUESTS = int(os.getenv("RATE_LIMIT_REQUESTS", "60"))   # per window
RATE_LIMIT_WINDOW   = int(os.getenv("RATE_LIMIT_WINDOW",   "60"))   # seconds

def _check_rate_limit(ip: str) -> bool:
    """Return True if request is allowed, False if rate-limited."""
    now = time.time()
    window_start = now - RATE_LIMIT_WINDOW
    bucket = _rate_buckets[ip]
    # Prune old timestamps
    _rate_buckets[ip] = [t for t in bucket if t > window_start]
    if len(_rate_buckets[ip]) >= RATE_LIMIT_REQUESTS:
        return False
    _rate_buckets[ip].append(now)
    return True

# ──────────────────────────────────────────────
# App
# ──────────────────────────────────────────────
API_VERSION = "1.1.0"

app = FastAPI(
    title="Lotto Extraction API",
    description="""
## Lotto Extraction REST API

Real lottery results from official public sources. No fake/random numbers.

### Features
- **Location-based lottery discovery** – find lotteries by US state
- **Multi-lottery selection** – query multiple games in one request
- **Date range filtering** – any date range up to 5 years
- **CSV export** – structured download with bonus-ball columns
- **Real data only** – sourced from government open data + verified archives

### Data Sources
- **NY Open Data** (data.ny.gov) – official NY State lottery results
- **lottery.net** – public historical results archive
- **lotto.net** – supplementary historical archive

### Column Format
`Date | Lotto_Name | State | Lottery_ID | Ball_1 … Ball_N | [Bonus]`

### Rate Limiting
60 requests per 60 seconds per IP. Exceeded requests receive HTTP 429.
    """,
    version=API_VERSION,
    contact={"name": "Lotto Extraction API"},
    license_info={"name": "Public Data"},
)

# ── CORS ─────────────────────────────────────
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "*").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID", "X-Total-Records", "X-State",
                    "X-Lotteries", "X-From-Date", "X-To-Date"],
)

# ── Stripe Router ──────────────────────────────
app.include_router(stripe_router)

# ── Security Headers + Request Tracking Middleware ────────────
@app.middleware("http")
async def request_middleware(request: Request, call_next):
    request_id = str(uuid.uuid4())[:8]
    client_ip  = request.headers.get("X-Forwarded-For", request.client.host if request.client else "unknown")
    client_ip  = client_ip.split(",")[0].strip()

    # Rate limiting (skip for health/metrics)
    if request.url.path not in ("/health", "/health/ready", "/metrics"):
        if not _check_rate_limit(client_ip):
            logger.warning(f"[{request_id}] Rate limited: {client_ip} {request.url.path}")
            _metrics["requests_4xx"] += 1
            _metrics["requests_error"] += 1
            _metrics["requests_total"] += 1
            return JSONResponse(
                status_code=429,
                content={"detail": "Too many requests. Limit: 60/min per IP."},
                headers={"Retry-After": "60", "X-Request-ID": request_id},
            )

    t0 = time.time()
    logger.info(f"[{request_id}] {request.method} {request.url.path} from {client_ip}")

    try:
        response = await call_next(request)
    except Exception as exc:
        _metrics["requests_5xx"] += 1
        _metrics["requests_error"] += 1
        _metrics["requests_total"] += 1
        logger.error(f"[{request_id}] Unhandled exception: {exc}", exc_info=True)
        return JSONResponse(status_code=500, content={"detail": "Internal server error"},
                            headers={"X-Request-ID": request_id})

    ms = int((time.time() - t0) * 1000)
    _metrics["requests_total"] += 1
    _metrics["by_endpoint"][request.url.path] += 1
    _metrics["response_times_ms"] = (_metrics["response_times_ms"] + [ms])[-200:]

    if response.status_code < 400:
        _metrics["requests_success"] += 1
    elif response.status_code < 500:
        _metrics["requests_4xx"] += 1
        _metrics["requests_error"] += 1
    else:
        _metrics["requests_5xx"] += 1
        _metrics["requests_error"] += 1

    # Security + tracking headers
    response.headers["X-Request-ID"]        = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"]     = "DENY"
    response.headers["X-XSS-Protection"]    = "1; mode=block"
    response.headers["Referrer-Policy"]     = "strict-origin-when-cross-origin"
    response.headers["Cache-Control"]       = "no-store"

    logger.info(f"[{request_id}] → {response.status_code} in {ms}ms")
    return response

# ──────────────────────────────────────────────
# Pydantic Models
# ──────────────────────────────────────────────

class LotteryInfo(BaseModel):
    id: str
    name: str
    type: str  # "multistate" or "state"


class StateInfo(BaseModel):
    state_code: str
    state_name: str
    lotteries: List[LotteryInfo]


class ExtractionRequest(BaseModel):
    state_code: str = Field(..., description="Two-letter US state code (e.g., 'NY', 'CA', 'TX')")
    lottery_ids: List[str] = Field(..., description="List of lottery IDs to extract (e.g., ['powerball', 'mega_millions'])")
    from_date: str = Field(..., description="Start date in YYYY-MM-DD format")
    to_date: str = Field(..., description="End date in YYYY-MM-DD format")


class DrawResult(BaseModel):
    Date: str
    Lotto_Name: str
    State: Optional[str] = None
    balls: Dict[str, str] = Field(default_factory=dict)


class ExtractionResult(BaseModel):
    state_code: str
    state_name: str
    lotteries: List[str]
    from_date: str
    to_date: str
    total_records: int
    data: List[Dict[str, Any]]
    csv_filename: str


# ──────────────────────────────────────────────
# Geolocation Helper
# ──────────────────────────────────────────────

async def get_state_from_ip(ip: str) -> Optional[str]:
    """
    Determine US state from IP address using ipapi.co (free tier).
    Returns two-letter state code or None.
    """
    if ip in ["127.0.0.1", "::1", "localhost"] or ip.startswith("192.168.") or ip.startswith("10."):
        return None

    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"https://ipapi.co/{ip}/json/")
            if resp.status_code == 200:
                data = resp.json()
                if data.get("country_code") == "US":
                    region = data.get("region_code", "")
                    if region and len(region) == 2:
                        return region.upper()
    except Exception as e:
        logger.warning(f"IP geolocation failed: {e}")
    return None


# ──────────────────────────────────────────────
# API Routes
# ──────────────────────────────────────────────

@app.get("/api/info", tags=["Info"])
async def root():
    """API info - returns API info and available endpoints."""
    return {
        "name": "Lotto Extraction API",
        "version": "1.0.0",
        "description": "Real lottery results extraction - no fake numbers",
        "data_sources": [
            "NY Open Data (data.ny.gov) - Official government lottery data",
            "lotto.net - Public historical results archive",
        ],
        "endpoints": {
            "GET /lotteries/by-state/{state_code}": "Get available lotteries for a state",
            "GET /lotteries/all-states": "List all states with their supported lotteries",
            "GET /lotteries/detect-location": "Auto-detect state from IP and return lotteries",
            "POST /extract": "Extract lottery results (JSON response)",
            "POST /extract/csv": "Extract lottery results (CSV download)",
            "GET /extract": "Extract via query params (JSON response)",
            "GET /extract/csv": "Extract via query params (CSV download)",
            "GET /docs": "Interactive API documentation (Swagger UI)",
            "GET /redoc": "Alternative API documentation",
        },
        "supported_states": len([s for s in LOTTERIES_BY_STATE.values() if s]),
        "note": "All data is real historical lottery results from official sources",
    }


@app.get("/lotteries/all-states", tags=["Lotteries"])
async def get_all_states():
    """
    Returns all US states and their available lotteries.
    States without lotteries (AL, AK, HI, NV, UT) are included with empty lists.
    """
    result = []
    for code, data in LOTTERIES_BY_STATE.items():
        if isinstance(data, dict):
            result.append({
                "state_code": code,
                "state_name": data.get("state_name", STATE_NAMES.get(code, code)),
                "lottery_count": len(data.get("lotteries", [])),
                "lotteries": data.get("lotteries", []),
            })
        else:
            result.append({
                "state_code": code,
                "state_name": STATE_NAMES.get(code, code),
                "lottery_count": 0,
                "lotteries": [],
                "note": "No state lottery available",
            })

    return {
        "total_states": len(result),
        "states_with_lottery": sum(1 for s in result if s["lottery_count"] > 0),
        "states": sorted(result, key=lambda x: x["state_name"]),
    }


@app.get("/lotteries/by-state/{state_code}", tags=["Lotteries"])
async def get_lotteries_by_state(state_code: str):
    """
    Returns available lotteries for a specific US state.

    - **state_code**: Two-letter state abbreviation (e.g., NY, CA, TX, FL)
    """
    code = state_code.upper()
    if code not in LOTTERIES_BY_STATE:
        raise HTTPException(status_code=404, detail=f"State '{state_code}' not found")

    data = LOTTERIES_BY_STATE[code]
    if not data:
        return {
            "state_code": code,
            "state_name": STATE_NAMES.get(code, code),
            "lotteries": [],
            "message": "This state does not have a state lottery",
        }

    return {
        "state_code": code,
        "state_name": data.get("state_name", STATE_NAMES.get(code, code)),
        "lotteries": data.get("lotteries", []),
        "lottery_count": len(data.get("lotteries", [])),
    }


@app.get("/lotteries/detect-location", tags=["Lotteries"])
async def detect_location_lotteries(
    ip: Optional[str] = Query(None, description="IP address for geolocation (auto-detected if not provided)"),
    state_code: Optional[str] = Query(None, description="Override with known state code"),
):
    """
    Auto-detect location from IP address and return available lotteries.
    If IP detection fails, returns all states for manual selection.

    - **ip**: Optional IP address for geolocation
    - **state_code**: Optional manual state code override
    """
    detected_state = None

    if state_code:
        detected_state = state_code.upper()
    elif ip:
        detected_state = await get_state_from_ip(ip)

    if detected_state and detected_state in LOTTERIES_BY_STATE:
        data = LOTTERIES_BY_STATE[detected_state]
        return {
            "detected_state_code": detected_state,
            "detected_state_name": STATE_NAMES.get(detected_state, detected_state),
            "detection_method": "state_code_override" if state_code else "ip_geolocation",
            "lotteries": data.get("lotteries", []) if isinstance(data, dict) else [],
            "all_states_available": False,
        }

    # Return all states if detection fails
    all_states = []
    for code, data in LOTTERIES_BY_STATE.items():
        if isinstance(data, dict) and data.get("lotteries"):
            all_states.append({
                "state_code": code,
                "state_name": data.get("state_name", STATE_NAMES.get(code, code)),
                "lottery_count": len(data.get("lotteries", [])),
            })

    return {
        "detected_state_code": None,
        "detection_method": "failed",
        "message": "Location could not be detected. Please select your state manually.",
        "all_states_available": True,
        "available_states": sorted(all_states, key=lambda x: x["state_name"]),
    }


@app.get("/extract", tags=["Extract"])
async def extract_get(
    state_code: str = Query(..., description="Two-letter US state code"),
    lottery_ids: str = Query(..., description="Comma-separated lottery IDs (e.g., 'powerball,mega_millions')"),
    from_date: str = Query(..., description="Start date YYYY-MM-DD"),
    to_date: str = Query(..., description="End date YYYY-MM-DD"),
):
    """
    Extract lottery results via GET request (query parameters).
    Returns JSON with all draw results.

    Example: `/extract?state_code=NY&lottery_ids=powerball,mega_millions&from_date=2024-01-01&to_date=2024-12-31`
    """
    ids = [x.strip() for x in lottery_ids.split(",") if x.strip()]
    return await _do_extract(state_code, ids, from_date, to_date)


@app.post("/extract", tags=["Extract"])
async def extract_post(request: ExtractionRequest):
    """
    Extract lottery results via POST request (JSON body).
    Returns JSON with all draw results.
    """
    return await _do_extract(
        request.state_code,
        request.lottery_ids,
        request.from_date,
        request.to_date,
    )


@app.get("/extract/csv", tags=["Extract"])
async def extract_csv_get(
    state_code: str = Query(..., description="Two-letter US state code"),
    lottery_ids: str = Query(..., description="Comma-separated lottery IDs"),
    from_date: str = Query(..., description="Start date YYYY-MM-DD"),
    to_date: str = Query(..., description="End date YYYY-MM-DD"),
):
    """
    Extract lottery results and download as CSV file.
    Filename format: `{State Name}_{Lottery Name}_{FromDate}_{ToDate}.csv`

    Example: `/extract/csv?state_code=NY&lottery_ids=powerball,mega_millions&from_date=2024-01-01&to_date=2024-12-31`
    """
    ids = [x.strip() for x in lottery_ids.split(",") if x.strip()]
    return await _do_extract_csv(state_code, ids, from_date, to_date)


@app.post("/extract/csv", tags=["Extract"])
async def extract_csv_post(request: ExtractionRequest):
    """
    Extract lottery results and download as CSV.
    Filename format: `{State Name}_{Lottery Name}_{FromDate}_{ToDate}.csv`
    """
    return await _do_extract_csv(
        request.state_code,
        request.lottery_ids,
        request.from_date,
        request.to_date,
    )


# ──────────────────────────────────────────────
# Internal Helpers
# ──────────────────────────────────────────────

def _validate_dates(from_date_str: str, to_date_str: str):
    """Validate and parse date strings."""
    try:
        from_dt = datetime.strptime(from_date_str, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid from_date: '{from_date_str}'. Use YYYY-MM-DD format.")

    try:
        to_dt = datetime.strptime(to_date_str, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid to_date: '{to_date_str}'. Use YYYY-MM-DD format.")

    if from_dt > to_dt:
        raise HTTPException(status_code=400, detail="from_date must be before or equal to to_date.")

    today = date.today()
    if to_dt > today:
        to_dt = today  # Cap at today

    max_range = timedelta(days=365 * 10 + 3)  # ~10-year limit per request (Powerball/Mega need deeper history)
    if to_dt - from_dt > max_range:
        raise HTTPException(
            status_code=400,
            detail="Date range too large. Maximum 10 years per request. Use multiple requests for longer ranges."
        )

    return from_dt, to_dt


def _get_lottery_name(lottery_id: str, state_code: str) -> str:
    """Get human-readable lottery name."""
    code = state_code.upper()
    if code in LOTTERIES_BY_STATE and isinstance(LOTTERIES_BY_STATE[code], dict):
        for lot in LOTTERIES_BY_STATE[code].get("lotteries", []):
            if lot["id"] == lottery_id:
                return lot["name"]
    # Fallback to source config
    if lottery_id in LOTTERY_SOURCES:
        return LOTTERY_SOURCES[lottery_id]["name"]
    return lottery_id.replace("_", " ").title()


def _get_state_name(state_code: str) -> str:
    """Get full state name from code."""
    code = state_code.upper()
    if code in LOTTERIES_BY_STATE and isinstance(LOTTERIES_BY_STATE[code], dict):
        return LOTTERIES_BY_STATE[code].get("state_name", STATE_NAMES.get(code, code))
    return STATE_NAMES.get(code, code)


async def _do_extract(state_code: str, lottery_ids: List[str], from_date_str: str, to_date_str: str) -> Dict:
    """Core extraction logic - returns JSON."""
    code = state_code.upper()
    from_dt, to_dt = _validate_dates(from_date_str, to_date_str)
    state_name = _get_state_name(code)

    if not lottery_ids:
        raise HTTPException(status_code=400, detail="At least one lottery_id is required.")

    # Validate lottery IDs against state
    valid_ids = []
    if code in LOTTERIES_BY_STATE and isinstance(LOTTERIES_BY_STATE[code], dict):
        state_lot_ids = [l["id"] for l in LOTTERIES_BY_STATE[code].get("lotteries", [])]
        for lid in lottery_ids:
            if lid in state_lot_ids:
                valid_ids.append(lid)
            else:
                logger.warning(f"Lottery '{lid}' not in state '{code}' lotteries, attempting anyway.")
                valid_ids.append(lid)  # Allow even if not in state list
    else:
        valid_ids = lottery_ids

    # Fetch results for each lottery concurrently
    tasks = []
    for lid in valid_ids:
        lname = _get_lottery_name(lid, code)
        tasks.append(fetch_lottery_results(lid, lname, state_name, from_dt, to_dt))

    all_results_nested = await asyncio.gather(*tasks, return_exceptions=True)

    all_results = []
    errors = []
    for i, result in enumerate(all_results_nested):
        if isinstance(result, Exception):
            errors.append(f"Error fetching {valid_ids[i]}: {str(result)}")
            logger.error(f"Error in fetch task: {result}")
        else:
            all_results.extend(result)

    # Sort by date descending
    all_results.sort(key=lambda x: x.get("Date", ""), reverse=True)

    # Build CSV rows (normalized columns)
    csv_rows = build_csv_rows(all_results)

    # Build filename
    lottery_names = [_get_lottery_name(lid, code) for lid in valid_ids]
    lottery_str = "_".join(n.replace(" ", "_") for n in lottery_names[:3])
    filename = f"{state_name.replace(' ', '_')}_{lottery_str}_{from_dt.strftime('%Y%m%d')}_{to_dt.strftime('%Y%m%d')}.csv"

    # Track records served in metrics
    _metrics["records_served"] += len(csv_rows)

    return {
        "state_code": code,
        "state_name": state_name,
        "lotteries": [_get_lottery_name(lid, code) for lid in valid_ids],
        "from_date": from_dt.strftime("%Y-%m-%d"),
        "to_date": to_dt.strftime("%Y-%m-%d"),
        "total_records": len(csv_rows),
        "data": csv_rows,
        "csv_filename": filename,
        "errors": errors,
        "data_sources": [
            "NY Open Data (data.ny.gov) - Official government data",
            "lotto.net - Historical results archive",
        ],
    }


async def _do_extract_csv(state_code: str, lottery_ids: List[str], from_date_str: str, to_date_str: str):
    """Core extraction logic - returns CSV file download."""
    result = await _do_extract(state_code, lottery_ids, from_date_str, to_date_str)

    if not result["data"]:
        raise HTTPException(
            status_code=404,
            detail=f"No lottery results found for the specified criteria. "
                   f"Note: Some state-specific lotteries may not have data available "
                   f"for the requested date range. Powerball and Mega Millions have the "
                   f"most historical data available."
        )

    # Build CSV content
    rows = result["data"]
    output = io.StringIO()

    # Write CSV
    if rows:
        fieldnames = list(rows[0].keys())
        writer = csv.DictWriter(output, fieldnames=fieldnames, lineterminator='\n')
        writer.writeheader()
        for row in rows:
            writer.writerow(row)

    output.seek(0)
    filename = result["csv_filename"]

    return StreamingResponse(
        io.BytesIO(output.getvalue().encode("utf-8")),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Total-Records": str(result["total_records"]),
            "X-State": result["state_name"],
            "X-Lotteries": ", ".join(result["lotteries"]),
            "X-From-Date": result["from_date"],
            "X-To-Date": result["to_date"],
        },
    )


# ──────────────────────────────────────────────
# Scoreboard API — real-time multi-state results
# ──────────────────────────────────────────────

# Map scoreboard game types to lottery_id patterns per state
SCOREBOARD_GAMES = {
    "pick3": {
        "CA": {"evening": "ca_daily3", "midday": "ca_midday3"},
        "FL": {"evening": "fl_pick3", "midday": "fl_pick3_midday"},
        "GA": {"evening": "ga_cash3", "midday": "ga_cash3_midday", "night": "ga_cash3_night"},
        "NY": {"evening": "ny_numbers", "midday": "ny_numbers_midday"},
        "OH": {"evening": "oh_pick3", "midday": "oh_pick3_midday"},
        "PA": {"evening": "pa_pick3", "midday": "pa_pick3_midday"},
        "NC": {"evening": "nc_pick3", "midday": "nc_pick3_midday"},
        "NJ": {"evening": "nj_pick3", "midday": "nj_pick3_midday"},
        "VA": {"evening": "va_pick3", "midday": "va_pick3_day"},
        "MI": {"evening": "mi_daily3", "midday": "mi_daily3_midday"},
        "TN": {"evening": "tn_cash3_evening", "midday": "tn_cash3_midday"},
        "MD": {"evening": "md_pick3", "midday": "md_pick3_midday"},
        "IN": {"evening": "in_daily3", "midday": "in_daily3_midday"},
        "IL": {"evening": "il_pick3_evening", "midday": "il_pick3_midday"},
        "MO": {"evening": "mo_pick3"},
        "TX": {"evening": "tx_pick3"},
        "KY": {"evening": "ky_pick3_evening", "midday": "ky_pick3_midday"},
        "SC": {"evening": "sc_pick3"},
        "LA": {"evening": "la_pick3"},
        "MA": {"evening": "ma_numbers", "midday": "ma_numbers_midday"},
        "AR": {"evening": "ar_cash3", "midday": "ar_cash3_midday"},
        "WV": {"evening": "wv_daily3"},
        "WI": {"evening": "wi_pick3"},
        "AZ": {"evening": "az_pick3"},
        "CO": {"evening": "co_pick3"},
    },
    "pick4": {
        "FL": {"evening": "fl_pick4", "midday": "fl_pick4_midday"},
        "GA": {"evening": "ga_cash4", "midday": "ga_cash4_midday", "night": "ga_cash4_night"},
        "NY": {"evening": "ny_win4", "midday": "ny_win4_midday"},
        "OH": {"evening": "oh_pick4", "midday": "oh_pick4_midday"},
        "PA": {"evening": "pa_pick4", "midday": "pa_pick4_midday"},
        "NC": {"evening": "nc_pick4", "midday": "nc_pick4_midday"},
        "NJ": {"evening": "nj_pick4", "midday": "nj_pick4_midday"},
        "VA": {"evening": "va_pick4", "midday": "va_pick4_day"},
        "MI": {"evening": "mi_daily4", "midday": "mi_daily4_midday"},
        "MD": {"evening": "md_pick4", "midday": "md_pick4_midday"},
        "IL": {"evening": "il_pick4_evening", "midday": "il_pick4_midday"},
        "IN": {"evening": "in_daily4"},
        "KY": {"evening": "ky_pick4_evening", "midday": "ky_pick4_midday"},
        "SC": {"evening": "sc_pick4"},
        "TX": {"evening": "tx_daily4"},
        "MO": {"evening": "mo_pick4"},
        "LA": {"evening": "la_pick4"},
        "WV": {"evening": "wv_daily4"},
        "WI": {"evening": "wi_pick4"},
    },
    "pick5": {
        "FL": {"evening": "fl_pick5", "midday": "fl_pick5_midday"},
        "OH": {"evening": "oh_pick5"},
        "PA": {"evening": "pa_pick5"},
        "MD": {"evening": "md_pick5", "midday": "md_pick5_midday"},
        "LA": {"evening": "la_pick5"},
    },
    "powerball": {
        "US": {"evening": "powerball"},
    },
    "megamillions": {
        "US": {"evening": "mega_millions"},
    },
}

# In-memory scoreboard cache {game_type}_{draw_type}_{date} -> {data, timestamp}
_scoreboard_cache: Dict[str, Any] = {}
SCOREBOARD_CACHE_TTL = 300  # 5 minutes


@app.get("/api/scoreboard", tags=["Scoreboard"])
async def get_scoreboard(
    game: str = Query("pick3", description="Game type: pick3, pick4, pick5, powerball, megamillions"),
    draw: str = Query("evening", description="Draw type: evening, midday, night"),
    target_date: Optional[str] = Query(None, description="Target date YYYY-MM-DD (defaults to today)"),
):
    """
    Auto-updating scoreboard endpoint.
    Returns the latest draw results for all states for a given game type and draw.
    Supports caching to avoid hammering upstream sources.
    """
    game = game.lower().strip()
    draw = draw.lower().strip()

    if game not in SCOREBOARD_GAMES:
        raise HTTPException(status_code=400, detail=f"Unknown game: {game}. Options: {list(SCOREBOARD_GAMES.keys())}")

    today = date.today()
    if target_date:
        try:
            td = datetime.strptime(target_date, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid date format: {target_date}. Use YYYY-MM-DD.")
    else:
        td = today

    # Check cache
    cache_key = f"{game}_{draw}_{td.isoformat()}"
    cached = _scoreboard_cache.get(cache_key)
    if cached and (time.time() - cached["timestamp"]) < SCOREBOARD_CACHE_TTL:
        logger.info(f"Scoreboard cache hit: {cache_key}")
        return cached["data"]

    # Build tasks: one fetch per state
    game_map = SCOREBOARD_GAMES[game]
    tasks = []
    task_meta = []  # (state_code, lottery_id)

    from_dt = td - timedelta(days=7)  # look back 7 days for latest draw

    for state_code, draws in game_map.items():
        lottery_id = draws.get(draw)
        if not lottery_id:
            continue
        lottery_name = _get_lottery_name(lottery_id, state_code)
        state_name = _get_state_name(state_code) if state_code != "US" else "United States"
        tasks.append(fetch_lottery_results(lottery_id, lottery_name, state_name, from_dt, td))
        task_meta.append((state_code, lottery_id, lottery_name))

    # Run all fetches concurrently
    results = await asyncio.gather(*tasks, return_exceptions=True)

    entries = []
    errors = []
    for i, result in enumerate(results):
        sc, lid, lname = task_meta[i]
        if isinstance(result, Exception):
            errors.append(f"{sc}/{lid}: {str(result)}")
            continue
        if not result:
            continue

        # Sort by date desc and take latest
        sorted_res = sorted(result, key=lambda x: x.get("Date", ""), reverse=True)
        latest = sorted_res[0] if sorted_res else None
        if not latest:
            continue

        # Extract ball numbers, separating main balls from extra/fireball
        all_balls = []
        extra = ""
        named_extra_keys = {"Fireball", "fireball", "Wild_Ball", "wild_ball",
                            "Extra_Ball", "Mega Ball", "Powerball", "Mega_Ball",
                            "Power_Ball", "Bonus", "bonus", "bonus_ball"}
        for key in sorted(latest.keys()):
            if key.startswith("Ball_"):
                all_balls.append(str(latest[key]))
            elif key in named_extra_keys and latest[key]:
                extra = str(latest[key])

        # Determine expected main ball count based on game type
        expected_balls = {"pick3": 3, "pick4": 4, "pick5": 5,
                          "powerball": 5, "megamillions": 5}.get(game, 3)

        # If we have more Ball_ columns than expected, the extras are fireball/wild
        if len(all_balls) > expected_balls and not extra:
            balls = all_balls[:expected_balls]
            extra = all_balls[expected_balls] if len(all_balls) > expected_balls else ""
        else:
            balls = all_balls[:expected_balls]

        entries.append({
            "state": sc,
            "lottery_id": lid,
            "lottery_name": lname,
            "date": latest.get("Date", ""),
            "balls": balls,
            "extra": extra,
            "status": "confirmed",
        })

    response_data = {
        "game": game,
        "draw": draw,
        "target_date": td.isoformat(),
        "fetched_at": datetime.utcnow().isoformat(),
        "entries": entries,
        "total_states": len(entries),
        "errors": errors,
        "cache_ttl_seconds": SCOREBOARD_CACHE_TTL,
    }

    # Store in cache
    _scoreboard_cache[cache_key] = {"data": response_data, "timestamp": time.time()}

    return response_data


@app.get("/api/scoreboard/games", tags=["Scoreboard"])
async def get_scoreboard_games():
    """Returns available scoreboard game types, draw types, and state counts."""
    games = {}
    for game_type, state_map in SCOREBOARD_GAMES.items():
        draws = set()
        for state_code, draw_map in state_map.items():
            draws.update(draw_map.keys())
        games[game_type] = {
            "states": len(state_map),
            "draws": sorted(draws),
        }
    return {"games": games}


@app.get("/health", tags=["Info"])
async def health_check():
    """Liveness probe – is the process alive?"""
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "version": API_VERSION,
    }


@app.get("/health/ready", tags=["Info"])
async def readiness_check():
    """
    Readiness probe – is the API ready to serve traffic?
    Verifies lottery config and scraper imports are loaded.
    """
    checks = {}
    ok = True

    # Check lottery config loaded
    try:
        n = sum(1 for v in LOTTERIES_BY_STATE.values() if isinstance(v, dict) and v.get("lotteries"))
        checks["lottery_config"] = {"status": "ok", "states_with_lotteries": n}
    except Exception as e:
        checks["lottery_config"] = {"status": "error", "detail": str(e)}
        ok = False

    # Check scraper importable
    try:
        from scrapers import fetch_lottery_results, build_csv_rows  # noqa
        checks["scrapers"] = {"status": "ok"}
    except Exception as e:
        checks["scrapers"] = {"status": "error", "detail": str(e)}
        ok = False

    status_code = 200 if ok else 503
    return JSONResponse(
        status_code=status_code,
        content={"status": "ready" if ok else "not_ready", "checks": checks,
                 "timestamp": datetime.utcnow().isoformat()},
    )


@app.get("/metrics", tags=["Info"])
async def get_metrics():
    """
    Runtime metrics: request counts, error rates, response times, uptime.
    """
    rt = _metrics["response_times_ms"]
    avg_ms = round(sum(rt) / len(rt), 1) if rt else 0
    p95_ms = sorted(rt)[int(len(rt) * 0.95)] if rt else 0
    p99_ms = sorted(rt)[int(len(rt) * 0.99)] if rt else 0

    start = datetime.fromisoformat(_metrics["start_time"])
    uptime_s = int((datetime.utcnow() - start).total_seconds())

    total = _metrics["requests_total"] or 1  # avoid div/0
    return {
        "version": API_VERSION,
        "uptime_seconds": uptime_s,
        "start_time": _metrics["start_time"],
        "requests": {
            "total":   _metrics["requests_total"],
            "success": _metrics["requests_success"],
            "error":   _metrics["requests_error"],
            "4xx":     _metrics["requests_4xx"],
            "5xx":     _metrics["requests_5xx"],
            "success_rate_pct": round(_metrics["requests_success"] / total * 100, 1),
        },
        "records_served": _metrics["records_served"],
        "response_time_ms": {"avg": avg_ms, "p95": p95_ms, "p99": p99_ms},
        "top_endpoints": dict(sorted(_metrics["by_endpoint"].items(),
                                      key=lambda x: x[1], reverse=True)[:10]),
        "rate_limit": {
            "requests_per_window": RATE_LIMIT_REQUESTS,
            "window_seconds": RATE_LIMIT_WINDOW,
        },
    }


@app.get("/lotteries/sources", tags=["Info"])
async def get_data_sources():
    """
    Returns information about data sources used for lottery results.
    """
    return {
        "sources": [
            {
                "name": "NY Open Data - Powerball",
                "url": "https://data.ny.gov/resource/d6yy-54nr.json",
                "type": "Official Government API",
                "coverage": "Powerball results from 2010 to present",
                "update_frequency": "After each drawing",
            },
            {
                "name": "NY Open Data - Mega Millions",
                "url": "https://data.ny.gov/resource/5xaw-6ayf.json",
                "type": "Official Government API",
                "coverage": "Mega Millions results from 2002 to present",
                "update_frequency": "After each drawing",
            },
            {
                "name": "NY Open Data - NY Lotto",
                "url": "https://data.ny.gov/resource/6nbc-h7bj.json",
                "type": "Official Government API",
                "coverage": "NY Lotto results",
                "update_frequency": "After each drawing",
            },
            {
                "name": "NY Open Data - Take 5",
                "url": "https://data.ny.gov/resource/dg63-4siq.json",
                "type": "Official Government API",
                "coverage": "NY Take 5 results",
                "update_frequency": "After each drawing",
            },
            {
                "name": "lotto.net",
                "url": "https://www.lotto.net",
                "type": "Public Historical Archive",
                "coverage": "Multiple state and multi-state lotteries",
                "update_frequency": "After each drawing",
            },
        ],
        "disclaimer": "All data is sourced from official or publicly verified lottery sources. No randomly generated numbers are used.",
    }


# ──────────────────────────────────────────────
# Serve Frontend Pages
# ──────────────────────────────────────────────
FRONTEND_BUILD = Path(__file__).parent.parent / "frontend" / "build"
SCOREBOARD_HTML = FRONTEND_BUILD / "lotto-scoreboard.html"
REACT_INDEX_HTML = FRONTEND_BUILD / "index.html"
# Fallback location (root of project)
SCOREBOARD_HTML_ALT = Path(__file__).parent.parent / "lotto-scoreboard.html"

def _scoreboard_path() -> Optional[Path]:
    if SCOREBOARD_HTML.exists():
        return SCOREBOARD_HTML
    if SCOREBOARD_HTML_ALT.exists():
        return SCOREBOARD_HTML_ALT
    return None

def _react_index_path() -> Optional[Path]:
    if REACT_INDEX_HTML.exists():
        return REACT_INDEX_HTML
    return None

@app.get("/", include_in_schema=False)
@app.get("/app", include_in_schema=False)
async def serve_root():
    """Root → serve the Lotto Extractor (React app — main page)."""
    idx = _react_index_path()
    if idx:
        return FileResponse(str(idx), media_type="text/html",
                            headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"})
    raise HTTPException(status_code=404, detail="React app not found")

@app.get("/scoreboard", include_in_schema=False)
@app.get("/lotto-scoreboard.html", include_in_schema=False)
async def serve_scoreboard():
    """Scoreboard page."""
    sb = _scoreboard_path()
    if sb:
        return FileResponse(str(sb), media_type="text/html",
                            headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"})
    raise HTTPException(status_code=404, detail="Scoreboard not found")

# ──────────────────────────────────────────────
# Serve static assets from React build (CSS/JS/images)
# ──────────────────────────────────────────────

if FRONTEND_BUILD.exists():
    static_dir = FRONTEND_BUILD / "static"
    if static_dir.exists():
        app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

    manifest_path = FRONTEND_BUILD / "manifest.json"
    if manifest_path.exists():
        @app.get("/manifest.json")
        async def manifest():
            return FileResponse(str(manifest_path))

    favicon_path = FRONTEND_BUILD / "favicon.ico"
    if favicon_path.exists():
        @app.get("/favicon.ico")
        async def favicon():
            return FileResponse(str(favicon_path))

    # Catch-all fallback → serve scoreboard for unknown paths
    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str):
        API_PREFIXES = (
            "extract", "lotteries", "health", "docs", "redoc",
            "openapi", "api/", "static/", "stripe/", "metrics",
        )
        if any(full_path.startswith(p) for p in API_PREFIXES):
            raise HTTPException(status_code=404, detail=f"API path not found: /{full_path}")
        # Serve scoreboard as the default page
        sb = _scoreboard_path()
        if sb:
            return FileResponse(str(sb), media_type="text/html",
                                headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"})
        raise HTTPException(status_code=404, detail="Frontend not built")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=False)
