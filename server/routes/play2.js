'use strict';
// Routes for Tournaments, Nebulix Quiz and Nebula Worlds (logic lives in server/tournaments.js, quiz.js, worlds.js).
const tour = require('../tournaments');
const quiz = require('../quiz');
const worlds = require('../worlds');
const { HttpError } = require('../util');

module.exports = function register(r) {
  tour.start();
  const R = { auth: true, limit: [120, 60000, 'user'] }; const W = (n) => ({ auth: true, verified: true, limit: [n, 60000, 'user'] });
  // tournaments
  r.get('/api/tournaments', R, async (c) => tour.list(c.user));
  r.get('/api/tournaments/:id', R, async (c) => tour.detail(c.user, c.params.id));
  r.post('/api/tournaments/:id/join', W(20), async (c) => tour.join(c.user, c.params.id));
  // quiz
  r.get('/api/quiz', R, async (c) => quiz.catalog(c.user));
  r.get('/api/quiz/q/:id', R, async (c) => { const q = quiz.findQuiz(c.params.id); if (!q || (!q.builtin && q.owner !== c.user.id && !q.public)) throw new HttpError(404, 'no_quiz', 'Quiz not found'); return { quiz: { id: c.params.id, title: q.title, emoji: q.emoji, public: !!q.public, mine: q.owner === c.user.id, questions: q.questions } }; });
  r.post('/api/quiz/save', W(20), async (c) => quiz.saveQuiz(c.user, c.body || {}));
  r.delete('/api/quiz/q/:id', W(20), async (c) => { const all = require('../state').S.store.table('quizzes'); const q = all[c.params.id]; if (!q || q.owner !== c.user.id) throw new HttpError(404, 'no_quiz', 'Not found'); delete all[c.params.id]; require('../state').S.store.touch('quizzes'); return { ok: true }; });
  r.post('/api/quiz/host', W(20), async (c) => quiz.host(c.user, c.body.quiz));
  r.post('/api/quiz/join', W(30), async (c) => quiz.join(c.user, String(c.body.pin || '').replace(/\D/g, '')));
  r.get('/api/quiz/live/:pin', { auth: true, limit: [240, 60000, 'user'] }, async (c) => quiz.state(c.user, c.params.pin));
  r.post('/api/quiz/live/:pin/control', W(120), async (c) => quiz.control(c.user, c.params.pin, String(c.body.action || '')));
  r.post('/api/quiz/live/:pin/answer', W(120), async (c) => quiz.answer(c.user, c.params.pin, c.body.i));
  r.post('/api/quiz/live/:pin/leave', W(60), async (c) => quiz.leave(c.user, c.params.pin));
  // worlds
  r.get('/api/worlds', R, async (c) => worlds.view(c.user));
  r.post('/api/worlds/gear/buy', W(30), async (c) => worlds.buyGear(c.user, String(c.body.id || '')));
  r.post('/api/worlds/gear/equip', W(60), async (c) => worlds.equip(c.user, String(c.body.id || '')));
  r.post('/api/worlds/pass', W(10), async (c) => worlds.buyPass(c.user, String(c.body.id || '')));
  r.post('/api/worlds/finish', W(20), async (c) => worlds.finish(c.user, c.body.w, c.body.ms));
  // community worlds (World Builder)
  r.get('/api/worlds/ugc', R, async (c) => worlds.ugcList(c.user, String((c.query || {}).sort || '')));
  r.get('/api/worlds/ugc/:id', R, async (c) => worlds.ugcGet(c.user, c.params.id));
  r.post('/api/worlds/ugc', W(40), async (c) => worlds.ugcSave(c.user, c.body || {}));
  r.delete('/api/worlds/ugc/:id', W(20), async (c) => worlds.ugcDelete(c.user, c.params.id));
  r.post('/api/worlds/ugc/:id/like', W(60), async (c) => worlds.ugcLike(c.user, c.params.id));
  r.post('/api/worlds/ugc/:id/play', W(60), async (c) => worlds.ugcPlay(c.user, c.params.id));
  r.post('/api/worlds/ugc/:id/finish', W(30), async (c) => worlds.ugcFinish(c.user, c.params.id, c.body.ms));
  // clans
  const clans = require('../clans'); const leagues = require('../leagues'); const boss = require('../boss');
  r.get('/api/clans', R, async (c) => clans.overview(c.user));
  r.get('/api/clans/:id', R, async (c) => clans.view(c.user, c.params.id));
  r.post('/api/clans', W(10), async (c) => clans.create(c.user, c.body || {}));
  r.post('/api/clans/:id/join', W(20), async (c) => clans.join(c.user, c.params.id));
  r.post('/api/clan/leave', W(20), async (c) => clans.leave(c.user));
  r.post('/api/clan/manage', W(60), async (c) => clans.manage(c.user, c.body || {}));
  // leagues
  r.get('/api/leagues', R, async (c) => leagues.view(c.user));
  // world boss
  boss.start();
  r.get('/api/boss', { auth: true, limit: [240, 60000, 'user'] }, async (c) => boss.view(c.user));
  r.post('/api/boss/power', W(30), async (c) => boss.power(c.user, String(c.body.id || '')));
  r.post('/api/boss/summon', W(5), async (c) => boss.summon(c.user));
  // player card for profiles: clan, league, level, bosses, worlds, tournaments, Arcade bests, season
  r.get('/api/players/:id/card', R, async (c) => {
    const st = require('../state'); const u = st.S.users[c.params.id]; if (!u || u.deleted) throw new HttpError(404, 'no_user', 'User not found');
    const lt = leagues.TIERS[(u.league && u.league.tier) || 0]; const cl = clans.tagOf(u); const cobj = cl ? st.S.store.table('clans')[cl.id] : null;
    const mine = Object.values(st.S.store.table('ugcworlds')).filter((w) => w.owner === u.id && w.pub);
    const names = Object.fromEntries(tour.GAMES);
    const arcade = Object.entries(u.arcade || {}).filter(([, x]) => x && x.best > 0).sort((a, b) => (b[1].runs || 0) - (a[1].runs || 0)).slice(0, 4).map(([g, x]) => ({ game: g, name: names[g] || g, best: x.best, runs: x.runs || 0 }));
    let season = null; try { const sv = require('../season').view(u); season = { tier: sv.tier, tiers: sv.tiers }; } catch {}
    return { level: require('../progress').levelOfUser(u), league: { tier: (u.league && u.league.tier) || 0, best: (u.league && u.league.best) || 0, icon: lt.icon, n: lt.n, color: lt.color },
      clan: cobj ? { id: cobj.id, tag: cobj.tag, name: cobj.name, emoji: cobj.emoji, color: cobj.color, role: (cobj.members[u.id] || {}).role } : null,
      boss: { kills: (u.bossStats && u.bossStats.kills) || 0, best: (u.bossStats && u.bossStats.best) || 0 },
      worlds: { made: mine.length, players: mine.reduce((a, w) => a + Object.keys(w.played || {}).length, 0), likes: mine.reduce((a, w) => a + Object.keys(w.likes || {}).length, 0) },
      tournaments: tour.winsOf(u.id), arcade, season };
  });
  // Arcade challenges: dare someone to beat your best in a game
  r.post('/api/challenges', W(30), async (c) => {
    const st = require('../state'); const { dayKey, rid, now } = require('../util'); const me = c.user; const to = st.S.users[String(c.body.to || '')]; const game = String(c.body.game || '');
    const names = Object.fromEntries(tour.GAMES); if (!names[game]) throw new HttpError(400, 'bad_game', 'Unknown game');
    if (!to || to.deleted || to.id === me.id) throw new HttpError(404, 'no_user', 'Pick another player');
    const mine = me.arcade && me.arcade[game] ? me.arcade[game].best : 0; if (!(mine > 0)) throw new HttpError(400, 'no_score', 'Play this game first to set a score to beat');
    const day = (me.chDay = me.chDay && me.chDay.d === dayKey() ? me.chDay : { d: dayKey(), n: 0 }); if (day.n >= 15) throw new HttpError(429, 'too_many', 'You sent enough challenges today');
    day.n++; to.challenges = (to.challenges || []).filter((x) => !(x.from === me.id && x.game === game)); to.challenges.unshift({ id: rid(6), from: me.id, game, gname: names[game], score: mine, at: now() }); to.challenges.length = Math.min(to.challenges.length, 20);
    st.S.store.touch('users');
    st.hub.push(to.id, { t: 'notice', text: `⚔️ @${me.username} challenges you to beat ${mine} in ${names[game]}`, es: `⚔️ @${me.username} te reta a superar ${mine} en ${names[game]}` }); st.hub.push(to.id, { t: 'challenge' });
    return { ok: true, score: mine, gname: names[game] };
  });
  r.get('/api/challenges', R, async (c) => {
    const st = require('../state'); const me = c.user; const wk = Date.now() - 7 * 86400000;
    return { items: (me.challenges || []).filter((x) => x.at > wk && st.S.users[x.from]).map((x) => { const best = me.arcade && me.arcade[x.game] ? me.arcade[x.game].best : 0; return { id: x.id, game: x.game, gname: x.gname, score: x.score, at: x.at, from: st.publicUser(st.S.users[x.from]), myBest: best, beaten: best > x.score }; }) };
  });
  // Palabra del día
  r.get('/api/word', R, async (c) => require('../word').view(c.user));
  r.post('/api/word/guess', W(40), async (c) => require('../word').guess(c.user, c.body.w));
  // Nebulix Live
  r.get('/api/arena', { auth: true }, async () => { const st = require('../arena').stats(); const n = (g, rk) => st.filter((x) => x.game === g && (rk === undefined || !!x.ranked === rk)).reduce((a, x) => a + x.humans, 0); return { ops: n('ops'), royale: n('royale'), duel: n('duel'), real: n('real'), box: n('box'), ranked: st.filter((x) => x.ranked).reduce((a, x) => a + x.humans, 0), rooms: st.length }; });
  r.get('/api/feed', R, async (c) => ({ items: require('../feed').recent(String((c.query || {}).kind || '') || null, Number((c.query || {}).n) || 60) }));
  // Home "command centre": everything live in one call
  r.get('/api/live', { auth: true, limit: [60, 60000, 'user'] }, async (c) => {
    const u = c.user; const st = require('../state');
    const bv = boss.view(u); const tl = tour.list(u); const hourly = tl.live.find((x) => x.kind === 'hourly');
    const lv = leagues.view(u); const T0 = lv.tiers[lv.tier];
    const ov = clans.overview(u); const ug = worlds.ugcList(u, 'top');
    return {
      online: st.hub.count(),
      boss: bv.live ? { live: true, boss: bv.live.boss, hp: bv.live.hp, max: bv.live.max, end: bv.live.end, fighters: bv.live.fighters } : { live: false, next: bv.next, boss: bv.nextBoss },
      tour: hourly ? { gname: hourly.gname, game: hourly.game, end: hourly.end, pool: hourly.pool, players: hourly.players, joined: hourly.joined, myRank: hourly.myRank } : null,
      league: { tier: lv.tier, icon: T0.icon, n: T0.n, color: T0.color, rank: lv.rank, xp: lv.xp, players: lv.players, ends: lv.ends },
      clan: ov.mine ? { id: ov.mine.id, tag: ov.mine.tag, name: ov.mine.name, emoji: ov.mine.emoji, color: ov.mine.color, week: ov.mine.week, rank: (ov.war.find((x) => x.id === ov.mine.id) || {}).rank || null } : null,
      worlds: ug.worlds.slice(0, 4).map((w) => ({ id: w.id, name: w.name, kind: w.kind, sky: w.sky, online: w.online, likes: w.likes, owner: w.owner && w.owner.username })),
      worldsOnline: worlds.online(),
    };
  });
  const weekly = () => { clans.settle(); leagues.settle(); }; const wt = setInterval(weekly, 60000); wt.unref && wt.unref(); setTimeout(weekly, 8000).unref();
};
