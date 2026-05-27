import React, { useState, useEffect, useCallback, useRef } from 'react';

/* ═══════════════════════════════════════════════════════════════
   MobileAppScreen — Full-screen mobile landing with app link
   Features:
   1. Beautiful hero with animated app showcase
   2. Share / Copy app link button (Web Share API + clipboard fallback)
   3. PWA install prompt (native + iOS guide)
   4. Feature highlights with micro-animations
   5. Quick-launch buttons for Extract / Predict / Scoreboard
═══════════════════════════════════════════════════════════════ */

const DISMISS_KEY = 'lotto_mob_screen_dismissed';
const APP_URL = typeof window !== 'undefined' ? window.location.origin : '';

/* ── Feature cards ── */
const FEATURES = [
  { icon: '📥', title: 'Extract Results', desc: 'Real data from 46 US states', mode: 'extractor' },
  { icon: '🔮', title: 'Smart Predictor', desc: 'AI-powered number analysis', mode: 'predictor' },
  { icon: '🏆', title: 'Live Scoreboard', desc: 'Track winning patterns', mode: 'scoreboard' },
];

const HIGHLIGHTS = [
  { icon: '🛡️', text: 'Official sources only' },
  { icon: '📊', text: '10+ years of data' },
  { icon: '⚡', text: 'Instant results' },
  { icon: '📱', text: 'Works offline' },
];

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

export default function MobileAppScreen({ onModeChange, onDismiss }) {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [animStep, setAnimStep] = useState(0);
  const animRef = useRef(null);

  /* ── Entry animation sequence ── */
  useEffect(() => {
    const steps = [100, 300, 500, 700, 900, 1100];
    steps.forEach((delay, i) => {
      const t = setTimeout(() => setAnimStep(i + 1), delay);
      return () => clearTimeout(t);
    });
  }, []);

  /* ── Listen for install prompt ── */
  useEffect(() => {
    if (isStandalone()) return;
    const handler = (e) => { e.preventDefault(); setDeferredPrompt(e); };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  /* ── Share app link ── */
  const handleShare = useCallback(async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Lotto Extraction — Real Lottery Results',
          text: 'Check out this lottery results app — real data from 46 US states!',
          url: APP_URL,
        });
        setShared(true);
        setTimeout(() => setShared(false), 3000);
      } catch (e) {
        if (e.name !== 'AbortError') handleCopyLink();
      }
    } else {
      handleCopyLink();
    }
  }, []);

  /* ── Copy link fallback ── */
  const handleCopyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(APP_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback for older browsers
      const ta = document.createElement('textarea');
      ta.value = APP_URL;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  }, []);

  /* ── Install PWA ── */
  const handleInstall = async () => {
    if (deferredPrompt) {
      setInstalling(true);
      try {
        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
      } catch { /* ignore */ }
      setDeferredPrompt(null);
      setInstalling(false);
    } else if (isIOS()) {
      setShowIOSGuide(true);
    } else {
      setShowIOSGuide(true);
    }
  };

  /* ── Navigate to a mode ── */
  const handleFeatureClick = (mode) => {
    if (mode === 'scoreboard') {
      window.location.href = '/lotto-scoreboard.html';
    } else {
      onModeChange(mode);
      onDismiss();
    }
  };

  /* ── Dismiss screen ── */
  const handleGetStarted = () => {
    onDismiss();
  };

  /* ── iOS Guide overlay ── */
  if (showIOSGuide) {
    return (
      <div className="mas-overlay" onClick={() => setShowIOSGuide(false)}>
        <div className="mas-ios-guide" onClick={e => e.stopPropagation()}>
          <button className="mas-ios-guide__close" onClick={() => setShowIOSGuide(false)}>×</button>
          <div className="mas-ios-guide__icon">📲</div>
          <h3 className="mas-ios-guide__title">Install Lotto App</h3>
          <div className="mas-ios-guide__steps">
            {isIOS() ? (
              <>
                <div className="mas-ios-step">
                  <span className="mas-ios-step__num">1</span>
                  <span>Tap the <strong>Share</strong> button <span style={{fontSize:18}}>⎋</span> at the bottom</span>
                </div>
                <div className="mas-ios-step">
                  <span className="mas-ios-step__num">2</span>
                  <span>Scroll and tap <strong>"Add to Home Screen"</strong></span>
                </div>
                <div className="mas-ios-step">
                  <span className="mas-ios-step__num">3</span>
                  <span>Tap <strong>"Add"</strong> — done!</span>
                </div>
              </>
            ) : (
              <>
                <div className="mas-ios-step">
                  <span className="mas-ios-step__num">1</span>
                  <span>Tap <strong>⋮</strong> menu in your browser</span>
                </div>
                <div className="mas-ios-step">
                  <span className="mas-ios-step__num">2</span>
                  <span>Tap <strong>"Install app"</strong> or <strong>"Add to Home screen"</strong></span>
                </div>
                <div className="mas-ios-step">
                  <span className="mas-ios-step__num">3</span>
                  <span>Open from your home screen!</span>
                </div>
              </>
            )}
          </div>
          <button className="mas-ios-guide__btn" onClick={() => setShowIOSGuide(false)}>Got it</button>
        </div>
      </div>
    );
  }

  return (
    <div className="mas">
      {/* ── Animated background ── */}
      <div className="mas__bg">
        <div className="mas__orb mas__orb--1" />
        <div className="mas__orb mas__orb--2" />
        <div className="mas__orb mas__orb--3" />
      </div>

      {/* ── Top bar ── */}
      <div className={`mas__topbar${animStep >= 1 ? ' mas--visible' : ''}`}>
        <div className="mas__topbar-brand">
          <span className="mas__logo">🎰</span>
          <span className="mas__brandname">Lotto Extraction</span>
        </div>
        <button className="mas__skip" onClick={handleGetStarted}>
          Skip →
        </button>
      </div>

      {/* ── Hero section ── */}
      <div className="mas__hero">
        <div className={`mas__app-icon${animStep >= 2 ? ' mas--pop' : ''}`}>
          <span className="mas__app-icon-emoji">🎰</span>
          <div className="mas__app-icon-ring" />
        </div>

        <h1 className={`mas__title${animStep >= 2 ? ' mas--visible' : ''}`}>
          Real Lottery<br />
          <span className="mas__title-gradient">Results & Predictions</span>
        </h1>

        <p className={`mas__subtitle${animStep >= 3 ? ' mas--visible' : ''}`}>
          Official data from 46 US states.<br/>
          Extract, predict, and win smarter.
        </p>

        {/* ── Animated balls row ── */}
        <div className={`mas__balls${animStep >= 3 ? ' mas--visible' : ''}`}>
          {['07','14','32','45','61'].map((n, i) => (
            <div key={n} className="mas__ball" style={{ animationDelay: `${0.6 + i * 0.1}s` }}>
              {n}
            </div>
          ))}
          <div className="mas__ball mas__ball--power" style={{ animationDelay: '1.1s' }}>
            20
          </div>
        </div>
      </div>

      {/* ── App Link section (the main CTA) ── */}
      <div className={`mas__link-section${animStep >= 4 ? ' mas--visible' : ''}`}>
        <div className="mas__link-card">
          <div className="mas__link-header">
            <span className="mas__link-icon">🔗</span>
            <span className="mas__link-title">Share App Link</span>
          </div>
          <div className="mas__link-url">
            <span className="mas__link-url-text">{APP_URL.replace(/^https?:\/\//, '')}</span>
            <button
              className={`mas__link-copy${copied ? ' mas__link-copy--done' : ''}`}
              onClick={handleCopyLink}
            >
              {copied ? '✓ Copied' : '📋 Copy'}
            </button>
          </div>
          <div className="mas__link-actions">
            <button className="mas__share-btn" onClick={handleShare}>
              {shared ? '✓ Shared!' : '📤 Share App'}
            </button>
            {!isStandalone() && (
              <button className="mas__install-btn" onClick={handleInstall} disabled={installing}>
                {installing ? '⏳' : '📲'} {deferredPrompt ? 'Install App' : 'Add to Home'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Highlight pills ── */}
      <div className={`mas__highlights${animStep >= 4 ? ' mas--visible' : ''}`}>
        {HIGHLIGHTS.map((h, i) => (
          <span key={i} className="mas__highlight-pill">
            <span>{h.icon}</span> {h.text}
          </span>
        ))}
      </div>

      {/* ── Feature cards ── */}
      <div className={`mas__features${animStep >= 5 ? ' mas--visible' : ''}`}>
        {FEATURES.map((f, i) => (
          <button
            key={f.mode}
            className="mas__feature-card"
            onClick={() => handleFeatureClick(f.mode)}
            style={{ animationDelay: `${i * 0.12}s` }}
          >
            <div className="mas__feature-icon">{f.icon}</div>
            <div className="mas__feature-info">
              <div className="mas__feature-title">{f.title}</div>
              <div className="mas__feature-desc">{f.desc}</div>
            </div>
            <span className="mas__feature-arrow">→</span>
          </button>
        ))}
      </div>

      {/* ── Bottom CTA ── */}
      <div className={`mas__bottom${animStep >= 6 ? ' mas--visible' : ''}`}>
        <button className="mas__cta" onClick={handleGetStarted}>
          Get Started
        </button>
        <p className="mas__footer-text">
          Free to use · No sign-up required · Real data only
        </p>
      </div>
    </div>
  );
}
