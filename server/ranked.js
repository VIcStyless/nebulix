'use strict';
// Nebulix 13 — competitive ranked play for Nebulix Arena (Nebula Royale, Nebula Ops and Duels).
// Rank points (RP) per mode and per season. Ranks, all original to Nebulix:
//   Bronce · Plata · Oro · Platino · Diamante (I, II, III each, 100 RP per division)
//   Nebulosa (1500+) · Supernova (1900+) · Singularidad (2200+ and top 100 of that mode)
// Seasons last 30 days. At the end everyone gets coins (and items from Oro up) for the highest rank they reached,
// and RP are softly reset (halved). Losing costs more the higher you are; a rank shield (Shop) cancels one loss.
const { S, hub } = require('./state');
const { now } = require('./util');

const MODES = ['royale', 'ops', 'duel'];
const TIERS = [
  { n: ['Bronze', 'Bronce'], c: '#c2763c', ic: '🥉' }, { n: ['Silver', 'Plata'], c: '#a8b3c4', ic: '🥈' }, { n: ['Gold', 'Oro'], c: '#facc15', ic: '🥇' },
  { n: ['Platinum', 'Platino'], c: '#2dd4bf', ic: '💠' }, { n: ['Diamond', 'Diamante'], c: '#60a5fa', ic: '💎' },
  { n: ['Nebula', 'Nebulosa'], c: '#a855f7', ic: '🌌' }, { n: ['Supernova', 'Supernova'], c: '#f97316', ic: '💥' }, { n: ['Singularity', 'Singularidad'], c: '#f43f5e', ic: '🕳️' },
];
const SEASON_DAYS = 30; const DAY = 86400000;
const REWARD_COINS = [600, 1200, 2500, 4500, 7500, 12000, 20000, 35000];
const REWARD_ITEMS = { 2: ['glider_rk_gold'], 4: ['glider_rk_gold', 'trail_rk_diamond'], 5: ['glider_rk_gold', 'trail_rk_diamond', 'title_rk_nebula'], 6: ['glider_rk_gold', 'trail_rk_diamond', 'title_rk_nebula', 'title_rk_supernova', 'outfit_rk_super'], 7: ['glider_rk_gold', 'trail_rk_diamond', 'title_rk_nebula', 'title_rk_supernova', 'outfit_rk_super', 'title_rk_singularity'] };

function season() {
  const m = (S.meta.rk = S.meta.rk || {});
  if (!m.n) { m.n = 1; m.start = now(); m.end = m.start + SEASON_DAYS * DAY; S.store.touch('meta'); }
  return m;
}
function rec(u, mode) {
  const s = season(); u.rk = u.rk || {};
  if (u.rk.s !== s.n) { u.rk.prev = u.rk.s ? { s: u.rk.s, best: bestTier(u) } : u.rk.prev || null; u.rk.s = s.n; const old = u.rk.m || {}; u.rk.m = {}; for (const k of MODES) { const rp = old[k] ? Math.floor((old[k].rp || 0) * 0.5) : 0; u.rk.m[k] = { rp, peak: rp, g: 0, w: 0 }; } }
  u.rk.m = u.rk.m || {}; return mode ? (u.rk.m[mode] = u.rk.m[mode] || { rp: 0, peak: 0, g: 0, w: 0 }) : u.rk.m;
}
// players of a mode in this season, best first (cached for a few seconds)
let cache = { t: 0, lists: {} };
function ladder(mode) {
  if (now() - cache.t > 5000) cache = { t: now(), lists: {} };
  if (cache.lists[mode]) return cache.lists[mode]; const s = season();
  const l = Object.values(S.users).filter((u) => u && !u.deleted && u.rk && u.rk.s === s.n && u.rk.m && u.rk.m[mode] && u.rk.m[mode].g > 0).sort((a, b) => b.rk.m[mode].rp - a.rk.m[mode].rp);
  return (cache.lists[mode] = l);
}
function rankOf(rp, pos) {
  let tier, div = 0;
  if (rp >= 2200 && pos !== undefined && pos < 100) tier = 7; else if (rp >= 1900) tier = 6; else if (rp >= 1500) tier = 5; else { tier = Math.min(4, Math.floor(rp / 300)); div = Math.min(2, Math.floor((rp % 300) / 100)); }
  const T = TIERS[tier]; const roman = ['I', 'II', 'III'][div];
  const nextAt = tier < 5 ? (tier * 300 + (div + 1) * 100) : tier === 5 ? 1900 : tier === 6 ? 2200 : null;
  const from = tier < 5 ? tier * 300 + div * 100 : tier === 5 ? 1500 : tier === 6 ? 1900 : 2200;
  return { tier, div: tier < 5 ? div : null, n: tier < 5 ? [T.n[0] + ' ' + roman, T.n[1] + ' ' + roman] : T.n, c: T.c, ic: T.ic, rp, from, next: nextAt, prog: nextAt ? Math.max(0, Math.min(1, (rp - from) / (nextAt - from))) : 1 };
}
function rankFor(u, mode) { const r = rec(u, mode); const pos = ladder(mode).indexOf(u); return Object.assign(rankOf(r.rp, pos >= 0 ? pos : undefined), { pos: pos >= 0 ? pos + 1 : null, g: r.g, w: r.w, peak: r.peak }); }
function bestTier(u) { if (!u.rk || !u.rk.m) return 0; let b = 0; for (const k of MODES) { const r = u.rk.m[k]; if (r && r.g > 0) b = Math.max(b, rankOf(r.peak || r.rp, ladder(k).indexOf(u) >= 0 ? ladder(k).indexOf(u) : undefined).tier); } return b; }
// small badge for publicUser: best rank this season (null if no ranked games)
function badgeOf(u) {
  try { const s = season(); if (!u.rk || u.rk.s !== s.n || !u.rk.m) return null; let best = null;
    for (const k of MODES) { const r = u.rk.m[k]; if (!r || !r.g) continue; const pos = ladder(k).indexOf(u); const rk = rankOf(r.rp, pos >= 0 ? pos : undefined); if (!best || rk.rp > best.rp) best = Object.assign(rk, { m: k }); }
    return best ? { t: best.tier, n: best.n, c: best.c, ic: best.ic, m: best.m } : null; } catch { return null; }
}
// apply the result of a ranked match. info: royale { place, total, kills } · ops { won, kills } · duel { won, vsBot }
function result(u, mode, info) {
  if (!u || !MODES.includes(mode)) return null; const r = rec(u, mode); const before = rankFor(u, mode);
  let d = 0;
  if (mode === 'royale') { const p = info.place || 99; d = p === 1 ? 70 : p <= 3 ? 45 : p <= 5 ? 30 : p <= 10 ? 12 : p <= 15 ? -8 : -18; d += Math.min(8, info.kills || 0) * 6 - Math.min(8, info.botKills || 0) * 3; }
  else if (mode === 'ops') d = (info.won ? 32 : -22) + Math.min(12, (info.kills || 0) * 2);
  else d = info.won ? (info.vsBot ? 14 : 28) : (info.vsBot ? -12 : -20);
  if (info.abandon) d = -35;
  if (d < 0) d = Math.round(d * (1 + before.tier * 0.12));
  let shield = false; if (d < 0 && u.rk.shield > 0 && !info.abandon) { u.rk.shield--; d = 0; shield = true; }
  r.rp = Math.max(0, r.rp + d); r.g++; if (info.won || info.place === 1) r.w++; r.peak = Math.max(r.peak || 0, r.rp);
  u.rk.hist = [{ m: mode, d, t: now(), p: info.place || null, won: info.won === undefined ? null : !!info.won }].concat(u.rk.hist || []).slice(0, 20);
  cache.t = 0; S.store.touch('users');
  const after = rankFor(u, mode); const promoted = after.tier > before.tier || (after.tier === before.tier && (after.div || 0) > (before.div || 0));
  const demoted = after.tier < before.tier;
  if (promoted) hub.push(u.id, { t: 'notice', text: `${after.ic} Promoted to ${after.n[0]}!`, es: `${after.ic} ¡Has subido a ${after.n[1]}!` });
  return { delta: d, before: before.rp, after: after.rp, rank: after, promoted, demoted, shield };
}
// season end: rewards for the best rank reached, soft reset happens lazily in rec()
function tick() {
  const s = season(); if (now() < s.end) return false;
  const econ = require('./economy'); let n = 0;
  for (const u of Object.values(S.users)) {
    if (!u || u.deleted || !u.rk || u.rk.s !== s.n || !u.rk.m) continue; if (!MODES.some((k) => u.rk.m[k] && u.rk.m[k].g >= 3)) continue; // at least 3 ranked games
    const best = bestTier(u); econ.adjust(u, REWARD_COINS[best], 'ranked:season:' + s.n);
    const tierKey = Object.keys(REWARD_ITEMS).map(Number).filter((k) => k <= best).sort((a, b) => b - a)[0];
    for (const id of REWARD_ITEMS[tierKey] || []) econ.grant(u, id);
    hub.push(u.id, { t: 'notice', text: `🏁 Ranked season ${s.n} is over: you reached ${TIERS[best].n[0]} and earned ${REWARD_COINS[best]} coins`, es: `🏁 Fin de la temporada clasificatoria ${s.n}: llegaste a ${TIERS[best].n[1]} y ganas ${REWARD_COINS[best]} monedas` });
    n++;
  }
  s.last = { n: s.n, end: s.end, rewarded: n }; s.n++; s.start = now(); s.end = s.start + SEASON_DAYS * DAY; S.store.touch('meta'); S.store.touch('users'); cache.t = 0;
  return true;
}
function board(mode, u, limit = 100) {
  mode = MODES.includes(mode) ? mode : 'royale'; const l = ladder(mode);
  const { publicUser } = require('./state');
  return { mode, season: seasonView(), top: l.slice(0, limit).map((x, i) => Object.assign({ pos: i + 1, user: publicUser(x) }, (({ rp, n, c, ic, tier }) => ({ rp, n, c, ic, tier }))(rankOf(x.rk.m[mode].rp, i)), { g: x.rk.m[mode].g, w: x.rk.m[mode].w })), me: u ? rankFor(u, mode) : null };
}
function seasonView() { const s = season(); return { n: s.n, start: s.start, end: s.end, left: Math.max(0, s.end - now()), last: s.last || null }; }
function mine(u) { const o = {}; for (const k of MODES) o[k] = rankFor(u, k); return { season: seasonView(), modes: o, shield: (u.rk && u.rk.shield) || 0, hist: (u.rk && u.rk.hist) || [], prev: (u.rk && u.rk.prev) || null, tiers: TIERS.map((t, i) => ({ n: t.n, c: t.c, ic: t.ic, coins: REWARD_COINS[i] })), rewards: REWARD_ITEMS }; }
// average tier of some players (bots in ranked rooms get harder with it)
function avgTier(users, mode) { if (!users.length) return 0; return users.reduce((a, u) => a + rankOf(rec(u, mode).rp).tier, 0) / users.length; }
module.exports = { TIERS, MODES, rankOf, rankFor, result, badgeOf, board, mine, tick, seasonView, avgTier, season };
