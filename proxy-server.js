const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

// ── Directories ──────────────────────────────────────────────
const BUILD_DIR  = __dirname + '/frontend/build';   // React build (main app)
const PUBLIC_DIR = __dirname + '/frontend/public';  // scoreboard (latest)
const BACKEND    = 'http://localhost:8000';          // FastAPI backend

const MIME = {
  '.html':  'text/html; charset=utf-8',
  '.js':    'application/javascript',
  '.css':   'text/css',
  '.json':  'application/json',
  '.png':   'image/png',
  '.ico':   'image/x-icon',
  '.svg':   'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff':  'font/woff',
  '.ttf':   'font/ttf',
  '.map':   'application/json',
  '.txt':   'text/plain',
};

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

// ── Helpers ──────────────────────────────────────────────────
function serveFile(filePath, res) {
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404, CORS); res.end('Not found'); return; }
    const ext = (filePath.match(/\.[^./]+$/) || [''])[0].toLowerCase();
    res.writeHead(200, { ...CORS, 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function proxyToBackend(req, res, body) {
  const opts = {
    hostname: 'localhost',
    port: 8000,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: 'localhost:8000' },
  };
  const pr = http.request(opts, (backRes) => {
    res.writeHead(backRes.statusCode, { ...CORS, ...backRes.headers });
    backRes.pipe(res);
  });
  pr.on('error', (err) => {
    res.writeHead(502, CORS);
    res.end(JSON.stringify({ error: 'Backend unavailable: ' + err.message }));
  });
  if (body) pr.write(body);
  pr.end();
}

// ── Server ───────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }

  const urlPath = req.url.split('?')[0];

  // 1. Scoreboard — always latest from frontend/public
  if (urlPath === '/lotto-scoreboard.html') {
    serveFile(PUBLIC_DIR + '/lotto-scoreboard.html', res);
    return;
  }

  // 2. API routes → proxy to FastAPI backend
  const apiPaths = ['/lotteries', '/extract', '/health', '/ready',
                    '/metrics', '/predict', '/backtest', '/stripe', '/api'];
  if (apiPaths.some(p => urlPath.startsWith(p))) {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => proxyToBackend(req, res, body || null));
    return;
  }

  // 3. React static assets
  if (urlPath.startsWith('/static/') ||
      urlPath === '/asset-manifest.json' ||
      urlPath === '/manifest.json' ||
      urlPath === '/robots.txt') {
    serveFile(BUILD_DIR + urlPath, res);
    return;
  }

  // 4. Favicon — try build first, ignore 404
  if (urlPath === '/favicon.ico') {
    const fp = BUILD_DIR + '/favicon.ico';
    fs.access(fp, fs.constants.R_OK, err => {
      if (!err) serveFile(fp, res);
      else { res.writeHead(204, CORS); res.end(); }
    });
    return;
  }

  // 5. Root → React app (index.html from build)
  if (urlPath === '/' || urlPath === '/index.html') {
    serveFile(BUILD_DIR + '/index.html', res);
    return;
  }

  // 6. SPA fallback — serve React index for any unknown route
  fs.access(BUILD_DIR + urlPath, fs.constants.R_OK, err => {
    if (!err) serveFile(BUILD_DIR + urlPath, res);
    else      serveFile(BUILD_DIR + '/index.html', res);
  });
});

server.listen(8090, '0.0.0.0', () => {
  console.log('🚀 Server :8090  →  React app + scoreboard + FastAPI proxy');
  console.log('   /                     → React main app (frontend/build)');
  console.log('   /lotto-scoreboard.html → Scoreboard (frontend/public)');
  console.log('   /lotteries/*          → FastAPI backend :8000');
});
