/**
 * StripeCheckout.js
 * ─────────────────────────────────────────────────────────────────────────
 * Modal that collects the user's email, calls the backend
 * POST /stripe/create-checkout-session, then redirects to Stripe's
 * hosted Checkout page.
 *
 * Props:
 *   plan     – "pro" | "elite"
 *   billing  – "monthly" | "annual"
 *   onClose  – called when the modal is dismissed
 *
 * The backend URL is read from REACT_APP_API_URL (defaults to same origin).
 * ─────────────────────────────────────────────────────────────────────────
 */
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PLANS } from './MonetizationContext';

const API_BASE = process.env.REACT_APP_API_URL || '';

const PLAN_COLORS = {
  pro:   { bg: '#7c3aed', light: 'rgba(124,58,237,0.12)', border: '#7c3aed' },
  elite: { bg: '#f59e0b', light: 'rgba(245,158,11,0.12)', border: '#f59e0b' },
};

export default function StripeCheckout({ plan, billing = 'monthly', onClose, onMockUpgrade }) {
  const [email,   setEmail]   = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  // ── Admin / owner bypass (no payment required) ──
  const ADMIN_EMAILS = ['safyre@mac.com'];

  const planCfg   = PLANS[plan] || PLANS.pro;
  const colors    = PLAN_COLORS[plan] || PLAN_COLORS.pro;
  const monthlyPrice = plan === 'pro' ? 9.99 : 29.99;
  const annualPrice  = plan === 'pro' ? 7.99 : 23.99;
  const price     = billing === 'annual' ? annualPrice : monthlyPrice;
  const saving    = billing === 'annual' ? Math.round((1 - annualPrice / monthlyPrice) * 100) : 0;

  async function handleCheckout(e) {
    e.preventDefault();
    setError('');

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Please enter a valid email address.');
      return;
    }

    // ── Admin / owner: grant elite access instantly without payment ──
    if (ADMIN_EMAILS.includes(email.trim().toLowerCase())) {
      if (onMockUpgrade) onMockUpgrade('elite');
      // Store email so we remember on reload
      try { localStorage.setItem('lotto_admin_email', email.trim().toLowerCase()); } catch {}
      onClose();
      return;
    }

    setLoading(true);
    try {
      const res  = await fetch(`${API_BASE}/stripe/create-checkout-session`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ plan, billing, email }),
      });
      const data = await res.json();

      if (!res.ok) {
        // Common friendly messages
        if (res.status === 503) {
          setError('🔧 Stripe is not configured yet. See STRIPE_SETUP.md to add your keys.');
        } else if (res.status === 400 && data.detail?.includes('Price ID')) {
          setError('💳 Stripe products not set up yet. Add price IDs in your .env file.');
        } else {
          setError(data.detail || 'Unable to start checkout. Please try again.');
        }
        setLoading(false);
        return;
      }

      // Redirect to Stripe Checkout
      if (data.checkout_url) {
        window.location.href = data.checkout_url;
      } else {
        setError('Unexpected response from server. Please try again.');
        setLoading(false);
      }
    } catch (err) {
      setError('Network error — please check your connection and try again.');
      setLoading(false);
    }
  }

  return (
    <AnimatePresence>
      {/* Backdrop */}
      <motion.div
        key="backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.65)',
          backdropFilter: 'blur(4px)',
          zIndex: 2000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '1rem',
        }}
      >
        {/* Modal */}
        <motion.div
          key="modal"
          initial={{ opacity: 0, scale: 0.92, y: 20 }}
          animate={{ opacity: 1, scale: 1,    y: 0 }}
          exit={{   opacity: 0, scale: 0.92, y: 20 }}
          transition={{ type: 'spring', stiffness: 300, damping: 28 }}
          onClick={ev => ev.stopPropagation()}
          style={{
            background: 'var(--bg-card, #1e2433)',
            borderRadius: 20,
            border: `2px solid ${colors.border}`,
            boxShadow: `0 24px 60px rgba(0,0,0,0.5), 0 0 0 1px ${colors.border}40`,
            maxWidth: 440,
            width: '100%',
            overflow: 'hidden',
          }}
        >
          {/* Header gradient */}
          <div style={{
            background: `linear-gradient(135deg, ${colors.bg}ee, ${colors.bg}99)`,
            padding: '1.5rem 2rem 1.25rem',
            position: 'relative',
          }}>
            <button
              onClick={onClose}
              style={{
                position: 'absolute', top: 12, right: 12,
                background: 'rgba(255,255,255,0.15)',
                border: 'none', borderRadius: '50%',
                width: 30, height: 30, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontSize: 18, lineHeight: 1,
              }}
              aria-label="Close"
            >×</button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <span style={{ fontSize: 36 }}>{planCfg.icon}</span>
              <div>
                <div style={{ color: '#fff', fontWeight: 800, fontSize: '1.3rem' }}>
                  Upgrade to {planCfg.name}
                </div>
                <div style={{ color: 'rgba(255,255,255,0.85)', fontSize: '0.875rem' }}>
                  Powered by Stripe — secure checkout
                </div>
              </div>
            </div>

            {/* Price display */}
            <div style={{
              background: 'rgba(255,255,255,0.15)',
              borderRadius: 12,
              padding: '0.75rem 1rem',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div>
                <span style={{ color: '#fff', fontWeight: 800, fontSize: '1.6rem' }}>
                  ${price.toFixed(2)}
                </span>
                <span style={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.85rem', marginLeft: 4 }}>
                  / mo{billing === 'annual' ? ' (billed annually)' : ''}
                </span>
              </div>
              {saving > 0 && (
                <div style={{
                  background: '#22c55e',
                  color: '#fff', fontWeight: 700, fontSize: '0.75rem',
                  padding: '4px 10px', borderRadius: 20,
                }}>
                  Save {saving}%
                </div>
              )}
            </div>
          </div>

          {/* Form body */}
          <div style={{ padding: '1.75rem 2rem' }}>
            {/* Feature highlights */}
            <div style={{
              background: colors.light,
              border: `1px solid ${colors.border}30`,
              borderRadius: 10,
              padding: '0.75rem 1rem',
              marginBottom: '1.25rem',
            }}>
              <div style={{ color: 'var(--text-m, #94a3b8)', fontSize: '0.8rem', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                What you get
              </div>
              {plan === 'pro' ? (
                <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {['50 predictions / day', 'All games & all 46 states', 'CSV export + advanced analytics', '5,000 API calls / month', 'Hot/Cold alerts'].map(f => (
                    <li key={f} style={{ color: 'var(--text-h, #e2e8f0)', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ color: colors.bg, fontWeight: 700 }}>✓</span> {f}
                    </li>
                  ))}
                </ul>
              ) : (
                <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {['Unlimited predictions', 'Email draw alerts', 'Full API access (unlimited)', 'Syndicate tools + white-label', 'Priority support'].map(f => (
                    <li key={f} style={{ color: 'var(--text-h, #e2e8f0)', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ color: colors.bg, fontWeight: 700 }}>✓</span> {f}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <form onSubmit={handleCheckout}>
              <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-m, #94a3b8)', fontSize: '0.85rem', fontWeight: 600 }}>
                Your email address
              </label>
              <input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                disabled={loading}
                style={{
                  width: '100%',
                  padding: '0.75rem 1rem',
                  borderRadius: 10,
                  border: `2px solid ${error ? '#ef4444' : 'rgba(148,163,184,0.2)'}`,
                  background: 'var(--bg-input, rgba(255,255,255,0.05))',
                  color: 'var(--text-h, #e2e8f0)',
                  fontSize: '1rem',
                  outline: 'none',
                  boxSizing: 'border-box',
                  transition: 'border-color 0.2s',
                }}
                onFocus={e => e.target.style.borderColor = colors.border}
                onBlur={e => e.target.style.borderColor = error ? '#ef4444' : 'rgba(148,163,184,0.2)'}
              />

              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  style={{
                    marginTop: 8, padding: '0.6rem 0.8rem',
                    background: 'rgba(239,68,68,0.12)',
                    border: '1px solid rgba(239,68,68,0.35)',
                    borderRadius: 8,
                    color: '#fca5a5', fontSize: '0.83rem', lineHeight: 1.4,
                  }}
                >
                  {error}
                </motion.div>
              )}

              <button
                type="submit"
                disabled={loading}
                style={{
                  width: '100%',
                  marginTop: '1rem',
                  padding: '0.85rem',
                  background: loading
                    ? 'rgba(148,163,184,0.2)'
                    : `linear-gradient(135deg, ${colors.bg}, ${colors.bg}cc)`,
                  color: '#fff',
                  border: 'none',
                  borderRadius: 12,
                  fontWeight: 700,
                  fontSize: '1rem',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  letterSpacing: '0.02em',
                  transition: 'opacity 0.2s, transform 0.1s',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
              >
                {loading ? (
                  <>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: 'spin 0.8s linear infinite' }}>
                      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                    </svg>
                    Redirecting to Stripe…
                  </>
                ) : (
                  <>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M20 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z"/>
                    </svg>
                    Continue to Secure Checkout
                  </>
                )}
              </button>
            </form>

            {/* Trust signals */}
            <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, flexWrap: 'wrap' }}>
              {[
                { icon: '🔒', text: 'SSL secured' },
                { icon: '💳', text: 'Powered by Stripe' },
                { icon: '↩️', text: '7-day refund' },
              ].map(({ icon, text }) => (
                <div key={text} style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-m, #64748b)', fontSize: '0.75rem' }}>
                  <span>{icon}</span><span>{text}</span>
                </div>
              ))}
            </div>

            <p style={{ textAlign: 'center', color: 'var(--text-m, #64748b)', fontSize: '0.72rem', marginTop: '0.75rem', lineHeight: 1.4 }}>
              By continuing you agree to our Terms of Service. Cancel anytime from your billing portal.
            </p>
          </div>
        </motion.div>
      </motion.div>

      {/* Spinner keyframe */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </AnimatePresence>
  );
}
