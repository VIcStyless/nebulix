'use strict';
// Work: professions with virtual salaries, job XP, career ranks (promotions), a global work level and shift events.
const crypto = require('crypto');
const { S } = require('../state');
const econ = require('../economy');
const prog = require('../progress');
const { HttpError, now } = require('../util');

// id, [en, es], icon, base salary per shift, work level required
const JOBS = [
  ['courier', ['Courier', 'Repartidor'], '🛵', 40, 1], ['barista', ['Barista', 'Barista'], '☕', 50, 1],
  ['streamer', ['Streamer', 'Streamer'], '🎥', 70, 3], ['designer', ['Designer', 'Diseñador'], '🎨', 90, 5],
  ['chef', ['Chef', 'Chef'], '👨‍🍳', 110, 7], ['developer', ['Developer', 'Programador'], '💻', 140, 10],
  ['pilot', ['Pilot', 'Piloto'], '✈️', 180, 14], ['doctor', ['Doctor', 'Médico'], '🩺', 220, 18],
  ['astronaut', ['Astronaut', 'Astronauta'], '🚀', 300, 25],
].map(([id, n, icon, base, req]) => ({ id, n, icon, base, req }));
const JOB_BY = new Map(JOBS.map((j) => [j.id, j]));
// career ranks inside a job: [en, es], job XP needed, salary multiplier
const RANKS = [[['Trainee', 'Becario'], 0, 1], [['Junior', 'Junior'], 120, 1.3], [['Senior', 'Senior'], 400, 1.7], [['Lead', 'Jefe de equipo'], 1000, 2.2], [['Director', 'Director'], 2400, 3]];
const SHIFT_CD = 30 * 60000;
const workXpFor = (L) => 60 * L * (L - 1); // total work XP to reach level L
function workLevel(xp) { let L = 1; while (L < 100 && workXpFor(L + 1) <= xp) L++; return L; }
function rankOf(jx) { let i = 0; for (let k = 0; k < RANKS.length; k++) if (jx >= RANKS[k][1]) i = k; return i; }
const EVENTS = [
  [60, null, 1, ['A normal day at work.', 'Un día normal de trabajo.']],
  [18, 'tip', 1.25, ['Great service — you got tips!', '¡Gran servicio, te dieron propina!']],
  [10, 'overtime', 1.5, ['You stayed for overtime.', 'Te quedaste haciendo horas extra.']],
  [7, 'slow', 0.8, ['A slow day…', 'Un día flojo…']],
  [5, 'bonus', 2, ['Your boss gave you a bonus!', '¡Tu jefe te dio un bonus!']],
];
function rollEvent() { const total = EVENTS.reduce((a, e) => a + e[0], 0); let r = crypto.randomInt(0, total); for (const e of EVENTS) { if (r < e[0]) return e; r -= e[0]; } return EVENTS[0]; }

function ws(u) { u.work = u.work || { job: null, xp: 0, jobs: {}, last: 0, shifts: 0, earned: 0, log: [] }; return u.work; }
function petBonus(u) { try { return require('./wallet').petBonus(u); } catch { return 0; } }
function view(u) {
  const w = ws(u); const lvl = workLevel(w.xp);
  const jobs = JOBS.map((j) => { const jx = (w.jobs[j.id] || {}).xp || 0; const r = rankOf(jx); return { id: j.id, n: j.n, icon: j.icon, base: j.base, req: j.req, locked: lvl < j.req, xp: jx, rank: r, salary: salaryOf(u, j, r, lvl), next: RANKS[r + 1] ? RANKS[r + 1][1] : null }; });
  return { job: w.job, level: lvl, xp: w.xp, cur: workXpFor(lvl), next: workXpFor(lvl + 1), shifts: w.shifts, earned: w.earned, readyAt: w.last + SHIFT_CD, cd: SHIFT_CD, jobs, ranks: RANKS.map(([n, x, m]) => ({ n, xp: x, mult: m })), log: w.log.slice(0, 15), petBonus: petBonus(u) };
}
function lifeMult(u) { try { return require('./life').workMult(u); } catch { return 1; } }
function salaryOf(u, j, rank, lvl) { return Math.round(j.base * RANKS[rank][2] * (1 + (lvl - 1) * 0.02) * (1 + petBonus(u)) * lifeMult(u)); }

module.exports = function register(r) {
  r.get('/api/work', { auth: true }, async (c) => view(c.user));

  r.post('/api/work/apply', { auth: true, verified: true, limit: [20, 60000, 'user'] }, async (c) => {
    const u = c.user; const w = ws(u); const j = JOB_BY.get(String(c.body.job || ''));
    if (!j) throw new HttpError(404, 'no_job', 'Unknown job');
    if (workLevel(w.xp) < j.req) throw new HttpError(403, 'locked', 'Reach work level ' + j.req + ' to apply');
    w.job = j.id; w.jobs[j.id] = w.jobs[j.id] || { xp: 0 }; S.store.touch('users');
    return view(u);
  });

  r.post('/api/work/shift', { auth: true, verified: true, limit: [20, 60000, 'user'] }, async (c) => {
    const u = c.user; const w = ws(u);
    if (!w.job) throw new HttpError(400, 'no_job', 'Pick a job first');
    const left = w.last + SHIFT_CD - now(); if (left > 0) throw new HttpError(429, 'tired', 'You can work again in ' + Math.ceil(left / 60000) + ' min');
    const j = JOB_BY.get(w.job); const lvlBefore = workLevel(w.xp); const jw = (w.jobs[j.id] = w.jobs[j.id] || { xp: 0 }); const rankBefore = rankOf(jw.xp);
    const ev = rollEvent(); const pay = Math.max(1, Math.round(salaryOf(u, j, rankBefore, lvlBefore) * ev[2] * require('../boosts').workMult(u)));
    const jx = 20 + crypto.randomInt(0, 11); const wx = 25 + crypto.randomInt(0, 11);
    jw.xp += jx; w.xp += wx; w.last = now(); w.shifts++; w.earned += pay;
    econ.adjust(u, pay, 'work:' + j.id); try { require('./life').afterShift(u); } catch {}
    const rankAfter = rankOf(jw.xp); const lvlAfter = workLevel(w.xp);
    const promo = rankAfter > rankBefore ? { rank: rankAfter, n: RANKS[rankAfter][0], bonus: 100 * rankAfter } : null;
    if (promo) econ.adjust(u, promo.bonus, 'work:promotion');
    w.log.unshift({ t: now(), job: j.id, pay, ev: ev[1], promo: promo ? rankAfter : undefined }); if (w.log.length > 30) w.log.length = 30;
    S.store.touch('users'); prog.award(u, 'work');
    return { pay, event: { k: ev[1], mult: ev[2], text: ev[3] }, jobXp: jx, workXp: wx, promo, levelUp: lvlAfter > lvlBefore ? lvlAfter : null, coins: u.coins, state: view(u) };
  });
};
module.exports.JOBS = JOBS;
