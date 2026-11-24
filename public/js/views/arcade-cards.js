// Nebulix 3.0 — Solitaire (Klondike, draw 1 or 3) and Checkers against the computer (English draughts rules:
// captures are compulsory, multi-jumps continue, men become kings on the last row).
import { h, mount } from '../util.js';
import { t } from '../i18n.js';
import { sfx } from '../sfx.js';

export const CARD_GAMES = [
  ['solitaire', 'Solitaire', 'layers', 'Klondike: build the four suits from Ace to King.', 'pts'],
  ['checkers', 'Checkers', 'grid', 'Classic draughts against the computer. Captures are compulsory.', 'pts'],
];
const snd = (k) => { try { sfx[k] && sfx[k](); } catch {} };
function overlay(board) { const ov = h('div.arc-ov'); board.appendChild(ov); return { show: (title, big, sub, extra, btn, go) => { ov.classList.remove('hide'); mount(ov, h('div.arc-ovc', h('h3', title), big != null ? h('div.arc-big', String(big)) : null, sub ? h('p.muted', sub) : null, extra || null, h('button.btn.primary', { onClick: go }, btn))); }, hide: () => { mount(ov); ov.classList.add('hide'); } }; }
const pick = (opts, cur, set) => h('div.row', { style: 'gap:6px;justify-content:center;margin-bottom:10px' }, opts.map(([k, l]) => h('button.btn.sm' + (k === cur() ? '.primary' : ''), { onClick: (e) => { set(k); e.currentTarget.parentNode.querySelectorAll('.btn').forEach((x) => x.classList.toggle('primary', x === e.currentTarget)); } }, t(l))));

// ================= SOLITAIRE =================
const SUITS = ['♠', '♥', '♦', '♣']; const RED = (s) => s === '♥' || s === '♦'; const RANK = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
function solitaireGame(stage, hud, end, best, env) {
  const board = h('div.arc-board.so-board'); const top = h('div.so-top'); const tab = h('div.so-tab'); board.append(top, tab); stage.append(board); const o = overlay(board);
  let stock, waste, found, piles, sel = null, moves, score, t0, tick = 0, draw = 1, over = false, hist = [];
  const deal = () => { const deck = []; for (const s of SUITS) for (let r = 1; r <= 13; r++) deck.push({ s, r, up: false }); for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    piles = Array.from({ length: 7 }, (_, i) => { const p = deck.splice(0, i + 1); p[p.length - 1].up = true; return p; }); stock = deck; waste = []; found = [[], [], [], []]; };
  const snap = () => { hist.push(JSON.stringify({ stock, waste, found, piles, score, moves })); if (hist.length > 60) hist.shift(); };
  const paintHud = () => mount(hud, h('span.pill', t('Score: {s}', { s: score })), h('span.pill', t('Moves: {n}', { n: moves })), h('span.pill', '⏱ ' + Math.floor((performance.now() - t0) / 60000) + ':' + String(Math.floor((performance.now() - t0) / 1000) % 60).padStart(2, '0')), h('button.btn.sm', { disabled: !hist.length, onClick: undo }, '↶ ' + t('Undo')), h('button.btn.sm', { onClick: autoAll }, '⚡ ' + t('Auto')), h('span.pill', t('Best: {s}', { s: best })));
  function begin() { o.hide(); deal(); sel = null; moves = 0; score = 0; hist = []; over = false; t0 = performance.now(); clearInterval(tick); tick = setInterval(paintHud, 1000); paint(); paintHud(); }
  function undo() { if (!hist.length || over) return; const x = JSON.parse(hist.pop()); ({ stock, waste, found, piles, score, moves } = x); sel = null; paint(); paintHud(); }
  const canFound = (c, fi) => { const f = found[fi]; return f.length ? f[f.length - 1].s === c.s && f[f.length - 1].r === c.r - 1 : c.r === 1; };
  const canPile = (c, pi) => { const p = piles[pi]; if (!p.length) return c.r === 13; const tp = p[p.length - 1]; return tp.up && RED(tp.s) !== RED(c.s) && tp.r === c.r + 1; };
  function take(src) { // src: { from: 'waste' | 'pile' | 'found', i, k } → cards that would move
    if (src.from === 'waste') return waste.slice(-1); if (src.from === 'found') return found[src.i].slice(-1); return piles[src.i].slice(src.k);
  }
  function remove(src, n) { if (src.from === 'waste') waste.splice(-n); else if (src.from === 'found') found[src.i].splice(-n); else { piles[src.i].splice(-n); const p = piles[src.i]; if (p.length && !p[p.length - 1].up) { p[p.length - 1].up = true; score += 5; } } }
  function moveTo(src, dest) {
    const cards = take(src); if (!cards.length) return false; const c = cards[0];
    if (dest.to === 'found') { if (cards.length !== 1 || !canFound(c, dest.i)) return false; snap(); remove(src, 1); found[dest.i].push(c); score += src.from === 'found' ? 0 : 10; }
    else { if (dest.i === src.i && src.from === 'pile') return false; if (!canPile(c, dest.i)) return false; snap(); remove(src, cards.length); piles[dest.i].push(...cards); score += src.from === 'waste' ? 5 : src.from === 'found' ? -15 : 0; }
    moves++; snd('click'); sel = null; checkWin(); return true;
  }
  function autoFound(src) { const c = take(src)[0]; if (!c || take(src).length !== 1) return false; for (let fi = 0; fi < 4; fi++) if (canFound(c, fi)) return moveTo(src, { to: 'found', i: fi }); return false; }
  function autoAll() { let any = true; let n = 0; while (any && n++ < 60) { any = false; if (waste.length && autoFound({ from: 'waste' })) any = true; for (let i = 0; i < 7; i++) if (piles[i].length && autoFound({ from: 'pile', i, k: piles[i].length - 1 })) any = true; } paint(); paintHud(); }
  function drawCards() { if (over) return; snap(); if (!stock.length) { if (!waste.length) { hist.pop(); return; } stock = waste.reverse().map((c) => Object.assign(c, { up: false })); waste = []; score = Math.max(0, score - (draw === 1 ? 100 : 20)); } else { for (let i = 0; i < draw && stock.length; i++) { const c = stock.pop(); c.up = true; waste.push(c); } } moves++; sel = null; snd('click'); paint(); paintHud(); }
  function clickSrc(src) { if (over) return; if (sel) { const ok = src.from === 'pile' ? moveTo(sel, { to: 'pile', i: src.i }) : src.from === 'found' ? moveTo(sel, { to: 'found', i: src.i }) : false; if (ok || (sel.from === src.from && sel.i === src.i && sel.k === src.k)) { sel = null; paint(); paintHud(); return; } }
    sel = src.from === 'found' && !found[src.i].length ? null : src; paint(); }
  function checkWin() { if (found.every((f) => f.length === 13)) { over = true; clearInterval(tick); const ms = performance.now() - t0; const sc = Math.round(score + Math.max(0, 1500 - ms / 1000) + (draw === 3 ? 300 : 0)); snd('win'); paint(); setTimeout(() => o.show(t('You won!'), sc, t('{n} moves', { n: moves }), pick([[1, 'Draw 1'], [3, 'Draw 3']], () => draw, (v) => { draw = v; }), t('Play again'), begin), 500); end(sc, ms).then((r) => { if (r) best = r.best; }); } }
  const cardEl = (c, extra = {}) => (c.up ? h('div.so-card' + (RED(c.s) ? '.red' : '') + (extra.sel ? '.sel' : ''), extra.attrs || {}, h('span.so-tl', RANK[c.r], h('i', c.s)), h('span.so-mid', c.s), h('span.so-br', RANK[c.r], h('i', c.s))) : h('div.so-card.back', extra.attrs || {}));
  function paint() {
    const wtop = waste.slice(-Math.min(draw, waste.length));
    mount(top, h('div.so-slot', { onClick: drawCards, title: t('Draw') }, stock.length ? h('div.so-card.back', h('b.so-cnt', String(stock.length))) : h('div.so-empty', '↻')),
      h('div.so-slot.so-waste', wtop.length ? wtop.map((c, i) => h('div.so-fan', { style: { left: i * 18 + 'px' } }, cardEl(c, i === wtop.length - 1 ? { sel: sel && sel.from === 'waste', attrs: { onClick: () => clickSrc({ from: 'waste' }), onDblclick: () => { if (autoFound({ from: 'waste' })) { paint(); paintHud(); } } } } : {}))) : h('div.so-empty')),
      h('div.grow'), found.map((f, i) => h('div.so-slot', { onClick: () => clickSrc({ from: 'found', i }) }, f.length ? cardEl(f[f.length - 1], { sel: sel && sel.from === 'found' && sel.i === i }) : h('div.so-empty', SUITS[i]))));
    mount(tab, piles.map((p, i) => h('div.so-pile', { onClick: (e) => { if (e.target === e.currentTarget) clickSrc({ from: 'pile', i, k: p.length }); } }, p.length ? p.map((c, k) => h('div.so-st', { style: { top: (p.slice(0, k).reduce((a, x) => a + (x.up ? 26 : 10), 0)) + 'px' } }, cardEl(c, { sel: sel && sel.from === 'pile' && sel.i === i && k >= sel.k, attrs: c.up ? { onClick: (e) => { e.stopPropagation(); clickSrc({ from: 'pile', i, k }); }, onDblclick: () => { if (k === p.length - 1 && autoFound({ from: 'pile', i, k })) { paint(); paintHud(); } } } : {} }))) : h('div.so-empty', { onClick: () => clickSrc({ from: 'pile', i, k: 0 }) }, 'K'))));
  }
  void env; deal(); moves = 0; score = 0; t0 = performance.now(); paint();
  o.show(t('Solitaire'), null, t('Click a card and then where it goes. Double-click sends a card to the top piles. Click the deck to draw.'), pick([[1, 'Draw 1'], [3, 'Draw 3']], () => draw, (v) => { draw = v; }), t('Start'), begin);
  return () => clearInterval(tick);
}

// ================= CHECKERS =================
// board: 32-free 8x8 array; 'w','W' (you, moving up), 'b','B' (CPU, moving down)
function ckStart() { const b = Array(64).fill(null); for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if ((r + c) % 2) { if (r < 3) b[r * 8 + c] = 'b'; else if (r > 4) b[r * 8 + c] = 'w'; } return b; }
const own = (p, side) => p && p.toLowerCase() === side;
function ckJumps(b, i, side, path = [i], caps = [], out = []) {
  const p = b[i]; const r = i >> 3, c = i & 7; const king = p === p.toUpperCase(); const dirs = king ? [-1, 1] : side === 'w' ? [-1] : [1]; let found = false;
  for (const dr of dirs) for (const dc of [-1, 1]) { const mr = r + dr, mc = c + dc, tr = r + 2 * dr, tc = c + 2 * dc; if (tr < 0 || tr > 7 || tc < 0 || tc > 7) continue; const m = mr * 8 + mc, tI = tr * 8 + tc;
    if (b[m] && !own(b[m], side) && !b[tI] && !caps.includes(m)) { found = true; const nb = b.slice(); nb[tI] = p; nb[i] = null; const crown = !king && ((side === 'w' && tr === 0) || (side === 'b' && tr === 7));
      if (crown) out.push({ path: [...path, tI], caps: [...caps, m] }); else ckJumps(nb, tI, side, [...path, tI], [...caps, m], out); } }
  if (!found && caps.length) out.push({ path, caps }); return out;
}
function ckMoves(b, side) {
  const jumps = []; const steps = [];
  for (let i = 0; i < 64; i++) { if (!own(b[i], side)) continue; jumps.push(...ckJumps(b, i, side)); const r = i >> 3, c = i & 7; const king = b[i] === b[i].toUpperCase(); for (const dr of king ? [-1, 1] : side === 'w' ? [-1] : [1]) for (const dc of [-1, 1]) { const tr = r + dr, tc = c + dc; if (tr >= 0 && tr < 8 && tc >= 0 && tc < 8 && !b[tr * 8 + tc]) steps.push({ path: [i, tr * 8 + tc], caps: [] }); } }
  return jumps.length ? jumps : steps;
}
function ckApply(b, m) { const nb = b.slice(); const from = m.path[0], to = m.path[m.path.length - 1]; let p = nb[from]; nb[from] = null; for (const x of m.caps) nb[x] = null; if (p === 'w' && to >> 3 === 0) p = 'W'; if (p === 'b' && to >> 3 === 7) p = 'B'; nb[to] = p; return nb; }
function ckEval(b) { let v = 0; for (let i = 0; i < 64; i++) { const p = b[i]; if (!p) continue; const s = p.toLowerCase() === 'b' ? 1 : -1; v += s * (p === p.toUpperCase() ? 175 : 100 + (p === 'b' ? (i >> 3) * 4 : (7 - (i >> 3)) * 4)); } return v; }
function ckSearch(b, d, side, a, bb) { const ms = ckMoves(b, side); if (!ms.length) return side === 'b' ? -10000 - d : 10000 + d; if (!d) return ckEval(b);
  if (side === 'b') { let v = -Infinity; for (const m of ms) { v = Math.max(v, ckSearch(ckApply(b, m), d - 1, 'w', a, bb)); a = Math.max(a, v); if (a >= bb) break; } return v; }
  let v = Infinity; for (const m of ms) { v = Math.min(v, ckSearch(ckApply(b, m), d - 1, 'b', a, bb)); bb = Math.min(bb, v); if (a >= bb) break; } return v; }
function checkersGame(stage, hud, end, best, env) {
  const board = h('div.arc-board.ck-board'); const grid = h('div.ck-grid'); board.append(grid); stage.append(board); const o = overlay(board);
  let b, sel = -1, legal = [], turn = 'w', level = 'medium', over = true, t0 = 0, last = null, plies = 0, quiet = 0;
  const paintHud = () => { const n = (s) => b.filter((p) => own(p, s)).length; mount(hud, h('span.pill', turn === 'w' ? t('Your move') : t('Computer is thinking…')), h('span.pill', '⚪ ' + n('w') + ' · ⚫ ' + n('b')), h('span.pill', t('Best: {s}', { s: best }))); };
  function begin() { o.hide(); b = ckStart(); sel = -1; turn = 'w'; over = false; t0 = performance.now(); last = null; plies = 0; quiet = 0; legal = ckMoves(b, 'w'); paint(); paintHud(); }
  function finish(res) { over = true; const ms = performance.now() - t0; const base = { easy: 250, medium: 550, hard: 900 }[level]; const sc = res === 'win' ? Math.max(base / 2, base - plies * 3) : res === 'draw' ? Math.round(base / 5) : 0; snd(res === 'win' ? 'win' : res === 'draw' ? 'coin' : 'lose');
    setTimeout(() => o.show(res === 'win' ? t('You win!') : res === 'draw' ? t('Draw') : t('The computer wins'), sc ? Math.round(sc) : null, null, pick([['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']], () => level, (v) => { level = v; }), t('Play again'), begin), 500);
    if (sc > 0) end(Math.round(sc), ms).then((r) => { if (r) best = r.best; }); }
  function play(m) { last = m; quiet = m.caps.length || b[m.path[0]].toLowerCase() === b[m.path[0]] ? 0 : quiet + 1; b = ckApply(b, m); plies++; sel = -1; snd(m.caps.length ? 'coin' : 'click'); turn = turn === 'w' ? 'b' : 'w'; legal = ckMoves(b, turn); paint(); paintHud();
    if (!legal.length) return finish(turn === 'w' ? 'lose' : 'win'); if (quiet >= 60) return finish('draw');
    if (turn === 'b') setTimeout(() => { const ms = legal; const d = { easy: 1, medium: 4, hard: 6 }[level]; let bestM = ms[0], bv = -Infinity; for (const x of ms) { let v = ckSearch(ckApply(b, x), d - 1, 'w', -Infinity, Infinity); if (level === 'easy') v += Math.random() * 80; if (v > bv) { bv = v; bestM = x; } } play(bestM); }, 350); }
  function click(i) { if (over || turn !== 'w') return; const m = legal.filter((x) => x.path[0] === sel && x.path[x.path.length - 1] === i); if (sel >= 0 && m.length) return play(m.sort((a, b2) => b2.caps.length - a.caps.length)[0]); sel = legal.some((x) => x.path[0] === i) ? i : -1; paint(); }
  function paint() {
    const targets = new Set(legal.filter((x) => x.path[0] === sel).map((x) => x.path[x.path.length - 1])); const movable = new Set(legal.map((x) => x.path[0]));
    mount(grid, Array.from({ length: 64 }, (_, i) => { const dark = ((i >> 3) + (i & 7)) % 2; const p = b[i];
      return h('button.ck-sq' + (dark ? '.dk' : '.lt') + (i === sel ? '.sel' : '') + (last && last.path.includes(i) ? '.last' : '') + (targets.has(i) ? '.tgt' : ''), { type: 'button', onClick: () => click(i), disabled: !dark },
        p ? h('span.ck-pc.' + (p.toLowerCase() === 'w' ? 'w' : 'b') + (p === p.toUpperCase() ? '.king' : '') + (turn === 'w' && movable.has(i) && !over ? '.can' : ''), p === p.toUpperCase() ? '♛' : '') : null); }));
  }
  void env; b = ckStart(); paint();
  o.show(t('Checkers'), null, t('You play white and move up the board. Captures are compulsory and jumps continue while possible. Reach the far row to crown a king.'), pick([['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']], () => level, (v) => { level = v; }), t('Start'), begin);
  return () => { over = true; };
}
export const CARD_FNS = { solitaire: solitaireGame, checkers: checkersGame };
