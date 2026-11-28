'use strict';
const MUTED_PATHS = /^\/api\/(channels\/[^/]+\/messages(\/[^/]+)?|comments\/[^/]+|echo(\/[^/]+\/repost)?|forum(\/p\/[^/]+\/comment)?|lens(\/[^/]+\/comments|\/stories)?|hub(\/upload|\/[^/]+(\/version|\/cover)?)?|worlds\/ugc|squads|events|themes|recruit|crosshairs|cups|code\/r\/.+\/comments)$/;
const cfg = require('./config');
const metrics = require('./metrics');
const { HttpError, sendJson, readBody, Limiter, clientIp } = require('./util');

class Router {
  constructor() { this.routes = []; }
  add(method, pattern, opts, handler) {
    if (typeof opts === 'function') { handler = opts; opts = {}; }
    const keys = [];
    // ":name" matches one path segment, ":name+" the rest of the path (with slashes)
    const src = pattern.replace(/[.*?^${}()|[\]\\]/g, '\\$&').replace(/:(\w+)(\+?)/g, (_, k, all) => { keys.push(k); return all ? '(.+)' : '([^/]+)'; });
    const r = { method, pattern, re: new RegExp('^' + src + '/?$'), keys, opts, handler, limiter: null };
    if (opts.limit) r.limiter = new Limiter(opts.limit[0] * require('./config').rateLimitMul, opts.limit[1]);
    this.routes.push(r);
  }
  get(p, o, h) { this.add('GET', p, o, h); }
  post(p, o, h) { this.add('POST', p, o, h); }
  put(p, o, h) { this.add('PUT', p, o, h); }
  patch(p, o, h) { this.add('PATCH', p, o, h); }
  delete(p, o, h) { this.add('DELETE', p, o, h); }
  match(method, path) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = r.re.exec(path);
      if (m) {
        const params = {};
        try { r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); }); } catch { return null; }
        return { r, params };
      }
    }
    return null;
  }
}

const globalLimiter = new Limiter(900 * require('./config').rateLimitMul, 60000);

function checkOrigin(req) {
  const o = req.headers.origin;
  if (o) { if (!cfg.appOrigins().includes(o)) throw new HttpError(403, 'bad_origin', 'Cross-origin request blocked'); return; }
  const sfs = req.headers['sec-fetch-site'];
  if (sfs && sfs !== 'same-origin' && sfs !== 'none') throw new HttpError(403, 'bad_origin', 'Cross-site request blocked');
}

function handleError(res, e) {
  if (res.headersSent) { try { res.end(); } catch {} return; }
  if (e instanceof HttpError) {
    const h = {}; if (e.retryAfter) h['Retry-After'] = e.retryAfter;
    return sendJson(res, e.status, { error: e.code, message: e.message }, h);
  }
  console.error('[api] unhandled error:', e && e.stack || e);
  sendJson(res, 500, { error: 'server_error', message: 'Something went wrong' });
}

async function dispatch(router, req, res, url, getAuth) {
  const m = router.match(req.method, url.pathname);
  if (!m) return sendJson(res, 404, { error: 'not_found', message: 'Not found' });
  const { r, params } = m; const o = r.opts; metrics.api(req);
  try {
    const ip = clientIp(req, cfg.trustProxy);
    if (!globalLimiter.hit(ip)) { const e = new HttpError(429, 'rate_limited', 'Too many requests'); e.retryAfter = globalLimiter.retryAfter(ip); throw e; }
    const unsafe = req.method !== 'GET' && req.method !== 'HEAD';
    if (unsafe && !o.noOrigin) checkOrigin(req);
    const a = getAuth(req);
    const c = {
      req, res, url, params, query: Object.fromEntries(url.searchParams), user: a ? a.user : null,
      sess: a ? a.session : null, sh: a ? a.sh : null, ip, body: null, raw: null,
    };
    if (o.auth && !c.user) throw new HttpError(401, 'unauthorized', 'Please log in');
    if (o.verified && c.user && !c.user.verified) throw new HttpError(403, 'not_verified', 'Verify your email first');
    if (o.role === 'staff' && !(c.user && ['owner', 'admin', 'mod'].includes(c.user.role))) throw new HttpError(403, 'forbidden', 'Staff only');
    if (o.role === 'admin' && !(c.user && ['owner', 'admin'].includes(c.user.role))) throw new HttpError(403, 'forbidden', 'Admins only');
    if (o.role === 'owner' && !(c.user && c.user.role === 'owner')) throw new HttpError(403, 'forbidden', 'Owner only');
    // a muted user cannot publish in public places (messages, posts, comments, uploads, worlds…); DMs and reports still work
    if (unsafe && req.method !== 'DELETE' && c.user && c.user.mutedUntil && c.user.mutedUntil > Date.now() && MUTED_PATHS.test(url.pathname)) {
      const mins = Math.ceil((c.user.mutedUntil - Date.now()) / 60000); throw new HttpError(403, 'muted', `You are muted by the moderators for ${mins} more min`);
    }
    if (r.limiter) {
      const key = (o.limit[2] === 'user' && c.user ? 'u:' + c.user.id : 'ip:' + ip);
      if (!r.limiter.hit(key)) { const e = new HttpError(429, 'rate_limited', 'Slow down a little'); e.retryAfter = r.limiter.retryAfter(key); throw e; }
    }
    if (unsafe && !o.stream) {
      if (o.raw) c.raw = await readBody(req, o.bodyLimit || (1 << 20));
      else {
        const buf = await readBody(req, o.bodyLimit || 256 * 1024);
        if (buf.length) {
          if (!/application\/json/i.test(req.headers['content-type'] || '')) throw new HttpError(415, 'unsupported_media', 'JSON expected');
          try { c.body = JSON.parse(buf.toString('utf8')); } catch { throw new HttpError(400, 'bad_json', 'Invalid JSON'); }
        }
        if (c.body === null || typeof c.body !== 'object') c.body = {};
      }
    }
    const out = await r.handler(c);
    if (out !== undefined && !res.headersSent) sendJson(res, 200, out);
  } catch (e) { if (!(e instanceof HttpError)) metrics.error(r.pattern, req.method, e); handleError(res, e); }
}

module.exports = { Router, dispatch, handleError, checkOrigin };
