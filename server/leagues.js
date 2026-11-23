'use strict';
// Leagues: weekly competitive divisions. Everyone starts in Bronze; the XP you earn during the week (UTC, Monday to
// Sunday) ranks you against the other players in your league. When the week ends the top players move up, the
// bottom ones move down and everyone who played gets coins (more the higher the league and the rank).
const { S, hub, publicUser } = require('./state');
const { now } = require('./util');

const TIERS = [
  ['bronze', ['Bronze', 'Bronce'], '🥉', '#b45309', 1500],
  ['silver', ['Silver', 'Plata'], '🥈', '#94a3b8', 3000],
  ['gold', ['Gold', 'Oro'], '🥇', '#eab308', 5000],
  ['platinum', ['Platinum', 'Platino'], '💠', '#22d3ee', 8000],
  ['diamond', ['Diamond', 'Diamante'], '💎', '#6366f1', 13000],
  ['nebula', ['Nebula', 'Nébula'], '🌌', '#d946ef', 20000],
].map(([id, n, icon, color, top]) => ({ id, n, icon, color, top }));
const weekKey = (t = now()) => require('./progress').weekKey(t);
const ensure = (u) => { const l = (u.league = u.league || { tier: 0, wk: null, xp: 0, best: 0 }); if (l.wk !== weekKey()) { l.wk = weekKey(); l.xp = 0; } return l; };
const zone = (n) => (n >= 4 ? Math.max(1, Math.round(n * 0.2)) : n >= 2 ? 1 : 0); // how many go up / down
const prizeFor = (tier, rank, n) => { const top = TIERS[tier].top; if (rank === 1) return top; if (rank === 2) return Math.round(top * 0.6); if (rank === 3) return Math.round(top * 0.4); return n > 3 && rank <= Math.ceil(n / 2) ? Math.round(top * 0.15) : Math.round(top * 0.06); };

const catchUp = () => { if (S.meta.leagueWeek && S.meta.leagueWeek !== weekKey()) settle(); };
function onXp(u, gained) { if (!(gained > 0) || u.deleted) return; catchUp(); const l = ensure(u); l.xp += gained; }
function rankTier(tier, wk) { return Object.values(S.users).filter((u) => !u.deleted && u.league && u.league.wk === wk && (u.league.tier || 0) === tier && u.league.xp > 0).sort((a, b) => b.league.xp - a.league.xp); }
function view(u) {
  catchUp(); const l = ensure(u); const list = rankTier(l.tier, l.wk); const n = list.length; const z = zone(n);
  const end = new Date(l.wk); end.setUTCDate(end.getUTCDate() + 7);
  const myRank = list.findIndex((x) => x.id === u.id) + 1;
  return { tiers: TIERS.map((x, i) => ({ id: x.id, n: x.n, icon: x.icon, color: x.color, top: x.top, i })), tier: l.tier, xp: l.xp, best: l.best || 0, ends: end.getTime(), rank: myRank || null, players: n, up: l.tier < TIERS.length - 1 ? z : 0, down: l.tier > 0 ? z : 0,
    board: list.slice(0, 50).map((x, i) => ({ rank: i + 1, user: publicUser(x), xp: x.league.xp, prize: prizeFor(l.tier, i + 1, n), online: hub.online(x.id) })), last: u.leagueLast || null };
}
function settle() {
  try {
    const k = weekKey(); if (!S.meta.leagueWeek) { S.meta.leagueWeek = k; S.store.touch('meta'); return; }
    if (S.meta.leagueWeek === k) return; const prev = S.meta.leagueWeek; const econ = require('./economy');
    const moves = [];
    for (let tier = 0; tier < TIERS.length; tier++) {
      const list = rankTier(tier, prev); const n = list.length; const z = zone(n);
      list.forEach((u, i) => {
        const rank = i + 1; const prize = prizeFor(tier, rank, n); let to = tier;
        if (tier < TIERS.length - 1 && rank <= z) to = tier + 1; else if (tier > 0 && rank > n - z && n >= 4) to = tier - 1;
        moves.push([u, tier, to, rank, prize]);
      });
    }
    for (const [u, from, , rank] of moves) if (rank === 1) require('./feed').add('league', TIERS[from].icon, [`@${u.username} won the ${TIERS[from].n[0]} league this week`, `@${u.username} ha ganado la liga ${TIERS[from].n[1]} esta semana`], { uid: u.id, link: '#/leagues' });
    for (const [u, from, to, rank, prize] of moves) {
      econ.adjust(u, prize, 'league:' + prev); if (rank <= 3) econ.adjustGems(u, [15, 8, 4][rank - 1] * (from + 1), 'league:' + prev);
      u.league.tier = to; u.league.best = Math.max(u.league.best || 0, to); u.leagueLast = { week: prev, from, to, rank, prize };
      const T0 = TIERS[to]; const move = to > from ? 'up' : to < from ? 'down' : 'stay';
      hub.push(u.id, { t: 'notice', text: `${T0.icon} League week over: you finished #${rank} (+${prize} coins). ${move === 'up' ? 'Promoted to ' + T0.n[0] + '!' : move === 'down' ? 'Moved down to ' + T0.n[0] + '.' : 'You stay in ' + T0.n[0] + '.'}`,
        es: `${T0.icon} Fin de la semana de liga: has quedado #${rank} (+${prize} monedas). ${move === 'up' ? '¡Asciendes a ' + T0.n[1] + '!' : move === 'down' ? 'Bajas a ' + T0.n[1] + '.' : 'Sigues en ' + T0.n[1] + '.'}` });
    }
    S.meta.leagueWeek = k; S.store.touch('meta'); S.store.touch('users');
  } catch (e) { console.error('[leagues]', e); }
}
module.exports = { view, onXp, settle, TIERS };
