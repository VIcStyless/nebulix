'use strict';
// Progression: XP & levels, achievements, daily quests, weekly XP and leaderboards.
// Definitions live in public/data/progress.json so the browser shows exactly what the server checks.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { S, hub } = require('./state');
const { now, dayKey, HttpError } = require('./util');

const DEFS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'progress.json'), 'utf8'));
const ACH = DEFS.achievements; const ACH_BY = new Map(ACH.map((a) => [a.id, a]));
const QUESTS = DEFS.quests; const Q_BY = new Map(QUESTS.map((q) => [q.id, q]));
const QUESTS_PER_DAY = 3;
const MAX_LEVEL = 200;

// xp: per occurrence · cap: daily XP cap for this source · cnt: counter key · cd: min ms between XP awards (client events: between counts too)
const EV = {
  msg: { xp: 2, cap: 80, cnt: 'msgs', cd: 12000 },
  react: { xp: 1, cap: 15, cnt: 'reacts', cd: 3000 },
  dm: { xp: 2, cap: 40, cnt: 'dms', cd: 12000 },
  bet: { xp: 1, cap: 60, cnt: 'bets' },
  win: { xp: 0, cap: 0, cnt: 'wins' },
  daily: { xp: 25, cap: 25, cnt: 'dailies' },
  buy: { xp: 10, cap: 50, cnt: 'buys' },
  theme_pub: { xp: 40, cap: 40, cnt: 'themesPub' },
  theme_inst: { xp: 5, cap: 50, cnt: 'installsRecv' },
  theme_use: { xp: 5, cap: 15, cnt: 'themesInstalled' },
  friend: { xp: 15, cap: 60, cnt: 'friends' },
  arcade: { xp: 6, cap: 72, cnt: 'arcadeRuns' },
  duel: { xp: 10, cap: 80, cnt: 'duels' },
  duel_win: { xp: 25, cap: 150, cnt: 'duelWins' },
  nova: { xp: 2, cap: 20, cnt: 'novaMsgs', cd: 5000 },
  work: { xp: 8, cap: 80, cnt: 'shifts' },
  trade: { xp: 3, cap: 30, cnt: 'trades', cd: 5000 },
  donate: { xp: 10, cap: 60, cnt: 'donations', cd: 10000 },
  stockgame: { xp: 6, cap: 60, cnt: 'stockgames' },
  fps: { xp: 6, cap: 80, cnt: 'fpsRounds' },
  chest: { xp: 5, cap: 25, cnt: 'chests' },
  pet: { xp: 2, cap: 20, cnt: 'petCare', cd: 3000 },
  life: { xp: 3, cap: 40, cnt: 'lifeActs', cd: 3000 },
  social: { xp: 2, cap: 30, cnt: 'socialPosts', cd: 5000 },
  // reported by the browser — small, capped, and rate-limited so they cannot be farmed
  distro: { xp: 10, cap: 30, cnt: 'distros', client: true, cd: 20000 },
  bench: { xp: 8, cap: 24, cnt: 'benches', client: true, cd: 8000 },
  browse: { xp: 2, cap: 20, cnt: 'sites', client: true, cd: 15000 },
  track: { xp: 2, cap: 30, cnt: 'tracks', client: true, cd: 30000 },
  mix: { xp: 20, cap: 40, cnt: 'mixes', client: true, cd: 60000 },
  deck: { xp: 3, cap: 15, cnt: 'deckLoads', client: true, cd: 5000 },
  os: { xp: 5, cap: 5, cnt: 'osSessions', client: true, cd: 600000 },
};
const CLIENT_EVENTS = Object.keys(EV).filter((k) => EV[k].client);

// Total XP needed to *reach* level L: 0, 100, 300, 600, 1000 … (50·L·(L-1))
const xpFor = (L) => 50 * L * (L - 1);
function levelOf(xp) { let L = Math.floor((1 + Math.sqrt(1 + 0.08 * Math.max(0, xp))) / 2); while (L > 1 && xpFor(L) > xp) L--; while (L < MAX_LEVEL && xpFor(L + 1) <= xp) L++; return Math.min(L, MAX_LEVEL); }
function levelInfo(xp) { const level = levelOf(xp); const cur = xpFor(level); const next = xpFor(level + 1); return { level, xp, cur, next, into: xp - cur, need: next - cur }; }
const levelReward = (L) => 20 + L * 10 + ([5, 10, 25, 50, 75, 100].includes(L) ? L * 20 : 0);
const weekKey = (t = now()) => { const d = new Date(t); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };

function ensure(u) {
  if (!u.prog) u.prog = {};
  const p = u.prog;
  p.xp = p.xp || 0; p.cnt = p.cnt || {}; p.best = p.best || {}; p.ach = p.ach || {}; p.cd = p.cd || {}; p.showcase = Array.isArray(p.showcase) ? p.showcase : [];
  if (!p.day || p.day.d !== dayKey()) p.day = { d: dayKey(), xp: {} };
  if (!p.week || p.week.w !== weekKey()) p.week = { w: weekKey(), xp: 0 };
  return p;
}

function questsFor(u) {
  const p = ensure(u); const d = dayKey();
  if (!p.q || p.q.d !== d) {
    // deterministic per user+day so a reload never rerolls
    const seed = crypto.createHash('sha256').update(u.id + ':' + d).digest();
    const pool = QUESTS.map((q, i) => ({ q, k: seed.readUInt16BE((i * 2) % 30) ^ (i * 2654435761 >>> 16) })).sort((a, b) => a.k - b.k).slice(0, QUESTS_PER_DAY).map((x) => x.q.id);
    p.q = { d, ids: pool, n: {}, claimed: {} };
  }
  return p.q;
}

// 'pro' means a real membership (bought or redeemed) — staff/owner get PRO perks for free but not this achievement.
function flagOf(u, key) { if (key === 'verified') return !!u.verified && !u.noEmail; if (key === 'pro') return (u.proUntil || 0) > now(); return false; }
function achieved(u, a, p, level) {
  if (a.kind === 'count') return (p.cnt[a.key] || 0) >= a.goal;
  if (a.kind === 'best') return (p.best[a.key] || 0) >= a.goal;
  if (a.kind === 'level') return level >= a.goal;
  if (a.kind === 'flag') return flagOf(u, a.key);
  return false;
}

// Apply XP; pays level-up rewards. Returns { gained, levelUp }.
function addXp(u, n) {
  const p = ensure(u); if (n <= 0) return { gained: 0, levelUp: null };
  const before = levelOf(p.xp); p.xp += n; p.week.xp += n; const after = levelOf(p.xp);
  let reward = 0;
  for (let L = before + 1; L <= after; L++) reward += levelReward(L);
  if (reward) require('./economy').adjust(u, reward, 'level-up');
  if (after > before) require('./economy').adjustGems(u, 3 * (after - before), 'level-up');
  return { gained: n, levelUp: after > before ? { from: before, to: after, coins: reward } : null };
}

function checkAchievements(u) {
  const p = ensure(u); const level = levelOf(p.xp); const unlocked = [];
  for (const a of ACH) {
    if (p.ach[a.id] || !achieved(u, a, p, level)) continue;
    p.ach[a.id] = now(); unlocked.push(a.id);
    if (a.coins) require('./economy').adjust(u, a.coins, 'achievement:' + a.id);
    require('./economy').adjustGems(u, 2, 'achievement:' + a.id);
  }
  // a level achievement can be unlocked by XP from another achievement's reward chain — loop once more cheaply
  if (unlocked.length) { const lv = levelOf(p.xp); for (const a of ACH) if (!p.ach[a.id] && a.kind === 'level' && lv >= a.goal) { p.ach[a.id] = now(); unlocked.push(a.id); if (a.coins) require('./economy').adjust(u, a.coins, 'achievement:' + a.id); } }
  return unlocked;
}

function pushProgress(u, extra) {
  const p = ensure(u);
  hub.push(u.id, Object.assign({ t: 'prog', xp: p.xp, level: levelInfo(p.xp) }, extra || {}));
}

/**
 * Record that something happened. Safe to call from anywhere; never throws.
 * meta: { bet, mult, net, streak, score, game } for "best" metrics.
 */
function award(u, ev, n = 1, meta = {}) {
  try {
    const e = EV[ev]; if (!u || !e || u.deleted) return null;
    const p = ensure(u); const t = now();
    const coolingDown = e.cd && t - (p.cd[ev] || 0) < e.cd;
    if (e.client && coolingDown) return null; // browser-reported events are ignored entirely while cooling down
    p.cnt[e.cnt] = (p.cnt[e.cnt] || 0) + n;
    // best-of metrics
    if (meta.bet) p.best.bet = Math.max(p.best.bet || 0, meta.bet);
    if (meta.mult && meta.net > 0) p.best.mult = Math.max(p.best.mult || 0, meta.mult);
    if (meta.streak) p.best.streak = Math.max(p.best.streak || 0, meta.streak);
    if (meta.game && Number.isFinite(meta.score)) p.best['arcade_' + meta.game] = Math.max(p.best['arcade_' + meta.game] || 0, meta.score);
    // XP within the daily cap
    let xp = 0;
    if (!coolingDown && e.xp > 0) { const used = p.day.xp[ev] || 0; xp = Math.max(0, Math.min(e.xp * n, e.cap - used)); p.day.xp[ev] = used + xp; p.cd[ev] = t; }
    // quests
    const q = questsFor(u); const questDone = [];
    for (const id of q.ids) { const def = Q_BY.get(id); if (!def || def.ev !== ev || q.claimed[id]) continue; const was = q.n[id] || 0; q.n[id] = Math.min(def.goal, was + n); if (was < def.goal && q.n[id] >= def.goal) questDone.push(id); }
    const { gained, levelUp } = addXp(u, xp * require('./boosts').xpMult(u));
    if (levelUp && Math.floor(levelUp.to / 5) > Math.floor(levelUp.from / 5)) { const L = Math.floor(levelUp.to / 5) * 5; require('./feed').add('level', '⭐', [`@${u.username} reached level ${L}`, `@${u.username} ha llegado al nivel ${L}`], { uid: u.id, link: '#/progress' }); }
    require('./season').onEvent(u, e.cnt, n, gained);
    if (gained > 0) { try { require('./clans').onXp(u, gained); require('./leagues').onXp(u, gained); } catch (er) { console.error('[progress:clan/league]', er); } }
    const unlocked = checkAchievements(u);
    S.store.touch('users');
    if (gained || levelUp || unlocked.length || questDone.length) pushProgress(u, { gained, levelUp, unlocked, questDone, src: ev });
    return { gained, levelUp, unlocked, questDone };
  } catch (err) { console.error('[progress]', ev, err); return null; }
}

function claimQuest(u, id) {
  const q = questsFor(u); const def = Q_BY.get(id);
  if (!def || !q.ids.includes(id)) throw new HttpError(404, 'no_quest', 'That quest is not on today\'s list');
  if (q.claimed[id]) throw new HttpError(409, 'claimed', 'Already claimed');
  if ((q.n[id] || 0) < def.goal) throw new HttpError(400, 'not_done', 'Finish the quest first');
  q.claimed[id] = now();
  if (def.coins) require('./economy').adjust(u, def.coins, 'quest:' + id);
  const { gained, levelUp } = addXp(u, def.xp || 0);
  require('./season').addSp(u, 60 + (def.xp || 0), 'quest');
  const unlocked = checkAchievements(u);
  S.store.touch('users');
  pushProgress(u, { gained, levelUp, unlocked, src: 'quest' });
  return { coins: def.coins || 0, xp: def.xp || 0, levelUp, unlocked };
}

function stateOf(u) {
  const p = ensure(u); const q = questsFor(u);
  const ach = p.ach; // also re-check passive flags (verified/pro) on read
  const unlocked = checkAchievements(u); if (unlocked.length) S.store.touch('users');
  return {
    level: levelInfo(p.xp), week: p.week.xp, counters: p.cnt, best: p.best, showcase: p.showcase,
    achievements: Object.entries(ach).map(([id, t]) => ({ id, t })),
    quests: q.ids.map((id) => { const d = Q_BY.get(id); return d ? { id, icon: d.icon, name: d.name, goal: d.goal, n: q.n[id] || 0, coins: d.coins, xp: d.xp, claimed: !!q.claimed[id] } : null; }).filter(Boolean),
    resetAt: Date.parse(dayKey() + 'T00:00:00Z') + 86400000,
    caps: Object.fromEntries(Object.entries(EV).filter(([, e]) => e.cap).map(([k, e]) => [k, { used: p.day.xp[k] || 0, cap: e.cap }])),
  };
}

function setShowcase(u, ids) {
  const p = ensure(u);
  if (!Array.isArray(ids)) throw new HttpError(400, 'bad_ids', 'Send a list of achievement ids');
  const clean = [...new Set(ids.map(String))].filter((id) => p.ach[id]).slice(0, 3);
  p.showcase = clean; S.store.touch('users');
  return clean;
}

const levelOfUser = (u) => (u && u.prog ? levelOf(u.prog.xp || 0) : 1);

function leaderboard(kind, me) {
  const users = Object.values(S.users).filter((u) => u.verified && !u.deleted && !u.banned);
  let score;
  if (kind === 'weekly') score = (u) => (u.prog && u.prog.week && u.prog.week.w === weekKey() ? u.prog.week.xp : 0);
  else if (kind === 'coins') score = (u) => u.coins || 0;
  else if (kind === 'duels') score = (u) => (u.prog && u.prog.cnt ? u.prog.cnt.duelWins || 0 : 0);
  else if (kind && kind.startsWith('arcade_')) score = (u) => (u.prog && u.prog.best ? u.prog.best[kind] || 0 : 0);
  else score = (u) => (u.prog ? u.prog.xp || 0 : 0);
  const rows = users.map((u) => ({ u, s: score(u) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  const top = rows.slice(0, 25).map((x, i) => ({ rank: i + 1, score: x.s, level: levelOfUser(x.u), user: require('./state').publicUser(x.u) }));
  const myIdx = me ? rows.findIndex((x) => x.u.id === me.id) : -1;
  return { kind: kind || 'xp', top, me: myIdx >= 0 ? { rank: myIdx + 1, score: rows[myIdx].s } : null, total: rows.length };
}

module.exports = { DEFS, ACH, QUESTS, EV, CLIENT_EVENTS, xpFor, levelOf, levelInfo, levelOfUser, award, claimQuest, stateOf, setShowcase, leaderboard, checkAchievements, weekKey, ensure };
