'use strict';
// Nebulix proxy engine. Serves /service/<sid>/<scheme>/<host>/<path> on the isolated proxy origin.
const http = require('http');
const https = require('https');
const net = require('net');
const tls = require('tls');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const cfg = require('../config');
const { HttpError, escapeHtml, now } = require('../util');
const guard = require('./guard');
const sessions = require('./sessions');
const bl = require('./blocklist');
const { rewriteHtml, findBase } = require('./html');
const { rewriteCss } = require('./css');
const { rewriteJs } = require('./js');

const RUNTIME = fs.readFileSync(path.join(__dirname, 'client/runtime.js'));
const RUNTIME_GZ = zlib.gzipSync(RUNTIME, { level: 9 });
const WORKER = fs.readFileSync(path.join(__dirname, 'client/worker.js'), 'utf8');
// Cache-bust the runtime by its own content hash, so a change to runtime.js invalidates every cached copy.
const RUNTIME_HASH = require('crypto').createHash('sha256').update(RUNTIME).digest('hex').slice(0, 12);
const RUNTIME_ETAG = `"rt-${RUNTIME_HASH}"`;

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 128, maxFreeSockets: 32 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 128, maxFreeSockets: 32 });
const stats = { req: 0, bytes: 0, errors: 0, cacheHits: 0, ads: 0, tunnels: 0 };

const UA = {
  chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
  safari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  mobile: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
};
const SERVICE_RE = /^\/service\/([A-Za-z0-9_-]{16,40})(\/.*)?$/;
const TARGET_RE = /^\/(https?|wss?)\/([A-Za-z0-9.\-_:[\]]+)(\/.*)?$/;
const SKIP_URL = /^(#|data:|blob:|javascript:|mailto:|tel:|sms:|about:|magnet:|intent:)/i;

const SKIP_REQ = new Set(['host', 'connection', 'keep-alive', 'proxy-authorization', 'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'cookie', 'referer', 'origin', 'user-agent', 'accept-encoding', 'forwarded', 'via', 'x-real-ip', 'true-client-ip', 'cdn-loop', 'expect', 'content-length', 'if-range']);
const DROP_RES = new Set(['set-cookie', 'content-security-policy', 'content-security-policy-report-only', 'x-frame-options', 'strict-transport-security', 'public-key-pins', 'public-key-pins-report-only', 'expect-ct', 'cross-origin-opener-policy', 'cross-origin-embedder-policy', 'cross-origin-resource-policy', 'report-to', 'nel', 'link', 'alt-svc', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-authenticate', 'proxy-connection', 'permissions-policy', 'feature-policy', 'origin-agent-cluster', 'document-policy', 'x-xss-protection', 'server', 'x-powered-by', 'location']);
const JS_MIMES = new Set(['application/javascript', 'text/javascript', 'application/x-javascript', 'application/ecmascript', 'text/ecmascript', 'application/x-ecmascript', 'text/jscript']);

// ---------- helpers ----------
const split = (url) => { const q = url.indexOf('?'); return q < 0 ? [url, ''] : [url.slice(0, q), url.slice(q)]; };
const toProxy = (sid, abs) => `/service/${sid}/${abs.protocol.slice(0, -1)}/${abs.host}${abs.pathname}${abs.search}${abs.hash}`;
function makeRw(sid) {
  return (u, base) => {
    const s = String(u).trim();
    if (!s || SKIP_URL.test(s)) return u;
    let abs; try { abs = new URL(s, base); } catch { return u; }
    if (!/^(https?|wss?):$/.test(abs.protocol)) return u;
    return toProxy(sid, abs);
  };
}
function realFromProxied(sid, urlStr) { // absolute or root-relative proxied URL -> real URL string (or null)
  try {
    const u = new URL(urlStr, 'http://x');
    const m = SERVICE_RE.exec(u.pathname);
    if (!m || m[1] !== sid) return null;
    const t = TARGET_RE.exec(m[2] || '');
    if (!t) return null;
    return `${t[1]}://${t[2]}${t[3] || '/'}${u.search}`;
  } catch { return null; }
}

function detectCharset(ct, buf, isHtml) {
  let m = /charset\s*=\s*["']?([\w-]+)/i.exec(ct || '');
  if (m) return m[1];
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return 'utf-8';
  if (buf[0] === 0xff && buf[1] === 0xfe) return 'utf-16le';
  if (buf[0] === 0xfe && buf[1] === 0xff) return 'utf-16be';
  if (isHtml) { m = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(buf.subarray(0, 4096).toString('latin1')); if (m) return m[1]; }
  return 'utf-8';
}
function decodeText(buf, cs) { try { return new TextDecoder(cs).decode(buf); } catch { return buf.toString('utf8'); } }

const errorHtml = (title, detail, back) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0c0e;color:#ececef;font-family:Segoe UI,system-ui,sans-serif">
<div style="max-width:440px;padding:28px;text-align:left;background:#131418;border:1px solid #24262c;border-radius:12px;margin:16px">
<div style="width:36px;height:36px;border-radius:9px;background:#d4ff3f;display:grid;place-items:center;color:#0b0c0e;font-weight:700">!</div><h2 style="margin:14px 0 6px;font-size:20px;letter-spacing:-.02em">${escapeHtml(title)}</h2>
<p style="color:#8a8f98;line-height:1.5;margin:0 0 18px">${escapeHtml(detail)}</p>
<p style="margin:0 0 18px"><button onclick="location.reload()" style="background:#d4ff3f;border:0;color:#0b0c0e;font-weight:600;padding:9px 16px;border-radius:8px;font-size:14px;cursor:pointer">Retry</button></p>
<p style="color:#6b7079;font-size:12px;margin:0">${escapeHtml(cfg.brand)} &middot; Created by ${escapeHtml(cfg.creator)}${back ? ' &middot; <a style="color:#d4ff3f" href="' + escapeHtml(cfg.appOrigin) + '" target="_top">Back to app</a>' : ''}</p></div></body></html>`;

function sendError(res, status, title, detail) {
  stats.errors++;
  if (res.headersSent) { try { res.destroy(); } catch {} return; }
  const body = Buffer.from(errorHtml(title, detail, true));
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'" });
  res.end(body);
}

function errorText(e) {
  if (e instanceof HttpError) return e.message;
  const c = e && e.code;
  if (c === 'ENOTFOUND') return 'That address could not be found (DNS lookup failed).';
  if (c === 'EBLOCKED') return 'Private and local addresses are blocked.';
  if (c === 'ECONNREFUSED') return 'The site refused the connection.';
  if (c === 'ECONNRESET' || c === 'EPIPE') return 'The connection was reset by the site.';
  if (c === 'ETIMEDOUT' || (e && /timeout/i.test(e.message))) return 'The site took too long to answer.';
  if (c && String(c).startsWith('ERR_TLS') || c === 'CERT_HAS_EXPIRED' || c === 'DEPTH_ZERO_SELF_SIGNED_CERT' || c === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || c === 'ERR_SSL_WRONG_VERSION_NUMBER') return 'The secure connection to the site failed (certificate or TLS problem).';
  return 'Could not reach the site' + (c ? ' (' + c + ')' : '') + '.';
}

// ---------- extensions ----------
function matchPattern(p, href) {
  try {
    if (p === '<all_urls>') return /^https?:/i.test(href);
    const m = /^(\*|https?):\/\/(\*|\*\.[^/*]+|[^/*]+)(\/.*)$/.exec(p);
    if (!m) return false;
    const u = new URL(href);
    if (m[1] === '*' ? !/^https?:$/.test(u.protocol) : m[1] + ':' !== u.protocol) return false;
    const h = m[2];
    if (h !== '*') {
      if (h.startsWith('*.')) { const d = h.slice(2); if (u.hostname !== d && !u.hostname.endsWith('.' + d)) return false; }
      else if (u.hostname !== h) return false;
    }
    return new RegExp('^' + m[3].replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$').test(u.pathname + u.search);
  } catch { return false; }
}
const jsonSafe = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
function extInject(sess, u) {
  let out = '';
  for (const e of sess.ext || []) {
    if (!e.on) continue;
    const href = u.href;
    if (!(e.matches || []).some((p) => matchPattern(p, href)) || (e.excludes || []).some((p) => matchPattern(p, href))) continue;
    const meta = { name: e.name, manifest: e.manifest || {}, messages: e.messages || {}, files: e.files || {} };
    for (const css of e.css || []) out += `<style data-nx-ext="${escapeHtml(e.id)}">${String(css).replace(/<\/style/gi, '<\\/style')}</style>`;
    for (const js of e.js || []) {
      out += `<script>__nx$.ext(${jsonSafe(e.id)},${jsonSafe(meta)},function(chrome,browser){\n${String(js).replace(/<\/script/gi, '<\\/script')}\n},${jsonSafe(e.runAt || 'document_idle')})</script>`;
    }
  }
  return out;
}

const SHIELD_JS = `(function(){try{var no=function(){throw new DOMException('WebRTC is disabled by Nebulix VPN','NotAllowedError')};['RTCPeerConnection','webkitRTCPeerConnection','mozRTCPeerConnection','RTCDataChannel'].forEach(function(k){try{Object.defineProperty(window,k,{value:no,configurable:false,writable:false})}catch(e){}});
if(navigator.mediaDevices){try{navigator.mediaDevices.enumerateDevices=function(){return Promise.resolve([])}}catch(e){}}
try{Object.defineProperty(navigator,'languages',{get:function(){return['en-US','en']}});Object.defineProperty(navigator,'language',{get:function(){return'en-US'}})}catch(e){}
try{var R=Intl.DateTimeFormat.prototype.resolvedOptions;Intl.DateTimeFormat.prototype.resolvedOptions=function(){var o=R.apply(this,arguments);o.timeZone='UTC';return o}}catch(e){}
try{navigator.getBattery&&(navigator.getBattery=undefined)}catch(e){}}catch(e){}})();`;
function buildInject(sess, u, baseHrefUrl, ref) {
  const c = { prefix: `/service/${sess.sid}/`, base: u.href, baseHref: baseHrefUrl ? baseHrefUrl.href : null, app: cfg.appOrigin, apps: cfg.appOrigins(), cookies: sess.jar.documentCookie(u), ref: ref || '', v: 1 };
  return (sess.prefs.vpn ? '<script src="/__nx/shield.js"></script>' : '') + `<script src="/__nx/runtime.js?v=${RUNTIME_HASH}" data-cfg="${encodeURIComponent(JSON.stringify(c))}"></script>` + extInject(sess, u);
}

// ---------- tiny LRU cache for pass-through assets ----------
const cache = new Map(); let cacheBytes = 0;
function cacheGet(k) { const e = cache.get(k); if (!e) return null; if (e.exp < now()) { cache.delete(k); cacheBytes -= e.body.length; return null; } cache.delete(k); cache.set(k, e); return e; }
function cachePut(k, e) {
  const max = cfg.proxyCacheMB * 1048576;
  if (e.body.length > 4 * 1048576 || max <= 0) return;
  const old = cache.get(k); if (old) { cacheBytes -= old.body.length; cache.delete(k); }
  cache.set(k, e); cacheBytes += e.body.length;
  while (cacheBytes > max) { const first = cache.keys().next().value; cacheBytes -= cache.get(first).body.length; cache.delete(first); }
}
function ttlOf(h) {
  const cc = String(h['cache-control'] || '').toLowerCase();
  if (/no-store|no-cache|private/.test(cc)) return 0;
  const m = /s-maxage=(\d+)/.exec(cc) || /max-age=(\d+)/.exec(cc);
  return m ? Math.min(parseInt(m[1], 10), 3600) : 0;
}

// ---------- request headers ----------
function buildHeaders(req, sess, u, refReal) {
  const h = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (SKIP_REQ.has(k) || k.startsWith('sec-fetch-') || k.startsWith('x-forwarded-') || k.startsWith('cf-') || k.startsWith('x-nx')) continue;
    h[k] = v;
  }
  const mode = sess.prefs.ua || 'auto';
  if (mode !== 'auto' && UA[mode]) { h['user-agent'] = UA[mode]; for (const k of Object.keys(h)) if (k.startsWith('sec-ch-ua')) delete h[k]; }
  else h['user-agent'] = req.headers['user-agent'] || UA.chrome;
  if (sess.prefs.vpn) { h['user-agent'] = UA.chrome; for (const k of Object.keys(h)) if (k.startsWith('sec-ch-ua')) delete h[k]; h['accept-language'] = 'en-US,en;q=0.9'; delete h.dnt; } // VPN mode: a common, generic identity
  h.host = u.host;
  h['accept-encoding'] = 'gzip, deflate, br';
  const ck = sess.jar.header(u); if (ck) h.cookie = ck;
  if (refReal) { h.referer = refReal; }
  if (req.headers.origin) { try { h.origin = refReal ? new URL(refReal).origin : u.origin; } catch { h.origin = u.origin; } }
  else if (req.method !== 'GET' && req.method !== 'HEAD') { try { h.origin = refReal ? new URL(refReal).origin : u.origin; } catch {} }
  if (req.headers['content-length']) h['content-length'] = req.headers['content-length'];
  if (!h['accept-language']) h['accept-language'] = 'en-US,en;q=0.9';
  return h;
}

function resHeaders(up) {
  const h = {};
  for (const [k, v] of Object.entries(up)) if (!DROP_RES.has(k)) h[k] = v;
  h['x-robots-tag'] = 'noindex';
  return h;
}

function inferFromReferer(req) {
  const ref = req.headers.referer;
  if (!ref) return null;
  try {
    const r = new URL(ref);
    if (r.host !== req.headers.host) return null;
    const m = SERVICE_RE.exec(r.pathname); if (!m) return null;
    const t = TARGET_RE.exec(m[2] || ''); if (!t) return null;
    return { sid: m[1], prefix: `/${t[1]}/${t[2]}` };
  } catch { return null; }
}

function rateOk(sess) {
  const t = now();
  if (t - sess.rate.t > 10000) { sess.rate.t = t; sess.rate.n = 0; }
  return ++sess.rate.n <= 600;
}

function pushLog(sess, e) { sess.log.push(e); if (sess.log.length > 250) sess.log.splice(0, 50); }

const CSP = () => `default-src 'self' data: blob: 'unsafe-inline' 'unsafe-eval'; connect-src 'self' data: blob: ws://${cfg.proxyHost} wss://${cfg.proxyHost}; frame-ancestors 'self' ${cfg.appOrigins().join(' ')}; form-action 'self'; base-uri 'self'; object-src 'self'`;

// ---------- main handler ----------
async function handle(req, res) {
  const [pathname, search] = split(req.url);
  if (pathname === '/__nx/runtime.js') return serveRuntime(req, res);
  // VPN mode: stop pages from discovering your real IP through WebRTC (the classic VPN leak)
  if (pathname === '/__nx/shield.js') { res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }); return res.end(SHIELD_JS); }
  if (pathname === '/' || pathname === '/index.html') {
    const body = Buffer.from(`<!doctype html><meta charset="utf-8"><title>${escapeHtml(cfg.brand)} proxy node</title><body style="font-family:system-ui;background:#0b0c0e;color:#ececef;display:grid;place-items:center;min-height:100vh;margin:0"><div style="text-align:center"><h1>&#10022; ${escapeHtml(cfg.brand)} proxy node</h1><p>This address serves proxied pages for the app.</p><p><a style="color:#a5b4fc" href="${escapeHtml(cfg.appOrigin)}">Open ${escapeHtml(cfg.brand)}</a></p><p style="color:#8d86c9">Created by ${escapeHtml(cfg.creator)}</p></div>`);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
    return res.end(body);
  }
  let sid; let rest;
  const m = SERVICE_RE.exec(pathname);
  if (m) { sid = m[1]; rest = m[2] || '/'; }
  else {
    const inf = inferFromReferer(req);
    if (!inf) return sendError(res, 404, 'Not found', 'Open pages from inside the app so links can be routed through the proxy.');
    sid = inf.sid; rest = inf.prefix + pathname;
  }
  const sess = sessions.get(sid);
  if (!sess) return sendError(res, 440, 'Session expired', 'Go back to the app and open the page again to start a new session.');
  if (!rateOk(sess)) { res.writeHead(429, { 'Retry-After': '5' }); return res.end('Too many requests'); }

  if (rest === '/__cookie') return handleCookie(req, res, sess);
  const t = TARGET_RE.exec(rest);
  if (!t) return sendError(res, 400, 'Bad address', 'That proxied address is not valid.');
  let u;
  try { u = new URL(`${t[1]}://${t[2]}${t[3] || '/'}${search}`); } catch { return sendError(res, 400, 'Bad address', 'That address is not valid.'); }
  if (u.protocol === 'ws:' || u.protocol === 'wss:') return sendError(res, 400, 'WebSocket address', 'This address is only available as a WebSocket.');
  try { guard.checkUrl(u); } catch (e) { return sendError(res, e.status || 403, 'Blocked', errorText(e)); }
  if (bl.isBlocked(u.hostname)) return sendError(res, 403, 'Blocked', 'This site is blocked by the server administrator.');
  if (sess.prefs.adblock && bl.isAd(u.hostname)) {
    sess.stats.ads++; stats.ads++;
    pushLog(sess, { t: now(), m: req.method, u: u.host + u.pathname.slice(0, 80), s: 204, b: 0, ms: 0, c: 'AD' });
    res.writeHead(204, { 'Cache-Control': 'max-age=300' }); return res.end();
  }
  if (sess.prefs.stripTracking && u.search) u.search = require('./blocklist').stripTracking(u.search);
  return fetchUpstream(req, res, sess, u);
}

function fetchUpstream(req, res, sess, u) {
  const t0 = now();
  const dest = req.headers['sec-fetch-dest'] || '';
  const refReal = req.headers.referer ? realFromProxied(sess.sid, req.headers.referer) : null;
  const method = req.method;
  sess.stats.req++; stats.req++;

  // cache
  const cacheable = method === 'GET' && sess.prefs.cache && !req.headers.range && !req.headers.authorization;
  if (cacheable) {
    const hit = cacheGet(u.href);
    if (hit && (hit.enc === '' || String(req.headers['accept-encoding'] || '').includes(hit.enc))) {
      sess.stats.cached++; stats.cacheHits++;
      res.writeHead(hit.status, Object.assign({}, hit.headers, { 'x-nebulix-cache': 'HIT' }));
      res.end(hit.body);
      pushLog(sess, { t: now(), m: method, u: u.host + u.pathname.slice(0, 80), s: hit.status, b: hit.body.length, ms: now() - t0, c: 'HIT' });
      return;
    }
  }

  const lib = u.protocol === 'https:' ? https : http;
  const opts = {
    method, hostname: u.hostname.replace(/^\[|\]$/g, ''), port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search,
    headers: buildHeaders(req, sess, u, refReal), agent: u.protocol === 'https:' ? httpsAgent : httpAgent, lookup: guard.lookup,
  };
  if (u.protocol === 'https:' && !net.isIP(opts.hostname)) opts.servername = opts.hostname;
  const up = lib.request(opts);
  up.setTimeout(30000, () => up.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
  res.on('close', () => { if (!res.writableEnded) up.destroy(); });
  up.on('error', (e) => {
    pushLog(sess, { t: now(), m: method, u: u.host + u.pathname.slice(0, 80), s: 502, b: 0, ms: now() - t0, c: 'ERR' });
    sendError(res, e instanceof HttpError ? e.status : 502, 'Could not open this page', errorText(e));
  });
  up.on('response', (r) => onResponse(req, res, sess, u, r, dest, refReal, t0, cacheable));
  if (method === 'GET' || method === 'HEAD') up.end(); else req.pipe(up);
}

function classify(mime, dest, sess, req, status) {
  if (req.method === 'HEAD' || status === 204 || status === 304) return 'pass';
  if (mime === 'text/html' || mime === 'application/xhtml+xml') return 'html';
  if (mime === 'text/css') return 'css';
  if (sess.prefs.jsRewrite !== false && (JS_MIMES.has(mime) || (dest === 'script' && (mime === '' || mime === 'text/plain')) || ((dest === 'worker' || dest === 'sharedworker') && (mime === '' || mime === 'text/plain')))) return 'js';
  return 'pass';
}

function onResponse(req, res, sess, u, up, dest, refReal, t0, cacheable) {
  const status = up.statusCode;
  const sc = up.headers['set-cookie'];
  if (sc && sc.length) sess.jar.set(sc, u);
  const logIt = (bytes, c) => pushLog(sess, { t: now(), m: req.method, u: u.host + u.pathname.slice(0, 80), s: status, b: bytes, ms: now() - t0, c: c || 'MISS' });

  if (status >= 300 && status < 400 && up.headers.location) {
    let loc = null; try { loc = new URL(up.headers.location, u); } catch {}
    if (loc && /^https?:$/.test(loc.protocol)) {
      up.resume();
      res.writeHead(status, Object.assign(resHeaders(up.headers), { location: toProxy(sess.sid, loc), 'content-length': '0' }));
      res.end(); logIt(0, 'REDIR'); return;
    }
  }

  const ct = up.headers['content-type'] || '';
  const mime = ct.split(';')[0].trim().toLowerCase();
  const enc = String(up.headers['content-encoding'] || '').toLowerCase().trim();
  let kind = classify(mime, dest, sess, req, status);
  const decoder = enc === 'gzip' || enc === 'x-gzip' ? () => zlib.createGunzip() : enc === 'br' ? () => zlib.createBrotliDecompress() : enc === 'deflate' ? () => zlib.createInflate() : null;
  if (kind !== 'pass' && enc && enc !== 'identity' && !decoder) kind = 'pass';

  if (kind === 'pass') {
    const h = resHeaders(up.headers);
    const ttl = ttlOf(up.headers);
    const store = cacheable && status === 200 && !sc && ttl > 0 && Number(up.headers['content-length'] || 0) <= 4 * 1048576;
    res.writeHead(status, h);
    if (req.method === 'HEAD') { res.end(); logIt(0); return; }
    let bytes = 0; const chunks = store ? [] : null;
    up.on('data', (c) => { bytes += c.length; sess.stats.bytes += c.length; stats.bytes += c.length; if (chunks) { chunks.push(c); if (bytes > 4 * 1048576) chunks.length = 0; } });
    up.on('end', () => {
      logIt(bytes);
      if (chunks && chunks.length) cachePut(u.href, { status, headers: h, body: Buffer.concat(chunks), exp: now() + ttl * 1000, enc: enc === 'br' ? 'br' : enc === 'gzip' ? 'gzip' : enc === 'deflate' ? 'deflate' : '' });
    });
    up.pipe(res);
    return;
  }

  // ---- rewritten content: buffer, decode, rewrite ----
  const cap = kind === 'html' ? 25e6 : kind === 'js' ? 40e6 : 10e6;
  const chunks = []; let size = 0; let aborted = false;
  const src = decoder ? up.pipe(decoder()) : up;
  const fail = (e) => { if (aborted) return; aborted = true; up.destroy(); logIt(0, 'ERR'); sendError(res, 502, 'Could not read this page', e instanceof HttpError ? e.message : 'The response could not be processed.'); };
  src.on('error', fail);
  src.on('data', (c) => { size += c.length; if (size > cap) return fail(new HttpError(502, 'too_big', 'This file is too large to process.')); chunks.push(c); });
  src.on('end', () => {
    if (aborted) return;
    try { finishRewritten(req, res, sess, u, up, kind, dest, ct, Buffer.concat(chunks), refReal, logIt); } catch (e) { console.error('[proxy] rewrite failed', u.href, e && e.message); fail(e); }
  });
}

function finishRewritten(req, res, sess, u, up, kind, dest, ct, buf, refReal, logIt) {
  const rw = makeRw(sess.sid);
  const h = resHeaders(up.headers);
  for (const k of ['content-length', 'content-encoding', 'etag', 'last-modified', 'accept-ranges', 'content-md5', 'digest', 'content-range']) delete h[k];
  let body; let type;
  const jsOn = sess.prefs.jsRewrite !== false;
  if (kind === 'html') {
    const text = decodeText(buf, detectCharset(ct, buf, true));
    const baseUrl = findBase(text, u);
    const docDest = !dest || ['document', 'iframe', 'frame', 'embed', 'object'].includes(dest);
    const out = rewriteHtml(text, {
      base: baseUrl || u, rw, jsOn, rwJs: (c) => rewriteJs(c, (x) => rw(x, baseUrl || u)),
      inject: docDest ? buildInject(sess, u, baseUrl, refReal) : '',
    });
    body = Buffer.from(out, 'utf8'); type = 'text/html; charset=utf-8';
    h['cache-control'] = 'no-cache'; h['referrer-policy'] = 'same-origin';
    if (docDest) h['content-security-policy'] = CSP();
  } else if (kind === 'css') {
    const text = decodeText(buf, detectCharset(ct, buf, false));
    body = Buffer.from(rewriteCss(text, u, rw), 'utf8'); type = 'text/css; charset=utf-8';
  } else {
    const text = decodeText(buf, detectCharset(ct, buf, false));
    let code = rewriteJs(text, (x) => rw(x, u));
    if (dest === 'worker' || dest === 'sharedworker') code = `self.__nx_wcfg=${JSON.stringify({ prefix: `/service/${sess.sid}/`, base: u.href })};\n${WORKER}\n${code}`;
    body = Buffer.from(code, 'utf8'); type = 'text/javascript; charset=utf-8';
  }
  h['content-type'] = type; h.vary = 'Accept-Encoding';
  sess.stats.bytes += body.length; stats.bytes += body.length;
  const ae = String(req.headers['accept-encoding'] || '');
  const done = (b, encName) => {
    if (encName) h['content-encoding'] = encName;
    h['content-length'] = b.length;
    res.writeHead(up.statusCode, h);
    if (req.method === 'HEAD') res.end(); else res.end(b);
    logIt(b.length);
  };
  if (body.length < 1024) return done(body);
  if (/\bbr\b/.test(ae)) zlib.brotliCompress(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: body.length } }, (e, z) => (e ? done(body) : done(z, 'br')));
  else if (/\bgzip\b/.test(ae)) zlib.gzip(body, { level: 5 }, (e, z) => (e ? done(body) : done(z, 'gzip')));
  else done(body);
}

function handleCookie(req, res, sess) {
  if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
  const chunks = []; let n = 0;
  req.on('data', (c) => { n += c.length; if (n < 8192) chunks.push(c); });
  req.on('end', () => {
    try {
      const j = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const url = new URL(String(j.url));
      guard.checkUrl(url);
      const ck = String(j.cookie || '').replace(/;\s*httponly/gi, '');
      sess.jar.set([ck], url);
    } catch {}
    res.writeHead(204, { 'Cache-Control': 'no-store' }); res.end();
  });
}

function serveRuntime(req, res) {
  const h = { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache', ETag: RUNTIME_ETAG, Vary: 'Accept-Encoding' };
  if (req.headers['if-none-match'] === RUNTIME_ETAG) { res.writeHead(304, h); return res.end(); }
  if (/\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) { h['Content-Encoding'] = 'gzip'; h['Content-Length'] = RUNTIME_GZ.length; res.writeHead(200, h); return res.end(RUNTIME_GZ); }
  h['Content-Length'] = RUNTIME.length; res.writeHead(200, h); res.end(RUNTIME);
}

// ---------- WebSocket tunnel (raw byte pipe after the upgrade handshake) ----------
function handleUpgrade(req, socket, head) {
  const deny = (code, msg) => { try { socket.write(`HTTP/1.1 ${code} ${msg}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); } catch {} socket.destroy(); };
  try {
    if (req.headers.origin !== cfg.proxyOrigin) return deny(403, 'Forbidden');
    const [pathname, search] = split(req.url);
    const m = SERVICE_RE.exec(pathname);
    if (!m) return deny(404, 'Not Found');
    const sess = sessions.get(m[1]);
    if (!sess) return deny(440, 'Session Expired');
    const t = TARGET_RE.exec(m[2] || '');
    if (!t || (t[1] !== 'ws' && t[1] !== 'wss')) return deny(400, 'Bad Request');
    const u = new URL(`${t[1]}://${t[2]}${t[3] || '/'}${search}`);
    guard.checkUrl(u);
    if (bl.isBlocked(u.hostname) || (sess.prefs.adblock && bl.isAd(u.hostname))) return deny(403, 'Blocked');
    if (sess.tunnels >= 16) return deny(429, 'Too Many Tunnels');
    const key = req.headers['sec-websocket-key'];
    if (!key || String(req.headers.upgrade).toLowerCase() !== 'websocket') return deny(400, 'Bad Request');
    const secure = u.protocol === 'wss:';
    const port = parseInt(u.port || (secure ? 443 : 80), 10);
    const host = u.hostname.replace(/^\[|\]$/g, '');
    const refReal = req.headers.referer ? realFromProxied(sess.sid, req.headers.referer) : null;
    const ua = (sess.prefs.ua && sess.prefs.ua !== 'auto' && UA[sess.prefs.ua]) || req.headers['user-agent'] || UA.chrome;
    const connectOpts = { host, port, lookup: guard.lookup };
    if (secure && !net.isIP(host)) connectOpts.servername = host;
    const sock = (secure ? tls : net).connect(connectOpts);
    sess.tunnels++; stats.tunnels++;
    let closed = false;
    const end = () => { if (closed) return; closed = true; sess.tunnels--; try { sock.destroy(); } catch {} try { socket.destroy(); } catch {} };
    sock.setTimeout(600000, end); socket.setTimeout(600000, end);
    sock.on('error', end); socket.on('error', end); sock.on('close', end); socket.on('close', end);
    sock.on(secure ? 'secureConnect' : 'connect', () => {
      let o; try { o = refReal ? new URL(refReal).origin : u.origin.replace(/^ws/, 'http'); } catch { o = u.origin.replace(/^ws/, 'http'); }
      const ck = sess.jar.header(new URL(u.href.replace(/^ws/, 'http')));
      let hs = `GET ${u.pathname}${u.search} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: ${req.headers['sec-websocket-version'] || '13'}\r\nOrigin: ${o}\r\nUser-Agent: ${ua}\r\n`;
      if (req.headers['sec-websocket-protocol']) hs += `Sec-WebSocket-Protocol: ${req.headers['sec-websocket-protocol']}\r\n`;
      if (req.headers['sec-websocket-extensions']) hs += `Sec-WebSocket-Extensions: ${req.headers['sec-websocket-extensions']}\r\n`;
      if (ck) hs += `Cookie: ${ck}\r\n`;
      sock.write(hs + '\r\n');
      if (head && head.length) sock.write(head);
      socket.pipe(sock); sock.pipe(socket);
    });
  } catch (e) { deny(e.status || 400, 'Blocked'); }
}

module.exports = { handle, handleUpgrade, stats, matchPattern, cacheStats: () => ({ entries: cache.size, bytes: cacheBytes }), UA };
