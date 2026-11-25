'use strict';
// Nebulix 3.0 Developer Toolbox — the HTTP request tester. Browsers cannot call most APIs directly (CORS), so the server
// makes the request for a logged-in, verified user. SSRF protection is the proxy's guard: only http(s), no embedded
// credentials, no internal ports or hostnames, and every connection goes through a DNS lookup that refuses private,
// loopback, link-local and metadata addresses (checked at connect time, so DNS rebinding does not help). Redirects are
// not followed automatically (the 3xx and its Location are shown); responses are capped at 1 MB.
const http = require('http');
const https = require('https');
const { HttpError } = require('../util');
const guard = require('../proxy/guard');

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const MAX = 1024 * 1024;
const HOP = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'upgrade', 'keep-alive', 'proxy-authorization', 'proxy-connection', 'te', 'trailer', 'cookie', 'expect']);

function send(u, method, headers, body) {
  return new Promise((res, rej) => {
    const t0 = Date.now(); const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, { method, headers, lookup: guard.lookup, timeout: 12000, agent: false }, (r) => {
      const parts = []; let n = 0; let cut = false; const tf = Date.now();
      r.on('data', (c) => { if (n >= MAX) { cut = true; r.destroy(); return; } parts.push(c.subarray(0, MAX - n)); n += Math.min(c.length, MAX - n); });
      const done = () => res({ status: r.statusCode, statusText: r.statusMessage, headers: r.headers, body: Buffer.concat(parts), truncated: cut, ttfb: tf - t0, ms: Date.now() - t0, remote: r.socket && r.socket.remoteAddress });
      r.on('end', done); r.on('close', done); r.on('error', done);
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    req.on('error', rej);
    if (body) req.end(body); else req.end();
  });
}

module.exports = function register(r) {
  r.post('/api/devtools/http', { auth: true, verified: true, limit: [30, 60000, 'user'], bodyLimit: 600000 }, async (c) => {
    const b = c.body || {}; const method = String(b.method || 'GET').toUpperCase(); if (!METHODS.includes(method)) throw new HttpError(400, 'bad_method', 'Unsupported method');
    let u; try { u = new URL(String(b.url || '').trim()); } catch { throw new HttpError(400, 'bad_url', 'Enter a full address, e.g. https://api.github.com/zen'); }
    if (!/^https?:$/.test(u.protocol)) throw new HttpError(400, 'bad_scheme', 'Only http:// and https:// addresses');
    guard.checkUrl(u);
    const headers = { 'user-agent': 'Nebulix-HTTP-Tester/1.0 (+https://nebulix.fly.dev)' };
    for (const [k, v] of Object.entries(b.headers || {}).slice(0, 40)) { const key = String(k).trim().toLowerCase(); if (!/^[a-z0-9!#$%&'*+.^_`|~-]{1,80}$/.test(key) || HOP.has(key)) continue; headers[key] = String(v).replace(/[\r\n]/g, '').slice(0, 4000); }
    const body = ['GET', 'HEAD', 'OPTIONS'].includes(method) || b.body == null ? null : Buffer.from(String(b.body).slice(0, 500000));
    let r;
    try { r = await send(u, method, headers, body); }
    catch (e) {
      if (e.code === 'EBLOCKED') throw new HttpError(403, 'blocked_target', 'Private and local addresses are blocked');
      throw new HttpError(502, 'request_failed', e.code === 'ETIMEDOUT' ? 'The server did not answer in 12 s' : e.code === 'ENOTFOUND' ? 'That host does not exist' : 'Request failed: ' + (e.code || e.message));
    }
    const type = String(r.headers['content-type'] || ''); const text = /^(text\/|application\/(json|xml|javascript|x-www-form-urlencoded|.*\+json|.*\+xml))/i.test(type) || (!type && !r.body.includes(0));
    return { status: r.status, statusText: r.statusText, headers: r.headers, size: r.body.length, truncated: r.truncated, ms: r.ms, ttfb: r.ttfb,
      body: text ? r.body.toString('utf8') : null, base64: text ? null : r.body.subarray(0, 200000).toString('base64'), contentType: type };
  });
};
