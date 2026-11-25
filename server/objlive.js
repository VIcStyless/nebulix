'use strict';
// Nebulix 3.0 — real-time co-editing for Nebulix Sheets and Slides.
// A document is split into independent keyed units: a sheet into one unit per cell ("c:B4") plus its settings
// ("m:cols", "m:widths", …); a presentation into one unit per slide ("s:<id>"), the slide order ("o:") and its settings.
// Editors send "set unit k to v" operations (v is the unit's JSON, null deletes it). The server applies them in arrival
// order and relays them; a client skips remote operations on units it still has unconfirmed changes for (the server
// will apply its own afterwards), so every copy ends up identical. Same transport and safety net as Docs
// (server/doclive.js): one batch in flight per client, acks on the ordered socket, a periodic hash check, HTTP for
// batches bigger than a socket frame, and an old-style whole-document save ends the session.
const crypto = require('crypto');
const { S, publicUser } = require('./state');
const { Limiter, now } = require('./util');

const MAX_DATA = 2 * 1024 * 1024 - 65536; const MAX_UNITS = 60000; const MAX_MEMBERS = 50; const KEEP_MS = 10 * 60 * 1000; const SAVE_MS = 1500;
const COLORS = ['#f43f5e', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#14b8a6', '#ec4899', '#84cc16', '#06b6d4', '#f97316'];
const KEY = /^[a-z]:[\w.-]{0,40}$/; const CID = /^[A-Za-z0-9_-]{4,16}$/;
const sessions = new Map();
const opLim = new Limiter(40, 1000); const curLim = new Limiter(30, 1000); const joinLim = new Limiter(30, 10000); const chkLim = new Limiter(6, 10000);
const items = () => S.store.table('drive');
const P = () => require('./routes/drive').perms;

// ---- the same split / assemble rules as public/js/objlive.js ----
function split(kind, data) {
  const m = new Map(); data = data || {};
  for (const [k, v] of Object.entries(data)) {
    if (kind === 'sheet' && k === 'cells') { for (const [ref, c] of Object.entries(v || {})) if (/^[A-Z]{1,3}\d{1,5}$/.test(ref)) m.set('c:' + ref, JSON.stringify(c)); }
    else if (kind === 'slides' && k === 'slides') { const ids = []; for (const s of v || []) { if (!s || !s.id) continue; ids.push(String(s.id)); m.set('s:' + s.id, JSON.stringify(s)); } m.set('o:', JSON.stringify(ids)); }
    else if (/^[\w-]{1,40}$/.test(k)) m.set('m:' + k, JSON.stringify(v));
  }
  return m;
}
function assemble(kind, m) {
  const d = {};
  for (const [k, v] of m) if (k.startsWith('m:')) { try { d[k.slice(2)] = JSON.parse(v); } catch {} }
  if (kind === 'sheet') { d.cells = {}; for (const [k, v] of m) if (k.startsWith('c:')) { try { d.cells[k.slice(2)] = JSON.parse(v); } catch {} } }
  if (kind === 'slides') {
    let order = []; try { order = JSON.parse(m.get('o:') || '[]'); } catch {}
    const seen = new Set(); d.slides = [];
    for (const id of order) if (!seen.has(id) && m.has('s:' + id)) { seen.add(id); try { d.slides.push(JSON.parse(m.get('s:' + id))); } catch {} }
    for (const [k, v] of [...m].sort((a, b) => (a[0] < b[0] ? -1 : 1))) if (k.startsWith('s:') && !seen.has(k.slice(2))) { try { d.slides.push(JSON.parse(v)); } catch {} }
  }
  return d;
}
function fnv(str) { let h = 0x811c9dc5; for (let k = 0; k < str.length; k++) { h ^= str.charCodeAt(k); h = Math.imul(h, 0x01000193) >>> 0; } return h; }
const hashOf = (s) => fnv([...s.units].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => k + '=' + v).join('\n'));

function open(it) {
  let s = sessions.get(it.id); if (s) return s;
  const units = split(it.kind, it.data);
  s = { item: it.id, kind: it.kind, sid: crypto.randomBytes(6).toString('base64url'), ver: 0, units, size: [...units.values()].reduce((a, v) => a + v.length, 0), members: new Map(), dirty: false, saveT: null, endT: null, by: null, colorN: 0 };
  sessions.set(it.id, s); return s;
}
function save(s) { clearTimeout(s.saveT); s.saveT = null; if (!s.dirty) return; const it = items()[s.item]; s.dirty = false; if (!it || it.purged) return; it.data = assemble(s.kind, s.units); it.updated = now(); if (s.by) it.editedBy = s.by; S.store.touch('drive'); }
const later = (s) => { s.dirty = true; if (!s.saveT) s.saveT = setTimeout(() => save(s), SAVE_MS); };
function peerView(m) { const u = S.users[m.uid]; const p = u ? publicUser(u) : {}; return { cid: m.cid, username: p.username || '?', displayName: p.displayName || p.username || '?', avatar: p.avatar || null, color: m.color, edit: m.edit, at: m.at || null }; }
function send(s, msg, except) { const str = JSON.stringify(msg); for (const m of s.members.values()) if (m.cid !== except) m.conn.send(str); }
function state(s, m) { m.conn.send({ t: 'ol_state', item: s.item, cid: m.cid, sid: s.sid, ver: s.ver, edit: m.edit, units: [...s.units], peers: [...s.members.values()].filter((x) => x.cid !== m.cid).map(peerView) }); }
function leave(s, cid) {
  const m = s.members.get(cid); if (!m) return; s.members.delete(cid); if (m.conn.data.ol) m.conn.data.ol.delete(s.item + ' ' + cid);
  send(s, { t: 'ol_peer', item: s.item, kind: 'leave', cid });
  if (!s.members.size) { save(s); clearTimeout(s.endT); s.endT = setTimeout(() => { if (!s.members.size && sessions.get(s.item) === s) { save(s); sessions.delete(s.item); } }, KEEP_MS); s.endT.unref && s.endT.unref(); }
}
function apply(s, m, ops) {
  const it = items()[s.item]; if (!it || !P().canEdit(it, S.users[m.uid] || {})) { m.edit = false; return { error: 'read_only' }; }
  if (!Array.isArray(ops) || !ops.length || ops.length > 5000) return { error: 'bad_ops' };
  let size = s.size; let bad = 0; const done = [];
  for (const op of ops) {
    if (!op || !KEY.test(String(op.k || '')) || (op.v !== null && typeof op.v !== 'string')) { bad++; continue; }
    if (op.v !== null) { try { JSON.parse(op.v); } catch { bad++; continue; } }
    const old = s.units.get(op.k); const nsize = size - (old ? old.length : 0) + (op.v ? op.v.length : 0);
    if (nsize > MAX_DATA || (!old && s.units.size >= MAX_UNITS)) return { error: 'too_big', ver: s.ver };
    if (op.v === null) s.units.delete(op.k); else s.units.set(op.k, op.v); size = nsize; done.push({ k: op.k, v: op.v });
  }
  s.size = size;
  if (done.length) { s.ver++; s.by = m.uid; later(s); send(s, { t: 'ol_ops', item: s.item, ver: s.ver, by: m.cid, ops: done }, m.cid); }
  return { ver: s.ver, bad };
}
function member(conn, u, m) { const s = sessions.get(String(m.item || '')); const mm = s && s.members.get(String(m.cid || '')); return mm && mm.conn === conn && mm.uid === u.id ? [s, mm] : [null, null]; }
function onMessage(conn, u, m) {
  if (m.t === 'ol_join') {
    if (!joinLim.hit(u.id)) return conn.send({ t: 'ol_error', item: m.item, cid: m.cid, error: 'rate_limited' });
    const cid = String(m.cid || ''); const it = items()[String(m.item || '')]; const me = S.users[u.id] || u;
    if (!CID.test(cid) || !it || !['sheet', 'slides'].includes(it.kind) || !P().canRead(it, me)) return conn.send({ t: 'ol_error', item: m.item, cid, error: 'no_item' });
    const s = open(it); const old = s.members.get(cid); if (old && old.conn !== conn) leave(s, cid);
    if (!s.members.has(cid) && s.members.size >= MAX_MEMBERS) return conn.send({ t: 'ol_error', item: it.id, cid, error: 'full' });
    clearTimeout(s.endT);
    const mem = s.members.get(cid) || { cid, uid: u.id, conn, color: COLORS[s.colorN++ % COLORS.length], at: null };
    mem.edit = P().canEdit(it, me); s.members.set(cid, mem); (conn.data.ol || (conn.data.ol = new Set())).add(it.id + ' ' + cid);
    state(s, mem); send(s, { t: 'ol_peer', item: it.id, kind: 'join', peer: peerView(mem) }, cid); return;
  }
  const [s, mem] = member(conn, u, m); if (!s) { if (m.t === 'ol_ops') conn.send({ t: 'ol_error', item: m.item, cid: m.cid, error: 'not_joined' }); return; }
  if (m.t === 'ol_leave') return leave(s, mem.cid);
  if (m.t === 'ol_ops') { if (!opLim.hit(u.id)) return conn.send({ t: 'ol_ack', item: s.item, cid: mem.cid, seq: m.seq, error: 'rate_limited' }); return conn.send({ t: 'ol_ack', item: s.item, cid: mem.cid, seq: m.seq, ...apply(s, mem, m.ops) }); }
  if (m.t === 'ol_cur') { if (!curLim.hit(u.id)) return; mem.at = /^[\w:.-]{1,40}$/.test(String(m.at || '')) ? String(m.at) : null; return send(s, { t: 'ol_cur', item: s.item, cid: mem.cid, at: mem.at }, mem.cid); }
  if (m.t === 'ol_chk') { if (chkLim.hit(u.id) && Number(m.ver) === s.ver && (Number(m.h) >>> 0) !== hashOf(s)) state(s, mem); return; }
  if (m.t === 'ol_resync') { if (chkLim.hit(u.id)) state(s, mem); }
}
function applyHttp(u, itemId, body) {
  const s = sessions.get(itemId); const mem = s && s.members.get(String(body.cid || '')); if (!mem || mem.uid !== u.id) return { error: 'not_joined' };
  if (!opLim.hit(u.id, 5)) { mem.conn.send({ t: 'ol_ack', item: s.item, cid: mem.cid, seq: body.seq, error: 'rate_limited' }); return { error: 'rate_limited' }; }
  const r = apply(s, mem, body.ops); mem.conn.send({ t: 'ol_ack', item: s.item, cid: mem.cid, seq: body.seq, ...r }); return r;
}
function onClose(conn) { const set = conn.data.ol; if (!set) return; conn.data.ol = null; for (const k of set) { const [item, cid] = k.split(' '); const s = sessions.get(item); if (s && s.members.get(cid) && s.members.get(cid).conn === conn) leave(s, cid); } }
function reset(itemId) { const s = sessions.get(itemId); if (!s) return; save(s); clearTimeout(s.endT); sessions.delete(itemId); send(s, { t: 'ol_reset', item: itemId }); for (const m of s.members.values()) if (m.conn.data.ol) m.conn.data.ol.delete(itemId + ' ' + m.cid); }
function flushAll() { for (const s of sessions.values()) save(s); }
module.exports = { onMessage, onClose, applyHttp, reset, flushAll, split, assemble, fnv, _sessions: sessions };
