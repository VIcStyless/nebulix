'use strict';
// World Boss: a live event for everyone. Every 2 hours (UTC, on even hours) an original giant monster appears for
// 20 minutes. Everyone online attacks it together (taps / clicks over the WebSocket, rate-limited on the server)
// and can buy power attacks with coins. Its health grows with every new fighter. If it falls, the reward pool is
// shared by damage; the top three get gems and the last hit a bonus. If time runs out, fighters get a small consolation.
const { S, hub, publicUser } = require('./state');
const { now, HttpError } = require('./util');

const EVERY = 2 * 3600000; const LEN = 20 * 60000;
const BOSSES = [
  ['devourer', ['Star Devourer', 'Devorador de Estrellas'], '🌑', '#a855f7'],
  ['kraken', ['Void Kraken', 'Kraken del Vacío'], '🐙', '#06b6d4'],
  ['golem', ['Neon Golem', 'Gólem de Neón'], '🗿', '#22c55e'],
  ['dragon', ['Solar Dragon', 'Dragón Solar'], '🐉', '#f97316'],
  ['wraith', ['Comet Wraith', 'Espectro Cometa'], '👻', '#e2e8f0'],
].map(([id, n, icon, color]) => ({ id, n, icon, color }));
const POWERS = [
  ['bomb', ['Nova bomb', 'Bomba nova'], '💣', 1000, 6000],
  ['laser', ['Orbital laser', 'Láser orbital'], '🔆', 5000, 34000],
  ['meteor', ['Meteor strike', 'Lluvia de meteoritos'], '☄️', 20000, 150000],
].map(([id, n, icon, price, dmg]) => ({ id, n, icon, price, dmg }));
const P_BY = new Map(POWERS.map((p) => [p.id, p]));
const BASE = 60000; const PER = 45000; // HP: base + per fighter
const RATE = 14; // max hits per second per player

let fight = null; // { slot, boss, start, end, hp, max, dmg: Map(uid -> n), hits: Map(uid -> n), bucket: Map(uid -> {tok, at}), over, won, lastHit }
const slotOf = (t) => Math.floor(t / EVERY);
const bossFor = (slot) => BOSSES[slot % BOSSES.length];
function begin(t, forced) {
  if (fight && !fight.over) finish(false);
  const slot = slotOf(t); const start = forced ? t : slot * EVERY;
  fight = { slot, boss: bossFor(slot), start, end: start + LEN, hp: BASE, max: BASE, dmg: new Map(), hits: new Map(), bucket: new Map(), over: false, won: false, lastHit: null };
  hub.pushMany([...hub.conns.keys()], { t: 'boss', ev: 'spawn', boss: pub(fight.boss), end: fight.end });
}
const pub = (b) => ({ id: b.id, n: b.n, icon: b.icon, color: b.color });
function top(n = 10) { if (!fight) return []; return [...fight.dmg.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([id, d], i) => (S.users[id] ? { rank: i + 1, user: publicUser(S.users[id]), dmg: d } : null)).filter(Boolean); }
function live() { const f = fight; return f && !f.over ? { boss: pub(f.boss), hp: Math.max(0, Math.round(f.hp)), max: f.max, end: f.end, fighters: f.dmg.size, top: top(5) } : null; }
function nextAt(t = now()) { const s = slotOf(t); const cur = s * EVERY; return t < cur + LEN && !(fight && fight.slot === s && fight.over) ? cur : (s + 1) * EVERY; }
function view(u) {
  const t = now(); tick();
  const f = fight && !fight.over ? fight : null;
  return { live: f ? Object.assign(live(), { myDmg: f.dmg.get(u.id) || 0, myRank: [...f.dmg.entries()].sort((a, b) => b[1] - a[1]).findIndex(([id]) => id === u.id) + 1 || null, top: top(10) }) : null,
    next: nextAt(t), nextBoss: pub(bossFor(slotOf(nextAt(t)))), powers: POWERS.map((p) => ({ id: p.id, n: p.n, icon: p.icon, price: p.price, dmg: p.dmg })), last: S.meta.bossLast || null, kills: (u.bossStats && u.bossStats.kills) || 0, best: (u.bossStats && u.bossStats.best) || 0, len: LEN, every: EVERY };
}
function join(f, u) { if (!f.dmg.has(u.id)) { f.dmg.set(u.id, 0); f.hits.set(u.id, 0); f.max += PER; f.hp += PER; } }
function deal(u, n, lastBy) {
  const f = fight; if (!f || f.over || now() >= f.end) return 0; join(f, u);
  n = Math.max(0, Math.min(f.hp, n)); f.hp -= n; f.dmg.set(u.id, f.dmg.get(u.id) + n); dirty = true;
  if (f.hp <= 0) { f.lastHit = lastBy || u.id; finish(true); }
  return n;
}
// WebSocket: { t: 'boss_hit', n } — n taps since the last message
function onMessage(conn, u, m) {
  if (m.t !== 'boss_hit') return; const f = fight; if (!f || f.over) return;
  const t = now(); const b = f.bucket.get(u.id) || { tok: RATE * 2, at: t }; b.tok = Math.min(RATE * 2, b.tok + ((t - b.at) / 1000) * RATE); b.at = t;
  const want = Math.max(0, Math.min(40, Math.trunc(Number(m.n) || 0))); const n = Math.min(want, Math.floor(b.tok)); b.tok -= n; f.bucket.set(u.id, b); if (!n) return;
  const lvl = require('./progress').levelOfUser ? require('./progress').levelOfUser(u) : 1;
  let dmg = 0; let crits = 0; for (let i = 0; i < n; i++) { const c = Math.random() < 0.1; if (c) crits++; dmg += (14 + Math.min(40, Math.floor(lvl / 2)) + Math.floor(Math.random() * 8)) * (c ? 3 : 1); }
  f.hits.set(u.id, (f.hits.get(u.id) || 0) + n);
  const done = deal(u, dmg); conn.send({ t: 'boss_dmg', dmg: done, crits });
}
function power(u, id) {
  const p = P_BY.get(id); if (!p) throw new HttpError(404, 'no_power', 'Unknown attack');
  const f = fight; if (!f || f.over || now() >= f.end) throw new HttpError(409, 'no_boss', 'There is no boss right now');
  if (!require('./economy').adjust(u, -p.price, 'boss:' + p.id)) throw new HttpError(402, 'no_coins', 'Not enough coins');
  const dmg = deal(u, p.dmg); hub.pushMany([...hub.conns.keys()], { t: 'boss', ev: 'power', by: u.username, icon: p.icon, dmg });
  return Object.assign(view(u), { dealt: dmg });
}
function finish(won) {
  const f = fight; if (!f || f.over) return; f.over = true; f.won = won; const econ = require('./economy');
  const ranked = [...f.dmg.entries()].filter(([id, d]) => d > 0 && S.users[id]).sort((a, b) => b[1] - a[1]);
  const total = ranked.reduce((a, [, d]) => a + d, 0) || 1; const pool = Math.min(250000, 25000 + 10000 * ranked.length); const results = [];
  ranked.forEach(([id, d], i) => {
    const u = S.users[id]; let coins; let gems = 0;
    if (won) { coins = Math.max(200, Math.floor(pool * (d / total))); if (i < 3 && ranked.length >= 2) gems = [25, 15, 10][i]; if (f.lastHit === id) coins += 2500; }
    else coins = Math.min(400, 50 + Math.floor(d / 400));
    econ.adjust(u, coins, 'boss:' + (won ? 'win' : 'escape')); if (gems) econ.adjustGems(u, gems, 'boss:top');
    u.bossStats = u.bossStats || { kills: 0, best: 0 }; if (won) u.bossStats.kills++; u.bossStats.best = Math.max(u.bossStats.best, d);
    results.push({ id, rank: i + 1, dmg: d, coins, gems });
    try { require('./progress').award(u, 'arcade', 1); } catch {}
    hub.push(id, { t: 'notice', text: won ? `${f.boss.icon} ${f.boss.n[0]} defeated! You dealt ${d} damage (#${i + 1}) and get ${coins} coins${gems ? ' + ' + gems + ' gems' : ''}.` : `${f.boss.icon} ${f.boss.n[0]} escaped. Consolation: ${coins} coins.`,
      es: won ? `${f.boss.icon} ¡${f.boss.n[1]} derrotado! Has hecho ${d} de daño (#${i + 1}) y ganas ${coins} monedas${gems ? ' + ' + gems + ' gemas' : ''}.` : `${f.boss.icon} ${f.boss.n[1]} ha escapado. Premio de consolación: ${coins} monedas.` });
  });
  S.meta.bossLast = { boss: pub(f.boss), won, at: now(), fighters: ranked.length, max: f.max, lastHit: f.lastHit && S.users[f.lastHit] ? publicUser(S.users[f.lastHit]) : null,
    top: results.slice(0, 5).map((r) => ({ rank: r.rank, user: publicUser(S.users[r.id]), dmg: r.dmg, coins: r.coins, gems: r.gems })) };
  if (ranked.length) { const tu = S.users[ranked[0][0]]; require('./feed').add('boss', f.boss.icon, won ? [`${f.boss.n[0]} was defeated by ${ranked.length} fighters. Top damage: @${tu.username}`, `${f.boss.n[1]} ha caído ante ${ranked.length} luchadores. Más daño: @${tu.username}`] : [`${f.boss.n[0]} escaped from ${ranked.length} fighters`, `${f.boss.n[1]} ha escapado de ${ranked.length} luchadores`], { uid: tu.id, link: '#/boss' }); }
  S.store.touch('meta'); S.store.touch('users');
  hub.pushMany([...hub.conns.keys()], { t: 'boss', ev: won ? 'down' : 'gone', boss: pub(f.boss), last: S.meta.bossLast });
}
let dirty = false; let lastPush = 0;
function tick() {
  const t = now(); const s = slotOf(t); const inWindow = t < s * EVERY + LEN;
  if (fight && !fight.over && t >= fight.end) finish(false);
  if (inWindow && (!fight || fight.slot !== s)) begin(t);
  if (fight && !fight.over && (dirty || t - lastPush > 5000) && t - lastPush >= 700) { dirty = false; lastPush = t; hub.pushMany([...hub.conns.keys()], Object.assign({ t: 'boss', ev: 'hp' }, live())); }
}
let timer = null;
function start() { if (!timer) { timer = setInterval(tick, 350); timer.unref && timer.unref(); } }
const banner = () => live();
// the owner can summon a boss outside the schedule (for events)
function summon(u) { if (!u || u.role !== 'owner') throw new HttpError(403, 'forbidden', 'Only the owner can summon a boss'); if (fight && !fight.over) throw new HttpError(409, 'boss_live', 'A boss is already here'); begin(now(), true); return view(u); }
module.exports = { start, view, onMessage, power, banner, summon, BOSSES };
