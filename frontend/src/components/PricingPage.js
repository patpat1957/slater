/**
 * PricingPage.js
 * Full-screen pricing / plans page with feature matrix, CTAs, FAQ, and testimonials.
 */
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMonetization, PLANS, FEATURE_MATRIX } from './MonetizationContext';

/* ── Checkmark / X ── */
function Cell({ val, planColor }) {
  if (val === true)  return <span style={{ color: '#10b981', fontWeight: 800, fontSize: 17 }}>✓</span>;
  if (val === false) return <span style={{ color: 'rgba(255,255,255,0.15)', fontSize: 15 }}>—</span>;
  return <span style={{ color: planColor || '#e8eaf0', fontWeight: 600, fontSize: 13 }}>{val}</span>;
}

/* ── Testimonials ── */
const TESTIMONIALS = [
  { name: 'Marcus T.',   state: 'CA', quote: 'Predicted CA Pick 3 box 4 times in one week. Pro tier paid for itself in day one.', stars: 5 },
  { name: 'Sandra R.',   state: 'TX', quote: 'The frequency charts are incredible. I can spot patterns I never noticed before.', stars: 5 },
  { name: 'James K.',    state: 'NY', quote: 'Elite tier — the API access lets me build my own tools on top. Game changer.', stars: 5 },
  { name: 'Priya M.',    state: 'FL', quote: 'Free tier got me hooked, upgraded to Pro the same day. Worth every penny.', stars: 5 },
];

/* ── FAQ ── */
const FAQ = [
  { q: 'How does the prediction engine work?',
    a: 'We use 6 mathematical strategies: Mirror (+5), Rundown (+1/+2/+3), position-overdue analysis, sum targeting, hot/cold digit tracking, and pair-frequency analysis — all derived from real historical draw data.' },
  { q: 'Is this guaranteed to win?',
    a: 'No. Lottery draws are random and no strategy guarantees a win. Our tools are statistical analysis aids for entertainment and research purposes only. Please play responsibly.' },
  { q: 'Can I cancel at any time?',
    a: 'Yes. Downgrade back to Free at any time from your account dashboard — no questions asked.' },
  { q: 'What does the REST API include?',
    a: 'Pro & Elite API access includes endpoints for historical draw data, prediction generation, frequency analysis, and CSV export — all documented via Swagger/ReDoc.' },
  { q: 'How many states are supported?',
    a: 'We currently support 46 US states. Free tier is limited to 5 states; Pro and Elite unlock all 46.' },
  { q: 'What payment methods do you accept?',
    a: 'We accept all major credit cards, debit cards, and PayPal via Stripe (coming soon). Cancel anytime.' },
];

export default function PricingPage({ onClose }) {
  const { plan, upgradeTo, downgradeToFree } = useMonetization();
  const [billingCycle, setBillingCycle] = useState('monthly'); // 'monthly' | 'annual'
  const [openFaq, setOpenFaq] = useState(null);

  const discount = 0.2; // 20% annual discount
  const getPrice = (p) => {
    if (p.price === 0) return 'Free';
    const base = billingCycle === 'annual' ? p.price * (1 - discount) : p.price;
    return `$${base.toFixed(2)}`;
  };

  const planList = Object.values(PLANS);

  return (
    <motion.div className="pricing-overlay"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>

      <motion.div className="pricing-page"
        initial={{ opacity: 0, y: 32 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}>

        {/* Close */}
        {onClose && (
          <button className="pricing-close" onClick={onClose}>✕</button>
        )}

        {/* Hero */}
        <div className="pricing-hero">
          <div className="pricing-hero__orb pricing-hero__orb--1" />
          <div className="pricing-hero__orb pricing-hero__orb--2" />
          <div style={{ position: 'relative', zIndex: 2 }}>
            <motion.div className="predictor__badge" style={{ marginBottom: 16 }}
              initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
              💎 &nbsp;Simple, transparent pricing
            </motion.div>
            <h2 className="pricing-title">
              Pick the plan that <span className="gradient-text">wins for you</span>
            </h2>
            <p className="pricing-sub">
              Start free. Upgrade anytime. Cancel anytime.
            </p>

            {/* Billing toggle */}
            <div className="billing-toggle">
              <button
                className={`billing-btn${billingCycle === 'monthly' ? ' billing-btn--active' : ''}`}
                onClick={() => setBillingCycle('monthly')}>
                Monthly
              </button>
              <button
                className={`billing-btn${billingCycle === 'annual' ? ' billing-btn--active' : ''}`}
                onClick={() => setBillingCycle('annual')}>
                Annual
                <span className="billing-save">Save 20%</span>
              </button>
            </div>
          </div>
        </div>

        {/* Plan cards */}
        <div className="plan-cards">
          {planList.map((p, i) => {
            const isCurrent = plan === p.id;
            const isPopular = p.badge === 'Most Popular';
            const isBest    = p.badge === 'Best Value';
            return (
              <motion.div key={p.id}
                className={`plan-card${isPopular ? ' plan-card--popular' : ''}${isBest ? ' plan-card--best' : ''}`}
                style={{ '--plan-color': p.color, '--plan-color-light': p.colorLight }}
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}>

                {p.badge && (
                  <div className="plan-badge" style={{ background: p.color }}>
                    {p.badge}
                  </div>
                )}

                <div className="plan-card__icon">{p.icon}</div>
                <div className="plan-card__name">{p.name}</div>
                <div className="plan-card__price">
                  <span className="plan-price-val">{getPrice(p)}</span>
                  {p.price > 0 && <span className="plan-price-period">/{billingCycle === 'annual' ? 'mo, billed annually' : 'mo'}</span>}
                </div>

                {/* Key features list */}
                <ul className="plan-features">
                  <li><span className="pf-check" style={{ color: p.color }}>✓</span>
                    {p.limits.predictionsPerDay === 999 ? 'Unlimited' : p.limits.predictionsPerDay} predictions/day
                  </li>
                  <li><span className="pf-check" style={{ color: p.color }}>✓</span>
                    {p.limits.historicalDays >= 3000 ? '10-year' : p.limits.historicalDays === 365 ? '1-year' : '30-day'} history
                  </li>
                  <li><span className="pf-check" style={{ color: p.color }}>✓</span>
                    {p.limits.states === 999 ? 'All 46 states' : `${p.limits.states} states`}
                  </li>
                  <li><span className="pf-check" style={{ color: p.color }}>✓</span>
                    {p.limits.games.length > 1 ? 'All lottery games' : 'Pick 3 only'}
                  </li>
                  {p.limits.csvExport       && <li><span className="pf-check" style={{ color: p.color }}>✓</span> CSV export</li>}
                  {p.limits.apiAccess       && <li><span className="pf-check" style={{ color: p.color }}>✓</span> REST API access ({p.limits.apiCallsPerMonth?.toLocaleString()}/mo)</li>}
                  {p.limits.hotColdAlert    && <li><span className="pf-check" style={{ color: p.color }}>✓</span> Hot/Cold alerts</li>}
                  {p.limits.emailAlerts     && <li><span className="pf-check" style={{ color: p.color }}>✓</span> Email draw alerts</li>}
                  {p.limits.syndicateTools  && <li><span className="pf-check" style={{ color: p.color }}>✓</span> Syndicate tools</li>}
                  {p.limits.whiteLabel      && <li><span className="pf-check" style={{ color: p.color }}>✓</span> White-label API</li>}
                  {p.limits.prioritySupport && <li><span className="pf-check" style={{ color: p.color }}>✓</span> Priority support</li>}
                </ul>

                {/* CTA */}
                {isCurrent ? (
                  <div className="plan-cta plan-cta--current">
                    ✓ Current Plan
                  </div>
                ) : p.id === 'free' ? (
                  <button className="plan-cta plan-cta--downgrade" onClick={downgradeToFree}>
                    Downgrade to Free
                  </button>
                ) : (
                  <button
                    className="plan-cta plan-cta--upgrade"
                    style={{ background: `linear-gradient(135deg, ${p.color}, ${p.color}cc)` }}
                    onClick={() => upgradeTo(p.id, billingCycle)}>
                    {p.icon} Upgrade to {p.name}
                  </button>
                )}

                {p.price > 0 && (
                  <p className="plan-trial">7-day free trial · Cancel anytime</p>
                )}
              </motion.div>
            );
          })}
        </div>

        {/* Feature matrix */}
        <div className="feature-matrix">
          <h3 className="feature-matrix__title">Full Feature Comparison</h3>
          <div className="feature-table-wrap">
            <table className="feature-table">
              <thead>
                <tr>
                  <th>Feature</th>
                  {planList.map(p => (
                    <th key={p.id} style={{ color: p.color }}>{p.icon} {p.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {FEATURE_MATRIX.map((row, i) => (
                  <tr key={i} className={i % 2 === 0 ? 'ft-row--even' : ''}>
                    <td className="ft-label">{row.label}</td>
                    <td><Cell val={row.free}  planColor={PLANS.free.color} /></td>
                    <td><Cell val={row.pro}   planColor={PLANS.pro.color} /></td>
                    <td><Cell val={row.elite} planColor={PLANS.elite.color} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Testimonials */}
        <div className="testimonials">
          <h3 className="feature-matrix__title">What our members say</h3>
          <div className="testimonials-grid">
            {TESTIMONIALS.map((t, i) => (
              <motion.div key={i} className="testimonial-card"
                initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + i * 0.08 }}>
                <div className="testimonial-stars">{'★'.repeat(t.stars)}</div>
                <p className="testimonial-quote">"{t.quote}"</p>
                <div className="testimonial-author">{t.name} · {t.state}</div>
              </motion.div>
            ))}
          </div>
        </div>

        {/* FAQ */}
        <div className="faq-section">
          <h3 className="feature-matrix__title">Frequently Asked Questions</h3>
          {FAQ.map((item, i) => (
            <div key={i} className={`faq-item${openFaq === i ? ' faq-item--open' : ''}`}>
              <button className="faq-q" onClick={() => setOpenFaq(openFaq === i ? null : i)}>
                <span>{item.q}</span>
                <span className="faq-arrow">{openFaq === i ? '▲' : '▼'}</span>
              </button>
              <AnimatePresence>
                {openFaq === i && (
                  <motion.div className="faq-a"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25 }}>
                    <p>{item.a}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>

        {/* Money-back guarantee */}
        <div className="guarantee-banner">
          <span className="guarantee-icon">🛡️</span>
          <div>
            <div className="guarantee-title">30-Day Money-Back Guarantee</div>
            <div className="guarantee-sub">
              Not satisfied? Contact us within 30 days for a full refund — no questions asked.
            </div>
          </div>
        </div>

      </motion.div>
    </motion.div>
  );
}
