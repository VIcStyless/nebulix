// Nebulix 3.0 — live co-editing for Sheets and Slides (protocol in server/objlive.js). The document is a map of keyed
// units (cells, slides, the slide order, settings). After every local change the map is diffed against the last
// state we know the server has; changed units are sent as one batch at a time. Remote changes to units we still have
// unconfirmed edits for are skipped (ours reach the server later and win), so every copy converges.
import { api, ws } from './api.js';
import { S, bus } from './state.js';
import { mergeJson } from './merge3.js';

// ---- the same split / assemble rules as server/objlive.js ----
export function split(kind, data) {
  const m = new Map(); data = data || {};
  for (const [k, v] of Object.entries(data)) {
    if (kind === 'sheet' && k === 'cells') { for (const [ref, c] of Object.entries(v || {})) if (/^[A-Z]{1,3}\d{1,5}$/.test(ref)) m.set('c:' + ref, JSON.stringify(c)); }
    else if (kind === 'slides' && k === 'slides') { const ids = []; for (const s of v || []) { if (!s || !s.id) continue; ids.push(String(s.id)); m.set('s:' + s.id, JSON.stringify(s)); } m.set('o:', JSON.stringify(ids)); }
    else if (/^[\w-]{1,40}$/.test(k)) m.set('m:' + k, JSON.stringify(v));
  }
  return m;
}
export function assemble(kind, m) {
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
function fnv(str) { let x = 0x811c9dc5; for (let k = 0; k < str.length; k++) { x ^= str.charCodeAt(k); x = Math.imul(x, 0x01000193) >>> 0; } return x; }
const newId = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(6)))).replace(/\+/g, '-').replace(/\//g, '_');

export function liveObj(it, { kind, getData, setData, canEdit, onStatus, onPeers, onSaved, onLost, beforeJoin } = {}) {
  const cid = newId(); let shadow = new Map(); let inflight = null; let pending = []; let seq = 0; let ver = 0;
  let live = false; let everLive = false; let alive = true; let status = ''; let joinT = 0; let ackT = 0; let diffT = 0;
  const peers = new Map(); const offs = [];
  const setStatus = (s) => { if (s !== status) { status = s; onStatus && onStatus(s); } };
  const unacked = () => (inflight ? inflight.ops : []).concat(pending);
  function diff() {
    if (!everLive || !canEdit()) return; clearTimeout(diffT); diffT = 0;
    const cur = split(kind, getData()); const ops = [];
    for (const [k, v] of cur) if (shadow.get(k) !== v) { ops.push({ k, v, b: shadow.has(k) ? shadow.get(k) : null }); shadow.set(k, v); }
    for (const k of [...shadow.keys()]) if (!cur.has(k)) { ops.push({ k, v: null }); shadow.delete(k); }
    if (ops.length) { pending.push(...ops); pump(); }
  }
  function pump() {
    if (!live || inflight || !pending.length) return; const ops = pending.splice(0, 2000); inflight = { seq: ++seq, ops };
    const msg = { t: 'ol_ops', item: it.id, cid, seq, ops }; setStatus('saving');
    if (JSON.stringify(msg).length < 60000) ws.send(msg); else api.post('/api/drive/item/' + it.id + '/olive', { cid, seq, ops }, { quiet: true }).catch(() => {});
    clearTimeout(ackT); ackT = setTimeout(() => { if (inflight && inflight.seq === seq) { live = false; join(); } }, 15000);
  }
  function show(changed) { setData(assemble(kind, shadow), changed); }
  function applyState(m) {
    diff(); const un = unacked(); inflight = null; pending = []; clearTimeout(ackT);
    shadow = new Map(m.units); ver = m.ver;
    for (const op of un) { if (op.v === null) shadow.delete(op.k); else shadow.set(op.k, op.v); } // our unconfirmed changes go on top again
    peers.clear(); for (const p of m.peers || []) peers.set(p.cid, p); onPeers && onPeers([...peers.values()]);
    live = true; everLive = true; if (!m.edit && canEdit()) onLost && onLost('read_only');
    show(null); pending = un; pump(); if (!pending.length) setStatus('live');
  }
  function remote(ops) {
    diff(); const skip = new Set(unacked().map((o) => o.k)); const changed = new Set();
    for (const op of ops) { if (skip.has(op.k)) continue; if (op.v === null) shadow.delete(op.k); else shadow.set(op.k, op.v); changed.add(op.k); }
    if (changed.size) show(changed);
  }
  function join() {
    if (!alive) return;
    Promise.resolve(!everLive && beforeJoin ? beforeJoin() : null).catch(() => {}).then(() => {
      setStatus(everLive ? 'reconnecting' : 'connecting'); ws.send({ t: 'ol_join', item: it.id, cid });
      clearTimeout(joinT); joinT = setTimeout(() => { if (!live && alive) setStatus(everLive ? 'offline' : 'solo'); }, 6000);
    });
  }
  const mine = (m) => m.item === it.id && (!m.cid || m.cid === cid);
  offs.push(
    bus.on('ws:open', () => { live = false; join(); }),
    bus.on('ws:close', () => { live = false; if (everLive) setStatus('offline'); peers.clear(); onPeers && onPeers([]); }),
    bus.on('ws:ol_state', (m) => { if (mine(m)) { clearTimeout(joinT); applyState(m); } }),
    bus.on('ws:ol_ops', (m) => { if (m.item === it.id && live) { ver = m.ver; remote(m.ops || []); } }),
    bus.on('ws:ol_ack', (m) => {
      if (!mine(m) || !inflight || m.seq !== inflight.seq) return; clearTimeout(ackT);
      if (m.error === 'rate_limited') { pending = inflight.ops.concat(pending); inflight = null; setTimeout(pump, 1200); return; }
      if (m.error) { inflight = null; pending = []; onLost && onLost(m.error); ws.send({ t: 'ol_resync', item: it.id, cid }); return; }
      if (m.fixes && m.fixes.length) { // the server merged our change with someone else's (phase 13)
        diff(); const changed = new Set();
        for (const f of m.fixes) {
          const mine = [...inflight.ops].reverse().find((o) => o.k === f.k); if (!mine) continue; const later = pending.filter((o) => o.k === f.k);
          let now = f.v;
          if (later.length && later[later.length - 1].v !== null) { const local = shadow.get(f.k); try { now = JSON.stringify(mergeJson(JSON.parse(mine.v), JSON.parse(f.v), JSON.parse(local))); } catch { now = local; } const last = later[later.length - 1]; for (const o of later) if (o !== last) pending.splice(pending.indexOf(o), 1); last.b = f.v; last.v = now; if (now === f.v) pending.splice(pending.indexOf(last), 1); }
          else if (later.length) continue;
          shadow.set(f.k, now); changed.add(f.k);
        }
        if (changed.size) show(changed);
      }
      ver = m.ver; inflight = null; if (m.bad) ws.send({ t: 'ol_resync', item: it.id, cid });
      if (pending.length) pump(); else { setStatus('live'); onSaved && onSaved(); }
    }),
    bus.on('ws:ol_peer', (m) => { if (m.item !== it.id) return; if (m.kind === 'join' && m.peer) peers.set(m.peer.cid, m.peer); else peers.delete(m.cid); onPeers && onPeers([...peers.values()]); }),
    bus.on('ws:ol_cur', (m) => { if (m.item !== it.id) return; const p = peers.get(m.cid); if (p) { p.at = m.at; onPeers && onPeers([...peers.values()]); } }),
    bus.on('ws:ol_reset', (m) => { if (m.item === it.id) { live = false; join(); } }),
    bus.on('ws:ol_error', (m) => { if (!mine(m)) return; if (m.error === 'not_joined') { live = false; join(); } else if (m.error === 'no_item') { alive = false; setStatus('solo'); } }),
  );
  const chk = setInterval(() => { if (!live || inflight || pending.length || diffT) return; ws.send({ t: 'ol_chk', item: it.id, cid, ver, h: fnv([...shadow].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => k + '=' + v).join('\n')) }); }, 20000);
  if (S.ws) join(); else { setStatus('connecting'); ws.connect(); joinT = setTimeout(() => { if (!live) setStatus('solo'); }, 6000); }
  let lastAt = null;
  return {
    get everLive() { return everLive; }, get live() { return live; },
    get unsent() { diff(); return unacked().length; },
    changed() { if (!everLive) return; if (!diffT) diffT = setTimeout(diff, 150); },
    cursor(at) { if (!live || at === lastAt) return; lastAt = at; ws.send({ t: 'ol_cur', item: it.id, cid, at }); },
    destroy() {
      if (everLive && live) { diff(); if (pending.length) { const ops = pending.splice(0); const msg = { t: 'ol_ops', item: it.id, cid, seq: ++seq, ops }; if (JSON.stringify(msg).length < 60000) ws.send(msg); else api.post('/api/drive/item/' + it.id + '/olive', { cid, seq, ops }, { quiet: true }).catch(() => {}); } ws.send({ t: 'ol_leave', item: it.id, cid }); }
      alive = false; live = false; offs.forEach((f) => f()); clearInterval(chk); clearTimeout(joinT); clearTimeout(ackT); clearTimeout(diffT);
    },
  };
}
