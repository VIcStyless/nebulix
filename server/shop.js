'use strict';
// Nebulix 13 — the daily Shop (Tienda). It rotates every day at 00:00 (Madrid time):
//   · featured: two complete sets as bundles (25 % off the items you do not own yet)
//   · daily: six single items, one of them a flash deal (−40 %)
//   · exclusive: two limited items with a few copies for everyone; once shown they stay away for 30+ days
//   · utilities (always): supply crate, Arena booster, double XP, rank shield
// Prices follow the live economy index (server/market.js). Items can be gifted to friends.
const { S, hub, publicUser } = require('./state');
const { HttpError } = require('./util');
const econ = require('./economy');
const market = require('./market');

const madridDay = (t = Date.now()) => new Date(t).toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
function msToReset() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return Math.max(1000, ((23 - Number(p.hour)) * 3600 + (59 - Number(p.minute)) * 60 + (60 - Number(p.second))) * 1000);
}
function rng(seed) { let a = [...String(seed)].reduce((x, c) => (x * 31 + c.charCodeAt(0)) >>> 0, 7); return () => { a = (a + 0x6d2b79f5) | 0; let x = Math.imul(a ^ (a >>> 15), 1 | a); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }
const shuffle = (arr, R) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const BUNDLE_OFF = 0.25, DEAL_OFF = 0.4;
const UTIL = [
  { id: 'crate', icon: '🎁', n: ['Supply crate', 'Cofre de suministro'], d: ['A random locker item you do not own yet (common to legendary).', 'Un objeto aleatorio de la Taquilla que aún no tienes (de común a legendario).'], price: 1200 },
  { id: 'boost:arena', icon: '🎯', n: ['Arena booster · 24 h', 'Potenciador Arena · 24 h'], d: ['+50% Arena coins and a 4,500 daily cap.', '+50 % de monedas en el Arena y límite de 4.500 al día.'], boost: 'arena' },
  { id: 'boost:xp2', icon: '⚡', n: ['Double XP · 24 h', 'XP doble · 24 h'], d: ['Level up twice as fast.', 'Sube de nivel el doble de rápido.'], boost: 'xp2' },
  { id: 'shield', icon: '🛡️', n: ['Rank shield', 'Escudo de rango'], d: ['Your next ranked defeat costs no rank points (keep up to 3, one a day).', 'Tu próxima derrota en clasificatoria no resta puntos (hasta 3, uno al día).'], price: 5000 },
];

function shopItems() { return econ.items.filter((it) => it.shop && !it.reward); }
function roll(sh, day) {
  const R = rng('nebulix-shop-' + day); const pool = shopItems();
  // two sets, not the ones featured yesterday
  const setIds = econ.L_SETS.map((x) => x[0]).filter((x) => !(sh.prevSets || []).includes(x));
  const sets = shuffle(setIds, R).slice(0, 2);
  const featured = pool.filter((it) => sets.includes(it.set) && !it.excl).map((it) => it.id);
  // six daily items from different categories when possible, never from the featured sets
  const rest = shuffle(pool.filter((it) => !it.excl && !sets.includes(it.set)), R); const daily = []; const cats = new Set();
  for (const it of rest) { if (daily.length >= 6) break; if (!cats.has(it.cat)) { daily.push(it.id); cats.add(it.cat); } }
  for (const it of rest) { if (daily.length >= 6) break; if (!daily.includes(it.id)) daily.push(it.id); }
  // exclusives: away for at least 30 days, the ones seen longest ago first
  const hist = (sh.exclHist = sh.exclHist || {}); const ex = pool.filter((it) => it.excl);
  const ok = shuffle(ex.filter((it) => !hist[it.id] || (Date.parse(day) - Date.parse(hist[it.id])) >= 30 * 86400000), R);
  const fallback = ex.slice().sort((a, b) => String(hist[a.id] || '').localeCompare(String(hist[b.id] || '')));
  const excl = (ok.length >= 2 ? ok : ok.concat(fallback.filter((it) => !ok.includes(it)))).slice(0, 2).map((it) => it.id);
  for (const id of excl) hist[id] = day;
  Object.assign(sh, { day, sets, featured, daily, excl, deal: daily[Math.floor(R() * daily.length)] || null, sold: {}, prevSets: sets });
  S.store.touch('meta');
}
function state() {
  const sh = (S.meta.shop = S.meta.shop || {}); const d = madridDay();
  if (sh.day !== d || !Array.isArray(sh.daily)) roll(sh, d);
  return sh;
}
const inToday = (sh, id) => sh.featured.includes(id) || sh.daily.includes(id) || sh.excl.includes(id);
function priceOf(sh, it) { let p = market.price(it.price, it.id); if (sh.deal === it.id) p = Math.round(p * (1 - DEAL_OFF)); return p; }
function itemView(sh, it, u) {
  const o = { id: it.id, cat: it.cat, n: it.n, rarity: it.rarity, spec: it.spec, set: it.set || null, price: priceOf(sh, it), base: it.price, owned: !!(u.inv && u.inv[it.id]) };
  if (sh.deal === it.id) { o.deal = true; o.full = market.price(it.price, it.id); }
  if (it.excl) { o.excl = true; o.stock = it.stock || 30; o.left = Math.max(0, o.stock - (sh.sold[it.id] || 0)); }
  return o;
}
function bundleOf(sh, set, u) {
  const its = econ.items.filter((it) => it.set === set && sh.featured.includes(it.id)); const meta = econ.L_SETS.find((x) => x[0] === set);
  const missing = its.filter((it) => !(u.inv && u.inv[it.id])); const full = missing.reduce((a, it) => a + priceOf(sh, it), 0);
  return { id: 'bundle_' + set, set, n: meta ? [meta[1][0] + ' set', 'Set ' + meta[1][1]] : [set, set], c: meta ? [meta[2], meta[3]] : null, rarity: meta ? meta[4] : 'rare', items: its.map((it) => it.id), missing: missing.length, full, price: Math.round(full * (1 - BUNDLE_OFF)) };
}
function utilView(u) {
  const B = require('./boosts'); const v = B.view(u);
  return UTIL.map((x) => { const b = x.boost && v.boosts.find((y) => y.id === x.boost); return { id: x.id, icon: x.icon, n: x.n, d: x.d, price: b ? b.price : market.price(x.price), on: b ? b.on : false, until: b ? b.until : 0, extra: x.id === 'shield' ? ((u.rk && u.rk.shield) || 0) : null }; });
}
function view(u) {
  const sh = state(); const by = (id) => econ.byId.get(id);
  return {
    day: sh.day, resetIn: msToReset(), index: market.index(), mood: market.mood(market.index()), coins: u.coins,
    bundles: sh.sets.map((s) => bundleOf(sh, s, u)),
    featured: sh.featured.map(by).filter(Boolean).map((it) => itemView(sh, it, u)),
    daily: sh.daily.map(by).filter(Boolean).map((it) => itemView(sh, it, u)),
    excl: sh.excl.map(by).filter(Boolean).map((it) => itemView(sh, it, u)),
    util: utilView(u),
  };
}
function pay(u, price, why) { if (!econ.adjust(u, -price, why)) throw new HttpError(402, 'no_funds', 'Not enough coins'); }
function giveCrate(u) {
  const W = { common: 50, rare: 30, epic: 15, legendary: 5 };
  const pool = shopItems().filter((it) => !it.excl && !(u.inv && u.inv[it.id])); if (!pool.length) throw new HttpError(409, 'all_owned', 'You already own every item a crate can give');
  let tot = pool.reduce((a, it) => a + (W[it.rarity] || 5), 0); let r = Math.random() * tot; let pick = pool[0];
  for (const it of pool) { r -= W[it.rarity] || 5; if (r <= 0) { pick = it; break; } }
  return pick;
}
function buy(u, id, { to = null } = {}) {
  const sh = state(); id = String(id || '');
  const target = to || u; const gift = !!to;
  // utilities
  if (UTIL.some((x) => x.id === id)) {
    if (gift) throw new HttpError(400, 'no_gift', 'Utilities cannot be gifted');
    const x = UTIL.find((y) => y.id === id);
    if (x.boost) { require('./boosts').buyBoost(u, x.boost); return { ok: true, util: id, coins: u.coins }; }
    if (id === 'crate') { const pick = giveCrate(u); pay(u, market.price(x.price), 'shop:crate'); econ.grant(u, pick.id); market.demand('crate'); return { ok: true, got: itemView(sh, pick, u), coins: u.coins, inv: u.inv }; }
    if (id === 'shield') {
      const rk = (u.rk = u.rk || {}); const d = madridDay(); if ((rk.shield || 0) >= 3) throw new HttpError(409, 'max', 'You already have 3 shields'); if (rk.shieldDay === d) throw new HttpError(429, 'daily', 'You can buy one shield a day');
      pay(u, market.price(x.price), 'shop:shield'); rk.shield = (rk.shield || 0) + 1; rk.shieldDay = d; S.store.touch('users'); return { ok: true, shield: rk.shield, coins: u.coins };
    }
  }
  // bundles
  if (id.startsWith('bundle_')) {
    const set = id.slice(7); if (!sh.sets.includes(set)) throw new HttpError(404, 'gone', 'This bundle is not in today’s Shop');
    const b = bundleOf(sh, set, target); if (!b.missing) throw new HttpError(409, 'owned', gift ? 'They already own the whole set' : 'You already own the whole set');
    pay(u, b.price, (gift ? 'shop:gift:' : 'shop:') + id);
    for (const iid of b.items) { if (econ.grant(target, iid)) market.demand(iid); }
    if (gift) notifyGift(u, target, b.n);
    return { ok: true, coins: u.coins, inv: u.inv };
  }
  const it = econ.byId.get(id); if (!it || !it.shop || it.reward) throw new HttpError(404, 'no_item', 'Item not found');
  if (!inToday(sh, id)) throw new HttpError(410, 'gone', 'This item is not in today’s Shop — come back when it rotates in');
  if (target.inv && target.inv[id]) throw new HttpError(409, 'owned', gift ? 'They already own this item' : 'You already own this item');
  if (it.excl && (sh.sold[id] || 0) >= (it.stock || 30)) throw new HttpError(410, 'sold_out', 'Sold out for today');
  pay(u, priceOf(sh, it), (gift ? 'shop:gift:' : 'shop:') + id);
  econ.grant(target, id); market.demand(id, it.excl ? 2 : 1);
  if (it.excl) { sh.sold[id] = (sh.sold[id] || 0) + 1; S.store.touch('meta'); }
  if (gift) notifyGift(u, target, it.n);
  try { require('./progress').award(u, 'buy'); } catch {}
  return { ok: true, coins: u.coins, inv: u.inv, item: itemView(sh, it, u) };
}
function notifyGift(from, to, n) {
  hub.push(to.id, { t: 'notice', text: `🎁 @${from.username} sent you “${n[0]}” — open your Locker`, es: `🎁 @${from.username} te ha regalado «${n[1]}» — abre tu Taquilla` });
  try { require('./feed').add('gift', '🎁', [`@${from.username} gave @${to.username} a gift from the Shop`, `@${from.username} ha regalado a @${to.username} algo de la Tienda`], { uid: from.id }); } catch {}
}
function gift(u, id, username) {
  const to = Object.values(S.users).find((x) => x && !x.deleted && x.username && x.username.toLowerCase() === String(username || '').replace(/^@/, '').toLowerCase());
  if (!to) throw new HttpError(404, 'no_user', 'User not found'); if (to.id === u.id) throw new HttpError(400, 'self', 'Buy it for yourself instead');
  const r = buy(u, id, { to }); return Object.assign(r, { to: publicUser(to) });
}
// what the Locker shows: owned locker items with their specs, and what is equipped
function locker(u) {
  const inv = u.inv || {}; const own = econ.items.filter((it) => econ.LOCK_CATS.includes(it.cat) && inv[it.id]);
  const eq = u.eq || {};
  return { items: own.map((it) => ({ id: it.id, cat: it.cat, n: it.n, rarity: it.rarity, spec: it.spec, set: it.set || null, excl: !!it.excl, reward: !!it.reward, since: inv[it.id] })), eq: { outfit: eq.outfit || null, backpack: eq.backpack || null, pickaxe: eq.pickaxe || null, glider: eq.glider || null, wrap: eq.wrap || null, trail: eq.trail || null, elim: eq.elim || null, emotes: eq.emotes || [] }, total: econ.items.filter((it) => econ.LOCK_CATS.includes(it.cat) && !it.reward).length };
}
// a compact locker for 3D (arena, previews): specs of what someone has equipped
function lockerSpec(u) {
  if (!u || !u.eq) return null; const eq = u.eq; const o = {};
  for (const k of ['outfit', 'backpack', 'pickaxe', 'glider', 'wrap', 'trail', 'elim']) { const it = eq[k] && econ.byId.get(eq[k]); if (it && u.inv && u.inv[it.id]) o[k] = Object.assign({ id: it.id }, it.spec); }
  o.emotes = (eq.emotes || []).map((id) => econ.byId.get(id)).filter((it) => it && u.inv && u.inv[it.id]).map((it) => Object.assign({ id: it.id }, it.spec));
  return o;
}
// bots get a random look from the Shop pool
function randomSpec() {
  const pick = (cat) => { const l = shopItems().filter((it) => it.cat === cat && !it.excl); const it = l[Math.floor(Math.random() * l.length)]; return it ? Object.assign({ id: it.id }, it.spec) : undefined; };
  return { outfit: Math.random() < 0.7 ? pick('outfit') : undefined, backpack: Math.random() < 0.6 ? pick('backpack') : undefined, glider: pick('glider'), pickaxe: pick('pickaxe'), wrap: Math.random() < 0.5 ? pick('wrap') : undefined, trail: Math.random() < 0.4 ? pick('trail') : undefined, emotes: [pick('emote')].filter(Boolean) };
}
module.exports = { view, buy, gift, locker, lockerSpec, randomSpec, state, madridDay, msToReset };
