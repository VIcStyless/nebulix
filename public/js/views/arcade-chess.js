// Nebulix 3.0 — Chess against the computer. Full rules: castling, en passant, promotion (choose the piece), check,
// checkmate, stalemate, threefold repetition, the 50-move rule and insufficient material. The CPU searches with
// alpha-beta on material + piece-square tables (Easy = 1 ply with noise, Medium = 2, Hard = 3 plies + quiescence).
import { h, mount } from '../util.js';
import { t } from '../i18n.js';
import { sfx } from '../sfx.js';

export const CHESS_GAMES = [['chess', 'Chess', 'grid', 'Play chess against the computer at three levels.', 'pts']];
const snd = (k) => { try { sfx[k] && sfx[k](); } catch {} };
const GLYPH = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙', k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
// piece-square tables (white's view, a8 = index 0)
const PST = {
  p: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
  n: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
  b: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
  r: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
  q: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
  k: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
};
const isW = (p) => p && p === p.toUpperCase(); const side = (p) => (p ? (isW(p) ? 'w' : 'b') : null);
const rc = (i) => [i >> 3, i & 7]; const idx = (r, c) => r * 8 + c; const on = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
const sq = (i) => 'abcdefgh'[i & 7] + (8 - (i >> 3));

function start() { const b = Array(64).fill(null); 'rnbqkbnr'.split('').forEach((p, c) => { b[c] = p; b[56 + c] = p.toUpperCase(); b[8 + c] = 'p'; b[48 + c] = 'P'; }); return { b, turn: 'w', castle: { K: true, Q: true, k: true, q: true }, ep: -1, half: 0, full: 1 }; }
function attacked(s, i, by) {
  const b = s.b; const [r, c] = rc(i); const W = by === 'w';
  const pr = W ? r + 1 : r - 1; for (const dc of [-1, 1]) if (on(pr, c + dc) && b[idx(pr, c + dc)] === (W ? 'P' : 'p')) return true;
  for (const [dr, dc] of [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]) if (on(r + dr, c + dc) && b[idx(r + dr, c + dc)] === (W ? 'N' : 'n')) return true;
  for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) { if (on(r + dr, c + dc) && b[idx(r + dr, c + dc)] === (W ? 'K' : 'k')) return true; }
  for (const [dr, dc, ps] of [[1, 0, 'RQ'], [-1, 0, 'RQ'], [0, 1, 'RQ'], [0, -1, 'RQ'], [1, 1, 'BQ'], [1, -1, 'BQ'], [-1, 1, 'BQ'], [-1, -1, 'BQ']]) {
    let rr = r + dr, cc = c + dc; while (on(rr, cc)) { const p = b[idx(rr, cc)]; if (p) { if (side(p) === by && ps.includes(p.toUpperCase())) return true; break; } rr += dr; cc += dc; }
  }
  return false;
}
const kingAt = (s, col) => s.b.indexOf(col === 'w' ? 'K' : 'k');
const inCheck = (s, col) => attacked(s, kingAt(s, col), col === 'w' ? 'b' : 'w');
function pseudo(s) {
  const out = []; const b = s.b; const me = s.turn; const W = me === 'w';
  for (let i = 0; i < 64; i++) {
    const p = b[i]; if (!p || side(p) !== me) continue; const [r, c] = rc(i); const k = p.toLowerCase();
    const add = (j, extra) => out.push(Object.assign({ from: i, to: j, piece: p, cap: b[j] }, extra || {}));
    if (k === 'p') {
      const dir = W ? -1 : 1; const r1 = r + dir; const last = W ? 0 : 7;
      const push = (j, extra) => { if ((j >> 3) === last) for (const pr of 'qrbn') add(j, Object.assign({ promo: W ? pr.toUpperCase() : pr }, extra)); else add(j, extra); };
      if (on(r1, c) && !b[idx(r1, c)]) { push(idx(r1, c)); const r2 = r + 2 * dir; if ((W ? r === 6 : r === 1) && !b[idx(r2, c)]) add(idx(r2, c), { dbl: true }); }
      for (const dc of [-1, 1]) { if (!on(r1, c + dc)) continue; const j = idx(r1, c + dc); if (b[j] && side(b[j]) !== me) push(j); else if (j === s.ep) add(j, { epCap: idx(r, c + dc), cap: W ? 'p' : 'P' }); }
    } else if (k === 'n' || k === 'k') {
      const D = k === 'n' ? [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]] : [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
      for (const [dr, dc] of D) if (on(r + dr, c + dc)) { const j = idx(r + dr, c + dc); if (!b[j] || side(b[j]) !== me) add(j); }
      if (k === 'k') { const opp = W ? 'b' : 'w'; const row = W ? 7 : 0;
        if (i === idx(row, 4) && !attacked(s, i, opp)) {
          if (s.castle[W ? 'K' : 'k'] && !b[idx(row, 5)] && !b[idx(row, 6)] && b[idx(row, 7)] === (W ? 'R' : 'r') && !attacked(s, idx(row, 5), opp) && !attacked(s, idx(row, 6), opp)) add(idx(row, 6), { castle: 'K' });
          if (s.castle[W ? 'Q' : 'q'] && !b[idx(row, 3)] && !b[idx(row, 2)] && !b[idx(row, 1)] && b[idx(row, 0)] === (W ? 'R' : 'r') && !attacked(s, idx(row, 3), opp) && !attacked(s, idx(row, 2), opp)) add(idx(row, 2), { castle: 'Q' });
        } }
    } else {
      const D = k === 'r' ? [[1, 0], [-1, 0], [0, 1], [0, -1]] : k === 'b' ? [[1, 1], [1, -1], [-1, 1], [-1, -1]] : [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
      for (const [dr, dc] of D) { let rr = r + dr, cc = c + dc; while (on(rr, cc)) { const j = idx(rr, cc); if (b[j]) { if (side(b[j]) !== me) add(j); break; } add(j); rr += dr; cc += dc; } }
    }
  }
  return out;
}
function make(s, m) {
  const n = { b: s.b.slice(), turn: s.turn === 'w' ? 'b' : 'w', castle: Object.assign({}, s.castle), ep: -1, half: s.half + 1, full: s.full + (s.turn === 'b' ? 1 : 0) };
  const b = n.b; b[m.to] = m.promo || m.piece; b[m.from] = null; if (m.epCap !== undefined) b[m.epCap] = null;
  if (m.piece.toLowerCase() === 'p' || m.cap) n.half = 0; if (m.dbl) n.ep = (m.from + m.to) / 2;
  if (m.castle) { const row = m.from >> 3; if (m.castle === 'K') { b[idx(row, 5)] = b[idx(row, 7)]; b[idx(row, 7)] = null; } else { b[idx(row, 3)] = b[idx(row, 0)]; b[idx(row, 0)] = null; } }
  if (m.piece === 'K') n.castle.K = n.castle.Q = false; if (m.piece === 'k') n.castle.k = n.castle.q = false;
  for (const [i, k] of [[63, 'K'], [56, 'Q'], [7, 'k'], [0, 'q']]) if (m.from === i || m.to === i) n.castle[k] = false;
  return n;
}
const legal = (s) => pseudo(s).filter((m) => !inCheck(make(s, m), s.turn));
const key = (s) => s.b.map((p) => p || '.').join('') + s.turn + Object.entries(s.castle).filter((x) => x[1]).map((x) => x[0]).join('') + s.ep;
function evaluate(s) { let v = 0; for (let i = 0; i < 64; i++) { const p = s.b[i]; if (!p) continue; const k = p.toLowerCase(); const w = isW(p); v += (w ? 1 : -1) * (VAL[k] + PST[k][w ? i : (7 - (i >> 3)) * 8 + (i & 7)]); } return s.turn === 'w' ? v : -v; }
const order = (ms) => ms.sort((a, b) => ((b.cap ? VAL[b.cap.toLowerCase()] * 10 - VAL[b.piece.toLowerCase()] : 0) + (b.promo ? 800 : 0)) - ((a.cap ? VAL[a.cap.toLowerCase()] * 10 - VAL[a.piece.toLowerCase()] : 0) + (a.promo ? 800 : 0)));
let nodes = 0;
function quiesce(s, a, b, d) { nodes++; const sp = evaluate(s); if (sp >= b) return b; if (sp > a) a = sp; if (d <= 0) return a; for (const m of order(legal(s).filter((x) => x.cap || x.promo))) { const v = -quiesce(make(s, m), -b, -a, d - 1); if (v >= b) return b; if (v > a) a = v; } return a; }
function search(s, depth, a, b, q) {
  nodes++; if (nodes > 120000) return evaluate(s); const ms = legal(s);
  if (!ms.length) return inCheck(s, s.turn) ? -100000 - depth : 0; if (depth === 0) return q ? quiesce(s, a, b, 4) : evaluate(s);
  for (const m of order(ms)) { const v = -search(make(s, m), depth - 1, -b, -a, q); if (v >= b) return b; if (v > a) a = v; } return a;
}
function bestMove(s, level) {
  const ms = order(legal(s)); if (!ms.length) return null; nodes = 0; const depth = { easy: 1, medium: 2, hard: 3 }[level]; let best = null, bv = -Infinity;
  for (const m of ms) { let v = -search(make(s, m), depth - 1, -Infinity, -bv, level === 'hard'); if (level === 'easy') v += Math.random() * 120 - 60; if (v > bv) { bv = v; best = m; } }
  return best;
}

function chessGame(stage, hud, end, best, env) {
  const board = h('div.arc-board.ch-board'); const grid = h('div.ch-grid'); const side_ = h('div.ch-side'); board.append(h('div.ch-wrap', grid, side_)); stage.append(board);
  const ov = h('div.arc-ov'); board.append(ov);
  let s, sel = -1, moves = [], hist = [], seen = new Map(), over = false, level = 'medium', last = null, t0 = 0, thinking = false, flip = false;
  const show = (title, big, sub, btn, go) => { ov.classList.remove('hide'); mount(ov, h('div.arc-ovc', h('h3', title), big != null ? h('div.arc-big', String(big)) : null, sub ? h('p.muted', sub) : null, lvPick(), h('button.btn.primary', { onClick: go }, btn))); };
  const lvPick = () => h('div.row', { style: 'gap:6px;justify-content:center;margin-bottom:10px' }, [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']].map(([k, l]) => h('button.btn.sm' + (k === level ? '.primary' : ''), { onClick: (e) => { level = k; e.currentTarget.parentNode.querySelectorAll('.btn').forEach((x) => x.classList.toggle('primary', x === e.currentTarget)); } }, t(l))));
  const paintHud = () => mount(hud, h('span.pill', s.turn === 'w' ? t('Your move (white)') : t('Computer is thinking…')), h('span.pill', t('Level: {l}', { l: t(level === 'easy' ? 'Easy' : level === 'medium' ? 'Medium' : 'Hard') })), h('span.pill', t('Best: {s}', { s: best })));
  function begin() { ov.classList.add('hide'); mount(ov); s = start(); sel = -1; moves = []; hist = []; seen = new Map(); over = false; last = null; t0 = performance.now(); paint(); paintHud(); }
  function status() {
    const ms = legal(s); const k = key(s); if (!ms.length) return inCheck(s, s.turn) ? (s.turn === 'w' ? 'lose' : 'win') : 'draw';
    if (s.half >= 100 || (seen.get(k) || 0) >= 3) return 'draw';
    const pcs = s.b.filter(Boolean).map((p) => p.toLowerCase()).sort().join(''); if (['kk', 'bkk', 'kkn'].includes(pcs)) return 'draw'; return null;
  }
  function finish(res) {
    over = true; const ms = performance.now() - t0; const lvB = { easy: 300, medium: 650, hard: 1000 }[level]; const sc = res === 'win' ? Math.max(lvB / 2, lvB - s.full * 4) : res === 'draw' ? Math.round(lvB / 5) : 0;
    snd(res === 'win' ? 'win' : res === 'lose' ? 'lose' : 'coin');
    setTimeout(() => show(res === 'win' ? t('Checkmate — you win!') : res === 'lose' ? t('Checkmate — the computer wins') : t('Draw'), sc || null, t('{n} moves', { n: s.full }), t('Play again'), begin), 600);
    if (sc > 0) end(Math.round(sc), ms).then((r) => { if (r) best = r.best; });
  }
  function doMove(m) {
    hist.push({ s, m }); s = make(s, m); last = m; sel = -1; moves = []; const k = key(s); seen.set(k, (seen.get(k) || 0) + 1);
    snd(m.cap ? 'coin' : 'click'); paint(); paintHud(); const st = status(); if (st) return finish(st);
    if (s.turn === 'b') { thinking = true; setTimeout(() => { const cm = bestMove(s, level); thinking = false; if (cm) doMove(cm); }, 250); }
  }
  async function choosePromo(cands) { return new Promise((res) => { ov.classList.remove('hide'); mount(ov, h('div.arc-ovc', h('h3', t('Promote to')), h('div.row', { style: 'gap:8px;justify-content:center' }, cands.map((m) => h('button.ch-promo', { onClick: () => { ov.classList.add('hide'); mount(ov); res(m); } }, GLYPH[m.promo]))))); }); }
  async function click(i) {
    if (over || thinking || s.turn !== 'w') return;
    const cands = moves.filter((m) => m.to === i);
    if (cands.length) { const m = cands.length > 1 ? await choosePromo(cands) : cands[0]; doMove(m); return; }
    if (s.b[i] && side(s.b[i]) === 'w') { sel = i; moves = legal(s).filter((m) => m.from === i); } else { sel = -1; moves = []; }
    paint();
  }
  function paint() {
    const chk = inCheck(s, s.turn) ? kingAt(s, s.turn) : -1; const order_ = [...Array(64).keys()]; if (flip) order_.reverse();
    mount(grid, order_.map((i) => { const [r, c] = rc(i); const p = s.b[i]; const tgt = moves.find((m) => m.to === i);
      return h('button.ch-sq' + ((r + c) % 2 ? '.dk' : '.lt') + (i === sel ? '.sel' : '') + (last && (i === last.from || i === last.to) ? '.last' : '') + (i === chk ? '.check' : ''), { type: 'button', onClick: () => click(i), 'aria-label': sq(i) + (p ? ' ' + p : '') },
        p ? h('span.ch-pc' + (isW(p) ? '.w' : '.b'), GLYPH[p]) : null, tgt ? h('i.ch-dot' + (tgt.cap ? '.cap' : '')) : null, c === (flip ? 7 : 0) ? h('small.ch-rk', String(8 - r)) : null, r === (flip ? 0 : 7) ? h('small.ch-fl', 'abcdefgh'[c]) : null); }));
    const capW = []; const capB = []; for (const x of hist) if (x.m.cap) (isW(x.m.cap) ? capW : capB).push(x.m.cap);
    const san = hist.map((x) => (x.m.castle ? (x.m.castle === 'K' ? 'O-O' : 'O-O-O') : (x.m.piece.toLowerCase() === 'p' ? '' : x.m.piece.toUpperCase()) + (x.m.cap ? 'x' : '') + sq(x.m.to) + (x.m.promo ? '=' + x.m.promo.toUpperCase() : '')));
    mount(side_, h('div.ch-caps', capB.map((p) => GLYPH[p]).join(' ') || ' '), h('ol.ch-moves', Array.from({ length: Math.ceil(san.length / 2) }, (_, k) => h('li', h('span', san[k * 2]), h('span', san[k * 2 + 1] || '')))), h('div.ch-caps', capW.map((p) => GLYPH[p]).join(' ') || ' '),
      h('div.row', { style: 'gap:6px;flex-wrap:wrap' }, h('button.btn.sm', { disabled: hist.length < 2 || thinking || over, onClick: () => { hist.pop(); const back = hist.pop(); s = back.s; last = hist.length ? hist[hist.length - 1].m : null; sel = -1; moves = []; paint(); paintHud(); } }, '↶ ' + t('Undo')), h('button.btn.sm', { onClick: () => { flip = !flip; paint(); } }, '⇅ ' + t('Flip')), h('button.btn.sm.ghost', { onClick: () => { if (!over) { over = true; show(t('You resigned'), null, null, t('Play again'), begin); } } }, '🏳 ' + t('Resign'))));
    const mv = side_.querySelector('.ch-moves'); if (mv) mv.scrollTop = mv.scrollHeight;
  }
  void env; s = start(); paint(); show(t('Chess'), null, t('You play white. Click a piece, then a highlighted square. Castling, en passant and promotion all work.'), t('Start'), begin);
  return () => { over = true; };
}
export const CHESS_FNS = { chess: chessGame };
