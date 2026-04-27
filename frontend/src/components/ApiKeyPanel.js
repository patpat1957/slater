/**
 * ApiKeyPanel.js
 * Shows API key, usage stats, and docs links for Pro/Elite users.
 */
import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { useMonetization } from './MonetizationContext';

const ENDPOINTS = [
  { method: 'GET',  path: '/lotteries/all-states',              desc: 'List all supported states' },
  { method: 'GET',  path: '/lotteries/by-state/{code}',         desc: 'Get lottery games for a state' },
  { method: 'POST', path: '/extract',                            desc: 'Extract historical draw results' },
  { method: 'GET',  path: '/extract/csv',                       desc: 'Download results as CSV' },
  { method: 'POST', path: '/predict',                            desc: 'Generate AI predictions (Pro+)' },
  { method: 'GET',  path: '/predict/frequency/{state}/{game}',   desc: 'Get digit frequency analysis' },
];

const METHOD_COLOR = { GET: '#10b981', POST: '#7c3aed', DELETE: '#ef4444' };

export default function ApiKeyPanel() {
  const { apiKey, plan, planConfig, usage } = useMonetization();
  const [copied, setCopied] = useState(false);
  const [showKey, setShowKey] = useState(false);

  const callLimit = planConfig.limits.apiCallsPerMonth;

  const handleCopy = () => {
    navigator.clipboard.writeText(apiKey).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Real usage: monthly API call count tracked in localStorage via MonetizationContext.trackApiCall()
  const callsUsed = usage.apiCallsThisMonth || 0;
  const usagePct  = callLimit === 999999 ? Math.min(Math.round((callsUsed / 50000) * 100), 99)
                                         : Math.round((callsUsed / callLimit) * 100);

  return (
    <div className="api-panel">
      <div className="api-panel__header">
        <div>
          <h3 className="api-panel__title">🔌 REST API Access</h3>
          <p className="api-panel__sub">Integrate lottery data into your own apps and tools</p>
        </div>
        <div className="api-plan-chip" style={{ background: planConfig.colorLight, border: `1px solid ${planConfig.color}44`, color: planConfig.color }}>
          {planConfig.icon} {planConfig.name} · {callLimit === 999999 ? 'Unlimited' : callLimit?.toLocaleString()} calls/mo
        </div>
      </div>

      {/* API Key box */}
      <div className="api-key-box">
        <div className="api-key-label">Your API Key</div>
        <div className="api-key-row">
          <code className="api-key-val">
            {showKey ? apiKey : apiKey.slice(0, 8) + '•'.repeat(20)}
          </code>
          <button className="api-key-btn" onClick={() => setShowKey(v => !v)}>
            {showKey ? '🙈 Hide' : '👁 Show'}
          </button>
          <button className="api-key-btn api-key-btn--copy" onClick={handleCopy}>
            {copied ? '✓ Copied!' : '📋 Copy'}
          </button>
        </div>
        <p className="api-key-warn">⚠️ Keep this key secret — do not expose it in client-side code.</p>
      </div>

      {/* Usage meter */}
      <div className="api-usage-card">
        <div className="api-usage-header">
          <span className="api-usage-title">This Month's Usage</span>
          <span className="api-usage-nums">
          {callsUsed.toLocaleString()} / {callLimit === 999999 ? '∞' : callLimit?.toLocaleString()} calls
          </span>
        </div>
        <div className="api-usage-track">
          <motion.div className="api-usage-fill"
            initial={{ width: 0 }}
            animate={{ width: `${usagePct}%` }}
            transition={{ duration: 0.8 }}
            style={{ background: usagePct > 80 ? '#ef4444' : planConfig.color }}
          />
        </div>
        <div className="api-usage-foot">Resets on the 1st of each month</div>
      </div>

      {/* Endpoints */}
      <div className="api-endpoints">
        <div className="api-endpoints-title">Available Endpoints</div>
        {ENDPOINTS.map((ep, i) => (
          <div key={i} className="api-endpoint-row">
            <span className="api-method" style={{ background: METHOD_COLOR[ep.method] + '22', color: METHOD_COLOR[ep.method] }}>
              {ep.method}
            </span>
            <code className="api-path">{ep.path}</code>
            <span className="api-desc">{ep.desc}</span>
          </div>
        ))}
      </div>

      {/* Auth example */}
      <div className="api-example">
        <div className="api-example-title">Authentication Example</div>
        <pre className="api-code">{`curl -H "X-API-Key: ${showKey ? apiKey : 'YOUR_API_KEY'}" \\
  "${window.location.origin}/lotteries/by-state/CA"`}</pre>
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
        <a href={`${window.location.origin}/docs`} target="_blank" rel="noreferrer" className="api-docs-btn">
          📖 Swagger Docs
        </a>
        <a href={`${window.location.origin}/redoc`} target="_blank" rel="noreferrer" className="api-docs-btn api-docs-btn--alt">
          📋 ReDoc
        </a>
      </div>
    </div>
  );
}
