'use strict';
// Nebulix main entry: one process, two origins.
//   APP origin   -> UI, API, uploads, realtime WebSocket (/ws)
//   PROXY origin -> proxied pages only (/service/<sid>/...) so a website can never touch your account.
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const net = require('net');
const cfg = require('./config');
const { Router, dispatch } = require('./router');
const { HttpError, sendJson, clientIp, now } = require('./util');
const state = require('./state');
const ws = require('./ws');
const uploads = require('./uploads');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.txt': 'text/plain; charset=utf-8', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.wasm': 'application/wasm', '.iso': 'application/octet-stream', '.img': 'application/octet-stream', '.bin': 'application/octet-stream',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.webmanifest', '.txt', '.wasm', '.img', '.bin']);

let router = null; let engine = null; let authMod = null; let chatMod = null;

function appCsp() {
  const ws = cfg.appOrigins().map((o) => o.replace(/^http/, 'ws')).join(' ');
  return [
    "default-src 'self'", "script-src 'self' 'wasm-unsafe-eval'", "style-src 'self' 'unsafe-inline'", `img-src 'self' data: blob: https://image.pollinations.ai ${cfg.proxyOrigin} https://*.scdn.co https://*.spotifycdn.com https://*.sndcdn.com https://*.ytimg.com https://*.mm.bing.net https://*.bing.com https://*.bing.net https://*.wikimedia.org https://static-cdn.jtvnw.net`, "font-src 'self' data:",
    `connect-src 'self' ${ws} https://text.pollinations.ai https://api.llm7.io ${require('./compute').cspOrigins()}`, `frame-src blob: ${cfg.proxyOrigin}${cfg.gamesOrigin ? ' ' + cfg.gamesOrigin : ''} https://open.spotify.com https://w.soundcloud.com https://www.youtube-nocookie.com https://player.twitch.tv https://www.twitch.tv 'self'`, "media-src 'self' blob: data:", "worker-src 'self' blob:", "object-src 'none'",
    "base-uri 'none'", "form-action 'self'", `frame-ancestors 'self' ${cfg.appOrigins().join(' ')}`, // only Nebulix itself (the about:blank launcher, mirrors) may frame the app
  ].join('; ');
}
function appHeaders() {
  const px = `"${cfg.proxyOrigin}"`; const gx = cfg.gamesOrigin ? ` "${cfg.gamesOrigin}"` : ''; // games domain: Hub games in "domain"/"native" mode get the same features as a Chrome tab
  const h = {
    'Content-Security-Policy': appCsp(), 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': `camera=(self), microphone=(self), display-capture=(self), gamepad=(self ${px}${gx}), fullscreen=(self ${px}${gx} "https://www.youtube-nocookie.com" "https://player.twitch.tv"), autoplay=(self ${px}${gx} "https://open.spotify.com" "https://w.soundcloud.com" "https://www.youtube-nocookie.com" "https://player.twitch.tv"), encrypted-media=(self${gx} "https://open.spotify.com" "https://www.youtube-nocookie.com"), midi=(self${gx}), clipboard-write=(self ${px}${gx}), clipboard-read=(self${gx}), screen-wake-lock=(self${gx}), accelerometer=(self${gx}), gyroscope=(self${gx}), cross-origin-isolated=(self${gx}), geolocation=(), payment=(), usb=(), interest-cohort=()`,
  };
  if (cfg.secureCookies) h['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  return h;
}

// ---------- static files ----------
const fileCache = new Map(); // abs path -> { mtime, size, etag, raw, gz, br }
// big files: streamed from disk with Range support, never held in memory (VM disk images)
function sendBig(req, res, abs, st, type) {
      const etag = '"' + st.size.toString(36) + '-' + Math.floor(st.mtimeMs).toString(36) + '"';
      const base = { 'Content-Type': type, ETag: etag, 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=604800', 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges', 'X-Content-Type-Options': 'nosniff' };
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, base); return res.end(); }
      const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
      if (m) {
        let a = m[1] === '' ? st.size - Number(m[2]) : Number(m[1]); let b = m[1] === '' ? st.size - 1 : (m[2] === '' ? st.size - 1 : Number(m[2]));
        if (!(a >= 0 && a <= b && a < st.size)) { res.writeHead(416, Object.assign({ 'Content-Range': 'bytes */' + st.size }, base)); return res.end(); }
        b = Math.min(b, st.size - 1); res.writeHead(206, Object.assign({ 'Content-Range': `bytes ${a}-${b}/${st.size}`, 'Content-Length': b - a + 1 }, base));
        if (req.method === 'HEAD') return res.end(); return fs.createReadStream(abs, { start: a, end: b }).pipe(res);
      }
      res.writeHead(200, Object.assign({ 'Content-Length': st.size }, base)); if (req.method === 'HEAD') return res.end(); return fs.createReadStream(abs).pipe(res);
    }
// 13.8: all the stylesheets of index.html served as one file (one request instead of 18). Rebuilt when any of them changes.
let cssBundle = null;
function buildCssBundle(html) {
  const hrefs = [...html.matchAll(/<link rel="stylesheet" href="(\/css\/[a-z0-9-]+\.css)">\n?/g)].map((m) => m[1]); if (hrefs.length < 2) return null;
  const files = hrefs.map((h) => path.join(cfg.publicDir, h)); let stamp = '';
  try { stamp = files.map((f) => { const s = fs.statSync(f); return s.size + ':' + Math.floor(s.mtimeMs); }).join('|'); } catch { return null; }
  if (cssBundle && cssBundle.stamp === stamp) return cssBundle;
  const raw = Buffer.from(files.map((f, i) => '/* ' + hrefs[i] + ' */\n' + fs.readFileSync(f, 'utf8')).join('\n'));
  const hash = crypto.createHash('sha1').update(raw).digest('hex').slice(0, 10);
  cssBundle = { stamp, hrefs, url: '/css/bundle-' + hash + '.css', raw, etag: '"b' + hash + '"', gz: zlib.gzipSync(raw, { level: 9 }), br: zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } }) };
  return cssBundle;
}
function cssStamp() { try { return cssBundle.hrefs.map((h) => { const s = fs.statSync(path.join(cfg.publicDir, h)); return s.size + ':' + Math.floor(s.mtimeMs); }).join('|'); } catch { return ''; } }
function bundleHtml(raw) {
  const html = raw.toString('utf8'); const b = buildCssBundle(html); if (!b) return raw;
  let first = true; const out = html.replace(/<link rel="stylesheet" href="\/css\/[a-z0-9-]+\.css">\n?/g, () => { if (!first) return ''; first = false; return '<link rel="stylesheet" href="' + b.url + '">\n'; });
  return Buffer.from(out);
}
function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end(); }
  if (/^\/css\/bundle-[0-9a-f]{10}\.css$/.test(pathname) && cssBundle && pathname === cssBundle.url) {
    const b = cssBundle; const ae = String(req.headers['accept-encoding'] || ''); const h = { 'Content-Type': 'text/css; charset=utf-8', ETag: b.etag, 'Cache-Control': 'public, max-age=31536000, immutable', Vary: 'Accept-Encoding' };
    if (req.headers['if-none-match'] === b.etag) { res.writeHead(304, h); return res.end(); }
    let body = b.raw; if (/\bbr\b/.test(ae)) { body = b.br; h['Content-Encoding'] = 'br'; } else if (/\bgzip\b/.test(ae)) { body = b.gz; h['Content-Encoding'] = 'gzip'; }
    h['Content-Length'] = body.length; res.writeHead(200, h); return res.end(req.method === 'HEAD' ? undefined : body);
  }
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { res.writeHead(400); return res.end(); }
  if (rel.includes('\0') || rel.includes('\\')) { res.writeHead(400); return res.end(); }
  if (rel === '/' || rel === '') rel = '/index.html';
  const abs = path.resolve(cfg.publicDir, '.' + rel);
  if (abs !== cfg.publicDir && !abs.startsWith(cfg.publicDir + path.sep)) { res.writeHead(403); return res.end(); }
  if (path.basename(abs).startsWith('.')) { res.writeHead(404); return res.end(); }
  fs.stat(abs, (err, st) => {
    if (err || !st.isFile()) return notFound(res);
    const ext = path.extname(abs).toLowerCase();
    const type = MIME[ext];
    if (!type) return notFound(res);
    // big files (disk images for the virtual machines): streamed from disk with Range support, never held in memory
    if (st.size > 4 * 1048576) return sendBig(req, res, abs, st, type);
    let ent = fileCache.get(abs);
    const fresh = ent && ent.mtime === st.mtimeMs && ent.size === st.size && (rel !== '/index.html' || !cssBundle || ent.css === cssStamp());
    const send = () => {
      const h = Object.assign({ 'Content-Type': type, ETag: ent.etag, 'Cache-Control': ext === '.html' || ext === '.js' || ext === '.css' || ext === '.mjs' || ext === '.json' ? 'no-cache' : 'public, max-age=86400' }, appHeaders());
      if (ext !== '.html') { delete h['Content-Security-Policy']; delete h['X-Frame-Options']; delete h['Cross-Origin-Opener-Policy']; delete h['Permissions-Policy']; }
      if (req.headers['if-none-match'] === ent.etag) { res.writeHead(304, h); return res.end(); }
      const ae = String(req.headers['accept-encoding'] || '');
      let body = ent.raw;
      if (COMPRESSIBLE.has(ext) && ent.raw.length > 1024) {
        if (/\bbr\b/.test(ae) && ent.br) { body = ent.br; h['Content-Encoding'] = 'br'; }
        else if (/\bgzip\b/.test(ae) && ent.gz) { body = ent.gz; h['Content-Encoding'] = 'gzip'; }
        h.Vary = 'Accept-Encoding';
      }
      h['Content-Length'] = body.length;
      res.writeHead(200, h);
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    if (fresh) return send();
    fs.readFile(abs, (e2, raw) => {
      if (e2) return notFound(res);
      if (rel === '/index.html') { try { raw = bundleHtml(raw); } catch (err) { console.error('[css bundle]', err.message); } }
      ent = { mtime: st.mtimeMs, size: st.size, raw, etag: `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`, gz: null, br: null };
      if (COMPRESSIBLE.has(ext) && raw.length > 1024) {
        try { const big = raw.length > 1048576; ent.gz = zlib.gzipSync(raw, { level: big ? 5 : 9 }); ent.br = zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: big ? 4 : 9 } }); } catch {} // big files (emulator, disk images): fast settings so the server never stalls
      }
      if (rel === '/index.html' && cssBundle) { ent.css = cssBundle.stamp; ent.etag = ent.etag.slice(0, -1) + '-' + cssBundle.etag.slice(2, -1) + '"'; } // the page changes when the styles do
      fileCache.set(abs, ent);
      send();
    });
  });
}
function notFound(res) {
  const body = Buffer.from('Not found');
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
  res.end(body);
}

// ---------- request routing ----------
function onRequest(req, res) {
  const host = String(req.headers.host || '').toLowerCase();
  const t0 = now();
  if (process.env.LOG_REQUESTS) res.on('finish', () => console.log(`${req.method} ${host}${req.url} -> ${res.statusCode} ${now() - t0}ms`));
  if (host === cfg.proxyHost) {
    Promise.resolve(engine.handle(req, res)).catch((e) => {
      console.error('[proxy] unhandled', e && e.stack || e);
      if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'text/plain' }); res.end('Proxy error'); } else res.destroy();
    });
    return;
  }
  if (cfg.gamesHost && host === cfg.gamesHost) return require('./routes/hub').serveGameDomain(req, res);
  if (!cfg.appHosts().includes(host)) {
    // Unknown Host header: refuse (blocks DNS-rebinding and stray virtual hosts)
    const body = Buffer.from(`This address is not served by ${cfg.brand}. Open ${cfg.appOrigin}\n`);
    res.writeHead(421, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': body.length });
    return res.end(body);
  }
  let url;
  try { url = new URL(req.url, cfg.appOrigin); } catch { res.writeHead(400); return res.end(); }
  const p = url.pathname;
  if (p.startsWith('/api/')) {
    for (const [k, v] of Object.entries({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin' })) res.setHeader(k, v);
    return dispatch(router, req, res, url, authMod.fromRequest);
  }
  if (p.startsWith('/uploads/')) return uploads.serve(req, res, p.slice(9));
  // user content (repo previews, Hub games/apps, Drive files): plain router routes with their own sandboxed headers
  if (p.startsWith('/x/')) return dispatch(router, req, res, url, authMod.fromRequest);
  // big OS images kept on the data volume (e.g. Android-x86), streamed with Range support
  if (/^\/vmd\/[A-Za-z0-9._-]{3,80}\.(iso|img)$/.test(p)) { const abs = path.join(cfg.dataDir, 'vm', path.basename(p)); return fs.stat(abs, (err, st) => (err || !st.isFile() ? notFound(res) : sendBig(req, res, abs, st, 'application/octet-stream'))); }
  // short links from the link generator: /l/<code> → a page inside Nebulix (internal destinations only)
  if (/^\/l\/[A-Za-z0-9_-]{2,32}$/.test(p)) return require('./routes/links').redirect(req, res, p.slice(3));
  if (p === '/robots.txt') { const b = Buffer.from('User-agent: *\nDisallow: /api/\nDisallow: /uploads/\n'); res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': b.length }); return res.end(b); }
  return serveStatic(req, res, p);
}

const wsCount = new Map();
function onUpgrade(req, socket, head) {
  const host = String(req.headers.host || '').toLowerCase();
  socket.on('error', () => {});
  if (host === cfg.proxyHost) return engine.handleUpgrade(req, socket, head);
  if (!cfg.appHosts().includes(host)) return ws.reject(socket, 421, 'Misdirected Request'); // (the games host has no WebSocket)
  const url = new URL(req.url, cfg.appOrigin);
  if (url.pathname !== '/ws') return ws.reject(socket, 404, 'Not Found');
  if (!cfg.appOrigins().includes(req.headers.origin)) return ws.reject(socket, 403, 'Forbidden');
  const a = authMod.fromRequest(req);
  if (!a || !a.user.verified) return ws.reject(socket, 401, 'Unauthorized');
  const uid = a.user.id;
  const n = wsCount.get(uid) || 0;
  if (n >= 8) return ws.reject(socket, 429, 'Too Many Connections');
  const conn = ws.upgrade(req, socket, { maxPayload: 1 << 16 });
  if (!conn) return;
  wsCount.set(uid, n + 1);
  conn.on('close', () => { const k = (wsCount.get(uid) || 1) - 1; if (k <= 0) wsCount.delete(uid); else wsCount.set(uid, k); });
  if (head && head.length) conn._data(head);
  chatMod.attachWs(conn, a.user);
}

// ---------- startup ----------
function canListen(port, host) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, host);
  });
}
async function pickPort(want, explicit, host) {
  if (want === 0) {
    return new Promise((resolve, reject) => {
      const s = net.createServer(); s.once('error', reject);
      s.listen(0, host, () => { const p = s.address().port; s.close(() => resolve(p)); });
    });
  }
  for (let p = want; p < want + (explicit ? 1 : 30); p++) if (await canListen(p, host)) return p;
  throw new Error(`Port ${want} is already in use. Set PORT to a free port or close the other program.`);
}

let registered = false;
function register() {
  if (registered) return;
  registered = true;
  router = new Router();
  authMod = require('./routes/auth'); chatMod = require('./routes/chat');
  for (const m of ['auth', 'profile', 'economy', 'themes', 'chat', 'ai', 'pay', 'proxyapi', 'admin', 'misc', 'progress', 'arcade', 'music', 'social', 'unfurl', 'translate', 'work', 'invest', 'wallet', 'tube', 'plaza', 'search', 'apps', 'code', 'hub', 'drive', 'media', 'perks', 'life', 'social2', 'play2', 'media2', 'compete', 'security', 'vpn', 'links', 'study', 'fusion', 'mods', 'gems', 'calendar', 'android', 'devtools']) require('./routes/' + m)(router);
  engine = require('./proxy/engine');
}

async function start(opts = {}) {
  if (opts.port !== undefined) { cfg.port = opts.port; cfg.portExplicit = true; }
  const port = await pickPort(cfg.port, cfg.portExplicit, cfg.host === '0.0.0.0' ? '127.0.0.1' : cfg.host);
  cfg.finalize(port);
  if (cfg.gamesHost && (cfg.gamesHost === cfg.appHost || cfg.gamesHost === cfg.proxyHost)) throw new Error('GAMES_ORIGIN must be a different host than APP_ORIGIN and PROXY_ORIGIN.');
  if (cfg.appHost === cfg.proxyHost) throw new Error('PROXY_ORIGIN must be a different host than APP_ORIGIN (otherwise websites could access your account). See README.');
  state.init();
  require('./migrations').runMigrations();
  register();
  state.S.store.startAutosave && state.S.store.startAutosave();

  const servers = [];
  const make = () => {
    const s = http.createServer({ maxHeaderSize: 32 * 1024 }, onRequest);
    s.on('upgrade', onUpgrade);
    s.on('clientError', (err, sock) => { try { sock.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); } catch { sock.destroy(); } });
    s.keepAliveTimeout = 65000; s.headersTimeout = 70000; s.requestTimeout = 0;
    servers.push(s);
    return s;
  };
  await new Promise((resolve, reject) => { const s = make(); s.once('error', reject); s.listen(port, cfg.host, resolve); });
  // "localhost" can resolve to ::1 first on some systems; listen there too when we are loopback-only
  if (cfg.host === '127.0.0.1') {
    await new Promise((resolve) => { const s = make(); s.once('error', () => { servers.splice(servers.indexOf(s), 1); resolve(); }); s.listen(port, '::1', resolve); });
  }
  const close = async () => {
    for (const s of servers) { try { s.closeAllConnections && s.closeAllConnections(); s.close(); } catch {} }
    try { require('./doclive').flushAll(); } catch {}
    try { require('./objlive').flushAll(); } catch {}
    try { state.S.store.flushSync(); } catch (e) { console.error('[store] flush on close failed', e.message); }
  };
  return { port, servers, close, cfg };
}

function banner(info) {
  const mail = require('./mail').mode();
  const ai = require('./routes/ai').mode();
  const pay = require('./routes/pay').enabled();
  const line = '-'.repeat(62);
  console.log(`\n${line}\n  ${cfg.brand}  v${cfg.VERSION}   ·   Created by ${cfg.creator}\n${line}`);
  console.log(`  App:    ${cfg.appOrigin}`);
  console.log(`  Proxy:  ${cfg.proxyOrigin}  (isolated origin for proxied sites)`);
  console.log(`  Data:   ${cfg.dataDir}`);
  console.log(`  Mail:   ${mail}${mail === 'console' ? '  (codes are shown on screen / in this window; set SMTP_* or RESEND_API_KEY for real emails)' : ''}`);
  console.log(`  AI:     ${ai}${ai === 'local' ? '  (offline assistant; add a Claude key in Admin → AI, or install Ollama for free local AI)' : ''}`);
  console.log(`  PRO:    ${pay.stripe ? 'Stripe enabled' : 'redeem codes only (set STRIPE_* to accept cards)'}`);
  if (!cfg.isPublic) console.log('  Mode:   private (only this computer). Run "npm run public" for a shareable link.');
  console.log(`${line}\n  Press Ctrl+C to stop.\n`);
}

let crashes = [];
process.on('uncaughtException', (e) => {
  console.error('[fatal-ish] uncaught exception:', e && e.stack || e);
  const t = now(); crashes = crashes.filter((x) => t - x < 60000); crashes.push(t);
  if (crashes.length > 25) { console.error('Too many errors, exiting.'); process.exit(1); }
});
process.on('unhandledRejection', (e) => { console.error('[warn] unhandled rejection:', e && e.stack || e); });

module.exports = { start, banner };

if (require.main === module) {
  // The Windows client reads the server output from a log file (NX_LOG_FILE) instead of a console window.
  require('./logfile')();
  start().then((info) => {
    banner(info);
    let stopping = false;
    const stop = async () => { if (stopping) return; stopping = true; console.log('\nShutting down…'); await info.close(); process.exit(0); };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
    // The Windows client talks to us over stdin: when it closes the pipe (Quit / Restart) we save and exit cleanly.
    if (process.env.NX_CLIENT === '1') { process.stdin.on('end', stop); process.stdin.on('error', stop); process.stdin.resume(); }
    if (process.env.NX_OPEN_BROWSER === '1') {
      const { exec } = require('child_process');
      const cmd = process.platform === 'win32' ? `start "" "${cfg.appOrigin}"` : process.platform === 'darwin' ? `open "${cfg.appOrigin}"` : `xdg-open "${cfg.appOrigin}"`;
      exec(cmd, () => {});
    }
  }).catch((e) => { console.error('\nCould not start ' + cfg.brand + ': ' + e.message + '\n'); process.exit(1); });
}
