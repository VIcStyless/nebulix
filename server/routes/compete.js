'use strict';
// Nebulix 13 routes: daily Shop, Locker, live economy, ranked, duel challenges and Nebula Vault.
const { S, hub, publicUser } = require('../state');
const { HttpError } = require('../util');
const shop = require('../shop');
const market = require('../market');
const ranked = require('../ranked');
const vault = require('../vault');
const econ = require('../economy');

const findUser = (name) => Object.values(S.users).find((x) => x && !x.deleted && x.username && x.username.toLowerCase() === String(name || '').replace(/^@/, '').trim().toLowerCase());
module.exports = function register(r) {
  market.start();
  // ---- shop + locker ----
  r.get('/api/shop', { auth: true }, async (c) => shop.view(c.user));
  r.post('/api/shop/buy', { auth: true, verified: true, limit: [40, 60000, 'user'] }, async (c) => shop.buy(c.user, c.body.id));
  r.post('/api/shop/gift', { auth: true, verified: true, limit: [15, 60000, 'user'] }, async (c) => shop.gift(c.user, c.body.id, c.body.to));
  r.get('/api/locker', { auth: true }, async (c) => shop.locker(c.user));
  r.post('/api/locker/equip', { auth: true, limit: [120, 60000, 'user'] }, async (c) => {
    const slot = String(c.body.slot || ''); if (![...econ.LOCK_CATS.filter((x) => x !== 'emote'), 'emotes'].includes(slot)) throw new HttpError(400, 'bad_slot', 'Unknown slot');
    econ.equip(c.user, slot, c.body.id === undefined ? null : c.body.id); return shop.locker(c.user);
  });
  r.get('/api/locker/of/:username', { auth: true }, async (c) => { const u = findUser(c.params.username); if (!u) throw new HttpError(404, 'no_user', 'User not found'); return { user: publicUser(u), lk: shop.lockerSpec(u) }; });
  // ---- player marketplace ----
  const trade = require('../trade');
  r.get('/api/trade', { auth: true, limit: [120, 60000, 'user'] }, async (c) => trade.browse(c.user, c.query || {}));
  r.get('/api/trade/mine', { auth: true }, async (c) => trade.mine(c.user));
  r.get('/api/trade/item/:id', { auth: true }, async (c) => trade.item(c.user, c.params.id));
  r.post('/api/trade/list', { auth: true, verified: true, limit: [30, 60000, 'user'] }, async (c) => trade.list(c.user, c.body.item, c.body.price));
  r.post('/api/trade/:id/buy', { auth: true, verified: true, limit: [40, 60000, 'user'] }, async (c) => trade.buy(c.user, c.params.id));
  r.post('/api/trade/:id/cancel', { auth: true, limit: [60, 60000, 'user'] }, async (c) => trade.cancel(c.user, c.params.id));
  // ---- economy ----
  r.get('/api/economy/market', { auth: true }, async (c) => market.publicView(['owner', 'admin'].includes(c.user.role)));
  r.post('/api/economy/market/refresh', { auth: true }, async (c) => { if (!['owner', 'admin'].includes(c.user.role)) throw new HttpError(403, 'forbidden', 'Staff only'); market.update(); return market.publicView(true); });
  // ---- ranked ----
  r.get('/api/ranked', { auth: true }, async (c) => ranked.mine(c.user));
  r.get('/api/ranked/board', { auth: true, limit: [60, 60000, 'user'] }, async (c) => ranked.board(String(c.query.mode || 'royale'), c.user));
  r.get('/api/ranked/of/:username', { auth: true }, async (c) => { const u = findUser(c.params.username); if (!u) throw new HttpError(404, 'no_user', 'User not found'); const m = ranked.mine(u); return { user: publicUser(u), modes: m.modes, season: m.season }; });
  // ---- duel challenges ----
  r.post('/api/arena/duel/challenge', { auth: true, verified: true, limit: [12, 60000, 'user'] }, async (c) => {
    const to = findUser(c.body.to); if (!to) throw new HttpError(404, 'no_user', 'User not found'); if (to.id === c.user.id) throw new HttpError(400, 'self', 'You cannot challenge yourself');
    const bet = Math.max(0, Math.min(1e12, Math.trunc(Number(c.body.bet) || 0))); if (bet && c.user.coins < bet && !c.user.infinite) throw new HttpError(402, 'no_funds', 'You do not have that many coins');
    if (!hub.online(to.id)) throw new HttpError(409, 'offline', 'That player is not online right now');
    const ch = require('../arena').challenge(c.user, to, bet);
    hub.push(to.id, { t: 'ar_invite', id: ch.id, from: publicUser(c.user), bet, exp: ch.exp });
    return { id: ch.id, to: publicUser(to), exp: ch.exp };
  });
  r.get('/api/arena/duel/invites', { auth: true }, async (c) => ({ invites: require('../arena').invitesFor(c.user.id).map((x) => ({ id: x.id, from: publicUser(S.users[x.from]), bet: x.bet, exp: x.exp })) }));
  r.post('/api/arena/duel/accept', { auth: true, verified: true, limit: [20, 60000, 'user'] }, async (c) => {
    const out = await require('../arena').accept(c.user, c.body.id);
    hub.push(out.from.id, { t: 'ar_go', room: out.room, game: 'duel', by: publicUser(c.user) });
    return { room: out.room };
  });
  r.post('/api/arena/duel/decline', { auth: true, limit: [30, 60000, 'user'] }, async (c) => { const ch = require('../arena').decline(c.user, c.body.id); if (ch && ch.from !== c.user.id) hub.push(ch.from, { t: 'notice', text: `@${c.user.username} declined your duel`, es: `@${c.user.username} ha rechazado tu duelo` }); return { ok: true }; });
  // ---- Nebula Vault ----
  r.get('/api/vault', { auth: true, limit: [120, 60000, 'user'] }, async (c) => vault.store(c.user, c.query ? { q: c.query.q, tag: c.query.tag } : {}));
  r.get('/api/vault/library', { auth: true }, async (c) => vault.library(c.user));
  r.post('/api/vault/:id/buy', { auth: true, verified: true, limit: [30, 60000, 'user'] }, async (c) => vault.buy(c.user, c.params.id));
  r.post('/api/vault/:id/refund', { auth: true, verified: true, limit: [10, 60000, 'user'] }, async (c) => vault.refund(c.user, c.params.id));
  r.post('/api/vault/:id/wish', { auth: true, limit: [60, 60000, 'user'] }, async (c) => vault.wish(c.user, c.params.id));
  r.post('/api/vault/:id/sale', { auth: true, verified: true, limit: [30, 60000, 'user'] }, async (c) => vault.setSale(c.user, c.params.id, c.body || {}));
};
