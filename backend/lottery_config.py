"""
Lottery Configuration - All supported lotteries by US state/territory.
Sources: Official state lottery websites & public data sources.
"""

# Comprehensive lottery registry keyed by state abbreviation
LOTTERIES_BY_STATE = {
    "AL": [],  # Alabama: No state lottery
    "AK": [],  # Alaska: No state lottery
    "AZ": {
        "state_name": "Arizona",
        "lotteries": [
            {"id": "powerball", "name": "Powerball", "type": "multistate"},
            {"id": "mega_millions", "name": "Mega Millions", "type": "multistate"},
            {"id": "az_fantasy5", "name": "Fantasy 5", "type": "state"},
            {"id": "az_pick3", "name": "Pick 3", "type": "state"},
        ]
    },
    "AR": {
        "state_name": "Arkansas",
        "lotteries": [
            {"id": "powerball", "name": "Powerball", "type": "multistate"},
            {"id": "mega_millions", "name": "Mega Millions", "type": "multistate"},
            {"id": "ar_natural_state_jackpot", "name": "Natural State Jackpot", "type": "state"},
            {"id": "ar_cash3", "name": "Cash 3", "type": "state"},
        ]
    },
    "CA": {
        "state_name": "California",
        "lotteries": [
            {"id": "powerball", "name": "Powerball", "type": "multistate"},
            {"id": "mega_millions", "name": "Mega Millions", "type": "multistate"},
            {"id": "ca_superlotto_plus", "name": "SuperLotto Plus", "type": "state"},
            {"id": "ca_fantasy5", "name": "Fantasy 5", "type": "state"},
            {"id": "ca_daily4", "name": "Daily 4", "type": "state"},
            {"id": "ca_pick3", "name": "Daily 3", "type": "state"},
        ]
    },
    "CO": {
        "state_name": "Colorado",
        "lotteries": [
            {"id": "powerball", "name": "Powerball", "type": "multistate"},
            {"id": "mega_millions", "name": "Mega Millions", "type": "multistate"},
            {"id": "co_lotto", "name": "Colorado Lotto+", "type": "state"},
            {"id": "co_cash5", "name": "Cash 5", "type": "state"},
            {"id": "co_pick3", "name": "Pick 3", "type": "state"},
        ]
    },
    "CT": {
        "state_name": "Connecticut",
        "lotteries": [
            {"id": "powerball", "name": "Powerball", "type": "multistate"},
            {"id": "mega_millions", "name": "Mega Millions", "type": "multistate"},
            {"id": "ct_lotto", "name": "Lotto!", "type": "state"},
            {"id": "ct_cash5", "name": "Cash 5", "type": "state"},
            {"id": "ct_play3", "name": "Play 3", "type": "state"},
            {"id": "ct_play4", "name": "Play 4", "type": "state"},
        ]
    },
    "DC": {
        "state_name": "Washington D.C.",
        "lotteries": [
            {"id": "powerball", "name": "Powerball", "type": "multistate"},
            {"id": "mega_millions", "name": "Mega Millions", "type": "multistate"},
            {"id": "dc_lottery", "name": "DC-4", "type": "state"},
        ]
    },
    "DE": {
        "state_name": "Delaware",
        "lotteries": [
            {"id": "powerball", "name": "Powerball", "type": "multistate"},
            {"id": "mega_millions", "name": "Mega Millions", "type": "multistate"},
            {"id": "de_play3", "name": "Play 3", "type": "state"},
            {"id": "de_play4", "name": "Play 4", "type": "state"},
        ]
    },
    "FL": {
        "state_name": "Florida",
        "lotteries": [
            {"id": "powerball", "name": "Powerball", "type": "multistate"},
            {"id": "mega_millions", "name": "Mega Millions", "type": "multistate"},
            {"id": "fl_lotto", "name": "Florida Lotto", "type": "state"},
            {"id": "fl_fantasy5", "name": "Fantasy 5", "type": "state"},
            {"id": "fl_pick3", "name": "Pick 3", "type": "state"},
            {"id": "fl_pick4", "name": "Pick 4", "type": "state"},
            {"id": "fl_pick5", "name": "Pick 5", "type": "state"},
            {"id": "fl_cash4life", "name": "Cash4Life", "type": "multistate"},
        ]
    },
    "GA": {
        "state_name": "Georgia",
        "lotteries": [
            {"id": "powerball", "name": "Powerball", "type": "multistate"},
            {"id": "mega_millions", "name": "Mega Millions", "type": "multistate"},
            {"id": "ga_fantasy5", "name": "Fantasy 5", "type": "state"},
            {"id": "ga_cash3", "name": "Cash 3", "type": "state"},
            {"id": "ga_cash4", "name": "Cash 4", "type": "state"},
            {"id": "ga_jumbo_bucks", "name": "Jumbo Bucks Lotto", "type": "state"},
        ]
    },
    "HI": [],  # Hawaii: No state lottery
    "ID": {
        "state_name": "Idaho",
        "lotteries": [
            {"id": "powerball", "name": "Powerball", "type": "multistate"},
            {"id": "mega_millions", "name": "Mega Millions", "type": "multistate"},
            {"id": "id_weekly_grand", "name": "Weekly Grand", "type": "state"},
            {"id": "id_pick3", "name": "Pick 3", "type": "state"},
        ]
    },
    "IL": {
        "state_name": "Illinois",
        "lotteries": [
            {"id": "powerball", "name": "Powerball", "type": "multistate"},
            {"id": "mega_millions", "name": "Mega Millions", "type": "multistate"},
            {"id": "il_lotto", "name": "Lotto", "type": "state"},
            {"id": "il_lucky_day_lotto", "name": "Lucky Day Lotto", "type": "state"},
            {"id": "il_pick3", "name": "Pick 3", "type": "state"},
            {"id": "il_pick4", "name": "Pick 4", "type": "state"},
        ]
    },
    "IN": {
        "state_name": "Indiana",
        "lotteries": [
            {"id": "powerball", "name": "Powerball", "type": "multistate"},
            {"id": "mega_millions", "name": "Mega Millions", "type": "multistate"},
            {"id": "in_hoosier_lotto", "name": "Hoosier Lotto", "type": "state"},
            {"id": "in_cash5", "name": "Cash 5", "type": "state"},
            {"id": "in_daily3", "name": "Daily 3", "type": "state"},
            {"id": "in_daily4", "name": "Daily 4", "type": "state"},
        ]
    },
    "IA": {
        "state_name": "Iowa",
        "lotteries": [
            {"id": "powerball", "name": "Powerball", "type": "multistate"},
            {"id": "mega_millions", "name": "Mega Millions", "type": "multistate"},
            {"id": "ia_pick3", "name": "Pick 3", "type": "state"},
            {"id": "ia_pick4", "name": "Pick 4", "type": "state"},
        ]
    },
    "KS": {
        "state_name": "Kansas",
        "lotteries": [
            {"id": "powerball", "name": "Powerball", "type": "multistate"},
            {"id": "mega_millions", "name": "Mega Millions", "type": "multistate"},
            {"id": "ks_pick3", "name": "Pick 3", "type": "state"},
            {"id": "ks_super_kansas_cash", "name": "Super Kansas Cash", "type": "state"},
        ]
    },
    "KY": {
        "state_name": "Kentucky",
        "lotteries": [
            {"id": "powerball", "name": "Powerball", "type": "multistate"},
            {"id": "mega_millions", "name": "Mega Millions", "type": "multistate"},
            {"id": "ky_keno", "name": "Keno", "type": "state"},
            {"id": "ky_pick3", "name": "Pick 3", "type": "state"},
            {"id": "ky_pick4", "name": "Pick 4", "type": "state"},
        ]
    },
    "LA": {
        "state_name": "Louisiana",
        "lotteries": [
            {"id": "powerball", "name": "Powerball", "type": "multistate"},
            {"id": "mega_millions", "name": "Mega Millions", "type": "multistate"},
            {"id": "la_lotto", "name": "Lotto", "type": "state"},
            {"id": "la_easy5", "name": "Easy 5", "type": "state"},
            {"id": "la_pick3", "name": "Pick 3", "type": "state"},
            {"id": "la_pick4", "name": "Pick 4", "type": "state"},
            {"id": "la_pick5", "name": "Pick 5", "type": "state"},
        ]
    },
    "ME": {
        "state_name": "Maine",
        "lotteries": [
            {"id": "powerball", "name": "Powerball", "type": "multistate"},
            {"id": "mega_millions", "name": "Mega Millions", "type": "multistate"},
            {"id": "me_megabucks_plus", "name": "Megabucks Plus", "type": "state"},
            {"id": "me_pick3", "name": "Pick 3", "type": "state"},
            {"id": "me_pick4", "name": "Pick 4", "type": "state"},
        ]
    },
    "MD": {
        "state_name": "Maryland",
        "lotteries": [
            {"id": "powerball", "name": "Powerball", "type": "multistate"},
            {"id": "mega_millions", "name": "Mega Millions", "type": "multistate"},
            {"id": "md_multimatch", "name": "Multi-Match", "type": "state"},
            {"id": "md_cash4life", "name": "Cash4Life", "type": "multistate"},
            {"id": "md_pick3", "name": "Pick 3", "type": "state"},
            {"id": "md_pick4", "name": "Pick 4", "type": "state"},
            {"id": "md_pick5", "name": "Pick 5", "type": "state"},
        ]
    },
    "MA": {
        "state_name": "Massachusetts",
        "lotteries": [
            {"id": "powerball", "name": "Powerball", "type": "multistate"},
            {"id": "mega_millions", "name": "Mega Millions", "type": "multistate"},
            {"id": "ma_megabucks_doubler", "name": "Megabucks Doubler", "type": "state"},
            {"id": "ma_masscash", "name": "Mass Cash", "type": "state"},
            {"id": "ma_numbers", "name": "The Numbers Game", "type": "state"},
        ]
    },
    "MI": {
        "state_name": "Michigan",
        "lotteries": [
            {"id": "powerball", "name": "Powerball", "type": "multistate"},
            {"id": "mega_millions", "name": "Mega Millions", "type": "multistate"},
            {"id": "mi_lotto47", "name": "Lotto 47", "type": "state"},
            {"id": "mi_fantasy5", "name": "Fantasy 5", "type": "state"},
            {"id": "mi_daily3", "name": "Daily 3", "type": "state"},
            {"id": "mi_daily4", "name": "Daily 4", "type": "state"},
            {"id": "mi_keno", "name": "Club Keno", "type": "state"},
        ]
    },
    "MN": {
        "state_name": "Minnesota",
        "lotteries": [
            {"id": "powerball", "name": "Powerball", "type": "multistate"},
            {"id": "mega_millions", "name": "Mega Millions", "type": "multistate"},
            {"id": "mn_northstar_cash", "name": "Northstar Cash", "type": "state"},
            {"id": "mn_gopher5", "name": "Gopher 5", "type": "state"},
            {"id": "mn_pick3", "name": "Pick 3", "type": "state"},
        ]
    },
    "MS": {
        "state_name": "Mississippi",
        "lotteries": [
            {"id": "powerball", "name": "Powerball", "type": "multistate"},
            {"id": "mega_millions", "name": "Mega Millions", "type": "multistate"},
            {"id": "ms_msplay3", "name": "MS Play 3", "type": "state"},
            {"id": "ms_msplay4", "name": "MS Play 4", "type": "state"},
        ]
    },
    "MO": {
        "state_name": "Missouri",
        "lotteries": [
            {"id": "powerball", "name": "Powerball", "type": "multistate"},
            {"id": "mega_millions", "name": "Mega Millions", "type": "multistate"},
            {"id": "mo_show_me_cash", "name": "Show Me Cash", "type": "state"},
            {"id": "mo_pick3", "name": "Pick 3", "type": "state"},
            {"id": "mo_pick4", "name": "Pick 4", "type": "state"},
        ]
    },
    "MT": {
        "state_name": "Montana",
        "lotteries": [
            {"id": "powerball", "name": "Powerball", "type": "multistate"},
            {"id": "mega_millions", "name": "Mega Millions", "type": "multistate"},
            {"id": "mt_montana_cash", "name": "Montana Cash", "type": "state"},
        ]
    },
    "NE": {
        "state_name": "Nebraska",
        "lotteries": [
            {"id": "powerball", "name": "Powerball", "type": "multistate"},
            {"id": "mega_millions", "name": "Mega Millions", "type": "multistate"},
            {"id": "ne_pick3", "name": "Pick 3", "type": "state"},
            {"id": "ne_pick5", "name": "Pick 5", "type": "state"},
        ]
    },
    "NV": [],  # Nevada: No state lottery
    "NH": {
        "state_name": "New Hampshire",
        "lotteries": [
            {"id": "powerball", "name": "Powerball", "type": "multistate"},
            {"id": "mega_millions", "name": "Mega Millions", "type": "multistate"},
            {"id": "nh_gimme5", "name": "Gimme 5", "type": "state"},
            {"id": "nh_pick3", "name": "Pick 3", "type": "state"},
            {"id": "nh_pick4", "name": "Pick 4", "type": "state"},
        ]
    },
    "NJ": {
        "state_name": "New Jersey",
        "lotteries": [
            {"id": "powerball", "name": "Powerball", "type": "multistate"},
            {"id": "mega_millions", "name": "Mega Millions", "type": "multistate"},
            {"id": "nj_jersey_cash5", "name": "Jersey Cash 5", "type": "state"},
            {"id": "nj_cash4life", "name": "Cash4Life", "type": "multistate"},
            {"id": "nj_pick3", "name": "Pick-3", "type": "state"},
            {"id": "nj_pick4", "name": "Pick-4", "type": "state"},
            {"id": "nj_pick6", "name": "Pick-6", "type": "state"},
        ]
    },
    "NM": {
        "state_name": "New Mexico",
        "lotteries": [
            {"id": "powerball", "name": "Powerball", "type": "multistate"},
            {"id": "mega_millions", "name": "Mega Millions", "type": "multistate"},
            {"id": "nm_roadrunner_cash", "name": "Roadrunner Cash", "type": "state"},
            {"id": "nm_pick3", "name": "Pick 3", "type": "state"},
        ]
    },
    "NY": {
        "state_name": "New York",
        "lotteries": [
            {"id": "powerball", "name": "Powerball", "type": "multistate"},
            {"id": "mega_millions", "name": "Mega Millions", "type": "multistate"},
            {"id": "ny_lotto", "name": "New York Lotto", "type": "state"},
            {"id": "ny_numbers", "name": "Numbers", "type": "state"},
            {"id": "ny_win4", "name": "Win 4", "type": "state"},
            {"id": "ny_take5", "name": "Take 5", "type": "state"},
            {"id": "ny_cash4life", "name": "Cash4Life", "type": "multistate"},
            {"id": "ny_pick10", "name": "Pick 10", "type": "state"},
        ]
    },
    "NC": {
        "state_name": "North Carolina",
        "lotteries": [
            {"id": "powerball", "name": "Powerball", "type": "multistate"},
            {"id": "mega_millions", "name": "Mega Millions", "type": "multistate"},
            {"id": "nc_cash5", "name": "Cash 5", "type": "state"},
            {"id": "nc_pick3", "name": "Pick 3", "type": "state"},
            {"id": "nc_pick4", "name": "Pick 4", "type": "state"},
        ]
    },
    "ND": {
        "state_name": "North Dakota",
        "lotteries": [
            {"id": "powerball", "name": "Powerball", "type": "multistate"},
            {"id": "mega_millions", "name": "Mega Millions", "type": "multistate"},
            {"id": "nd_2by2", "name": "2by2", "type": "state"},
        ]
    },
    "OH": {
        "state_name": "Ohio",
        "lotteries": [
            {"id": "powerball", "name": "Powerball", "type": "multistate"},
            {"id": "mega_millions", "name": "Mega Millions", "type": "multistate"},
            {"id": "oh_classic_lotto", "name": "Classic Lotto", "type": "state"},
            {"id": "oh_rolling_cash5", "name": "Rolling Cash 5", "type": "state"},
            {"id": "oh_pick3", "name": "Pick 3", "type": "state"},
            {"id": "oh_pick4", "name": "Pick 4", "type": "state"},
            {"id": "oh_pick5", "name": "Pick 5", "type": "state"},
        ]
    },
    "OK": {
        "state_name": "Oklahoma",
        "lotteries": [
            {"id": "powerball", "name": "Powerball", "type": "multistate"},
            {"id": "mega_millions", "name": "Mega Millions", "type": "multistate"},
            {"id": "ok_cash5", "name": "Cash 5", "type": "state"},
            {"id": "ok_pick3", "name": "Pick 3", "type": "state"},
        ]
    },
    "OR": {
        "state_name": "Oregon",
        "lotteries": [
            {"id": "powerball", "name": "Powerball", "type": "multistate"},
            {"id": "mega_millions", "name": "Mega Millions", "type": "multistate"},
            {"id": "or_megabucks", "name": "Megabucks", "type": "state"},
            {"id": "or_win_for_life", "name": "Win for Life", "type": "state"},
            {"id": "or_pick4", "name": "Pick 4", "type": "state"},
        ]
    },
    "PA": {
        "state_name": "Pennsylvania",
        "lotteries": [
            {"id": "powerball", "name": "Powerball", "type": "multistate"},
            {"id": "mega_millions", "name": "Mega Millions", "type": "multistate"},
            {"id": "pa_cash5", "name": "Cash 5", "type": "state"},
            {"id": "pa_match6", "name": "Match 6 Lotto", "type": "state"},
            {"id": "pa_pick2", "name": "Pick 2", "type": "state"},
            {"id": "pa_pick3", "name": "Pick 3", "type": "state"},
            {"id": "pa_pick4", "name": "Pick 4", "type": "state"},
            {"id": "pa_pick5", "name": "Pick 5", "type": "state"},
            {"id": "pa_cash4life", "name": "Cash4Life", "type": "multistate"},
        ]
    },
    "RI": {
        "state_name": "Rhode Island",
        "lotteries": [
            {"id": "powerball", "name": "Powerball", "type": "multistate"},
            {"id": "mega_millions", "name": "Mega Millions", "type": "multistate"},
            {"id": "ri_wild_money", "name": "Wild Money", "type": "state"},
            {"id": "ri_numbers", "name": "The Numbers", "type": "state"},
        ]
    },
    "SC": {
        "state_name": "South Carolina",
        "lotteries": [
            {"id": "powerball", "name": "Powerball", "type": "multistate"},
            {"id": "mega_millions", "name": "Mega Millions", "type": "multistate"},
            {"id": "sc_palmetto_cash5", "name": "Palmetto Cash 5", "type": "state"},
            {"id": "sc_pick3", "name": "Pick 3", "type": "state"},
            {"id": "sc_pick4", "name": "Pick 4", "type": "state"},
        ]
    },
    "SD": {
        "state_name": "South Dakota",
        "lotteries": [
            {"id": "powerball", "name": "Powerball", "type": "multistate"},
            {"id": "mega_millions", "name": "Mega Millions", "type": "multistate"},
            {"id": "sd_dakota_cash", "name": "Dakota Cash", "type": "state"},
            {"id": "sd_pick3", "name": "Pick 3", "type": "state"},
        ]
    },
    "TN": {
        "state_name": "Tennessee",
        "lotteries": [
            {"id": "powerball", "name": "Powerball", "type": "multistate"},
            {"id": "mega_millions", "name": "Mega Millions", "type": "multistate"},
            {"id": "tn_cash4life", "name": "Cash4Life", "type": "multistate"},
            {"id": "tn_tennessee_cash", "name": "Tennessee Cash", "type": "state"},
            {"id": "tn_pick3", "name": "Pick 3", "type": "state"},
            {"id": "tn_pick4", "name": "Pick 4", "type": "state"},
        ]
    },
    "TX": {
        "state_name": "Texas",
        "lotteries": [
            {"id": "powerball", "name": "Powerball", "type": "multistate"},
            {"id": "mega_millions", "name": "Mega Millions", "type": "multistate"},
            {"id": "tx_lotto_texas", "name": "Lotto Texas", "type": "state"},
            {"id": "tx_texas_two_step", "name": "Texas Two Step", "type": "state"},
            {"id": "tx_pick3", "name": "Pick 3", "type": "state"},
            {"id": "tx_daily4", "name": "Daily 4", "type": "state"},
            {"id": "tx_cash5", "name": "Cash 5", "type": "state"},
            {"id": "tx_all_or_nothing", "name": "All or Nothing", "type": "state"},
        ]
    },
    "UT": [],  # Utah: No state lottery
    "VT": {
        "state_name": "Vermont",
        "lotteries": [
            {"id": "powerball", "name": "Powerball", "type": "multistate"},
            {"id": "mega_millions", "name": "Mega Millions", "type": "multistate"},
            {"id": "vt_gimme5", "name": "Gimme 5", "type": "state"},
            {"id": "vt_pick3", "name": "Pick 3", "type": "state"},
            {"id": "vt_pick4", "name": "Pick 4", "type": "state"},
        ]
    },
    "VA": {
        "state_name": "Virginia",
        "lotteries": [
            {"id": "powerball", "name": "Powerball", "type": "multistate"},
            {"id": "mega_millions", "name": "Mega Millions", "type": "multistate"},
            {"id": "va_cash5", "name": "Cash 5", "type": "state"},
            {"id": "va_pick3", "name": "Pick 3", "type": "state"},
            {"id": "va_pick4", "name": "Pick 4", "type": "state"},
            {"id": "va_cash4life", "name": "Cash4Life", "type": "multistate"},
        ]
    },
    "WA": {
        "state_name": "Washington",
        "lotteries": [
            {"id": "powerball", "name": "Powerball", "type": "multistate"},
            {"id": "mega_millions", "name": "Mega Millions", "type": "multistate"},
            {"id": "wa_lotto", "name": "Lotto", "type": "state"},
            {"id": "wa_hit5", "name": "Hit 5", "type": "state"},
            {"id": "wa_match4", "name": "Match 4", "type": "state"},
            {"id": "wa_daily_game", "name": "Daily Game", "type": "state"},
        ]
    },
    "WV": {
        "state_name": "West Virginia",
        "lotteries": [
            {"id": "powerball", "name": "Powerball", "type": "multistate"},
            {"id": "mega_millions", "name": "Mega Millions", "type": "multistate"},
            {"id": "wv_cash25", "name": "Cash 25", "type": "state"},
            {"id": "wv_daily3", "name": "Daily 3", "type": "state"},
            {"id": "wv_daily4", "name": "Daily 4", "type": "state"},
        ]
    },
    "WI": {
        "state_name": "Wisconsin",
        "lotteries": [
            {"id": "powerball", "name": "Powerball", "type": "multistate"},
            {"id": "mega_millions", "name": "Mega Millions", "type": "multistate"},
            {"id": "wi_badger5", "name": "Badger 5", "type": "state"},
            {"id": "wi_supercash", "name": "SuperCash!", "type": "state"},
            {"id": "wi_pick3", "name": "Pick 3", "type": "state"},
            {"id": "wi_pick4", "name": "Pick 4", "type": "state"},
        ]
    },
    "WY": {
        "state_name": "Wyoming",
        "lotteries": [
            {"id": "powerball", "name": "Powerball", "type": "multistate"},
            {"id": "mega_millions", "name": "Mega Millions", "type": "multistate"},
            {"id": "wy_cowboy_draw", "name": "Cowboy Draw", "type": "state"},
        ]
    },
}

# Scraper source mapping - maps lottery ID to scraping source
LOTTERY_SOURCES = {
    "powerball": {
        "name": "Powerball",
        "source": "lotto_net",
        "url": "https://www.lotto.net/powerball/numbers/{year}",
        "balls": ["Ball_1", "Ball_2", "Ball_3", "Ball_4", "Ball_5"],
        "bonus_balls": ["Powerball"],
        "state": "Multi-State",
    },
    "mega_millions": {
        "name": "Mega Millions",
        "source": "lotto_net",
        "url": "https://www.lotto.net/mega-millions/numbers/{year}",
        "balls": ["Ball_1", "Ball_2", "Ball_3", "Ball_4", "Ball_5"],
        "bonus_balls": ["Mega Ball"],
        "state": "Multi-State",
    },
    "ny_lotto": {
        "name": "New York Lotto",
        "source": "ny_open_data",
        "url": "https://data.ny.gov/resource/6nbc-h7bj.json",
        "balls": ["Ball_1", "Ball_2", "Ball_3", "Ball_4", "Ball_5", "Ball_6"],
        "bonus_balls": ["Bonus"],
        "state": "New York",
    },
    "ny_numbers": {
        "name": "New York Numbers",
        "source": "ny_open_data",
        "url": "https://data.ny.gov/resource/vmqe-9k7b.json",
        "balls": ["Ball_1", "Ball_2", "Ball_3"],
        "bonus_balls": [],
        "state": "New York",
    },
    "ny_win4": {
        "name": "Win 4",
        "source": "ny_open_data",
        "url": "https://data.ny.gov/resource/58de-axaz.json",
        "balls": ["Ball_1", "Ball_2", "Ball_3", "Ball_4"],
        "bonus_balls": [],
        "state": "New York",
    },
    "ny_take5": {
        "name": "Take 5",
        "source": "ny_open_data",
        "url": "https://data.ny.gov/resource/dg63-4siq.json",
        "balls": ["Ball_1", "Ball_2", "Ball_3", "Ball_4", "Ball_5"],
        "bonus_balls": [],
        "state": "New York",
    },
    "ca_superlotto_plus": {
        "name": "SuperLotto Plus",
        "source": "lotto_net",
        "url": "https://www.lotto.net/superlotto-plus/numbers/{year}",
        "balls": ["Ball_1", "Ball_2", "Ball_3", "Ball_4", "Ball_5"],
        "bonus_balls": ["Mega"],
        "state": "California",
    },
    "fl_lotto": {
        "name": "Florida Lotto",
        "source": "lotto_net",
        "url": "https://www.lotto.net/florida-lotto/numbers/{year}",
        "balls": ["Ball_1", "Ball_2", "Ball_3", "Ball_4", "Ball_5", "Ball_6"],
        "bonus_balls": [],
        "state": "Florida",
    },
    "tx_lotto_texas": {
        "name": "Lotto Texas",
        "source": "lotto_net",
        "url": "https://www.lotto.net/lotto-texas/numbers/{year}",
        "balls": ["Ball_1", "Ball_2", "Ball_3", "Ball_4", "Ball_5", "Ball_6"],
        "bonus_balls": [],
        "state": "Texas",
    },
    "pa_cash5": {
        "name": "Cash 5",
        "source": "lotto_net",
        "url": "https://www.lotto.net/pa-cash-5/numbers/{year}",
        "balls": ["Ball_1", "Ball_2", "Ball_3", "Ball_4", "Ball_5"],
        "bonus_balls": [],
        "state": "Pennsylvania",
    },
}

# State code to state name mapping
STATE_NAMES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas",
    "CA": "California", "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware",
    "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho",
    "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas",
    "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
    "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi",
    "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
    "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York",
    "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma",
    "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina",
    "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah",
    "VT": "Vermont", "VA": "Virginia", "WA": "Washington", "WV": "West Virginia",
    "WI": "Wisconsin", "WY": "Wyoming", "DC": "Washington D.C.",
}
