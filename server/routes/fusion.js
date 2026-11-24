'use strict';
// Nebula Fusion and Nebula Dash APIs (13.8). See server/fusion.js and public/js/views/dash.js.
const fu = require('../fusion');
const { HttpError, dayKey } = require('../util');
const { S } = require('../state');
const DASH = { stardust: 60, neon: 120, overdrive: 250, pulse: 120, core: 300 }; // first completion; then 15 a day per level
module.exports = function register(r) {
  r.get('/api/fusion', { auth: true }, async (c) => fu.state(c.user));
  r.get('/api/fusion/board', { auth: true }, async (c) => ({ board: fu.board(c.user) }));
  r.post('/api/fusion/combine', { auth: true, verified: true, limit: [40, 60000, 'user'] }, async (c) => fu.combine(c.user, c.body.a, c.body.b));
  r.get('/api/race', { auth: true }, async (c) => require('../race').view(c.user));
  r.post('/api/dash/complete', { auth: true, verified: true, limit: [20, 60000, 'user'] }, async (c) => {
    const id = String(c.body.level || ''); if (!DASH[id]) throw new HttpError(400, 'bad_level', 'Unknown level');
    const u = c.user; const d = (u.dash = u.dash || { done: {}, day: {} }); const today = dayKey(); let coins = 0;
    if (!d.done[id]) { d.done[id] = Date.now(); coins = DASH[id]; } else if (d.day[id] !== today) { coins = 15; }
    d.day[id] = today; if (coins) require('../economy').adjust(u, coins, 'dash:' + id); S.store.touch('users');
    try { require('../progress').award(u, 'dash'); require('../progress').award(u, 'win'); } catch {}
    return { coins, first: coins === DASH[id] };
  });
};
