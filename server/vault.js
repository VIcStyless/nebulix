'use strict';
// Nebulix 13 — Nebula Vault: the game store of Nebulix. Creators sell the games and apps they upload to the Hub
// for coins (or keep them free), with discounts; players buy them once and keep them in their library forever.
//   · the creator gets 85 % of every sale, 15 % leaves the economy (a coin sink)
//   · a paid game only runs for its owners: the play address carries a signed, expiring key (see playKey)
//   · refunds within 30 minutes of buying (the creator's share is taken back)
//   · wishlist with an alert when a game goes on sale
const crypto = require('crypto');
const { S, hub } = require('./state');
const { HttpError, now } = require('./util');
const cfg = require('./config');

const CUT = 0.85; const REFUND_MS = 30 * 60000; const MAX_PRICE = 1_000_000;
const items = () => S.store.table('hubitems');
const isGame = (it) => it && it.files && (it.kind === 'game' || it.kind === 'app');
const disc = (it) => (it.sale && it.sale.disc > 0 && (!it.sale.until || it.sale.until > now()) ? it.sale.disc : 0);
const priceOf = (it) => (it && it.sale && it.sale.price > 0 ? Math.max(1, Math.round(it.sale.price * (1 - disc(it) / 100))) : 0);
const owns = (u, it) => !!(u && it && (it.owner === u.id || (u.lib && u.lib[it.id]) || ['owner', 'admin'].includes(u.role)));
const paid = (it) => !!(it && it.sale && it.sale.price > 0);
const locked = (u, it) => paid(it) && !owns(u, it);

// signed key for the play address of a paid game: <exp36>.<sig>, valid for 12 hours, bound to the game
function playKey(it, u) { const exp = Math.floor((now() + 12 * 3600000) / 1000).toString(36); return exp + '.' + crypto.createHmac('sha256', cfg.secret).update('play|' + it.id + '|' + exp).digest('base64url').slice(0, 22); }
function checkKey(id, key) {
  const [exp, sig] = String(key || '').split('.'); if (!exp || !sig) return false; if (parseInt(exp, 36) * 1000 < now()) return false;
  const good = crypto.createHmac('sha256', cfg.secret).update('play|' + id + '|' + exp).digest('base64url').slice(0, 22);
  return sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good));
}
function saleView(it, u) { return { price: it.sale && it.sale.price > 0 ? it.sale.price : 0, disc: disc(it), until: it.sale && it.sale.until && disc(it) ? it.sale.until : 0, eff: priceOf(it), owned: owns(u, it), sales: it.sales || 0, wished: !!(u && (u.wish || []).includes(it.id)), locked: locked(u, it) }; }
function card(it, u) { const v = require('./routes/hub').view(it, u); v.sale = saleView(it, u); return v; }

function setSale(u, id, body) {
  const it = items()[id]; if (!it || it.owner !== u.id) throw new HttpError(404, 'no_item', 'Not found'); if (!isGame(it)) throw new HttpError(400, 'not_game', 'Only games and apps can be sold');
  const price = Math.trunc(Number(body.price) || 0); if (price < 0 || price > MAX_PRICE) throw new HttpError(400, 'bad_price', `Price between 0 and ${MAX_PRICE}`);
  const d = Math.trunc(Number(body.disc) || 0); if (d < 0 || d > 90) throw new HttpError(400, 'bad_disc', 'Discount between 0 and 90 %');
  const days = Math.max(1, Math.min(30, Math.trunc(Number(body.days) || 7)));
  const wasSale = disc(it) > 0; it.sale = Object.assign(it.sale || {}, { price, disc: price ? d : 0, until: d ? now() + days * 86400000 : 0, since: (it.sale && it.sale.since) || now() });
  if (price && it.allowDownload) it.allowDownload = false; // paid games cannot be downloaded by everyone
  S.store.touch('hubitems');
  // wishlist alert when a discount starts
  if (d && !wasSale) for (const w of Object.values(S.users)) if (w && w.wish && w.wish.includes(it.id) && !owns(w, it)) hub.push(w.id, { t: 'notice', text: `🏷️ “${it.title}” is ${d}% off in Nebula Vault`, es: `🏷️ «${it.title}» tiene un ${d} % de descuento en Nebula Vault` });
  return saleView(it, u);
}
function buy(u, id) {
  const econ = require('./economy'); const it = items()[id]; if (!it || it.public === false || !isGame(it)) throw new HttpError(404, 'no_item', 'Not found');
  if (owns(u, it)) throw new HttpError(409, 'owned', 'It is already in your library');
  const p = priceOf(it); u.lib = u.lib || {};
  if (p > 0) { if (!econ.adjust(u, -p, 'vault:buy:' + id)) throw new HttpError(402, 'no_funds', 'Not enough coins'); const o = S.users[it.owner]; if (o) { econ.adjust(o, Math.floor(p * CUT), 'vault:sale:' + id); hub.push(o.id, { t: 'notice', text: `💸 @${u.username} bought “${it.title}” (+${Math.floor(p * CUT)} coins)`, es: `💸 @${u.username} ha comprado «${it.title}» (+${Math.floor(p * CUT)} monedas)` }); } it.sales = (it.sales || 0) + 1; it.revenue = (it.revenue || 0) + Math.floor(p * CUT); S.store.touch('hubitems'); }
  u.lib[id] = { t: now(), p }; u.wish = (u.wish || []).filter((x) => x !== id); S.store.touch('users');
  try { require('./market').demand('vault', 1); } catch {}
  return { ok: true, coins: u.coins, sale: saleView(it, u) };
}
function refund(u, id) {
  const econ = require('./economy'); const it = items()[id]; const l = u.lib && u.lib[id]; if (!it || !l) throw new HttpError(404, 'no_item', 'Not in your library');
  if (now() - l.t > REFUND_MS) throw new HttpError(403, 'too_late', 'Refunds are possible for 30 minutes after buying');
  if (l.p > 0) { const o = S.users[it.owner]; const share = Math.floor(l.p * CUT); if (o && !econ.adjust(o, -share, 'vault:refund:' + id)) throw new HttpError(409, 'creator', 'The creator has already spent the coins — it cannot be refunded'); econ.adjust(u, l.p, 'vault:refund:' + id); it.sales = Math.max(0, (it.sales || 1) - 1); it.revenue = Math.max(0, (it.revenue || 0) - share); S.store.touch('hubitems'); }
  delete u.lib[id]; S.store.touch('users'); return { ok: true, coins: u.coins };
}
function wish(u, id) { const it = items()[id]; if (!it) throw new HttpError(404, 'no_item', 'Not found'); u.wish = u.wish || []; const i = u.wish.indexOf(id); if (i >= 0) u.wish.splice(i, 1); else u.wish.unshift(id); u.wish = u.wish.slice(0, 200); S.store.touch('users'); return { wished: i < 0 }; }

function store(u, q = {}) {
  const all = Object.values(items()).filter((it) => isGame(it) && it.public !== false);
  const term = String(q.q || '').trim().toLowerCase().slice(0, 60); const tag = String(q.tag || '').toLowerCase().slice(0, 24);
  let list = all; if (term) list = list.filter((it) => it.title.toLowerCase().includes(term) || (it.tags || []).some((t) => t.includes(term))); if (tag) list = list.filter((it) => (it.tags || []).includes(tag));
  const rating = require('./routes/hub').internals.ratingOf; const score = (it) => (it.views || 0) + (it.likes || []).length * 10 + (it.sales || 0) * 25 + ((rating(it.id) || { avg: 0 }).avg * 20);
  const by = (arr, f, n = 12) => arr.slice().sort(f).slice(0, n).map((it) => card(it, u));
  const tags = {}; for (const it of all) for (const t of it.tags || []) tags[t] = (tags[t] || 0) + 1;
  return {
    featured: by(all.filter((it) => it.thumb), (a, b) => score(b) - score(a), 5),
    deals: by(all.filter((it) => disc(it) > 0), (a, b) => disc(b) - disc(a)),
    top: by(all.filter(paid), (a, b) => (b.sales || 0) - (a.sales || 0) || score(b) - score(a)),
    rated: by(all.filter((it) => rating(it.id)), (a, b) => (rating(b.id).avg * 100 + rating(b.id).n) - (rating(a.id).avg * 100 + rating(a.id).n)),
    fresh: by(all, (a, b) => (b.updated || b.created) - (a.updated || a.created)),
    free: by(all.filter((it) => !paid(it)), (a, b) => score(b) - score(a)),
    results: term || tag ? by(list, (a, b) => score(b) - score(a), 60) : null,
    tags: Object.entries(tags).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([t, n]) => ({ t, n })),
    counts: { games: all.length, paid: all.filter(paid).length, deals: all.filter((it) => disc(it) > 0).length },
    coins: u.coins,
  };
}
function library(u) {
  const lib = u.lib || {}; const its = items();
  const owned = Object.keys(lib).map((id) => its[id]).filter(Boolean).map((it) => Object.assign(card(it, u), { bought: lib[it.id].t, paid: lib[it.id].p, refundable: lib[it.id].p > 0 && now() - lib[it.id].t < REFUND_MS }));
  const made = Object.values(its).filter((it) => it.owner === u.id && isGame(it)).map((it) => Object.assign(card(it, u), { revenue: it.revenue || 0 }));
  const wished = (u.wish || []).map((id) => its[id]).filter((it) => it && it.public !== false).map((it) => card(it, u));
  return { owned, made, wish: wished, earned: made.reduce((a, x) => a + (x.revenue || 0), 0), sold: made.reduce((a, x) => a + (x.sale.sales || 0), 0) };
}
module.exports = { setSale, buy, refund, wish, store, library, owns, locked, paid, playKey, checkKey, saleView, priceOf };
