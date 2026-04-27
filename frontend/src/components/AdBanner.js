/**
 * AdBanner.js
 * Non-intrusive ad / affiliate placeholder banners for free-tier users.
 * Replace ad content with real affiliate links (e.g. lottery ticket sites,
 * number wheeling tools, syndicate services) or a Google AdSense unit.
 */
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMonetization } from './MonetizationContext';

const ADS = [
  {
    id: 1,
    type: 'affiliate',
    icon: '🎰',
    brand: 'theLotter',
    headline: 'Play official lotteries online',
    body: 'Buy official tickets for Powerball, Mega Millions & 50+ world lotteries',
    cta: 'Play Now →',
    badge: 'Partner',
    href: '#',                   // replace with affiliate link
    color: '#7c3aed',
  },
  {
    id: 2,
    type: 'affiliate',
    icon: '📱',
    brand: 'Jackpocket',
    headline: 'Order official lottery tickets from your phone',
    body: 'The official lottery app — order real tickets delivered to your account',
    cta: 'Download Free →',
    badge: 'Sponsored',
    href: '#',
    color: '#f59e0b',
  },
  {
    id: 3,
    type: 'upgrade',
    icon: '⚡',
    brand: 'LottoPro',
    headline: 'Remove ads & unlock all features',
    body: 'Upgrade to Pro for unlimited predictions, all states, CSV export, and API access',
    cta: 'Upgrade for $9.99/mo →',
    badge: 'Upgrade',
    href: null,
    color: '#10b981',
    isUpgradeAd: true,
  },
];

/* Rotates through ads on a timer */
export default function AdBanner({ position = 'bottom' }) {
  const { plan, setShowPricing } = useMonetization();
  const [current, setCurrent] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  // Only show ads on free plan
  if (plan !== 'free' || dismissed) return null;

  const ad = ADS[current % ADS.length];

  return (
    <AnimatePresence>
      {!dismissed && (
        <motion.div
          className={`ad-banner ad-banner--${position}`}
          key={current}
          initial={{ opacity: 0, y: position === 'bottom' ? 12 : -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: position === 'bottom' ? 12 : -12 }}
          transition={{ duration: 0.3 }}>

          <div className="ad-banner__inner" style={{ '--ad-color': ad.color }}>
            <span className="ad-label">AD</span>

            <span className="ad-icon">{ad.icon}</span>

            <div className="ad-body">
              <div className="ad-brand">
                {ad.brand}
                <span className="ad-badge" style={{ background: ad.color + '22', color: ad.color }}>{ad.badge}</span>
              </div>
              <div className="ad-headline">{ad.headline}</div>
              <div className="ad-desc">{ad.body}</div>
            </div>

            {ad.isUpgradeAd ? (
              <button className="ad-cta" style={{ background: ad.color }}
                onClick={() => setShowPricing(true)}>
                {ad.cta}
              </button>
            ) : (
              <a href={ad.href} target="_blank" rel="noreferrer noopener"
                className="ad-cta" style={{ background: ad.color, textDecoration: 'none' }}>
                {ad.cta}
              </a>
            )}

            <div className="ad-controls">
              <button className="ad-next" onClick={() => setCurrent(c => c + 1)} title="Next ad">›</button>
              <button className="ad-dismiss" onClick={() => setDismissed(true)} title="Dismiss">✕</button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ── Inline sponsored widget (for sidebar / between sections) ── */
export function SponsoredWidget() {
  const { plan } = useMonetization();
  if (plan !== 'free') return null;

  return (
    <div className="sponsored-widget">
      <div className="sw-label">Sponsored</div>
      <div className="sw-body">
        <span style={{ fontSize: 28 }}>🌐</span>
        <div>
          <div className="sw-title">Advertise here</div>
          <div className="sw-sub">Reach 50,000+ lottery players monthly</div>
        </div>
        <a href="mailto:ads@lottopro.app" className="sw-btn">Contact us</a>
      </div>
    </div>
  );
}
