import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import './App.css';

/* ── Step components ── */
import Step1_StateLottery   from './components/Step1_StateLottery';
import Step2_DateRange      from './components/Step2_DateRange';
import Step3_Results        from './components/Step3_Results';
import LottoBall            from './components/LottoBall';
import UniversalPredictor   from './components/UniversalPredictor';
import HitMissDashboard     from './components/HitMissDashboard';

/* ── Mobile ── */
import MobileAppBanner  from './components/MobileAppBanner';
import MobileBottomNav  from './components/MobileBottomNav';
import MobileAppScreen  from './components/MobileAppScreen';

/* ── Monetization ── */
import { MonetizationProvider, useMonetization } from './components/MonetizationContext';
import PricingPage      from './components/PricingPage';
import UpgradeModal     from './components/UpgradeModal';
import PlanBadge        from './components/PlanBadge';
import AdBanner         from './components/AdBanner';
import StripeCheckout   from './components/StripeCheckout';
import CheckoutSuccess  from './components/CheckoutSuccess';

const API = '';  /* relative — CRA proxy → localhost:8000 */

/* ── helpers ── */
const fmtDate    = d => (d instanceof Date ? d.toISOString().split('T')[0] : d);
const oneYearAgo = () => { const d = new Date(); d.setFullYear(d.getFullYear() - 1); return d; };

/* ── Hero demo balls ── */
const DEMO_BALLS = [
  { n: '07', t: 'white'     },
  { n: '14', t: 'white'     },
  { n: '32', t: 'white'     },
  { n: '45', t: 'white'     },
  { n: '61', t: 'white'     },
  { n: '20', t: 'powerball' },
];

/* ── Feature pills ── */
const PILLS = [
  { icon: '📍', text: 'Location-aware'  },
  { icon: '🎟️', text: '46 US states'   },
  { icon: '📅', text: '10+ yrs of data' },
  { icon: '📥', text: 'CSV export'      },
  { icon: '🔌', text: 'REST API'        },
  { icon: '🔒', text: 'Real data only'  },
];

/* ── Step config ── */
const STEPS = [
  { num: 1, icon: '📍', label: 'State & Lotteries', desc: 'Choose your state and games' },
  { num: 2, icon: '📅', label: 'Date Range',         desc: 'Set the extraction window' },
  { num: 3, icon: '🚀', label: 'Extract & Analyze',  desc: 'View draws + analytics' },
];

/* ── Toast ── */
function Toast({ msg, type, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4500);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <motion.div
      className={`toast toast--${type}`}
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 24 }}
    >
      <span>{msg}</span>
      <button className="toast__close" onClick={onClose}>×</button>
    </motion.div>
  );
}

/* ── Wizard Progress ── */
function WizardProgress({ step, maxStep }) {
  return (
    <div className="wizard">
      {STEPS.map((s, idx) => {
        const done   = step > s.num;
        const active = step === s.num;
        return (
          <React.Fragment key={s.num}>
            <div className={`wizard__step${active ? ' is-active' : ''}${done ? ' is-done' : ''}`}>
              <div className="wizard__bubble">
                {done
                  ? <span className="wizard__check">✓</span>
                  : <span style={{ fontSize: 22 }}>{s.icon}</span>
                }
                {active && <span className="wizard__pulse" />}
              </div>
              <div style={{ textAlign: 'center' }}>
                <span className="wizard__label">{s.label}</span>
              </div>
            </div>
            {idx < STEPS.length - 1 && (
              <div className={`wizard__line${done ? ' is-done' : ''}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   APP
═══════════════════════════════════════════════════ */
export default function App() {
  return (
    <MonetizationProvider>
      <AppInner />
    </MonetizationProvider>
  );
}

function AppInner() {
  const {
    showPricing, setShowPricing,
    pendingCheckout, setPendingCheckout,
    checkoutSuccess, setCheckoutSuccess,
    activatePlan, mockUpgrade,
  } = useMonetization();

  /* ── top-level mode ── */
  const [appMode, setAppMode] = useState('extractor'); // 'extractor' | 'predictor' | 'dashboard'

  /* ── Mobile app screen (shown once per session on mobile) ── */
  const [showMobileScreen, setShowMobileScreen] = useState(() => {
    if (typeof window === 'undefined') return false;
    // Show on mobile only, skip if standalone PWA or already dismissed this session
    const isMob = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth <= 768;
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    const dismissed = sessionStorage.getItem('lotto_mas_dismissed');
    return isMob && !isStandalone && !dismissed;
  });

  const dismissMobileScreen = useCallback(() => {
    setShowMobileScreen(false);
    try { sessionStorage.setItem('lotto_mas_dismissed', '1'); } catch {}
  }, []);

  /* ── Detect ?checkout=success in URL on mount ── */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('checkout');
    const plan   = params.get('plan') || 'pro';
    const sid    = params.get('session_id') || '';
    if (status === 'success') {
      setCheckoutSuccess({ plan, sessionId: sid });
      // Clean URL
      const clean = window.location.pathname;
      window.history.replaceState({}, '', clean);
    } else if (status === 'cancelled') {
      // Just clean the URL; user can try again
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []); // eslint-disable-line

  /* ── state ── */
  const [step, setStep] = useState(1);

  /* Step 1 */
  const [allStates,          setAllStates]          = useState([]);
  const [selectedState,      setSelectedState]      = useState(null);
  const [availableLotteries, setAvailableLotteries] = useState([]);
  const [selectedLotteries,  setSelectedLotteries]  = useState([]);
  const [detecting,          setDetecting]          = useState(true);
  const [detectedState,      setDetectedState]      = useState(null);

  /* Step 2 */
  const [fromDate, setFromDate] = useState(oneYearAgo);
  const [toDate,   setToDate]   = useState(() => new Date());

  /* Step 3 */
  const [results,     setResults]     = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [csvLoading,  setCsvLoading]  = useState(false);
  const [error,       setError]       = useState(null);
  const [toasts,      setToasts]      = useState([]);

  const resultsRef = useRef(null);

  /* ── Toast helpers ── */
  const addToast    = useCallback((msg, type = 'success') => {
    const id = Date.now();
    setToasts(t => [...t, { id, msg, type }]);
  }, []);
  const removeToast = useCallback(id => setToasts(t => t.filter(x => x.id !== id)), []);

  /* ── Init: load states + auto-detect ── */
  useEffect(() => {
    axios.get(`${API}/lotteries/all-states`)
      .then(r => setAllStates(r.data.states.filter(s => s.lottery_count > 0)))
      .catch(() => {});

    axios.get(`${API}/lotteries/detect-location`)
      .then(r => {
        const d = r.data;
        if (d.detected_state_code) {
          const opt = {
            value: d.detected_state_code,
            label: `${d.detected_state_name} (${d.detected_state_code})`,
          };
          setDetectedState(opt);
          setSelectedState(opt);
          setAvailableLotteries(d.lotteries || []);
        }
      })
      .catch(() => {})
      .finally(() => setDetecting(false));
  }, []);

  /* ── State change ── */
  const handleStateChange = async (opt) => {
    setSelectedState(opt);
    setSelectedLotteries([]);
    setResults(null);
    setError(null);
    if (!opt) { setAvailableLotteries([]); return; }
    try {
      const r = await axios.get(`${API}/lotteries/by-state/${opt.value}`);
      setAvailableLotteries(r.data.lotteries || []);
    } catch {
      setError(`Could not load lotteries for ${opt.label}`);
    }
  };

  /* ── Lottery change ── */
  const handleLotteryChange = (sel) => {
    setSelectedLotteries(sel || []);
    setResults(null);
  };

  /* ── Extract ── */
  const handleExtract = async () => {
    if (!selectedState || !selectedLotteries.length) return;
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const r = await axios.post(`${API}/extract`, {
        state_code:  selectedState.value,
        lottery_ids: selectedLotteries.map(l => l.value),
        from_date:   fmtDate(fromDate),
        to_date:     fmtDate(toDate),
      });
      setResults(r.data);
      setStep(3);
      addToast(`✓ Found ${r.data.total_records} real lottery draws`, 'success');
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);
    } catch (e) {
      const msg = e.response?.data?.detail || e.message;
      setError(typeof msg === 'string' ? msg : JSON.stringify(msg));
      addToast('⚠️ Extraction failed — see details below', 'error');
    } finally {
      setLoading(false);
    }
  };

  /* ── CSV download ── */
  const handleCSV = async () => {
    if (!selectedState || !selectedLotteries.length) return;
    setCsvLoading(true);
    const params = new URLSearchParams({
      state_code:  selectedState.value,
      lottery_ids: selectedLotteries.map(l => l.value).join(','),
      from_date:   fmtDate(fromDate),
      to_date:     fmtDate(toDate),
    });
    try {
      const r = await axios.get(`${API}/extract/csv?${params}`, { responseType: 'blob' });
      const cd       = r.headers['content-disposition'] || '';
      const filename = cd.match(/filename="?([^"]+)"?/)?.[1] || 'lotto_results.csv';
      const url = URL.createObjectURL(new Blob([r.data], { type: 'text/csv' }));
      const a   = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
      addToast(`📥 ${filename} saved`, 'success');
    } catch (e) {
      const msg = e.response?.status === 404
        ? 'No data found for that selection and range'
        : (e.message || 'Download failed');
      addToast(`⚠️ ${msg}`, 'error');
    } finally {
      setCsvLoading(false);
    }
  };

  /* ── Derived ── */
  const canProceed  = !!(selectedState && selectedLotteries.length > 0);
  const canExtract  = canProceed;

  /* ── Navigation helpers ── */
  const goNext = () => setStep(s => Math.min(3, s + 1));
  const goBack = () => setStep(s => Math.max(1, s - 1));

  /* ── Step panel content ── */
  const stepContent = {
    1: (
      <Step1_StateLottery
        allStates={allStates}
        selectedState={selectedState}
        onStateChange={handleStateChange}
        availableLotteries={availableLotteries}
        selectedLotteries={selectedLotteries}
        onLotteryChange={handleLotteryChange}
        detecting={detecting}
        detectedState={detectedState}
      />
    ),
    2: (
      <Step2_DateRange
        fromDate={fromDate}
        setFromDate={setFromDate}
        toDate={toDate}
        setToDate={setToDate}
        selectedLotteries={selectedLotteries}
        disabled={!canProceed}
      />
    ),
    3: (
      <div>
        {/* ── Extract / Summary panel (always visible in step 3) ── */}
        {!results && !loading && (
          <div>
            <div className="step-panel__header">
              <div className="step-panel__icon" style={{ fontSize: 26 }}>🚀</div>
              <div>
                <div className="step-panel__title">Extract Real Data</div>
                <div className="step-panel__sub">Scrape live from official lottery sources</div>
              </div>
            </div>

            {canExtract && (
              <div className="extract-summary-card">
                <div className="extract-summary-item">
                  <span className="extract-summary-icon">📍</span>
                  <div>
                    <div className="extract-summary-label">State</div>
                    <div className="extract-summary-val">{selectedState?.label}</div>
                  </div>
                </div>
                <div className="extract-summary-item">
                  <span className="extract-summary-icon">🎟️</span>
                  <div>
                    <div className="extract-summary-label">Lotteries</div>
                    <div className="extract-summary-val">{selectedLotteries.map(l => l.label).join(' · ')}</div>
                  </div>
                </div>
                <div className="extract-summary-item">
                  <span className="extract-summary-icon">📅</span>
                  <div>
                    <div className="extract-summary-label">Date Range</div>
                    <div className="extract-summary-val">{fmtDate(fromDate)} → {fmtDate(toDate)}</div>
                  </div>
                </div>
              </div>
            )}

            <button
              className="btn-extract"
              onClick={handleExtract}
              disabled={loading || !canExtract}
            >
              {loading
                ? <><span className="btn-spinner" /> Fetching real draws…</>
                : '🔍 Extract Results'
              }
            </button>

            <button
              className="btn-csv"
              onClick={handleCSV}
              disabled={csvLoading || !canExtract}
            >
              {csvLoading
                ? <><span className="btn-spinner" /> Building CSV…</>
                : '📥 Download CSV'
              }
            </button>

            {!canExtract && (
              <p style={{ marginTop: 12, fontSize: 13, color: 'var(--text-d)', textAlign: 'center' }}>
                ← Go back to complete Step 1 and Step 2
              </p>
            )}
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div style={{ textAlign: 'center', padding: '48px 20px' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>⏳</div>
            <div style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
              Extracting lottery draws…
            </div>
            <div style={{ fontSize: 14, color: 'var(--text-m)' }}>
              Fetching from official sources — this may take a few seconds
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 24, gap: 8 }}>
              {[0,1,2].map(i => (
                <motion.div
                  key={i}
                  style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--purple)' }}
                  animate={{ scale: [1, 1.4, 1], opacity: [0.5, 1, 0.5] }}
                  transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="error-banner">
            <span className="error-banner__icon">⚠️</span>
            <div style={{ flex: 1 }}>
              <strong style={{ color: '#fca5a5' }}>Extraction Error</strong>
              <p style={{ fontSize: 13, color: 'rgba(252,165,165,0.8)', marginTop: 4 }}>{error}</p>
            </div>
            <button className="error-banner__close" onClick={() => setError(null)}>×</button>
          </div>
        )}

        {/* Results dashboard */}
        {results && !loading && (
          <div ref={resultsRef}>
            <Step3_Results
              results={results}
              selectedState={selectedState}
              selectedLotteries={selectedLotteries}
              fromDate={fromDate}
              toDate={toDate}
              onCSV={handleCSV}
              csvLoading={csvLoading}
            />

            {/* Re-extract option */}
            <div style={{ marginTop: 24, display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                className="btn-back"
                onClick={() => { setResults(null); setError(null); }}
                style={{ fontSize: 13 }}
              >
                🔄 New Extraction
              </button>
              <button
                className="btn-csv"
                onClick={handleCSV}
                disabled={csvLoading}
                style={{ width: 'auto', padding: '10px 20px', fontSize: 13 }}
              >
                {csvLoading ? '⏳ Building…' : '📥 Download CSV'}
              </button>
            </div>
          </div>
        )}
      </div>
    ),
  };

  return (
    <div className="app" data-theme="lotto">
      {/* ══════════ MOBILE APP SCREEN — full-screen landing with app link ══════════ */}
      {showMobileScreen && (
        <MobileAppScreen
          onModeChange={setAppMode}
          onDismiss={dismissMobileScreen}
        />
      )}

      {/* ── Stripe: Checkout email/redirect modal ── */}
      <AnimatePresence>
        {pendingCheckout && (
          <StripeCheckout
            plan={pendingCheckout.plan}
            billing={pendingCheckout.billing || 'monthly'}
            onClose={() => setPendingCheckout(null)}
            onMockUpgrade={mockUpgrade}
          />
        )}
      </AnimatePresence>

      {/* ── Stripe: Post-payment success overlay ── */}
      <AnimatePresence>
        {checkoutSuccess && (
          <CheckoutSuccess
            plan={checkoutSuccess.plan}
            sessionId={checkoutSuccess.sessionId}
            onActivate={(p) => activatePlan(p)}
            onClose={() => setCheckoutSuccess(null)}
          />
        )}
      </AnimatePresence>

      {/* ── Monetization overlays ── */}
      <UpgradeModal />
      <AnimatePresence>
        {showPricing && <PricingPage onClose={() => setShowPricing(false)} />}
      </AnimatePresence>
      {/* ── Toast Stack ── */}
      <div className="toast-stack">
        <AnimatePresence>
          {toasts.map(t => (
            <Toast key={t.id} msg={t.msg} type={t.type} onClose={() => removeToast(t.id)} />
          ))}
        </AnimatePresence>
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

          {/* ── Mode switcher ── */}
          <div className="mode-switcher">
            <button
              className={`mode-btn${appMode === 'extractor' ? ' mode-btn--active' : ''}`}
              onClick={() => setAppMode('extractor')}
            >
              📥 Extractor
            </button>
            <button
              className={`mode-btn mode-btn--predictor${appMode === 'predictor' ? ' mode-btn--active mode-btn--predictor-active' : ''}`}
              onClick={() => setAppMode('predictor')}
            >
              🔮 Predictor
            </button>
            <button
              className={`mode-btn mode-btn--dashboard${appMode === 'dashboard' ? ' mode-btn--active mode-btn--dashboard-active' : ''}`}
              onClick={() => setAppMode('dashboard')}
            >
              📊 Dashboard
            </button>
          </div>

          {/* ── Scoreboard CTA — always visible ── */}
          <a className="scoreboard-cta" href="/lotto-scoreboard.html">
            🎰 Live Scoreboard
          </a>

          <nav className="site-header__nav">
            <PlanBadge />
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

      {/* ══════════ PREDICTOR MODE ══════════ */}
      {appMode === 'predictor' && (
        <main className="main-content" style={{ paddingTop: 0 }}>
          <UniversalPredictor />
        </main>
      )}

      {/* ══════════ DASHBOARD MODE ══════════ */}
      {appMode === 'dashboard' && (
        <main className="main-content" style={{ paddingTop: 0 }}>
          <HitMissDashboard />
        </main>
      )}

      {/* ══════════ EXTRACTOR MODE ══════════ */}
      {appMode === 'extractor' && <>

      {/* ══════════ HERO ══════════ */}
      <section className="hero">
        <div className="hero__orb hero__orb--1" aria-hidden="true" />
        <div className="hero__orb hero__orb--2" aria-hidden="true" />
        <div className="hero__inner">
          <motion.div
            className="hero__badge"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            🛡️ &nbsp;Official sources only · 46 US states
          </motion.div>

          <motion.h2
            className="hero__title"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            Extract <span className="gradient-text">Real Lottery</span><br />Results Instantly
          </motion.h2>

          <motion.p
            className="hero__sub"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            Every number is a real historical draw — zero randomness, zero fakes.
          </motion.p>

          {/* Animated lottery balls */}
          <motion.div
            className="hero__drum"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.3 }}
          >
            {DEMO_BALLS.map((b, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 + i * 0.07 }}
              >
                <LottoBall number={b.n} type={b.t} size="lg" animate />
              </motion.div>
            ))}
          </motion.div>

          {/* Feature pills */}
          <motion.div
            className="hero__pills"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.7 }}
          >
            {PILLS.map((p, i) => (
              <span key={i} className="feature-pill">
                <span>{p.icon}</span>{p.text}
              </span>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ══════════ WIZARD ══════════ */}
      <main className="main-content">
        <WizardProgress step={step} maxStep={3} />

        {/* ── Step panel ── */}
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            className={`step-panel ${step <= 2 ? 'step-panel--active' : ''}`}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}
            style={{ maxWidth: 840, margin: '0 auto' }}
          >
            {stepContent[step]}

            {/* ── Wizard nav ── */}
            <div className="wizard-nav">
              <button
                className="btn-back"
                onClick={goBack}
                disabled={step === 1}
              >
                ← Back
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {/* Step indicator */}
                <span style={{ fontSize: 12, color: 'var(--text-d)' }}>
                  Step {step} of 3
                </span>

                {step < 3 ? (
                  <button
                    className="btn-next"
                    onClick={step === 2 ? () => { setStep(3); } : goNext}
                    disabled={step === 1 && !canProceed}
                  >
                    {step === 1 && !canProceed
                      ? 'Select a state & lottery first'
                      : step === 2
                        ? 'Review & Extract →'
                        : 'Next →'
                    }
                  </button>
                ) : (
                  !results && !loading && (
                    <button
                      className="btn-next"
                      onClick={handleExtract}
                      disabled={loading || !canExtract}
                    >
                      {loading ? '⏳ Extracting…' : '🔍 Extract Now'}
                    </button>
                  )
                )}
              </div>
            </div>
          </motion.div>
        </AnimatePresence>

        {/* ── Error banner outside step panel ── */}
        {error && step !== 3 && (
          <motion.div
            className="error-banner"
            style={{ maxWidth: 840, margin: '16px auto 0' }}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <span className="error-banner__icon">⚠️</span>
            <div style={{ flex: 1 }}>
              <strong style={{ color: '#fca5a5' }}>Error</strong>
              <p style={{ fontSize: 13, marginTop: 4 }}>{error}</p>
            </div>
            <button className="error-banner__close" onClick={() => setError(null)}>×</button>
          </motion.div>
        )}
      </main>

      </> /* end extractor mode */}

      {/* ── Bottom ad banner (free plan only) ── */}
      <AdBanner position="bottom" />

      {/* ══════════ MOBILE: App install banner + Bottom nav ══════════ */}
      <MobileAppBanner />
      <MobileBottomNav appMode={appMode} onModeChange={setAppMode} />

      {/* ══════════ FOOTER ══════════ */}
      <footer className="site-footer">
        <div className="site-footer__inner">
          <span>🎰 Lotto Extraction — Real data only. Zero fake numbers.</span>
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
