'use strict';
// Provably-fair casino games using virtual coins only (no purchase, no cash-out).
const crypto = require('crypto');
const { S, hub } = require('./state');
const econ = require('./economy');
const { HttpError, now, sha256, rid, dayKey } = require('./util');

const MIN_BET = 1; const MAX_BET = 1_000_000_000_000_000; // no real bet limit: you can bet your whole balance

// ---- provably fair RNG: HMAC_SHA256(serverSeed, clientSeed:nonce:cursor) -> 32-bit floats ----
function fairOf(u) {
  if (!u.fair) u.fair = { server: crypto.randomBytes(32).toString('hex'), client: rid(6), nonce: 0 };
  return u.fair;
}
function floatsFrom(server, client, nonce, n) {
  const out = []; let cursor = 0;
  while (out.length < n) {
    const h = crypto.createHmac('sha256', server).update(`${client}:${nonce}:${cursor++}`).digest();
    for (let i = 0; i + 4 <= 32 && out.length < n; i += 4) out.push(h.readUInt32BE(i) / 4294967296);
  }
  return out;
}

// ---- outcomes (pure functions so the client verifier can reproduce them) ----
const SLOT_SYMBOLS = [['🍒', 30], ['🍋', 25], ['🔔', 18], ['🍇', 14], ['⭐', 8], ['💎', 4], ['7️⃣', 1]];
const SLOT_PAY = { '🍒': 8, '🍋': 12, '🔔': 25, '🍇': 40, '⭐': 100, '💎': 300, '7️⃣': 1000 };
const TWO_CHERRY = 1.2;
function slotSymbol(f) {
  let acc = 0; const x = f * 100;
  for (const [s, w] of SLOT_SYMBOLS) { acc += w; if (x < acc) return s; }
  return SLOT_SYMBOLS[0][0];
}
function slotsPayMult(reels) {
  if (reels[0] === reels[1] && reels[1] === reels[2]) return SLOT_PAY[reels[0]];
  if (reels.filter((s) => s === '🍒').length === 2) return TWO_CHERRY;
  return 0;
}
const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
function rouletteWin(bet, n) {
  const t = bet.type;
  if (t === 'number') return n === bet.value ? 36 : 0;
  if (n === 0) return 0;
  switch (t) {
    case 'red': return REDS.has(n) ? 2 : 0;
    case 'black': return !REDS.has(n) ? 2 : 0;
    case 'odd': return n % 2 === 1 ? 2 : 0;
    case 'even': return n % 2 === 0 ? 2 : 0;
    case 'low': return n <= 18 ? 2 : 0;
    case 'high': return n >= 19 ? 2 : 0;
    case 'dozen': return Math.ceil(n / 12) === bet.value ? 3 : 0;
    case 'column': return ((n - 1) % 3) + 1 === bet.value ? 3 : 0;
    default: return 0;
  }
}
const COIN_MULT = 1.96;
function diceMult(target, mode) {
  const chance = mode === 'under' ? target : 100 - target;
  return Math.floor((98 / chance) * 100) / 100;
}

function rgCheck(u, bet) {
  const rg = u.rg || {};
  if (rg.until && rg.until > now()) throw new HttpError(403, 'excluded', 'You paused casino play. It unlocks ' + new Date(rg.until).toLocaleString('en-US'));
  if (rg.pending && rg.pending.at <= now()) { rg.limit = rg.pending.limit; rg.pending = null; }
  if (rg.limit > 0) {
    const lost = rg.day === dayKey() ? rg.lost || 0 : 0;
    if (lost >= rg.limit) throw new HttpError(403, 'limit', 'Daily loss limit reached. Take a break!');
  }
}
// Responsible play: tightening a limit applies instantly, loosening it waits 24h; pauses can only be extended.
function setLimits(u, { limit, pauseHours }) {
  u.rg = u.rg || {};
  const rg = u.rg;
  if (rg.pending && rg.pending.at <= now()) { rg.limit = rg.pending.limit; rg.pending = null; }
  if (limit !== undefined) {
    limit = Math.trunc(Number(limit));
    if (!Number.isFinite(limit) || limit < 0 || limit > 1000000) throw new HttpError(400, 'bad_limit', 'Limit must be 0 (none) or a positive number');
    const cur = rg.limit || 0;
    const looser = limit === 0 ? cur > 0 : cur > 0 && limit > cur;
    if (looser) rg.pending = { limit, at: now() + 24 * 3600 * 1000 };
    else { rg.limit = limit; rg.pending = null; }
  }
  if (pauseHours) {
    if (![1, 24, 168].includes(pauseHours)) throw new HttpError(400, 'bad_pause', 'Pause for 1h, 24h or 7 days');
    rg.until = Math.max(rg.until || 0, now() + pauseHours * 3600 * 1000);
  }
  S.store.touch('users');
}
function rgRecord(u, net) {
  u.rg = u.rg || {};
  if (u.rg.day !== dayKey()) { u.rg.day = dayKey(); u.rg.lost = 0; }
  if (net < 0) u.rg.lost = (u.rg.lost || 0) - net;
  else u.rg.lost = Math.max(0, (u.rg.lost || 0) - net);
}

const lastBet = new Map();
// Shared bet validation for every game: limits, funds, pacing and responsible-play settings.
function checkBet(u, raw, { gap = 600 } = {}) {
  const bet = Math.trunc(Number(raw));
  if (!Number.isFinite(bet) || bet < MIN_BET) throw new HttpError(400, 'bad_bet', 'Minimum bet is ' + MIN_BET);
  if (bet > MAX_BET) throw new HttpError(400, 'bad_bet', 'Maximum bet is ' + MAX_BET);
  if (bet > u.coins) throw new HttpError(402, 'no_funds', 'Not enough coins');
  const t = Date.now();
  if (t - (lastBet.get(u.id) || 0) < gap) throw new HttpError(429, 'too_fast', 'Slow down a little');
  lastBet.set(u.id, t);
  rgCheck(u, bet);
  return bet;
}
// Stats, responsible-play tally and XP for a finished bet (coins are moved by the caller).
function record(u, bet, payout, mult) {
  const net = payout - bet;
  const st = (u.stats = u.stats || {});
  st.bets = (st.bets || 0) + 1; st.wagered = (st.wagered || 0) + bet;
  if (payout > 0) st.won = (st.won || 0) + payout;
  if (net > (st.biggest || 0)) st.biggest = net;
  rgRecord(u, net);
  try { require('./boosts').cashback(u, net); } catch {}
  S.store.touch('users');
  const prog = require('./progress'); prog.award(u, 'bet', 1, { bet, mult, net }); if (net > 0) prog.award(u, 'win');
  try { require('./c3d').played(u, net, bet); } catch {}
  return net;
}

function play(u, game, params) {
  if (EXTRA_SINGLE[game]) return EXTRA_SINGLE[game](u, params);
  const bet = checkBet(u, params.bet);

  const fair = fairOf(u);
  const nonce = fair.nonce;
  let mult = 0; let result;
  if (game === 'coinflip') {
    const pick = params.pick === 'tails' ? 'tails' : params.pick === 'heads' ? 'heads' : null;
    if (!pick) throw new HttpError(400, 'bad_pick', 'Pick heads or tails');
    const [f] = floatsFrom(fair.server, fair.client, nonce, 1);
    const side = f < 0.5 ? 'heads' : 'tails';
    mult = side === pick ? COIN_MULT : 0; result = { side, pick };
  } else if (game === 'dice') {
    const target = Number(params.target); const mode = params.mode === 'over' ? 'over' : 'under';
    if (!Number.isFinite(target) || target < 2 || target > 98) throw new HttpError(400, 'bad_target', 'Target must be between 2 and 98');
    const [f] = floatsFrom(fair.server, fair.client, nonce, 1);
    const roll = Math.floor(f * 10000) / 100;
    const win = mode === 'under' ? roll < target : roll > target;
    mult = win ? diceMult(target, mode) : 0; result = { roll, target, mode, mult: diceMult(target, mode) };
  } else if (game === 'slots') {
    const reels = floatsFrom(fair.server, fair.client, nonce, 3).map(slotSymbol);
    mult = slotsPayMult(reels); result = { reels };
  } else if (game === 'roulette') {
    const type = String(params.type || ''); const value = Number(params.value);
    const okT = ['red', 'black', 'odd', 'even', 'low', 'high', 'dozen', 'column', 'number'];
    if (!okT.includes(type)) throw new HttpError(400, 'bad_bet_type', 'Unknown roulette bet');
    if (type === 'number' && !(Number.isInteger(value) && value >= 0 && value <= 36)) throw new HttpError(400, 'bad_value', 'Pick a number from 0 to 36');
    if ((type === 'dozen' || type === 'column') && ![1, 2, 3].includes(value)) throw new HttpError(400, 'bad_value', 'Pick 1, 2 or 3');
    const [f] = floatsFrom(fair.server, fair.client, nonce, 1);
    const n = Math.floor(f * 37);
    mult = rouletteWin({ type, value }, n); result = { n, color: n === 0 ? 'green' : REDS.has(n) ? 'red' : 'black', type, value };
  } else throw new HttpError(404, 'no_game', 'Unknown game');

  fair.nonce++;
  const payout = Math.floor(bet * mult);
  const net = payout - bet;
  // single atomic ledger update
  econ.adjust(u, net, 'casino:' + game);
  record(u, bet, payout, mult);
  bigWin(u, game, bet, mult, payout);
  return { game, bet, mult, payout, net, result, nonce, balance: u.coins };
}

function fairPublic(u) {
  const f = fairOf(u);
  const rg = u.rg || {};
  return { hash: sha256(f.server), client: f.client, nonce: f.nonce, rg: { limit: rg.limit || 0, pending: rg.pending || null, until: rg.until || 0, lost: rg.day === dayKey() ? rg.lost || 0 : 0 } };
}
function setClientSeed(u, seed) {
  if (typeof seed !== 'string' || !/^[\w .-]{1,32}$/.test(seed)) throw new HttpError(400, 'bad_seed', 'Seed must be 1-32 simple characters');
  const f = fairOf(u); f.client = seed; f.nonce = 0; S.store.touch('users');
}
function rotate(u) {
  const f = fairOf(u);
  const old = { server: f.server, hash: sha256(f.server), client: f.client, lastNonce: f.nonce };
  u.fair = { server: crypto.randomBytes(32).toString('hex'), client: f.client, nonce: 0 };
  S.store.touch('users');
  return { revealed: old, next: { hash: sha256(u.fair.server), client: u.fair.client, nonce: 0 } };
}

function leaderboard() {
  const list = Object.values(S.users).filter((u) => u.verified && !u.deleted && !u.banned);
  // a bottomless owner wallet would make the board pointless
  const rich = list.filter((u) => !u.infinite).sort((a, b) => b.coins - a.coins).slice(0, 10).map((u) => ({ id: u.id, name: u.displayName || u.username, coins: u.coins }));
  const big = list.slice().sort((a, b) => ((b.stats || {}).biggest || 0) - ((a.stats || {}).biggest || 0)).filter((u) => (u.stats || {}).biggest > 0).slice(0, 10)
    .map((u) => ({ id: u.id, name: u.displayName || u.username, win: u.stats.biggest }));
  return { rich, big };
}

// ===================== more games: crash, plinko, mines, blackjack, jackpot =====================
// Same provably-fair seeds as the classic games; every outcome comes from floatsFrom(server, client, nonce).
function nextFloats(u, n) { const f = fairOf(u); const out = floatsFrom(f.server, f.client, f.nonce, n); const nonce = f.nonce; f.nonce++; return { fl: out, nonce }; }

// ---- Crash: pick an auto cash-out; the rocket's crash point is 0.98 / (1 - f) (2% edge, 1.00 = instant bust). ----
const CRASH_MAX = 1000;
function crashPoint(f) { return Math.min(CRASH_MAX, Math.max(1, Math.floor((0.98 / (1 - f)) * 100) / 100)); }
function playCrash(u, params) {
  const cash = Math.floor(Number(params.cashout) * 100) / 100;
  if (!Number.isFinite(cash) || cash < 1.01 || cash > CRASH_MAX) throw new HttpError(400, 'bad_cashout', 'Auto cash-out must be between 1.01× and 1000×');
  const bet = checkBet(u, params.bet);
  const { fl, nonce } = nextFloats(u, 1);
  const point = crashPoint(fl[0]);
  const mult = point >= cash ? cash : 0;
  const payout = Math.floor(bet * mult);
  econ.adjust(u, payout - bet, 'casino:crash'); const net = record(u, bet, payout, mult); bigWin(u, 'crash', bet, mult, payout);
  return { game: 'crash', bet, mult, payout, net, result: { point, cashout: cash }, nonce, balance: u.coins };
}

// ---- Plinko: one float per row, < 0.5 falls left. Tables pay ~99%. ----
const PLINKO = {
  8: { low: [5.6, 2.1, 1.1, 1, 0.5, 1, 1.1, 2.1, 5.6], medium: [13, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 13], high: [29, 4, 1.5, 0.3, 0.2, 0.3, 1.5, 4, 29] },
  12: { low: [10, 3, 1.6, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 1.6, 3, 10], medium: [33, 11, 4, 2, 1.1, 0.6, 0.3, 0.6, 1.1, 2, 4, 11, 33], high: [170, 24, 8.1, 2, 0.7, 0.2, 0.2, 0.2, 0.7, 2, 8.1, 24, 170] },
  16: { low: [16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1, 0.5, 1, 1.1, 1.2, 1.4, 1.4, 2, 9, 16], medium: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110], high: [1000, 130, 26, 9, 4, 2, 0.2, 0.2, 0.2, 0.2, 0.2, 2, 4, 9, 26, 130, 1000] },
};
function plinkoPath(fl, rows) { const path = fl.slice(0, rows).map((f) => (f < 0.5 ? 0 : 1)); return { path, slot: path.reduce((a, b) => a + b, 0) }; }
function playPlinko(u, params) {
  const rows = Number(params.rows); const risk = String(params.risk || '');
  if (!PLINKO[rows] || !PLINKO[rows][risk]) throw new HttpError(400, 'bad_plinko', 'Pick 8, 12 or 16 rows and low, medium or high risk');
  const bet = checkBet(u, params.bet, { gap: 250 });
  const { fl, nonce } = nextFloats(u, rows);
  const { path, slot } = plinkoPath(fl, rows);
  const mult = PLINKO[rows][risk][slot]; const payout = Math.floor(bet * mult);
  econ.adjust(u, payout - bet, 'casino:plinko'); const net = record(u, bet, payout, mult); bigWin(u, 'plinko', bet, mult, payout);
  return { game: 'plinko', bet, mult, payout, net, result: { rows, risk, path, slot }, nonce, balance: u.coins };
}

// ---- Horse racing: 6 horses with fixed chances; payout = 0.95 / chance (5% edge). One float picks the winner,
// five more set the order behind it, the rest shape each horse's pace for the race animation. ----
const HORSES = [
  { id: 0, name: 'Relámpago', color: '#ef4444', p: 0.30 }, { id: 1, name: 'Nébula', color: '#8b5cf6', p: 0.22 }, { id: 2, name: 'Cometa', color: '#f59e0b', p: 0.17 },
  { id: 3, name: 'Trueno', color: '#3b82f6', p: 0.13 }, { id: 4, name: 'Esmeralda', color: '#22c55e', p: 0.10 }, { id: 5, name: 'Fantasma', color: '#e5e7eb', p: 0.08 },
].map((x) => Object.assign(x, { mult: Math.floor((0.95 / x.p) * 100) / 100 }));
function horseRace(fl) {
  let acc = 0; let winner = HORSES.length - 1; for (const hz of HORSES) { acc += hz.p; if (fl[0] < acc) { winner = hz.id; break; } }
  const rest = HORSES.filter((x) => x.id !== winner).map((x, i) => ({ id: x.id, k: fl[1 + i] + x.p })).sort((a, b) => b.k - a.k).map((x) => x.id);
  const order = [winner, ...rest];
  // pace: 10 checkpoints per horse (fraction of the track), winner crosses first; others finish behind by place
  const pace = {}; order.forEach((id, place) => { const pts = []; let x = 0; const end = 1 - place * 0.035; for (let k = 1; k <= 10; k++) { const noise = (fl[6 + id * 10 + k - 1] - 0.5) * 0.06; x = k === 10 ? end : Math.min(end - 0.01, Math.max(x + 0.02, (end * k) / 10 + noise)); pts.push(Math.round(x * 1000) / 1000); } pace[id] = pts; });
  return { winner, order, pace };
}
function playHorses(u, params) {
  const horse = Math.trunc(Number(params.horse)); const hz = HORSES[horse]; if (!hz) throw new HttpError(400, 'bad_horse', 'Pick a horse');
  const bet = checkBet(u, params.bet, { gap: 1500 });
  const { fl, nonce } = nextFloats(u, 66);
  const race = horseRace(fl);
  const mult = race.winner === horse ? hz.mult : 0; const payout = Math.floor(bet * mult);
  econ.adjust(u, payout - bet, 'casino:horses'); const net = record(u, bet, payout, mult);
  return { game: 'horses', bet, mult, payout, net, result: Object.assign({ horse }, race), nonce, balance: u.coins };
}

// ---- Wheel: 30 segments, the risk picks the multipliers (~97.5–98% back). One float picks the segment. ----
const WHEEL_SEG = (spec) => { const pool = spec.flatMap(([m, n]) => Array(n).fill(m)); const wins = pool.filter((m) => m > 0).sort((x, y) => x - y); const W = wins.length;
  // fixed, mixed order (same for everyone, part of the fair maths): wins spread evenly, alternating small and big ones
  const mixed = []; let lo = 0, hi = W - 1; while (lo <= hi) { mixed.push(wins[lo++]); if (lo <= hi) mixed.push(wins[hi--]); }
  const out = []; let wi = 0; for (let i = 0; i < 30; i++) out.push(Math.floor(((i + 1) * W) / 30) > Math.floor((i * W) / 30) ? mixed[wi++] : 0); return out; };
const WHEEL = { low: WHEEL_SEG([[1.5, 12], [1.25, 9], [0, 9]]), medium: WHEEL_SEG([[1.7, 5], [2, 4], [3, 3], [4, 1], [0, 17]]), high: WHEEL_SEG([[29.4, 1], [0, 29]]) };
function playWheel(u, params) {
  const risk = String(params.risk || ''); if (!WHEEL[risk]) throw new HttpError(400, 'bad_risk', 'Pick low, medium or high risk');
  const bet = checkBet(u, params.bet, { gap: 300 });
  const { fl, nonce } = nextFloats(u, 1); const seg = Math.floor(fl[0] * 30); const mult = WHEEL[risk][seg]; const payout = Math.floor(bet * mult);
  econ.adjust(u, payout - bet, 'casino:wheel'); const net = record(u, bet, payout, mult); bigWin(u, 'wheel', bet, mult, payout);
  return { game: 'wheel', bet, mult, payout, net, result: { risk, seg }, nonce, balance: u.coins };
}
// ---- Keno: 40 numbers, pick 1–10, 10 are drawn. Tables scaled at start-up to 97% back (exact hypergeometric maths). ----
const KENO_BASE = { 1: [0, 3.96], 2: [0, 1.9, 4.5], 3: [0, 1, 3.1, 10.4], 4: [0, 0.8, 1.8, 5, 22.5], 5: [0, 0.25, 1.4, 4.1, 16.5, 36], 6: [0, 0, 1, 3.68, 7, 16.5, 40], 7: [0, 0, 0.47, 3, 4.5, 14, 31, 60], 8: [0, 0, 0, 2.2, 4, 13, 22, 55, 70], 9: [0, 0, 0, 1.55, 3, 8, 15, 44, 60, 85], 10: [0, 0, 0, 1.4, 2.25, 4.5, 8, 17, 50, 80, 100] };
const choose = (n, k) => { if (k < 0 || k > n) return 0; let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; };
const KENO = {}; for (const [k, row] of Object.entries(KENO_BASE)) { const K = Number(k); const ev = row.reduce((a, m, h) => a + m * (choose(K, h) * choose(40 - K, 10 - h)) / choose(40, 10), 0); KENO[K] = row.map((m) => Math.floor(m * (0.97 / ev) * 100) / 100); }
function kenoDraw(fl) { const cells = [...Array(40).keys()].map((x) => x + 1); for (let i = 39; i > 0; i--) { const j = Math.floor(fl[39 - i] * (i + 1)); [cells[i], cells[j]] = [cells[j], cells[i]]; } return cells.slice(0, 10); }
function playKeno(u, params) {
  const picks = [...new Set((Array.isArray(params.picks) ? params.picks : []).map((x) => Math.trunc(Number(x))))].filter((x) => x >= 1 && x <= 40);
  if (picks.length < 1 || picks.length > 10) throw new HttpError(400, 'bad_picks', 'Pick between 1 and 10 numbers');
  const bet = checkBet(u, params.bet, { gap: 400 });
  const { fl, nonce } = nextFloats(u, 39); const drawn = kenoDraw(fl); const hits = picks.filter((x) => drawn.includes(x)).length;
  const mult = KENO[picks.length][hits] || 0; const payout = Math.floor(bet * mult);
  econ.adjust(u, payout - bet, 'casino:keno'); const net = record(u, bet, payout, mult); bigWin(u, 'keno', bet, mult, payout);
  return { game: 'keno', bet, mult, payout, net, result: { picks, drawn, hits }, nonce, balance: u.coins };
}
// ---- Limbo: choose a target; the result is 0.98 / (1 - f). Reach the target and you win bet × target. ----
const LIMBO_MAX = 1000000;
function playLimbo(u, params) {
  const target = Math.floor(Number(params.target) * 100) / 100;
  if (!Number.isFinite(target) || target < 1.01 || target > LIMBO_MAX) throw new HttpError(400, 'bad_target', 'Target must be between 1.01× and 1,000,000×');
  const bet = checkBet(u, params.bet, { gap: 250 });
  const { fl, nonce } = nextFloats(u, 1); const point = Math.min(LIMBO_MAX, Math.max(1, Math.floor((0.98 / (1 - fl[0])) * 100) / 100));
  const mult = point >= target ? target : 0; const payout = Math.floor(bet * mult);
  econ.adjust(u, payout - bet, 'casino:limbo'); const net = record(u, bet, payout, mult); bigWin(u, 'limbo', bet, mult, payout);
  return { game: 'limbo', bet, mult, payout, net, result: { point, target }, nonce, balance: u.coins };
}
// big wins go to Nebulix Live (and the casino's live ticker)
const GNAME = { dragontiger: ['Dragon Tiger', 'Dragón y Tigre'], sicbo: ['Sic Bo', 'Sic Bo'], craps: ['Craps', 'Dados (Craps)'], tower: ['Tower', 'Torre'], baccarat: ['Baccarat', 'Bacará'], videopoker: ['Video Poker', 'Video póker'], hilo: ['Hi-Lo', 'Hi-Lo'], wheel: ['Wheel', 'Rueda'], keno: ['Keno', 'Keno'], limbo: ['Limbo', 'Limbo'], crash: ['Crash', 'Crash'], plinko: ['Plinko', 'Plinko'], slots: ['Slots', 'Tragaperras'], roulette: ['Roulette', 'Ruleta'], mines: ['Mines', 'Minas'], dice: ['Dice', 'Dados'], horses: ['Horse racing', 'Carreras de caballos'], blackjack: ['Blackjack', 'Blackjack'], coinflip: ['Coin Flip', 'Cara o cruz'] };
const lastBig = new Map();
function bigWin(u, game, bet, mult, payout) {
  try {
    if (!(mult >= 20 && payout - bet >= 2000)) return; const t = Date.now(); if (t - (lastBig.get(u.id) || 0) < 60000) return; lastBig.set(u.id, t);
    const g = GNAME[game] || [game, game]; const m = '×' + (Math.round(mult * 100) / 100); const n = payout.toLocaleString('es-ES');
    require('./feed').add('casino', '🎰', [`@${u.username} won ${n} coins (${m}) in ${g[0]}`, `@${u.username} ha ganado ${n} monedas (${m}) en ${g[1]}`], { uid: u.id, link: '/casino/' + game });
  } catch {}
}
// ---- Daily free spin: once a day, a free prize wheel (no bet). ----
const DAILY_PRIZES = [100, 250, 100, 500, 150, 1000, 200, 2500, 100, 300, 5000, 250];
function dailySpin(u) {
  const today = dayKey(); u.casinoDaily = u.casinoDaily || {};
  if (u.casinoDaily.day === today) throw new HttpError(429, 'already', 'You already used today’s free spin. Come back tomorrow!');
  const seg = crypto.randomInt(DAILY_PRIZES.length); const prize = DAILY_PRIZES[seg];
  u.casinoDaily = { day: today, prize }; econ.adjust(u, prize, 'casino:daily'); S.store.touch('users');
  return { seg, prize, balance: u.coins };
}
const dailyState = (u) => ({ prizes: DAILY_PRIZES, used: !!(u.casinoDaily && u.casinoDaily.day === dayKey()) });

// ---- Nebulix 3.0 tables: Dragon Tiger, Sic Bo, Craps (one request each) and Tower (multi-step, like Mines) ----
// Outcomes come from the same provably fair floats as every other game; payouts are set from exact odds.
const DT_RANK = (c) => RANKS.indexOf(c.r) + 1; // A low … K high
function playDragonTiger(u, params) {
  const side = String(params.side || ''); if (!['dragon', 'tiger', 'tie'].includes(side)) throw new HttpError(400, 'bad_side', 'Bet on Dragon, Tiger or Tie');
  const bet = checkBet(u, params.bet, { gap: 300 }); const { fl, nonce } = nextFloats(u, 2);
  const dragon = cardOf(fl[0]), tiger = cardOf(fl[1]); const d = DT_RANK(dragon), tt = DT_RANK(tiger); const win = d > tt ? 'dragon' : tt > d ? 'tiger' : 'tie';
  const mult = win === 'tie' ? (side === 'tie' ? 12 : 0.5) : side === win ? 2 : 0; const payout = Math.floor(bet * mult);
  econ.adjust(u, payout - bet, 'casino:dragontiger'); const net = record(u, bet, payout, mult); bigWin(u, 'dragontiger', bet, mult, payout);
  return { game: 'dragontiger', bet, mult, payout, net, result: { dragon, tiger, win, side }, nonce, balance: u.coins };
}
const SB_WAYS = (() => { const w = {}; for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) for (let c = 1; c <= 6; c++) w[a + b + c] = (w[a + b + c] || 0) + 1; return w; })();
const SB_EDGE = 0.97;
const SB_PAY = { small: 2, big: 2, odd: 2, even: 2, triple: Math.floor((SB_EDGE * 216 / 6) * 10) / 10, total: Object.fromEntries(Object.entries(SB_WAYS).filter(([k]) => k >= 4 && k <= 17).map(([k, w]) => [k, Math.floor((SB_EDGE * 216 / w) * 10) / 10])) };
function sicboWins(dice, bet, pick) {
  const sum = dice[0] + dice[1] + dice[2]; const triple = dice[0] === dice[1] && dice[1] === dice[2];
  if (bet === 'small') return !triple && sum >= 4 && sum <= 10; if (bet === 'big') return !triple && sum >= 11 && sum <= 17;
  if (bet === 'odd') return !triple && sum % 2 === 1; if (bet === 'even') return !triple && sum % 2 === 0;
  if (bet === 'triple') return triple; if (bet === 'total') return sum === pick; return false;
}
function playSicBo(u, params) {
  const kind = String(params.kind || ''); const pick = Math.trunc(Number(params.total));
  if (!['small', 'big', 'odd', 'even', 'triple', 'total'].includes(kind)) throw new HttpError(400, 'bad_bet', 'Choose a Sic Bo bet');
  if (kind === 'total' && !(pick >= 4 && pick <= 17)) throw new HttpError(400, 'bad_total', 'Pick a total from 4 to 17');
  const bet = checkBet(u, params.bet, { gap: 300 }); const { fl, nonce } = nextFloats(u, 3); const dice = fl.map((f) => 1 + Math.floor(f * 6));
  const m = kind === 'total' ? SB_PAY.total[pick] : SB_PAY[kind]; const mult = sicboWins(dice, kind, pick) ? m : 0; const payout = Math.floor(bet * mult);
  econ.adjust(u, payout - bet, 'casino:sicbo'); const net = record(u, bet, payout, mult); bigWin(u, 'sicbo', bet, mult, payout);
  return { game: 'sicbo', bet, mult, payout, net, result: { dice, sum: dice[0] + dice[1] + dice[2], kind, total: kind === 'total' ? pick : null }, nonce, balance: u.coins };
}
// Craps: Pass / Don't Pass are settled in one go (every roll is returned for the animation); Field is one roll.
function crapsRolls(fl, line) {
  const rolls = []; let i = 0; const roll = () => { const r = [1 + Math.floor(fl[i++] * 6), 1 + Math.floor(fl[i++] * 6)]; rolls.push(r); return r[0] + r[1]; };
  if (line === 'field') { const s = roll(); return { rolls, mult: s === 2 ? 3 : s === 12 ? 4 : [3, 4, 9, 10, 11].includes(s) ? 2 : 0, point: null }; }
  const first = roll(); const pass = line === 'pass';
  if ([7, 11].includes(first)) return { rolls, mult: pass ? 2 : 0, point: null };
  if ([2, 3].includes(first)) return { rolls, mult: pass ? 0 : 2, point: null };
  if (first === 12) return { rolls, mult: pass ? 0 : 1, point: null }; // don't pass: bar 12 (push)
  while (i + 2 <= fl.length) { const s = roll(); if (s === first) return { rolls, mult: pass ? 2 : 0, point: first }; if (s === 7) return { rolls, mult: pass ? 0 : 2, point: first }; }
  return { rolls, mult: 1, point: first }; // practically impossible (300 rolls without a decision): stake returned
}
function playCraps(u, params) {
  const line = String(params.line || ''); if (!['pass', 'dontpass', 'field'].includes(line)) throw new HttpError(400, 'bad_bet', 'Choose Pass, Don’t Pass or Field');
  const bet = checkBet(u, params.bet, { gap: 300 }); const { fl, nonce } = nextFloats(u, 600); const r = crapsRolls(fl, line);
  const payout = Math.floor(bet * r.mult); econ.adjust(u, payout - bet, 'casino:craps'); const net = record(u, bet, payout, r.mult); bigWin(u, 'craps', bet, r.mult, payout);
  return { game: 'craps', bet, mult: r.mult, payout, net, result: { line, rolls: r.rolls, point: r.point }, nonce, balance: u.coins };
}
// Tower: 8 floors; pick a safe tile on each floor to climb, cash out any time after the first floor.
const TOWER = { easy: { tiles: 4, bombs: 1 }, medium: { tiles: 3, bombs: 1 }, hard: { tiles: 2, bombs: 1 }, expert: { tiles: 3, bombs: 2 } };
const TOWER_FLOORS = 8, TOWER_EDGE = 0.98;
function towerMult(mode, floors) { const m = TOWER[mode]; return Math.floor(TOWER_EDGE * Math.pow(m.tiles / (m.tiles - m.bombs), floors) * 100) / 100; }
function towerLayout(fl, mode) { const m = TOWER[mode]; const out = []; let k = 0; for (let f = 0; f < TOWER_FLOORS; f++) { const cells = [...Array(m.tiles).keys()]; for (let i = m.tiles - 1; i > 0; i--) { const j = Math.floor(fl[k++] * (i + 1)); [cells[i], cells[j]] = [cells[j], cells[i]]; } out.push(cells.slice(0, m.bombs).sort()); } return out; }
function towerView(r, reveal) { return { bet: r.bet, mode: r.mode, picks: r.picks, floor: r.picks.length, mult: r.picks.length ? towerMult(r.mode, r.picks.length) : 1, next: r.picks.length < TOWER_FLOORS ? towerMult(r.mode, r.picks.length + 1) : null, nonce: r.nonce, layout: reveal ? r.layout : undefined, over: !!reveal }; }
function towerStart(u, params) {
  if (u.round && u.round.tower) throw new HttpError(409, 'in_round', 'Finish your current Tower round first');
  const mode = String(params.mode || 'medium'); if (!TOWER[mode]) throw new HttpError(400, 'bad_mode', 'Choose a difficulty');
  const bet = checkBet(u, params.bet); const { fl, nonce } = nextFloats(u, TOWER_FLOORS * 4);
  if (!econ.adjust(u, -bet, 'casino:tower')) throw new HttpError(402, 'no_funds', 'Not enough coins');
  u.round = Object.assign(u.round || {}, { tower: { bet, mode, layout: towerLayout(fl, mode), picks: [], nonce, t: now() } }); S.store.touch('users');
  return { round: towerView(u.round.tower, false), balance: u.coins };
}
function towerEnd(u, r, payout) { delete u.round.tower; if (payout > 0) econ.adjust(u, payout, 'casino:tower'); const mult = payout / r.bet; const net = record(u, r.bet, payout, mult); bigWin(u, 'tower', r.bet, mult, payout); return { payout, net, mult }; }
function towerPick(u, params) {
  const r = u.round && u.round.tower; if (!r) throw new HttpError(409, 'no_round', 'Start a Tower round first');
  const tile = Math.trunc(Number(params.tile)); if (!(tile >= 0 && tile < TOWER[r.mode].tiles)) throw new HttpError(400, 'bad_tile', 'Pick a tile');
  const floor = r.picks.length;
  if (r.layout[floor].includes(tile)) { const end = towerEnd(u, r, 0); return Object.assign({ boom: { floor, tile }, round: towerView(r, true), balance: u.coins }, end); }
  r.picks.push(tile); S.store.touch('users');
  if (r.picks.length === TOWER_FLOORS) return towerCashout(u);
  return { round: towerView(r, false), balance: u.coins };
}
function towerCashout(u) {
  const r = u.round && u.round.tower; if (!r) throw new HttpError(409, 'no_round', 'No Tower round in progress');
  if (!r.picks.length) throw new HttpError(400, 'no_picks', 'Climb at least one floor first');
  const payout = Math.floor(r.bet * towerMult(r.mode, r.picks.length)); const end = towerEnd(u, r, payout);
  return Object.assign({ cashed: true, round: towerView(r, true), balance: u.coins }, end);
}

const EXTRA_SINGLE = { baccarat: (u, p) => playBaccarat(u, p), crash: playCrash, plinko: playPlinko, horses: playHorses, wheel: playWheel, keno: playKeno, limbo: playLimbo, dragontiger: playDragonTiger, sicbo: playSicBo, craps: playCraps };

// ---- Mines: 5×5 grid. Bet is taken at the start; cash out any time after a safe pick. ----
const MINES_EDGE = 0.98;
function minesLayout(fl, count) { const cells = [...Array(25).keys()]; for (let i = 24; i > 0; i--) { const j = Math.floor(fl[24 - i] * (i + 1)); [cells[i], cells[j]] = [cells[j], cells[i]]; } return cells.slice(0, count).sort((a, b) => a - b); }
function minesMult(mines, safe) { let m = MINES_EDGE; for (let k = 0; k < safe; k++) m *= (25 - k) / (25 - mines - k); return Math.floor(m * 100) / 100; }
function minesView(r, reveal) { return { bet: r.bet, mines: r.mines, picks: r.picks, mult: r.picks.length ? minesMult(r.mines, r.picks.length) : 1, next: minesMult(r.mines, r.picks.length + 1), nonce: r.nonce, layout: reveal ? r.layout : undefined, over: !!reveal }; }
function minesStart(u, params) {
  if (u.round && u.round.mines) throw new HttpError(409, 'in_round', 'Finish your current Mines round first');
  const mines = Math.trunc(Number(params.mines));
  if (!Number.isInteger(mines) || mines < 1 || mines > 24) throw new HttpError(400, 'bad_mines', 'Pick 1 to 24 mines');
  const bet = checkBet(u, params.bet);
  const { fl, nonce } = nextFloats(u, 24);
  if (!econ.adjust(u, -bet, 'casino:mines')) throw new HttpError(402, 'no_funds', 'Not enough coins');
  u.round = Object.assign(u.round || {}, { mines: { bet, mines, layout: minesLayout(fl, mines), picks: [], nonce, t: now() } });
  S.store.touch('users');
  return { round: minesView(u.round.mines, false), balance: u.coins };
}
function minesEnd(u, r, payout) {
  delete u.round.mines;
  if (payout > 0) econ.adjust(u, payout, 'casino:mines');
  const mult = payout / r.bet; const net = record(u, r.bet, payout, mult);
  return { payout, net, mult };
}
function minesPick(u, params) {
  const r = u.round && u.round.mines; if (!r) throw new HttpError(409, 'no_round', 'Start a Mines round first');
  const cell = Math.trunc(Number(params.cell));
  if (!Number.isInteger(cell) || cell < 0 || cell > 24) throw new HttpError(400, 'bad_cell', 'Pick a tile');
  if (r.picks.includes(cell)) throw new HttpError(409, 'picked', 'Already revealed');
  if (r.layout.includes(cell)) { const end = minesEnd(u, r, 0); return Object.assign({ boom: cell, round: minesView(r, true), balance: u.coins }, end); }
  r.picks.push(cell); S.store.touch('users');
  if (r.picks.length === 25 - r.mines) return minesCashout(u);
  return { round: minesView(r, false), balance: u.coins };
}
function minesCashout(u) {
  const r = u.round && u.round.mines; if (!r) throw new HttpError(409, 'no_round', 'No Mines round in progress');
  if (!r.picks.length) throw new HttpError(400, 'no_picks', 'Reveal at least one tile first');
  const payout = Math.floor(r.bet * minesMult(r.mines, r.picks.length));
  const end = minesEnd(u, r, payout);
  return Object.assign({ cashed: true, round: minesView(r, true), balance: u.coins }, end);
}

// ---- Blackjack: infinite-deck shoe from the seed (card i = floor(f_i · 52)). Dealer stands on all 17s, blackjack pays 3:2. ----
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']; const SUITS = ['♠', '♥', '♦', '♣'];
const cardOf = (f) => { const n = Math.floor(f * 52); return { r: RANKS[n % 13], s: SUITS[Math.floor(n / 13)] }; };
function handValue(cards) { let v = 0, aces = 0; for (const c of cards) { if (c.r === 'A') { v += 11; aces++; } else v += ['J', 'Q', 'K'].includes(c.r) ? 10 : Number(c.r); } while (v > 21 && aces) { v -= 10; aces--; } return { v, soft: aces > 0 }; }
const isBJ = (cards) => cards.length === 2 && handValue(cards).v === 21;
function bjDraw(r) { const c = cardOf(r.shoe[r.i++]); return c; }
function bjView(r, done) { return { bet: r.bet, player: r.player, dealer: done ? r.dealer : [r.dealer[0]], pv: handValue(r.player).v, dv: done ? handValue(r.dealer).v : handValue([r.dealer[0]]).v, doubled: !!r.doubled, nonce: r.nonce, canDouble: !done && r.player.length === 2 && !r.doubled, over: !!done }; }
function bjStart(u, params) {
  if (u.round && u.round.bj) throw new HttpError(409, 'in_round', 'Finish your current hand first');
  const bet = checkBet(u, params.bet);
  const { fl, nonce } = nextFloats(u, 48);
  if (!econ.adjust(u, -bet, 'casino:blackjack')) throw new HttpError(402, 'no_funds', 'Not enough coins');
  const r = { bet, shoe: fl, i: 0, player: [], dealer: [], nonce, t: now() };
  r.player.push(bjDraw(r)); r.dealer.push(bjDraw(r)); r.player.push(bjDraw(r)); r.dealer.push(bjDraw(r));
  u.round = Object.assign(u.round || {}, { bj: r }); S.store.touch('users');
  if (isBJ(r.player) || isBJ(r.dealer)) return bjFinish(u, r);
  return { round: bjView(r, false), balance: u.coins };
}
function bjFinish(u, r) {
  const pv = handValue(r.player).v;
  if (pv <= 21 && !isBJ(r.player)) while (handValue(r.dealer).v < 17) r.dealer.push(bjDraw(r));
  const dv = handValue(r.dealer).v; const stake = r.bet * (r.doubled ? 2 : 1);
  let outcome, payout;
  if (isBJ(r.player) && isBJ(r.dealer)) { outcome = 'push'; payout = stake; }
  else if (isBJ(r.player)) { outcome = 'blackjack'; payout = Math.floor(stake * 2.5); }
  else if (isBJ(r.dealer)) { outcome = 'lose'; payout = 0; }
  else if (pv > 21) { outcome = 'bust'; payout = 0; }
  else if (dv > 21 || pv > dv) { outcome = 'win'; payout = stake * 2; }
  else if (pv === dv) { outcome = 'push'; payout = stake; }
  else { outcome = 'lose'; payout = 0; }
  delete u.round.bj;
  if (payout > 0) econ.adjust(u, payout, 'casino:blackjack');
  const net = record(u, stake, payout, payout / stake);
  return { round: bjView(r, true), outcome, payout, net, balance: u.coins };
}
function bjAction(u, action) {
  const r = u.round && u.round.bj; if (!r) throw new HttpError(409, 'no_round', 'Deal a hand first');
  if (action === 'hit') { r.player.push(bjDraw(r)); S.store.touch('users'); if (handValue(r.player).v >= 21) return bjFinish(u, r); return { round: bjView(r, false), balance: u.coins }; }
  if (action === 'stand') return bjFinish(u, r);
  if (action === 'double') {
    if (r.player.length !== 2 || r.doubled) throw new HttpError(400, 'no_double', 'You can only double on your first two cards');
    if (!econ.adjust(u, -r.bet, 'casino:blackjack')) throw new HttpError(402, 'no_funds', 'Not enough coins to double');
    r.doubled = true; r.player.push(bjDraw(r)); return bjFinish(u, r);
  }
  throw new HttpError(400, 'bad_action', 'Hit, stand or double');
}


// ================= 13.7: Baccarat, Video Poker (Jacks or Better) and Hi-Lo =================
// ---- Baccarat: infinite-deck shoe from the seed, standard third-card rules. Player 2×, Banker 1.95×, Tie 9× (Player/Banker bets push on a tie). ----
const bacVal = (c) => (c.r === 'A' ? 1 : ['10', 'J', 'Q', 'K'].includes(c.r) ? 0 : Number(c.r));
const bacTotal = (cards) => cards.reduce((a, c) => a + bacVal(c), 0) % 10;
function baccaratDeal(fl) {
  let i = 0; const draw = () => cardOf(fl[i++]);
  const P = [draw(), draw()]; const B = [draw(), draw()]; let p = bacTotal(P), b = bacTotal(B);
  if (p < 8 && b < 8) {
    let p3 = null; if (p <= 5) { p3 = draw(); P.push(p3); }
    const v = p3 ? bacVal(p3) : null;
    const bankerDraws = p3 === null ? b <= 5 : b <= 2 || (b === 3 && v !== 8) || (b === 4 && v >= 2 && v <= 7) || (b === 5 && v >= 4 && v <= 7) || (b === 6 && (v === 6 || v === 7));
    if (bankerDraws) B.push(draw()); p = bacTotal(P); b = bacTotal(B);
  }
  return { player: P, banker: B, p, b, win: p > b ? 'player' : b > p ? 'banker' : 'tie' };
}
const BAC_PAY = { player: 2, banker: 1.95, tie: 9 };
function playBaccarat(u, params) {
  const side = String(params.side || ''); if (!BAC_PAY[side]) throw new HttpError(400, 'bad_side', 'Bet on Player, Banker or Tie');
  const bet = checkBet(u, params.bet, { gap: 400 });
  const { fl, nonce } = nextFloats(u, 6); const r = baccaratDeal(fl);
  const mult = r.win === side ? BAC_PAY[side] : r.win === 'tie' ? 1 : 0; const payout = Math.floor(bet * mult);
  econ.adjust(u, payout - bet, 'casino:baccarat'); const net = record(u, bet, payout, mult); bigWin(u, 'baccarat', bet, mult, payout);
  return { game: 'baccarat', bet, mult, payout, net, result: Object.assign({ side }, r), nonce, balance: u.coins };
}

// ---- Video Poker, Jacks or Better (9/6 table): a shuffled 52-card deck from the seed; deal 5, hold any, draw once. ----
const VP_PAY = [['royal', 800], ['sflush', 50], ['four', 25], ['full', 9], ['flush', 6], ['straight', 4], ['three', 3], ['twopair', 2], ['jacks', 1]];
const rankN = (r) => (r === 'A' ? 14 : r === 'K' ? 13 : r === 'Q' ? 12 : r === 'J' ? 11 : Number(r));
function vpHand(cards) {
  const ns = cards.map((c) => rankN(c.r)).sort((a, b) => a - b); const flush = cards.every((c) => c.s === cards[0].s);
  const uniq = [...new Set(ns)]; const wheel = uniq.length === 5 && ns.join() === '2,3,4,5,14'; const straight = uniq.length === 5 && (ns[4] - ns[0] === 4 || wheel);
  const counts = Object.values(ns.reduce((m, n) => ((m[n] = (m[n] || 0) + 1), m), {})).sort((a, b) => b - a);
  const pairHigh = Object.entries(ns.reduce((m, n) => ((m[n] = (m[n] || 0) + 1), m), {})).some(([n, k]) => k === 2 && Number(n) >= 11);
  if (straight && flush && ns[0] === 10) return 'royal'; if (straight && flush) return 'sflush'; if (counts[0] === 4) return 'four'; if (counts[0] === 3 && counts[1] === 2) return 'full';
  if (flush) return 'flush'; if (straight) return 'straight'; if (counts[0] === 3) return 'three'; if (counts[0] === 2 && counts[1] === 2) return 'twopair'; if (counts[0] === 2 && pairHigh) return 'jacks'; return null;
}
const vpMult = (hand) => (hand ? VP_PAY.find((x) => x[0] === hand)[1] : 0);
function deck52(fl) { const d = [...Array(52).keys()]; for (let i = 51; i > 0; i--) { const j = Math.floor(fl[51 - i] * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; } return d.map((n) => ({ r: RANKS[n % 13], s: SUITS[Math.floor(n / 13)] })); }
const vpView = (r, done) => ({ bet: r.bet, cards: r.cards, held: r.held || [], hand: vpHand(r.cards), nonce: r.nonce, done: !!done });
function vpDeal(u, params) {
  if (u.round && u.round.vp) throw new HttpError(409, 'in_round', 'Finish your current hand first');
  const bet = checkBet(u, params.bet); const { fl, nonce } = nextFloats(u, 51);
  if (!econ.adjust(u, -bet, 'casino:videopoker')) throw new HttpError(402, 'no_funds', 'Not enough coins');
  const deck = deck52(fl); u.round = Object.assign(u.round || {}, { vp: { bet, deck, cards: deck.slice(0, 5), nonce, t: now() } }); S.store.touch('users');
  return { round: vpView(u.round.vp, false), balance: u.coins };
}
function vpDraw(u, params) {
  const r = u.round && u.round.vp; if (!r) throw new HttpError(409, 'no_round', 'Deal a hand first');
  const held = [...new Set((Array.isArray(params.held) ? params.held : []).map((x) => Math.trunc(Number(x))).filter((x) => x >= 0 && x < 5))];
  let k = 5; r.cards = r.cards.map((c, i) => (held.includes(i) ? c : r.deck[k++])); r.held = held;
  const hand = vpHand(r.cards); const mult = vpMult(hand); const payout = Math.floor(r.bet * mult);
  delete u.round.vp; if (payout > 0) econ.adjust(u, payout, 'casino:videopoker'); const net = record(u, r.bet, payout, mult); bigWin(u, 'videopoker', r.bet, mult, payout);
  return { round: vpView(r, true), hand, mult, payout, net, balance: u.coins };
}

// ---- Hi-Lo: guess if the next card is higher-or-equal or lower-or-equal (A low … K high). Each right guess multiplies by 0.98 / chance. ----
const hlRank = (c) => (c.r === 'A' ? 1 : rankN(c.r));
const hlChance = (rank, dir) => (dir === 'hi' ? (14 - rank) / 13 : rank / 13);
const hlStep = (rank, dir) => Math.floor((0.98 / hlChance(rank, dir)) * 10000) / 10000;
const hlView = (r) => { const c = r.cards[r.cards.length - 1]; const rk = hlRank(c); return { bet: r.bet, cards: r.cards, mult: Math.floor(r.mult * 100) / 100, steps: r.steps, hi: rk === 13 ? null : hlStep(rk, 'hi'), lo: rk === 1 ? null : hlStep(rk, 'lo'), pHi: hlChance(rk, 'hi'), pLo: hlChance(rk, 'lo'), nonce: r.nonce }; };
function hlStart(u, params) {
  if (u.round && u.round.hl) throw new HttpError(409, 'in_round', 'Finish your current Hi-Lo round first');
  const bet = checkBet(u, params.bet); const { fl, nonce } = nextFloats(u, 60);
  if (!econ.adjust(u, -bet, 'casino:hilo')) throw new HttpError(402, 'no_funds', 'Not enough coins');
  u.round = Object.assign(u.round || {}, { hl: { bet, fl, i: 1, cards: [cardOf(fl[0])], mult: 1, steps: 0, skips: 0, nonce, t: now() } }); S.store.touch('users');
  return { round: hlView(u.round.hl), balance: u.coins };
}
function hlEnd(u, r, payout) { delete u.round.hl; if (payout > 0) econ.adjust(u, payout, 'casino:hilo'); const mult = payout / r.bet; const net = record(u, r.bet, payout, mult); bigWin(u, 'hilo', r.bet, mult, payout); return { payout, net, mult }; }
function hlGuess(u, params) {
  const r = u.round && u.round.hl; if (!r) throw new HttpError(409, 'no_round', 'Start a Hi-Lo round first');
  const dir = String(params.dir || ''); if (!['hi', 'lo', 'skip'].includes(dir)) throw new HttpError(400, 'bad_guess', 'Guess higher, lower or skip');
  if (r.i >= r.fl.length) return hlCashout(u);
  const prev = hlRank(r.cards[r.cards.length - 1]);
  if (dir === 'skip') { if (r.skips >= 3) throw new HttpError(400, 'no_skips', 'You can skip 3 cards per round'); r.skips++; r.cards.push(cardOf(r.fl[r.i++])); S.store.touch('users'); return { round: hlView(r), balance: u.coins }; }
  if ((dir === 'hi' && prev === 13) || (dir === 'lo' && prev === 1)) throw new HttpError(400, 'bad_guess', 'That guess cannot win');
  const c = cardOf(r.fl[r.i++]); const n = hlRank(c); r.cards.push(c);
  const ok = dir === 'hi' ? n >= prev : n <= prev;
  if (!ok) { const end = hlEnd(u, r, 0); return Object.assign({ lost: true, round: hlView(r), balance: u.coins }, end); }
  r.mult *= hlStep(prev, dir); r.steps++; S.store.touch('users');
  if (r.mult >= 10000) return hlCashout(u);
  return { round: hlView(r), balance: u.coins };
}
function hlCashout(u) {
  const r = u.round && u.round.hl; if (!r) throw new HttpError(409, 'no_round', 'No Hi-Lo round in progress');
  if (!r.steps) throw new HttpError(400, 'no_steps', 'Guess at least once first');
  const end = hlEnd(u, r, Math.floor(r.bet * Math.min(10000, r.mult))); return Object.assign({ cashed: true, round: hlView(r), balance: u.coins }, end);
}

function roundsOf(u) { const r = u.round || {}; return { mines: r.mines ? minesView(r.mines, false) : null, bj: r.bj ? bjView(r.bj, false) : null, vp: r.vp ? vpView(r.vp, false) : null, hl: r.hl ? hlView(r.hl) : null, tower: r.tower ? towerView(r.tower, false) : null }; }

// ---- Jackpot: shared pot. Everyone deposits; one ticket per coin; the winner is drawn from a committed seed. ----
const JP_WINDOW = 45000; const JP_SOLO_TIMEOUT = 10 * 60000; const JP_FEE = 0.02; const JP_MAX_DEPOSIT = 1_000_000_000_000_000;
function jpState() {
  const m = S.meta; if (!m.jackpot) m.jackpot = { round: null, history: [] };
  if (!m.jackpot.round) { const seed = crypto.randomBytes(32).toString('hex'); m.jackpot.round = { id: rid(6), seed, hash: sha256(seed), entries: [], opened: now(), endsAt: 0 }; S.store.touch('meta'); }
  return m.jackpot;
}
function jpPublic(viewer) {
  const j = jpState(); const r = j.round; const pot = r.entries.reduce((a, e) => a + e.amt, 0);
  const by = new Map(); for (const e of r.entries) by.set(e.uid, (by.get(e.uid) || 0) + e.amt);
  const players = [...by].map(([uid, amt]) => { const u = S.users[uid]; return { id: uid, name: u ? u.displayName || u.username : '?', avatar: u ? u.avatar || null : null, amt, chance: pot ? Math.round((amt / pot) * 10000) / 100 : 0 }; }).sort((a, b) => b.amt - a.amt);
  return { id: r.id, hash: r.hash, pot, players, endsAt: r.endsAt, fee: JP_FEE, mine: viewer ? by.get(viewer.id) || 0 : 0, history: j.history.slice(0, 10), max: JP_MAX_DEPOSIT };
}
function jpDeposit(u, params) {
  const amt = Math.trunc(Number(params.bet));
  if (!Number.isFinite(amt) || amt < 10) throw new HttpError(400, 'bad_bet', 'Minimum deposit is 10 coins');
  const j = jpState(); const r = j.round;
  const mine = r.entries.filter((e) => e.uid === u.id).reduce((a, e) => a + e.amt, 0);
  if (mine + amt > JP_MAX_DEPOSIT) throw new HttpError(400, 'bad_bet', 'Up to ' + JP_MAX_DEPOSIT + ' coins per player each round');
  if (amt > u.coins) throw new HttpError(402, 'no_funds', 'Not enough coins');
  rgCheck(u, amt);
  if (r.endsAt && r.endsAt - now() < 1500) throw new HttpError(409, 'closing', 'This round is closing — join the next one');
  if (!econ.adjust(u, -amt, 'casino:jackpot')) throw new HttpError(402, 'no_funds', 'Not enough coins');
  r.entries.push({ uid: u.id, amt, t: now() });
  if (!r.endsAt && new Set(r.entries.map((e) => e.uid)).size >= 2) r.endsAt = now() + JP_WINDOW;
  S.store.touch('meta'); S.store.touch('users');
  jpBroadcast();
  return { jackpot: jpPublic(u), balance: u.coins };
}
function jpBroadcast() { const r = jpState().round; const ids = [...new Set(r.entries.map((e) => e.uid))]; hub.pushMany(ids, { t: 'jackpot', id: r.id }); }
function jpSettle() {
  const j = jpState(); const r = j.round; const t = now();
  const uids = [...new Set(r.entries.map((e) => e.uid))];
  if (uids.length === 1 && t - r.opened > JP_SOLO_TIMEOUT && t - Math.max(...r.entries.map((e) => e.t)) > JP_SOLO_TIMEOUT) {
    // nobody joined: refund in full
    const u = S.users[uids[0]]; const amt = r.entries.reduce((a, e) => a + e.amt, 0);
    if (u) econ.adjust(u, amt, 'casino:jackpot-refund');
    j.history.unshift({ id: r.id, t, refunded: true, pot: amt, seed: r.seed, hash: r.hash }); j.round = null; S.store.touch('meta'); hub.pushMany(uids, { t: 'jackpot' }); return;
  }
  if (!r.endsAt || r.endsAt > t) return;
  const pot = r.entries.reduce((a, e) => a + e.amt, 0);
  const f = floatsFrom(r.seed, r.id, 0, 1)[0]; const ticket = Math.floor(f * pot);
  let acc = 0, winnerId = r.entries[0].uid; for (const e of r.entries) { acc += e.amt; if (ticket < acc) { winnerId = e.uid; break; } }
  const prize = Math.floor(pot * (1 - JP_FEE)); const w = S.users[winnerId];
  if (w) econ.adjust(w, prize, 'casino:jackpot-win');
  const stakes = new Map(); for (const e of r.entries) stakes.set(e.uid, (stakes.get(e.uid) || 0) + e.amt);
  for (const [uid, amt] of stakes) { const u = S.users[uid]; if (u) record(u, amt, uid === winnerId ? prize : 0, uid === winnerId ? prize / amt : 0); }
  j.history.unshift({ id: r.id, t, pot, prize, ticket, winner: winnerId, winnerName: w ? w.displayName || w.username : '?', chance: Math.round(((stakes.get(winnerId) || 0) / pot) * 10000) / 100, seed: r.seed, hash: r.hash, players: stakes.size });
  if (j.history.length > 30) j.history.length = 30;
  j.round = null; S.store.touch('meta'); S.store.touch('users');
  hub.pushMany(uids, { t: 'jackpot', settled: true });
}
let jpTimer = null;
function startJackpot() { if (jpTimer) return; jpState(); jpTimer = setInterval(() => { try { jpSettle(); } catch (e) { console.error('[jackpot]', e && e.message); } }, 1000); jpTimer.unref && jpTimer.unref(); }

const EXTRA_CFG = { tower: { modes: TOWER, floors: TOWER_FLOORS }, sicbo: SB_PAY, wheel: WHEEL, keno: KENO, limboMax: LIMBO_MAX, horses: HORSES, crashMax: CRASH_MAX, plinko: PLINKO, minesEdge: MINES_EDGE, jackpot: { fee: JP_FEE, window: JP_WINDOW, max: JP_MAX_DEPOSIT } };

module.exports = { towerStart, towerPick, towerCashout, towerMult, towerLayout, crapsRolls, sicboWins, SB_PAY, TOWER, vpDeal, vpDraw, vpHand, VP_PAY, hlStart, hlGuess, hlCashout, baccaratDeal, BAC_PAY, dailySpin, dailyState, WHEEL, KENO, kenoDraw, bigWin, HORSES, horseRace, minesStart, minesPick, minesCashout, bjStart, bjAction, roundsOf, jpPublic, jpDeposit, startJackpot, crashPoint, plinkoPath, minesLayout, minesMult, cardOf, handValue, EXTRA_CFG, PLINKO, play, setLimits, fairPublic, setClientSeed, rotate, leaderboard, floatsFrom, slotSymbol, slotsPayMult, rouletteWin, diceMult, SLOT_SYMBOLS, SLOT_PAY, COIN_MULT, TWO_CHERRY, MIN_BET, MAX_BET };
