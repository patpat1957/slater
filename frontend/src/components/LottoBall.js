import React from 'react';

/**
 * LottoBall — renders a single lottery ball with 3D shading
 * type: 'white' | 'powerball' | 'mega' | 'bonus' | 'cashball'
 * size: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
 */
// Pick-style games return single-digit values (0-9) from the API already formatted correctly.
// We only zero-pad if the value is 2+ digits (regular lotto games like Powerball, Fantasy 5, etc.)
function formatBall(number) {
  const s = String(number).trim();
  // If the backend already sent a single digit (pick game), keep it as-is
  if (s.length <= 1) return s;
  // Otherwise zero-pad to 2 digits (regular lotto)
  return s.padStart(2, '0');
}

export default function LottoBall({ number, type = 'white', size = 'md', animate = false }) {
  const num = formatBall(number);
  return (
    <span
      className={`lball lball--${type} lball--${size}${animate ? ' lball--pop' : ''}`}
      title={`Ball ${num}`}
    >
      {num}
    </span>
  );
}

/* ── Ball color/type mapping based on column key ── */
const BALL_TYPE_MAP = {
  Powerball:   'powerball',
  Mega_Ball:   'mega',
  Mega:        'mega',
  Bonus:       'bonus',
  Bonus_Ball:  'bonus',
  Cash_Ball:   'cashball',
  Lucky_Ball:  'cashball',
};

/* Keys that are multipliers / metadata (not balls) */
const MULTIPLIER_KEYS = new Set(['Power_Play', 'Megaplier', 'Multiplier', 'Extra', 'Power_Ball_Multiplier']);
const SKIP_KEYS = new Set(['Date', 'Lotto_Name', 'State', 'Lottery_ID', 'Lotto_Ball', 'Source']);

/**
 * BallRow — renders the full row of balls for a single lottery draw
 */
export function BallRow({ row }) {
  // Regular numbered balls: Ball_1, Ball_2, …
  const ballKeys = Object.keys(row)
    .filter(k => k.startsWith('Ball_'))
    .sort((a, b) => +a.split('_')[1] - +b.split('_')[1]);

  // Special balls (Powerball, Mega Ball, Bonus, etc.)
  const specialKeys = Object.keys(row).filter(k =>
    !k.startsWith('Ball_') &&
    !SKIP_KEYS.has(k) &&
    !MULTIPLIER_KEYS.has(k) &&
    BALL_TYPE_MAP[k] !== undefined &&
    row[k] && row[k] !== ''
  );

  // Multiplier labels (Power Play, Megaplier, etc.)
  const multiplierKeys = Object.keys(row).filter(k =>
    MULTIPLIER_KEYS.has(k) && row[k] && row[k] !== ''
  );

  const hasBalls = ballKeys.some(k => row[k] && row[k] !== '');

  if (!hasBalls && !specialKeys.length) {
    return <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 12 }}>—</span>;
  }

  return (
    <div className="ball-row">
      {/* Main numbered balls */}
      {ballKeys.map(k =>
        row[k] && row[k] !== '' ? (
          <LottoBall key={k} number={row[k]} type="white" size="sm" />
        ) : null
      )}

      {/* Special ball (Powerball, Mega Ball, etc.) */}
      {specialKeys.map(k =>
        row[k] && row[k] !== '' ? (
          <React.Fragment key={k}>
            <span className="ball-divider" />
            <LottoBall
              number={row[k]}
              type={BALL_TYPE_MAP[k] || 'bonus'}
              size="sm"
            />
          </React.Fragment>
        ) : null
      )}

      {/* Multiplier badge */}
      {multiplierKeys.map(k => {
        const raw = row[k] || '';
        const val = raw.replace(/^0+/, '') || '0';
        const label = k.replace(/_/g, ' ');
        return (
          <span key={k} className="multiplier-badge">
            ×{val} {label}
          </span>
        );
      })}
    </div>
  );
}
