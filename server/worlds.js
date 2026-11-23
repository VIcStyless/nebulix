'use strict';
// Nebula Worlds: original 3D multiplayer worlds — obby (parkour) courses and hangouts. Everyone in the same world
// sees each other move and chat (relayed over the WebSocket, in memory only). Finishing a course pays coins once a
// day per course and records your best time. Gear (speed, jump, double jump, glider, trails) is bought with coins.
const { S, publicUser, isPro, isStaff } = require('./state');
const { dayKey, Limiter, HttpError, rid, now } = require('./util');

// id, [en, es], icon, kind, min finish ms (anti-cheat), daily reward, pass price (0 = free)
const WORLDS = [
  ['tower', ['Nebula Tower', 'Torre Nébula'], '🗼', 'obby', 25000, 400, 0, 'easy'],
  ['neon', ['Neon Run', 'Carrera Neón'], '🌈', 'obby', 35000, 700, 0, 'medium'],
  ['void', ['Void Climb', 'Escalada del Vacío'], '🌌', 'obby', 45000, 1200, 0, 'hard'],
  ['lava', ['Lava Rush', 'Fiebre de Lava'], '🌋', 'obby', 40000, 1000, 0, 'hard'],
  ['plaza', ['Star Plaza', 'Plaza Estelar'], '🎡', 'hangout', 0, 0, 0, ''],
  ['palace', ['Sky Palace (VIP)', 'Palacio del Cielo (VIP)'], '🏰', 'hangout', 0, 0, 50000, ''],
].map(([id, n, icon, kind, minMs, reward, price, diff]) => ({ id, n, icon, kind, minMs, reward, price, diff }));
const W_BY = new Map(WORLDS.map((w) => [w.id, w]));
const GEAR = [
  ['speed', ['Speed coil', 'Bobina de velocidad'], '⚡', 6000, 'move', ['Run 30% faster.', 'Corre un 30 % más rápido.']],
  ['gravity', ['Gravity coil', 'Bobina de gravedad'], '🪐', 9000, 'move', ['Jump higher and fall slower.', 'Salta más alto y cae más despacio.']],
  ['double', ['Double jump', 'Doble salto'], '🦘', 15000, 'move', ['Jump again in mid-air.', 'Vuelve a saltar en el aire.']],
  ['glider', ['Glider', 'Planeador'], '🪂', 25000, 'move', ['Hold Space while falling to glide.', 'Mantén Espacio al caer para planear.']],
  ['trail_rainbow', ['Rainbow trail', 'Estela arcoíris'], '🌈', 3000, 'trail', ['A rainbow follows you.', 'Te sigue un arcoíris.']],
  ['trail_fire', ['Fire trail', 'Estela de fuego'], '🔥', 4000, 'trail', ['Leave flames behind.', 'Deja llamas a tu paso.']],
  ['trail_stars', ['Star trail', 'Estela de estrellas'], '✨', 6000, 'trail', ['Sparkle everywhere you go.', 'Brilla por donde pases.']],
  ['hat_crown', ['Golden crown', 'Corona de oro'], '👑', 12000, 'hat', ['Shown above your head in every world.', 'Se ve sobre tu cabeza en todos los mundos.']],
  ['hat_halo', ['Halo', 'Aureola'], '😇', 8000, 'hat', ['A glowing halo.', 'Una aureola brillante.']],
].map(([id, n, icon, price, slot, d]) => ({ id, n, icon, price, slot, d }));
const G_BY = new Map(GEAR.map((g) => [g.id, g]));

function gear(u) { const g = (u.gear = u.gear || { owned: [], trail: null, hat: null, off: [] }); g.owned = g.owned || []; g.off = g.off || []; return g; }
const looks = (u) => { const g = u.gear || {}; return { trail: g.trail || null, hat: g.hat || null }; };
const passes = (u) => (u.worldPass = u.worldPass || []);
const T = () => S.store.table('worldtimes');

// ---------- realtime rooms ----------
const rooms = new Map(); // world -> Map(uid -> { conn, x, y, z, ry, a })
const moveLim = new Limiter(30, 2000); const sayLim = new Limiter(6, 10000);
const MAXP = 40; let dirty = new Map(); let timer = null;
const num = (v, lo, hi) => { v = Number(v); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0; };
const who = (u) => ({ id: u.id, username: u.username, displayName: u.displayName || u.username, av3: u.av3 || null, pro: isPro(u), looks: looks(u), clan: require('./clans').tagOf(u) });
const st = (id, p) => ({ id, x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100, z: Math.round(p.z * 100) / 100, ry: Math.round(p.ry * 100) / 100, a: p.a || 0 });
function tick() {
  for (const [w, set] of dirty) { const room = rooms.get(w); if (!room) continue; const list = [...set].filter((id) => room.has(id)).map((id) => st(id, room.get(id))); if (!list.length) continue; for (const [id, p] of room) { const l = list.filter((x) => x.id !== id); if (l.length) p.conn.send({ t: 'w3_pos', list: l }); } }
  dirty = new Map(); if (![...rooms.values()].some((r) => r.size)) { clearInterval(timer); timer = null; }
}
function leaveAll(conn, u) { for (const [w, room] of rooms) { const p = room.get(u.id); if (p && p.conn === conn) { room.delete(u.id); for (const [, q] of room) q.conn.send({ t: 'w3_leave', id: u.id }); } if (!room.size) rooms.delete(w); } conn.data.w3 = false; }
function ugcRoom(u, wid) { const id = String(wid || ''); if (!id.startsWith('u_')) return null; const x = U()[id.slice(2)]; return x && (x.pub || x.owner === u.id) ? { id, price: 0 } : null; }
function join(conn, u, wid) {
  const w = W_BY.get(String(wid || '')) || ugcRoom(u, wid); if (!w) return;
  if (w.price && !passes(u).includes(w.id) && u.role !== 'owner') { conn.send({ t: 'w3_denied', w: w.id }); return; }
  leaveAll(conn, u);
  const room = rooms.get(w.id) || new Map(); rooms.set(w.id, room);
  if (room.size >= MAXP) { conn.send({ t: 'w3_full', w: w.id }); return; }
  const p = { conn, x: 0, y: 1, z: 0, ry: 0, a: 0 }; room.set(u.id, p); conn.data.w3 = w.id;
  conn.send({ t: 'w3_hello', w: w.id, players: [...room.keys()].filter((id) => id !== u.id && S.users[id]).map((id) => Object.assign(who(S.users[id]), st(id, room.get(id)))) });
  for (const [id, q] of room) if (id !== u.id) q.conn.send({ t: 'w3_join', p: Object.assign(who(u), st(u.id, p)) });
  if (!timer) timer = setInterval(tick, 100);
}
function onMessage(conn, u, m) {
  if (m.t === 'w3_join') return join(conn, u, m.w);
  if (m.t === 'w3_leave') return leaveAll(conn, u);
  const wid = conn.data.w3; const room = wid && rooms.get(wid); const p = room && room.get(u.id); if (!p || p.conn !== conn) return;
  if (m.t === 'w3_move') { if (!moveLim.hit(u.id)) return; p.x = num(m.x, -400, 400); p.y = num(m.y, -60, 400); p.z = num(m.z, -400, 400); p.ry = num(m.ry, -20, 20); p.a = Math.trunc(num(m.a, 0, 9)); if (!dirty.has(wid)) dirty.set(wid, new Set()); dirty.get(wid).add(u.id); return; }
  if (m.t === 'w3_say' || m.t === 'w3_emote') {
    if (!sayLim.hit(u.id) || (u.mutedUntil && u.mutedUntil > Date.now() && m.t === 'w3_say')) return;
    const text = m.t === 'w3_emote' ? String(m.e || '').slice(0, 8) : String(m.text || '').replace(/[\u0000-\u001f‪-‮⁦-⁩]/g, '').trim().slice(0, 90);
    if (text) for (const [, q] of room) q.conn.send({ t: m.t, id: u.id, text });
  }
}
const leave = (conn, u) => leaveAll(conn, u);

// ---------- HTTP side ----------
function view(u) {
  const g = gear(u); const times = T(); const pass = passes(u);
  return {
    worlds: WORLDS.map((w) => { const tt = times[w.id] || {}; const best = Object.entries(tt).sort((a, b) => a[1] - b[1]).slice(0, 5).map(([id, ms]) => (S.users[id] ? { user: publicUser(S.users[id]), ms } : null)).filter(Boolean);
      return { id: w.id, n: w.n, icon: w.icon, kind: w.kind, reward: w.reward, price: w.price, diff: w.diff, online: (rooms.get(w.id) || new Map()).size, myBest: tt[u.id] || null, best, unlocked: !w.price || pass.includes(w.id) || u.role === 'owner', claimedToday: !!(u.worldDay && u.worldDay.d === dayKey() && u.worldDay.done.includes(w.id)) }; }),
    gear: GEAR.map((x) => ({ id: x.id, n: x.n, icon: x.icon, price: x.price, slot: x.slot, d: x.d, owned: g.owned.includes(x.id), on: x.slot === 'move' ? g.owned.includes(x.id) && !g.off.includes(x.id) : g[x.slot] === x.id })),
    me: Object.assign(who(u), { move: g.owned.filter((id) => G_BY.get(id) && G_BY.get(id).slot === 'move' && !g.off.includes(id)) }), coins: u.coins,
  };
}
function buyGear(u, id) { const x = G_BY.get(id); if (!x) throw new HttpError(404, 'no_gear', 'Unknown item'); const g = gear(u); if (g.owned.includes(id)) throw new HttpError(409, 'owned', 'You already own it'); if (!require('./economy').adjust(u, -x.price, 'worlds:gear:' + id)) throw new HttpError(402, 'no_coins', 'Not enough coins'); g.owned.push(id); if (x.slot !== 'move') g[x.slot] = id; S.store.touch('users'); return view(u); }
function equip(u, id) { const x = G_BY.get(id); const g = gear(u); if (!x || !g.owned.includes(id)) throw new HttpError(400, 'not_owned', 'Buy it first'); if (x.slot === 'move') { const i = g.off.indexOf(id); if (i >= 0) g.off.splice(i, 1); else g.off.push(id); } else g[x.slot] = g[x.slot] === id ? null : id; S.store.touch('users'); return view(u); }
function buyPass(u, wid) { const w = W_BY.get(wid); if (!w || !w.price) throw new HttpError(404, 'no_world', 'Unknown world'); if (passes(u).includes(w.id)) throw new HttpError(409, 'owned', 'You already have the pass'); if (!require('./economy').adjust(u, -w.price, 'worlds:pass:' + w.id)) throw new HttpError(402, 'no_coins', 'Not enough coins'); passes(u).push(w.id); S.store.touch('users'); return view(u); }
function finish(u, wid, ms) {
  const w = W_BY.get(String(wid || '')); if (!w || w.kind !== 'obby') throw new HttpError(404, 'no_world', 'Unknown course');
  ms = Math.trunc(Number(ms)); if (!Number.isFinite(ms) || ms < w.minMs || ms > 3 * 3600000) throw new HttpError(400, 'implausible', 'That time does not add up');
  const tt = (T()[w.id] = T()[w.id] || {}); const pb = !tt[u.id] || ms < tt[u.id]; if (pb) { tt[u.id] = ms; S.store.touch('worldtimes'); }
  const day = (u.worldDay = u.worldDay && u.worldDay.d === dayKey() ? u.worldDay : { d: dayKey(), done: [] }); let coins = 0;
  if (!day.done.includes(w.id)) { day.done.push(w.id); coins = w.reward; require('./economy').adjust(u, coins, 'worlds:finish:' + w.id); }
  S.store.touch('users'); require('./progress').award(u, 'arcade', 1);
  return { pb, best: tt[u.id], coins, rank: Object.values(tt).filter((x) => x < tt[u.id]).length + 1 };
}

// ---------- community worlds, made with the World Builder ----------
// A world is a list of blocks on a grid: [gx, gy, gz, size, kind, colour]. Cells are 2 units wide, gy is the height
// of the block's top. Obby worlds need one spawn and at least one finish; hangouts just a spawn.
const U = () => S.store.table('ugcworlds');
const UK = new Set(['n', 'move', 'lift', 'bounce', 'kill', 'check', 'finish', 'deco', 'spawn', 'ice']);
const SKIES = ['night', 'sunset', 'day', 'neon', 'void', 'lava', 'candy'];
const MAXB = 900; const PER_USER = 12; const CELL = 2; const EARN = 60; const EARN_CAP = 3000;
const hex = (c) => (/^#[0-9a-f]{6}$/i.test(String(c)) ? String(c).toLowerCase() : '#8b5cf6');
function cleanBlocks(arr) {
  if (!Array.isArray(arr)) throw new HttpError(400, 'bad_world', 'No blocks');
  const out = []; const seen = new Set();
  for (const b of arr.slice(0, MAXB + 1)) {
    if (!Array.isArray(b)) continue; const gx = Math.trunc(b[0]), gy = Math.trunc(b[1]), gz = Math.trunc(b[2]), sz = Math.trunc(b[3]); const k = String(b[4]);
    if (![gx, gy, gz, sz].every(Number.isFinite) || Math.abs(gx) > 60 || Math.abs(gz) > 60 || gy < 0 || gy > 80 || sz < 1 || sz > 4 || !UK.has(k)) continue;
    const key = gx + ',' + gy + ',' + gz; if (seen.has(key)) continue; seen.add(key); out.push([gx, gy, gz, sz, k, hex(b[5])]);
  }
  if (out.length > MAXB) throw new HttpError(400, 'too_big', `A world can have up to ${MAXB} blocks`);
  return out;
}
function minMs(x) { const sp = x.blocks.find((b) => b[4] === 'spawn'); const fins = x.blocks.filter((b) => b[4] === 'finish'); if (!sp || !fins.length) return 3000; const d = Math.min(...fins.map((f) => Math.hypot((f[0] - sp[0]) * CELL, (f[2] - sp[2]) * CELL))); return Math.max(3000, Math.round((d / 13) * 1000)); }
function ucard(x, u, full) {
  const tt = x.best || {}; const best = Object.entries(tt).sort((a, b) => a[1] - b[1]).slice(0, full ? 10 : 3).map(([id, ms]) => (S.users[id] ? { user: publicUser(S.users[id]), ms } : null)).filter(Boolean);
  const v = { id: x.id, name: x.name, desc: x.desc, kind: x.kind, sky: x.sky, owner: S.users[x.owner] ? publicUser(S.users[x.owner]) : null, mine: x.owner === u.id, pub: x.pub, plays: x.plays || 0, players: Object.keys(x.played || {}).length, likes: Object.keys(x.likes || {}).length, liked: !!(x.likes || {})[u.id], finishes: x.finishes || 0, created: x.created, updated: x.updated, size: x.blocks.length, online: (rooms.get('u_' + x.id) || new Map()).size, myBest: tt[u.id] || null, best };
  if (full) v.blocks = x.blocks; return v;
}
function ugcList(u, sort) {
  const all = Object.values(U()).filter((x) => S.users[x.owner]); const score = (x) => Object.keys(x.likes || {}).length * 5 + Object.keys(x.played || {}).length * 2 + (x.finishes || 0) + ((rooms.get('u_' + x.id) || new Map()).size * 20);
  const pub = all.filter((x) => x.pub); const list = sort === 'new' ? pub.sort((a, b) => b.created - a.created) : pub.sort((a, b) => score(b) - score(a) || b.created - a.created);
  return { worlds: list.slice(0, 60).map((x) => ucard(x, u)), mine: all.filter((x) => x.owner === u.id).sort((a, b) => b.updated - a.updated).map((x) => ucard(x, u)), skies: SKIES, max: MAXB, perUser: PER_USER, earn: EARN };
}
function ugcGet(u, id) { const x = U()[id]; if (!x || (!x.pub && x.owner !== u.id && !isStaff(u))) throw new HttpError(404, 'no_world', 'World not found'); return ucard(x, u, true); }
function ugcSave(u, b) {
  const name = String(b.name || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40); if (name.length < 3) throw new HttpError(400, 'bad_name', 'Give your world a name (3+ characters)');
  const kind = b.kind === 'hangout' ? 'hangout' : 'obby'; const blocks = cleanBlocks(b.blocks); const pub = !!b.pub;
  const spawns = blocks.filter((x) => x[4] === 'spawn').length; if (spawns !== 1) throw new HttpError(400, 'need_spawn', 'Place exactly one spawn block');
  if (kind === 'obby' && !blocks.some((x) => x[4] === 'finish')) throw new HttpError(400, 'need_finish', 'An obby needs at least one finish block');
  let x = b.id ? U()[String(b.id)] : null; const t = now();
  if (x && x.owner !== u.id) throw new HttpError(403, 'not_yours', 'That world is not yours');
  if (!x) { if (Object.values(U()).filter((w) => w.owner === u.id).length >= PER_USER) throw new HttpError(409, 'too_many', `You can have up to ${PER_USER} worlds`); const id = rid(8); x = U()[id] = { id, owner: u.id, created: t, plays: 0, played: {}, likes: {}, best: {}, finishes: 0 }; }
  const changed = JSON.stringify(x.blocks) !== JSON.stringify(blocks) || x.kind !== kind;
  Object.assign(x, { name, desc: String(b.desc || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200), kind, sky: SKIES.includes(b.sky) ? b.sky : 'night', blocks, pub, updated: t });
  if (changed) x.best = {}; // the course changed: old times no longer mean anything
  S.store.touch('ugcworlds'); if (pub && !x.firstPub) { x.firstPub = t; try { require('./progress').award(u, 'social', 1); } catch {} require('./feed').add('world', '🧱', [`@${u.username} published the world “${name}”`, `@${u.username} ha publicado el mundo «${name}»`], { uid: u.id, link: '#/worlds' }); }
  return ucard(x, u, true);
}
function ugcDelete(u, id) { const x = U()[id]; if (!x) throw new HttpError(404, 'no_world', 'World not found'); if (x.owner !== u.id && !isStaff(u)) throw new HttpError(403, 'not_yours', 'That world is not yours'); delete U()[id]; S.store.touch('ugcworlds'); return { ok: true }; }
function ugcLike(u, id) { const x = U()[id]; if (!x || !x.pub) throw new HttpError(404, 'no_world', 'World not found'); x.likes = x.likes || {}; if (x.likes[u.id]) delete x.likes[u.id]; else x.likes[u.id] = 1; S.store.touch('ugcworlds'); return ucard(x, u); }
function ugcPlay(u, id) { const x = U()[id]; if (!x || (!x.pub && x.owner !== u.id)) throw new HttpError(404, 'no_world', 'World not found'); x.plays = (x.plays || 0) + 1; x.played = x.played || {}; x.played[u.id] = 1; S.store.touch('ugcworlds'); return { ok: true }; }
function ugcFinish(u, id, ms) {
  const x = U()[id]; if (!x || x.kind !== 'obby' || (!x.pub && x.owner !== u.id)) throw new HttpError(404, 'no_world', 'World not found');
  ms = Math.trunc(Number(ms)); if (!Number.isFinite(ms) || ms < minMs(x) || ms > 3 * 3600000) throw new HttpError(400, 'implausible', 'That time does not add up');
  x.best = x.best || {}; const pb = !x.best[u.id] || ms < x.best[u.id]; if (pb) x.best[u.id] = ms; x.finishes = (x.finishes || 0) + 1;
  // the creator earns coins when other people finish their world (once per player, world and day; daily cap)
  let creator = 0; const owner = S.users[x.owner];
  if (owner && owner.id !== u.id) {
    const day = (u.ugcDone = u.ugcDone && u.ugcDone.d === dayKey() ? u.ugcDone : { d: dayKey(), ids: [] });
    const earn = (owner.ugcEarn = owner.ugcEarn && owner.ugcEarn.d === dayKey() ? owner.ugcEarn : { d: dayKey(), n: 0 });
    if (!day.ids.includes(x.id) && earn.n < EARN_CAP) { day.ids.push(x.id); creator = Math.min(EARN, EARN_CAP - earn.n); earn.n += creator; require('./economy').adjust(owner, creator, 'worlds:creator:' + x.id); require('./state').hub.push(owner.id, { t: 'notice', text: `🧱 @${u.username} finished your world “${x.name}” (+${creator} coins)`, es: `🧱 @${u.username} ha completado tu mundo «${x.name}» (+${creator} monedas)` }); }
  }
  S.store.touch('ugcworlds'); S.store.touch('users'); require('./progress').award(u, 'arcade', 1);
  return { pb, best: x.best[u.id], coins: 0, creator, rank: Object.values(x.best).filter((v) => v < x.best[u.id]).length + 1 };
}
const online = () => [...rooms.values()].reduce((a, r) => a + r.size, 0);
module.exports = { onMessage, leave, view, buyGear, equip, buyPass, finish, online, WORLDS, ugcList, ugcGet, ugcSave, ugcDelete, ugcLike, ugcPlay, ugcFinish };
