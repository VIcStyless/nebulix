'use strict';
// Nebulix 3.0 — real-time co-editing for Nebulix Docs.
//
// A live session holds the document as an ordered list of top-level blocks (paragraphs, headings, lists, tables…)
// with ids. Editors send block operations over the WebSocket (or over HTTP when a batch is bigger than the socket's
// 64 KB frame limit); the server applies them in arrival order and relays them to everyone else in the document.
//   s  {id, h}      replace the block's HTML (also brings back a deleted block: edits beat deletes)
//   i  {id, a, h}   insert a new block directly after block `a` (null = at the top)
//   d  {id}         delete the block (kept as a tombstone, so later inserts after it keep their place)
// Each client sends one batch at a time and waits for its ack. Because everything the server relays to a client goes
// through the same ordered socket, a client can tell which remote operations the server applied before its own batch
// and resolve them the same way (see public/js/doclive.js), so every copy converges. A periodic hash check catches
// anything that slips through and resends the full state.
// The document is still stored as one HTML string (`item.data.html`), so Drive, exports, comments and older clients
// keep working; an old-style save (PUT with data) resets the live session and everyone reloads.
const crypto = require('crypto');
const { S, hub, publicUser } = require('./state');
const { Limiter, now } = require('./util');

const MAX_DATA = 2 * 1024 * 1024 - 65536;
const MAX_ENTRIES = 20000; const MAX_MEMBERS = 50; const MAX_SESSIONS = 2000;
const KEEP_MS = 10 * 60 * 1000; const SAVE_MS = 1500;
const COLORS = ['#f43f5e', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#14b8a6', '#ec4899', '#84cc16', '#06b6d4', '#f97316'];
const VOID = new Set(['br', 'hr', 'img', 'wbr', 'input', 'meta', 'link', 'col', 'area', 'base', 'embed', 'source', 'track', 'param']);
const INLINE = new Set(['b', 'strong', 'i', 'em', 'u', 's', 'strike', 'a', 'span', 'font', 'mark', 'sub', 'sup', 'code', 'br', 'img']);
const ID = /^[A-Za-z0-9_-]{4,16}$/;

const sessions = new Map(); // item id -> session
const opLim = new Limiter(40, 1000); const curLim = new Limiter(30, 1000); const joinLim = new Limiter(30, 10000); const chkLim = new Limiter(6, 10000);
const items = () => S.store.table('drive');
const rid = () => crypto.randomBytes(6).toString('base64url');
let perms = null; // { canRead, canEdit } from routes/drive.js (set on first use to avoid a require cycle)
const P = () => perms || (perms = require('./routes/drive').perms);

// Split browser-serialised HTML into its top-level pieces: every block element is one piece, and each run of loose
// text / inline elements between blocks becomes one piece. Returns null if the markup is not balanced.
function splitTop(html) {
  const out = []; let depth = 0; let start = 0; let run = -1; let i = 0; const n = html.length; const stack = [];
  const flushRun = (end) => { if (run >= 0) { const s = html.slice(run, end); if (s.trim()) out.push(s); run = -1; } };
  while (i < n) {
    if (html[i] !== '<') { if (depth === 0 && run < 0) run = i; i++; continue; }
    if (html.startsWith('<!--', i)) { const e = html.indexOf('-->', i + 4); i = e < 0 ? n : e + 3; continue; }
    const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)/.exec(html.slice(i, i + 20));
    if (!m) { if (depth === 0 && run < 0) run = i; i++; continue; }
    // find the end of the tag, skipping quoted attribute values (browsers keep < and > raw inside them)
    let j = i + m[0].length; let q = '';
    while (j < n) { const ch = html[j]; if (q) { if (ch === q) q = ''; } else if (ch === '"' || ch === "'") q = ch; else if (ch === '>') break; j++; }
    if (j >= n) return null;
    const tag = m[2].toLowerCase(); const closing = m[1] === '/'; const selfClose = html[j - 1] === '/' || VOID.has(tag);
    if (depth === 0 && !closing && INLINE.has(tag)) { if (run < 0) run = i; }
    else if (depth === 0 && !closing) { flushRun(i); start = i; }
    if (closing) { if (!stack.length || stack[stack.length - 1] !== tag) return null; stack.pop(); depth--; if (depth === 0 && run < 0) out.push(html.slice(start, j + 1)); }
    else if (!selfClose) { stack.push(tag); depth++; }
    else if (depth === 0 && run < 0) out.push(html.slice(i, j + 1));
    i = j + 1;
  }
  if (depth !== 0) return null;
  flushRun(n);
  return out;
}

function fnv(str) { let h = 0x811c9dc5; for (let k = 0; k < str.length; k++) { h ^= str.charCodeAt(k); h = Math.imul(h, 0x01000193) >>> 0; } return h; }
const liveHtml = (s) => s.blocks.filter((b) => !b.dead).map((b) => b.h).join('');
const hashOf = (s) => fnv(s.blocks.filter((b) => !b.dead).map((b) => b.id + ':' + b.h).join('\n'));

function open(it) {
  let s = sessions.get(it.id); if (s) return s;
  if (sessions.size >= MAX_SESSIONS) { for (const [k, x] of sessions) if (!x.members.size) { save(x); sessions.delete(k); if (sessions.size < MAX_SESSIONS) break; } if (sessions.size >= MAX_SESSIONS) return null; }
  const html = String((it.data && it.data.html) || '');
  const parts = splitTop(html) || [html];
  s = { item: it.id, sid: rid(), ver: 0, blocks: parts.map((h) => ({ id: rid(), h, dead: false })), members: new Map(), dirty: false, saveT: null, endT: null, by: null, colorN: 0 };
  s.size = html.length; s.index = new Map(s.blocks.map((b, k) => [b.id, b]));
  sessions.set(it.id, s); return s;
}
function save(s) {
  clearTimeout(s.saveT); s.saveT = null; if (!s.dirty) return;
  const it = items()[s.item]; if (!it || it.purged) { s.dirty = false; return; }
  it.data = { ...(it.data || {}), html: liveHtml(s) }; it.updated = now(); if (s.by) it.editedBy = s.by; s.dirty = false; S.store.touch('drive');
}
function later(s) { s.dirty = true; if (!s.saveT) s.saveT = setTimeout(() => save(s), SAVE_MS); }
function peerView(m) { const u = S.users[m.uid]; const p = u ? publicUser(u) : {}; return { cid: m.cid, username: p.username || '?', displayName: p.displayName || p.username || '?', avatar: p.avatar || null, color: m.color, edit: m.edit, b: m.b || null, o: m.o || 0 }; }
function send(s, msg, exceptCid) { const str = JSON.stringify(msg); for (const m of s.members.values()) if (m.cid !== exceptCid) m.conn.send(str); }
function state(s, m) { m.conn.send({ t: 'dl_state', item: s.item, cid: m.cid, sid: s.sid, ver: s.ver, edit: m.edit, blocks: s.blocks.map((b) => (b.dead ? { id: b.id, dead: 1 } : { id: b.id, h: b.h })), peers: [...s.members.values()].filter((x) => x.cid !== m.cid).map(peerView) }); }

function leave(s, cid) {
  const m = s.members.get(cid); if (!m) return; s.members.delete(cid);
  const set = m.conn.data.dl; if (set) set.delete(s.item + ' ' + cid);
  send(s, { t: 'dl_peer', item: s.item, kind: 'leave', cid });
  if (!s.members.size) { save(s); clearTimeout(s.endT); s.endT = setTimeout(() => { if (!s.members.size && sessions.get(s.item) === s) { save(s); sessions.delete(s.item); } }, KEEP_MS); s.endT.unref && s.endT.unref(); }
}

// Apply one batch from member `m`. Returns { ver, bad } (bad = operations that referred to unknown blocks).
function apply(s, m, ops) {
  const it = items()[s.item]; if (!it || !P().canEdit(it, S.users[m.uid] || {})) { m.edit = false; return { error: 'read_only' }; }
  if (!Array.isArray(ops) || !ops.length || ops.length > 500) return { error: 'bad_ops' };
  let bad = 0; const done = []; let size = s.size;
  for (const op of ops) {
    if (!op || typeof op !== 'object' || !ID.test(String(op.id || ''))) { bad++; continue; }
    const h = op.h === undefined ? '' : String(op.h);
    let b = s.index.get(op.id);
    if (op.o === 'd') { if (!b) { bad++; continue; } if (!b.dead) { size -= b.h.length; b.dead = true; b.h = ''; } done.push({ o: 'd', id: op.id }); continue; }
    if (op.o !== 's' && op.o !== 'i') { bad++; continue; }
    if (size - (b && !b.dead ? b.h.length : 0) + h.length > MAX_DATA) return { error: 'too_big', ver: s.ver };
    if (b) { size += h.length - (b.dead ? 0 : b.h.length); b.h = h; b.dead = false; done.push({ o: 's', id: op.id, h }); continue; } // an insert retried after a reconnect is already there
    if (op.o === 's') { bad++; continue; }
    if (s.blocks.length >= MAX_ENTRIES) return { error: 'too_big', ver: s.ver };
    const a = op.a == null ? null : String(op.a); let at = 0;
    if (a !== null) { const ab = s.index.get(a); if (!ab) { bad++; at = s.blocks.length; } else at = s.blocks.indexOf(ab) + 1; }
    b = { id: op.id, h, dead: false }; s.blocks.splice(at, 0, b); s.index.set(b.id, b); size += h.length;
    done.push({ o: 'i', id: op.id, a: a !== null && s.index.has(a) ? a : (at === 0 ? null : s.blocks[at - 1].id), h });
  }
  s.size = size;
  if (done.length) { s.ver++; s.by = m.uid; later(s); send(s, { t: 'dl_ops', item: s.item, ver: s.ver, by: m.cid, ops: done }, m.cid); }
  return { ver: s.ver, bad };
}

function member(conn, u, m) {
  const s = sessions.get(String(m.item || '')); const mm = s && s.members.get(String(m.cid || ''));
  return mm && mm.conn === conn && mm.uid === u.id ? [s, mm] : [null, null];
}

function onMessage(conn, u, m) {
  if (m.t === 'dl_join') {
    if (!joinLim.hit(u.id)) return conn.send({ t: 'dl_error', item: m.item, cid: m.cid, error: 'rate_limited' });
    const cid = String(m.cid || ''); const it = items()[String(m.item || '')]; const me = S.users[u.id] || u;
    if (!ID.test(cid) || !it || it.kind !== 'doc' || !P().canRead(it, me)) return conn.send({ t: 'dl_error', item: m.item, cid, error: 'no_item' });
    const s = open(it); if (!s) return conn.send({ t: 'dl_error', item: it.id, cid, error: 'busy' });
    const old = s.members.get(cid); if (old && old.conn !== conn) leave(s, cid);
    if (!s.members.has(cid) && s.members.size >= MAX_MEMBERS) return conn.send({ t: 'dl_error', item: it.id, cid, error: 'full' });
    clearTimeout(s.endT);
    const mem = s.members.get(cid) || { cid, uid: u.id, conn, color: COLORS[s.colorN++ % COLORS.length], b: null, o: 0 };
    mem.edit = P().canEdit(it, me); s.members.set(cid, mem); (conn.data.dl || (conn.data.dl = new Set())).add(it.id + ' ' + cid);
    state(s, mem); send(s, { t: 'dl_peer', item: it.id, kind: 'join', peer: peerView(mem) }, cid);
    return;
  }
  const [s, mem] = member(conn, u, m); if (!s) { if (m.t === 'dl_ops') conn.send({ t: 'dl_error', item: m.item, cid: m.cid, error: 'not_joined' }); return; }
  if (m.t === 'dl_leave') return leave(s, mem.cid);
  if (m.t === 'dl_ops') {
    if (!opLim.hit(u.id)) return conn.send({ t: 'dl_ack', item: s.item, cid: mem.cid, seq: m.seq, error: 'rate_limited' });
    const r = apply(s, mem, m.ops); return conn.send({ t: 'dl_ack', item: s.item, cid: mem.cid, seq: m.seq, ...r });
  }
  if (m.t === 'dl_cur') {
    if (!curLim.hit(u.id)) return;
    mem.b = ID.test(String(m.b || '')) ? String(m.b) : null; mem.o = Math.max(0, Math.min(1e6, Number(m.o) | 0)); mem.e = Math.max(0, Math.min(1e6, Number(m.e) | 0));
    return send(s, { t: 'dl_cur', item: s.item, cid: mem.cid, b: mem.b, o: mem.o, e: mem.e }, mem.cid);
  }
  if (m.t === 'dl_chk') { // the client is idle and at version `ver`: compare content hashes, resend the state if they differ
    if (!chkLim.hit(u.id)) return;
    if (Number(m.ver) === s.ver && (Number(m.h) >>> 0) !== hashOf(s)) state(s, mem);
    return;
  }
  if (m.t === 'dl_resync') { if (chkLim.hit(u.id)) state(s, mem); }
}
// Big batches arrive over HTTP; the ack still goes through the member's socket so it stays in order with the relays.
function applyHttp(u, itemId, body) {
  const s = sessions.get(itemId); const mem = s && s.members.get(String(body.cid || ''));
  if (!mem || mem.uid !== u.id) return { error: 'not_joined' };
  if (!opLim.hit(u.id, 5)) { mem.conn.send({ t: 'dl_ack', item: s.item, cid: mem.cid, seq: body.seq, error: 'rate_limited' }); return { error: 'rate_limited' }; }
  const r = apply(s, mem, body.ops); mem.conn.send({ t: 'dl_ack', item: s.item, cid: mem.cid, seq: body.seq, ...r }); return r;
}
function onClose(conn) {
  const set = conn.data.dl; if (!set) return; conn.data.dl = null;
  for (const k of set) { const [item, cid] = k.split(' '); const s = sessions.get(item); if (s && s.members.get(cid) && s.members.get(cid).conn === conn) leave(s, cid); }
}
// Someone saved the whole document the old way (or it was deleted): end the session so everybody reloads it.
function reset(itemId) {
  const s = sessions.get(itemId); if (!s) return; save(s); clearTimeout(s.endT); sessions.delete(itemId);
  send(s, { t: 'dl_reset', item: itemId }); for (const m of s.members.values()) { const set = m.conn.data.dl; if (set) set.delete(itemId + ' ' + m.cid); }
}
const isLive = (itemId) => { const s = sessions.get(itemId); return !!(s && s.members.size); };
function flushAll() { for (const s of sessions.values()) save(s); }
const stats = () => ({ sessions: sessions.size, editors: [...sessions.values()].reduce((a, s) => a + s.members.size, 0) });
module.exports = { onMessage, onClose, applyHttp, reset, isLive, flushAll, stats, splitTop, fnv, _sessions: sessions };
