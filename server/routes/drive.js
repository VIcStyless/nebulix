'use strict';
// Nebulix Drive + Docs, Sheets and Slides. Files live in the shared blob store; documents keep their content
// as JSON in the item (docs: sanitised HTML string, sheets: cells, slides: slide list). Sharing: private,
// anyone with the link (logged-in Nebulix users) or editable by link.
const { S, hub, publicUser, isPro } = require('../state');
const blobs = require('../blobs');
const { HttpError, now, rid } = require('../util');

const items = () => S.store.table('drive');
const touch = () => S.store.touch('drive');
const KINDS = ['folder', 'file', 'doc', 'sheet', 'slides'];
const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f‪-‮\/\\]/g, ' ').trim().slice(0, n);
const MAX_DATA = 2 * 1024 * 1024;
const maxFile = (u) => (isPro(u) ? [1024, 1024, 2048, 4096][require('../state').tierRank(u)] : 200) * 1024 * 1024;

const canRead = (it, u) => it && !it.purged && (it.owner === u.id || it.share === 'link' || it.share === 'edit' || u.role === 'owner');
const canEdit = (it, u) => it && !it.purged && (it.owner === u.id || it.share === 'edit');
function view(it, u, withData) {
  const o = S.users[it.owner];
  const v = { id: it.id, kind: it.kind, name: it.name, parent: it.parent || null, size: it.size || 0, type: it.type || null, created: it.created, updated: it.updated, starred: !!it.starred, trashed: !!it.trashed, share: it.share || 'private', mine: it.owner === u.id, canEdit: canEdit(it, u), owner: o ? { username: o.username, displayName: o.displayName || o.username } : null };
  if (withData) v.data = it.data || null;
  if (it.kind === 'file') v.url = `/x/drive/f/${it.id}/${encodeURIComponent(it.name)}`;
  return v;
}
function get(c, edit) { const it = items()[c.params.id]; if (!it || !(edit ? canEdit(it, c.user) : canRead(it, c.user))) throw new HttpError(404, 'no_item', 'Not found'); return it; }
const BLANK = {
  doc: () => ({ html: '<h1>Documento sin título</h1><p>Empieza a escribir…</p>' }),
  sheet: () => ({ cells: {}, cols: 26, rows: 100, widths: {} }),
  slides: () => ({ theme: 'nebula', slides: [{ id: rid(5), layout: 'title', bg: null, els: [{ id: rid(5), type: 'text', x: 8, y: 30, w: 84, h: 20, text: 'Título de la presentación', size: 54, bold: true, align: 'center' }, { id: rid(5), type: 'text', x: 15, y: 55, w: 70, h: 10, text: 'Subtítulo', size: 26, align: 'center' }] }] }),
};

module.exports = function register(r) {
  const live = require('../doclive');
  r.get('/api/drive/list', { auth: true, limit: [240, 60000, 'user'] }, async (c) => {
    const u = c.user; const view_ = c.query.view || 'files'; const parent = c.query.parent || null;
    let list = Object.values(items()).filter((x) => !x.purged);
    if (view_ === 'shared') list = list.filter((x) => x.owner !== u.id && (x.sharedWith || []).includes(u.id) && !x.trashed);
    else {
      list = list.filter((x) => x.owner === u.id);
      if (view_ === 'trash') list = list.filter((x) => x.trashed);
      else if (view_ === 'starred') list = list.filter((x) => x.starred && !x.trashed);
      else if (view_ === 'recent') list = list.filter((x) => !x.trashed && x.kind !== 'folder').sort((a, b) => b.updated - a.updated).slice(0, 50);
      else list = list.filter((x) => !x.trashed && (x.parent || null) === parent);
    }
    if (view_ !== 'recent') list.sort((a, b) => (a.kind === 'folder') === (b.kind === 'folder') ? a.name.localeCompare(b.name) : a.kind === 'folder' ? -1 : 1);
    // breadcrumbs
    const crumbs = []; let p = parent ? items()[parent] : null; let guard = 0;
    while (p && guard++ < 20) { crumbs.unshift({ id: p.id, name: p.name }); p = p.parent ? items()[p.parent] : null; }
    return { items: list.map((x) => view(x, u)), crumbs, usage: blobs.usage(u) };
  });
  r.post('/api/drive', { auth: true, verified: true, limit: [120, 60000, 'user'] }, async (c) => {
    const u = c.user; const kind = c.body.kind; if (!['folder', 'doc', 'sheet', 'slides'].includes(kind)) throw new HttpError(400, 'bad_kind', 'Unknown kind');
    const parent = c.body.parent && items()[c.body.parent] && items()[c.body.parent].owner === u.id ? c.body.parent : null;
    const def = { folder: 'Nueva carpeta', doc: 'Documento sin título', sheet: 'Hoja sin título', slides: 'Presentación sin título' }[kind];
    if (Object.values(items()).filter((x) => x.owner === u.id && !x.purged).length > (isPro(u) ? 20000 : 3000)) throw new HttpError(400, 'too_many', 'Too many items in your Drive');
    const it = { id: rid(9), owner: u.id, kind, name: clean(c.body.name, 120) || def, parent, created: now(), updated: now(), share: 'private' };
    if (BLANK[kind]) it.data = BLANK[kind]();
    items()[it.id] = it; touch();
    return { item: view(it, u, true) };
  });
  r.put('/api/drive/upload', { auth: true, verified: true, stream: true, limit: [120, 3600000, 'user'] }, async (c) => {
    const u = c.user; const name = clean(c.query.name, 160) || 'archivo';
    const parent = c.query.parent && items()[c.query.parent] && items()[c.query.parent].owner === u.id ? c.query.parent : null;
    const len = Number(c.req.headers['content-length'] || 0); const q = blobs.usage(u);
    if (q.used + len > q.quota) { c.req.resume(); blobs.charge(u, len); }
    const f = await blobs.receive(c.req, maxFile(u));
    blobs.charge(u, f.size);
    const it = { id: rid(9), owner: u.id, kind: 'file', name, parent, sha: f.sha, size: f.size, type: blobs.typeOf(name), created: now(), updated: now(), share: 'private' };
    items()[it.id] = it; touch();
    return { item: view(it, u) };
  });
  r.get('/api/drive/item/:id', { auth: true, limit: [240, 60000, 'user'] }, async (c) => {
    const it = get(c); if (it.owner !== c.user.id && it.share !== 'private') { it.sharedWith = [...new Set([...(it.sharedWith || []), c.user.id])].slice(0, 500); touch(); }
    return { item: view(it, c.user, true) };
  });
  r.put('/api/drive/item/:id', { auth: true, verified: true, limit: [240, 60000, 'user'], bodyLimit: MAX_DATA + 65536 }, async (c) => {
    const it = get(c, true); const u = c.user; const b = c.body; const own = it.owner === u.id;
    if (b.data !== undefined && it.kind !== 'folder' && it.kind !== 'file') { const s = JSON.stringify(b.data); if (s.length > MAX_DATA) throw new HttpError(413, 'too_big', 'This document is too large (2 MB)'); if (it.kind === 'doc') live.reset(it.id); /* ends the live session (saving it first) before the new content wins */ it.data = b.data; it.updated = now(); it.editedBy = u.id; }
    if (b.name !== undefined) it.name = clean(b.name, 120) || it.name;
    if (own) {
      if (b.starred !== undefined) it.starred = !!b.starred;
      if (b.trashed !== undefined) { it.trashed = !!b.trashed; it.updated = now(); }
      if (b.share !== undefined && ['private', 'link', 'edit'].includes(b.share)) it.share = b.share;
      if (b.parent !== undefined) { const p = b.parent && items()[b.parent]; if (b.parent && (!p || p.owner !== u.id || p.kind !== 'folder' || p.id === it.id)) throw new HttpError(400, 'bad_parent', 'Bad folder'); it.parent = b.parent || null; }
    }
    touch(); return { item: view(it, u, false), saved: it.updated };
  });
  r.delete('/api/drive/item/:id', { auth: true, verified: true }, async (c) => {
    const it = get(c); if (it.owner !== c.user.id) throw new HttpError(403, 'forbidden', 'Only the owner can delete it');
    const purge = (x) => { x.purged = true; if (x.kind === 'file') blobs.charge(c.user, -(x.size || 0)); for (const ch of Object.values(items())) if (ch.parent === x.id && !ch.purged) purge(ch); };
    purge(it); live.reset(it.id); delete it.data; if (comments()[it.id]) { delete comments()[it.id]; S.store.touch('doccomments'); } touch(); return { ok: true };
  });
  // ---- Nebulix 3.0: comments on documents (threads anchored to a quoted piece of text, replies, resolve) ----
  // Anyone who can open the document can comment; the author or the document's owner can delete a thread, and
  // anyone who can edit it can resolve/reopen. The owner and everyone in the thread get a notice.
  const comments = () => S.store.table('doccomments');
  const ctext = (s, n) => String(s || '').replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, n);
  const cuser = (id) => { const u = S.users[id]; return u ? { username: u.username, displayName: u.displayName || u.username, avatar: publicUser(u).avatar || null } : { username: '?', displayName: '?' }; };
  const cview = (th, it, u) => ({ id: th.id, by: cuser(th.by), mine: th.by === u.id, quote: th.quote || '', text: th.text, at: th.at, resolved: !!th.resolved, resolvedBy: th.resolvedBy ? cuser(th.resolvedBy).username : null,
    canDelete: th.by === u.id || it.owner === u.id, replies: (th.replies || []).map((x) => ({ id: x.id, by: cuser(x.by), mine: x.by === u.id, text: x.text, at: x.at, canDelete: x.by === u.id || it.owner === u.id })) });
  const docItem = (c) => { const it = get(c); if (it.kind === 'folder' || it.kind === 'file') throw new HttpError(400, 'bad_kind', 'Only documents have comments'); return it; };
  const threads = (it) => comments()[it.id] || (comments()[it.id] = []);
  function tell(it, th, from, en, es) {
    const to = new Set([it.owner, th.by, ...(th.replies || []).map((x) => x.by)]); to.delete(from.id);
    for (const id of to) if (S.users[id]) hub.push(id, { t: 'notice', text: `💬 @${from.username} ${en} “${it.name}”`, es: `💬 @${from.username} ${es} «${it.name}»`, link: '#/' + ({ doc: 'docs', sheet: 'sheets', slides: 'slides' }[it.kind] || 'drive') + '/' + it.id });
    for (const id of new Set([it.owner, ...(it.sharedWith || []), th.by])) if (S.users[id]) hub.push(id, { t: 'dcomm', item: it.id });
  }
  r.get('/api/drive/item/:id/comments', { auth: true, limit: [240, 60000, 'user'] }, async (c) => { const it = docItem(c); return { comments: threads(it).map((th) => cview(th, it, c.user)) }; });
  r.post('/api/drive/item/:id/comments', { auth: true, verified: true, limit: [30, 60000, 'user'] }, async (c) => {
    const it = docItem(c); const text = ctext(c.body.text, 2000); if (!text) throw new HttpError(400, 'empty', 'Write a comment');
    const list = threads(it); if (list.length >= 300) throw new HttpError(400, 'too_many', 'This document has too many comments — delete some first');
    const th = { id: rid(8), by: c.user.id, text, quote: ctext(c.body.quote, 300), at: now(), replies: [] }; list.push(th); S.store.touch('doccomments');
    tell(it, th, c.user, 'commented on', 'ha comentado en'); return { comment: cview(th, it, c.user) };
  });
  const thread = (c, it) => { const th = threads(it).find((x) => x.id === c.params.cid); if (!th) throw new HttpError(404, 'no_comment', 'Comment not found'); return th; };
  r.post('/api/drive/item/:id/comments/:cid/reply', { auth: true, verified: true, limit: [60, 60000, 'user'] }, async (c) => {
    const it = docItem(c); const th = thread(c, it); const text = ctext(c.body.text, 2000); if (!text) throw new HttpError(400, 'empty', 'Write a reply');
    if ((th.replies || []).length >= 100) throw new HttpError(400, 'too_many', 'This thread is full');
    (th.replies = th.replies || []).push({ id: rid(8), by: c.user.id, text, at: now() }); th.resolved = false; S.store.touch('doccomments');
    tell(it, th, c.user, 'replied to a comment in', 'ha respondido a un comentario en'); return { comment: cview(th, it, c.user) };
  });
  r.put('/api/drive/item/:id/comments/:cid', { auth: true, verified: true, limit: [120, 60000, 'user'] }, async (c) => {
    const it = docItem(c); const th = thread(c, it);
    if (c.body.resolved !== undefined) { if (!canEdit(it, c.user) && th.by !== c.user.id) throw new HttpError(403, 'forbidden', 'Only editors can resolve comments'); th.resolved = !!c.body.resolved; th.resolvedBy = th.resolved ? c.user.id : null; }
    if (c.body.text !== undefined) { if (th.by !== c.user.id) throw new HttpError(403, 'forbidden', 'You can only edit your own comments'); const text = ctext(c.body.text, 2000); if (!text) throw new HttpError(400, 'empty', 'Write a comment'); th.text = text; th.edited = now(); }
    S.store.touch('doccomments'); for (const id of new Set([it.owner, ...(it.sharedWith || [])])) if (S.users[id] && id !== c.user.id) hub.push(id, { t: 'dcomm', item: it.id });
    return { comment: cview(th, it, c.user) };
  });
  r.delete('/api/drive/item/:id/comments/:cid', { auth: true, verified: true, limit: [120, 60000, 'user'] }, async (c) => {
    const it = docItem(c); const list = threads(it); const th = thread(c, it);
    if (c.query.reply) { const i = (th.replies || []).findIndex((x) => x.id === c.query.reply); if (i < 0) throw new HttpError(404, 'no_comment', 'Reply not found'); if (th.replies[i].by !== c.user.id && it.owner !== c.user.id) throw new HttpError(403, 'forbidden', 'Not yours'); th.replies.splice(i, 1); }
    else { if (th.by !== c.user.id && it.owner !== c.user.id) throw new HttpError(403, 'forbidden', 'Only the author or the owner can delete it'); list.splice(list.indexOf(th), 1); }
    S.store.touch('doccomments'); for (const id of new Set([it.owner, ...(it.sharedWith || [])])) if (S.users[id] && id !== c.user.id) hub.push(id, { t: 'dcomm', item: it.id });
    return { ok: true };
  });
  // Nebulix 3.0: co-editing batches too big for one WebSocket frame (an inline image, a big paste)
  r.post('/api/drive/item/:id/live', { auth: true, verified: true, limit: [120, 60000, 'user'], bodyLimit: MAX_DATA + 65536 }, async (c) => {
    get(c, true); const res = live.applyHttp(c.user, c.params.id, c.body || {});
    if (res.error && res.error !== 'too_big') throw new HttpError(res.error === 'rate_limited' ? 429 : 409, res.error, res.error === 'read_only' ? 'You can only read this document' : 'Live session not found — reload the document');
    return res;
  });
  r.post('/api/drive/trash/empty', { auth: true, verified: true }, async (c) => {
    let n = 0; for (const x of Object.values(items())) if (x.owner === c.user.id && x.trashed && !x.purged) { x.purged = true; delete x.data; if (x.kind === 'file') blobs.charge(c.user, -(x.size || 0)); n++; }
    touch(); return { removed: n };
  });
  r.get('/x/drive/f/:id/:name', { auth: true }, async (c) => { const it = items()[c.params.id]; if (!it || it.kind !== 'file' || !canRead(it, c.user)) throw new HttpError(404, 'no_item', 'Not found'); blobs.send(c.req, c.res, it.sha, { type: it.type, name: it.name, inline: c.query.dl !== '1' }); });
};
module.exports.perms = { canRead, canEdit };
