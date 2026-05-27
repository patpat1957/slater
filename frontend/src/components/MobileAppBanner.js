import React, { useState, useEffect, useCallback } from 'react';

/* ═══════════════════════════════════════════════════════════════
   MobileAppBanner — Smart PWA install prompt + mobile app banner
   Shows:
   1. Native install prompt (Chrome/Edge beforeinstallprompt)
   2. iOS "Add to Home Screen" instructions
   3. Dismissible — remembers via localStorage
═══════════════════════════════════════════════════════════════ */

const DISMISS_KEY = 'lotto_app_banner_dismissed';
const DISMISS_DAYS = 7; // Re-show after 7 days

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

function isAndroid() {
  return /Android/.test(navigator.userAgent);
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

function isMobile() {
  return /Mobi|Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
    || window.innerWidth <= 768;
}

export default function MobileAppBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showBanner, setShowBanner] = useState(false);
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installed, setInstalled] = useState(false);

  /* ── Check dismiss state ── */
  const isDismissed = useCallback(() => {
    try {
      const ts = localStorage.getItem(DISMISS_KEY);
      if (!ts) return false;
      const diff = Date.now() - parseInt(ts, 10);
      return diff < DISMISS_DAYS * 86400000;
    } catch { return false; }
  }, []);

  /* ── Listen for beforeinstallprompt (Chrome/Edge/Samsung) ── */
  useEffect(() => {
    if (isStandalone() || isDismissed()) return;

    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      if (isMobile()) setShowBanner(true);
    };

    window.addEventListener('beforeinstallprompt', handler);

    // If no prompt fires within 2s on mobile, show generic banner
    const fallback = setTimeout(() => {
      if (isMobile() && !isStandalone() && !isDismissed()) {
        setShowBanner(true);
      }
    }, 2000);

    // Listen for successful install
    window.addEventListener('appinstalled', () => {
      setInstalled(true);
      setShowBanner(false);
    });

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      clearTimeout(fallback);
    };
  }, [isDismissed]);

  /* ── Handle install click ── */
  const handleInstall = async () => {
    if (deferredPrompt) {
      setInstalling(true);
      try {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
          setInstalled(true);
        }
      } catch { /* ignore */ }
      setDeferredPrompt(null);
      setInstalling(false);
    } else if (isIOS()) {
      setShowIOSGuide(true);
    } else {
      // Generic: open in browser address bar prompt
      setShowIOSGuide(true);
    }
  };

  /* ── Dismiss ── */
  const handleDismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch {}
    setShowBanner(false);
    setShowIOSGuide(false);
  };

  if (!showBanner || isStandalone() || installed) return null;

  /* ── iOS Guide overlay ── */
  if (showIOSGuide) {
    return (
      <div className="mob-install-overlay" onClick={handleDismiss}>
        <div className="mob-install-guide" onClick={e => e.stopPropagation()}>
          <button className="mob-install-guide__close" onClick={handleDismiss}>×</button>
          <div className="mob-install-guide__icon">📲</div>
          <h3 className="mob-install-guide__title">Install Lotto App</h3>
          {isIOS() ? (
            <div className="mob-install-guide__steps">
              <div className="mob-install-step">
                <span className="mob-install-step__num">1</span>
                <span>Tap the <strong>Share</strong> button <span style={{fontSize:18}}>⎋</span> at the bottom of Safari</span>
              </div>
              <div className="mob-install-step">
                <span className="mob-install-step__num">2</span>
                <span>Scroll down and tap <strong>"Add to Home Screen"</strong> ➕</span>
              </div>
              <div className="mob-install-step">
                <span className="mob-install-step__num">3</span>
                <span>Tap <strong>"Add"</strong> — the app icon appears on your home screen!</span>
              </div>
            </div>
          ) : (
            <div className="mob-install-guide__steps">
              <div className="mob-install-step">
                <span className="mob-install-step__num">1</span>
                <span>Tap the <strong>menu</strong> button <span style={{fontSize:18}}>⋮</span> in your browser</span>
              </div>
              <div className="mob-install-step">
                <span className="mob-install-step__num">2</span>
                <span>Tap <strong>"Add to Home screen"</strong> or <strong>"Install app"</strong></span>
              </div>
              <div className="mob-install-step">
                <span className="mob-install-step__num">3</span>
                <span>Tap <strong>"Add"</strong> — open the app from your home screen!</span>
              </div>
            </div>
          )}
          <button className="mob-install-guide__btn" onClick={handleDismiss}>
            Got it
          </button>
        </div>
      </div>
    );
  }

  /* ── Main banner ── */
  return (
    <div className="mob-app-banner">
      <div className="mob-app-banner__inner">
        <div className="mob-app-banner__icon">
          <span className="mob-app-banner__logo">🎰</span>
        </div>
        <div className="mob-app-banner__text">
          <div className="mob-app-banner__name">Lotto Extraction</div>
          <div className="mob-app-banner__desc">
            {isIOS() ? 'Add to Home Screen for the best experience' : 'Install our free app for quick access'}
          </div>
        </div>
        <div className="mob-app-banner__actions">
          <button className="mob-app-banner__install" onClick={handleInstall} disabled={installing}>
            {installing ? '...' : deferredPrompt ? 'Install' : isIOS() ? 'Add' : 'Install'}
          </button>
          <button className="mob-app-banner__close" onClick={handleDismiss} aria-label="Close">×</button>
        </div>
      </div>
    </div>
  );
}
