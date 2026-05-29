/**
 * HitMissDashboard.js
 * Full-screen dashboard showing Hit/Miss analytics, Amount Won calculations,
 * trend charts, per-game breakdowns, and recent draw history across ALL
 * tracked games/states/draw-times stored in localStorage by PredictionTracker.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend,
  AreaChart, Area,
} from 'recharts';

/* ═══════════════════════════════════════════════════════════════════════
   PRIZE STRUCTURES — official approximate payouts by game + match count
   ═══════════════════════════════════════════════════════════════════════ */
const PRIZE_TABLES = {
  powerball: {
    label: 'Powerball', cost: 2,
    // matches → { prize, withBonus? }  (main numbers only, no Power Play)
    prizes: [
      { match: 5, bonus: true,  prize: 'Jackpot', value: 100_000_000, label: '5+PB = Jackpot' },
      { match: 5, bonus: false, prize: '$1,000,000', value: 1_000_000, label: '5 = $1M' },
      { match: 4, bonus: true,  prize: '$50,000', value: 50_000, label: '4+PB = $50K' },
      { match: 4, bonus: false, prize: '$100', value: 100, label: '4 = $100' },
      { match: 3, bonus: true,  prize: '$100', value: 100, label: '3+PB = $100' },
      { match: 3, bonus: false, prize: '$7', value: 7, label: '3 = $7' },
      { match: 2, bonus: true,  prize: '$7', value: 7, label: '2+PB = $7' },
      { match: 1, bonus: true,  prize: '$4', value: 4, label: '1+PB = $4' },
      { match: 0, bonus: true,  prize: '$4', value: 4, label: '0+PB = $4' },
    ],
    lookupPrize(hitCount, bonusHit) {
      const row = this.prizes.find(p => p.match === hitCount && p.bonus === !!bonusHit);
      if (row) return row.value;
      // If bonus is false, check without bonus
      const noBonus = this.prizes.find(p => p.match === hitCount && !p.bonus);
      return noBonus ? noBonus.value : 0;
    }
  },
  megamil: {
    label: 'Mega Millions', cost: 2,
    prizes: [
      { match: 5, bonus: true,  prize: 'Jackpot', value: 50_000_000, label: '5+MB = Jackpot' },
      { match: 5, bonus: false, prize: '$1,000,000', value: 1_000_000, label: '5 = $1M' },
      { match: 4, bonus: true,  prize: '$10,000', value: 10_000, label: '4+MB = $10K' },
      { match: 4, bonus: false, prize: '$500', value: 500, label: '4 = $500' },
      { match: 3, bonus: true,  prize: '$200', value: 200, label: '3+MB = $200' },
      { match: 3, bonus: false, prize: '$10', value: 10, label: '3 = $10' },
      { match: 2, bonus: true,  prize: '$10', value: 10, label: '2+MB = $10' },
      { match: 1, bonus: true,  prize: '$4', value: 4, label: '1+MB = $4' },
      { match: 0, bonus: true,  prize: '$2', value: 2, label: '0+MB = $2' },
    ],
    lookupPrize(hitCount, bonusHit) {
      const row = this.prizes.find(p => p.match === hitCount && p.bonus === !!bonusHit);
      if (row) return row.value;
      const noBonus = this.prizes.find(p => p.match === hitCount && !p.bonus);
      return noBonus ? noBonus.value : 0;
    }
  },
  superlotto: {
    label: 'SuperLotto Plus', cost: 1,
    prizes: [
      { match: 5, bonus: true,  prize: 'Jackpot', value: 7_000_000, label: '5+Mega = Jackpot' },
      { match: 5, bonus: false, prize: '$25,000', value: 25_000, label: '5 = $25K' },
      { match: 4, bonus: true,  prize: '$3,383', value: 3_383, label: '4+Mega' },
      { match: 4, bonus: false, prize: '$84', value: 84, label: '4 = $84' },
      { match: 3, bonus: true,  prize: '$37', value: 37, label: '3+Mega = $37' },
      { match: 3, bonus: false, prize: '$7', value: 7, label: '3 = $7' },
      { match: 2, bonus: true,  prize: '$5', value: 5, label: '2+Mega = $5' },
      { match: 1, bonus: true,  prize: '$1', value: 1, label: '1+Mega = $1' },
    ],
    lookupPrize(hitCount, bonusHit) {
      const row = this.prizes.find(p => p.match === hitCount && p.bonus === !!bonusHit);
      if (row) return row.value;
      const noBonus = this.prizes.find(p => p.match === hitCount && !p.bonus);
      return noBonus ? noBonus.value : 0;
    }
  },
  fantasy5: {
    label: 'Fantasy 5', cost: 1,
    prizes: [
      { match: 5, bonus: false, prize: 'Jackpot', value: 60_000, label: '5 = ~$60K' },
      { match: 4, bonus: false, prize: '$500', value: 500, label: '4 = $500' },
      { match: 3, bonus: false, prize: '$15', value: 15, label: '3 = $15' },
      { match: 2, bonus: false, prize: '$1', value: 1, label: '2 = $1' },
    ],
    lookupPrize(hitCount) { const r = this.prizes.find(p => p.match === hitCount); return r ? r.value : 0; }
  },
  pick5: {
    label: 'Pick 5', cost: 1,
    prizes: [
      { match: 5, bonus: false, prize: '$50,000', value: 50_000, label: '5 = $50K' },
      { match: 4, bonus: false, prize: '$500', value: 500, label: '4 = $500' },
      { match: 3, bonus: false, prize: '$20', value: 20, label: '3 = $20' },
      { match: 2, bonus: false, prize: '$1', value: 1, label: '2 = $1' },
    ],
    lookupPrize(hitCount) { const r = this.prizes.find(p => p.match === hitCount); return r ? r.value : 0; }
  },
  cash5: {
    label: 'Cash 5', cost: 1,
    prizes: [
      { match: 5, bonus: false, prize: '$100,000', value: 100_000, label: '5 = $100K' },
      { match: 4, bonus: false, prize: '$500', value: 500, label: '4 = $500' },
      { match: 3, bonus: false, prize: '$10', value: 10, label: '3 = $10' },
      { match: 2, bonus: false, prize: '$1', value: 1, label: '2 = $1' },
    ],
    lookupPrize(hitCount) { const r = this.prizes.find(p => p.match === hitCount); return r ? r.value : 0; }
  },
  lotto: {
    label: 'Lotto', cost: 1,
    prizes: [
      { match: 6, bonus: false, prize: 'Jackpot', value: 2_000_000, label: '6 = Jackpot' },
      { match: 5, bonus: false, prize: '$1,000', value: 1_000, label: '5 = $1K' },
      { match: 4, bonus: false, prize: '$50', value: 50, label: '4 = $50' },
      { match: 3, bonus: false, prize: '$5', value: 5, label: '3 = $5' },
    ],
    lookupPrize(hitCount) { const r = this.prizes.find(p => p.match === hitCount); return r ? r.value : 0; }
  },
  // Pick 3/4 — exact match only (digit games)
  pick3: {
    label: 'Pick 3', cost: 1,
    prizes: [
      { match: 3, bonus: false, prize: '$500', value: 500, label: '3 = $500 (straight)' },
      { match: 2, bonus: false, prize: '$0', value: 0, label: '2 = $0' },
    ],
    lookupPrize(hitCount) { return hitCount >= 3 ? 500 : 0; }
  },
  pick4: {
    label: 'Pick 4', cost: 1,
    prizes: [
      { match: 4, bonus: false, prize: '$5,000', value: 5_000, label: '4 = $5K (straight)' },
      { match: 3, bonus: false, prize: '$0', value: 0, label: '3 = $0' },
    ],
    lookupPrize(hitCount) { return hitCount >= 4 ? 5000 : 0; }
  },
};

// Fallback for games not in PRIZE_TABLES
const FALLBACK_PRIZE = {
  label: 'Unknown', cost: 1,
  prizes: [
    { match: 5, bonus: false, prize: '$50,000', value: 50_000, label: '5 = $50K' },
    { match: 4, bonus: false, prize: '$200', value: 200, label: '4 = $200' },
    { match: 3, bonus: false, prize: '$10', value: 10, label: '3 = $10' },
  ],
  lookupPrize(hitCount) { const r = this.prizes.find(p => p.match === hitCount); return r ? r.value : 0; }
};

function getPrizeTable(gameType) {
  const key = (gameType || '').toLowerCase().replace(/\s+/g, '').replace('megamillions', 'megamil');
  return PRIZE_TABLES[key] || FALLBACK_PRIZE;
}

/* ═══════════════════════════════════════════════════════════════════════
   SCAN localStorage FOR ALL TRACKER DATA
   ═══════════════════════════════════════════════════════════════════════ */
const TRACKER_PREFIX = 'lotto_tracker_';

function scanAllTrackerData() {
  const results = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(TRACKER_PREFIX)) continue;
      const suffix = key.slice(TRACKER_PREFIX.length); // e.g. "ca_powerball_evening"
      const parts = suffix.split('_');
      if (parts.length < 3) continue;
      const state = parts[0];
      const gameType = parts[1];
      const drawTime = parts.slice(2).join('_');
      try {
        const records = JSON.parse(localStorage.getItem(key));
        if (Array.isArray(records) && records.length > 0) {
          results.push({ state, gameType, drawTime, records });
        }
      } catch {}
    }
  } catch {}
  return results;
}

/* ═══════════════════════════════════════════════════════════════════════
   COMPUTE DASHBOARD STATS FROM ALL RECORDS
   ═══════════════════════════════════════════════════════════════════════ */
function computeDashboardStats(allGameData) {
  let totalSessions = 0;
  let resolvedSessions = 0;
  let pendingSessions = 0;
  let totalLinesPlayed = 0;
  let totalHits = 0;
  let totalMisses = 0;
  let totalBonusHits = 0;
  let totalAmountWon = 0;
  let totalCost = 0;
  let goalMetCount = 0;
  const hitDistribution = {};
  const trendData = [];
  const perGameStats = {};
  const recentHistory = [];
  const prizeBreakdown = {};

  allGameData.forEach(({ state, gameType, drawTime, records }) => {
    const prizeTable = getPrizeTable(gameType);
    const gameKey = `${state.toUpperCase()}_${gameType}`;

    if (!perGameStats[gameKey]) {
      perGameStats[gameKey] = {
        state: state.toUpperCase(), gameType, label: prizeTable.label || gameType,
        sessions: 0, resolved: 0, totalLines: 0, totalHits: 0,
        bestHits: 0, avgBestHits: 0, goalMetCount: 0,
        amountWon: 0, cost: 0, bonusHits: 0,
        hitDistribution: {},
      };
    }
    const gs = perGameStats[gameKey];

    records.forEach(rec => {
      totalSessions++;
      gs.sessions++;

      if (!rec.outcome) {
        pendingSessions++;
        return;
      }

      resolvedSessions++;
      gs.resolved++;
      const linesCount = rec.outcome.results?.length || rec.combos?.length || 0;
      totalLinesPlayed += linesCount;
      gs.totalLines += linesCount;

      const bestLineHits = rec.outcome.bestLineHits || 0;
      hitDistribution[bestLineHits] = (hitDistribution[bestLineHits] || 0) + 1;
      gs.hitDistribution[bestLineHits] = (gs.hitDistribution[bestLineHits] || 0) + 1;
      gs.bestHits = Math.max(gs.bestHits, bestLineHits);

      if (rec.outcome.goalMet) { goalMetCount++; gs.goalMetCount++; }
      if (rec.outcome.anyBonusHit) { totalBonusHits++; gs.bonusHits++; }

      // Per-line: compute hits, misses, prizes
      let sessionWon = 0;
      const lineCost = prizeTable.cost || 1;
      (rec.outcome.results || []).forEach((line, li) => {
        const hits = line.hitCount || 0;
        totalHits += hits;
        gs.totalHits += hits;
        const n = rec.meta?.n || rec.combos?.[0]?.nums?.length || 5;
        totalMisses += (n - hits);

        // Prize calculation
        const prize = prizeTable.lookupPrize(hits, !!line.bonusHit);
        sessionWon += prize;
        totalCost += lineCost;
        gs.cost += lineCost;

        // Breakdown
        if (prize > 0) {
          const tier = `${hits}${line.bonusHit ? '+Bonus' : ''}`;
          if (!prizeBreakdown[tier]) prizeBreakdown[tier] = { count: 0, total: 0 };
          prizeBreakdown[tier].count++;
          prizeBreakdown[tier].total += prize;
        }
      });

      totalAmountWon += sessionWon;
      gs.amountWon += sessionWon;

      // Trend data
      trendData.push({
        date: rec.drawDate || '',
        gameKey,
        gameType,
        state: state.toUpperCase(),
        bestHits: bestLineHits,
        avgHits: +(rec.outcome.avgHits || 0).toFixed(2),
        goalMet: rec.outcome.goalMet,
        won: sessionWon,
        lines: linesCount,
        bonusHit: rec.outcome.anyBonusHit,
      });

      // Recent history
      recentHistory.push({
        id: rec.id,
        date: rec.drawDate || '',
        gameType, state: state.toUpperCase(), drawTime,
        gameLabel: prizeTable.label || gameType,
        actualNums: rec.outcome.actualNums || [],
        actualBonus: rec.outcome.actualBonus,
        bestLineHits,
        goalMet: rec.outcome.goalMet,
        anyBonusHit: rec.outcome.anyBonusHit,
        won: sessionWon,
        linesCount,
        combos: rec.combos || [],
        results: rec.outcome.results || [],
        n: rec.meta?.n || rec.combos?.[0]?.nums?.length || 5,
      });
    });

    // Finalize per-game averages
    if (gs.resolved > 0) {
      gs.avgBestHits = +(records
        .filter(r => r.outcome)
        .reduce((s, r) => s + (r.outcome.bestLineHits || 0), 0) / gs.resolved).toFixed(2);
    }
  });

  // Sort recent history newest first
  recentHistory.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  // Sort trend by date
  trendData.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  return {
    totalSessions, resolvedSessions, pendingSessions,
    totalLinesPlayed, totalHits, totalMisses,
    totalBonusHits, totalAmountWon, totalCost,
    goalMetCount,
    goalMetPct: resolvedSessions > 0 ? +((goalMetCount / resolvedSessions) * 100).toFixed(1) : 0,
    hitRate: totalLinesPlayed > 0 ? +((totalHits / (totalHits + totalMisses)) * 100).toFixed(1) : 0,
    avgBestHits: resolvedSessions > 0
      ? +(Object.entries(hitDistribution).reduce((s, [k, v]) => s + Number(k) * v, 0) / resolvedSessions).toFixed(2)
      : 0,
    netProfit: totalAmountWon - totalCost,
    roi: totalCost > 0 ? +(((totalAmountWon - totalCost) / totalCost) * 100).toFixed(1) : 0,
    hitDistribution,
    trendData,
    perGameStats: Object.values(perGameStats).sort((a, b) => b.resolved - a.resolved),
    recentHistory: recentHistory.slice(0, 50),
    prizeBreakdown,
  };
}

/* ═══════════════════════════════════════════════════════════════════════
   FORMATTING HELPERS
   ═══════════════════════════════════════════════════════════════════════ */
function fmtMoney(val) {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 10_000) return `$${(val / 1_000).toFixed(1)}K`;
  if (val >= 1_000) return `$${val.toLocaleString()}`;
  return `$${val.toFixed(0)}`;
}

function fmtMoneyFull(val) {
  return `$${val.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/* ═══════════════════════════════════════════════════════════════════════
   CHART COLORS
   ═══════════════════════════════════════════════════════════════════════ */
const CHART_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#ec4899', '#14b8a6', '#f97316'];
const HIT_COLORS = { 0: '#ef4444', 1: '#f97316', 2: '#f59e0b', 3: '#10b981', 4: '#3b82f6', 5: '#8b5cf6', 6: '#ec4899' };

/* ═══════════════════════════════════════════════════════════════════════
   CUSTOM TOOLTIP
   ═══════════════════════════════════════════════════════════════════════ */
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: '#1f2937', border: '1px solid #374151', borderRadius: 8,
      padding: '8px 12px', fontSize: '0.78rem', color: '#e5e7eb', boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
    }}>
      <div style={{ fontWeight: 700, marginBottom: 4, color: '#f3f4f6' }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color, marginBottom: 2 }}>
          {p.name}: <strong>{typeof p.value === 'number' && p.name.includes('$') ? fmtMoney(p.value) : p.value}</strong>
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   MAIN DASHBOARD COMPONENT
   ═══════════════════════════════════════════════════════════════════════ */
export default function HitMissDashboard() {
  const [stats, setStats] = useState(null);
  const [selectedGame, setSelectedGame] = useState('all');
  const [showDetail, setShowDetail] = useState(null); // expanded recent draw
  const [tab, setTab] = useState('overview'); // 'overview' | 'games' | 'history' | 'prizes'

  // Load data from localStorage
  const loadData = useCallback(() => {
    const allGameData = scanAllTrackerData();
    if (allGameData.length === 0) {
      setStats(null);
      return;
    }
    const computed = computeDashboardStats(allGameData);
    setStats(computed);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Refresh on storage change (cross-tab)
  useEffect(() => {
    const handler = () => loadData();
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, [loadData]);

  // Filtered stats by game
  const filteredTrend = useMemo(() => {
    if (!stats) return [];
    if (selectedGame === 'all') return stats.trendData;
    return stats.trendData.filter(d => `${d.state}_${d.gameType}` === selectedGame);
  }, [stats, selectedGame]);

  const filteredHistory = useMemo(() => {
    if (!stats) return [];
    if (selectedGame === 'all') return stats.recentHistory;
    return stats.recentHistory.filter(d => `${d.state}_${d.gameType}` === selectedGame);
  }, [stats, selectedGame]);

  // Hit distribution chart data
  const hitDistChartData = useMemo(() => {
    if (!stats) return [];
    const dist = stats.hitDistribution;
    const maxKey = Math.max(...Object.keys(dist).map(Number), 5);
    const data = [];
    for (let i = 0; i <= maxKey; i++) {
      data.push({ hits: `${i} hit${i !== 1 ? 's' : ''}`, count: dist[i] || 0, fill: HIT_COLORS[i] || '#6b7280' });
    }
    return data;
  }, [stats]);

  // Trend chart (rolling avg)
  const trendChartData = useMemo(() => {
    if (!filteredTrend.length) return [];
    // Group by date, show rolling average of best hits
    const byDate = {};
    filteredTrend.forEach(d => {
      if (!byDate[d.date]) byDate[d.date] = { date: d.date, total: 0, count: 0, won: 0, lines: 0 };
      byDate[d.date].total += d.bestHits;
      byDate[d.date].count++;
      byDate[d.date].won += d.won;
      byDate[d.date].lines += d.lines;
    });
    const arr = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
    let runningSum = 0, runningCount = 0;
    return arr.map(d => {
      runningSum += d.total;
      runningCount += d.count;
      return {
        date: d.date.slice(5), // MM-DD
        bestHits: +(d.total / d.count).toFixed(2),
        rollingAvg: +(runningSum / runningCount).toFixed(2),
        won: d.won,
      };
    });
  }, [filteredTrend]);

  // Won over time (cumulative)
  const cumulativeWon = useMemo(() => {
    if (!trendChartData.length) return [];
    let cumWon = 0, cumCost = 0;
    return trendChartData.map(d => {
      cumWon += d.won;
      cumCost += (stats?.totalCost || 0) / trendChartData.length; // approximate
      return { ...d, cumWon, cumCost: Math.round(cumCost) };
    });
  }, [trendChartData, stats]);

  // Per-game pie chart
  const gamePieData = useMemo(() => {
    if (!stats) return [];
    return stats.perGameStats
      .filter(g => g.resolved > 0)
      .map((g, i) => ({
        name: `${g.state} ${g.label}`,
        value: g.resolved,
        won: g.amountWon,
        fill: CHART_COLORS[i % CHART_COLORS.length],
      }));
  }, [stats]);

  /* ── Empty state ── */
  if (!stats) {
    return (
      <div className="hmd">
        <div className="hmd-empty">
          <div className="hmd-empty__icon">📊</div>
          <h2 className="hmd-empty__title">No Prediction Data Yet</h2>
          <p className="hmd-empty__text">
            Start tracking your predictions to see hit/miss analytics, amount won,
            and performance trends here.
          </p>
          <div className="hmd-empty__steps">
            <div className="hmd-empty__step">
              <span className="hmd-empty__step-num">1</span>
              <span>Go to <strong>Predictor</strong> mode</span>
            </div>
            <div className="hmd-empty__step">
              <span className="hmd-empty__step-num">2</span>
              <span>Select a game and run <strong>Auto-Calibrate</strong></span>
            </div>
            <div className="hmd-empty__step">
              <span className="hmd-empty__step-num">3</span>
              <span>After draws, predictions are <strong>auto-compared</strong></span>
            </div>
            <div className="hmd-empty__step">
              <span className="hmd-empty__step-num">4</span>
              <span>Come back here to see your <strong>full dashboard</strong></span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const profit = stats.netProfit;
  const profitColor = profit >= 0 ? '#10b981' : '#ef4444';

  return (
    <div className="hmd">
      {/* ══════════════════════════════════════════════════════
          HEADER
          ══════════════════════════════════════════════════════ */}
      <div className="hmd-header">
        <div className="hmd-header__title-row">
          <h2 className="hmd-header__title">
            <span className="hmd-header__icon">📊</span>
            Hit &amp; Miss Dashboard
          </h2>
          <button className="hmd-refresh-btn" onClick={loadData} title="Refresh data">
            🔄 Refresh
          </button>
        </div>
        <p className="hmd-header__sub">
          Track your predictions vs actual draws, see amount won, and analyze your performance over time.
        </p>
      </div>

      {/* ══════════════════════════════════════════════════════
          GAME FILTER
          ══════════════════════════════════════════════════════ */}
      <div className="hmd-filter">
        <button
          className={`hmd-filter__btn${selectedGame === 'all' ? ' hmd-filter__btn--active' : ''}`}
          onClick={() => setSelectedGame('all')}
        >
          All Games
        </button>
        {stats.perGameStats.filter(g => g.resolved > 0).map(g => {
          const key = `${g.state}_${g.gameType}`;
          return (
            <button
              key={key}
              className={`hmd-filter__btn${selectedGame === key ? ' hmd-filter__btn--active' : ''}`}
              onClick={() => setSelectedGame(key)}
            >
              {g.state} {g.label}
            </button>
          );
        })}
      </div>

      {/* ══════════════════════════════════════════════════════
          TAB NAVIGATION
          ══════════════════════════════════════════════════════ */}
      <div className="hmd-tabs">
        {[
          { id: 'overview', icon: '📈', label: 'Overview' },
          { id: 'games',    icon: '🎮', label: 'Per Game' },
          { id: 'history',  icon: '📋', label: 'History' },
          { id: 'prizes',   icon: '💰', label: 'Prizes' },
        ].map(t => (
          <button
            key={t.id}
            className={`hmd-tab${tab === t.id ? ' hmd-tab--active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            <span className="hmd-tab__icon">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════
          TAB CONTENT
          ══════════════════════════════════════════════════════ */}
      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.2 }}
        >
          {tab === 'overview' && (
            <OverviewTab
              stats={stats} profit={profit} profitColor={profitColor}
              hitDistChartData={hitDistChartData}
              trendChartData={trendChartData}
              cumulativeWon={cumulativeWon}
              gamePieData={gamePieData}
            />
          )}
          {tab === 'games' && (
            <GamesTab stats={stats} />
          )}
          {tab === 'history' && (
            <HistoryTab
              history={filteredHistory}
              showDetail={showDetail}
              setShowDetail={setShowDetail}
            />
          )}
          {tab === 'prizes' && (
            <PrizesTab stats={stats} />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   OVERVIEW TAB — KPI Cards + Charts
   ═══════════════════════════════════════════════════════════════════════ */
function OverviewTab({ stats, profit, profitColor, hitDistChartData, trendChartData, cumulativeWon, gamePieData }) {
  return (
    <div className="hmd-overview">
      {/* KPI Cards */}
      <div className="hmd-kpis">
        <KpiCard icon="🎮" label="Games Tracked" value={stats.resolvedSessions} sub={`${stats.pendingSessions} pending`} color="#3b82f6" />
        <KpiCard icon="🎯" label="Total Hits" value={stats.totalHits.toLocaleString()} sub={`across ${stats.totalLinesPlayed} lines`} color="#10b981" />
        <KpiCard icon="❌" label="Total Misses" value={stats.totalMisses.toLocaleString()} sub={`${stats.hitRate}% hit rate`} color="#ef4444" />
        <KpiCard icon="⭐" label="Avg Best Hits" value={stats.avgBestHits} sub={`${stats.goalMetPct}% goal met (3+)`} color="#f59e0b" />
        <KpiCard icon="💰" label="Amount Won" value={fmtMoney(stats.totalAmountWon)} sub={`from ${fmtMoney(stats.totalCost)} spent`} color="#10b981" large />
        <KpiCard icon={profit >= 0 ? "📈" : "📉"} label="Net Profit/Loss" value={`${profit >= 0 ? '+' : ''}${fmtMoney(Math.abs(profit))}`} sub={`${stats.roi}% ROI`} color={profitColor} large />
        <KpiCard icon="🎱" label="Bonus Hits" value={stats.totalBonusHits} sub={`${stats.resolvedSessions > 0 ? ((stats.totalBonusHits / stats.resolvedSessions) * 100).toFixed(1) : 0}% rate`} color="#8b5cf6" />
      </div>

      {/* Charts Row */}
      <div className="hmd-charts-row">
        {/* Hit Distribution */}
        <div className="hmd-chart-card">
          <h3 className="hmd-chart-card__title">Hit Distribution (Best Line per Draw)</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={hitDistChartData} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="hits" tick={{ fill: '#9ca3af', fontSize: 12 }} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 12 }} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="count" name="Draws" radius={[6, 6, 0, 0]}>
                {hitDistChartData.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Hit Trend */}
        <div className="hmd-chart-card">
          <h3 className="hmd-chart-card__title">Best Hits Trend Over Time</h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={trendChartData} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="date" tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 12 }} domain={[0, 'auto']} />
              <Tooltip content={<ChartTooltip />} />
              <Line type="monotone" dataKey="bestHits" name="Best Hits" stroke="#3b82f6" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="rollingAvg" name="Running Avg" stroke="#10b981" strokeWidth={2} strokeDasharray="5 5" dot={false} />
              {/* Goal line at 3 */}
              <Line type="monotone" dataKey={() => 3} name="Goal (3)" stroke="#f59e0b" strokeWidth={1} strokeDasharray="3 3" dot={false} />
              <Legend wrapperStyle={{ fontSize: 11, color: '#9ca3af' }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Second Row: Cumulative Winnings + Game Pie */}
      <div className="hmd-charts-row">
        <div className="hmd-chart-card">
          <h3 className="hmd-chart-card__title">Cumulative Winnings Over Time</h3>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={cumulativeWon} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
              <defs>
                <linearGradient id="wonGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="date" tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 12 }} tickFormatter={v => fmtMoney(v)} />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="cumWon" name="$ Won (Cumulative)" stroke="#10b981" fill="url(#wonGrad)" strokeWidth={2} />
              <Legend wrapperStyle={{ fontSize: 11, color: '#9ca3af' }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="hmd-chart-card">
          <h3 className="hmd-chart-card__title">Games Tracked Breakdown</h3>
          {gamePieData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={gamePieData}
                  dataKey="value" nameKey="name"
                  cx="50%" cy="50%"
                  innerRadius={50} outerRadius={90}
                  paddingAngle={3}
                  label={({ name, value }) => `${name} (${value})`}
                  labelLine={{ stroke: '#6b7280' }}
                >
                  {gamePieData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ textAlign: 'center', padding: 40, color: '#6b7280' }}>No game data</div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   KPI CARD
   ═══════════════════════════════════════════════════════════════════════ */
function KpiCard({ icon, label, value, sub, color, large }) {
  return (
    <motion.div
      className={`hmd-kpi${large ? ' hmd-kpi--large' : ''}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="hmd-kpi__icon" style={{ color }}>{icon}</div>
      <div className="hmd-kpi__label">{label}</div>
      <div className="hmd-kpi__value" style={{ color }}>{value}</div>
      <div className="hmd-kpi__sub">{sub}</div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   GAMES TAB — Per-game breakdown table
   ═══════════════════════════════════════════════════════════════════════ */
function GamesTab({ stats }) {
  return (
    <div className="hmd-games">
      <div className="hmd-games__table-wrap">
        <table className="hmd-games__table">
          <thead>
            <tr>
              <th>Game</th>
              <th>State</th>
              <th>Draws</th>
              <th>Lines</th>
              <th>Best Hits</th>
              <th>Avg Best</th>
              <th>Goal Met</th>
              <th>Bonus Hits</th>
              <th>Won</th>
              <th>Spent</th>
              <th>Net</th>
            </tr>
          </thead>
          <tbody>
            {stats.perGameStats.map((g, i) => {
              const net = g.amountWon - g.cost;
              return (
                <tr key={i}>
                  <td style={{ fontWeight: 700 }}>{g.label}</td>
                  <td><span className="hmd-state-badge">{g.state}</span></td>
                  <td>{g.resolved}</td>
                  <td>{g.totalLines}</td>
                  <td style={{ fontWeight: 700, color: g.bestHits >= 3 ? '#10b981' : '#f59e0b' }}>{g.bestHits}</td>
                  <td>{g.avgBestHits}</td>
                  <td>
                    <span style={{ color: g.goalMetCount > 0 ? '#10b981' : '#6b7280' }}>
                      {g.goalMetCount} ({g.resolved > 0 ? ((g.goalMetCount / g.resolved) * 100).toFixed(0) : 0}%)
                    </span>
                  </td>
                  <td style={{ color: g.bonusHits > 0 ? '#8b5cf6' : '#6b7280' }}>{g.bonusHits}</td>
                  <td style={{ color: '#10b981', fontWeight: 600 }}>{fmtMoney(g.amountWon)}</td>
                  <td style={{ color: '#9ca3af' }}>{fmtMoney(g.cost)}</td>
                  <td style={{ color: net >= 0 ? '#10b981' : '#ef4444', fontWeight: 700 }}>
                    {net >= 0 ? '+' : ''}{fmtMoney(Math.abs(net))}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} style={{ fontWeight: 700 }}>TOTAL</td>
              <td style={{ fontWeight: 700 }}>{stats.resolvedSessions}</td>
              <td style={{ fontWeight: 700 }}>{stats.totalLinesPlayed}</td>
              <td></td>
              <td style={{ fontWeight: 700 }}>{stats.avgBestHits}</td>
              <td style={{ fontWeight: 700 }}>{stats.goalMetCount} ({stats.goalMetPct}%)</td>
              <td style={{ fontWeight: 700 }}>{stats.totalBonusHits}</td>
              <td style={{ fontWeight: 700, color: '#10b981' }}>{fmtMoney(stats.totalAmountWon)}</td>
              <td style={{ fontWeight: 700, color: '#9ca3af' }}>{fmtMoney(stats.totalCost)}</td>
              <td style={{ fontWeight: 700, color: stats.netProfit >= 0 ? '#10b981' : '#ef4444' }}>
                {stats.netProfit >= 0 ? '+' : ''}{fmtMoney(Math.abs(stats.netProfit))}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Per-game hit distribution mini-charts */}
      <div className="hmd-games__charts">
        {stats.perGameStats.filter(g => g.resolved > 0).map((g, gi) => {
          const dist = g.hitDistribution;
          const maxKey = Math.max(...Object.keys(dist).map(Number), 5);
          const data = [];
          for (let i = 0; i <= maxKey; i++) {
            data.push({ hits: `${i}`, count: dist[i] || 0, fill: HIT_COLORS[i] || '#6b7280' });
          }
          return (
            <div key={gi} className="hmd-games__mini-chart">
              <h4 className="hmd-games__mini-title">{g.state} {g.label}</h4>
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: -10 }}>
                  <XAxis dataKey="hits" tick={{ fill: '#9ca3af', fontSize: 10 }} />
                  <YAxis tick={{ fill: '#9ca3af', fontSize: 10 }} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {data.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="hmd-games__mini-stats">
                Won: <strong style={{ color: '#10b981' }}>{fmtMoney(g.amountWon)}</strong>
                {' · '}Avg: <strong>{g.avgBestHits}</strong> hits
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   HISTORY TAB — Recent draws with expandable detail
   ═══════════════════════════════════════════════════════════════════════ */
function HistoryTab({ history, showDetail, setShowDetail }) {
  if (history.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '48px 20px', color: '#6b7280' }}>
        <div style={{ fontSize: 48 }}>📋</div>
        <p>No resolved predictions yet for the selected game.</p>
      </div>
    );
  }

  return (
    <div className="hmd-history">
      {history.map((rec, ri) => {
        const isExpanded = showDetail === rec.id;
        const won = rec.won;
        return (
          <motion.div
            key={rec.id || ri}
            className={`hmd-history__row${rec.goalMet ? ' hmd-history__row--met' : ''}`}
            layout
          >
            <div
              className="hmd-history__summary"
              onClick={() => setShowDetail(isExpanded ? null : rec.id)}
              style={{ cursor: 'pointer' }}
            >
              <div className="hmd-history__left">
                <span className="hmd-history__result-icon">
                  {rec.goalMet ? '✅' : '❌'}
                </span>
                <div>
                  <div className="hmd-history__date">{rec.date}</div>
                  <div className="hmd-history__game">{rec.state} {rec.gameLabel} · {rec.drawTime}</div>
                </div>
              </div>
              <div className="hmd-history__right">
                <span className={`hmd-history__hits${rec.bestLineHits >= 3 ? ' hmd-history__hits--good' : ''}`}>
                  {rec.bestLineHits}/{rec.n}
                </span>
                {won > 0 && (
                  <span className="hmd-history__won">{fmtMoney(won)}</span>
                )}
                {rec.anyBonusHit && (
                  <span className="hmd-history__bonus-badge">+Bonus</span>
                )}
                <span className="hmd-history__arrow">{isExpanded ? '▲' : '▼'}</span>
              </div>
            </div>

            {/* Expanded detail */}
            <AnimatePresence>
              {isExpanded && (
                <motion.div
                  className="hmd-history__detail"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  {/* Actual numbers */}
                  <div className="hmd-history__actual">
                    <span className="hmd-history__detail-label">Actual Draw:</span>
                    {rec.actualNums.map((num, ni) => {
                      const isHit = rec.results.some(r => r.hits?.includes(num));
                      return (
                        <span
                          key={ni}
                          className={`hmd-ball${isHit ? ' hmd-ball--hit' : ''}`}
                        >{num}</span>
                      );
                    })}
                    {rec.actualBonus != null && (
                      <span className="hmd-ball hmd-ball--bonus">{rec.actualBonus}</span>
                    )}
                  </div>

                  {/* Per-line results */}
                  {rec.results.map((line, li) => (
                    <div key={li} className="hmd-history__line">
                      <span className="hmd-history__line-num">L{li + 1}</span>
                      {rec.combos[li]?.nums?.map((num, ni) => {
                        const isHit = line.hits?.includes(Number(num));
                        return (
                          <span key={ni} className={`hmd-ball hmd-ball--sm${isHit ? ' hmd-ball--hit' : ' hmd-ball--miss'}`}>
                            {num}
                          </span>
                        );
                      })}
                      {line.bonusPick != null && (
                        <span className={`hmd-ball hmd-ball--sm${line.bonusHit ? ' hmd-ball--bonus-hit' : ' hmd-ball--bonus-miss'}`}>
                          {line.bonusPick}
                        </span>
                      )}
                      <span className={`hmd-history__line-count${(line.hitCount || 0) >= 3 ? ' hmd-history__line-count--good' : ''}`}>
                        {line.hitCount || 0}/{rec.n}
                        {line.bonusHit && <span className="hmd-history__line-bonus">+B</span>}
                      </span>
                      {(() => {
                        const pt = getPrizeTable(rec.gameType);
                        const linePrize = pt.lookupPrize(line.hitCount || 0, !!line.bonusHit);
                        return linePrize > 0 ? (
                          <span className="hmd-history__line-prize">{fmtMoney(linePrize)}</span>
                        ) : null;
                      })()}
                    </div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   PRIZES TAB — Prize structure reference + breakdown
   ═══════════════════════════════════════════════════════════════════════ */
function PrizesTab({ stats }) {
  return (
    <div className="hmd-prizes">
      {/* Actual prize breakdown from tracked data */}
      {Object.keys(stats.prizeBreakdown).length > 0 && (
        <div className="hmd-prizes__earned">
          <h3 className="hmd-prizes__section-title">Your Prize Breakdown</h3>
          <div className="hmd-prizes__earned-grid">
            {Object.entries(stats.prizeBreakdown)
              .sort(([, a], [, b]) => b.total - a.total)
              .map(([tier, data]) => (
                <div key={tier} className="hmd-prizes__earned-card">
                  <div className="hmd-prizes__earned-tier">{tier} Match{tier.includes('+') ? '' : 'es'}</div>
                  <div className="hmd-prizes__earned-count">{data.count}x</div>
                  <div className="hmd-prizes__earned-total">{fmtMoneyFull(data.total)}</div>
                </div>
              ))}
          </div>
          <div className="hmd-prizes__earned-total-row">
            <span>Total Won:</span>
            <strong style={{ color: '#10b981', fontSize: '1.3rem' }}>{fmtMoneyFull(stats.totalAmountWon)}</strong>
          </div>
        </div>
      )}

      {/* Prize structure reference */}
      <h3 className="hmd-prizes__section-title" style={{ marginTop: 24 }}>Prize Structure Reference</h3>
      <div className="hmd-prizes__tables">
        {Object.entries(PRIZE_TABLES).map(([key, table]) => (
          <div key={key} className="hmd-prizes__table-card">
            <h4 className="hmd-prizes__table-title">{table.label}</h4>
            <div className="hmd-prizes__table-cost">Ticket: ${table.cost}</div>
            <table className="hmd-prizes__ref-table">
              <thead>
                <tr><th>Match</th><th>Prize</th></tr>
              </thead>
              <tbody>
                {table.prizes.map((p, i) => (
                  <tr key={i}>
                    <td>{p.label}</td>
                    <td style={{ fontWeight: 600, color: p.value >= 1000 ? '#10b981' : '#d1d5db' }}>{p.prize}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
