'use strict';
// Small utility endpoints: health check and the "Nerd mode" network lab (latency, down/up speed, header echo).
const os = require('os');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const cfg = require('../config');
const { S, hub } = require('../state');
const { HttpError, now, Limiter } = require('../util');
const { checkUrl, lookup } = require('../proxy/guard');

const started = now();
const speedLim = new Limiter(24, 60000);
const reachLim = new Limiter(40, 60000);

module.exports = function register(r) {
  r.get('/api/health', async () => ({ ok: true, brand: cfg.brand, creator: cfg.creator, version: cfg.VERSION, t: now() }));
  // ---- Web Push (13.8) ----
  const wp = require('../webpush');
  r.get('/api/push/key', { auth: true }, async (c) => ({ key: wp.publicKey(), on: !!(c.user.push && c.user.push.length) && !(c.user.settings && c.user.settings.push === false) }));
  r.post('/api/push/subscribe', { auth: true, limit: [20, 600000, 'user'] }, async (c) => { if (!wp.subscribe(c.user, c.body && c.body.sub)) throw new HttpError(400, 'bad_sub', 'This browser cannot receive notifications from Nebulix'); if (c.user.settings && c.user.settings.push === false) { c.user.settings.push = true; S.store.touch('users'); } return { ok: true }; });
  r.post('/api/push/unsubscribe', { auth: true, limit: [20, 600000, 'user'] }, async (c) => { wp.unsubscribe(c.user, String((c.body && c.body.endpoint) || '')); return { ok: true }; });
  r.post('/api/push/test', { auth: true, limit: [5, 600000, 'user'] }, async (c) => { const es = c.user.lang === 'es'; const n = await wp.send(c.user.id, { title: 'Nebulix', body: es ? 'Las notificaciones funcionan.' : 'Notifications are working.', url: '/#/settings', tag: 'test' }); if (!n) throw new HttpError(400, 'no_push', 'No device could receive it'); return { sent: n }; });

  r.get('/api/nerd/ping', async () => ({ t: now() }));

  // Download test: N MB of incompressible bytes
  r.get('/api/nerd/blob', { auth: true }, async (c) => {
    if (!speedLim.hit(c.user.id)) throw new HttpError(429, 'rate_limited', 'Speed tests are limited, wait a moment');
    const mb = Math.max(1, Math.min(40, parseInt(c.query.mb, 10) || 8));
    const total = mb * 1048576; const res = c.res;
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': total, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    const chunk = crypto.randomBytes(65536);
    let sent = 0;
    await new Promise((resolve) => {
      const pump = () => {
        while (sent < total) {
          const n = Math.min(chunk.length, total - sent);
          sent += n;
          if (!res.write(n === chunk.length ? chunk : chunk.subarray(0, n))) { res.once('drain', pump); return; }
        }
        res.end(); resolve();
      };
      res.on('close', resolve); pump();
    });
  });

  // Upload test: swallow up to 25 MB and report how many bytes arrived and how long it took
  r.post('/api/nerd/upload', { auth: true, stream: true }, async (c) => {
    if (!speedLim.hit(c.user.id)) throw new HttpError(429, 'rate_limited', 'Speed tests are limited, wait a moment');
    const t0 = now(); let n = 0;
    await new Promise((resolve, reject) => {
      c.req.on('data', (d) => { n += d.length; if (n > 25 * 1048576) { c.req.destroy(); reject(new HttpError(413, 'too_large', 'Too much data')); } });
      c.req.on('end', resolve); c.req.on('error', reject); c.req.on('aborted', () => reject(new HttpError(400, 'aborted', 'Aborted')));
    });
    return { bytes: n, ms: now() - t0 };
  });

  // What does the server see about you? (privacy check)
  r.get('/api/nerd/echo', { auth: true }, async (c) => {
    const h = Object.assign({}, c.req.headers); delete h.cookie; delete h.authorization;
    return { ip: c.ip, http: c.req.httpVersion, tls: !!c.req.socket.encrypted, headers: h, t: now() };
  });

  // Can this Nebulix server reach a public website? Reports status and a DNS / connect / TLS / first-byte breakdown.
  // Uses the same SSRF guard as the proxy (public addresses only) and never follows redirects.
  r.get('/api/nerd/reach', { auth: true }, async (c) => {
    if (!reachLim.hit(c.user.id)) throw new HttpError(429, 'rate_limited', 'Too many checks, wait a moment');
    let u; try { u = new URL(String(c.query.url || '')); } catch { throw new HttpError(400, 'bad_url', 'That address does not look right'); }
    checkUrl(u); // throws for private / local targets and non-http(s)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new HttpError(400, 'bad_scheme', 'Only http(s) addresses can be checked');
    const lib = u.protocol === 'https:' ? https : http; const t0 = process.hrtime.bigint(); const mark = {};
    const ms = () => Number((process.hrtime.bigint() - t0) / 1000000n);
    return await new Promise((resolve) => {
      let done = false; const fin = (o) => { if (!done) { done = true; resolve(Object.assign({ url: u.origin + '/' }, o)); } };
      const req = lib.request({ method: 'HEAD', hostname: u.hostname.replace(/^\[|\]$/g, ''), port: u.port || undefined, path: '/', lookup, timeout: 7000, headers: { 'User-Agent': 'Nebulix-ReachCheck/1', Accept: '*/*' }, agent: false }, (res) => {
        mark.first = ms(); res.resume();
        fin({ ok: true, status: res.statusCode, ms: mark.first, dns: mark.dns, connect: mark.connect, tls: mark.tls, server: String(res.headers.server || '').slice(0, 40) || null, redirect: res.headers.location ? String(res.headers.location).slice(0, 120) : null });
      });
      req.on('socket', (s) => { s.once('lookup', () => { mark.dns = ms(); }); s.once('connect', () => { mark.connect = ms(); }); s.once('secureConnect', () => { mark.tls = ms(); }); });
      req.on('timeout', () => { req.destroy(); fin({ ok: false, error: 'timeout', ms: ms() }); });
      req.on('error', (e) => fin({ ok: false, error: e.code === 'EBLOCKED' ? 'blocked' : (e.code || 'error'), ms: ms() }));
      req.end();
    });
  });

  r.get('/api/nerd/server', { auth: true }, async () => {
    const m = process.memoryUsage();
    return {
      node: process.version, platform: `${os.type()} ${os.release()} ${os.arch()}`, cpus: os.cpus().length, load: os.loadavg().map((x) => Math.round(x * 100) / 100),
      uptime: Math.floor((now() - started) / 1000), rssMB: Math.round(m.rss / 1048576), heapMB: Math.round(m.heapUsed / 1048576),
      online: hub.count(), version: cfg.VERSION,
    };
  });
};
