import React, { useState, useCallback } from 'react';
import Select from 'react-select';
import { motion, AnimatePresence } from 'framer-motion';

/* ── react-select dark styles ── */
const mkSelectStyles = (accent = '#7c3aed') => ({
  control: (b, s) => ({
    ...b,
    background: 'rgba(255,255,255,0.04)',
    border: `1px solid ${s.isFocused ? accent : 'rgba(255,255,255,0.09)'}`,
    borderRadius: 12,
    boxShadow: s.isFocused ? `0 0 0 3px ${accent}30` : 'none',
    minHeight: 50,
    cursor: 'pointer',
    transition: 'all 0.2s',
    '&:hover': { borderColor: accent },
  }),
  menu: b => ({
    ...b,
    background: '#1a1a3e',
    border: '1px solid rgba(124,58,237,0.35)',
    borderRadius: 14,
    boxShadow: '0 20px 60px rgba(0,0,0,0.85)',
    zIndex: 99999,
    overflow: 'hidden',
  }),
  menuPortal: b => ({ ...b, zIndex: 99999 }),
  option: (b, s) => ({
    ...b,
    background: s.isSelected ? accent : s.isFocused ? `${accent}28` : 'transparent',
    color: '#fff',
    cursor: 'pointer',
    transition: 'background 0.15s',
    padding: '10px 14px',
  }),
  singleValue: b => ({ ...b, color: '#fff' }),
  multiValue: b => ({ ...b, background: `${accent}30`, borderRadius: 8, margin: '2px 4px' }),
  multiValueLabel: b => ({ ...b, color: '#fff', padding: '2px 6px' }),
  multiValueRemove: b => ({
    ...b, color: 'rgba(255,255,255,0.7)', borderRadius: '0 8px 8px 0',
    '&:hover': { background: accent, color: '#fff' }
  }),
  placeholder: b => ({ ...b, color: 'rgba(255,255,255,0.3)' }),
  input: b => ({ ...b, color: '#fff' }),
  groupHeading: b => ({
    ...b, color: '#a78bfa', fontSize: 11, fontWeight: 700,
    letterSpacing: 1, textTransform: 'uppercase', padding: '8px 14px 4px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  }),
  group: b => ({ ...b, paddingTop: 0 }),
  indicatorSeparator: () => ({ display: 'none' }),
  dropdownIndicator: b => ({ ...b, color: 'rgba(255,255,255,0.35)', padding: '0 10px' }),
  clearIndicator: b => ({ ...b, color: 'rgba(255,255,255,0.35)' }),
  valueContainer: b => ({ ...b, padding: '4px 14px', gap: 4 }),
  noOptionsMessage: b => ({ ...b, color: 'rgba(255,255,255,0.4)', fontSize: 13 }),
});

/* ── Lottery icon map ── */
const LOTTERY_ICONS = {
  powerball: '🔴',
  mega_millions: '🔵',
  ny_lotto: '🗽',
  ny_lotto_net: '🗽',
  take5: '5️⃣',
  cash4life: '💵',
  numbers: '#️⃣',
  win4: '4️⃣',
  pick10: '🔟',
  ca_superlotto_plus: '⭐',
  ca_fantasy5: '🌟',
  ca_daily3: '3️⃣',
  ca_daily4: '4️⃣',
  fl_lotto: '☀️',
  tx_lotto_texas: '⭐',
  wa_lotto: '🌲',
  or_megabucks: '💰',
  mi_lotto47: '🎯',
  nj_jersey_cash5: '💚',
  nj_pick6: '6️⃣',
  il_lotto: '🌽',
};

function getLotteryIcon(id) {
  return LOTTERY_ICONS[id] || '🎟️';
}

/* ── Lottery Card ── */
function LotteryCard({ lottery, isSelected, onToggle }) {
  const isMultistate = lottery.type === 'multistate';
  return (
    <motion.button
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ scale: 1.02, y: -2 }}
      whileTap={{ scale: 0.97 }}
      onClick={() => onToggle(lottery)}
      className={`lottery-card ${isSelected ? (isMultistate ? 'is-selected' : 'is-selected--amber') : ''}`}
      title={lottery.name}
    >
      {isSelected && (
        <span className="lottery-card__check">✓</span>
      )}
      <span className="lottery-card__icon">{getLotteryIcon(lottery.id)}</span>
      <div>
        <div className="lottery-card__name">{lottery.name}</div>
        <div className="lottery-card__type">
          {isMultistate ? '🌐 Multi-State' : '🏛️ State'}
        </div>
      </div>
    </motion.button>
  );
}

/* ══════════════════════════════════════
   Step 1: Pick State + Lotteries
══════════════════════════════════════ */
export default function Step1_StateLottery({
  allStates,
  selectedState,
  onStateChange,
  availableLotteries,
  selectedLotteries,
  onLotteryChange,
  detecting,
  detectedState,
}) {
  const [search, setSearch] = useState('');

  const stateOptions = allStates.map(s => ({
    value: s.state_code,
    label: `${s.state_name} (${s.state_code})`,
  }));

  const toggleLottery = useCallback((lottery) => {
    const sel = selectedLotteries || [];
    const exists = sel.find(l => l.value === lottery.id);
    if (exists) {
      onLotteryChange(sel.filter(l => l.value !== lottery.id));
    } else {
      onLotteryChange([...sel, { value: lottery.id, label: lottery.name, type: lottery.type }]);
    }
  }, [selectedLotteries, onLotteryChange]);

  const selectAll = () => {
    onLotteryChange(availableLotteries.map(l => ({ value: l.id, label: l.name, type: l.type })));
  };

  const selectAllMultistate = () => {
    const ms = availableLotteries
      .filter(l => l.type === 'multistate')
      .map(l => ({ value: l.id, label: l.name, type: l.type }));
    onLotteryChange(ms);
  };

  const clearAll = () => onLotteryChange([]);

  const filteredLotteries = search.trim()
    ? availableLotteries.filter(l =>
        l.name.toLowerCase().includes(search.toLowerCase()) ||
        l.id.toLowerCase().includes(search.toLowerCase())
      )
    : availableLotteries;

  const multistate = filteredLotteries.filter(l => l.type === 'multistate');
  const stateOnly = filteredLotteries.filter(l => l.type === 'state');
  const selectedIds = new Set((selectedLotteries || []).map(l => l.value));

  const lotteryCount = allStates.find(s => s.state_code === selectedState?.value)?.lottery_count || 0;

  return (
    <div>
      {/* ── State Selector ── */}
      <div className="step-panel__header">
        <div className="step-panel__icon" style={{ fontSize: 26 }}>📍</div>
        <div>
          <div className="step-panel__title">Choose Your State</div>
          <div className="step-panel__sub">
            {detecting ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="btn-spinner" style={{ width: 12, height: 12, borderWidth: 2 }} />
                Detecting your location…
              </span>
            ) : detectedState ? (
              <span style={{ color: '#34d399' }}>
                📍 Auto-detected: <strong>{detectedState.label}</strong>
              </span>
            ) : (
              'Search or pick any of the 46 supported US states'
            )}
          </div>
        </div>
      </div>

      {/* ── Auto-detect banner ── */}
      <AnimatePresence>
        {!detecting && detectedState && selectedState?.value === detectedState?.value && (
          <motion.div
            className="state-detect-banner"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
          >
            <span>✅</span>
            <span>
              Using your detected location: <strong>{detectedState.label}</strong>
              {lotteryCount > 0 && <span style={{ color: 'rgba(52,211,153,0.7)', marginLeft: 8 }}>
                · {lotteryCount} lotteries available
              </span>}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <Select
        options={stateOptions}
        value={selectedState}
        onChange={onStateChange}
        placeholder="🔍  Search by state name or abbreviation…"
        isClearable
        isSearchable
        styles={mkSelectStyles('#7c3aed')}
        noOptionsMessage={() => 'No states found'}
        className="select-container"
        menuPortalTarget={document.body}
        menuPosition="fixed"
      />

      {/* ── Lottery Selection ── */}
      <AnimatePresence>
        {selectedState && availableLotteries.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3 }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ marginTop: 28 }}>
              {/* Header row */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div className="step-panel__icon" style={{ width: 36, height: 36, fontSize: 18 }}>🎟️</div>
                  <div>
                    <div style={{ fontFamily: 'var(--font-head)', fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
                      Select Lotteries
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-m)' }}>
                      {selectedLotteries?.length || 0} of {availableLotteries.length} selected
                    </div>
                  </div>
                </div>

                {/* Quick-select buttons */}
                <div className="quick-select-bar" style={{ margin: 0 }}>
                  <button className="qs-btn qs-btn--amber" onClick={selectAllMultistate} title="Select all multi-state lotteries">
                    🌐 Multi-State
                  </button>
                  <button className="qs-btn" onClick={selectAll} title="Select all lotteries">
                    ✅ All
                  </button>
                  {(selectedLotteries?.length || 0) > 0 && (
                    <button className="qs-btn qs-btn--clear" onClick={clearAll}>
                      ✕ Clear
                    </button>
                  )}
                </div>
              </div>

              {/* Search within lotteries */}
              {availableLotteries.length > 4 && (
                <input
                  type="text"
                  className="rt-search"
                  placeholder="🔍 Filter lotteries…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  style={{ width: '100%', marginBottom: 16 }}
                />
              )}

              {/* Multi-state group */}
              {multistate.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', color: 'var(--text-d)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                    🌐 Multi-State
                    <span style={{ fontSize: 10, background: 'rgba(124,58,237,0.2)', color: 'var(--purple-l)', padding: '2px 6px', borderRadius: 6 }}>
                      {multistate.length}
                    </span>
                  </div>
                  <div className="lottery-card-grid">
                    {multistate.map(l => (
                      <LotteryCard
                        key={l.id}
                        lottery={l}
                        isSelected={selectedIds.has(l.id)}
                        onToggle={toggleLottery}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* State-specific group */}
              {stateOnly.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', color: 'var(--text-d)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                    🏛️ State Lotteries
                    <span style={{ fontSize: 10, background: 'rgba(245,158,11,0.2)', color: 'var(--amber-l)', padding: '2px 6px', borderRadius: 6 }}>
                      {stateOnly.length}
                    </span>
                  </div>
                  <div className="lottery-card-grid">
                    {stateOnly.map(l => (
                      <LotteryCard
                        key={l.id}
                        lottery={l}
                        isSelected={selectedIds.has(l.id)}
                        onToggle={toggleLottery}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* No filter results */}
              {filteredLotteries.length === 0 && search && (
                <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-d)', fontSize: 14 }}>
                  No lotteries match "{search}"
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── placeholder when no state ── */}
      {!selectedState && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          style={{
            marginTop: 24,
            padding: '32px',
            borderRadius: 14,
            border: '1px dashed rgba(255,255,255,0.08)',
            textAlign: 'center',
            color: 'var(--text-d)',
            fontSize: 14,
          }}
        >
          👆 Select a state above to see available lotteries
        </motion.div>
      )}
    </div>
  );
}
