'use strict';
// Nebulix Arena (12.0, 13.0): online rooms for three original modes over the WebSocket.
//   Nebula Ops "Assault": 5 vs 5 rounds (Raiders vs Guardians), plant / defuse the plasma core, economy, first to 7.
//   Nebula Royale: up to 20 on an island, drop ship, closing storm, chests with loot by rarity, building, last one wins.
//   Duels (13.0): 1 vs 1 on Prism Court, same weapon for both each round, first to 5. Quick match, ranked or a
//   challenge to a friend with an optional coin bet (the winner takes 95 % of the pot).
// Every mode has a ranked queue (server/ranked.js); ranked rooms get tougher bots.
// The server owns health, kills, money, loot, storm, builds and bots, and checks every shot (fire rate, range and
// line of sight) so simple cheats do not work. Clients send their position ~15×/s and draw everyone else.
const path = require('path');
const { pathToFileURL } = require('url');
const { S, publicUser } = require('./state');
const { Limiter, rid, dayKey } = require('./util');

let SH = null; let shLoading = null;
const shared = () => SH ? Promise.resolve(SH) : (shLoading = shLoading || import(pathToFileURL(path.join(__dirname, '../public/js/arena-shared.js')).href).then((m) => (SH = m)));
shared().catch((e) => console.error('[arena] shared', e));

const rooms = new Map(); let timer = null;
const msgLim = new Limiter(80, 2000);
const BOT_NAMES = ['Nyx', 'Orion', 'Vega', 'Lyra', 'Kai', 'Zed', 'Rook', 'Juno', 'Pixel', 'Bolt', 'Echo', 'Nova', 'Ash', 'Iris', 'Volt', 'Sable', 'Comet', 'Drift', 'Fable', 'Quill', 'Rune', 'Talon', 'Wren', 'Blaze'];
const rand = (a, b) => a + Math.random() * (b - a);
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const now = () => Date.now();
const OPS_MAX = 5; const ROYALE_MAX = 20;

// ---------- rewards (capped per day) ----------
function reward(uid, coins, why) {
  const u = S.users[uid]; if (!u || coins <= 0) return 0;
  u.arena = u.arena && u.arena.day === dayKey() ? u.arena : { day: dayKey(), coins: 0 };
  const boost = require('./boosts').active(u, 'arena'); if (boost) coins = Math.round(coins * 1.5);
  const give = Math.max(0, Math.min(coins, (boost ? 4500 : 3000) - u.arena.coins)); if (!give) return 0;
  u.arena.coins += give; require('./economy').adjust(u, give, 'arena:' + why); S.store.touch('users'); return give;
}

// ---------- entities ----------
function ent(room, { uid = null, conn = null, name, team = null, bot = false }) {
  const id = bot ? 'b' + rid(5) : uid; const u = uid && S.users[uid];
  const e = { id, uid, conn, bot, name: name || (u ? u.displayName || u.username : 'Bot'), av3: u ? u.av3 || null : { skin: Math.floor(rand(0, 6)), topColor: Math.floor(rand(0, 9)), pants: Math.floor(rand(0, 9)), hair: ['short', 'spiky', 'bun', 'mohawk', 'long'][Math.floor(rand(0, 5))], hairColor: Math.floor(rand(0, 6)) },
    team, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, hp: 100, armor: 0, alive: true, w: 'pistol', slot: 0, inv: [{ w: 'pistol', r: 0 }], mats: 0, money: 800, kit: false, kills: 0, deaths: 0, botKills: 0, last: {}, a: 0, heals: { med: 0, sh: 0 },
    lk: u ? require('./shop').lockerSpec(u) : (bot ? require('./shop').randomSpec() : null),
    ai: bot ? { t: 0, target: null, goal: null, stuck: 0, lx: 0, lz: 0, skill: rand(0.25, 0.55) + (room.botBoost || 0), strafe: 1, jumpAt: 0, vy: 0, react: 0, hurtAt: 0, by: null, buildAt: 0, healAt: 0, seen: 0 } : null, joined: now(), lastMove: now() };
  if (e.ai) e.ai.skill = Math.min(0.95, e.ai.skill);
  room.ents.set(id, e); return e;
}
const meta = (e) => ({ id: e.id, name: e.name, av3: e.av3, team: e.team, bot: e.bot, lk: e.lk || null, user: e.uid && S.users[e.uid] ? publicUser(S.users[e.uid]) : null });
const snap = (e) => [e.id, Math.round(e.x * 100) / 100, Math.round(e.y * 100) / 100, Math.round(e.z * 100) / 100, Math.round(e.yaw * 100) / 100, Math.round(e.pitch * 100) / 100, Math.round(e.hp), e.alive ? 1 : 0, e.w, e.a || 0, Math.round(e.armor)];
function send(room, msg, except) { for (const e of room.ents.values()) if (e.conn && e !== except) e.conn.send(msg); }
const humans = (room) => [...room.ents.values()].filter((e) => !e.bot);
function feed(room, a, b, w, head) { send(room, { t: 'ar_kill', a: a ? a.id : null, an: a ? a.name : null, b: b.id, bn: b.name, w, head: !!head, x: b.x, y: b.y, z: b.z, fx: a && a.lk && a.lk.elim ? a.lk.elim : null }); }

// ---------- map helpers ----------
function solids(room) { return room.game !== 'royale' ? room.map.boxes : room.map.boxes.concat([...room.builds.values()].map((p) => SH.pieceBox(p)).filter(Boolean)); }
function blocked(room, x, z, y = 0, r = 0.4) {
  for (const b of solids(room)) { const by = b.y || 0; if (y + 1.7 > by && y < by + b.h - 0.35 && Math.abs(x - b.x) < b.w / 2 + r && Math.abs(z - b.z) < b.d / 2 + r) return true; }
  if (room.game === 'royale') { for (const t of room.map.trees) if (Math.hypot(t.x - x, t.z - z) < t.r + r) return true; for (const k of room.map.rocks) if (y < k.r * 0.8 && Math.hypot(k.x - x, k.z - z) < k.r + r) return true; const H = room.map.half; if (Math.abs(x) > H || Math.abs(z) > H) return true; }
  else if (Math.abs(x) > room.map.size.w - 1 || Math.abs(z) > room.map.size.d - 1) return true;
  return false;
}
const los = (room, a, b) => SH.losBoxes(solids(room), a.x, a.y + SH.EYE, a.z, b.x, b.y + 1.2, b.z);

// ---------- damage ----------
function damage(room, attacker, target, amount, w, head) {
  if (!target.alive || room.phase === 'end') return;
  if (room.game !== 'royale' && attacker && attacker.team === target.team && attacker !== target) return; // no friendly fire
  if (room.game === 'duel' && room.phase !== 'live') return;
  let dmg = amount; if (target.armor > 0) { const absorb = Math.min(target.armor, dmg * (room.game === 'ops' ? 0.5 : 1)); target.armor -= absorb; dmg -= absorb; }
  if (target.ai && attacker && attacker !== target) { target.ai.hurtAt = now(); target.ai.by = attacker.id; }
  target.hp -= dmg; if (target.conn) target.conn.send({ t: 'ar_hurt', by: attacker ? attacker.id : null, hp: Math.max(0, Math.round(target.hp)), armor: Math.round(target.armor) });
  if (attacker && attacker.conn && attacker !== target) attacker.conn.send({ t: 'ar_hit', id: target.id, head: !!head, kill: target.hp <= 0, dmg: Math.round(amount), shield: amount - dmg > 0.5 });
  if (target.hp <= 0) kill(room, attacker, target, w, head);
}
function kill(room, attacker, target, w, head) {
  target.alive = false; target.hp = 0; target.deaths++; target.diedAt = now();
  if (attacker && attacker !== target) { attacker.kills++; if (target.bot) attacker.botKills++; if (room.game === 'ops') attacker.money = Math.min(16000, attacker.money + 300); else if (room.game === 'royale') attacker.mats = Math.min(999, attacker.mats + 50); if (attacker.uid && target.uid) reward(attacker.uid, room.game === 'ops' ? 30 : 25, 'kill');
    if (attacker.bot && attacker.lk && attacker.lk.emotes && attacker.lk.emotes[0] && Math.random() < 0.35) setTimeout(() => send(room, { t: 'ar_emote', id: attacker.id, k: attacker.lk.emotes[0].k }), 600); }
  feed(room, attacker && attacker !== target ? attacker : null, target, w, head);
  if (room.game === 'duel') { const win = attacker && attacker !== target ? attacker.team : (target.team === 'atk' ? 'def' : 'atk'); return duelEndRound(room, win, 'elim'); }
  if (room.game === 'ops') { target.inv = [{ w: 'pistol', r: 0 }]; target.slot = 0; target.w = 'pistol'; if (room.carrier === target.id) { room.carrier = null; room.coreDrop = { x: target.x, z: target.z }; send(room, { t: 'ar_core', drop: room.coreDrop }); } }
  else if (room.game === 'royale') { if (target.inv.length) dropLoot(room, target); room.placed.push({ id: target.id, name: target.name, place: [...room.ents.values()].filter((e) => e.alive).length + 1 }); if (target.uid) { const place = [...room.ents.values()].filter((e) => e.alive).length + 1; let rk = null; if (room.ranked && !target.rkDone) { rk = require('./ranked').result(S.users[target.uid], 'royale', { place, kills: target.kills - target.botKills, botKills: target.botKills, total: room.ents.size }); target.rkDone = true; target.rkRes = rk; } send1(target, { t: 'ar_out', place, by: attacker ? attacker.name : null, rk }); } }
}
const send1 = (e, m) => { if (e.conn) e.conn.send(m); };

// ---------- shots from players ----------
function onShot(room, e, m) {
  const W = SH.WEAPONS[m.w]; if (!W || !e.alive || room.frozen) return;
  if (!e.inv.some((it) => it.w === m.w)) return; // must own the weapon
  const t0 = now(); if (t0 - (e.last[m.w] || 0) < W.rate * 1000 * 0.75) return; e.last[m.w] = t0; e.w = m.w;
  const rar = (e.inv.find((it) => it.w === m.w) || {}).r || 0; const mult = room.game === 'royale' ? SH.RARITY[rar].m : 1;
  send(room, { t: 'ar_fx', id: e.id, w: m.w, to: Array.isArray(m.to) ? m.to.slice(0, 3).map(Number) : null }, e);
  const hits = (Array.isArray(m.hits) ? m.hits : []).slice(0, W.pellets || 1);
  for (const h of hits) {
    const tg = room.ents.get(String(h.id || '')); if (!tg || !tg.alive || tg === e) continue;
    const d = Math.hypot(tg.x - e.x, tg.y - e.y, tg.z - e.z); if (d > W.range * 1.15) continue;
    if (!los(room, e, tg) && !SH.losBoxes(solids(room), e.x, e.y + SH.EYE, e.z, tg.x, tg.y + 1.6, tg.z)) continue;
    const fall = d > W.range * 0.6 ? 0.75 : 1; damage(room, e, tg, W.dmg * mult * fall * (h.head ? W.head : 1), m.w, h.head);
  }
  if (room.game === 'royale') for (const bid of (Array.isArray(m.builds) ? m.builds : []).slice(0, 3)) hitBuild(room, String(bid), W.dmg * mult);
}
function hitBuild(room, bid, dmg) { const p = room.builds.get(bid); if (!p) return; p.hp -= dmg; if (p.hp <= 0) { room.builds.delete(bid); send(room, { t: 'ar_unbuild', id: bid }); } else send(room, { t: 'ar_bhp', id: bid, hp: Math.round(p.hp) }); }

// ---------- Nebula Ops ----------
const OPS = { win: 7, buy: 9000, live: 105000, post: 5000, plant: 3000, defuse: 5000, kitDefuse: 3000, fuse: 40000 };
function opsNewRound(room) {
  room.phase = 'buy'; room.frozen = true; room.until = now() + OPS.buy; room.core = null; room.coreDrop = null; room.plant = null; room.defuse = null; room.round++;
  const atk = [...room.ents.values()].filter((e) => e.team === 'atk'); const def = [...room.ents.values()].filter((e) => e.team === 'def');
  for (const [list, sp] of [[atk, room.map.spawns.atk], [def, room.map.spawns.def]]) list.forEach((e, i) => { const s = sp[i % sp.length]; Object.assign(e, { x: s.x + rand(-0.5, 0.5), y: 0, z: s.z, yaw: s.yaw, pitch: 0, hp: 100, alive: true }); if (e.bot) botBuy(e); });
  room.carrier = (atk.find((e) => !e.bot) || atk[0] || {}).id || null; room.siteGoal = Math.random() < 0.5 ? 'A' : 'B';
  for (const e of room.ents.values()) if (e.bot) { e.ai.goal = null; e.ai.target = null; }
  send(room, { t: 'ar_round', round: room.round, score: room.score, phase: 'buy', until: room.until, carrier: room.carrier });
  for (const e of room.ents.values()) send1(e, { t: 'ar_you', money: e.money, inv: e.inv, armor: e.armor, kit: e.kit, x: e.x, z: e.z, yaw: e.yaw, hp: e.hp });
}
function botBuy(e) {
  if (e.money >= 2700 + 650 && !e.inv.some((it) => it.w === 'rifle')) { e.money -= 2700; e.inv = [{ w: 'rifle', r: 0 }, { w: 'pistol', r: 0 }]; }
  else if (e.money >= 1200 && e.inv.length < 2) { e.money -= 1200; e.inv = [{ w: 'smg', r: 0 }, { w: 'pistol', r: 0 }]; }
  if (e.money >= 650 && e.armor < 50) { e.money -= 650; e.armor = 100; } e.w = e.inv[0].w;
}
function opsEndRound(room, winner, why) {
  if (room.phase === 'post' || room.phase === 'end') return;
  room.phase = 'post'; room.until = now() + OPS.post; room.score[winner]++;
  for (const e of room.ents.values()) { e.money = Math.min(16000, e.money + (e.team === winner ? 3000 : 1900)); if (!e.alive) { e.armor = 0; e.kit = false; } }
  send(room, { t: 'ar_rend', winner, why, score: room.score });
  if (room.score[winner] >= OPS.win) {
    room.phase = 'end'; room.until = now() + 12000;
    for (const e of humans(room)) { const won = e.team === winner; const r = reward(e.uid, (won ? 300 : 60) * (humans(room).length > 1 ? 1 : 0.5), won ? 'win' : 'match'); const rk = room.ranked ? require('./ranked').result(S.users[e.uid], 'ops', { won, kills: e.kills }) : null; send1(e, { t: 'ar_end', won, coins: r, score: room.score, board: board(room), rk }); }
    room.done = true;
  }
}
const board = (room) => [...room.ents.values()].map((e) => ({ id: e.id, name: e.name, team: e.team, k: e.kills, d: e.deaths, bot: e.bot })).sort((a, b) => b.k - a.k);
function opsTick(room, dt) {
  const t = now();
  if (room.phase === 'warm' && t > room.until) { room.round = 0; room.score = { atk: 0, def: 0 }; for (const e of room.ents.values()) { e.money = 800; e.kills = 0; e.deaths = 0; e.inv = [{ w: 'pistol', r: 0 }]; e.armor = 0; } opsNewRound(room); return; }
  if (room.phase === 'buy' && t > room.until) { room.phase = 'live'; room.frozen = false; room.until = t + OPS.live; send(room, { t: 'ar_phase', phase: 'live', until: room.until }); }
  if (room.phase === 'post' && t > room.until) { opsNewRound(room); return; }
  if (room.phase === 'end' && t > room.until) { room.phase = 'warm'; room.done = false; room.until = t + 4000; send(room, { t: 'ar_phase', phase: 'warm', until: room.until }); return; }
  if (room.phase !== 'live') return;
  const alive = (tm) => [...room.ents.values()].filter((e) => e.team === tm && e.alive).length;
  // planting / defusing
  if (room.plant) { const e = room.ents.get(room.plant.id); if (!e || !e.alive || Math.hypot(e.x - room.plant.x, e.z - room.plant.z) > 1.2) room.plant = null; else if (t - room.plant.at >= OPS.plant) { room.core = { x: e.x, z: e.z, site: room.plant.site, at: t, boom: t + OPS.fuse }; room.carrier = null; room.plant = null; room.until = room.core.boom; send(room, { t: 'ar_core', core: room.core }); } }
  if (room.defuse) { const e = room.ents.get(room.defuse.id); if (!e || !e.alive || !room.core || Math.hypot(e.x - room.core.x, e.z - room.core.z) > 1.8) { room.defuse = null; send(room, { t: 'ar_defuse', id: null }); } else if (t - room.defuse.at >= (e.kit ? OPS.kitDefuse : OPS.defuse)) { room.defuse = null; send(room, { t: 'ar_core', defused: true }); opsEndRound(room, 'def', 'defused'); return; } }
  if (room.core && t >= room.core.boom) { for (const e of room.ents.values()) if (e.alive && Math.hypot(e.x - room.core.x, e.z - room.core.z) < 12) damage(room, null, e, 500, 'core'); send(room, { t: 'ar_core', boom: room.core }); opsEndRound(room, 'atk', 'core'); return; }
  if (!alive('atk') && !room.core) return opsEndRound(room, 'def', 'elim');
  if (!alive('def')) return opsEndRound(room, 'atk', 'elim');
  if (!room.core && t > room.until) return opsEndRound(room, 'def', 'time');
  // a dropped core is picked up by walking over it
  if (room.coreDrop) for (const e of room.ents.values()) if (e.team === 'atk' && e.alive && Math.hypot(e.x - room.coreDrop.x, e.z - room.coreDrop.z) < 1.4) { room.carrier = e.id; room.coreDrop = null; send(room, { t: 'ar_core', carrier: e.id }); break; }
  for (const e of room.ents.values()) if (e.bot && e.alive) botThink(room, e, dt);
}

// ---------- Nebula Royale ----------
function royaleStart(room) {
  room.phase = 'ship'; room.frozen = false; const a = rand(0, Math.PI * 2); const L = room.map.half + 20;
  room.ship = { x0: Math.cos(a) * L, z0: Math.sin(a) * L, x1: -Math.cos(a) * L, z1: -Math.sin(a) * L, at: now(), dur: 32000, y: 90 };
  room.storm = { phase: -1, cx: rand(-60, 60), cz: rand(-60, 60), r: room.map.half * 1.5, from: null, to: null, until: now() + 32000 + 15000 };
  const total = ROYALE_MAX; let i = 0; while (room.ents.size < total) { ent(room, { bot: true, name: BOT_NAMES[i++ % BOT_NAMES.length] + ' ' + (10 + Math.floor(rand(0, 89))) }); }
  for (const e of room.ents.values()) { Object.assign(e, { hp: 100, armor: 0, alive: true, inShip: true, inv: [], w: null, slot: 0, mats: 100, kills: 0, botKills: 0, heals: { med: 0, sh: 0 }, x: room.ship.x0, z: room.ship.z0, y: 90 }); if (e.bot) e.ai.jumpAt = now() + rand(4000, 30000); }
  room.drops = new Map();
  room.chestsOpen = new Set(); room.builds = new Map(); room.placed = [];
  send(room, { t: 'ar_ship', ship: room.ship, storm: room.storm, ents: [...room.ents.values()].map(meta) });
  for (const e of humans(room)) send1(e, { t: 'ar_you', heals: e.heals });
}
function shipPos(room, t = now()) { const s = room.ship; const k = Math.min(1, (t - s.at) / s.dur); return { x: s.x0 + (s.x1 - s.x0) * k, z: s.z0 + (s.z1 - s.z0) * k, k }; }
function lootRoll() { const r = Math.random(); const rar = r < 0.38 ? 0 : r < 0.66 ? 1 : r < 0.85 ? 2 : r < 0.96 ? 3 : 4; const w = ['smg', 'shotgun', 'rifle', 'rifle', 'lance', 'pistol', 'smg', 'shotgun'][Math.floor(Math.random() * 8)]; return { w, r: rar }; }
function giveItem(e, it) { const i = e.inv.findIndex((x) => x.w === it.w); if (i >= 0) { if (it.r > e.inv[i].r) e.inv[i] = it; } else if (e.inv.length < 5) e.inv.push(it); else { let lo = 0; e.inv.forEach((x, k) => { if (x.r < e.inv[lo].r) lo = k; }); if (it.r > e.inv[lo].r) e.inv[lo] = it; } if (!e.w) e.w = e.inv[0].w; }
function royaleTick(room, dt) {
  const t = now();
  if (room.phase === 'lobby') { if (t > room.until) royaleStart(room); return; }
  if (room.phase === 'end') { if (t > room.until) closeRoom(room); return; }
  // ship: auto-jump at the end; bots jump at their time
  if (room.phase === 'ship') { const sp = shipPos(room); for (const e of room.ents.values()) if (e.inShip) { e.x = sp.x; e.z = sp.z; e.y = 90; if ((e.bot && t > e.ai.jumpAt) || sp.k >= 1) jump(room, e); } if (sp.k >= 1) { room.phase = 'live'; send(room, { t: 'ar_phase', phase: 'live' }); } }
  // storm phases
  const st = room.storm; if (t > st.until) { st.phase++; const P = SH.STORM[Math.min(st.phase, SH.STORM.length - 1)]; if (st.shrinking) { st.shrinking = false; st.r = st.to.r; st.cx = st.to.cx; st.cz = st.to.cz; st.until = t + (SH.STORM[Math.min(st.phase, SH.STORM.length - 1)] || P).wait * 1000; } else { const nr = P.r; const ang = rand(0, Math.PI * 2); const off = Math.max(0, st.r - nr) * rand(0, 0.6); st.from = { r: st.r, cx: st.cx, cz: st.cz, at: t }; st.to = { r: nr, cx: st.cx + Math.cos(ang) * off, cz: st.cz + Math.sin(ang) * off }; st.shrinking = true; st.until = t + P.shrink * 1000; st.dps = P.dps; } send(room, { t: 'ar_storm', storm: st }); }
  if (st.shrinking && st.from) { const k = Math.min(1, (t - st.from.at) / Math.max(1, st.until - st.from.at)); st.r = st.from.r + (st.to.r - st.from.r) * k; st.cx = st.from.cx + (st.to.cx - st.from.cx) * k; st.cz = st.from.cz + (st.to.cz - st.from.cz) * k; }
  room.stormAcc = (room.stormAcc || 0) + dt; if (room.stormAcc >= 1) { room.stormAcc = 0; for (const e of room.ents.values()) if (e.alive && !e.inShip && Math.hypot(e.x - st.cx, e.z - st.cz) > st.r) damage(room, null, e, st.dps || 1, 'storm'); }
  for (const e of room.ents.values()) if (e.bot && e.alive && !e.inShip) { if (e.falling) { e.y = Math.max(0, e.y - 14 * dt); if (e.ai.land) { const k = Math.min(1, dt * 0.25); e.x += (e.ai.land.x - e.x) * k; e.z += (e.ai.land.z - e.z) * k; } if (e.y <= 0) e.falling = false; } else botThink(room, e, dt); }
  // winner
  const alive = [...room.ents.values()].filter((e) => e.alive); const humansAlive = alive.filter((e) => !e.bot);
  if (room.phase === 'live' && (alive.length <= 1 || (!humansAlive.length && humans(room).length))) {
    room.phase = 'end'; room.until = t + 15000; const win = alive.length === 1 ? alive[0] : null;
    for (const e of humans(room)) { const place = e.alive ? 1 : ((room.placed.find((p) => p.id === e.id) || {}).place || 99); const coins = reward(e.uid, place === 1 ? 500 : place <= 5 ? 100 : 20, 'royale'); const rk = room.ranked && !e.rkDone ? require('./ranked').result(S.users[e.uid], 'royale', { place, kills: e.kills - e.botKills, botKills: e.botKills, total: room.ents.size }) : e.rkRes || null; e.rkDone = true; send1(e, { t: 'ar_end', win: win ? { id: win.id, name: win.name } : null, place, coins, kills: e.kills, rk }); }
    room.done = true;
    if (win && win.uid) { try { require('./feed').add('record', '🏆', [`@${S.users[win.uid].username} won a Nebula Royale match with ${win.kills} eliminations`, `@${S.users[win.uid].username} ha ganado una partida de Nebula Royale con ${win.kills} eliminaciones`], { uid: win.uid, link: '/royale' }); } catch {} }
  }
}
function jump(room, e) { e.inShip = false; e.falling = true; if (e.bot) { const p = room.map.pois[Math.floor(Math.random() * room.map.pois.length)]; e.ai.land = { x: p.x + rand(-20, 20), z: p.z + rand(-20, 20) }; } send(room, { t: 'ar_jumped', id: e.id }); }

// ---------- bots (13.0: reaction time, cover building, healing, storm rotation, better looting) ----------
const bestRar = (e) => e.inv.reduce((m, x) => Math.max(m, x.r), -1);
// pick the right weapon for the distance
function botWeapon(e, d) {
  if (!e.inv.length) return null; let best = null; let bs = -1;
  for (const it of e.inv) { const W = SH.WEAPONS[it.w]; if (!W || d > W.range) continue; const fit = it.w === 'shotgun' ? (d < 10 ? 3 : 0.5) : it.w === 'smg' ? (d < 18 ? 2.4 : 1) : it.w === 'lance' ? (d > 40 ? 3 : 0.4) : it.w === 'rifle' ? 2 : 1; const sc = fit + it.r * 0.4; if (sc > bs) { bs = sc; best = it.w; } }
  return best || e.inv[0].w;
}
// a wall between the bot and whoever is shooting it (same rules and cost as players)
function botBuild(room, e, from) {
  if (room.game !== 'royale' || e.mats < SH.BUILD_COST || room.builds.size > 1500) return false;
  const C = SH.CELL; const dx = from.x - e.x, dz = from.z - e.z; const gx0 = Math.round(e.x / C), gz0 = Math.round(e.z / C); const zMajor = Math.abs(dz) >= Math.abs(dx);
  const lvl = Math.max(0, Math.floor((e.y + 0.2) / C));
  const p = zMajor ? { k: 'wall', gx: gx0, gy: lvl, gz: dz < 0 ? gz0 : gz0 + 1, dir: 0 } : { k: 'wall', gx: dx < 0 ? gx0 : gx0 + 1, gy: lvl, gz: gz0, dir: 1 };
  if ([...room.builds.values()].some((q) => q.k === 'wall' && q.gx === p.gx && q.gy === p.gy && q.gz === p.gz && q.dir === p.dir)) return false;
  Object.assign(p, { id: rid(6), hp: SH.BUILD_HP, owner: e.id }); e.mats -= SH.BUILD_COST; room.builds.set(p.id, p); send(room, { t: 'ar_build', p }); return true;
}
function stormSafe(room, e, margin = 0.8) {
  const st = room.storm; if (!st) return true; const c = st.shrinking && st.to ? st.to : st.next || null; const cx = c ? c.cx : st.cx, cz = c ? c.cz : st.cz, r = c ? c.r : st.r;
  return Math.hypot(e.x - cx, e.z - cz) < Math.max(4, r * margin);
}
function botThink(room, e, dt) {
  const ai = e.ai; ai.t -= dt; const ops = room.game !== 'royale'; const T = now();
  // gravity for bot jumps
  if (ai.vy || e.y > 0) { ai.vy -= 18 * dt; e.y = Math.max(0, e.y + ai.vy * dt); if (e.y <= 0) ai.vy = 0; }
  if (ai.t <= 0) {
    ai.t = rand(0.2, 0.4) * (1.3 - ai.skill * 0.5); let best = null; let bs = -1e9; const range = ops ? 60 : 50 + ai.skill * 25;
    for (const o of room.ents.values()) {
      if (o === e || !o.alive || o.inShip || (ops && o.team === e.team)) continue; const d = dist(e, o); if (d > (e.inv.length ? range : 7) || !los(room, e, o)) continue;
      const sc = -d - (o.hp + o.armor) * 0.15 + (o.id === ai.by && T - ai.hurtAt < 3000 ? 25 : 0) + (o.id === ai.target ? 8 : 0); if (sc > bs) { bs = sc; best = o; }
    }
    // someone shooting us from out of sight: turn toward them
    if (!best && ai.by && T - ai.hurtAt < 2500) { const o = room.ents.get(ai.by); if (o && o.alive) e.yaw = Math.atan2(o.x - e.x, o.z - e.z) + Math.PI; }
    if (best && best.id !== ai.target) ai.react = T + (650 - ai.skill * 450) * rand(0.7, 1.3); // reaction time before the first shot
    ai.target = best ? best.id : null;
    if (!best) {
      if (ops) { if (!ai.goal || dist(e, ai.goal) < 2) { if (room.game === 'duel') ai.goal = { x: rand(-10, 10), z: rand(-8, 8) }; else { const site = room.map.sites[room.siteGoal]; ai.goal = e.team === 'atk' ? (room.coreDrop && Math.random() < 0.6 ? { x: room.coreDrop.x, z: room.coreDrop.z } : { x: site.x + rand(-3, 3), z: site.z + rand(-3, 3) }) : (room.core ? { x: room.core.x, z: room.core.z } : { x: room.map.sites[Math.random() < 0.5 ? 'A' : 'B'].x + rand(-5, 5), z: room.map.sites.A.z + rand(-4, 6) }); } } }
      else {
        const st = room.storm; const stormT = st ? st.until - T : 1e9;
        // heal when it is calm
        if ((e.hp < 70 && e.heals.med > 0) || (e.armor < 50 && e.heals.sh > 0)) { if (T - ai.hurtAt > 3000 && T > ai.healAt) { useHeal(room, e, e.hp < 70 && e.heals.med > 0 ? 'med' : 'sh'); ai.healAt = T + 2600; } }
        const needStorm = st && (!stormSafe(room, e, 0.85) && (st.shrinking || stormT < 25000 || !stormSafe(room, e, 1.05)));
        if (needStorm) { const c = st.shrinking && st.to ? st.to : st; const a = Math.atan2(e.z - c.cz, e.x - c.cx); const r = Math.max(2, c.r * rand(0.2, 0.6)); ai.goal = { x: c.cx + Math.cos(a) * r, z: c.cz + Math.sin(a) * r, storm: true }; }
        else if (!ai.goal || dist(e, ai.goal) < 2 || (ai.goal.chest !== undefined && room.chestsOpen.has(ai.goal.chest))) {
          const weak = e.inv.length < 3 || bestRar(e) < 2 + (ai.skill > 0.6 ? 1 : 0); const look = weak ? 70 : 30;
          let chest = null, cd = look; room.map.chests.forEach((c, i) => { if (room.chestsOpen.has(i)) return; const d = Math.hypot(c.x - e.x, c.z - e.z); if (d < cd) { cd = d; chest = [c, i]; } });
          let drop = null; for (const [id, dp] of (room.drops || new Map())) { const d = Math.hypot(dp.x - e.x, dp.z - e.z); if (d < 25 && dp.items.some((it) => !e.inv.some((x) => x.w === it.w && x.r >= it.r))) { drop = [dp, id]; break; } }
          const inside = (c) => c.box && Math.abs(e.x - c.box.x) < c.box.w / 2 && Math.abs(e.z - c.box.z) < c.box.d / 2;
          ai.goal = drop ? { x: drop[0].x, z: drop[0].z, drop: drop[1] } : chest ? (chest[0].door && !inside(chest[0]) ? { x: chest[0].door.x, z: chest[0].door.z, chest: chest[1], via: true } : { x: chest[0].x, z: chest[0].z, chest: chest[1] }) : st ? { x: st.cx + rand(-st.r * 0.45, st.r * 0.45), z: st.cz + rand(-st.r * 0.45, st.r * 0.45) } : { x: rand(-60, 60), z: rand(-60, 60) };
        }
      }
    }
  }
  // ops: plant at the site, defuse the core
  if (room.game === 'ops' && room.phase === 'live') {
    if (e.team === 'atk' && room.carrier === e.id && !room.core) { const site = room.map.sites[room.siteGoal]; if (Math.hypot(e.x - site.x, e.z - site.z) < site.r) { if (!room.plant) room.plant = { id: e.id, x: e.x, z: e.z, at: now(), site: room.siteGoal }; return; } }
    if (e.team === 'def' && room.core && !ai.target && Math.hypot(e.x - room.core.x, e.z - room.core.z) < 1.5) { if (!room.defuse) { room.defuse = { id: e.id, at: now() }; send(room, { t: 'ar_defuse', id: e.id }); } return; }
  }
  if (!ops && ai.goal && ai.goal.via && Math.hypot(e.x - ai.goal.x, e.z - ai.goal.z) < 1.6) { const c = room.map.chests[ai.goal.chest]; ai.goal = { x: c.x, z: c.z, chest: ai.goal.chest }; }
  if (!ops && ai.goal && ai.goal.chest !== undefined && !ai.goal.via && Math.hypot(e.x - ai.goal.x, e.z - ai.goal.z) < 2.6 && !room.chestsOpen.has(ai.goal.chest)) { openChest(room, e, ai.goal.chest); ai.goal = null; }
  if (!ops && ai.goal && ai.goal.drop && Math.hypot(e.x - ai.goal.x, e.z - ai.goal.z) < 2) { pickDrop(room, e, ai.goal.drop); ai.goal = null; }
  const tg = ai.target && room.ents.get(ai.target);
  let mx = 0, mz = 0;
  if (tg && tg.alive) {
    const d = dist(e, tg) || 0.1; e.yaw = Math.atan2(tg.x - e.x, tg.z - e.z) + Math.PI; const fx = (tg.x - e.x) / d, fz = (tg.z - e.z) / d;
    const w = botWeapon(e, d); const W = w && SH.WEAPONS[w];
    if (Math.random() < dt * (0.5 + ai.skill)) ai.strafe = -ai.strafe;
    const want = !W ? 1 : w === 'shotgun' ? 5 : w === 'smg' ? 10 : w === 'lance' ? 35 : ops ? 14 : 15; const near = d > want + 3 ? 1 : d < want - 4 ? -0.6 : 0;
    mx = fx * near + -fz * ai.strafe * 0.75; mz = fz * near + fx * ai.strafe * 0.75;
    // jump now and then while fighting (harder to hit)
    if (!ops && e.y <= 0 && Math.random() < dt * ai.skill * 0.9) ai.vy = 6.5;
    // under fire with materials: build a wall and keep fighting from behind it
    if (!ops && T - ai.hurtAt < 600 && T > ai.buildAt && Math.random() < 0.25 + ai.skill * 0.6) { const from = room.ents.get(ai.by) || tg; if (botBuild(room, e, from)) { ai.buildAt = T + 2500 - ai.skill * 1200; } }
    if (W && w) { e.w = w; }
    if (!W && d < 2.4 && T - (e.last.pick || 0) > 650) { e.last.pick = T; send(room, { t: 'ar_fx', id: e.id, w: 'pick', to: null }); if (Math.random() < 0.5 + ai.skill * 0.4) damage(room, e, tg, 20, 'pick', false); }
    if (W && d <= W.range && T > ai.react && T - (e.last[w] || 0) > W.rate * 1000 * (ops ? 2 : 2.3) * (1.25 - ai.skill * 0.4)) {
      e.last[w] = T; send(room, { t: 'ar_fx', id: e.id, w, to: [tg.x + rand(-0.4, 0.4), tg.y + 1.2, tg.z + rand(-0.4, 0.4)] });
      if (los(room, e, tg)) {
        // accuracy: skill, distance against the weapon's range, target moving / crouching / in the air, bot moving
        const moving = (tg.a & 1) ? 0.8 : 1; const crouch = (tg.a & 2) ? 0.85 : 1; const air = (tg.a & 4) || tg.y > 0.5 ? 0.75 : 1; const self = (mx || mz) ? 0.85 : 1;
        const p = Math.max(0.05, Math.min(0.92, (0.25 + ai.skill * 0.7) * (1 - Math.min(1, d / (W.range * 1.1)) * 0.6) * moving * crouch * air * self));
        const rar = room.game === 'royale' ? SH.RARITY[(e.inv.find((x) => x.w === w) || { r: 0 }).r].m : 1;
        const pellets = W.pellets ? Math.round(W.pellets * (0.25 + 0.5 * Math.max(0, 1 - d / W.range))) : 1;
        if (Math.random() < p) damage(room, e, tg, W.dmg * pellets * rar * (Math.random() < 0.06 + ai.skill * 0.12 ? W.head : 1) * (ops ? 0.9 : 0.85), w, false);
      }
    }
  } else if (ai.goal) { const d = Math.hypot(ai.goal.x - e.x, ai.goal.z - e.z) || 1; mx = (ai.goal.x - e.x) / d; mz = (ai.goal.z - e.z) / d; e.yaw = Math.atan2(mx, mz) + Math.PI; }
  // stuck: break a build in the way, or take a short detour (and hop)
  if (ai.detour && T < ai.detour.until) { mx = ai.detour.x; mz = ai.detour.z; }
  const sp = (room.game === 'duel' ? 4.8 : 4.6) * dt * (ai.goal && ai.goal.storm ? 1.3 : 1); const nx = e.x + mx * sp, nz = e.z + mz * sp;
  if (!blocked(room, nx, e.z, e.y)) e.x = nx; if (!blocked(room, e.x, nz, e.y)) e.z = nz;
  e.a = ((mx || mz) ? 1 : 0) | (e.y > 0.2 ? 4 : 0); ai.stuck += dt;
  if (ai.stuck > 1) {
    if (Math.hypot(e.x - ai.lx, e.z - ai.lz) < 0.6 && (mx || mz)) {
      let broke = false; if (!ops) for (const p of room.builds.values()) { const b = SH.pieceBox(p); if (b && Math.hypot(b.x - e.x, b.z - e.z) < 3) { hitBuild(room, p.id, 60); broke = true; break; } }
      if (!broke) { const a = rand(0, Math.PI * 2); ai.detour = { x: Math.cos(a), z: Math.sin(a), until: T + 1400 }; if (!ai.goal || !ai.goal.storm) ai.goal = null; if (e.y <= 0) ai.vy = 6; }
    }
    ai.stuck = 0; ai.lx = e.x; ai.lz = e.z;
  }
}
// ---------- royale loot helpers ----------
function openChest(room, e, i) {
  room.chestsOpen.add(i); const it = lootRoll(); giveItem(e, it); e.mats = Math.min(999, e.mats + 30); if (Math.random() < 0.35) e.armor = Math.min(100, e.armor + 50);
  const heal = Math.random() < 0.45 ? (Math.random() < 0.55 ? 'med' : 'sh') : null; if (heal) e.heals[heal] = Math.min(6, e.heals[heal] + 1);
  send(room, { t: 'ar_chest', i }); send1(e, { t: 'ar_you', inv: e.inv, mats: e.mats, armor: e.armor, got: it, heals: e.heals, gotHeal: heal });
}
function useHeal(room, e, k) {
  const H = SH.HEALS[k]; if (!H || !e.alive || !(e.heals[k] > 0)) return; const t = now(); if (t - (e.last['heal'] || 0) < H.cd * 1000) return;
  if (k === 'med' && e.hp >= 100) return; if (k === 'sh' && e.armor >= 100) return;
  e.last['heal'] = t; e.heals[k]--; if (H.hp) e.hp = Math.min(100, e.hp + H.hp); if (H.armor) e.armor = Math.min(100, e.armor + H.armor);
  send1(e, { t: 'ar_you', heals: e.heals, armor: e.armor, healed: k }); send1(e, { t: 'ar_hurt', by: null, hp: Math.round(e.hp), armor: Math.round(e.armor), heal: true });
}
// eliminated players drop their weapons in a loot pile anyone can pick up (E)
function dropLoot(room, target) {
  room.drops = room.drops || new Map(); const id = rid(5); const dp = { x: target.x, z: target.z, items: target.inv.slice(), heals: Object.assign({}, target.heals), mats: Math.floor(target.mats / 2) };
  room.drops.set(id, dp); send(room, { t: 'ar_drop', id, x: dp.x, z: dp.z, n: dp.items.length, r: Math.max(0, ...dp.items.map((x) => x.r)) });
}
function pickDrop(room, e, id) {
  const dp = room.drops && room.drops.get(id); if (!dp || Math.hypot(dp.x - e.x, dp.z - e.z) > 3) return;
  for (const it of dp.items) giveItem(e, it); for (const k of ['med', 'sh']) e.heals[k] = Math.min(6, e.heals[k] + (dp.heals[k] || 0)); e.mats = Math.min(999, e.mats + dp.mats);
  room.drops.delete(id); send(room, { t: 'ar_undrop', id }); send1(e, { t: 'ar_you', inv: e.inv, mats: e.mats, heals: e.heals });
}

// ---------- Duels ----------
const DUEL = { pre: 3000, live: 45000, post: 2600, end: 12000, wait: 10000, privWait: 90000 };
function duelRound(room) {
  room.round++; const w = SH.DUEL_ROT[(room.round - 1) % SH.DUEL_ROT.length];
  room.phase = 'buy'; room.frozen = true; room.until = now() + DUEL.pre;
  for (const e of room.ents.values()) { const s = room.map.spawns[e.team][0]; Object.assign(e, { x: s.x, y: 0, z: s.z + rand(-1, 1), yaw: s.yaw, pitch: 0, hp: 100, armor: 50, alive: true, inv: [{ w, r: 0 }], w, slot: 0 }); if (e.ai) { e.ai.goal = null; e.ai.target = null; } }
  send(room, { t: 'ar_round', round: room.round, score: room.score, phase: 'buy', until: room.until, weapon: w });
  for (const e of room.ents.values()) send1(e, { t: 'ar_you', inv: e.inv, armor: e.armor, x: e.x, z: e.z, yaw: e.yaw, hp: e.hp, money: 0 });
}
function duelEndRound(room, winner, why) {
  if (room.phase !== 'live') return; room.phase = 'post'; room.until = now() + DUEL.post; if (winner) room.score[winner]++;
  send(room, { t: 'ar_rend', winner, why, score: room.score });
  if (winner && room.score[winner] >= SH.DUEL_WIN) duelFinish(room, winner, 'score');
}
function duelFinish(room, winner, why) {
  if (room.done) return; room.done = true; room.phase = 'end'; room.until = now() + DUEL.end;
  const ents = [...room.ents.values()]; const vsBot = ents.some((x) => x.bot); const pot = room.pot || 0; const prize = Math.floor(pot * 0.95);
  for (const e of ents) {
    if (!e.uid) continue; const u = S.users[e.uid]; if (!u) continue; const won = e.team === winner;
    if (won && prize) require('./economy').adjust(u, prize, 'duel:pot');
    const coins = reward(e.uid, won ? (vsBot ? 25 : 90) : (vsBot ? 5 : 20), 'duel');
    if (won && !vsBot) { u.duelWins = (u.duelWins || 0) + 1; if (u.duelWins === 10) require('./economy').grant(u, 'title_duelist'); if (u.duelWins === 25) require('./economy').grant(u, 'wrap_duel'); S.store.touch('users'); }
    const rk = room.ranked ? require('./ranked').result(u, 'duel', { won, vsBot }) : null;
    send1(e, { t: 'ar_end', won, coins, prize: won ? prize : 0, pot, score: room.score, board: board(room), why, rk, duel: true });
  }
  room.escrow = null; // the pot has been paid
}
function duelTick(room) {
  const t = now();
  if (room.phase === 'wait') {
    const hs = humans(room);
    if (hs.length >= 2) { room.score = { atk: 0, def: 0 }; room.round = 0; duelRound(room); return; }
    if (t > room.until) { if (room.priv || !hs.length) return closeRoom(room); const b = ent(room, { bot: true, team: hs[0].team === 'atk' ? 'def' : 'atk', name: BOT_NAMES[Math.floor(rand(0, BOT_NAMES.length))] + ' ' + (10 + Math.floor(rand(0, 89))) }); send(room, { t: 'ar_ent', e: meta(b) }); room.score = { atk: 0, def: 0 }; room.round = 0; duelRound(room); }
    return;
  }
  if (room.phase === 'buy' && t > room.until) { room.phase = 'live'; room.frozen = false; room.until = t + DUEL.live; send(room, { t: 'ar_phase', phase: 'live', until: room.until }); }
  if (room.phase === 'post' && t > room.until) { duelRound(room); return; }
  if (room.phase === 'end') { if (t > room.until) closeRoom(room); return; }
  if (room.phase !== 'live') return;
  if (t > room.until) { const [a, b] = ['atk', 'def'].map((tm) => [...room.ents.values()].find((e) => e.team === tm)); const win = a && b ? (a.hp > b.hp ? 'atk' : b.hp > a.hp ? 'def' : null) : null; return duelEndRound(room, win, 'time'); }
  for (const e of room.ents.values()) if (e.bot && e.alive) botThink(room, e, 0.05);
}

// ---------- rooms ----------
const GAMES = ['ops', 'royale', 'duel'];
async function newRoom(game, opts = {}) {
  await shared();
  const room = { id: rid(6), game, ents: new Map(), phase: game === 'ops' ? 'warm' : game === 'duel' ? 'wait' : 'lobby', until: now() + (game === 'ops' ? 5000 : game === 'duel' ? (opts.priv ? DUEL.privWait : DUEL.wait) : 20000), created: now(), builds: new Map(), score: { atk: 0, def: 0 }, round: 0,
    seed: game === 'royale' ? 'nebula-royale-' + Math.floor(Math.random() * 5) : game === 'duel' ? 'court' : 'depot', ranked: !!opts.ranked, priv: opts.priv || null, allowed: opts.allowed || null, pot: opts.pot || 0, escrow: opts.escrow || null, botBoost: opts.botBoost || 0 };
  room.map = game === 'ops' ? SH.opsMap() : game === 'duel' ? SH.duelMap() : SH.royaleMap(room.seed); rooms.set(room.id, room);
  if (game === 'ops') { for (let i = 0; i < OPS_MAX; i++) ent(room, { bot: true, team: 'atk', name: BOT_NAMES[i] }); for (let i = 0; i < OPS_MAX; i++) ent(room, { bot: true, team: 'def', name: BOT_NAMES[i + 8] }); }
  if (!timer) timer = setInterval(tickAll, 50);
  return room;
}
function closeRoom(room) {
  // a duel that never finished gives every bet back
  if (room.escrow) { for (const [uid, amt] of Object.entries(room.escrow)) { const u = S.users[uid]; if (u && amt > 0) { require('./economy').adjust(u, amt, 'duel:refund'); require('./state').hub.push(uid, { t: 'notice', text: `↩️ Duel cancelled: ${amt} coins returned`, es: `↩️ Duelo cancelado: se te devuelven ${amt} monedas` }); } } room.escrow = null; }
  for (const e of humans(room)) if (e.conn) { e.conn.data.arena = null; e.conn.send({ t: 'ar_closed' }); } rooms.delete(room.id);
}
async function join(conn, u, game, opts = {}) {
  if (!GAMES.includes(game)) return; await shared();
  leave(conn, u);
  const ranked = !!opts.ranked; let room = null;
  if (opts.room) { room = rooms.get(String(opts.room)); if (!room || room.game !== game || (room.allowed && !room.allowed.includes(u.id)) || room.phase === 'end') { conn.send({ t: 'ar_closed', why: 'gone' }); return; } }
  else room = [...rooms.values()].find((r) => r.game === game && !r.priv && r.ranked === ranked && (game === 'ops' ? r.phase !== 'end' && humans(r).length < OPS_MAX * 2 : game === 'duel' ? r.phase === 'wait' && humans(r).length < 2 : r.phase === 'lobby' && humans(r).length < ROYALE_MAX));
  if (!room) { const boost = ranked ? 0.08 + require('./ranked').avgTier([u], game) * 0.05 : 0; room = await newRoom(game, { ranked, botBoost: boost }); }
  let e;
  if (game === 'ops') { // take a bot's place on the team with fewer people
    const team = humans(room).filter((x) => x.team === 'atk').length <= humans(room).filter((x) => x.team === 'def').length ? 'atk' : 'def';
    const bot = [...room.ents.values()].find((x) => x.bot && x.team === team); if (bot) { room.ents.delete(bot.id); if (room.carrier === bot.id) room.carrier = u.id; send(room, { t: 'ar_gone', id: bot.id }); }
    e = ent(room, { uid: u.id, conn, team }); Object.assign(e, { x: bot ? bot.x : 0, z: bot ? bot.z : 30, y: 0, yaw: bot ? bot.yaw : 0, alive: room.phase === 'warm' || room.phase === 'buy' || (bot ? bot.alive : false), hp: bot ? bot.hp : 100, money: bot ? bot.money : 800, inv: bot ? bot.inv : [{ w: 'pistol', r: 0 }], w: bot ? bot.w : 'pistol', armor: bot ? bot.armor : 0, kills: bot ? bot.kills : 0, deaths: bot ? bot.deaths : 0 });
  } else if (game === 'duel') {
    const taken = [...room.ents.values()].map((x) => x.team); const team = taken.includes('atk') ? 'def' : 'atk'; const s = room.map.spawns[team][0];
    e = ent(room, { uid: u.id, conn, team }); Object.assign(e, { x: s.x, z: s.z, y: 0, yaw: s.yaw, alive: true, hp: 100, inv: [{ w: 'pistol', r: 0 }], w: 'pistol' });
  } else { e = ent(room, { uid: u.id, conn }); e.alive = true; }
  conn.data.arena = room.id;
  conn.send({ t: 'ar_hello', room: room.id, game, you: e.id, seed: room.seed, phase: room.phase, until: room.until, score: room.score, round: room.round, carrier: room.carrier, core: room.core, coreDrop: room.coreDrop, ship: room.ship || null, storm: room.storm || null, ranked: room.ranked, pot: room.pot || 0, priv: !!room.priv,
    builds: [...room.builds.values()], chests: room.chestsOpen ? [...room.chestsOpen] : [], drops: room.drops ? [...room.drops].map(([id, d]) => ({ id, x: d.x, z: d.z, n: d.items.length, r: Math.max(0, ...d.items.map((x) => x.r)) })) : [], ents: [...room.ents.values()].map(meta), me: { money: e.money, inv: e.inv, armor: e.armor, mats: e.mats, team: e.team, x: e.x, z: e.z, yaw: e.yaw, hp: e.hp, alive: e.alive, inShip: !!e.inShip, heals: e.heals } });
  send(room, { t: 'ar_ent', e: meta(e) }, e);
}
function leave(conn, u) {
  const room = conn.data && conn.data.arena && rooms.get(conn.data.arena); if (!room) return; conn.data.arena = null;
  const e = room.ents.get(u.id); if (!e || e.conn !== conn) return; room.ents.delete(u.id); send(room, { t: 'ar_gone', id: u.id });
  const started = room.game === 'ops' ? room.phase !== 'warm' && room.phase !== 'end' && !room.done : room.game === 'duel' ? room.phase !== 'wait' && room.phase !== 'end' : room.phase !== 'lobby' && room.phase !== 'end';
  // leaving a ranked match half way counts as a heavy loss (not for Royale players who were already eliminated)
  if (room.ranked && started && !e.rkDone && (room.game !== 'royale' || e.alive)) { try { require('./ranked').result(u, room.game, { abandon: true }); } catch (err) { console.error('[arena] abandon', err); } }
  if (room.game === 'ops' && room.phase !== 'end') { const b = ent(room, { bot: true, team: e.team, name: BOT_NAMES[Math.floor(rand(0, BOT_NAMES.length))] }); Object.assign(b, { x: e.x, z: e.z, y: 0, alive: e.alive, hp: e.hp, inv: e.inv, w: e.w, money: e.money, armor: e.armor }); if (room.carrier === u.id) room.carrier = b.id; send(room, { t: 'ar_ent', e: meta(b) }); }
  // a duel: whoever stays wins by forfeit (and takes the pot)
  if (room.game === 'duel' && started && !room.done) { const other = [...room.ents.values()].find((x) => x.team !== e.team); if (other) { room.phase = 'live'; duelFinish(room, other.team, 'forfeit'); } }
  if (!humans(room).length) closeRoom(room);
}
let snapT = 0;
function tickAll() {
  const dt = 0.05; snapT++;
  for (const room of rooms.values()) {
    try { if (room.game === 'ops') opsTick(room, dt); else if (room.game === 'duel') duelTick(room); else royaleTick(room, dt); } catch (err) { console.error('[arena] tick', err); }
    if (snapT % 2 === 0 && rooms.has(room.id)) { const list = [...room.ents.values()].map(snap); const extra = room.game === 'ops' ? { pl: room.plant ? room.plant.id : null } : room.game === 'royale' ? { st: room.storm ? [Math.round(room.storm.cx), Math.round(room.storm.cz), Math.round(room.storm.r * 10) / 10] : null } : {}; send(room, Object.assign({ t: 'ar_s', l: list }, extra)); }
  }
  if (!rooms.size) { clearInterval(timer); timer = null; }
}

// ---------- duel challenges (from routes/arena-routes.js) ----------
const challenges = new Map(); // id -> { id, from, to, bet, ranked, exp }
function challenge(from, to, bet) {
  for (const [k, c] of challenges) if (c.exp < now()) challenges.delete(k);
  if ([...challenges.values()].filter((c) => c.from === from.id).length >= 3) throw new (require('./util').HttpError)(429, 'too_many', 'You already have 3 open challenges');
  const c = { id: rid(8), from: from.id, to: to.id, bet, exp: now() + 120000 }; challenges.set(c.id, c); return c;
}
async function accept(u, id) {
  const { HttpError } = require('./util'); const econ = require('./economy'); const c = challenges.get(String(id || ''));
  if (!c || c.to !== u.id || c.exp < now()) throw new HttpError(404, 'gone', 'This challenge has expired');
  const a = S.users[c.from]; if (!a) throw new HttpError(404, 'gone', 'The challenger is gone'); challenges.delete(c.id);
  const escrow = {};
  if (c.bet > 0) {
    if (!econ.adjust(u, -c.bet, 'duel:bet')) throw new HttpError(402, 'no_funds', 'You do not have enough coins for this bet');
    escrow[u.id] = c.bet;
    if (!econ.adjust(a, -c.bet, 'duel:bet')) { econ.adjust(u, c.bet, 'duel:refund'); throw new HttpError(402, 'no_funds', 'The challenger no longer has enough coins'); }
    escrow[a.id] = c.bet;
  }
  const room = await newRoom('duel', { priv: c.id, allowed: [a.id, u.id], pot: c.bet * 2, escrow: c.bet > 0 ? escrow : null });
  return { room: room.id, from: a };
}
function decline(u, id) { const c = challenges.get(String(id || '')); if (c && (c.to === u.id || c.from === u.id)) challenges.delete(c.id); return c; }
const invitesFor = (uid) => [...challenges.values()].filter((c) => c.to === uid && c.exp > now());

// ---------- messages ----------
const num = (v, lo, hi) => { v = Number(v); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0; };
function onMessage(conn, u, m) {
  if (!msgLim.hit(u.id)) return;
  if (m.t === 'ar_join') return void join(conn, u, String(m.game || ''), { ranked: !!m.ranked, room: m.room ? String(m.room) : null });
  if (m.t === 'ar_leave') return leave(conn, u);
  const room = conn.data.arena && rooms.get(conn.data.arena); if (!room) return; const e = room.ents.get(u.id); if (!e || e.conn !== conn) return;
  if (m.t === 'ar_state') {
    if (!e.alive || e.inShip) return; const x = num(m.x, -400, 400), y = num(m.y, -5, 120), z = num(m.z, -400, 400); const t = now(); const dtm = Math.max(0.05, (t - e.lastMove) / 1000); e.lastMove = t;
    const sp = Math.hypot(x - e.x, z - e.z) / dtm; if (room.frozen && Math.hypot(x - e.x, z - e.z) > 0.5) { send1(e, { t: 'ar_pos', x: e.x, z: e.z }); return; }
    if (sp > (e.falling || y > 3 ? 40 : 16)) { send1(e, { t: 'ar_pos', x: e.x, z: e.z, y: e.y }); return; } // too fast: snap back
    if (e.falling && y <= 0.2) e.falling = false;
    Object.assign(e, { x, y, z, yaw: num(m.yaw, -100, 100), pitch: num(m.pitch, -2, 2), a: Math.trunc(num(m.a, 0, 31)) }); if (m.w && SH.WEAPONS[m.w] && e.inv.some((it) => it.w === m.w)) e.w = m.w;
    if (room.game === 'ops' && room.plant && room.plant.id === e.id && Math.hypot(x - room.plant.x, z - room.plant.z) > 1.2) room.plant = null;
  } else if (m.t === 'ar_shot') onShot(room, e, m);
  else if (m.t === 'ar_buy' && room.game === 'ops' && (room.phase === 'buy' || (room.phase === 'live' && now() < room.until - OPS.live + 15000))) {
    const it = String(m.item || ''); const W = SH.WEAPONS[it];
    if (W && W.price && e.money >= W.price) { e.money -= W.price; e.inv = e.inv.filter((x) => SH.WEAPONS[x.w].slot !== W.slot); e.inv.unshift({ w: it, r: 0 }); e.w = it; }
    else if (it === 'armor' && e.money >= SH.ARMOR_PRICE && e.armor < 100) { e.money -= SH.ARMOR_PRICE; e.armor = 100; }
    else if (it === 'kit' && e.team === 'def' && !e.kit && e.money >= SH.KIT_PRICE) { e.money -= SH.KIT_PRICE; e.kit = true; }
    send1(e, { t: 'ar_you', money: e.money, inv: e.inv, armor: e.armor, kit: e.kit });
  } else if (m.t === 'ar_plant' && room.game === 'ops' && room.phase === 'live' && e.alive && room.carrier === e.id && !room.core) {
    const site = Object.entries(room.map.sites).find(([, s]) => Math.hypot(e.x - s.x, e.z - s.z) < s.r); if (site) room.plant = { id: e.id, x: e.x, z: e.z, at: now(), site: site[0] };
  } else if (m.t === 'ar_defuse' && room.game === 'ops' && room.phase === 'live' && e.alive && e.team === 'def' && room.core && Math.hypot(e.x - room.core.x, e.z - room.core.z) < 1.8) {
    if (!room.defuse) { room.defuse = { id: e.id, at: now() }; send(room, { t: 'ar_defuse', id: e.id }); }
  } else if (m.t === 'ar_jump' && room.game === 'royale' && e.inShip) jump(room, e);
  else if (m.t === 'ar_open' && room.game === 'royale' && e.alive) {
    const i = Math.trunc(num(m.i, 0, 9999)); const c = room.map.chests[i]; if (!c || room.chestsOpen.has(i) || Math.hypot(c.x - e.x, c.z - e.z) > 3) return;
    openChest(room, e, i);
  } else if (m.t === 'ar_pick' && room.game === 'royale' && e.alive) pickDrop(room, e, String(m.id || ''));
  else if (m.t === 'ar_use' && room.game === 'royale') useHeal(room, e, m.k === 'sh' ? 'sh' : 'med');
  else if (m.t === 'ar_emote') { const t = now(); if (t - (e.last.emote || 0) < 2500 || !e.alive) return; const k = String(m.k || ''); const own = (e.lk && e.lk.emotes || []).some((x) => x.k === k) || k === 'wave'; if (!own) return; e.last.emote = t; send(room, { t: 'ar_emote', id: e.id, k }); }
  else if (m.t === 'ar_harvest' && room.game === 'royale' && e.alive) {
    const t = now(); if (t - (e.last.harvest || 0) < 450) return; e.last.harvest = t; const tr = room.map.trees[Math.trunc(num(m.i, 0, 9999))]; const rk = m.rock !== undefined && room.map.rocks[Math.trunc(num(m.rock, 0, 9999))];
    const obj = tr || rk; if (!obj || Math.hypot(obj.x - e.x, obj.z - e.z) > obj.r + 3) return; e.mats = Math.min(999, e.mats + (rk ? 12 : 8)); send1(e, { t: 'ar_you', mats: e.mats });
  } else if (m.t === 'ar_build' && room.game === 'royale' && e.alive && !e.inShip) {
    const k = ['wall', 'floor', 'ramp'].includes(m.k) ? m.k : null; if (!k || e.mats < SH.BUILD_COST || room.builds.size > 1500) return;
    const p = { id: rid(6), k, gx: Math.trunc(num(m.gx, -60, 60)), gy: Math.trunc(num(m.gy, 0, 12)), gz: Math.trunc(num(m.gz, -60, 60)), dir: Math.trunc(num(m.dir, 0, 3)), hp: SH.BUILD_HP, owner: e.id };
    if (Math.hypot(p.gx * SH.CELL - e.x, p.gz * SH.CELL - e.z) > 10 || Math.abs(p.gy * SH.CELL - e.y) > 9) return;
    if ([...room.builds.values()].some((q) => q.k === p.k && q.gx === p.gx && q.gy === p.gy && q.gz === p.gz && (q.k !== 'wall' || q.dir === p.dir))) return;
    e.mats -= SH.BUILD_COST; room.builds.set(p.id, p); send(room, { t: 'ar_build', p }); send1(e, { t: 'ar_you', mats: e.mats });
  } else if (m.t === 'ar_hitbuild' && room.game === 'royale' && e.alive) { const t = now(); if (t - (e.last.pick || 0) < 400) return; e.last.pick = t; hitBuild(room, String(m.id || ''), 40); }
  else if (m.t === 'ar_slot') { const i = Math.trunc(num(m.i, 0, 4)); if (e.inv[i]) { e.slot = i; e.w = e.inv[i].w; } }
}
function onClose(conn, u) { if (conn.data && conn.data.arena) leave(conn, u); }
const stats = () => [...rooms.values()].map((r) => ({ id: r.id, game: r.game, phase: r.phase, humans: humans(r).length, ents: r.ents.size, ranked: r.ranked }));
module.exports = { onMessage, onClose, stats, shared, challenge, accept, decline, invitesFor };
