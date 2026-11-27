'use strict';
// Wallet hub: coin transfers between players, pets (adopt, feed, play — an active pet boosts work pay)
// and loot chests (coins + cosmetics from the Market catalog). Virtual coins only.
const crypto = require('crypto');
const { S, hub, audit, publicUser } = require('../state');
const econ = require('../economy');
const prog = require('../progress');
const { HttpError, now, dayKey, rid } = require('../util');

// ---------------- transfers ----------------
const TX_MAX = 100000; const TX_DAY = 250000;
const banned = (u) => !!(u.banned && (!u.banned.until || u.banned.until > now()));

function transfer(u, body) {
  const amount = Math.trunc(Number(body.amount));
  if (!Number.isFinite(amount) || amount < 1) throw new HttpError(400, 'bad_amount', 'Enter an amount of at least 1 coin');
  if (amount > econ.MAX_COINS) throw new HttpError(400, 'bad_amount', 'That amount is too large');
  if (!body.donation && amount > TX_MAX) throw new HttpError(400, 'bad_amount', 'Up to ' + TX_MAX.toLocaleString('en-US') + ' coins per transfer');
  if (u.infinite) throw new HttpError(403, 'infinite', 'Transfers are disabled for accounts with an unlimited wallet');
  const name = String(body.to || '').trim().replace(/^@/, '').toLowerCase();
  const id = S.byName.get(name); const to = id && S.users[id];
  if (!to || to.deleted || !to.verified) throw new HttpError(404, 'no_user', 'No player with that username');
  if (to.id === u.id) throw new HttpError(400, 'self', 'You cannot send coins to yourself');
  if (banned(to) || banned(u)) throw new HttpError(403, 'banned', 'This transfer is not allowed');
  if ((to.blocked || []).includes(u.id) || (u.blocked || []).includes(to.id)) throw new HttpError(403, 'blocked', 'You cannot send coins to this player');
  const note = String(body.note || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80);
  const day = (u.txDay = u.txDay && u.txDay.d === dayKey() ? u.txDay : { d: dayKey(), sent: 0 });
  // donations (Plaza booths) have no daily cap; plain transfers keep it
  if (!body.donation && day.sent + amount > TX_DAY) throw new HttpError(429, 'daily_cap', 'Daily transfer limit reached (' + TX_DAY.toLocaleString('en-US') + ' coins)');
  if (amount > u.coins) throw new HttpError(402, 'no_funds', 'Not enough coins');
  if (to.coins + amount > econ.MAX_COINS) throw new HttpError(400, 'full', 'That wallet is full');
  // Node runs this synchronously: debit and credit happen together, nothing can interleave.
  if (!econ.adjust(u, -amount, 'transfer:to:@' + to.username)) throw new HttpError(402, 'no_funds', 'Not enough coins');
  econ.adjust(to, amount, 'transfer:from:@' + u.username);
  if (!body.donation) day.sent += amount;
  const rec = { id: rid(6), t: now(), from: u.id, to: to.id, amount, note };
  S.meta.transfers = S.meta.transfers || []; S.meta.transfers.unshift(rec); if (S.meta.transfers.length > 2000) S.meta.transfers.length = 2000;
  S.store.touch('meta'); S.store.touch('users');
  if (amount >= 10000) audit('coin_transfer', u.id, { to: to.id, amount });
  if (!body.donation) hub.push(to.id, { t: 'transfer', from: publicUser(u), amount, note }); // a donation sends its own notice
  return { ok: true, transfer: rec, coins: u.coins, to: publicUser(to) };
}
// Gems can be sent too (3.0 phase 25). Gems are scarce (earned, or 40/day bought with coins), so the caps are small:
// this keeps an army of alt accounts from funnelling gems past the daily exchange limit.
const GEM_TX_MAX = 200; const GEM_TX_DAY = 500;
function transferGems(u, body) {
  const amount = Math.trunc(Number(body.amount));
  if (!Number.isFinite(amount) || amount < 1) throw new HttpError(400, 'bad_amount', 'Enter an amount of at least 1 gem');
  if (amount > GEM_TX_MAX) throw new HttpError(400, 'bad_amount', 'Up to ' + GEM_TX_MAX + ' gems per transfer');
  const name = String(body.to || '').trim().replace(/^@/, '').toLowerCase();
  const id = S.byName.get(name); const to = id && S.users[id];
  if (!to || to.deleted || !to.verified) throw new HttpError(404, 'no_user', 'No player with that username');
  if (to.id === u.id) throw new HttpError(400, 'self', 'You cannot send gems to yourself');
  if (banned(to) || banned(u)) throw new HttpError(403, 'banned', 'This transfer is not allowed');
  if ((to.blocked || []).includes(u.id) || (u.blocked || []).includes(to.id)) throw new HttpError(403, 'blocked', 'You cannot send gems to this player');
  const note = String(body.note || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80);
  const day = (u.gemTxDay = u.gemTxDay && u.gemTxDay.d === dayKey() ? u.gemTxDay : { d: dayKey(), sent: 0 });
  if (day.sent + amount > GEM_TX_DAY) throw new HttpError(429, 'daily_cap', 'Daily gem limit reached (' + GEM_TX_DAY + ' gems)');
  if (amount > (u.gems || 0)) throw new HttpError(402, 'no_gems', 'Not enough gems');
  if ((to.gems || 0) + amount > econ.MAX_GEMS) throw new HttpError(400, 'full', 'That player has the most gems possible');
  if (!econ.adjustGems(u, -amount, 'transfer:to:@' + to.username)) throw new HttpError(402, 'no_gems', 'Not enough gems');
  econ.adjustGems(to, amount, 'transfer:from:@' + u.username);
  day.sent += amount;
  const rec = { id: rid(6), t: now(), from: u.id, to: to.id, amount, note, cur: 'gems' };
  S.meta.transfers = S.meta.transfers || []; S.meta.transfers.unshift(rec); if (S.meta.transfers.length > 2000) S.meta.transfers.length = 2000;
  S.store.touch('meta'); S.store.touch('users');
  if (amount >= 50) audit('gem_transfer', u.id, { to: to.id, amount });
  if (!body.donation) hub.push(to.id, { t: 'transfer', from: publicUser(u), amount, note, cur: 'gems' });
  return { ok: true, transfer: rec, gems: u.gems, coins: u.coins, to: publicUser(to) };
}
const gemLimits = (u) => ({ max: GEM_TX_MAX, day: GEM_TX_DAY, sentToday: u.gemTxDay && u.gemTxDay.d === dayKey() ? u.gemTxDay.sent : 0 });
function transfersOf(u) {
  return (S.meta.transfers || []).filter((x) => x.from === u.id || x.to === u.id).slice(0, 30).map((x) => {
    const other = S.users[x.from === u.id ? x.to : x.from];
    return { id: x.id, t: x.t, amount: x.amount, note: x.note, cur: x.cur || 'coins', dir: x.from === u.id ? 'out' : 'in', user: other ? { id: other.id, username: other.username, displayName: other.displayName || other.username } : null };
  });
}

// ---------------- pets ----------------
// species id, [en, es], emoji, price
const SPECIES = [['cat', ['Cat', 'Gato'], '🐱', 500], ['dog', ['Dog', 'Perro'], '🐶', 500], ['fox', ['Fox', 'Zorro'], '🦊', 1200], ['owl', ['Owl', 'Búho'], '🦉', 1500],
  ['axolotl', ['Axolotl', 'Ajolote'], '🦎', 2500], ['robot', ['Robo-pup', 'Robo-perrito'], '🤖', 4000], ['dragon', ['Dragon', 'Dragón'], '🐉', 10000], ['unicorn', ['Unicorn', 'Unicornio'], '🦄', 15000]]
  .map(([id, n, e, price]) => ({ id, n, e, price }));
const SP_BY = new Map(SPECIES.map((s) => [s.id, s]));
const MAX_PETS = 6; const FEED_COST = 15; const FEED_CD = 60 * 60000; const PLAY_CD = 30 * 60000;
const petXpFor = (L) => 40 * L * (L - 1);
function petLevel(xp) { let L = 1; while (L < 50 && petXpFor(L + 1) <= xp) L++; return L; }
// needs drop over time: hunger −1 every 15 min, joy −1 every 20 min
function decay(p) { const t = now(); p.hunger = Math.max(0, p.hunger - Math.floor((t - p.hAt) / 900000)); p.hAt = t - ((t - p.hAt) % 900000); p.joy = Math.max(0, p.joy - Math.floor((t - p.jAt) / 1200000)); p.jAt = t - ((t - p.jAt) % 1200000); }
function pets(u) { u.pets = u.pets || { active: null, list: [] }; return u.pets; }
function petView(p) { decay(p); const sp = SP_BY.get(p.sp); const lvl = petLevel(p.xp); return { id: p.id, sp: p.sp, e: sp.e, species: sp.n, name: p.name, lvl, xp: p.xp, cur: petXpFor(lvl), next: petXpFor(lvl + 1), hunger: p.hunger, joy: p.joy, born: p.born, feedAt: p.fedAt + FEED_CD, playAt: p.playedAt + PLAY_CD }; }
// active pet: +1% work pay per level (max +25%), only while it is fed and happy (both above 20)
function petBonus(u) { const P = u.pets; if (!P || !P.active) return 0; const p = P.list.find((x) => x.id === P.active); if (!p) return 0; decay(p); if (p.hunger <= 20 || p.joy <= 20) return 0; return Math.min(0.25, petLevel(p.xp) / 100); }
function cleanName(s, fb) { const n = String(s || '').replace(/[\u0000-\u001f‪-‮⁦-⁩]/g, '').trim().slice(0, 20); return n || fb; }

// ---------------- chests ----------------
// coins: [weight, min, max] buckets — expected value ≈ 85% of the price in coins, plus a cosmetic chance on top.
const CHESTS = [
  { id: 'wood', n: ['Wooden chest', 'Cofre de madera'], e: '📦', price: 250, coins: [[50, 50, 150], [35, 150, 300], [12, 300, 600], [3, 600, 1500]], item: 0.08, rar: ['common', 'rare'] },
  { id: 'silver', n: ['Silver chest', 'Cofre de plata'], e: '🎁', price: 1000, coins: [[50, 250, 650], [35, 650, 1200], [12, 1200, 2400], [3, 2400, 6000]], item: 0.15, rar: ['rare', 'epic'] },
  { id: 'gold', n: ['Golden chest', 'Cofre de oro'], e: '👑', price: 5000, coins: [[50, 1300, 3300], [35, 3300, 6000], [12, 6000, 12000], [3, 12000, 30000]], item: 0.25, rar: ['epic', 'legendary'] },
];
const CH_BY = new Map(CHESTS.map((c) => [c.id, c]));
function openChest(u, id) {
  const ch = CH_BY.get(id); if (!ch) throw new HttpError(404, 'no_chest', 'Unknown chest');
  if (!econ.adjust(u, -ch.price, 'chest:' + id)) throw new HttpError(402, 'no_funds', 'Not enough coins');
  const total = ch.coins.reduce((a, b) => a + b[0], 0); let r = crypto.randomInt(0, total); let b = ch.coins[0];
  for (const x of ch.coins) { if (r < x[0]) { b = x; break; } r -= x[0]; }
  const coins = crypto.randomInt(b[1], b[2] + 1); econ.adjust(u, coins, 'chest:' + id + ':reward');
  let item = null;
  if (crypto.randomInt(0, 10000) < ch.item * 10000) {
    const pool = econ.items.filter((it) => ch.rar.includes(it.rarity) && !it.pro && it.cat !== 'perk' && !(u.inv && u.inv[it.id]));
    if (pool.length) { item = pool[crypto.randomInt(0, pool.length)]; u.inv = u.inv || {}; u.inv[item.id] = now(); }
  }
  u.chests = u.chests || { opened: 0, log: [] }; u.chests.opened++; u.chests.log.unshift({ t: now(), id, coins, item: item ? item.id : null }); if (u.chests.log.length > 20) u.chests.log.length = 20;
  S.store.touch('users'); prog.award(u, 'chest');
  return { chest: id, coins, tier: ch.coins.indexOf(b), item, balance: u.coins };
}

module.exports = function register(r) {
  r.get('/api/wallet', { auth: true }, async (c) => {
    const u = c.user; const P = pets(u);
    const inv = Object.keys(u.inv || {}); const cats = {}; for (const id of inv) { const it = econ.byId.get(id); if (it) cats[it.cat] = (cats[it.cat] || 0) + 1; }
    return {
      coins: u.coins, infinite: !!u.infinite, tx: (u.tx || []).slice(0, 40), transfers: transfersOf(u), limits: { max: TX_MAX, day: TX_DAY, sentToday: u.txDay && u.txDay.d === dayKey() ? u.txDay.sent : 0 },
      gems: u.gems || 0, gemLimits: gemLimits(u),
      pets: { active: P.active, list: P.list.map(petView), species: SPECIES, max: MAX_PETS, feedCost: FEED_COST, bonus: petBonus(u) },
      chests: { list: CHESTS.map(({ id, n, e, price, item, rar }) => ({ id, n, e, price, item, rar })), opened: (u.chests || {}).opened || 0, log: ((u.chests || {}).log || []).slice(0, 10) },
      inventory: { total: inv.length, cats, catalog: econ.items.length },
    };
  });
  r.post('/api/wallet/transfer', { auth: true, verified: true, limit: [15, 60000, 'user'] }, async (c) => (String((c.body || {}).currency || '') === 'gems' ? transferGems : transfer)(c.user, c.body));

  r.post('/api/pets/adopt', { auth: true, verified: true, limit: [10, 60000, 'user'] }, async (c) => {
    const u = c.user; const P = pets(u); const sp = SP_BY.get(String(c.body.species || ''));
    if (!sp) throw new HttpError(404, 'no_species', 'Unknown pet');
    if (P.list.length >= MAX_PETS) throw new HttpError(400, 'too_many', 'You can have up to ' + MAX_PETS + ' pets');
    if (!econ.adjust(u, -sp.price, 'pet:adopt:' + sp.id)) throw new HttpError(402, 'no_funds', 'Not enough coins');
    const t = now(); const p = { id: rid(5), sp: sp.id, name: cleanName(c.body.name, sp.n[0]), xp: 0, hunger: 80, joy: 80, hAt: t, jAt: t, born: t, fedAt: 0, playedAt: 0 };
    P.list.push(p); if (!P.active) P.active = p.id; S.store.touch('users'); prog.award(u, 'pet');
    return { pet: petView(p), coins: u.coins };
  });
  const findPet = (u, id) => { const p = pets(u).list.find((x) => x.id === String(id)); if (!p) throw new HttpError(404, 'no_pet', 'Pet not found'); return p; };
  r.post('/api/pets/:id/feed', { auth: true, verified: true, limit: [30, 60000, 'user'] }, async (c) => {
    const u = c.user; const p = findPet(u, c.params.id); decay(p);
    if (now() - p.fedAt < FEED_CD) throw new HttpError(429, 'full', p.name + ' is not hungry yet');
    if (!econ.adjust(u, -FEED_COST, 'pet:feed')) throw new HttpError(402, 'no_funds', 'Not enough coins');
    p.hunger = Math.min(100, p.hunger + 40); p.xp += 15; p.fedAt = now(); S.store.touch('users'); prog.award(u, 'pet');
    return { pet: petView(p), coins: u.coins };
  });
  r.post('/api/pets/:id/play', { auth: true, verified: true, limit: [30, 60000, 'user'] }, async (c) => {
    const u = c.user; const p = findPet(u, c.params.id); decay(p);
    if (now() - p.playedAt < PLAY_CD) throw new HttpError(429, 'tired', p.name + ' needs a rest');
    p.joy = Math.min(100, p.joy + 35); p.xp += 10; p.playedAt = now(); S.store.touch('users'); prog.award(u, 'pet');
    return { pet: petView(p), coins: u.coins };
  });
  r.post('/api/pets/:id/active', { auth: true, verified: true, limit: [30, 60000, 'user'] }, async (c) => { const u = c.user; const p = findPet(u, c.params.id); pets(u).active = p.id; S.store.touch('users'); return { active: p.id }; });
  r.post('/api/pets/:id/rename', { auth: true, verified: true, limit: [20, 60000, 'user'] }, async (c) => { const u = c.user; const p = findPet(u, c.params.id); p.name = cleanName(c.body.name, p.name); S.store.touch('users'); return { pet: petView(p) }; });

  r.post('/api/chests/open', { auth: true, verified: true, limit: [30, 60000, 'user'] }, async (c) => openChest(c.user, String(c.body.id || '')));
};
module.exports.petBonus = petBonus;
module.exports.transfer = transfer;
module.exports.transferGems = transferGems;
module.exports.gemLimits = gemLimits;
