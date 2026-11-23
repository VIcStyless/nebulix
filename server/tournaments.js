'use strict';
// Tournaments on the Arcade games, on an automatic schedule (UTC):
//   hourly  — a new game every hour, free entry, prize pool paid by Nebulix that grows with the number of players
//   daily   — one game all day, entry fee; the pot (fees + a Nebulix bonus) is split 50/30/20
//   weekly  — Monday to Sunday championship, bigger fee and bonus
// You join, then your best Arcade score in that game during the tournament counts. Prizes are paid automatically.
// Casino games are never tournaments.
const { S, hub, publicUser } = require('./state');
const { now, HttpError } = require('./util');

const GAMES = [['snake', 'Nebula Snake'], ['2048', '2048'], ['aim', 'Aim Trainer'], ['typing', 'Typing Test'], ['blocks', 'Block Drop'], ['flap', 'Nebula Flap'], ['defenders', 'Star Defenders'], ['bricks', 'Brick Breaker'], ['ops', 'Nebula Ops (3D)'], ['memory', 'Memory Sequence'], ['paddle', 'Paddle Duel'], ['dash', 'Gravity Dash'], ['stack', 'Star Stack']];
const H = 3600000; const D = 24 * H;
const SPLIT = [0.5, 0.3, 0.2];
const KINDS = {
  hourly: { fee: 0, base: 600, per: 400, cap: 8000, len: H },
  daily: { fee: 1000, bonus: 10000, len: D },
  weekly: { fee: 5000, bonus: 75000, len: 7 * D },
};
const T = () => S.store.table('tournaments');
const pickGame = (n, salt) => GAMES[Math.abs((n * 7 + salt) % GAMES.length)];
const mondayOf = (t) => { const d = new Date(t); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.getTime(); };
// the tournament of a kind that contains time t
function slot(kind, t) {
  let start;
  if (kind === 'hourly') start = Math.floor(t / H) * H; else if (kind === 'daily') start = Math.floor(t / D) * D; else start = mondayOf(t);
  const k = KINDS[kind]; const n = Math.floor(start / k.len);
  let [game, gname] = pickGame(n, kind === 'hourly' ? 0 : kind === 'daily' ? 3 : 5);
  const id = kind[0] + '-' + new Date(start).toISOString().slice(0, 13).replace(/[-T:]/g, '');
  const stored = T()[id]; if (stored) { game = stored.game; gname = stored.gname; } // a running tournament never changes game
  return { id, kind, game, gname, start, end: start + k.len, fee: k.fee };
}
function rec(s) { const all = T(); return all[s.id] || (all[s.id] = { id: s.id, kind: s.kind, game: s.game, gname: s.gname, start: s.start, end: s.end, fee: s.fee, entries: {}, pot: 0, settled: false }); }
function prizePool(r) { const n = ranking(r).length; const k = KINDS[r.kind]; if (r.kind === 'hourly') return n ? Math.min(k.cap, k.base + k.per * n) : 0; return r.pot + (n >= 2 ? k.bonus : 0); }
function ranking(r) { return Object.entries(r.entries).filter(([, e]) => e.best > 0).sort((a, b) => b[1].best - a[1].best || a[1].at - b[1].at); }
function view(r, me, full) {
  const rk = ranking(r); const pool = prizePool(r); const myIdx = rk.findIndex(([id]) => id === me.id);
  const v = { id: r.id, kind: r.kind, game: r.game, gname: r.gname, start: r.start, end: r.end, fee: r.fee, players: Object.keys(r.entries).length, pool, prizes: SPLIT.map((x) => Math.floor(pool * x)), joined: !!r.entries[me.id], myBest: r.entries[me.id] ? r.entries[me.id].best : 0, myRank: myIdx >= 0 ? myIdx + 1 : null, settled: r.settled, live: r.start <= now() && now() < r.end };
  v.top = rk.slice(0, full ? 25 : 3).map(([id, e], i) => { const u = S.users[id]; return u ? { rank: i + 1, user: publicUser(u), best: e.best } : null; }).filter(Boolean);
  if (r.results) v.results = r.results;
  return v;
}
function current(t = now()) { return ['hourly', 'daily', 'weekly'].map((k) => slot(k, t)); }
function list(me) {
  const t = now(); const live = current(t).map((s) => view(T()[s.id] || rec(s), me));
  const upcoming = []; for (let i = 1; i <= 5; i++) { const s = slot('hourly', t + i * H); upcoming.push({ id: s.id, kind: s.kind, game: s.game, gname: s.gname, start: s.start, end: s.end, fee: s.fee }); }
  const nd = slot('daily', t + D); upcoming.push({ id: nd.id, kind: nd.kind, game: nd.game, gname: nd.gname, start: nd.start, end: nd.end, fee: nd.fee });
  const past = Object.values(T()).filter((r) => r.settled).sort((a, b) => b.end - a.end).slice(0, 12).map((r) => view(r, me));
  const wins = Object.values(T()).filter((r) => r.settled && (r.results || []).some((x) => x.id === me.id)).length;
  return { live, upcoming, past, wins };
}
function join(u, id) {
  const s = current().find((x) => x.id === id); if (!s) throw new HttpError(404, 'no_tournament', 'That tournament is not running');
  const r = rec(s); if (r.entries[u.id]) return view(r, u, true);
  if (r.fee && !require('./economy').adjust(u, -r.fee, 'tournament:' + r.id)) throw new HttpError(402, 'no_coins', 'Not enough coins');
  r.pot += r.fee; r.entries[u.id] = { best: 0, at: now(), joined: now() }; S.store.touch('tournaments');
  return view(r, u, true);
}
// called by the Arcade after a valid score
function onScore(u, game, score) {
  try {
    let changed = false;
    for (const s of current()) { if (s.game !== game) continue; const r = T()[s.id]; const e = r && r.entries[u.id]; if (!e || score <= e.best) continue; e.best = score; e.at = now(); changed = true; }
    if (changed) S.store.touch('tournaments');
  } catch (e) { console.error('[tournaments]', e); }
}
function settle() {
  const t = now(); const all = T(); let touched = false;
  for (const r of Object.values(all)) {
    if (!r.settled && r.end <= t) {
      const rk = ranking(r); const pool = prizePool(r); const results = []; const econ = require('./economy');
      if (rk.length >= 2) {
        { const [wid] = rk[0]; const wu = S.users[wid]; const kn = { hourly: ['hourly', 'de la hora'], daily: ['daily cup', 'copa diaria'], weekly: ['weekly championship', 'campeonato semanal'] }[r.kind]; if (wu) require('./feed').add('tournament', '🏆', [`@${wu.username} won the ${kn[0]} ${r.gname} tournament (+${Math.floor(pool * SPLIT[0])} coins)`, `@${wu.username} ha ganado el torneo ${kn[1]} de ${r.gname} (+${Math.floor(pool * SPLIT[0])} monedas)`], { uid: wid, link: '#/tournaments' }); }
        rk.slice(0, 3).forEach(([id, e], i) => { const u = S.users[id]; if (!u) return; const prize = Math.floor(pool * SPLIT[i]); if (prize > 0) econ.adjust(u, prize, 'tournament:prize:' + r.id); results.push({ id, rank: i + 1, best: e.best, prize }); hub.push(id, { t: 'notice', text: `🏆 You finished #${i + 1} in the ${r.gname} tournament: +${prize} coins`, es: `🏆 Has quedado #${i + 1} en el torneo de ${r.gname}: +${prize} monedas` }); });
      } else {
        // not enough competition: paid tournaments refund every entry, a lone hourly player gets a small thank-you
        if (r.fee) for (const id of Object.keys(r.entries)) { const u = S.users[id]; if (u) { econ.adjust(u, r.fee, 'tournament:refund:' + r.id); hub.push(id, { t: 'notice', text: `↩️ The ${r.gname} tournament did not have enough players. Your entry fee was refunded.`, es: `↩️ El torneo de ${r.gname} no tuvo jugadores suficientes. Te hemos devuelto la entrada.` }); } }
        else if (rk.length === 1) { const [id, e] = rk[0]; const u = S.users[id]; if (u) { econ.adjust(u, 100, 'tournament:solo:' + r.id); results.push({ id, rank: 1, best: e.best, prize: 100 }); } }
      }
      r.results = results; r.settled = true; touched = true;
    }
    if (r.settled && t - r.end > 8 * D) { delete all[r.id]; touched = true; }
  }
  if (touched) S.store.touch('tournaments');
}
let timer = null;
function start() { if (!timer) { timer = setInterval(settle, 30000); timer.unref && timer.unref(); setTimeout(settle, 5000).unref(); } }
function detail(me, id) { const r = T()[id]; if (!r) { const s = current().find((x) => x.id === id); if (!s) throw new HttpError(404, 'no_tournament', 'Tournament not found'); return view(rec(s), me, true); } return view(r, me, true); }
const winsOf = (uid) => Object.values(T()).filter((r) => r.settled && (r.results || []).some((x) => x.id === uid && x.rank === 1)).length;
module.exports = { list, join, onScore, settle, start, detail, GAMES, winsOf };
