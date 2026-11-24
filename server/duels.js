'use strict';
// Server-authoritative 1v1 duels: Tic-Tac-Toe, Connect Four and Rock-Paper-Scissors (best of 3).
// Optional coin wager: both stakes are escrowed on accept; the winner takes the pot, a draw refunds.
const crypto = require('crypto');
const { S, hub, publicUser } = require('./state');
const { HttpError, rid, now } = require('./util');

const GAMES = {
  ttt: { name: 'Tic-Tac-Toe', turn: 45000 },
  c4: { name: 'Connect Four', turn: 45000 },
  rps: { name: 'Rock Paper Scissors', turn: 30000 },
  // Nebulix 3.0: board games validated with the shared rules (server/rules.js)
  chess: { name: 'Chess', turn: 120000 },
  checkers: { name: 'Checkers', turn: 90000 },
};
const R = () => require('./rules');
// Elo ratings for the board games (start at 1200; K = 32 for the first 20 games, then 20)
const RATED = ['chess', 'checkers'];
const eloOf = (u, g) => (u && u.elo && u.elo[g]) || 1200;
function rate(d, winnerIdx) {
  if (!RATED.includes(d.game) || ['restart', 'expired'].includes(d.reason)) return; const A = S.users[d.a], B = S.users[d.b]; if (!A || !B) return;
  const ra = eloOf(A, d.game), rb = eloOf(B, d.game); const ea = 1 / (1 + 10 ** ((rb - ra) / 400)); const sa = winnerIdx === null ? 0.5 : winnerIdx === 0 ? 1 : 0;
  const k = (u) => (((u.eloN || {})[d.game] || 0) < 20 ? 32 : 20);
  const na = Math.round(ra + k(A) * (sa - ea)), nb = Math.round(rb + k(B) * ((1 - sa) - (1 - ea)));
  for (const [u, v] of [[A, na], [B, nb]]) { u.elo = u.elo || {}; u.elo[d.game] = v; u.eloN = u.eloN || {}; u.eloN[d.game] = (u.eloN[d.game] || 0) + 1; }
  d.elo = { a: [ra, na], b: [rb, nb] }; S.store.touch('users');
}
function ratings(game) { if (!RATED.includes(game)) return []; return Object.values(S.users).filter((u) => !u.deleted && u.eloN && u.eloN[game] > 0).sort((x, y) => eloOf(y, game) - eloOf(x, game)).slice(0, 25).map((u) => ({ user: publicUser(u), rating: eloOf(u, game), games: u.eloN[game] })); }
// friends can watch each other's running duels (read only)
const isFriendOf = (u, d) => (u.friends || []).includes(d.a) || (u.friends || []).includes(d.b);
// Nebulix 3.0: spectators get every move pushed live. Opening /watch registers you for 90 s (the client renews it).
const watchers = new Map(); // duel id → Map(uid → last seen)
const WATCH_MS = 90000;
function watch(u, id) {
  const d = table()[id]; if (!d || (d.a !== u.id && d.b !== u.id && !isFriendOf(u, d))) throw new HttpError(404, 'no_duel', 'Duel not found');
  if (d.a !== u.id && d.b !== u.id && d.status === 'active') { if (!watchers.has(id)) watchers.set(id, new Map()); const m = watchers.get(id); if (m.size < 200 || m.has(u.id)) m.set(u.id, Date.now()); }
  return viewFor(d, u.id);
}
const spectators = (id) => { const m = watchers.get(id); if (!m) return []; const t0 = Date.now() - WATCH_MS; for (const [uid, ts] of m) if (ts < t0) m.delete(uid); if (!m.size) watchers.delete(id); return [...m.keys()]; };
function live(u) { return Object.values(table()).filter((d) => d.status === 'active' && d.game !== 'rps' && d.a !== u.id && d.b !== u.id && isFriendOf(u, d)).slice(0, 20).map((d) => viewFor(d, u.id)); }
const PENDING_MS = 120000;
const MAX_WAGER = 1000;
const MAX_PENDING_OUT = 3;

let D = null; // store table
function table() { if (!D) D = S.store.table('duels'); return D; }

// ---- game rules ----
const TTT_LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
function tttWinner(b) { for (const l of TTT_LINES) if (b[l[0]] !== null && b[l[0]] === b[l[1]] && b[l[1]] === b[l[2]]) return { p: b[l[0]], line: l }; return null; }
const C4_W = 7, C4_H = 6;
function c4Winner(b) {
  const at = (x, y) => (x < 0 || y < 0 || x >= C4_W || y >= C4_H ? null : b[y * C4_W + x]);
  for (let y = 0; y < C4_H; y++) for (let x = 0; x < C4_W; x++) {
    const p = at(x, y); if (p === null) continue;
    for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      const line = [y * C4_W + x]; let k = 1;
      while (k < 4 && at(x + dx * k, y + dy * k) === p) { line.push((y + dy * k) * C4_W + x + dx * k); k++; }
      if (k === 4) return { p, line };
    }
  }
  return null;
}
const RPS_BEATS = { r: 's', p: 'r', s: 'p' };

function initState(game, first) {
  if (game === 'ttt') return { board: Array(9).fill(null), turn: first };
  if (game === 'c4') return { board: Array(C4_W * C4_H).fill(null), turn: first };
  if (game === 'chess') { const pos = R().chess.start(); return { pos, white: first, turn: first, seen: { [R().chess.key(pos)]: 1 }, last: null, moves: [] }; }
  if (game === 'checkers') return { b: R().checkers.ckStart(), white: first, turn: first, quiet: 0, last: null };
  return { round: 1, picks: [null, null], score: [0, 0], history: [] };
}

// ---- views ----
function viewFor(d, uid) {
  const me = d.a === uid ? 0 : d.b === uid ? 1 : null;
  const st = d.st || {};
  const g = { game: d.game };
  if (d.game === 'rps') {
    g.round = st.round; g.score = st.score; g.history = st.history;
    g.myPick = me === null ? null : st.picks ? st.picks[me] : null;
    g.theyPicked = me === null ? false : !!(st.picks && st.picks[1 - me]);
  } else if (d.game === 'chess' && st.pos) { g.pos = st.pos; g.turn = st.turn; g.white = st.white; g.last = st.last; g.moves = (st.moves || []).slice(-200); }
  else if (d.game === 'checkers' && st.b) { g.b = st.b; g.turn = st.turn; g.white = st.white; g.last = st.last; }
  else if (st.board) { g.board = st.board; g.turn = st.turn; g.line = d.line || null; }
  return {
    id: d.id, game: d.game, name: GAMES[d.game].name, a: publicUser(S.users[d.a]), b: publicUser(S.users[d.b]), wager: d.wager, status: d.status,
    me, created: d.created, started: d.started || 0, ended: d.ended || 0, deadline: d.status === 'active' ? d.turnStart + GAMES[d.game].turn : (d.status === 'pending' ? d.created + PENDING_MS : 0),
    winner: d.winner === undefined ? null : d.winner, draw: !!d.draw, reason: d.reason || null, state: g,
    ratings: RATED.includes(d.game) ? { a: eloOf(S.users[d.a], d.game), b: eloOf(S.users[d.b], d.game) } : null, elo: d.elo || null,
  };
}
function push(d) {
  for (const uid of [d.a, d.b]) hub.push(uid, { t: 'duel', duel: viewFor(d, uid) });
  for (const uid of spectators(d.id)) if (uid !== d.a && uid !== d.b) hub.push(uid, { t: 'duel', duel: viewFor(d, uid), watch: true });
  if (d.status !== 'active') watchers.delete(d.id);
}

// ---- lifecycle ----
function econ() { return require('./economy'); }
function prog() { return require('./progress'); }

function canChallenge(a, b) {
  if ((b.blocked || []).includes(a.id) || (a.blocked || []).includes(b.id)) return false;
  const pol = (b.settings && b.settings.duels) || 'friends';
  if (pol === 'none') return false;
  if (pol === 'friends') return (b.friends || []).includes(a.id);
  return true;
}

function create(u, body) {
  const game = String(body.game || '');
  if (!GAMES[game]) throw new HttpError(400, 'bad_game', 'Pick Tic-Tac-Toe, Connect Four, Rock Paper Scissors, Chess or Checkers');
  let target = body.to ? S.users[String(body.to)] : null;
  if (!target && body.username) { const id = S.byName.get(String(body.username).toLowerCase()); target = id ? S.users[id] : null; }
  if (!target || !target.verified || target.deleted) throw new HttpError(404, 'no_user', 'Player not found');
  if (target.id === u.id) throw new HttpError(400, 'self', 'You cannot duel yourself');
  if (!canChallenge(u, target)) throw new HttpError(403, 'duel_blocked', 'This player is not accepting duels from you');
  const wager = Math.trunc(Number(body.wager) || 0);
  if (wager < 0 || wager > MAX_WAGER) throw new HttpError(400, 'bad_wager', `Wagers go from 0 to ${MAX_WAGER} coins`);
  if (wager > u.coins) throw new HttpError(402, 'no_funds', 'Not enough coins for that wager');
  const out = Object.values(table()).filter((d) => d.a === u.id && d.status === 'pending' && now() - d.created < PENDING_MS);
  if (out.length >= MAX_PENDING_OUT) throw new HttpError(429, 'too_many', 'You already have 3 open challenges');
  if (Object.values(table()).some((d) => d.status === 'active' && ([d.a, d.b].includes(u.id) && [d.a, d.b].includes(target.id)))) throw new HttpError(409, 'in_game', 'You are already playing this person');
  const d = { id: 'd' + rid(6), game, a: u.id, b: target.id, wager, status: 'pending', created: now() };
  table()[d.id] = d; S.store.touch('duels'); push(d);
  return viewFor(d, u.id);
}

function get(id, u) {
  const d = table()[id]; if (!d || (u && d.a !== u.id && d.b !== u.id)) throw new HttpError(404, 'no_duel', 'Duel not found');
  return d;
}

function accept(u, id) {
  const d = get(id, u);
  if (d.b !== u.id) throw new HttpError(403, 'forbidden', 'Only the challenged player can accept');
  if (d.status !== 'pending') throw new HttpError(409, 'not_pending', 'This challenge is no longer open');
  if (now() - d.created > PENDING_MS) { d.status = 'expired'; S.store.touch('duels'); push(d); throw new HttpError(410, 'expired', 'This challenge expired'); }
  const A = S.users[d.a], B = S.users[d.b];
  if (!A || !B) throw new HttpError(404, 'no_user', 'Player not found');
  if (d.wager) {
    if (A.coins < d.wager) throw new HttpError(402, 'no_funds_them', 'The challenger no longer has enough coins');
    if (B.coins < d.wager) throw new HttpError(402, 'no_funds', 'Not enough coins for this wager');
    econ().adjust(A, -d.wager, 'duel:stake'); econ().adjust(B, -d.wager, 'duel:stake'); d.escrow = true;
  }
  d.status = 'active'; d.started = now(); d.turnStart = now();
  d.st = initState(d.game, crypto.randomInt(2));
  S.store.touch('duels'); push(d);
  return viewFor(d, u.id);
}

function decline(u, id) {
  const d = get(id, u);
  if (d.status !== 'pending') throw new HttpError(409, 'not_pending', 'This challenge is no longer open');
  d.status = d.a === u.id ? 'canceled' : 'declined'; d.ended = now();
  S.store.touch('duels'); push(d);
  return viewFor(d, u.id);
}

// winnerIdx: 0 / 1 / null (draw)
function finish(d, winnerIdx, reason, line) {
  if (d.status !== 'active') return;
  d.status = 'done'; d.ended = now(); d.reason = reason; if (line) d.line = line;
  const ids = [d.a, d.b];
  if (winnerIdx === null) { d.draw = true; d.winner = null; if (d.escrow) ids.forEach((id) => { const x = S.users[id]; if (x) econ().adjust(x, d.wager, 'duel:refund'); }); }
  else {
    d.winner = ids[winnerIdx];
    if (d.escrow) { const w = S.users[d.winner]; if (w) econ().adjust(w, d.wager * 2, 'duel:win'); }
  }
  d.escrow = false; try { rate(d, winnerIdx); } catch (e) { console.error('[duels] elo', e); }
  ids.forEach((id) => { const x = S.users[id]; if (x) prog().award(x, 'duel'); });
  if (d.winner && S.users[d.winner]) prog().award(S.users[d.winner], 'duel_win');
  S.store.touch('duels');
}

function move(u, id, body) {
  const d = get(id, u);
  if (d.status !== 'active') throw new HttpError(409, 'not_active', 'This duel is not running');
  const me = d.a === u.id ? 0 : 1; const st = d.st;
  if (d.game === 'chess' || d.game === 'checkers') {
    if (st.turn !== me) throw new HttpError(409, 'not_your_turn', 'Wait for your turn');
    const side = me === st.white ? 'w' : 'b';
    if (d.game === 'chess') {
      const C = R().chess; if (st.pos.turn !== side) throw new HttpError(409, 'not_your_turn', 'Wait for your turn');
      const from = Number(body.from), to = Number(body.to); const promo = String(body.promo || 'q').toLowerCase();
      const m = C.legal(st.pos).find((x) => x.from === from && x.to === to && (!x.promo || x.promo.toLowerCase() === promo));
      if (!m) throw new HttpError(400, 'bad_move', 'That move is not legal');
      st.pos = C.make(st.pos, m); st.last = { from, to }; st.moves = (st.moves || []).concat({ from, to, piece: m.piece, cap: m.cap || null, promo: m.promo || null, castle: m.castle || null }).slice(-400);
      const k = C.key(st.pos); st.seen[k] = (st.seen[k] || 0) + 1;
      const next = C.legal(st.pos); const pcs = st.pos.b.filter(Boolean).map((p) => p.toLowerCase()).sort().join('');
      if (!next.length) { if (C.inCheck(st.pos, st.pos.turn)) finish(d, me, 'checkmate'); else finish(d, null, 'stalemate'); }
      else if (st.pos.half >= 100 || st.seen[k] >= 3 || ['kk', 'bkk', 'kkn'].includes(pcs)) finish(d, null, 'draw');
      else { st.turn = 1 - me; d.turnStart = now(); }
    } else {
      const K = R().checkers; const path = Array.isArray(body.path) ? body.path.map(Number) : [];
      const m = K.ckMoves(st.b, side).find((x) => x.path.length === path.length && x.path.every((v, i) => v === path[i]));
      if (!m) throw new HttpError(400, 'bad_move', 'That move is not legal');
      const man = st.b[m.path[0]] === side; st.b = K.ckApply(st.b, m); st.last = { path: m.path, caps: m.caps };
      st.quiet = m.caps.length || man ? 0 : (st.quiet || 0) + 1;
      const other = side === 'w' ? 'b' : 'w';
      if (!K.ckMoves(st.b, other).length) finish(d, me, 'win');
      else if (st.quiet >= 80) finish(d, null, 'draw');
      else { st.turn = 1 - me; d.turnStart = now(); }
    }
  } else if (d.game === 'ttt' || d.game === 'c4') {
    if (st.turn !== me) throw new HttpError(409, 'not_your_turn', 'Wait for your turn');
    let cell;
    if (d.game === 'ttt') { cell = Number(body.cell); if (!Number.isInteger(cell) || cell < 0 || cell > 8 || st.board[cell] !== null) throw new HttpError(400, 'bad_move', 'Pick an empty square'); }
    else {
      const col = Number(body.col); if (!Number.isInteger(col) || col < 0 || col >= C4_W) throw new HttpError(400, 'bad_move', 'Pick a column');
      cell = -1; for (let y = C4_H - 1; y >= 0; y--) if (st.board[y * C4_W + col] === null) { cell = y * C4_W + col; break; }
      if (cell < 0) throw new HttpError(400, 'bad_move', 'That column is full');
    }
    st.board[cell] = me; st.last = cell;
    const w = d.game === 'ttt' ? tttWinner(st.board) : c4Winner(st.board);
    if (w) finish(d, w.p, 'win', w.line);
    else if (st.board.every((x) => x !== null)) finish(d, null, 'draw');
    else { st.turn = 1 - me; d.turnStart = now(); }
  } else {
    const pick = String(body.pick || '');
    if (!RPS_BEATS[pick]) throw new HttpError(400, 'bad_move', 'Pick rock, paper or scissors');
    if (st.picks[me]) throw new HttpError(409, 'already_picked', 'You already picked this round');
    st.picks[me] = pick;
    if (st.picks[0] && st.picks[1]) {
      const [p0, p1] = st.picks; let w = null;
      if (p0 !== p1) w = RPS_BEATS[p0] === p1 ? 0 : 1;
      if (w !== null) st.score[w]++;
      st.history.push({ picks: [p0, p1], w });
      st.picks = [null, null]; st.round++; d.turnStart = now();
      if (st.score[0] >= 2 || st.score[1] >= 2) finish(d, st.score[0] > st.score[1] ? 0 : 1, 'win');
      else if (st.round > 7) finish(d, st.score[0] === st.score[1] ? null : st.score[0] > st.score[1] ? 0 : 1, st.score[0] === st.score[1] ? 'draw' : 'win'); // 7 rounds of ties max
    }
  }
  S.store.touch('duels'); push(d);
  return viewFor(d, u.id);
}

function resign(u, id) {
  const d = get(id, u);
  if (d.status !== 'active') throw new HttpError(409, 'not_active', 'This duel is not running');
  finish(d, d.a === u.id ? 1 : 0, 'resign'); push(d);
  return viewFor(d, u.id);
}

function rematch(u, id) {
  const d = get(id, u);
  if (d.status !== 'done') throw new HttpError(409, 'not_done', 'Finish the duel first');
  const other = d.a === u.id ? d.b : d.a;
  return create(u, { game: d.game, to: other, wager: d.wager });
}

function listFor(u) {
  const mine = Object.values(table()).filter((d) => d.a === u.id || d.b === u.id);
  const t = now();
  const live = mine.filter((d) => d.status === 'active' || (d.status === 'pending' && t - d.created < PENDING_MS)).sort((x, y) => y.created - x.created);
  const recent = mine.filter((d) => d.status === 'done').sort((x, y) => y.ended - x.ended).slice(0, 10);
  return { live: live.map((d) => viewFor(d, u.id)), recent: recent.map((d) => viewFor(d, u.id)) };
}

// Timeouts: a player who lets their turn clock run out loses; stale pending challenges expire.
function sweep() {
  if (!S.store) return;
  const t = now(); let dirty = false;
  for (const d of Object.values(table())) {
    if (d.status === 'pending' && t - d.created > PENDING_MS) { d.status = 'expired'; d.ended = t; dirty = true; push(d); }
    else if (d.status === 'active' && t - d.turnStart > GAMES[d.game].turn + 1500) {
      const st = d.st; let loser;
      if (d.game === 'rps') loser = !st.picks[0] && !st.picks[1] ? null : (st.picks[0] ? 1 : 0);
      else loser = st.turn;
      if (loser === null) finish(d, null, 'timeout'); else finish(d, 1 - loser, 'timeout');
      dirty = true; push(d);
    }
    // forget old finished duels after a week
    if (['done', 'declined', 'canceled', 'expired'].includes(d.status) && t - (d.ended || d.created) > 7 * 86400000) { delete table()[d.id]; dirty = true; }
  }
  if (dirty) S.store.touch('duels');
}

// After a restart, an active duel can't continue (no clocks ran): refund the escrow and close it.
function recover() {
  for (const d of Object.values(table())) {
    if (d.status === 'active') {
      if (d.escrow) for (const id of [d.a, d.b]) { const x = S.users[id]; if (x) econ().adjust(x, d.wager, 'duel:refund'); }
      d.escrow = false; d.status = 'done'; d.draw = true; d.winner = null; d.reason = 'restart'; d.ended = now();
    }
  }
  S.store.touch('duels');
}

let timer = null;
function start() { recover(); if (!timer) { timer = setInterval(sweep, 2000); timer.unref && timer.unref(); } }

module.exports = { ratings, watch, live, GAMES, create, accept, decline, move, resign, rematch, listFor, viewFor, get, sweep, start, table, MAX_WAGER, PENDING_MS };
