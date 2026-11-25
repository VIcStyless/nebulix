// Nebulix 3.0 — live co-editing for Nebulix Docs (the protocol is described in server/doclive.js).
// The page keeps a "shadow" copy of the server's block list (with tombstones). Local edits are found with a
// MutationObserver, turned into block operations and sent one batch at a time. A remote operation that touches a
// block we have unsent or unacknowledged changes for was applied by the server *before* ours (the socket is ordered),
// so ours will overwrite it: we skip it. Remote inserts skip over our own unacknowledged inserts at the same spot,
// exactly where the server will put them. The result: every copy ends with the same blocks in the same order.
import { h } from './util.js';
import { api, ws } from './api.js';
import { S, bus } from './state.js';
import { t } from './i18n.js';
import { sanitize } from './office.js';
import { mergeHtml } from './merge3.js';

const INLINE = /^(#text|B|STRONG|I|EM|U|S|STRIKE|A|SPAN|FONT|MARK|SUB|SUP|CODE|BR|IMG)$/;
const BLOCK = /^(P|H1|H2|H3|H4|UL|OL|BLOCKQUOTE|PRE|DIV|HR|TABLE)$/;
const newId = () => { const a = crypto.getRandomValues(new Uint8Array(6)); return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_'); };
export function fnv(str) { let x = 0x811c9dc5; for (let k = 0; k < str.length; k++) { x ^= str.charCodeAt(k); x = Math.imul(x, 0x01000193) >>> 0; } return x; }

export function liveDoc(it, page, { canEdit, onStatus, onPeers, onChange, onSaved, beforeJoin, onLost } = {}) {
  const cid = newId();
  let shadow = []; let index = new Map(); // entries { id, h, dead }
  const elOf = new Map(); let idOf = new WeakMap();
  let inflight = null; let pending = []; let seq = 0; let ver = 0; let sid = null;
  let live = false; let everLive = false; let alive = true; let joinT = 0; let ackT = 0; let status = '';
  const dirty = new Set(); let structural = false;
  const peers = new Map(); const offs = [];
  const setStatus = (s) => { if (s !== status) { status = s; onStatus && onStatus(s); } };

  // ---------- DOM helpers ----------
  const topOf = (n) => { while (n && n.parentNode !== page) n = n.parentNode; return n && n.parentNode === page ? n : null; };
  function mkEl(html) {
    const tp = document.createElement('template'); tp.innerHTML = sanitize(html);
    const nodes = [...tp.content.childNodes].filter((n) => n.nodeType === 1 || (n.nodeType === 3 && n.textContent.trim()));
    if (nodes.length === 1 && nodes[0].nodeType === 1) return nodes[0];
    const w = document.createElement(nodes.some((n) => n.nodeType === 1 && BLOCK.test(n.tagName)) ? 'div' : 'p');
    if (nodes.length) w.append(...nodes); else w.append(document.createElement('br'));
    return w;
  }
  const bind = (id, el) => { idOf.set(el, id); elOf.set(id, el); };
  const prevLiveEl = (i) => { for (let k = i - 1; k >= 0; k--) if (!shadow[k].dead && elOf.get(shadow[k].id)) return elOf.get(shadow[k].id); return null; };
  const placeEl = (entry, el) => { const i = shadow.indexOf(entry); const p = prevLiveEl(i); if (p) p.after(el); else page.prepend(el); bind(entry.id, el); };
  const textOff = (block, node, off) => { try { const r = document.createRange(); r.setStart(block, 0); r.setEnd(node, off); return r.toString().length; } catch { return 0; } };
  function posAt(block, n) {
    const w = document.createTreeWalker(block, NodeFilter.SHOW_TEXT); let x; let last = null;
    while ((x = w.nextNode())) { last = x; if (n <= x.length) return [x, n]; n -= x.length; }
    return last ? [last, last.length] : [block, 0];
  }
  function caret() {
    const s = getSelection(); if (!s || !s.rangeCount || !page.contains(s.anchorNode)) return null;
    const b = topOf(s.focusNode); if (!b) return null; const a = topOf(s.anchorNode);
    return { b: idOf.get(b) || null, o: textOff(b, s.focusNode, s.focusOffset), bt: b.textContent, ab: a && idOf.get(a), ao: a ? textOff(a, s.anchorNode, s.anchorOffset) : 0, at: a ? a.textContent : '' };
  }
  // Where a caret at offset o in `was` ends up in `now` (text changed around it): keep it relative to the unchanged
  // start or end of the paragraph, so text another person added before the caret pushes it along.
  function shift(was, now, o) {
    if (was === now || was == null) return o; let pre = 0; while (pre < was.length && pre < now.length && was[pre] === now[pre]) pre++;
    let suf = 0; while (suf < was.length - pre && suf < now.length - pre && was[was.length - 1 - suf] === now[now.length - 1 - suf]) suf++;
    if (o <= pre) return o; if (o >= was.length - suf) return now.length - (was.length - o); return Math.max(0, Math.min(now.length, now.length - (was.length - o)));
  }
  function restore(c) {
    if (!c || !c.b || document.activeElement !== page) return; const el = elOf.get(c.b); if (!el || !el.isConnected) return;
    c = { ...c, o: shift(c.bt, el.textContent, c.o) }; if (c.ab) { const ae0 = elOf.get(c.ab); if (ae0) c.ao = shift(c.at, ae0.textContent, c.ao); }
    try { const s = getSelection(); const [n, o] = posAt(el, c.o); const ae = c.ab && elOf.get(c.ab); const [an, ao] = ae && ae.isConnected ? posAt(ae, c.ao) : [n, o]; s.setBaseAndExtent(an, ao, n, o); } catch {}
  }

  // ---------- local changes ----------
  const mo = new MutationObserver((recs) => note(recs));
  function note(recs) { for (const r of recs) { if (r.target === page) structural = true; else { const b = topOf(r.target); if (b) dirty.add(b); else structural = true; } } }
  function normalize() { // loose text / inline nodes at the top level go into a paragraph, keeping the caret
    let run = null; const s = getSelection(); const keep = s && s.rangeCount ? [s.anchorNode, s.anchorOffset, s.focusNode, s.focusOffset] : null; let moved = false;
    for (const n of [...page.childNodes]) {
      if (n.nodeType === 3 && !n.textContent.trim() && !run) { if (!(keep && (keep[0] === n || keep[2] === n))) n.remove(); continue; }
      if (n.nodeType === 3 || (n.nodeType === 1 && INLINE.test(n.nodeName)) || n.nodeType !== 1) { if (n.nodeType === 8) { n.remove(); continue; } if (!run) { run = document.createElement('p'); n.before(run); } run.append(n); moved = true; continue; }
      run = null;
    }
    if (moved && keep && document.activeElement === page) { try { s.setBaseAndExtent(keep[0], keep[1], keep[2], keep[3]); } catch {} }
    if (moved) structural = true;
  }
  function diff() {
    if (!canEdit() || !everLive) return;
    note(mo.takeRecords()); if (!structural && !dirty.size) return;
    normalize(); note(mo.takeRecords());
    const ops = [];
    if (!structural) for (const el of dirty) { const e = el.parentNode === page && index.get(idOf.get(el)); if (!e || e.dead || elOf.get(e.id) !== el) { structural = true; break; } }
    if (structural) {
      const kids = [...page.children]; const ids = kids.map((el) => idOf.get(el) || null);
      const liveOld = shadow.filter((e) => !e.dead).map((e) => e.id); const pos = new Map(liveOld.map((id, k) => [id, k]));
      const seen = new Set();
      for (let k = 0; k < kids.length; k++) { const id = ids[k]; if (!id || !pos.has(id) || seen.has(id) || elOf.get(id) !== kids[k]) ids[k] = null; else seen.add(id); }
      // blocks that moved (drag and drop): keep the longest run in the old order, re-create the rest
      const seqIdx = []; for (let k = 0; k < kids.length; k++) if (ids[k]) seqIdx.push(k);
      const keepSet = lis(seqIdx.map((k) => pos.get(ids[k]))).map((j) => ids[seqIdx[j]]); const kept = new Set(keepSet);
      for (const id of liveOld) if (!kept.has(id)) { const e = index.get(id); e.dead = true; e.h = ''; elOf.delete(id); ops.push({ o: 'd', id }); }
      let prev = null;
      for (let k = 0; k < kids.length; k++) {
        const el = kids[k]; let id = ids[k];
        if (!id || !kept.has(id)) { id = newId(); bind(id, el); const e = { id, h: el.outerHTML, dead: false }; const at = prev === null ? 0 : shadow.indexOf(index.get(prev)) + 1; shadow.splice(at, 0, e); index.set(id, e); ops.push({ o: 'i', id, a: prev, h: e.h }); }
        else if (dirty.has(el)) { const e = index.get(id); const hh = el.outerHTML; if (hh !== e.h) { ops.push({ o: 's', id, h: hh, b: e.h }); e.h = hh; } }
        prev = id;
      }
    } else {
      for (const el of dirty) { const e = index.get(idOf.get(el)); const hh = el.outerHTML; if (hh !== e.h) { ops.push({ o: 's', id: e.id, h: hh, b: e.h }); e.h = hh; } }
    }
    dirty.clear(); structural = false;
    if (ops.length) { pending.push(...ops); pump(); }
  }
  function lis(a) { // indices of a longest increasing subsequence
    const tails = []; const prevI = new Array(a.length);
    for (let i = 0; i < a.length; i++) { let lo = 0, hi = tails.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[tails[m]] < a[i]) lo = m + 1; else hi = m; } prevI[i] = lo ? tails[lo - 1] : -1; tails[lo] = i; }
    const out = []; let k = tails.length ? tails[tails.length - 1] : -1; while (k >= 0) { out.push(k); k = prevI[k]; } return out.reverse();
  }
  function pump() {
    if (!live || inflight || !pending.length) { if (pending.length || inflight) setStatus(live ? 'saving' : status); return; }
    const ops = pending.length > 400 ? pending.splice(0, 400) : pending.splice(0); inflight = { seq: ++seq, ops };
    const msg = { t: 'dl_ops', item: it.id, cid, seq, ops }; setStatus('saving');
    if (JSON.stringify(msg).length < 60000) ws.send(msg);
    else api.post('/api/drive/item/' + it.id + '/live', { cid, seq, ops }, { quiet: true }).catch(() => {});
    clearTimeout(ackT); ackT = setTimeout(() => { if (inflight && inflight.seq === seq) rejoin(); }, 15000);
  }
  const unacked = () => (inflight ? inflight.ops : []).concat(pending);

  // The server merged our edit with someone else's (phase 13): take its result, and rebase anything typed since.
  function applyFixes(sent, fixes) {
    diff(); const c = caret();
    for (const f of fixes) {
      const e = index.get(f.id); if (!e) continue; const mine = [...sent].reverse().find((o) => o.id === f.id && o.h !== undefined); if (!mine) continue;
      const later = pending.filter((o) => o.id === f.id && o.o !== 'd');
      let now = f.h;
      if (later.length) { const local = e.h; now = mergeHtml(mine.h, f.h, local); if (now === null) now = local; const last = later[later.length - 1]; for (const o of later) if (o !== last) pending.splice(pending.indexOf(o), 1); last.b = f.h; last.h = now; if (now === f.h) pending.splice(pending.indexOf(last), 1); }
      if (e.dead) continue; e.h = now; const old = elOf.get(f.id); if (old && old.isConnected) { const el = mkEl(now); old.replaceWith(el); bind(f.id, el); }
    }
    mo.takeRecords(); restore(c); changedRemote();
  }

  // ---------- remote changes ----------
  function applyOne(op, skip, ownIns) {
    let e = index.get(op.id);
    if (op.o === 'd') { if (!e || skip.has(op.id)) return; if (!e.dead) { e.dead = true; e.h = ''; const el = elOf.get(op.id); if (el) el.remove(); elOf.delete(op.id); } return; }
    if (e || op.o === 's') {
      if (!e) return 'bad'; if (skip.has(op.id)) return;
      e.h = op.h; const el = mkEl(op.h); const old = elOf.get(op.id);
      if (!e.dead && old && old.isConnected) { old.replaceWith(el); bind(op.id, el); } else { e.dead = false; placeEl(e, el); }
      return;
    }
    let at = 0; if (op.a != null) { const a = index.get(op.a); if (!a) return 'bad'; at = shadow.indexOf(a) + 1; }
    while (at < shadow.length && ownIns.has(shadow[at].id)) at++;
    e = { id: op.id, h: op.h, dead: false }; shadow.splice(at, 0, e); index.set(e.id, e); placeEl(e, mkEl(op.h));
  }
  function remote(ops) {
    diff(); const c = caret(); const un = unacked();
    const skip = new Set(un.map((o) => o.id)); const ownIns = new Set(un.filter((o) => o.o === 'i').map((o) => o.id));
    let bad = false; for (const op of ops) if (applyOne(op, skip, ownIns) === 'bad') bad = true;
    mo.takeRecords(); restore(c); changedRemote();
    if (bad) ws.send({ t: 'dl_resync', item: it.id, cid });
  }
  const changedRemote = () => { page.dispatchEvent(new Event('nx-remote')); onChange && onChange(); drawCarets(); };

  function applyState(m) {
    diff(); const c = caret(); let un = unacked(); inflight = null; pending = []; clearTimeout(ackT);
    const fresh = m.blocks.map((b) => ({ id: b.id, h: b.h || '', dead: !!b.dead }));
    if (sid && m.sid !== sid && un.length) un = remap(un, fresh, c);
    shadow = fresh; index = new Map(shadow.map((e) => [e.id, e])); elOf.clear(); idOf = new WeakMap();
    sid = m.sid; ver = m.ver;
    page.replaceChildren(); for (const e of shadow) if (!e.dead) { const el = mkEl(e.h); page.append(el); bind(e.id, el); }
    // our changes that the server has not confirmed go on top again (re-sending is harmless: inserts of an id that
    // already exists are treated as edits)
    const none = new Set(); const mine = new Set(un.filter((o) => o.o === 'i').map((o) => o.id));
    for (const op of un) { if (op.o === 'i' && !index.get(op.id)) { let at = 0; if (op.a != null) { const a = index.get(op.a); at = a ? shadow.indexOf(a) + 1 : shadow.length; } const e = { id: op.id, h: op.h, dead: false }; shadow.splice(at, 0, e); index.set(e.id, e); placeEl(e, mkEl(op.h)); } else applyOne(op.o === 'i' ? { ...op, o: 's' } : op, none, mine); }
    mo.takeRecords(); dirty.clear(); structural = false;
    peers.clear(); for (const p of m.peers || []) peers.set(p.cid, p); onPeers && onPeers([...peers.values()]);
    const wasLive = everLive; live = true; everLive = true; setStatus('live');
    if (!m.edit && canEdit()) { onLost && onLost('read_only'); }
    restore(c); changedRemote(); pending = un; pump(); if (!pending.length && !inflight) setStatus('live');
    return wasLive;
  }
  // The server restarted (or the document was saved the old way): block ids are new. Match our old blocks to the new
  // ones by content so unconfirmed changes still land in the right place.
  function remap(un, fresh, c) {
    const byHtml = new Map(); for (const e of fresh) if (!e.dead) { const l = byHtml.get(e.h) || []; l.push(e.id); byHtml.set(e.h, l); }
    const map = new Map(); const order = shadow.map((e) => e.id); const touched = new Set(un.map((o) => o.id));
    for (const e of shadow) if (!e.dead && !touched.has(e.id)) { const l = byHtml.get(e.h); if (l && l.length) map.set(e.id, l.shift()); }
    const prevMapped = (id) => { for (let k = order.indexOf(id) - 1; k >= 0; k--) if (map.has(order[k])) return map.get(order[k]); return null; };
    // a block we changed has different content now: take the unmatched server block in the same place
    const used = new Set(map.values()); const freshLive = fresh.filter((e) => !e.dead).map((e) => e.id); const mineIns = new Set(un.filter((o) => o.o === 'i').map((o) => o.id));
    for (const id of order) {
      if (map.has(id) || mineIns.has(id) || !touched.has(id)) continue;
      const p = prevMapped(id); const k = p == null ? 0 : freshLive.indexOf(p) + 1;
      if (k < freshLive.length && !used.has(freshLive[k])) { map.set(id, freshLive[k]); used.add(freshLive[k]); }
    }
    const out = [];
    for (const op of un) {
      if (op.o === 'd') { if (map.has(op.id)) out.push({ o: 'd', id: map.get(op.id) }); continue; }
      if (op.o === 's' && map.has(op.id)) { out.push({ o: 's', id: map.get(op.id), h: op.h }); continue; }
      if (op.o === 's' && mineIns.has(op.id)) { out.push(op); continue; }
      const a = op.o === 'i' ? (op.a == null ? null : map.get(op.a) || (out.some((x) => x.id === op.a) ? op.a : prevMapped(op.a))) : prevMapped(op.id);
      const nid = op.o === 'i' ? op.id : newId(); if (op.o === 's') map.set(op.id, nid);
      out.push({ o: 'i', id: nid, a, h: op.h });
    }
    if (c && c.b && map.has(c.b)) c.b = map.get(c.b); if (c && c.ab && map.has(c.ab)) c.ab = map.get(c.ab);
    return out;
  }

  // ---------- presence and remote carets ----------
  const layer = h('div.dl-layer', { 'aria-hidden': 'true' });
  function drawCarets() {
    const host = page.parentNode; if (!host) return; if (layer.parentNode !== host) host.append(layer);
    const base = host.getBoundingClientRect(); const out = [];
    for (const p of peers.values()) {
      const el = p.b && elOf.get(p.b); if (!el || !el.isConnected) continue;
      let rects = [];
      try {
        const r = document.createRange(); const [n, o] = posAt(el, p.o); r.setStart(n, o); r.collapse(true); let cr = r.getClientRects()[0];
        if (!cr) cr = el.getBoundingClientRect();
        if (p.e !== undefined && p.e !== p.o) { const [n2, o2] = posAt(el, p.e); const s = document.createRange(); if (p.e > p.o) { s.setStart(n, o); s.setEnd(n2, o2); } else { s.setStart(n2, o2); s.setEnd(n, o); } rects = [...s.getClientRects()]; }
        const x = cr.left - base.left + host.scrollLeft; const y = cr.top - base.top + host.scrollTop; const hh = cr.height || 20;
        for (const q of rects) out.push(h('i.dl-sel', { style: `left:${q.left - base.left + host.scrollLeft}px;top:${q.top - base.top + host.scrollTop}px;width:${q.width}px;height:${q.height}px;background:${p.color}` }));
        out.push(h('i.dl-caret', { style: `left:${x}px;top:${y}px;height:${hh}px;--c:${p.color}` }, h('span.dl-flag', p.displayName)));
      } catch {}
    }
    layer.replaceChildren(...out);
  }
  let curT = 0; let lastCur = '';
  function sendCursor() {
    if (!live) return; clearTimeout(curT);
    curT = setTimeout(() => {
      if (canEdit()) diff(); const s = getSelection(); let b = null, o = 0, e = 0;
      if (s && s.rangeCount && page.contains(s.focusNode)) { const el = topOf(s.focusNode); b = el && idOf.get(el); if (b) { o = textOff(el, s.focusNode, s.focusOffset); e = topOf(s.anchorNode) === el ? textOff(el, s.anchorNode, s.anchorOffset) : o; } }
      const k = b + ':' + o + ':' + e; if (k === lastCur) return; lastCur = k; ws.send({ t: 'dl_cur', item: it.id, cid, b, o, e });
    }, 120);
  }

  // ---------- connection ----------
  async function join() {
    if (!alive) return; if (!everLive && beforeJoin) { try { await beforeJoin(); } catch {} }
    setStatus(everLive ? 'reconnecting' : 'connecting'); ws.send({ t: 'dl_join', item: it.id, cid });
    clearTimeout(joinT); joinT = setTimeout(() => { if (!live && alive) setStatus(everLive ? 'offline' : 'solo'); }, 6000);
  }
  function rejoin() { live = false; join(); }
  const mineMsg = (m) => m.item === it.id && (!m.cid || m.cid === cid);
  offs.push(
    bus.on('ws:open', () => { live = false; join(); }),
    bus.on('ws:close', () => { live = false; if (everLive) setStatus('offline'); peers.clear(); onPeers && onPeers([]); drawCarets(); }),
    bus.on('ws:dl_state', (m) => { if (mineMsg(m)) { clearTimeout(joinT); applyState(m); } }),
    bus.on('ws:dl_ops', (m) => { if (m.item !== it.id || !live) return; ver = m.ver; remote(m.ops || []); }),
    bus.on('ws:dl_ack', (m) => {
      if (!mineMsg(m) || !inflight || m.seq !== inflight.seq) return; clearTimeout(ackT);
      if (m.error === 'rate_limited') { pending = inflight.ops.concat(pending); inflight = null; setTimeout(pump, 1200); return; }
      if (m.error === 'read_only') { inflight = null; pending = []; onLost && onLost('read_only'); ws.send({ t: 'dl_resync', item: it.id, cid }); return; }
      if (m.error) { inflight = null; pending = []; onLost && onLost(m.error); ws.send({ t: 'dl_resync', item: it.id, cid }); return; }
      if (m.fixes && m.fixes.length) applyFixes(inflight.ops, m.fixes);
      ver = m.ver; inflight = null; if (m.bad) ws.send({ t: 'dl_resync', item: it.id, cid });
      if (pending.length) pump(); else { setStatus('live'); onSaved && onSaved(); }
    }),
    bus.on('ws:dl_peer', (m) => { if (m.item !== it.id) return; if (m.kind === 'join' && m.peer) peers.set(m.peer.cid, m.peer); else peers.delete(m.cid); onPeers && onPeers([...peers.values()]); drawCarets(); }),
    bus.on('ws:dl_cur', (m) => { if (m.item !== it.id) return; const p = peers.get(m.cid); if (!p) return; p.b = m.b; p.o = m.o; p.e = m.e; drawCarets(); }),
    bus.on('ws:dl_reset', (m) => { if (m.item === it.id) rejoin(); }),
    bus.on('ws:dl_error', (m) => { if (!mineMsg(m)) return; if (m.error === 'not_joined') rejoin(); else if (m.error === 'no_item') { alive = false; live = false; setStatus('solo'); onLost && onLost('no_item'); } }),
  );
  mo.observe(page, { childList: true, subtree: true, characterData: true, attributes: true });
  let inT = 0; const onInput = () => { if (!everLive) return; if (!inT) inT = setTimeout(() => { inT = 0; diff(); }, 150); };
  page.addEventListener('input', onInput);
  document.addEventListener('selectionchange', sendCursor);
  const onLayout = () => drawCarets(); window.addEventListener('resize', onLayout);
  const chk = setInterval(() => { if (!live || inflight || pending.length || dirty.size || structural) return; ws.send({ t: 'dl_chk', item: it.id, cid, ver, h: fnv(shadow.filter((e) => !e.dead).map((e) => e.id + ':' + e.h).join('\n')) }); }, 20000);
  if (S.ws) join(); else { setStatus('connecting'); ws.connect(); joinT = setTimeout(() => { if (!live) setStatus('solo'); }, 6000); }

  return {
    get everLive() { return everLive; }, get live() { return live; }, get status() { return status; },
    get unsent() { diff(); return unacked().length; },
    changed() { onInput(); },
    flush() { if (everLive) diff(); },
    destroy() {
      if (everLive && live) { diff(); if (pending.length) { const ops = pending.splice(0); const msg = { t: 'dl_ops', item: it.id, cid, seq: ++seq, ops }; if (JSON.stringify(msg).length < 60000) ws.send(msg); else api.post('/api/drive/item/' + it.id + '/live', { cid, seq, ops }, { quiet: true }).catch(() => {}); } ws.send({ t: 'dl_leave', item: it.id, cid }); }
      alive = false; live = false; mo.disconnect(); offs.forEach((f) => f()); clearInterval(chk); clearTimeout(joinT); clearTimeout(ackT); clearTimeout(curT); clearTimeout(inT);
      page.removeEventListener('input', onInput); document.removeEventListener('selectionchange', sendCursor); window.removeEventListener('resize', onLayout); layer.remove();
    },
    html: () => shadow.filter((e) => !e.dead).map((e) => e.h).join(''),
    redraw: drawCarets,
    _debug: () => ({ shadow, inflight, pending, ver, sid, live }),
  };
}

// Little stack of the people editing with you.
export function peersEl() {
  const el = h('div.dl-peers');
  el.set = (list) => {
    el.replaceChildren(...list.slice(0, 6).map((p) => h('span.dl-peer', { title: p.displayName + (p.edit ? '' : ' · ' + t('viewing')), style: '--c:' + p.color }, p.avatar ? h('img', { src: p.avatar, alt: '' }) : (p.displayName || '?').slice(0, 1).toUpperCase())), ...(list.length > 6 ? [h('span.dl-peer.more', '+' + (list.length - 6))] : []));
  };
  return el;
}
