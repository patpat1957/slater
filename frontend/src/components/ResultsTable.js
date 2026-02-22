import React, { useState, useMemo } from 'react';
import { BallRow } from './LottoBall';

const PAGE_SIZE = 50;

/* ── Color map for lottery name badges ── */
const getLottoBadgeClass = name => {
  const n = name.toLowerCase().replace(/\s+/g, '-');
  if (n.includes('powerball'))     return 'lotto-badge--powerball';
  if (n.includes('mega-millions')) return 'lotto-badge--mega-millions';
  if (n.includes('take-5') || n.includes('cash4life')) return 'lotto-badge--take-5';
  if (n.includes('superlotto'))    return 'lotto-badge--superlotto-plus';
  if (n.includes('florida') || n.includes('oregon') || n.includes('texas-lotto')) return 'lotto-badge--florida-lotto';
  return '';
};

/* ── Format date nicely ── */
const fmtDate = (dateStr) => {
  try {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
};

/* ── Day of week ── */
const getDayOfWeek = (dateStr) => {
  try {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short' });
  } catch {
    return '';
  }
};

export default function ResultsTable({ data, lotteries }) {
  const [page, setPage] = useState(1);
  const [sortDir, setSortDir] = useState('desc');
  const [filterName, setFilterName] = useState('all');
  const [search, setSearch] = useState('');

  /* Unique lottery names */
  const lottoNames = useMemo(
    () => [...new Set(data.map(r => r.Lotto_Name))].sort(),
    [data]
  );

  /* Filtered + sorted data */
  const filtered = useMemo(() => {
    let rows = [...data];
    if (filterName !== 'all') rows = rows.filter(r => r.Lotto_Name === filterName);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(r =>
        r.Date.includes(search.trim()) ||
        r.Lotto_Name.toLowerCase().includes(q)
      );
    }
    rows.sort((a, b) => sortDir === 'desc'
      ? b.Date.localeCompare(a.Date)
      : a.Date.localeCompare(b.Date));
    return rows;
  }, [data, filterName, search, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageData = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const handleFilter = (name) => { setFilterName(name); setPage(1); };
  const handleSearch = (e) => { setSearch(e.target.value); setPage(1); };
  const toggleSort = () => { setSortDir(d => d === 'desc' ? 'asc' : 'desc'); setPage(1); };

  /* Count per lottery for filter chips */
  const countMap = useMemo(() => {
    const m = {};
    data.forEach(r => { m[r.Lotto_Name] = (m[r.Lotto_Name] || 0) + 1; });
    return m;
  }, [data]);

  /* Empty state */
  if (!data.length) {
    return (
      <div className="empty-state">
        <div className="empty-state__icon">🎱</div>
        <h3 className="empty-state__title">No Draws Found</h3>
        <p className="empty-state__sub">
          No lottery results match your selection and date range.
        </p>
        <ul className="empty-state__tips">
          <li>💡 Powerball &amp; Mega Millions have data back to 2010</li>
          <li>💡 Most state lotteries available from 2015 onwards</li>
          <li>💡 Try selecting a wider date range</li>
          <li>💡 State-specific lotteries may have limited history</li>
        </ul>
      </div>
    );
  }

  /* Page window for pagination */
  const buildPages = () => {
    const total = totalPages;
    const cur = safePage;
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const pages = [];
    if (cur <= 4) {
      pages.push(1, 2, 3, 4, 5, '…', total);
    } else if (cur >= total - 3) {
      pages.push(1, '…', total - 4, total - 3, total - 2, total - 1, total);
    } else {
      pages.push(1, '…', cur - 1, cur, cur + 1, '…', total);
    }
    return pages;
  };

  return (
    <div className="results-table-wrap">
      {/* ── Toolbar ── */}
      <div className="rt-toolbar">
        <div className="rt-filters">
          <button
            className={`rt-chip ${filterName === 'all' ? 'rt-chip--active' : ''}`}
            onClick={() => handleFilter('all')}
          >
            All &nbsp;
            <span style={{ opacity: 0.7 }}>({data.length})</span>
          </button>
          {lottoNames.map(n => (
            <button
              key={n}
              className={`rt-chip ${filterName === n ? 'rt-chip--active' : ''}`}
              onClick={() => handleFilter(n)}
            >
              {n} &nbsp;
              <span style={{ opacity: 0.7 }}>({countMap[n] || 0})</span>
            </button>
          ))}
        </div>

        <div className="rt-actions">
          <input
            className="rt-search"
            type="text"
            placeholder="🔍  Filter by date or lottery…"
            value={search}
            onChange={handleSearch}
          />
          <button className="rt-sort-btn" onClick={toggleSort} title="Toggle sort order">
            {sortDir === 'desc' ? '↓ Newest First' : '↑ Oldest First'}
          </button>
        </div>
      </div>

      {/* ── Table ── */}
      <div className="rt-scroll">
        <table className="rt">
          <thead className="rt__head">
            <tr>
              <th className="rt__th" style={{ width: 130 }}>
                <button className="rt__sort" onClick={toggleSort}>
                  Date {sortDir === 'desc' ? '↓' : '↑'}
                </button>
              </th>
              <th className="rt__th" style={{ width: 160 }}>Lottery</th>
              <th className="rt__th">Winning Numbers</th>
            </tr>
          </thead>
          <tbody>
            {pageData.map((row, i) => (
              <tr
                key={`${row.Date}-${row.Lotto_Name}-${i}`}
                className={`rt__row ${i % 2 !== 0 ? 'rt__row--alt' : ''}`}
              >
                {/* Date cell */}
                <td className="rt__td rt__td--date">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span className="date-badge">{fmtDate(row.Date)}</span>
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.5px', fontWeight: 600 }}>
                      {getDayOfWeek(row.Date)}
                    </span>
                  </div>
                </td>

                {/* Lottery name cell */}
                <td className="rt__td rt__td--name">
                  <span className={`lotto-name-badge ${getLottoBadgeClass(row.Lotto_Name)}`}>
                    {row.Lotto_Name}
                  </span>
                </td>

                {/* Balls cell */}
                <td className="rt__td rt__td--balls">
                  <BallRow row={row} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div className="rt-pagination">
          <span className="rt-pag-info">
            Showing {((safePage - 1) * PAGE_SIZE) + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of{' '}
            <strong style={{ color: 'var(--purple-l)' }}>{filtered.length.toLocaleString()}</strong>
            {filterName !== 'all' && ` ${filterName}`} draws
          </span>

          <div className="rt-pag-btns">
            <button className="rt-pag-btn" onClick={() => setPage(1)} disabled={safePage === 1} title="First">
              «
            </button>
            <button className="rt-pag-btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1} title="Previous">
              ‹
            </button>

            {buildPages().map((pg, idx) =>
              pg === '…' ? (
                <span key={`ellipsis-${idx}`} style={{ color: 'var(--text-d)', padding: '0 4px', lineHeight: '34px' }}>…</span>
              ) : (
                <button
                  key={pg}
                  className={`rt-pag-btn ${pg === safePage ? 'rt-pag-btn--active' : ''}`}
                  onClick={() => setPage(pg)}
                >
                  {pg}
                </button>
              )
            )}

            <button className="rt-pag-btn" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages} title="Next">
              ›
            </button>
            <button className="rt-pag-btn" onClick={() => setPage(totalPages)} disabled={safePage === totalPages} title="Last">
              »
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
