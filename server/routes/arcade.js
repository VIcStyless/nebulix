'use strict';
// Arcade: personal bests + leaderboards for the built-in mini-games, and the 1v1 duel API.
const { S } = require('../state');
const econ = require('../economy');
const prog = require('../progress');
const duels = require('../duels');
const { HttpError, dayKey, now, Limiter } = require('../util');

// Plausibility rules — scores come from the browser, so we reject the impossible and keep rewards tiny.
const GAMES = {
  snake: { max: 400, check: (s, ms) => ms >= s * 110 },
  2048: { max: 4000000, check: (s, ms) => ms >= s * 1.5 },
  aim: { max: 200, check: (s, ms) => ms >= 25000 && ms <= 45000 && s <= ms / 140 },
  typing: { max: 250, check: (s, ms) => ms >= 14000 },
  blocks: { max: 2000000, check: (s, ms) => ms >= s * 0.5 },
  flap: { max: 2000, check: (s, ms) => ms >= s * 1100 },
  paddle: { max: 300, check: (s, ms) => ms >= s * 1500 },
  defenders: { max: 1000000, check: (s, ms) => ms >= s * 8 },
  bricks: { max: 500000, check: (s, ms) => ms >= s * 5 },
  ops: { max: 400000, check: (s, ms) => ms >= s * 10 },
  stocks: { max: 1200, check: (s, ms) => ms >= 55000 && ms <= 90000 && s <= ms / 50 },
  memory: { max: 100, check: (s, ms) => ms >= (s * (s + 1) / 2) * 450 },
  dash: { max: 20000, check: (s, ms) => ms >= s * 90 },
  stack: { max: 600, check: (s, ms) => ms >= s * 280 },
  // Nebulix 3.0
  mines: { max: 3000, check: (s, ms) => ms >= 3000 },
  sudoku: { max: 1900, check: (s, ms) => ms >= 25000 },
  rocks: { max: 500000, check: (s, ms) => ms >= s * 4 },
  gems: { max: 100000, check: (s, ms) => ms >= 55000 && ms <= 120000 },
  reflex: { max: 1000, check: (s, ms) => ms >= 5000 },
  chess: { max: 1000, check: (s, ms) => ms >= 20000 },
  solitaire: { max: 3500, check: (s, ms) => ms >= 45000 },
  checkers: { max: 900, check: (s, ms) => ms >= 20000 },
  bubbles: { max: 300000, check: (s, ms) => ms >= s * 2 },
  td: { max: 200000, check: (s, ms) => ms >= s * 15 },
  words: { max: 2200, check: (s, ms) => ms >= 15000 },
};
const scoreLim = new Limiter(1, 4000);
const DAILY_COIN_CAP = 60;

module.exports = function register(r) {
  duels.start();

  r.post('/api/arcade/score', { auth: true, verified: true, limit: [30, 60000, 'user'] }, async (c) => {
    const u = c.user; const game = String(c.body.game || ''); const g = GAMES[game];
    if (!g) throw new HttpError(400, 'bad_game', 'Unknown game');
    const score = Math.trunc(Number(c.body.score)); const ms = Math.trunc(Number(c.body.ms));
    if (!Number.isFinite(score) || score < 0 || score > g.max || !Number.isFinite(ms) || ms < 0 || ms > 6 * 3600000) throw new HttpError(400, 'bad_score', 'That score is not valid');
    if (!g.check(score, ms)) throw new HttpError(400, 'implausible', 'That score does not add up');
    if (!scoreLim.hit(u.id)) throw new HttpError(429, 'rate_limited', 'Slow down a little');
    const a = (u.arcade = u.arcade || {}); const rec = (a[game] = a[game] || { best: 0, runs: 0 });
    const pb = score > rec.best; rec.runs++; rec.last = now(); if (pb) rec.best = score;
    // tiny coin reward: 1 per run, +5 for a personal best, capped per day
    const day = (u.arcadeDay = u.arcadeDay && u.arcadeDay.d === dayKey() ? u.arcadeDay : { d: dayKey(), coins: 0 });
    const want = 1 + (pb && score > 0 ? 5 : 0); const coins = Math.max(0, Math.min(want, DAILY_COIN_CAP - day.coins));
    if (coins) { day.coins += coins; econ.adjust(u, coins, 'arcade:' + game); }
    S.store.touch('users');
    const res = prog.award(u, 'arcade', 1, { game, score });
    try { require('../tournaments').onScore(u, game, score); } catch {}
    if (pb && score > 0) { // a new all-time Nebulix record for this game goes to Nebulix Live
      let top = 0; for (const x of Object.values(S.users)) if (x.id !== u.id && x.arcade && x.arcade[game] && !x.deleted) top = Math.max(top, x.arcade[game].best || 0);
      if (score > top && top > 0) { const nm = (require('../tournaments').GAMES.find((x) => x[0] === game) || [game, game])[1]; require('../feed').add('record', '👑', [`@${u.username} set a new Nebulix record in ${nm}: ${score}`, `@${u.username} ha batido el récord de Nebulix en ${nm}: ${score}`], { uid: u.id, link: '#/arcade?play=' + game }); }
    }
    return { best: rec.best, pb, runs: rec.runs, coins, xp: res ? res.gained : 0 };
  });

  r.get('/api/arcade/me', { auth: true }, async (c) => ({ games: c.user.arcade || {}, coinsToday: c.user.arcadeDay && c.user.arcadeDay.d === dayKey() ? c.user.arcadeDay.coins : 0, cap: DAILY_COIN_CAP }));

  r.get('/api/arcade/leaderboard/:game', { auth: true, verified: true, limit: [60, 60000, 'user'] }, async (c) => {
    if (!GAMES[c.params.game]) throw new HttpError(404, 'bad_game', 'Unknown game');
    return prog.leaderboard('arcade_' + c.params.game, c.user);
  });

  // ---- duels ----
  r.get('/api/duels', { auth: true, verified: true }, async (c) => duels.listFor(c.user));
  r.get('/api/duels/ratings', { auth: true }, async (c) => ({ game: String(c.query.game || 'chess'), list: duels.ratings(String(c.query.game || 'chess')), me: (c.user.elo || {})[String(c.query.game || 'chess')] || 1200 }));
  r.get('/api/duels/live', { auth: true, verified: true }, async (c) => ({ duels: duels.live(c.user) }));
  r.get('/api/duels/:id/watch', { auth: true, verified: true, limit: [120, 60000, 'user'] }, async (c) => ({ duel: duels.watch(c.user, c.params.id) }));
  r.get('/api/duels/:id', { auth: true, verified: true }, async (c) => ({ duel: duels.viewFor(duels.get(c.params.id, c.user), c.user.id) }));
  r.post('/api/duels', { auth: true, verified: true, limit: [40, 600000, 'user'] }, async (c) => ({ duel: duels.create(c.user, c.body || {}) }));
  r.post('/api/duels/:id/accept', { auth: true, verified: true, limit: [30, 60000, 'user'] }, async (c) => ({ duel: duels.accept(c.user, c.params.id) }));
  r.post('/api/duels/:id/decline', { auth: true, verified: true, limit: [30, 60000, 'user'] }, async (c) => ({ duel: duels.decline(c.user, c.params.id) }));
  r.post('/api/duels/:id/move', { auth: true, verified: true, limit: [180, 60000, 'user'] }, async (c) => ({ duel: duels.move(c.user, c.params.id, c.body || {}) }));
  r.post('/api/duels/:id/resign', { auth: true, verified: true, limit: [30, 60000, 'user'] }, async (c) => ({ duel: duels.resign(c.user, c.params.id) }));
  r.post('/api/duels/:id/rematch', { auth: true, verified: true, limit: [40, 600000, 'user'] }, async (c) => ({ duel: duels.rematch(c.user, c.params.id) }));
};
