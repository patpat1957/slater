import React, { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import { useMonetization } from './MonetizationContext';
import { SponsoredWidget } from './AdBanner';
import ApiKeyPanel from './ApiKeyPanel';
import OptimizerPanel from './OptimizerPanel';

const API = '';
const FREE_STATES = ['CA', 'NY', 'TX', 'FL', 'PA'];

/* ─── prediction engine (pure JS, runs in browser) ─── */
/* NOTE: Simple pattern predictions removed — use Optimizer tab instead */
function runPredictionEngine(draws, gameType) {
  if (!draws || draws.length < 5) return null;

  // Identify game type — pick-3 style (0-9 digits, 3 positions) vs pick-4 vs big-ball
  const pick3Games = new Set(['pick3', 'cash3', 'daily3']);
  const pick4Games = new Set(['pick4', 'daily4']);
  const isPick3   = pick3Games.has(gameType);
  const isPick4   = pick4Games.has(gameType);
  const isPickN   = isPick3 || isPick4;
  const isBigBall = !isPickN; // powerball / mega / lotto / fantasy5 / cash5 / pick5 / lotto647 etc.

  // Check if this game has a separate bonus ball (Powerball, Mega Ball, Mega)
  const bonusCfg = GAME_CONFIGS[gameType]?.bonus;
  const hasBonus = !!bonusCfg && isBigBall;

  /* ── 1. flatten numbers ── */
  const allNums = draws.flatMap(d => d.numbers || []);
  const maxNum  = isBigBall ? Math.max(...allNums) : 9;

  /* ── 1b. bonus ball frequency analysis ── */
  let bonusFreq = {}, bonusHot = [], bonusCold = [], lastBonus = null;
  if (hasBonus) {
    const bonusMax = bonusCfg.max;
    for (let i = 1; i <= bonusMax; i++) bonusFreq[i] = 0;
    draws.forEach(d => { if (d.bonus != null) bonusFreq[d.bonus] = (bonusFreq[d.bonus] || 0) + 1; });
    const bonusSorted = Object.entries(bonusFreq).sort((a, b) => b[1] - a[1]);
    bonusHot  = bonusSorted.slice(0, 3).map(([n]) => +n);
    bonusCold = bonusSorted.filter(([,c]) => c > 0).slice(-3).map(([n]) => +n);
    lastBonus = draws[0]?.bonus ?? null;
  }

  /* ── 2. frequency map ── */
  const freq = {};
  for (let i = 0; i <= maxNum; i++) freq[i] = 0;
  allNums.forEach(n => { if (freq[n] !== undefined) freq[n]++; });

  const sorted    = Object.entries(freq).sort((a, b) => b[1] - a[1]);
  const hotNums   = sorted.slice(0, 6).map(([n]) => +n);
  const coldNums  = sorted.slice(-6).map(([n]) => +n);

  /* ── 3. position analysis (Pick 3 / Pick 4) ── */
  const posFreq = [];
  if (isPickN) {
    const posLen = isPick3 ? 3 : 4;
    for (let p = 0; p < posLen; p++) {
      const pf = {};
      for (let d = 0; d <= 9; d++) pf[d] = 0;
      draws.forEach(dr => { if (dr.numbers[p] !== undefined) pf[dr.numbers[p]]++; });
      posFreq.push(pf);
    }
  }

  /* ── 4. overdue digits per position ── */
  const posOverdue = posFreq.map(pf => {
    const skips = {};
    for (let d = 0; d <= 9; d++) {
      const idx = draws.findIndex(dr => dr.numbers.includes(d));
      skips[d] = idx === -1 ? 999 : idx;
    }
    return Object.entries(skips).sort((a, b) => b[1] - a[1]).map(([d]) => +d);
  });

  /* ── 5. sum stats ── */
  const sums    = draws.map(d => (d.numbers || []).reduce((a, b) => a + b, 0));
  const avgSum  = sums.reduce((a, b) => a + b, 0) / sums.length;
  const lastSum = sums[0];

  const sumFreq = {};
  sums.forEach(s => { sumFreq[s] = (sumFreq[s] || 0) + 1; });
  const topSums = Object.entries(sumFreq).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([s]) => +s);

  /* ── 6. mirror (Pick 3 / Pick 4) ── */
  const lastDraw = draws[0].numbers || [];
  const mirror   = lastDraw.map(d => (d + 5) % 10);
  const rundown1 = lastDraw.map(d => (d + 1) % 10);
  const rundown2 = lastDraw.map(d => (d + 2) % 10);
  const rundown3 = lastDraw.map(d => (d + 3) % 10);

  /* ── 7. pairs ── */
  const pairFreq = {};
  draws.forEach(dr => {
    const nums = dr.numbers || [];
    for (let a = 0; a < nums.length; a++)
      for (let b = a + 1; b < nums.length; b++) {
        const key = `${Math.min(nums[a], nums[b])}-${Math.max(nums[a], nums[b])}`;
        pairFreq[key] = (pairFreq[key] || 0) + 1;
      }
  });
  const topPairs = Object.entries(pairFreq).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([p, c]) => ({ pair: p, count: c }));

  /* ── 8. even/odd balance ── */
  const lastEvens = lastDraw.filter(n => n % 2 === 0).length;
  const lastOdds  = lastDraw.length - lastEvens;

  /* ── 9. generate predictions ── */
  let predictions = [];

  if (isPick3) {
    // A: Mirror
    predictions.push({ label: 'Mirror (+5)', nums: mirror, method: 'Mirror of last draw', confidence: 'High', sum: mirror.reduce((a,b)=>a+b,0) });
    // B: Rundown +1
    predictions.push({ label: 'Rundown +1', nums: rundown1, method: 'Last draw +1 each digit', confidence: 'High', sum: rundown1.reduce((a,b)=>a+b,0) });
    // C: Position overdue
    if (posOverdue.length === 3) {
      const due = [posOverdue[0][0], posOverdue[1][0], posOverdue[2][0]];
      predictions.push({ label: 'Position Due', nums: due, method: 'Most overdue digit per position', confidence: 'Medium', sum: due.reduce((a,b)=>a+b,0) });
    }
    // D: Rundown +3
    predictions.push({ label: 'Rundown +3', nums: rundown3, method: 'Last draw +3 each digit', confidence: 'Medium', sum: rundown3.reduce((a,b)=>a+b,0) });
    // E: Hot combo
    const hotCombo = [hotNums[0] % 10, hotNums[1] % 10, hotNums[2] % 10];
    predictions.push({ label: 'Hot Combo', nums: hotCombo, method: 'Top 3 hottest digits', confidence: 'Low', sum: hotCombo.reduce((a,b)=>a+b,0) });
  } else if (isPick4) {
    predictions.push({ label: 'Mirror (+5)', nums: mirror, method: 'Mirror of last draw', confidence: 'High', sum: mirror.reduce((a,b)=>a+b,0) });
    predictions.push({ label: 'Rundown +1', nums: rundown1, method: 'Last draw +1 each digit', confidence: 'High', sum: rundown1.reduce((a,b)=>a+b,0) });
    if (posOverdue.length === 4) {
      const due = [posOverdue[0][0], posOverdue[1][0], posOverdue[2][0], posOverdue[3][0]];
      predictions.push({ label: 'Position Due', nums: due, method: 'Most overdue digit per position', confidence: 'Medium', sum: due.reduce((a,b)=>a+b,0) });
    }
    predictions.push({ label: 'Rundown +2', nums: rundown2, method: 'Last draw +2 each digit', confidence: 'Medium', sum: rundown2.reduce((a,b)=>a+b,0) });
    const hotCombo4 = [hotNums[0]%10, hotNums[1]%10, hotNums[2]%10, hotNums[3]%10];
    predictions.push({ label: 'Hot Combo', nums: hotCombo4, method: 'Top 4 hottest digits', confidence: 'Low', sum: hotCombo4.reduce((a,b)=>a+b,0) });
  } else {
    // Big ball games — use frequency-based picks
    const ballCount = lastDraw.length;

    // Helper: pick a bonus ball for each prediction line
    const pickBonus = (method) => {
      if (!hasBonus) return undefined;
      if (method === 'hot')    return bonusHot[0] || 1;
      if (method === 'cold')   return bonusCold[0] || 1;
      if (method === 'due')    return bonusCold.length > 0 ? bonusCold[bonusCold.length - 1] : 1;
      if (method === 'mix')    return bonusHot.length > 1 ? bonusHot[1] : bonusHot[0] || 1;
      // balanced: pick from middle of frequency range
      const mid = Object.entries(bonusFreq).sort((a,b) => b[1]-a[1]);
      return mid.length > 2 ? +mid[Math.floor(mid.length/3)][0] : bonusHot[0] || 1;
    };

    // A: Top hot
    predictions.push({ label: 'Hot Picks', nums: hotNums.slice(0, ballCount).sort((a,b)=>a-b), bonus: pickBonus('hot'), method: 'Most frequent numbers historically', confidence: 'High' });
    // B: Mix hot + cold
    const mix = [...hotNums.slice(0, Math.ceil(ballCount * 0.6)), ...coldNums.slice(0, Math.floor(ballCount * 0.4))].slice(0, ballCount).sort((a,b)=>a-b);
    predictions.push({ label: 'Hot + Cold Mix', nums: mix, bonus: pickBonus('mix'), method: `${Math.ceil(ballCount * 0.6)} hot + ${Math.floor(ballCount * 0.4)} cold`, confidence: 'Medium' });
    // C: Balanced even/odd
    const evens = Object.keys(freq).filter(n => +n % 2 === 0).sort((a, b) => freq[b] - freq[a]).map(Number);
    const odds  = Object.keys(freq).filter(n => +n % 2 !== 0).sort((a, b) => freq[b] - freq[a]).map(Number);
    const half  = Math.floor(ballCount / 2);
    const balanced = [...evens.slice(0, half), ...odds.slice(0, ballCount - half)].sort((a,b)=>a-b);
    predictions.push({ label: 'Balanced E/O', nums: balanced, bonus: pickBonus('balanced'), method: 'Equal even/odd split from hot numbers', confidence: 'Medium' });
    // D: Pairs-based
    const pairNums = [...new Set(topPairs.flatMap(p => p.pair.split('-').map(Number)))].slice(0, ballCount).sort((a,b)=>a-b);
    if (pairNums.length === ballCount)
      predictions.push({ label: 'Top Pairs', nums: pairNums, bonus: pickBonus('mix'), method: 'Numbers from most common pairs', confidence: 'Low' });
    // E: Due numbers (least frequent)
    const due = sorted.slice(-ballCount).map(([n]) => +n).sort((a,b)=>a-b);
    predictions.push({ label: 'Due Numbers', nums: due, bonus: pickBonus('due'), method: 'Least-frequent (overdue) numbers', confidence: 'Low' });
  }

  return {
    predictions,
    hotNums,
    coldNums,
    topPairs,
    sums: sums.slice(0, 10),
    avgSum: +avgSum.toFixed(1),
    lastSum,
    topSums,
    posFreq,
    posOverdue,
    lastDraw,
    mirror,
    rundown1,
    totalDraws: draws.length,
    lastEvens,
    lastOdds,
    drawLength: lastDraw.length,
    hasBonus,
    bonusCfg,
    bonusHot,
    bonusCold,
    bonusFreq,
    lastBonus,
  };
}

/* ─── confidence badge ─── */
function ConfBadge({ level }) {
  const map = { High: '#10b981', Medium: '#f59e0b', Low: '#7c3aed' };
  return (
    <span style={{
      background: map[level] + '22',
      border: `1px solid ${map[level]}55`,
      color: map[level],
      borderRadius: 20, padding: '2px 10px',
      fontSize: 11, fontWeight: 700, letterSpacing: 0.4,
    }}>{level}</span>
  );
}

/* ─── single prediction card ─── */
function PredCard({ pred, rank, gameType }) {
  const isPickN = gameType === 'pick3' || gameType === 'pick4';
  const colors  = ['#f59e0b', '#a78bfa', '#34d399', '#60a5fa', '#f87171'];
  const color   = colors[rank] || '#a78bfa';
  const bonusCfg = GAME_CONFIGS[gameType]?.bonus;

  return (
    <motion.div
      className="pred-card"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: rank * 0.07 }}
      style={{ '--pred-color': color }}
    >
      <div className="pred-card__rank" style={{ background: color + '22', color }}>
        {rank === 0 ? '⭐' : `#${rank + 1}`}
      </div>
      <div className="pred-card__body">
        <div className="pred-card__label">{pred.label}</div>
        <div className="pred-card__nums">
          {pred.nums.map((n, i) => (
            <span key={i} className="pred-ball" style={{ background: color + '22', border: `2px solid ${color}66`, color }}>
              {isPickN ? n : String(n).padStart(2, '0')}
            </span>
          ))}
          {/* Bonus ball (Powerball / Mega Ball / Mega) — rendered with distinct color */}
          {pred.bonus != null && bonusCfg && (
            <span className="pred-ball pred-ball--bonus" style={{
              background: bonusCfg.color + '22',
              border: `2px solid ${bonusCfg.color}`,
              color: bonusCfg.color,
              fontWeight: 800,
              marginLeft: 4,
            }}
            title={bonusCfg.name}
            >
              {String(pred.bonus).padStart(2, '0')}
            </span>
          )}
          {isPickN && pred.sum !== undefined && (
            <span className="pred-sum">Σ {pred.sum}</span>
          )}
        </div>
        {/* Bonus ball label */}
        {pred.bonus != null && bonusCfg && (
          <div style={{ fontSize: 10, color: bonusCfg.color, fontWeight: 700, marginTop: 2, letterSpacing: 0.3 }}>
            {bonusCfg.name}: {String(pred.bonus).padStart(2, '0')}
          </div>
        )}
        <div className="pred-card__method">{pred.method}</div>
      </div>
      <ConfBadge level={pred.confidence} />
    </motion.div>
  );
}

/* ─── digit frequency bar ─── */
function FreqBar({ digit, count, max, hot }) {
  const pct = max > 0 ? (count / max) * 100 : 0;
  const color = hot ? '#f59e0b' : '#7c3aed';
  return (
    <div className="freq-row">
      <span className="freq-label">{digit}</span>
      <div className="freq-track">
        <motion.div
          className="freq-fill"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, delay: digit * 0.04 }}
          style={{ background: color }}
        />
      </div>
      <span className="freq-count">{count}</span>
      {hot && <span className="freq-hot">🔥</span>}
    </div>
  );
}

/* ─── GAME TYPE CONFIG ─── */
const GAME_CONFIGS = {
  pick3:     { label: 'Pick 3',            icon: '3️⃣',  digits: 3,  type: 'pick3',    playTypes: ['Straight', 'Box', 'Straight/Box', 'Combo'] },
  pick4:     { label: 'Pick 4',            icon: '4️⃣',  digits: 4,  type: 'pick4',    playTypes: ['Straight', 'Box', 'Straight/Box', 'Combo'] },
  fantasy5:  { label: 'Fantasy 5',         icon: '5️⃣',  digits: 5,  type: 'big',      playTypes: ['Straight'] },
  lotto647:  { label: 'Lotto 6/47',        icon: '🎯',  digits: 6,  type: 'big',      playTypes: ['Straight'] },
  powerball: { label: 'Powerball',         icon: '🔴',  digits: 5,  type: 'big',      playTypes: ['Straight'], bonus: { name: 'Powerball', max: 26, color: '#ef4444' } },
  megamil:   { label: 'Mega Millions',     icon: '🟡',  digits: 5,  type: 'big',      playTypes: ['Straight'], bonus: { name: 'Mega Ball', max: 25, color: '#f59e0b' } },
  daily4:    { label: 'Daily 4',           icon: '4️⃣',  digits: 4,  type: 'pick4',    playTypes: ['Straight', 'Box', 'Combo'] },
  cash3:     { label: 'Cash 3',            icon: '💰',  digits: 3,  type: 'pick3',    playTypes: ['Straight', 'Box'] },
  pick5:     { label: 'Pick 5',            icon: '5️⃣',  digits: 5,  type: 'big',      playTypes: ['Straight'] },
  lotto:     { label: 'Lotto',             icon: '🎯',  digits: 6,  type: 'big',      playTypes: ['Straight'] },
  cash5:     { label: 'Cash 5',            icon: '5️⃣',  digits: 5,  type: 'big',      playTypes: ['Straight'] },
  superlotto:{ label: 'SuperLotto Plus',   icon: '⭐',  digits: 5,  type: 'big',      playTypes: ['Straight'], bonus: { name: 'Mega', max: 27, color: '#f59e0b' } },
};

// ─── STATE → LOTTERY ID MAP ──────────────────────────────────────────────────
// Keys: `${STATE}_${GAME}` or `${STATE}_${GAME}_midday` / `${STATE}_${GAME}_evening`
// Values: backend lottery ID string (matches lottery_config.py)
// For states that use the same ID for both draw times, one key covers all.
// Priority: midday/evening key > generic key.
const STATE_LOTTERY_IDS = {
  // ── Powerball / Mega Millions (multistate) ──
  '*_powerball':        'powerball',
  '*_megamil':          'mega_millions',

  // ── ARIZONA ──
  AZ_pick3:             'az_pick3',
  AZ_fantasy5:          'az_fantasy5',

  // ── ARKANSAS ──
  AR_pick3:             'ar_cash3',
  AR_pick3_midday:      'ar_cash3_midday',
  AR_pick3_evening:     'ar_cash3',

  // ── CALIFORNIA ──
  CA_pick3:             'ca_daily3',
  CA_pick3_midday:      'ca_midday3',
  CA_pick3_evening:     'ca_daily3',
  CA_daily4:            'ca_daily4',
  CA_fantasy5:          'ca_fantasy5',
  CA_lotto:             'ca_superlotto_plus',
  CA_superlotto:        'ca_superlotto_plus',

  // ── COLORADO ──
  CO_pick3:             'co_pick3',
  CO_cash5:             'co_cash5',
  CO_lotto:             'co_lotto',

  // ── CONNECTICUT ──
  CT_pick3:             'ct_play3',
  CT_pick3_midday:      'ct_play3',
  CT_pick3_evening:     'ct_play3',
  CT_pick4:             'ct_play4',
  CT_cash5:             'ct_cash5',
  CT_lotto:             'ct_lotto',

  // ── DC ──
  DC_pick4:             'dc_lottery',

  // ── DELAWARE ──
  DE_pick3:             'de_play3_night',
  DE_pick3_midday:      'de_play3_day',
  DE_pick3_evening:     'de_play3_night',
  DE_pick4:             'de_play4_night',
  DE_pick4_midday:      'de_play4_day',
  DE_pick4_evening:     'de_play4_night',
  DE_pick5:             'de_play5_night',
  DE_pick5_midday:      'de_play5_day',
  DE_pick5_evening:     'de_play5_night',

  // ── FLORIDA ──
  FL_pick3:             'fl_pick3',
  FL_pick3_midday:      'fl_pick3_midday',
  FL_pick3_evening:     'fl_pick3',
  FL_pick4:             'fl_pick4',
  FL_pick4_midday:      'fl_pick4_midday',
  FL_pick4_evening:     'fl_pick4',
  FL_pick5:             'fl_pick5',
  FL_pick5_midday:      'fl_pick5_midday',
  FL_pick5_evening:     'fl_pick5',
  FL_fantasy5:          'fl_fantasy5',
  FL_lotto:             'fl_lotto',

  // ── GEORGIA ──
  GA_cash3:             'ga_cash3',
  GA_cash3_midday:      'ga_cash3_midday',
  GA_cash3_evening:     'ga_cash3',
  GA_pick3:             'ga_cash3',
  GA_pick3_midday:      'ga_cash3_midday',
  GA_pick3_evening:     'ga_cash3',
  GA_pick4:             'ga_cash4',
  GA_pick4_midday:      'ga_cash4_midday',
  GA_pick4_evening:     'ga_cash4',
  GA_fantasy5:          'ga_fantasy5',

  // ── IDAHO ──
  ID_pick3:             'id_pick3_night',
  ID_pick3_midday:      'id_pick3_day',
  ID_pick3_evening:     'id_pick3_night',
  ID_pick4:             'id_pick4_night',
  ID_pick4_midday:      'id_pick4_day',
  ID_pick4_evening:     'id_pick4_night',

  // ── ILLINOIS ──
  IL_pick3:             'il_pick3_evening',
  IL_pick3_midday:      'il_pick3_midday',
  IL_pick3_evening:     'il_pick3_evening',
  IL_pick4:             'il_pick4_evening',
  IL_pick4_midday:      'il_pick4_midday',
  IL_pick4_evening:     'il_pick4_evening',
  IL_lotto647:          'il_lotto',
  IL_lotto:             'il_lotto',

  // ── INDIANA ──
  IN_pick3:             'in_daily3',
  IN_pick3_midday:      'in_daily3_midday',
  IN_pick3_evening:     'in_daily3',
  IN_daily4:            'in_daily4',
  IN_pick4:             'in_daily4',
  IN_cash5:             'in_cash5',
  IN_lotto:             'in_hoosier_lotto',

  // ── IOWA ──
  IA_pick3:             'ia_pick3_evening',
  IA_pick3_midday:      'ia_pick3_midday',
  IA_pick3_evening:     'ia_pick3_evening',
  IA_pick4:             'ia_pick4_evening',
  IA_pick4_midday:      'ia_pick4_midday',
  IA_pick4_evening:     'ia_pick4_evening',

  // ── KANSAS ──
  KS_pick3:             'ks_pick3_evening',
  KS_pick3_midday:      'ks_pick3_midday',
  KS_pick3_evening:     'ks_pick3_evening',

  // ── KENTUCKY ──
  KY_pick3:             'ky_pick3_evening',
  KY_pick3_midday:      'ky_pick3_midday',
  KY_pick3_evening:     'ky_pick3_evening',
  KY_pick4:             'ky_pick4_evening',
  KY_pick4_midday:      'ky_pick4_midday',
  KY_pick4_evening:     'ky_pick4_evening',

  // ── LOUISIANA ──
  LA_pick3:             'la_pick3',
  LA_pick4:             'la_pick4',
  LA_pick5:             'la_pick5',
  LA_lotto:             'la_lotto',
  LA_cash5:             'la_easy5',

  // ── MAINE ──
  ME_pick3:             'me_pick3',
  ME_pick4:             'me_pick4',

  // ── MARYLAND ──
  MD_pick3:             'md_pick3',
  MD_pick3_midday:      'md_pick3_midday',
  MD_pick3_evening:     'md_pick3',
  MD_pick4:             'md_pick4',
  MD_pick4_midday:      'md_pick4_midday',
  MD_pick4_evening:     'md_pick4',
  MD_pick5:             'md_pick5',
  MD_pick5_midday:      'md_pick5_midday',
  MD_pick5_evening:     'md_pick5',

  // ── MASSACHUSETTS ──
  MA_pick3:             'ma_numbers',
  MA_pick3_midday:      'ma_numbers_midday',
  MA_pick3_evening:     'ma_numbers',
  MA_cash5:             'ma_masscash',
  MA_lotto:             'ma_megabucks_doubler',

  // ── MICHIGAN ──
  MI_pick3:             'mi_daily3',
  MI_pick3_midday:      'mi_daily3_midday',
  MI_pick3_evening:     'mi_daily3',
  MI_pick4:             'mi_daily4',
  MI_daily4:            'mi_daily4',
  MI_pick4_midday:      'mi_daily4_midday',
  MI_pick4_evening:     'mi_daily4',
  MI_fantasy5:          'mi_fantasy5',
  MI_lotto647:          'mi_lotto47',

  // ── MINNESOTA ──
  MN_pick3:             'mn_pick3',
  MN_cash5:             'mn_northstar_cash',
  MN_lotto:             'mn_gopher5',

  // ── MISSISSIPPI ──
  MS_pick3:             'ms_cash3',
  MS_pick3_midday:      'ms_cash3_midday',
  MS_pick3_evening:     'ms_cash3',
  MS_pick4:             'ms_cash4',
  MS_pick4_midday:      'ms_cash4_midday',
  MS_pick4_evening:     'ms_cash4',

  // ── MISSOURI ──
  MO_pick3:             'mo_pick3',
  MO_pick4:             'mo_pick4',

  // ── MONTANA ──
  MT_lotto:             'mt_montana_cash',

  // ── NEBRASKA ──
  NE_pick3:             'ne_pick3',
  NE_pick5:             'ne_pick5',

  // ── NEW HAMPSHIRE ──
  NH_pick3:             'nh_pick3',
  NH_pick4:             'nh_pick4',
  NH_cash5:             'nh_gimme5',

  // ── NEW JERSEY ──
  NJ_pick3:             'nj_pick3',
  NJ_pick3_midday:      'nj_pick3',  // NJ pick3 midday — same source as evening (no separate midday URL)
  NJ_pick3_evening:     'nj_pick3',
  NJ_pick4:             'nj_pick4',
  NJ_pick4_midday:      'nj_pick4',  // NJ pick4 midday — same source
  NJ_pick4_evening:     'nj_pick4',
  NJ_lotto647:          'nj_pick6',
  NJ_cash5:             'nj_jersey_cash5',

  // ── NEW MEXICO ──
  NM_pick3:             'nm_pick3',
  NM_cash5:             'nm_roadrunner_cash',

  // ── NEW YORK ──
  NY_pick3:             'ny_numbers',
  NY_pick4:             'ny_win4',
  NY_lotto647:          'ny_lotto',
  NY_fantasy5:          'ny_take5',
  NY_cash5:             'ny_take5',

  // ── NORTH CAROLINA ──
  NC_pick3:             'nc_pick3',
  NC_pick3_midday:      'nc_pick3_midday',
  NC_pick3_evening:     'nc_pick3',
  NC_pick4:             'nc_pick4',
  NC_pick4_midday:      'nc_pick4',  // NC pick4 midday uses same ID as evening
  NC_pick4_evening:     'nc_pick4',
  NC_cash5:             'nc_cash5',

  // ── NORTH DAKOTA ──
  ND_lotto:             'nd_2by2',

  // ── OHIO ──
  OH_pick3:             'oh_pick3',
  OH_pick3_midday:      'oh_pick3_midday',
  OH_pick3_evening:     'oh_pick3',
  OH_pick4:             'oh_pick4',
  OH_pick4_midday:      'oh_pick4_midday',
  OH_pick4_evening:     'oh_pick4',
  OH_pick5:             'oh_pick5',
  OH_lotto647:          'oh_classic_lotto',
  OH_cash5:             'oh_rolling_cash5',

  // ── OKLAHOMA ──
  OK_pick3:             'ok_pick3',
  OK_cash5:             'ok_cash5',

  // ── OREGON ──
  OR_pick4:             'or_pick4',
  OR_lotto:             'or_megabucks',

  // ── PENNSYLVANIA ──
  PA_pick3:             'pa_pick3',
  PA_pick3_midday:      'pa_pick3_day',
  PA_pick3_evening:     'pa_pick3_evening',
  PA_pick4:             'pa_pick4',
  PA_pick4_midday:      'pa_pick4_day',
  PA_pick4_evening:     'pa_pick4_evening',
  PA_pick5:             'pa_pick5',
  PA_cash5:             'pa_cash5',
  PA_lotto647:          'pa_match6',

  // ── RHODE ISLAND ──
  RI_pick3:             'ri_numbers',
  RI_lotto:             'ri_wild_money',

  // ── SOUTH CAROLINA ──
  SC_pick3:             'sc_pick3',
  SC_pick4:             'sc_pick4',
  SC_cash5:             'sc_palmetto_cash5',

  // ── SOUTH DAKOTA ──
  SD_pick3:             'sd_pick3',
  SD_lotto:             'sd_dakota_cash',

  // ── TENNESSEE ──
  TN_pick3:             'tn_cash3_evening',   // TN Pick 3 evening = Cash 3 Evening
  TN_pick3_midday:      'tn_cash3_midday',    // TN Pick 3 midday  = Cash 3 Midday
  TN_pick3_evening:     'tn_cash3_evening',
  TN_cash3:             'tn_cash3_evening',
  TN_cash3_midday:      'tn_cash3_midday',
  TN_cash3_evening:     'tn_cash3_evening',
  TN_pick4:             'tn_pick4',
  TN_cash5:             'tn_tennessee_cash',

  // ── TEXAS ──
  TX_pick3:             'tx_pick3',
  TX_daily4:            'tx_daily4',
  TX_pick4:             'tx_daily4',
  TX_cash5:             'tx_cash5',
  TX_lotto647:          'tx_lotto_texas',
  TX_lotto:             'tx_lotto_texas',

  // ── VERMONT ──
  VT_pick3:             'vt_pick3',
  VT_pick4:             'vt_pick4',

  // ── VIRGINIA ──
  VA_pick3:             'va_pick3',
  VA_pick3_midday:      'va_pick3_day',
  VA_pick3_evening:     'va_pick3',
  VA_pick4:             'va_pick4',
  VA_pick4_midday:      'va_pick4_day',
  VA_pick4_evening:     'va_pick4',
  VA_cash5:             'va_cash5',

  // ── WASHINGTON ──
  WA_pick3:             'wa_daily_game',
  WA_lotto:             'wa_lotto',
  WA_cash5:             'wa_hit5',

  // ── WEST VIRGINIA ──
  WV_pick3:             'wv_daily3',
  WV_pick4:             'wv_daily4',

  // ── WISCONSIN ──
  WI_pick3:             'wi_pick3',
  WI_pick4:             'wi_pick4',
  WI_cash5:             'wi_supercash',

  // ── WYOMING ──
  WY_lotto:             'wy_cowboy_draw',
};

/**
 * Resolve the backend lottery ID for a given state + game + drawTime.
 * Lookup order: `${STATE}_${game}_${drawTime}` → `${STATE}_${game}` → `*_${game}`
 * 'All' draw-time → falls back to generic (evening) key.
 * Returns null if no mapping found.
 */
function getLotteryId(state, game, drawTime) {
  const raw = (drawTime || '').toLowerCase();
  // 'all' → use generic/evening key (returns all draws from the main scrape)
  const dt = raw === 'midday' ? 'midday' : raw === 'evening' ? 'evening' : null;
  if (dt) {
    const specific = STATE_LOTTERY_IDS[`${state}_${game}_${dt}`];
    if (specific) return specific;
  }
  return STATE_LOTTERY_IDS[`${state}_${game}`]
      || STATE_LOTTERY_IDS[`*_${game}`]
      || null;
}

/* ─── STATE / GAME MAP ─── */
const STATE_GAMES = {
  CA: ['pick3', 'daily4', 'fantasy5', 'superlotto', 'powerball', 'megamil'],
  NY: ['pick3', 'pick4', 'lotto647', 'cash5', 'powerball', 'megamil'],
  TX: ['pick3', 'daily4', 'cash5', 'lotto647', 'powerball', 'megamil'],
  FL: ['pick3', 'pick4', 'fantasy5', 'powerball', 'megamil'],
  PA: ['pick3', 'pick4', 'cash5', 'lotto647', 'powerball', 'megamil'],
  OH: ['pick3', 'pick4', 'cash5', 'lotto647', 'powerball', 'megamil'],
  GA: ['pick3', 'pick4', 'fantasy5', 'powerball', 'megamil'],
  IL: ['pick3', 'pick4', 'lotto647', 'powerball', 'megamil'],
  NJ: ['pick3', 'pick4', 'cash5', 'lotto647', 'powerball', 'megamil'],
  NC: ['pick3', 'pick4', 'cash5', 'powerball', 'megamil'],
  MI: ['pick3', 'pick4', 'fantasy5', 'lotto647', 'powerball', 'megamil'],
  VA: ['pick3', 'pick4', 'cash5', 'powerball', 'megamil'],
  WA: ['pick3', 'cash5', 'powerball', 'megamil'],
  AZ: ['pick3', 'fantasy5', 'powerball', 'megamil'],
  MA: ['pick3', 'cash5', 'powerball', 'megamil'],
  TN: ['pick3', 'pick4', 'cash5', 'powerball', 'megamil'],
  MO: ['pick3', 'pick4', 'powerball', 'megamil'],
  MD: ['pick3', 'pick4', 'powerball', 'megamil'],
  WI: ['pick3', 'pick4', 'cash5', 'powerball', 'megamil'],
  MN: ['pick3', 'cash5', 'powerball', 'megamil'],
  SC: ['pick3', 'pick4', 'cash5', 'powerball', 'megamil'],
  KY: ['pick3', 'pick4', 'powerball', 'megamil'],
  CT: ['pick3', 'pick4', 'cash5', 'powerball', 'megamil'],
  OR: ['pick4', 'powerball', 'megamil'],
  IA: ['pick3', 'pick4', 'powerball', 'megamil'],
  KS: ['pick3', 'powerball', 'megamil'],
  AR: ['pick3', 'powerball', 'megamil'],
  OK: ['pick3', 'cash5', 'powerball', 'megamil'],
  NM: ['pick3', 'cash5', 'powerball', 'megamil'],
  IN: ['pick3', 'daily4', 'cash5', 'powerball', 'megamil'],
  LA: ['pick3', 'pick4', 'cash5', 'powerball', 'megamil'],
  CO: ['pick3', 'cash5', 'powerball', 'megamil'],
  DE: ['pick3', 'pick4', 'powerball', 'megamil'],
  DC: ['pick4', 'powerball', 'megamil'],
  NH: ['pick3', 'pick4', 'cash5', 'powerball', 'megamil'],
  ME: ['pick3', 'pick4', 'powerball', 'megamil'],
  VT: ['pick3', 'pick4', 'powerball', 'megamil'],
  RI: ['pick3', 'powerball', 'megamil'],
  ID: ['pick3', 'pick4', 'powerball', 'megamil'],
  MT: ['powerball', 'megamil'],
  NE: ['pick3', 'powerball', 'megamil'],
  WV: ['pick3', 'pick4', 'powerball', 'megamil'],
  MS: ['pick3', 'pick4', 'powerball', 'megamil'],
  SD: ['pick3', 'powerball', 'megamil'],
  ND: ['powerball', 'megamil'],
  WY: ['powerball', 'megamil'],
};

const ALL_STATES = Object.keys(STATE_GAMES).sort();

/* ── draw session time options ── */
const DRAW_TIMES = ['Evening', 'Midday', 'All'];

/* ─── no sample/random data — real draws only ─── */

/* ═══════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════ */
/* ── Locked feature overlay ── */
function LockedOverlay({ reason, onUpgrade }) {
  return (
    <div className="locked-overlay">
      <div className="locked-overlay__inner">
        <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
        <div className="locked-title">Pro Feature</div>
        <div className="locked-reason">{reason}</div>
        <button className="locked-btn" onClick={onUpgrade}>⚡ Upgrade to Pro</button>
      </div>
    </div>
  );
}

export default function UniversalPredictor() {
  const { plan, planConfig, canUse, canPredict, consumePrediction, trackApiCall, requirePlan, setShowPricing, setShowUpgrade, setUpgradeReason } = useMonetization();
  const [selectedState, setSelectedState] = useState('CA');
  const [selectedGame,  setSelectedGame]  = useState('pick3');
  const [drawTime,      setDrawTime]      = useState('Evening');
  const [predDate,      setPredDate]      = useState(() => {
    const t = new Date(); t.setDate(t.getDate() + 1);
    return t.toISOString().split('T')[0];
  });
  const [draws,         setDraws]         = useState([]);
  const [analysis,      setAnalysis]      = useState(null);
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState(null);
  const [dataSource,    setDataSource]    = useState('');
  const [activeTab,     setActiveTab]     = useState('optimizer');

  const resultsRef   = useRef(null);

  const games   = STATE_GAMES[selectedState] || [];
  const gameCfg = GAME_CONFIGS[selectedGame] || GAME_CONFIGS.pick3;

  /* Plan helpers */
  const isStateLocked = (s) => plan === 'free' && !FREE_STATES.includes(s);
  const isGameLocked  = (g) => !(planConfig.limits.games || []).includes(g);

  /* When state changes, reset game if unavailable */
  useEffect(() => {
    const avail = STATE_GAMES[selectedState] || [];
    if (!avail.includes(selectedGame)) setSelectedGame(avail[0] || 'pick3');
  }, [selectedState]);

  /* Fetch draws from backend — real historical data only, no sample/random data */
  const handleAnalyze = useCallback(async () => {
    // Quota check
    if (!canPredict()) {
      setUpgradeReason(`You've used all ${planConfig.limits.predictionsPerDay} free predictions today. Upgrade for unlimited access.`);
      setShowUpgrade(true);
      return;
    }
    // Game access check
    if (isGameLocked(selectedGame)) {
      requirePlan('multiGame', 'pro', `${GAME_CONFIGS[selectedGame]?.label} predictions require a Pro plan.`);
      return;
    }
    // State access check
    if (isStateLocked(selectedState)) {
      requirePlan('states', 'pro', `${selectedState} is only available on the Pro plan. Free tier: ${FREE_STATES.join(', ')}.`);
      return;
    }
    setLoading(true);
    setError(null);
    setAnalysis(null);
    setDraws([]);

    try {
      // ── Resolve the exact backend lottery ID for this state + game + draw time ──
      const lotteryId = getLotteryId(selectedState, selectedGame, drawTime);

      if (!lotteryId) {
        setError(`No lottery data source found for ${selectedState} ${gameCfg.label}. This game may not be available in your state.`);
        setLoading(false);
        return;
      }

      // Helper: call /extract with the resolved lotteryId and normalise rows → [{date, numbers}]
      const extractDraws = async (daysBack) => {
        // Use Eastern Time date string to avoid UTC-offset off-by-one day issues
        const etDateStr = (d) => new Intl.DateTimeFormat('en-CA', {
          timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
        }).format(d); // returns YYYY-MM-DD
        const toDate   = new Date();                                     // today — include today's draw
        const fromDate = new Date(); fromDate.setDate(fromDate.getDate() - daysBack);
        const resp = await axios.post(`${API}/extract`, {
          state_code:  selectedState,
          lottery_ids: [lotteryId],
          from_date:   etDateStr(fromDate),
          to_date:     etDateStr(toDate),
        });
        // Backend returns { data: [...rows], total_records, ... }
        // Each row: Date, Lotto_Name, Ball_1, Ball_2, Ball_3, ... (no 'numbers' array)
        const respBody = resp?.data || {};
        const raw = Array.isArray(respBody)
          ? respBody
          : Array.isArray(respBody.data)
            ? respBody.data
            : Array.isArray(respBody.results)
              ? respBody.results
              : [];
        return raw.map(r => {
          const ballNums = Object.keys(r)
            .filter(k => /^Ball_\d+$/.test(k))
            .sort((a, b) => parseInt(a.split('_')[1]) - parseInt(b.split('_')[1]))
            .map(k => Number(r[k]))
            .filter(n => !isNaN(n));
          // Append bonus ball for games that store it separately
          // Powerball red ball (1-26) → r.Powerball
          // Mega Millions Mega Ball (1-25) → r.Mega_Ball
          // Detect bonus ball stored as a separate field
          const bonusVal = r.Powerball != null ? Number(r.Powerball)
                         : r.Mega_Ball  != null ? Number(r.Mega_Ball)
                         : r.Mega       != null ? Number(r.Mega)
                         : r.Bonus_Ball != null ? Number(r.Bonus_Ball)
                         : null;
          const baseNums = ballNums.length > 0
            ? ballNums
            : Array.isArray(r.numbers)
              ? r.numbers.map(Number)
              : Object.values(r).filter(v => typeof v === 'number' && !isNaN(v));
          // For games with a bonus ball config, store it separately
          const gameBonusCfg = GAME_CONFIGS[selectedGame]?.bonus;
          let mainNums, bonus;
          const expectedMainBalls = GAME_CONFIGS[selectedGame]?.digits || 5;
          if (gameBonusCfg) {
            if (bonusVal != null && !isNaN(bonusVal)) {
              // Bonus explicitly in a named field (Powerball, Mega_Ball, Mega)
              mainNums = baseNums;
              bonus = bonusVal;
            } else if (baseNums.length > expectedMainBalls) {
              // Bonus stored as last Ball_N (e.g. lotteryusa puts it in Ball_6)
              mainNums = baseNums.slice(0, expectedMainBalls);
              bonus = baseNums[expectedMainBalls];
            } else {
              mainNums = baseNums;
              bonus = null;
            }
          } else {
            mainNums = (bonusVal != null && !isNaN(bonusVal))
              ? [...baseNums, bonusVal]
              : baseNums;
            bonus = null;
          }
          return {
            date:    r.Date || r.draw_date || r.date || '',
            numbers: mainNums,
            bonus:   bonus,
          };
        }).filter(r => r.numbers.length > 0);
      };

      // Fetch historical draws.
      // Jackpot games (Powerball/Mega/SuperLotto) → 10 years for deeper analysis.
      // Pick games → 5 years (already thousands of draws).
      // Fallback to shorter range if result is suspiciously small.
      const isJackpotGame = !!GAME_CONFIGS[selectedGame]?.bonus;
      const primaryDays = isJackpotGame ? 3650 : 1825;  // 10yr or 5yr
      const fallbackDays = isJackpotGame ? 1825 : 730;  // 5yr or 2yr
      let fetchedDraws = await extractDraws(primaryDays);
      if (fetchedDraws.length < 10) {
        fetchedDraws = await extractDraws(fallbackDays);
      }

      if (fetchedDraws.length >= 10) {
        setDraws(fetchedDraws);
        setDataSource(`Live data · ${fetchedDraws.length} draws from backend`);
        consumePrediction();
        trackApiCall(1); // track this real backend fetch in monthly API usage counter
        setActiveTab('optimizer'); // always land on optimizer after loading draws
      } else {
        const found = fetchedDraws.length;
        setError(
          found > 0
            ? `Only ${found} draw${found !== 1 ? 's' : ''} found — need at least 10 for reliable analysis. Try a different date range or check that ${selectedState} ${gameCfg.label} is supported.`
            : `No draw history found for ${selectedState} ${gameCfg.label}. Make sure the backend is connected and this game is available in your state.`
        );
      }

      setLoading(false);
    } catch (e) {
      setError(`Could not load draw history: ${e?.message || 'backend unavailable'}. Please check your connection and try again.`);
      setLoading(false);
    }
  }, [selectedState, selectedGame, gameCfg, canPredict, consumePrediction, trackApiCall, planConfig, requirePlan, isStateLocked]);

  /* Run engine whenever draws update */
  useEffect(() => {
    if (draws.length > 0) {
      const result = runPredictionEngine(draws, selectedGame);
      setAnalysis(result);
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);
    }
  }, [draws, selectedGame]);

  const isPickN = ['pick3', 'cash3', 'daily3', 'pick4', 'daily4'].includes(selectedGame);

  /* ── sum buckets for chart ── */
  const sumBuckets = analysis ? (() => {
    const b = {};
    analysis.sums.forEach(s => { b[s] = (b[s] || 0) + 1; });
    return Object.entries(b).sort((a, b) => +a[0] - +b[0]);
  })() : [];

  /* ── tabs ── */
  const TABS = [
    { id: 'frequency',   label: '📊 Frequency'   },
    { id: 'stats',       label: '📈 Stats',       locked: !canUse('advancedStats') },
    { id: 'history',     label: '📋 History'      },
    { id: 'optimizer',   label: '🎰 Optimizer'   },
    { id: 'api',         label: '🔌 API',          locked: !canUse('apiAccess')     },
  ];

  return (
    <div className="predictor">
      {/* ── Header ── */}
      <div className="predictor__hero">
        <div className="predictor__hero-orb predictor__hero-orb--1" />
        <div className="predictor__hero-orb predictor__hero-orb--2" />
        <div className="predictor__hero-inner">
          <motion.div className="predictor__badge"
            initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
            🎰 &nbsp;Lottery Optimizer + Predictor
          </motion.div>
          <motion.h2 className="predictor__title"
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            Smart <span className="gradient-text">Lottery Optimizer</span>
          </motion.h2>
          <motion.p className="predictor__sub"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}>
            ML-powered number optimization across every US state lottery · Pick 3, Pick 4, Powerball, Mega Millions &amp; more
          </motion.p>
        </div>
      </div>

      {/* ── Controls ── */}
      <div className="predictor__controls">
        {/* State */}
        <div className="ctrl-group">
          <label className="ctrl-label">📍 State</label>
          <select className="ctrl-select" value={selectedState}
            onChange={e => setSelectedState(e.target.value)}>
            {ALL_STATES.map(s => (
              <option key={s} value={s}>
                {isStateLocked(s) ? '🔒 ' : ''}{s}
              </option>
            ))}
          </select>
          {isStateLocked(selectedState) && (
            <div className="ctrl-lock-msg">
              🔒 Free: {FREE_STATES.join(', ')} only
              <button className="ctrl-lock-btn" onClick={() => { setUpgradeReason('Unlock all 46 states with Pro.'); setShowUpgrade(true); }}>Unlock</button>
            </div>
          )}
        </div>

        {/* Game */}
        <div className="ctrl-group">
          <label className="ctrl-label">🎮 Game</label>
          <select className="ctrl-select" value={selectedGame}
            onChange={e => setSelectedGame(e.target.value)}>
            {games.map(g => (
              <option key={g} value={g}>{isGameLocked(g) ? '🔒 ' : ''}{GAME_CONFIGS[g]?.icon} {GAME_CONFIGS[g]?.label}</option>
            ))}
          </select>
          {isGameLocked(selectedGame) && (
            <div className="ctrl-lock-msg">
              🔒 {GAME_CONFIGS[selectedGame]?.label} requires Pro
              <button className="ctrl-lock-btn" onClick={() => { setUpgradeReason(`${GAME_CONFIGS[selectedGame]?.label} predictions require Pro.`); setShowUpgrade(true); }}>Unlock</button>
            </div>
          )}
        </div>

        {/* Draw time */}
        <div className="ctrl-group">
          <label className="ctrl-label">🕐 Draw</label>
          <select className="ctrl-select" value={drawTime}
            onChange={e => setDrawTime(e.target.value)}>
            {DRAW_TIMES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        {/* Prediction date */}
        <div className="ctrl-group">
          <label className="ctrl-label">📅 Predict For</label>
          <input
            type="date"
            className="ctrl-select"
            value={predDate}
            onChange={e => setPredDate(e.target.value)}
          />
        </div>

        {/* Analyze button */}
        <button
          className="btn-analyze"
          onClick={handleAnalyze}
          disabled={loading}
        >
          {loading
            ? <><span className="btn-spinner" /> Analyzing…</>
            : '📥 Load Draw Data'
          }
        </button>
      </div>

      {/* ── Selected summary strip ── */}
      {(selectedState && selectedGame) && (
        <div className="predictor__strip">
          <span className="strip-chip">
            <span style={{ fontSize: 18 }}>{gameCfg.icon}</span>
            {selectedState} · {gameCfg.label} · {drawTime}
          </span>
          <span className="strip-chip strip-chip--amber">
            📅 Predicting: {predDate}
          </span>
          {dataSource && (
            <span className={`strip-chip ${dataSource.startsWith('⚠️') ? 'strip-chip--warn' : 'strip-chip--green'}`}>
              {dataSource}
            </span>
          )}
        </div>
      )}

      {/* ── Loading ── */}
      <AnimatePresence>
        {loading && (
          <motion.div className="predictor__loading"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div style={{ fontSize: 52, marginBottom: 16 }}>🔮</div>
            <div className="loading-title">Analyzing draw patterns…</div>
            <div className="loading-sub">Running frequency analysis, mirror method, rundown & sum targeting</div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 20 }}>
              {[0,1,2,3,4].map(i => (
                <motion.div key={i}
                  style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--purple)' }}
                  animate={{ scale: [1, 1.5, 1], opacity: [0.4, 1, 0.4] }}
                  transition={{ duration: 1.0, repeat: Infinity, delay: i * 0.15 }}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─ Tab nav — always visible ─ */}
      <div className="pred-tabs pred-tabs--standalone">
        {TABS.map(t => (
          <button key={t.id}
            className={`pred-tab${activeTab === t.id ? ' pred-tab--active' : ''}${t.locked ? ' pred-tab--locked' : ''}`}
            onClick={() => {
              if (t.locked) {
                requirePlan('apiAccess', 'pro', `${t.label.replace(/[^\w\s]/g,'')} tab requires a Pro plan.`);
              } else {
                setActiveTab(t.id);
              }
            }}>
            {t.locked ? '🔒 ' : ''}{t.label}
          </button>
        ))}
      </div>

      {/* ── Results ── */}
      <AnimatePresence>
        {analysis && !loading && activeTab !== 'optimizer' && (
          <motion.div ref={resultsRef}
            className="predictor__results"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}>

            {/* ─ Summary stats row ─ */}
            <div className="pred-stats-row">
              {[
                { icon: '📊', label: 'Draws Analyzed', val: analysis.totalDraws },
                { icon: '🎯', label: 'Last Draw',      val: analysis.lastDraw.join(isPickN ? '-' : ' · ') },
                { icon: '📐', label: 'Avg Sum',        val: analysis.avgSum },
                { icon: '🔥', label: 'Hottest',        val: isPickN ? analysis.hotNums.slice(0,3).join(', ') : analysis.hotNums.slice(0,4).join(', ') },
                { icon: '❄️', label: 'Coldest',        val: isPickN ? analysis.coldNums.slice(-3).join(', ') : analysis.coldNums.slice(-4).join(', ') },
              ].map((s, i) => (
                <motion.div key={i} className="pred-stat-card"
                  initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.06 }}>
                  <div className="pred-stat-icon">{s.icon}</div>
                  <div className="pred-stat-val">{s.val}</div>
                  <div className="pred-stat-label">{s.label}</div>
                </motion.div>
              ))}
            </div>


            {/* ═ TAB: FREQUENCY ═ */}
            {activeTab === 'frequency' && (
              <div className="pred-section">
                <div className="pred-section__head">
                  <h3 className="pred-section__title">📊 Digit / Number Frequency</h3>
                  <p className="pred-section__sub">How often each number appeared across {analysis.totalDraws} draws</p>
                </div>

                <div className="freq-chart">
                  {isPickN ? (
                    // digits 0-9
                    (() => {
                      const allD = draws.flatMap(d => d.numbers);
                      const dFreq = {};
                      for (let i = 0; i <= 9; i++) dFreq[i] = 0;
                      allD.forEach(d => { dFreq[d] = (dFreq[d]||0)+1; });
                      const maxV = Math.max(...Object.values(dFreq));
                      return Array.from({ length: 10 }, (_, d) => (
                        <FreqBar key={d} digit={d} count={dFreq[d]} max={maxV}
                          hot={analysis.hotNums.includes(d)} />
                      ));
                    })()
                  ) : (
                    // big ball: top 20 numbers
                    (() => {
                      const allN  = draws.flatMap(d => d.numbers);
                      const nFreq = {};
                      allN.forEach(n => { nFreq[n] = (nFreq[n]||0)+1; });
                      const sorted = Object.entries(nFreq).sort((a, b) => b[1] - a[1]).slice(0, 25);
                      const maxV   = sorted[0]?.[1] || 1;
                      return sorted.map(([n, c]) => (
                        <FreqBar key={n} digit={+n} count={c} max={maxV}
                          hot={analysis.hotNums.includes(+n)} />
                      ));
                    })()
                  )}
                </div>

                {isPickN && (
                  <div style={{ marginTop: 32 }}>
                    <h4 className="pred-section__title" style={{ fontSize: 15, marginBottom: 16 }}>
                      Position Breakdown
                    </h4>
                    <div className="pos-grid">
                      {analysis.posFreq.map((pf, pi) => {
                        const maxV = Math.max(...Object.values(pf));
                        return (
                          <div key={pi} className="pos-col">
                            <div className="pos-col__title">Position {pi + 1}</div>
                            {Array.from({ length: 10 }, (_, d) => (
                              <FreqBar key={d} digit={d} count={pf[d] || 0} max={maxV}
                                hot={(pf[d] || 0) === maxV} />
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ═ TAB: STATS ═ */}
            {activeTab === 'stats' && (
              <div className="pred-section" style={{ position: 'relative' }}>
                {!canUse('advancedStats') && (
                  <LockedOverlay
                    reason="Advanced statistical analysis is available on the Pro plan."
                    onUpgrade={() => { requirePlan('advancedStats', 'pro', 'Advanced analytics require Pro.'); }}
                  />
                )}
                <div className="pred-section__head">
                  <h3 className="pred-section__title">📈 Statistical Analysis</h3>
                  <p className="pred-section__sub">Deep-dive into patterns, sums, pairs and trends</p>
                </div>

                <div className="stats-grid">
                  {/* Sum distribution */}
                  <div className="stats-card">
                    <div className="stats-card__title">Sum Distribution (last 10)</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                      {analysis.sums.map((s, i) => (
                        <span key={i} className="sum-chip"
                          style={{ opacity: 1 - i * 0.07, background: analysis.topSums.includes(s) ? 'rgba(245,158,11,0.2)' : 'rgba(124,58,237,0.12)' }}>
                          {s}
                        </span>
                      ))}
                    </div>
                    <div className="stats-label">Top sums: {analysis.topSums.slice(0,3).join(', ')}</div>
                    <div className="stats-label">Average: <strong>{analysis.avgSum}</strong></div>
                  </div>

                  {/* Hot pairs */}
                  <div className="stats-card">
                    <div className="stats-card__title">Top Pairs</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                      {analysis.topPairs.map((p, i) => (
                        <div key={i} className="pair-row">
                          <span className="pair-badge">{p.pair}</span>
                          <div className="pair-track">
                            <div className="pair-fill" style={{ width: `${(p.count / analysis.topPairs[0].count) * 100}%` }} />
                          </div>
                          <span className="pair-count">{p.count}×</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Overdue */}
                  {isPickN && (
                    <div className="stats-card">
                      <div className="stats-card__title">Overdue Digits by Position</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
                        {analysis.posOverdue.map((due, pi) => (
                          <div key={pi}>
                            <div className="stats-label" style={{ marginBottom: 6 }}>Position {pi + 1}</div>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              {due.slice(0, 5).map((d, i) => (
                                <span key={i} className="overdue-chip"
                                  style={{ opacity: 1 - i * 0.15 }}>
                                  {d}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Even / Odd */}
                  <div className="stats-card">
                    <div className="stats-card__title">Even / Odd — Last Draw</div>
                    <div style={{ display: 'flex', gap: 12, marginTop: 16, justifyContent: 'center' }}>
                      <div className="eo-box eo-box--even">
                        <div className="eo-box__num">{analysis.lastEvens}</div>
                        <div className="eo-box__label">Even</div>
                      </div>
                      <div className="eo-box eo-box--odd">
                        <div className="eo-box__num">{analysis.lastOdds}</div>
                        <div className="eo-box__label">Odd</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ═ TAB: HISTORY ═ */}
            {activeTab === 'history' && (
              <div className="pred-section">
                <div className="pred-section__head">
                  <h3 className="pred-section__title">📋 Recent Draw History</h3>
                  <p className="pred-section__sub">Last {Math.min(draws.length, 30)} draws</p>
                </div>
                <div className="history-table-wrap">
                  <table className="history-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Date</th>
                        <th>Numbers</th>
                        {isPickN && <th>Sum</th>}
                        {isPickN && <th>E/O</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {draws.slice(0, 30).map((d, i) => {
                        const s   = d.numbers.reduce((a, b) => a + b, 0);
                        const eo  = d.numbers.map(n => n % 2 === 0 ? 'E' : 'O').join('');
                        return (
                          <tr key={i} className={i === 0 ? 'history-row--latest' : ''}>
                            <td style={{ color: 'var(--text-d)', fontSize: 12 }}>{i + 1}</td>
                            <td style={{ fontFamily: 'monospace', fontSize: 13 }}>{d.date}</td>
                            <td>
                              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                {d.numbers.map((n, j) => (
                                  <span key={j} className="hist-ball"
                                    style={{ background: analysis.hotNums.slice(0,3).includes(n) ? 'rgba(245,158,11,0.25)' : 'rgba(124,58,237,0.18)' }}>
                                    {isPickN ? n : String(n).padStart(2,'0')}
                                  </span>
                                ))}
                              </div>
                            </td>
                            {isPickN && <td><span className="sum-chip">{s}</span></td>}
                            {isPickN && <td style={{ fontFamily: 'monospace', fontSize: 12, letterSpacing: 2, color: 'var(--text-m)' }}>{eo}</td>}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ═ TAB: API ═ */}
            {activeTab === 'api' && (
              <div className="pred-section">
                <ApiKeyPanel />
              </div>
            )}

          </motion.div>
        )}
      </AnimatePresence>

      {/* ═ TAB: OPTIMIZER ═  Always available — native React, no iframe */}
      {activeTab === 'optimizer' && (
        <div className="pred-section pred-section--optimizer">
          <OptimizerPanel
            draws={draws}
            gameType={selectedGame}
            drawTime={drawTime}
            state={selectedState}
            onLoadData={handleAnalyze}
            loadingData={loading}
          />
        </div>
      )}

      {/* ── Empty state — only when no analysis and not on optimizer tab ── */}
      {!analysis && !loading && activeTab !== 'optimizer' && (
        <motion.div className="predictor__empty"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}>
          <div style={{ fontSize: 72, marginBottom: 16 }}>🎰</div>
          <div className="empty-title">Select a game &amp; load draws</div>
          <div className="empty-sub">
            Choose your <strong style={{ color: 'var(--purple-l)' }}>State</strong>,
            &nbsp;<strong style={{ color: 'var(--purple-l)' }}>Game</strong> and
            &nbsp;<strong style={{ color: 'var(--purple-l)' }}>Draw session</strong>,
            then use the <strong style={{ color: 'var(--purple-l)' }}>Optimizer tab</strong>
            to load draws and run the Lotto Optimizer.
            {error && (
              <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10, color: '#f87171', fontSize: 13, textAlign: 'left', lineHeight: 1.6 }}>
                ⚠️ {error}
              </div>
            )}
          </div>
          <div className="empty-games">
            {['Pick 3','Pick 4','Powerball','Mega Millions','Fantasy 5'].map((g, i) => (
              <span key={i} className="feature-pill" style={{ cursor: 'default' }}>🎟️ {g}</span>
            ))}
          </div>
          {/* Optimizer shortcut */}
          <div style={{ marginTop: 20, display: 'flex', justifyContent: 'center' }}>
            <button
              className="opt-btn opt-btn--calibrate"
              style={{ fontSize: 14, padding: '10px 24px' }}
              onClick={() => setActiveTab('optimizer')}
            >
              🎰 Open Lottery Optimizer
            </button>
          </div>
          {/* Free-tier upsell card */}
          {plan === 'free' && (
            <motion.div className="empty-upsell"
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
              <div className="eu-icon">⚡</div>
              <div className="eu-body">
                <div className="eu-title">Upgrade to Pro</div>
                <div className="eu-sub">All 46 states · All games · 50 predictions/day · CSV export · API access</div>
              </div>
              <button className="eu-btn" onClick={() => setShowPricing(true)}>See Plans →</button>
            </motion.div>
          )}
        </motion.div>
      )}

      {/* Sponsored widget (free plan only) */}
      <SponsoredWidget />
    </div>
  );
}
