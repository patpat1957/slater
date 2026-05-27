/**
 * PredictionTracker.js
 * Tracks prediction outcomes, analyzes miss patterns, and computes adaptive
 * learning weights to improve future predictions toward a 3+ hit goal.
 *
 * Storage: localStorage per game+state+drawTime key.
 * Each record: { id, ts, gameType, state, drawTime, drawDate, combos[], bonusPicks[],
 *                outcome: { actualNums, actualBonus, hits[], bonusHit, matchCounts[] } }
 *
 * Learning output: adaptive weight adjustments fed back into the optimizer engine.
 */

// ── Date normalizer — handles M/D/YYYY, YYYY-MM-DD, and ISO strings ────────
function normalizeDate(d) {
  if (!d) return '';
  const s = String(d).split('T')[0];
  // If already ISO: YYYY-MM-DD
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) return s;
  // US format: M/D/YYYY → YYYY-MM-DD
  const parts = s.split('/');
  if (parts.length === 3) {
    const [m, day, y] = parts;
    return `${y}-${m.padStart(2,'0')}-${day.padStart(2,'0')}`;
  }
  return s; // fallback
}

// ── Storage helpers ──────────────────────────────────────────────────────────
const STORAGE_KEY_PREFIX = 'lotto_tracker_';
const MAX_RECORDS = 100; // keep last 100 prediction sessions per game

function storageKey(gameType, state, drawTime) {
  return `${STORAGE_KEY_PREFIX}${state}_${gameType}_${drawTime}`;
}

function loadRecords(gameType, state, drawTime) {
  try {
    const raw = localStorage.getItem(storageKey(gameType, state, drawTime));
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveRecords(gameType, state, drawTime, records) {
  try {
    const trimmed = records.slice(-MAX_RECORDS);
    localStorage.setItem(storageKey(gameType, state, drawTime), JSON.stringify(trimmed));
  } catch (e) { console.warn('[Tracker] save failed:', e); }
}

// ── Snapshot a prediction session ────────────────────────────────────────────
/**
 * Save the optimizer's pred5 + passing combos as a trackable prediction.
 * Called after each optimizer run.
 * @param {string} gameType
 * @param {string} state
 * @param {string} drawTime
 * @param {string} drawDate  - the next draw date these predictions target
 * @param {Array}  pred5     - [{combo, fails, score, walkForwardHits, walkForwardTotal}]
 * @param {Array}  bonusPicks - bonus ball picks per prediction line (or [])
 * @param {object} meta      - { n, poolSize, isNumGame, totalDraws, starRatings[] }
 */
export function savePrediction({ gameType, state, drawTime, drawDate, pred5, bonusPicks = [], meta = {} }) {
  const records = loadRecords(gameType, state, drawTime);

  // Normalize drawDate to ISO format for consistent matching
  const normDate = normalizeDate(drawDate);
  // Avoid duplicates for the same draw date
  const existing = records.findIndex(r => normalizeDate(r.drawDate) === normDate);
  const record = {
    id: existing >= 0 ? records[existing].id : `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    ts: new Date().toISOString(),
    gameType, state, drawTime, drawDate: normDate,
    combos: pred5.map(p => ({
      nums: [...p.combo],
      score: p.score,
      fails: [...p.fails],
      stars: meta.starRatings ? meta.starRatings[pred5.indexOf(p)] : 0,
      wfHits: p.walkForwardHits ?? 0,
      wfTotal: p.walkForwardTotal ?? 0,
    })),
    bonusPicks: bonusPicks.map(Number),
    meta: {
      n: meta.n || 0,
      poolSize: meta.poolSize || 0,
      isNumGame: !!meta.isNumGame,
      totalDraws: meta.totalDraws || 0,
    },
    outcome: null, // filled in when actual draw is known
  };

  if (existing >= 0) {
    records[existing] = record;
  } else {
    records.push(record);
  }
  saveRecords(gameType, state, drawTime, records);
  return record;
}

// ── Compare predictions against actual draw results ──────────────────────────
/**
 * Given actual draw results, find all unresolved predictions for that draw date
 * and compute hit/miss outcomes.
 * @param {string} gameType
 * @param {string} state
 * @param {string} drawTime
 * @param {Array}  draws - [{date, numbers[], bonus?}] - all available draws
 * @returns {Array} resolved records with outcome data
 */
export function resolvePredictions({ gameType, state, drawTime, draws }) {
  if (!draws || draws.length === 0) return [];
  const records = loadRecords(gameType, state, drawTime);
  let changed = false;

  // Build a map of draw dates → actual numbers (normalized to ISO YYYY-MM-DD)
  const drawMap = {};
  draws.forEach(d => {
    const date = normalizeDate(d.date);
    if (date) drawMap[date] = { nums: (d.numbers || []).map(Number), bonus: d.bonus != null ? Number(d.bonus) : null };
  });

  const resolved = [];
  records.forEach(rec => {
    if (rec.outcome) { resolved.push(rec); return; } // already resolved
    const actual = drawMap[normalizeDate(rec.drawDate)];
    if (!actual) return; // draw hasn't happened yet

    const isNumGame = rec.meta?.isNumGame ?? true;
    const n = rec.meta?.n || rec.combos[0]?.nums.length || 5;
    const actualSet = new Set(actual.nums.slice(0, n));

    rec.outcome = {
      actualNums: [...actual.nums.slice(0, n)],
      actualBonus: actual.bonus,
      results: rec.combos.map((c, i) => {
        const predNums = c.nums.map(Number);
        const hits = predNums.filter(num => actualSet.has(num));
        const misses = predNums.filter(num => !actualSet.has(num));
        const missed = [...actualSet].filter(num => !new Set(predNums).has(num));
        const bonusPick = rec.bonusPicks?.[i] ?? null;
        const bonusHit = bonusPick != null && actual.bonus != null && bonusPick === actual.bonus;
        return {
          hitCount: hits.length,
          hits,
          misses,
          missed,       // actual numbers we failed to predict
          bonusHit,
          bonusPick,
          matchPct: hits.length / n,
        };
      }),
    };

    // Compute best line performance
    rec.outcome.bestLineHits = Math.max(...rec.outcome.results.map(r => r.hitCount));
    rec.outcome.avgHits = rec.outcome.results.reduce((s, r) => s + r.hitCount, 0) / rec.outcome.results.length;
    rec.outcome.anyBonusHit = rec.outcome.results.some(r => r.bonusHit);
    rec.outcome.goalMet = rec.outcome.bestLineHits >= 3; // target: at least 3 hits on best line
    changed = true;
    resolved.push(rec);
  });

  if (changed) saveRecords(gameType, state, drawTime, records);
  return resolved;
}

// ── Get all tracked records (resolved + pending) ─────────────────────────────
export function getTrackerRecords(gameType, state, drawTime) {
  return loadRecords(gameType, state, drawTime);
}

// ── Clear tracker data ───────────────────────────────────────────────────────
export function clearTracker(gameType, state, drawTime) {
  try { localStorage.removeItem(storageKey(gameType, state, drawTime)); } catch {}
}

// ══════════════════════════════════════════════════════════════════════════════
//  ANALYTICS — compute hit/miss statistics and trends
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Compute comprehensive analytics from resolved tracker records.
 * @param {Array} records - tracker records (resolved ones have outcome !== null)
 * @returns {object} analytics summary
 */
export function computeTrackerAnalytics(records) {
  const resolved = records.filter(r => r.outcome);
  if (resolved.length === 0) {
    return {
      totalSessions: records.length,
      resolvedSessions: 0,
      pendingSessions: records.length,
      overallAccuracy: 0,
      avgBestHits: 0,
      avgAvgHits: 0,
      goalMetCount: 0,
      goalMetPct: 0,
      bonusHitRate: 0,
      hitDistribution: {},
      trend: [],
      recentImprovement: 0,
      missAnalysis: null,
    };
  }

  const totalSessions = records.length;
  const resolvedSessions = resolved.length;
  const pendingSessions = totalSessions - resolvedSessions;

  // Hit distribution: how many sessions had best-line hits of 0,1,2,3,4,5,...
  const hitDistribution = {};
  let totalBestHits = 0, totalAvgHits = 0, goalMetCount = 0, bonusHitCount = 0;

  resolved.forEach(r => {
    const best = r.outcome.bestLineHits || 0;
    hitDistribution[best] = (hitDistribution[best] || 0) + 1;
    totalBestHits += best;
    totalAvgHits += r.outcome.avgHits || 0;
    if (r.outcome.goalMet) goalMetCount++;
    if (r.outcome.anyBonusHit) bonusHitCount++;
  });

  const avgBestHits = totalBestHits / resolvedSessions;
  const avgAvgHits = totalAvgHits / resolvedSessions;
  const goalMetPct = (goalMetCount / resolvedSessions) * 100;
  const bonusHitRate = (bonusHitCount / resolvedSessions) * 100;

  // Trend: rolling average of best hits over last N sessions
  const trend = resolved.slice(-20).map((r, i) => ({
    session: i + 1,
    date: r.drawDate,
    bestHits: r.outcome.bestLineHits || 0,
    avgHits: +(r.outcome.avgHits || 0).toFixed(2),
    goalMet: r.outcome.goalMet,
  }));

  // Recent improvement: compare last 5 sessions to previous 5
  const last5 = resolved.slice(-5);
  const prev5 = resolved.slice(-10, -5);
  const last5Avg = last5.length > 0 ? last5.reduce((s, r) => s + (r.outcome.bestLineHits || 0), 0) / last5.length : 0;
  const prev5Avg = prev5.length > 0 ? prev5.reduce((s, r) => s + (r.outcome.bestLineHits || 0), 0) / prev5.length : 0;
  const recentImprovement = last5Avg - prev5Avg;

  return {
    totalSessions, resolvedSessions, pendingSessions,
    overallAccuracy: avgBestHits,
    avgBestHits: +avgBestHits.toFixed(2),
    avgAvgHits: +avgAvgHits.toFixed(2),
    goalMetCount, goalMetPct: +goalMetPct.toFixed(1),
    bonusHitRate: +bonusHitRate.toFixed(1),
    hitDistribution,
    trend,
    recentImprovement: +recentImprovement.toFixed(2),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
//  MISS ANALYSIS — identify patterns in prediction failures
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Analyze why predictions miss — identify recurring patterns in failures.
 * @param {Array} records - resolved tracker records
 * @param {number} poolSize - number pool size for the game
 * @param {boolean} isNumGame
 * @returns {object} miss analysis with actionable insights
 */
export function analyzeMissPatterns(records, poolSize, isNumGame) {
  const resolved = records.filter(r => r.outcome);
  if (resolved.length < 2) return null;

  const n = resolved[0]?.meta?.n || resolved[0]?.combos[0]?.nums.length || 5;

  // Track which numbers we predicted vs what actually drew
  const predictedFreq = new Array(poolSize + 1).fill(0); // 1-indexed for num games
  const actualFreq = new Array(poolSize + 1).fill(0);
  const hitFreq = new Array(poolSize + 1).fill(0);      // numbers that were both predicted AND drawn
  const missedFreq = new Array(poolSize + 1).fill(0);   // actual numbers we failed to predict
  const overPredicted = new Array(poolSize + 1).fill(0); // numbers we predicted but didn't draw

  resolved.forEach(r => {
    const actualNums = r.outcome.actualNums.map(Number);
    const actualSet = new Set(actualNums);
    actualNums.forEach(num => { if (num >= 0 && num <= poolSize) actualFreq[num]++; });

    r.combos.forEach(c => {
      c.nums.forEach(num => {
        const k = Number(num);
        if (k >= 0 && k <= poolSize) {
          predictedFreq[k]++;
          if (actualSet.has(k)) hitFreq[k]++;
          else overPredicted[k]++;
        }
      });
    });

    // Which actual numbers were never predicted in any line
    actualNums.forEach(num => {
      const wasPredicted = r.combos.some(c => c.nums.map(Number).includes(num));
      if (!wasPredicted && num >= 0 && num <= poolSize) missedFreq[num]++;
    });
  });

  // ── Identify frequently missed numbers (drawn but rarely predicted)
  const frequentlyMissed = [];
  for (let i = (isNumGame ? 1 : 0); i <= poolSize; i++) {
    if (actualFreq[i] > 0) {
      const missRate = missedFreq[i] / actualFreq[i];
      if (missRate > 0.5 && actualFreq[i] >= 2) {
        frequentlyMissed.push({ num: i, actualCount: actualFreq[i], missedCount: missedFreq[i], missRate: +(missRate * 100).toFixed(0) });
      }
    }
  }
  frequentlyMissed.sort((a, b) => b.missedCount - a.missedCount);

  // ── Identify over-predicted numbers (predicted often but rarely drawn)
  const overPredictedNums = [];
  for (let i = (isNumGame ? 1 : 0); i <= poolSize; i++) {
    if (predictedFreq[i] > 0) {
      const wasteRate = overPredicted[i] / predictedFreq[i];
      if (wasteRate > 0.7 && predictedFreq[i] >= 3) {
        overPredictedNums.push({ num: i, predictedCount: predictedFreq[i], wastedCount: overPredicted[i], wasteRate: +(wasteRate * 100).toFixed(0) });
      }
    }
  }
  overPredictedNums.sort((a, b) => b.wastedCount - a.wastedCount);

  // ── Range analysis: which number ranges are we missing?
  const rangeSize = isNumGame ? 10 : 5;
  const ranges = {};
  for (let i = (isNumGame ? 1 : 0); i <= poolSize; i++) {
    const rangeKey = `${Math.floor(i / rangeSize) * rangeSize + 1}-${Math.min((Math.floor(i / rangeSize) + 1) * rangeSize, poolSize)}`;
    if (!ranges[rangeKey]) ranges[rangeKey] = { predicted: 0, actual: 0, hits: 0, missed: 0 };
    ranges[rangeKey].predicted += predictedFreq[i];
    ranges[rangeKey].actual += actualFreq[i];
    ranges[rangeKey].hits += hitFreq[i];
    ranges[rangeKey].missed += missedFreq[i];
  }

  // ── Consecutive number analysis
  let consecInActual = 0, consecPredicted = 0;
  resolved.forEach(r => {
    const sorted = [...r.outcome.actualNums].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] - sorted[i - 1] === 1) { consecInActual++; break; }
    }
    r.combos.forEach(c => {
      const s = [...c.nums].sort((a, b) => a - b);
      for (let i = 1; i < s.length; i++) {
        if (s[i] - s[i - 1] === 1) { consecPredicted++; break; }
      }
    });
  });

  // ── Hot/Cold shift detection
  const recentResolved = resolved.slice(-5);
  const olderResolved = resolved.slice(-10, -5);
  const recentActual = new Set();
  const olderActual = new Set();
  recentResolved.forEach(r => r.outcome.actualNums.forEach(n => recentActual.add(n)));
  olderResolved.forEach(r => r.outcome.actualNums.forEach(n => olderActual.add(n)));
  const newHotNums = [...recentActual].filter(n => !olderActual.has(n));
  const coolingNums = [...olderActual].filter(n => !recentActual.has(n));

  return {
    frequentlyMissed: frequentlyMissed.slice(0, 10),
    overPredictedNums: overPredictedNums.slice(0, 10),
    ranges,
    consecutiveAnalysis: {
      actualDrawsWithConsec: consecInActual,
      predictionsWithConsec: consecPredicted,
      totalDraws: resolved.length,
    },
    hotColdShift: {
      newHotNums: newHotNums.slice(0, 5),
      coolingNums: coolingNums.slice(0, 5),
    },
    sampleSize: resolved.length,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
//  ADAPTIVE LEARNING — compute weight adjustments for the optimizer
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Compute adaptive learning weights based on tracker history.
 * These weights adjust the optimizer's combo generation to favor
 * numbers that have been missed and de-emphasize over-predicted numbers.
 *
 * @param {Array} records - resolved tracker records
 * @param {number} poolSize
 * @param {boolean} isNumGame
 * @returns {object} { numberBoosts: Map<num, multiplier>, filterAdjustments, confidence }
 */
export function computeLearningWeights(records, poolSize, isNumGame) {
  const resolved = records.filter(r => r.outcome);
  if (resolved.length < 3) {
    return { numberBoosts: {}, filterAdjustments: {}, confidence: 0, insights: ['Need at least 3 resolved predictions to start learning.'], coverageInsights: null };
  }

  const n = resolved[0]?.meta?.n || 5;
  const missAnalysis = analyzeMissPatterns(records, poolSize, isNumGame);
  if (!missAnalysis) return { numberBoosts: {}, filterAdjustments: {}, confidence: 0, insights: ['Insufficient data for learning.'], coverageInsights: null };

  const numberBoosts = {};
  const insights = [];
  const confidence = Math.min(100, Math.round((resolved.length / 20) * 100));

  // ════════════════════════════════════════════════════════════════════
  //  V2 PATTERN-LEVEL LEARNING — learns from structural patterns, not just numbers
  // ════════════════════════════════════════════════════════════════════

  // ── 1. COVERAGE ANALYSIS: How well did our lines cover the actual draws? ──
  let totalCoverage = 0, totalBestHits = 0;
  const zoneMissCount = {};  // zone → number of times we missed numbers in that zone
  const zoneSize = isNumGame ? Math.ceil(poolSize / 7) : poolSize;

  resolved.forEach(r => {
    const actualNums = r.outcome.actualNums.map(Number);
    const actualSet = new Set(actualNums);
    const allPredicted = new Set();
    r.combos.forEach(c => c.nums.forEach(num => allPredicted.add(Number(num))));

    // Coverage: what % of actual numbers appeared in at least one prediction line
    const covered = [...actualSet].filter(num => allPredicted.has(num)).length;
    totalCoverage += covered / actualSet.size;
    totalBestHits += r.outcome.bestLineHits || 0;

    // Track which zones we missed
    const missed = [...actualSet].filter(num => !allPredicted.has(num));
    missed.forEach(num => {
      const k = isNumGame ? num - 1 : num;
      const zone = Math.floor(k / zoneSize);
      zoneMissCount[zone] = (zoneMissCount[zone] || 0) + 1;
    });
  });

  const avgCoverage = totalCoverage / resolved.length;
  const avgBestHitsRaw = totalBestHits / resolved.length;

  // ── 2. ZONE-BASED BOOSTING: Strongly boost numbers in frequently-missed zones ──
  if (isNumGame && Object.keys(zoneMissCount).length > 0) {
    const maxZoneMiss = Math.max(...Object.values(zoneMissCount));
    Object.entries(zoneMissCount).forEach(([zone, missCount]) => {
      if (missCount < 2) return; // need at least 2 misses to act
      const intensity = missCount / maxZoneMiss; // 0-1 scale
      const zoneLo = parseInt(zone) * zoneSize;
      const zoneHi = Math.min((parseInt(zone) + 1) * zoneSize, poolSize);
      // Boost ALL numbers in the missed zone (zone-level, not individual)
      for (let k = zoneLo; k < zoneHi; k++) {
        const num = isNumGame ? k + 1 : k;
        const zoneBoost = 1 + intensity * 0.8; // up to 1.8x for most-missed zones
        numberBoosts[num] = (numberBoosts[num] || 1) * zoneBoost;
      }
    });
    const missedZones = Object.entries(zoneMissCount)
      .filter(([, c]) => c >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([z, c]) => {
        const lo = parseInt(z) * zoneSize + 1;
        const hi = Math.min((parseInt(z) + 1) * zoneSize, poolSize);
        return `${lo}-${hi} (missed ${c}×)`;
      });
    if (missedZones.length > 0) {
      insights.push(`🗺️ Zone boost: ranges ${missedZones.join(', ')} — draws keep landing here but predictions miss`);
    }
  }

  // ── 3. COVERAGE-DRIVEN BOOSTING: If coverage is low, aggressively boost missed numbers ──
  const coverageMultiplier = avgCoverage < 0.4 ? 2.0 : avgCoverage < 0.6 ? 1.5 : 1.0;
  missAnalysis.frequentlyMissed.forEach(({ num, missRate }) => {
    // V2: Stronger boost scaled by coverage deficit
    const boost = 1 + (missRate / 100) * 0.5 * coverageMultiplier; // up to 2.0x when coverage is poor
    numberBoosts[num] = (numberBoosts[num] || 1) * boost;
  });
  if (missAnalysis.frequentlyMissed.length > 0) {
    const nums = missAnalysis.frequentlyMissed.slice(0, 5).map(m => m.num);
    insights.push(`🔺 Boosting under-predicted: ${nums.join(', ')}${coverageMultiplier > 1 ? ` (${coverageMultiplier}× intensity — coverage only ${(avgCoverage * 100).toFixed(0)}%)` : ''}`);
  }

  // ── 4. PENALIZE OVER-PREDICTED (V2: stronger penalties when wasting coverage) ──
  const wasteMultiplier = avgCoverage < 0.5 ? 1.5 : 1.0; // penalize harder when coverage is poor
  missAnalysis.overPredictedNums.forEach(({ num, wasteRate }) => {
    const penalty = 1 - (wasteRate / 100) * 0.3 * wasteMultiplier; // down to 0.55x when coverage is poor
    numberBoosts[num] = (numberBoosts[num] || 1) * Math.max(0.4, penalty);
  });
  if (missAnalysis.overPredictedNums.length > 0) {
    const nums = missAnalysis.overPredictedNums.slice(0, 5).map(m => m.num);
    insights.push(`🔻 Reducing over-predicted: ${nums.join(', ')}${wasteMultiplier > 1 ? ' (stronger penalty — poor coverage)' : ''}`);
  }

  // ── 5. HOT/COLD SHIFT ADJUSTMENTS ──
  if (missAnalysis.hotColdShift.newHotNums.length > 0) {
    missAnalysis.hotColdShift.newHotNums.forEach(num => {
      numberBoosts[num] = (numberBoosts[num] || 1) * 1.4; // V2: stronger 1.4x (was 1.3)
    });
    insights.push(`🔥 New hot numbers: ${missAnalysis.hotColdShift.newHotNums.join(', ')}`);
  }
  if (missAnalysis.hotColdShift.coolingNums.length > 0) {
    missAnalysis.hotColdShift.coolingNums.forEach(num => {
      numberBoosts[num] = (numberBoosts[num] || 1) * 0.7; // V2: stronger 0.7x (was 0.8)
    });
    insights.push(`❄️ Cooling numbers: ${missAnalysis.hotColdShift.coolingNums.join(', ')}`);
  }

  // ── 6. GAP/SPREAD PATTERN LEARNING: Boost numbers that fill typical gap patterns ──
  // Analyze what gaps between consecutive sorted numbers appear in actual draws
  if (isNumGame && resolved.length >= 5) {
    const recentActual = resolved.slice(-5).map(r => r.outcome.actualNums.map(Number).sort((a, b) => a - b));
    // Find which "positions" in the pool real draws tend to land
    // e.g., if draws cluster around low + middle + high, boost numbers in underrepresented zones
    const positionBuckets = new Array(n).fill(0);
    recentActual.forEach(nums => {
      nums.forEach((num, i) => {
        positionBuckets[i] += num;
      });
    });
    const avgPositions = positionBuckets.map(s => Math.round(s / recentActual.length));

    // Boost numbers near the average positions (within ±3)
    avgPositions.forEach(avgPos => {
      for (let delta = -3; delta <= 3; delta++) {
        const num = avgPos + delta;
        if (num >= 1 && num <= poolSize) {
          const proximity = 1 - Math.abs(delta) / 4; // 1.0 at center, 0.25 at edge
          numberBoosts[num] = (numberBoosts[num] || 1) * (1 + proximity * 0.2); // up to 1.2x
        }
      }
    });
    insights.push(`📐 Pattern learning: typical draw positions ~${avgPositions.join(', ')} — boosting nearby numbers`);
  }

  // ── 7. FILTER ADJUSTMENTS ──
  const filterAdjustments = {};
  const { actualDrawsWithConsec, totalDraws } = missAnalysis.consecutiveAnalysis;
  const consecActualRate = totalDraws > 0 ? actualDrawsWithConsec / totalDraws : 0;
  if (consecActualRate > 0.4) {
    filterAdjustments.consec = 'ok';
    insights.push(`📊 Consecutive numbers in ${(consecActualRate * 100).toFixed(0)}% of draws — CON filter relaxed`);
  }

  const rangeEntries = Object.entries(missAnalysis.ranges);
  const imbalancedRanges = rangeEntries.filter(([, v]) => v.actual > 0 && v.missed / v.actual > 0.6);
  if (imbalancedRanges.length > 0) {
    insights.push(`📊 Under-represented ranges: ${imbalancedRanges.map(([k]) => k).join(', ')}`);
  }

  // ── 8. GOAL PROGRESS + COVERAGE REPORT ──
  const analytics = computeTrackerAnalytics(records);
  const coverageInsights = {
    avgCoverage: +(avgCoverage * 100).toFixed(0),
    avgBestHits: +avgBestHitsRaw.toFixed(2),
    zoneMissCount,
    coverageMultiplier,
    wasteMultiplier,
  };

  if (analytics.avgBestHits < 3) {
    insights.push(`🎯 Goal: 3+ hits. Current avg: ${analytics.avgBestHits} hits, coverage: ${coverageInsights.avgCoverage}%. Learning active.`);
  } else {
    insights.push(`✅ Goal met! Avg ${analytics.avgBestHits} best-line hits, coverage: ${coverageInsights.avgCoverage}%.`);
  }

  // ── 9. BONUS BALL LEARNING (Mega Ball / Powerball) ──
  const bonusLearning = analyzeBonusBallPatterns(resolved);
  if (bonusLearning) {
    if (bonusLearning.hitRate > 0) {
      insights.push(`🎱 Bonus ball hit rate: ${bonusLearning.hitRate.toFixed(0)}% (${bonusLearning.hits}/${bonusLearning.total}). ${bonusLearning.hitRate >= 20 ? 'Good performance!' : 'Learning from misses.'}`);
    }
    if (bonusLearning.hotBonusNums.length > 0) {
      insights.push(`🎱 Hot bonus numbers: ${bonusLearning.hotBonusNums.join(', ')} — appeared most often in recent draws`);
    }
  }

  return {
    numberBoosts,
    filterAdjustments,
    confidence,
    insights,
    analytics,
    coverageInsights, // V2: coverage-level learning data
    bonusLearning,    // V2: bonus ball learning data
  };
}

/**
 * Analyze bonus ball (Mega Ball / Powerball) patterns from resolved predictions.
 * Returns hot/cold bonus numbers and hit rate for bonus ball learning.
 */
function analyzeBonusBallPatterns(resolved) {
  // Only analyze records that have a bonus ball in the actual draw
  const withBonus = resolved.filter(r => r.outcome?.actualBonus != null);
  if (withBonus.length < 2) return null;

  let bonusHits = 0;
  const actualBonusFreq = {};   // actual bonus numbers → frequency
  const pickedBonusFreq = {};   // our picks → frequency
  const bonusHitNums = {};      // bonus numbers we successfully predicted

  withBonus.forEach(r => {
    const actualBonus = Number(r.outcome.actualBonus);
    actualBonusFreq[actualBonus] = (actualBonusFreq[actualBonus] || 0) + 1;

    // Check our bonus picks
    const picks = (r.bonusPicks || []).filter(b => b != null).map(Number);
    picks.forEach(p => { pickedBonusFreq[p] = (pickedBonusFreq[p] || 0) + 1; });

    if (r.outcome.anyBonusHit) {
      bonusHits++;
      bonusHitNums[actualBonus] = (bonusHitNums[actualBonus] || 0) + 1;
    }
  });

  // Hot bonus numbers: most frequently drawn in actual results (top 5)
  const hotBonusNums = Object.entries(actualBonusFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([num]) => Number(num));

  // Over-picked bonus: numbers we keep picking but never come up
  const overPickedBonus = Object.entries(pickedBonusFreq)
    .filter(([num, count]) => count >= 3 && !actualBonusFreq[num])
    .map(([num]) => Number(num))
    .slice(0, 5);

  // Under-picked bonus: frequently drawn but we rarely pick
  const underPickedBonus = Object.entries(actualBonusFreq)
    .filter(([num, count]) => count >= 2 && (!pickedBonusFreq[num] || pickedBonusFreq[num] < count))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([num]) => Number(num));

  return {
    total: withBonus.length,
    hits: bonusHits,
    hitRate: withBonus.length > 0 ? (bonusHits / withBonus.length) * 100 : 0,
    hotBonusNums,
    overPickedBonus,
    underPickedBonus,
    actualBonusFreq,
    pickedBonusFreq,
    bonusHitNums,
  };
}

// ── Load learning weights for use by the optimizer ───────────────────────────
export function getLearningWeights(gameType, state, drawTime, poolSize, isNumGame) {
  const records = loadRecords(gameType, state, drawTime);
  return computeLearningWeights(records, poolSize, isNumGame);
}

// ══════════════════════════════════════════════════════════════════════════════
//  TODAY-FOCUSED HELPERS — get results for today / most recent draws
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Get the most recent resolved prediction sessions (today or last few days).
 * Returns the most recent N resolved sessions, with the newest first.
 * @param {Array} records - all tracker records
 * @param {number} count  - how many recent sessions to return (default 10)
 * @returns {Array} recent resolved sessions, newest first
 */
export function getRecentResults(records, count = 10) {
  return records
    .filter(r => r.outcome)
    .sort((a, b) => (b.drawDate || '').localeCompare(a.drawDate || ''))
    .slice(0, count);
}

/**
 * Get pending (unresolved) predictions — these are predictions waiting for today's draw.
 * @param {Array} records
 * @returns {Array} unresolved predictions, newest first
 */
export function getPendingPredictions(records) {
  return records
    .filter(r => !r.outcome)
    .sort((a, b) => (b.drawDate || '').localeCompare(a.drawDate || ''));
}

/**
 * Compute a "what we learned today" summary from the most recent resolved session.
 * Focuses on actionable insights from the latest draw.
 * @param {object} latestResolved - the most recently resolved record
 * @param {number} poolSize
 * @param {boolean} isNumGame
 * @returns {object} today's learning summary
 */
export function computeTodayLearning(latestResolved, poolSize, isNumGame) {
  if (!latestResolved?.outcome) return null;

  const o = latestResolved.outcome;
  const n = latestResolved.meta?.n || latestResolved.combos[0]?.nums.length || 5;
  const actualSet = new Set(o.actualNums.map(Number));

  // Which numbers did we predict across all lines?
  const predictedSet = new Set();
  latestResolved.combos.forEach(c => c.nums.forEach(num => predictedSet.add(Number(num))));

  // Numbers we completely missed (in actual but not in ANY prediction line)
  const totallyMissed = [...actualSet].filter(num => !predictedSet.has(num));
  // Numbers we predicted but were NOT in the actual draw
  const wastedPredictions = [...predictedSet].filter(num => !actualSet.has(num));
  // Numbers that were hits (in both predicted and actual)
  const hitNumbers = [...actualSet].filter(num => predictedSet.has(num));

  // Coverage: what % of actual numbers did we include in at least one line?
  const coverage = actualSet.size > 0 ? (hitNumbers.length / actualSet.size * 100) : 0;

  // ── Bonus ball (Mega Ball / Powerball) analysis ──
  const actualBonus = o.actualBonus != null ? Number(o.actualBonus) : null;
  const bonusPicks = latestResolved.bonusPicks || [];
  const bonusHitCount = o.results ? o.results.filter(r => r.bonusHit).length : 0;
  const anyBonusHit = bonusHitCount > 0;
  const bonusPredicted = bonusPicks.filter(b => b != null).map(Number);
  const uniqueBonusPicks = [...new Set(bonusPredicted)];

  // Best and worst lines
  const lineResults = o.results.map((r, i) => ({
    lineNum: i + 1,
    hits: r.hitCount,
    hitNums: r.hits,
    missNums: r.misses,
    bonusHit: r.bonusHit,
    bonusPick: r.bonusPick,
  }));
  const bestLine = lineResults.reduce((a, b) => a.hits >= b.hits ? a : b, lineResults[0]);
  const worstLine = lineResults.reduce((a, b) => a.hits <= b.hits ? a : b, lineResults[0]);

  return {
    drawDate: latestResolved.drawDate,
    actualNums: o.actualNums,
    actualBonus,
    bestLineHits: o.bestLineHits,
    avgHits: o.avgHits,
    goalMet: o.goalMet,
    totallyMissed,
    wastedPredictions,
    hitNumbers,
    coverage: +coverage.toFixed(0),
    bestLine,
    worstLine,
    lineResults,
    totalLines: latestResolved.combos.length,
    // Bonus ball summary
    bonusSummary: actualBonus != null ? {
      actualBonus,
      bonusPicks: uniqueBonusPicks,
      anyBonusHit,
      bonusHitCount,
      totalLines: lineResults.length,
    } : null,
    adjustments: buildAdjustments(totallyMissed, wastedPredictions, hitNumbers, o.bestLineHits, n, actualBonus, anyBonusHit, uniqueBonusPicks),
  };
}

/**
 * Build specific adjustment recommendations based on today's results.
 */
function buildAdjustments(missed, wasted, hits, bestHits, n, actualBonus = null, anyBonusHit = false, bonusPicks = []) {
  const adj = [];
  if (missed.length > 0) {
    adj.push({
      type: 'boost',
      icon: '🔺',
      text: `Boost numbers ${missed.join(', ')} — drawn today but missing from all prediction lines`,
      nums: missed,
    });
  }
  if (wasted.length > 3) {
    const topWasted = wasted.slice(0, 5);
    adj.push({
      type: 'reduce',
      icon: '🔻',
      text: `Reduce weight on ${topWasted.join(', ')} — predicted but not drawn today`,
      nums: topWasted,
    });
  }
  if (bestHits < 3) {
    adj.push({
      type: 'goal',
      icon: '🎯',
      text: `Best line had ${bestHits}/${n} hits — need ${3 - bestHits} more to reach goal. Increasing diversity in next predictions.`,
    });
  } else {
    adj.push({
      type: 'success',
      icon: '✅',
      text: `Goal met! Best line matched ${bestHits}/${n} numbers. Reinforcing current strategy.`,
    });
  }
  if (hits.length > 0) {
    adj.push({
      type: 'reinforce',
      icon: '💪',
      text: `Numbers ${hits.join(', ')} hit today — maintaining their weight for next prediction`,
      nums: hits,
    });
  }
  // ── Bonus ball (Mega Ball / Powerball) adjustments ──
  if (actualBonus != null) {
    if (anyBonusHit) {
      adj.push({
        type: 'bonus_hit',
        icon: '🎱',
        text: `Bonus ball ${actualBonus} HIT! Our pick matched. Reinforcing bonus strategy.`,
        nums: [actualBonus],
      });
    } else {
      const pickedStr = bonusPicks.length > 0 ? bonusPicks.join(', ') : 'none';
      adj.push({
        type: 'bonus_miss',
        icon: '🎱',
        text: `Bonus ball was ${actualBonus} — we picked ${pickedStr}. Adjusting bonus weights for next draw.`,
        nums: [actualBonus],
      });
    }
  }
  return adj;
}

// ── Storage key for learning weights cache ───────────────────────────────────
const LEARNING_KEY_PREFIX = 'lotto_learning_';
export function saveLearningCache(gameType, state, drawTime, weights) {
  try {
    localStorage.setItem(`${LEARNING_KEY_PREFIX}${state}_${gameType}_${drawTime}`, JSON.stringify(weights));
  } catch {}
}
export function loadLearningCache(gameType, state, drawTime) {
  try {
    const raw = localStorage.getItem(`${LEARNING_KEY_PREFIX}${state}_${gameType}_${drawTime}`);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
