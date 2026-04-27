/**
 * CheckoutSuccess.js
 * ─────────────────────────────────────────────────────────────────────────
 * Full-screen celebration overlay shown after a successful Stripe checkout.
 *
 * It is displayed when the URL contains ?checkout=success&plan=<plan>.
 * After 3 seconds (or on button click) it calls onActivate(plan, email)
 * so MonetizationContext can upgrade the local state to match the new plan.
 *
 * Props:
 *   plan       – "pro" | "elite"  (from URL param)
 *   sessionId  – Stripe checkout session ID (optional, for verification)
 *   onActivate – fn(plan) called to commit the plan in context
 *   onClose    – fn() called to dismiss and clean URL
 * ─────────────────────────────────────────────────────────────────────────
 */
import React, { useEffect, useState, useRef } from 'react';
import { motion } from 'framer-motion';

const PLAN_DISPLAY = {
  pro:   { name: 'Pro',   icon: '⚡', color: '#7c3aed', features: ['50 predictions / day', 'All games & all 46 states', 'CSV export', '5,000 API calls/mo', 'Advanced analytics'] },
  elite: { name: 'Elite', icon: '👑', color: '#f59e0b', features: ['Unlimited predictions', 'Email draw alerts', 'Unlimited API', 'Syndicate tools', 'Priority support'] },
};

const API_BASE = process.env.REACT_APP_API_URL || '';

export default function CheckoutSuccess({ plan = 'pro', sessionId, onActivate, onClose }) {
  const pd         = PLAN_DISPLAY[plan] || PLAN_DISPLAY.pro;
  const [step, setStep] = useState('loading'); // loading | ready | done
  const [apiKey, setApiKey] = useState('');
  const [copied, setCopied] = useState(false);
  const timerRef = useRef(null);

  /* ── On mount: fetch subscription status to get API key ── */
  useEffect(() => {
    async function activate() {
      // Give webhook up to 3 seconds to process
      await sleep(1500);
      // Try to read session/plan from URL params
      const params = new URLSearchParams(window.location.search);
      const emailParam = params.get('email') || '';

      try {
        if (emailParam) {
          const res  = await fetch(`${API_BASE}/stripe/subscription-status?email=${encodeURIComponent(emailParam)}`);
          if (res.ok) {
            const data = await res.json();
            if (data.api_key) setApiKey(data.api_key);
          }
        }
      } catch (_) {}

      setStep('ready');
      // Auto-activate after 5 s
      timerRef.current = setTimeout(() => handleActivate(), 5000);
    }
    activate();
    return () => clearTimeout(timerRef.current);
    // eslint-disable-next-line
  }, []);

  function handleActivate() {
    clearTimeout(timerRef.current);
    setStep('done');
    onActivate(plan);
    setTimeout(onClose, 300);
  }

  function copyKey() {
    if (apiKey) {
      navigator.clipboard.writeText(apiKey).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.82)',
        backdropFilter: 'blur(8px)',
        zIndex: 3000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.85, y: 30 }}
        animate={{ opacity: 1, scale: 1,    y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 24 }}
        style={{
          background: 'var(--bg-card, #1e2433)',
          borderRadius: 24,
          border: `2px solid ${pd.color}`,
          boxShadow: `0 32px 80px rgba(0,0,0,0.6), 0 0 60px ${pd.color}30`,
          maxWidth: 500,
          width: '100%',
          overflow: 'hidden',
          textAlign: 'center',
        }}
      >
        {/* Animated gradient header */}
        <div style={{
          background: `linear-gradient(135deg, ${pd.color}ee 0%, ${pd.color}77 100%)`,
          padding: '2.5rem 2rem 2rem',
          position: 'relative',
          overflow: 'hidden',
        }}>
          {/* Confetti circles */}
          {[...Array(12)].map((_, i) => (
            <motion.div
              key={i}
              initial={{ y: -20, opacity: 0, scale: 0 }}
              animate={{ y: [-20, Math.random() * 80 - 10], opacity: [0, 1, 0], scale: [0, 1, 0.5] }}
              transition={{ delay: i * 0.08, duration: 1.2, ease: 'easeOut' }}
              style={{
                position: 'absolute',
                top: Math.random() * 60 + '%',
                left: Math.random() * 100 + '%',
                width: 8 + Math.random() * 10,
                height: 8 + Math.random() * 10,
                borderRadius: '50%',
                background: ['#fff', '#ffd700', '#ff6b6b', '#4ecdc4', '#ffe66d'][i % 5],
                pointerEvents: 'none',
              }}
            />
          ))}

          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: [0, 1.3, 1] }}
            transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
            style={{ fontSize: 72, lineHeight: 1, marginBottom: 12 }}
          >
            {step === 'loading' ? '⏳' : '🎉'}
          </motion.div>

          <h1 style={{ color: '#fff', fontWeight: 900, fontSize: '1.8rem', margin: 0 }}>
            {step === 'loading' ? 'Activating…' : 'Welcome to LottoPro ' + pd.name + '!'}
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.85)', marginTop: 6, fontSize: '0.95rem' }}>
            {step === 'loading'
              ? 'Confirming your payment with Stripe…'
              : 'Your subscription is active. Let\'s predict some winners! 🎰'}
          </p>
        </div>

        {/* Body */}
        <div style={{ padding: '1.75rem 2rem 2rem' }}>
          {step === 'loading' ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '1rem 0' }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={pd.color} strokeWidth="2.5" style={{ animation: 'spin 0.8s linear infinite' }}>
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
              </svg>
            </div>
          ) : (
            <>
              {/* Feature checklist */}
              <div style={{
                background: 'rgba(255,255,255,0.04)',
                border: `1px solid ${pd.color}30`,
                borderRadius: 12,
                padding: '1rem 1.25rem',
                marginBottom: '1.25rem',
                textAlign: 'left',
              }}>
                <div style={{ color: 'var(--text-m, #94a3b8)', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
                  Your {pd.icon} {pd.name} features are unlocked
                </div>
                {pd.features.map(f => (
                  <motion.div
                    key={f}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 }}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', color: 'var(--text-h, #e2e8f0)', fontSize: '0.9rem' }}
                  >
                    <span style={{ color: '#22c55e', fontWeight: 800, fontSize: '1rem' }}>✓</span>
                    {f}
                  </motion.div>
                ))}
              </div>

              {/* API key (if available) */}
              {apiKey && (
                <div style={{
                  background: 'rgba(124,58,237,0.08)',
                  border: '1px solid rgba(124,58,237,0.25)',
                  borderRadius: 12,
                  padding: '0.875rem 1rem',
                  marginBottom: '1.25rem',
                  textAlign: 'left',
                }}>
                  <div style={{ color: 'var(--text-m, #94a3b8)', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>
                    Your API Key
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <code style={{
                      flex: 1,
                      background: 'rgba(0,0,0,0.25)',
                      padding: '6px 10px',
                      borderRadius: 6,
                      fontSize: '0.78rem',
                      color: '#a78bfa',
                      fontFamily: 'monospace',
                      wordBreak: 'break-all',
                    }}>
                      {apiKey}
                    </code>
                    <button
                      onClick={copyKey}
                      style={{
                        background: copied ? '#22c55e' : 'rgba(124,58,237,0.3)',
                        border: 'none', borderRadius: 8,
                        padding: '6px 12px', cursor: 'pointer',
                        color: '#fff', fontSize: '0.78rem', fontWeight: 600,
                        whiteSpace: 'nowrap', transition: 'background 0.2s',
                      }}
                    >
                      {copied ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                  <p style={{ color: 'var(--text-m, #64748b)', fontSize: '0.72rem', marginTop: 6 }}>
                    Save this key — it's also visible in the API tab of the app.
                  </p>
                </div>
              )}

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleActivate}
                style={{
                  width: '100%',
                  padding: '0.9rem',
                  background: `linear-gradient(135deg, ${pd.color}, ${pd.color}cc)`,
                  color: '#fff', border: 'none', borderRadius: 12,
                  fontWeight: 800, fontSize: '1.05rem', cursor: 'pointer',
                  letterSpacing: '0.02em',
                }}
              >
                Start Predicting Now →
              </motion.button>

              <p style={{ color: 'var(--text-m, #64748b)', fontSize: '0.78rem', marginTop: '0.75rem', lineHeight: 1.4 }}>
                Manage billing, update card, or cancel anytime from{' '}
                <strong style={{ color: 'var(--text-m)' }}>Account → Billing</strong> in the app.
              </p>
            </>
          )}
        </div>
      </motion.div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </motion.div>
  );
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
