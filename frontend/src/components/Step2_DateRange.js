import React from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { motion } from 'framer-motion';

/* Shared popper modifiers — render in fixed position so it escapes overflow:hidden parents */
const POPPER_PROPS = {
  strategy: 'fixed',
  modifiers: [{ name: 'offset', options: { offset: [0, 8] } }],
};

const RANGE_SHORTCUTS = [
  { label: '30d',   days: 30,  tip: 'Last 30 days' },
  { label: '90d',   days: 90,  tip: 'Last 90 days' },
  { label: '6 mo',  days: 180, tip: 'Last 6 months' },
  { label: '1 yr',  days: 365, tip: 'Last 1 year' },
  { label: '2 yr',  days: 730, tip: 'Last 2 years' },
  { label: '5 yr',  days: 1825, tip: 'Last 5 years' },
];

function diffDays(from, to) {
  if (!from || !to) return 0;
  return Math.max(0, Math.ceil((to - from) / 86400000));
}

function fmtDateDisplay(d) {
  if (!d) return '—';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/* ═══════════════════════════════════════
   Step 2: Date Range
═══════════════════════════════════════ */
export default function Step2_DateRange({
  fromDate,
  setFromDate,
  toDate,
  setToDate,
  selectedLotteries,
  disabled,
}) {
  const dayRange = diffDays(fromDate, toDate);
  const estDraws = Math.round(dayRange / 3.5 * (selectedLotteries?.length || 1));

  const setRange = (days) => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days);
    setFromDate(from);
    setToDate(to);
  };

  /* Detect active shortcut */
  const activeShortcut = RANGE_SHORTCUTS.find(r => {
    const expected = new Date();
    expected.setDate(expected.getDate() - r.days);
    return Math.abs(expected - fromDate) < 86400000 * 1.5;
  });

  return (
    <div>
      <div className="step-panel__header">
        <div className="step-panel__icon" style={{ fontSize: 26 }}>📅</div>
        <div>
          <div className="step-panel__title">Set Date Range</div>
          <div className="step-panel__sub">
            {disabled
              ? 'Complete Step 1 to unlock date selection'
              : 'Choose the range of lottery draws to extract'}
          </div>
        </div>
      </div>

      {/* ── Quick shortcuts ── */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.6px', textTransform: 'uppercase', color: 'var(--text-d)', marginBottom: 10 }}>
          Quick ranges
        </div>
        <div className="range-shortcuts">
          {RANGE_SHORTCUTS.map(r => (
            <button
              key={r.label}
              className={`range-btn ${activeShortcut?.days === r.days ? 'is-active' : ''}`}
              onClick={() => setRange(r.days)}
              disabled={disabled}
              title={r.tip}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Date pickers ── */}
      <div className="date-range-grid">
        <div className="date-field">
          <label className="date-label">From Date</label>
          <DatePicker
            selected={fromDate}
            onChange={d => setFromDate(d)}
            selectsStart
            startDate={fromDate}
            endDate={toDate}
            maxDate={toDate}
            dateFormat="yyyy-MM-dd"
            className="date-inp"
            disabled={disabled}
            showYearDropdown
            showMonthDropdown
            scrollableYearDropdown
            yearDropdownItemNumber={30}
            placeholderText="Start date…"
            popperProps={POPPER_PROPS}
            popperPlacement="bottom-start"
          />
        </div>

        <div className="date-arrow-col">
          <span style={{ fontSize: 18 }}>→</span>
        </div>

        <div className="date-field">
          <label className="date-label">To Date</label>
          <DatePicker
            selected={toDate}
            onChange={d => setToDate(d)}
            selectsEnd
            startDate={fromDate}
            endDate={toDate}
            minDate={fromDate}
            maxDate={new Date()}
            dateFormat="yyyy-MM-dd"
            className="date-inp"
            disabled={disabled}
            showYearDropdown
            showMonthDropdown
            scrollableYearDropdown
            yearDropdownItemNumber={30}
            placeholderText="End date…"
            popperProps={POPPER_PROPS}
            popperPlacement="bottom-start"
          />
        </div>
      </div>

      {/* ── Range summary ── */}
      {!disabled && dayRange > 0 && (
        <motion.div
          className="range-summary"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          key={dayRange}
        >
          <span>📊</span>
          <span>
            <strong style={{ color: 'var(--amber-l)' }}>{dayRange.toLocaleString()}</strong> day range
            &nbsp;·&nbsp;
            {fmtDateDisplay(fromDate)} → {fmtDateDisplay(toDate)}
            {selectedLotteries?.length > 0 && (
              <>
                &nbsp;·&nbsp;
                ~<strong style={{ color: 'var(--amber-l)' }}>{estDraws.toLocaleString()}</strong> estimated draws
              </>
            )}
          </span>
        </motion.div>
      )}

      {/* ── Data availability tip ── */}
      <div style={{
        marginTop: 20,
        padding: '14px 16px',
        borderRadius: 12,
        background: 'rgba(124,58,237,0.06)',
        border: '1px solid rgba(124,58,237,0.12)',
        fontSize: 12,
        color: 'var(--text-m)',
        lineHeight: 1.7,
      }}>
        <div style={{ fontWeight: 600, color: 'var(--purple-l)', marginBottom: 6 }}>💡 Data availability guide</div>
        <div>🔴 <strong>Powerball</strong> & <strong>Mega Millions</strong> — from 2010 (NY Open Data)</div>
        <div>🗽 <strong>NY state lotteries</strong> — from 2010 (NY Open Data)</div>
        <div>🌐 <strong>Most state lotteries</strong> — from ~2015 (lotto.net)</div>
        <div>📅 Max allowed range: <strong>5 years</strong> per request</div>
      </div>
    </div>
  );
}
