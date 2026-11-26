'use strict';
// Nebulix 3.0 phase 20 — download manager: the server downloads a public http(s) link straight into the user's Drive
// (browsers cannot fetch most links themselves because of CORS). Same SSRF guard as the proxy (checked again on every
// redirect), the user's storage quota and file-size limit apply, at most 3 downloads at a time per user, progress and
// cancel. Jobs live in memory (the finished file is a normal Drive item).
const http = require('http');
const https = require('https');
const { S, isPro, tierRank } = require('../state');
const { HttpError, now, rid } = require('../util');
const guard = require('../proxy/guard');
const blobs = require('../blobs');

const jobs = new Map(); // uid -> Map(jobId -> job)
const maxFile = (u) => (isPro(u) ? [1024, 1024, 2048, 4096][tierRank(u)] : 200) * 1024 * 1024;
const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f‪-‮/\\]/g, ' ').trim().slice(0, n);
const mine = (u) => { let m = jobs.get(u.id); if (!m) jobs.set(u.id, (m = new Map())); return m; };
const view = (j) => ({ id: j.id, url: j.url, name: j.name, status: j.status, bytes: j.bytes, total: j.total, error: j.error || null, item: j.item || null, started: j.started, finished: j.finished || null });

function nameFrom(res, u) {
  const cd = String(res.headers['content-disposition'] || '');
  const m = /filename\*=UTF-8''([^;]+)/i.exec(cd) || /filename="?([^";]+)"?/i.exec(cd);
  let n = m ? (() => { try { return decodeURIComponent(m[1]); } catch { return m[1]; } })() : decodeURIComponent(u.pathname.split('/').pop() || '');
  n = clean(n, 160); if (!n || n === '.' || n === '..') n = u.hostname.replace(/^www\./, '') + '.bin'; return n;
}
function start(user, j, url, hops = 0) {
  let u; try { u = new URL(url); } catch { return fail(j, 'Enter a full address (https://…)'); }
  if (!/^https?:$/.test(u.protocol)) return fail(j, 'Only http(s) links can be downloaded');
  try { guard.checkUrl(u); } catch (e) { return fail(j, e.message); }
  const req = (u.protocol === 'https:' ? https : http).get(u, { lookup: guard.lookup, timeout: 20000, agent: false, headers: { 'user-agent': 'Nebulix-Downloads/1.0 (+https://nebulix.fly.dev)', accept: '*/*' } }, async (res) => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); if (hops >= 5) return fail(j, 'Too many redirects'); return start(user, j, new URL(res.headers.location, u).href, hops + 1); }
    if (res.statusCode !== 200) { res.resume(); return fail(j, 'The server answered ' + res.statusCode); }
    j.total = Number(res.headers['content-length']) || 0; j.name = j.name || nameFrom(res, u);
    const free = blobs.quota(user) - blobs.usage(user).used; const max = Math.min(maxFile(user), Math.max(0, free));
    if (j.total && j.total > max) { res.resume(); req.destroy(); return fail(j, j.total > maxFile(user) ? 'The file is bigger than your limit (' + Math.round(maxFile(user) / 1048576) + ' MB)' : 'Not enough storage in your Drive'); }
    res.on('data', (d) => { j.bytes += d.length; });
    try {
      const f = await blobs.receive(res, max);
      if (j.status === 'cancelled') return;
      blobs.charge(user, f.size);
      const it = { id: rid(9), owner: user.id, kind: 'file', name: j.name, parent: null, sha: f.sha, size: f.size, type: blobs.typeOf(j.name), created: now(), updated: now(), share: 'private', source: j.url };
      S.store.table('drive')[it.id] = it; S.store.touch('drive');
      Object.assign(j, { status: 'done', item: it.id, bytes: f.size, total: f.size, finished: now() });
      S.hub.push(user.id, { t: 'notice', text: '⬇️ Downloaded “' + j.name + '” to Drive', es: '⬇️ «' + j.name + '» se ha descargado en Drive', link: '#/drive' });
    } catch (e) { if (j.status !== 'cancelled') fail(j, e.code === 'quota' ? 'Not enough storage in your Drive' : e.message || 'Download failed'); }
  });
  j.req = req;
  req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
  req.on('error', (e) => { if (j.status === 'cancelled') return; fail(j, e.code === 'EBLOCKED' ? 'Private and local addresses are blocked' : e.code === 'ETIMEDOUT' ? 'The server did not answer' : e.code === 'ENOTFOUND' ? 'That host does not exist' : 'Download failed'); });
}
function fail(j, msg) { if (j.status === 'done' || j.status === 'cancelled') return; j.status = 'error'; j.error = msg; j.finished = now(); try { j.req && j.req.destroy(); } catch {} }

module.exports = function register(r) {
  r.get('/api/downloads', { auth: true, limit: [240, 60000, 'user'] }, async (c) => ({ downloads: [...mine(c.user).values()].sort((a, b) => b.started - a.started).map(view), usage: blobs.usage(c.user) }));
  r.post('/api/downloads', { auth: true, verified: true, limit: [30, 600000, 'user'] }, async (c) => {
    const url = String((c.body || {}).url || '').trim(); if (!url) throw new HttpError(400, 'bad_url', 'Paste a link');
    const m = mine(c.user); if ([...m.values()].filter((j) => j.status === 'running').length >= 3) throw new HttpError(429, 'busy', 'Up to 3 downloads at a time');
    if (m.size >= 50) { const old = [...m.values()].filter((j) => j.status !== 'running').sort((a, b) => a.started - b.started)[0]; if (old) m.delete(old.id); }
    const j = { id: rid(8), url: url.slice(0, 2000), name: clean((c.body || {}).name, 160) || null, status: 'running', bytes: 0, total: 0, started: now() };
    m.set(j.id, j); start(S.users[c.user.id] || c.user, j, j.url); await new Promise((res) => setTimeout(res, 300)); // fail fast on bad links
    return { download: view(j) };
  });
  r.delete('/api/downloads/:id', { auth: true, verified: true }, async (c) => {
    const m = mine(c.user); const j = m.get(c.params.id); if (!j) throw new HttpError(404, 'not_found', 'Not found');
    if (j.status === 'running') { j.status = 'cancelled'; j.finished = now(); try { j.req && j.req.destroy(); } catch {} } else m.delete(j.id);
    return { ok: true };
  });
};
