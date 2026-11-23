'use strict';
const crypto = require('crypto');

class HttpError extends Error {
  constructor(status, code, message) { super(message || code); this.status = status; this.code = code || 'error'; }
}

const rid = (n = 9) => crypto.randomBytes(n).toString('base64url');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hmac = (key, s) => crypto.createHmac('sha256', key).update(s).digest('hex');
const now = () => Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function safeEqual(a, b) {
  const A = Buffer.from(String(a)); const B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

function parseCookies(h) {
  const o = {};
  if (!h) return o;
  for (const p of h.split(';')) {
    const i = p.indexOf('=');
    if (i < 0) continue;
    const k = p.slice(0, i).trim();
    if (!k || k in o) continue;
    const raw = p.slice(i + 1).trim();
    try { o[k] = decodeURIComponent(raw); } catch { o[k] = raw; }
  }
  return o;
}

function cookieStr(name, value, o = {}) {
  let s = `${name}=${encodeURIComponent(value)}`;
  if (o.maxAge != null) s += `; Max-Age=${Math.floor(o.maxAge)}`;
  s += `; Path=${o.path || '/'}`;
  if (o.httpOnly !== false) s += '; HttpOnly';
  if (o.secure) s += '; Secure';
  s += `; SameSite=${o.sameSite || 'Lax'}`;
  return s;
}

function readBody(req, limit = 1 << 20) {
  return new Promise((resolve, reject) => {
    const len = parseInt(req.headers['content-length'] || '0', 10);
    if (len > limit) {
      // Drain moderately sized bodies before answering so the client reads the 413 instead of a reset connection.
      const err = new HttpError(413, 'too_large', 'Payload too large');
      if (len > 64 * 1048576) { req.resume(); return reject(err); }
      const t = setTimeout(() => { reject(err); req.destroy(); }, 30000);
      req.on('end', () => { clearTimeout(t); reject(err); }); req.on('error', () => { clearTimeout(t); reject(err); });
      return req.resume();
    }
    const chunks = []; let n = 0; let over = false;
    const timer = setTimeout(() => { reject(new HttpError(408, 'timeout', 'Request body timeout')); req.destroy(); }, 60000);
    req.on('data', (c) => { n += c.length; if (n > limit) { over = true; return; } chunks.push(c); });
    req.on('end', () => { clearTimeout(timer); over ? reject(new HttpError(413, 'too_large', 'Payload too large')) : resolve(Buffer.concat(chunks)); });
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.on('aborted', () => { clearTimeout(timer); reject(new HttpError(400, 'aborted', 'Request aborted')); });
  });
}

function sendJson(res, status, obj, headers) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store',
  }, headers || {}));
  res.end(body);
}

const limiters = new Set();
class Limiter {
  constructor(max, windowMs) { this.max = max; this.win = windowMs; this.m = new Map(); limiters.add(this); }
  hit(key, cost = 1) {
    const t = Date.now(); let e = this.m.get(key);
    if (!e || e.r <= t) { e = { n: 0, r: t + this.win }; this.m.set(key, e); }
    e.n += cost;
    return e.n <= this.max;
  }
  reset(key) { this.m.delete(key); }
  retryAfter(key) { const e = this.m.get(key); return e ? Math.max(1, Math.ceil((e.r - Date.now()) / 1000)) : 1; }
  gc() { const t = Date.now(); for (const [k, e] of this.m) if (e.r <= t) this.m.delete(k); }
}
setInterval(() => { for (const l of limiters) l.gc(); }, 60000).unref();

class Semaphore {
  constructor(n) { this.n = n; this.q = []; }
  async run(fn) {
    if (this.n <= 0) await new Promise((r) => this.q.push(r));
    this.n--;
    try { return await fn(); } finally { this.n++; const nx = this.q.shift(); if (nx) nx(); }
  }
}

function normIp(ip) { return String(ip || '').replace(/^::ffff:/, ''); }
function clientIp(req, trust) {
  if (trust) {
    const cf = req.headers['cf-connecting-ip']; if (cf) return normIp(cf);
    const xf = req.headers['x-forwarded-for']; if (xf) return normIp(String(xf).split(',')[0].trim());
  }
  return normIp(req.socket.remoteAddress);
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const V = {
  username: (s) => typeof s === 'string' && /^[A-Za-z0-9_]{3,20}$/.test(s),
  email: (s) => typeof s === 'string' && s.length <= 254 && /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[A-Za-z]{2,}$/.test(s),
  password: (s) => typeof s === 'string' && s.length >= 8 && s.length <= 128,
  str: (s, min, max) => typeof s === 'string' && s.length >= min && s.length <= max,
  int: (n, min, max) => Number.isInteger(n) && n >= min && n <= max,
};
const WEAK = new Set(['password', '12345678', '123456789', 'qwertyui', 'password1', 'iloveyou', '11111111', 'abc12345', 'letmein1', 'minecraft', 'fortnite1']);

function maskEmail(e) {
  const [u, d] = e.split('@');
  return (u.length <= 2 ? u[0] + '*' : u[0] + '*'.repeat(Math.min(u.length - 2, 6)) + u.slice(-1)) + '@' + d;
}

function dayKey(t = Date.now()) { return new Date(t).toISOString().slice(0, 10); }

// time-sortable ids for messages
let lastTs = 0; let seq = 0;
function msgId() {
  const t = Date.now();
  if (t === lastTs) seq++; else { lastTs = t; seq = 0; }
  return t.toString(36).padStart(9, '0') + seq.toString(36).padStart(2, '0') + crypto.randomBytes(3).toString('hex');
}

module.exports = { HttpError, rid, sha256, hmac, now, sleep, safeEqual, parseCookies, cookieStr, readBody, sendJson, Limiter, Semaphore, clientIp, normIp, escapeHtml, V, WEAK, maskEmail, dayKey, msgId };
