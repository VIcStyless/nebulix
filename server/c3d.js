'use strict';
// 3D casino lobby: who is in it, where they stand and what they are playing. In memory only; positions are
// relayed to everyone in the lobby a few times per second. Bets themselves still go through the normal casino API.
const { S, hub, isPro } = require('./state');
const { now, Limiter } = require('./util');

const MAX = 60; const B = 30; // lobby half-size (units) — positions are clamped to it
const room = new Map(); // uid -> { conn, x, z, ry, w, game, say, sayAt, joined }
const moveLim = new Limiter(40, 2000); const sayLim = new Limiter(6, 10000);
let dirty = new Set(); let timer = null;
const num = (v, lo, hi) => { v = Number(v); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0; };
const GAMES = new Set(['slots', 'roulette', 'blackjack', 'crash', 'plinko', 'mines', 'dice', 'coinflip', 'jackpot', 'horses', 'bar', 'booths', '']);

function who(u) { return { id: u.id, username: u.username, displayName: u.displayName || u.username, pro: isPro(u), av3: u.av3 || null, role: u.role }; }
function state(id, p) { return { id, x: Math.round(p.x * 100) / 100, z: Math.round(p.z * 100) / 100, ry: Math.round(p.ry * 100) / 100, w: p.w ? 1 : 0, g: p.game || '' }; }
function others(uid) { return [...room.keys()].filter((id) => id !== uid); }
function tick() {
  if (!dirty.size) return;
  const list = [...dirty].filter((id) => room.has(id)).map((id) => state(id, room.get(id))); dirty = new Set();
  if (list.length) for (const [id, p] of room) { const l = list.filter((x) => x.id !== id); if (l.length) p.conn.send({ t: 'c3d_pos', list: l }); }
}
function join(conn, u) {
  if (room.size >= MAX && !room.has(u.id)) { conn.send({ t: 'c3d_full' }); return; }
  const prev = room.get(u.id); if (prev && prev.conn !== conn) prev.conn.send({ t: 'c3d_kicked' });
  const p = { conn, x: (Math.random() - 0.5) * 4, z: 12 + Math.random() * 2, ry: Math.PI, w: 0, game: '', joined: now() };
  room.set(u.id, p); conn.data.c3d = true;
  conn.send({ t: 'c3d_hello', me: state(u.id, p), players: others(u.id).map((id) => Object.assign(who(S.users[id]), state(id, room.get(id)))) });
  for (const id of others(u.id)) room.get(id).conn.send({ t: 'c3d_join', p: Object.assign(who(u), state(u.id, p)) });
  if (!timer) timer = setInterval(tick, 120);
}
function leave(conn, u) {
  const p = room.get(u.id); if (!p || p.conn !== conn) return;
  room.delete(u.id); conn.data.c3d = false;
  for (const [, q] of room) q.conn.send({ t: 'c3d_leave', id: u.id });
  if (!room.size && timer) { clearInterval(timer); timer = null; }
}
function onMessage(conn, u, m) {
  if (m.t === 'c3d_join') return join(conn, u);
  if (m.t === 'c3d_leave') return leave(conn, u);
  const p = room.get(u.id); if (!p || p.conn !== conn) return;
  if (m.t === 'c3d_move') { if (!moveLim.hit(u.id)) return; p.x = num(m.x, -B, B); p.z = num(m.z, -B, B); p.ry = num(m.ry, -10, 10); p.w = !!m.w; dirty.add(u.id); return; }
  if (m.t === 'c3d_at') { const g = String(m.g || ''); if (!GAMES.has(g)) return; p.game = g; dirty.add(u.id); return; }
  if (m.t === 'c3d_say' || m.t === 'c3d_emote') {
    if (!sayLim.hit(u.id)) return;
    const text = m.t === 'c3d_emote' ? String(m.e || '').slice(0, 8) : String(m.text || '').replace(/[\u0000-\u001f‪-‮⁦-⁩]/g, '').trim().slice(0, 90);
    if (!text) return;
    for (const [, q] of room) q.conn.send({ t: m.t, id: u.id, text });
  }
}
// Called by the casino after every settled bet so people around can see wins.
function played(u, net, bet) {
  const p = room.get(u.id); if (!p) return;
  for (const [, q] of room) q.conn.send({ t: 'c3d_fx', id: u.id, g: p.game || '', net, bet });
}
const count = () => room.size;
const playersAt = () => [...room.entries()].map(([id, p]) => ({ id, g: p.game }));
module.exports = { onMessage, leave, played, count, playersAt };
