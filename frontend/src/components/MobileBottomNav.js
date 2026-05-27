import React from 'react';

/* ═══════════════════════════════════════════════════════════════
   MobileBottomNav — Fixed bottom navigation bar for mobile
   Shows on screens ≤ 768px only (CSS-controlled)
═══════════════════════════════════════════════════════════════ */

export default function MobileBottomNav({ appMode, onModeChange }) {
  const tabs = [
    { id: 'extractor', icon: '📥', label: 'Extract' },
    { id: 'predictor', icon: '🔮', label: 'Predict' },
    { id: 'scoreboard', icon: '🏆', label: 'Scores' },
  ];

  const handleTab = (id) => {
    if (id === 'scoreboard') {
      window.location.href = '/lotto-scoreboard.html';
    } else {
      onModeChange(id);
    }
  };

  return (
    <nav className="mob-bottom-nav">
      {tabs.map(t => (
        <button
          key={t.id}
          className={`mob-bottom-nav__tab${appMode === t.id ? ' mob-bottom-nav__tab--active' : ''}`}
          onClick={() => handleTab(t.id)}
        >
          <span className="mob-bottom-nav__icon">{t.icon}</span>
          <span className="mob-bottom-nav__label">{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
