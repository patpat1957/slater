/**
 * LotteryOptimizerEngine.js
 * Pure JavaScript lottery optimizer engine — zero DOM dependencies.
 * Extracted from lotto-scoreboard.html and ported to ES modules.
 *
 * ML features:
 *   - Temporal decay (λ=0.02) — recent draws weighted more heavily
 *   - F1-score calibration for SA/FA level selection
 *   - Skip/overdue bonus in scoreCombo
 *   - Positional Naïve-Bayes bonus
 *   - Pair co-occurrence bonus
 *
 * V2 UPGRADE — Coverage-Maximizing Prediction System:
 *   - Zone-based coverage: divides number pool into zones, ensures all zones represented
 *   - Diversity-enforced pred5: lines are selected to MINIMIZE overlap, MAXIMIZE coverage
 *   - Pattern-level learning: learns ideal gap structure, range spread, sum clusters
 *   - Adaptive generation: uses historical draw patterns to shape combo structure
 *   - Coverage scoring: rewards sets of 5 lines that collectively cover more of the pool
 */

// ── Prime digits (0-9 scope): 2,3,5,7
export const PRIME_DIGITS = new Set([2, 3, 5, 7]);
// ── Low digits: 0-4, High: 5-9
export const LOW_DIGITS = new Set([0, 1, 2, 3, 4]);

// ════════════════════════════════════════════════════════════════════════════
//  PDF OPTIMIZER STRATEGIES — 20 mathematical/statistical lottery rules
//  Source: "Tips - Lottery Optimizer.pdf"
// ════════════════════════════════════════════════════════════════════════════

// ── 1. AC (Arithmetic Complexity) Value ─────────────────────────────────
/**
 * Compute AC (Arithmetic Complexity) for a sorted combination.
 * AC = count of unique absolute differences between all pairs, minus (n-1).
 * PDF Rule: AC value should be between 7 and 10 for 5-number games (like Mega Millions).
 * For 6-number games, AC should be 7-15. For smaller games, scale accordingly.
 * @param {number[]} combo - sorted array of numbers
 * @returns {number} AC value
 */
export function computeACValue(combo) {
  const sorted = [...combo].map(Number).sort((a, b) => a - b);
  const diffs = new Set();
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      diffs.add(Math.abs(sorted[j] - sorted[i]));
    }
  }
  return diffs.size - (sorted.length - 1);
}

/**
 * Get the valid AC range for a given game configuration.
 * Max possible AC = C(n,2) - (n-1). For n=5: max=6, n=6: max=10.
 * PDF Rule "AC 7-10" applies to 6-number games (6/49 etc.).
 * For 5-number games (Mega Millions, Powerball), ideal AC = 4-6.
 * For 4-number games, ideal AC = 2-3. For 3, AC = 0-2.
 * We target the top 60-100% of the AC range (high complexity preferred).
 */
export function getACRange(n) {
  // Max AC = C(n,2) - (n-1)
  const maxAC = (n * (n - 1)) / 2 - (n - 1);
  if (n <= 3) return { min: 0, max: maxAC };          // max=2
  if (n === 4) return { min: 1, max: maxAC };          // max=3, ideal 1-3
  if (n === 5) return { min: 4, max: maxAC };           // max=6, ideal 4-6
  if (n >= 6) return { min: 7, max: maxAC };            // max=10+, ideal 7+
  return { min: Math.floor(maxAC * 0.6), max: maxAC };
}

// ── 2. Enhanced Skip Analysis (SA4 max 12, SA5 max 18-19) ──────────────
/**
 * Compute per-number skip values (draws since last appearance).
 * PDF Rule: SA4 max skip = 12, SA5 max skip = 18-19.
 * Numbers with skip > threshold are "overdue" and should be included/avoided strategically.
 * @param {Array} confirmed - historical entries
 * @param {number} poolSize
 * @param {boolean} isNumGame
 * @returns {number[]} skip value per pool index
 */
export function computeDetailedSkips(confirmed, poolSize, isNumGame) {
  const skips = new Array(poolSize).fill(confirmed.length); // default: never seen
  for (let i = confirmed.length - 1; i >= 0; i--) {
    const drawAge = confirmed.length - 1 - i;
    confirmed[i].nums.forEach(d => {
      const k = isNumGame ? (parseInt(d) - 1) : parseInt(d);
      if (k >= 0 && k < poolSize) {
        skips[k] = Math.min(skips[k], drawAge);
      }
    });
  }
  return skips;
}

/**
 * Get maximum allowed skip for SA level based on game type.
 * PDF: SA4 → max 12; SA5 → max 18-19
 */
export function getMaxSkipForSA(n, saLevel) {
  // saLevel 0-4 corresponds to SA1-SA5
  const skipLimits = {
    3: [4, 6, 8, 10, 12],
    4: [5, 7, 9, 12, 15],
    5: [6, 8, 12, 15, 19],
    6: [7, 10, 14, 18, 22],
  };
  const limits = skipLimits[n] || skipLimits[5];
  return limits[Math.min(saLevel, limits.length - 1)];
}

// ── 3. Consecutive Number Limits ────────────────────────────────────────
/**
 * Count consecutive number sets in a combo.
 * PDF Rule: Maximum 2 consecutive sets (pairs) allowed.
 * A "set" is a group of 2+ consecutive numbers (e.g., 5-6 is one set, 5-6-7 is still one set).
 * @param {number[]} combo
 * @returns {number} count of consecutive sets
 */
export function countConsecutiveSets(combo) {
  const sorted = [...combo].map(Number).sort((a, b) => a - b);
  let sets = 0;
  let inSet = false;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] === 1) {
      if (!inSet) { sets++; inSet = true; }
    } else {
      inSet = false;
    }
  }
  return sets;
}

// ── 4. Gap Analysis (98% historical conformance) ───────────────────────
/**
 * Compute gap profile from historical data and check if a combo's gaps
 * fall within the 98th percentile of historical gap patterns.
 * PDF Rule: Gaps between numbers should follow 98% of historical draws.
 * @param {Array} confirmed - historical entries
 * @param {number} n
 * @param {boolean} isNumGame
 * @returns {object} { gapRanges: [{min, max, p98}], avgGaps }
 */
export function computeHistoricalGapProfile(confirmed, n, isNumGame) {
  if (!isNumGame || confirmed.length < 20) return null;
  const parse = d => parseInt(d) || 0;

  // Collect gap data per position (gap between pos[i] and pos[i+1] in sorted combo)
  const gapsByPos = Array.from({ length: n - 1 }, () => []);

  confirmed.forEach(e => {
    const sorted = e.nums.slice(0, n).map(parse).sort((a, b) => a - b);
    for (let i = 0; i < sorted.length - 1; i++) {
      gapsByPos[i].push(sorted[i + 1] - sorted[i]);
    }
  });

  // Compute 1st and 98th percentile for each gap position
  const gapRanges = gapsByPos.map(gaps => {
    if (gaps.length === 0) return { min: 1, max: 30, p98: 30 };
    const sorted = [...gaps].sort((a, b) => a - b);
    const p2Idx = Math.floor(sorted.length * 0.01);
    const p98Idx = Math.min(Math.ceil(sorted.length * 0.98) - 1, sorted.length - 1);
    return {
      min: sorted[p2Idx],
      max: sorted[p98Idx],
      p98: sorted[p98Idx],
      avg: Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length),
    };
  });

  return { gapRanges };
}

/**
 * Check if a combo's gaps conform to 98% historical gap profile.
 * @param {number[]} combo
 * @param {object} gapProfile - from computeHistoricalGapProfile
 * @returns {boolean} true if gaps conform
 */
export function checkGapConformance(combo, gapProfile) {
  if (!gapProfile || !gapProfile.gapRanges) return true; // no data = pass
  const sorted = [...combo].map(Number).sort((a, b) => a - b);
  for (let i = 0; i < sorted.length - 1; i++) {
    const gap = sorted[i + 1] - sorted[i];
    const range = gapProfile.gapRanges[i];
    if (range && (gap < range.min || gap > range.p98)) return false;
  }
  return true;
}

// ── 5. SK123 Repetition Rule ────────────────────────────────────────────
/**
 * PDF Rule: At least one number from the last 1-3 draws should appear in the
 * new combination (90%+ probability in real lottery data).
 * Returns the set of numbers that appeared in the last N draws.
 * @param {Array} confirmed - historical entries (oldest→newest)
 * @param {number} n - numbers per draw
 * @param {number} lookback - how many recent draws to consider (1-3)
 * @returns {Set<number>} numbers from recent draws
 */
export function getRecentDrawNumbers(confirmed, n, lookback = 3) {
  const recent = new Set();
  const start = Math.max(0, confirmed.length - lookback);
  for (let i = start; i < confirmed.length; i++) {
    confirmed[i].nums.slice(0, n).forEach(d => recent.add(parseInt(d)));
  }
  return recent;
}

/**
 * Check if combo includes at least one number from the last 3 draws.
 * @param {number[]} combo
 * @param {Set<number>} recentNums - from getRecentDrawNumbers
 * @returns {boolean} true if at least one match
 */
export function checkSK123Rule(combo, recentNums) {
  if (!recentNums || recentNums.size === 0) return true;
  return combo.some(d => recentNums.has(parseInt(d)));
}

// ── 6. Hot/Cold/Prime/Low Ratio Optimization ────────────────────────────
/**
 * Compute optimal HCPL ratio targets based on historical data.
 * PDF Rule: Ensure optimal number of Hot, Cold, Prime and Low numbers.
 * Historical analysis shows ideal ratios vary by game.
 * @param {Array} confirmed - historical entries
 * @param {number} n
 * @param {Array} overall - frequency array
 * @param {number} poolSize
 * @param {boolean} isNumGame
 * @returns {object} { idealHot, idealCold, idealPrime, idealLow, ranges }
 */
export function computeIdealHCPL(confirmed, n, overall, poolSize, isNumGame) {
  if (confirmed.length < 20) return null;
  const max = Math.max(...overall, 1);

  const hotCounts = [], coldCounts = [], primeCounts = [], lowCounts = [];
  confirmed.slice(-Math.min(100, confirmed.length)).forEach(e => {
    let h = 0, c = 0, p = 0, l = 0;
    e.nums.slice(0, n).forEach(d => {
      const k = isNumGame ? (parseInt(d) - 1) : parseInt(d);
      if (k < 0 || k >= poolSize) return;
      if (overall[k] >= max * 0.6) h++;
      else if (overall[k] < max * 0.3 && overall[k] > 0) c++;
      if (PRIME_DIGITS.has(k % 10)) p++;
      if (LOW_DIGITS.has(isNumGame ? k % 10 : k)) l++;
    });
    hotCounts.push(h); coldCounts.push(c);
    primeCounts.push(p); lowCounts.push(l);
  });

  const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const mode = arr => {
    const freq = {};
    arr.forEach(v => { freq[v] = (freq[v] || 0) + 1; });
    return +Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] || 0;
  };

  return {
    idealHot: Math.round(avg(hotCounts)),
    idealCold: Math.round(avg(coldCounts)),
    idealPrime: Math.round(avg(primeCounts)),
    idealLow: Math.round(avg(lowCounts)),
    modeHot: mode(hotCounts),
    modeCold: mode(coldCounts),
    ranges: {
      hot: { min: Math.max(0, Math.round(avg(hotCounts)) - 1), max: Math.min(n, Math.round(avg(hotCounts)) + 1) },
      cold: { min: 0, max: Math.min(n, Math.round(avg(coldCounts)) + 1) },
      prime: { min: Math.max(0, Math.round(avg(primeCounts)) - 1), max: Math.min(n, Math.round(avg(primeCounts)) + 1) },
      low: { min: Math.max(0, Math.round(avg(lowCounts)) - 1), max: Math.min(n, Math.round(avg(lowCounts)) + 1) },
    },
  };
}

// ── 7. Start/End Field Coverage (80%+ historical) ──────────────────────
/**
 * PDF Rule: The first and last numbers in a sorted combo should be among
 * the highest frequency start/end values, covering ≥80% of historical draws.
 * @param {Array} confirmed - historical entries
 * @param {number} n
 * @param {boolean} isNumGame
 * @returns {object} { validStarts: Set, validEnds: Set }
 */
export function computeStartEndCoverage(confirmed, n, isNumGame) {
  if (!isNumGame || confirmed.length < 20) return null;
  const parse = d => parseInt(d) || 0;

  const startFreq = {}, endFreq = {};
  confirmed.forEach(e => {
    const sorted = e.nums.slice(0, n).map(parse).sort((a, b) => a - b);
    const start = sorted[0];
    const end = sorted[sorted.length - 1];
    startFreq[start] = (startFreq[start] || 0) + 1;
    endFreq[end] = (endFreq[end] || 0) + 1;
  });

  // Find the smallest set of start values covering 80% of draws
  const total = confirmed.length;
  const target = Math.ceil(total * 0.80);

  const sortedStarts = Object.entries(startFreq).sort((a, b) => b[1] - a[1]);
  const validStarts = new Set();
  let cumStart = 0;
  for (const [val, cnt] of sortedStarts) {
    validStarts.add(Number(val));
    cumStart += cnt;
    if (cumStart >= target) break;
  }

  const sortedEnds = Object.entries(endFreq).sort((a, b) => b[1] - a[1]);
  const validEnds = new Set();
  let cumEnd = 0;
  for (const [val, cnt] of sortedEnds) {
    validEnds.add(Number(val));
    cumEnd += cnt;
    if (cumEnd >= target) break;
  }

  return { validStarts, validEnds };
}

// ── 8. Pattern/Group Filtering (Top 27 patterns, Top 60 groups) ────────
/**
 * PDF Rule: Combinations among top 27 patterns and/or top 60 groups
 * are prioritized. Patterns are based on number ranges/zones.
 * @param {number[]} combo
 * @param {number} poolSize
 * @param {number} n
 * @param {boolean} isNumGame
 * @returns {string} pattern key (e.g., "L-L-M-H-H" for Low-Low-Mid-High-High)
 */
export function getComboPattern(combo, poolSize, n, isNumGame) {
  if (!isNumGame) return 'N/A';
  const third = Math.ceil(poolSize / 3);
  return combo.map(d => {
    const v = parseInt(d);
    if (v <= third) return 'L';
    if (v <= third * 2) return 'M';
    return 'H';
  }).join('-');
}

/**
 * Compute historical pattern frequency and return top N patterns.
 * @param {Array} confirmed
 * @param {number} poolSize
 * @param {number} n
 * @param {boolean} isNumGame
 * @param {number} topN - how many top patterns to return (default 27)
 * @returns {Set<string>} top patterns
 */
export function computeTopPatterns(confirmed, poolSize, n, isNumGame, topN = 27) {
  if (!isNumGame || confirmed.length < 20) return null;
  const parse = d => parseInt(d) || 0;
  const third = Math.ceil(poolSize / 3);

  const patternFreq = {};
  confirmed.forEach(e => {
    const sorted = e.nums.slice(0, n).map(parse).sort((a, b) => a - b);
    const pattern = sorted.map(v => {
      if (v <= third) return 'L';
      if (v <= third * 2) return 'M';
      return 'H';
    }).join('-');
    patternFreq[pattern] = (patternFreq[pattern] || 0) + 1;
  });

  const sorted = Object.entries(patternFreq).sort((a, b) => b[1] - a[1]);
  return new Set(sorted.slice(0, topN).map(([p]) => p));
}

/**
 * Compute group signature (based on tens digit grouping).
 * Group = how many numbers from each decade (0s, 10s, 20s, 30s, etc.)
 * @param {number[]} combo
 * @param {number} poolSize
 * @returns {string} group key (e.g., "1-1-1-1-1" meaning one from each decade)
 */
export function getComboGroup(combo, poolSize) {
  const decades = Math.ceil(poolSize / 10);
  const counts = new Array(decades).fill(0);
  combo.forEach(d => {
    const v = parseInt(d);
    const dec = Math.min(Math.floor((v - 1) / 10), decades - 1);
    counts[dec]++;
  });
  return counts.join('-');
}

/**
 * Compute top N groups from historical data.
 * @param {Array} confirmed
 * @param {number} poolSize
 * @param {number} n
 * @param {boolean} isNumGame
 * @param {number} topN - default 60
 * @returns {Set<string>} top groups
 */
export function computeTopGroups(confirmed, poolSize, n, isNumGame, topN = 60) {
  if (!isNumGame || confirmed.length < 20) return null;
  const parse = d => parseInt(d) || 0;

  const groupFreq = {};
  confirmed.forEach(e => {
    const sorted = e.nums.slice(0, n).map(parse).sort((a, b) => a - b);
    const group = getComboGroup(sorted, poolSize);
    groupFreq[group] = (groupFreq[group] || 0) + 1;
  });

  const sorted = Object.entries(groupFreq).sort((a, b) => b[1] - a[1]);
  return new Set(sorted.slice(0, topN).map(([g]) => g));
}

// ── 9. Enhanced Star Rating Criteria ────────────────────────────────────
/**
 * PDF Rule: Star rating incorporates:
 * - Past wins (walk-forward hits)
 * - Double-digit SA values (numbers with skip ≥ 10)
 * - Filter pass count
 * - AC value conformance
 * - Pattern/group ranking
 * - SK123 inclusion
 * @param {object} combo result with { combo, fails, score, walkForwardHits, walkForwardTotal }
 * @param {object} extras - { acValue, acRange, inTopPattern, inTopGroup, hasSK123,
 *                           gapConforms, startEndOk, hcplOk, consecSetsOk }
 * @returns {number} 1-5 star rating
 */
export function computeEnhancedStarRating(result, extras = {}) {
  let stars = 0;

  // Base: filter pass (0 fails = 2 stars, 1 fail = 1 star, 2+ = 0)
  if (result.fails.length === 0) stars += 2;
  else if (result.fails.length === 1) stars += 1;

  // Walk-forward backtest performance
  if (result.walkForwardHits !== undefined && result.walkForwardTotal > 0) {
    const wfPct = result.walkForwardHits / result.walkForwardTotal;
    if (wfPct >= 0.50) stars += 1.5;
    else if (wfPct >= 0.30) stars += 1;
    else if (wfPct >= 0.15) stars += 0.5;
  }

  // AC value in range (+0.5)
  if (extras.acValue !== undefined && extras.acRange) {
    if (extras.acValue >= extras.acRange.min && extras.acValue <= extras.acRange.max) stars += 0.5;
  }

  // In top pattern or top group (+0.5 each)
  if (extras.inTopPattern) stars += 0.5;
  if (extras.inTopGroup) stars += 0.25;

  // SK123 rule satisfied (+0.25)
  if (extras.hasSK123) stars += 0.25;

  // Gap conformance (+0.25)
  if (extras.gapConforms) stars += 0.25;

  // Start/end field coverage (+0.25)
  if (extras.startEndOk) stars += 0.25;

  // Clamp to 1-5
  return Math.max(1, Math.min(5, Math.round(stars)));
}

// ── 10. Status Detection (Normal/Unstable) ─────────────────────────────
/**
 * PDF Rule: Detect if the game is in Normal or Unstable status.
 * Unstable = recent draws consistently outside expected sum/OE ranges.
 * When unstable, apply bias-playing strategy (lean toward outlier patterns).
 * Enhanced version of existing computeStatus.
 */
export function computeEnhancedStatus(confirmed, n, isNumGame, overall, sumStats, oeStats) {
  if (confirmed.length < 6) return { isNormal: true, unstableCount: 0, bias: null };
  const parse = d => parseInt(d) || 0;
  const recent = confirmed.slice(-10);

  let sumOutliers = 0, oeOutliers = 0;
  const top2OE = (oeStats.top2 || []).filter(v => v >= 0);

  recent.forEach(e => {
    const sum = e.nums.slice(0, n).reduce((a, d) => a + parse(d), 0);
    if (sum < sumStats.lo || sum > sumStats.hi) sumOutliers++;

    const odds = e.nums.slice(0, n).filter(d => parse(d) % 2 !== 0).length;
    if (top2OE.length > 0 && !top2OE.includes(odds)) oeOutliers++;
  });

  const isUnstable = sumOutliers >= 4 || oeOutliers >= 5;

  // Bias recommendation when unstable
  let bias = null;
  if (isUnstable) {
    const recentSums = recent.map(e => e.nums.slice(0, n).reduce((a, d) => a + parse(d), 0));
    const avgRecentSum = recentSums.reduce((a, b) => a + b, 0) / recentSums.length;
    bias = {
      sumDirection: avgRecentSum > sumStats.avg ? 'high' : 'low',
      sumTarget: Math.round(avgRecentSum),
      reason: `${sumOutliers}/10 recent draws outside expected sum range`,
    };
  }

  return { isNormal: !isUnstable, unstableCount: sumOutliers + oeOutliers, bias };
}

// Game configuration
export const OPTIMIZER_GAME_CONFIGS = {
  pick3:       { n: 3, poolSize: 10, isNumGame: false, label: 'Pick 3',        sbId: 'pick3' },
  pick4:       { n: 4, poolSize: 10, isNumGame: false, label: 'Pick 4',        sbId: 'pick4' },
  pick5:       { n: 5, poolSize: 39, isNumGame: true,  label: 'Pick 5',        sbId: 'pick5' },
  pick6:       { n: 6, poolSize: 49, isNumGame: true,  label: 'Pick 6',        sbId: 'pick6' },
  cash3:       { n: 3, poolSize: 10, isNumGame: false, label: 'Cash 3',        sbId: 'cash3' },
  daily3:      { n: 3, poolSize: 10, isNumGame: false, label: 'Daily 3',       sbId: 'daily3' },
  daily4:      { n: 4, poolSize: 10, isNumGame: false, label: 'Daily 4',       sbId: 'daily4' },
  powerball:   { n: 5, poolSize: 69, isNumGame: true,  label: 'Powerball',     sbId: 'powerball',    bonusN: 1, bonusPool: 26, bonusLabel: 'Powerball (red)' },
  megamil:     { n: 5, poolSize: 70, isNumGame: true,  label: 'Mega Millions', sbId: 'megamillions', bonusN: 1, bonusPool: 25, bonusLabel: 'Mega Ball (gold)' },
  fantasy5:    { n: 5, poolSize: 39, isNumGame: true,  label: 'Fantasy 5',          sbId: 'fantasy5' },
  lotto647:    { n: 6, poolSize: 47, isNumGame: true,  label: 'Lotto 6/47',         sbId: 'lotto647' },
  superlotto:  { n: 5, poolSize: 47, isNumGame: true,  label: 'CA SuperLotto Plus', sbId: 'superlotto', bonusN: 1, bonusPool: 27, bonusLabel: 'Mega (gold)' },
  cash5:       { n: 5, poolSize: 43, isNumGame: true,  label: 'Cash 5',            sbId: 'cash5' },
  lotto:       { n: 6, poolSize: 53, isNumGame: true,  label: 'Lotto',             sbId: 'lotto' },
};

// Draw schedule (Eastern Time reference)
export const DRAW_SCHEDULE = {
  pick3: {
    midday:  { label: 'Midday',  time: '12:59 PM ET', days: 'Mon–Sat', states: ['NY','NJ','PA','OH','MD','VA','NC','FL','GA','CA','TN','MI'] },
    evening: { label: 'Evening', time: '7:57 PM ET',  days: 'Daily',   states: ['NY','NJ','PA','OH','MD','VA','NC','FL','GA','CA','TN','MI'] },
  },
  pick4: {
    midday:  { label: 'Midday',  time: '12:59 PM ET', days: 'Mon–Sat', states: ['NY','NJ','PA','OH','MD','VA','NC','FL','GA','MI','IN'] },
    evening: { label: 'Evening', time: '7:57 PM ET',  days: 'Daily',   states: ['NY','NJ','PA','OH','MD','VA','NC','FL','GA','MI','IN'] },
  },
  pick5: {
    midday:  { label: 'Midday',  time: '12:30 PM ET', days: 'Mon–Sat', states: ['NY','NJ','PA','OH','MD','VA','NC','FL'] },
    evening: { label: 'Evening', time: '10:30 PM ET', days: 'Daily',   states: ['NY','NJ','PA','OH','MD','VA','NC','FL'] },
  },
  pick6: {
    midday:  { label: 'Midday',  time: '12:30 PM ET', days: 'Mon–Wed–Sat', states: ['NY','NJ','PA','OH'] },
    evening: { label: 'Evening', time: '10:59 PM ET', days: 'Mon–Wed–Sat', states: ['NY','NJ','PA','OH'] },
  },
  cash3: {
    midday:  { label: 'Midday',  time: '12:29 PM ET', days: 'Mon–Sat', states: ['GA','TN','FL','MS'] },
    evening: { label: 'Evening', time: '6:59 PM ET',  days: 'Daily',   states: ['GA','TN','FL','MS'] },
  },
  daily3: {
    midday:  { label: 'Midday',  time: '12:59 PM ET', days: 'Daily', states: ['MI','CA'] },
    evening: { label: 'Evening', time: '7:29 PM ET',  days: 'Daily', states: ['MI','CA'] },
  },
  daily4: {
    midday:  { label: 'Midday',  time: '12:59 PM ET', days: 'Mon–Sat', states: ['CA','MI','IN'] },
    evening: { label: 'Evening', time: '7:57 PM ET',  days: 'Daily',   states: ['CA','MI','IN'] },
  },
  superlotto: {
    evening: { label: 'Evening', time: '7:57 PM PT', days: 'Wed & Sat', states: ['CA'] },
  },
  powerball: {
    evening: { label: 'Evening', time: '10:59 PM ET', days: 'Mon, Wed & Sat', states: ['All US states'] },
  },
  megamil: {
    evening: { label: 'Evening', time: '11:00 PM ET', days: 'Tue & Fri', states: ['All US states'] },
  },
  fantasy5: {
    evening: { label: 'Evening', time: '11:00 PM ET', days: 'Daily', states: ['CA', 'FL', 'GA', 'MI'] },
  },
  lotto647: {
    evening: { label: 'Evening', time: '11:00 PM ET', days: 'Mon, Wed & Sat', states: ['NY', 'NJ', 'PA', 'OH', 'MI', 'IL'] },
  },
  cash5: {
    evening: { label: 'Evening', time: '11:00 PM ET', days: 'Daily', states: ['PA', 'VA', 'NC', 'CT', 'NJ'] },
  },
  lotto: {
    evening: { label: 'Evening', time: '11:00 PM ET', days: 'Mon, Wed & Sat', states: ['FL', 'IL', 'TX', 'CA'] },
  },
};

// ────────────────────────────────────────────────────────────────────────────
//  DATA CONVERSION — convert predictor draws → optimizer entries format
// ────────────────────────────────────────────────────────────────────────────
/**
 * Convert predictor-style draws [{date, numbers}] to optimizer entries [{nums, ts, draw, status}]
 * @param {Array} draws   - array of {date: string, numbers: number[]}
 * @param {string} drawType - 'midday' | 'evening'
 */
export function convertDrawsToEntries(draws, drawType = 'evening') {
  if (!draws || draws.length === 0) return [];
  // Backend returns newest-first; engine expects oldest-first (allHist[last] = most recent).
  // Sort ascending by date so allHist[allHist.length-1] is always the latest draw.
  const sorted = [...draws].sort((a, b) => {
    const da = a.date || '';
    const db = b.date || '';
    return da < db ? -1 : da > db ? 1 : 0;
  });
  return sorted.map(d => {
    const nums = d.numbers.map(Number);
    // Append bonus ball (Powerball/Mega Ball/Mega) at the end so it's at nums[n]
    // This allows the optimizer position table to detect and display it correctly
    if (d.bonus != null && !isNaN(Number(d.bonus))) {
      nums.push(Number(d.bonus));
    }
    return {
      nums,
      ts:     d.date || '',
      draw:   drawType,
      status: 'confirmed',
    };
  });
}

// ────────────────────────────────────────────────────────────────────────────
//  HISTORY FILTER
// ────────────────────────────────────────────────────────────────────────────
/**
 * Filter entries to confirmed ones with at least n numbers.
 * Optionally filter by drawType (falls back to all if filtered set is too small).
 */
export function getAllHistoryConfirmed(entries, n, drawType) {
  const all = entries.filter(e => e.status === 'confirmed' && e.nums && e.nums.length >= n);
  if (!drawType) return all;
  const filtered = all.filter(e => !e.draw || e.draw === drawType);
  return filtered.length >= Math.max(n + 2, 10) ? filtered : all;
}

// ────────────────────────────────────────────────────────────────────────────
//  FREQUENCY COMPUTATION
// ────────────────────────────────────────────────────────────────────────────
/**
 * Compute per-position and overall frequency arrays from entries.
 * ML UPGRADE: supports temporal decay — recent draws weighted more heavily.
 * decay=0 → uniform; decay=0.02 → ~50% weight at 35 draws ago
 */
export function computeFreqFromEntries(entries, n, poolSize, isNumGame, decay = 0) {
  const pos     = Array.from({ length: n }, () => new Array(poolSize).fill(0));
  const overall = new Array(poolSize).fill(0);
  const len = entries.length;
  entries.forEach((e, idx) => {
    const age = len - 1 - idx; // 0 = most recent
    const w   = decay > 0 ? Math.exp(-decay * age) : 1.0;
    e.nums.slice(0, n).forEach((d, i) => {
      const k = isNumGame ? (parseInt(d) - 1) : parseInt(d);
      if (k >= 0 && k < poolSize) { pos[i][k] += w; overall[k] += w; }
    });
  });
  return { pos, overall };
}

// ────────────────────────────────────────────────────────────────────────────
//  SKIP MAP
// ────────────────────────────────────────────────────────────────────────────
export function computeSkipMap(confirmed, poolSize, isNumGame) {
  const skipMap = new Array(poolSize).fill(confirmed.length);
  for (let i = confirmed.length - 1; i >= 0; i--) {
    confirmed[i].nums.forEach(d => {
      const k = isNumGame ? (parseInt(d) - 1) : parseInt(d);
      if (k >= 0 && k < poolSize && skipMap[k] === confirmed.length)
        skipMap[k] = confirmed.length - 1 - i;
    });
  }
  return skipMap;
}

// ────────────────────────────────────────────────────────────────────────────
//  SA LEVELS
// ────────────────────────────────────────────────────────────────────────────
/**
 * Compute 5 SA (Skip Analysis) levels using windows [1,2,3,5,7] unique draw dates.
 * ML UPGRADE: auto-expand uses skip-map (most overdue) instead of alphabetical.
 */
export function computeSALevels(confirmed, poolSize, isNumGame, n) {
  const windows  = [1, 2, 3, 5, 7];
  const allDates = [...new Set(confirmed.map(e => e.ts))].sort();
  return windows.map(w => {
    const dates  = allDates.slice(-w);
    const inPool = new Set();
    confirmed.filter(e => dates.includes(e.ts)).forEach(e => {
      e.nums.forEach(d => {
        const k = isNumGame ? (parseInt(d) - 1) : parseInt(d);
        if (k >= 0 && k < poolSize) inPool.add(k);
      });
    });
    let pool = [...inPool].sort((a, b) => a - b);
    if (pool.length < n) {
      const skip = computeSkipMap(confirmed, poolSize, isNumGame);
      const all  = [...Array(poolSize).keys()].sort((a, b) => skip[b] - skip[a]);
      pool = [...new Set([...pool, ...all])].slice(0, Math.max(n + 2, pool.length + 2));
    }
    return pool;
  });
}

// ────────────────────────────────────────────────────────────────────────────
//  FA LEVELS
// ────────────────────────────────────────────────────────────────────────────
export function computeFALevels(overall, poolSize) {
  const pool   = [...Array(poolSize).keys()];
  const sorted = [...pool].sort((a, b) => overall[b] - overall[a]).filter(k => overall[k] > 0);
  if (sorted.length === 0) return [[], [], [], []];
  const cuts = [0.30, 0.50, 0.70, 1.0];
  return cuts.map(cut => {
    const count = Math.max(2, Math.ceil(sorted.length * cut));
    return sorted.slice(0, count).sort((a, b) => a - b);
  });
}

// ────────────────────────────────────────────────────────────────────────────
//  SUM STATS
// ────────────────────────────────────────────────────────────────────────────
export function computeSumStats(confirmed, isNumGame, n) {
  if (confirmed.length === 0) return { lo: 0, hi: 27, avg: 13, recent: 0, sums: [] };
  const parse = d => parseInt(d) || 0;
  const sums  = confirmed.map(e => e.nums.slice(0, n).reduce((a, d) => a + parse(d), 0));
  const sorted = [...sums].sort((a, b) => a - b);
  const lo85  = sorted[Math.floor(sorted.length * 0.075)]  ?? sorted[0];
  const hi85  = sorted[Math.ceil( sorted.length * 0.925) - 1] ?? sorted[sorted.length - 1];
  const avg   = Math.round(sums.reduce((a, b) => a + b, 0) / sums.length);
  return { lo: lo85, hi: hi85, avg, recent: sums[sums.length - 1], sums };
}

// ────────────────────────────────────────────────────────────────────────────
//  ODD/EVEN STATS
// ────────────────────────────────────────────────────────────────────────────
export function computeOEStats(confirmed, n, isNumGame) {
  if (confirmed.length === 0)
    return { bestPattern: 'N/A', top2Patterns: 'N/A', patterns: {}, top2: [null, null] };
  const patterns = {};
  confirmed.forEach(e => {
    const odds = e.nums.slice(0, n).filter(d => parseInt(d) % 2 !== 0).length;
    const pat  = `${odds}O/${n - odds}E`;
    patterns[pat] = (patterns[pat] || 0) + 1;
  });
  const sorted = Object.entries(patterns).sort((a, b) => b[1] - a[1]);
  const bestPattern  = sorted[0]?.[0] || 'N/A';
  const top2Patterns = sorted.slice(0, 2).map(([p, c]) => `${p}(${c}×)`).join(', ');
  const parseOdd = pat => { const m = pat.match(/(\d+)O/); return m ? parseInt(m[1]) : -1; };
  const top2 = sorted.slice(0, 2).map(([p]) => parseOdd(p));
  return { bestPattern, top2Patterns, patterns, top2 };
}

// ────────────────────────────────────────────────────────────────────────────
//  CONSECUTIVE STATS
// ────────────────────────────────────────────────────────────────────────────
export function computeConsecStats(confirmed) {
  if (confirmed.length === 0) return '0';
  const recent = confirmed.slice(-10);
  const count = recent.filter(e => {
    const s = [...e.nums].map(Number).sort((a, b) => a - b);
    for (let i = 1; i < s.length; i++) if (s[i] - s[i - 1] === 1) return true;
    return false;
  }).length;
  return `${count}/${recent.length}`;
}

// ────────────────────────────────────────────────────────────────────────────
//  HCPL STRING
// ────────────────────────────────────────────────────────────────────────────
export function computeHCPLStr(lastNums, overall, poolSize, isNumGame) {
  if (!lastNums || lastNums.length === 0) return 'N/A';
  const max = Math.max(...overall, 1);
  let h = 0, c = 0, p = 0, l = 0;
  lastNums.forEach(d => {
    const k = isNumGame ? (parseInt(d) - 1) : parseInt(d);
    if (k < 0 || k >= poolSize) return;
    if (overall[k] >= max * 0.6) h++;
    else if (overall[k] < max * 0.3 && overall[k] > 0) c++;
    if (PRIME_DIGITS.has(k % 10)) p++;
    if (LOW_DIGITS.has(isNumGame ? k % 10 : k)) l++;
  });
  return `H:${h} C:${c} P:${p} L:${l}`;
}

// ────────────────────────────────────────────────────────────────────────────
//  STATUS
// ────────────────────────────────────────────────────────────────────────────
export function computeStatus(confirmed, n, isNumGame, overall, sumStats) {
  if (confirmed.length < 3) return { isNormal: true, unstableCount: 0 };
  const recent = confirmed.slice(-6);
  let consec = 0, maxConsec = 0;
  recent.forEach(e => {
    const sum = e.nums.slice(0, n).reduce((a, d) => a + (parseInt(d) || 0), 0);
    if (sum < sumStats.lo || sum > sumStats.hi) { consec++; maxConsec = Math.max(maxConsec, consec); }
    else consec = 0;
  });
  return { isNormal: maxConsec < 3, unstableCount: maxConsec };
}

// ────────────────────────────────────────────────────────────────────────────
//  HCPL VECTOR
// ────────────────────────────────────────────────────────────────────────────
export function getHCPL(nums, overall, poolSize, isNumGame) {
  const max = Math.max(...overall, 1);
  let h = 0, c = 0, p = 0, l = 0;
  nums.forEach(d => {
    const k = isNumGame ? (parseInt(d) - 1) : parseInt(d);
    if (k < 0 || k >= poolSize) return;
    if (overall[k] >= max * 0.6) h++;
    else if (overall[k] < max * 0.3 && overall[k] > 0) c++;
    if (PRIME_DIGITS.has(k % 10)) p++;
    if (LOW_DIGITS.has(isNumGame ? k % 10 : k)) l++;
  });
  return [h, c, p, l];
}

// ────────────────────────────────────────────────────────────────────────────
//  COMBINATION CHECKER — returns fail codes
//  ENHANCED with PDF Optimizer strategies (AC, GAP, SK123, CON2, SE, PAT/GRP)
// ────────────────────────────────────────────────────────────────────────────
export function checkCombination(nums, confirmed, overall, pos, poolSize, isNumGame, n, sumStats, oeStats, opts) {
  const fails = [];
  const parse = d => parseInt(d) || 0;
  const max   = Math.max(...overall, 1);

  // SUM check
  if (opts.sum === 'on' && sumStats.sums.length >= 5) {
    const s = nums.reduce((a, d) => a + parse(d), 0);
    if (s < sumStats.lo || s > sumStats.hi) fails.push('SUM');
    if (confirmed.length >= 10) {
      const uniqueSums = [];
      const seenS = new Set();
      for (let i = confirmed.length - 1; i >= 0 && uniqueSums.length < 5; i--) {
        const es = confirmed[i].nums.slice(0, n).reduce((a, d) => a + parse(d), 0);
        if (!seenS.has(es)) { seenS.add(es); uniqueSums.push(es); }
      }
      if (uniqueSums.includes(s)) fails.push('SAM');
    }
  }

  // ODD/EVEN
  if (opts.oe && opts.oe !== 'off') {
    const odds = nums.filter(d => parse(d) % 2 !== 0).length;
    if (opts.oe === 'auto') {
      const top2 = (oeStats.top2 || []).filter(v => v >= 0);
      if (top2.length > 0 && top2.length <= (n + 1) && !top2.includes(odds)) fails.push('ODD');
    } else {
      const m = opts.oe.match(/(\d+)o(\d+)e/);
      if (m && odds !== parseInt(m[1])) fails.push('ODD');
    }
  }

  // ── PDF Strategy 3: Consecutive number limit (max 2 sets) ──
  if (opts.consec === 'no') {
    const s = [...nums].sort((a, b) => a - b);
    for (let i = 1; i < s.length; i++) if (s[i] - s[i - 1] === 1) { fails.push('CON'); break; }
  } else if (opts.consec === 'auto' || opts.consec === 'ok') {
    const consecSets = countConsecutiveSets(nums);
    // PDF: max 2 consecutive sets allowed; fail if 3+
    if (consecSets > 2) fails.push('CON');
    // Also fail if entire combo is consecutive (original logic)
    const s = [...nums].sort((a, b) => a - b);
    let maxRun = 1, run = 1;
    for (let i = 1; i < s.length; i++) { if (s[i] - s[i - 1] === 1) run++; else run = 1; maxRun = Math.max(maxRun, run); }
    if (maxRun >= n) fails.push('CON');
  }

  // HCC
  if (opts.hcpl === 'on' && confirmed.length >= 8) {
    const last26  = confirmed.slice(-Math.min(26, confirmed.length));
    const curHCPL = getHCPL(nums, overall, poolSize, isNumGame);
    const matchCount = last26.filter(e =>
      getHCPL(e.nums.slice(0, n), overall, poolSize, isNumGame).join('') === curHCPL.join('')
    ).length;
    if (matchCount >= Math.max(4, Math.ceil(last26.length * 0.30))) fails.push('HCC');
  }

  // REP
  if (confirmed.length > 0) {
    const lastDraw = confirmed[confirmed.length - 1].nums.slice(0, n).map(parse);
    const maxRep   = opts.rep === '0' ? 0 : opts.rep === '1' ? 1 : opts.rep === '2' ? 2
                   : (!isNumGame && n >= 4) ? 2 : 1;
    const repCount = nums.filter(d => lastDraw.includes(parse(d))).length;
    if (repCount > maxRep) fails.push('REP');
  }

  // FRQ
  if (confirmed.length >= 6) {
    const topN    = isNumGame ? Math.max(3, Math.ceil(poolSize * 0.20)) : 3;
    const topFreq = [...Array(poolSize).keys()].sort((a, b) => overall[b] - overall[a]).filter(k => overall[k] > 0).slice(0, topN);
    if (topFreq.length > 0 && !nums.some(d => topFreq.includes(isNumGame ? parse(d) - 1 : parse(d)))) fails.push('FRQ');
  }

  // PAT
  if (confirmed.length >= 2) {
    const mySorted = [...nums].map(parse).sort((a, b) => a - b).join('-');
    const seenDates = [], last2Pat = [];
    for (let i = confirmed.length - 1; i >= 0 && seenDates.length < 2; i--) {
      const dt = confirmed[i].ts || i + '';
      if (!seenDates.includes(dt)) {
        seenDates.push(dt);
        last2Pat.push([...confirmed[i].nums.slice(0, n)].map(parse).sort((a, b) => a - b).join('-'));
      }
    }
    if (last2Pat.includes(mySorted)) fails.push('PAT');
  }

  // ── PDF Strategy 1: AC Value Filter (AC must be 7-10 for 5-number games) ──
  if (isNumGame && n >= 4 && confirmed.length >= 10) {
    const ac = computeACValue(nums);
    const acRange = getACRange(n);
    if (ac < acRange.min || ac > acRange.max) fails.push('AC');
  }

  // ── PDF Strategy 4: Gap Analysis (98% historical conformance) ──
  if (isNumGame && opts._gapProfile) {
    if (!checkGapConformance(nums, opts._gapProfile)) fails.push('GAP');
  }

  // ── PDF Strategy 5: SK123 Rule (must include number from last 3 draws) ──
  if (opts._recentNums && confirmed.length >= 3) {
    if (!checkSK123Rule(nums, opts._recentNums)) fails.push('SK1');
  }

  // ── PDF Strategy 7: Start/End Field Coverage (80%+ historical) ──
  if (isNumGame && opts._startEnd) {
    const sorted = [...nums].map(parse).sort((a, b) => a - b);
    const startNum = sorted[0];
    const endNum = sorted[sorted.length - 1];
    if (!opts._startEnd.validStarts.has(startNum)) fails.push('SE1');
    if (!opts._startEnd.validEnds.has(endNum)) fails.push('SE2');
  }

  return fails;
}

// ────────────────────────────────────────────────────────────────────────────
//  WEIGHTED COMBO GENERATOR
// ────────────────────────────────────────────────────────────────────────────
export function generateComboWeighted(pool, n, isNumGame, poolSize, overall, pos, learningBoosts = null) {
  const max     = Math.max(...overall, 1);
  const weights = pool.map(k => {
    let w = 1 + (overall[k] / max) * 3;
    // Apply adaptive learning boosts from prediction tracker
    if (learningBoosts) {
      const numKey = isNumGame ? k + 1 : k;
      if (learningBoosts[numKey]) w *= learningBoosts[numKey];
    }
    return w;
  });
  const result  = [];
  const remaining  = [...pool];
  const remWeights = [...weights];
  while (result.length < n && remaining.length > 0) {
    const total = remWeights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total, cum = 0, pick = 0;
    for (let i = 0; i < remWeights.length; i++) { cum += remWeights[i]; if (r < cum) { pick = i; break; } }
    result.push(isNumGame ? remaining[pick] + 1 : remaining[pick]);
    remaining.splice(pick, 1);
    remWeights.splice(pick, 1);
  }
  while (result.length < n) result.push(isNumGame ? pool[0] + 1 : pool[0]);
  // Sort ascending for number games (1-39, 1-69 etc); keep positional order for digit games (Pick 3/4)
  if (isNumGame) result.sort((a, b) => a - b);
  return result;
}

// ────────────────────────────────────────────────────────────────────────────
//  WALK-FORWARD BACKTEST — test a combo against real historical draws
// ────────────────────────────────────────────────────────────────────────────
/**
 * Test how many of the last `window` real draws contained at least `minHits`
 * digits from `combo`. Returns { hits, total }.
 *
 * For Pick-3/4 (isNumGame=false): digit matching (0-9)
 * For number games (isNumGame=true): exact number matching
 *
 * minHits defaults to max(1, floor(n/2)) — so for Pick-3 at least 1 digit,
 * for Pick-5 at least 2 numbers, etc.
 */
export function walkForwardBacktest(combo, confirmed, n, isNumGame, window = 30) {
  if (!confirmed || confirmed.length === 0) return { hits: 0, total: 0 };
  const testDraws = confirmed.slice(-Math.min(window, confirmed.length));
  const minHits   = Math.max(1, Math.floor(n / 2));
  const parse     = d => parseInt(d) || 0;
  const comboSet  = new Set(combo.map(parse));

  let hits = 0;
  testDraws.forEach(e => {
    const drawNums = e.nums.slice(0, n).map(parse);
    const matches  = drawNums.filter(d => comboSet.has(d)).length;
    if (matches >= minHits) hits++;
  });
  return { hits, total: testDraws.length };
}


/**
 * Score a combo using original ML features PLUS PDF optimizer strategy bonuses.
 * @param {number[]} combo
 * @param {Array} confirmed
 * @param {Array} overall
 * @param {Array} pos
 * @param {number} poolSize
 * @param {boolean} isNumGame
 * @param {number} n
 * @param {string[]} fails
 * @param {object} pdfData - optional PDF strategy pre-computed data
 *   { topPatterns, topGroups, recentNums, gapProfile, startEnd, idealHCPL }
 */
export function scoreCombo(combo, confirmed, overall, pos, poolSize, isNumGame, n, fails, pdfData = null) {
  let score = (5 - Math.min(fails.length, 5)) * 100;
  const max  = Math.max(...overall, 1);

  const skipMap = computeSkipMap(confirmed, poolSize, isNumGame);
  const maxSkip = Math.max(...skipMap, 1);

  combo.forEach((d, pi) => {
    const k = isNumGame ? (parseInt(d) - 1) : parseInt(d);
    if (k < 0 || k >= poolSize) return;
    score += (overall[k] / max) * 25;
    if (pos && pos[pi]) {
      const posTotal = pos[pi].reduce((a, b) => a + b, 0) || 1;
      score += (pos[pi][k] / posTotal) * 20;
    }
    score += (skipMap[k] / maxSkip) * 15;
  });

  if (confirmed.length >= 10) {
    const pairFreq = {};
    confirmed.slice(-Math.min(confirmed.length, 200)).forEach(e => {
      const nums = e.nums.slice(0, n).map(d => isNumGame ? (parseInt(d) - 1) : parseInt(d));
      for (let a = 0; a < nums.length; a++)
        for (let b = a + 1; b < nums.length; b++) {
          const key = Math.min(nums[a], nums[b]) + '_' + Math.max(nums[a], nums[b]);
          pairFreq[key] = (pairFreq[key] || 0) + 1;
        }
    });
    const maxPair   = Math.max(...Object.values(pairFreq), 1);
    const comboKeys = combo.map(d => isNumGame ? (parseInt(d) - 1) : parseInt(d));
    for (let a = 0; a < comboKeys.length; a++)
      for (let b = a + 1; b < comboKeys.length; b++) {
        const key = Math.min(comboKeys[a], comboKeys[b]) + '_' + Math.max(comboKeys[a], comboKeys[b]);
        if (pairFreq[key]) score += (pairFreq[key] / maxPair) * 10;
      }
  }

  // ══ PDF OPTIMIZER STRATEGY BONUSES ══
  if (pdfData && isNumGame) {
    // Strategy 1: AC value bonus (in ideal range = +30)
    if (n >= 4) {
      const ac = computeACValue(combo);
      const acRange = getACRange(n);
      if (ac >= acRange.min && ac <= acRange.max) score += 30;
      // Extra bonus for AC in the sweet spot (8-9 for 5-number games)
      const sweetMin = Math.ceil((acRange.min + acRange.max) / 2) - 1;
      const sweetMax = Math.ceil((acRange.min + acRange.max) / 2) + 1;
      if (ac >= sweetMin && ac <= sweetMax) score += 10;
    }

    // Strategy 5: SK123 bonus — includes number from last 3 draws (+20)
    if (pdfData.recentNums && pdfData.recentNums.size > 0) {
      const matchCount = combo.filter(d => pdfData.recentNums.has(parseInt(d))).length;
      if (matchCount >= 1) score += 15;
      if (matchCount >= 2) score += 10;
    }

    // Strategy 4: Gap conformance bonus (+15)
    if (pdfData.gapProfile) {
      if (checkGapConformance(combo, pdfData.gapProfile)) score += 15;
    }

    // Strategy 7: Start/End field coverage bonus (+15)
    if (pdfData.startEnd) {
      const sorted = [...combo].map(Number).sort((a, b) => a - b);
      if (pdfData.startEnd.validStarts.has(sorted[0])) score += 8;
      if (pdfData.startEnd.validEnds.has(sorted[sorted.length - 1])) score += 8;
    }

    // Strategy 8: Pattern/Group scoring (+25 for top pattern, +15 for top group)
    if (pdfData.topPatterns) {
      const pat = getComboPattern(combo, poolSize, n, isNumGame);
      if (pdfData.topPatterns.has(pat)) score += 25;
    }
    if (pdfData.topGroups) {
      const grp = getComboGroup(combo, poolSize);
      if (pdfData.topGroups.has(grp)) score += 15;
    }

    // Strategy 6: HCPL ratio conformance bonus (+15)
    if (pdfData.idealHCPL) {
      const [h, c, p, l] = getHCPL(combo, overall, poolSize, isNumGame);
      const { ranges } = pdfData.idealHCPL;
      let hcplBonus = 0;
      if (h >= ranges.hot.min && h <= ranges.hot.max) hcplBonus += 4;
      if (c >= ranges.cold.min && c <= ranges.cold.max) hcplBonus += 4;
      if (p >= ranges.prime.min && p <= ranges.prime.max) hcplBonus += 4;
      if (l >= ranges.low.min && l <= ranges.low.max) hcplBonus += 4;
      score += hcplBonus;
    }

    // Strategy 3: Consecutive sets bonus (0-1 sets = bonus, 2 = small bonus)
    const cSets = countConsecutiveSets(combo);
    if (cSets === 0) score += 10;
    else if (cSets === 1) score += 5;
  }

  return score;
}

// ════════════════════════════════════════════════════════════════════════════
//  V2 UPGRADE: COVERAGE-MAXIMIZING PREDICTION SYSTEM
// ════════════════════════════════════════════════════════════════════════════

// ── Learn historical draw PATTERNS (not just individual number frequencies) ──
/**
 * Analyze structural patterns from historical draws:
 * - Gap structure: distances between consecutive numbers in sorted draws
 * - Range distribution: how draws spread across number zones
 * - Sum clustering: which sum ranges produce the most draws
 * - Spread metric: min-to-max range of each draw
 *
 * @param {Array} confirmed - historical draw entries
 * @param {number} n - numbers per draw
 * @param {number} poolSize - total pool
 * @param {boolean} isNumGame
 * @returns {object} pattern profiles for generation guidance
 */
export function analyzeDrawPatterns(confirmed, n, poolSize, isNumGame) {
  if (!confirmed || confirmed.length < 10) return null;
  const parse = d => parseInt(d) || 0;

  // Divide pool into zones (e.g., 1-14, 15-28, 29-42, 43-56, 57-70 for Mega Millions)
  const numZones = Math.max(3, Math.min(7, Math.ceil(poolSize / (isNumGame ? 10 : 3))));
  const zoneSize = Math.ceil(poolSize / numZones);

  const gapHistogram = {};     // gap → count (gaps between sorted numbers)
  const spreadHist = {};       // spread → count (max - min of each draw)
  const zoneCoverage = {};     // "z0-z1-z2" pattern → count
  const sumBuckets = {};       // sum bucket → count
  const rangeHitRate = new Array(numZones).fill(0); // how often each zone is hit

  const recent = confirmed.slice(-Math.min(100, confirmed.length));

  recent.forEach(e => {
    const nums = e.nums.slice(0, n).map(parse);
    const sorted = isNumGame ? [...nums].sort((a, b) => a - b) : nums;

    // Gap analysis (for number games only)
    if (isNumGame) {
      for (let i = 1; i < sorted.length; i++) {
        const gap = sorted[i] - sorted[i - 1];
        const gapBucket = Math.min(gap, 20); // cap at 20
        gapHistogram[gapBucket] = (gapHistogram[gapBucket] || 0) + 1;
      }

      // Spread
      const spread = sorted[sorted.length - 1] - sorted[0];
      const spreadBucket = Math.floor(spread / 5) * 5;
      spreadHist[spreadBucket] = (spreadHist[spreadBucket] || 0) + 1;
    }

    // Zone coverage
    const zoneHits = new Set();
    nums.forEach(num => {
      const k = isNumGame ? num - 1 : num;
      const zone = Math.min(Math.floor(k / zoneSize), numZones - 1);
      zoneHits.add(zone);
      rangeHitRate[zone]++;
    });
    const zoneKey = [...zoneHits].sort().join('-');
    zoneCoverage[zoneKey] = (zoneCoverage[zoneKey] || 0) + 1;

    // Sum buckets (bucket size = 10 for number games, 3 for digit games)
    const sum = nums.reduce((a, b) => a + b, 0);
    const bucketSize = isNumGame ? 10 : 3;
    const sumBucket = Math.floor(sum / bucketSize) * bucketSize;
    sumBuckets[sumBucket] = (sumBuckets[sumBucket] || 0) + 1;
  });

  // Find most common gap patterns
  const totalGaps = Object.values(gapHistogram).reduce((a, b) => a + b, 0) || 1;
  const gapProfile = Object.entries(gapHistogram)
    .map(([gap, count]) => ({ gap: +gap, pct: count / totalGaps }))
    .sort((a, b) => b.pct - a.pct);

  // Find most common zone patterns (top 5)
  const topZonePatterns = Object.entries(zoneCoverage)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([pattern, count]) => ({ zones: pattern.split('-').map(Number), count, pct: count / recent.length }));

  // Find best sum range
  const topSumBuckets = Object.entries(sumBuckets)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([bucket, count]) => ({ lo: +bucket, hi: +bucket + (isNumGame ? 10 : 3), count, pct: count / recent.length }));

  // Zone hit rates (normalized)
  const totalZoneHits = rangeHitRate.reduce((a, b) => a + b, 0) || 1;
  const zoneWeights = rangeHitRate.map(h => h / totalZoneHits);

  // Most common spread range
  const topSpreads = Object.entries(spreadHist)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([spread, count]) => ({ lo: +spread, hi: +spread + 5, pct: count / recent.length }));

  return {
    numZones,
    zoneSize,
    gapProfile,
    topZonePatterns,
    topSumBuckets,
    zoneWeights,
    topSpreads,
    sampleSize: recent.length,
  };
}

// ── Generate a combo that matches historical PATTERN structure ──────────
/**
 * Instead of just picking by frequency, this generates combos that match
 * the structural patterns found in real draws (zone coverage, gap structure,
 * spread range). Much more likely to produce realistic-looking draws.
 *
 * @param {Array} pool - candidate number pool (0-indexed for number games)
 * @param {number} n - numbers to pick
 * @param {boolean} isNumGame
 * @param {number} poolSize
 * @param {Array} overall - frequency array
 * @param {object} patterns - from analyzeDrawPatterns
 * @param {object} learningBoosts - adaptive weight multipliers
 * @param {Set} avoidNumbers - numbers to deprioritize (for diversity across lines)
 * @returns {Array} generated combo
 */
export function generatePatternAwareCombo(pool, n, isNumGame, poolSize, overall, patterns, learningBoosts = null, avoidNumbers = null) {
  const max = Math.max(...overall, 1);

  // If no pattern data, fall back to weighted generation
  if (!patterns || !isNumGame) {
    return generateComboWeighted(pool, n, isNumGame, poolSize, overall, null, learningBoosts);
  }

  const { numZones, zoneSize, zoneWeights, topSpreads, gapProfile } = patterns;

  // Step 1: Decide which zones to draw from (guided by historical zone patterns)
  // Pick n zones with probability proportional to historical hit rates
  const zonesNeeded = Math.min(n, numZones);
  const selectedZones = [];
  const zonePool = [...Array(numZones).keys()];
  const zoneW = [...zoneWeights];

  for (let i = 0; i < zonesNeeded && zonePool.length > 0; i++) {
    const total = zoneW.reduce((a, b) => a + b, 0);
    if (total <= 0) break;
    let r = Math.random() * total, cum = 0, pick = 0;
    for (let j = 0; j < zoneW.length; j++) {
      cum += zoneW[j];
      if (r < cum) { pick = j; break; }
    }
    selectedZones.push(zonePool[pick]);
    zonePool.splice(pick, 1);
    zoneW.splice(pick, 1);
  }

  // Step 2: For each zone, pick the best candidate number
  const result = [];
  const usedNums = new Set();

  selectedZones.forEach(zone => {
    const zoneLo = zone * zoneSize;
    const zoneHi = Math.min((zone + 1) * zoneSize, poolSize);

    // Get candidates in this zone from the candidate pool
    const zoneCandidates = pool.filter(k => k >= zoneLo && k < zoneHi && !usedNums.has(k));
    if (zoneCandidates.length === 0) return;

    // Weight by frequency + learning boosts + diversity penalty
    const weights = zoneCandidates.map(k => {
      let w = 1 + (overall[k] / max) * 3;
      if (learningBoosts) {
        const numKey = isNumGame ? k + 1 : k;
        if (learningBoosts[numKey]) w *= learningBoosts[numKey];
      }
      // Penalize numbers already used in other prediction lines (diversity)
      if (avoidNumbers && avoidNumbers.has(isNumGame ? k + 1 : k)) {
        w *= 0.3; // strong penalty but not zero — still possible
      }
      return w;
    });

    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0) return;
    let r = Math.random() * total, cum = 0, pick = 0;
    for (let i = 0; i < weights.length; i++) {
      cum += weights[i];
      if (r < cum) { pick = i; break; }
    }

    const chosen = zoneCandidates[pick];
    usedNums.add(chosen);
    result.push(isNumGame ? chosen + 1 : chosen);
  });

  // Step 3: Fill remaining slots from overall weighted pool
  while (result.length < n) {
    const remaining = pool.filter(k => !usedNums.has(k));
    if (remaining.length === 0) break;

    const weights = remaining.map(k => {
      let w = 1 + (overall[k] / max) * 3;
      if (learningBoosts) {
        const numKey = isNumGame ? k + 1 : k;
        if (learningBoosts[numKey]) w *= learningBoosts[numKey];
      }
      if (avoidNumbers && avoidNumbers.has(isNumGame ? k + 1 : k)) w *= 0.3;
      return w;
    });

    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0) break;
    let r = Math.random() * total, cum = 0, pick = 0;
    for (let i = 0; i < weights.length; i++) {
      cum += weights[i];
      if (r < cum) { pick = i; break; }
    }

    usedNums.add(remaining[pick]);
    result.push(isNumGame ? remaining[pick] + 1 : remaining[pick]);
  }

  // Sort ascending for number games
  if (isNumGame) result.sort((a, b) => a - b);
  return result;
}

// ── Select 5 diverse lines that MAXIMIZE collective coverage ──────────
/**
 * Instead of picking the top 5 highest-scoring combos (which overlap heavily),
 * this selects 5 lines that together cover the maximum number of distinct numbers,
 * while still respecting quality (passing filters, high score).
 *
 * Uses a greedy set-cover approach:
 * 1. Pick the highest-scoring combo as Line 1
 * 2. For each subsequent line, pick the combo that adds the MOST NEW numbers
 *    not already covered by previous lines, weighted by its score
 *
 * @param {Array} candidates - scored combo objects [{combo, fails, score, ...}]
 * @param {number} n - numbers per combo
 * @param {number} poolSize
 * @param {boolean} isNumGame
 * @param {number} count - how many lines to select (default 5)
 * @returns {Array} selected diverse combos
 */
export function selectDiverseLines(candidates, n, poolSize, isNumGame, count = 5) {
  if (candidates.length <= count) return candidates;

  const selected = [];
  const coveredNumbers = new Set();

  for (let line = 0; line < count; line++) {
    let bestIdx = -1;
    let bestDiversityScore = -Infinity;

    for (let i = 0; i < candidates.length; i++) {
      // Skip already selected
      if (selected.includes(i)) continue;

      const combo = candidates[i].combo;
      const nums = combo.map(d => parseInt(d));

      // Count how many NEW numbers this combo adds
      const newNumbers = nums.filter(num => !coveredNumbers.has(num)).length;

      // Diversity score: heavily weight new coverage, then quality score
      // Line 1: pure quality (newNumbers = n always)
      // Lines 2-5: prioritize coverage contribution
      const qualityScore = candidates[i].score;
      const maxQuality = Math.max(...candidates.map(c => c.score), 1);
      const normalizedQuality = qualityScore / maxQuality;

      let diversityScore;
      if (line === 0) {
        // First line: pick best quality
        diversityScore = normalizedQuality;
      } else {
        // Subsequent lines: 70% coverage + 30% quality
        const coverageRatio = newNumbers / n;
        diversityScore = coverageRatio * 0.7 + normalizedQuality * 0.3;
      }

      // Bonus for passing all filters
      if (candidates[i].fails.length === 0) diversityScore += 0.1;

      if (diversityScore > bestDiversityScore) {
        bestDiversityScore = diversityScore;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0) {
      selected.push(bestIdx);
      candidates[bestIdx].combo.forEach(d => coveredNumbers.add(parseInt(d)));
    }
  }

  return selected.map(i => candidates[i]);
}

// ── Compute coverage metrics for a set of prediction lines ─────────────
/**
 * Measures how well a set of prediction lines covers the number pool.
 * Used for scoring and learning feedback.
 *
 * @param {Array} lines - array of combos (each is array of numbers)
 * @param {number} poolSize
 * @param {boolean} isNumGame
 * @returns {object} coverage metrics
 */
export function computeCoverageMetrics(lines, poolSize, isNumGame) {
  const allNumbers = new Set();
  const numberCounts = {};

  lines.forEach(combo => {
    combo.forEach(d => {
      const num = parseInt(d);
      allNumbers.add(num);
      numberCounts[num] = (numberCounts[num] || 0) + 1;
    });
  });

  const uniqueCount = allNumbers.size;
  const totalPicks = lines.reduce((s, c) => s + c.length, 0);
  const maxPossible = Math.min(totalPicks, isNumGame ? poolSize : 10);

  // Overlap ratio: how much duplication exists across lines
  const overlapCount = totalPicks - uniqueCount;
  const overlapRatio = totalPicks > 0 ? overlapCount / totalPicks : 0;

  // Coverage ratio: what fraction of the pool is covered
  const coverageRatio = uniqueCount / (isNumGame ? poolSize : 10);

  // Zone coverage (for number games)
  const numZones = isNumGame ? Math.ceil(poolSize / 10) : 1;
  const zonesHit = new Set();
  allNumbers.forEach(num => {
    const k = isNumGame ? num - 1 : num;
    zonesHit.add(Math.floor(k / Math.ceil(poolSize / numZones)));
  });
  const zoneCoverage = zonesHit.size / numZones;

  // Spread: range of each line (avg)
  const spreads = lines.map(c => {
    const sorted = [...c].map(Number).sort((a, b) => a - b);
    return sorted[sorted.length - 1] - sorted[0];
  });
  const avgSpread = spreads.length > 0 ? spreads.reduce((a, b) => a + b, 0) / spreads.length : 0;

  return {
    uniqueNumbers: uniqueCount,
    totalPicks,
    maxPossible,
    overlapRatio: +overlapRatio.toFixed(3),
    coverageRatio: +coverageRatio.toFixed(3),
    zoneCoverage: +zoneCoverage.toFixed(3),
    avgSpread: +avgSpread.toFixed(1),
    zonesHit: zonesHit.size,
    totalZones: numZones,
  };
}

// ────────────────────────────────────────────────────────────────────────────
//  F1 SCORE
// ────────────────────────────────────────────────────────────────────────────
export function f1Score(recall, poolLen, n) {
  if (recall <= 0 || poolLen <= 0) return 0;
  const precision = n / poolLen;
  if (precision + recall === 0) return 0;
  return 2 * precision * recall / (precision + recall);
}

// ────────────────────────────────────────────────────────────────────────────
//  AUTO-CALIBRATION ENGINE
// ────────────────────────────────────────────────────────────────────────────
/**
 * Run auto-calibration on the given entries.
 * Returns { bestSA, bestFA, sumStats, oeStats, bestConsec, bestOE, bestRep, avgRep,
 *           saLevels, faLevels, training, testSize, oeTopPct, consecDraws }
 * Calls onProgress(pct) for UI feedback (0-100).
 */
export function runAutoCalibration(entries, n, poolSize, isNumGame, onProgress) {
  const DECAY = 0.02;
  // Use ALL available history — no arbitrary cap.
  // More data = better SA/FA calibration and more accurate filter tuning.
  // testSize is bounded at 50 so calibration time stays manageable.
  const training  = entries; // was: entries.slice(-1000) — removed hard cap
  const testSize  = Math.min(50, Math.max(n + 2, Math.floor(training.length * 0.20)));

  const fullFreq = computeFreqFromEntries(training, n, poolSize, isNumGame, DECAY);
  const saLevels = computeSALevels(training, poolSize, isNumGame, n);
  const faLevels = computeFALevels(fullFreq.overall, poolSize, isNumGame);

  if (onProgress) onProgress(20);

  function saHitRate(lvl) {
    let hits = 0;
    for (let t = training.length - testSize; t < training.length; t++) {
      const trainSoFar = training.slice(0, t);
      if (trainSoFar.length < 3) continue;
      const saL  = computeSALevels(trainSoFar, poolSize, isNumGame, n);
      const pool = saL[lvl] || [];
      const actual = training[t].nums.slice(0, n).map(d => isNumGame ? (parseInt(d) - 1) : parseInt(d));
      if (actual.every(k => pool.includes(k))) hits++;
    }
    return hits / testSize;
  }

  function faHitRate(lvl) {
    let hits = 0;
    for (let t = training.length - testSize; t < training.length; t++) {
      const trainSoFar = training.slice(0, t);
      if (trainSoFar.length < 3) continue;
      const freq2 = computeFreqFromEntries(trainSoFar, n, poolSize, isNumGame, DECAY);
      const faL   = computeFALevels(freq2.overall, poolSize, isNumGame);
      const pool  = faL[lvl] || [];
      const actual = training[t].nums.slice(0, n).map(d => isNumGame ? (parseInt(d) - 1) : parseInt(d));
      if (actual.every(k => pool.includes(k))) hits++;
    }
    return hits / testSize;
  }

  // SA calibration
  const saScores = [0, 1, 2, 3, 4].map(i => ({
    lvl: i, hit: saHitRate(i), score: f1Score(saHitRate(i), (saLevels[i] || []).length || poolSize, n),
    size: (saLevels[i] || []).length,
  }));
  const bestSA = saScores.reduce((b, c) => c.score > b.score ? c : b, saScores[0]);

  if (onProgress) onProgress(45);

  // FA calibration
  const faScores = [0, 1, 2, 3].map(i => ({
    lvl: i, hit: faHitRate(i), score: f1Score(faHitRate(i), (faLevels[i] || []).length || poolSize, n),
    size: (faLevels[i] || []).length,
  }));
  const bestFA = faScores.reduce((b, c) => c.score > b.score ? c : b, faScores[0]);

  if (onProgress) onProgress(65);

  // Filter calibration
  const sumStats = computeSumStats(training, isNumGame, n);
  const oeStats  = computeOEStats(training, n, isNumGame);

  const consecDraws = training.slice(-20).filter(e => {
    const s = [...e.nums.slice(0, n)].map(Number).sort((a, b) => a - b);
    for (let i = 1; i < s.length; i++) if (s[i] - s[i - 1] === 1) return true;
    return false;
  }).length / Math.min(training.length, 20);
  const bestConsec = consecDraws > 0.4 ? 'ok' : 'auto';

  const top2oeCount = (oeStats.top2 || []).filter(v => v >= 0).length;
  const oeTopPct = oeStats.patterns
    ? Object.entries(oeStats.patterns).sort((a, b) => b[1] - a[1]).slice(0, 2).reduce((s, [, v]) => s + v, 0) / training.length
    : 0;
  const bestOE = (top2oeCount >= 1 && oeTopPct >= 0.55) ? 'auto' : 'off';

  const repCounts = [];
  for (let i = 1; i < Math.min(training.length, 50); i++) {
    const prev = training[i - 1].nums.slice(0, n).map(d => parseInt(d));
    const curr = training[i].nums.slice(0, n).map(d => parseInt(d));
    repCounts.push(curr.filter(d => prev.includes(d)).length);
  }
  const avgRep = repCounts.length ? repCounts.reduce((a, b) => a + b, 0) / repCounts.length : 1;
  const bestRep = avgRep > 1.5 ? '2' : avgRep > 0.8 ? '1' : '0';

  if (onProgress) onProgress(80);

  return {
    bestSA, bestFA, sumStats, oeStats,
    bestConsec, bestOE, bestRep, avgRep,
    saLevels, faLevels, training, testSize,
    oeTopPct, consecDraws,
  };
}

// ────────────────────────────────────────────────────────────────────────────
//  RUN OPTIMIZER (5000 iterations, async-chunked via Promise)
// ────────────────────────────────────────────────────────────────────────────
/**
 * Run 5000-iteration optimizer.
 * Returns a Promise resolving to { topPassing, topNearMiss, passes, total, failFreq, pred5, allHist, sumStats, oeStats }
 * @param {Array}  entries   - confirmed history entries
 * @param {number} n         - digits per draw
 * @param {number} poolSize  - total pool
 * @param {boolean} isNumGame
 * @param {number} saLvl     - SA level index (-1 = all)
 * @param {number} faLvl     - FA level index (-1 = all)
 * @param {Array}  saLevels  - precomputed SA levels
 * @param {Array}  faLevels  - precomputed FA levels
 * @param {object} opts      - { sum, oe, consec, hcpl, rep }
 * @param {number} topCount  - how many top combos to return
 * @param {number} decay     - temporal decay λ
 * @param {function} onProgress - (pct 0-100) callback
 * @param {string} drawType  - 'midday' | 'evening'
 */
export function runOptimizerEngine({
  entries, n, poolSize, isNumGame,
  saLvl, faLvl, saLevels, faLevels,
  opts, topCount = 5, decay = 0,
  onProgress, drawType = 'evening',
  gameType = '',
  learningBoosts = null,
}) {
  return new Promise(resolve => {
    const allHist  = getAllHistoryConfirmed(entries, n, drawType);
    if (allHist.length === 0) {
      resolve({ topPassing: [], topNearMiss: [], passes: 0, total: 0, failFreq: {}, pred5: [], allHist, sumStats: computeSumStats([], isNumGame, n), oeStats: computeOEStats([], n, isNumGame), coverageMetrics: null });
      return;
    }

    const histFreq = computeFreqFromEntries(allHist, n, poolSize, isNumGame, decay);
    const { overall, pos } = histFreq;
    const sumStats = computeSumStats(allHist, isNumGame, n);
    const oeStats  = computeOEStats(allHist, n, isNumGame);

    // ── V2: Analyze historical draw patterns for pattern-aware generation ──
    const patterns = analyzeDrawPatterns(allHist, n, poolSize, isNumGame);

    // ══ V3 PDF OPTIMIZER: Pre-compute all strategy data (one-time cost) ══
    const pdfData = isNumGame ? {
      gapProfile:  computeHistoricalGapProfile(allHist, n, isNumGame),
      recentNums:  getRecentDrawNumbers(allHist, n, 3),
      startEnd:    computeStartEndCoverage(allHist, n, isNumGame),
      topPatterns: computeTopPatterns(allHist, poolSize, n, isNumGame, 27),
      topGroups:   computeTopGroups(allHist, poolSize, n, isNumGame, 60),
      idealHCPL:   computeIdealHCPL(allHist, n, overall, poolSize, isNumGame),
      status:      computeEnhancedStatus(allHist, n, isNumGame, overall, sumStats, oeStats),
    } : null;

    // Inject PDF strategy data into opts so checkCombination can use them
    const enhancedOpts = { ...opts };
    if (pdfData) {
      enhancedOpts._gapProfile = pdfData.gapProfile;
      enhancedOpts._recentNums = pdfData.recentNums;
      enhancedOpts._startEnd   = pdfData.startEnd;
    }

    let saPool   = saLvl >= 0 ? (saLevels[saLvl] || []) : [...Array(poolSize).keys()];
    let faPool   = faLvl >= 0 ? (faLevels[faLvl] || []) : [...Array(poolSize).keys()];
    let candPool = saPool.filter(k => faPool.includes(k));
    if (candPool.length < n) candPool = [...new Set([...saPool, ...faPool])];
    if (candPool.length < n) candPool = [...Array(poolSize).keys()];

    // ── V2+V3: Split iterations — 60% pattern-aware, 40% classic weighted ──
    const TOTAL = 5000, CHUNK = 500;
    const PATTERN_ITERS = isNumGame ? Math.floor(TOTAL * 0.6) : 0; // pattern-aware only for number games
    let iter = 0;
    const best = [];

    function runChunk() {
      const end = Math.min(iter + CHUNK, TOTAL);
      for (; iter < end; iter++) {
        let combo;
        if (iter < PATTERN_ITERS && patterns) {
          // V2: Pattern-aware generation — zone-guided, diversity-aware
          combo = generatePatternAwareCombo(candPool, n, isNumGame, poolSize, overall, patterns, learningBoosts, null);
        } else {
          // Classic weighted generation (still benefits from learningBoosts)
          combo = generateComboWeighted(candPool, n, isNumGame, poolSize, overall, pos, learningBoosts);
        }
        const fails = checkCombination(combo, allHist, overall, pos, poolSize, isNumGame, n, sumStats, oeStats, enhancedOpts);
        const score = scoreCombo(combo, allHist, overall, pos, poolSize, isNumGame, n, fails, pdfData);
        best.push({ combo, fails, score });
      }
      if (onProgress) onProgress(Math.round((iter / TOTAL) * 100));
      if (iter < TOTAL) { setTimeout(runChunk, 0); return; }

      // Deduplicate & sort
      const seen   = new Set();
      const unique = best.filter(r => {
        const k = isNumGame ? r.combo.join('-') : [...r.combo].sort((a, b) => a - b).join('-');
        if (seen.has(k)) return false; seen.add(k); return true;
      });
      unique.sort((a, b) => b.score - a.score);

      const passing   = unique.filter(r => r.fails.length === 0);
      const nearMiss  = unique.filter(r => r.fails.length === 1 || r.fails.length === 2);
      const passes    = passing.length;
      const topPassing  = passing.slice(0, topCount);
      const topNearMiss = nearMiss.slice(0, Math.max(3, topCount - topPassing.length + 3));

      const failFreq = {};
      unique.forEach(r => r.fails.forEach(f => { failFreq[f] = (failFreq[f] || 0) + 1; }));

      // ── Walk-forward backtest ──
      const WF_WINDOW = Math.min(200, Math.max(50, Math.floor(allHist.length * 0.20)));
      const annotate = r => {
        const wf = walkForwardBacktest(r.combo, allHist, n, isNumGame, WF_WINDOW);
        return { ...r, walkForwardHits: wf.hits, walkForwardTotal: wf.total };
      };

      const annotatedPassing  = topPassing.map(annotate);
      const annotatedNearMiss = topNearMiss.map(annotate);

      // ══ V3 PDF OPTIMIZER: Enhanced star rating with PDF criteria ══
      const starOf = r => {
        if (pdfData && isNumGame) {
          // Use enhanced star rating incorporating PDF strategy criteria
          const acVal = computeACValue(r.combo);
          const acRange = getACRange(n);
          const extras = {
            acValue: acVal,
            acRange,
            inTopPattern: pdfData.topPatterns ? pdfData.topPatterns.has(getComboPattern(r.combo, poolSize, n, isNumGame)) : false,
            inTopGroup: pdfData.topGroups ? pdfData.topGroups.has(getComboGroup(r.combo, poolSize)) : false,
            hasSK123: pdfData.recentNums ? checkSK123Rule(r.combo, pdfData.recentNums) : true,
            gapConforms: pdfData.gapProfile ? checkGapConformance(r.combo, pdfData.gapProfile) : true,
            startEndOk: pdfData.startEnd ? (() => {
              const sorted = [...r.combo].map(Number).sort((a, b) => a - b);
              return pdfData.startEnd.validStarts.has(sorted[0]) && pdfData.startEnd.validEnds.has(sorted[sorted.length - 1]);
            })() : true,
          };
          return computeEnhancedStarRating(r, extras);
        }
        // Fallback: original star rating for digit games / no PDF data
        if (r.walkForwardHits !== undefined && r.walkForwardTotal > 0) {
          const wfPct = r.walkForwardHits / r.walkForwardTotal;
          const f = r.fails.length;
          if (f === 0 && wfPct >= 0.50) return 5;
          if (f === 0 && wfPct >= 0.30) return 4;
          if (f === 0)                  return 3;
          if (f === 1 && wfPct >= 0.30) return 3;
          if (f === 1)                  return 2;
          if (f === 2 && wfPct >= 0.30) return 2;
          return 1;
        }
        return Math.max(1, 5 - Math.min(r.fails.length, 4));
      };

      // ══ V2: DIVERSITY-BASED PRED5 SELECTION ══
      // Instead of just taking top 5 by score (which overlap heavily),
      // select 5 lines that MAXIMIZE collective number coverage.
      const pred5Candidates = [...annotatedPassing, ...annotatedNearMiss];
      const pred5Seen = new Set();
      const pred5Pool = pred5Candidates.filter(r => {
        const k = isNumGame ? r.combo.join('-') : [...r.combo].sort((a, b) => a - b).join('-');
        if (pred5Seen.has(k)) return false;
        pred5Seen.add(k);
        return true;
      });

      // Sort candidates by star then score (quality pool)
      pred5Pool.sort((a, b) => starOf(b) - starOf(a) || b.score - a.score);

      // Take top 50 quality candidates, then use diversity selection to pick 5
      const qualityPool = pred5Pool.slice(0, Math.min(50, pred5Pool.length));
      let annotatedPred5;

      if (isNumGame && qualityPool.length >= 5) {
        // V2: Diversity-based selection — maximize coverage across the 5 lines
        annotatedPred5 = selectDiverseLines(qualityPool, n, poolSize, isNumGame, 5);
      } else {
        // Fallback: classic top-5 selection
        annotatedPred5 = qualityPool.slice(0, 5);
      }

      // ── V2: Compute coverage metrics for the selected pred5 ──
      const coverageMetrics = annotatedPred5.length > 0
        ? computeCoverageMetrics(annotatedPred5.map(r => r.combo), poolSize, isNumGame)
        : null;

      resolve({
        topPassing: annotatedPassing, topNearMiss: annotatedNearMiss,
        passes, total: unique.length, failFreq,
        pred5: annotatedPred5, allHist, sumStats, oeStats,
        coverageMetrics, // V2: coverage data for tracker learning
        patterns,        // V2: pattern analysis for UI display
        pdfStrategies: pdfData, // V3: PDF optimizer strategy data
      });
    }

    setTimeout(runChunk, 10);
  });
}

// ────────────────────────────────────────────────────────────────────────────
//  NEXT DRAW DATE HELPER
// ────────────────────────────────────────────────────────────────────────────
function getETDateParts(date) {
  const ref = date || new Date();
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hour12: false,
    weekday: 'short',
  });
  const parts = {};
  fmt.formatToParts(ref).forEach(({ type, value }) => { parts[type] = value; });
  return {
    year: parseInt(parts.year), month: parseInt(parts.month), day: parseInt(parts.day),
    hour: parseInt(parts.hour), minute: parseInt(parts.minute),
    dayOfWeek: parts.weekday,
  };
}

export function getNextDrawDate(game, drawType) {
  // Normalise drawType: 'all' or undefined → fall back to 'evening'
  const resolvedDrawType = (!drawType || drawType === 'all') ? 'evening' : drawType;
  const sched = DRAW_SCHEDULE[game]?.[resolvedDrawType];
  if (!sched) return { dateStr: 'TBD', label: '', timeEt: '', timesPt: '', timesCt: '', timesMt: '' };

  const [hStr, mStr, ampm] = sched.time.replace(/ [A-Z]{2,3}$/, '').split(/[: ]/);
  let h = parseInt(hStr); const m = parseInt(mStr);
  if (ampm === 'PM' && h !== 12) h += 12;
  if (ampm === 'AM' && h === 12) h  = 0;
  const drawMinET = h * 60 + m;

  const p = getETDateParts();
  const etNowMin = p.hour * 60 + p.minute;
  const etNoonUTC = new Date(Date.UTC(p.year, p.month - 1, p.day, 12, 0, 0));

  let dayOffset = 0;
  if (etNowMin >= drawMinET) dayOffset = 1;

  // Map game draw-day patterns to allowed day-of-week indices
  // Sun=0, Mon=1, Tue=2, Wed=3, Thu=4, Fri=5, Sat=6
  const DOW_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DRAW_DAYS_MAP = {
    pick6:      [1, 3, 6],        // Mon, Wed, Sat
    powerball:  [1, 3, 6],        // Mon, Wed, Sat
    lotto647:   [1, 3, 6],        // Mon, Wed, Sat
    lotto:      [1, 3, 6],        // Mon, Wed, Sat
    megamil:    [2, 5],           // Tue, Fri
    superlotto: [3, 6],           // Wed, Sat
  };
  const allowedDows = DRAW_DAYS_MAP[game] || null; // null = daily
  for (let tries = 0; tries < 14; tries++) {
    const candidate = new Date(etNoonUTC.getTime() + dayOffset * 86400000);
    const cp = getETDateParts(candidate);
    const dow = DOW_NAMES.indexOf(cp.dayOfWeek);
    if (allowedDows) {
      if (allowedDows.includes(dow)) break;
      dayOffset++;
    } else {
      break;  // Daily games — any day is fine
    }
  }

  const target = new Date(etNoonUTC.getTime() + dayOffset * 86400000);
  const tp = getETDateParts(target);
  const dateStr = `${tp.month}/${tp.day}/${tp.year}`;

  const drawH = Math.floor(drawMinET / 60), drawM = drawMinET % 60;
  const fmt12 = (hh, mm) => {
    const norm = ((hh % 24) + 24) % 24;
    const ap = norm >= 12 ? 'PM' : 'AM';
    const hd = norm % 12 || 12;
    return `${hd}:${mm.toString().padStart(2, '0')} ${ap}`;
  };

  return {
    dateStr,
    label: sched.label,
    timeEt:  `${fmt12(drawH,     drawM)} ET`,
    timesCt: `${fmt12(drawH - 1, drawM)} CT`,
    timesMt: `${fmt12(drawH - 2, drawM)} MT`,
    timesPt: `${fmt12(drawH - 3, drawM)} PT`,
    days:   sched.days,
    states: sched.states,
  };
}

// ────────────────────────────────────────────────────────────────────────────
//  100-DRAW HISTORICAL BACKTEST
// ────────────────────────────────────────────────────────────────────────────
/**
 * Run a historical backtest: for each of the last `count` draws, use only the
 * history *before* that draw to generate optimised predictions, then compare
 * them against the actual result.  Returns an array of per-draw outcome records
 * that can be fed straight into PredictionTracker.savePrediction / resolve.
 *
 * Uses 500 iterations per draw (vs 5000 for live runs) to keep total time
 * reasonable (~20-40 s for 100 draws on a modern browser).
 *
 * @param {object} params
 * @param {Array}  params.allHist   - full confirmed history (oldest→newest)
 * @param {number} params.n
 * @param {number} params.poolSize
 * @param {boolean} params.isNumGame
 * @param {number} params.count     - how many draws to backtest (default 100)
 * @param {function} params.onProgress - (pct 0–100, currentDraw, totalDraws)
 * @returns {Promise<Array>} array of { drawDate, actualNums, pred5, outcomes }
 */
export function runHistoricalBacktest({
  allHist, n, poolSize, isNumGame, count = 100, onProgress,
  bonusPool = 0, bonusHist = [],
}) {
  return new Promise(resolve => {
    if (!allHist || allHist.length < n + 5) { resolve([]); return; }

    const minTraining = Math.max(n + 4, 20);
    const maxTests = Math.min(count, allHist.length - minTraining);
    if (maxTests <= 0) { resolve([]); return; }

    const startIdx = allHist.length - maxTests;
    const results  = [];
    let   cursor   = 0;

    function processNext() {
      const batchEnd = Math.min(cursor + 2, maxTests);
      for (; cursor < batchEnd; cursor++) {
        const testIdx   = startIdx + cursor;
        const training  = allHist.slice(0, testIdx);
        const testDraw  = allHist[testIdx];
        const actualNums = testDraw.nums.slice(0, n).map(Number);

        const DECAY = 0.02;
        const freq  = computeFreqFromEntries(training, n, poolSize, isNumGame, DECAY);
        const { overall, pos } = freq;
        const saLevels = computeSALevels(training, poolSize, isNumGame, n);
        const faLevels = computeFALevels(overall, poolSize, isNumGame);
        const sumStats = computeSumStats(training, isNumGame, n);
        const oeStats  = computeOEStats(training, n, isNumGame);

        // V2: Analyze patterns from training data for pattern-aware generation
        const patterns = isNumGame ? analyzeDrawPatterns(training, n, poolSize, isNumGame) : null;

        const pickBest = (levels) => {
          let best = { lvl: 0, score: 0 };
          for (let l = 0; l < levels.length; l++) {
            const pool = levels[l] || [];
            if (pool.length < n) continue;
            const testN = Math.min(10, training.length - 3);
            let hits = 0;
            for (let t = training.length - testN; t < training.length; t++) {
              const act = training[t].nums.slice(0, n).map(d => isNumGame ? (parseInt(d) - 1) : parseInt(d));
              if (act.every(k => pool.includes(k))) hits++;
            }
            const recall = testN > 0 ? hits / testN : 0;
            const score = f1Score(recall, pool.length, n);
            if (score > best.score) best = { lvl: l, score };
          }
          return best.lvl;
        };
        const bestSA = pickBest(saLevels);
        const bestFA = pickBest(faLevels);

        let saPool   = saLevels[bestSA] || [...Array(poolSize).keys()];
        let faPool   = faLevels[bestFA] || [...Array(poolSize).keys()];
        let candPool = saPool.filter(k => faPool.includes(k));
        if (candPool.length < n) candPool = [...new Set([...saPool, ...faPool])];
        if (candPool.length < n) candPool = [...Array(poolSize).keys()];

        const opts = { sum: 'on', oe: 'auto', consec: 'auto', hcpl: 'on', rep: 'auto' };

        // V3 PDF: Pre-compute PDF strategy data for backtest (lightweight)
        const btPdfData = isNumGame && training.length >= 20 ? {
          gapProfile:  computeHistoricalGapProfile(training, n, isNumGame),
          recentNums:  getRecentDrawNumbers(training, n, 3),
          startEnd:    computeStartEndCoverage(training, n, isNumGame),
          topPatterns: computeTopPatterns(training, poolSize, n, isNumGame, 27),
          topGroups:   computeTopGroups(training, poolSize, n, isNumGame, 60),
          idealHCPL:   computeIdealHCPL(training, n, overall, poolSize, isNumGame),
        } : null;

        // Inject PDF data into opts for checkCombination
        if (btPdfData) {
          opts._gapProfile = btPdfData.gapProfile;
          opts._recentNums = btPdfData.recentNums;
          opts._startEnd   = btPdfData.startEnd;
        }

        // V2+V3: Split iterations — 60% pattern-aware, 40% classic (for number games)
        const ITERS = 500;
        const PATTERN_ITERS = isNumGame && patterns ? Math.floor(ITERS * 0.6) : 0;
        const combos = [];
        const seen = new Set();
        for (let it = 0; it < ITERS; it++) {
          let combo;
          if (it < PATTERN_ITERS) {
            combo = generatePatternAwareCombo(candPool, n, isNumGame, poolSize, overall, patterns, null, null);
          } else {
            combo = generateComboWeighted(candPool, n, isNumGame, poolSize, overall, pos);
          }
          const k = isNumGame ? combo.join('-') : [...combo].sort((a, b) => a - b).join('-');
          if (seen.has(k)) continue;
          seen.add(k);
          const fails = checkCombination(combo, training, overall, pos, poolSize, isNumGame, n, sumStats, oeStats, opts);
          const score = scoreCombo(combo, training, overall, pos, poolSize, isNumGame, n, fails, btPdfData);
          combos.push({ combo, fails, score });
        }
        combos.sort((a, b) => b.score - a.score);
        const passing  = combos.filter(r => r.fails.length === 0);
        const nearMiss = combos.filter(r => r.fails.length === 1 || r.fails.length === 2);
        const allCandidates = [...passing.slice(0, 20), ...nearMiss.slice(0, 10)];

        // V2: Use diversity selection instead of just taking top 5 by score
        let pred5;
        if (isNumGame && allCandidates.length >= 5) {
          pred5 = selectDiverseLines(allCandidates, n, poolSize, isNumGame, 5);
        } else {
          pred5 = allCandidates.slice(0, 5);
        }

        // Compare predictions to actual draw
        const actualSet = new Set(actualNums);
        const outcomes = pred5.map(p => {
          const predNums = p.combo.map(Number);
          const hits   = predNums.filter(d => actualSet.has(d));
          const misses = predNums.filter(d => !actualSet.has(d));
          return {
            nums: predNums,
            score: p.score,
            fails: p.fails,
            hitCount: hits.length,
            hits,
            misses,
            matchPct: hits.length / n,
          };
        });

        const bestLineHits = outcomes.length > 0 ? Math.max(...outcomes.map(o => o.hitCount)) : 0;
        const avgHits = outcomes.length > 0 ? outcomes.reduce((s, o) => s + o.hitCount, 0) / outcomes.length : 0;

        // ── Generate bonus picks from historical bonus data ──
        let backtestBonusPicks = [];
        if (bonusPool > 0) {
          // Build bonus frequency from training data (draws before this test draw)
          const bonusFreqBT = new Array(bonusPool).fill(0);
          for (let bi = 0; bi < testIdx; bi++) {
            const entry = allHist[bi];
            if (entry.nums.length > n) {
              const bk = parseInt(entry.nums[n]) - 1;
              if (bk >= 0 && bk < bonusPool) bonusFreqBT[bk]++;
            }
          }
          // Pick top 5 bonus numbers by frequency
          const topBonus = bonusFreqBT
            .map((cnt, idx) => ({ num: idx + 1, cnt }))
            .sort((a, b) => b.cnt - a.cnt)
            .slice(0, 5)
            .map(x => x.num);
          if (topBonus.length === 0) {
            const step = Math.max(1, Math.floor(bonusPool / 5));
            for (let bi = 0; bi < 5; bi++) topBonus.push(Math.min(1 + step * bi, bonusPool));
          }
          backtestBonusPicks = pred5.map((_, pi) => topBonus[pi % topBonus.length]);

          // Check bonus hits
          const actualBonus = testDraw.nums.length > n ? Number(testDraw.nums[n]) : null;
          outcomes.forEach((o, oi) => {
            o.bonusPick = backtestBonusPicks[oi] || null;
            o.bonusHit = actualBonus != null && o.bonusPick === actualBonus;
          });
        }

        const actualBonus = testDraw.nums.length > n ? Number(testDraw.nums[n]) : null;

        results.push({
          drawDate: testDraw.ts || '',
          drawIndex: testIdx,
          actualNums,
          actualBonus,
          pred5,
          bonusPicks: backtestBonusPicks,
          outcomes,
          bestLineHits,
          avgHits,
          goalMet: bestLineHits >= 3,
          linesGenerated: pred5.length,
        });
      }

      if (onProgress) onProgress(Math.round((cursor / maxTests) * 100), cursor, maxTests);

      if (cursor < maxTests) {
        setTimeout(processNext, 0);
      } else {
        resolve(results);
      }
    }

    setTimeout(processNext, 10);
  });
}

// ────────────────────────────────────────────────────────────────────────────
//  OE OPTIONS HELPER
// ────────────────────────────────────────────────────────────────────────────
export function generateOEOptions(n) {
  const opts = [];
  for (let odd = 0; odd <= n; odd++) opts.push({ value: `${odd}o${n - odd}e`, label: `${odd}O/${n - odd}E` });
  return opts;
}
