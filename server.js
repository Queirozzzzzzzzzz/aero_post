#!/usr/bin/env node
'use strict';
// AeroPost — local HTTP client. Zero dependencies (Node 18+).
// Run: node server.js   ->   http://localhost:5757
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 5757;
const HOST = process.env.HOST || '127.0.0.1';
const ALLOWED = new Set((process.env.ALLOWED_HOSTS || 'localhost,127.0.0.1').split(',').map(s => s.trim()).filter(Boolean));
const DATA_FILE = path.join(process.env.DATA_DIR || __dirname, 'data.json');
const INDEX = path.join(__dirname, 'index.html');
const empty = () => ({ collections: [], history: [], envs: [], activeEnv: null });

function loadData() {
  try { return Object.assign(empty(), JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))); }
  catch { return empty(); }
}
function saveData(d) {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(d, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}
function readBody(req, limit = 200 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', c => {
      n += c.length;
      if (n > limit) { reject(new Error('Payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function sendJson(res, code, obj) {
  const b = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(b);
}

async function proxySend(p, signal) {
  const method = String(p.method || 'GET').toUpperCase();
  const headers = new Headers();
  for (const [k, v] of p.headers || []) { try { headers.append(k, String(v)); } catch { /* invalid header, skip */ } }
  const init = { method, headers, redirect: p.follow === false ? 'manual' : 'follow', signal };
  const b = p.body || { mode: 'none' };
  if (method !== 'GET' && method !== 'HEAD') {
    if (b.mode === 'raw' || b.mode === 'urlencoded') {
      if (b.raw) init.body = b.raw;
    } else if (b.mode === 'form') {
      const fd = new FormData();
      for (const f of b.form || []) {
        if (f.type === 'file') {
          if (f.data) fd.append(f.key, new Blob([Buffer.from(f.data, 'base64')], { type: f.mime || 'application/octet-stream' }), f.name || 'file');
        } else fd.append(f.key, f.value ?? '');
      }
      init.body = fd;
      headers.delete('content-type'); // let fetch set the multipart boundary
    }
  }
  const t0 = performance.now();
  const r = await fetch(p.url, init);
  const buf = Buffer.from(await r.arrayBuffer());
  const time = Math.round(performance.now() - t0);
  const hdrs = [];
  r.headers.forEach((v, k) => { if (k !== 'set-cookie') hdrs.push([k, v]); });
  for (const c of (r.headers.getSetCookie ? r.headers.getSetCookie() : [])) hdrs.push(['set-cookie', c]);
  return {
    status: r.status,
    statusText: r.statusText || http.STATUS_CODES[r.status] || '',
    headers: hdrs, size: buf.length, time,
    body: buf.toString('base64'), url: r.url, redirected: r.redirected,
  };
}

const server = http.createServer(async (req, res) => {
  try {
    // Block DNS-rebinding and cross-site abuse: only localhost hosts, and API needs a custom header
    if (!ALLOWED.has((req.headers.host || '').replace(/:\d+$/, ''))) { res.writeHead(403); return res.end('Forbidden'); }
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(fs.readFileSync(INDEX));
    }
    if (!url.pathname.startsWith('/api/')) { res.writeHead(404); return res.end('Not found'); }
    if (req.headers['x-aeropost'] !== '1') { res.writeHead(403); return res.end('Forbidden'); }

    if (url.pathname === '/api/data' && req.method === 'GET') return sendJson(res, 200, loadData());
    if (url.pathname === '/api/data' && req.method === 'PUT') {
      const d = JSON.parse((await readBody(req)).toString('utf8'));
      saveData(Object.assign(empty(), d));
      return sendJson(res, 200, { ok: true });
    }
    if (url.pathname === '/api/send' && req.method === 'POST') {
      const p = JSON.parse((await readBody(req)).toString('utf8'));
      const ctl = new AbortController();
      res.on('close', () => { if (!res.writableEnded) ctl.abort(); }); // client cancelled
      const ms = Number(p.timeout) > 0 ? Number(p.timeout) : 0;
      const signal = ms ? AbortSignal.any([ctl.signal, AbortSignal.timeout(ms)]) : ctl.signal;
      try {
        return sendJson(res, 200, await proxySend(p, signal));
      } catch (e) {
        let msg;
        if (e && e.name === 'TimeoutError') msg = `Request timed out after ${ms} ms`;
        else if (e && e.name === 'AbortError') msg = 'Request cancelled';
        else {
          const c = e && e.cause;
          msg = `${(c && (c.code || c.name)) || e.name}: ${(c && c.message) || e.message}`;
        }
        return sendJson(res, 200, { error: msg });
      }
    }
    res.writeHead(404); res.end('Not found');
  } catch (e) {
    if (!res.headersSent) sendJson(res, 500, { error: String(e && e.message || e) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n  AeroPost running  ->  http://localhost:${PORT}\n  Data file         ->  ${DATA_FILE}\n`);
});
