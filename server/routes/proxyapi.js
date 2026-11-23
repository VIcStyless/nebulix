'use strict';
// Control API for the proxy: sessions, per-session preferences, logs, cookies and Chrome-style extensions.
const cfg = require('../config');
const { S, isPro, isStaff } = require('../state');
const sessions = require('../proxy/sessions');
const engine = require('../proxy/engine');
const { HttpError, now, rid } = require('../util');

const UAS = ['auto', 'chrome', 'firefox', 'safari', 'mobile'];

function prefsOf(u) {
  const p = (u && u.settings && u.settings.proxy) || {};
  return { adblock: p.adblock !== false, jsRewrite: p.jsRewrite !== false, stripTracking: p.stripTracking !== false, cache: p.cache !== false, ua: UAS.includes(p.ua) ? p.ua : 'auto', vpn: !!p.vpn };
}

// User changed proxy settings -> apply to their live sessions straight away.
function refreshPrefs(u) {
  const p = prefsOf(u);
  for (const s of sessions.ofUser(u.id)) Object.assign(s.prefs, p);
}

const ownerKey = (c) => (c.user ? c.user.id : 'g:' + c.ip);
function own(c, sid) {
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(String(sid))) throw new HttpError(404, 'no_session', 'Session not found');
  const s = sessions.get(String(sid));
  if (!s || s.uid !== ownerKey(c)) throw new HttpError(404, 'no_session', 'Session not found');
  return s;
}
function needProxyAccess(c) {
  if (!c.user && !cfg.allowGuestProxy) throw new HttpError(401, 'unauthorized', 'Log in to use the proxy');
}

// ---------- extensions (content scripts + styles; manifest subset) ----------
const MATCH_RE = /^(<all_urls>|(\*|https?):\/\/(\*|\*\.[A-Za-z0-9.-]+|[A-Za-z0-9.-]+)\/.*)$/;
const MAX_EXT_BYTES = 1.5 * 1048576;
const MAX_TOTAL_BYTES = 8 * 1048576;

function cleanList(a, max, fn) { return (Array.isArray(a) ? a : []).slice(0, max).map(fn).filter((x) => x !== null && x !== undefined && x !== ''); }
function cleanExt(inp, prev) {
  if (!inp || typeof inp !== 'object') throw new HttpError(400, 'bad_ext', 'Invalid extension');
  const name = String(inp.name || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80);
  if (!name) throw new HttpError(400, 'bad_ext', 'The extension has no name');
  const pat = (p) => (typeof p === 'string' && p.length <= 200 && MATCH_RE.test(p) ? p : null);
  const matches = cleanList(inp.matches, 50, pat);
  if (!matches.length) throw new HttpError(400, 'bad_ext', 'This extension has no usable content script (match patterns are missing)');
  const text = (t) => (typeof t === 'string' ? t.slice(0, 600000) : null);
  const css = cleanList(inp.css, 30, text); const js = cleanList(inp.js, 30, text);
  if (!css.length && !js.length) throw new HttpError(400, 'bad_ext', 'This extension has no content scripts or styles Nebulix can run');
  const files = {};
  if (inp.files && typeof inp.files === 'object') {
    let n = 0;
    for (const [k, v] of Object.entries(inp.files)) {
      if (n++ >= 40) break;
      if (typeof v === 'string' && /^[\w./@-]{1,120}$/.test(k) && v.length <= 200000) files[k] = v;
    }
  }
  const messages = {};
  if (inp.messages && typeof inp.messages === 'object') {
    let n = 0;
    for (const [k, v] of Object.entries(inp.messages)) {
      if (n++ >= 300) break;
      if (/^\w{1,60}$/.test(k) && v && typeof v.message === 'string') messages[k] = { message: v.message.slice(0, 400) };
    }
  }
  const mf = inp.manifest && typeof inp.manifest === 'object' ? inp.manifest : {};
  const manifest = {
    name, version: String(mf.version || inp.version || '1.0').slice(0, 20), manifest_version: mf.manifest_version === 3 ? 3 : 2,
    description: String(mf.description || inp.description || '').slice(0, 300), permissions: cleanList(mf.permissions, 40, (x) => (typeof x === 'string' ? x.slice(0, 60) : null)),
  };
  const ext = {
    id: prev ? prev.id : 'x' + rid(6), name, version: manifest.version, description: manifest.description, on: inp.on === undefined ? true : !!inp.on,
    matches, excludes: cleanList(inp.excludes, 50, pat), css, js, files, messages, manifest,
    runAt: ['document_start', 'document_end', 'document_idle'].includes(inp.runAt) ? inp.runAt : 'document_idle', added: prev ? prev.added : now(),
  };
  ext.size = Buffer.byteLength(JSON.stringify(ext));
  if (ext.size > MAX_EXT_BYTES) throw new HttpError(413, 'ext_too_big', 'This extension is too large (limit 1.5 MB of scripts and styles)');
  return ext;
}
const extMeta = (e) => ({ id: e.id, name: e.name, version: e.version, description: e.description, on: e.on, matches: e.matches, runAt: e.runAt, size: e.size, scripts: e.js.length, styles: e.css.length, added: e.added });
function syncExt(u) { for (const s of sessions.ofUser(u.id)) s.ext = u.extensions || []; }

module.exports = function register(r) {
  // ----- sessions -----
  r.post('/api/proxy/session', { limit: [120, 600000] }, async (c) => {
    needProxyAccess(c);
    const s = sessions.create(ownerKey(c), c.user ? prefsOf(c.user) : {}, c.ip);
    s.ext = c.user ? (c.user.extensions || []) : [];
    return { sid: s.sid, origin: cfg.proxyOrigin, prefix: `/service/${s.sid}/`, prefs: s.prefs, ttlHours: 12 };
  });

  r.get('/api/proxy/session/:sid', async (c) => {
    needProxyAccess(c);
    const s = own(c, c.params.sid);
    return { sid: s.sid, created: s.created, prefs: s.prefs, stats: s.stats, cookies: s.jar.size(), tunnels: s.tunnels };
  });

  r.delete('/api/proxy/session/:sid', async (c) => {
    needProxyAccess(c);
    const s = own(c, c.params.sid);
    sessions.sessions.delete(s.sid);
    return { ok: true };
  });

  r.patch('/api/proxy/session/:sid', async (c) => {
    needProxyAccess(c);
    const s = own(c, c.params.sid); const p = c.body.prefs || {};
    for (const k of ['adblock', 'jsRewrite', 'stripTracking', 'cache']) if (p[k] !== undefined) s.prefs[k] = !!p[k];
    if (p.ua !== undefined) { if (!UAS.includes(p.ua)) throw new HttpError(400, 'bad_setting', 'Bad user agent'); s.prefs.ua = p.ua; }
    return { prefs: s.prefs };
  });

  r.get('/api/proxy/log/:sid', async (c) => {
    needProxyAccess(c);
    const s = own(c, c.params.sid);
    return { log: s.log.slice(-150).reverse(), stats: s.stats };
  });

  r.post('/api/proxy/clear/:sid', async (c) => {
    needProxyAccess(c);
    const s = own(c, c.params.sid); const what = String(c.body.what || '');
    if (what === 'cookies') s.jar.clear(c.body.domain ? String(c.body.domain).toLowerCase().slice(0, 253) : undefined);
    else if (what === 'log') { s.log.length = 0; s.stats = { req: 0, bytes: 0, blocked: 0, cached: 0, ads: 0 }; }
    else throw new HttpError(400, 'bad_request', 'Nothing to clear');
    return { ok: true, cookies: s.jar.size() };
  });

  r.get('/api/proxy/cookies/:sid', async (c) => {
    needProxyAccess(c);
    return { cookies: own(c, c.params.sid).jar.list().slice(0, 400) };
  });
  r.post('/api/proxy/cookies/:sid/delete', async (c) => {
    needProxyAccess(c);
    const s = own(c, c.params.sid); const b = c.body;
    return { ok: s.jar.remove(String(b.domain || ''), String(b.path || ''), String(b.name || '')) };
  });

  r.get('/api/proxy/stats', { auth: true }, async (c) => {
    const mine = sessions.ofUser(c.user.id).map((s) => ({ sid: s.sid, created: s.created, last: s.last, stats: s.stats }));
    const out = { sessions: mine };
    if (isStaff(c.user)) out.node = Object.assign({}, engine.stats, { sessions: sessions.count(), cache: engine.cacheStats() });
    return out;
  });

  // ----- extensions -----
  r.get('/api/extensions', { auth: true }, async (c) => {
    const list = (c.user.extensions || []).map(extMeta);
    return { extensions: list, limit: isPro(c.user) ? 20 : 5, bytes: (c.user.extensions || []).reduce((n, e) => n + e.size, 0), maxBytes: MAX_TOTAL_BYTES };
  });

  r.post('/api/extensions', { auth: true, verified: true, limit: [20, 600000, 'user'], bodyLimit: 3 * 1048576 }, async (c) => {
    const u = c.user; u.extensions = u.extensions || [];
    const max = isPro(u) ? 20 : 5;
    if (u.extensions.length >= max) throw new HttpError(400, 'too_many', `You can keep up to ${max} extensions${isPro(u) ? '' : ' (PRO raises this to 20)'}`);
    const ext = cleanExt(c.body.extension);
    if (u.extensions.reduce((n, e) => n + e.size, ext.size) > MAX_TOTAL_BYTES) throw new HttpError(413, 'ext_quota', 'Extension storage is full');
    u.extensions.push(ext); S.store.touch('users'); syncExt(u);
    return { extension: extMeta(ext) };
  });

  r.patch('/api/extensions/:id', { auth: true, limit: [60, 60000, 'user'] }, async (c) => {
    const e = (c.user.extensions || []).find((x) => x.id === c.params.id);
    if (!e) throw new HttpError(404, 'no_ext', 'Extension not found');
    if (c.body.on !== undefined) e.on = !!c.body.on;
    S.store.touch('users'); syncExt(c.user);
    return { extension: extMeta(e) };
  });

  r.delete('/api/extensions/:id', { auth: true, limit: [60, 60000, 'user'] }, async (c) => {
    const u = c.user; const n = (u.extensions || []).length;
    u.extensions = (u.extensions || []).filter((x) => x.id !== c.params.id);
    if (u.extensions.length === n) throw new HttpError(404, 'no_ext', 'Extension not found');
    S.store.touch('users'); syncExt(u);
    return { ok: true };
  });
};

module.exports.refreshPrefs = refreshPrefs;
module.exports.prefsOf = prefsOf;
module.exports.cleanExt = cleanExt;
