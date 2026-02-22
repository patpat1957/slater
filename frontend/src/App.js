import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import Select from 'react-select';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import './App.css';

// Use relative URL when served from same server (production), absolute for dev
const API_BASE = process.env.REACT_APP_API_URL !== undefined
  ? (process.env.REACT_APP_API_URL || '')
  : 'http://localhost:8000';

// ─────────────────────────────────────────────────────
// Sub-Components
// ─────────────────────────────────────────────────────

const LottoBall = ({ number, type = 'regular' }) => {
  const cls = type === 'powerball' ? 'ball ball-red'
    : type === 'mega' ? 'ball ball-gold'
    : type === 'bonus' ? 'ball ball-green'
    : 'ball ball-white';
  return <span className={cls}>{String(number).padStart(2, '0')}</span>;
};

const ResultRow = ({ row, index }) => {
  const ballKeys = Object.keys(row).filter(k => k.startsWith('Ball_')).sort((a, b) => {
    const na = parseInt(a.split('_')[1]);
    const nb = parseInt(b.split('_')[1]);
    return na - nb;
  });
  const specialKeys = Object.keys(row).filter(k =>
    !k.startsWith('Ball_') &&
    !['Date', 'Lotto_Name', 'State', 'Lottery_ID'].includes(k)
  );

  return (
    <tr className={index % 2 === 0 ? 'row-even' : 'row-odd'}>
      <td className="td-date">{row.Date}</td>
      <td className="td-name">{row.Lotto_Name}</td>
      <td className="td-balls">
        <div className="balls-row">
          {ballKeys.map(k => (
            <LottoBall key={k} number={row[k]} type="regular" />
          ))}
          {specialKeys.map(k => {
            const keyLower = k.toLowerCase();
            const ballType = keyLower.includes('powerball') ? 'powerball'
              : keyLower.includes('mega') ? 'mega'
              : keyLower.includes('bonus') || keyLower.includes('cash') ? 'bonus'
              : 'regular';
            return (
              <span key={k} className="bonus-group">
                <span className="bonus-label">{k.replace(/_/g, ' ')}</span>
                <LottoBall number={row[k]} type={ballType} />
              </span>
            );
          })}
        </div>
      </td>
    </tr>
  );
};

const StepBadge = ({ num, label, active, done }) => (
  <div className={`step-badge ${active ? 'step-active' : ''} ${done ? 'step-done' : ''}`}>
    <div className="step-num">{done ? '✓' : num}</div>
    <span>{label}</span>
  </div>
);

// ─────────────────────────────────────────────────────
// Main App
// ─────────────────────────────────────────────────────

export default function App() {
  // State
  const [step, setStep] = useState(1);
  const [allStates, setAllStates] = useState([]);
  const [selectedState, setSelectedState] = useState(null);
  const [availableLotteries, setAvailableLotteries] = useState([]);
  const [selectedLotteries, setSelectedLotteries] = useState([]);
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    return d;
  });
  const [toDate, setToDate] = useState(new Date());
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [detecting, setDetecting] = useState(true);
  const [detectedState, setDetectedState] = useState(null);
  const [apiInfo, setApiInfo] = useState(null);
  const [activeTab, setActiveTab] = useState('results');

  // Fetch all states on mount
  useEffect(() => {
    fetchAllStates();
    detectLocation();
  }, []);

  const fetchAllStates = async () => {
    try {
      const res = await axios.get(`${API_BASE}/lotteries/all-states`);
      const states = res.data.states.filter(s => s.lottery_count > 0);
      setAllStates(states);
    } catch (e) {
      console.error('Failed to load states:', e);
    }
  };

  const detectLocation = async () => {
    setDetecting(true);
    try {
      const res = await axios.get(`${API_BASE}/lotteries/detect-location`);
      const data = res.data;
      if (data.detected_state_code) {
        setDetectedState({
          code: data.detected_state_code,
          name: data.detected_state_name,
          lotteries: data.lotteries,
        });
        // Auto-select detected state
        setSelectedState({
          value: data.detected_state_code,
          label: `${data.detected_state_name} (${data.detected_state_code})`,
        });
        setAvailableLotteries(data.lotteries || []);
        if (data.lotteries?.length > 0) setStep(2);
      }
    } catch (e) {
      console.error('Location detection failed:', e);
    } finally {
      setDetecting(false);
    }
  };

  const handleStateChange = async (option) => {
    setSelectedState(option);
    setSelectedLotteries([]);
    setResults(null);
    setError(null);

    if (!option) {
      setAvailableLotteries([]);
      setStep(1);
      return;
    }

    try {
      const res = await axios.get(`${API_BASE}/lotteries/by-state/${option.value}`);
      setAvailableLotteries(res.data.lotteries || []);
      setStep(2);
    } catch (e) {
      setError(`Failed to load lotteries for ${option.label}`);
    }
  };

  const handleLotteryChange = (selected) => {
    setSelectedLotteries(selected || []);
    if (selected?.length > 0) setStep(3);
    else setStep(2);
  };

  const handleExtract = async () => {
    if (!selectedState || selectedLotteries.length === 0) return;

    setLoading(true);
    setError(null);
    setResults(null);

    const fmtDate = d => d.toISOString().split('T')[0];

    try {
      const res = await axios.post(`${API_BASE}/extract`, {
        state_code: selectedState.value,
        lottery_ids: selectedLotteries.map(l => l.value),
        from_date: fmtDate(fromDate),
        to_date: fmtDate(toDate),
      });
      setResults(res.data);
      setStep(4);
      setActiveTab('results');
    } catch (e) {
      const msg = e.response?.data?.detail || e.message;
      setError(typeof msg === 'string' ? msg : JSON.stringify(msg));
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadCSV = async () => {
    if (!selectedState || selectedLotteries.length === 0) return;

    const fmtDate = d => d.toISOString().split('T')[0];
    const params = new URLSearchParams({
      state_code: selectedState.value,
      lottery_ids: selectedLotteries.map(l => l.value).join(','),
      from_date: fmtDate(fromDate),
      to_date: fmtDate(toDate),
    });

    try {
      const res = await axios.get(`${API_BASE}/extract/csv?${params}`, {
        responseType: 'blob',
      });
      const cd = res.headers['content-disposition'] || '';
      let filename = cd.match(/filename="?([^"]+)"?/)?.[1] || 'lotto_results.csv';
      const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError('CSV download failed: ' + (e.response?.data?.detail || e.message));
    }
  };

  const buildApiUrl = () => {
    if (!selectedState || selectedLotteries.length === 0) return '';
    const fmtDate = d => d.toISOString().split('T')[0];
    const ids = selectedLotteries.map(l => l.value).join(',');
    return `${API_BASE}/extract/csv?state_code=${selectedState.value}&lottery_ids=${ids}&from_date=${fmtDate(fromDate)}&to_date=${fmtDate(toDate)}`;
  };

  const buildCurlCmd = () => {
    if (!selectedState || selectedLotteries.length === 0) return '';
    const fmtDate = d => d.toISOString().split('T')[0];
    const body = JSON.stringify({
      state_code: selectedState.value,
      lottery_ids: selectedLotteries.map(l => l.value),
      from_date: fmtDate(fromDate),
      to_date: fmtDate(toDate),
    }, null, 2);
    return `curl -X POST "${API_BASE}/extract/csv" \\\n  -H "Content-Type: application/json" \\\n  -d '${body}' \\\n  -o "${selectedState?.label?.split(' ')[0] || 'results'}_lottery.csv"`;
  };

  // Select options
  const stateOptions = allStates.map(s => ({
    value: s.state_code,
    label: `${s.state_name} (${s.state_code})`,
  }));

  const lotteryOptions = availableLotteries.map(l => ({
    value: l.id,
    label: l.name,
    type: l.type,
  }));

  const groupedLotteryOptions = [
    {
      label: '🌐 Multi-State Lotteries',
      options: lotteryOptions.filter(o => o.type === 'multistate'),
    },
    {
      label: '🏛️ State Lotteries',
      options: lotteryOptions.filter(o => o.type === 'state'),
    },
  ].filter(g => g.options.length > 0);

  const ballColumnHeaders = results?.data?.length > 0
    ? Object.keys(results.data[0]).filter(k =>
        !['Date', 'Lotto_Name', 'State', 'Lottery_ID'].includes(k)
      )
    : [];

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-inner">
          <div className="logo">
            <span className="logo-icon">🎰</span>
            <div>
              <h1>Lotto Extraction</h1>
              <p>Real lottery numbers from official sources</p>
            </div>
          </div>
          <div className="header-links">
            <a href={`${API_BASE}/docs`} target="_blank" rel="noreferrer" className="btn-link">
              📖 API Docs
            </a>
            <a href={`${API_BASE}/redoc`} target="_blank" rel="noreferrer" className="btn-link">
              📋 ReDoc
            </a>
          </div>
        </div>
      </header>

      <main className="main">
        {/* Steps indicator */}
        <div className="steps-bar">
          <StepBadge num={1} label="Select State" active={step === 1} done={step > 1} />
          <div className="step-line" />
          <StepBadge num={2} label="Pick Lotteries" active={step === 2} done={step > 2} />
          <div className="step-line" />
          <StepBadge num={3} label="Set Date Range" active={step === 3} done={step > 3} />
          <div className="step-line" />
          <StepBadge num={4} label="Extract Data" active={step === 4} done={false} />
        </div>

        <div className="card-grid">
          {/* ─── Step 1: State Selection ─── */}
          <div className={`card ${step >= 1 ? 'card-active' : ''}`}>
            <div className="card-header">
              <span className="card-icon">📍</span>
              <div>
                <h2>Step 1: Select State</h2>
                {detecting && <p className="detecting">🔍 Detecting your location...</p>}
                {detectedState && !detecting && (
                  <p className="detected">✅ Detected: <strong>{detectedState.name}</strong></p>
                )}
              </div>
            </div>
            <div className="card-body">
              <Select
                options={stateOptions}
                value={selectedState}
                onChange={handleStateChange}
                placeholder="Search or select your state..."
                isClearable
                className="state-select"
                classNamePrefix="react-select"
                styles={selectStyles}
                noOptionsMessage={() => 'No states found'}
              />
              {selectedState && (
                <div className="info-badge">
                  🏛️ {allStates.find(s => s.state_code === selectedState.value)?.lottery_count || 0} lotteries available
                </div>
              )}
            </div>
          </div>

          {/* ─── Step 2: Lottery Selection ─── */}
          <div className={`card ${step >= 2 ? 'card-active' : 'card-disabled'}`}>
            <div className="card-header">
              <span className="card-icon">🎟️</span>
              <div>
                <h2>Step 2: Pick Lotteries</h2>
                <p>Select one or more lotteries to extract</p>
              </div>
            </div>
            <div className="card-body">
              <Select
                isMulti
                options={groupedLotteryOptions}
                value={selectedLotteries}
                onChange={handleLotteryChange}
                isDisabled={step < 2}
                placeholder={step < 2 ? "Select a state first..." : "Choose lotteries..."}
                closeMenuOnSelect={false}
                className="lottery-select"
                classNamePrefix="react-select"
                styles={selectStyles}
                formatOptionLabel={(opt) => (
                  <div className="lottery-option">
                    <span>{opt.type === 'multistate' ? '🌐' : '🏛️'}</span>
                    <span>{opt.label}</span>
                    <span className={`opt-badge ${opt.type}`}>{opt.type}</span>
                  </div>
                )}
              />
              {selectedLotteries.length > 0 && (
                <div className="selected-tags">
                  {selectedLotteries.map(l => (
                    <span key={l.value} className={`tag tag-${l.type}`}>
                      {l.type === 'multistate' ? '🌐' : '🏛️'} {l.label}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ─── Step 3: Date Range ─── */}
          <div className={`card ${step >= 3 ? 'card-active' : 'card-disabled'}`}>
            <div className="card-header">
              <span className="card-icon">📅</span>
              <div>
                <h2>Step 3: Date Range</h2>
                <p>Select the timeline for extraction</p>
              </div>
            </div>
            <div className="card-body">
              <div className="date-row">
                <div className="date-field">
                  <label>From Date</label>
                  <DatePicker
                    selected={fromDate}
                    onChange={d => { setFromDate(d); if (step < 3) setStep(3); }}
                    selectsStart
                    startDate={fromDate}
                    endDate={toDate}
                    maxDate={toDate}
                    dateFormat="yyyy-MM-dd"
                    placeholderText="Start date"
                    disabled={step < 3}
                    className="date-input"
                    showYearDropdown
                    scrollableYearDropdown
                    yearDropdownItemNumber={30}
                    showMonthDropdown
                  />
                </div>
                <div className="date-arrow">→</div>
                <div className="date-field">
                  <label>To Date</label>
                  <DatePicker
                    selected={toDate}
                    onChange={d => { setToDate(d); if (step < 3) setStep(3); }}
                    selectsEnd
                    startDate={fromDate}
                    endDate={toDate}
                    minDate={fromDate}
                    maxDate={new Date()}
                    dateFormat="yyyy-MM-dd"
                    placeholderText="End date"
                    disabled={step < 3}
                    className="date-input"
                    showYearDropdown
                    scrollableYearDropdown
                    yearDropdownItemNumber={30}
                    showMonthDropdown
                  />
                </div>
              </div>
              {step >= 3 && (
                <p className="date-info">
                  📊 Range: {Math.ceil((toDate - fromDate) / (1000 * 60 * 60 * 24))} days
                </p>
              )}
            </div>
          </div>

          {/* ─── Action Buttons ─── */}
          <div className="card action-card">
            <div className="action-buttons">
              <button
                className="btn btn-primary"
                onClick={handleExtract}
                disabled={loading || !selectedState || selectedLotteries.length === 0}
              >
                {loading ? (
                  <><span className="spinner" /> Scraping Real Data...</>
                ) : (
                  <>🔍 Extract Results</>
                )}
              </button>
              <button
                className="btn btn-secondary"
                onClick={handleDownloadCSV}
                disabled={loading || !selectedState || selectedLotteries.length === 0}
              >
                📥 Download CSV
              </button>
            </div>
            {selectedState && selectedLotteries.length > 0 && (
              <div className="query-info">
                <span>📍 {selectedState.label}</span>
                <span>🎟️ {selectedLotteries.length} lottery/lotteries</span>
                <span>📅 {fromDate.toISOString().split('T')[0]} → {toDate.toISOString().split('T')[0]}</span>
              </div>
            )}
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="error-box">
            <strong>⚠️ Error:</strong> {error}
          </div>
        )}

        {/* Results Section */}
        {results && (
          <div className="results-section">
            {/* Stats Bar */}
            <div className="stats-bar">
              <div className="stat">
                <div className="stat-num">{results.total_records}</div>
                <div className="stat-label">Draws Found</div>
              </div>
              <div className="stat">
                <div className="stat-num">{results.lotteries.length}</div>
                <div className="stat-label">Lotteries</div>
              </div>
              <div className="stat">
                <div className="stat-num">{results.state_name.split(' ')[0]}</div>
                <div className="stat-label">State</div>
              </div>
              <div className="stat">
                <div className="stat-num">
                  {Math.ceil((new Date(results.to_date) - new Date(results.from_date)) / (1000 * 60 * 60 * 24))}d
                </div>
                <div className="stat-label">Period</div>
              </div>
            </div>

            {/* Tabs */}
            <div className="tabs">
              <button
                className={`tab ${activeTab === 'results' ? 'tab-active' : ''}`}
                onClick={() => setActiveTab('results')}
              >
                📋 Results ({results.total_records})
              </button>
              <button
                className={`tab ${activeTab === 'api' ? 'tab-active' : ''}`}
                onClick={() => setActiveTab('api')}
              >
                🔌 API Reference
              </button>
              <button
                className="tab tab-download"
                onClick={handleDownloadCSV}
              >
                📥 Download CSV
              </button>
            </div>

            {/* Results Tab */}
            {activeTab === 'results' && (
              <div className="table-wrapper">
                {results.total_records === 0 ? (
                  <div className="no-results">
                    <div className="no-results-icon">🔍</div>
                    <h3>No Results Found</h3>
                    <p>No lottery draws found for the selected criteria.</p>
                    <ul>
                      <li>Try expanding the date range</li>
                      <li>Powerball & Mega Millions have the most historical data (back to 2010)</li>
                      <li>Some state-specific lotteries have limited historical data</li>
                    </ul>
                  </div>
                ) : (
                  <table className="results-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Lottery</th>
                        <th>Numbers</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.data.map((row, i) => (
                        <ResultRow key={i} row={row} index={i} />
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* API Tab */}
            {activeTab === 'api' && (
              <div className="api-section">
                <h3>🔌 REST API Reference</h3>
                <p>Use these endpoints to access lottery data programmatically.</p>

                <div className="api-block">
                  <div className="api-method">GET</div>
                  <div className="api-details">
                    <div className="api-title">Extract Results (JSON)</div>
                    <code>{API_BASE}/extract?state_code={selectedState?.value}&lottery_ids={selectedLotteries.map(l=>l.value).join(',')}&from_date={fromDate.toISOString().split('T')[0]}&to_date={toDate.toISOString().split('T')[0]}</code>
                  </div>
                </div>

                <div className="api-block">
                  <div className="api-method">GET</div>
                  <div className="api-details">
                    <div className="api-title">Download CSV</div>
                    <code>{buildApiUrl()}</code>
                    <button className="copy-btn" onClick={() => navigator.clipboard.writeText(buildApiUrl())}>
                      Copy URL
                    </button>
                  </div>
                </div>

                <div className="api-block">
                  <div className="api-method post">POST</div>
                  <div className="api-details">
                    <div className="api-title">Extract (POST JSON Body)</div>
                    <pre className="code-block">{buildCurlCmd()}</pre>
                    <button className="copy-btn" onClick={() => navigator.clipboard.writeText(buildCurlCmd())}>
                      Copy cURL
                    </button>
                  </div>
                </div>

                <div className="api-endpoints-list">
                  <h4>All Available Endpoints</h4>
                  <table className="endpoints-table">
                    <thead>
                      <tr><th>Method</th><th>Endpoint</th><th>Description</th></tr>
                    </thead>
                    <tbody>
                      <tr><td><span className="m get">GET</span></td><td>/lotteries/all-states</td><td>List all states & lotteries</td></tr>
                      <tr><td><span className="m get">GET</span></td><td>/lotteries/by-state/{'{state_code}'}</td><td>Lotteries for a specific state</td></tr>
                      <tr><td><span className="m get">GET</span></td><td>/lotteries/detect-location</td><td>Auto-detect state from IP</td></tr>
                      <tr><td><span className="m get">GET</span></td><td>/lotteries/sources</td><td>Data source information</td></tr>
                      <tr><td><span className="m get">GET</span></td><td>/extract</td><td>Extract results (JSON, query params)</td></tr>
                      <tr><td><span className="m post">POST</span></td><td>/extract</td><td>Extract results (JSON, body)</td></tr>
                      <tr><td><span className="m get">GET</span></td><td>/extract/csv</td><td>Download CSV (query params)</td></tr>
                      <tr><td><span className="m post">POST</span></td><td>/extract/csv</td><td>Download CSV (body)</td></tr>
                      <tr><td><span className="m get">GET</span></td><td>/health</td><td>Health check</td></tr>
                      <tr><td><span className="m get">GET</span></td><td>/docs</td><td>Swagger UI docs</td></tr>
                    </tbody>
                  </table>
                </div>

                <div className="data-source-note">
                  <h4>⚠️ Data Sources</h4>
                  <p><strong>No random/fake numbers are ever used.</strong> All lottery results are fetched from:</p>
                  <ul>
                    <li><strong>NY Open Data</strong> (data.ny.gov) — Official NY State government data for Powerball, Mega Millions, NY Lotto, Take 5, etc.</li>
                    <li><strong>lotto.net</strong> — Public historical archive for multi-state and state lotteries</li>
                  </ul>
                </div>

                {results.errors && results.errors.length > 0 && (
                  <div className="api-warnings">
                    <h4>⚠️ Warnings</h4>
                    {results.errors.map((e, i) => <p key={i}>{e}</p>)}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="footer">
        <p>
          🎰 <strong>Lotto Extraction</strong> — Real lottery data from official sources.
          Data provided by <a href="https://data.ny.gov" target="_blank" rel="noreferrer">NY Open Data</a> and
          <a href="https://www.lotto.net" target="_blank" rel="noreferrer"> lotto.net</a>.
        </p>
      </footer>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// React-Select Custom Styles
// ─────────────────────────────────────────────────────
const selectStyles = {
  control: (base, state) => ({
    ...base,
    background: 'rgba(255,255,255,0.05)',
    borderColor: state.isFocused ? '#7c3aed' : 'rgba(255,255,255,0.15)',
    borderRadius: '10px',
    boxShadow: state.isFocused ? '0 0 0 3px rgba(124,58,237,0.3)' : 'none',
    color: '#fff',
    fontSize: '15px',
    minHeight: '46px',
    '&:hover': { borderColor: '#7c3aed' },
  }),
  menu: (base) => ({
    ...base,
    background: '#1e1e3f',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: '10px',
    zIndex: 1000,
  }),
  option: (base, state) => ({
    ...base,
    background: state.isSelected ? '#7c3aed' : state.isFocused ? 'rgba(124,58,237,0.3)' : 'transparent',
    color: '#fff',
    cursor: 'pointer',
  }),
  singleValue: (base) => ({ ...base, color: '#fff' }),
  multiValue: (base) => ({
    ...base,
    background: 'rgba(124,58,237,0.4)',
    borderRadius: '6px',
  }),
  multiValueLabel: (base) => ({ ...base, color: '#fff' }),
  multiValueRemove: (base) => ({
    ...base,
    color: '#fff',
    '&:hover': { background: '#7c3aed', color: '#fff' },
  }),
  placeholder: (base) => ({ ...base, color: 'rgba(255,255,255,0.4)' }),
  input: (base) => ({ ...base, color: '#fff' }),
  groupHeading: (base) => ({
    ...base,
    color: '#a78bfa',
    fontSize: '11px',
    fontWeight: '700',
    letterSpacing: '1px',
    textTransform: 'uppercase',
    padding: '8px 12px 4px',
  }),
  indicatorSeparator: () => ({ display: 'none' }),
  dropdownIndicator: (base) => ({ ...base, color: 'rgba(255,255,255,0.5)' }),
  clearIndicator: (base) => ({ ...base, color: 'rgba(255,255,255,0.5)' }),
};
