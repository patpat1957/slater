"""
Draw Schedule — US lottery draw times by state, game type, and draw period.

All times in LOCAL timezone for that state. The 'tz' field is the IANA timezone.
'avail_delay_min' = minutes after draw time before results typically appear online.

Sources: Official state lottery websites, lotteryusa.com, lotterypost.com (June 2026).
"""

# ─── Draw time configuration ────────────────────────────────────────────────
# Structure: DRAW_TIMES[game_type][state] = {
#   "tz": "America/New_York",
#   "midday":  {"draw": "13:35", "avail": "13:50"},  # HH:MM local
#   "evening": {"draw": "18:59", "avail": "19:15"},
#   "night":   {"draw": "23:34", "avail": "23:50"},   # GA only
#   "days": [0,1,2,3,4,5,6]  # 0=Mon..6=Sun; omit = daily
# }
#
# 'draw' = official draw time (local TZ)
# 'avail' = when results are typically available online (draw + delay)

DRAW_TIMES = {
    # ════════════════════════════════════════════════════════════════════════
    #  PICK 3
    # ════════════════════════════════════════════════════════════════════════
    "pick3": {
        "AR": {"tz": "America/Chicago",    "midday": {"draw": "12:59", "avail": "13:15"}, "evening": {"draw": "18:59", "avail": "19:15"}},
        "AZ": {"tz": "America/Phoenix",    "evening": {"draw": "19:30", "avail": "19:45"}},
        "CA": {"tz": "America/Los_Angeles", "midday": {"draw": "13:00", "avail": "13:20"}, "evening": {"draw": "18:30", "avail": "18:50"}},
        "CO": {"tz": "America/Denver",     "evening": {"draw": "19:35", "avail": "19:50"}},
        "CT": {"tz": "America/New_York",   "evening": {"draw": "22:38", "avail": "22:55"}},
        "DE": {"tz": "America/New_York",   "midday": {"draw": "13:30", "avail": "13:50"}, "evening": {"draw": "19:30", "avail": "19:50"}},
        "FL": {"tz": "America/New_York",   "midday": {"draw": "13:30", "avail": "13:50"}, "evening": {"draw": "21:45", "avail": "22:00"}},
        "GA": {"tz": "America/New_York",   "midday": {"draw": "12:29", "avail": "12:45"}, "evening": {"draw": "18:59", "avail": "19:15"}, "night": {"draw": "23:34", "avail": "23:50"}},
        "IA": {"tz": "America/Chicago",    "midday": {"draw": "12:20", "avail": "12:40"}, "evening": {"draw": "21:00", "avail": "21:20"}},
        "ID": {"tz": "America/Boise",      "midday": {"draw": "13:00", "avail": "13:20"}, "evening": {"draw": "21:00", "avail": "21:20"}},
        "IL": {"tz": "America/Chicago",    "midday": {"draw": "12:40", "avail": "12:55"}, "evening": {"draw": "21:22", "avail": "21:40"}},
        "IN": {"tz": "America/Indiana/Indianapolis", "midday": {"draw": "13:20", "avail": "13:40"}, "evening": {"draw": "23:00", "avail": "23:20"}},
        "KS": {"tz": "America/Chicago",    "midday": {"draw": "12:30", "avail": "12:50"}, "evening": {"draw": "21:00", "avail": "21:20"}},
        "KY": {"tz": "America/New_York",   "midday": {"draw": "13:20", "avail": "13:40"}, "evening": {"draw": "23:00", "avail": "23:20"}},
        "LA": {"tz": "America/Chicago",    "evening": {"draw": "21:00", "avail": "21:20"}},
        "MA": {"tz": "America/New_York",   "midday": {"draw": "14:00", "avail": "14:20"}, "evening": {"draw": "21:30", "avail": "21:50"}},
        "MD": {"tz": "America/New_York",   "midday": {"draw": "12:28", "avail": "12:45"}, "evening": {"draw": "19:56", "avail": "20:10"}},
        "ME": {"tz": "America/New_York",   "evening": {"draw": "19:00", "avail": "19:20"}},
        "MI": {"tz": "America/Detroit",    "midday": {"draw": "12:59", "avail": "13:15"}, "evening": {"draw": "19:29", "avail": "19:45"}},
        "MN": {"tz": "America/Chicago",    "evening": {"draw": "18:17", "avail": "18:35"}},
        "MO": {"tz": "America/Chicago",    "evening": {"draw": "20:59", "avail": "21:15"}},
        "MS": {"tz": "America/Chicago",    "midday": {"draw": "14:30", "avail": "14:50"}, "evening": {"draw": "21:30", "avail": "21:50"}},
        "NC": {"tz": "America/New_York",   "midday": {"draw": "15:00", "avail": "15:20"}, "evening": {"draw": "23:22", "avail": "23:40"}},
        "NE": {"tz": "America/Chicago",    "evening": {"draw": "21:20", "avail": "21:40"}},
        "NH": {"tz": "America/New_York",   "evening": {"draw": "19:00", "avail": "19:20"}},
        "NJ": {"tz": "America/New_York",   "midday": {"draw": "12:59", "avail": "13:15"}, "evening": {"draw": "22:57", "avail": "23:10"}},
        "NM": {"tz": "America/Denver",     "evening": {"draw": "21:00", "avail": "21:20"}},
        "NY": {"tz": "America/New_York",   "midday": {"draw": "14:30", "avail": "14:50"}, "evening": {"draw": "22:30", "avail": "22:50"}},
        "OH": {"tz": "America/New_York",   "midday": {"draw": "12:29", "avail": "12:45"}, "evening": {"draw": "19:29", "avail": "19:45"}},
        "OK": {"tz": "America/Chicago",    "evening": {"draw": "22:00", "avail": "22:20"}},
        "PA": {"tz": "America/New_York",   "midday": {"draw": "13:35", "avail": "13:50"}, "evening": {"draw": "18:59", "avail": "19:15"}},
        "RI": {"tz": "America/New_York",   "evening": {"draw": "19:29", "avail": "19:45"}},
        "SC": {"tz": "America/New_York",   "midday": {"draw": "12:59", "avail": "13:15"}, "evening": {"draw": "18:59", "avail": "19:15"}},
        "SD": {"tz": "America/Chicago",    "evening": {"draw": "21:00", "avail": "21:20"}},
        "TN": {"tz": "America/Chicago",    "midday": {"draw": "12:28", "avail": "12:45"}, "evening": {"draw": "18:28", "avail": "18:45"}},
        "TX": {"tz": "America/Chicago",    "evening": {"draw": "22:12", "avail": "22:30"}},
        "VA": {"tz": "America/New_York",   "midday": {"draw": "14:00", "avail": "14:20"}, "evening": {"draw": "23:00", "avail": "23:20"}},
        "VT": {"tz": "America/New_York",   "evening": {"draw": "19:00", "avail": "19:20"}},
        "WA": {"tz": "America/Los_Angeles","evening": {"draw": "20:15", "avail": "20:35"}},
        "WI": {"tz": "America/Chicago",    "evening": {"draw": "21:00", "avail": "21:20"}},
        "WV": {"tz": "America/New_York",   "evening": {"draw": "18:59", "avail": "19:15"}},
    },

    # ════════════════════════════════════════════════════════════════════════
    #  PICK 4
    # ════════════════════════════════════════════════════════════════════════
    "pick4": {
        "CA": {"tz": "America/Los_Angeles","evening": {"draw": "18:30", "avail": "18:50"}},
        "CT": {"tz": "America/New_York",   "evening": {"draw": "22:38", "avail": "22:55"}},
        "DC": {"tz": "America/New_York",   "evening": {"draw": "19:50", "avail": "20:10"}},
        "DE": {"tz": "America/New_York",   "midday": {"draw": "13:30", "avail": "13:50"}, "evening": {"draw": "19:30", "avail": "19:50"}},
        "FL": {"tz": "America/New_York",   "midday": {"draw": "13:30", "avail": "13:50"}, "evening": {"draw": "21:45", "avail": "22:00"}},
        "GA": {"tz": "America/New_York",   "midday": {"draw": "12:29", "avail": "12:45"}, "evening": {"draw": "18:59", "avail": "19:15"}, "night": {"draw": "23:34", "avail": "23:50"}},
        "IA": {"tz": "America/Chicago",    "midday": {"draw": "12:20", "avail": "12:40"}, "evening": {"draw": "21:00", "avail": "21:20"}},
        "ID": {"tz": "America/Boise",      "midday": {"draw": "13:00", "avail": "13:20"}, "evening": {"draw": "21:00", "avail": "21:20"}},
        "IL": {"tz": "America/Chicago",    "midday": {"draw": "12:40", "avail": "12:55"}, "evening": {"draw": "21:22", "avail": "21:40"}},
        "IN": {"tz": "America/Indiana/Indianapolis", "evening": {"draw": "23:00", "avail": "23:20"}},
        "KY": {"tz": "America/New_York",   "midday": {"draw": "13:20", "avail": "13:40"}, "evening": {"draw": "23:00", "avail": "23:20"}},
        "LA": {"tz": "America/Chicago",    "evening": {"draw": "21:00", "avail": "21:20"}},
        "MD": {"tz": "America/New_York",   "midday": {"draw": "12:28", "avail": "12:45"}, "evening": {"draw": "19:56", "avail": "20:10"}},
        "ME": {"tz": "America/New_York",   "evening": {"draw": "19:00", "avail": "19:20"}},
        "MI": {"tz": "America/Detroit",    "midday": {"draw": "12:59", "avail": "13:15"}, "evening": {"draw": "19:29", "avail": "19:45"}},
        "MO": {"tz": "America/Chicago",    "evening": {"draw": "20:59", "avail": "21:15"}},
        "MS": {"tz": "America/Chicago",    "midday": {"draw": "14:30", "avail": "14:50"}, "evening": {"draw": "21:30", "avail": "21:50"}},
        "NC": {"tz": "America/New_York",   "midday": {"draw": "15:00", "avail": "15:20"}, "evening": {"draw": "23:22", "avail": "23:40"}},
        "NH": {"tz": "America/New_York",   "evening": {"draw": "19:00", "avail": "19:20"}},
        "NJ": {"tz": "America/New_York",   "midday": {"draw": "12:59", "avail": "13:15"}, "evening": {"draw": "22:57", "avail": "23:10"}},
        "NY": {"tz": "America/New_York",   "midday": {"draw": "14:30", "avail": "14:50"}, "evening": {"draw": "22:30", "avail": "22:50"}},
        "OH": {"tz": "America/New_York",   "midday": {"draw": "12:29", "avail": "12:45"}, "evening": {"draw": "19:29", "avail": "19:45"}},
        "OR": {"tz": "America/Los_Angeles","evening": {"draw": "19:00", "avail": "19:20"}},
        "PA": {"tz": "America/New_York",   "midday": {"draw": "13:35", "avail": "13:50"}, "evening": {"draw": "18:59", "avail": "19:15"}},
        "SC": {"tz": "America/New_York",   "midday": {"draw": "12:59", "avail": "13:15"}, "evening": {"draw": "18:59", "avail": "19:15"}},
        "TN": {"tz": "America/Chicago",    "evening": {"draw": "18:28", "avail": "18:45"}},
        "TX": {"tz": "America/Chicago",    "evening": {"draw": "22:12", "avail": "22:30"}},
        "VA": {"tz": "America/New_York",   "midday": {"draw": "14:00", "avail": "14:20"}, "evening": {"draw": "23:00", "avail": "23:20"}},
        "VT": {"tz": "America/New_York",   "evening": {"draw": "19:00", "avail": "19:20"}},
        "WA": {"tz": "America/Los_Angeles","evening": {"draw": "20:15", "avail": "20:35"}},
        "WI": {"tz": "America/Chicago",    "evening": {"draw": "21:00", "avail": "21:20"}},
        "WV": {"tz": "America/New_York",   "evening": {"draw": "18:59", "avail": "19:15"}},
    },

    # ════════════════════════════════════════════════════════════════════════
    #  PICK 5
    # ════════════════════════════════════════════════════════════════════════
    "pick5": {
        "DE": {"tz": "America/New_York",   "midday": {"draw": "13:30", "avail": "13:50"}, "evening": {"draw": "19:30", "avail": "19:50"}},
        "FL": {"tz": "America/New_York",   "midday": {"draw": "13:30", "avail": "13:50"}, "evening": {"draw": "21:45", "avail": "22:00"}},
        "LA": {"tz": "America/Chicago",    "evening": {"draw": "21:00", "avail": "21:20"}},
        "MD": {"tz": "America/New_York",   "midday": {"draw": "12:28", "avail": "12:45"}, "evening": {"draw": "19:56", "avail": "20:10"}},
        "NE": {"tz": "America/Chicago",    "evening": {"draw": "21:20", "avail": "21:40"}},
        "OH": {"tz": "America/New_York",   "evening": {"draw": "19:29", "avail": "19:45"}},
        "PA": {"tz": "America/New_York",   "midday": {"draw": "13:35", "avail": "13:50"}, "evening": {"draw": "18:59", "avail": "19:15"}},
    },

    # ════════════════════════════════════════════════════════════════════════
    #  CASH 5 / FANTASY 5
    # ════════════════════════════════════════════════════════════════════════
    "cash5": {
        "AZ": {"tz": "America/Phoenix",    "evening": {"draw": "19:30", "avail": "19:50"}},
        "CA": {"tz": "America/Los_Angeles", "evening": {"draw": "18:30", "avail": "18:50"}},
        "CO": {"tz": "America/Denver",     "evening": {"draw": "19:35", "avail": "19:55"}},
        "CT": {"tz": "America/New_York",   "evening": {"draw": "22:38", "avail": "22:55"}},
        "FL": {"tz": "America/New_York",   "evening": {"draw": "23:15", "avail": "23:35"}},
        "GA": {"tz": "America/New_York",   "midday": {"draw": "12:29", "avail": "12:45"}, "evening": {"draw": "18:59", "avail": "19:15"}},
        "IN": {"tz": "America/Indiana/Indianapolis", "evening": {"draw": "23:00", "avail": "23:20"}},
        "MI": {"tz": "America/Detroit",    "evening": {"draw": "19:29", "avail": "19:45"}},
        "NC": {"tz": "America/New_York",   "evening": {"draw": "23:22", "avail": "23:40"}},
        "NJ": {"tz": "America/New_York",   "evening": {"draw": "22:57", "avail": "23:15"}},
        "NY": {"tz": "America/New_York",   "midday": {"draw": "14:30", "avail": "14:50"}, "evening": {"draw": "22:30", "avail": "22:50"}},
        "OH": {"tz": "America/New_York",   "evening": {"draw": "19:29", "avail": "19:45"}},
        "OK": {"tz": "America/Chicago",    "evening": {"draw": "22:00", "avail": "22:20"}},
        "PA": {"tz": "America/New_York",   "evening": {"draw": "18:59", "avail": "19:15"}},
        "SC": {"tz": "America/New_York",   "evening": {"draw": "18:59", "avail": "19:15"}},
        "TX": {"tz": "America/Chicago",    "evening": {"draw": "22:12", "avail": "22:30"}},
        "VA": {"tz": "America/New_York",   "evening": {"draw": "23:00", "avail": "23:20"}},
    },

    # ════════════════════════════════════════════════════════════════════════
    #  LOTTO (6-number state games — draw 2-3x/week)
    # ════════════════════════════════════════════════════════════════════════
    "lotto": {
        "CA": {"tz": "America/Los_Angeles", "evening": {"draw": "19:57", "avail": "20:15"}, "days": [2, 5]},          # Wed, Sat
        "FL": {"tz": "America/New_York",    "evening": {"draw": "23:15", "avail": "23:35"}, "days": [2, 5]},          # Wed, Sat
        "IL": {"tz": "America/Chicago",     "evening": {"draw": "21:22", "avail": "21:40"}, "days": [0, 3, 5]},       # Mon, Thu, Sat
        "NJ": {"tz": "America/New_York",    "evening": {"draw": "22:57", "avail": "23:15"}, "days": [0, 3]},          # Mon, Thu
        "NY": {"tz": "America/New_York",    "evening": {"draw": "20:15", "avail": "20:35"}, "days": [2, 5]},          # Wed, Sat
        "PA": {"tz": "America/New_York",    "evening": {"draw": "18:59", "avail": "19:15"}, "days": [0, 2, 5]},       # Mon, Wed, Sat
        "TX": {"tz": "America/Chicago",     "evening": {"draw": "22:12", "avail": "22:30"}, "days": [0, 3, 5]},       # Mon, Thu, Sat
    },

    # ════════════════════════════════════════════════════════════════════════
    #  POWERBALL — Mon/Wed/Sat 10:59 PM ET
    # ════════════════════════════════════════════════════════════════════════
    "powerball": {
        "US": {"tz": "America/New_York", "evening": {"draw": "22:59", "avail": "23:15"}, "days": [0, 2, 5]},  # Mon, Wed, Sat
    },

    # ════════════════════════════════════════════════════════════════════════
    #  MEGA MILLIONS — Tue/Fri 11:00 PM ET
    # ════════════════════════════════════════════════════════════════════════
    "megamillions": {
        "US": {"tz": "America/New_York", "evening": {"draw": "23:00", "avail": "23:20"}, "days": [1, 4]},  # Tue, Fri
    },
}


# ─── Helper: collect all draw events for a game, sorted by ET availability ──
def get_draw_windows(game_type: str) -> list:
    """
    Returns a list of draw windows for a game type, sorted by ET availability time.
    Each item: {state, draw_type, draw_time_local, avail_time_local, tz, days}
    """
    game_schedule = DRAW_TIMES.get(game_type, {})
    windows = []
    for state, info in game_schedule.items():
        tz = info["tz"]
        days = info.get("days")  # None = daily
        for draw_type in ("midday", "evening", "night"):
            slot = info.get(draw_type)
            if not slot:
                continue
            windows.append({
                "state": state,
                "draw_type": draw_type,
                "draw_time": slot["draw"],
                "avail_time": slot["avail"],
                "tz": tz,
                "days": days,  # None = every day
            })
    return windows


def get_all_avail_times_et() -> list:
    """
    Returns ALL draw events across ALL games, converted to ET minutes-since-midnight,
    sorted chronologically.  Used by the frontend to know when to auto-poll.
    Each: {game, state, draw_type, avail_et_hhmm, draw_et_hhmm, days}
    """
    from datetime import datetime, timedelta
    import zoneinfo

    et = zoneinfo.ZoneInfo("America/New_York")
    results = []

    for game_type, states in DRAW_TIMES.items():
        for state, info in states.items():
            local_tz = zoneinfo.ZoneInfo(info["tz"])
            days = info.get("days")
            for draw_type in ("midday", "evening", "night"):
                slot = info.get(draw_type)
                if not slot:
                    continue
                # Convert avail time from local → ET
                # Use a reference date (2026-06-15 is a Monday)
                ref = datetime(2026, 6, 15, 0, 0, 0)
                avail_h, avail_m = map(int, slot["avail"].split(":"))
                draw_h, draw_m = map(int, slot["draw"].split(":"))

                local_avail = ref.replace(hour=avail_h, minute=avail_m, tzinfo=local_tz)
                local_draw = ref.replace(hour=draw_h, minute=draw_m, tzinfo=local_tz)

                et_avail = local_avail.astimezone(et)
                et_draw = local_draw.astimezone(et)

                results.append({
                    "game": game_type,
                    "state": state,
                    "draw_type": draw_type,
                    "draw_et": f"{et_draw.hour:02d}:{et_draw.minute:02d}",
                    "avail_et": f"{et_avail.hour:02d}:{et_avail.minute:02d}",
                    "draw_local": slot["draw"],
                    "avail_local": slot["avail"],
                    "tz": info["tz"],
                    "days": days,
                })

    results.sort(key=lambda x: x["avail_et"])
    return results


def get_poll_schedule_et() -> list:
    """
    Returns deduplicated polling windows in ET — the distinct times when the
    frontend should auto-fetch, grouped by which games have new results available.

    Returns list of {avail_et, games: [{game, draw_type, states:[...]}]}
    sorted chronologically.
    """
    all_events = get_all_avail_times_et()

    # Group by avail_et (rounded to nearest 5 min for batching)
    from collections import defaultdict
    buckets = defaultdict(list)

    for evt in all_events:
        # Round avail_et to nearest 5-min window
        h, m = map(int, evt["avail_et"].split(":"))
        m5 = (m // 5) * 5
        bucket_key = f"{h:02d}:{m5:02d}"
        buckets[bucket_key].append(evt)

    schedule = []
    for time_key in sorted(buckets.keys()):
        events = buckets[time_key]
        # Group by game+draw_type
        game_groups = defaultdict(list)
        for e in events:
            game_groups[(e["game"], e["draw_type"])].append(e["state"])

        games = []
        for (game, draw_type), states in sorted(game_groups.items()):
            games.append({
                "game": game,
                "draw_type": draw_type,
                "states": sorted(states),
                "count": len(states),
            })

        schedule.append({
            "avail_et": time_key,
            "games": games,
            "total_states": sum(g["count"] for g in games),
        })

    return schedule
