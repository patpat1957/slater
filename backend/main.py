"""
Lotto Extraction API - FastAPI Backend
Real lottery data only - no fake/random numbers.
"""

import csv
import io
import json
import logging
import asyncio
import os
from pathlib import Path
from datetime import date, datetime, timedelta
from typing import List, Optional, Dict, Any
from fastapi import FastAPI, Query, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
import httpx

from lottery_config import LOTTERIES_BY_STATE, STATE_NAMES, LOTTERY_SOURCES
from scrapers import fetch_lottery_results, build_csv_rows

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Lotto Extraction API",
    description="""
## Lotto Extraction REST API

Real lottery results from official sources.

### Features
- **Location-based lottery discovery** - Find lotteries available in your state
- **Multi-lottery selection** - Choose multiple lotteries simultaneously
- **Date range filtering** - Query results between any two dates
- **CSV export** - Download results in structured CSV format
- **Real data only** - All numbers sourced from official lottery websites and government open data

### Data Sources
- **NY Open Data** (data.ny.gov) - Official NY State lottery data (Powerball, Mega Millions, NY Lotto, etc.)
- **lotto.net** - Public historical lottery results archive
- Real-time scraping of official lottery sources

### Column Format
`Date | Lotto_Name | Ball_1 | Ball_2 | ... | [Bonus Balls]`
    """,
    version="1.0.0",
    contact={"name": "Lotto Extraction API", "url": "http://localhost:8000"},
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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

    max_range = timedelta(days=365 * 5)  # 5-year limit per request
    if to_dt - from_dt > max_range:
        raise HTTPException(
            status_code=400,
            detail="Date range too large. Maximum 5 years per request. Use multiple requests for longer ranges."
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

    return {
        "state_code": code,
        "state_name": state_name,
        "lotteries": [_get_lottery_name(lid, code) for lid in valid_ids],
        "from_date": from_dt.strftime("%Y-%m-%d"),
        "to_date": to_dt.strftime("%Y-%m-%d"),
        "total_records": len(csv_rows),
        "data": csv_rows,
        "csv_filename": filename,
        "errors": errors if errors else None,
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


@app.get("/health", tags=["Info"])
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "version": "1.0.0",
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
# Serve React Frontend (SPA)
# ──────────────────────────────────────────────

FRONTEND_BUILD = Path(__file__).parent.parent / "frontend" / "build"

if FRONTEND_BUILD.exists():
    # Serve static assets (JS, CSS, images)
    app.mount("/static", StaticFiles(directory=str(FRONTEND_BUILD / "static")), name="static")

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

    # Root → serve React frontend
    @app.get("/", include_in_schema=False)
    async def serve_root():
        index_file = FRONTEND_BUILD / "index.html"
        return FileResponse(str(index_file))

    # SPA fallback — serve index.html for all non-API paths
    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str):
        API_PREFIXES = (
            "extract", "lotteries", "health", "docs", "redoc",
            "openapi", "api/", "static/",
        )
        if any(full_path.startswith(p) for p in API_PREFIXES):
            raise HTTPException(status_code=404, detail=f"API path not found: /{full_path}")
        index_file = FRONTEND_BUILD / "index.html"
        if index_file.exists():
            return FileResponse(str(index_file))
        raise HTTPException(status_code=404, detail="Frontend not built")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=False)
