'use strict';
// Nebulix 13.1 — the Marketplace: players sell cosmetic items to each other for coins.
//   · any cosmetic you own can be listed (Market items, Locker items, Shop exclusives); upgrades, earned rewards and PRO
//     items cannot be traded
//   · the buyer pays the price, the seller gets 95 %, 5 % leaves the economy (coin sink)
//   · the market script (server/market.js) also reads this market every hour: for every item it knows the floor price
//     (cheapest listing), the last sales, the 7-day average, how many are for sale and the trend, and it suggests a fair
//     price when you list something. Prices that are far off are not allowed (protects against mistakes and abuse).
const { S, hub, publicUser } = require('./state');
const { HttpError, now, rid } = require('./util');
const econ = require('./economy');

const FEE = 0.05; const MAX_OPEN = 25; const DAY = 86400000;
const T = () => S.store.table('trades');            // id -> listing
const touch = () => S.store.touch('trades');
const hist = () => { const m = (S.meta.trade = S.meta.trade || {}); m.sales = m.sales || {}; return m; }; // sales[itemId] = [[t, price], …]

function tradable(it) { return !!it && !it.reward && !it.pro && it.cat !== 'perk'; }
// reference price of an item: what it costs in the shops now, adjusted by real sales when there are enough
function reference(it) {
  const base = require('./market').price(it.price || 500, it.id) * (it.excl ? 1.6 : 1);
  const s = (hist().sales[it.id] || []).filter((x) => now() - x[0] < 14 * DAY).map((x) => x[1]).sort((a, b) => a - b);
  if (s.length >= 3) { const med = s[Math.floor(s.length / 2)]; return Math.round(med * 0.7 + base * 0.3); }
  return Math.round(base);
}
const bounds = (it) => { const r = reference(it); return [Math.max(1, Math.floor(r * 0.2)), Math.ceil(r * 25)]; };
function openOf(id) { return Object.values(T()).filter((l) => l.status === 'open' && l.item === id); }
function stats(it) {
  const open = openOf(it.id).sort((a, b) => a.price - b.price); const sales = hist().sales[it.id] || [];
  const week = sales.filter((x) => now() - x[0] < 7 * DAY); const prev = sales.filter((x) => now() - x[0] >= 7 * DAY && now() - x[0] < 14 * DAY);
  const avg = (l) => (l.length ? Math.round(l.reduce((a, x) => a + x[1], 0) / l.length) : null);
  const a7 = avg(week), a14 = avg(prev);
  return { floor: open.length ? open[0].price : null, listed: open.length, last: sales.length ? sales[sales.length - 1][1] : null, avg7: a7, sold7: week.length, trend: a7 && a14 ? Math.round(((a7 - a14) / a14) * 100) : null, suggested: reference(it), bounds: bounds(it) };
}
function itemCard(it, u) { return { id: it.id, cat: it.cat, n: it.n, rarity: it.rarity, spec: it.spec, excl: !!it.excl, owned: !!(u && u.inv && u.inv[it.id]), stats: stats(it) }; }
const lView = (l) => ({ id: l.id, item: l.item, price: l.price, t: l.t, seller: S.users[l.seller] ? publicUser(S.users[l.seller]) : null, status: l.status, soldAt: l.soldAt || null });

function list(u, id, price) {
  const it = econ.byId.get(String(id || '')); if (!tradable(it)) throw new HttpError(400, 'not_tradable', 'This item cannot be traded');
  if (!u.inv || !u.inv[it.id]) throw new HttpError(403, 'not_owned', 'You do not own this item');
  if (Object.values(T()).some((l) => l.status === 'open' && l.seller === u.id && l.item === it.id)) throw new HttpError(409, 'listed', 'You are already selling this item');
  if (Object.values(T()).filter((l) => l.status === 'open' && l.seller === u.id).length >= MAX_OPEN) throw new HttpError(429, 'too_many', `You can have up to ${MAX_OPEN} items for sale`);
  price = Math.trunc(Number(price)); const [lo, hi] = bounds(it);
  if (!(price >= lo && price <= hi)) throw new HttpError(400, 'bad_price', `Price between ${lo} and ${hi} coins for this item`);
  const l = { id: rid(10), seller: u.id, item: it.id, price, t: now(), status: 'open' }; T()[l.id] = l; touch();
  return lView(l);
}
function cancel(u, lid) { const l = T()[lid]; if (!l || l.status !== 'open' || (l.seller !== u.id && !['owner', 'admin'].includes(u.role))) throw new HttpError(404, 'gone', 'Listing not found'); l.status = 'cancelled'; touch(); return { ok: true }; }
function unequip(u, id) { const e = u.eq || {}; for (const k of Object.keys(e)) { if (e[k] === id) e[k] = null; else if (Array.isArray(e[k])) e[k] = e[k].filter((x) => x !== id); } }
function buy(u, lid) {
  const l = T()[lid]; if (!l || l.status !== 'open') throw new HttpError(410, 'gone', 'Someone else bought it first');
  if (l.seller === u.id) throw new HttpError(400, 'own', 'This is your own listing');
  const s = S.users[l.seller]; const it = econ.byId.get(l.item);
  if (!s || !s.inv || !s.inv[l.item]) { l.status = 'cancelled'; touch(); throw new HttpError(410, 'gone', 'The seller no longer has this item'); }
  if (u.inv && u.inv[l.item]) throw new HttpError(409, 'owned', 'You already own this item');
  if (!econ.adjust(u, -l.price, 'trade:buy:' + l.item)) throw new HttpError(402, 'no_funds', 'Not enough coins');
  const gain = Math.floor(l.price * (1 - FEE)); econ.adjust(s, gain, 'trade:sell:' + l.item);
  delete s.inv[l.item]; unequip(s, l.item); econ.grant(u, l.item); S.store.touch('users');
  l.status = 'sold'; l.buyer = u.id; l.soldAt = now(); touch();
  const h = hist(); (h.sales[l.item] = h.sales[l.item] || []).push([now(), l.price]); if (h.sales[l.item].length > 40) h.sales[l.item].splice(0, h.sales[l.item].length - 40); S.store.touch('meta');
  require('./market').demand(l.item, 1);
  hub.push(s.id, { t: 'notice', text: `Sold “${it.n[0]}” on the Marketplace for ${l.price} coins (+${gain})`, es: `Has vendido «${it.n[1]}» en el Mercado de jugadores por ${l.price} monedas (+${gain})` });
  return { ok: true, coins: u.coins, inv: u.inv, item: it.id };
}
// browse: one row per item with open listings (or all tradable items with ?all=1), filters and sort
function browse(u, q = {}) {
  const cat = String(q.cat || ''); const rar = String(q.rarity || ''); const term = String(q.q || '').toLowerCase().slice(0, 40); const sort = String(q.sort || 'popular');
  const ids = new Set(Object.values(T()).filter((l) => l.status === 'open').map((l) => l.item));
  let items = econ.items.filter((it) => tradable(it) && (q.all ? true : ids.has(it.id)));
  if (cat) items = items.filter((it) => it.cat === cat); if (rar) items = items.filter((it) => it.rarity === rar); if (term) items = items.filter((it) => it.n.join(' ').toLowerCase().includes(term));
  let rows = items.map((it) => itemCard(it, u));
  rows.sort((a, b) => sort === 'cheap' ? (a.stats.floor || 1e18) - (b.stats.floor || 1e18) : sort === 'expensive' ? (b.stats.floor || 0) - (a.stats.floor || 0) : sort === 'trend' ? (b.stats.trend || -1e9) - (a.stats.trend || -1e9) : (b.stats.sold7 * 3 + b.stats.listed) - (a.stats.sold7 * 3 + a.stats.listed));
  const recent = Object.values(T()).filter((l) => l.status === 'sold').sort((a, b) => b.soldAt - a.soldAt).slice(0, 12).map((l) => Object.assign(lView(l), { n: (econ.byId.get(l.item) || { n: [l.item, l.item] }).n }));
  return { rows: rows.slice(0, 120), recent, summary: summary(), coins: u.coins };
}
function item(u, id) {
  const it = econ.byId.get(String(id || '')); if (!tradable(it)) throw new HttpError(404, 'no_item', 'Item not found');
  return { item: itemCard(it, u), listings: openOf(it.id).sort((a, b) => a.price - b.price).slice(0, 50).map(lView), history: (hist().sales[it.id] || []).slice(-40), mine: openOf(it.id).filter((l) => l.seller === u.id).map(lView) };
}
function mine(u) {
  const own = econ.items.filter((it) => tradable(it) && u.inv && u.inv[it.id]).map((it) => itemCard(it, u));
  const lst = Object.values(T()).filter((l) => l.seller === u.id || l.buyer === u.id).sort((a, b) => (b.soldAt || b.t) - (a.soldAt || a.t)).slice(0, 60).map((l) => Object.assign(lView(l), { n: (econ.byId.get(l.item) || { n: [l.item, l.item] }).n, sold: l.seller === u.id && l.status === 'sold', bought: l.buyer === u.id }));
  return { items: own, listings: lst };
}
// numbers for the economy page and the hourly market update
function summary() {
  const all = Object.values(T()); const open = all.filter((l) => l.status === 'open'); const week = all.filter((l) => l.status === 'sold' && now() - l.soldAt < 7 * DAY);
  const vol = week.reduce((a, l) => a + l.price, 0);
  // how sale prices compare with shop prices (> 1: players pay more than the shops ask)
  const ratios = week.map((l) => { const it = econ.byId.get(l.item); return it ? l.price / Math.max(1, require('./market').price(it.price || 500)) : 1; });
  const tIdx = ratios.length ? Math.round((ratios.reduce((a, b) => a + b, 0) / ratios.length) * 100) / 100 : 1;
  return { open: open.length, sold7: week.length, volume7: vol, fees7: Math.floor(vol * FEE), tradeIndex: tIdx };
}
// old listings expire after 30 days
function sweep() { let n = 0; for (const l of Object.values(T())) if (l.status === 'open' && now() - l.t > 30 * DAY) { l.status = 'expired'; n++; } if (n) touch(); return n; }
module.exports = { list, cancel, buy, browse, item, mine, summary, sweep, reference, tradable };
