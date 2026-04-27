/**
 * UpgradeModal.js
 * Compact modal shown when a user tries to access a locked feature.
 */
import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMonetization, PLANS } from './MonetizationContext';

export default function UpgradeModal() {
  const { showUpgrade, setShowUpgrade, upgradeReason, upgradeTo, setShowPricing } = useMonetization();

  return (
    <AnimatePresence>
      {showUpgrade && (
        <>
          {/* Backdrop */}
          <motion.div
            className="modal-backdrop"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setShowUpgrade(false)}
          />

          {/* Modal */}
          <motion.div
            className="upgrade-modal"
            initial={{ opacity: 0, scale: 0.92, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 20 }}
            transition={{ duration: 0.28, ease: 'easeOut' }}>

            <button className="modal-close" onClick={() => setShowUpgrade(false)}>✕</button>

            <div className="upgrade-modal__icon">🔒</div>
            <h3 className="upgrade-modal__title">Upgrade to unlock</h3>
            <p className="upgrade-modal__reason">{upgradeReason}</p>

            <div className="upgrade-options">
              {/* Pro */}
              <div className="upgrade-option upgrade-option--pro">
                <div className="uo-top">
                  <span className="uo-icon">{PLANS.pro.icon}</span>
                  <div>
                    <div className="uo-name">{PLANS.pro.name}</div>
                    <div className="uo-price">${PLANS.pro.price}/mo</div>
                  </div>
                  <span className="uo-badge uo-badge--purple">Most Popular</span>
                </div>
                <ul className="uo-features">
                  <li>✓ 50 predictions/day</li>
                  <li>✓ All 46 states</li>
                  <li>✓ All lottery games</li>
                  <li>✓ CSV export + API</li>
                  <li>✓ Advanced analytics</li>
                </ul>
                <button className="uo-btn uo-btn--pro" onClick={() => upgradeTo('pro', 'monthly')}>
                  ⚡ Upgrade to Pro — ${PLANS.pro.price}/mo
                </button>
              </div>

              {/* Elite */}
              <div className="upgrade-option upgrade-option--elite">
                <div className="uo-top">
                  <span className="uo-icon">{PLANS.elite.icon}</span>
                  <div>
                    <div className="uo-name">{PLANS.elite.name}</div>
                    <div className="uo-price">${PLANS.elite.price}/mo</div>
                  </div>
                  <span className="uo-badge uo-badge--amber">Best Value</span>
                </div>
                <ul className="uo-features">
                  <li>✓ Unlimited predictions</li>
                  <li>✓ 10-year history</li>
                  <li>✓ Email draw alerts</li>
                  <li>✓ Syndicate tools</li>
                  <li>✓ White-label API</li>
                </ul>
                <button className="uo-btn uo-btn--elite" onClick={() => upgradeTo('elite', 'monthly')}>
                  👑 Upgrade to Elite — ${PLANS.elite.price}/mo
                </button>
              </div>
            </div>

            <button className="uo-compare"
              onClick={() => { setShowUpgrade(false); setShowPricing(true); }}>
              Compare all plans →
            </button>

            <p className="uo-disclaimer">7-day free trial · Cancel anytime · No credit card required to try</p>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
