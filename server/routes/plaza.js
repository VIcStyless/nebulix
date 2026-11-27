'use strict';
// The Plaza: what coins and gems are for beyond cosmetics.
//  - gems: exchange coins → gems (one way)
//  - donations & donation booths: anyone can open a booth, others donate coins; pay coins to boost it to the top
//  - player market: sell cosmetics you own to other players (5% fee), boost a listing
//  - staff: hire workers who earn coins while you are away (collect them, capped)
//  - 3D avatar: the character shown in the 3D casino and on your profile
// Everything is virtual: coins and gems are never bought or paid out with real money.
const path = require('path');
const { S, hub, audit, publicUser, isPro } = require('../state');
const econ = require('../economy');
const prog = require('../progress');
const { HttpError, now, rid, dayKey } = require('../util');

const AV = require(path.join(__dirname, '..', '..', 'public', 'data', 'avatar.json'));
const HOUR = 3600000;
const banned = (u) => !!(u.banned && (!u.banned.until || u.banned.until > now()));
const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f‪-‮⁦-⁩]/g, '').trim().slice(0, n);
const EMOJI1 = /^(?:\p{Extended_Pictographic}(?:‍\p{Extended_Pictographic}|️|\p{Emoji_Modifier})*)$/u;
const COLOR = /^#[0-9a-f]{6}$/i;
const meta = (k, d) => (S.meta[k] = S.meta[k] || d);
const mini = (u) => (u ? { id: u.id, username: u.username, displayName: u.displayName || u.username, avatar: u.avatar || null, pro: isPro(u), av3: u.av3 || null } : null);

// ================= donations & booths =================
const BOOST_COINS_PER_HOUR = 2000; const BOOST_MAX_H = 48;
function booths() { return meta('booths', {}); }
function boothView(b) {
  const u = S.users[b.uid]; if (!u || u.deleted || banned(u)) return null;
  return { uid: b.uid, user: mini(u), title: b.title, emoji: b.emoji, color: b.color, goal: b.goal, raised: b.raised, raisedGems: b.raisedGems || 0, donors: b.donors, boosted: b.boostUntil > now() ? b.boostUntil : 0, created: b.created, online: hub.online(u.id), last: b.last || null };
}
function sortedBooths() {
  const t = now();
  return Object.values(booths()).map(boothView).filter(Boolean)
    .sort((a, b) => (b.boosted > t) - (a.boosted > t) || (b.boosted - a.boosted) || (b.online - a.online) || ((b.last && b.last.t) || b.created) - ((a.last && a.last.t) || a.created));
}
function donate(u, body) {
  const W = require('./wallet'); const gems = String(body.currency || '') === 'gems';
  const toName = String(body.to || '').replace(/^@/, '');
  const r = (gems ? W.transferGems : W.transfer)(u, { to: toName, amount: body.amount, note: clean(body.note, 80) || '🎁', donation: true });
  const to = S.users[r.to.id];
  const b = booths()[to.id];
  const rec = { id: rid(6), t: now(), from: u.id, to: to.id, amount: r.transfer.amount, note: r.transfer.note }; if (gems) rec.cur = 'gems';
  if (b) { if (gems) b.raisedGems = (b.raisedGems || 0) + rec.amount; else b.raised += rec.amount; b.donors = (b.donors || 0) + 1; b.last = { t: rec.t, from: u.username, amount: rec.amount, cur: gems ? 'gems' : 'coins' }; }
  const feed = meta('donations', []); feed.unshift(rec); if (feed.length > 300) feed.length = 300;
  const k = gems ? 'donatedGems' : 'donated'; const kr = gems ? 'receivedGems' : 'received';
  u.stats = u.stats || {}; u.stats[k] = (u.stats[k] || 0) + rec.amount;
  to.stats = to.stats || {}; to.stats[kr] = (to.stats[kr] || 0) + rec.amount;
  S.store.touch('meta'); S.store.touch('users');
  try { prog.award(u, 'donate'); } catch {}
  hub.push(to.id, { t: 'donation', from: publicUser(u), amount: rec.amount, note: rec.note, cur: gems ? 'gems' : 'coins' });
  return { ok: true, coins: u.coins, gems: u.gems || 0, donation: rec, booth: b ? boothView(b) : null };
}
const feedView = () => (S.meta.donations || []).slice(0, 25).map((d) => ({ id: d.id, t: d.t, amount: d.amount, cur: d.cur || 'coins', note: d.note, from: mini(S.users[d.from]), to: mini(S.users[d.to]) })).filter((d) => d.from && d.to);
function topDonors() {
  const score = (u) => (u.stats.donated || 0) + (u.stats.donatedGems || 0) * econ.GEM_RATE; // a gem counts as what it costs in coins
  const list = Object.values(S.users).filter((u) => !u.deleted && u.verified && u.stats && score(u) > 0).sort((a, b) => score(b) - score(a)).slice(0, 10);
  return list.map((u) => ({ user: mini(u), donated: u.stats.donated || 0, gems: u.stats.donatedGems || 0 }));
}

// ================= player market =================
const FEE = 0.05; const MAX_LIST = 12; const LIST_BOOST_PER_HOUR = 1000;
function listings() { return meta('p2p', []); }
function listingView(l) {
  const it = econ.byId.get(l.item); const s = S.users[l.seller]; if (!it || !s || s.deleted) return null;
  return { id: l.id, item: { id: it.id, cat: it.cat, n: it.n, spec: it.spec, rarity: it.rarity, icon: it.icon, price: it.price, pro: !!it.pro }, price: l.price, seller: mini(s), created: l.created, boosted: l.boostUntil > now() ? l.boostUntil : 0 };
}
function sellItem(u, body) {
  const id = String(body.item || ''); const price = Math.trunc(Number(body.price));
  const it = econ.byId.get(id);
  if (!it) throw new HttpError(404, 'no_item', 'Item not found');
  if (it.cat === 'perk') throw new HttpError(400, 'not_tradable', 'Upgrades cannot be resold');
  if (!u.inv || !u.inv[id]) throw new HttpError(403, 'not_owned', 'You do not own this item');
  if (!Number.isFinite(price) || price < 10 || price > 10_000_000) throw new HttpError(400, 'bad_price', 'Price must be between 10 and 10,000,000 coins');
  if (listings().filter((l) => l.seller === u.id).length >= MAX_LIST) throw new HttpError(400, 'too_many', `Up to ${MAX_LIST} items on sale at once`);
  // escrow: the item leaves the inventory (and any slot) until it sells or the listing is cancelled
  delete u.inv[id];
  if (u.eq) { for (const k of Object.keys(u.eq)) if (u.eq[k] === id) u.eq[k] = null; if (Array.isArray(u.eq.badges)) u.eq.badges = u.eq.badges.filter((b) => b !== id); }
  const l = { id: 'l' + rid(6), seller: u.id, item: id, price, created: now(), boostUntil: 0 };
  listings().unshift(l); S.store.touch('meta'); S.store.touch('users');
  return { listing: listingView(l) };
}
function cancelListing(u, id) {
  const all = listings(); const i = all.findIndex((l) => l.id === id);
  if (i < 0) throw new HttpError(404, 'no_listing', 'Listing not found');
  const l = all[i]; if (l.seller !== u.id && !['owner', 'admin'].includes(u.role)) throw new HttpError(403, 'forbidden', 'Not your listing');
  all.splice(i, 1); const s = S.users[l.seller]; if (s) { s.inv = s.inv || {}; s.inv[l.item] = s.inv[l.item] || now(); }
  S.store.touch('meta'); S.store.touch('users');
  return { ok: true };
}
function buyListing(u, id) {
  const all = listings(); const i = all.findIndex((l) => l.id === id);
  if (i < 0) throw new HttpError(404, 'no_listing', 'This item was already sold');
  const l = all[i]; const s = S.users[l.seller];
  if (l.seller === u.id) throw new HttpError(400, 'self', 'That is your own listing');
  if (!s || s.deleted) throw new HttpError(410, 'gone', 'The seller is gone');
  if (u.inv && u.inv[l.item]) throw new HttpError(409, 'owned', 'You already own this item');
  if (u.infinite) throw new HttpError(403, 'infinite', 'Not available for unlimited wallets');
  if (!econ.adjust(u, -l.price, 'p2p:buy:' + l.item)) throw new HttpError(402, 'no_funds', 'Not enough coins');
  const fee = Math.ceil(l.price * FEE);
  econ.adjust(s, l.price - fee, 'p2p:sell:' + l.item);
  u.inv = u.inv || {}; u.inv[l.item] = now();
  all.splice(i, 1);
  const hist = meta('p2pHist', []); hist.unshift({ t: now(), item: l.item, price: l.price, seller: s.id, buyer: u.id }); if (hist.length > 300) hist.length = 300;
  S.store.touch('meta'); S.store.touch('users');
  if (l.price >= 50000) audit('p2p_sale', u.id, { seller: s.id, item: l.item, price: l.price });
  hub.push(s.id, { t: 'sold', item: l.item, price: l.price, got: l.price - fee, buyer: publicUser(u) });
  return { ok: true, coins: u.coins, item: l.item };
}
function boost(u, kind, id, hours, coinsPerHour) {
  hours = Math.trunc(Number(hours));
  if (!Number.isFinite(hours) || hours < 1 || hours > 24) throw new HttpError(400, 'bad_hours', 'Boost between 1 and 24 hours');
  let target;
  if (kind === 'booth') { target = booths()[u.id]; if (!target) throw new HttpError(404, 'no_booth', 'Open your booth first'); }
  else { target = listings().find((l) => l.id === id && l.seller === u.id); if (!target) throw new HttpError(404, 'no_listing', 'Listing not found'); }
  const start = Math.max(now(), target.boostUntil || 0);
  if (start + hours * HOUR - now() > BOOST_MAX_H * HOUR) throw new HttpError(400, 'too_long', `A boost can be at most ${BOOST_MAX_H} hours ahead`);
  const cost = hours * coinsPerHour;
  if (!econ.adjust(u, -cost, 'boost:' + kind)) throw new HttpError(402, 'no_funds', `Boosting costs ${cost.toLocaleString('en-US')} coins`);
  target.boostUntil = start + hours * HOUR; S.store.touch('meta');
  return { ok: true, boostUntil: target.boostUntil, coins: u.coins, cost };
}

// ================= staff (passive income) =================
// id, emoji, [en, es], base price, currency, coins per hour
const STAFF = [
  ['intern', '🧑‍🎓', ['Intern', 'Becario'], 2000, 'coins', 40],
  ['barista', '☕', ['Barista', 'Barista'], 6000, 'coins', 130],
  ['streamer', '🎥', ['Streamer', 'Streamer'], 15000, 'coins', 330],
  ['dev', '💻', ['Programmer', 'Programadora'], 40000, 'coins', 900],
  ['designer', '🎨', ['Designer', 'Diseñador'], 100000, 'coins', 2300],
  ['trader', '📈', ['Trader', 'Trader'], 300000, 'coins', 7000],
  ['chef', '👩‍🍳', ['Star chef', 'Chef estrella'], 900000, 'coins', 21000],
  ['robot', '🤖', ['Robot worker', 'Robot obrero'], 60, 'gems', 2500],
  ['ai', '🧠', ['Nova AI assistant', 'Asistente IA Nova'], 250, 'gems', 11000],
].map(([id, e, n, price, cur, rate]) => ({ id, e, n, price, cur, rate }));
const STAFF_BY = new Map(STAFF.map((s) => [s.id, s]));
const MAX_EACH = 25;
const capHours = (u) => (isPro(u) ? 24 : 12) + require('../boosts').extraShift(u);
function staff(u) { u.staff = u.staff || { n: {}, since: now() }; return u.staff; }
const staffRate = (u) => { const st = staff(u); let r = 0; for (const s of STAFF) r += (st.n[s.id] || 0) * s.rate; return r * (isPro(u) ? 1.2 : 1) * require('../boosts').staffMult(u); };
const priceOf = (s, owned) => Math.ceil(s.price * Math.pow(1.15, owned));
function pending(u) { const st = staff(u); const hrs = Math.min(capHours(u), (now() - st.since) / HOUR); return { coins: Math.floor(staffRate(u) * hrs), hours: hrs, full: hrs >= capHours(u) }; }
function staffView(u) {
  const st = staff(u); const p = pending(u);
  return { list: STAFF.map((s) => ({ id: s.id, e: s.e, n: s.n, rate: s.rate, cur: s.cur, owned: st.n[s.id] || 0, price: priceOf(s, st.n[s.id] || 0), max: MAX_EACH })), rate: Math.round(staffRate(u)), pending: p.coins, hours: Math.round(p.hours * 10) / 10, cap: capHours(u), full: p.full, coins: u.coins, gems: u.gems || 0 };
}
function collect(u) {
  const p = pending(u); const st = staff(u);
  st.since = now();
  if (p.coins > 0) { econ.adjust(u, p.coins, 'staff'); try { prog.award(u, 'work'); } catch {} }
  S.store.touch('users');
  return Object.assign({ collected: p.coins }, staffView(u));
}
function hire(u, id) {
  const s = STAFF_BY.get(id); if (!s) throw new HttpError(404, 'no_staff', 'Unknown worker');
  const st = staff(u); const owned = st.n[id] || 0;
  if (owned >= MAX_EACH) throw new HttpError(400, 'max', `You already have ${MAX_EACH} of these`);
  // pay what the current team earned so far, so the new hire does not count backwards
  const p = pending(u); if (p.coins > 0) econ.adjust(u, p.coins, 'staff'); st.since = now();
  const price = priceOf(s, owned);
  if (s.cur === 'gems') { if (!econ.adjustGems(u, -price, 'hire:' + id)) throw new HttpError(402, 'no_gems', 'Not enough gems'); }
  else if (!econ.adjust(u, -price, 'hire:' + id)) throw new HttpError(402, 'no_funds', 'Not enough coins');
  st.n[id] = owned + 1; S.store.touch('users');
  return Object.assign({ hired: id }, staffView(u));
}

// ================= 3D avatar =================
const PART = (k, id) => (AV.parts[k] || []).find((p) => p.id === id);
const idx = (arr, v) => (Number.isInteger(v) && v >= 0 && v < arr.length ? v : null);
function cleanAvatar(u, inp) {
  const d = Object.assign({}, AV.default, u.av3 || {});
  const out = {};
  out.skin = idx(AV.skin, inp.skin) ?? d.skin; out.hairColor = idx(AV.hairColor, inp.hairColor) ?? d.hairColor;
  out.topColor = idx(AV.color, inp.topColor) ?? d.topColor; out.pants = idx(AV.color, inp.pants) ?? d.pants;
  const owned = u.av3inv || {};
  let cost = { coins: 0, gems: 0 }; const buy = [];
  for (const k of Object.keys(AV.parts)) {
    const want = inp[k] !== undefined ? String(inp[k]) : d[k];
    const p = PART(k, want); if (!p) throw new HttpError(400, 'bad_part', 'Unknown avatar part');
    if ((p.coins || p.gems) && !owned[k + ':' + p.id]) { cost.coins += p.coins || 0; cost.gems += p.gems || 0; buy.push(k + ':' + p.id); }
    out[k] = p.id;
  }
  return { av: out, cost, buy };
}
function saveAvatar(u, inp) {
  const { av, cost, buy } = cleanAvatar(u, inp || {});
  if (buy.length && !inp.confirmBuy) return { needsPurchase: true, cost, parts: buy };
  if (cost.gems && (u.gems || 0) < cost.gems) throw new HttpError(402, 'no_gems', `You need ${cost.gems} gems`);
  if (cost.coins && u.coins < cost.coins && !u.infinite) throw new HttpError(402, 'no_funds', `You need ${cost.coins.toLocaleString('en-US')} coins`);
  if (cost.coins) econ.adjust(u, -cost.coins, 'avatar');
  if (cost.gems) econ.adjustGems(u, -cost.gems, 'avatar');
  u.av3inv = u.av3inv || {}; for (const b of buy) u.av3inv[b] = now();
  u.av3 = av; S.store.touch('users');
  try { S.hub.push(u.id, { t: 'me', user: require('../state').selfUser(u) }); } catch {}
  return { ok: true, av3: av, owned: Object.keys(u.av3inv), coins: u.coins, gems: u.gems || 0 };
}

module.exports = function register(r) {
  const A = { auth: true, verified: true };
  // gems
  r.get('/api/gems', { auth: true }, async (c) => ({ gems: c.user.gems || 0, rate: econ.GEM_RATE, perDay: econ.GEM_DAY, left: econ.GEM_DAY - (c.user.gemDay && c.user.gemDay.d === dayKey() ? c.user.gemDay.n : 0), tx: (c.user.gtx || []).slice(0, 20) }));
  r.post('/api/gems/exchange', Object.assign({ limit: [20, 60000, 'user'] }, A), async (c) => econ.buyGems(c.user, c.body.n));

  // donations & booths
  r.get('/api/plaza', { auth: true, limit: [60, 60000, 'user'] }, async (c) => ({ booths: sortedBooths().slice(0, 60), mine: booths()[c.user.id] ? boothView(booths()[c.user.id]) : null, feed: feedView(), top: topDonors(), boostPrice: BOOST_COINS_PER_HOUR, gemLimits: require('./wallet').gemLimits(c.user) }));
  r.post('/api/plaza/booth', Object.assign({ limit: [20, 60000, 'user'] }, A), async (c) => {
    const u = c.user; const b = c.body; const all = booths();
    const title = clean(b.title, 48); if (title.length < 3) throw new HttpError(400, 'bad_title', 'Give your booth a title (3-48 characters)');
    const emoji = EMOJI1.test(String(b.emoji || '')) ? b.emoji : '🎁';
    const color = COLOR.test(String(b.color || '')) ? b.color : '#7c5cff';
    const goal = Math.max(100, Math.min(10_000_000, Math.trunc(Number(b.goal)) || 10000));
    const cur = all[u.id] || { uid: u.id, raised: 0, donors: 0, created: now(), boostUntil: 0 };
    Object.assign(cur, { title, emoji, color, goal }); all[u.id] = cur; S.store.touch('meta');
    return { booth: boothView(cur) };
  });
  r.delete('/api/plaza/booth', A, async (c) => { delete booths()[c.user.id]; S.store.touch('meta'); return { ok: true }; });
  r.post('/api/plaza/boost', Object.assign({ limit: [20, 60000, 'user'] }, A), async (c) => boost(c.user, 'booth', null, c.body.hours, BOOST_COINS_PER_HOUR));
  r.post('/api/donate', Object.assign({ limit: [20, 60000, 'user'] }, A), async (c) => donate(c.user, c.body));

  // player market
  r.get('/api/p2p', { auth: true, limit: [60, 60000, 'user'] }, async (c) => {
    const t = now(); const all = listings().map(listingView).filter(Boolean);
    all.sort((a, b) => (b.boosted > t) - (a.boosted > t) || b.boosted - a.boosted || b.created - a.created);
    const cat = String(c.query.cat || ''); const list = cat ? all.filter((l) => l.item.cat === cat) : all;
    return { listings: list.slice(0, 120), mine: all.filter((l) => l.seller.id === c.user.id), fee: FEE, boostPrice: LIST_BOOST_PER_HOUR, recent: (S.meta.p2pHist || []).slice(0, 10).map((h) => ({ t: h.t, item: h.item, price: h.price })) };
  });
  r.post('/api/p2p/sell', Object.assign({ limit: [20, 60000, 'user'] }, A), async (c) => sellItem(c.user, c.body));
  r.post('/api/p2p/:id/buy', Object.assign({ limit: [30, 60000, 'user'] }, A), async (c) => buyListing(c.user, c.params.id));
  r.post('/api/p2p/:id/cancel', Object.assign({ limit: [30, 60000, 'user'] }, A), async (c) => cancelListing(c.user, c.params.id));
  r.post('/api/p2p/:id/boost', Object.assign({ limit: [20, 60000, 'user'] }, A), async (c) => boost(c.user, 'listing', c.params.id, c.body.hours, LIST_BOOST_PER_HOUR));

  // staff
  r.get('/api/staff', { auth: true }, async (c) => staffView(c.user));
  r.post('/api/staff/hire', Object.assign({ limit: [40, 60000, 'user'] }, A), async (c) => hire(c.user, String(c.body.id || '')));
  r.post('/api/staff/collect', Object.assign({ limit: [30, 60000, 'user'] }, A), async (c) => collect(c.user));

  // 3D avatar
  r.get('/api/avatar3d', { auth: true }, async (c) => ({ av3: Object.assign({}, AV.default, c.user.av3 || {}), owned: Object.keys(c.user.av3inv || {}), coins: c.user.coins, gems: c.user.gems || 0 }));
  r.put('/api/avatar3d', Object.assign({ limit: [30, 60000, 'user'] }, A), async (c) => saveAvatar(c.user, c.body));
};
module.exports.STAFF = STAFF;
module.exports.pending = pending;
