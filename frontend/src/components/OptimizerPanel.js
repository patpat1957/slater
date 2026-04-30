/**
 * OptimizerPanel.js
 * Full native React implementation of the Lottery Optimizer.
 * No iframe — all logic runs directly in the browser via LotteryOptimizerEngine.js.
 *
 * Props:
 *   draws     {Array}  [{date, numbers}] from predictor or empty []
 *   gameType  {string} pick3 | pick4 | pick5 | pick6 | powerball | megamil | ...
 *   drawTime  {string} 'Midday' | 'Evening'
 *   state     {string} two-letter state code
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  OPTIMIZER_GAME_CONFIGS,
  convertDrawsToEntries,
  getAllHistoryConfirmed,
  computeFreqFromEntries,
  computeSALevels,
  computeFALevels,
  computeSumStats,
  computeOEStats,
  computeConsecStats,
  computeHCPLStr,
  computeStatus,
  runAutoCalibration,
  runOptimizerEngine,
  generateOEOptions,
  getNextDrawDate,
  checkCombination,
} from './LotteryOptimizerEngine';

// ─── helper ───────────────────────────────────────────────────────────────
function dispVal(k, isNumGame) { return isNumGame ? k + 1 : k; }

// ─── Ball color by digit value ─────────────────────────────────────────────
// Pick3/4 (0-9): color based on digit
// Number games (1-69): color based on range
function getBallClass(num, isNumGame) {
  const n = parseInt(num) || 0;
  if (!isNumGame) {
    // Digit 0-9: color wheel
    const colors = [
      'opt-ball--d0', // 0 - white/silver
      'opt-ball--d1', // 1 - red
      'opt-ball--d2', // 2 - blue
      'opt-ball--d3', // 3 - green
      'opt-ball--d4', // 4 - orange
      'opt-ball--d5', // 5 - purple
      'opt-ball--d6', // 6 - teal
      'opt-ball--d7', // 7 - pink
      'opt-ball--d8', // 8 - gold
      'opt-ball--d9', // 9 - crimson
    ];
    return colors[n % 10] || 'opt-ball--d0';
  } else {
    // Number game: color by range
    if (n <= 10)  return 'opt-ball--r1';
    if (n <= 20)  return 'opt-ball--r2';
    if (n <= 30)  return 'opt-ball--r3';
    if (n <= 40)  return 'opt-ball--r4';
    if (n <= 50)  return 'opt-ball--r5';
    if (n <= 60)  return 'opt-ball--r6';
    return              'opt-ball--r7';
  }
}

// ─── Ball component ────────────────────────────────────────────────────────
function Ball({ num, isNumGame, overrideClass = '' }) {
  const cls = overrideClass || getBallClass(num, isNumGame);
  return (
    <span className={`opt-ball ${cls}`}>{num}</span>
  );
}

// ─── Star rating helper ────────────────────────────────────────────────────
// Scoring tiers (requires walk-forward backtest data):
//   5★ — 0 fails  + WF hit rate ≥ 50%   (highest confidence)
//   4★ — 0 fails  + WF hit rate ≥ 30%
//   3★ — 0 fails  (any WF)  OR  1 fail + WF ≥ 30%
//   2★ — 1 fail   (any WF)  OR  2 fails + WF ≥ 30%
//   1★ — 2+ fails (low WF)  fallback
// Without WF data: 5 - min(fails, 4), floored at 1.
function getStarCount(result) {
  if (result.walkForwardHits !== undefined && result.walkForwardTotal > 0) {
    const wfPct  = result.walkForwardHits / result.walkForwardTotal;
    const fails  = result.fails.length;
    if (fails === 0 && wfPct >= 0.50) return 5;
    if (fails === 0 && wfPct >= 0.30) return 4;
    if (fails === 0)                  return 3;
    if (fails === 1 && wfPct >= 0.30) return 3;
    if (fails === 1)                  return 2;
    if (fails === 2 && wfPct >= 0.30) return 2;  // 2-fail with strong WF still earns 2★
    return 1;
  }
  return Math.max(1, 5 - Math.min(result.fails.length, 4));
}

// ─── Star bar component ────────────────────────────────────────────────────
function StarBar({ count }) {
  return (
    <span className="opt-star-bar" aria-label={`${count} stars`}>
      {[1,2,3,4,5].map(i => (
        <span key={i} className={i <= count ? 'opt-star opt-star--on' : 'opt-star opt-star--off'}>★</span>
      ))}
    </span>
  );
}

// ─── Combo card ────────────────────────────────────────────────────────────
function ComboCard({ result, rank, isNearMiss, isNumGame, bonusNum, bonusLabel, bonusColor }) {
  const starCount = getStarCount(result);
  const rankLabels = ['🥇', '🥈', '🥉', '4th', '5th', '6th', '7th', '8th', '9th', '10th'];
  const rankLabel  = isNearMiss ? `NM${rank + 1}` : (rankLabels[rank] || `${rank + 1}th`);
  const isPassing  = result.fails.length === 0;
  const isNear1    = result.fails.length === 1;

  const cardCls = isPassing  ? 'opt-combo-card opt-combo--pass'
                : isNear1    ? 'opt-combo-card opt-combo--near'
                :              'opt-combo-card opt-combo--miss';

  const statusBadge = isPassing
    ? <span className="opt-status-badge opt-status-badge--pass">✅ PASSING</span>
    : isNear1
      ? <span className="opt-status-badge opt-status-badge--near">🔶 NEAR-MISS</span>
      : <span className="opt-status-badge opt-status-badge--miss">❌ MISS</span>;

  const wfLabel = (result.walkForwardHits !== undefined && result.walkForwardTotal > 0)
    ? `📈 ${result.walkForwardHits}/${result.walkForwardTotal} real-draw hits` : null;

  const wfPct = (result.walkForwardHits !== undefined && result.walkForwardTotal > 0)
    ? Math.round(result.walkForwardHits / result.walkForwardTotal * 100) : null;

  return (
    <div className={cardCls}>
      {/* Top row: rank + status badge */}
      <div className="opt-combo-header">
        <span className="opt-combo-rank-label" style={isNearMiss ? { color: '#fbbf24' } : {}}>
          {rankLabel}
        </span>
        {statusBadge}
      </div>

      {/* Star bar */}
      <div className="opt-combo-stars">
        <StarBar count={starCount} />
        <span className="opt-combo-star-count">{starCount}★</span>
      </div>

      {/* Colored balls */}
      <div className="opt-combo-balls">
        {result.combo.map((n, i) => (
          <Ball key={i} num={n} isNumGame={isNumGame} />
        ))}
        {bonusNum != null && (
          <span className="opt-ball opt-ball--bonus" style={{
            background: (bonusColor || '#ef4444') + '22',
            border: `2px solid ${bonusColor || '#ef4444'}`,
            color: bonusColor || '#ef4444',
            fontWeight: 800,
            borderRadius: '50%',
            width: 32, height: 32,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13, marginLeft: 4,
          }} title={bonusLabel || 'Bonus ball'}>
            {String(bonusNum).padStart(2, '0')}
          </span>
        )}
      </div>

      {/* Fail tags */}
      <div className="opt-combo-tags">
        {isPassing
          ? <span className="opt-tag opt-tag--pass">ALL PASS</span>
          : result.fails.map(f => <span key={f} className="opt-tag opt-tag--fail">❌ {f}</span>)
        }
      </div>

      {/* Walk-forward badge */}
      {wfLabel && (
        <div className="opt-combo-wf" title="Walk-forward backtest against real historical draws">
          {wfLabel}
          {wfPct !== null && (
            <span className="opt-wf-pct" style={{ color: wfPct >= 50 ? '#4ade80' : wfPct >= 30 ? '#fbbf24' : '#f87171' }}>
              &nbsp;({wfPct}%)
            </span>
          )}
        </div>
      )}

      <div className="opt-combo-score">Score: {result.score.toFixed(0)}</div>
    </div>
  );
}

// ─── SA / FA cell ──────────────────────────────────────────────────────────
function SACell({ label, nums, count, active, onClick }) {
  return (
    <div className={`opt-sa-cell ${active ? 'opt-sa-cell--active' : ''}`} onClick={onClick} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && onClick()}>
      <div className="opt-sa-lv">{label}</div>
      <div className="opt-sa-nums">{nums.slice(0, 12).join(' ') || '—'}{nums.length > 12 ? '…' : ''}</div>
      <div className="opt-sa-count">{count} num{count !== 1 ? 's' : ''}</div>
    </div>
  );
}

// ─── Progress bar ──────────────────────────────────────────────────────────
function ProgressBar({ pct }) {
  if (pct <= 0) return null;
  return (
    <div className="opt-progress-wrap">
      <div className="opt-progress-bar" style={{ width: `${pct}%` }} />
    </div>
  );
}

// ─── Optimizer Position Table ──────────────────────────────────────────────
// Shows per-position number frequency so user can manually build combos
// Also shows which numbers are "hot" at each position for the next draw
// bonusPool: pool size for the bonus ball (e.g. 26 for Powerball red ball)
// bonusLabel: display name for the bonus ball column
// bonusHist: [{nums}] where nums[0] is the bonus ball value
// lastBonusNum: the bonus ball value from the most recent draw
function OptimizerPositionTable({ allHist, n, poolSize, isNumGame, results, lastDrawNums,
                                   bonusPool = 0, bonusLabel = '', bonusHist = [], lastBonusNum = null }) {
  const [showAll, setShowAll] = useState(false);
  const [selectedNums, setSelectedNums] = useState(Array(n).fill(null)); // user-selected number per position
  const [selectedBonus, setSelectedBonus] = useState(null); // selected bonus ball

  // Compute per-position frequency from draw history (white balls only)
  const posFreq = React.useMemo(() => {
    if (!allHist || allHist.length === 0) return null;
    const pos = Array.from({ length: n }, () => new Array(poolSize).fill(0));
    allHist.forEach(e => {
      e.nums.slice(0, n).forEach((d, i) => {
        const k = isNumGame ? (parseInt(d) - 1) : parseInt(d);
        if (k >= 0 && k < poolSize) pos[i][k]++;
      });
    });
    return pos;
  }, [allHist, n, poolSize, isNumGame]);

  // Compute skip (how many draws ago each number last appeared at each position)
  const posSkip = React.useMemo(() => {
    if (!allHist || allHist.length === 0) return null;
    const skip = Array.from({ length: n }, () => new Array(poolSize).fill(allHist.length));
    for (let i = allHist.length - 1; i >= 0; i--) {
      allHist[i].nums.slice(0, n).forEach((d, pi) => {
        const k = isNumGame ? (parseInt(d) - 1) : parseInt(d);
        if (k >= 0 && k < poolSize && skip[pi][k] === allHist.length)
          skip[pi][k] = allHist.length - 1 - i;
      });
    }
    return skip;
  }, [allHist, n, poolSize, isNumGame]);

  // ── Bonus ball (Powerball red 1-26, Mega Ball 1-25) frequency & skip ──
  const bonusFreq = React.useMemo(() => {
    if (!bonusPool || !bonusHist || bonusHist.length === 0) return null;
    const freq = new Array(bonusPool).fill(0);
    bonusHist.forEach(e => {
      const k = parseInt(e.nums[0]) - 1; // 1-based → 0-based
      if (k >= 0 && k < bonusPool) freq[k]++;
    });
    return freq;
  }, [bonusHist, bonusPool]);

  const bonusSkip = React.useMemo(() => {
    if (!bonusPool || !bonusHist || bonusHist.length === 0) return null;
    const skip = new Array(bonusPool).fill(bonusHist.length);
    for (let i = bonusHist.length - 1; i >= 0; i--) {
      const k = parseInt(bonusHist[i].nums[0]) - 1;
      if (k >= 0 && k < bonusPool && skip[k] === bonusHist.length)
        skip[k] = bonusHist.length - 1 - i;
    }
    return skip;
  }, [bonusHist, bonusPool]);

  const getBonusTopNums = (showAllBonus) => {
    if (!bonusFreq) return [];
    const total = bonusHist.length;
    const sorted = bonusFreq
      .map((cnt, k) => ({ k, cnt, pct: total > 0 ? (cnt / total * 100) : 0 }))
      .filter(x => x.cnt > 0)
      .sort((a, b) => b.cnt - a.cnt)
      .slice(0, showAllBonus ? bonusPool : 15);
    const maxCnt = sorted.length > 0 ? sorted[0].cnt : 1;
    return sorted.map(x => ({ ...x, barPct: Math.round(x.cnt / maxCnt * 100) }));
  };

  if (!posFreq) return null;

  const total = allHist.length;
  const TOP_SHOW = showAll ? poolSize : Math.min(poolSize, isNumGame ? 15 : 10);

  // Get sorted top numbers per position with relative bar widths
  const getTopNums = (posIdx) => {
    const sorted = posFreq[posIdx]
      .map((cnt, k) => ({ k, cnt, pct: total > 0 ? (cnt / total * 100) : 0 }))
      .filter(x => x.cnt > 0)
      .sort((a, b) => b.cnt - a.cnt)
      .slice(0, TOP_SHOW);
    // relative bar: max frequency at this position = 100%
    const maxCnt = sorted.length > 0 ? sorted[0].cnt : 1;
    return sorted.map(x => ({ ...x, barPct: Math.round(x.cnt / maxCnt * 100) }));
  };

  // Get selected-combination star match based on positional data
  const getComboStarMatch = (combo) => {
    if (!combo || combo.length !== n) return null;
    let posScore = 0;
    let posMatches = 0;
    combo.forEach((num, pi) => {
      const k = isNumGame ? (parseInt(num) - 1) : parseInt(num);
      if (k >= 0 && k < poolSize && posFreq[pi]) {
        const sortedIdx = posFreq[pi]
          .map((c, idx) => ({ idx, c }))
          .sort((a, b) => b.c - a.c)
          .findIndex(x => x.idx === k);
        const topN = Math.ceil(poolSize * 0.3); // top 30%
        if (sortedIdx !== -1 && sortedIdx < topN) {
          posMatches++;
          posScore += (topN - sortedIdx) / topN;
        }
      }
    });
    return { posMatches, posScore: posMatches > 0 ? (posScore / posMatches * 100).toFixed(0) : 0 };
  };

  const handleSelectNum = (posIdx, num) => {
    setSelectedNums(prev => {
      const next = [...prev];
      next[posIdx] = next[posIdx] === num ? null : num;
      return next;
    });
  };

  const selectedCombo = selectedNums.every(v => v !== null) ? selectedNums : null;
  const comboStarMatch = selectedCombo ? getComboStarMatch(selectedCombo) : null;

  // Check if selected combo matches any optimizer result
  const matchedResult = selectedCombo && results ? [...(results.topPassing || []), ...(results.topNearMiss || [])].find(r =>
    r.combo.length === n && r.combo.every((v, i) => v === selectedCombo[i])
  ) : null;

  return (
    <div className="opt-pos-table-wrap">
      <div className="opt-stage__title" style={{ marginBottom: 8 }}>
        📊 Optimizer Table — Number Frequency by Position
        <span className="opt-hint" style={{ display: 'inline', marginLeft: 8, fontSize: '0.75rem', color: '#94a3b8' }}>
          ({total} draws)
        </span>
        {bonusPool > 0 && (
          <span style={{ marginLeft: 8, fontSize: '0.72rem', color: '#f87171', background: 'rgba(239,68,68,0.12)', borderRadius: 5, padding: '2px 7px' }}>
            + {bonusLabel || 'Bonus ball'} 1–{bonusPool}
          </span>
        )}
      </div>

      {/* Instructions */}
      <div className="opt-pos-instructions">
        <div className="opt-pos-instr-title">📖 How to Build Combinations:</div>
        <ol className="opt-pos-instr-list">
          <li>Look at each position column below — numbers are sorted by how often they appear at that position (P1–P{n} white balls, 1–{poolSize}).</li>
          <li>Click a number in each position to select it (highlighted in yellow).</li>
          <li>Top numbers (green) are the most frequent at that position — <strong>best candidates for next draw.</strong></li>
          <li>Once you select one number per position, your custom combination appears below with its star match rating.</li>
          {bonusPool > 0 && (
            <li>🔴 <strong>{bonusLabel || 'Bonus ball'} (1–{bonusPool})</strong> — shown in the red column on the right. Click to select your bonus ball. Hot bonus numbers (top 3) appear in green.</li>
          )}
          <li>Use <strong>Manual Combo Check</strong> below to verify your combination against all filters.</li>
          <li><strong>Star match</strong> measures how many of your selected numbers are in the top 30% for their position.</li>
        </ol>
      </div>

      {/* Position columns — white balls + optional bonus ball */}
      <div className="opt-pos-grid" style={{ gridTemplateColumns: bonusPool > 0 ? `repeat(${n}, 1fr) auto` : `repeat(${n}, 1fr)` }}>
        {Array.from({ length: n }, (_, pi) => {
          const topNums = getTopNums(pi);
          const lastNum = lastDrawNums[pi];
          return (
            <div key={pi} className="opt-pos-col">
              <div className="opt-pos-col__head">
                <span className="opt-pos-label">P{pi + 1}</span>
                {lastNum !== undefined && (
                  <span className="opt-pos-last" title="Last draw value">
                    Last: <strong>{lastNum}</strong>
                  </span>
                )}
              </div>
              <div className="opt-pos-nums">
                {topNums.map((item, rank) => {
                  const dispNum = isNumGame ? item.k + 1 : item.k;
                  const isTop3  = rank < 3;
                  const isTop10 = rank < 10;
                  const isLast  = String(dispNum) === String(lastNum);
                  const skip    = posSkip ? posSkip[pi][item.k] : null;
                  const isSelected = selectedNums[pi] === dispNum;
                  return (
                    <div
                      key={item.k}
                      className={[
                        'opt-pos-num',
                        isTop3   ? 'opt-pos-num--top3'  : '',
                        isTop10  ? 'opt-pos-num--top10' : '',
                        isLast   ? 'opt-pos-num--last'  : '',
                        isSelected ? 'opt-pos-num--selected' : '',
                      ].join(' ').trim()}
                      onClick={() => handleSelectNum(pi, dispNum)}
                      title={`${dispNum} appeared ${item.cnt}x at position ${pi+1} (${item.pct.toFixed(1)}% of draws)${skip !== null && skip < allHist.length ? ` · Last seen: ${skip} draws ago` : ''}`}
                    >
                      <span className="opt-pos-num__digit">{dispNum}</span>
                      <span className="opt-pos-num__bar">
                        <span className="opt-pos-num__fill" style={{ width: `${item.barPct}%`, minWidth: 2 }} />
                      </span>
                      <span className="opt-pos-num__cnt">{item.cnt}×</span>
                      <span className="opt-pos-num__pct">{item.pct.toFixed(0)}%</span>
                      {skip !== null && skip < allHist.length && skip <= 5 && (
                        <span className="opt-pos-num__skip" title={skip === 0 ? 'Drawn in last draw at this position' : `Last seen ${skip} draw${skip !== 1 ? 's' : ''} ago at this position`}>
                          {skip === 0 ? '↺now' : `↺${skip}`}
                        </span>
                      )}
                    </div>
                  );
                })}
                {posFreq[pi].filter(c => c > 0).length > TOP_SHOW && !showAll && (
                  <div className="opt-pos-more" onClick={() => setShowAll(true)}>
                    +{posFreq[pi].filter(c => c > 0).length - TOP_SHOW} more…
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* ── Bonus Ball Column (Powerball red 1-26 / Mega Ball 1-25) ── */}
        {bonusPool > 0 && bonusFreq && (
          <div className="opt-pos-col opt-pos-col--bonus">
            <div className="opt-pos-col__head">
              <span className="opt-pos-label opt-pos-label--bonus">
                {bonusLabel || '🔴 Bonus'}
              </span>
              {lastBonusNum != null && (
                <span className="opt-pos-last" title="Last draw bonus ball">
                  Last: <strong>{lastBonusNum}</strong>
                </span>
              )}
            </div>
            <div className="opt-pos-nums">
              {getBonusTopNums(showAll).map((item, rank) => {
                const dispNum = item.k + 1; // always 1-based
                const isTop3  = rank < 3;
                const isTop5  = rank < 5;
                const isLast  = String(dispNum) === String(lastBonusNum);
                const skip    = bonusSkip ? bonusSkip[item.k] : null;
                const isSelected = selectedBonus === dispNum;
                return (
                  <div
                    key={item.k}
                    className={[
                      'opt-pos-num opt-pos-num--bonus',
                      isTop3     ? 'opt-pos-num--top3'     : '',
                      isTop5     ? 'opt-pos-num--top10'    : '',
                      isLast     ? 'opt-pos-num--last'     : '',
                      isSelected ? 'opt-pos-num--selected' : '',
                    ].join(' ').trim()}
                    onClick={() => setSelectedBonus(prev => prev === dispNum ? null : dispNum)}
                    title={`${dispNum} drawn ${item.cnt}x as bonus ball (${item.pct.toFixed(1)}%)${skip !== null && skip < bonusHist.length ? ` · Last: ${skip} draws ago` : ''}`}
                  >
                    <span className="opt-pos-num__digit">{dispNum}</span>
                    <span className="opt-pos-num__bar">
                      <span className="opt-pos-num__fill opt-pos-num__fill--bonus" style={{ width: `${item.barPct}%`, minWidth: 2 }} />
                    </span>
                    <span className="opt-pos-num__cnt">{item.cnt}×</span>
                    <span className="opt-pos-num__pct">{item.pct.toFixed(0)}%</span>
                    {skip !== null && skip < bonusHist.length && skip <= 5 && (
                      <span className="opt-pos-num__skip" title={skip === 0 ? 'Drawn as bonus in last draw' : `Last drawn as bonus ${skip} draw${skip !== 1 ? 's' : ''} ago`}>
                        {skip === 0 ? '↺now' : `↺${skip}`}
                      </span>
                    )}
                  </div>
                );
              })}
              {bonusFreq.filter(c => c > 0).length > 15 && !showAll && (
                <div className="opt-pos-more" onClick={() => setShowAll(true)}>
                  +{bonusFreq.filter(c => c > 0).length - 15} more…
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="opt-pos-legend">
        <span className="opt-pos-legend-item opt-pos-legend--top3">■ Top 3 (hottest)</span>
        <span className="opt-pos-legend-item opt-pos-legend--top10">■ Top 10</span>
        <span className="opt-pos-legend-item opt-pos-legend--last">■ Last draw number</span>
        <span className="opt-pos-legend-item opt-pos-legend--selected">■ Your selection</span>
        {bonusPool > 0 && <span className="opt-pos-legend-item opt-pos-legend--bonus">■ Bonus ball (1–{bonusPool})</span>}
        <span className="opt-pos-legend-item" style={{ color: '#94a3b8' }}>↺now = drawn last time at this position · ↺N = N draws ago</span>
      </div>

      {/* Selected combo display */}
      <div className="opt-pos-combo-builder">
        <div className="opt-pos-combo-title">🎯 Your Combination:</div>
        <div className="opt-pos-combo-row">
          {Array.from({ length: n }, (_, pi) => (
            <div key={pi} className={`opt-pos-combo-slot ${selectedNums[pi] !== null ? 'opt-pos-combo-slot--filled' : 'opt-pos-combo-slot--empty'}`}>
              {selectedNums[pi] !== null ? selectedNums[pi] : '?'}
            </div>
          ))}
          {bonusPool > 0 && (
            <div
              className={`opt-pos-combo-slot opt-pos-combo-slot--bonus ${selectedBonus !== null ? 'opt-pos-combo-slot--bonus-filled' : 'opt-pos-combo-slot--empty'}`}
              title={bonusLabel || 'Bonus ball'}
            >
              {selectedBonus !== null ? selectedBonus : '🔴?'}
            </div>
          )}
          {selectedCombo && (
            <>
              {comboStarMatch && (
                <div className="opt-pos-combo-stars">
                  <span title={`${comboStarMatch.posMatches}/${n} positions in top 30%`}>
                    {Array.from({ length: 5 }, (_, i) => (
                      <span key={i} style={{ color: i < Math.round(comboStarMatch.posMatches / n * 5) ? '#fbbf24' : '#475569' }}>★</span>
                    ))}
                    <span style={{ fontSize: '0.72rem', color: '#94a3b8', marginLeft: 4 }}>
                      {comboStarMatch.posMatches}/{n} hot positions
                    </span>
                  </span>
                </div>
              )}
              <button className="opt-btn opt-btn--check" style={{ marginLeft: 8, padding: '4px 10px', fontSize: '0.78rem' }}
                onClick={() => { setSelectedNums(Array(n).fill(null)); setSelectedBonus(null); }}>
                Clear
              </button>
            </>
          )}
        </div>
        {bonusPool > 0 && selectedBonus !== null && (
          <div style={{ color: '#f87171', fontSize: '0.78rem', marginTop: 4 }}>
            {bonusLabel || 'Bonus ball'}: <strong>{selectedBonus}</strong>
            {bonusFreq && bonusFreq[selectedBonus - 1] !== undefined && (
              <span style={{ color: '#94a3b8', marginLeft: 8 }}>
                (drawn {bonusFreq[selectedBonus - 1]}× · {bonusHist.length > 0 ? (bonusFreq[selectedBonus - 1] / bonusHist.length * 100).toFixed(1) : 0}%)
              </span>
            )}
          </div>
        )}
        {selectedCombo && matchedResult && (
          <div className="opt-pos-combo-match" style={{ color: matchedResult.fails.length === 0 ? '#4ade80' : '#fbbf24', marginTop: 4, fontSize: '0.8rem' }}>
            {matchedResult.fails.length === 0
              ? `✅ This combo is in your PASSING results! (${getStarCount(matchedResult)}★)`
              : `🔶 This combo is in Near-Miss results — fails: ${matchedResult.fails.join(', ')}`}
          </div>
        )}
        {selectedCombo && !matchedResult && (
          <div style={{ color: '#94a3b8', fontSize: '0.75rem', marginTop: 4 }}>
            Use Manual Combo Check below to test this combination against all filters.
          </div>
        )}
        {!selectedCombo && (
          <div style={{ color: '#64748b', fontSize: '0.75rem', marginTop: 4 }}>
            Click one number per position to build a combination{bonusPool > 0 ? ` + bonus ball (1–${bonusPool})` : ''}
          </div>
        )}
      </div>

      {showAll && (
        <button className="opt-pos-show-less" onClick={() => setShowAll(false)}>Show fewer numbers ▲</button>
      )}
    </div>
  );
}

// ─── Star filter selector ──────────────────────────────────────────────────
// starFilter: 0 = show all; 2/3/4/5 = show only combos with >= N stars
function StarFilterBar({ value, onChange }) {
  // value = starFilter (0 = All, 2/3/4/5 = show combos with >= N stars)
  const options = [
    { v: 0, label: 'All',              title: 'Show all combos (1 – 5 stars)' },
    { v: 2, label: '★★+ min 2★',         title: 'Show only combos rated 2 stars or higher (hide 1★)' },
    { v: 3, label: '★★★+ min 3★',        title: 'Show only combos rated 3 stars or higher (hide 1-2★)' },
    { v: 4, label: '★★★★+ min 4★',       title: 'Show only combos rated 4 stars or higher (hide 1-3★)' },
    { v: 5, label: '★★★★★ top 5★ only',  title: 'Show only the best 5-star combos' },
  ];
  return (
    <div className="opt-star-selector">
      {options.map(o => (
        <button
          key={o.v}
          className={`opt-star-btn${value === o.v ? ' opt-star-btn--active' : ''}`}
          onClick={() => onChange(o.v)}
          title={o.title}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ─── Lines Generator component ────────────────────────────────────────────
// Renders 5 / 10 / 15 / 20 selector + "Generate Lines" button.
// On click it picks the top-N star-filtered combos from passingCombos and
// displays them as a printable slip with Next Draw game / current day info.
function LinesGenerator({ passingCombos, nearMissCombos, minStars, gameLabel, drawTypeStr, nextDraw, isNumGame, bonusPool, bonusLabel }) {
  const [numLines,       setNumLines]   = React.useState(5);
  const [generatedLines, setGenLines]   = React.useState(null);
  const [copied,         setCopied]     = React.useState(false);
  const [pickedIdx,      setPickedIdx]  = React.useState(new Set()); // indices of picked lines
  const slipRef = React.useRef(null);

  // Today's date in US Eastern time
  const todayStr = React.useMemo(() => {
    const now = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      month: 'numeric', day: 'numeric', year: 'numeric'
    }).format(new Date());
    return now;
  }, []);

  // Is the next draw today?
  const isToday = nextDraw && nextDraw.dateStr === todayStr;

  // Build a sorted, star-filtered pool from passing (preferred) + near-miss
  const pool = React.useMemo(() => {
    const starOk = (r) => minStars === 0 || getStarCount(r) >= minStars;
    const passing  = (passingCombos  || []).filter(starOk);
    const nearMiss = (nearMissCombos || []).filter(starOk);
    const sort = arr => [...arr].sort((a, b) => getStarCount(b) - getStarCount(a) || b.score - a.score);
    return [...sort(passing), ...sort(nearMiss)];
  }, [passingCombos, nearMissCombos, minStars]);

  const handleGenerate = () => {
    const lines = pool.slice(0, numLines);
    setGenLines(lines);
    setPickedIdx(new Set());
    setCopied(false);
  };

  // ── Pick-list helpers ────────────────────────────────────────────────────
  const allPicked    = generatedLines && pickedIdx.size === generatedLines.length;
  const somePicked   = pickedIdx.size > 0;
  const pickedLines  = generatedLines ? generatedLines.filter((_, i) => pickedIdx.has(i)) : [];
  const workingLines = somePicked ? pickedLines : generatedLines || [];  // copy/print uses selection if any, else all

  const togglePick = (i) => {
    setPickedIdx(prev => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  };
  const toggleAll = () => {
    if (allPicked) { setPickedIdx(new Set()); }
    else           { setPickedIdx(new Set(generatedLines.map((_, i) => i))); }
  };
  const removeSelected = () => {
    if (!generatedLines || pickedIdx.size === 0) return;
    const remaining = generatedLines.filter((_, i) => !pickedIdx.has(i));
    setGenLines(remaining.length > 0 ? remaining : null);
    setPickedIdx(new Set());
    setCopied(false);
  };

  // ── Build formatted lines for copy/print ────────────────────────────────
  const buildLines = (lines) => lines.map((r, i) => {
    const displayCombo = isNumGame ? [...r.combo].sort((a, b) => a - b) : r.combo;
    const nums  = displayCombo.join(' - ');
    const stars = '★'.repeat(getStarCount(r)) + '☆'.repeat(5 - getStarCount(r));
    const pass  = r.fails.length === 0 ? '✅ PASS' : `⚠️ ${r.fails.join(',')}`;
    return `Line ${i + 1}: ${nums}  ${stars}  ${pass}`;
  }).join('\n');

  const handleCopy = () => {
    if (!generatedLines) return;
    const drawLabel  = isToday ? "TODAY's Draw" : 'Next Draw';
    const header     = `${gameLabel} — ${drawTypeStr === 'evening' ? 'Evening' : 'Midday'} · ${drawLabel}`;
    const dateStr    = nextDraw ? `${drawLabel}: ${nextDraw.dateStr} at ${nextDraw.timeEt}` : '';
    const filterNote = minStars > 0 ? `Star Filter: ≥ ${minStars}★` : 'Star Filter: All';
    const label      = somePicked ? `Selected ${pickedLines.length} of ${generatedLines.length} lines` : `${generatedLines.length} lines`;
    const text = [header, dateStr, filterNote, label, '', buildLines(workingLines)].join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleClear = () => { setGenLines(null); setPickedIdx(new Set()); setCopied(false); };

  const handlePrint = () => {
    if (!generatedLines || !slipRef.current) return;
    const lines      = workingLines;
    const drawLabel  = isToday ? "TODAY's Draw" : 'Next Draw';
    const dateStr    = nextDraw ? `${nextDraw.dateStr} · ${nextDraw.timeEt}` : '';
    const filterNote = minStars > 0 ? `⭐ ≥${minStars}★ filter` : '⭐ All stars';
    const drawMode   = drawTypeStr === 'evening' ? '🌙 Evening' : '☀️ Midday';
    const lineLabel  = somePicked ? `${lines.length} Selected Lines` : `${lines.length} Lines`;

    const rows = lines.map((r, i) => {
      const displayCombo = isNumGame ? [...r.combo].sort((a, b) => a - b) : r.combo;
      const nums  = displayCombo.map(n => `<span class="pn-ball">${isNumGame ? String(n).padStart(2,'0') : n}</span>`).join('');
      const bonus = bonusPool > 0 && r.bonusNum != null
        ? `<span class="pn-ball pn-ball--bonus">${String(r.bonusNum).padStart(2,'0')}</span>` : '';
      const stars = '★'.repeat(getStarCount(r)) + '<span style="opacity:.3">★</span>'.repeat(5 - getStarCount(r));
      const tag   = r.fails.length === 0
        ? '<span class="pn-pass">✅ PASS</span>'
        : `<span class="pn-fail">⚠️ ${r.fails.slice(0,2).join(', ')}</span>`;
      return `<tr class="${r.fails.length === 0 ? 'pn-row-pass' : 'pn-row-near'}">
        <td class="pn-num">${i + 1}</td>
        <td class="pn-balls">${nums}${bonus}</td>
        <td class="pn-stars">${stars}</td>
        <td class="pn-tag">${tag}</td>
      </tr>`;
    }).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${gameLabel} — Lines Slip</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         background: #fff; color: #111; padding: 24px; font-size: 13px; }
  .pn-header { border-bottom: 2px solid #1e3a8a; padding-bottom: 10px; margin-bottom: 14px; }
  .pn-title  { font-size: 20px; font-weight: 800; color: #1e3a8a; letter-spacing: .5px; }
  .pn-meta   { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 6px;
               font-size: 11px; color: #475569; font-weight: 600; }
  .pn-meta span { background: #f1f5f9; border: 1px solid #cbd5e1;
                  border-radius: 10px; padding: 2px 10px; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; }
  th    { background: #1e3a8a; color: #fff; font-size: 10px; text-transform: uppercase;
          letter-spacing: .5px; padding: 6px 10px; text-align: left; }
  th:first-child { width: 32px; text-align: center; }
  tr    { border-bottom: 1px solid #e2e8f0; }
  .pn-row-pass { background: #f0fdf4; }
  .pn-row-near { background: #fffbeb; }
  .pn-num  { text-align: center; font-weight: 800; color: #1e3a8a;
             font-size: 12px; padding: 8px 4px; width: 32px; }
  .pn-balls { padding: 8px 10px; }
  .pn-ball  { display: inline-block; width: 30px; height: 30px; line-height: 30px;
              text-align: center; border-radius: 50%; background: #1e3a8a; color: #fff;
              font-weight: 800; font-size: 11px; margin-right: 4px; }
  .pn-ball--bonus { background: #dc2626; }
  .pn-stars { color: #f59e0b; font-size: 13px; padding: 8px 10px; letter-spacing: 1px; white-space: nowrap; }
  .pn-tag   { padding: 8px 10px; font-size: 11px; font-weight: 700; white-space: nowrap; }
  .pn-pass  { color: #16a34a; }
  .pn-fail  { color: #b45309; }
  .pn-footer { margin-top: 16px; font-size: 10px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 8px; }
  @media print { body { padding: 12px; } }
</style></head><body>
<div class="pn-header">
  <div class="pn-title">🎟️ ${gameLabel} — Lines Slip</div>
  <div class="pn-meta">
    <span>${drawLabel}</span>
    <span>📅 ${dateStr}</span>
    <span>${drawMode}</span>
    <span>${filterNote}</span>
    <span>${lineLabel}</span>
  </div>
</div>
<table>
  <thead><tr>
    <th>#</th><th>Numbers</th><th>Stars</th><th>Status</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>
<div class="pn-footer">
  ⚠️ Statistical picks for entertainment only — not a guarantee of winning. Please play responsibly.
  &nbsp;·&nbsp; Generated: ${new Date().toLocaleString('en-US',{timeZone:'America/New_York'})} ET
</div>
</body></html>`;

    const w = window.open('', '_blank', 'width=700,height=600');
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); }, 400);
  };

  const available = pool.length;
  const canGenerate = available > 0;

  return (
    <div className="opt-lines-gen">
      {/* ── Section Title */}
      <div className="opt-lines-gen__section-title">
        <span className="opt-lines-gen__section-icon">🎟️</span>
        <span className="opt-lines-gen__section-label">Lines Generator</span>
        <span className="opt-lines-gen__section-sub">
          {isToday
            ? <span className="opt-lines-gen__today-badge">📅 TODAY</span>
            : nextDraw
              ? <span className="opt-lines-gen__next-badge">📅 Next Draw</span>
              : null}
          {minStars > 0
            ? <span className="opt-lines-gen__filter-note">⭐ ≥{minStars}★ filter · {available} available</span>
            : <span className="opt-lines-gen__filter-note">⭐ All stars · {available} available</span>}
        </span>
      </div>

      {/* ── Draw Info Banner (Today vs Next Draw) */}
      {nextDraw && (
        <div className={`opt-lines-gen__draw-info${isToday ? ' opt-lines-gen__draw-info--today' : ''}`}>
          {isToday
            ? <span className="opt-lines-gen__draw-today-label">🔴 TODAY's Draw</span>
            : <span className="opt-lines-gen__draw-next-label">⏭ Next Draw</span>}
          <span className="opt-lines-gen__draw-badge">📅 {nextDraw.dateStr}</span>
          <span className="opt-lines-gen__draw-time">⏰ {nextDraw.timeEt}</span>
          <span className="opt-lines-gen__draw-game">🎰 {gameLabel} · {drawTypeStr === 'evening' ? '🌙 Evening' : '☀️ Midday'}</span>
        </div>
      )}

      {/* ── Lines Count Selector + Generate Button */}
      <div className="opt-lines-gen__controls">
        <span className="opt-lines-gen__label">How many lines?</span>
        <div className="opt-lines-gen__btn-group">
          {[5, 10, 15, 20].map(n => (
            <button
              key={n}
              className={`opt-lines-btn${numLines === n ? ' opt-lines-btn--active' : ''}`}
              onClick={() => { setNumLines(n); setGenLines(null); setPickedIdx(new Set()); }}
              title={`Select ${n} lines`}
            >
              {n}
            </button>
          ))}
        </div>
        <button
          className="opt-lines-gen__go"
          onClick={handleGenerate}
          disabled={!canGenerate}
          title={canGenerate ? `Generate top ${numLines} star-filtered lines` : 'Run Auto-Calibrate or Optimize first'}
        >
          {canGenerate ? `▶ Generate ${numLines} Lines` : '⚠️ Run Optimizer First'}
        </button>
        {generatedLines && (
          <div className="opt-lines-gen__post-btns">
            <button className="opt-lines-copy" onClick={handleCopy} title={somePicked ? `Copy ${pickedLines.length} selected lines` : 'Copy all lines to clipboard'}>
              {copied ? '✅ Copied!' : somePicked ? `📋 Copy (${pickedLines.length})` : '📋 Copy'}
            </button>
            <button className="opt-lines-print" onClick={handlePrint} title={somePicked ? `Print ${pickedLines.length} selected lines` : 'Print all lines'}>
              {somePicked ? `🖨️ Print (${pickedLines.length})` : '🖨️ Print'}
            </button>
            {somePicked && (
              <button className="opt-lines-remove" onClick={removeSelected} title={`Remove ${pickedLines.length} selected lines`}>
                🗑️ Remove ({pickedLines.length})
              </button>
            )}
            <button className="opt-lines-clear" onClick={handleClear} title="Clear all generated lines">× Clear</button>
          </div>
        )}
      </div>

      {/* ── Active star filter hint */}
      {minStars > 0 && (
        <div className="opt-lines-gen__star-hint">
          ⭐ Star filter active: showing only combos with <strong>≥ {minStars}★</strong> ·
          {available > 0
            ? ` ${available} combo${available !== 1 ? 's' : ''} in pool`
            : ' No combos match — relax the filter or run Auto-Calibrate'}
        </div>
      )}

      {/* ── Generated slip */}
      {generatedLines && generatedLines.length > 0 && (
        <div className="opt-lines-slip" ref={slipRef}>

          {/* Slip header with Select-All checkbox */}
          <div className="opt-lines-slip__header">
            <label className="opt-lines-selectall" title="Select / deselect all lines">
              <input
                type="checkbox"
                checked={allPicked}
                onChange={toggleAll}
                className="opt-lines-chk"
              />
              <span className="opt-lines-selectall__label">
                {somePicked ? `${pickedIdx.size} of ${generatedLines.length} picked` : 'Select'}
              </span>
            </label>
            <span className="opt-lines-slip__game">{gameLabel}</span>
            <span className="opt-lines-slip__draw">{drawTypeStr === 'evening' ? '🌙 Evening' : '☀️ Midday'}</span>
            {nextDraw && (
              <span className={`opt-lines-slip__date${isToday ? ' opt-lines-slip__date--today' : ''}`}>
                {isToday ? '🔴 TODAY ' : ''}📅 {nextDraw.dateStr}
              </span>
            )}
            {minStars > 0 && (
              <span className="opt-lines-slip__star-filter">⭐ ≥{minStars}★</span>
            )}
            <span className="opt-lines-slip__count">{generatedLines.length} Lines</span>
          </div>

          {/* Pick-list toolbar — shown only when some lines are selected */}
          {somePicked && (
            <div className="opt-lines-picklist-bar">
              <span className="opt-lines-picklist-bar__info">
                ✔ {pickedIdx.size} line{pickedIdx.size !== 1 ? 's' : ''} selected
              </span>
              <div className="opt-lines-picklist-bar__actions">
                <button className="opt-lines-copy opt-lines-copy--sm" onClick={handleCopy}>📋 Copy selected</button>
                <button className="opt-lines-print opt-lines-print--sm" onClick={handlePrint}>🖨️ Print selected</button>
                <button className="opt-lines-remove opt-lines-remove--sm" onClick={removeSelected}>🗑️ Remove selected</button>
              </div>
            </div>
          )}

          {/* Lines list */}
          <div className="opt-lines-slip__list">
            {generatedLines.map((r, i) => {
              const displayCombo = isNumGame ? [...r.combo].sort((a, b) => a - b) : r.combo;
              const stars     = getStarCount(r);
              const isPassing = r.fails.length === 0;
              const isPicked  = pickedIdx.has(i);
              const rowCls    = [
                'opt-lines-row',
                isPassing ? 'opt-lines-row--pass' : 'opt-lines-row--near',
                isPicked  ? 'opt-lines-row--picked' : '',
              ].join(' ').trim();
              return (
                <div key={i} className={rowCls} onClick={() => togglePick(i)} title="Click to pick / unpick this line">
                  {/* Checkbox */}
                  <label className="opt-lines-row__chk" onClick={e => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isPicked}
                      onChange={() => togglePick(i)}
                      className="opt-lines-chk"
                    />
                  </label>
                  <span className="opt-lines-num">{i + 1}</span>
                  <div className="opt-lines-balls">
                    {displayCombo.map((num, j) => <Ball key={j} num={num} isNumGame={isNumGame} />)}
                    {bonusPool > 0 && r.bonusNum != null && (
                      <Ball num={r.bonusNum} isNumGame={true} overrideClass="opt-ball--bonus" />
                    )}
                  </div>
                  <StarBar count={stars} />
                  <span className="opt-lines-status">
                    {isPassing
                      ? <span className="opt-tag opt-tag--pass">✅ PASS</span>
                      : r.fails.slice(0, 2).map(f => <span key={f} className="opt-tag opt-tag--fail">❌{f}</span>)
                    }
                  </span>
                  {r.walkForwardHits !== undefined && r.walkForwardTotal > 0 && (
                    <span className="opt-lines-wf">📈 {r.walkForwardHits}/{r.walkForwardTotal}</span>
                  )}
                </div>
              );
            })}
          </div>

          {generatedLines.length < numLines && (
            <div className="opt-lines-slip__warn">
              ⚠️ Only {generatedLines.length} combos available with current star filter.
              {minStars > 0 && ' Try relaxing the star filter or run Auto-Calibrate for more results.'}
            </div>
          )}
          <div className="opt-lines-slip__footer">
            ⚠️ Statistical picks only — not a guarantee of winning. Play responsibly.
          </div>
        </div>
      )}

      {generatedLines && generatedLines.length === 0 && (
        <div className="opt-lines-empty">
          ⚠️ No combos available for this star filter. Try "All" stars or run Auto-Calibrate.
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════
export default function OptimizerPanel({ draws = [], gameType = 'pick3', drawTime = 'Evening', state = 'CA', onLoadData = null, loadingData = false }) {
  const cfg = OPTIMIZER_GAME_CONFIGS[gameType] || OPTIMIZER_GAME_CONFIGS.pick3;
  const { n, poolSize, isNumGame, label: gameLabel } = cfg;
  // 'All' draw-time → treat as 'evening' for optimizer purposes (uses full history anyway)
  const drawTimeNorm = drawTime && drawTime.toLowerCase();
  const drawTypeStr = drawTimeNorm === 'midday' ? 'midday' : 'evening';

  // Convert predictor draws → optimizer entries
  const entries = convertDrawsToEntries(draws, drawTypeStr);
  const allHist = getAllHistoryConfirmed(entries, n, drawTypeStr);

  // ── Derived stats (computed once when entries change) ─────────────────
  const [statsReady, setStatsReady] = useState(false);
  const [saLevels,   setSaLevels]   = useState([[], [], [], [], []]);
  const [faLevels,   setFaLevels]   = useState([[], [], [], []]);
  const [sumStats,   setSumStats]   = useState({ lo: 0, hi: 27, avg: 13, recent: 0, sums: [] });
  const [oeStats,    setOeStats]    = useState({ bestPattern: 'N/A', top2Patterns: 'N/A', patterns: {}, top2: [] });
  const [statusInfo, setStatusInfo] = useState({ isNormal: true, unstableCount: 0 });
  const [hcplStr,    setHcplStr]    = useState('N/A');
  const [consecStr,  setConsecStr]  = useState('0/0');

  // ── User selections ────────────────────────────────────────────────────
  const [selectedSA, setSelectedSA] = useState(-1);  // -1 = none
  const [selectedFA, setSelectedFA] = useState(-1);
  const [optSum,     setOptSum]     = useState('on');
  const [optOE,      setOptOE]      = useState('auto');
  const [optConsec,  setOptConsec]  = useState('auto');
  const [optHCPL,    setOptHCPL]    = useState('on');
  const [optRep,     setOptRep]     = useState('auto');
  const [topCount,   setTopCount]   = useState(5);
  // ── Star filter ────────────────────────────────────────────────────────
  // minStars=0 means show all; 2/3/4/5 = show only combos with >= N stars
  const [minStars,   setMinStars]   = useState(0);  // 0 = show all
  const [predMinStars, setPredMinStars] = useState(0); // dedicated prediction star filter

  // ── Manual combo check ─────────────────────────────────────────────────
  const [manualInput,   setManualInput]   = useState('');
  const [manualResult,  setManualResult]  = useState(null);

  // ── Run state ──────────────────────────────────────────────────────────
  const [running,  setRunning]  = useState(false);
  const [progress, setProgress] = useState(0);
  const [status,   setStatus]   = useState('');
  const [results,  setResults]  = useState(null);
  const [nextDraw, setNextDraw] = useState(null);
  const [calibReport, setCalibReport] = useState(null);

  const runningRef = useRef(false);

  // ── Recompute stats when draws/game changes ────────────────────────────
  useEffect(() => {
    setStatsReady(false);
    setResults(null);
    setCalibReport(null);
    setNextDraw(null);
    setProgress(0);
    setStatus('');
    setSelectedSA(-1);
    setSelectedFA(-1);
    setManualResult(null);
    setManualInput('');
    setMinStars(0);   // reset star filter when game/draws change
    setPredMinStars(0); // reset prediction star filter

    if (allHist.length < 1) { setStatsReady(true); return; }

    const histFreq = computeFreqFromEntries(allHist, n, poolSize, isNumGame, 0.01);
    const sa = computeSALevels(allHist, poolSize, isNumGame, n);
    const fa = computeFALevels(histFreq.overall, poolSize, isNumGame);
    const ss = computeSumStats(allHist, isNumGame, n);
    const oe = computeOEStats(allHist, n, isNumGame);
    const st = computeStatus(allHist, n, isNumGame, histFreq.overall, ss);
    const lastNums = allHist.length > 0 ? allHist[allHist.length - 1].nums.slice(0, n) : [];
    const hc = computeHCPLStr(lastNums, histFreq.overall, poolSize, isNumGame);
    const cs = computeConsecStats(allHist);

    setSaLevels(sa);
    setFaLevels(fa);
    setSumStats(ss);
    setOeStats(oe);
    setStatusInfo(st);
    setHcplStr(hc);
    setConsecStr(cs);
    setStatsReady(true);
  // eslint-disable-next-line
  }, [draws.length, gameType, drawTime, allHist.length]);

  // ── Auto-Calibrate ─────────────────────────────────────────────────────
  const handleAutoCalibrate = useCallback(async () => {
    if (running) return;
    if (allHist.length < n + 2) {
      setStatus(`❌ Need at least ${n + 2} confirmed draws. Add more results first.`);
      return;
    }
    setRunning(true);
    runningRef.current = true;
    setResults(null);
    setCalibReport(null);
    setNextDraw(null);
    setProgress(5);
    setStatus('🔬 Calibrating against ' + allHist.length + ' draws… ML: F1+Decay+Skip…');

    await new Promise(r => setTimeout(r, 20));
    const cal = runAutoCalibration(allHist, n, poolSize, isNumGame, p => setProgress(p));

    setSelectedSA(cal.bestSA.lvl);
    setSelectedFA(cal.bestFA.lvl);
    setOptSum('on');
    setOptOE(cal.bestOE);
    setOptConsec(cal.bestConsec);
    setOptHCPL('on');
    setOptRep(cal.bestRep);

    setCalibReport(cal);
    setProgress(85);
    setStatus(`⚙️ Running 5,000-iteration optimizer on ${allHist.length} actual ${gameLabel} draws…`);

    const opts = { sum: 'on', oe: cal.bestOE, consec: cal.bestConsec, hcpl: 'on', rep: cal.bestRep };
    const res = await runOptimizerEngine({
      entries, n, poolSize, isNumGame,
      saLvl: cal.bestSA.lvl, faLvl: cal.bestFA.lvl,
      saLevels: cal.saLevels, faLevels: cal.faLevels,
      opts, topCount, decay: 0.02,
      onProgress: p => setProgress(85 + Math.round(p * 0.15)),
      drawType: drawTypeStr,
      gameType,
    });

    const nd = getNextDrawDate(gameType, drawTypeStr);
    setResults(res);
    setNextDraw(nd);
    setProgress(0);
    setStatus('');
    setRunning(false);
    runningRef.current = false;
  }, [allHist, entries, n, poolSize, isNumGame, gameType, gameLabel, drawTypeStr, topCount, running]);

  // ── Manual Optimize (no calibration) ──────────────────────────────────
  const handleOptimize = useCallback(async () => {
    if (running) return;
    if (allHist.length < 1) {
      setStatus('❌ No history data. Generate predictions first or add draw data.');
      return;
    }
    setRunning(true);
    runningRef.current = true;
    setResults(null);
    setCalibReport(null);
    setProgress(2);
    setStatus(`⚙️ Optimizing — 5,000 iterations on ${allHist.length} actual ${gameLabel} draws…`);

    const opts = { sum: optSum, oe: optOE, consec: optConsec, hcpl: optHCPL, rep: optRep };

    const histFreq = computeFreqFromEntries(allHist, n, poolSize, isNumGame, 0.01);
    const saL = saLevels.length === 5 && saLevels[0].length > 0 ? saLevels : computeSALevels(allHist, poolSize, isNumGame, n);
    const faL = faLevels.length === 4 && faLevels[0].length > 0 ? faLevels : computeFALevels(histFreq.overall, poolSize, isNumGame);

    const res = await runOptimizerEngine({
      entries, n, poolSize, isNumGame,
      saLvl: selectedSA, faLvl: selectedFA,
      saLevels: saL, faLevels: faL,
      opts, topCount, decay: 0.01,
      onProgress: p => setProgress(p),
      drawType: drawTypeStr,
      gameType,
    });

    const nd = getNextDrawDate(gameType, drawTypeStr);
    setResults(res);
    setNextDraw(nd);
    setProgress(0);
    setStatus('');
    setRunning(false);
    runningRef.current = false;
  }, [allHist, entries, n, poolSize, isNumGame, gameType, gameLabel, drawTypeStr, saLevels, faLevels, selectedSA, selectedFA, optSum, optOE, optConsec, optHCPL, optRep, topCount, running]);

  // ── Manual combo check ─────────────────────────────────────────────────
  const handleManualCheck = useCallback(() => {
    const raw = manualInput.trim().replace(/[^0-9]/g, ' ').trim().split(/\s+/).filter(Boolean);
    if (raw.length !== n) {
      setManualResult({ ok: false, msg: `❌ Enter exactly ${n} numbers` });
      return;
    }
    const nums = raw.map(Number);
    if (allHist.length === 0) {
      setManualResult({ ok: false, msg: '❌ No history data' });
      return;
    }
    const histFreq = computeFreqFromEntries(allHist, n, poolSize, isNumGame, 0);
    const ss = computeSumStats(allHist, isNumGame, n);
    const oe = computeOEStats(allHist, n, isNumGame);
    const fails = checkCombination(nums, allHist, histFreq.overall, histFreq.pos, poolSize, isNumGame, n, ss, oe, { sum: 'on', oe: 'auto', consec: 'auto', hcpl: 'on', rep: 'auto' });
    if (fails.length === 0) {
      setManualResult({ ok: true, msg: '✅ PASS — optimal combination!' });
    } else {
      setManualResult({ ok: false, msg: `⚠️ FAIL: ${fails.join(', ')}` });
    }
  }, [manualInput, allHist, n, poolSize, isNumGame]);

  const hasData = allHist.length >= n + 2;
  const lastDrawNums = allHist.length > 0 ? allHist[allHist.length - 1].nums.slice(0, n) : [];
  // Walk-forward window matches the engine: 20% of history, min 50, max 200
  const wfWindow = Math.min(200, Math.max(50, Math.floor(allHist.length * 0.20)));

  // ─── Bonus ball support (Powerball red ball 1-26, Mega Ball 1-25) ──────
  const bonusN    = cfg.bonusN    || 0;
  const bonusPool = cfg.bonusPool || 0;
  const bonusLabel = cfg.bonusLabel || '';
  // bonusHist: each entry has nums[0] = the bonus ball value (index n in draw)
  const bonusHist = bonusPool > 0 && allHist.length > 0
    ? allHist.filter(e => e.nums.length > n && e.nums[n] != null).map(e => ({ nums: [e.nums[n]] }))
    : [];
  const lastBonusNum = bonusPool > 0 && allHist.length > 0
    ? (allHist[allHist.length - 1].nums[n] ?? null)
    : null;

  // ─── Bonus ball picks for combo lines (rotate through top-frequency bonus numbers) ──
  const bonusColor = cfg.bonusLabel?.includes('gold') ? '#f59e0b' : '#ef4444';
  const topBonusNums = React.useMemo(() => {
    if (!bonusPool || !bonusHist || bonusHist.length === 0) return [];
    const freq = new Array(bonusPool).fill(0);
    bonusHist.forEach(e => { const k = parseInt(e.nums[0]) - 1; if (k >= 0 && k < bonusPool) freq[k]++; });
    return freq.map((cnt, idx) => ({ num: idx + 1, cnt }))
      .sort((a, b) => b.cnt - a.cnt)
      .slice(0, 5)
      .map(x => x.num);
  }, [bonusHist, bonusPool]);
  // Pick bonus for combo at index i: cycle through top 5 hot bonus numbers
  const pickBonusForCombo = (i) => {
    if (!bonusPool || topBonusNums.length === 0) return null;
    return topBonusNums[i % topBonusNums.length];
  };

  // ─── OE options ────────────────────────────────────────────────────────
  const oeOptions = generateOEOptions(n);

  // ─── Helper: star filter predicate ─────────────────────────────────────
  const starMatch = (r) => {
    const s = getStarCount(r);
    // minStars=0 → show all; N → show only combos with stars >= N (min quality filter)
    return minStars === 0 ? true : s >= minStars;
  };
  const countFiltered = (arr) => arr ? arr.filter(starMatch).length : 0;

  // ─── Render ────────────────────────────────────────────────────────────
  return (
    <div className="opt-panel">

      {/* ── Header ── */}
      <div className="opt-panel__header">
        <div className="opt-panel__title">
          🎰 Lottery Optimizer
          {statusInfo.isNormal
            ? <span className="opt-status opt-status--normal">✅ NORMAL</span>
            : <span className="opt-status opt-status--unstable">⚠️ UNSTABLE ({statusInfo.unstableCount} consec fails)</span>
          }
        </div>
        <div className="opt-panel__meta">
          <span className="opt-meta-chip">{gameLabel}</span>
          <span className="opt-meta-chip">{drawTypeStr === 'midday' ? '☀️ Midday' : '🌙 Evening'}</span>
          <span className="opt-meta-chip">📍 {state}</span>
          <span className="opt-meta-chip opt-meta-chip--data">
            📊 {allHist.length} draws · Last: {lastDrawNums.join('-') || '—'}
          </span>
        </div>
      </div>

      {/* ── No data notice ── */}
      {!hasData && (
        <div className="opt-nodata">
          <div className="opt-nodata__icon">📊</div>
          <div className="opt-nodata__title">Draw History Needed</div>
          <div className="opt-nodata__sub">
            {allHist.length === 0
              ? 'Load draw history to run the Optimizer.'
              : `Only ${allHist.length} draw${allHist.length !== 1 ? 's' : ''} loaded — need at least ${n + 2}. Load more data below.`
            }
          </div>
          {onLoadData && (
            <button
              className="opt-btn opt-btn--calibrate"
              style={{ marginTop: 16, fontSize: '0.9rem' }}
              onClick={onLoadData}
              disabled={loadingData}
            >
              {loadingData ? '⏳ Loading draw data…' : '📥 Load Draw Data'}
            </button>
          )}
        </div>
      )}

      {/* ── Three-stage panel (only shown with data) ── */}
      {hasData && statsReady && (
        <>
          {/* ── STAGE 1: SA / FA ── */}
          <div className="opt-stage">
            <div className="opt-stage__title">Stage 1 — Number Reduction</div>

            <div className="opt-stage__sub" style={{ color: '#93c5fd' }}>
              📊 Skip Analysis (SA) — most recent digit occurrences
            </div>
            <div className="opt-sa-grid">
              {saLevels.map((pool, i) => (
                <SACell
                  key={i}
                  label={`SA${i + 1}`}
                  nums={pool.map(k => dispVal(k, isNumGame))}
                  count={pool.length}
                  active={selectedSA === i}
                  onClick={() => setSelectedSA(selectedSA === i ? -1 : i)}
                />
              ))}
            </div>
            <div className="opt-hint">SA1=last 1 draw · SA2=last 2 · SA3=last 3 · SA4=last 5 · SA5=last 7 draws. <strong>Lower=fewer digits.</strong> Leave unselected to use all.</div>

            <div className="opt-stage__sub" style={{ color: '#86efac', marginTop: 10 }}>
              📈 Frequency Analysis (FA) — most frequent digits
            </div>
            <div className="opt-fa-grid">
              {faLevels.map((pool, i) => (
                <SACell
                  key={i}
                  label={`FA${i + 1}`}
                  nums={pool.map(k => dispVal(k, isNumGame))}
                  count={pool.length}
                  active={selectedFA === i}
                  onClick={() => setSelectedFA(selectedFA === i ? -1 : i)}
                />
              ))}
            </div>
            <div className="opt-hint">FA1=top 30% · FA2=top 50% · FA3=top 70% · FA4=all non-zero. <strong>Lower=hotter digits only.</strong></div>
          </div>

          {/* ── OPTIMIZER TABLE: Position Frequency Table ── */}
          <div className="opt-stage">
            <OptimizerPositionTable
              allHist={allHist}
              n={n}
              poolSize={poolSize}
              isNumGame={isNumGame}
              results={results}
              lastDrawNums={lastDrawNums}
              bonusPool={bonusPool}
              bonusLabel={bonusLabel}
              bonusHist={bonusHist}
              lastBonusNum={lastBonusNum}
            />
          </div>

          {/* ── STAGE 2: Filter Options ── */}
          <div className="opt-stage">
            <div className="opt-stage__title">Stage 2 — Filter Options</div>
            <div className="opt-settings">

              <div className="opt-field">
                <label className="opt-label">🔢 Sum Range (85%)</label>
                <div className="opt-field__info">{sumStats.lo}–{sumStats.hi} · Avg: {sumStats.avg}</div>
                <select className="opt-select" value={optSum} onChange={e => setOptSum(e.target.value)}>
                  <option value="on">✅ Filter sums</option>
                  <option value="off">⬜ Off</option>
                </select>
              </div>

              <div className="opt-field">
                <label className="opt-label">⚖️ Odd/Even Pattern</label>
                <div className="opt-field__info">{oeStats.bestPattern} · Top-2: {oeStats.top2Patterns}</div>
                <select className="opt-select" value={optOE} onChange={e => setOptOE(e.target.value)}>
                  <option value="auto">🔄 Auto top-2 patterns</option>
                  <option value="off">⬜ Off</option>
                  {oeOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>

              <div className="opt-field">
                <label className="opt-label">🔗 Consecutive Digits</label>
                <div className="opt-field__info">{consecStr} of last 10 draws</div>
                <select className="opt-select" value={optConsec} onChange={e => setOptConsec(e.target.value)}>
                  <option value="auto">🔄 Auto</option>
                  <option value="ok">✅ Allow</option>
                  <option value="no">❌ No Consecutive</option>
                </select>
              </div>

              <div className="opt-field">
                <label className="opt-label">🌡️ HCPL Filter</label>
                <div className="opt-field__info">{hcplStr}</div>
                <select className="opt-select" value={optHCPL} onChange={e => setOptHCPL(e.target.value)}>
                  <option value="on">✅ Avoid repeat H/C/P/L</option>
                  <option value="off">⬜ Off</option>
                </select>
              </div>

              <div className="opt-field">
                <label className="opt-label">🔁 Max Repeats from Last Draw</label>
                <div className="opt-field__info">Last: {lastDrawNums.join('-') || '—'}</div>
                <select className="opt-select" value={optRep} onChange={e => setOptRep(e.target.value)}>
                  <option value="auto">🔄 Auto</option>
                  <option value="0">0 — no repeats</option>
                  <option value="1">1 repeat OK</option>
                  <option value="2">2 repeats OK</option>
                </select>
              </div>

              <div className="opt-field">
                <label className="opt-label">📋 Top N Combos</label>
                <select className="opt-select" value={topCount} onChange={e => setTopCount(parseInt(e.target.value))}>
                  <option value={3}>Top 3</option>
                  <option value={5}>Top 5</option>
                  <option value={10}>Top 10</option>
                </select>
              </div>
            </div>

            {/* ── Star Filter Bar ── */}
            <div className="opt-stage__sub" style={{ marginTop: 10, color: '#fbbf24' }}>
              ⭐ Star Filter — show only combos at or above selected star rating
            </div>
            <StarFilterBar value={minStars} onChange={setMinStars} />
            {minStars > 0 && (
              <div className="opt-star-filter-strip">
                ⭐ Active: showing <strong>≥ {minStars}★ only</strong> (minimum {minStars} stars)
                &nbsp;·&nbsp;
                <button className="opt-star-filter-clear" onClick={() => setMinStars(0)}>Clear ×</button>
              </div>
            )}
            <div className="opt-hint">
              ⭐ Star rating: ⭐⭐⭐⭐⭐=0 fails+≥50% WF hit · ⭐⭐⭐⭐=0 fails+≥30% · ⭐⭐⭐=0 fails · ⭐⭐=1 fail OR 2 fails+≥30% WF · ⭐=2+ fails low WF.
              <strong>“min 3★” shows only 3★–5★ combos · “top 5★” shows only the best · “All” = no filter.</strong>
            </div>
          </div>


          {/* ── Lines Generator ── */}
          <LinesGenerator
            passingCombos={results ? results.topPassing : []}
            nearMissCombos={results ? results.topNearMiss : []}
            minStars={minStars}
            gameLabel={gameLabel}
            drawTypeStr={drawTypeStr}
            nextDraw={nextDraw}
            isNumGame={isNumGame}
            bonusPool={bonusPool}
            bonusLabel={bonusLabel}
          />

          {/* ── Manual combo check ── */}
          <div className="opt-manual">
            <div className="opt-stage__title">🔍 Manual Combo Check</div>
            <div className="opt-manual__row">
              <input
                className="opt-manual__input"
                type="text"
                value={manualInput}
                onChange={e => setManualInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleManualCheck()}
                placeholder={n === 3 ? 'e.g. 4-7-2' : n === 4 ? 'e.g. 3-5-8-1' : '1-2-3-4-5'}
              />
              <button className="opt-btn opt-btn--check" onClick={handleManualCheck}>CHECK</button>
            </div>
            {manualResult && (
              <div className={`opt-manual__result ${manualResult.ok ? 'opt-manual__result--pass' : 'opt-manual__result--fail'}`}>
                {manualResult.msg}
              </div>
            )}
          </div>

          {/* ── Action buttons ── */}
          <div className="opt-actions">
            <button
              className="opt-btn opt-btn--calibrate"
              onClick={handleAutoCalibrate}
              disabled={running || !hasData}
            >
              {running && progress > 0 && progress < 90 ? '⏳ Calibrating…' : '🔬 Auto-Calibrate & Predict'}
            </button>
            <button
              className="opt-btn opt-btn--optimize"
              onClick={handleOptimize}
              disabled={running || !hasData}
            >
              {running && progress >= 90 ? '⏳ Optimizing…' : `🎰 Optimize (5,000 runs on ${allHist.length} draws)`}
            </button>
          </div>
          <div className="opt-hint" style={{ marginBottom: 8 }}>
            Uses <strong>{allHist.length} actual {gameLabel} draws</strong> for all 5,000 iterations · Auto-Calibrate finds best settings first
          </div>

          {/* Progress bar */}
          <ProgressBar pct={progress} />

          {/* Status message */}
          {status && <div className="opt-status-msg">{status}</div>}

          {/* ── Calibration report ── */}
          {calibReport && (
            <div className="opt-calib-report">
              <div className="opt-calib-report__title">
                🔬 Auto-Calibration Complete — {calibReport.training.length} {gameLabel} draws · testSize={calibReport.testSize} &nbsp;
                <span className="opt-ml-badge">🧠 ML: F1+Decay+Skip</span>
              </div>
              <div className="opt-calib-grid">
                <div className="opt-an-card"><div className="opt-an-title">📊 Best SA</div><div className="opt-an-val">SA{calibReport.bestSA.lvl + 1} <span className="opt-an-muted">({(calibReport.bestSA.hit * 100).toFixed(0)}% hit, pool: {calibReport.bestSA.size})</span></div></div>
                <div className="opt-an-card"><div className="opt-an-title">📈 Best FA</div><div className="opt-an-val">FA{calibReport.bestFA.lvl + 1} <span className="opt-an-muted">({(calibReport.bestFA.hit * 100).toFixed(0)}% hit, pool: {calibReport.bestFA.size})</span></div></div>
                <div className="opt-an-card"><div className="opt-an-title">⚖️ OE Filter</div><div className="opt-an-val">{calibReport.bestOE === 'auto' ? 'Auto (top-2)' : 'Off'} <span className="opt-an-muted">({(calibReport.oeTopPct * 100).toFixed(0)}% cov)</span></div></div>
                <div className="opt-an-card"><div className="opt-an-title">🔗 Consecutive</div><div className="opt-an-val">{calibReport.bestConsec === 'ok' ? 'Allow' : 'Auto'} <span className="opt-an-muted">({(calibReport.consecDraws * 100).toFixed(0)}% draws)</span></div></div>
                <div className="opt-an-card"><div className="opt-an-title">🔁 Repeat</div><div className="opt-an-val">Max {calibReport.bestRep} <span className="opt-an-muted">(avg {calibReport.avgRep.toFixed(1)})</span></div></div>
                <div className="opt-an-card"><div className="opt-an-title">🎯 Sum Range</div><div className="opt-an-val">{calibReport.sumStats.lo}–{calibReport.sumStats.hi} <span className="opt-an-muted">(avg {calibReport.sumStats.avg})</span></div></div>
              </div>
              <div className="opt-calib-report__pools">
                SA pool: [{calibReport.saLevels[calibReport.bestSA.lvl]?.map(k => dispVal(k, isNumGame)).join(' ') || ''}] ·
                FA pool: [{calibReport.faLevels[calibReport.bestFA.lvl]?.map(k => dispVal(k, isNumGame)).join(' ') || ''}]
              </div>
            </div>
          )}

          {/* ── Results ── */}
          {results && (
            <>
              {/* Summary row */}
              <div className="opt-summary-row">
                <div className="opt-an-card">
                  <div className="opt-an-title">📊 SA Pool</div>
                  <div className="opt-an-val" style={{ fontSize: '.75rem' }}>
                    {selectedSA >= 0 ? `SA${selectedSA + 1}: [${saLevels[selectedSA]?.map(k => dispVal(k, isNumGame)).join(' ')}]` : 'All digits'}
                  </div>
                </div>
                <div className="opt-an-card">
                  <div className="opt-an-title">📈 FA Pool</div>
                  <div className="opt-an-val" style={{ fontSize: '.75rem' }}>
                    {selectedFA >= 0 ? `FA${selectedFA + 1}: [${faLevels[selectedFA]?.map(k => dispVal(k, isNumGame)).join(' ')}]` : 'All digits'}
                  </div>
                </div>
                <div className="opt-an-card">
                  <div className="opt-an-title">✅ Pass Rate</div>
                  <div className="opt-an-val" style={{ color: results.total > 0 ? (results.passes / results.total >= 0.2 ? '#4ade80' : results.passes / results.total >= 0.05 ? '#fbbf24' : '#f87171') : '#f87171' }}>
                    {results.total > 0 ? (results.passes / results.total * 100).toFixed(1) : 0}% ({results.passes}/{results.total})
                  </div>
                </div>
                <div className="opt-an-card">
                  <div className="opt-an-title">🎯 Sum Range</div>
                  <div className="opt-an-val">{results.sumStats.lo}–{results.sumStats.hi} (avg {results.sumStats.avg})</div>
                </div>
                <div className="opt-an-card">
                  <div className="opt-an-title">📈 Walk-Forward</div>
                  <div className="opt-an-val" style={{ fontSize: '.72rem' }}>
                    Tested on {wfWindow} real {gameLabel} draws
                  </div>
                </div>
              </div>

              {/* Fail code breakdown */}
              {Object.keys(results.failFreq).length > 0 && (
                <div className="opt-fail-breakdown">
                  <div className="opt-fail-breakdown__title">🔍 Filter Fail Frequency (5,000 iterations on actual draws)</div>
                  {['SUM', 'SAM', 'ODD', 'CON', 'HCC', 'REP', 'FRQ', 'PAT']
                    .filter(f => results.failFreq[f] > 0)
                    .sort((a, b) => (results.failFreq[b] || 0) - (results.failFreq[a] || 0))
                    .map(f => {
                      const pct = results.total > 0 ? (results.failFreq[f] / results.total * 100).toFixed(0) : 0;
                      const color = pct > 50 ? '#f87171' : pct > 25 ? '#fbbf24' : '#86efac';
                      return (
                        <div key={f} className="opt-fail-row">
                          <span className="opt-fail-code" style={{ color }}>{f}</span>
                          <div className="opt-fail-track">
                            <div className="opt-fail-fill" style={{ width: `${pct}%`, background: color }} />
                          </div>
                          <span className="opt-fail-pct" style={{ color: 'var(--text-d)' }}>{pct}% of runs</span>
                        </div>
                      );
                    })}
                </div>
              )}

              {/* ─── PASSING combos section ─── */}
              {(() => {
                const filtered = results.topPassing.filter(starMatch);
                const total    = results.topPassing.length;
                const filterLabel = minStars > 0 ? ` (≥ ${minStars}★)` : '';
                return (
                  <>
                    <div className="opt-results-header">
                      <div className="opt-results-title opt-results-title--pass">
                        ⭐ Passing Combos — {filtered.length}/{total} shown
                        {minStars > 0 && <span className="opt-results-filter-note">{filterLabel}</span>}
                      </div>
                    </div>
                    {filtered.length > 0 ? (
                      <div className="opt-result-grid">
                        {filtered.map((r, i) => (
                          <ComboCard key={i} result={r} rank={i} isNearMiss={false} isNumGame={isNumGame}
                            bonusNum={pickBonusForCombo(i)} bonusLabel={bonusLabel} bonusColor={bonusColor} />
                        ))}
                      </div>
                    ) : (
                      <div className="opt-no-pass">
                        {total > 0
                          ? `All ${total} passing combos are rated lower than ${minStars}★. Click All to see them.`
                          : '⚠️ No combos passed ALL filters. Showing near-misses below. Try turning off SUM or ODD filters.'}
                      </div>
                    )}
                  </>
                );
              })()}

              {/* ─── NEAR-MISS combos section ─── */}
              {(() => {
                const nmFiltered = results.topNearMiss.filter(starMatch);
                const nmTotal    = results.topNearMiss.length;
                const nmFilterLabel = minStars > 0 ? ` (≥ ${minStars}★)` : '';
                return nmTotal > 0 && (
                  <>
                    <div className="opt-results-header">
                      <div className="opt-results-title opt-results-title--near">
                        🔍 Near-Miss — {nmFiltered.length}/{nmTotal} shown
                        {minStars > 0 && <span className="opt-results-filter-note">{nmFilterLabel}</span>}
                      </div>
                    </div>
                    {nmFiltered.length > 0 ? (
                      <div className="opt-result-grid">
                        {nmFiltered.map((r, i) => <ComboCard key={i} result={r} rank={i} isNearMiss isNumGame={isNumGame}
                          bonusNum={pickBonusForCombo(i)} bonusLabel={bonusLabel} bonusColor={bonusColor} />)}
                      </div>
                    ) : (
                      <div className="opt-no-pass" style={{ color: '#94a3b8' }}>
                        All near-miss combos are rated lower than {minStars}★. Click All to see them.
                      </div>
                    )}
                  </>
                );
              })()}

              {/* Tips */}
              <div className="opt-tips">
                <strong>💡 Optimizer Tips ({gameLabel} · {allHist.length} real draws):</strong><br />
                • <strong style={{ color: '#4ade80' }}>⭐⭐⭐⭐⭐ Passing</strong> combos passed all filters — highest mathematical confidence.<br />
                • <strong style={{ color: '#fbbf24' }}>Near-Miss</strong> combos show 1-2 fail codes — use to understand active filters.<br />
                • <strong>⭐ Star rating:</strong> ⭐⭐⭐⭐⭐=0 fails+≥50% WF · ⭐⭐⭐⭐=0 fails+≥30% · ⭐⭐⭐=0 fails · ⭐⭐=1 fail OR 2 fails+≥30% WF · ⭐=2+ fails low WF.<br />
                • Use the <strong>⭐ Star Filter bar</strong> (Stage 2): <em>min 2★</em> shows ≥2★ · <em>min 3★</em> shows ≥3★ · <em>min 4★</em> shows ≥4★ · <em>top 5★</em> shows only 5★ · <em>All</em> shows everything.<br />
                • <strong>Ball colors</strong>: {isNumGame ? '1-10=red · 11-20=blue · 21-30=green · 31-40=orange · 41-50=purple · 51+=pink' : '0=silver · 1=red · 2=blue · 3=green · 4=orange · 5=purple · 6=teal · 7=pink · 8=gold · 9=crimson'}.<br />
                • All 5,000 iterations are scored against your <strong>actual {gameLabel} draw history</strong>.<br />
                • Play ONLY when STATUS shows <strong style={{ color: '#4ade80' }}>Normal</strong>. Stop when <strong style={{ color: '#f87171' }}>Unstable</strong>.
              </div>

              {/* Next Draw Predictions panel */}
              {results.pred5 && results.pred5.length > 0 && nextDraw && (() => {
                // Apply dedicated prediction star filter (predMinStars) — independent from global starFilter.
                const allPred = [...results.pred5].sort((a, b) => getStarCount(b) - getStarCount(a) || b.score - a.score);
                const activePredFilter = predMinStars;
                const filteredPred = activePredFilter === 0 ? allPred : allPred.filter(p => getStarCount(p) >= activePredFilter);
                const rankEmojis   = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
                // Compute star distribution for the filter bar badges
                const predStarDist = {};
                allPred.forEach(p => { const s = getStarCount(p); predStarDist[s] = (predStarDist[s] || 0) + 1; });

                // ── Print predictions as a clean slip ──
                const handlePrintPredictions = () => {
                  if (filteredPred.length === 0) return;
                  const drawMode = drawTypeStr === 'evening' ? '🌙 Evening' : '☀️ Midday';
                  const filterNote = activePredFilter > 0 ? `⭐ ≥${activePredFilter}★ filter` : '⭐ All stars';
                  const totalDraws = results.allHist?.length || allHist.length;

                  const rows = filteredPred.map((p, i) => {
                    const displayCombo = isNumGame ? [...p.combo].sort((a, b) => a - b) : p.combo;
                    const nums = displayCombo.map(num => `<span class="pn-ball">${isNumGame ? String(num).padStart(2,'0') : num}</span>`).join('');
                    const bonus = bonusPool > 0 && pickBonusForCombo(i) != null
                      ? `<span class="pn-ball pn-ball--bonus">${String(pickBonusForCombo(i)).padStart(2,'0')}</span>` : '';
                    const stars = '★'.repeat(getStarCount(p)) + '<span style="opacity:.3">★</span>'.repeat(5 - getStarCount(p));
                    const tag = p.fails.length === 0
                      ? '<span class="pn-pass">✅ PASS</span>'
                      : `<span class="pn-fail">⚠️ ${p.fails.slice(0,2).join(', ')}</span>`;
                    const wf = (p.walkForwardHits !== undefined && p.walkForwardTotal > 0)
                      ? `<span class="pn-wf">📈 ${p.walkForwardHits}/${p.walkForwardTotal}</span>` : '';
                    return `<tr class="${p.fails.length === 0 ? 'pn-row-pass' : 'pn-row-near'}">
                      <td class="pn-num">${rankEmojis[i] || (i + 1)}</td>
                      <td class="pn-balls">${nums}${bonus}</td>
                      <td class="pn-stars">${stars}</td>
                      <td class="pn-tag">${tag}</td>
                      <td class="pn-wf-cell">${wf}</td>
                    </tr>`;
                  }).join('');

                  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${gameLabel} — Next Draw Predictions</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         background: #fff; color: #111; padding: 24px; font-size: 13px; }
  .pn-header { border-bottom: 2px solid #1e3a8a; padding-bottom: 10px; margin-bottom: 14px; }
  .pn-title  { font-size: 20px; font-weight: 800; color: #1e3a8a; letter-spacing: .5px; }
  .pn-meta   { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 6px;
               font-size: 11px; color: #475569; font-weight: 600; }
  .pn-meta span { background: #f1f5f9; border: 1px solid #cbd5e1;
                  border-radius: 10px; padding: 2px 10px; }
  .pn-draw-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
                  gap: 8px; margin: 12px 0; }
  .pn-draw-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;
                  padding: 8px 12px; text-align: center; }
  .pn-draw-card__title { font-size: 10px; color: #64748b; text-transform: uppercase;
                         letter-spacing: .5px; margin-bottom: 2px; }
  .pn-draw-card__val { font-size: 14px; font-weight: 700; color: #1e293b; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; }
  th    { background: #1e3a8a; color: #fff; font-size: 10px; text-transform: uppercase;
          letter-spacing: .5px; padding: 6px 10px; text-align: left; }
  th:first-child { width: 36px; text-align: center; }
  tr    { border-bottom: 1px solid #e2e8f0; }
  .pn-row-pass { background: #f0fdf4; }
  .pn-row-near { background: #fffbeb; }
  .pn-num  { text-align: center; font-weight: 800; color: #1e3a8a;
             font-size: 14px; padding: 8px 4px; width: 36px; }
  .pn-balls { padding: 8px 10px; }
  .pn-ball  { display: inline-block; width: 32px; height: 32px; line-height: 32px;
              text-align: center; border-radius: 50%; background: #1e3a8a; color: #fff;
              font-weight: 800; font-size: 12px; margin-right: 4px; }
  .pn-ball--bonus { background: #dc2626; }
  .pn-stars { color: #f59e0b; font-size: 14px; padding: 8px 10px; letter-spacing: 1px; white-space: nowrap; }
  .pn-tag   { padding: 8px 10px; font-size: 11px; font-weight: 700; white-space: nowrap; }
  .pn-pass  { color: #16a34a; }
  .pn-fail  { color: #b45309; }
  .pn-wf-cell { padding: 8px 10px; font-size: 10px; color: #3b82f6; white-space: nowrap; }
  .pn-footer { margin-top: 16px; font-size: 10px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 8px; line-height: 1.7; }
  @media print { body { padding: 12px; } }
</style></head><body>
<div class="pn-header">
  <div class="pn-title">🎯 ${gameLabel} — Next Draw Predictions</div>
  <div class="pn-meta">
    <span>📅 ${nextDraw.dateStr}</span>
    <span>⏰ ${nextDraw.timeEt}</span>
    <span>${drawMode}</span>
    <span>${filterNote}</span>
    <span>📊 ${totalDraws} draws analyzed</span>
    <span>📍 ${state}</span>
  </div>
</div>
<div class="pn-draw-grid">
  <div class="pn-draw-card"><div class="pn-draw-card__title">Next Draw</div><div class="pn-draw-card__val">${nextDraw.dateStr}</div></div>
  <div class="pn-draw-card"><div class="pn-draw-card__title">Time (ET)</div><div class="pn-draw-card__val">${nextDraw.timeEt}</div></div>
  <div class="pn-draw-card"><div class="pn-draw-card__title">Draw Days</div><div class="pn-draw-card__val">${nextDraw.days || 'Daily'}</div></div>
  <div class="pn-draw-card"><div class="pn-draw-card__title">Walk-Forward</div><div class="pn-draw-card__val">${wfWindow} draws tested</div></div>
</div>
<table>
  <thead><tr>
    <th>#</th><th>Numbers</th><th>Stars</th><th>Status</th><th>WF</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>
<div class="pn-footer">
  ⚠️ Statistical picks for entertainment only — not a guarantee of winning. Please play responsibly.<br />
  🔬 All 5,000 iterations scored against ${totalDraws} actual ${gameLabel} draws.<br />
  📈 Walk-forward backtest: ${wfWindow} real draws &middot; ⭐ Star rating includes real-draw hit rate.<br />
  Generated: ${new Date().toLocaleString('en-US',{timeZone:'America/New_York'})} ET
</div>
</body></html>`;

                  const w = window.open('', '_blank', 'width=750,height=650');
                  if (!w) return;
                  w.document.write(html);
                  w.document.close();
                  w.focus();
                  setTimeout(() => { w.print(); }, 400);
                };

                // ── Copy predictions to clipboard ──
                const handleCopyPredictions = () => {
                  if (filteredPred.length === 0) return;
                  const totalDraws = results.allHist?.length || allHist.length;
                  const header = `🎯 ${gameLabel} — Next Draw Predictions`;
                  const dateInfo = `📅 ${nextDraw.dateStr} · ⏰ ${nextDraw.timeEt} · ${drawTypeStr === 'evening' ? '🌙 Evening' : '☀️ Midday'}`;
                  const statsInfo = `📊 ${totalDraws} draws analyzed · Walk-forward: ${wfWindow} draws · 📍 ${state}`;
                  const filterInfo = activePredFilter > 0 ? `⭐ Filter: ≥${activePredFilter}★` : '⭐ Filter: All';
                  const lines = filteredPred.map((p, i) => {
                    const displayCombo = isNumGame ? [...p.combo].sort((a, b) => a - b) : p.combo;
                    const nums = displayCombo.join(' - ');
                    const bonus = bonusPool > 0 && pickBonusForCombo(i) != null ? ` + ${bonusLabel}: ${pickBonusForCombo(i)}` : '';
                    const stars = '★'.repeat(getStarCount(p)) + '☆'.repeat(5 - getStarCount(p));
                    const pass = p.fails.length === 0 ? '✅ PASS' : `⚠️ ${p.fails.join(',')}`;
                    const wf = (p.walkForwardHits !== undefined && p.walkForwardTotal > 0)
                      ? ` · 📈 ${p.walkForwardHits}/${p.walkForwardTotal}` : '';
                    return `${rankEmojis[i] || (i + 1)} ${nums}${bonus}  ${stars}  ${pass}${wf}`;
                  }).join('\n');
                  const text = [header, dateInfo, statsInfo, filterInfo, '', lines, '', '⚠️ Statistical picks only — play responsibly.'].join('\n');
                  navigator.clipboard.writeText(text);
                };

                return (
                <div className="opt-next-draw">
                  <div className="opt-next-draw__title">
                    📅 Next Draw Predictions — {gameLabel} {drawTypeStr === 'evening' ? 'Evening' : 'Midday'}
                    &nbsp;·&nbsp;
                    <span style={{ fontSize: '.75rem', color: '#93c5fd' }}>
                      Walk-forward backtested on {wfWindow} actual {gameLabel} draws
                    </span>
                  </div>
                  <div className="opt-next-draw__grid">
                    <div className="opt-an-card">
                      <div className="opt-an-title">📆 Next Draw Date</div>
                      <div className="opt-an-val" style={{ color: '#34d399' }}>{nextDraw.dateStr}</div>
                    </div>
                    <div className="opt-an-card">
                      <div className="opt-an-title">⏰ Draw Times (USA)</div>
                      <div className="opt-an-val" style={{ fontSize: '.68rem', lineHeight: 1.7 }}>
                        {nextDraw.timeEt} &nbsp;|&nbsp; {nextDraw.timesCt}<br />
                        {nextDraw.timesMt} &nbsp;|&nbsp; {nextDraw.timesPt}
                      </div>
                    </div>
                    <div className="opt-an-card">
                      <div className="opt-an-title">📅 Draw Days</div>
                      <div className="opt-an-val">{nextDraw.days || 'Daily'}</div>
                    </div>
                    <div className="opt-an-card">
                      <div className="opt-an-title">🗺️ States</div>
                      <div className="opt-an-val" style={{ fontSize: '.68rem' }}>{(nextDraw.states || []).join(', ')}</div>
                    </div>
                  </div>
                  {/* ── Dedicated prediction star filter ── */}
                  <div className="opt-pred-star-filter">
                    <span className="opt-pred-star-filter__label">Filter predictions:</span>
                    {[
                      { v: 0, label: 'All' },
                      { v: 2, label: '2★+' },
                      { v: 3, label: '3★+' },
                      { v: 4, label: '4★+' },
                      { v: 5, label: '5★' },
                    ].map(o => {
                      const count = o.v === 0 ? allPred.length : allPred.filter(p => getStarCount(p) >= o.v).length;
                      return (
                        <button
                          key={o.v}
                          className={`opt-pred-star-btn${activePredFilter === o.v ? ' opt-pred-star-btn--active' : ''}${count === 0 && o.v > 0 ? ' opt-pred-star-btn--empty' : ''}`}
                          onClick={() => setPredMinStars(o.v)}
                          title={o.v === 0 ? 'Show all predictions' : `Show only predictions rated ${o.v}★ or higher`}
                        >
                          {o.label}
                          <span className="opt-pred-star-btn__count">{count}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="opt-pred-list-title">
                    🎯 {filteredPred.length}/{allPred.length} Predicted Lines — sorted by ⭐ highest first
                    {activePredFilter > 0 && (
                      <span style={{ fontSize: '.72rem', color: '#fbbf24', marginLeft: 6 }}>
                        · ⭐ filter: ≥{activePredFilter}★ only
                      </span>
                    )}
                    &nbsp;·&nbsp;
                    <span style={{ fontSize: '.72rem', color: '#94a3b8' }}>
                      {results.allHist?.length || allHist.length} {gameLabel} draws
                    </span>
                  </div>
                  {/* ── Print / Copy buttons for predictions ── */}
                  {filteredPred.length > 0 && (
                    <div className="opt-pred-actions">
                      <button className="opt-pred-action-btn opt-pred-action-btn--print" onClick={handlePrintPredictions} title="Print predictions as a clean slip">
                        🖨️ Print Predictions
                      </button>
                      <button className="opt-pred-action-btn opt-pred-action-btn--copy" onClick={handleCopyPredictions} title="Copy predictions to clipboard">
                        📋 Copy
                      </button>
                    </div>
                  )}
                  {filteredPred.length === 0 ? (
                    <div className="opt-no-pass" style={{ marginTop: 8 }}>
                      No predicted lines meet the ≥{activePredFilter}★ filter.
                      <button className="opt-pred-star-reset" onClick={() => setPredMinStars(0)}>Show All</button>
                    </div>
                  ) : (
                    filteredPred.map((p, i) => {
                      const starCount = getStarCount(p);
                      return (
                        <div key={i} className="opt-pred-row">
                          <span className="opt-pred-rank">{rankEmojis[i] || `${i + 1}`}</span>
                          <div className="opt-pred-balls">
                            {p.combo.map((n, j) => <Ball key={j} num={n} isNumGame={isNumGame} />)}
                          </div>
                          <StarBar count={starCount} />
                          <span className="opt-pred-tag">
                            {p.fails.length === 0
                              ? <span className="opt-tag opt-tag--pass">✅ PASS</span>
                              : p.fails.slice(0, 2).map(f => <span key={f} className="opt-tag opt-tag--fail">❌{f}</span>)
                            }
                          </span>
                          {p.walkForwardHits !== undefined && p.walkForwardTotal > 0 && (
                            <span className="opt-pred-wf" style={{ fontSize: '.65rem', color: '#93c5fd', marginLeft: 'auto' }}>
                              📈 {p.walkForwardHits}/{p.walkForwardTotal}
                            </span>
                          )}
                        </div>
                      );
                    })
                  )}
                  <div className="opt-next-draw__disclaimer">
                    ⚠️ Predictions are statistical — not a guarantee of winning.<br />
                    🔬 All 5,000 iterations scored against {results.allHist?.length || allHist.length} actual {gameLabel} draws.<br />
                    📈 Walk-forward backtest used last {wfWindow} draws · ⭐ Star rating accounts for real-draw hit rate.<br />
                    🕐 Draw times shown in ET, CT, MT, PT — check your state lottery for exact schedule.
                  </div>
                </div>
                );
              })()}
            </>
          )}

          {/* Fail code reference */}
          <details className="opt-fail-ref">
            <summary>📖 Fail Code Reference (click to expand)</summary>
            <div className="opt-fail-codes">
              <span>SUM — sum outside 85% range</span>
              <span>SAM — same sum as last 5 unique draws</span>
              <span>ODD — odd/even pattern mismatch</span>
              <span>CON — too many consecutive digits</span>
              <span>HCC — H/C/P/L pattern repeated ≥30% in last 26</span>
              <span>REP — too many digits repeated from last draw</span>
              <span>FRQ — missing top-frequency digit</span>
              <span>PAT — same sorted pattern as prev 2 unique draws</span>
            </div>
          </details>
        </>
      )}

    </div>
  );
}
