// Arcade, part 2: Block Drop, Nebula Flap, Paddle Duel, Star Defenders, Brick Breaker and Memory Sequence.
// Each game: (stage, hud, end, best, env) → cleanup. end(score, ms) submits the run (personal bests + coins).
import { h, mount, fmt, clamp } from '../util.js';
import { t } from '../i18n.js';
import { sfx } from '../sfx.js';

export const MORE_GAMES = [
  ['dash', 'Gravity Dash', 'zap', 'Flip gravity between floor and ceiling to dodge the spikes.', 'm'],
  ['stack', 'Star Stack', 'layers', 'Drop each floor right on top of the last one.', 'floors'],
  ['blocks', 'Block Drop', 'layers', 'Rotate falling blocks and clear full lines.', 'pts'],
  ['flap', 'Nebula Flap', 'zap', 'Tap to fly through the gates.', 'gates'],
  ['paddle', 'Paddle Duel', 'activity', 'Classic paddle tennis against the CPU. First to 5 ends it.', 'pts'],
  ['defenders', 'Star Defenders', 'star', 'Hold the line against waves of invaders.', 'pts'],
  ['bricks', 'Brick Breaker', 'grid', 'Bounce the ball and smash every brick.', 'pts'],
  ['memory', 'Memory Sequence', 'puzzle', 'Repeat the growing colour sequence.', 'steps'],
];
const snd = (k) => { try { sfx[k] && sfx[k](); } catch {} };

// overlay helper shared by all games
function overlay(stage, boardEl) {
  const ov = h('div.arc-ov'); boardEl.appendChild(ov); stage.append(boardEl);
  return {
    show: (title, big, sub, btn, onGo) => { mount(ov, h('div.arc-ovc', h('h3', title), big !== null && big !== undefined ? h('div.arc-big', String(big)) : null, sub ? h('p.muted', sub) : null, h('button.btn.primary', { onClick: onGo }, btn))); ov.classList.remove('hide'); },
    hide: () => { mount(ov); ov.classList.add('hide'); },
    el: ov,
  };
}
const accent = (env) => [env.css('--accent', '#8b5cf6'), env.css('--accent2', '#38bdf8')];
function keyHandler(env, fn) { const k = (e) => { if (!env.root.isConnected || !env.keysForMe(e) || e.ctrlKey || e.metaKey || e.altKey) return; fn(e); }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }
function keyUpHandler(env, fn) { const k = (e) => { if (!env.root.isConnected) return; fn(e); }; document.addEventListener('keyup', k); return () => document.removeEventListener('keyup', k); }

// ================= BLOCK DROP =================
const SHAPES = { I: [[0, 1], [1, 1], [2, 1], [3, 1]], O: [[1, 0], [2, 0], [1, 1], [2, 1]], T: [[1, 0], [0, 1], [1, 1], [2, 1]], S: [[1, 0], [2, 0], [0, 1], [1, 1]], Z: [[0, 0], [1, 0], [1, 1], [2, 1]], J: [[0, 0], [0, 1], [1, 1], [2, 1]], L: [[2, 0], [0, 1], [1, 1], [2, 1]] };
const SCOL = { I: '#22d3ee', O: '#facc15', T: '#a78bfa', S: '#4ade80', Z: '#f87171', J: '#60a5fa', L: '#fb923c' };
function blocksGame(stage, hud, end, best, env) {
  const C = 10, R = 20, S = 28; const W = C * S + 130, H = R * S;
  const cv = h('canvas.arc-canvas.arc-tall', { width: W, height: H, tabindex: 0 }); const o = overlay(stage, h('div.arc-board.arc-tallwrap', cv)); const g = cv.getContext('2d');
  let grid, cur, next, score, lines, level, t0, timer = 0, raf = 0, over = true, bag = [];
  const draw7 = () => { if (!bag.length) bag = Object.keys(SHAPES).sort(() => Math.random() - 0.5); return bag.pop(); };
  const mk = (k) => ({ k, cells: SHAPES[k].map(([x, y]) => [x, y]), x: 3, y: k === 'I' ? -1 : 0 });
  const fits = (cells, x, y) => cells.every(([cx, cy]) => { const X = cx + x, Y = cy + y; return X >= 0 && X < C && Y < R && (Y < 0 || !grid[Y][X]); });
  const rot = (p) => { if (p.k === 'O') return p.cells; const n = p.k === 'I' ? 4 : 3; return p.cells.map(([x, y]) => [n - 1 - y, x]); };
  const speed = () => Math.max(70, 800 - (level - 1) * 70);
  const paintHud = () => mount(hud, h('span.pill', t('Score: {s}', { s: fmt.num(score) })), h('span.pill', t('Lines: {n}', { n: lines })), h('span.pill', t('Level {n}', { n: level })), h('span.pill', t('Best: {s}', { s: fmt.num(Math.max(best, score)) })));
  function reset() { grid = Array.from({ length: R }, () => Array(C).fill(null)); bag = []; score = 0; lines = 0; level = 1; next = mk(draw7()); spawn(); paintHud(); }
  function spawn() { cur = next; next = mk(draw7()); if (!fits(cur.cells, cur.x, cur.y)) gameOver(); }
  function lock() {
    for (const [x, y] of cur.cells) { const Y = y + cur.y; if (Y < 0) return gameOver(); grid[Y][x + cur.x] = SCOL[cur.k]; }
    let n = 0; for (let y = R - 1; y >= 0; y--) if (grid[y].every(Boolean)) { grid.splice(y, 1); grid.unshift(Array(C).fill(null)); n++; y++; }
    if (n) { score += [0, 100, 300, 500, 800][n] * level; lines += n; level = 1 + Math.floor(lines / 10); snd('win'); } else snd('tick');
    paintHud(); spawn();
  }
  function fall() { if (over) return; if (fits(cur.cells, cur.x, cur.y + 1)) cur.y++; else lock(); if (!over) timer = setTimeout(fall, speed()); }
  function move(dx) { if (!over && fits(cur.cells, cur.x + dx, cur.y)) cur.x += dx; }
  function rotate() { if (over) return; const c = rot(cur); for (const k of [0, -1, 1, -2, 2]) if (fits(c, cur.x + k, cur.y)) { cur.cells = c; cur.x += k; return; } }
  function soft() { if (over) return; if (fits(cur.cells, cur.x, cur.y + 1)) { cur.y++; score++; paintHud(); } }
  function hard() { if (over) return; let d = 0; while (fits(cur.cells, cur.x, cur.y + 1)) { cur.y++; d++; } score += d * 2; clearTimeout(timer); lock(); if (!over) timer = setTimeout(fall, speed()); }
  function gameOver() { if (over) return; over = true; clearTimeout(timer); snd('lose'); const ms = performance.now() - t0; o.show(t('Game over'), fmt.num(score), t('{n} lines', { n: lines }), t('Play again'), begin); if (score > 0) end(score, ms).then((r) => { if (r) best = r.best; paintHud(); }); }
  function cell(x, y, col, a = 1) { g.globalAlpha = a; g.fillStyle = col; g.fillRect(x * S + 1, y * S + 1, S - 2, S - 2); g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(x * S + 1, y * S + 1, S - 2, 4); g.globalAlpha = 1; }
  function render() {
    raf = requestAnimationFrame(render); g.clearRect(0, 0, W, H); g.fillStyle = 'rgba(255,255,255,.03)'; g.fillRect(0, 0, C * S, H);
    g.strokeStyle = 'rgba(255,255,255,.04)'; for (let x = 1; x < C; x++) { g.beginPath(); g.moveTo(x * S, 0); g.lineTo(x * S, H); g.stroke(); }
    if (grid) for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) if (grid[y][x]) cell(x, y, grid[y][x]);
    if (cur && !over) { let gy = cur.y; while (fits(cur.cells, cur.x, gy + 1)) gy++; for (const [x, y] of cur.cells) { if (y + gy >= 0) cell(x + cur.x, y + gy, SCOL[cur.k], 0.18); if (y + cur.y >= 0) cell(x + cur.x, y + cur.y, SCOL[cur.k]); } }
    g.fillStyle = 'rgba(255,255,255,.7)'; g.font = '600 13px system-ui'; g.fillText(t('Next'), C * S + 20, 26);
    if (next) for (const [x, y] of next.cells) { g.fillStyle = SCOL[next.k]; g.fillRect(C * S + 22 + x * 20, 44 + y * 20, 18, 18); }
  }
  const begin = () => { o.hide(); reset(); over = false; t0 = performance.now(); clearTimeout(timer); timer = setTimeout(fall, speed()); cv.focus(); };
  const offK = keyHandler(env, (e) => { if (over) return; const k = e.key; const c = e.code;
    if (k === 'ArrowLeft' || c === 'KeyA') move(-1); else if (k === 'ArrowRight' || c === 'KeyD') move(1); else if (k === 'ArrowDown' || c === 'KeyS') soft(); else if (k === 'ArrowUp' || c === 'KeyW' || c === 'KeyX') rotate(); else if (k === ' ') hard(); else return; e.preventDefault(); });
  let sw = null; cv.addEventListener('pointerdown', (e) => { sw = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  cv.addEventListener('pointerup', (e) => { if (!sw || over) return; const dx = e.clientX - sw.x, dy = e.clientY - sw.y; sw = null; if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return rotate(); if (Math.abs(dx) > Math.abs(dy)) { const n = Math.max(1, Math.round(Math.abs(dx) / 30)); for (let i = 0; i < n; i++) move(Math.sign(dx)); } else if (dy > 0) hard(); });
  reset(); o.show(t('Block Drop'), null, t('←/→ move · ↑ rotate · ↓ soft drop · Space hard drop. Tap to rotate, swipe to move.'), t('Start'), begin); render();
  return () => { over = true; clearTimeout(timer); cancelAnimationFrame(raf); offK(); };
}

// ================= NEBULA FLAP =================
function flapGame(stage, hud, end, best, env) {
  const W = 520, H = 520; const cv = h('canvas.arc-canvas', { width: W, height: H, tabindex: 0 }); const o = overlay(stage, h('div.arc-board', cv)); const g = cv.getContext('2d');
  const [A1, A2] = accent(env); let y, vy, pipes, score, run = false, t0, last, raf = 0, spawnAcc;
  const GAP = 150, SPEED = 150, EVERY = 1.6;
  const paintHud = () => mount(hud, h('span.pill', t('Gates: {n}', { n: score })), h('span.pill', t('Best: {s}', { s: Math.max(best, score) })));
  const reset = () => { y = H / 2; vy = 0; pipes = []; score = 0; spawnAcc = EVERY - 0.6; paintHud(); };
  const flap = () => { if (!run) return; vy = -330; snd('tick'); };
  function die() { if (!run) return; run = false; snd('lose'); const ms = performance.now() - t0; o.show(t('Game over'), score, null, t('Play again'), begin); if (score > 0) end(score, ms).then((r) => { if (r) best = r.best; paintHud(); }); }
  function frame(now) {
    raf = requestAnimationFrame(frame); const dt = Math.min(0.033, (now - (last || now)) / 1000); last = now;
    if (run) {
      vy += 900 * dt; y += vy * dt; spawnAcc += dt;
      if (spawnAcc >= EVERY) { spawnAcc = 0; pipes.push({ x: W + 30, gy: 90 + Math.random() * (H - 180 - GAP), passed: false }); }
      for (const p of pipes) { p.x -= SPEED * dt; if (!p.passed && p.x + 30 < 110) { p.passed = true; score++; snd('coin'); paintHud(); } }
      pipes = pipes.filter((p) => p.x > -70);
      if (y < 12 || y > H - 12) die();
      for (const p of pipes) if (110 + 12 > p.x - 30 && 110 - 12 < p.x + 30 && (y - 12 < p.gy || y + 12 > p.gy + GAP)) die();
    }
    g.clearRect(0, 0, W, H);
    for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(255,255,255,' + (0.15 + (i % 3) * 0.1) + ')'; g.fillRect((((i * 97 - now * 0.01 * (1 + (i % 3))) % W) + W) % W, (i * 53) % H, 2, 2); }
    for (const p of pipes) { const gr = g.createLinearGradient(p.x - 30, 0, p.x + 30, 0); gr.addColorStop(0, A1); gr.addColorStop(1, A2); g.fillStyle = gr; g.fillRect(p.x - 30, 0, 60, p.gy); g.fillRect(p.x - 30, p.gy + GAP, 60, H - p.gy - GAP); g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(p.x - 34, p.gy - 12, 68, 12); g.fillRect(p.x - 34, p.gy + GAP, 68, 12); }
    g.save(); g.translate(110, y); g.rotate(clamp(vy / 600, -0.5, 0.9)); g.fillStyle = '#fde68a'; g.shadowColor = A2; g.shadowBlur = 18; g.beginPath(); g.ellipse(0, 0, 15, 12, 0, 0, 7); g.fill(); g.shadowBlur = 0; g.fillStyle = '#0b0820'; g.beginPath(); g.arc(6, -3, 2.6, 0, 7); g.fill(); g.fillStyle = '#f97316'; g.beginPath(); g.moveTo(13, 1); g.lineTo(21, 4); g.lineTo(13, 7); g.fill(); g.restore();
  }
  const begin = () => { o.hide(); reset(); run = true; t0 = performance.now(); vy = -250; cv.focus(); };
  const offK = keyHandler(env, (e) => { if (e.key === ' ' || e.key === 'ArrowUp' || e.code === 'KeyW') { e.preventDefault(); flap(); } });
  cv.addEventListener('pointerdown', flap);
  reset(); o.show(t('Nebula Flap'), null, t('Space, ↑ or tap to fly. Pass through the gates.'), t('Start'), begin); raf = requestAnimationFrame(frame);
  return () => { run = false; cancelAnimationFrame(raf); offK(); };
}

// ================= PADDLE DUEL =================
function paddleGame(stage, hud, end, best, env) {
  const W = 520, H = 520; const cv = h('canvas.arc-canvas', { width: W, height: H, tabindex: 0 }); const o = overlay(stage, h('div.arc-board', cv)); const g = cv.getContext('2d');
  const [A1, A2] = accent(env); const PH = 80; let py, cy, bx, by, vx, vy, me, cpu, run = false, t0, last, raf = 0, serveAt = 0; const keys = {};
  const paintHud = () => mount(hud, h('span.pill', t('You {a} – {b} CPU', { a: me, b: cpu })), h('span.pill', t('Best: {s}', { s: Math.max(best, me) })));
  const serve = (dir) => { bx = W / 2; by = H / 2; const a = (Math.random() - 0.5) * 0.9; const sp = 300 + Math.min(220, (me + cpu) * 12); vx = Math.cos(a) * sp * dir; vy = Math.sin(a) * sp; serveAt = performance.now() + 1000; };
  const reset = () => { py = cy = H / 2; me = 0; cpu = 0; serve(1); paintHud(); };
  function point(winner) { if (winner === 'me') { me++; snd('win'); } else { cpu++; snd('lose'); } paintHud(); if (cpu >= 5) return finish(); serve(winner === 'me' ? -1 : 1); }
  function finish() { run = false; const ms = performance.now() - t0; o.show(t('Game over'), me, t('You scored {n} points', { n: me }), t('Play again'), begin); if (me > 0) end(me, ms).then((r) => { if (r) best = r.best; paintHud(); }); }
  function frame(now) {
    raf = requestAnimationFrame(frame); const dt = Math.min(0.033, (now - (last || now)) / 1000); last = now;
    if (run) {
      if (keys.up) py -= 420 * dt; if (keys.down) py += 420 * dt; py = clamp(py, PH / 2, H - PH / 2);
      const target = vx > 0 ? by : H / 2; cy += clamp(target - cy, -300 * dt, 300 * dt); cy = clamp(cy, PH / 2, H - PH / 2);
      if (now > serveAt) {
        bx += vx * dt; by += vy * dt;
        if (by < 8) { by = 8; vy = Math.abs(vy); } if (by > H - 8) { by = H - 8; vy = -Math.abs(vy); }
        if (vx < 0 && bx < 34 && bx > 18 && Math.abs(by - py) < PH / 2 + 8) { vx = Math.abs(vx) * 1.05; vy += (by - py) * 5; snd('tick'); }
        if (vx > 0 && bx > W - 34 && bx < W - 18 && Math.abs(by - cy) < PH / 2 + 8) { vx = -Math.abs(vx) * 1.04; vy += (by - cy) * 4; snd('tick'); }
        if (bx < -10) point('cpu'); else if (bx > W + 10) point('me');
      }
    }
    g.clearRect(0, 0, W, H); g.setLineDash([8, 10]); g.strokeStyle = 'rgba(255,255,255,.15)'; g.beginPath(); g.moveTo(W / 2, 0); g.lineTo(W / 2, H); g.stroke(); g.setLineDash([]);
    g.fillStyle = 'rgba(255,255,255,.12)'; g.font = '800 64px system-ui'; g.textAlign = 'center'; g.fillText(String(me), W / 4, 90); g.fillText(String(cpu), (W * 3) / 4, 90); g.textAlign = 'left';
    g.fillStyle = A1; g.fillRect(18, py - PH / 2, 12, PH); g.fillStyle = A2; g.fillRect(W - 30, cy - PH / 2, 12, PH);
    if (bx !== undefined) { g.fillStyle = '#fff'; g.shadowColor = A2; g.shadowBlur = 14; g.beginPath(); g.arc(bx, by, 8, 0, 7); g.fill(); g.shadowBlur = 0; }
  }
  const begin = () => { o.hide(); reset(); run = true; t0 = performance.now(); cv.focus(); };
  const offK = keyHandler(env, (e) => { if (e.key === 'ArrowUp' || e.code === 'KeyW') { keys.up = true; e.preventDefault(); } else if (e.key === 'ArrowDown' || e.code === 'KeyS') { keys.down = true; e.preventDefault(); } });
  const offU = keyUpHandler(env, (e) => { if (e.key === 'ArrowUp' || e.code === 'KeyW') keys.up = false; else if (e.key === 'ArrowDown' || e.code === 'KeyS') keys.down = false; });
  const pm = (e) => { const r = cv.getBoundingClientRect(); py = clamp(((e.clientY - r.top) / r.height) * H, PH / 2, H - PH / 2); };
  cv.addEventListener('pointermove', pm); cv.addEventListener('pointerdown', pm);
  reset(); o.show(t('Paddle Duel'), null, t('Mouse, touch, ↑/↓ or W/S. The game ends when the CPU scores 5.'), t('Start'), begin); raf = requestAnimationFrame(frame);
  return () => { run = false; cancelAnimationFrame(raf); offK(); offU(); };
}

// ================= STAR DEFENDERS =================
function defendersGame(stage, hud, end, best, env) {
  const W = 520, H = 520; const cv = h('canvas.arc-canvas', { width: W, height: H, tabindex: 0 }); const o = overlay(stage, h('div.arc-board', cv)); const g = cv.getContext('2d');
  const [A1, A2] = accent(env); let px, aliens, dir, stepT, shots, bombs, score, lives, wave, run = false, t0, last, raf = 0, cool = 0, parts = []; const keys = {};
  const ROWS = 5, COLS = 9; const ACOL = ['#f472b6', '#a78bfa', '#a78bfa', '#38bdf8', '#38bdf8']; const APTS = [30, 20, 20, 10, 10];
  const paintHud = () => mount(hud, h('span.pill', t('Score: {s}', { s: fmt.num(score) })), h('span.pill', '❤'.repeat(Math.max(0, lives))), h('span.pill', t('Wave {n}', { n: wave })), h('span.pill', t('Best: {s}', { s: fmt.num(Math.max(best, score)) })));
  const spawnWave = () => { aliens = []; for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) aliens.push({ x: 60 + c * 44, y: 60 + r * 36 + Math.min(80, (wave - 1) * 12), r, alive: true }); dir = 1; stepT = 0; };
  const reset = () => { px = W / 2; score = 0; lives = 3; wave = 1; shots = []; bombs = []; spawnWave(); paintHud(); };
  function boom(x, y, c) { for (let i = 0; i < 12; i++) parts.push({ x, y, vx: (Math.random() - 0.5) * 220, vy: (Math.random() - 0.5) * 220, l: 1, c }); }
  function finish() { run = false; snd('lose'); const ms = performance.now() - t0; o.show(t('Game over'), fmt.num(score), t('You reached wave {n}', { n: wave }), t('Play again'), begin); if (score > 0) end(score, ms).then((r) => { if (r) best = r.best; paintHud(); }); }
  function frame(now) {
    raf = requestAnimationFrame(frame); const dt = Math.min(0.033, (now - (last || now)) / 1000); last = now;
    if (run) {
      if (keys.l) px -= 300 * dt; if (keys.r) px += 300 * dt; px = clamp(px, 24, W - 24); cool -= dt;
      if (keys.fire && cool <= 0 && shots.length < 2) { shots.push({ x: px, y: H - 52 }); cool = 0.35; snd('tick'); }
      const live = aliens.filter((a) => a.alive); const interval = Math.max(0.06, 0.6 * (live.length / (ROWS * COLS)) / (1 + (wave - 1) * 0.15));
      stepT += dt; if (stepT >= interval) { stepT = 0; const edge = live.some((a) => (dir > 0 ? a.x > W - 30 : a.x < 30)); if (edge) { dir = -dir; for (const a of live) a.y += 16; } else for (const a of live) a.x += 10 * dir; }
      if (live.length && Math.random() < dt * (0.8 + wave * 0.25)) { const a = live[Math.floor(Math.random() * live.length)]; bombs.push({ x: a.x, y: a.y + 12 }); }
      for (const s of shots) s.y -= 520 * dt; for (const b of bombs) b.y += (180 + wave * 15) * dt;
      for (const s of shots) for (const a of live) if (a.alive && Math.abs(s.x - a.x) < 16 && Math.abs(s.y - a.y) < 12) { a.alive = false; s.y = -99; score += APTS[a.r]; boom(a.x, a.y, ACOL[a.r]); snd('coin'); paintHud(); }
      shots = shots.filter((s) => s.y > -10); bombs = bombs.filter((b) => { if (b.y > H - 50 && b.y < H - 20 && Math.abs(b.x - px) < 20) { lives--; boom(px, H - 36, '#fff'); snd('lose'); paintHud(); return false; } return b.y < H; });
      if (lives <= 0 || live.some((a) => a.y > H - 70)) finish();
      else if (!aliens.some((a) => a.alive)) { wave++; score += 100; spawnWave(); bombs = []; snd('win'); paintHud(); }
    }
    g.clearRect(0, 0, W, H);
    for (const a of aliens || []) if (a.alive) { g.fillStyle = ACOL[a.r]; const x = a.x, y = a.y; const f = Math.floor(now / 400) % 2; g.fillRect(x - 12, y - 6, 24, 10); g.fillRect(x - 8, y - 10, 16, 4); g.fillRect(x - 14 + (f ? 2 : 0), y + 4, 6, 5); g.fillRect(x + 8 - (f ? 2 : 0), y + 4, 6, 5); g.fillStyle = '#0b0820'; g.fillRect(x - 6, y - 4, 4, 4); g.fillRect(x + 2, y - 4, 4, 4); }
    g.fillStyle = A2; for (const s of shots) g.fillRect(s.x - 2, s.y - 8, 4, 12); g.fillStyle = '#f87171'; for (const b of bombs) g.fillRect(b.x - 2, b.y - 5, 4, 10);
    if (run || lives > 0) { g.fillStyle = A1; g.shadowColor = A1; g.shadowBlur = 12; g.beginPath(); g.moveTo(px, H - 52); g.lineTo(px + 20, H - 24); g.lineTo(px - 20, H - 24); g.closePath(); g.fill(); g.shadowBlur = 0; }
    parts = parts.filter((p) => (p.l -= dt * 1.8) > 0); for (const p of parts) { p.x += p.vx * dt; p.y += p.vy * dt; g.globalAlpha = p.l; g.fillStyle = p.c; g.fillRect(p.x, p.y, 3, 3); } g.globalAlpha = 1;
  }
  const begin = () => { o.hide(); reset(); run = true; t0 = performance.now(); cv.focus(); };
  const map = (e, v) => { const k = e.key, c = e.code; if (k === 'ArrowLeft' || c === 'KeyA') keys.l = v; else if (k === 'ArrowRight' || c === 'KeyD') keys.r = v; else if (k === ' ' || k === 'ArrowUp' || c === 'KeyW') keys.fire = v; else return false; return true; };
  const offK = keyHandler(env, (e) => { if (map(e, true)) e.preventDefault(); }); const offU = keyUpHandler(env, (e) => map(e, false));
  cv.addEventListener('pointermove', (e) => { const r = cv.getBoundingClientRect(); px = clamp(((e.clientX - r.left) / r.width) * W, 24, W - 24); });
  cv.addEventListener('pointerdown', (e) => { const r = cv.getBoundingClientRect(); px = clamp(((e.clientX - r.left) / r.width) * W, 24, W - 24); keys.fire = true; });
  cv.addEventListener('pointerup', () => { keys.fire = false; });
  reset(); o.show(t('Star Defenders'), null, t('←/→ to move, Space to fire. Touch: drag and hold to fire.'), t('Start'), begin); raf = requestAnimationFrame(frame);
  return () => { run = false; cancelAnimationFrame(raf); offK(); offU(); };
}

// ================= BRICK BREAKER =================
function bricksGame(stage, hud, end, best, env) {
  const W = 520, H = 520; const cv = h('canvas.arc-canvas', { width: W, height: H, tabindex: 0 }); const o = overlay(stage, h('div.arc-board', cv)); const g = cv.getContext('2d');
  const [A1, A2] = accent(env); const PW = 90; let px, bx, by, vx, vy, bricks, score, lives, level, run = false, stuck = true, t0, last, raf = 0; const keys = {};
  const COLS = 10, ROWS = 6, BW = 48, BH = 18; const RC = ['#f87171', '#fb923c', '#facc15', '#4ade80', '#38bdf8', '#a78bfa'];
  const paintHud = () => mount(hud, h('span.pill', t('Score: {s}', { s: fmt.num(score) })), h('span.pill', '❤'.repeat(Math.max(0, lives))), h('span.pill', t('Level {n}', { n: level })), h('span.pill', t('Best: {s}', { s: fmt.num(Math.max(best, score)) })));
  const build = () => { bricks = []; for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) bricks.push({ x: 20 + c * (BW + 0), y: 50 + r * (BH + 4), r, hp: level > 2 && r < 2 ? 2 : 1 }); };
  const stick = () => { stuck = true; bx = px; by = H - 44; };
  const launch = () => { if (!run || !stuck) return; stuck = false; const sp = 340 + level * 30; const a = -Math.PI / 2 + (Math.random() - 0.5) * 0.8; vx = Math.cos(a) * sp; vy = Math.sin(a) * sp; };
  const reset = () => { px = W / 2; score = 0; lives = 3; level = 1; build(); stick(); paintHud(); };
  function finish(win) { run = false; snd(win ? 'win' : 'lose'); const ms = performance.now() - t0; o.show(t('Game over'), fmt.num(score), t('You reached level {n}', { n: level }), t('Play again'), begin); if (score > 0) end(score, ms).then((r) => { if (r) best = r.best; paintHud(); }); }
  function frame(now) {
    raf = requestAnimationFrame(frame); const dt = Math.min(0.025, (now - (last || now)) / 1000); last = now;
    if (run) {
      if (keys.l) px -= 460 * dt; if (keys.r) px += 460 * dt; px = clamp(px, PW / 2, W - PW / 2);
      if (stuck) { bx = px; by = H - 44; }
      else {
        bx += vx * dt; by += vy * dt;
        if (bx < 8) { bx = 8; vx = Math.abs(vx); } if (bx > W - 8) { bx = W - 8; vx = -Math.abs(vx); } if (by < 8) { by = 8; vy = Math.abs(vy); }
        if (vy > 0 && by > H - 40 && by < H - 24 && Math.abs(bx - px) < PW / 2 + 8) { const k = (bx - px) / (PW / 2); const sp = Math.hypot(vx, vy); const a = -Math.PI / 2 + k * 1.05; vx = Math.cos(a) * sp; vy = Math.sin(a) * sp; snd('tick'); }
        for (const b of bricks) { if (b.hp <= 0) continue; if (bx > b.x - 8 && bx < b.x + BW + 8 && by > b.y - 8 && by < b.y + BH + 8) { b.hp--; const fromSide = Math.min(Math.abs(bx - b.x), Math.abs(bx - b.x - BW)) < Math.min(Math.abs(by - b.y), Math.abs(by - b.y - BH)); if (fromSide) vx = -vx; else vy = -vy; if (b.hp <= 0) { score += 10 * level; snd('coin'); } paintHud(); break; } }
        if (by > H + 10) { lives--; paintHud(); if (lives <= 0) return finish(false); stick(); }
        if (!bricks.some((b) => b.hp > 0)) { level++; score += 250; build(); stick(); paintHud(); snd('win'); }
      }
    }
    g.clearRect(0, 0, W, H);
    for (const b of bricks || []) if (b.hp > 0) { g.fillStyle = RC[b.r]; g.globalAlpha = b.hp > 1 ? 1 : 0.85; g.fillRect(b.x + 2, b.y, BW - 4, BH); g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(b.x + 2, b.y, BW - 4, 4); if (b.hp > 1) { g.strokeStyle = '#fff'; g.strokeRect(b.x + 3, b.y + 1, BW - 6, BH - 2); } g.globalAlpha = 1; }
    const gr = g.createLinearGradient(px - PW / 2, 0, px + PW / 2, 0); gr.addColorStop(0, A1); gr.addColorStop(1, A2); g.fillStyle = gr; g.fillRect(px - PW / 2, H - 34, PW, 12);
    if (bx !== undefined) { g.fillStyle = '#fff'; g.shadowColor = A2; g.shadowBlur = 14; g.beginPath(); g.arc(bx, by, 7, 0, 7); g.fill(); g.shadowBlur = 0; }
    if (run && stuck) { g.fillStyle = 'rgba(255,255,255,.6)'; g.font = '600 14px system-ui'; g.textAlign = 'center'; g.fillText(t('Space or tap to launch'), W / 2, H - 70); g.textAlign = 'left'; }
  }
  const begin = () => { o.hide(); reset(); run = true; t0 = performance.now(); cv.focus(); };
  const map = (e, v) => { const k = e.key, c = e.code; if (k === 'ArrowLeft' || c === 'KeyA') keys.l = v; else if (k === 'ArrowRight' || c === 'KeyD') keys.r = v; else return false; return true; };
  const offK = keyHandler(env, (e) => { if (e.key === ' ') { e.preventDefault(); launch(); return; } if (map(e, true)) e.preventDefault(); }); const offU = keyUpHandler(env, (e) => map(e, false));
  cv.addEventListener('pointermove', (e) => { const r = cv.getBoundingClientRect(); px = clamp(((e.clientX - r.left) / r.width) * W, PW / 2, W - PW / 2); });
  cv.addEventListener('pointerdown', (e) => { const r = cv.getBoundingClientRect(); px = clamp(((e.clientX - r.left) / r.width) * W, PW / 2, W - PW / 2); launch(); });
  reset(); o.show(t('Brick Breaker'), null, t('Mouse, touch or ←/→ to move. Space or tap to launch.'), t('Start'), begin); raf = requestAnimationFrame(frame);
  return () => { run = false; cancelAnimationFrame(raf); offK(); offU(); };
}

// ================= MEMORY SEQUENCE =================
function memoryGame(stage, hud, end, best, env) {
  const PADS = ['#ef4444', '#22c55e', '#3b82f6', '#eab308']; const TONES = [329.6, 261.6, 220, 164.8];
  const pads = PADS.map((c, i) => h('button.mem-pad', { type: 'button', style: { '--c': c }, 'aria-label': t('Pad {n}', { n: i + 1 }), onPointerdown: () => press(i) }));
  const board = h('div.arc-board.mem-board', h('div.mem-grid', pads)); const o = overlay(stage, board);
  let seq = [], idx = 0, listening = false, score = 0, t0 = 0, alive = true, timers = []; let ac = null;
  const later = (fn, ms) => timers.push(setTimeout(() => alive && fn(), ms));
  const paintHud = () => mount(hud, h('span.pill', t('Steps: {n}', { n: score })), h('span.pill', t('Best: {s}', { s: Math.max(best, score) })));
  function tone(i, ms) { try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); const o2 = ac.createOscillator(); const gn = ac.createGain(); o2.frequency.value = TONES[i]; o2.type = 'triangle'; gn.gain.setValueAtTime(0.12, ac.currentTime); gn.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + ms / 1000); o2.connect(gn).connect(ac.destination); o2.start(); o2.stop(ac.currentTime + ms / 1000); } catch {} }
  function flash(i, ms = 380) { pads[i].classList.add('on'); tone(i, ms); later(() => pads[i].classList.remove('on'), ms); }
  function playSeq() { listening = false; board.classList.add('watch'); seq.forEach((p, k) => later(() => flash(p), 600 + k * 620)); later(() => { listening = true; idx = 0; board.classList.remove('watch'); }, 600 + seq.length * 620); }
  function nextRound() { seq.push(Math.floor(Math.random() * 4)); playSeq(); }
  function press(i) {
    if (!listening) return; flash(i, 220);
    if (seq[idx] !== i) { listening = false; snd('lose'); const ms = performance.now() - t0; o.show(t('Game over'), score, t('You remembered {n} steps', { n: score }), t('Play again'), begin); if (score > 0) end(score, ms).then((r) => { if (r) best = r.best; paintHud(); }); return; }
    idx++; if (idx === seq.length) { score = seq.length; paintHud(); listening = false; snd('coin'); later(nextRound, 500); }
  }
  const begin = () => { o.hide(); seq = []; score = 0; paintHud(); t0 = performance.now(); nextRound(); };
  const offK = keyHandler(env, (e) => { const m = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, KeyQ: 0, KeyW: 1, KeyA: 2, KeyS: 3 }[e.code]; if (m !== undefined) { e.preventDefault(); press(m); } });
  paintHud(); o.show(t('Memory Sequence'), null, t('Watch the pads light up, then repeat the sequence. Keys 1-4 work too.'), t('Start'), begin);
  return () => { alive = false; timers.forEach(clearTimeout); offK(); try { ac && ac.close(); } catch {} };
}


// ================= GRAVITY DASH =================
// Run forever; tap / Space flips gravity between the floor and the ceiling. Spikes grow on both sides. Score = metres.
function dashGame(stage, hud, end, best, env) {
  const W = 640, H = 360, FLOOR = H - 40, CEIL = 40, P = 26, PX = 120;
  const cv = h('canvas.arc-canvas.arc-wide', { width: W, height: H, tabindex: 0 }); const o = overlay(stage, h('div.arc-board.arc-widewrap', cv)); const g = cv.getContext('2d');
  const [A1, A2] = accent(env); let y, vy, grav, spikes, dist, speed, run = false, t0, last, raf = 0, gap, trail, grounded, shown = 0;
  const score = () => Math.floor(dist / 50);
  const paintHud = () => { shown = score(); mount(hud, h('span.pill', t('{n} m', { n: shown })), h('span.pill', t('Best: {s}', { s: Math.max(best, shown) }))); };
  const reset = () => { y = FLOOR - P; vy = 0; grav = 1; spikes = []; dist = 0; speed = 260; gap = 300; trail = []; grounded = true; paintHud(); };
  const flip = () => { if (!run || !grounded) return; grav = -grav; grounded = false; vy = grav * 120; snd('tick'); };
  function spawn() {
    const w = 26 + Math.random() * 46; const side = Math.random() < 0.5 ? 'f' : 'c';
    spikes.push({ x: W + 20, w, side });
    if (dist > 2500 && Math.random() < 0.35) spikes.push({ x: W + 20 + w + 150 + Math.random() * 60, w: 26 + Math.random() * 30, side: side === 'f' ? 'c' : 'f' });
    gap = Math.max(170, 320 - dist / 120) + Math.random() * 140;
  }
  function die() { if (!run) return; run = false; snd('lose'); const ms = performance.now() - t0; const s = score(); o.show(t('Game over'), t('{n} m', { n: s }), null, t('Play again'), begin); if (s > 0) end(s, ms).then((r) => { if (r) best = r.best; paintHud(); }); }
  function frame(now) {
    raf = requestAnimationFrame(frame); const dt = Math.min(0.033, (now - (last || now)) / 1000); last = now;
    if (run) {
      speed = Math.min(520, speed + 9 * dt); dist += speed * dt;
      vy += grav * 2600 * dt; y += vy * dt; grounded = false;
      if (y >= FLOOR - P) { y = FLOOR - P; vy = 0; if (grav > 0) grounded = true; }
      if (y <= CEIL) { y = CEIL; vy = 0; if (grav < 0) grounded = true; }
      for (const sp of spikes) sp.x -= speed * dt; spikes = spikes.filter((sp) => sp.x + sp.w > -20);
      const lastX = spikes.length ? Math.max(...spikes.map((sp) => sp.x + sp.w)) : 0; if (W - lastX > gap) spawn();
      for (const sp of spikes) { const hx = PX + 4 < sp.x + sp.w - 6 && PX + P - 4 > sp.x + 6; if (!hx) continue; if (sp.side === 'f' && y + P > FLOOR - 22) die(); if (sp.side === 'c' && y < CEIL + 22) die(); }
      trail.push({ x: PX, y: y + P / 2, a: 1 }); if (trail.length > 18) trail.shift(); for (const tr of trail) { tr.x -= speed * dt; tr.a -= dt * 2.5; }
      if (score() !== shown) paintHud();
    }
    g.fillStyle = '#060814'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 60; i++) { const sp = 1 + (i % 3); g.fillStyle = 'rgba(255,255,255,' + (0.12 + (i % 3) * 0.12) + ')'; g.fillRect((((i * 131 - dist * 0.15 * sp) % W) + W) % W, CEIL + 8 + ((i * 47) % (FLOOR - CEIL - 16)), sp, sp); }
    const gr = g.createLinearGradient(0, 0, W, 0); gr.addColorStop(0, A1); gr.addColorStop(1, A2);
    g.fillStyle = gr; g.fillRect(0, FLOOR, W, 3); g.fillRect(0, CEIL - 3, W, 3);
    g.strokeStyle = 'rgba(255,255,255,.07)'; for (let x = -((dist * 0.6) % 40); x < W; x += 40) { g.beginPath(); g.moveTo(x, FLOOR + 3); g.lineTo(x - 20, H); g.stroke(); g.beginPath(); g.moveTo(x, CEIL - 3); g.lineTo(x - 20, 0); g.stroke(); }
    for (const sp of spikes) { g.fillStyle = '#f43f5e'; g.shadowColor = '#f43f5e'; g.shadowBlur = 12; const n = Math.max(1, Math.round(sp.w / 18)); const ww = sp.w / n; g.beginPath(); for (let i = 0; i < n; i++) { const x = sp.x + i * ww; if (sp.side === 'f') { g.moveTo(x, FLOOR); g.lineTo(x + ww / 2, FLOOR - 24); g.lineTo(x + ww, FLOOR); } else { g.moveTo(x, CEIL); g.lineTo(x + ww / 2, CEIL + 24); g.lineTo(x + ww, CEIL); } } g.fill(); g.shadowBlur = 0; }
    for (const tr of trail) { if (tr.a <= 0) continue; g.fillStyle = A2; g.globalAlpha = Math.max(0, tr.a) * 0.5; g.fillRect(tr.x, tr.y - 6, 10, 12); } g.globalAlpha = 1;
    g.save(); g.translate(PX + P / 2, y + P / 2); g.rotate(run ? (dist / 40) % (Math.PI * 2) * (grav > 0 ? 1 : -1) * (grounded ? 0 : 1) : 0); g.shadowColor = A1; g.shadowBlur = 20; g.fillStyle = gr; g.fillRect(-P / 2, -P / 2, P, P); g.shadowBlur = 0; g.fillStyle = '#fff'; g.fillRect(-4, -6, 5, 5); g.fillRect(4, -6, 5, 5); g.restore();
  }
  const begin = () => { o.hide(); reset(); run = true; t0 = performance.now(); cv.focus(); };
  const offK = keyHandler(env, (e) => { if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.code === 'KeyW' || e.code === 'KeyS') { e.preventDefault(); flip(); } });
  cv.addEventListener('pointerdown', flip);
  reset(); o.show(t('Gravity Dash'), null, t('Space, ↑/↓ or tap to flip gravity. Dodge the spikes on the floor and the ceiling.'), t('Start'), begin); raf = requestAnimationFrame(frame);
  return () => { run = false; cancelAnimationFrame(raf); offK(); };
}

// ================= STAR STACK =================
// A slab slides from side to side; tap to drop it. Only the part that overlaps the floor below stays. Perfect drops keep the full width.
function stackGame(stage, hud, end, best, env) {
  const W = 410, H = 560, SH = 26;
  const cv = h('canvas.arc-canvas.arc-tall', { width: W, height: H, tabindex: 0 }); const o = overlay(stage, h('div.arc-board.arc-tallwrap', cv)); const g = cv.getContext('2d');
  let floors, cur, dir, speed, camY, camT, run = false, t0, raf = 0, last, chips, combo, flash = 0;
  const hue = (i) => `hsl(${(i * 13 + 250) % 360} 85% 60%)`;
  const paintHud = () => mount(hud, h('span.pill', t('Floors: {n}', { n: floors.length - 1 })), combo > 1 ? h('span.pill', '✨ x' + combo) : null, h('span.pill', t('Best: {s}', { s: Math.max(best, floors.length - 1) })));
  const reset = () => { floors = [{ x: W / 2 - 90, w: 180 }]; speed = 170; camY = 0; camT = 0; chips = []; combo = 0; next(); paintHud(); };
  function next() { const top = floors[floors.length - 1]; dir = floors.length % 2 ? 1 : -1; cur = { x: dir > 0 ? -top.w : W, w: top.w }; }
  function drop() {
    if (!run) return; const top = floors[floors.length - 1]; let x = cur.x, w = cur.w; const d = x - top.x;
    if (Math.abs(d) <= 5) { x = top.x; combo++; snd('coin'); flash = 1; if (combo >= 3) w = Math.min(220, w + 6); }
    else { combo = 0; if (Math.abs(d) >= w) { chips.push({ x: cur.x, y: floors.length, w: cur.w, vy: 0, c: hue(floors.length) }); return die(); } const cut = Math.abs(d); chips.push({ x: d > 0 ? top.x + top.w : x, y: floors.length, w: cut, vy: 0, c: hue(floors.length) }); if (d > 0) { w -= cut; } else { x = top.x; w -= cut; } snd('tick'); }
    floors.push({ x, w }); speed = Math.min(560, speed + 12); camT = Math.max(0, (floors.length - 14) * SH); next(); paintHud();
  }
  function die() { run = false; snd('lose'); const s = floors.length - 1; const ms = performance.now() - t0; setTimeout(() => o.show(t('Game over'), s, null, t('Play again'), begin), 500); if (s > 0) end(s, ms).then((r) => { if (r) best = r.best; paintHud(); }); }
  function frame(now) {
    raf = requestAnimationFrame(frame); const dt = Math.min(0.033, (now - (last || now)) / 1000); last = now;
    if (run) { cur.x += dir * speed * dt; const top = floors[floors.length - 1]; if (dir > 0 && cur.x > W) dir = -1; if (dir < 0 && cur.x + cur.w < 0) dir = 1; void top; }
    camY += (camT - camY) * Math.min(1, dt * 6); flash = Math.max(0, flash - dt * 3);
    const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, `hsl(${(250 + camY / 8) % 360} 55% 12%)`); bg.addColorStop(1, '#05060f'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 50; i++) { g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect((i * 83) % W, ((i * 131 + camY * 0.3) % H), 2, 2); }
    const yOf = (i) => H - 60 - i * SH + camY;
    floors.forEach((f, i) => { const y = yOf(i); if (y > H + SH || y < -SH) return; g.fillStyle = hue(i); g.fillRect(f.x, y, f.w, SH - 2); g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(f.x, y, f.w, 4); });
    if (run) { const y = yOf(floors.length); g.fillStyle = hue(floors.length); g.shadowColor = hue(floors.length); g.shadowBlur = 16; g.fillRect(cur.x, y, cur.w, SH - 2); g.shadowBlur = 0; }
    for (const c of chips) { c.vy += 900 * dt; c.dy = (c.dy || 0) + c.vy * dt; g.globalAlpha = Math.max(0, 1 - c.dy / 400); g.fillStyle = c.c; g.fillRect(c.x, yOf(c.y) + c.dy, c.w, SH - 2); } g.globalAlpha = 1; chips = chips.filter((c) => c.dy < 400);
    if (flash > 0) { g.strokeStyle = `rgba(255,255,255,${flash})`; g.lineWidth = 3; const f = floors[floors.length - 1]; g.strokeRect(f.x - 4, yOf(floors.length - 1) - 4, f.w + 8, SH + 6); g.lineWidth = 1; }
  }
  const begin = () => { o.hide(); reset(); run = true; t0 = performance.now(); cv.focus(); };
  const offK = keyHandler(env, (e) => { if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); drop(); } });
  cv.addEventListener('pointerdown', drop);
  reset(); o.show(t('Star Stack'), null, t('Space or tap to drop the slab. Perfect drops keep it wide.'), t('Start'), begin); raf = requestAnimationFrame(frame);
  return () => { run = false; cancelAnimationFrame(raf); offK(); };
}

export const MORE_FNS = { dash: dashGame, stack: stackGame, blocks: blocksGame, flap: flapGame, paddle: paddleGame, defenders: defendersGame, bricks: bricksGame, memory: memoryGame };
