'use strict';
// Nebulix 3.0 phase 16 — productivity tools.
//  * Personal collections (habits, journal, read later, mind maps, password vault): per-user documents with size limits.
//    The password vault is encrypted in the browser (AES-256-GCM, key from the master password with PBKDF2); the server
//    only ever stores { v, salt, iv, ct } and cannot read it.
//  * Read later: fetches a page's title and description through the proxy's SSRF guard.
//  * Forms: build a form, share its link, collect answers from logged-in users (one each unless allowed), see results
//    and download CSV.
const http = require('http');
const https = require('https');
const { S, hub } = require('../state');
const { HttpError, now, rid } = require('../util');
const guard = require('../proxy/guard');

const KINDS = { habits: [200, 4000], journal: [3000, 20000], readlater: [2000, 3000], mindmaps: [200, 200000], vault: [1, 600000], levels: [100, 200000] }; // [max docs, max bytes per doc]
const tbl = () => S.store.table('ptools');
const mine = (u) => { const t = tbl(); return t[u.id] || (t[u.id] = {}); };
const coll = (u, kind) => { const m = mine(u); return m[kind] || (m[kind] = {}); };
const okKind = (k) => { if (!KINDS[k]) throw new HttpError(404, 'not_found', 'Unknown tool'); return k; };
const ID = /^[A-Za-z0-9_-]{4,24}$/;

function fetchMeta(url, hops = 0) {
  return new Promise((res, rej) => {
    let u; try { u = new URL(url); } catch { return rej(new HttpError(400, 'bad_url', 'Enter a full address (https://…)')); }
    if (!/^https?:$/.test(u.protocol)) return rej(new HttpError(400, 'bad_url', 'Only http(s) addresses'));
    try { guard.checkUrl(u); } catch (e) { return rej(e); }
    const req = (u.protocol === 'https:' ? https : http).get(u, { lookup: guard.lookup, timeout: 8000, agent: false, headers: { 'user-agent': 'Nebulix-ReadLater/1.0 (+https://nebulix.fly.dev)', accept: 'text/html' } }, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && hops < 4) { r.resume(); return fetchMeta(new URL(r.headers.location, u).href, hops + 1).then(res, rej); }
      let body = ''; r.setEncoding('utf8');
      r.on('data', (c) => { body += c; if (body.length > 256 * 1024) r.destroy(); });
      const done = () => {
        const pick = (re) => { const m = re.exec(body); return m ? m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim() : ''; };
        const title = pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']{1,300})/i) || pick(/<title[^>]*>([^<]{1,300})<\/title>/i);
        const desc = pick(/<meta[^>]+(?:name|property)=["'](?:og:)?description["'][^>]+content=["']([^"']{1,500})/i);
        res({ url: u.href, title: title.slice(0, 200), desc: desc.slice(0, 400), site: u.hostname.replace(/^www\./, '') });
      };
      r.on('end', done); r.on('close', done);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => rej(e.code === 'EBLOCKED' ? new HttpError(403, 'blocked_target', 'Private and local addresses are blocked') : new HttpError(502, 'fetch_failed', 'Could not open that page')));
  });
}

module.exports = function register(r) {
  r.get('/api/me/tools/:kind', { auth: true, limit: [240, 60000, 'user'] }, async (c) => {
    const k = okKind(c.params.kind); const list = Object.values(coll(c.user, k)).sort((a, b) => (b.updated || 0) - (a.updated || 0));
    return { items: list };
  });
  r.put('/api/me/tools/:kind/:id', { auth: true, verified: true, limit: [240, 60000, 'user'], bodyLimit: 700000 }, async (c) => {
    const k = okKind(c.params.kind); if (!ID.test(c.params.id)) throw new HttpError(400, 'bad_id', 'Bad id');
    const data = c.body && c.body.data; if (data == null || typeof data !== 'object') throw new HttpError(400, 'bad_data', 'Nothing to save');
    if (k === 'vault' && !(typeof data.ct === 'string' && typeof data.iv === 'string' && typeof data.salt === 'string' && Object.keys(data).every((x) => ['v', 'ct', 'iv', 'salt', 'iter'].includes(x)))) throw new HttpError(400, 'not_encrypted', 'The vault must be encrypted in your browser before it is saved');
    const size = JSON.stringify(data).length; const [maxN, maxB] = KINDS[k];
    if (size > maxB) throw new HttpError(413, 'too_big', 'This is too big to save');
    const col = coll(c.user, k); if (!col[c.params.id] && Object.keys(col).length >= maxN) throw new HttpError(400, 'too_many', 'You have reached the limit for this tool');
    const prev = col[c.params.id]; if (c.body.base != null && prev && prev.updated !== c.body.base) throw new HttpError(409, 'changed', 'This was changed on another device — reload to see the latest version');
    col[c.params.id] = { id: c.params.id, data, created: prev ? prev.created : now(), updated: now() }; S.store.touch('ptools');
    return { item: col[c.params.id] };
  });
  r.delete('/api/me/tools/:kind/:id', { auth: true, verified: true, limit: [240, 60000, 'user'] }, async (c) => {
    const col = coll(c.user, okKind(c.params.kind)); if (!col[c.params.id]) throw new HttpError(404, 'not_found', 'Not found'); delete col[c.params.id]; S.store.touch('ptools'); return { ok: true };
  });
  r.post('/api/me/tools/readlater/fetch', { auth: true, verified: true, limit: [30, 60000, 'user'] }, async (c) => fetchMeta(String((c.body || {}).url || '').trim()));

  // ---- Forms ----
  const forms = () => S.store.table('forms'); const answers = () => S.store.table('formresp');
  const QTYPES = ['text', 'para', 'choice', 'multi', 'scale', 'email', 'number', 'date'];
  const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, n);
  function normForm(b) {
    const qs = (Array.isArray(b.questions) ? b.questions : []).slice(0, 60).map((q) => ({ id: ID.test(String(q.id || '')) ? q.id : rid(6), type: QTYPES.includes(q.type) ? q.type : 'text', label: clean(q.label, 300) || '?', help: clean(q.help, 300),
      required: !!q.required, options: ['choice', 'multi'].includes(q.type) ? (Array.isArray(q.options) ? q.options : []).map((o) => clean(o, 120)).filter(Boolean).slice(0, 30) : undefined,
      min: q.type === 'scale' ? 1 : undefined, max: q.type === 'scale' ? Math.max(2, Math.min(10, Number(q.max) || 5)) : undefined }));
    return { title: clean(b.title, 140) || 'Formulario sin título', desc: clean(b.desc, 2000), questions: qs, open: b.open !== false, multi: !!b.multi, anonymous: !!b.anonymous };
  }
  const formView = (f, u, full) => ({ id: f.id, title: f.title, desc: f.desc, questions: f.questions, open: f.open, multi: f.multi, anonymous: f.anonymous, created: f.created, updated: f.updated, mine: f.owner === u.id,
    owner: (S.users[f.owner] || {}).username || '?', responses: full ? (answers()[f.id] || []).length : undefined, answered: (answers()[f.id] || []).some((a) => a.by === u.id) });
  const getForm = (c) => { const f = forms()[c.params.id]; if (!f) throw new HttpError(404, 'no_form', 'Form not found'); return f; };
  r.get('/api/forms', { auth: true, limit: [120, 60000, 'user'] }, async (c) => ({ forms: Object.values(forms()).filter((f) => f.owner === c.user.id).sort((a, b) => b.updated - a.updated).map((f) => formView(f, c.user, true)) }));
  r.post('/api/forms', { auth: true, verified: true, limit: [30, 600000, 'user'] }, async (c) => {
    if (Object.values(forms()).filter((f) => f.owner === c.user.id).length >= 100) throw new HttpError(400, 'too_many', 'Up to 100 forms');
    const f = { id: rid(9), owner: c.user.id, ...normForm(c.body || {}), created: now(), updated: now() }; forms()[f.id] = f; S.store.touch('forms'); return { form: formView(f, c.user, true) };
  });
  r.put('/api/forms/:id', { auth: true, verified: true, limit: [120, 60000, 'user'], bodyLimit: 200000 }, async (c) => {
    const f = getForm(c); if (f.owner !== c.user.id) throw new HttpError(403, 'forbidden', 'Only the owner can edit this form');
    Object.assign(f, normForm({ ...f, ...(c.body || {}) }), { updated: now() }); S.store.touch('forms'); return { form: formView(f, c.user, true) };
  });
  r.delete('/api/forms/:id', { auth: true, verified: true }, async (c) => { const f = getForm(c); if (f.owner !== c.user.id) throw new HttpError(403, 'forbidden', 'Not yours'); delete forms()[f.id]; delete answers()[f.id]; S.store.touch('forms'); S.store.touch('formresp'); return { ok: true }; });
  r.get('/api/forms/:id', { auth: true, limit: [240, 60000, 'user'] }, async (c) => ({ form: formView(getForm(c), c.user, false) }));
  r.post('/api/forms/:id/answer', { auth: true, verified: true, limit: [30, 60000, 'user'], bodyLimit: 120000 }, async (c) => {
    const f = getForm(c); if (!f.open) throw new HttpError(403, 'closed', 'This form is no longer accepting answers');
    const list = answers()[f.id] || (answers()[f.id] = []); if (!f.multi && list.some((a) => a.by === c.user.id)) throw new HttpError(409, 'answered', 'You have already answered this form');
    if (list.length >= 5000) throw new HttpError(400, 'full', 'This form has reached its answer limit');
    const given = (c.body || {}).answers || {}; const out = {};
    for (const q of f.questions) {
      let v = given[q.id];
      if (q.type === 'multi') v = (Array.isArray(v) ? v : []).filter((x) => q.options.includes(x));
      else if (q.type === 'choice') v = q.options.includes(v) ? v : '';
      else if (q.type === 'scale') { v = Number(v); v = v >= 1 && v <= q.max ? Math.round(v) : ''; }
      else if (q.type === 'number') { v = v === '' || v == null ? '' : Number(v); if (v !== '' && !Number.isFinite(v)) throw new HttpError(400, 'bad_answer', '“' + q.label + '” must be a number'); }
      else if (q.type === 'email') { v = clean(v, 200); if (v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) throw new HttpError(400, 'bad_answer', '“' + q.label + '” must be an email address'); }
      else if (q.type === 'date') { v = /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : ''; }
      else v = clean(v, q.type === 'para' ? 5000 : 500);
      if (q.required && (v === '' || (Array.isArray(v) && !v.length))) throw new HttpError(400, 'missing', 'Answer “' + q.label + '”');
      out[q.id] = v;
    }
    list.push({ id: rid(8), by: c.user.id, at: now(), answers: out }); S.store.touch('formresp');
    if (f.owner !== c.user.id) hub.push(f.owner, { t: 'notice', text: `📋 New answer to “${f.title}”`, es: `📋 Nueva respuesta a «${f.title}»`, link: '#/forms/' + f.id + '/results' });
    return { ok: true };
  });
  r.get('/api/forms/:id/results', { auth: true, limit: [120, 60000, 'user'] }, async (c) => {
    const f = getForm(c); if (f.owner !== c.user.id) throw new HttpError(403, 'forbidden', 'Only the owner can see the answers');
    const list = answers()[f.id] || [];
    return { form: formView(f, c.user, true), answers: list.map((a) => ({ id: a.id, at: a.at, by: f.anonymous ? null : (S.users[a.by] || {}).username || '?', answers: a.answers })) };
  });
  r.delete('/api/forms/:id/results/:aid', { auth: true, verified: true }, async (c) => { const f = getForm(c); if (f.owner !== c.user.id) throw new HttpError(403, 'forbidden', 'Not yours'); const list = answers()[f.id] || []; const i = list.findIndex((a) => a.id === c.params.aid); if (i < 0) throw new HttpError(404, 'not_found', 'Not found'); list.splice(i, 1); S.store.touch('formresp'); return { ok: true }; });
};
module.exports.fetchMeta = fetchMeta; // for tests
