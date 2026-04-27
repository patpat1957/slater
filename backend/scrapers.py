"""
Real Lottery Data Scrapers - No fake/random numbers.
All data sourced from official/public lottery websites and open data APIs.

Data sources:
- lotto.net: Public historical results archive (archive-list structure)
- data.ny.gov: NY State Open Data (when accessible)
"""

import re
import asyncio
import logging
from datetime import datetime, date, timedelta
from typing import List, Dict, Optional, Any
import httpx
import requests as _requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

# ── 403 Error Cache ──────────────────────────────────────────────────────────
# When a data source returns 403 Forbidden, cache it so subsequent requests
# within the TTL skip that source immediately (avoids repeated slow failures).
# Key: domain or source name, Value: timestamp when the 403 was received
import time as _time
_403_cache = {}  # { 'ny_open_data': timestamp, 'lottery.net': timestamp, ... }
_403_TTL = 600   # 10 minutes
_error_cache = {}  # { 'lottery.net': {count: N, ts: timestamp} } — tracks consecutive errors
_ERROR_TTL = 300   # 5 minutes cooldown after repeated errors
_ERROR_THRESHOLD = 3  # consecutive errors before blocking

def _is_403_blocked(source: str) -> bool:
    """Check if a source is temporarily blocked due to recent 403 or repeated errors."""
    ts = _403_cache.get(source)
    if ts and (_time.time() - ts) < _403_TTL:
        return True
    if ts:
        del _403_cache[source]  # expired
    # Also check repeated-error block
    info = _error_cache.get(source)
    if info and info['count'] >= _ERROR_THRESHOLD and (_time.time() - info['ts']) < _ERROR_TTL:
        return True
    if info and (_time.time() - info['ts']) >= _ERROR_TTL:
        del _error_cache[source]  # expired
    return False

def _mark_403(source: str):
    """Mark a source as returning 403."""
    _403_cache[source] = _time.time()
    logger.warning(f"403 cached for {source} — skipping for {_403_TTL}s")

def _mark_error(source: str):
    """Track consecutive errors for a source; blocks after threshold."""
    info = _error_cache.get(source, {'count': 0, 'ts': 0})
    info['count'] = info['count'] + 1
    info['ts'] = _time.time()
    _error_cache[source] = info
    if info['count'] >= _ERROR_THRESHOLD:
        logger.warning(f"error-cached {source} after {info['count']} failures — skipping for {_ERROR_TTL}s")

def _clear_errors(source: str):
    """Clear error count on successful request."""
    _error_cache.pop(source, None)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
}


def fmt_ball(n) -> str:
    """Format ball number as zero-padded 2-digit string (for regular lotto games)."""
    try:
        # Strip any non-digit characters first
        num_str = re.sub(r'[^\d]', '', str(n)).strip()
        if not num_str:
            return "00"
        return f"{int(num_str):02d}"
    except Exception:
        return str(n).strip().zfill(2)


def fmt_ball_single(n) -> str:
    """Format ball number as a single digit string (0-9) for Pick 3/4/5 type games."""
    try:
        num_str = re.sub(r'[^\d]', '', str(n)).strip()
        if not num_str:
            return "0"
        val = int(num_str)
        # Pick games use digits 0-9 only
        return str(val % 10)
    except Exception:
        s = str(n).strip()
        return s[-1] if s and s[-1].isdigit() else "0"


# Games where each ball is a single digit (0-9), not a two-digit number
SINGLE_DIGIT_GAMES = {
    # Virginia
    "va_pick3", "va_pick3_day",
    "va_pick4", "va_pick4_day",
    # Florida
    "fl_pick3", "fl_pick3_midday",
    "fl_pick4", "fl_pick4_midday",
    "fl_pick5", "fl_pick5_midday",
    # California
    "ca_daily3", "ca_midday3", "ca_daily4",
    # Arizona
    "az_pick3",
    # Arkansas
    "ar_cash3", "ar_cash3_midday",
    # New York
    "ny_numbers", "ny_numbers_midday",
    "ny_win4", "ny_win4_midday",
    # Colorado
    "co_pick3",
    # Connecticut
    "ct_play3", "ct_play4",
    # DC
    "dc_lottery",
    # Delaware (Play 3/4/5 use single digits 0-9; Multi Win uses 2-digit balls)
    "de_play3_day", "de_play3_night",
    "de_play4_day", "de_play4_night",
    "de_play5_day", "de_play5_night",
    # Georgia (single-digit pick-style games)
    "ga_cash3", "ga_cash3_midday", "ga_cash3_night",
    "ga_cash4", "ga_cash4_midday", "ga_cash4_night",
    "ga_five_evening", "ga_five_midday",
    # ga_cash_pop uses 2-digit balls (1–15 range), ga_fantasy5 uses 2-digit – NOT in SINGLE_DIGIT_GAMES
    # Illinois (pick3/pick4 single-digit; lucky day lotto, il_lotto, il_hotwins use 2-digit)
    "il_pick3_evening", "il_pick3_midday",
    "il_pick4_evening", "il_pick4_midday",
    # Indiana
    "in_daily3", "in_daily3_midday", "in_daily4",
    # Iowa
    "ia_pick3_evening", "ia_pick3_midday",
    "ia_pick4_evening", "ia_pick4_midday",
    # Idaho (id_cash uses 2-digit balls – NOT single digit)
    "id_pick3_day", "id_pick3_night",
    "id_pick4_day", "id_pick4_night",
    # Kansas (pick3 single-digit; super-cash 2-digit)
    "ks_pick3_evening", "ks_pick3_midday",
    # Kentucky (pick3/4 single-digit; cash-ball/cash-pop 2-digit)
    "ky_pick3_evening", "ky_pick3_midday",
    "ky_pick4_evening", "ky_pick4_midday",
    # Louisiana
    "la_pick3", "la_pick4", "la_pick5",
    # Massachusetts
    "ma_numbers", "ma_numbers_midday",
    # Maryland
    "md_pick3", "md_pick3_midday",
    "md_pick4", "md_pick4_midday",
    "md_pick5", "md_pick5_midday",
    # Maine
    "me_pick3", "me_pick4",
    # Michigan
    "mi_daily3", "mi_daily3_midday",
    "mi_daily4", "mi_daily4_midday",
    # Minnesota
    "mn_pick3",
    # Missouri
    "mo_pick3", "mo_pick4",
    # Mississippi
    "ms_cash3", "ms_cash3_midday",
    "ms_cash4", "ms_cash4_midday",
    # North Carolina
    "nc_pick3", "nc_pick3_midday",
    "nc_pick4", "nc_pick4_midday",
    # Nebraska
    "ne_pick3",
    # New Hampshire
    "nh_pick3", "nh_pick4",
    # New Jersey
    "nj_pick3", "nj_pick3_midday", "nj_pick4", "nj_pick4_midday",
    # New Mexico
    "nm_pick3",
    # Ohio
    "oh_pick3", "oh_pick3_midday",
    "oh_pick4", "oh_pick4_midday", "oh_pick5",
    # Oklahoma
    "ok_pick3",
    # Oregon
    "or_pick4",
    # Pennsylvania
    "pa_pick2", "pa_pick3", "pa_pick3_day", "pa_pick3_evening", "pa_pick3_midday",
    "pa_pick4", "pa_pick4_day", "pa_pick4_evening", "pa_pick4_midday", "pa_pick5",
    # Rhode Island
    "ri_numbers",
    # South Carolina
    "sc_pick3", "sc_pick4",
    # South Dakota
    "sd_pick3",
    # Tennessee
    "tn_pick3", "tn_cash3_evening", "tn_cash3_midday", "tn_pick4",
    # Texas
    "tx_pick3", "tx_daily4",
    # Vermont
    "vt_pick3", "vt_pick4",
    # Washington
    "wa_daily_game",
    # Wisconsin
    "wi_pick3", "wi_pick4",
    # West Virginia
    "wv_daily3", "wv_daily4",
}


def _parse_lotto_net_date(text: str) -> Optional[date]:
    """Parse various date formats from lotto.net archive-list format."""
    text = text.strip()
    # Remove ordinal suffixes: 1st -> 1, 2nd -> 2, etc.
    cleaned = re.sub(r'(\d+)(st|nd|rd|th)', r'\1', text)

    # lotto.net format: "WednesdayDecember 31 2025" or "Monday December 29 2025"
    # Try to extract just the date part
    # Pattern: [Day of week][Month] [Date] [Year]
    patterns = [
        # "WednesdayDecember 31 2025" - day and month concatenated
        (r'(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)'
         r'(January|February|March|April|May|June|July|August|September|October|November|December)'
         r'\s+(\d{1,2})\s+(\d{4})', '%B %d %Y'),
        # Standard formats
        (r'(January|February|March|April|May|June|July|August|September|October|November|December)'
         r'\s+(\d{1,2})\s+(\d{4})', '%B %d %Y'),
    ]

    for pattern, fmt in patterns:
        m = re.search(pattern, cleaned, re.I)
        if m:
            try:
                if len(m.groups()) == 3:
                    month_str, day_str, year_str = m.group(1), m.group(2), m.group(3)
                    return datetime.strptime(f"{month_str} {day_str} {year_str}", fmt).date()
                elif len(m.groups()) == 2:
                    day_str, year_str = m.group(1), m.group(2)
                    return datetime.strptime(f"{day_str} {year_str}", fmt).date()
            except ValueError:
                continue

    # Fallback: try direct parsing
    direct_formats = [
        "%B %d %Y", "%m/%d/%Y", "%Y-%m-%d",
    ]
    for fmt in direct_formats:
        try:
            return datetime.strptime(cleaned.strip(), fmt).date()
        except ValueError:
            continue

    return None


def _parse_ball_li(li_text: str, label: str) -> Optional[str]:
    """
    Extract ball number from a list item text.
    lotto.net embeds the label in the li text: "26Powerball" or "10P.Play"
    """
    # Remove the label and extract only digits
    cleaned = li_text.replace(label, '').strip()
    digits = re.sub(r'[^\d]', '', cleaned)
    if digits:
        return fmt_ball(digits)
    return None


def _parse_lotto_net_archive_items(soup: BeautifulSoup, lottery_id: str, lottery_name: str,
                                    state: str, from_date: date, to_date: date) -> List[Dict]:
    """
    Parse lotto.net archive-list items.
    Each item has:
    - div.date: "WednesdayDecember 31st 2025"
    - ul > li: balls (last li has bonus ball label embedded in text)
    """
    results = []
    archive_items = soup.find_all('div', class_='archive-list')

    for item in archive_items:
        # Extract date
        date_div = item.find('div', class_='date')
        if not date_div:
            continue

        date_text = date_div.get_text(strip=True)
        draw_date = _parse_lotto_net_date(date_text)
        if not draw_date:
            continue

        # Filter by date range
        if draw_date > to_date:
            continue
        if draw_date < from_date:
            # Items are sorted newest first, so we can stop
            break

        # Extract balls
        balls_ul = item.find('ul')
        if not balls_ul:
            continue

        lis = balls_ul.find_all('li')
        balls = []
        bonus_ball = None
        power_play = None

        for li in lis:
            txt = li.get_text(strip=True)
            if not txt:
                continue

            # Check for special ball labels in text
            if 'Powerball' in txt or 'PowerBall' in txt:
                num = re.sub(r'[^\d]', '', txt.replace('Powerball', '').replace('PowerBall', ''))
                if num:
                    bonus_ball = fmt_ball(num)
            elif 'Mega' in txt and 'Megaplier' not in txt and 'MegaBall' not in txt and 'Mega Ball' not in txt:
                # Could be Mega ball or Megaplier
                num = re.sub(r'[^\d]', '', re.sub(r'Mega\w*', '', txt))
                if num:
                    bonus_ball = fmt_ball(num)
            elif 'MegaBall' in txt or 'Mega Ball' in txt:
                num = re.sub(r'[^\d]', '', re.sub(r'Mega\s*Ball', '', txt))
                if num:
                    bonus_ball = fmt_ball(num)
            elif 'Megaplier' in txt or 'multiplier' in txt.lower():
                num = re.sub(r'[^\d]', '', re.sub(r'(?:Mega|multiplier|plier)', '', txt, flags=re.I))
                if num:
                    power_play = fmt_ball(num)
            elif 'P.Play' in txt or 'Power Play' in txt or 'PowerPlay' in txt:
                num = re.sub(r'[^\d]', '', re.sub(r'P\.Play|Power\s*Play', '', txt))
                if num:
                    power_play = fmt_ball(num)
            elif 'Bonus' in txt:
                num = re.sub(r'[^\d]', '', txt.replace('Bonus', ''))
                if num:
                    bonus_ball = fmt_ball(num)
            else:
                # Regular ball - extract digits only
                digits = re.sub(r'[^\d]', '', txt)
                if digits:
                    balls.append(fmt_ball(digits))

        if len(balls) < 3:  # Minimum 3 regular balls
            continue

        row = {
            "Date": draw_date.strftime("%Y-%m-%d"),
            "Lotto_Name": lottery_name,
            "State": state,
            "Lottery_ID": lottery_id,
        }

        # Map balls to columns based on lottery type
        if lottery_id == "powerball":
            for i, b in enumerate(balls[:5], 1):
                row[f"Ball_{i}"] = b
            if bonus_ball:
                row["Powerball"] = bonus_ball
            if power_play:
                row["Power_Play"] = power_play

        elif lottery_id == "mega_millions":
            for i, b in enumerate(balls[:5], 1):
                row[f"Ball_{i}"] = b
            if bonus_ball:
                row["Mega_Ball"] = bonus_ball
            if power_play:
                row["Megaplier"] = power_play

        elif lottery_id == "ca_superlotto_plus":
            for i, b in enumerate(balls[:5], 1):
                row[f"Ball_{i}"] = b
            if bonus_ball:
                row["Mega"] = bonus_ball

        elif lottery_id in ["fl_lotto", "tx_lotto_texas", "ny_lotto_net", "mi_lotto47",
                             "wa_lotto", "wi_supercash", "or_megabucks"]:
            for i, b in enumerate(balls, 1):
                row[f"Ball_{i}"] = b
            if bonus_ball:
                row["Bonus"] = bonus_ball

        else:
            for i, b in enumerate(balls, 1):
                row[f"Ball_{i}"] = b
            if bonus_ball:
                row["Bonus_Ball"] = bonus_ball
            if power_play:
                row["Multiplier"] = power_play

        results.append(row)

    return results


# URL map for lotto.net
LOTTO_NET_URL_MAP = {
    "powerball": "https://www.lotto.net/powerball/numbers/{year}",
    "mega_millions": "https://www.lotto.net/mega-millions/numbers/{year}",
    "ca_superlotto_plus": "https://www.lotto.net/california-super-lotto-plus/numbers/{year}",
    "fl_lotto": "https://www.lotto.net/florida-lotto/numbers/{year}",
    "tx_lotto_texas": "https://www.lotto.net/texas-lotto/numbers/{year}",
    "ny_lotto_net": "https://www.lotto.net/new-york-lotto/numbers/{year}",
    "mi_lotto47": "https://www.lotto.net/michigan-lotto-47/numbers/{year}",
    "wa_lotto": "https://www.lotto.net/washington-lotto/numbers/{year}",
    "or_megabucks": "https://www.lotto.net/oregon-megabucks/numbers/{year}",
    "nj_jersey_cash5": "https://www.lotto.net/new-jersey-cash-5/numbers/{year}",
    "nj_pick6": "https://www.lotto.net/new-jersey-pick-6/numbers/{year}",
    "il_lotto": "https://www.lotto.net/illinois-lotto/numbers/{year}",
}


async def scrape_lotto_net(lottery_id: str, lottery_name: str, state: str,
                            from_date: date, to_date: date) -> List[Dict]:
    """
    Scrape lotto.net for lottery results using the archive-list structure.
    """
    url_template = LOTTO_NET_URL_MAP.get(lottery_id)
    if not url_template:
        logger.warning(f"No lotto.net URL for lottery_id: {lottery_id}")
        return []

    # Skip if lotto.net recently returned 403
    if _is_403_blocked('lotto.net'):
        logger.debug(f"lotto.net 403-cached, skipping {lottery_id}")
        return []

    results = []
    years_needed = list(range(from_date.year, to_date.year + 1))

    async with httpx.AsyncClient(headers=HEADERS, timeout=30, follow_redirects=True) as client:
        for year in years_needed:
            url = url_template.format(year=year)
            try:
                resp = await client.get(url)
                if resp.status_code == 404:
                    logger.info(f"No data for year {year}: {url}")
                    continue
                if resp.status_code == 403:
                    logger.warning(f"lotto.net: Access denied (403) for {lottery_id} year {year}")
                    _mark_403('lotto.net')
                    break
                if resp.status_code != 200:
                    logger.warning(f"Failed to fetch {url}: {resp.status_code}")
                    continue

                soup = BeautifulSoup(resp.text, "lxml")
                draws = _parse_lotto_net_archive_items(soup, lottery_id, lottery_name, state, from_date, to_date)
                results.extend(draws)
                logger.info(f"Scraped {len(draws)} draws for {lottery_id} year {year}")
                _clear_errors('lotto.net')  # success — reset error counter

                # Be polite - delay between requests
                if len(years_needed) > 1:
                    await asyncio.sleep(0.6)

            except Exception as e:
                logger.error(f"Error scraping {url}: {e}")
                _mark_error('lotto.net')

    return sorted(results, key=lambda x: x.get("Date", ""), reverse=True)


# ── lottery.net game URL map (multi-state) ──
# Covers CA, AZ and any other state using lottery.net year-based archives.
# URL pattern: https://lottery.net/{state}/{game}/numbers/{year}
LOTTERY_NET_CA_URL_MAP = {
    # California
    "ca_daily3":         "https://lottery.net/california/daily-3-evening/numbers/{year}",
    "ca_midday3":        "https://lottery.net/california/daily-3-midday/numbers/{year}",
    "ca_daily4":         "https://lottery.net/california/daily-4/numbers/{year}",
    "ca_fantasy5":       "https://lottery.net/california/fantasy-5/numbers/{year}",
    "ca_superlotto_plus":"https://lottery.net/california/superlotto-plus/numbers/{year}",
    # Arizona
    "az_pick3":          "https://lottery.net/arizona/pick-3/numbers/{year}",
    "az_fantasy5":       "https://lottery.net/arizona/fantasy-5/numbers/{year}",
    # Arkansas
    "ar_cash3":          "https://lottery.net/arkansas/cash-3-evening/numbers/{year}",
    "ar_cash3_midday":   "https://lottery.net/arkansas/cash-3-midday/numbers/{year}",
    "ar_natural_state_jackpot": "https://lottery.net/arkansas/natural-state-jackpot/numbers/{year}",
    # Colorado
    "co_pick3":          "https://lottery.net/colorado/pick-3/numbers/{year}",
    "co_cash5":          "https://lottery.net/colorado/cash-5/numbers/{year}",
    "co_lotto":          "https://lottery.net/colorado/lotto-plus/numbers/{year}",
    # Connecticut
    "ct_play3":          "https://lottery.net/connecticut/play-3/numbers/{year}",
    "ct_play4":          "https://lottery.net/connecticut/play-4/numbers/{year}",
    "ct_cash5":          "https://lottery.net/connecticut/cash-5/numbers/{year}",
    "ct_lotto":          "https://lottery.net/connecticut/lotto/numbers/{year}",
    # DC
    "dc_lottery":        "https://lottery.net/district-of-columbia/dc-4/numbers/{year}",
    # Delaware (Day & Night draws)
    "de_play3_day":      "https://lottery.net/delaware/play-3-day/numbers/{year}",
    "de_play3_night":    "https://lottery.net/delaware/play-3-night/numbers/{year}",
    "de_play4_day":      "https://lottery.net/delaware/play-4-day/numbers/{year}",
    "de_play4_night":    "https://lottery.net/delaware/play-4-night/numbers/{year}",
    "de_play5_day":      "https://lottery.net/delaware/play-5-day/numbers/{year}",
    "de_play5_night":    "https://lottery.net/delaware/play-5-night/numbers/{year}",
    "de_multi_win":      "https://lottery.net/delaware/multi-win-lotto/numbers/{year}",
    # Florida  (Pick 3/4/5 have Fireball as extra ball; Cash4Life has Cash_Ball)
    "fl_fantasy5":       "https://lottery.net/florida/fantasy-5/numbers/{year}",
    "fl_pick3":          "https://lottery.net/florida/pick-3-evening/numbers/{year}",
    "fl_pick3_midday":   "https://lottery.net/florida/pick-3-midday/numbers/{year}",
    "fl_pick4":          "https://lottery.net/florida/pick-4-evening/numbers/{year}",
    "fl_pick4_midday":   "https://lottery.net/florida/pick-4-midday/numbers/{year}",
    "fl_pick5":          "https://lottery.net/florida/pick-5-evening/numbers/{year}",
    "fl_pick5_midday":   "https://lottery.net/florida/pick-5-midday/numbers/{year}",
    "fl_cash4life":      "https://lottery.net/florida/cash-4-life/numbers/{year}",
    # Georgia (ga_jumbo_bucks not on lottery.net – removed)
    "ga_cash3":          "https://lottery.net/georgia/cash-3-evening/numbers/{year}",
    "ga_cash3_midday":   "https://lottery.net/georgia/cash-3-midday/numbers/{year}",
    "ga_cash3_night":    "https://lottery.net/georgia/cash-3-night/numbers/{year}",
    "ga_cash4":          "https://lottery.net/georgia/cash-4-evening/numbers/{year}",
    "ga_cash4_midday":   "https://lottery.net/georgia/cash-4-midday/numbers/{year}",
    "ga_cash4_night":    "https://lottery.net/georgia/cash-4-night/numbers/{year}",
    "ga_fantasy5":       "https://lottery.net/georgia/fantasy-5/numbers/{year}",
    "ga_five_evening":   "https://lottery.net/georgia/five-evening/numbers/{year}",
    "ga_five_midday":    "https://lottery.net/georgia/five-midday/numbers/{year}",
    "ga_cash_pop":       "https://lottery.net/georgia/cash-pop/numbers/{year}",
    # Illinois (il_pick4/lucky-day-lotto → 404; midday variants missing)
    "il_pick3_evening":           "https://lottery.net/illinois/pick-3-evening/numbers/{year}",
    "il_pick3_midday":            "https://lottery.net/illinois/pick-3-midday/numbers/{year}",
    "il_pick4_evening":           "https://lottery.net/illinois/pick-4-evening/numbers/{year}",
    "il_pick4_midday":            "https://lottery.net/illinois/pick-4-midday/numbers/{year}",
    "il_lucky_day_lotto_evening": "https://lottery.net/illinois/lucky-day-lotto-evening/numbers/{year}",
    "il_lucky_day_lotto_midday":  "https://lottery.net/illinois/lucky-day-lotto-midday/numbers/{year}",
    "il_lotto":                   "https://lottery.net/illinois/lotto/numbers/{year}",
    "il_hotwins":                 "https://lottery.net/illinois/hotwins/numbers/{year}",
    # Indiana
    "in_daily3":         "https://lottery.net/indiana/daily-3-evening/numbers/{year}",
    "in_daily3_midday":  "https://lottery.net/indiana/daily-3-midday/numbers/{year}",
    "in_daily4":         "https://lottery.net/indiana/daily-4/numbers/{year}",
    "in_cash5":          "https://lottery.net/indiana/cash-5/numbers/{year}",
    "in_hoosier_lotto":  "https://lottery.net/indiana/hoosier-lotto/numbers/{year}",
    # Iowa
    "ia_pick3_evening": "https://lottery.net/iowa/pick-3-evening/numbers/{year}",
    "ia_pick3_midday":  "https://lottery.net/iowa/pick-3-midday/numbers/{year}",
    "ia_pick4_evening": "https://lottery.net/iowa/pick-4-evening/numbers/{year}",
    "ia_pick4_midday":  "https://lottery.net/iowa/pick-4-midday/numbers/{year}",
    # Idaho (id_pick3/pick-3 → 404; id_weekly_grand → redirects to homepage – removed)
    "id_pick3_day":   "https://lottery.net/idaho/pick-3-day/numbers/{year}",
    "id_pick3_night": "https://lottery.net/idaho/pick-3-night/numbers/{year}",
    "id_pick4_day":   "https://lottery.net/idaho/pick-4-day/numbers/{year}",
    "id_pick4_night": "https://lottery.net/idaho/pick-4-night/numbers/{year}",
    "id_cash":        "https://lottery.net/idaho/cash/numbers/{year}",
    # Kansas (ks_pick3/pick-3->404, super-kansas-cash->404; keno not on lottery.net)
    "ks_pick3_evening":  "https://lottery.net/kansas/pick-3-evening/numbers/{year}",
    "ks_pick3_midday":   "https://lottery.net/kansas/pick-3-midday/numbers/{year}",
    "ks_super_cash":     "https://lottery.net/kansas/super-cash/numbers/{year}",
    # Kentucky (pick-3/4->404; keno not on lottery.net; added midday, cash-ball, cash-pop)
    "ky_pick3_evening":  "https://lottery.net/kentucky/pick-3-evening/numbers/{year}",
    "ky_pick3_midday":   "https://lottery.net/kentucky/pick-3-midday/numbers/{year}",
    "ky_pick4_evening":  "https://lottery.net/kentucky/pick-4-evening/numbers/{year}",
    "ky_pick4_midday":   "https://lottery.net/kentucky/pick-4-midday/numbers/{year}",
    "ky_cash_ball":      "https://lottery.net/kentucky/cash-ball/numbers/{year}",
    "ky_cash_pop":       "https://lottery.net/kentucky/cash-pop/numbers/{year}",
    # Louisiana
    "la_pick3":          "https://lottery.net/louisiana/pick-3/numbers/{year}",
    "la_pick4":          "https://lottery.net/louisiana/pick-4/numbers/{year}",
    "la_pick5":          "https://lottery.net/louisiana/pick-5/numbers/{year}",
    "la_easy5":          "https://lottery.net/louisiana/easy-5/numbers/{year}",
    "la_lotto":          "https://lottery.net/louisiana/lotto/numbers/{year}",
    # Massachusetts
    "ma_numbers":          "https://lottery.net/massachusetts/numbers-evening/numbers/{year}",
    "ma_numbers_midday":   "https://lottery.net/massachusetts/numbers-midday/numbers/{year}",
    "ma_masscash":         "https://lottery.net/massachusetts/mass-cash/numbers/{year}",
    "ma_megabucks_doubler":"https://lottery.net/massachusetts/megabucks/numbers/{year}",
    # Maryland
    "md_pick3":          "https://lottery.net/maryland/pick-3-evening/numbers/{year}",
    "md_pick3_midday":   "https://lottery.net/maryland/pick-3-midday/numbers/{year}",
    "md_pick4":          "https://lottery.net/maryland/pick-4-evening/numbers/{year}",
    "md_pick4_midday":   "https://lottery.net/maryland/pick-4-midday/numbers/{year}",
    "md_pick5":          "https://lottery.net/maryland/pick-5-evening/numbers/{year}",
    "md_pick5_midday":   "https://lottery.net/maryland/pick-5-midday/numbers/{year}",
    "md_multimatch":     "https://lottery.net/maryland/multi-match/numbers/{year}",
    "md_cash4life":      "https://lottery.net/cash-4-life/numbers/{year}",
    # Maine  (Tri-State game; lottery.net uses -evening suffix for pick games;
    #         Megabucks Plus is listed as plain 'megabucks' on lottery.net)
    "me_pick3":          "https://lottery.net/maine/pick-3-evening/numbers/{year}",
    "me_pick4":          "https://lottery.net/maine/pick-4-evening/numbers/{year}",
    "me_megabucks_plus": "https://lottery.net/maine/megabucks/numbers/{year}",
    # Michigan
    "mi_daily3":         "https://lottery.net/michigan/daily-3-evening/numbers/{year}",
    "mi_daily3_midday":  "https://lottery.net/michigan/daily-3-midday/numbers/{year}",
    "mi_daily4":         "https://lottery.net/michigan/daily-4-evening/numbers/{year}",
    "mi_daily4_midday":  "https://lottery.net/michigan/daily-4-midday/numbers/{year}",
    "mi_fantasy5":       "https://lottery.net/michigan/fantasy-5/numbers/{year}",
    "mi_keno":           "https://lottery.net/michigan/keno/numbers/{year}",
    # Minnesota
    "mn_pick3":          "https://lottery.net/minnesota/pick-3/numbers/{year}",
    "mn_northstar_cash": "https://lottery.net/minnesota/northstar-cash/numbers/{year}",
    "mn_gopher5":        "https://lottery.net/minnesota/gopher-5/numbers/{year}",
    # Missouri
    "mo_pick3":          "https://lottery.net/missouri/pick-3/numbers/{year}",
    "mo_pick4":          "https://lottery.net/missouri/pick-4/numbers/{year}",
    "mo_show_me_cash":   "https://lottery.net/missouri/show-me-cash/numbers/{year}",
    # Mississippi
    "ms_cash3":          "https://lottery.net/mississippi/cash-3-evening/numbers/{year}",
    "ms_cash3_midday":   "https://lottery.net/mississippi/cash-3-midday/numbers/{year}",
    "ms_cash4":          "https://lottery.net/mississippi/cash-4-evening/numbers/{year}",
    "ms_cash4_midday":   "https://lottery.net/mississippi/cash-4-midday/numbers/{year}",
    # Montana
    "mt_montana_cash":   "https://lottery.net/montana/montana-cash/numbers/{year}",
    # North Carolina
    "nc_pick3":          "https://lottery.net/north-carolina/pick-3-evening/numbers/{year}",
    "nc_pick3_midday":   "https://lottery.net/north-carolina/pick-3-midday/numbers/{year}",
    "nc_pick4":          "https://lottery.net/north-carolina/pick-4-evening/numbers/{year}",
    "nc_pick4_midday":   "https://lottery.net/north-carolina/pick-4-midday/numbers/{year}",
    "nc_cash5":          "https://lottery.net/north-carolina/cash-5/numbers/{year}",
    # North Dakota
    "nd_2by2":           "https://lottery.net/north-dakota/2by2/numbers/{year}",
    # Nebraska
    "ne_pick3":          "https://lottery.net/nebraska/pick-3/numbers/{year}",
    "ne_pick5":          "https://lottery.net/nebraska/pick-5/numbers/{year}",
    # New Hampshire  (Tri-State game; pick-3/4 require -evening suffix)
    "nh_pick3":          "https://lottery.net/new-hampshire/pick-3-evening/numbers/{year}",
    "nh_pick4":          "https://lottery.net/new-hampshire/pick-4-evening/numbers/{year}",
    "nh_gimme5":         "https://lottery.net/new-hampshire/gimme-5/numbers/{year}",
    # New Jersey
    "nj_pick3":          "https://lottery.net/new-jersey/pick-3-evening/numbers/{year}",
    "nj_pick3_midday":   "https://lottery.net/new-jersey/pick-3-midday/numbers/{year}",
    "nj_pick4":          "https://lottery.net/new-jersey/pick-4-evening/numbers/{year}",
    "nj_pick4_midday":   "https://lottery.net/new-jersey/pick-4-midday/numbers/{year}",
    "nj_cash4life":      "https://lottery.net/cash-4-life/numbers/{year}",
    # New Mexico
    "nm_pick3":          "https://lottery.net/new-mexico/pick-3/numbers/{year}",
    "nm_roadrunner_cash":"https://lottery.net/new-mexico/roadrunner-cash/numbers/{year}",
    # Ohio
    "oh_pick3":          "https://lottery.net/ohio/pick-3-evening/numbers/{year}",
    "oh_pick3_midday":   "https://lottery.net/ohio/pick-3-midday/numbers/{year}",
    "oh_pick4":          "https://lottery.net/ohio/pick-4-evening/numbers/{year}",
    "oh_pick4_midday":   "https://lottery.net/ohio/pick-4-midday/numbers/{year}",
    "oh_pick5":          "https://lottery.net/ohio/pick-5/numbers/{year}",
    "oh_rolling_cash5":  "https://lottery.net/ohio/rolling-cash-5/numbers/{year}",
    "oh_classic_lotto":  "https://lottery.net/ohio/classic-lotto/numbers/{year}",
    # Oklahoma
    "ok_pick3":          "https://lottery.net/oklahoma/pick-3/numbers/{year}",
    "ok_cash5":          "https://lottery.net/oklahoma/cash-5/numbers/{year}",
    # Oregon
    "or_pick4":          "https://lottery.net/oregon/pick-4/numbers/{year}",
    "or_win_for_life":   "https://lottery.net/oregon/win-for-life/numbers/{year}",
    # Pennsylvania (pick-3/4/5 – only -evening and -day variants exist on lottery.net;
    #               plain /pick-3/ and /pick-4/ return 404)
    "pa_pick2":          "https://lottery.net/pennsylvania/pick-2/numbers/{year}",
    "pa_pick3":          "https://lottery.net/pennsylvania/pick-3-evening/numbers/{year}",
    "pa_pick3_day":      "https://lottery.net/pennsylvania/pick-3-day/numbers/{year}",
    "pa_pick3_evening":  "https://lottery.net/pennsylvania/pick-3-evening/numbers/{year}",
    "pa_pick3_midday":   "https://lottery.net/pennsylvania/pick-3-day/numbers/{year}",
    "pa_pick4":          "https://lottery.net/pennsylvania/pick-4-evening/numbers/{year}",
    "pa_pick4_day":      "https://lottery.net/pennsylvania/pick-4-day/numbers/{year}",
    "pa_pick4_evening":  "https://lottery.net/pennsylvania/pick-4-evening/numbers/{year}",
    "pa_pick4_midday":   "https://lottery.net/pennsylvania/pick-4-day/numbers/{year}",
    "pa_pick5":          "https://lottery.net/pennsylvania/pick-5/numbers/{year}",
    "pa_cash5":          "https://lottery.net/pennsylvania/cash-5/numbers/{year}",
    "pa_match6":         "https://lottery.net/pennsylvania/match-6/numbers/{year}",
    "pa_cash4life":      "https://lottery.net/cash-4-life/numbers/{year}",
    # Rhode Island
    "ri_numbers":        "https://lottery.net/rhode-island/the-numbers/numbers/{year}",
    "ri_wild_money":     "https://lottery.net/rhode-island/wild-money/numbers/{year}",
    # South Carolina
    "sc_pick3":          "https://lottery.net/south-carolina/pick-3/numbers/{year}",
    "sc_pick4":          "https://lottery.net/south-carolina/pick-4/numbers/{year}",
    "sc_palmetto_cash5": "https://lottery.net/south-carolina/palmetto-cash-5/numbers/{year}",
    # South Dakota
    "sd_pick3":          "https://lottery.net/south-dakota/pick-3/numbers/{year}",
    "sd_dakota_cash":    "https://lottery.net/south-dakota/dakota-cash/numbers/{year}",
    # Tennessee (cash-3 has midday+evening; pick-3/4 generic URL contains all draws)
    "tn_pick3":          "https://lottery.net/tennessee/pick-3/numbers/{year}",
    "tn_cash3_evening":  "https://lottery.net/tennessee/cash-3-evening/numbers/{year}",
    "tn_cash3_midday":   "https://lottery.net/tennessee/cash-3-midday/numbers/{year}",
    "tn_pick4":          "https://lottery.net/tennessee/pick-4/numbers/{year}",
    "tn_tennessee_cash": "https://lottery.net/tennessee/tennessee-cash/numbers/{year}",
    "tn_cash4life":      "https://lottery.net/cash-4-life/numbers/{year}",
    # Texas
    "tx_pick3":          "https://lottery.net/texas/pick-3/numbers/{year}",
    "tx_daily4":         "https://lottery.net/texas/daily-4/numbers/{year}",
    "tx_cash5":          "https://lottery.net/texas/cash-5/numbers/{year}",
    "tx_texas_two_step": "https://lottery.net/texas/texas-two-step/numbers/{year}",
    "tx_all_or_nothing": "https://lottery.net/texas/all-or-nothing/numbers/{year}",
    # Vermont  (Tri-State game; pick-3/4 require -evening suffix)
    "vt_pick3":          "https://lottery.net/vermont/pick-3-evening/numbers/{year}",
    "vt_pick4":          "https://lottery.net/vermont/pick-4-evening/numbers/{year}",
    "vt_gimme5":         "https://lottery.net/vermont/gimme-5/numbers/{year}",
    # Virginia (Pick 3/4 have Fireball; Cash5 is 5-ball; Cash4Life is multi-state;
    #           -night and -evening are both valid slugs; prefer -evening for consistency)
    "va_cash5":          "https://lottery.net/virginia/cash-5/numbers/{year}",
    "va_pick3":          "https://lottery.net/virginia/pick-3-evening/numbers/{year}",
    "va_pick3_day":      "https://lottery.net/virginia/pick-3-day/numbers/{year}",
    "va_pick4":          "https://lottery.net/virginia/pick-4-evening/numbers/{year}",
    "va_pick4_day":      "https://lottery.net/virginia/pick-4-day/numbers/{year}",
    "va_cash4life":      "https://lottery.net/cash-4-life/numbers/{year}",
    # Washington
    "wa_daily_game":     "https://lottery.net/washington/daily-game/numbers/{year}",
    "wa_hit5":           "https://lottery.net/washington/hit-5/numbers/{year}",
    "wa_match4":         "https://lottery.net/washington/match-4/numbers/{year}",
    # Wisconsin
    "wi_pick3":          "https://lottery.net/wisconsin/pick-3/numbers/{year}",
    "wi_pick4":          "https://lottery.net/wisconsin/pick-4/numbers/{year}",
    "wi_badger5":        "https://lottery.net/wisconsin/badger-5/numbers/{year}",
    "wi_supercash":      "https://lottery.net/wisconsin/supercash/numbers/{year}",
    # West Virginia
    "wv_daily3":         "https://lottery.net/west-virginia/daily-3/numbers/{year}",
    "wv_daily4":         "https://lottery.net/west-virginia/daily-4/numbers/{year}",
    "wv_cash25":         "https://lottery.net/west-virginia/cash-25/numbers/{year}",
    # Wyoming
    "wy_cowboy_draw":    "https://lottery.net/wyoming/cowboy-draw/numbers/{year}",
    # New York (fallback when NY Open Data returns 403)
    "ny_take5":          "https://lottery.net/new-york/take-5/numbers/{year}",
    "ny_take5_midday":   "https://lottery.net/new-york/take-5-midday/numbers/{year}",
    "ny_numbers":        "https://lottery.net/new-york/numbers-evening/numbers/{year}",
    "ny_numbers_midday": "https://lottery.net/new-york/numbers-midday/numbers/{year}",
    "ny_win4":           "https://lottery.net/new-york/win-4-evening/numbers/{year}",
    "ny_win4_midday":    "https://lottery.net/new-york/win-4-midday/numbers/{year}",
    "ny_lotto":          "https://lottery.net/new-york/lotto/numbers/{year}",
    "ny_cash4life":      "https://lottery.net/cash-4-life/numbers/{year}",
    "ny_pick10":         "https://lottery.net/new-york/pick-10/numbers/{year}",
}

# Number of digits per ball for each game (used as fallback when <li> parsing fails)
LOTTERY_NET_CA_BALL_DIGITS = {
    # California
    "ca_daily3":         1,   # "743"      -> [7, 4, 3]
    "ca_midday3":        1,   # "279"      -> [2, 7, 9]
    "ca_daily4":         1,   # "7703"     -> [7, 7, 0, 3]
    "ca_fantasy5":       2,   # parsed via <li> – variable width
    "ca_superlotto_plus":2,
    # Arizona
    "az_pick3":          1,
    "az_fantasy5":       2,
    # Arkansas
    "ar_cash3":          1,   # 3-ball pick (digits 0-9)
    "ar_cash3_midday":   1,
    "ar_natural_state_jackpot": 2,  # 5-ball game (numbers 1-39)
    # Colorado
    "co_pick3":          1,
    "co_cash5":          2,
    "co_lotto":          2,
    # Connecticut
    "ct_play3":          1,
    "ct_play4":          1,
    "ct_cash5":          2,
    "ct_lotto":          2,
    # DC
    "dc_lottery":        1,
    # Delaware (Day & Night; Play 3/4/5 = single digits 0-9; Multi Win = 2-digit)
    "de_play3_day":      1,
    "de_play3_night":    1,
    "de_play4_day":      1,
    "de_play4_night":    1,
    "de_play5_day":      1,
    "de_play5_night":    1,
    "de_multi_win":      2,
    # Florida – all parsed via <li> elements
    "fl_fantasy5":       2,
    "fl_pick3":          1,
    "fl_pick3_midday":   1,
    "fl_pick4":          1,
    "fl_pick4_midday":   1,
    "fl_pick5":          1,
    "fl_pick5_midday":   1,
    "fl_cash4life":      2,
    # Georgia
    "ga_cash3":          1,
    "ga_cash3_midday":   1,
    "ga_cash3_night":    1,
    "ga_cash4":          1,
    "ga_cash4_midday":   1,
    "ga_cash4_night":    1,
    "ga_fantasy5":       2,
    "ga_five_evening":   1,
    "ga_five_midday":    1,
    "ga_cash_pop":       2,
    # Illinois
    "il_pick3_evening":           1,
    "il_pick3_midday":            1,
    "il_pick4_evening":           1,
    "il_pick4_midday":            1,
    "il_lucky_day_lotto_evening": 2,
    "il_lucky_day_lotto_midday":  2,
    "il_lotto":                   2,
    "il_hotwins":                 2,
    # Indiana
    "in_daily3":         1,
    "in_daily3_midday":  1,
    "in_daily4":         1,
    "in_cash5":          2,
    "in_hoosier_lotto":  2,
    # Iowa
    "ia_pick3_evening": 1,
    "ia_pick3_midday":  1,
    "ia_pick4_evening": 1,
    "ia_pick4_midday":  1,
    # Idaho
    "id_pick3_day":   1,
    "id_pick3_night": 1,
    "id_pick4_day":   1,
    "id_pick4_night": 1,
    "id_cash":        2,
    # Kansas
    "ks_pick3_evening":  1,
    "ks_pick3_midday":   1,
    "ks_super_cash":     2,
    # Kentucky
    "ky_pick3_evening":  1,
    "ky_pick3_midday":   1,
    "ky_pick4_evening":  1,
    "ky_pick4_midday":   1,
    "ky_cash_ball":      2,
    "ky_cash_pop":       2,
    # Louisiana
    "la_pick3":          1,
    "la_pick4":          1,
    "la_pick5":          1,
    "la_easy5":          2,
    "la_lotto":          2,
    # Massachusetts
    "ma_numbers":        1,
    "ma_numbers_midday": 1,
    "ma_masscash":       2,
    "ma_megabucks_doubler":2,
    # Maryland
    "md_pick3":          1,
    "md_pick3_midday":   1,
    "md_pick4":          1,
    "md_pick4_midday":   1,
    "md_pick5":          1,
    "md_pick5_midday":   1,
    "md_multimatch":     2,
    "md_cash4life":      2,
    # Maine
    "me_pick3":          1,
    "me_pick4":          1,
    "me_megabucks_plus": 2,
    # Michigan
    "mi_daily3":         1,
    "mi_daily3_midday":  1,
    "mi_daily4":         1,
    "mi_daily4_midday":  1,
    "mi_fantasy5":       2,
    "mi_keno":           2,
    # Minnesota
    "mn_pick3":          1,
    "mn_northstar_cash": 2,
    "mn_gopher5":        2,
    # Missouri
    "mo_pick3":          1,
    "mo_pick4":          1,
    "mo_show_me_cash":   2,
    # Mississippi
    "ms_cash3":          1,
    "ms_cash3_midday":   1,
    "ms_cash4":          1,
    "ms_cash4_midday":   1,
    # Montana
    "mt_montana_cash":   2,
    # North Carolina
    "nc_pick3":          1,
    "nc_pick3_midday":   1,
    "nc_pick4":          1,
    "nc_pick4_midday":   1,
    "nc_cash5":          2,
    # North Dakota
    "nd_2by2":           2,
    # Nebraska
    "ne_pick3":          1,
    "ne_pick5":          2,
    # New Hampshire
    "nh_pick3":          1,
    "nh_pick4":          1,
    "nh_gimme5":         2,
    # New Jersey
    "nj_pick3":          1,
    "nj_pick3_midday":   1,
    "nj_pick4":          1,
    "nj_pick4_midday":   1,
    "nj_cash4life":      2,
    # New Mexico
    "nm_pick3":          1,
    "nm_roadrunner_cash":2,
    # Ohio
    "oh_pick3":          1,
    "oh_pick3_midday":   1,
    "oh_pick4":          1,
    "oh_pick4_midday":   1,
    "oh_pick5":          1,
    "oh_rolling_cash5":  2,
    "oh_classic_lotto":  2,
    # Oklahoma
    "ok_pick3":          1,
    "ok_cash5":          2,
    # Oregon
    "or_pick4":          1,
    "or_win_for_life":   2,
    # Pennsylvania
    "pa_pick2":          1,
    "pa_pick3":          1,
    "pa_pick3_day":      1,
    "pa_pick3_evening":  1,
    "pa_pick3_midday":   1,
    "pa_pick4":          1,
    "pa_pick4_day":      1,
    "pa_pick4_evening":  1,
    "pa_pick4_midday":   1,
    "pa_pick5":          1,
    "pa_cash5":          2,
    "pa_match6":         2,
    "pa_cash4life":      2,
    # Rhode Island
    "ri_numbers":        1,
    "ri_wild_money":     2,
    # South Carolina
    "sc_pick3":          1,
    "sc_pick4":          1,
    "sc_palmetto_cash5": 2,
    # South Dakota
    "sd_pick3":          1,
    "sd_dakota_cash":    2,
    # Tennessee
    "tn_pick3":          1,
    "tn_cash3_evening":  1,
    "tn_cash3_midday":   1,
    "tn_pick4":          1,
    "tn_tennessee_cash": 2,
    "tn_cash4life":      2,
    # Texas
    "tx_pick3":          1,
    "tx_daily4":         1,
    "tx_cash5":          2,
    "tx_texas_two_step": 2,
    "tx_all_or_nothing": 2,
    # Vermont
    "vt_pick3":          1,
    "vt_pick4":          1,
    "vt_gimme5":         2,
    # Virginia
    "va_cash5":          2,
    "va_pick3":          1,
    "va_pick3_day":      1,
    "va_pick4":          1,
    "va_pick4_day":      1,
    "va_cash4life":      2,
    # Washington
    "wa_daily_game":     1,
    "wa_hit5":           2,
    "wa_match4":         2,
    # Wisconsin
    "wi_pick3":          1,
    "wi_pick4":          1,
    "wi_badger5":        2,
    "wi_supercash":      2,
    # West Virginia
    "wv_daily3":         1,
    "wv_daily4":         1,
    "wv_cash25":         2,
    # Wyoming
    "wy_cowboy_draw":    2,
    # New York (lottery.net fallback)
    "ny_take5":          2,   # 5-ball, numbers 1-39
    "ny_take5_midday":   2,
    "ny_numbers":        1,   # 3-ball pick (digits 0-9)
    "ny_numbers_midday": 1,
    "ny_win4":           1,   # 4-ball pick
    "ny_win4_midday":    1,
    "ny_lotto":          2,   # 6-ball lotto
    "ny_cash4life":      2,   # 5-ball + cash ball
    "ny_pick10":         2,   # 20-ball keno-style
}

# Games where lottery.net uses 2-column table (Date, Numbers) instead of
# 3-column (Date, Draw#, Numbers) — numbers cell is at index 1 not 2
# AZ, CA, and most other states use the 3-column layout
# FL, VA, AR, NY, and many other states use the 2-column layout
LOTTERY_NET_TWO_COL_GAMES = {
    # Florida
    "fl_fantasy5", "fl_pick3", "fl_pick3_midday",
    "fl_pick4", "fl_pick4_midday",
    "fl_pick5", "fl_pick5_midday",
    # Arkansas
    "ar_cash3", "ar_cash3_midday", "ar_natural_state_jackpot",
    # Colorado
    "co_pick3", "co_cash5", "co_lotto",
    # Connecticut
    "ct_play3", "ct_play4", "ct_cash5", "ct_lotto",
    # DC
    "dc_lottery",
    # Delaware
    "de_play3_day", "de_play3_night",
    "de_play4_day", "de_play4_night",
    "de_play5_day", "de_play5_night",
    "de_multi_win",
    # Georgia
    "ga_cash3", "ga_cash3_midday", "ga_cash3_night",
    "ga_cash4", "ga_cash4_midday", "ga_cash4_night",
    "ga_fantasy5", "ga_five_evening", "ga_five_midday", "ga_cash_pop",
    # Illinois (pick3/4 are 3-col NOT two-col; il_lotto/lucky-day are 2-col; il_hotwins is 3-col)
    "il_lucky_day_lotto_evening", "il_lucky_day_lotto_midday",
    "il_lotto",
    # Indiana
    "in_daily3", "in_daily3_midday", "in_daily4", "in_cash5", "in_hoosier_lotto",
    # Iowa (2-col, single-digit)
    "ia_pick3_evening", "ia_pick3_midday",
    "ia_pick4_evening", "ia_pick4_midday",
    # Idaho
    "id_pick3_day", "id_pick3_night",
    "id_pick4_day", "id_pick4_night",
    "id_cash",
    # Kansas
    "ks_pick3_evening", "ks_pick3_midday",
    "ks_super_cash",
    # Kentucky
    "ky_pick3_evening", "ky_pick3_midday",
    "ky_pick4_evening", "ky_pick4_midday",
    "ky_cash_ball", "ky_cash_pop",
    # Louisiana
    "la_pick3", "la_pick4", "la_pick5", "la_easy5", "la_lotto",
    # Massachusetts — mass-cash and megabucks are 3-col; only numbers games are 2-col
    "ma_numbers", "ma_numbers_midday",
    # Maryland
    "md_pick3", "md_pick3_midday",
    "md_pick4", "md_pick4_midday",
    "md_pick5", "md_pick5_midday",
    "md_multimatch", "md_cash4life",
    # Maine
    "me_pick3", "me_pick4", "me_megabucks_plus",
    # Michigan — daily3/4 are 2-col; fantasy5 is 2-col but Double Play needs ball-cap
    "mi_daily3", "mi_daily3_midday",
    "mi_daily4", "mi_daily4_midday",
    "mi_fantasy5",
    # Minnesota
    "mn_pick3", "mn_northstar_cash", "mn_gopher5",
    # Missouri
    "mo_pick3", "mo_pick4", "mo_show_me_cash",
    # Mississippi
    "ms_cash3", "ms_cash3_midday",
    "ms_cash4", "ms_cash4_midday",
    # Montana
    "mt_montana_cash",
    # North Carolina
    "nc_pick3", "nc_pick3_midday",
    "nc_pick4", "nc_pick4_midday", "nc_cash5",
    # North Dakota
    "nd_2by2",
    # Nebraska
    "ne_pick3", "ne_pick5",
    # New Hampshire
    "nh_pick3", "nh_pick4", "nh_gimme5",
    # New Jersey
    "nj_pick3", "nj_pick3_midday",
    "nj_pick4", "nj_pick4_midday", "nj_cash4life",
    # New Mexico
    "nm_pick3", "nm_roadrunner_cash",
    # Ohio
    "oh_pick3", "oh_pick3_midday",
    "oh_pick4", "oh_pick4_midday",
    "oh_pick5", "oh_rolling_cash5", "oh_classic_lotto",
    # Oklahoma
    "ok_pick3", "ok_cash5",
    # Oregon
    "or_pick4", "or_win_for_life",
    # Pennsylvania
    "pa_pick2", "pa_pick3", "pa_pick3_day", "pa_pick3_evening", "pa_pick3_midday",
    "pa_pick4", "pa_pick4_day", "pa_pick4_evening", "pa_pick4_midday",
    "pa_pick5", "pa_cash5", "pa_match6", "pa_cash4life",
    # Rhode Island
    "ri_numbers", "ri_wild_money",
    # South Carolina
    "sc_pick3", "sc_pick4", "sc_palmetto_cash5",
    # South Dakota
    "sd_pick3", "sd_dakota_cash",
    # Tennessee
    "tn_pick3", "tn_cash3_evening", "tn_cash3_midday",
    "tn_pick4", "tn_tennessee_cash", "tn_cash4life",
    # Texas
    "tx_pick3", "tx_daily4", "tx_cash5", "tx_texas_two_step", "tx_all_or_nothing",
    # Vermont
    "vt_pick3", "vt_pick4", "vt_gimme5",
    # Virginia
    "va_cash5", "va_pick3", "va_pick3_day",
    "va_pick4", "va_pick4_day",
    # Washington
    "wa_daily_game", "wa_hit5", "wa_match4",
    # Wisconsin
    "wi_pick3", "wi_pick4", "wi_badger5", "wi_supercash",
    # West Virginia
    "wv_daily3", "wv_daily4", "wv_cash25",
    # Wyoming
    "wy_cowboy_draw",
    # NY games on lottery.net use 2-col layout
    "ny_take5", "ny_take5_midday",
    "ny_numbers", "ny_numbers_midday",
    "ny_win4", "ny_win4_midday",
    "ny_lotto", "ny_cash4life", "ny_pick10",
}


def _split_lottery_net_ca_numbers(nums_text: str, lottery_id: str) -> List[str]:
    """
    Split the concatenated number string from lottery.net CA pages.
    For pick games (daily3, daily4), numbers are single digits concatenated.
    For fantasy5/superlotto, numbers are 2-digit pairs concatenated.
    """
    nums_text = nums_text.strip()
    ball_digits = LOTTERY_NET_CA_BALL_DIGITS.get(lottery_id, 1)

    if ball_digits == 1:
        # "743" -> ["7","4","3"] - single digit per ball
        return [fmt_ball_single(c) for c in nums_text if c.isdigit()]
    else:
        # "1391121" for fantasy5: split every 2 chars
        # But need to handle variable-length: fantasy5 = 5 balls * 2 digits = 10 chars
        balls = []
        i = 0
        while i + 1 < len(nums_text):
            balls.append(fmt_ball(nums_text[i:i+2]))
            i += 2
        if i < len(nums_text):
            balls.append(fmt_ball(nums_text[i]))
        return balls


async def scrape_lottery_net_ca(lottery_id: str, lottery_name: str, state: str,
                                 from_date: date, to_date: date) -> List[Dict]:
    """
    Scrape lottery.net for California pick-game results (Daily 3, Daily 4,
    Midday 3, Fantasy 5, SuperLotto Plus).

    Source: https://lottery.net/california/
    URL pattern: https://lottery.net/california/{game}/numbers/{year}
    Table format: [Date, Draw#, Numbers] with 365-366 rows per year.
    """
    url_template = LOTTERY_NET_CA_URL_MAP.get(lottery_id)
    if not url_template:
        logger.warning(f"No lottery.net CA URL for lottery_id: {lottery_id}")
        return []

    # Skip if lottery.net recently returned 403
    if _is_403_blocked('lottery.net'):
        logger.debug(f"lottery.net 403-cached, skipping {lottery_id}")
        return []

    results = []
    years_needed = list(range(from_date.year, to_date.year + 1))

    async with httpx.AsyncClient(headers=HEADERS, timeout=8, follow_redirects=True) as client:
        for year in years_needed:
            url = url_template.format(year=year)
            try:
                # Retry up to 2 times with short backoff (total max ~20s)
                resp = None
                for attempt in range(2):
                    resp = await client.get(url)
                    if resp.status_code == 200:
                        break
                    if resp.status_code == 404:
                        break  # definitive — don't retry
                    if attempt < 2:
                        await asyncio.sleep(1.5 * (attempt + 1))

                if resp is None or resp.status_code == 404:
                    logger.info(f"lottery.net: No data for {lottery_id} year {year}")
                    continue
                if resp.status_code == 403:
                    logger.warning(f"lottery.net: Access denied (403) for {lottery_id} year {year} after retries")
                    _mark_403('lottery.net')
                    break  # stop trying more years for this session
                if resp.status_code != 200:
                    logger.warning(f"lottery.net: Failed {url}: {resp.status_code}")
                    continue

                soup = BeautifulSoup(resp.text, "lxml")
                tables = soup.find_all("table")
                if not tables:
                    logger.warning(f"lottery.net: No table found for {url}")
                    continue

                draws_this_year = 0
                # Some FL games use 2-col layout (Date, Numbers) instead of
                # 3-col (Date, Draw#, Numbers) — numbers are in col index 1
                two_col = lottery_id in LOTTERY_NET_TWO_COL_GAMES
                min_cells = 2 if two_col else 3
                num_col   = 1 if two_col else 2

                t = tables[0]
                rows = t.find_all("tr")
                for row in rows[1:]:  # skip header row
                    cells = row.find_all(["td", "th"])
                    if len(cells) < min_cells:
                        continue

                    # Col 0: date string like "WednesdayDecember 31, 2025"
                    # or "Tuesday - 10:30pmDecember 31, 2024" (NY Take5)
                    date_text = cells[0].get_text(strip=True)
                    # Remove leading day-of-week
                    date_clean = re.sub(
                        r'^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)',
                        '', date_text
                    ).strip()
                    # Remove time component if present: "- 10:30pm" or "- 2:30pm"
                    date_clean = re.sub(r'^-?\s*\d{1,2}:\d{2}[aApP][mM]', '', date_clean).strip()

                    try:
                        draw_date = datetime.strptime(date_clean, "%B %d, %Y").date()
                    except ValueError:
                        try:
                            draw_date = datetime.strptime(date_clean, "%B %d,%Y").date()
                        except ValueError:
                            continue

                    # Date-range filter
                    if draw_date > to_date:
                        continue
                    if draw_date < from_date:
                        continue

                    # Numbers cell: parse individual <li> elements
                    # lottery.net uses <li class="ball"> for main balls,
                    # <li class="mega-ball"> for SuperLotto mega,
                    # <li class="cash-ball"> for Cash4Life,
                    # <li class="fireball"> for FL Pick Fireball bonus.
                    num_cell = cells[num_col]
                    ball_lis     = num_cell.find_all("li", class_="ball")
                    mega_lis     = num_cell.find_all("li", class_="mega-ball")
                    cash_lis     = num_cell.find_all("li", class_="cash-ball")
                    fireball_lis = num_cell.find_all("li", class_="fireball")

                    def _li_val(li_elem) -> str:
                        t = li_elem.get_text(strip=True)
                        if not t.isdigit():
                            return ""
                        if lottery_id in SINGLE_DIGIT_GAMES:
                            return fmt_ball_single(t)
                        return fmt_ball(t)

                    if ball_lis:
                        balls = [v for li in ball_lis if (v := _li_val(li))]
                    else:
                        # Fallback: split concatenated text (1-digit-per-ball games)
                        nums_text = num_cell.get_text(strip=True)
                        balls = _split_lottery_net_ca_numbers(nums_text, lottery_id)

                    mega_val     = _li_val(mega_lis[0])     if mega_lis     else ""
                    cash_val     = _li_val(cash_lis[0])     if cash_lis     else ""
                    fireball_val = _li_val(fireball_lis[0]) if fireball_lis else ""

                    if not balls:
                        continue

                    row_dict: Dict[str, Any] = {
                        "Date": draw_date.strftime("%Y-%m-%d"),
                        "Lotto_Name": lottery_name,
                        "State": state,
                        "Lottery_ID": lottery_id,
                    }

                    # Map balls to named columns
                    # Helper: re-format ball using correct formatter for this game
                    _bf = fmt_ball_single if lottery_id in SINGLE_DIGIT_GAMES else fmt_ball

                    # ── Games with Fireball (FL Pick 3/4/5, VA Pick 3/4, MS Cash 3/4) ──
                    FIREBALL_PICK3 = {
                        "fl_pick3", "fl_pick3_midday",
                        "va_pick3", "va_pick3_day",
                        "il_pick3_evening", "il_pick3_midday",
                        "ms_cash3", "ms_cash3_midday",
                    }
                    FIREBALL_PICK4 = {
                        "fl_pick4", "fl_pick4_midday",
                        "va_pick4", "va_pick4_day",
                        "il_pick4_evening", "il_pick4_midday",
                        "ms_cash4", "ms_cash4_midday",
                    }
                    FIREBALL_PICK5 = {"fl_pick5", "fl_pick5_midday"}

                    # ── Cash4Life games (5 balls + Cash Ball) ──
                    CASH4LIFE_GAMES = {
                        "fl_cash4life", "va_cash4life", "ny_cash4life",
                        "nj_cash4life", "md_cash4life", "pa_cash4life",
                        "tn_cash4life",
                    }

                    # ── SuperLotto-style (5 balls + Mega bonus) ──
                    # me_megabucks_plus is Tri-State Megabucks: 5 main balls + Mega bonus ball
                    SUPERLOTTO_GAMES = {"ca_superlotto_plus", "me_megabucks_plus"}

                    # ── NY Pick 10 keno (20 balls), IL HotWins (20 balls) ──
                    PICK10_GAMES = {"ny_pick10", "il_hotwins"}

                    # ── NY Lotto (6-ball), IL Lotto (6-ball + extra-shot bonus), and other 6-ball games ──
                    SIX_BALL_GAMES = {"ny_lotto", "pa_match6", "il_lotto"}

                    if lottery_id in FIREBALL_PICK3:
                        # 3 main balls + optional Fireball — single digit each
                        for i, b in enumerate(balls[:3], 1):
                            row_dict[f"Ball_{i}"] = _bf(b)
                        if fireball_val:
                            row_dict["Fireball"] = fmt_ball_single(fireball_val)
                        elif len(balls) >= 4:
                            row_dict["Fireball"] = fmt_ball_single(balls[3])

                    elif lottery_id in FIREBALL_PICK4:
                        # 4 main balls + optional Fireball — single digit each
                        for i, b in enumerate(balls[:4], 1):
                            row_dict[f"Ball_{i}"] = _bf(b)
                        if fireball_val:
                            row_dict["Fireball"] = fmt_ball_single(fireball_val)
                        elif len(balls) >= 5:
                            row_dict["Fireball"] = fmt_ball_single(balls[4])

                    elif lottery_id in FIREBALL_PICK5:
                        # 5 main balls + optional Fireball — single digit each
                        for i, b in enumerate(balls[:5], 1):
                            row_dict[f"Ball_{i}"] = _bf(b)
                        if fireball_val:
                            row_dict["Fireball"] = fmt_ball_single(fireball_val)
                        elif len(balls) >= 6:
                            row_dict["Fireball"] = fmt_ball_single(balls[5])

                    elif lottery_id in CASH4LIFE_GAMES:
                        # 5 main balls + Cash Ball
                        for i, b in enumerate(balls[:5], 1):
                            row_dict[f"Ball_{i}"] = _bf(b)
                        row_dict["Cash_Ball"] = cash_val or (balls[5] if len(balls) >= 6 else "")

                    elif lottery_id in SUPERLOTTO_GAMES:
                        # 5 main balls + Mega bonus
                        for i, b in enumerate(balls[:5], 1):
                            row_dict[f"Ball_{i}"] = _bf(b)
                        row_dict["Mega"] = mega_val or (balls[5] if len(balls) >= 6 else "")

                    elif lottery_id in SIX_BALL_GAMES:
                        for i, b in enumerate(balls[:6], 1):
                            row_dict[f"Ball_{i}"] = _bf(b)
                        # IL Lotto extra-shot bonus ball
                        extra_lis = num_cell.find_all("li", class_="extra-shot")
                        if extra_lis:
                            extra_val = extra_lis[0].get_text(strip=True)
                            if extra_val.isdigit():
                                row_dict["Extra_Shot"] = fmt_ball(extra_val)

                    elif lottery_id in PICK10_GAMES:
                        # 20-ball keno-style
                        for i, b in enumerate(balls[:20], 1):
                            row_dict[f"Ball_{i}"] = _bf(b)

                    elif lottery_id in {
                        # Fantasy-5 style games that embed a 'Double Play' in same row
                        # — cap at 5 main balls only
                        "mi_fantasy5", "ca_fantasy5", "az_fantasy5",
                        "fl_fantasy5", "ga_fantasy5",
                        "mn_northstar_cash", "mn_gopher5",
                        "nc_cash5", "oh_rolling_cash5",
                        "sc_palmetto_cash5", "wy_cowboy_draw",
                    }:
                        for i, b in enumerate(balls[:5], 1):
                            row_dict[f"Ball_{i}"] = _bf(b)

                    else:
                        # Generic handler: auto-detect ball count from available balls
                        # Uses correct formatter based on SINGLE_DIGIT_GAMES membership
                        for i, b in enumerate(balls, 1):
                            row_dict[f"Ball_{i}"] = _bf(b)

                    results.append(row_dict)
                    draws_this_year += 1

                logger.info(f"lottery.net: {draws_this_year} draws for {lottery_id} {year}")
                _clear_errors('lottery.net')  # success — reset error counter

                # Polite delay between yearly requests
                if len(years_needed) > 1:
                    await asyncio.sleep(0.5)

            except Exception as e:
                logger.error(f"Error scraping lottery.net CA {url}: {e}")
                _mark_error('lottery.net')

    return sorted(results, key=lambda x: x.get("Date", ""), reverse=True)


# ── lotteryusa.com fallback scraper ──────────────────────────────────────────
# Used when lottery.net is unavailable (403) or a game isn't in lottery.net.
# Returns the most-recent ~50 draws from the /year archive page.
# URL pattern: https://lotteryusa.com/{state}/{game}/year
LOTTERYUSA_URL_MAP = {
    # California (evening + midday)
    "ca_daily3":         "https://lotteryusa.com/california/daily-3/year",
    "ca_midday3":        "https://lotteryusa.com/california/midday-3/year",
    "ca_daily4":         "https://lotteryusa.com/california/daily-4/year",
    "ca_fantasy5":       "https://lotteryusa.com/california/fantasy-5/year",
    "ca_superlotto_plus":"https://lotteryusa.com/california/super-lotto-plus/year",
    # Georgia (evening)
    "ga_cash3":          "https://lotteryusa.com/georgia/cash-3/year",
    "ga_cash4":          "https://lotteryusa.com/georgia/cash-4/year",
    "ga_fantasy5":       "https://lotteryusa.com/georgia/fantasy-5/year",
    # Florida (evening + midday)
    "fl_pick3":          "https://lotteryusa.com/florida/pick-3/year",
    "fl_pick3_midday":   "https://lotteryusa.com/florida/midday-pick-3/year",
    "fl_pick4":          "https://lotteryusa.com/florida/pick-4/year",
    "fl_pick4_midday":   "https://lotteryusa.com/florida/midday-pick-4/year",
    "fl_fantasy5":       "https://lotteryusa.com/florida/fantasy-5/year",
    # New York (evening + midday)
    "ny_numbers":        "https://lotteryusa.com/new-york/numbers/year",
    "ny_numbers_midday": "https://lotteryusa.com/new-york/midday-numbers/year",
    "ny_win4":           "https://lotteryusa.com/new-york/win-4/year",
    "ny_win4_midday":    "https://lotteryusa.com/new-york/midday-win-4/year",
    "ny_take5":          "https://lotteryusa.com/new-york/take-5/year",
    # Ohio (evening + midday)
    "oh_pick3":          "https://lotteryusa.com/ohio/pick-3/year",
    "oh_pick3_midday":   "https://lotteryusa.com/ohio/midday-pick-3/year",
    "oh_pick4":          "https://lotteryusa.com/ohio/pick-4/year",
    "oh_pick4_midday":   "https://lotteryusa.com/ohio/midday-pick-4/year",
    # Michigan (evening only — no midday on lotteryusa)
    "mi_daily3":         "https://lotteryusa.com/michigan/daily-3/year",
    "mi_daily4":         "https://lotteryusa.com/michigan/daily-4/year",
    "mi_fantasy5":       "https://lotteryusa.com/michigan/fantasy-5/year",
    # North Carolina (evening + midday pick4 only)
    "nc_pick3":          "https://lotteryusa.com/north-carolina/pick-3/year",
    "nc_pick4":          "https://lotteryusa.com/north-carolina/pick-4/year",
    "nc_pick4_midday":   "https://lotteryusa.com/north-carolina/midday-pick-4/year",
    # New Jersey (evening + midday)
    "nj_pick3":          "https://lotteryusa.com/new-jersey/pick-3/year",
    "nj_pick3_midday":   "https://lotteryusa.com/new-jersey/midday-pick-3/year",
    "nj_pick4":          "https://lotteryusa.com/new-jersey/pick-4/year",
    "nj_pick4_midday":   "https://lotteryusa.com/new-jersey/midday-pick-4/year",
    # Virginia (evening only — no midday on lotteryusa)
    "va_pick3":          "https://lotteryusa.com/virginia/pick-3/year",
    "va_pick4":          "https://lotteryusa.com/virginia/pick-4/year",
    # Tennessee (evening + midday)
    "tn_cash3_evening":  "https://lotteryusa.com/tennessee/cash-3/year",
    "tn_cash3_midday":   "https://lotteryusa.com/tennessee/midday-cash-3/year",
    # Maryland (evening + midday)
    "md_pick3":          "https://lotteryusa.com/maryland/pick-3/year",
    "md_pick3_midday":   "https://lotteryusa.com/maryland/midday-pick-3/year",
    "md_pick4":          "https://lotteryusa.com/maryland/pick-4/year",
    "md_pick4_midday":   "https://lotteryusa.com/maryland/midday-pick-4/year",
    "md_pick5_midday":   "https://lotteryusa.com/maryland/midday-pick-5/year",
    # Illinois (lotto only — pick-3/pick-4 return 404 on lotteryusa)
    "il_lotto":          "https://lotteryusa.com/illinois/lotto/year",
    # Indiana (evening only — no midday on lotteryusa)
    "in_daily3":         "https://lotteryusa.com/indiana/daily-3/year",
    # Pennsylvania (evening + midday)
    "pa_pick3":          "https://lotteryusa.com/pennsylvania/pick-3/year",
    "pa_pick3_midday":   "https://lotteryusa.com/pennsylvania/midday-pick-3/year",
    "pa_pick4_midday":   "https://lotteryusa.com/pennsylvania/midday-pick-4/year",
    # Kentucky
    "ky_pick3_evening":  "https://lotteryusa.com/kentucky/pick-3/year",
    "ky_pick4_evening":  "https://lotteryusa.com/kentucky/pick-4/year",
    # Missouri
    "mo_pick3":          "https://lotteryusa.com/missouri/pick-3/year",
    "mo_pick4":          "https://lotteryusa.com/missouri/pick-4/year",
    # Arizona
    "az_pick3":          "https://lotteryusa.com/arizona/pick-3/year",
    # Colorado
    "co_pick3":          "https://lotteryusa.com/colorado/pick-3/year",
    # Connecticut
    "ct_play3":          "https://lotteryusa.com/connecticut/play-3/year",
    # Massachusetts (midday)
    "ma_numbers_midday": "https://lotteryusa.com/massachusetts/midday-numbers/year",
    # Minnesota
    "mn_pick3":          "https://lotteryusa.com/minnesota/pick-3/year",
    # South Carolina
    "sc_pick3":          "https://lotteryusa.com/south-carolina/pick-3/year",
    # Wisconsin
    "wi_pick3":          "https://lotteryusa.com/wisconsin/pick-3/year",
}


async def scrape_lotteryusa(lottery_id: str, lottery_name: str, state: str,
                             from_date: date, to_date: date) -> List[Dict]:
    """
    Fallback scraper using lotteryusa.com /year archive page.
    Returns up to ~50 recent draws (static HTML, no JS required).
    The /year page shows the 50 most-recent draws across all years.
    Used when lottery.net is blocked or returns 403 for a given game.
    """
    url = LOTTERYUSA_URL_MAP.get(lottery_id)
    if not url:
        logger.debug(f"lotteryusa: No URL configured for {lottery_id}")
        return []

    try:
        async with httpx.AsyncClient(headers=HEADERS, timeout=20, follow_redirects=True) as client:
            resp = await client.get(url)
            if resp.status_code != 200:
                logger.warning(f"lotteryusa: {resp.status_code} for {lottery_id}: {url}")
                return []

            soup = BeautifulSoup(resp.text, "lxml")
            draw_cards = soup.select(".c-draw-card")
            if not draw_cards:
                logger.warning(f"lotteryusa: No draw cards found for {lottery_id}")
                return []

            results = []
            _bf = fmt_ball_single if lottery_id in SINGLE_DIGIT_GAMES else fmt_ball

            for card in draw_cards:
                date_el = card.select_one(".c-draw-card__draw-date-sub")
                if not date_el:
                    continue
                date_str = date_el.get_text(strip=True)
                try:
                    draw_date = datetime.strptime(date_str, "%b %d, %Y").date()
                except ValueError:
                    try:
                        draw_date = datetime.strptime(date_str, "%B %d, %Y").date()
                    except ValueError:
                        continue

                if draw_date > to_date or draw_date < from_date:
                    continue

                balls = [b.get_text(strip=True) for b in card.select(".c-ball")
                         if b.get_text(strip=True).isdigit()]
                if not balls:
                    continue

                row_dict: Dict[str, Any] = {
                    "Date": draw_date.strftime("%Y-%m-%d"),
                    "Lotto_Name": lottery_name,
                    "State": state,
                    "Lottery_ID": lottery_id,
                }

                # ── Separate bonus ball for jackpot games ──
                # On lotteryusa, all balls come as sequential .c-ball elements.
                # For jackpot games the last ball(s) are bonus/multiplier.
                if lottery_id == "ca_superlotto_plus" and len(balls) >= 6:
                    for i, b in enumerate(balls[:5], 1):
                        row_dict[f"Ball_{i}"] = fmt_ball(b)
                    row_dict["Mega"] = fmt_ball(balls[5])
                elif lottery_id == "powerball" and len(balls) >= 6:
                    for i, b in enumerate(balls[:5], 1):
                        row_dict[f"Ball_{i}"] = fmt_ball(b)
                    row_dict["Powerball"] = fmt_ball(balls[5])
                    if len(balls) >= 7:
                        row_dict["Power_Play"] = str(balls[6])
                elif lottery_id == "mega_millions" and len(balls) >= 6:
                    for i, b in enumerate(balls[:5], 1):
                        row_dict[f"Ball_{i}"] = fmt_ball(b)
                    row_dict["Mega_Ball"] = fmt_ball(balls[5])
                    if len(balls) >= 7:
                        row_dict["Megaplier"] = str(balls[6])
                else:
                    for i, b in enumerate(balls, 1):
                        row_dict[f"Ball_{i}"] = _bf(b)

                results.append(row_dict)

            logger.info(f"lotteryusa fallback: {len(results)} draws for {lottery_id}")
            return sorted(results, key=lambda x: x.get("Date", ""), reverse=True)

    except Exception as e:
        logger.error(f"lotteryusa fallback error for {lottery_id}: {e}")
        return []


async def _supplement_deep_history(
    results: List[Dict],
    lottery_id: str, lottery_name: str, state_name: str,
    from_date: date, to_date: date,
    source_label: str = "lotteryusa",
) -> List[Dict]:
    """
    If lotteryusa returned too few results for the requested date range,
    supplement from lottery.net year-based archives which have full history.
    Also supplements today's missing data if to_date is not present.
    Returns the merged (and de-duplicated) result list.
    """
    if not results:
        return results

    requested_days = (to_date - from_date).days
    existing_dates = {r.get("Date") for r in results}
    has_to_date = str(to_date) in existing_dates
    need_full = (requested_days > 60 and len(results) < requested_days * 0.7
                 and lottery_id in LOTTERY_NET_CA_URL_MAP)
    need_today = (not has_to_date and lottery_id in LOTTERY_NET_CA_URL_MAP)

    if not need_full and not need_today:
        return results

    sup_from = from_date if need_full else to_date
    reason = (f"{source_label} returned {len(results)} for {requested_days}-day range"
              if need_full else f"{source_label} missing {to_date}")
    logger.info(f"{lottery_id}: {reason}, supplementing from lottery.net")

    supplement = await scrape_lottery_net_ca(lottery_id, lottery_name, state_name, sup_from, to_date)
    if supplement:
        for row in supplement:
            if row.get("Date") not in existing_dates:
                results.append(row)
                existing_dates.add(row.get("Date"))
        results.sort(key=lambda x: x.get("Date", ""), reverse=True)

    return results


# ── Louisiana CSV slug map ──
LA_CSV_SLUG_MAP = {
    "la_pick3":  "pick-3",
    "la_pick4":  "pick-4",
    "la_pick5":  "pick-5",
    "la_easy5":  "easy-5",
    "la_lotto":  "lotto",
}

# ── Louisiana CSV column map: game_id -> (date_col, ball_cols, bonus_col) ──
LA_CSV_COL_MAP = {
    "la_pick3": ("p3_drawing_date",  ["p3_number_1","p3_number_2","p3_number_3"],  None),
    "la_pick4": ("p4_drawing_date",  ["p4_number_1","p4_number_2","p4_number_3","p4_number_4"], None),
    "la_pick5": ("p5_drawing_date",  ["p5_number_1","p5_number_2","p5_number_3","p5_number_4","p5_number_5"], None),
    "la_easy5": ("e5_drawing_date",  ["e5_number_1","e5_number_2","e5_number_3","e5_number_4","e5_number_5"], None),
    "la_lotto":  ("lotto_drawing_date", ["lotto_number_1","lotto_number_2","lotto_number_3",
                                          "lotto_number_4","lotto_number_5","lotto_number_6"], None),
}

# ── KS game form field map: game_id -> (month_field, year_field, form_h3, button_value) ──
# button_value is the value= attribute of the submit button (used to anchor the table section)
KS_FORM_MAP = {
    "ks_pick3_evening": ("selectedMonthP3", "selectedYearP3", "Pick 3",          "UpdatePick3"),
    "ks_pick3_midday":  ("selectedMonthP3", "selectedYearP3", "Pick 3",          "UpdatePick3"),
    "ks_super_cash":    ("selectedMonthKC", "selectedYearKC", "Super Kansas Cash", "UpdateKansasCash"),
}

# KY API game-name map: game_id -> (api_game_name, draw_name_filter or None)
KY_API_GAME_MAP = {
    "ky_pick3_evening":  ("Pick 3",       "EVENING"),
    "ky_pick3_midday":   ("Pick 3",       "MIDDAY"),
    "ky_pick4_evening":  ("Pick 4",       "EVENING"),
    "ky_pick4_midday":   ("Pick 4",       "MIDDAY"),
    "ky_cash_ball":      ("KY Cash Ball", None),
    "ky_cash_pop":       ("KY CASH POP",  None),
}

KY_API_KEY   = "2Sizlki7TWFuQf8vG2NPy5wVDOjCXl6PW"
KY_API_BASE  = "https://kys-v2.p1.awc.lotteryservices.net/api/v2/draw-games/draws"


async def scrape_la_lottery_csv(lottery_id: str, lottery_name: str, state: str,
                                 from_date: date, to_date: date) -> List[Dict]:
    """
    Fetch Louisiana lottery results from the official louisianalottery.com CSV downloads.
    CSV URL: https://louisianalottery.com/csv/{slug}.csv
    Covers: la_pick3, la_pick4, la_pick5, la_easy5, la_lotto

    NOTE: louisianalottery.com blocks httpx (TLS fingerprint detection) but allows
    the standard `requests` library.  We therefore run the blocking request in a
    thread via asyncio.to_thread to stay non-blocking.
    """
    slug = LA_CSV_SLUG_MAP.get(lottery_id)
    col_info = LA_CSV_COL_MAP.get(lottery_id)
    if not slug or not col_info:
        logger.warning(f"No LA CSV config for {lottery_id}")
        return []

    date_col, ball_cols, bonus_col = col_info
    url = f"https://louisianalottery.com/csv/{slug}.csv"
    is_pick = lottery_id in ("la_pick3", "la_pick4", "la_pick5")
    la_headers = {
        **HEADERS,
        "Referer": f"https://louisianalottery.com/draw-games/{slug}/",
    }

    def _fetch_csv():
        """Blocking CSV fetch using requests (avoids httpx TLS-fingerprint block)."""
        r = _requests.get(url, headers=la_headers, timeout=30)
        return r.status_code, r.text

    try:
        status_code, text = await asyncio.to_thread(_fetch_csv)
        if status_code != 200:
            logger.warning(f"LA CSV fetch failed ({status_code}): {url}")
            return []
        lines = text.strip().splitlines()
        if len(lines) < 2:
            return []
        header = [h.strip().lower() for h in lines[0].split(",")]
        results = []
        for line in lines[1:]:
            parts = [p.strip() for p in line.split(",")]
            if len(parts) < len(header):
                continue
            row_dict = dict(zip(header, parts))
            raw_date = row_dict.get(date_col, "").strip()
            if not raw_date:
                continue
            try:
                d = datetime.strptime(raw_date, "%Y-%m-%d").date()
            except ValueError:
                continue
            if not (from_date <= d <= to_date):
                continue
            balls = [row_dict.get(c, "").strip() for c in ball_cols]
            if not any(balls):
                continue
            row = {
                "Date":       d.strftime("%Y-%m-%d"),
                "Lotto_Name": lottery_name,
                "State":      state,
                "Lottery_ID": lottery_id,
            }
            for i, b in enumerate(balls, 1):
                if b:
                    row[f"Ball_{i}"] = b if is_pick else fmt_ball(b)
            results.append(row)
        logger.info(f"LA CSV scraped {len(results)} rows for {lottery_id}")
        return sorted(results, key=lambda x: x["Date"], reverse=True)
    except Exception as e:
        logger.error(f"Error fetching LA CSV {url}: {e}")
        return []


async def scrape_ks_lottery(lottery_id: str, lottery_name: str, state: str,
                             from_date: date, to_date: date) -> List[Dict]:
    """
    Scrape Kansas lottery results from kslottery.com/previousnumbers/ via
    POST form with CSRF tokens (multipart/form-data).
    Covers: ks_pick3_evening, ks_pick3_midday, ks_super_cash
    """
    import calendar

    game_cfg = KS_FORM_MAP.get(lottery_id)
    if not game_cfg:
        logger.warning(f"No KS form config for {lottery_id}")
        return []

    month_field, year_field, form_h3, btn_value = game_cfg
    base_url = "https://www.kslottery.com/previousnumbers/"
    ks_headers = {**HEADERS, "Referer": base_url}

    # Determine which months we need
    months_needed = set()
    cur = from_date.replace(day=1)
    while cur <= to_date:
        months_needed.add((cur.year, cur.month))
        # advance one month
        if cur.month == 12:
            cur = cur.replace(year=cur.year + 1, month=1)
        else:
            cur = cur.replace(month=cur.month + 1)

    results = []

    async with httpx.AsyncClient(headers=ks_headers, timeout=30, follow_redirects=True) as client:
        for (year, month) in sorted(months_needed):
            try:
                # Step 1: GET page to obtain CSRF token and ufprt for this game's form
                r_get = await client.get(base_url)
                if r_get.status_code != 200:
                    logger.warning(f"KS GET failed {r_get.status_code}")
                    continue
                page_text = r_get.text

                # Parse form sections to find the one matching our game
                form_sections = re.findall(r'<form[^>]+>(.*?)</form>', page_text, re.DOTALL)
                target_form = None
                for fs in form_sections:
                    h3m = re.search(r'<h3[^>]*>([^<]+)</h3>', fs)
                    if h3m and form_h3.lower() in h3m.group(1).lower():
                        target_form = fs
                        break
                if not target_form:
                    logger.warning(f"KS: form for '{form_h3}' not found on page")
                    continue

                # Extract all hidden input fields from the target form
                # (attribute order may vary: name=... type=... value=... OR name=... value=...)
                def _extract_ks_inputs(html_frag):
                    fields_map = {}
                    for inp in re.findall(r'<input[^>]+>', html_frag):
                        nm = re.search(r'name="([^"]+)"', inp)
                        vm = re.search(r'value="([^"]+)"', inp)
                        if nm:
                            fields_map[nm.group(1)] = vm.group(1) if vm else ''
                    return fields_map

                form_fields = _extract_ks_inputs(target_form)
                ufprt = form_fields.get('ufprt', '')
                csrf  = form_fields.get('__RequestVerificationToken', '')
                if not ufprt or not csrf:
                    logger.warning(f"KS: CSRF/ufprt tokens not found for {lottery_id}")
                    continue

                # Step 2: POST to get historical data for this month/year
                post_files = {
                    "__RequestVerificationToken": (None, csrf),
                    "ufprt":                      (None, ufprt),
                    month_field:                  (None, f"{month:02d}"),
                    year_field:                   (None, str(year)),
                }
                r_post = await client.post(base_url, files=post_files)
                if r_post.status_code != 200:
                    logger.warning(f"KS POST failed {r_post.status_code} for {year}-{month:02d}")
                    continue

                html = r_post.text
                # Anchor on the Update button value (e.g. "UpdatePick3") which appears
                # immediately before the results table. The game h3 appears multiple times
                # in navigation, so we cannot use html.find(form_h3) directly.
                btn_idx = html.find(btn_value)
                if btn_idx < 0:
                    # Fallback: use last occurrence of form_h3
                    idx = html.rfind(form_h3)
                    if idx < 0:
                        logger.warning(f"KS: table anchor not found for {lottery_id}")
                        continue
                    section = html[idx: idx + 15000]
                else:
                    section = html[btn_idx: btn_idx + 15000]

                if lottery_id in ("ks_pick3_evening", "ks_pick3_midday"):
                    # Table format: Date | Draw Time | Ball_1 | Ball_2 | Ball_3 | Winners
                    rows = re.findall(
                        r'<td>(\d+/\d+/\d+)</td>\s*<td>(\w+)</td>'
                        r'\s*<td>(\d)</td>\s*<td>(\d)</td>\s*<td>(\d)</td>',
                        section
                    )
                    draw_filter = "Evening" if lottery_id == "ks_pick3_evening" else "Midday"
                    for (raw_date, draw_time, b1, b2, b3) in rows:
                        if draw_filter.lower() not in draw_time.lower():
                            continue
                        try:
                            d = datetime.strptime(raw_date, "%m/%d/%Y").date()
                        except ValueError:
                            continue
                        if not (from_date <= d <= to_date):
                            continue
                        results.append({
                            "Date":       d.strftime("%Y-%m-%d"),
                            "Lotto_Name": lottery_name,
                            "State":      state,
                            "Lottery_ID": lottery_id,
                            "Ball_1":     b1,
                            "Ball_2":     b2,
                            "Ball_3":     b3,
                        })
                elif lottery_id == "ks_super_cash":
                    # Table format: Date | Numbers (e.g. "2 - 3 - 9 - 27 - 30") | Super Cash Ball | Jackpot
                    rows = re.findall(
                        r'<td>(\d+/\d+/\d+)</td>\s*'
                        r'<td>([\d\s\-]+)</td>\s*'
                        r'<td>(\d+)</td>',
                        section
                    )
                    for (raw_date, nums_str, cash_ball) in rows:
                        try:
                            d = datetime.strptime(raw_date, "%m/%d/%Y").date()
                        except ValueError:
                            continue
                        if not (from_date <= d <= to_date):
                            continue
                        balls = [b.strip() for b in re.split(r'\s*-\s*', nums_str.strip()) if b.strip().isdigit()]
                        if len(balls) != 5:
                            continue
                        row = {
                            "Date":       d.strftime("%Y-%m-%d"),
                            "Lotto_Name": lottery_name,
                            "State":      state,
                            "Lottery_ID": lottery_id,
                        }
                        for i, b in enumerate(balls, 1):
                            row[f"Ball_{i}"] = fmt_ball(b)
                        row["Cash_Ball"] = fmt_ball(cash_ball)
                        results.append(row)

                await asyncio.sleep(0.8)   # be polite between month requests

            except Exception as e:
                logger.error(f"Error scraping KS {lottery_id} {year}-{month:02d}: {e}")

    return sorted(results, key=lambda x: x.get("Date", ""), reverse=True)


async def scrape_ky_lottery_api(lottery_id: str, lottery_name: str, state: str,
                                 from_date: date, to_date: date) -> List[Dict]:
    """
    Fetch Kentucky lottery results from the official IGT/AWC JSON API.
    API: https://kys-v2.p1.awc.lotteryservices.net/api/v2/draw-games/draws
    Auth: X-Esa-Api-Key header (public key embedded in the KY lottery web app)
    Covers: ky_pick3_evening, ky_pick3_midday, ky_pick4_evening, ky_pick4_midday,
            ky_cash_ball, ky_cash_pop
    """
    game_cfg = KY_API_GAME_MAP.get(lottery_id)
    if not game_cfg:
        logger.warning(f"No KY API config for {lottery_id}")
        return []

    api_game_name, draw_name_filter = game_cfg
    is_pick = lottery_id in ("ky_pick3_evening", "ky_pick3_midday",
                              "ky_pick4_evening", "ky_pick4_midday")

    # Request enough previous draws to cover the date range
    # Each day has 2 draws for Pick 3/4, 1 for Cash Ball/Pop
    days_span = (to_date - from_date).days + 1
    prev_count = max(60, days_span * 3)   # buffer

    url = f"{KY_API_BASE}?previous-draws={prev_count}&next-draws=0"
    api_headers = {
        **HEADERS,
        "X-Esa-Api-Key": KY_API_KEY,
        "Accept": "application/json",
        "Origin": "https://www.kylottery.com",
        "Referer": "https://www.kylottery.com/",
    }

    async with httpx.AsyncClient(headers=api_headers, timeout=30, follow_redirects=True) as client:
        try:
            resp = await client.get(url)
            if resp.status_code != 200:
                logger.warning(f"KY API failed {resp.status_code}: {url}")
                return []

            data = resp.json()
            draws = data.get("draws", [])
            results = []

            for d in draws:
                if d.get("gameName") != api_game_name:
                    continue
                if "results" not in d:
                    continue

                # Filter by draw name (EVENING / MIDDAY) for Pick 3/4
                draw_name = d.get("name", "").upper().strip()
                if draw_name_filter and draw_name_filter.upper() not in draw_name:
                    continue

                draw_ts = d.get("drawTime")
                if draw_ts is None:
                    continue
                draw_date = datetime.fromtimestamp(draw_ts / 1000).date()
                if not (from_date <= draw_date <= to_date):
                    continue

                draw_results = d["results"]
                if not draw_results:
                    continue
                primary   = draw_results[0].get("primary", [])
                secondary = draw_results[0].get("secondary", [])

                if not primary:
                    continue

                row = {
                    "Date":       draw_date.strftime("%Y-%m-%d"),
                    "Lotto_Name": lottery_name,
                    "State":      state,
                    "Lottery_ID": lottery_id,
                }

                for i, b in enumerate(primary, 1):
                    row[f"Ball_{i}"] = str(b) if is_pick else fmt_ball(b)

                if secondary:
                    if lottery_id == "ky_cash_ball":
                        row["Cash_Ball"] = fmt_ball(secondary[0])
                    elif lottery_id not in ("ky_cash_pop",):
                        row["Bonus"] = fmt_ball(secondary[0])

                results.append(row)

            logger.info(f"KY API scraped {len(results)} draws for {lottery_id}")
            return sorted(results, key=lambda x: x["Date"], reverse=True)

        except Exception as e:
            logger.error(f"Error fetching KY API {lottery_id}: {e}")
            return []


async def scrape_ny_open_data(lottery_id: str, lottery_name: str, state: str,
                               from_date: date, to_date: date) -> List[Dict]:
    """
    Fetch NY Lottery data from NY Open Data (Socrata API).
    Official government data source - real results only.
    """
    # Skip if recently returned 403
    if _is_403_blocked('ny_open_data'):
        logger.debug(f"NY Open Data 403-cached, skipping {lottery_id}")
        return []

    endpoints = {
        "ny_lotto": "https://data.ny.gov/resource/6nbc-h7bj.json",
        "ny_numbers": "https://data.ny.gov/resource/vmqe-9k7b.json",
        "ny_win4": "https://data.ny.gov/resource/58de-axaz.json",
        "ny_take5": "https://data.ny.gov/resource/dg63-4siq.json",
        "powerball": "https://data.ny.gov/resource/d6yy-54nr.json",
        "mega_millions": "https://data.ny.gov/resource/5xaw-6ayf.json",
        "ny_cash4life": "https://data.ny.gov/resource/kwxv-fwze.json",
        "ny_pick10": "https://data.ny.gov/resource/bycu-cw7c.json",
    }

    url = endpoints.get(lottery_id)
    if not url:
        return []

    from_str = from_date.strftime("%Y-%m-%dT00:00:00.000")
    to_str = to_date.strftime("%Y-%m-%dT23:59:59.999")

    params = {
        "$where": f"draw_date >= '{from_str}' AND draw_date <= '{to_str}'",
        "$order": "draw_date DESC",
        "$limit": 5000,
    }

    results = []
    async with httpx.AsyncClient(timeout=30, headers=HEADERS) as client:
        try:
            resp = await client.get(url, params=params)
            if resp.status_code == 200:
                data = resp.json()
                for record in data:
                    row = _parse_ny_open_data_record(record, lottery_id, lottery_name, state)
                    if row:
                        results.append(row)
                logger.info(f"NY Open Data: {len(results)} records for {lottery_id}")
            else:
                logger.warning(f"NY Open Data returned {resp.status_code} for {lottery_id}")
                if resp.status_code == 403:
                    _mark_403('ny_open_data')
        except Exception as e:
            logger.error(f"Error fetching NY Open Data for {lottery_id}: {e}")

    return results


def _parse_ny_open_data_record(record: Dict, lottery_id: str, lottery_name: str, state: str) -> Optional[Dict]:
    """Parse a single NY Open Data record."""
    try:
        draw_date_str = record.get("draw_date", "")
        if not draw_date_str:
            return None

        draw_date = datetime.fromisoformat(draw_date_str[:10]).strftime("%Y-%m-%d")
        row = {
            "Date": draw_date,
            "Lotto_Name": lottery_name,
            "State": state,
            "Lottery_ID": lottery_id,
        }

        winning = record.get("winning_numbers", "")
        nums = re.findall(r'\d+', winning)

        if lottery_id == "ny_lotto":
            for i, n in enumerate(nums[:6], 1):
                row[f"Ball_{i}"] = fmt_ball(n)
            if len(nums) >= 7:
                row["Bonus"] = fmt_ball(nums[6])

        elif lottery_id == "ny_numbers":
            # NY Numbers: 3-ball pick game — single digit each
            for i, n in enumerate(nums[:3], 1):
                row[f"Ball_{i}"] = fmt_ball_single(n)

        elif lottery_id == "ny_win4":
            # NY Win 4: 4-ball pick game — single digit each
            for i, n in enumerate(nums[:4], 1):
                row[f"Ball_{i}"] = fmt_ball_single(n)

        elif lottery_id == "ny_take5":
            for i, n in enumerate(nums[:5], 1):
                row[f"Ball_{i}"] = fmt_ball(n)

        elif lottery_id == "powerball":
            multiplier = record.get("multiplier", "")
            for i, n in enumerate(nums[:5], 1):
                row[f"Ball_{i}"] = fmt_ball(n)
            if len(nums) >= 6:
                row["Powerball"] = fmt_ball(nums[5])
            if multiplier:
                row["Power_Play"] = str(multiplier)

        elif lottery_id == "mega_millions":
            multiplier = record.get("multiplier", "")
            for i, n in enumerate(nums[:5], 1):
                row[f"Ball_{i}"] = fmt_ball(n)
            if len(nums) >= 6:
                row["Mega_Ball"] = fmt_ball(nums[5])
            if multiplier:
                row["Megaplier"] = str(multiplier)

        elif lottery_id == "ny_cash4life":
            for i, n in enumerate(nums[:5], 1):
                row[f"Ball_{i}"] = fmt_ball(n)
            if len(nums) >= 6:
                row["Cash_Ball"] = fmt_ball(nums[5])

        elif lottery_id == "ny_pick10":
            for i, n in enumerate(nums[:20], 1):
                row[f"Ball_{i}"] = fmt_ball(n)

        return row

    except Exception as e:
        logger.error(f"Error parsing NY Open Data record: {e}")
        return None


async def fetch_lottery_results(lottery_id: str, lottery_name: str, state_name: str,
                                 from_date: date, to_date: date) -> List[Dict]:
    """
    Master function to fetch lottery results from the best available source.
    Priority: NY Open Data (official) → lotto.net scraper

    All results are REAL lottery numbers from verified public sources.
    NO fake/random numbers are ever generated.
    """
    logger.info(f"Fetching {lottery_name} ({lottery_id}) from {from_date} to {to_date}")

    # ── Powerball ──
    if lottery_id == "powerball":
        # Try NY Open Data first (official government source)
        results = await scrape_ny_open_data("powerball", lottery_name, state_name, from_date, to_date)
        if results:
            return results
        # Fallback to lotto.net
        return await scrape_lotto_net("powerball", lottery_name, state_name, from_date, to_date)

    # ── Mega Millions ──
    if lottery_id == "mega_millions":
        results = await scrape_ny_open_data("mega_millions", lottery_name, state_name, from_date, to_date)
        if results:
            return results
        return await scrape_lotto_net("mega_millions", lottery_name, state_name, from_date, to_date)

    # ── NY State Lotteries ──
    # Priority: NY Open Data (official) → lotteryusa.com (reliable) → lottery.net (full history)
    if lottery_id in ["ny_lotto", "ny_numbers", "ny_win4", "ny_take5", "ny_cash4life", "ny_pick10",
                      "ny_numbers_midday", "ny_win4_midday", "ny_take5_midday"]:
        results = await scrape_ny_open_data(lottery_id, lottery_name, state_name, from_date, to_date)
        if results:
            return await _supplement_deep_history(results, lottery_id, lottery_name, state_name, from_date, to_date, "NY Open Data")
        # Fallback: lotteryusa.com (reliable, ~50 recent draws) + lottery.net supplement
        if lottery_id in LOTTERYUSA_URL_MAP:
            logger.info(f"NY Open Data unavailable for {lottery_id}, trying lotteryusa.com")
            results = await scrape_lotteryusa(lottery_id, lottery_name, state_name, from_date, to_date)
            if results:
                return await _supplement_deep_history(results, lottery_id, lottery_name, state_name, from_date, to_date)
        # Last resort: lottery.net full history
        if lottery_id in LOTTERY_NET_CA_URL_MAP:
            logger.info(f"Trying lottery.net for {lottery_id}")
            return await scrape_lottery_net_ca(lottery_id, lottery_name, state_name, from_date, to_date)
        return []

    # ── CA Pick / Draw Games ──
    # Priority: lotteryusa.com (reliable) → lottery.net (full history)
    # ca_pick3 is a legacy alias → routes to Evening draw
    if lottery_id in ("ca_daily3", "ca_pick3"):
        results = await scrape_lotteryusa("ca_daily3", lottery_name, state_name, from_date, to_date)
        if results:
            return await _supplement_deep_history(results, "ca_daily3", lottery_name, state_name, from_date, to_date)
        return await scrape_lottery_net_ca("ca_daily3", lottery_name, state_name, from_date, to_date)

    if lottery_id == "ca_midday3":
        results = await scrape_lotteryusa("ca_midday3", lottery_name, state_name, from_date, to_date)
        if results:
            return await _supplement_deep_history(results, "ca_midday3", lottery_name, state_name, from_date, to_date)
        return await scrape_lottery_net_ca("ca_midday3", lottery_name, state_name, from_date, to_date)

    if lottery_id == "ca_daily4":
        results = await scrape_lotteryusa("ca_daily4", lottery_name, state_name, from_date, to_date)
        if results:
            return await _supplement_deep_history(results, "ca_daily4", lottery_name, state_name, from_date, to_date)
        return await scrape_lottery_net_ca("ca_daily4", lottery_name, state_name, from_date, to_date)

    if lottery_id == "ca_fantasy5":
        results = await scrape_lotteryusa("ca_fantasy5", lottery_name, state_name, from_date, to_date)
        if results:
            return await _supplement_deep_history(results, "ca_fantasy5", lottery_name, state_name, from_date, to_date)
        return await scrape_lottery_net_ca("ca_fantasy5", lottery_name, state_name, from_date, to_date)

    # ── CA SuperLotto Plus ──
    if lottery_id == "ca_superlotto_plus":
        results = await scrape_lotteryusa("ca_superlotto_plus", lottery_name, state_name, from_date, to_date)
        if results:
            return await _supplement_deep_history(results, "ca_superlotto_plus", lottery_name, state_name, from_date, to_date)
        # Fallback to lottery.net, then lotto.net
        results = await scrape_lottery_net_ca("ca_superlotto_plus", lottery_name, state_name, from_date, to_date)
        if results:
            return results
        return await scrape_lotto_net("ca_superlotto_plus", lottery_name, state_name, from_date, to_date)

    # ── FL Lotto ──
    if lottery_id == "fl_lotto":
        return await scrape_lotto_net("fl_lotto", lottery_name, state_name, from_date, to_date)

    # ── TX Lotto Texas ──
    if lottery_id == "tx_lotto_texas":
        return await scrape_lotto_net("tx_lotto_texas", lottery_name, state_name, from_date, to_date)

    # ── MI Lotto 47 ──
    if lottery_id == "mi_lotto47":
        return await scrape_lotto_net("mi_lotto47", lottery_name, state_name, from_date, to_date)

    # ── WA Lotto ──
    if lottery_id == "wa_lotto":
        return await scrape_lotto_net("wa_lotto", lottery_name, state_name, from_date, to_date)

    # ── OR Megabucks ──
    if lottery_id == "or_megabucks":
        return await scrape_lotto_net("or_megabucks", lottery_name, state_name, from_date, to_date)

    # ── NJ Pick 6 ──
    if lottery_id == "nj_pick6":
        return await scrape_lotto_net("nj_pick6", lottery_name, state_name, from_date, to_date)

    # ── NJ Cash 5 ──
    if lottery_id == "nj_jersey_cash5":
        return await scrape_lotto_net("nj_jersey_cash5", lottery_name, state_name, from_date, to_date)

    # ── Louisiana – official CSV downloads ──
    if lottery_id in LA_CSV_SLUG_MAP:
        return await scrape_la_lottery_csv(lottery_id, lottery_name, state_name, from_date, to_date)

    # ── Kansas – kslottery.com POST form ──
    if lottery_id in KS_FORM_MAP:
        return await scrape_ks_lottery(lottery_id, lottery_name, state_name, from_date, to_date)

    # ── Kentucky – IGT/AWC JSON API ──
    if lottery_id in KY_API_GAME_MAP:
        return await scrape_ky_lottery_api(lottery_id, lottery_name, state_name, from_date, to_date)

    # ── Universal multi-source dispatcher ──
    # Priority order:
    #   1. lotteryusa.com  — reliable, no rate-limiting (~50 recent draws)
    #   2. lottery.net      — full history but often returns 403 (rate-limited)
    # _supplement_deep_history() handles both deep-history and today-missing cases
    if lottery_id in LOTTERYUSA_URL_MAP:
        results = await scrape_lotteryusa(lottery_id, lottery_name, state_name, from_date, to_date)
        if results:
            return await _supplement_deep_history(results, lottery_id, lottery_name, state_name, from_date, to_date)
        logger.info(f"lotteryusa.com returned 0 for {lottery_id}, trying lottery.net")

    # Try lottery.net (may be rate-limited but has more complete history)
    if lottery_id in LOTTERY_NET_CA_URL_MAP:
        results = await scrape_lottery_net_ca(lottery_id, lottery_name, state_name, from_date, to_date)
        if results:
            return results

    # If neither source had data but at least one was configured, return empty
    if lottery_id in LOTTERYUSA_URL_MAP or lottery_id in LOTTERY_NET_CA_URL_MAP:
        logger.warning(f"All sources returned 0 results for {lottery_id}")
        return []

    # For games truly not yet supported
    logger.warning(
        f"Lottery '{lottery_id}' ({lottery_name}) has no scraper configured. "
        f"Add its URL to LOTTERY_NET_CA_URL_MAP or LOTTERYUSA_URL_MAP to enable scraping."
    )
    return []


def build_csv_rows(results: List[Dict]) -> List[Dict]:
    """
    Normalize results into consistent CSV row format.
    Column order: Date, Lotto_Name, Ball_1, Ball_2, ..., [Bonus/Special balls]
    Numbers formatted as ## for regular lotto games (zero-padded, e.g., "01", "09").
    For Pick 3/4/5 type games, ball numbers are single digits (0-9).
    """
    if not results:
        return []

    # Collect all column names
    ball_cols = set()
    special_cols = set()
    for r in results:
        for k in r.keys():
            if k.startswith("Ball_"):
                ball_cols.add(k)
            elif k not in ["Date", "Lotto_Name", "State", "Lottery_ID"]:
                special_cols.add(k)

    # Sort ball columns numerically
    sorted_balls = sorted(ball_cols, key=lambda x: int(x.split("_")[1]))

    # Ordering for special columns
    special_priority = ["Powerball", "Power_Play", "Mega_Ball", "Megaplier",
                        "Mega", "Bonus", "Bonus_Ball", "Fireball", "Cash_Ball", "Multiplier"]
    sorted_special = (
        [c for c in special_priority if c in special_cols] +
        [c for c in sorted(special_cols) if c not in special_priority]
    )

    all_cols = ["Date", "Lotto_Name", "State", "Lottery_ID"] + sorted_balls + sorted_special

    normalized = []
    for r in results:
        row = {}
        for col in all_cols:
            row[col] = r.get(col, "")
        normalized.append(row)

    return normalized
