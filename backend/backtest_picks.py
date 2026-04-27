#!/usr/bin/env python3
"""
Full 1000-draw walk-forward backtest for CA Daily 3 and Daily 4.
Tests 18 configurations, compares to random, and produces tuned predictions.
"""
import json, random, math, sys
from collections import Counter, defaultdict
from datetime import date

# ── Load data ──────────────────────────────────────────────────────────────────
data = json.load(open("/tmp/ca_picks.json"))

def load_game(key, ball_cols):
    """Return list of (date_str, [digits]) sorted oldest→newest."""
    rows = sorted(data[key], key=lambda r: r["Date"])
    out = []
    for r in rows:
        digits = []
        for c in ball_cols:
            v = r.get(c, "").strip()
            if v != "":
                try:
                    digits.append(int(v))
                except ValueError:
                    pass
        if len(digits) == len(ball_cols):
            out.append((r["Date"], digits))
    return out

GAMES = {
    "Daily 3 Evening": {
        "key": "p3e",
        "balls": ["Ball_1","Ball_2","Ball_3"],
        "n": 3,
        "pool": list(range(10)),
    },
    "Daily 3 Midday": {
        "key": "p3m",
        "balls": ["Ball_1","Ball_2","Ball_3"],
        "n": 3,
        "pool": list(range(10)),
    },
    "Daily 4": {
        "key": "p4",
        "balls": ["Ball_1","Ball_2","Ball_3","Ball_4"],
        "n": 4,
        "pool": list(range(10)),
    },
}

# ── Prediction engine ──────────────────────────────────────────────────────────
def score_digits(history_draws, n_balls, w_freq, w_due, w_pair, decay, top_k):
    """
    Compute composite scores for each digit 0-9 per position.
    Returns list of n_balls dicts: {digit: score}
    """
    N = len(history_draws)
    if N == 0:
        return [{d: 1.0 for d in range(10)} for _ in range(n_balls)]

    # Per-position frequency & recency
    pos_scores = []
    for pos in range(n_balls):
        freq = Counter()
        recency = {}   # digit -> draws since last seen (0 = most recent)
        for i, (_, balls) in enumerate(history_draws):
            age = N - 1 - i  # 0 = most recent
            w = math.exp(-decay * age)
            d = balls[pos]
            freq[d] += w
            if d not in recency or recency[d] > age:
                recency[d] = age

        max_freq = max(freq.values()) if freq else 1
        # due score: more overdue = higher score
        max_due = max(recency.values()) if recency else 1
        scores = {}
        for d in range(10):
            f = freq.get(d, 0) / max_freq
            due = recency.get(d, N) / max(max_due, 1)
            scores[d] = w_freq * f + w_due * (1 - due)  # invert: high due = high score
        pos_scores.append(scores)

    # Pair co-occurrence (global, not per-position for pick games)
    if w_pair > 0 and n_balls >= 2:
        pair_freq = Counter()
        for _, balls in history_draws:
            for i in range(len(balls)):
                for j in range(i+1, len(balls)):
                    pair_freq[(balls[i], balls[j])] += 1
        if pair_freq:
            max_pf = max(pair_freq.values())
            # distribute pair score to each digit
            digit_pair = Counter()
            for (a, b), cnt in pair_freq.items():
                digit_pair[a] += cnt / max_pf
                digit_pair[b] += cnt / max_pf
            max_dp = max(digit_pair.values()) if digit_pair else 1
            for pos in range(n_balls):
                for d in range(10):
                    pos_scores[pos][d] += w_pair * digit_pair.get(d, 0) / max_dp

    # Normalize per position
    for pos in range(n_balls):
        total = sum(pos_scores[pos].values())
        if total > 0:
            for d in pos_scores[pos]:
                pos_scores[pos][d] /= total

    return pos_scores

def pick_top_k(pos_scores, top_k):
    """Return list of n_balls lists, each with top_k digit choices."""
    return [
        sorted(pos_scores[pos], key=lambda d: pos_scores[pos][d], reverse=True)[:top_k]
        for pos in range(len(pos_scores))
    ]

def count_hits(actual, top_choices):
    """Count how many positions the model has the actual digit in its top-k list."""
    hits = 0
    for pos, digit in enumerate(actual):
        if digit in top_choices[pos]:
            hits += 1
    return hits

def random_top_k(pool, n_balls, top_k):
    return [random.sample(pool, min(top_k, len(pool))) for _ in range(n_balls)]

# ── Config grid ───────────────────────────────────────────────────────────────
CONFIGS = []
for w_freq, w_due, w_pair in [(0.5, 0.3, 0.2), (0.6, 0.3, 0.1), (0.4, 0.4, 0.2),
                               (0.7, 0.2, 0.1), (0.5, 0.4, 0.1), (0.6, 0.2, 0.2)]:
    for decay in [0.010, 0.020, 0.030]:
        for top_k in [3, 5]:
            CONFIGS.append({
                "label": f"f{w_freq:.1f}_d{w_due:.1f}_p{w_pair:.1f}_dc{decay}_k{top_k}",
                "w_freq": w_freq, "w_due": w_due, "w_pair": w_pair,
                "decay": decay, "top_k": top_k
            })

WARMUP = 200        # minimum history before predicting
N_RANDOM_TRIALS = 5
N_DRAWS = 1000      # number of walk-forward steps to evaluate

all_results = {}

for game_name, ginfo in GAMES.items():
    draws = load_game(ginfo["key"], ginfo["balls"])
    n_balls = ginfo["n"]
    pool = ginfo["pool"]

    total_draws = len(draws)
    test_start = max(WARMUP, total_draws - N_DRAWS)
    test_draws = draws[test_start:]
    n_test = len(test_draws)

    print(f"\n{'='*60}")
    print(f"Game: {game_name}  |  Total draws: {total_draws}  |  Testing on last {n_test}")
    print(f"{'='*60}")
    sys.stdout.flush()

    best_cfg = None
    best_avg = -1

    config_results = []
    for cfg in CONFIGS:
        total_hits = 0
        all_hit_count = 0
        hit_dist = Counter()
        rand_total_hits = 0

        for i, (dt, actual) in enumerate(test_draws):
            history = draws[:test_start + i]
            if len(history) < WARMUP:
                continue

            ps = score_digits(history, n_balls, cfg["w_freq"], cfg["w_due"],
                              cfg["w_pair"], cfg["decay"], cfg["top_k"])
            top_choices = pick_top_k(ps, cfg["top_k"])
            hits = count_hits(actual, top_choices)
            total_hits += hits
            hit_dist[hits] += 1
            if hits == n_balls:
                all_hit_count += 1

            for _ in range(N_RANDOM_TRIALS):
                rc = random_top_k(pool, n_balls, cfg["top_k"])
                rand_total_hits += count_hits(actual, rc) / N_RANDOM_TRIALS

        evaluated = sum(hit_dist.values())
        if evaluated == 0:
            continue

        model_avg = total_hits / evaluated
        rand_avg = rand_total_hits / evaluated
        model_all_pct = 100 * all_hit_count / evaluated

        # expected random all-hit probability
        p_hit_per_pos = cfg["top_k"] / 10.0
        expected_random_all = 100 * (p_hit_per_pos ** n_balls)

        r = {
            "label": cfg["label"],
            "w_freq": cfg["w_freq"], "w_due": cfg["w_due"],
            "w_pair": cfg["w_pair"], "decay": cfg["decay"],
            "top_k": cfg["top_k"],
            "evaluated": evaluated,
            "model_avg_hits": round(model_avg, 4),
            "random_avg_hits": round(rand_avg, 4),
            "expected_random_avg": round(n_balls * p_hit_per_pos, 4),
            "model_all_hit_pct": round(model_all_pct, 2),
            "expected_random_all_pct": round(expected_random_all, 4),
            "lift_all_pct": round(model_all_pct - expected_random_all, 4),
            "hit_dist": dict(sorted(hit_dist.items())),
        }
        config_results.append(r)

        if model_all_pct > best_avg:
            best_avg = model_all_pct
            best_cfg = r

        print(f"  {cfg['label']:42s}  avg={model_avg:.3f}  rand={rand_avg:.3f}  "
              f"all-hit%={model_all_pct:.2f}%  lift={r['lift_all_pct']:+.2f}%")
        sys.stdout.flush()

    # Sort by all-hit pct
    config_results.sort(key=lambda x: x["model_all_hit_pct"], reverse=True)
    top5 = config_results[:5]

    print(f"\n  ★ BEST: {best_cfg['label']}  all-hit%={best_cfg['model_all_hit_pct']:.2f}%"
          f"  (expected random: {best_cfg['expected_random_all_pct']:.2f}%)")
    print(f"    avg hits: {best_cfg['model_avg_hits']}  rand avg: {best_cfg['random_avg_hits']}")

    all_results[game_name] = {
        "draws_total": total_draws,
        "draws_tested": n_test,
        "best_config": best_cfg,
        "top5_configs": top5,
        "all_configs": config_results,
    }

# ── Now generate tuned predictions for next draw ──────────────────────────────
print("\n" + "="*60)
print("TUNED PREDICTIONS FOR NEXT DRAW  (03/06/2026)")
print("="*60)

predictions = {}

for game_name, ginfo in GAMES.items():
    draws = load_game(ginfo["key"], ginfo["balls"])
    n_balls = ginfo["n"]
    pool = ginfo["pool"]
    best = all_results[game_name]["best_config"]

    # Use all available history
    ps = score_digits(draws, n_balls, best["w_freq"], best["w_due"],
                      best["w_pair"], best["decay"], best["top_k"])
    top_choices = pick_top_k(ps, best["top_k"])

    # Rank digits per position
    ranked = [sorted(range(10), key=lambda d: ps[pos][d], reverse=True) for pos in range(n_balls)]

    # Build combo suggestions
    # Combo 1: #1 ranked per position (straight)
    c1 = [ranked[pos][0] for pos in range(n_balls)]
    # Combo 2: use #2 for position with second-highest entropy
    c2 = [ranked[pos][1] if pos == 1 else ranked[pos][0] for pos in range(n_balls)]
    # Combo 3: mix overdue with hot
    c3 = [ranked[pos][2 if pos == 0 else 0] for pos in range(n_balls)]
    # Top-k box candidates
    box = sorted(set(d for pos_list in top_choices for d in pos_list))

    # Overdue digits per position
    overdue = []
    for pos in range(n_balls):
        last_seen = {}
        for i, (_, balls) in enumerate(reversed(draws)):
            age = i
            d = balls[pos]
            if d not in last_seen:
                last_seen[d] = age
        overdue_pos = sorted(range(10), key=lambda d: last_seen.get(d, 9999), reverse=True)
        overdue.append(overdue_pos[:3])

    print(f"\n  {game_name}")
    print(f"    Config: {best['label']}")
    print(f"    Top-k per position: {top_choices}")
    print(f"    Ranked #1 per position: {[ranked[pos][0] for pos in range(n_balls)]}")
    print(f"    Most overdue per pos:   {overdue}")
    print(f"    Suggested Straight #1:  {'-'.join(map(str,c1))}")
    print(f"    Suggested Straight #2:  {'-'.join(map(str,c2))}")
    print(f"    Suggested Straight #3:  {'-'.join(map(str,c3))}")
    print(f"    Box digits pool:        {box}")
    print(f"    Backtest all-hit%:      {best['model_all_hit_pct']:.2f}%  "
          f"(expected random: {best['expected_random_all_pct']:.2f}%)")
    print(f"    Hit distribution: {best['hit_dist']}")

    predictions[game_name] = {
        "best_config": best["label"],
        "backtest_all_hit_pct": best["model_all_hit_pct"],
        "expected_random_all_pct": best["expected_random_all_pct"],
        "lift_pct": best["lift_all_pct"],
        "top_choices_per_pos": top_choices,
        "ranked_per_pos": [ranked[pos][:5] for pos in range(n_balls)],
        "overdue_per_pos": overdue,
        "combo_1_straight": c1,
        "combo_2_straight": c2,
        "combo_3_straight": c3,
        "box_pool": box,
        "hit_distribution": best["hit_dist"],
    }

# Save full results
output = {"backtest": all_results, "predictions": predictions}
json.dump(output, open("/tmp/pick3_pick4_backtest.json", "w"), indent=2)
print("\n\nResults saved → /tmp/pick3_pick4_backtest.json")
