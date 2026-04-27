/**
 * PlanBadge.js
 * Compact header badge showing current plan + usage meter.
 * Includes a "Sign In" input so admins can unlock elite access by email.
 */
import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { useMonetization, PLANS } from './MonetizationContext';

export default function PlanBadge() {
  const { plan, planConfig, usage, setShowPricing, loginAsAdmin } = useMonetization();
  const limit = planConfig.limits.predictionsPerDay;
  const used  = usage.predictionsToday;
  const pct   = limit >= 999 ? 100 : Math.min((used / limit) * 100, 100);
  const low   = pct >= 80 && limit < 999;

  const [showLogin, setShowLogin] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginMsg, setLoginMsg] = useState('');

  function handleLogin(e) {
    e.preventDefault();
    const ok = loginAsAdmin(loginEmail);
    if (ok) {
      setLoginMsg('✅ Elite access granted!');
      setShowLogin(false);
      setLoginEmail('');
    } else {
      setLoginMsg('❌ Email not recognized. Use your account email.');
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <motion.button
        className={`plan-badge-btn${low ? ' plan-badge-btn--low' : ''}`}
        style={{ '--pc': planConfig.color }}
        onClick={() => setShowPricing(true)}
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.97 }}>

        <span className="pb-icon">{planConfig.icon}</span>
        <div className="pb-body">
          <div className="pb-name">
            {planConfig.name} Plan
            {plan === 'free' && (
              <span className="pb-upgrade"> · View Pricing ↗</span>
            )}
          </div>
          {limit < 999 ? (
            <div className="pb-usage">
              <div className="pb-track">
                <div className="pb-fill" style={{ width: `${pct}%`, background: low ? '#ef4444' : planConfig.color }} />
              </div>
              <span className="pb-count">{used}/{limit} predictions today</span>
            </div>
          ) : (
            <div className="pb-unlimited">Unlimited predictions</div>
          )}
        </div>
      </motion.button>

      {/* ── Sign In / Account button ── */}
      {plan === 'free' ? (
        <button
          onClick={() => { setShowLogin(v=>!v); setLoginMsg(''); }}
          style={{
            background: 'rgba(245,158,11,0.15)',
            border: '1px solid rgba(245,158,11,0.5)',
            color: '#f59e0b',
            borderRadius: 8,
            padding: '5px 12px',
            fontSize: '.75rem',
            fontWeight: 700,
            cursor: 'pointer',
            letterSpacing: '.3px',
          }}
        >
          🔑 Sign In
        </button>
      ) : (
        <span style={{ fontSize: '.72rem', color: '#4ade80', fontWeight: 700 }}>
          👑 {planConfig.name} Active
        </span>
      )}

      {/* ── Login dropdown ── */}
      {showLogin && (
        <form onSubmit={handleLogin} style={{
          display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap',
          background: 'rgba(15,23,42,0.97)',
          border: '1px solid rgba(245,158,11,0.4)',
          borderRadius: 10,
          padding: '8px 12px',
          position: 'absolute',
          top: 56,
          right: 8,
          zIndex: 1000,
          minWidth: 280,
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}>
          <div style={{ width: '100%', fontSize: '.78rem', color: '#94a3b8', marginBottom: 4 }}>
            Enter your account email for full access:
          </div>
          <input
            type="email"
            value={loginEmail}
            onChange={e=>setLoginEmail(e.target.value)}
            placeholder="your@email.com"
            autoFocus
            style={{
              flex: 1,
              background: '#0f172a',
              border: '1px solid #334155',
              color: '#f1f5f9',
              borderRadius: 6,
              padding: '6px 10px',
              fontSize: '.82rem',
              minWidth: 180,
            }}
          />
          <button type="submit" style={{
            background: '#f59e0b',
            color: '#000',
            border: 'none',
            borderRadius: 6,
            padding: '6px 14px',
            fontWeight: 800,
            fontSize: '.8rem',
            cursor: 'pointer',
          }}>
            Sign In
          </button>
          <button type="button" onClick={()=>setShowLogin(false)} style={{
            background: 'transparent',
            border: '1px solid #334155',
            color: '#64748b',
            borderRadius: 6,
            padding: '6px 10px',
            cursor: 'pointer',
            fontSize: '.8rem',
          }}>
            Cancel
          </button>
          {loginMsg && (
            <div style={{
              width: '100%',
              fontSize: '.78rem',
              fontWeight: 700,
              color: loginMsg.startsWith('✅') ? '#4ade80' : '#f87171',
              marginTop: 4,
            }}>
              {loginMsg}
            </div>
          )}
        </form>
      )}
    </div>
  );
}
