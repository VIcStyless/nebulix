'use strict';
// Nebulix 13.3 — mirror links and the link generator.
// Mirrors are extra public addresses for the very same Nebulix (same server, same accounts and data): tiny forwarder
// apps (MIRROR_HOSTS) or custom domains the owner adds here. Short links (/l/<code>) work on every mirror and only ever
// lead to pages inside Nebulix (never to outside sites, so they cannot be used for phishing redirects).
const cfg = require('../config');
const { S } = require('../state');
const { HttpError, now, rid } = require('../util');

const table = () => S.store.table('shortlinks'); // code -> { code, path, owner, t, hits }
const RESERVED = new Set(['api', 'x', 'admin', 'login', 'l']);
const cleanPath = (p) => { let s = String(p || '').trim(); try { if (/^https?:\/\//i.test(s)) { const u = new URL(s); if (!cfg.appHosts().includes(u.host.toLowerCase())) throw 0; s = u.hash || '#/'; } } catch { throw new HttpError(400, 'bad_dest', 'Links can only lead to pages inside Nebulix'); } s = s.replace(/^\/?#?\/?/, ''); if (!/^[A-Za-z0-9_\-./?=&%:]{0,200}$/.test(s)) throw new HttpError(400, 'bad_dest', 'Invalid destination'); return s; };
const health = new Map(); // host -> { ok, ms, at }
async function ping(host) {
  const h0 = health.get(host); if (h0 && now() - h0.at < 60000) return h0;
  const t0 = now(); let ok = false;
  if (host === cfg.appHost) ok = true; else { try { const r = await fetch(`https://${host}/api/health`, { signal: AbortSignal.timeout(8000) }); ok = r.ok; } catch { ok = false; } }
  const v = { ok, ms: now() - t0, at: now() }; health.set(host, v); return v;
}
const mirrorsView = () => cfg.appHosts().map((host) => ({ host, url: host === cfg.appHost ? cfg.appOrigin : 'https://' + host, main: host === cfg.appHost, custom: !(host === cfg.appHost || cfg.mirrorHosts.includes(host)), status: health.get(host) || null }));
function redirect(req, res, code) {
  const l = table()[code]; const dest = l ? '/#/' + l.path : '/';
  if (l) { l.hits = (l.hits || 0) + 1; S.store.touch('shortlinks'); }
  res.writeHead(302, { Location: dest, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); res.end();
}
module.exports = function register(r) {
  r.get('/api/links', { auth: true }, async (c) => ({ mirrors: mirrorsView(), mine: Object.values(table()).filter((l) => l.owner === c.user.id).sort((a, b) => b.t - a.t).slice(0, 100) }));
  r.post('/api/links/check', { auth: true, limit: [10, 60000, 'user'] }, async () => { await Promise.all(cfg.appHosts().map(ping)); return { mirrors: mirrorsView() }; });
  r.post('/api/links', { auth: true, verified: true, limit: [30, 600000, 'user'] }, async (c) => {
    const path = cleanPath(c.body.path); let code = String(c.body.code || '').trim();
    if (code) { if (!/^[A-Za-z0-9_-]{3,32}$/.test(code) || RESERVED.has(code.toLowerCase())) throw new HttpError(400, 'bad_code', 'Use 3-32 letters, numbers, - or _'); if (table()[code]) throw new HttpError(409, 'taken', 'That link name is taken'); }
    else { do { code = rid(6); } while (table()[code]); }
    if (Object.values(table()).filter((l) => l.owner === c.user.id).length >= 100) throw new HttpError(429, 'too_many', 'Up to 100 links');
    const l = { code, path, owner: c.user.id, t: now(), hits: 0 }; table()[code] = l; S.store.touch('shortlinks');
    return { link: l, urls: cfg.appOrigins().map((o) => o + '/l/' + code) };
  });
  r.delete('/api/links/:code', { auth: true }, async (c) => { const l = table()[c.params.code]; if (!l || (l.owner !== c.user.id && !['owner', 'admin'].includes(c.user.role))) throw new HttpError(404, 'no_link', 'Not found'); delete table()[l.code]; S.store.touch('shortlinks'); return { ok: true }; });
  // owner: custom domains pointing at this server (add the DNS record and the certificate first)
  r.post('/api/admin/mirrors', { auth: true, role: 'admin' }, async (c) => {
    if (c.user.role !== 'owner') throw new HttpError(403, 'owner_only', 'Only the owner can add mirrors');
    const host = String(c.body.host || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!/^[a-z0-9.-]{3,253}\.[a-z]{2,}$/.test(host)) throw new HttpError(400, 'bad_host', 'Enter a domain like play.example.com');
    S.meta.mirrors = (S.meta.mirrors || []).filter((m) => m.host !== host).concat([{ host, t: now() }]); S.store.touch('meta'); return { mirrors: mirrorsView() };
  });
  r.delete('/api/admin/mirrors/:host', { auth: true, role: 'admin' }, async (c) => { if (c.user.role !== 'owner') throw new HttpError(403, 'owner_only', 'Only the owner'); S.meta.mirrors = (S.meta.mirrors || []).filter((m) => m.host !== c.params.host); S.store.touch('meta'); return { mirrors: mirrorsView() }; });
};
module.exports.redirect = redirect;
