'use strict';
// Levels, achievements, daily quests, leaderboards and the public progress card shown on profiles.
const { S, publicUser } = require('../state');
const prog = require('../progress');
const { HttpError } = require('../util');

const BOARDS = ['xp', 'weekly', 'coins', 'duels', 'arcade_snake', 'arcade_2048', 'arcade_aim', 'arcade_typing'];

module.exports = function register(r) {
  r.get('/api/progress', { auth: true }, async (c) => prog.stateOf(c.user));
  // season pass (free, monthly)
  r.get('/api/season', { auth: true, limit: [120, 60000, 'user'] }, async (c) => require('../season').view(c.user));
  r.post('/api/season/claim', { auth: true, verified: true, limit: [60, 60000, 'user'] }, async (c) => require('../season').claim(c.user, c.body.tier === 'all' ? 'all' : c.body.tier));

  r.post('/api/progress/quests/:id/claim', { auth: true, verified: true, limit: [30, 60000, 'user'] }, async (c) => {
    const out = prog.claimQuest(c.user, String(c.params.id));
    return Object.assign(out, { state: prog.stateOf(c.user), coins: c.user.coins });
  });

  // Events only the browser can see (a benchmark finished, a distro opened…). Heavily capped server-side.
  r.post('/api/progress/event', { auth: true, verified: true, limit: [60, 60000, 'user'] }, async (c) => {
    const type = String(c.body.type || '');
    if (!prog.CLIENT_EVENTS.includes(type)) throw new HttpError(400, 'bad_event', 'Unknown event');
    const res = prog.award(c.user, type);
    return { ok: true, counted: !!res, gained: res ? res.gained : 0 };
  });

  r.put('/api/progress/showcase', { auth: true, verified: true, limit: [30, 60000, 'user'] }, async (c) => ({ showcase: prog.setShowcase(c.user, c.body.ids) }));

  r.get('/api/leaderboard', { auth: true, verified: true, limit: [60, 60000, 'user'] }, async (c) => {
    const kind = BOARDS.includes(c.query.kind) ? c.query.kind : 'xp';
    return prog.leaderboard(kind, c.user);
  });

  // Public progress card for a profile: level, unlocked achievements and the 3 showcased ones.
  r.get('/api/users/:id/progress', { auth: true, verified: true, limit: [120, 60000, 'user'] }, async (c) => {
    const u = S.users[c.params.id];
    if (!u || u.deleted || !u.verified) throw new HttpError(404, 'no_user', 'User not found');
    const p = prog.ensure(u);
    return {
      user: publicUser(u), level: prog.levelInfo(p.xp),
      achievements: Object.entries(p.ach).map(([id, t]) => ({ id, t })).sort((a, b) => b.t - a.t),
      showcase: p.showcase, duelWins: p.cnt.duelWins || 0, best: { snake: p.best.arcade_snake || 0, '2048': p.best.arcade_2048 || 0, aim: p.best.arcade_aim || 0, typing: p.best.arcade_typing || 0 },
    };
  });
};
