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
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
}


def fmt_ball(n) -> str:
    """Format ball number as zero-padded 2-digit string."""
    try:
        # Strip any non-digit characters first
        num_str = re.sub(r'[^\d]', '', str(n)).strip()
        if not num_str:
            return "00"
        return f"{int(num_str):02d}"
    except Exception:
        return str(n).strip().zfill(2)


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
                if resp.status_code != 200:
                    logger.warning(f"Failed to fetch {url}: {resp.status_code}")
                    continue

                soup = BeautifulSoup(resp.text, "lxml")
                draws = _parse_lotto_net_archive_items(soup, lottery_id, lottery_name, state, from_date, to_date)
                results.extend(draws)
                logger.info(f"Scraped {len(draws)} draws for {lottery_id} year {year}")

                # Be polite - delay between requests
                if len(years_needed) > 1:
                    await asyncio.sleep(0.6)

            except Exception as e:
                logger.error(f"Error scraping {url}: {e}")

    return sorted(results, key=lambda x: x.get("Date", ""), reverse=True)


async def scrape_ny_open_data(lottery_id: str, lottery_name: str, state: str,
                               from_date: date, to_date: date) -> List[Dict]:
    """
    Fetch NY Lottery data from NY Open Data (Socrata API).
    Official government data source - real results only.
    """
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
            for i, n in enumerate(nums[:3], 1):
                row[f"Ball_{i}"] = fmt_ball(n)

        elif lottery_id == "ny_win4":
            for i, n in enumerate(nums[:4], 1):
                row[f"Ball_{i}"] = fmt_ball(n)

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

    # ── NY State Lotteries via NY Open Data ──
    if lottery_id in ["ny_lotto", "ny_numbers", "ny_win4", "ny_take5", "ny_cash4life", "ny_pick10"]:
        results = await scrape_ny_open_data(lottery_id, lottery_name, state_name, from_date, to_date)
        if results:
            return results
        # NY Lotto fallback to lotto.net
        if lottery_id == "ny_lotto":
            return await scrape_lotto_net("ny_lotto_net", lottery_name, state_name, from_date, to_date)
        return []

    # ── CA SuperLotto Plus ──
    if lottery_id == "ca_superlotto_plus":
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

    # ── IL Lotto ──
    if lottery_id == "il_lotto":
        return await scrape_lotto_net("il_lotto", lottery_name, state_name, from_date, to_date)

    # For other state lotteries not yet scraped
    logger.warning(
        f"Lottery '{lottery_id}' ({lottery_name}) doesn't have a scraper configured yet. "
        f"Available scrapers: powerball, mega_millions, ny_lotto, ny_take5, ny_numbers, ny_win4, "
        f"ca_superlotto_plus, fl_lotto, tx_lotto_texas, mi_lotto47, wa_lotto, or_megabucks, "
        f"nj_pick6, nj_jersey_cash5, il_lotto"
    )
    return []


def build_csv_rows(results: List[Dict]) -> List[Dict]:
    """
    Normalize results into consistent CSV row format.
    Column order: Date, Lotto_Name, Ball_1, Ball_2, ..., [Bonus/Special balls]
    Numbers formatted as ##  (zero-padded, e.g., "01", "09")
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
                        "Mega", "Bonus", "Bonus_Ball", "Cash_Ball", "Multiplier"]
    sorted_special = (
        [c for c in special_priority if c in special_cols] +
        [c for c in sorted(special_cols) if c not in special_priority]
    )

    all_cols = ["Date", "Lotto_Name"] + sorted_balls + sorted_special

    normalized = []
    for r in results:
        row = {}
        for col in all_cols:
            row[col] = r.get(col, "")
        normalized.append(row)

    return normalized
