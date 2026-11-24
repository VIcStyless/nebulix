// Arcade, part 4 (Nebulix 3.0): Minesweeper, Sudoku, Space Rocks, Gem Match and Reflex.
// Same contract as the other arcade games: (stage, hud, end, best, env) → cleanup; end(score, ms) submits the run
// (the server checks every score for plausibility before it counts — see server/routes/arcade.js).
import { h, mount } from '../util.js';
import { t } from '../i18n.js';
import { sfx } from '../sfx.js';

export const PLUS_GAMES = [
  ['mines', 'Minesweeper', 'grid', 'Open every safe square. Numbers tell you how many mines touch it.', 'pts'],
  ['sudoku', 'Sudoku', 'grid', 'Fill the 9×9 grid so every row, column and box has 1-9.', 'pts'],
  ['rocks', 'Space Rocks', 'star', 'Fly, turn and blast the asteroids before they hit you.', 'pts'],
  ['gems', 'Gem Match', 'gem', 'Swap gems to make lines of three. 60 seconds of combos.', 'pts'],
  ['reflex', 'Reflex', 'zap', 'Click as soon as the screen turns green. Five rounds.', 'pts'],
];
const snd = (k) => { try { sfx[k] && sfx[k](); } catch {} };
const rnd = (a, b) => a + Math.random() * (b - a);
function overlay(board) {
  const ov = h('div.arc-ov'); board.appendChild(ov);
  return { show: (title, big, sub, btn, go, extra) => { ov.classList.remove('hide'); mount(ov, h('div.arc-ovc', h('h3', title), big !== null && big !== undefined ? h('div.arc-big', String(big)) : null, sub ? h('p.muted', sub) : null, extra || null, h('button.btn.primary', { onClick: go }, btn))); }, hide: () => { mount(ov); ov.classList.add('hide'); } };
}
const keys = (env, fn) => { const k = (e) => { if (!env.root.isConnected || !env.keysForMe(e) || e.ctrlKey || e.metaKey || e.altKey) return; fn(e, true); }; const u = (e) => fn(e, false); document.addEventListener('keydown', k); document.addEventListener('keyup', u); return () => { document.removeEventListener('keydown', k); document.removeEventListener('keyup', u); }; };
const fmtT = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');

// ================= MINESWEEPER =================
const MINE_LV = { easy: [9, 9, 10, 1], medium: [16, 16, 40, 2], hard: [16, 30, 99, 3] };
function minesGame(stage, hud, end, best, env) {
  const board = h('div.arc-board.ms-board'); const grid = h('div.ms-grid'); board.append(grid); stage.append(board); const o = overlay(board);
  let lv = 'easy', R, C, M, cells, opened, flags, over, t0, started, tick = 0, flagMode = false;
  const paintHud = () => { const sec = started ? (performance.now() - t0) / 1000 : 0; mount(hud, h('span.pill', '💣 ' + (M - flags)), h('span.pill', '⏱ ' + fmtT(sec)), h('button.btn.sm' + (flagMode ? '.primary' : ''), { onClick: () => { flagMode = !flagMode; paintHud(); } }, '🚩 ' + t('Flag mode')), h('span.pill', t('Best: {s}', { s: best }))); };
  function setup() { [R, C, M] = MINE_LV[lv]; cells = Array.from({ length: R * C }, () => ({ m: false, n: 0, o: false, f: false })); opened = 0; flags = 0; over = false; started = false; clearInterval(tick); grid.style.gridTemplateColumns = `repeat(${C}, var(--ms))`; board.style.setProperty('--ms', C > 16 ? '26px' : '32px'); paint(); paintHud(); }
  const nb = (i) => { const r = Math.floor(i / C), c = i % C; const out = []; for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { if (!dr && !dc) continue; const rr = r + dr, cc = c + dc; if (rr >= 0 && cc >= 0 && rr < R && cc < C) out.push(rr * C + cc); } return out; };
  function plant(safe) { const ban = new Set([safe, ...nb(safe)]); let k = 0; while (k < M) { const i = Math.floor(Math.random() * R * C); if (cells[i].m || ban.has(i)) continue; cells[i].m = true; k++; } cells.forEach((x, i) => { x.n = nb(i).filter((j) => cells[j].m).length; }); }
  function open(i) {
    if (over || cells[i].f) return; if (!started) { started = true; t0 = performance.now(); plant(i); tick = setInterval(paintHud, 500); }
    const x = cells[i]; if (x.o) { const f = nb(i).filter((j) => cells[j].f).length; if (f === x.n) nb(i).forEach((j) => { if (!cells[j].o && !cells[j].f) open(j); }); return; }
    if (x.m) { x.o = true; lose(); return; }
    const st = [i]; while (st.length) { const j = st.pop(); const y = cells[j]; if (y.o || y.f) continue; y.o = true; opened++; if (!y.n) nb(j).forEach((k) => { if (!cells[k].o) st.push(k); }); }
    snd('click'); paint(); if (opened === R * C - M) win();
  }
  function flag(i) { if (over || cells[i].o) return; cells[i].f = !cells[i].f; flags += cells[i].f ? 1 : -1; paint(); paintHud(); }
  function lose() { over = true; clearInterval(tick); cells.forEach((x) => { if (x.m) x.o = true; }); paint(); snd('lose'); board.classList.add('shake'); setTimeout(() => board.classList.remove('shake'), 500); o.show(t('Boom!'), null, t('You hit a mine.'), t('Play again'), () => { o.hide(); setup(); }, lvPick()); }
  function win() { over = true; clearInterval(tick); const ms = performance.now() - t0; const sc = Math.max(10, Math.round(MINE_LV[lv][3] * 1000 - ms / 1000 * (4 - MINE_LV[lv][3]))); snd('win'); o.show(t('Cleared!'), sc, t('Time: {t}', { t: fmtT(ms / 1000) }), t('Play again'), () => { o.hide(); setup(); }, lvPick()); end(sc, ms).then((r) => { if (r) best = r.best; }); }
  const NC = ['', '#60a5fa', '#4ade80', '#f87171', '#a78bfa', '#fb923c', '#22d3ee', '#f472b6', '#e5e7eb'];
  function paint() { mount(grid, cells.map((x, i) => h('button.ms-c' + (x.o ? '.o' : '') + (x.o && x.m ? '.boom' : ''), { type: 'button', style: x.o && x.n && !x.m ? `color:${NC[x.n]}` : null, onClick: () => (flagMode ? flag(i) : open(i)), onContextmenu: (e) => { e.preventDefault(); flag(i); } }, x.o ? (x.m ? '💣' : x.n || '') : x.f ? '🚩' : ''))); }
  const lvPick = () => h('div.row', { style: 'gap:6px;justify-content:center;margin-bottom:10px' }, Object.keys(MINE_LV).map((k) => h('button.btn.sm' + (k === lv ? '.primary' : ''), { onClick: (e) => { lv = k; e.currentTarget.parentNode.querySelectorAll('.btn').forEach((b) => b.classList.toggle('primary', b === e.currentTarget)); setup(); } }, t(k === 'easy' ? 'Easy' : k === 'medium' ? 'Medium' : 'Hard'))));
  setup(); o.show(t('Minesweeper'), null, t('Click to open, right-click (or Flag mode) to flag. Numbers show the mines around a square.'), t('Start'), () => o.hide(), lvPick());
  void env; return () => clearInterval(tick);
}

// ================= SUDOKU =================
function sudokuGame(stage, hud, end, best, env) {
  const board = h('div.arc-board.sd-board'); const grid = h('div.sd-grid'); const pad = h('div.sd-pad'); board.append(grid, pad); stage.append(board); const o = overlay(board);
  let sol, cur, fixed, sel = -1, notes, mistakes, t0, tick = 0, lv = 'easy', done = false, noteMode = false;
  const LV = { easy: [38, 1], medium: [30, 2], hard: [25, 3] };
  function generate() {
    const g = Array(81).fill(0); const ok = (i, v) => { const r = Math.floor(i / 9), c = i % 9; for (let k = 0; k < 9; k++) { if (g[r * 9 + k] === v || g[k * 9 + c] === v) return false; } const br = r - r % 3, bc = c - c % 3; for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) if (g[(br + a) * 9 + bc + b] === v) return false; return true; };
    const fill = (i) => { if (i === 81) return true; const vs = [1, 2, 3, 4, 5, 6, 7, 8, 9].sort(() => Math.random() - 0.5); for (const v of vs) if (ok(i, v)) { g[i] = v; if (fill(i + 1)) return true; g[i] = 0; } return false; };
    fill(0); return g;
  }
  function setup() { sol = generate(); const keep = new Set(); const idx = [...Array(81).keys()].sort(() => Math.random() - 0.5); for (const i of idx.slice(0, LV[lv][0])) keep.add(i); cur = sol.map((v, i) => (keep.has(i) ? v : 0)); fixed = cur.map(Boolean); notes = Array.from({ length: 81 }, () => new Set()); mistakes = 0; sel = -1; done = false; t0 = performance.now(); clearInterval(tick); tick = setInterval(paintHud, 1000); paint(); paintHud(); }
  const paintHud = () => mount(hud, h('span.pill', '⏱ ' + fmtT((performance.now() - t0) / 1000)), h('span.pill', '❌ ' + mistakes + '/3'), h('button.btn.sm' + (noteMode ? '.primary' : ''), { onClick: () => { noteMode = !noteMode; paintHud(); } }, '✎ ' + t('Notes')), h('span.pill', t('Best: {s}', { s: best })));
  function put(v) {
    if (sel < 0 || fixed[sel] || done) return;
    if (noteMode && v) { const n = notes[sel]; if (n.has(v)) n.delete(v); else n.add(v); paint(); return; }
    if (!v) { cur[sel] = 0; paint(); return; }
    if (sol[sel] !== v) { mistakes++; snd('lose'); const el = grid.children[sel]; el.classList.add('bad'); setTimeout(() => el.classList.remove('bad'), 400); paintHud(); if (mistakes >= 3) { done = true; clearInterval(tick); o.show(t('Too many mistakes'), null, t('Three wrong numbers end the game.'), t('Try again'), () => { o.hide(); setup(); }, lvPick()); } return; }
    cur[sel] = v; notes[sel].clear(); snd('click'); paint();
    if (cur.every((x, i) => x === sol[i])) { done = true; clearInterval(tick); const ms = performance.now() - t0; const sc = Math.max(50, Math.round(LV[lv][1] * 400 + Math.max(0, 1800 - ms / 1000) / 3 - mistakes * 50)); snd('win'); o.show(t('Solved!'), sc, t('Time: {t}', { t: fmtT(ms / 1000) }), t('Play again'), () => { o.hide(); setup(); }, lvPick()); end(sc, ms).then((r) => { if (r) best = r.best; }); }
  }
  function paint() {
    const sv = sel >= 0 ? cur[sel] : 0; const sr = Math.floor(sel / 9), sc2 = sel % 9;
    mount(grid, cur.map((v, i) => { const r = Math.floor(i / 9), c = i % 9; const rel = sel >= 0 && (r === sr || c === sc2 || (Math.floor(r / 3) === Math.floor(sr / 3) && Math.floor(c / 3) === Math.floor(sc2 / 3)));
      return h('button.sd-c' + (fixed[i] ? '.fx' : '') + (i === sel ? '.sel' : rel ? '.rel' : '') + (v && v === sv ? '.same' : '') + (c % 3 === 2 && c < 8 ? '.br' : '') + (r % 3 === 2 && r < 8 ? '.bb' : ''), { type: 'button', onClick: () => { sel = i; paint(); } }, v || (notes[i].size ? h('span.sd-notes', [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => h('i', notes[i].has(n) ? String(n) : ''))) : '')); }));
    mount(pad, [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => h('button.sd-k', { type: 'button', onClick: () => put(n) }, String(n), h('small', String(9 - cur.filter((x) => x === n).length)))), h('button.sd-k', { type: 'button', onClick: () => put(0) }, '⌫'));
  }
  const off = keys(env, (e, down) => { if (!down) return; if (/^[1-9]$/.test(e.key)) { put(Number(e.key)); e.preventDefault(); } else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') put(0); else if (e.key.toLowerCase() === 'n') { noteMode = !noteMode; paintHud(); } else { const d = { ArrowUp: -9, ArrowDown: 9, ArrowLeft: -1, ArrowRight: 1 }[e.key]; if (d) { e.preventDefault(); sel = Math.max(0, Math.min(80, (sel < 0 ? 40 : sel) + d)); paint(); } } });
  const lvPick = () => h('div.row', { style: 'gap:6px;justify-content:center;margin-bottom:10px' }, Object.keys(LV).map((k) => h('button.btn.sm' + (k === lv ? '.primary' : ''), { onClick: (e) => { lv = k; e.currentTarget.parentNode.querySelectorAll('.btn').forEach((b) => b.classList.toggle('primary', b === e.currentTarget)); setup(); } }, t(k === 'easy' ? 'Easy' : k === 'medium' ? 'Medium' : 'Hard'))));
  setup(); o.show(t('Sudoku'), null, t('Pick a square and type 1-9 (or use the pad). N switches to pencil notes. Three mistakes end the game.'), t('Start'), () => { o.hide(); t0 = performance.now(); }, lvPick());
  return () => { clearInterval(tick); off(); };
}

// ================= SPACE ROCKS =================
function rocksGame(stage, hud, end, best, env) {
  const W = 720, H = 480; const cv = h('canvas.arc-canvas.arc-wide', { width: W, height: H, tabindex: 0 }); const board = h('div.arc-board.arc-widewrap', cv); stage.append(board); const o = overlay(board); const g = cv.getContext('2d');
  const A1 = env.css('--accent', '#8b5cf6'), A2 = env.css('--accent2', '#22d3ee'); const K = new Set();
  let ship, rocks, shots, parts, score, lives, wave, run = false, raf = 0, last = 0, t0 = 0, inv = 0, cd = 0, stars = Array.from({ length: 90 }, () => [Math.random() * W, Math.random() * H, Math.random()]);
  const mkRock = (x, y, s) => { const n = 10; const pts = Array.from({ length: n }, (_, i) => [Math.cos(i / n * 6.283), Math.sin(i / n * 6.283), rnd(0.75, 1.15)]); const a = Math.random() * 6.283; const sp = rnd(30, 70) * (4 - s) * 0.6; return { x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, s, r: [0, 14, 26, 44][s], rot: 0, vr: rnd(-1, 1), pts }; };
  function spawnWave() { wave++; for (let i = 0; i < 2 + wave; i++) { let x, y; do { x = Math.random() * W; y = Math.random() * H; } while (Math.hypot(x - ship.x, y - ship.y) < 160); rocks.push(mkRock(x, y, 3)); } }
  const burst = (x, y, c, n = 14) => { for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, s = rnd(40, 200); parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, l: rnd(0.4, 0.9), c }); } };
  const paintHud = () => mount(hud, h('span.pill', t('Score: {s}', { s: score })), h('span.pill', '❤ ' + lives), h('span.pill', t('Wave {n}', { n: wave })), h('span.pill', t('Best: {s}', { s: Math.max(best, score) })));
  function begin() { o.hide(); ship = { x: W / 2, y: H / 2, a: -Math.PI / 2, vx: 0, vy: 0 }; rocks = []; shots = []; parts = []; score = 0; lives = 3; wave = 0; inv = 2; spawnWave(); run = true; t0 = performance.now(); last = t0; paintHud(); cancelAnimationFrame(raf); raf = requestAnimationFrame(loop); cv.focus(); }
  const wrap = (p) => { if (p.x < -50) p.x += W + 100; else if (p.x > W + 50) p.x -= W + 100; if (p.y < -50) p.y += H + 100; else if (p.y > H + 50) p.y -= H + 100; };
  function loop(now) {
    if (!run) return; raf = requestAnimationFrame(loop); const dt = Math.min(0.033, (now - last) / 1000); last = now; inv = Math.max(0, inv - dt); cd = Math.max(0, cd - dt);
    if (K.has('left')) ship.a -= 4.2 * dt; if (K.has('right')) ship.a += 4.2 * dt;
    const thrust = K.has('up'); if (thrust) { ship.vx += Math.cos(ship.a) * 260 * dt; ship.vy += Math.sin(ship.a) * 260 * dt; if (Math.random() < 0.6) parts.push({ x: ship.x - Math.cos(ship.a) * 14, y: ship.y - Math.sin(ship.a) * 14, vx: -Math.cos(ship.a) * 120 + rnd(-30, 30), vy: -Math.sin(ship.a) * 120 + rnd(-30, 30), l: 0.35, c: '#fb923c' }); }
    ship.vx *= 0.992; ship.vy *= 0.992; ship.x += ship.vx * dt; ship.y += ship.vy * dt; wrap(ship);
    if (K.has('fire') && cd <= 0 && shots.length < 6) { cd = 0.18; shots.push({ x: ship.x + Math.cos(ship.a) * 16, y: ship.y + Math.sin(ship.a) * 16, vx: Math.cos(ship.a) * 520 + ship.vx, vy: Math.sin(ship.a) * 520 + ship.vy, l: 1.1 }); snd('click'); }
    for (const s of shots) { s.x += s.vx * dt; s.y += s.vy * dt; s.l -= dt; wrap(s); }
    for (const r of rocks) { r.x += r.vx * dt; r.y += r.vy * dt; r.rot += r.vr * dt; wrap(r); }
    for (const p of parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.l -= dt; p.vx *= 0.98; p.vy *= 0.98; }
    for (const s of shots) for (const r of rocks) { if (r.dead || s.l <= 0) continue; if (Math.hypot(s.x - r.x, s.y - r.y) < r.r) { s.l = 0; r.dead = true; score += [0, 100, 50, 20][r.s]; burst(r.x, r.y, r.s === 1 ? A2 : '#cbd5e1', 10 + r.s * 6); snd('coin'); if (r.s > 1) for (let k = 0; k < 2; k++) rocks.push(mkRock(r.x, r.y, r.s - 1)); } }
    if (!inv) for (const r of rocks) { if (!r.dead && Math.hypot(ship.x - r.x, ship.y - r.y) < r.r + 10) { lives--; burst(ship.x, ship.y, A1, 30); snd('lose'); board.classList.add('shake'); setTimeout(() => board.classList.remove('shake'), 400); inv = 2.5; Object.assign(ship, { x: W / 2, y: H / 2, vx: 0, vy: 0 }); if (lives <= 0) return over(); break; } }
    rocks = rocks.filter((r) => !r.dead); shots = shots.filter((s) => s.l > 0); parts = parts.filter((p) => p.l > 0); if (!rocks.length) { score += 250 * wave; spawnWave(); }
    // draw
    g.fillStyle = '#05050f'; g.fillRect(0, 0, W, H); for (const [x, y, z] of stars) { g.fillStyle = `rgba(255,255,255,${0.2 + z * 0.6})`; g.fillRect(x, y, z * 2, z * 2); }
    g.lineWidth = 2; g.shadowBlur = 10; for (const r of rocks) { g.save(); g.translate(r.x, r.y); g.rotate(r.rot); g.strokeStyle = '#cbd5e1'; g.shadowColor = A2; g.beginPath(); r.pts.forEach(([x, y, k], i) => (i ? g.lineTo(x * r.r * k, y * r.r * k) : g.moveTo(x * r.r * k, y * r.r * k))); g.closePath(); g.fillStyle = 'rgba(148,163,184,.08)'; g.fill(); g.stroke(); g.restore(); }
    g.fillStyle = '#fff'; g.shadowColor = A2; for (const s of shots) { g.beginPath(); g.arc(s.x, s.y, 2.5, 0, 6.283); g.fill(); }
    for (const p of parts) { g.globalAlpha = Math.max(0, p.l * 1.4); g.fillStyle = p.c; g.shadowColor = p.c; g.fillRect(p.x, p.y, 2.5, 2.5); } g.globalAlpha = 1;
    if (!inv || Math.floor(now / 100) % 2) { g.save(); g.translate(ship.x, ship.y); g.rotate(ship.a); g.strokeStyle = A1; g.shadowColor = A1; g.shadowBlur = 16; g.beginPath(); g.moveTo(16, 0); g.lineTo(-11, -10); g.lineTo(-6, 0); g.lineTo(-11, 10); g.closePath(); g.stroke(); g.restore(); }
    g.shadowBlur = 0; if (Math.floor(now / 250) % 4 === 0) paintHud();
  }
  function over() { run = false; cancelAnimationFrame(raf); const ms = performance.now() - t0; paintHud(); o.show(t('Game over'), score, t('You reached wave {n}', { n: wave }), t('Play again'), begin); if (score > 0) end(score, ms).then((r) => { if (r) best = r.best; }); }
  const map = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyW: 'up', Space: 'fire', KeyK: 'fire' };
  const off = keys(env, (e, down) => { const k = map[e.code]; if (!k) return; e.preventDefault(); if (down) K.add(k); else K.delete(k); });
  // touch: left third turns left, right third turns right, middle thrusts; any touch fires
  cv.addEventListener('pointerdown', (e) => { const r = cv.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width; K.add('fire'); K.add(x < 0.33 ? 'left' : x > 0.66 ? 'right' : 'up'); });
  cv.addEventListener('pointerup', () => { K.clear(); }); cv.addEventListener('pointerleave', () => K.clear());
  o.show(t('Space Rocks'), null, t('← → to turn, ↑ to thrust, Space to fire. On a phone: tap the sides to turn, the middle to thrust.'), t('Start'), begin);
  return () => { run = false; cancelAnimationFrame(raf); off(); };
}

// ================= GEM MATCH =================
function gemsGame(stage, hud, end, best, env) {
  const N = 8; const GEM = ['💎', '🔶', '🟢', '🟣', '❤️', '⭐']; const board = h('div.arc-board.gm-board'); const grid = h('div.gm-grid'); board.append(grid); stage.append(board); const o = overlay(board);
  let b, sel = -1, score, combo, t0, tick = 0, busy = false, run = false;
  const rndG = () => Math.floor(Math.random() * GEM.length);
  const matches = () => { const m = new Set(); for (let r = 0; r < N; r++) for (let c = 0; c < N - 2; c++) { const v = b[r * N + c]; if (v >= 0 && v === b[r * N + c + 1] && v === b[r * N + c + 2]) { m.add(r * N + c); m.add(r * N + c + 1); m.add(r * N + c + 2); } } for (let c = 0; c < N; c++) for (let r = 0; r < N - 2; r++) { const v = b[r * N + c]; if (v >= 0 && v === b[(r + 1) * N + c] && v === b[(r + 2) * N + c]) { m.add(r * N + c); m.add((r + 1) * N + c); m.add((r + 2) * N + c); } } return m; };
  function fresh() { do { b = Array.from({ length: N * N }, rndG); } while (matches().size); }
  const paintHud = () => { const left = run ? Math.max(0, 60 - (performance.now() - t0) / 1000) : 60; mount(hud, h('span.pill', t('Score: {s}', { s: score || 0 })), h('span.pill', '⏱ ' + Math.ceil(left) + ' s'), combo > 1 ? h('span.pill', '🔥 ×' + combo) : null, h('span.pill', t('Best: {s}', { s: Math.max(best, score || 0) }))); if (run && left <= 0) finish(); };
  function paint(pop) { mount(grid, b.map((v, i) => h('button.gm-c' + (i === sel ? '.sel' : '') + (pop && pop.has(i) ? '.pop' : ''), { type: 'button', onClick: () => tap(i) }, v >= 0 ? h('span.gm-g', { style: `--d:${(i % N) * 0.02}s` }, GEM[v]) : ''))); }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  async function resolve() {
    combo = 0; let m = matches();
    while (m.size && run) { combo++; score += m.size * 10 * combo; paint(m); snd(combo > 1 ? 'win' : 'coin'); await wait(240); m.forEach((i) => { b[i] = -1; });
      for (let c = 0; c < N; c++) { const col = []; for (let r = N - 1; r >= 0; r--) if (b[r * N + c] >= 0) col.push(b[r * N + c]); for (let r = N - 1, k = 0; r >= 0; r--, k++) b[r * N + c] = k < col.length ? col[k] : rndG(); }
      paint(); paintHud(); await wait(160); m = matches(); }
  }
  async function tap(i) {
    if (!run || busy) return; if (sel < 0) { sel = i; paint(); return; }
    const a = sel; sel = -1; const adj = Math.abs(a - i) === N || (Math.abs(a - i) === 1 && Math.floor(a / N) === Math.floor(i / N)); if (!adj) { sel = i; paint(); return; }
    busy = true; [b[a], b[i]] = [b[i], b[a]]; paint();
    if (!matches().size) { await wait(160); [b[a], b[i]] = [b[i], b[a]]; snd('lose'); paint(); busy = false; return; }
    await resolve(); busy = false;
  }
  function begin() { o.hide(); fresh(); score = 0; combo = 0; sel = -1; run = true; t0 = performance.now(); paint(); paintHud(); clearInterval(tick); tick = setInterval(paintHud, 250); }
  function finish() { run = false; clearInterval(tick); const ms = performance.now() - t0; o.show(t('Time!'), score, t('Big combos multiply your points.'), t('Play again'), begin); if (score > 0) end(score, ms).then((r) => { if (r) best = r.best; }); }
  void env; o.show(t('Gem Match'), null, t('Click a gem, then a neighbour to swap them. Make lines of three or more. You have 60 seconds.'), t('Start'), begin);
  return () => { run = false; clearInterval(tick); };
}

// ================= REFLEX =================
function reflexGame(stage, hud, end, best, env) {
  const pad = h('button.rx-pad', { type: 'button' }); const board = h('div.arc-board.rx-board', pad); stage.append(board); const o = overlay(board);
  let round = 0, times = [], state = 'idle', timer = 0, go = 0, t0 = 0;
  const paintHud = () => mount(hud, h('span.pill', t('Round {n}/5', { n: Math.min(5, round + (state === 'idle' ? 0 : 1)) })), times.length ? h('span.pill', t('Average: {n} ms', { n: Math.round(times.reduce((a, b) => a + b, 0) / times.length) })) : null, h('span.pill', t('Best: {s}', { s: best })));
  const show = (cls, txt, sub) => { pad.className = 'rx-pad ' + cls; mount(pad, h('b', txt), sub ? h('span', sub) : null); };
  function next() { state = 'wait'; show('wait', t('Wait for green…'), t('Round {n}/5', { n: round + 1 })); timer = setTimeout(() => { state = 'go'; go = performance.now(); show('go', t('Click!')); }, rnd(1200, 3800)); paintHud(); }
  function press() {
    if (state === 'wait') { clearTimeout(timer); state = 'early'; snd('lose'); show('early', t('Too soon!'), t('Click to try that round again')); return; }
    if (state === 'early') return next();
    if (state === 'go') { const ms = performance.now() - go; times.push(ms); round++; snd('coin'); state = 'shown'; show('shown', Math.round(ms) + ' ms', round < 5 ? t('Click for the next round') : null); paintHud();
      if (round >= 5) { const avg = times.reduce((a, b) => a + b, 0) / times.length; const sc = Math.max(1, Math.round(100000 / Math.max(100, avg))); state = 'idle'; setTimeout(() => o.show(t('Done!'), sc, t('Average: {n} ms · fastest {f} ms', { n: Math.round(avg), f: Math.round(Math.min(...times)) }), t('Play again'), begin), 700); if (sc > 0) end(sc, performance.now() - t0).then((r) => { if (r) best = r.best; }); } return; }
    if (state === 'shown') next();
  }
  function begin() { o.hide(); round = 0; times = []; t0 = performance.now(); next(); }
  pad.addEventListener('pointerdown', (e) => { e.preventDefault(); press(); });
  const off = keys(env, (e, down) => { if (down && e.code === 'Space') { e.preventDefault(); press(); } });
  o.show(t('Reflex'), null, t('When the panel turns green, click (or press Space) as fast as you can. Five rounds; clicking early restarts the round.'), t('Start'), begin);
  return () => { clearTimeout(timer); off(); };
}

export const PLUS_FNS = { mines: minesGame, sudoku: sudokuGame, rocks: rocksGame, gems: gemsGame, reflex: reflexGame };
