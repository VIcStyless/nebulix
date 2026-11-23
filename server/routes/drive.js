'use strict';
// Nebulix Drive + Docs, Sheets and Slides. Files live in the shared blob store; documents keep their content
// as JSON in the item (docs: sanitised HTML string, sheets: cells, slides: slide list). Sharing: private,
// anyone with the link (logged-in Nebulix users) or editable by link.
const { S, publicUser, isPro } = require('../state');
const blobs = require('../blobs');
const { HttpError, now, rid } = require('../util');

const items = () => S.store.table('drive');
const touch = () => S.store.touch('drive');
const KINDS = ['folder', 'file', 'doc', 'sheet', 'slides'];
const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f‪-‮\/\\]/g, ' ').trim().slice(0, n);
const MAX_DATA = 2 * 1024 * 1024;
const maxFile = (u) => (isPro(u) ? 1024 : 200) * 1024 * 1024;

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
    if (b.data !== undefined && it.kind !== 'folder' && it.kind !== 'file') { const s = JSON.stringify(b.data); if (s.length > MAX_DATA) throw new HttpError(413, 'too_big', 'This document is too large (2 MB)'); it.data = b.data; it.updated = now(); it.editedBy = u.id; }
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
    purge(it); delete it.data; touch(); return { ok: true };
  });
  r.post('/api/drive/trash/empty', { auth: true, verified: true }, async (c) => {
    let n = 0; for (const x of Object.values(items())) if (x.owner === c.user.id && x.trashed && !x.purged) { x.purged = true; delete x.data; if (x.kind === 'file') blobs.charge(c.user, -(x.size || 0)); n++; }
    touch(); return { removed: n };
  });
  r.get('/x/drive/f/:id/:name', { auth: true }, async (c) => { const it = items()[c.params.id]; if (!it || it.kind !== 'file' || !canRead(it, c.user)) throw new HttpError(404, 'no_item', 'Not found'); blobs.send(c.req, c.res, it.sha, { type: it.type, name: it.name, inline: c.query.dl !== '1' }); });
};
