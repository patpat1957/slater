import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid, Legend,
} from 'recharts';
import ResultsTable from './ResultsTable';
import ApiPanel from './ApiPanel';

/* ── Stat Card ── */
function StatCard({ icon, value, label, delay = 0 }) {
  return (
    <motion.div
      className="stat-card"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4 }}
    >
      <span className="stat-card__icon">{icon}</span>
      <strong className="stat-card__value">{value}</strong>
      <span className="stat-card__label">{label}</span>
    </motion.div>
  );
}

/* ── Custom Tooltip ── */
function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: '#10102a',
      border: '1px solid rgba(124,58,237,0.3)',
      borderRadius: 10,
      padding: '10px 14px',
      fontSize: 12,
    }}>
      <div style={{ color: 'rgba(232,234,240,0.6)', marginBottom: 6, fontWeight: 600 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color || '#c4b5fd', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
          <span>{p.name}: <strong>{p.value}</strong></span>
        </div>
      ))}
    </div>
  );
}

/* ── Color palette per lottery ── */
const CHART_COLORS = [
  '#7c3aed', '#f59e0b', '#10b981', '#3b82f6', '#ef4444',
  '#8b5cf6', '#fcd34d', '#34d399', '#93c5fd', '#fca5a5',
];

/* ── Builds monthly draws-per-lottery dataset ── */
function buildMonthlyData(data) {
  const map = {};
  data.forEach(row => {
    const month = row.Date ? row.Date.slice(0, 7) : ''; // YYYY-MM
    if (!month) return;
    if (!map[month]) map[month] = { month };
    const name = row.Lotto_Name || 'Unknown';
    map[month][name] = (map[month][name] || 0) + 1;
  });
  return Object.entries(map)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => v);
}

/* ── Builds draws-per-lottery bar chart data ── */
function buildLotteryCountData(data) {
  const map = {};
  data.forEach(row => {
    const name = row.Lotto_Name || 'Unknown';
    map[name] = (map[name] || 0) + 1;
  });
  return Object.entries(map)
    .sort(([, a], [, b]) => b - a)
    .map(([name, count]) => ({ name, count }));
}

/* ── Builds hot/cold numbers ── */
function buildHotNumbers(data, topN = 15) {
  const freq = {};
  data.forEach(row => {
    Object.keys(row).forEach(k => {
      if (!k.startsWith('Ball_')) return;
      const v = row[k];
      if (!v || v === '') return;
      // Keep single-digit values as-is (pick games); zero-pad only multi-digit values
      const parsed = parseInt(v, 10);
      const n = String(parsed).length <= 1 ? String(parsed) : String(parsed).padStart(2, '0');
      freq[n] = (freq[n] || 0) + 1;
    });
  });
  return Object.entries(freq)
    .sort(([, a], [, b]) => b - a)
    .slice(0, topN)
    .map(([number, count]) => ({ number, count }));
}

/* ═══════════════════════════════════════
   Step 3: Results Dashboard
═══════════════════════════════════════ */
export default function Step3_Results({
  results,
  selectedState,
  selectedLotteries,
  fromDate,
  toDate,
  onCSV,
  csvLoading,
}) {
  const [activeTab, setActiveTab] = useState('table');

  /* Derived data */
  const lottoCountData = useMemo(() => buildLotteryCountData(results?.data || []), [results]);
  const monthlyData = useMemo(() => buildMonthlyData(results?.data || []), [results]);
  const hotNumbers = useMemo(() => buildHotNumbers(results?.data || []), [results]);
  const lotteryNames = useMemo(() => [...new Set((results?.data || []).map(r => r.Lotto_Name))], [results]);

  const dayRange = useMemo(() => {
    if (!fromDate || !toDate) return 0;
    return Math.max(0, Math.ceil((toDate - fromDate) / 86400000));
  }, [fromDate, toDate]);

  if (!results) return null;

  const fmtDate = d => (d instanceof Date ? d.toISOString().split('T')[0] : d);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
    >
      {/* ── Stats row ── */}
      <div className="stats-grid" style={{ marginBottom: 28 }}>
        <StatCard icon="🗂️" value={results.total_records.toLocaleString()} label="Total Draws" delay={0} />
        <StatCard icon="🎟️" value={results.lotteries?.length || 0} label="Lotteries" delay={0.05} />
        <StatCard icon="📍" value={results.state_name || selectedState?.label} label="State" delay={0.1} />
        <StatCard icon="📅" value={`${dayRange}d`} label="Date Span" delay={0.15} />
      </div>

      {/* ── Tabs ── */}
      <div className="results-tabs">
        {[
          { id: 'table',   label: '📋 Results', badge: results.total_records },
          { id: 'charts',  label: '📊 Analytics' },
          { id: 'api',     label: '🔌 API' },
        ].map(tab => (
          <button
            key={tab.id}
            className={`rtab ${activeTab === tab.id ? 'rtab--active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
            {tab.badge !== undefined && (
              <span className="rtab__count">{tab.badge.toLocaleString()}</span>
            )}
          </button>
        ))}

        {/* CSV button on far right */}
        <button
          className="rtab rtab--dl"
          onClick={onCSV}
          disabled={csvLoading}
          style={{ marginLeft: 'auto' }}
        >
          {csvLoading ? '⏳ Building…' : '📥 CSV'}
        </button>
      </div>

      {/* ── Tab content ── */}
      <AnimatePresence mode="wait">
        {activeTab === 'table' && (
          <motion.div
            key="table"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.25 }}
          >
            <ResultsTable data={results.data} lotteries={results.lotteries} />
          </motion.div>
        )}

        {activeTab === 'charts' && (
          <motion.div
            key="charts"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.25 }}
          >
            {/* ── Chart 1: Draws per lottery ── */}
            <div className="chart-container">
              <div className="chart-title">🎟️ Draws by Lottery</div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={lottoCountData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: 'rgba(232,234,240,0.45)', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    interval={0}
                    angle={-25}
                    textAnchor="end"
                    height={50}
                  />
                  <YAxis tick={{ fill: 'rgba(232,234,240,0.45)', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(124,58,237,0.1)' }} />
                  <Bar dataKey="count" fill="#7c3aed" radius={[6, 6, 0, 0]} name="Draws" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* ── Chart 2: Monthly trend ── */}
            {monthlyData.length > 1 && (
              <div className="chart-container">
                <div className="chart-title">📈 Monthly Draw Trend</div>
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={monthlyData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis
                      dataKey="month"
                      tick={{ fill: 'rgba(232,234,240,0.45)', fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      interval={Math.max(0, Math.floor(monthlyData.length / 8) - 1)}
                    />
                    <YAxis tick={{ fill: 'rgba(232,234,240,0.45)', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend
                      wrapperStyle={{ fontSize: 12, color: 'rgba(232,234,240,0.6)' }}
                    />
                    {lotteryNames.map((name, i) => (
                      <Line
                        key={name}
                        type="monotone"
                        dataKey={name}
                        stroke={CHART_COLORS[i % CHART_COLORS.length]}
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 5 }}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* ── Chart 3: Hot numbers ── */}
            {hotNumbers.length > 0 && (
              <div className="chart-container">
                <div className="chart-title">🔥 Most Frequent Numbers (Main Balls)</div>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={hotNumbers} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="number" tick={{ fill: 'rgba(232,234,240,0.45)', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: 'rgba(232,234,240,0.45)', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(245,158,11,0.1)' }} />
                    <Bar dataKey="count" fill="#f59e0b" radius={[4, 4, 0, 0]} name="Appearances" />
                  </BarChart>
                </ResponsiveContainer>
                <div style={{ fontSize: 11, color: 'var(--text-d)', marginTop: 8, textAlign: 'center' }}>
                  Frequency of main ball numbers across all selected draws
                </div>
              </div>
            )}
          </motion.div>
        )}

        {activeTab === 'api' && (
          <motion.div
            key="api"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.25 }}
          >
            <ApiPanel
              state={selectedState}
              lotteries={selectedLotteries}
              fromDate={fromDate}
              toDate={toDate}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
