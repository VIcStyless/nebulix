'use strict';
// Nebulix 3.0 — multiplayer rooms for Hub games (Game API: Nebulix.room.join / send / leave).
// A room is "<hub item>:<room name>"; up to 16 players. The server only relays small JSON messages between the
// players of the same room (it never runs game code). Messages from the game reach the server through the Hub page's
// WebSocket, so every message is tied to a logged-in account; rate limited per player.
const { S, publicUser } = require('./state');
const { Limiter } = require('./util');

const MAX = 16;
const rooms = new Map(); // key -> Map(uid -> conn)
const msgLim = new Limiter(30, 1000); const joinLim = new Limiter(10, 10000);
const who = (u) => { const p = publicUser(u); return { id: p.id, username: p.username, displayName: p.displayName || p.username }; };
const items = () => S.store.table('hubitems');
const cleanName = (v) => String(v || 'main').replace(/[^\w.-]/g, '').slice(0, 32) || 'main';

function leave(conn, u) {
  const key = conn.data.hr; if (!key) return; conn.data.hr = null; const room = rooms.get(key); if (!room) return;
  if (room.get(u.id) === conn) room.delete(u.id);
  const [item, name] = key.split(':');
  for (const [, c] of room) c.send({ t: 'hr_peer', item, room: name, kind: 'leave', user: who(u), count: room.size });
  if (!room.size) rooms.delete(key);
}
function onMessage(conn, u, m) {
  if (m.t === 'hr_join') {
    if (!joinLim.hit(u.id)) return conn.send({ t: 'hr_error', item: m.item, error: 'rate_limited' });
    const it = items()[String(m.item || '')]; if (!it || !it.files || (it.public === false && it.owner !== u.id)) return conn.send({ t: 'hr_error', item: m.item, error: 'no_item' });
    const name = cleanName(m.room); const key = it.id + ':' + name; leave(conn, u);
    const room = rooms.get(key) || new Map(); if (room.size >= MAX && !room.has(u.id)) return conn.send({ t: 'hr_error', item: it.id, error: 'room_full' });
    const prev = room.get(u.id); if (prev && prev !== conn) { prev.data.hr = null; prev.send({ t: 'hr_error', item: it.id, error: 'joined_elsewhere' }); }
    room.set(u.id, conn); rooms.set(key, room); conn.data.hr = key;
    const players = [...room.keys()].map((id) => S.users[id]).filter(Boolean).map(who);
    conn.send({ t: 'hr_joined', item: it.id, room: name, me: who(u), players });
    for (const [id, c] of room) if (id !== u.id) c.send({ t: 'hr_peer', item: it.id, room: name, kind: 'join', user: who(u), count: room.size });
    return;
  }
  if (m.t === 'hr_leave') return leave(conn, u);
  if (m.t === 'hr_msg') {
    const key = conn.data.hr; if (!key || !key.startsWith(String(m.item || '') + ':')) return; if (!msgLim.hit(u.id)) return;
    let data; try { data = JSON.stringify(m.data === undefined ? null : m.data); } catch { return; } if (data.length > 8192) return conn.send({ t: 'hr_error', item: m.item, error: 'too_big' });
    const room = rooms.get(key); if (!room) return; const [item, name] = key.split(':'); const out = { t: 'hr_msg', item, room: name, from: u.id, data: JSON.parse(data) };
    if (m.to) { const c = room.get(String(m.to)); if (c) c.send(out); return; }
    for (const [id, c] of room) if (id !== u.id) c.send(out);
  }
}
const stats = () => ({ rooms: rooms.size, players: [...rooms.values()].reduce((a, r) => a + r.size, 0) });
module.exports = { onMessage, leave, stats };
