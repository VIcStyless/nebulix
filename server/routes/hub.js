'use strict';
// Nebulix Hub: upload and share videos, browser games and web apps. Videos stream with seeking; games/apps
// (one .html file or a .zip with index.html) run sandboxed on their own opaque origin, never with your session.
const { S, publicUser, isPro, hub: wsHub } = require('../state');
const blobs = require('../blobs');
const { HttpError, now, rid } = require('../util');

const items = () => S.store.table('hubitems');
const saves = () => S.store.table('hubsaves'); // game saves (localStorage/cookies of a game) per player: "<item>:<user>" -> { ls, ck, t }
const touch = () => S.store.touch('hubitems');
const KINDS = ['video', 'clip', 'game', 'app', 'wall'];
const IMAGE = /^(png|jpe?g|webp|gif|avif)$/i;
const isVid = (k) => k === 'video' || k === 'clip';
const maxUpload = (u, kind) => (kind === 'video' ? (isPro(u) ? 1024 : 200) : kind === 'clip' ? (isPro(u) ? 300 : 100) : kind === 'wall' ? (isPro(u) ? 200 : 80) : (isPro(u) ? 2048 : 60)) * 1024 * 1024;
const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f‪-‮]/g, ' ').trim().slice(0, n);
// descriptions keep their line breaks (chapters, lists)
const cleanML = (s, n) => String(s || '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f‪-‮]/g, ' ').replace(/\n{4,}/g, '\n\n\n').trim().slice(0, n);
const VIDEO = /^(mp4|webm|ogv|mov|m4v)$/i;
const pending = new Map(); // upload id -> { uid, sha, size, name, t } (until it is published)
const CODE = /^(html?|zip|m?js)$/i;
// a single .js file becomes a tiny page that runs it full-window
const wrapJs = (name) => Buffer.from(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${name.replace(/[<>&"]/g, '')}</title><style>html,body{margin:0;height:100%;background:#0b0c14;color:#e5e7eb;font-family:system-ui,sans-serif}canvas{display:block}</style></head><body><script src="main.js"></script></body></html>`);
// unpack an uploaded web app into the blob store; find its start page even when it is not called index.html
// which stored file a request path means (directories fall back to their index.html)
function resolveFile(it, rest) { const p = String(rest || ''); if (it.files[p]) return p; const idx = (p ? p.replace(/\/$/, '') + '/' : '') + 'index.html'; return it.files[idx] ? idx : null; }
function streamFile(req, res, it, name, extra = {}) {
  let inner = name; let enc = null; if (/\.[a-z0-9]+\.(br|gz)$/i.test(name)) { enc = /\.br$/i.test(name) ? 'br' : 'gzip'; inner = name.slice(0, -3); }
  blobs.sendRaw(req, res, it.files[name].sha, Object.assign(enc ? { 'Content-Encoding': enc } : {}, { 'Content-Type': require('./code').typeFor(inner), 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin' }, extra));
}
const entryPath = (it) => (it.entry || 'index.html').split('/').map(encodeURIComponent).join('/');
// "domain" games run on the separate games origin (like a normal tab in Chrome); the rest run sandboxed under /x/play
const MODES = ['sandbox', 'domain', 'native'];
// average star rating from the reviews table (routes/media2.js)
function ratingOf(id) { const l = (S.store.table('hubreviews')[id]) || []; if (!l.length) return null; return { avg: Math.round((l.reduce((a, x) => a + x.stars, 0) / l.length) * 10) / 10, n: l.length }; }
const modeOf = (v) => (MODES.includes(v) ? v : 'sandbox');
const onDomain = (it) => !!(it.files && (it.runMode === 'domain' || it.runMode === 'native') && require('../config').gamesOrigin);
// paid games (Nebula Vault) only get an address for their owners, with a signed key in the path (12 h)
const srcOf = (it, u) => {
  if (isVid(it.kind) || it.wtype === 'video') return `/x/hub/v/${it.id}`; if (it.wtype === 'image') return `/x/hub/i/${it.id}`;
  const V = require('../vault'); if (V.paid(it)) { if (!V.owns(u, it)) return null; const k = V.playKey(it, u); return onDomain(it) ? `${require('../config').gamesOrigin}/gp/${k}/${it.id}/${entryPath(it)}` : `/x/pp/${k}/${it.id}/${entryPath(it)}`; }
  return onDomain(it) ? `${require('../config').gamesOrigin}/g/${it.id}/${entryPath(it)}` : `/x/play/${it.id}/${entryPath(it)}`;
};
async function unpack(up) {
  let files = {};
  if (/\.zip$/i.test(up.name)) {
    // streamed from disk, one entry at a time (games can be up to 2 GB)
    const list = await require('../zip').unzipFile(blobs.pathOf(up.sha), { maxEntries: 20000, maxTotal: 3 * 1024 ** 3 }, (p, stream, usize) => blobs.putStream(stream, usize + 1024));
    for (const f of list) files[f.path] = { sha: f.data.sha, size: f.data.size };
  } else if (/\.m?js$/i.test(up.name)) {
    const page = blobs.putBuffer(wrapJs(up.name)); files = { 'index.html': { sha: page.sha, size: page.size }, 'main.js': { sha: up.sha, size: up.size } };
  } else files = { 'index.html': { sha: up.sha, size: up.size } };
  const paths = Object.keys(files); if (!paths.length) throw new HttpError(400, 'empty', 'There are no files in it');
  let entry = paths.find((p) => /^index\.html?$/i.test(p));
  if (!entry) { const htmls = paths.filter((p) => /\.html?$/i.test(p)).sort((a, b) => a.split('/').length - b.split('/').length || a.length - b.length); entry = htmls[0]; }
  if (!entry) throw new HttpError(400, 'no_index', 'Add an .html page (for example index.html) to start the app');
  const size = paths.reduce((a, p) => a + (files[p].size || 0), 0);
  // a big .zip that only this upload created is not needed once unpacked (saves half the disk space)
  if (/\.zip$/i.test(up.name) && up.fresh && up.size > 20 * 1048576 && !paths.some((p) => files[p].sha === up.sha)) blobs.drop(up.sha);
  return { files, entry, size };
}

function view(it, u) {
  const o = S.users[it.owner];
  return { id: it.id, kind: it.kind, wtype: it.wtype || null, runMode: modeOf(it.runMode), gamesDomain: !!require('../config').gamesOrigin, title: it.title, desc: it.desc, tags: it.tags, owner: o ? publicUser(o) : null, files: it.files ? Object.keys(it.files).length : 0, allowDownload: !!it.allowDownload, allowRemix: !!it.allowRemix, remixOf: it.remixOf || null, remixes: it.remixes || 0, saved: !!(u && (u.hubSaved || []).includes(it.id)), comments: ((S.store.table('comments')[it.id]) || []).length, version: it.version || 1, updated: it.updated || it.created, views: it.views || 0, likes: (it.likes || []).length, liked: !!(u && (it.likes || []).includes(u.id)), created: it.created, size: it.size, thumb: it.thumb ? `/x/hub/t/${it.id}?v=${String(it.thumb).slice(0, 8)}` : null, rating: ratingOf(it.id), shots: (it.shots || []).map((s, i) => `/x/hub/s/${it.id}/${i}?v=${String(s).slice(0, 8)}`), game: it.game && items()[it.game] ? { id: it.game, title: items()[it.game].title } : null, chapters: it.chapters || null, mine: !!(u && u.id === it.owner), duration: it.duration || 0, public: it.public !== false, official: it.official || null, sale: it.files && (it.kind === 'game' || it.kind === 'app') ? require('../vault').saleView(it, u) : null };
}
module.exports = function register(r) {
  require('../hubseed').start();
  // 1) upload the raw file (streamed to disk, size-capped)
  r.put('/api/hub/upload', { auth: true, verified: true, stream: true, limit: [30, 3600000, 'user'] }, async (c) => {
    const kind = KINDS.includes(c.query.kind) ? c.query.kind : null; if (!kind) { c.req.resume(); throw new HttpError(400, 'bad_kind', 'Unknown kind'); }
    const name = clean(c.query.name, 120) || 'file'; const ext = name.split('.').pop().toLowerCase();
    if (isVid(kind) && c.query.thumb !== '1' && !VIDEO.test(ext)) { c.req.resume(); throw new HttpError(400, 'bad_type', 'Upload an MP4 or WEBM video'); }
    if (kind === 'wall' && c.query.thumb !== '1' && !VIDEO.test(ext) && !IMAGE.test(ext) && !CODE.test(ext)) { c.req.resume(); throw new HttpError(400, 'bad_type', 'A background can be a video (MP4/WEBM), an image or GIF, or an animated page (HTML/JS/ZIP/folder)'); }
    if (!isVid(kind) && kind !== 'wall' && !CODE.test(ext) && c.query.thumb !== '1') { c.req.resume(); throw new HttpError(400, 'bad_type', 'Upload an .html or .js file, a .zip or a folder'); }
    if (c.query.thumb === '1' && !/^(png|jpe?g|webp|gif)$/.test(ext)) { c.req.resume(); throw new HttpError(400, 'bad_type', 'Images must be PNG, JPG, WEBP or GIF'); }
    const max = c.query.thumb === '1' ? 3 * 1048576 : maxUpload(c.user, kind);
    const want = Number(c.req.headers['content-length'] || 0); if (want > 50 * 1048576 && blobs.freeBytes() - want * 2 < 1.5 * 1024 ** 3) { c.req.resume(); throw new HttpError(507, 'disk_full', 'The server is low on space for such a big upload right now. Try a smaller file or ask the owner.'); }
    const q = blobs.usage(c.user); if (q.used + Number(c.req.headers['content-length'] || 0) > q.quota) { c.req.resume(); blobs.charge(c.user, Number(c.req.headers['content-length'])); }
    const f = await blobs.receive(c.req, max);
    const id = rid(10); pending.set(id, { uid: c.user.id, sha: f.sha, size: f.size, fresh: !!f.fresh, name, t: now(), kind: c.query.thumb === '1' ? 'thumb' : kind });
    for (const [k, v] of pending) if (now() - v.t > 3 * 3600000) pending.delete(k);
    return { upload: id, size: f.size };
  });
  // 2) publish it
  r.post('/api/hub', { auth: true, verified: true, limit: [30, 3600000, 'user'] }, async (c) => {
    const u = c.user; const up = pending.get(String(c.body.upload || '')); if (!up || up.uid !== u.id || up.kind === 'thumb') throw new HttpError(400, 'no_upload', 'Upload the file first');
    const title = clean(c.body.title, 90); if (title.length < 2) throw new HttpError(400, 'bad_title', 'Give it a title');
    const it = { id: rid(8), owner: u.id, kind: up.kind, title, desc: cleanML(c.body.desc, 2000), tags: (Array.isArray(c.body.tags) ? c.body.tags : []).map((x) => clean(x, 24).toLowerCase()).filter(Boolean).slice(0, 8), created: now(), views: 0, likes: [], size: up.size, public: c.body.public !== false, duration: Math.max(0, Math.min(86400, Number(c.body.duration) || 0)) };
    it.allowDownload = !!c.body.allowDownload; it.allowRemix = !!c.body.allowRemix; it.runMode = modeOf(c.body.runMode);
    const wext = up.name.split('.').pop().toLowerCase();
    if (up.kind === 'wall' && VIDEO.test(wext)) { it.wtype = 'video'; it.sha = up.sha; it.type = blobs.typeOf(up.name).startsWith('video/') ? blobs.typeOf(up.name) : 'video/mp4'; }
    else if (up.kind === 'wall' && IMAGE.test(wext)) { it.wtype = 'image'; it.sha = up.sha; it.type = blobs.typeOf(up.name) || 'image/gif'; if (!c.body.thumb) it.thumb = up.sha; }
    else if (isVid(up.kind)) { it.sha = up.sha; it.type = blobs.typeOf(up.name).startsWith('video/') ? blobs.typeOf(up.name) : 'video/mp4'; }
    else { if (up.kind === 'wall') it.wtype = 'html'; const pk = await unpack(up); it.files = pk.files; it.entry = pk.entry; it.version = 1; it.versions = [{ v: 1, at: now(), note: clean(c.body.note, 200) || '', size: pk.size, files: Object.keys(pk.files).length }]; }
    const th = c.body.thumb && pending.get(String(c.body.thumb)); if (th && th.uid === u.id && th.kind === 'thumb') { it.thumb = th.sha; pending.delete(c.body.thumb); }
    if (it.kind === 'clip' && c.body.game && items()[c.body.game] && items()[c.body.game].public !== false) it.game = String(c.body.game);
    blobs.charge(u, up.size); pending.delete(c.body.upload);
    items()[it.id] = it; touch();
    try { require('./media2').onPublish(it, u); } catch (e) { console.error('[hub] publish', e); }
    try { require('../progress').award(u, 'work'); } catch {}
    return { item: view(it, u) };
  });
  r.get('/api/hub', { auth: true, limit: [120, 60000, 'user'] }, async (c) => {
    const u = c.user; const kind = KINDS.includes(c.query.kind) ? c.query.kind : null; const q = clean(c.query.q, 60).toLowerCase(); const sort = ['top', 'likes', 'updated', 'random', 'comments', 'rating'].includes(c.query.sort) ? c.query.sort : 'new'; const tag = clean(c.query.tag, 24).toLowerCase();
    let list = Object.values(items()).filter((x) => (c.query.mine ? x.owner === u.id : x.public !== false || x.owner === u.id));
    if (c.query.saved) { const sv = u.hubSaved || []; list = list.filter((x) => sv.includes(x.id)).sort((a, b) => sv.indexOf(a.id) - sv.indexOf(b.id)); }
    if (c.query.history) { const hs = u.hubHistory || []; list = list.filter((x) => hs.includes(x.id)).sort((a, b) => hs.indexOf(a.id) - hs.indexOf(b.id)); }
    if (c.query.col) { const col = (u.hubCols || []).find((x) => x.id === c.query.col); const ids = col ? col.items : []; list = list.filter((x) => ids.includes(x.id)); }
    if (tag) list = list.filter((x) => (x.tags || []).includes(tag));
    if (kind) list = list.filter((x) => x.kind === kind);
    if (q) list = list.filter((x) => x.title.toLowerCase().includes(q) || (x.tags || []).some((tg) => tg.includes(q)) || ((S.users[x.owner] || {}).username || '').toLowerCase().includes(q));
    const cm = S.store.table('comments'); const pop = (x) => (x.views || 0) + (x.likes || []).length * 10;
    if (!c.query.saved && !c.query.history) {
      if (sort === 'random') { for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; } }
      else list.sort((a, b) => (sort === 'top' ? pop(b) - pop(a) : sort === 'likes' ? (b.likes || []).length - (a.likes || []).length : sort === 'updated' ? (b.updated || b.created) - (a.updated || a.created) : sort === 'comments' ? (cm[b.id] || []).length - (cm[a.id] || []).length : sort === 'rating' ? ((ratingOf(b.id) || { avg: 0 }).avg * 100 + (ratingOf(b.id) || { n: 0 }).n) - ((ratingOf(a.id) || { avg: 0 }).avg * 100 + (ratingOf(a.id) || { n: 0 }).n) : b.created - a.created));
    }
    const fresh = Object.values(items()).filter((x) => x.public !== false && now() - (x.updated || x.created) < 21 * 86400000);
    const score = (x) => (x.views || 0) + (x.likes || []).length * 10;
    const feat = fresh.sort((a, b) => score(b) - score(a))[0] || null;
    const counts = {}; for (const x of Object.values(items())) if (x.public !== false) counts[x.kind] = (counts[x.kind] || 0) + 1;
    const tagCount = {}; for (const x of Object.values(items())) if (x.public !== false) for (const tg of x.tags || []) tagCount[tg] = (tagCount[tg] || 0) + 1;
    const tags = Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 24).map(([t, n]) => ({ t, n }));
    let stats = null; if (c.query.mine) { const mine = Object.values(items()).filter((x) => x.owner === u.id); stats = { items: mine.length, views: mine.reduce((a, x) => a + (x.views || 0), 0), likes: mine.reduce((a, x) => a + (x.likes || []).length, 0), comments: mine.reduce((a, x) => a + (cm[x.id] || []).length, 0), remixes: mine.reduce((a, x) => a + (x.remixes || 0), 0) }; }
    return { items: list.slice(0, 120).map((x) => view(x, u)), usage: blobs.usage(u), featured: feat ? view(feat, u) : null, counts, tags, stats, cols: (u.hubCols || []).map((x) => ({ id: x.id, name: x.name, n: x.items.length })) };
  });
  r.get('/api/hub/:id', { auth: true }, async (c) => {
    const it = items()[c.params.id]; if (!it || (it.public === false && it.owner !== c.user.id)) throw new HttpError(404, 'no_item', 'Not found');
    it.views = (it.views || 0) + 1; touch();
    const u0 = c.user; u0.hubHistory = [it.id, ...(u0.hubHistory || []).filter((x) => x !== it.id)].slice(0, 40); S.store.touch('users');
    const more = Object.values(items()).filter((x) => x.id !== it.id && x.kind === it.kind && x.public !== false).sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 12).map((x) => view(x, c.user));
    return { item: Object.assign(view(it, c.user), { src: srcOf(it, c.user), versions: (it.versions || []).slice(-20).reverse() }), more };
  });
  r.post('/api/hub/:id/like', { auth: true, verified: true, limit: [60, 60000, 'user'] }, async (c) => {
    const it = items()[c.params.id]; if (!it) throw new HttpError(404, 'no_item', 'Not found'); it.likes = it.likes || []; const i = it.likes.indexOf(c.user.id);
    if (i >= 0) it.likes.splice(i, 1); else { it.likes.push(c.user.id); if (it.owner !== c.user.id) wsHub.push(it.owner, { t: 'notice', text: `@${c.user.username} liked “${it.title}”` }); }
    touch(); return { likes: it.likes.length, liked: i < 0 };
  });
  // the files inside a game/app (anyone who can see it; the code runs on their screen, so they may read it)
  r.get('/api/hub/:id/files', { auth: true }, async (c) => {
    const it = items()[c.params.id]; if (!it || !it.files || (it.public === false && it.owner !== c.user.id)) throw new HttpError(404, 'no_item', 'Not found');
    return { entry: it.entry || 'index.html', files: Object.entries(it.files).map(([path, f]) => ({ path, size: f.size || 0 })).sort((a, b) => a.path.localeCompare(b.path)) };
  });
  // 14.0: one text file of a game/app for the code viewer (served by Nebulix itself: the games domain is another origin).
  // Plain text only, never run here; same visibility as the file list above.
  r.get('/api/hub/:id/raw', { auth: true, limit: [240, 60000, 'user'] }, async (c) => {
    const it = items()[c.params.id]; if (!it || !it.files || (it.public === false && it.owner !== c.user.id)) throw new HttpError(404, 'no_item', 'Not found');
    const p = String(c.query.path || ''); const f = it.files[p]; if (!f) throw new HttpError(404, 'no_file', 'File not found');
    if (!/\.(html?|css|m?js|json|txt|md|svg|xml|csv)$/i.test(p)) throw new HttpError(415, 'not_text', 'Only text files can be shown');
    const buf = blobs.readBuffer(f.sha); const cut = buf.length > 1048576;
    return { path: p, size: buf.length, cut, text: buf.subarray(0, 1048576).toString('utf8') };
  });
  // publish a new version of a game/app (same link, likes and views)
  r.post('/api/hub/:id/version', { auth: true, verified: true, limit: [20, 3600000, 'user'] }, async (c) => {
    const u = c.user; const it = items()[c.params.id]; if (!it || it.owner !== u.id || !it.files) throw new HttpError(404, 'no_item', 'Not found');
    const up = pending.get(String(c.body.upload || '')); if (!up || up.uid !== u.id || up.kind === 'thumb') throw new HttpError(400, 'no_upload', 'Upload the new files first');
    const pk = await unpack(up); blobs.charge(u, up.size - (it.size || 0)); pending.delete(c.body.upload); // storage is counted on the uploaded size, like the first version
    it.files = pk.files; it.entry = pk.entry; it.size = up.size; it.version = (it.version || 1) + 1; it.updated = now();
    it.versions = (it.versions || [{ v: 1, at: it.created, note: '', size: it.size }]).concat({ v: it.version, at: now(), note: clean(c.body.note, 200), size: pk.size, files: Object.keys(pk.files).length }).slice(-30);
    touch(); return { item: view(it, u) };
  });
  // set or change the cover image
  r.post('/api/hub/:id/cover', { auth: true, verified: true, limit: [30, 3600000, 'user'] }, async (c) => {
    const it = items()[c.params.id]; if (!it || it.owner !== c.user.id) throw new HttpError(404, 'no_item', 'Not found');
    const th = pending.get(String(c.body.thumb || '')); if (!th || th.uid !== c.user.id || th.kind !== 'thumb') throw new HttpError(400, 'no_upload', 'Upload the image first');
    it.thumb = th.sha; pending.delete(c.body.thumb); touch(); return { item: view(it, c.user) };
  });
  // backgrounds: what the live background layer needs (no view counted)
  r.get('/api/hub/:id/wall', { auth: true, limit: [60, 60000, 'user'] }, async (c) => {
    const it = items()[c.params.id]; if (!it || it.kind !== 'wall' || (it.public === false && it.owner !== c.user.id)) throw new HttpError(404, 'no_item', 'Not found');
    return { id: it.id, title: it.title, wtype: it.wtype, src: srcOf(it), thumb: it.thumb ? `/x/hub/t/${it.id}` : null };
  });
  // save for later
  r.post('/api/hub/:id/save', { auth: true, limit: [120, 60000, 'user'] }, async (c) => {
    const it = items()[c.params.id]; if (!it) throw new HttpError(404, 'no_item', 'Not found'); const u = c.user; const sv = u.hubSaved || [];
    const on = !sv.includes(it.id); u.hubSaved = on ? [it.id, ...sv].slice(0, 300) : sv.filter((x) => x !== it.id); S.store.touch('users'); return { saved: on };
  });
  r.delete('/api/hub/history', { auth: true }, async (c) => { c.user.hubHistory = []; S.store.touch('users'); return { ok: true }; });
  // collections (private lists of uploads)
  r.post('/api/hub/collections', { auth: true, limit: [30, 60000, 'user'] }, async (c) => {
    const u = c.user; const name = clean(c.body.name, 40); if (name.length < 1) throw new HttpError(400, 'bad_name', 'Give it a name'); u.hubCols = u.hubCols || [];
    if (u.hubCols.length >= 30) throw new HttpError(409, 'too_many', 'Up to 30 collections'); const col = { id: rid(6), name, items: [] }; u.hubCols.push(col); S.store.touch('users'); return { col: { id: col.id, name, n: 0 } };
  });
  r.post('/api/hub/collections/:cid/toggle', { auth: true, limit: [120, 60000, 'user'] }, async (c) => {
    const col = (c.user.hubCols || []).find((x) => x.id === c.params.cid); if (!col) throw new HttpError(404, 'no_col', 'Collection not found');
    const id = String(c.body.item || ''); if (!items()[id]) throw new HttpError(404, 'no_item', 'Not found');
    const on = !col.items.includes(id); col.items = on ? [id, ...col.items].slice(0, 500) : col.items.filter((x) => x !== id); S.store.touch('users'); return { on, n: col.items.length };
  });
  r.delete('/api/hub/collections/:cid', { auth: true }, async (c) => { c.user.hubCols = (c.user.hubCols || []).filter((x) => x.id !== c.params.cid); S.store.touch('users'); return { ok: true }; });
  r.get('/api/hub/collections/of/:id', { auth: true }, async (c) => ({ cols: (c.user.hubCols || []).map((x) => ({ id: x.id, name: x.name, has: x.items.includes(c.params.id) })) }));
  // remix: copy a game/app/background into your uploads (only when the author allows it)
  r.post('/api/hub/:id/remix', { auth: true, verified: true, limit: [10, 3600000, 'user'] }, async (c) => {
    const src = items()[c.params.id]; if (!src || !src.files || (src.public === false && src.owner !== c.user.id)) throw new HttpError(404, 'no_item', 'Not found');
    if (!src.allowRemix && src.owner !== c.user.id) throw new HttpError(403, 'no_remix', 'The author does not allow remixes');
    if (require('../vault').paid(src) && src.owner !== c.user.id) throw new HttpError(403, 'no_remix', 'Paid games cannot be remixed');
    const u = c.user; const q = blobs.usage(u); if (q.used + (src.size || 0) > q.quota) throw new HttpError(413, 'quota', 'Not enough storage for this remix');
    const it = { id: rid(8), owner: u.id, kind: src.kind, wtype: src.wtype, title: ('Remix: ' + src.title).slice(0, 90), desc: '', tags: (src.tags || []).slice(), created: now(), views: 0, likes: [], size: src.size || 0, public: false, files: Object.assign({}, src.files), entry: src.entry, version: 1, versions: [{ v: 1, at: now(), note: 'Remix of ' + src.title, size: src.size || 0, files: Object.keys(src.files).length }], remixOf: src.id, thumb: src.thumb, allowRemix: true, runMode: src.runMode };
    blobs.charge(u, it.size); items()[it.id] = it; src.remixes = (src.remixes || 0) + 1; touch();
    if (src.owner !== u.id) wsHub.push(src.owner, { t: 'notice', text: `🔁 @${u.username} remixed “${src.title}”`, es: `🔁 @${u.username} ha hecho un remix de «${src.title}»` });
    return { item: view(it, u) };
  });
  // download (the author always; others only when allowed)
  r.get('/x/hub/dl/:id', { auth: true, limit: [30, 60000, 'user'] }, async (c) => {
    const it = items()[c.params.id]; if (!it || (it.public === false && it.owner !== c.user.id)) throw new HttpError(404, 'no_item', 'Not found');
    if (!it.allowDownload && it.owner !== c.user.id && !['owner', 'admin'].includes(c.user.role)) throw new HttpError(403, 'no_download', 'The author does not allow downloads');
    if (require('../vault').locked(c.user, it)) throw new HttpError(402, 'buy_first', 'Buy it in Nebula Vault first');
    const safe = it.title.replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'nebulix';
    if (it.files) { const buf = require('./code').zipOf(Object.entries(it.files).map(([name, f]) => ({ name, data: blobs.readBuffer(f.sha) }))); c.res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': buf.length, 'Content-Disposition': `attachment; filename="${safe}.zip"` }); return c.res.end(buf); }
    blobs.send(c.req, c.res, it.sha, { type: it.type || 'application/octet-stream', name: safe + '.' + ((it.type || '').split('/')[1] || 'bin'), inline: false });
  });
  // a game's saved data for this player (sent by the Hub page, which receives it from the sandboxed game)
  r.put('/api/hub/:id/gamesave', { auth: true, limit: [120, 60000, 'user'], bodyLimit: 2.5 * 1048576 }, async (c) => {
    const it = items()[c.params.id]; if (!it || !it.files) throw new HttpError(404, 'no_item', 'Not found');
    const ls = c.body.ls && typeof c.body.ls === 'object' && !Array.isArray(c.body.ls) ? c.body.ls : {}; const keys = Object.keys(ls);
    if (keys.length > 3000) throw new HttpError(413, 'too_big', 'Too many saved keys');
    const clean = {}; for (const k of keys) clean[String(k).slice(0, 500)] = String(ls[k]);
    const ck = String(c.body.ck || '').slice(0, 8192); const size = JSON.stringify(clean).length + ck.length;
    if (size > 2 * 1048576) throw new HttpError(413, 'too_big', 'This game saves too much data (max 2 MB)');
    saves()[it.id + ':' + c.user.id] = { ls: clean, ck, t: now(), size }; S.store.touch('hubsaves'); return { ok: true, size };
  });
  r.delete('/api/hub/:id/gamesave', { auth: true }, async (c) => { delete saves()[c.params.id + ':' + c.user.id]; S.store.touch('hubsaves'); return { ok: true }; });
  r.patch('/api/hub/:id', { auth: true, verified: true }, async (c) => {
    const it = items()[c.params.id]; if (!it || it.owner !== c.user.id) throw new HttpError(404, 'no_item', 'Not found');
    if (c.body.title !== undefined) it.title = clean(c.body.title, 90) || it.title; if (c.body.desc !== undefined) it.desc = cleanML(c.body.desc, 2000); if (c.body.public !== undefined) it.public = !!c.body.public; if (c.body.allowDownload !== undefined) it.allowDownload = !!c.body.allowDownload; if (c.body.runMode !== undefined) it.runMode = modeOf(c.body.runMode); if (c.body.allowRemix !== undefined) it.allowRemix = !!c.body.allowRemix; if (Array.isArray(c.body.tags)) it.tags = c.body.tags.map((x) => clean(x, 24).toLowerCase()).filter(Boolean).slice(0, 8);
    touch(); return { item: view(it, c.user) };
  });
  r.delete('/api/hub/:id', { auth: true, verified: true }, async (c) => {
    const it = items()[c.params.id]; if (!it || (it.owner !== c.user.id && !['owner', 'admin', 'mod'].includes(c.user.role))) throw new HttpError(404, 'no_item', 'Not found');
    const o = S.users[it.owner]; if (o) blobs.charge(o, -(it.size || 0)); delete items()[it.id]; touch(); const cm = S.store.table('comments'); if (cm[it.id]) { delete cm[it.id]; S.store.touch('comments'); } return { ok: true };
  });
  // media + sandboxed games (no auth cookies needed for subresources; ids are random)
  r.get('/x/hub/i/:id', {}, async (c) => { const it = items()[c.params.id]; if (!it || it.wtype !== 'image') throw new HttpError(404, 'no_item', 'Not found'); blobs.send(c.req, c.res, it.sha, { type: it.type || 'image/gif', name: 'background', maxAge: 604800 }); });
  r.get('/x/hub/v/:id', {}, async (c) => { const it = items()[c.params.id]; if (!it || !(isVid(it.kind) || it.wtype === 'video')) throw new HttpError(404, 'no_item', 'Not found'); blobs.send(c.req, c.res, it.sha, { type: it.type || 'video/mp4', name: it.title + '.mp4', maxAge: 604800 }); });
  r.get('/x/hub/s/:id/:n', {}, async (c) => { const it = items()[c.params.id]; const sha = it && (it.shots || [])[Number(c.params.n)]; if (!sha) throw new HttpError(404, 'no_item', 'Not found'); blobs.send(c.req, c.res, sha, { type: 'image/jpeg', name: 'shot.jpg', maxAge: 604800 }); });
  r.get('/x/hub/t/:id', {}, async (c) => { const it = items()[c.params.id]; if (!it || !it.thumb) throw new HttpError(404, 'no_item', 'Not found'); if (it.official && it.thumbType === 'image/svg+xml') { const buf = blobs.readBuffer(it.thumb); c.res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Content-Length': buf.length, 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" }); return c.res.end(buf); } blobs.send(c.req, c.res, it.thumb, { type: 'image/jpeg', name: 'thumb.jpg', maxAge: 604800 }); });
  const lockedPage = (res) => { res.writeHead(402, { 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff' }); res.end('<!doctype html><meta charset="utf-8"><body style="margin:0;display:grid;place-items:center;height:100vh;background:#0b0c14;color:#e5e7eb;font:16px system-ui">🔒 Nebula Vault — buy this game to play it</body>'); };
  r.get('/x/pp/:key/:id/:rest+', {}, async (c) => {
    const it = items()[c.params.id]; if (!it || !it.files) throw new HttpError(404, 'no_item', 'Not found');
    if (!require('../vault').checkKey(it.id, c.params.key)) return lockedPage(c.res);
    return servePlay(c, it);
  });
  r.get('/x/play/:id/:rest+', {}, async (c) => {
    const it = items()[c.params.id]; if (!it || !it.files) throw new HttpError(404, 'no_item', 'Not found');
    if (require('../vault').paid(it)) return lockedPage(c.res);
    return servePlay(c, it);
  });
  function servePlay(c, it) {
    const name = resolveFile(it, c.params.rest);
    // big binary files (game data, music, models…) are streamed; HTML pages get the compatibility shim
    if (name && !/\.html?$/i.test(name)) return streamFile(c.req, c.res, it, name, { 'Content-Security-Policy': require('./code').NET_CSP() });
    require('./code').sendFiles(c.res, (p) => (it.files[p] ? blobs.readBuffer(it.files[p].sha) : null), c.params.rest, { net: true, inject: (html) => require('../hubshim').inject(html, c.user ? saves()[it.id + ':' + c.user.id] : null) });
  }
};
// The games host (GAMES_ORIGIN, e.g. nebulix-games.fly.dev): only serves the files of Hub games/apps whose creator chose
// "run like in Chrome". It is a different site from Nebulix (no cookies, no /api, no app), so a game there gets normal
// browser storage, IndexedDB and service workers but can never reach anyone's account. localStorage keys are prefixed
// per game so two games on this shared origin do not overwrite each other's saves.
const NS_SHIM = (id) => `<script>(function(){try{var real=window.localStorage,P='nxg:${id}:',own=function(k){return real.getItem(P+k)!==null};
function keys(){var o=[];for(var i=0;i<real.length;i++){var k=real.key(i);if(k&&k.indexOf(P)===0)o.push(k.slice(P.length))}return o}
var api={getItem:function(k){return real.getItem(P+String(k))},setItem:function(k,v){real.setItem(P+String(k),String(v))},removeItem:function(k){real.removeItem(P+String(k))},clear:function(){keys().forEach(function(k){real.removeItem(P+k)})},key:function(i){return keys()[i]||null}};
Object.defineProperty(api,'length',{get:function(){return keys().length}});
var px=new Proxy(api,{get:function(t,p){if(p in t)return t[p];if(typeof p==='string'&&own(p))return real.getItem(P+p);return undefined},set:function(t,p,v){if(p in t)return true;real.setItem(P+String(p),String(v));return true},deleteProperty:function(t,p){real.removeItem(P+String(p));return true},has:function(t,p){return p in t||own(p)},ownKeys:function(){return keys()},getOwnPropertyDescriptor:function(t,p){if(own(p))return{value:real.getItem(P+p),enumerable:true,configurable:true,writable:true}}});
Object.defineProperty(window,'localStorage',{value:px,configurable:true});
var ok=false;try{document.cookie='__nxt=1';ok=/__nxt=1/.test(document.cookie);document.cookie='__nxt=; max-age=0'}catch(e){}
if(!ok){var CK=P+'__cookies';Object.defineProperty(document,'cookie',{configurable:true,get:function(){return real.getItem(CK)||''},set:function(v){v=String(v);var kv=v.split(';')[0].trim(),n=kv.split('=')[0].trim();var cur=(real.getItem(CK)||'');var rest=cur?cur.split('; ').filter(function(c){return c.split('=')[0]!==n}):[];if(!/max-age=0|expires=thu, 01 jan 1970/i.test(v))rest.push(kv);real.setItem(CK,rest.join('; '))}})}
}catch(e){}})();</script>`;
// the bar shown on top of a game opened in "native" mode (its own window): back to Nebulix, fullscreen; hides itself
const NATIVE_BAR = (it) => { const app = require('../config').appOrigin; const title = String(it.title).replace(/[<>&"']/g, ''); return `<script>(function(){if(window.top!==window)return;function go(){if(document.getElementById('__nxbar'))return;var b=document.createElement('div');b.id='__nxbar';
b.innerHTML='<a href="${app}/#/hub/${it.id}" style="color:#fff;text-decoration:none;font-weight:700">◀ Nebulix</a><span style="opacity:.75;margin:0 10px">${title}</span><button type="button" style="margin-left:auto;background:#ffffff22;border:0;color:#fff;border-radius:6px;padding:3px 9px;cursor:pointer">⛶</button>';
b.style.cssText='position:fixed;top:0;left:0;right:0;z-index:2147483647;display:flex;align-items:center;gap:6px;padding:6px 12px;font:13px system-ui,sans-serif;color:#fff;background:linear-gradient(#000c,#0000);transition:transform .3s;pointer-events:auto';
b.querySelector('button').onclick=function(){document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen().catch(function(){})};
document.body.appendChild(b);var t;function show(){b.style.transform='none';clearTimeout(t);t=setTimeout(function(){b.style.transform='translateY(-110%)'},2500)}show();
addEventListener('mousemove',function(e){if(e.clientY<40)show()});addEventListener('touchstart',function(e){if(e.touches[0]&&e.touches[0].clientY<40)show()},{passive:true})}
if(document.body)go();else addEventListener('DOMContentLoaded',go)})();</script>`; };
function serveGameDomain(req, res) {
  const deny = (code, msg) => { res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' }); res.end(msg); };
  if (req.method !== 'GET' && req.method !== 'HEAD') return deny(405, 'Method not allowed');
  let path; try { path = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { return deny(400, 'Bad request'); }
  if (path === '/emu/' || path === '/emu') return require('../emu').serve(req, res); // retro console emulator (13.4)
  // /g/<id>/… free games · /gp/<key>/<id>/… paid games (signed key from Nebula Vault)
  let m = path.match(/^\/g\/([A-Za-z0-9_-]{4,20})\/(.*)$/); let key = null;
  if (!m) { const k = path.match(/^\/gp\/([a-z0-9]+\.[A-Za-z0-9_-]{22})\/([A-Za-z0-9_-]{4,20})\/(.*)$/); if (k) { key = k[1]; m = [k[0], k[2], k[3]]; } }
  if (!m) return deny(404, 'Nebulix games — nothing here');
  const it = items()[m[1]]; if (!it || !it.files || (it.runMode !== 'domain' && it.runMode !== 'native')) return deny(404, 'Game not found');
  if (require('../vault').paid(it) && !(key && require('../vault').checkKey(it.id, key))) return deny(402, 'Nebula Vault — buy this game to play it');
  let name = m[2] || 'index.html'; if (!it.files[name] && it.files[(name ? name.replace(/\/$/, '') + '/' : '') + 'index.html']) name = (name ? name.replace(/\/$/, '') + '/' : '') + 'index.html';
  const f = it.files[name]; if (!f) return deny(404, '404 — ' + name);
  // native: the game is cross-origin isolated (SharedArrayBuffer, threads) even inside the Nebulix page, thanks to
  // Document-Isolation-Policy; COOP/COEP do the same when it is opened on its own (new tab / own window)
  const ISO = it.runMode === 'native' ? { 'Document-Isolation-Policy': 'isolate-and-credentialless', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' } : {};
  if (!/\.html?$/i.test(name)) return streamFile(req, res, it, name, Object.assign({ 'Service-Worker-Allowed': key ? `/gp/${key}/${it.id}/` : `/g/${it.id}/` }, ISO));
  let buf = blobs.readBuffer(f.sha); let inner = name; let enc = null;
  if (/\.[a-z0-9]+\.(br|gz)$/i.test(name)) { enc = /\.br$/i.test(name) ? 'br' : 'gzip'; inner = name.slice(0, -3); }
  const type = require('./code').typeFor(inner);
  const native = it.runMode === 'native';
  if (/\.html?$/i.test(inner) && !enc) { const sh = NS_SHIM(it.id) + (native ? NATIVE_BAR(it) : ''); const t = buf.toString('utf8'); const mh = t.match(/<head[^>]*>/i); buf = Buffer.from(mh ? t.slice(0, mh.index + mh[0].length) + sh + t.slice(mh.index + mh[0].length) : sh + t); }
  res.writeHead(200, Object.assign(enc ? { 'Content-Encoding': enc } : {}, { 'Content-Type': type, 'Content-Length': buf.length, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin', 'Service-Worker-Allowed': key ? `/gp/${key}/${it.id}/` : `/g/${it.id}/` }, ISO));
  res.end(req.method === 'HEAD' ? undefined : buf);
}
// shared with Echo / Clips / TV (routes/media.js)
module.exports.items = items;
module.exports.serveGameDomain = serveGameDomain;
module.exports.view = view;
module.exports.take = (id, uid, kind) => { const up = pending.get(id); if (!up || up.uid !== uid || up.kind !== kind) return null; pending.delete(id); return up; };
module.exports.internals = { pending, items, view, touch, ratingOf };
