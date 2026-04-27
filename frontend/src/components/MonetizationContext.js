/**
 * MonetizationContext.js
 * Central store for plan state, usage limits, and upgrade logic.
 *
 * Real Stripe flow:
 *   1. upgradeTo(plan, billing) → shows StripeCheckout modal
 *   2. User enters email → POST /stripe/create-checkout-session
 *   3. Browser redirects to Stripe Checkout
 *   4. Stripe redirects back to ?checkout=success&plan=<plan>
 *   5. App.js detects URL param → shows CheckoutSuccess overlay
 *   6. CheckoutSuccess calls activatePlan(plan) → updates local state
 *
 * manageSubscription(email) → POST /stripe/create-portal-session
 * checkSubscriptionStatus(email) → GET /stripe/subscription-status
 */
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const API_BASE = process.env.REACT_APP_API_URL || '';

/* ─── Plan definitions ─── */
export const PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    price: 0,
    icon: '🎟️',
    color: '#6b7280',
    colorLight: 'rgba(107,114,128,0.15)',
    limits: {
      predictionsPerDay: 50,
      historicalDays: 365,
      states: 999,
      games: ['pick3','pick4','fantasy5','cash5','daily4','cash3','daily3','superlotto','lotto647','powerball','megamil','lotto'],  // all games free during beta
      csvExport: false,
      apiAccess: false,
      advancedStats: false,
      multiGame: true,
      hotColdAlert: false,
      emailAlerts: false,
      prioritySupport: false,
    },
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    price: 9.99,
    icon: '⚡',
    color: '#7c3aed',
    colorLight: 'rgba(124,58,237,0.18)',
    badge: 'Most Popular',
    limits: {
      predictionsPerDay: 50,
      historicalDays: 365,
      states: 999,
      games: ['pick3','pick4','powerball','megamil','fantasy5','lotto647','daily4','cash3','superlotto'],
      csvExport: true,
      apiAccess: true,
      advancedStats: true,
      multiGame: true,
      hotColdAlert: true,
      emailAlerts: false,
      prioritySupport: false,
      apiCallsPerMonth: 5000,
    },
  },
  elite: {
    id: 'elite',
    name: 'Elite',
    price: 29.99,
    icon: '👑',
    color: '#f59e0b',
    colorLight: 'rgba(245,158,11,0.15)',
    badge: 'Best Value',
    limits: {
      predictionsPerDay: 999,
      historicalDays: 3650,
      states: 999,
      games: ['pick3','pick4','powerball','megamil','fantasy5','lotto647','daily4','cash3','superlotto'],
      csvExport: true,
      apiAccess: true,
      advancedStats: true,
      multiGame: true,
      hotColdAlert: true,
      emailAlerts: true,
      prioritySupport: true,
      apiCallsPerMonth: 999999,
      whiteLabel: true,
      syndicateTools: true,
    },
  },
};

export const FEATURE_MATRIX = [
  { key: 'predictionsPerDay', label: 'Daily Predictions',    free: '3 / day',     pro: '50 / day',    elite: 'Unlimited' },
  { key: 'historicalDays',    label: 'Historical Data',      free: '30 days',     pro: '1 year',      elite: '10 years'  },
  { key: 'states',            label: 'States',               free: '5 states',    pro: 'All 46',      elite: 'All 46'    },
  { key: 'games',             label: 'Games',                free: 'Pick 3 only', pro: 'All games',   elite: 'All games' },
  { key: 'csvExport',         label: 'CSV Export',           free: false,         pro: true,          elite: true        },
  { key: 'apiAccess',         label: 'REST API Access',      free: false,         pro: true,          elite: true        },
  { key: 'advancedStats',     label: 'Advanced Analytics',   free: false,         pro: true,          elite: true        },
  { key: 'hotColdAlert',      label: 'Hot/Cold Alerts',      free: false,         pro: true,          elite: true        },
  { key: 'emailAlerts',       label: 'Email Draw Alerts',    free: false,         pro: false,         elite: true        },
  { key: 'prioritySupport',   label: 'Priority Support',     free: false,         pro: false,         elite: true        },
  { key: 'syndicateTools',    label: 'Syndicate Tools',      free: false,         pro: false,         elite: true        },
  { key: 'whiteLabel',        label: 'White-Label API',      free: false,         pro: false,         elite: true        },
];

/* ─── Context ─── */
const MonetizationContext = createContext(null);

const STORAGE_KEY = 'lotto_plan_v1';

// ── Admin / owner accounts — elite access, no payment required ──
const ADMIN_EMAILS = ['safyre@mac.com'];

export function MonetizationProvider({ children }) {
  const [plan, setPlan]         = useState('free');
  const [usage, setUsage]       = useState({ predictionsToday: 0, lastReset: null, apiCallsThisMonth: 0, apiCallsMonthKey: null });
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [upgradeReason, setUpgradeReason] = useState('');
  const [apiKey, setApiKey]     = useState('');
  const [showPricing, setShowPricing] = useState(false);

  // ── Stripe Checkout modal state ──────────────────────────────
  // pendingCheckout = { plan: 'pro'|'elite', billing: 'monthly'|'annual' } | null
  const [pendingCheckout, setPendingCheckout] = useState(null);

  // ── Stripe Checkout success overlay ─────────────────────────
  // checkoutSuccess = { plan, sessionId } | null (set by App.js from URL params)
  const [checkoutSuccess, setCheckoutSuccess] = useState(null);

  /* Load from localStorage */
  useEffect(() => {
    try {
      // ── Admin email check: if admin email stored → always elite ──
      const adminEmail = localStorage.getItem('lotto_admin_email') || '';
      if (adminEmail && ADMIN_EMAILS.includes(adminEmail.toLowerCase())) {
        setPlan('elite');
        setApiKey('lk_el_ADMIN_FULLACCESS');
        return; // skip normal plan restore
      }

      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      if (saved.plan) setPlan(saved.plan);
      if (saved.apiKey) setApiKey(saved.apiKey);

      // Reset daily prediction usage if new day
      const today = new Date().toDateString();
      // Reset monthly API call counter if new calendar month
      const monthKey = new Date().toISOString().slice(0, 7); // e.g. "2026-03"
      const savedUsage = saved.usage || {};
      const resetPredictions = savedUsage.lastReset !== today;
      const resetMonthly = savedUsage.apiCallsMonthKey !== monthKey;
      setUsage({
        predictionsToday: resetPredictions ? 0 : (savedUsage.predictionsToday || 0),
        lastReset: today,
        apiCallsThisMonth: resetMonthly ? 0 : (savedUsage.apiCallsThisMonth || 0),
        apiCallsMonthKey: monthKey,
      });
    } catch {}
  }, []);

  /* Save to localStorage whenever plan/usage/apiKey changes */
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ plan, usage, apiKey }));
    } catch {}
  }, [plan, usage, apiKey]);

  const planConfig = PLANS[plan] || PLANS.free;

  /* Check if a feature is available */
  const canUse = useCallback((feature) => {
    const cfg = PLANS[plan] || PLANS.free;
    return !!cfg.limits[feature];
  }, [plan]);

  /* Check prediction usage */
  const canPredict = useCallback(() => {
    const cfg = PLANS[plan] || PLANS.free;
    return usage.predictionsToday < cfg.limits.predictionsPerDay;
  }, [plan, usage]);

  /* Consume a prediction slot */
  const consumePrediction = useCallback(() => {
    setUsage(u => ({ ...u, predictionsToday: u.predictionsToday + 1 }));
  }, []);

  /* Track a real API call (increments monthly counter stored in localStorage) */
  const trackApiCall = useCallback((count = 1) => {
    setUsage(u => ({ ...u, apiCallsThisMonth: (u.apiCallsThisMonth || 0) + count }));
  }, []);

  /* Gate: show upgrade modal if feature locked */
  const requirePlan = useCallback((feature, neededPlan = 'pro', reason = '') => {
    const cfg = PLANS[plan] || PLANS.free;
    if (!cfg.limits[feature]) {
      setUpgradeReason(reason || `Unlock ${feature} with ${neededPlan === 'elite' ? 'Elite' : 'Pro'}`);
      setShowUpgrade(true);
      return false;
    }
    return true;
  }, [plan]);

  /**
   * upgradeTo – the main entry point for initiating an upgrade.
   *
   * If Stripe is configured (backend will return a checkout URL):
   *   → shows StripeCheckout modal (pendingCheckout state)
   *
   * If Stripe is NOT configured (dev/demo mode):
   *   → falls back to the old mock instant-upgrade so the UI still works
   *
   * billing defaults to 'monthly' if not supplied.
   */
  const upgradeTo = useCallback((newPlan, billing = 'monthly') => {
    if (newPlan === 'free') {
      downgradeToFree();
      return;
    }
    // Show the Stripe checkout modal — it will call the backend
    setPendingCheckout({ plan: newPlan, billing });
    setShowUpgrade(false);
    setShowPricing(false);
  }, []); // eslint-disable-line

  /** Called by StripeCheckout when it needs to fall back (no keys configured) */
  const mockUpgrade = useCallback((newPlan) => {
    setPlan(newPlan);
    if (newPlan !== 'free') {
      const key = 'lk_' + newPlan.slice(0,2) + '_' + Math.random().toString(36).slice(2, 18).toUpperCase();
      setApiKey(key);
    }
    setPendingCheckout(null);
    setShowUpgrade(false);
    setShowPricing(false);
  }, []);

  /** Called by CheckoutSuccess after Stripe redirect — commits the new plan */
  const activatePlan = useCallback((newPlan, newApiKey = '') => {
    setPlan(newPlan);
    if (newApiKey) setApiKey(newApiKey);
    else if (newPlan !== 'free') {
      // Generate a local key if webhook hasn't fired yet
      const key = 'lk_' + newPlan.slice(0,2) + '_' + Math.random().toString(36).slice(2, 18).toUpperCase();
      setApiKey(key);
    }
    setCheckoutSuccess(null);
  }, []);

  /** loginAsAdmin: called when user types admin email into login field */
  const loginAsAdmin = useCallback((email) => {
    const e = (email || '').trim().toLowerCase();
    if (ADMIN_EMAILS.includes(e)) {
      setPlan('elite');
      setApiKey('lk_el_ADMIN_FULLACCESS');
      try { localStorage.setItem('lotto_admin_email', e); } catch {}
      return true;
    }
    return false;
  }, []);

  const downgradeToFree = useCallback(() => {
    setPlan('free');
    setApiKey('');
  }, []);

  /** Open Stripe Customer Portal for billing management */
  const manageSubscription = useCallback(async (email) => {
    try {
      const res  = await fetch(`${API_BASE}/stripe/create-portal-session`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email }),
      });
      const data = await res.json();
      if (data.portal_url) window.location.href = data.portal_url;
    } catch (err) {
      console.error('Failed to open billing portal', err);
    }
  }, []);

  /** Sync plan from backend (called after checkout success) */
  const checkSubscriptionStatus = useCallback(async (email) => {
    // ── Admin bypass ──
    if (email && ADMIN_EMAILS.includes(email.trim().toLowerCase())) {
      setPlan('elite');
      setApiKey('lk_el_ADMIN_FULLACCESS');
      try { localStorage.setItem('lotto_admin_email', email.trim().toLowerCase()); } catch {}
      return { plan: 'elite', api_key: 'lk_el_ADMIN_FULLACCESS' };
    }
    try {
      const res  = await fetch(`${API_BASE}/stripe/subscription-status?email=${encodeURIComponent(email)}`);
      if (!res.ok) return null;
      const data = await res.json();
      if (data.plan && data.plan !== 'free') {
        setPlan(data.plan);
        if (data.api_key) setApiKey(data.api_key);
      }
      return data;
    } catch {
      return null;
    }
  }, []);

  return (
    <MonetizationContext.Provider value={{
      plan, planConfig,
      usage, canPredict, consumePrediction, trackApiCall,
      canUse, requirePlan,
      upgradeTo, mockUpgrade, activatePlan, downgradeToFree,
      manageSubscription, checkSubscriptionStatus,
      loginAsAdmin,
      showUpgrade, setShowUpgrade, upgradeReason, setUpgradeReason,
      showPricing, setShowPricing,
      apiKey, setApiKey,
      pendingCheckout, setPendingCheckout,
      checkoutSuccess, setCheckoutSuccess,
    }}>
      {children}
    </MonetizationContext.Provider>
  );
}

export function useMonetization() {
  const ctx = useContext(MonetizationContext);
  if (!ctx) throw new Error('useMonetization must be used inside MonetizationProvider');
  return ctx;
}
