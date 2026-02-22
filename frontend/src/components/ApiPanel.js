import React, { useState } from 'react';

const API_BASE = window.location.origin;

export default function ApiPanel({ state, lotteries, fromDate, toDate }) {
  const [copied, setCopied] = useState(null);

  const fmtDate = d => (d instanceof Date ? d.toISOString().split('T')[0] : d);
  const ids      = lotteries.map(l => l.value).join(',');
  const stateCode = state?.value || 'NY';
  const stateName = state?.label || 'New York (NY)';
  const from     = fmtDate(fromDate);
  const to       = fmtDate(toDate);

  const endpoints = [
    {
      id: 'json-get',
      method: 'GET',
      title: 'Extract Results — JSON',
      description: 'Returns JSON with all draws for the selected state, lotteries and date range.',
      url: `${API_BASE}/extract?state_code=${stateCode}&lottery_ids=${ids}&from_date=${from}&to_date=${to}`,
    },
    {
      id: 'csv-get',
      method: 'GET',
      title: 'Download CSV File',
      description: 'Returns a structured CSV: Date, Lotto_Name, Ball_1, Ball_2… with zero-padded numbers.',
      url: `${API_BASE}/extract/csv?state_code=${stateCode}&lottery_ids=${ids}&from_date=${from}&to_date=${to}`,
    },
    {
      id: 'states-all',
      method: 'GET',
      title: 'List All States & Lotteries',
      description: 'Returns all 46 supported US states and their available lottery games.',
      url: `${API_BASE}/lotteries/all-states`,
    },
    {
      id: 'state-by-code',
      method: 'GET',
      title: `Lotteries for ${stateName}`,
      description: `Returns all lottery games available for state code ${stateCode}.`,
      url: `${API_BASE}/lotteries/by-state/${stateCode}`,
    },
    {
      id: 'detect-loc',
      method: 'GET',
      title: 'Auto-Detect Location',
      description: 'Uses IP geolocation to detect your state and return available lotteries.',
      url: `${API_BASE}/lotteries/detect-location`,
    },
    {
      id: 'health',
      method: 'GET',
      title: 'Health Check',
      description: 'Returns API status, version, and timestamp.',
      url: `${API_BASE}/health`,
    },
  ];

  const postBody = JSON.stringify({
    state_code: stateCode,
    lottery_ids: lotteries.map(l => l.value),
    from_date: from,
    to_date: to,
  }, null, 2);

  const curlGet = `curl -G "${API_BASE}/extract/csv" \\
  --data-urlencode "state_code=${stateCode}" \\
  --data-urlencode "lottery_ids=${ids}" \\
  --data-urlencode "from_date=${from}" \\
  --data-urlencode "to_date=${to}" \\
  --output "${stateCode}_lotto_${from}_${to}.csv"`;

  const curlPost = `curl -X POST "${API_BASE}/extract/csv" \\
  -H "Content-Type: application/json" \\
  -d '${postBody.replace(/\n/g, '\n  ')}' \\
  --output "${stateCode}_lotto_${from}_${to}.csv"`;

  const copyToClipboard = (text, id) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 2200);
    }).catch(() => {});
  };

  return (
    <div className="api-panel">
      {/* ── Header ── */}
      <div className="api-panel__header">
        <h3>🔌 REST API Reference</h3>
        <a className="api-docs-btn" href={`${API_BASE}/docs`} target="_blank" rel="noreferrer">
          📖 Open Swagger UI ↗
        </a>
      </div>

      <p className="api-panel__intro">
        All endpoints below are pre-filled with your current state (<strong>{stateName}</strong>),
        selected lotteries, and date range. You can call them directly from any HTTP client.
      </p>

      {/* ── GET / POST comparison ── */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {[
          { id: 'note-get',  color: 'rgba(16,185,129,0.18)',  border: 'rgba(16,185,129,0.3)', text: '#6ee7b7',
            label: 'GET',  note: 'Parameters in query string. Best for browsers and quick testing.' },
          { id: 'note-post', color: 'rgba(245,158,11,0.12)',  border: 'rgba(245,158,11,0.25)', text: 'var(--amber-l)',
            label: 'POST', note: 'Parameters as JSON body. Best for programmatic use and large payloads.' },
        ].map(item => (
          <div key={item.id} style={{
            flex: 1, minWidth: 220, padding: '12px 16px', borderRadius: 10,
            background: item.color, border: `1px solid ${item.border}`,
          }}>
            <span className={`api-method api-method--${item.label.toLowerCase()}`}>{item.label}</span>
            <p style={{ fontSize: 12, color: item.text, marginTop: 8 }}>{item.note}</p>
          </div>
        ))}
      </div>

      {/* ── Endpoint list ── */}
      <div className="api-endpoints">
        {endpoints.map(ep => (
          <div key={ep.id} className="api-ep">
            <div className="api-ep__top">
              <span className="api-method api-method--get">{ep.method}</span>
              <span className="api-ep__title">{ep.title}</span>
            </div>
            {ep.description && <p className="api-ep__desc">{ep.description}</p>}
            <div className="api-ep__url-row">
              <code className="api-ep__url">{ep.url}</code>
              <button
                className={`copy-btn ${copied === ep.id ? 'copy-btn--done' : ''}`}
                onClick={() => copyToClipboard(ep.url, ep.id)}
              >
                {copied === ep.id ? '✓ Copied!' : 'Copy URL'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* ── POST endpoint note ── */}
      <div className="api-ep" style={{ borderColor: 'rgba(245,158,11,0.25)' }}>
        <div className="api-ep__top">
          <span className="api-method api-method--post">POST</span>
          <span className="api-ep__title">Extract Results — POST (JSON body)</span>
        </div>
        <p className="api-ep__desc">Send lottery extraction parameters as a JSON body.</p>
        <div className="api-ep__url-row">
          <code className="api-ep__url">{API_BASE}/extract</code>
          <button
            className={`copy-btn ${copied === 'post-url' ? 'copy-btn--done' : ''}`}
            onClick={() => copyToClipboard(`${API_BASE}/extract`, 'post-url')}
          >
            {copied === 'post-url' ? '✓ Copied!' : 'Copy URL'}
          </button>
        </div>
      </div>

      {/* ── cURL Examples ── */}
      <div className="api-curl">
        <div className="api-curl__header">
          <span className="api-method api-method--get">GET</span>
          <span className="api-curl__label">cURL — Download CSV via GET</span>
          <button
            className={`copy-btn ${copied === 'curl-get' ? 'copy-btn--done' : ''}`}
            onClick={() => copyToClipboard(curlGet, 'curl-get')}
          >
            {copied === 'curl-get' ? '✓ Copied!' : 'Copy'}
          </button>
        </div>
        <pre className="api-curl__code">{curlGet}</pre>
      </div>

      <div className="api-curl">
        <div className="api-curl__header">
          <span className="api-method api-method--post">POST</span>
          <span className="api-curl__label">cURL — Download CSV via POST</span>
          <button
            className={`copy-btn ${copied === 'curl-post' ? 'copy-btn--done' : ''}`}
            onClick={() => copyToClipboard(curlPost, 'curl-post')}
          >
            {copied === 'curl-post' ? '✓ Copied!' : 'Copy'}
          </button>
        </div>
        <pre className="api-curl__code">{curlPost}</pre>
      </div>

      {/* ── JSON Body ── */}
      <div className="api-curl">
        <div className="api-curl__header">
          <span className="api-curl__label">📄 JSON Request Body (for POST /extract and POST /extract/csv)</span>
          <button
            className={`copy-btn ${copied === 'body' ? 'copy-btn--done' : ''}`}
            onClick={() => copyToClipboard(postBody, 'body')}
          >
            {copied === 'body' ? '✓ Copied!' : 'Copy JSON'}
          </button>
        </div>
        <pre className="api-curl__code">{postBody}</pre>
      </div>

      {/* ── Data sources ── */}
      <div className="api-sources">
        <h4>📡 Real Data Sources — No Fake Numbers</h4>
        <div className="api-sources__grid">
          <div className="api-source-card">
            <div className="api-source-card__icon">🏛️</div>
            <div>
              <strong>NY Open Data (Socrata API)</strong>
              <p>Official NY State government portal — Powerball, Mega Millions, NY Lotto, Take 5, Numbers, Win 4, Cash4Life, Pick 10</p>
              <code>data.ny.gov</code>
            </div>
          </div>
          <div className="api-source-card">
            <div className="api-source-card__icon">🌐</div>
            <div>
              <strong>lotto.net Historical Archive</strong>
              <p>Comprehensive public archive — FL Lotto, CA SuperLotto+, TX Lotto, MI Lotto 47, NJ Pick 6, IL Lotto, OR Megabucks &amp; more</p>
              <code>lotto.net</code>
            </div>
          </div>
        </div>
        <p className="api-sources__disclaimer">
          🛡️ <strong>All numbers are real historical draws.</strong>&nbsp;
          No random number generation is ever used. Every result has a verifiable source date and official record.
        </p>
      </div>
    </div>
  );
}
