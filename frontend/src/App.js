import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import Select from 'react-select';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import './App.css';
import StepWizard from './components/StepWizard';
import ResultsTable from './components/ResultsTable';
import ApiPanel from './components/ApiPanel';
import LottoBall from './components/LottoBall';

const API = '';  // relative — served from same origin

/* ─── helpers ─── */
const fmtDate = d => (d instanceof Date ? d.toISOString().split('T')[0] : d);
const oneYearAgo = () => { const d = new Date(); d.setFullYear(d.getFullYear() - 1); return d; };

/* ─── react-select styles factory ─── */
const mkSelectStyles = (accent = '#7c3aed') => ({
  control: (b, s) => ({
    ...b,
    background: 'rgba(255,255,255,0.04)',
    border: `1px solid ${s.isFocused ? accent : 'rgba(255,255,255,0.09)'}`,
    borderRadius: 10,
    boxShadow: s.isFocused ? `0 0 0 3px ${accent}30` : 'none',
    minHeight: 50,
    cursor: 'pointer',
    transition: 'all 0.2s',
    '&:hover': { borderColor: accent },
  }),
  menu: b => ({
    ...b,
    background: '#10102a',
    border: '1px solid rgba(124,58,237,0.25)',
    borderRadius: 14,
    boxShadow: '0 20px 60px rgba(0,0,0,0.7)',
    zIndex: 999,
    overflow: 'hidden',
  }),
  option: (b, s) => ({
    ...b,
    background: s.isSelected ? accent : s.isFocused ? `${accent}28` : 'transparent',
    color: '#fff',
    cursor: 'pointer',
    transition: 'background 0.15s',
    padding: '10px 14px',
  }),
  singleValue: b => ({ ...b, color: '#fff' }),
  multiValue: b => ({ ...b, background: `${accent}30`, borderRadius: 8, margin: '2px 4px' }),
  multiValueLabel: b => ({ ...b, color: '#fff', padding: '2px 6px' }),
  multiValueRemove: b => ({
    ...b, color: 'rgba(255,255,255,0.7)', borderRadius: '0 8px 8px 0',
    '&:hover': { background: accent, color: '#fff' }
  }),
  placeholder: b => ({ ...b, color: 'rgba(255,255,255,0.3)' }),
  input: b => ({ ...b, color: '#fff' }),
  groupHeading: b => ({
    ...b, color: '#a78bfa', fontSize: 11, fontWeight: 700,
    letterSpacing: 1, textTransform: 'uppercase', padding: '8px 14px 4px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  }),
  group: b => ({ ...b, paddingTop: 0 }),
  indicatorSeparator: () => ({ display: 'none' }),
  dropdownIndicator: b => ({ ...b, color: 'rgba(255,255,255,0.35)', padding: '0 10px' }),
  clearIndicator: b => ({ ...b, color: 'rgba(255,255,255,0.35)' }),
  valueContainer: b => ({ ...b, padding: '4px 14px', gap: 4 }),
  noOptionsMessage: b => ({ ...b, color: 'rgba(255,255,255,0.4)', fontSize: 13 }),
});

/* ─── Hero demo balls ─── */
const DEMO_BALLS = [
  { n: '07', t: 'white' }, { n: '14', t: 'white' }, { n: '32', t: 'white' },
  { n: '45', t: 'white' }, { n: '61', t: 'white' }, { n: '20', t: 'powerball' },
];

/* ─── Stat Card ─── */
function StatCard({ icon, value, label }) {
  return (
    <div className="stat-card">
      <span className="stat-card__icon">{icon}</span>
      <strong className="stat-card__value">{value}</strong>
      <span className="stat-card__label">{label}</span>
    </div>
  );
}

/* ─── Feature Pill ─── */
function FeaturePill({ icon, text }) {
  return (
    <span className="feature-pill">
      <span>{icon}</span>{text}
    </span>
  );
}

/* ─── Toast ─── */
function Toast({ msg, type, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4500);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div className={`toast toast--${type}`}>
      <span>{msg}</span>
      <button className="toast__close" onClick={onClose}>×</button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════ */
export default function App() {
  /* ── state ── */
  const [step, setStep] = useState(1);
  const [allStates, setAllStates] = useState([]);
  const [selectedState, setSelectedState] = useState(null);
  const [availableLotteries, setAvailableLotteries] = useState([]);
  const [selectedLotteries, setSelectedLotteries] = useState([]);
  const [fromDate, setFromDate] = useState(oneYearAgo);
  const [toDate, setToDate] = useState(() => new Date());
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [csvLoading, setCsvLoading] = useState(false);
  const [error, setError] = useState(null);
  const [detecting, setDetecting] = useState(true);
  const [detectedState, setDetectedState] = useState(null);
  const [activeTab, setActiveTab] = useState('results');
  const [toasts, setToasts] = useState([]);
  const resultsRef = useRef(null);

  /* ── helpers ── */
  const addToast = useCallback((msg, type = 'success') => {
    const id = Date.now();
    setToasts(t => [...t, { id, msg, type }]);
  }, []);
  const removeToast = useCallback(id => setToasts(t => t.filter(x => x.id !== id)), []);

  /* ── init: load states + detect location ── */
  useEffect(() => {
    axios.get(`${API}/lotteries/all-states`).then(r => {
      setAllStates(r.data.states.filter(s => s.lottery_count > 0));
    }).catch(() => {});

    axios.get(`${API}/lotteries/detect-location`).then(r => {
      const d = r.data;
      if (d.detected_state_code) {
        const opt = {
          value: d.detected_state_code,
          label: `${d.detected_state_name} (${d.detected_state_code})`,
        };
        setDetectedState(opt);
        setSelectedState(opt);
        setAvailableLotteries(d.lotteries || []);
        if ((d.lotteries || []).length > 0) setStep(2);
      }
    }).catch(() => {}).finally(() => setDetecting(false));
  }, []);

  /* ── state change ── */
  const handleStateChange = async (opt) => {
    setSelectedState(opt);
    setSelectedLotteries([]);
    setResults(null);
    setError(null);
    if (!opt) { setAvailableLotteries([]); setStep(1); return; }
    try {
      const r = await axios.get(`${API}/lotteries/by-state/${opt.value}`);
      setAvailableLotteries(r.data.lotteries || []);
      setStep(2);
    } catch {
      setError(`Could not load lotteries for ${opt.label}`);
    }
  };

  /* ── lottery change ── */
  const handleLotteryChange = (sel) => {
    setSelectedLotteries(sel || []);
    setStep((sel || []).length > 0 ? 3 : 2);
    setResults(null);
  };

  /* ── extract ── */
  const handleExtract = async () => {
    if (!selectedState || !selectedLotteries.length) return;
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const r = await axios.post(`${API}/extract`, {
        state_code: selectedState.value,
        lottery_ids: selectedLotteries.map(l => l.value),
        from_date: fmtDate(fromDate),
        to_date: fmtDate(toDate),
      });
      setResults(r.data);
      setStep(4);
      setActiveTab('results');
      addToast(`✓ Found ${r.data.total_records} real lottery draws`, 'success');
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
    } catch (e) {
      const msg = e.response?.data?.detail || e.message;
      setError(typeof msg === 'string' ? msg : JSON.stringify(msg));
      addToast('⚠️ Extraction failed — see details below', 'error');
    } finally { setLoading(false); }
  };

  /* ── CSV download ── */
  const handleCSV = async () => {
    if (!selectedState || !selectedLotteries.length) return;
    setCsvLoading(true);
    const params = new URLSearchParams({
      state_code: selectedState.value,
      lottery_ids: selectedLotteries.map(l => l.value).join(','),
      from_date: fmtDate(fromDate),
      to_date: fmtDate(toDate),
    });
    try {
      const r = await axios.get(`${API}/extract/csv?${params}`, { responseType: 'blob' });
      const cd = r.headers['content-disposition'] || '';
      const filename = cd.match(/filename="?([^"]+)"?/)?.[1] || 'lotto_results.csv';
      const url = URL.createObjectURL(new Blob([r.data], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
      addToast(`📥 ${filename} saved`, 'success');
    } catch (e) {
      const msg = e.response?.status === 404
        ? 'No data found for that selection and range'
        : (e.message || 'Download failed');
      addToast(`⚠️ ${msg}`, 'error');
    } finally { setCsvLoading(false); }
  };

  /* ── Select options ── */
  const stateOptions = allStates.map(s => ({
    value: s.state_code,
    label: `${s.state_name} (${s.state_code})`,
  }));

  const lotteryOptions = [
    {
      label: '🌐 Multi-State',
      options: availableLotteries
        .filter(l => l.type === 'multistate')
        .map(l => ({ value: l.id, label: l.name, type: l.type })),
    },
    {
      label: '🏛️ State-Specific',
      options: availableLotteries
        .filter(l => l.type === 'state')
        .map(l => ({ value: l.id, label: l.name, type: l.type })),
    },
  ].filter(g => g.options.length > 0);

  /* ── quick-select helpers ── */
  const selectAllMultistate = () => {
    const ms = availableLotteries
      .filter(l => l.type === 'multistate')
      .map(l => ({ value: l.id, label: l.name, type: l.type }));
    handleLotteryChange(ms);
  };
  const selectAll = () => {
    handleLotteryChange(availableLotteries.map(l => ({ value: l.id, label: l.name, type: l.type })));
  };
  const clearLotteries = () => handleLotteryChange([]);

  /* ── range shortcuts ── */
  const setRange = (days) => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days);
    setFromDate(from);
    setToDate(to);
  };

  const dayRange = Math.max(0, Math.ceil((toDate - fromDate) / 86400000));
  const estDraws = Math.round(dayRange / 3.5 * selectedLotteries.length);
  const canExtract = !!(selectedState && selectedLotteries.length > 0);
  const lotteryCount = allStates.find(s => s.state_code === selectedState?.value)?.lottery_count || 0;

  return (
    <div className="app">
      {/* ── Toast Stack ── */}
      <div className="toast-stack">
        {toasts.map(t => (
          <Toast key={t.id} msg={t.msg} type={t.type} onClose={() => removeToast(t.id)} />
        ))}
      </div>

      {/* ══════════ HEADER ══════════ */}
      <header className="site-header">
        <div className="site-header__inner">
          <div className="site-header__brand">
            <span className="brand-logo">🎰</span>
            <div>
              <h1 className="brand-name">Lotto Extraction</h1>
              <p className="brand-tagline">Real lottery results · No fake data, ever</p>
            </div>
          </div>
          <nav className="site-header__nav">
            <span className="nav-pill">
              <span className="nav-pill-dot" />
              Live Data
            </span>
            <a className="nav-link" href={`${window.location.origin}/docs`} target="_blank" rel="noreferrer">
              📖 API Docs
            </a>
            <a className="nav-link nav-link--amber" href={`${window.location.origin}/redoc`} target="_blank" rel="noreferrer">
              📋 ReDoc
            </a>
          </nav>
        </div>
      </header>

      {/* ══════════ HERO ══════════ */}
      <section className="hero">
        {/* Floating decoration orbs */}
        <div className="hero__orb hero__orb--1" aria-hidden="true" />
        <div className="hero__orb hero__orb--2" aria-hidden="true" />

        <div className="hero__inner">
          <div className="hero__badge">
            🛡️ &nbsp;Official sources only · 46 US states
          </div>

          <h2 className="hero__title">
            Extract <span className="gradient-text">Real Lottery</span><br />Results Instantly
          </h2>

          <p className="hero__sub">
            Powered by lotto.net archive and NY Open Data API.
            Every number is a real historical draw — zero randomness, zero fakes.
          </p>

          {/* Animated lottery balls */}
          <div className="hero__drum">
            {DEMO_BALLS.map((b, i) => (
              <LottoBall key={i} number={b.n} type={b.t} size="lg" animate />
            ))}
          </div>

          {/* Feature pills */}
          <div className="hero__pills">
            <FeaturePill icon="📍" text="Location-aware" />
            <FeaturePill icon="🎟️" text="46 US states" />
            <FeaturePill icon="📅" text="10+ years of data" />
            <FeaturePill icon="📥" text="CSV export" />
            <FeaturePill icon="🔌" text="REST API included" />
            <FeaturePill icon="🔒" text="Real data only" />
          </div>
        </div>
      </section>

      {/* ══════════ WIZARD + CARDS ══════════ */}
      <main className="main-content">
        <StepWizard currentStep={step} />

        <div className="cards-grid">

          {/* ─── Step 1: Choose State ─── */}
          <div className={`card ${step >= 1 ? 'card--active' : ''}`}>
            <div className="card__head">
              <div className="card__icon-wrap">📍</div>
              <div>
                <h2 className="card__title">Choose Your State</h2>
                {detecting ? (
                  <p className="card__sub card__sub--detecting">
                    <span className="spinner-sm" />
                    Detecting your location…
                  </p>
                ) : detectedState ? (
                  <p className="card__sub card__sub--detected">
                    ✅ Auto-detected: <strong>{detectedState.label}</strong>
                  </p>
                ) : (
                  <p className="card__sub">Search or pick any US state to begin</p>
                )}
              </div>
            </div>

            <div className="card__body">
              {!detecting && detectedState && selectedState?.value === detectedState?.value && (
                <div className="state-detected-banner">
                  <span>📍 Using your detected location: <strong>{detectedState.label}</strong></span>
                </div>
              )}

              <Select
                options={stateOptions}
                value={selectedState}
                onChange={handleStateChange}
                placeholder="🔍  Search by state name or abbreviation…"
                isClearable
                isSearchable
                styles={mkSelectStyles('#7c3aed')}
                noOptionsMessage={() => 'No states found'}
              />

              {selectedState && (
                <div className="state-info-row">
                  <span className="info-chip">
                    🎟️ {lotteryCount} {lotteryCount === 1 ? 'lottery' : 'lotteries'} available
                  </span>
                  <button
                    className="clear-link"
                    onClick={() => {
                      setSelectedState(null);
                      setAvailableLotteries([]);
                      setSelectedLotteries([]);
                      setStep(1);
                    }}
                  >
                    Clear ×
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* ─── Step 2: Select Lotteries ─── */}
          <div className={`card ${step >= 2 ? 'card--active' : 'card--locked'}`}>
            <div className="card__head">
              <div className="card__icon-wrap">🎟️</div>
              <div>
                <h2 className="card__title">Select Lotteries</h2>
                <p className="card__sub">
                  {step < 2
                    ? 'Complete step 1 first'
                    : `${availableLotteries.length} lotteries — pick one or more`}
                </p>
              </div>
            </div>

            <div className="card__body">
              {step >= 2 && availableLotteries.length > 0 && (
                <div className="quick-select-row">
                  <button className="qs-btn" onClick={selectAllMultistate}>
                    🌐 All Multi-State
                  </button>
                  <button className="qs-btn" onClick={selectAll}>
                    ✅ Select All
                  </button>
                  {selectedLotteries.length > 0 && (
                    <button className="qs-btn qs-btn--clear" onClick={clearLotteries}>
                      ✕ Clear
                    </button>
                  )}
                </div>
              )}

              <Select
                isMulti
                options={lotteryOptions}
                value={selectedLotteries}
                onChange={handleLotteryChange}
                isDisabled={step < 2}
                placeholder={step < 2 ? '← Select a state first' : '🔍  Search lotteries…'}
                closeMenuOnSelect={false}
                hideSelectedOptions={false}
                styles={mkSelectStyles('#f59e0b')}
                formatOptionLabel={opt => (
                  <div className="lottery-opt">
                    <span className="lottery-opt__icon">
                      {opt.type === 'multistate' ? '🌐' : '🏛️'}
                    </span>
                    <span className="lottery-opt__name">{opt.label}</span>
                    <span className={`type-badge type-badge--${opt.type}`}>
                      {opt.type}
                    </span>
                  </div>
                )}
              />

              {selectedLotteries.length > 0 && (
                <div className="selected-chips">
                  {selectedLotteries.map(l => (
                    <span key={l.value} className={`sel-chip sel-chip--${l.type}`}>
                      {l.type === 'multistate' ? '🌐' : '🏛️'} {l.label}
                      <button
                        className="sel-chip__x"
                        onClick={() => handleLotteryChange(selectedLotteries.filter(x => x.value !== l.value))}
                        title={`Remove ${l.label}`}
                      >×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ─── Step 3: Date Range ─── */}
          <div className={`card ${step >= 3 ? 'card--active' : 'card--locked'}`}>
            <div className="card__head">
              <div className="card__icon-wrap">📅</div>
              <div>
                <h2 className="card__title">Date Range</h2>
                <p className="card__sub">
                  {step < 3 ? 'Select lotteries first' : 'Filter by draw date'}
                </p>
              </div>
            </div>

            <div className="card__body">
              {/* Quick range shortcuts */}
              <div className="range-shortcuts">
                {[
                  { label: '30 days', days: 30 },
                  { label: '90 days', days: 90 },
                  { label: '6 months', days: 180 },
                  { label: '1 year', days: 365 },
                  { label: '2 years', days: 730 },
                ].map(r => (
                  <button
                    key={r.label}
                    className="range-btn"
                    onClick={() => setRange(r.days)}
                    disabled={step < 3}
                  >
                    {r.label}
                  </button>
                ))}
              </div>

              {/* Date pickers */}
              <div className="date-inputs">
                <div className="date-field">
                  <label className="date-label">From Date</label>
                  <DatePicker
                    selected={fromDate}
                    onChange={d => { setFromDate(d); if (step < 3) setStep(3); }}
                    selectsStart
                    startDate={fromDate}
                    endDate={toDate}
                    maxDate={toDate}
                    dateFormat="yyyy-MM-dd"
                    className="date-inp"
                    disabled={step < 3}
                    showYearDropdown
                    showMonthDropdown
                    scrollableYearDropdown
                    yearDropdownItemNumber={30}
                    placeholderText="Start date…"
                  />
                </div>

                <div className="date-arrow-col">
                  <div className="date-arrow">→</div>
                </div>

                <div className="date-field">
                  <label className="date-label">To Date</label>
                  <DatePicker
                    selected={toDate}
                    onChange={d => { setToDate(d); if (step < 3) setStep(3); }}
                    selectsEnd
                    startDate={fromDate}
                    endDate={toDate}
                    minDate={fromDate}
                    maxDate={new Date()}
                    dateFormat="yyyy-MM-dd"
                    className="date-inp"
                    disabled={step < 3}
                    showYearDropdown
                    showMonthDropdown
                    scrollableYearDropdown
                    yearDropdownItemNumber={30}
                    placeholderText="End date…"
                  />
                </div>
              </div>

              {step >= 3 && dayRange > 0 && (
                <div className="range-summary">
                  📊 <strong>{dayRange}</strong> day range
                  &nbsp;·&nbsp;
                  ~<strong>{estDraws}</strong> estimated draws
                </div>
              )}
            </div>
          </div>

          {/* ─── Step 4: Extract ─── */}
          <div className="card card--action">
            <div className="card__head">
              <div className="card__icon-wrap">🚀</div>
              <div>
                <h2 className="card__title">Extract Real Data</h2>
                <p className="card__sub">Scrape live from official lottery sources</p>
              </div>
            </div>

            <div className="card__body">
              {canExtract && (
                <div className="extract-summary">
                  <div className="extract-summary__item">
                    <span className="extract-summary__icon">📍</span>
                    <span className="extract-summary__val">{selectedState?.label}</span>
                  </div>
                  <div className="extract-summary__item">
                    <span className="extract-summary__icon">🎟️</span>
                    <span className="extract-summary__val">
                      {selectedLotteries.map(l => l.label).join(' · ')}
                    </span>
                  </div>
                  <div className="extract-summary__item">
                    <span className="extract-summary__icon">📅</span>
                    <span className="extract-summary__val">
                      {fmtDate(fromDate)} → {fmtDate(toDate)}
                    </span>
                  </div>
                </div>
              )}

              <div className="extract-btns">
                <button
                  className="btn btn--primary"
                  onClick={handleExtract}
                  disabled={loading || !canExtract}
                >
                  {loading ? (
                    <><span className="btn-spinner" /> Fetching real draws…</>
                  ) : (
                    '🔍 Extract Results'
                  )}
                </button>

                <button
                  className="btn btn--csv"
                  onClick={handleCSV}
                  disabled={csvLoading || !canExtract}
                >
                  {csvLoading ? (
                    <><span className="btn-spinner" /> Building CSV…</>
                  ) : (
                    '📥 Download CSV'
                  )}
                </button>
              </div>

              {!canExtract && (
                <p className="extract-hint">
                  Complete steps 1 → 2 → 3 above to unlock extraction
                </p>
              )}
            </div>
          </div>
        </div>

        {/* ── Error ── */}
        {error && (
          <div className="error-banner">
            <span className="error-banner__icon">⚠️</span>
            <div>
              <strong>Extraction Error</strong>
              <p>{error}</p>
            </div>
            <button className="error-banner__close" onClick={() => setError(null)}>×</button>
          </div>
        )}

        {/* ══════════ RESULTS ══════════ */}
        {results && (
          <section className="results-section" ref={resultsRef}>

            {/* Stats bar */}
            <div className="results-stats">
              <StatCard icon="🗂️" value={results.total_records.toLocaleString()} label="Total Draws" />
              <StatCard icon="🎟️" value={results.lotteries.length} label="Lotteries" />
              <StatCard icon="📍" value={results.state_name} label="State" />
              <StatCard icon="📅" value={`${dayRange}d`} label="Date Span" />
            </div>

            {/* Tabs */}
            <div className="results-tabs">
              <button
                className={`rtab ${activeTab === 'results' ? 'rtab--active' : ''}`}
                onClick={() => setActiveTab('results')}
              >
                📋 Results
                <span className="rtab__count">{results.total_records}</span>
              </button>
              <button
                className={`rtab ${activeTab === 'api' ? 'rtab--active' : ''}`}
                onClick={() => setActiveTab('api')}
              >
                🔌 API Reference
              </button>
              <button
                className="rtab rtab--dl"
                onClick={handleCSV}
                disabled={csvLoading}
                title="Download as CSV"
              >
                {csvLoading ? '⏳ Building…' : '📥 Download CSV'}
              </button>
            </div>

            {/* Tab content */}
            <div className="results-body">
              {activeTab === 'results' && (
                <ResultsTable data={results.data} lotteries={results.lotteries} />
              )}
              {activeTab === 'api' && (
                <ApiPanel
                  state={selectedState}
                  lotteries={selectedLotteries}
                  fromDate={fromDate}
                  toDate={toDate}
                />
              )}
            </div>
          </section>
        )}
      </main>

      {/* ══════════ FOOTER ══════════ */}
      <footer className="site-footer">
        <div className="site-footer__inner">
          <span className="footer-brand">
            🎰 Lotto Extraction &mdash; Real data only. Zero fake numbers.
          </span>
          <span>
            Sources:&nbsp;
            <a href="https://data.ny.gov" target="_blank" rel="noreferrer">NY Open Data</a>
            &nbsp;&amp;&nbsp;
            <a href="https://www.lotto.net" target="_blank" rel="noreferrer">lotto.net</a>
          </span>
          <span>
            <a href={`${window.location.origin}/docs`} target="_blank" rel="noreferrer">Swagger UI</a>
            &nbsp;·&nbsp;
            <a href={`${window.location.origin}/redoc`} target="_blank" rel="noreferrer">ReDoc</a>
          </span>
        </div>
      </footer>
    </div>
  );
}
