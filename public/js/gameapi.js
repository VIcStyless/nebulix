// Nebulix 3.0 Game API — the page side. Hub games call window.Nebulix.submitScore(n, label?), Nebulix.leaderboard()
// and Nebulix.me() (injected by server/hubshim.js); the request arrives here by postMessage from that game's frame only,
// and the answer goes back to the same frame. Returns a function that stops listening.
import { api, ws } from './api.js';
import { S, bus } from './state.js';
import { toast, modal } from './ui.js';
import { h } from './util.js';
import { t } from './i18n.js';

export function gameApi(frame, itemId, { onBoard } = {}) {
  const reply = (req, data) => { if (!req) return; try { frame.contentWindow.postMessage({ nxHubRes: 1, req, data }, '*'); } catch {} };
  const emit = (type, payload) => { try { frame.contentWindow.postMessage({ nxHubEvent: 1, type, payload }, '*'); } catch {} };
  // multiplayer rooms: relay WebSocket events for this game into its frame
  let inRoom = false; let joinWait = null;
  const offs = [
    bus.on('ws:hr_joined', (m) => { if (m.item !== itemId) return; inRoom = true; if (joinWait) { joinWait(m); joinWait = null; } emit('joined', { room: m.room, me: m.me, players: m.players }); }),
    bus.on('ws:hr_peer', (m) => { if (m.item === itemId) emit(m.kind, { user: m.user, count: m.count }); }),
    bus.on('ws:hr_msg', (m) => { if (m.item === itemId) emit('message', { from: m.from, data: m.data }); }),
    bus.on('ws:hr_error', (m) => { if (m.item !== itemId && m.item) return; if (joinWait) { joinWait({ error: m.error }); joinWait = null; } emit('error', { error: m.error }); }),
  ];
  const onMsg = async (e) => {
    if (!frame.isConnected) { stop(); return; }
    const d = e.data; if (e.source !== frame.contentWindow || !d || d.nxHubApi !== 1) return;
    try {
      if (d.op === 'score') { const r = await api.post(`/api/hub/${itemId}/board`, { score: d.score, label: d.label }, { quiet: true }); if (r.pb) toast(t('New best in this game: {s} (rank #{r})', { s: r.best, r: r.rank }), 'good', 2500); reply(d.req, r); if (onBoard) onBoard(); }
      else if (d.op === 'board') reply(d.req, await api.get(`/api/hub/${itemId}/board`, { quiet: true }));
      else if (d.op === 'unlock') { const r = await api.post(`/api/hub/${itemId}/ach`, { id: d.id, title: d.title, desc: d.desc }, { quiet: true }); if (r.unlocked) { toast('🏅 ' + t('Achievement unlocked: {a}', { a: r.achievement.title }), 'good', 3500); try { (await import('./sfx.js')).sfx.big(); } catch {} } reply(d.req, r); if (onBoard) onBoard(); }
      else if (d.op === 'achs') reply(d.req, await api.get(`/api/hub/${itemId}/ach`, { quiet: true }));
      else if (d.op === 'room_join') { const r = await new Promise((res) => { joinWait = res; ws.send({ t: 'hr_join', item: itemId, room: d.room }); setTimeout(() => { if (joinWait === res) { joinWait = null; res({ error: 'timeout' }); } }, 8000); }); reply(d.req, r); }
      else if (d.op === 'room_send') { if (inRoom) ws.send({ t: 'hr_msg', item: itemId, data: d.data, to: d.to || undefined }); }
      else if (d.op === 'room_leave') { if (inRoom) { ws.send({ t: 'hr_leave' }); inRoom = false; } }
      else if (d.op === 'me') reply(d.req, S.me ? { username: S.me.username, displayName: S.me.displayName || S.me.username, lang: document.documentElement.lang || 'es' } : null);
      else reply(d.req, null);
    } catch { reply(d.req, null); }
  };
  function stop() { removeEventListener('message', onMsg); clearInterval(watch); offs.forEach((o) => { try { o(); } catch {} }); if (inRoom) { inRoom = false; try { ws.send({ t: 'hr_leave' }); } catch {} } }
  const watch = setInterval(() => { if (!frame.isConnected) stop(); }, 3000); // left the page: leave the room too
  addEventListener('message', onMsg);
  return stop;
}

// ---------- app permissions (nebulix.json) ----------
export const PERM_INFO = { camera: ['📷', 'Camera'], microphone: ['🎤', 'Microphone'], geolocation: ['📍', 'Location'], midi: ['🎹', 'MIDI devices'] };
export const allowExtra = (it) => (it.granted || []).filter((p) => PERM_INFO[p]).map((p) => '; ' + p).join('');
export const missingPerms = (it) => (it.perms || []).filter((p) => !(it.granted || []).includes(p));
// asks the player; resolves to the granted list (the browser still asks again for camera/microphone itself)
export async function askPerms(it) {
  const list = it.perms || []; if (!list.length) return [];
  const r = await modal({ title: t('“{n}” asks for permissions', { n: it.title }), body: h('div.col.gap', h('p.small.muted', t('This game or app wants to use the following. It runs isolated from your account either way; you can change this later.')),
    h('ul.gp-list', list.map((p) => h('li', h('span', PERM_INFO[p][0]), h('b', t(PERM_INFO[p][1])))))), actions: [{ label: t('Not now'), value: false }, { label: t('Allow'), kind: 'primary', value: true }] });
  try { const x = await api.post(`/api/hub/${it.id}/perms`, { grant: r ? list : [] }); it.granted = x.granted; } catch { /* keep the old grant */ }
  return it.granted || [];
}
