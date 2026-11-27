'use strict';
const { S, isPro, selfUser, publicUser } = require('../state');
const econ = require('../economy');
const casino = require('../casino');
const { HttpError } = require('../util');

module.exports = function register(r) {
  r.get('/api/economy/state', { auth: true }, async (c) => {
    const u = c.user;
    return { coins: u.coins, tx: u.tx || [], daily: econ.dailyState(u), stats: u.stats || {} };
  });

  r.post('/api/economy/daily/shield', { auth: true, verified: true, limit: [10, 60000, 'user'] }, async (c) => ({ daily: econ.buyFreeze(c.user), coins: c.user.coins }));
  r.post('/api/economy/daily', { auth: true, verified: true, limit: [10, 60000, 'user'] }, async (c) => {
    return econ.claimDaily(c.user);
  });

  r.get('/api/market', { auth: true }, async (c) => {
    const u = c.user;
    const mk = require('../market'); return { items: econ.items.map((it) => (it.price > 0 && !it.shop ? Object.assign({}, it, { price: mk.price(it.price, it.id), base: it.price }) : it)), inv: u.inv, eq: u.eq || {}, coins: u.coins, pro: isPro(u), index: mk.index(), mood: mk.mood(mk.index()) };
  });

  r.post('/api/market/buy', { auth: true, verified: true, limit: [30, 60000, 'user'] }, async (c) => {
    const it = econ.buy(c.user, String(c.body.id || ''));
    return { ok: true, item: it, coins: c.user.coins, inv: c.user.inv };
  });

  r.post('/api/market/equip', { auth: true, verified: true, limit: [60, 60000, 'user'] }, async (c) => {
    econ.equip(c.user, String(c.body.slot || ''), c.body.id === undefined ? null : c.body.id);
    return { ok: true, user: selfUser(c.user) };
  });

  // ---- casino ----
  r.get('/api/casino/state', { auth: true }, async (c) => {
    return {
      coins: c.user.coins, fair: casino.fairPublic(c.user), stats: c.user.stats || {},
      config: Object.assign({ min: casino.MIN_BET, max: casino.MAX_BET, coin: casino.COIN_MULT, slots: { symbols: casino.SLOT_SYMBOLS, pay: casino.SLOT_PAY, twoCherry: casino.TWO_CHERRY } }, casino.EXTRA_CFG),
      rounds: casino.roundsOf(c.user), daily: casino.dailyState(c.user),
    };
  });
  r.get('/api/casino/leaderboard', { auth: true, limit: [30, 60000, 'user'] }, async () => casino.leaderboard());
  r.post('/api/casino/fair/seed', { auth: true, verified: true, limit: [20, 60000, 'user'] }, async (c) => {
    casino.setClientSeed(c.user, c.body.seed);
    return { fair: casino.fairPublic(c.user) };
  });
  r.post('/api/casino/fair/rotate', { auth: true, verified: true, limit: [20, 60000, 'user'] }, async (c) => {
    const out = casino.rotate(c.user);
    return Object.assign(out, { fair: casino.fairPublic(c.user) });
  });
  r.post('/api/casino/limits', { auth: true, verified: true, limit: [20, 60000, 'user'] }, async (c) => {
    casino.setLimits(c.user, { limit: c.body.limit, pauseHours: c.body.pauseHours });
    return { fair: casino.fairPublic(c.user) };
  });
  // stateful games (bet is taken when the round starts)
  r.post('/api/casino/mines/start', { auth: true, verified: true, limit: [120, 60000, 'user'] }, async (c) => casino.minesStart(c.user, c.body));
  r.post('/api/casino/mines/pick', { auth: true, verified: true, limit: [300, 60000, 'user'] }, async (c) => casino.minesPick(c.user, c.body));
  r.post('/api/casino/mines/cashout', { auth: true, verified: true, limit: [120, 60000, 'user'] }, async (c) => casino.minesCashout(c.user));
  r.post('/api/casino/tower/start', { auth: true, verified: true, limit: [120, 60000, 'user'] }, async (c) => casino.towerStart(c.user, c.body));
  r.post('/api/casino/tower/pick', { auth: true, verified: true, limit: [300, 60000, 'user'] }, async (c) => casino.towerPick(c.user, c.body));
  r.post('/api/casino/tower/cashout', { auth: true, verified: true, limit: [120, 60000, 'user'] }, async (c) => casino.towerCashout(c.user));
  r.post('/api/casino/blackjack/deal', { auth: true, verified: true, limit: [120, 60000, 'user'] }, async (c) => casino.bjStart(c.user, c.body));
  r.post('/api/casino/blackjack/:action', { auth: true, verified: true, limit: [300, 60000, 'user'] }, async (c) => casino.bjAction(c.user, c.params.action));
  r.post('/api/casino/videopoker/deal', { auth: true, verified: true, limit: [120, 60000, 'user'] }, async (c) => casino.vpDeal(c.user, c.body));
  r.post('/api/casino/videopoker/draw', { auth: true, verified: true, limit: [120, 60000, 'user'] }, async (c) => casino.vpDraw(c.user, c.body));
  r.post('/api/casino/hilo/start', { auth: true, verified: true, limit: [120, 60000, 'user'] }, async (c) => casino.hlStart(c.user, c.body));
  r.post('/api/casino/hilo/guess', { auth: true, verified: true, limit: [300, 60000, 'user'] }, async (c) => casino.hlGuess(c.user, c.body));
  r.post('/api/casino/hilo/cashout', { auth: true, verified: true, limit: [120, 60000, 'user'] }, async (c) => casino.hlCashout(c.user));
  r.get('/api/casino/jackpot', { auth: true, limit: [120, 60000, 'user'] }, async (c) => ({ jackpot: casino.jpPublic(c.user) }));
  r.post('/api/casino/jackpot/join', { auth: true, verified: true, limit: [30, 60000, 'user'] }, async (c) => casino.jpDeposit(c.user, c.body));
  casino.startJackpot();

  r.post('/api/casino/daily', { auth: true, verified: true, limit: [10, 60000, 'user'] }, async (c) => casino.dailySpin(c.user));
  r.post('/api/casino/play/:game', { auth: true, verified: true, limit: [150, 60000, 'user'] }, async (c) => {
    return casino.play(c.user, c.params.game, c.body);
  });
};
