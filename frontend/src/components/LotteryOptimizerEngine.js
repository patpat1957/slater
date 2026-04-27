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
 */

// ── Prime digits (0-9 scope): 2,3,5,7
export const PRIME_DIGITS = new Set([2, 3, 5, 7]);
// ── Low digits: 0-4, High: 5-9
export const LOW_DIGITS = new Set([0, 1, 2, 3, 4]);

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

  // CON check
  if (opts.consec === 'no') {
    const s = [...nums].sort((a, b) => a - b);
    for (let i = 1; i < s.length; i++) if (s[i] - s[i - 1] === 1) { fails.push('CON'); break; }
  } else if (opts.consec === 'auto') {
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

  return fails;
}

// ────────────────────────────────────────────────────────────────────────────
//  WEIGHTED COMBO GENERATOR
// ────────────────────────────────────────────────────────────────────────────
export function generateComboWeighted(pool, n, isNumGame, poolSize, overall, pos) {
  const max     = Math.max(...overall, 1);
  const weights = pool.map(k => 1 + (overall[k] / max) * 3);
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


export function scoreCombo(combo, confirmed, overall, pos, poolSize, isNumGame, n, fails) {
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

  return score;
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
}) {
  return new Promise(resolve => {
    // Use ALL confirmed entries for this game — do not filter by drawType alone
    // so the 5,000 iterations are backed by the full actual draw history
    const allHist  = getAllHistoryConfirmed(entries, n, drawType);
    if (allHist.length === 0) {
      resolve({ topPassing: [], topNearMiss: [], passes: 0, total: 0, failFreq: {}, pred5: [], allHist, sumStats: computeSumStats([], isNumGame, n), oeStats: computeOEStats([], n, isNumGame) });
      return;
    }

    const histFreq = computeFreqFromEntries(allHist, n, poolSize, isNumGame, decay);
    const { overall, pos } = histFreq;
    const sumStats = computeSumStats(allHist, isNumGame, n);
    const oeStats  = computeOEStats(allHist, n, isNumGame);

    let saPool   = saLvl >= 0 ? (saLevels[saLvl] || []) : [...Array(poolSize).keys()];
    let faPool   = faLvl >= 0 ? (faLevels[faLvl] || []) : [...Array(poolSize).keys()];
    let candPool = saPool.filter(k => faPool.includes(k));
    if (candPool.length < n) candPool = [...new Set([...saPool, ...faPool])];
    if (candPool.length < n) candPool = [...Array(poolSize).keys()];

    const TOTAL = 5000, CHUNK = 500;
    let iter = 0;
    const best = [];

    function runChunk() {
      const end = Math.min(iter + CHUNK, TOTAL);
      for (; iter < end; iter++) {
        const combo = generateComboWeighted(candPool, n, isNumGame, poolSize, overall, pos);
        const fails = checkCombination(combo, allHist, overall, pos, poolSize, isNumGame, n, sumStats, oeStats, opts);
        const score = scoreCombo(combo, allHist, overall, pos, poolSize, isNumGame, n, fails);
        best.push({ combo, fails, score });
      }
      if (onProgress) onProgress(Math.round((iter / TOTAL) * 100));
      if (iter < TOTAL) { setTimeout(runChunk, 0); return; }

      // Deduplicate & sort
      const seen   = new Set();
      const unique = best.filter(r => { const k = r.combo.join('-'); if (seen.has(k)) return false; seen.add(k); return true; });
      unique.sort((a, b) => b.score - a.score);

      const passing   = unique.filter(r => r.fails.length === 0);
      const nearMiss  = unique.filter(r => r.fails.length === 1 || r.fails.length === 2);
      const passes    = passing.length;
      const topPassing  = passing.slice(0, topCount);
      const topNearMiss = nearMiss.slice(0, Math.max(3, topCount - topPassing.length + 3));

      const failFreq = {};
      unique.forEach(r => r.fails.forEach(f => { failFreq[f] = (failFreq[f] || 0) + 1; }));

      // ── Walk-forward backtest on real historical draws ──
      // Window scales with history size: 20% of draws, min 50, max 200.
      // More history = larger test window = higher statistical confidence.
      const WF_WINDOW = Math.min(200, Math.max(50, Math.floor(allHist.length * 0.20)));
      const annotate = r => {
        const wf = walkForwardBacktest(r.combo, allHist, n, isNumGame, WF_WINDOW);
        return { ...r, walkForwardHits: wf.hits, walkForwardTotal: wf.total };
      };

      // ── Annotate ALL passing and near-miss combos before selecting pred5
      //    so that star counts are available and pred5 can be sorted by star★ DESC.
      const annotatedPassing  = topPassing.map(annotate);
      const annotatedNearMiss = topNearMiss.map(annotate);

      // ── Inline star-count logic (mirrors OptimizerPanel.getStarCount) for sorting ──
      const starOf = r => {
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

      // Build pred5 from annotated results, sorted by star DESC then score DESC.
      // This ensures the highest-quality lines appear first in the Predictions panel.
      const pred5Candidates = [
        ...annotatedPassing,
        ...annotatedNearMiss,
      ];
      // De-duplicate by combo key (topPassing and topNearMiss can overlap if topCount < 5)
      const pred5Seen = new Set();
      const pred5Pool = pred5Candidates.filter(r => {
        const k = r.combo.join('-');
        if (pred5Seen.has(k)) return false;
        pred5Seen.add(k);
        return true;
      });
      pred5Pool.sort((a, b) => starOf(b) - starOf(a) || b.score - a.score);
      const annotatedPred5 = pred5Pool.slice(0, 5);

      resolve({ topPassing: annotatedPassing, topNearMiss: annotatedNearMiss, passes, total: unique.length, failFreq, pred5: annotatedPred5, allHist, sumStats, oeStats });
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
//  OE OPTIONS HELPER
// ────────────────────────────────────────────────────────────────────────────
export function generateOEOptions(n) {
  const opts = [];
  for (let odd = 0; odd <= n; odd++) opts.push({ value: `${odd}o${n - odd}e`, label: `${odd}O/${n - odd}E` });
  return opts;
}
