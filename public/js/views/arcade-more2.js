// Nebulix 3.0 — Bubble Shooter, Tower Defense and Word Search (Spanish and English word lists).
import { h, mount } from '../util.js';
import { t, getLang } from '../i18n.js';
import { sfx } from '../sfx.js';

export const MORE2_GAMES = [
  ['bubbles', 'Bubble Shooter', 'target', 'Aim, bounce and pop groups of three or more bubbles.', 'pts'],
  ['td', 'Tower Defense', 'shield', 'Build towers along the road and stop every wave.', 'pts'],
  ['words', 'Word Search', 'search', 'Find the hidden words in the letter grid.', 'pts'],
];
const snd = (k) => { try { sfx[k] && sfx[k](); } catch {} };
function overlay(board) { const ov = h('div.arc-ov'); board.appendChild(ov); return { show: (title, big, sub, btn, go, extra) => { ov.classList.remove('hide'); mount(ov, h('div.arc-ovc', h('h3', title), big != null ? h('div.arc-big', String(big)) : null, sub ? h('p.muted', sub) : null, extra || null, h('button.btn.primary', { onClick: go }, btn))); }, hide: () => { mount(ov); ov.classList.add('hide'); } }; }

// ================= BUBBLE SHOOTER =================
function bubblesGame(stage, hud, end, best, env) {
  const COLS = 11, R = 18, W = COLS * R * 2 + R, H = 600, COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899'];
  const cv = h('canvas.arc-canvas.arc-tall', { width: W, height: H }); const board = h('div.arc-board.arc-tallwrap', cv); stage.append(board); const o = overlay(board); const g = cv.getContext('2d');
  let grid, shot, next, cur, aim = -Math.PI / 2, score, shots, run = false, raf = 0, last = 0, t0 = 0, falling = [], pops = [], nColors = 4, rowOff = 0;
  const rowY = (r) => R + r * R * 1.73 + 4; const colX = (r, c) => R + c * R * 2 + (((r + rowOff) % 2) ? R : 0);
  const rnd = () => Math.floor(Math.random() * nColors);
  function newRow() { rowOff ^= 1; grid.unshift(Array.from({ length: COLS }, () => rnd())); }
  function begin() { o.hide(); grid = []; rowOff = 0; for (let r = 0; r < 6; r++) grid.push(Array.from({ length: COLS }, () => rnd())); for (let r = 0; r < 8; r++) grid.push(Array(COLS).fill(-1)); cur = rnd(); next = rnd(); score = 0; shots = 0; shot = null; falling = []; pops = []; run = true; t0 = performance.now(); last = t0; cancelAnimationFrame(raf); raf = requestAnimationFrame(loop); paintHud(); }
  const paintHud = () => mount(hud, h('span.pill', t('Score: {s}', { s: score })), h('span.pill', t('Next row in {n}', { n: 6 - (shots % 6) })), h('span.pill', t('Best: {s}', { s: Math.max(best, score) })));
  const nb = (r, c) => { const odd = (r + rowOff) % 2; return [[r, c - 1], [r, c + 1], [r - 1, c - (odd ? 0 : 1)], [r - 1, c + (odd ? 1 : 0)], [r + 1, c - (odd ? 0 : 1)], [r + 1, c + (odd ? 1 : 0)]].filter(([a, b]) => a >= 0 && b >= 0 && b < COLS && a < grid.length); };
  function snap(x, y) { let br = 0, bc = 0, bd = 1e9; for (let r = 0; r < grid.length; r++) for (let c = 0; c < COLS; c++) { if (grid[r][c] !== -1) continue; const d = Math.hypot(colX(r, c) - x, rowY(r) - y); if (d < bd) { bd = d; br = r; bc = c; } } return [br, bc]; }
  function settle(r, c, col) {
    grid[r][c] = col; const same = [[r, c]]; const seen = new Set([r + ',' + c]);
    for (let i = 0; i < same.length; i++) for (const [a, b] of nb(...same[i])) if (!seen.has(a + ',' + b) && grid[a][b] === col) { seen.add(a + ',' + b); same.push([a, b]); }
    if (same.length >= 3) {
      for (const [a, b] of same) { pops.push({ x: colX(a, b), y: rowY(a), c: COLORS[grid[a][b]], t: 0 }); grid[a][b] = -1; } score += same.length * 10; snd('coin');
      // drop everything that no longer hangs from the top row
      const keep = new Set(); const st = []; for (let c2 = 0; c2 < COLS; c2++) if (grid[0][c2] !== -1) { keep.add('0,' + c2); st.push([0, c2]); }
      while (st.length) { const [a, b] = st.pop(); for (const [x, y] of nb(a, b)) if (grid[x][y] !== -1 && !keep.has(x + ',' + y)) { keep.add(x + ',' + y); st.push([x, y]); } }
      let dropped = 0; for (let a = 0; a < grid.length; a++) for (let b = 0; b < COLS; b++) if (grid[a][b] !== -1 && !keep.has(a + ',' + b)) { falling.push({ x: colX(a, b), y: rowY(a), vy: 0, c: COLORS[grid[a][b]] }); grid[a][b] = -1; dropped++; }
      if (dropped) { score += dropped * 20 * Math.min(5, dropped); snd('win'); }
    } else snd('click');
    shots++; if (shots % 6 === 0) { newRow(); }
    while (grid.length > 16 && grid[grid.length - 1].every((v) => v === -1)) grid.pop();
    const lowest = grid.reduce((m, row, r) => (row.some((v) => v !== -1) ? r : m), -1); if (rowY(lowest) > H - 90) return over();
    if (grid.every((row) => row.every((v) => v === -1))) { score += 1000; for (let rr = 0; rr < 5; rr++) newRow(); nColors = Math.min(6, nColors + 1); }
    while (grid.length < 16) grid.push(Array(COLS).fill(-1));
    paintHud();
  }
  function over() { run = false; const ms = performance.now() - t0; o.show(t('Game over'), score, t('The bubbles reached the bottom.'), t('Play again'), begin); if (score > 0) end(score, ms).then((r) => { if (r) best = r.best; }); }
  function loop(now) {
    if (!run) return; raf = requestAnimationFrame(loop); const dt = Math.min(0.033, (now - last) / 1000); last = now;
    if (shot) { for (let k = 0; k < 4; k++) { shot.x += shot.vx * dt / 4; shot.y += shot.vy * dt / 4; if (shot.x < R) { shot.x = R; shot.vx *= -1; } if (shot.x > W - R) { shot.x = W - R; shot.vx *= -1; }
      let hit = shot.y <= R; if (!hit) for (let r = 0; r < grid.length && !hit; r++) for (let c = 0; c < COLS; c++) if (grid[r][c] !== -1 && Math.hypot(colX(r, c) - shot.x, rowY(r) - shot.y) < R * 1.8) { hit = true; break; }
      if (hit) { const [r, c] = snap(shot.x, shot.y); const col = shot.c; shot = null; settle(r, c, col); break; } } }
    for (const f of falling) { f.vy += 1400 * dt; f.y += f.vy * dt; } falling = falling.filter((f) => f.y < H + 40); for (const p of pops) p.t += dt; pops = pops.filter((p) => p.t < 0.35);
    // draw
    const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#1b1046'); bg.addColorStop(1, '#0a0716'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(239,68,68,.35)'; g.setLineDash([6, 6]); g.beginPath(); g.moveTo(0, H - 90); g.lineTo(W, H - 90); g.stroke(); g.setLineDash([]);
    const ball = (x, y, c, r = R - 1) => { const gr = g.createRadialGradient(x - r * .35, y - r * .35, r * .1, x, y, r); gr.addColorStop(0, '#fff'); gr.addColorStop(.25, c); gr.addColorStop(1, c); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.strokeStyle = 'rgba(0,0,0,.25)'; g.stroke(); };
    for (let r = 0; r < grid.length; r++) for (let c = 0; c < COLS; c++) if (grid[r][c] !== -1) ball(colX(r, c), rowY(r), COLORS[grid[r][c]]);
    for (const f of falling) ball(f.x, f.y, f.c); for (const p of pops) { g.globalAlpha = 1 - p.t / 0.35; ball(p.x, p.y, p.c, R * (1 + p.t * 2)); g.globalAlpha = 1; }
    const sx = W / 2, sy = H - 34; g.strokeStyle = 'rgba(255,255,255,.35)'; g.setLineDash([4, 8]); g.beginPath(); let px = sx, py = sy, vx = Math.cos(aim), vy = Math.sin(aim); g.moveTo(px, py); for (let i = 0; i < 60; i++) { px += vx * 8; py += vy * 8; if (px < R || px > W - R) vx *= -1; g.lineTo(px, py); if (py < 20) break; } g.stroke(); g.setLineDash([]);
    if (shot) ball(shot.x, shot.y, COLORS[shot.c]); else ball(sx, sy, COLORS[cur]); ball(sx + 60, sy + 10, COLORS[next], R * 0.7);
  }
  const aimAt = (e) => { const b = cv.getBoundingClientRect(); const x = (e.clientX - b.left) * W / b.width, y = (e.clientY - b.top) * H / b.height; aim = Math.max(-Math.PI + 0.12, Math.min(-0.12, Math.atan2(y - (H - 34), x - W / 2))); };
  cv.addEventListener('pointermove', aimAt);
  cv.addEventListener('pointerup', (e) => { if (!run || shot) return; aimAt(e); shot = { x: W / 2, y: H - 34, vx: Math.cos(aim) * 900, vy: Math.sin(aim) * 900, c: cur }; cur = next; next = rnd(); });
  void env; o.show(t('Bubble Shooter'), null, t('Aim with the mouse or your finger and release to shoot. Bounce off the walls. Groups of 3+ pop, and whatever hangs from them falls.'), t('Start'), begin);
  return () => { run = false; cancelAnimationFrame(raf); };
}

// ================= TOWER DEFENSE =================
function tdGame(stage, hud, end, best, env) {
  const CW = 16, CH = 10, S = 44, W = CW * S, H = CH * S; const cv = h('canvas.arc-canvas.arc-wide', { width: W, height: H }); const bar = h('div.td-bar'); const board = h('div.arc-board.arc-widewrap', cv, bar); stage.append(board); const o = overlay(board); const g = cv.getContext('2d');
  const PATH = [[0, 2], [5, 2], [5, 7], [10, 7], [10, 1], [14, 1], [14, 8], [15, 8]];
  const cells = new Set(); for (let i = 0; i < PATH.length - 1; i++) { const [x0, y0] = PATH[i], [x1, y1] = PATH[i + 1]; for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) cells.add(x + ',' + y); }
  const pts = PATH.map(([x, y]) => [x * S + S / 2, y * S + S / 2]); const segLen = []; let total = 0; for (let i = 0; i < pts.length - 1; i++) { const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); segLen.push(l); total += l; }
  const posAt = (d) => { for (let i = 0; i < segLen.length; i++) { if (d <= segLen[i]) { const k = d / segLen[i]; return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k]; } d -= segLen[i]; } return pts[pts.length - 1]; };
  const TYPES = { blaster: { n: 'Blaster', cost: 50, range: 110, rate: 0.45, dmg: 9, col: '#22d3ee' }, frost: { n: 'Frost', cost: 70, range: 95, rate: 0.9, dmg: 3, slow: 0.5, col: '#93c5fd' }, cannon: { n: 'Cannon', cost: 120, range: 140, rate: 1.6, dmg: 38, splash: 55, col: '#f59e0b' } };
  let towers, enemies, bullets, gold, lives, wave, spawnLeft, spawnT, run = false, raf = 0, last = 0, t0 = 0, pick = 'blaster', score, between = 0, hover = null;
  const paintBar = () => mount(bar, Object.entries(TYPES).map(([k, ty]) => h('button.td-t' + (k === pick ? '.on' : ''), { disabled: gold < ty.cost, onClick: () => { pick = k; paintBar(); } }, h('i', { style: { background: ty.col } }), t(ty.n), h('small', '🪙 ' + ty.cost))), h('span.tiny.muted', t('Click an empty square to build · right-click a tower to sell it (half back)')));
  const paintHud = () => mount(hud, h('span.pill', t('Wave {n}', { n: wave })), h('span.pill', '❤ ' + lives), h('span.pill', '🪙 ' + gold), h('span.pill', t('Score: {s}', { s: score })), h('span.pill', t('Best: {s}', { s: Math.max(best, score) })));
  function begin() { o.hide(); towers = []; enemies = []; bullets = []; gold = 150; lives = 20; wave = 0; score = 0; between = 2; run = true; t0 = performance.now(); last = t0; nextWave(); cancelAnimationFrame(raf); raf = requestAnimationFrame(loop); paintBar(); paintHud(); }
  function nextWave() { wave++; spawnLeft = 6 + wave * 2; spawnT = 0; }
  function loop(now) {
    if (!run) return; raf = requestAnimationFrame(loop); const dt = Math.min(0.033, (now - last) / 1000); last = now;
    if (between > 0) between -= dt; else if (spawnLeft > 0) { spawnT -= dt; if (spawnT <= 0) { spawnT = Math.max(0.35, 1 - wave * 0.04); spawnLeft--; const boss = spawnLeft === 0 && wave % 5 === 0; const hp = (20 + wave * 9) * (boss ? 8 : 1); enemies.push({ d: 0, hp, max: hp, sp: (boss ? 34 : 50 + Math.min(40, wave * 2)), slow: 0, boss }); } }
    else if (!enemies.length) { score += wave * 100; gold += 40 + wave * 5; nextWave(); between = 3; snd('win'); paintBar(); paintHud(); }
    for (const e of enemies) { e.slow = Math.max(0, e.slow - dt); e.d += e.sp * (e.slow > 0 ? 0.5 : 1) * dt; }
    const escaped = enemies.filter((e) => e.d >= total); if (escaped.length) { lives -= escaped.reduce((a, e) => a + (e.boss ? 5 : 1), 0); snd('lose'); enemies = enemies.filter((e) => e.d < total); paintHud(); if (lives <= 0) return over(); }
    for (const tw of towers) { tw.cd -= dt; const ty = TYPES[tw.k]; if (tw.cd > 0) continue; let tgt = null; for (const e of enemies) { const [x, y] = posAt(e.d); if (Math.hypot(x - tw.x, y - tw.y) <= ty.range && (!tgt || e.d > tgt.d)) tgt = e; }
      if (tgt) { tw.cd = ty.rate; const [x, y] = posAt(tgt.d); tw.ang = Math.atan2(y - tw.y, x - tw.x); bullets.push({ x: tw.x, y: tw.y, tgt, k: tw.k, sp: tw.k === 'cannon' ? 320 : 520 }); } }
    for (const b of bullets) { if (b.tgt.hp <= 0 && !enemies.includes(b.tgt)) { b.dead = true; continue; } const [x, y] = posAt(b.tgt.d); const dx = x - b.x, dy = y - b.y, dd = Math.hypot(dx, dy); if (dd < 8) { b.dead = true; const ty = TYPES[b.k];
        if (ty.splash) { for (const e of enemies) { const [ex, ey] = posAt(e.d); if (Math.hypot(ex - x, ey - y) < ty.splash) e.hp -= ty.dmg; } } else b.tgt.hp -= ty.dmg; if (ty.slow) b.tgt.slow = 1.2; } else { b.x += dx / dd * b.sp * dt; b.y += dy / dd * b.sp * dt; } }
    bullets = bullets.filter((b) => !b.dead); const dead = enemies.filter((e) => e.hp <= 0); if (dead.length) { gold += dead.reduce((a, e) => a + (e.boss ? 60 : 6), 0); score += dead.length * 10; enemies = enemies.filter((e) => e.hp > 0); snd('coin'); paintBar(); paintHud(); }
    // draw
    g.fillStyle = '#0f1f17'; g.fillRect(0, 0, W, H); for (let x = 0; x < CW; x++) for (let y = 0; y < CH; y++) { g.fillStyle = cells.has(x + ',' + y) ? '#3b2f1f' : (x + y) % 2 ? '#14281c' : '#122419'; g.fillRect(x * S, y * S, S, S); }
    if (hover && !cells.has(hover.join(',')) && !towers.some((tw) => tw.cx === hover[0] && tw.cy === hover[1])) { const ty = TYPES[pick]; g.fillStyle = 'rgba(255,255,255,.08)'; g.beginPath(); g.arc(hover[0] * S + S / 2, hover[1] * S + S / 2, ty.range, 0, 7); g.fill(); }
    for (const tw of towers) { const ty = TYPES[tw.k]; g.fillStyle = '#1f2937'; g.fillRect(tw.cx * S + 6, tw.cy * S + 6, S - 12, S - 12); g.save(); g.translate(tw.x, tw.y); g.rotate(tw.ang || 0); g.fillStyle = ty.col; g.shadowColor = ty.col; g.shadowBlur = 12; g.fillRect(-4, -4, 20, 8); g.beginPath(); g.arc(0, 0, 9, 0, 7); g.fill(); g.restore(); }
    g.shadowBlur = 0; for (const e of enemies) { const [x, y] = posAt(e.d); const r = e.boss ? 15 : 10; g.fillStyle = e.slow > 0 ? '#93c5fd' : e.boss ? '#ef4444' : '#f472b6'; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.fillStyle = '#000a'; g.fillRect(x - 14, y - r - 8, 28, 4); g.fillStyle = '#4ade80'; g.fillRect(x - 14, y - r - 8, 28 * Math.max(0, e.hp / e.max), 4); }
    for (const b of bullets) { g.fillStyle = TYPES[b.k].col; g.beginPath(); g.arc(b.x, b.y, b.k === 'cannon' ? 5 : 3, 0, 7); g.fill(); }
    if (between > 0 && wave) { g.fillStyle = '#fff'; g.font = '800 26px system-ui'; g.textAlign = 'center'; g.fillText(t('Wave {n}', { n: wave }), W / 2, 40); g.textAlign = 'left'; }
  }
  function over() { run = false; const ms = performance.now() - t0; o.show(t('Game over'), score, t('You held out until wave {n}', { n: wave }), t('Play again'), begin); if (score > 0) end(score, ms).then((r) => { if (r) best = r.best; }); }
  const cellAt = (e) => { const b = cv.getBoundingClientRect(); return [Math.floor((e.clientX - b.left) * W / b.width / S), Math.floor((e.clientY - b.top) * H / b.height / S)]; };
  cv.addEventListener('pointermove', (e) => { hover = cellAt(e); }); cv.addEventListener('pointerleave', () => { hover = null; });
  cv.addEventListener('click', (e) => { if (!run) return; const [cx, cy] = cellAt(e); if (cells.has(cx + ',' + cy) || towers.some((tw) => tw.cx === cx && tw.cy === cy)) return; const ty = TYPES[pick]; if (gold < ty.cost) return snd('lose'); gold -= ty.cost; towers.push({ k: pick, cx, cy, x: cx * S + S / 2, y: cy * S + S / 2, cd: 0 }); snd('click'); paintBar(); paintHud(); });
  cv.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!run) return; const [cx, cy] = cellAt(e); const i = towers.findIndex((tw) => tw.cx === cx && tw.cy === cy); if (i >= 0) { gold += Math.floor(TYPES[towers[i].k].cost / 2); towers.splice(i, 1); paintBar(); paintHud(); } });
  void env; o.show(t('Tower Defense'), null, t('Build towers next to the road. Blasters shoot fast, Frost slows, Cannons hit groups. Every fifth wave brings a boss.'), t('Start'), begin);
  return () => { run = false; cancelAnimationFrame(raf); };
}

// ================= WORD SEARCH =================
const WORDS = {
  es: { 'Animales': ['GATO', 'PERRO', 'TIGRE', 'CABALLO', 'DELFIN', 'AGUILA', 'CONEJO', 'TORTUGA', 'LEON', 'ZORRO', 'PINGUINO', 'JIRAFA'], 'Espacio': ['PLANETA', 'ESTRELLA', 'COMETA', 'GALAXIA', 'LUNA', 'SOL', 'COHETE', 'ORBITA', 'NEBULOSA', 'MARTE', 'SATURNO', 'ASTRONAUTA'], 'Tecnologia': ['CODIGO', 'TECLADO', 'PANTALLA', 'RATON', 'INTERNET', 'ROBOT', 'DATOS', 'NUBE', 'PIXEL', 'SERVIDOR', 'JUEGO', 'MOVIL'], 'Comida': ['PIZZA', 'TORTILLA', 'PAELLA', 'MANZANA', 'QUESO', 'PAN', 'SOPA', 'GALLETA', 'FRESA', 'CHOCOLATE', 'ARROZ', 'NARANJA'] },
  en: { 'Animals': ['CAT', 'DOG', 'TIGER', 'HORSE', 'DOLPHIN', 'EAGLE', 'RABBIT', 'TURTLE', 'LION', 'FOX', 'PENGUIN', 'GIRAFFE'], 'Space': ['PLANET', 'STAR', 'COMET', 'GALAXY', 'MOON', 'SUN', 'ROCKET', 'ORBIT', 'NEBULA', 'MARS', 'SATURN', 'ASTRONAUT'], 'Technology': ['CODE', 'KEYBOARD', 'SCREEN', 'MOUSE', 'INTERNET', 'ROBOT', 'DATA', 'CLOUD', 'PIXEL', 'SERVER', 'GAME', 'PHONE'], 'Food': ['PIZZA', 'PASTA', 'APPLE', 'CHEESE', 'BREAD', 'SOUP', 'COOKIE', 'BERRY', 'CHOCOLATE', 'RICE', 'ORANGE', 'BURGER'] },
};
function wordsGame(stage, hud, end, best, env) {
  const N = 12; const board = h('div.arc-board.ws-board'); const grid = h('div.ws-grid'); const list = h('div.ws-list'); board.append(h('div.ws-wrap', grid, list)); stage.append(board); const o = overlay(board);
  let letters, placed, found, sel = null, cur = [], t0 = 0, tick = 0, theme = null, over = false;
  const L = getLang() === 'es' ? 'es' : 'en'; const ABC = L === 'es' ? 'ABCDEFGHIJKLMNÑOPQRSTUVWXYZ' : 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const DIRS = [[0, 1], [1, 0], [1, 1], [-1, 1], [0, -1], [-1, 0], [-1, -1], [1, -1]];
  function build() {
    const themes = Object.keys(WORDS[L]); theme = themes[Math.floor(Math.random() * themes.length)];
    const pool = WORDS[L][theme].slice().sort(() => Math.random() - 0.5); letters = Array(N * N).fill(''); placed = [];
    for (const w of pool) { if (placed.length >= 9) break; for (let tries = 0; tries < 200; tries++) { const [dr, dc] = DIRS[Math.floor(Math.random() * (placed.length < 3 ? 3 : 8))]; const r = Math.floor(Math.random() * N), c = Math.floor(Math.random() * N); const er = r + dr * (w.length - 1), ec = c + dc * (w.length - 1); if (er < 0 || er >= N || ec < 0 || ec >= N) continue;
      let ok = true; for (let k = 0; k < w.length; k++) { const x = letters[(r + dr * k) * N + c + dc * k]; if (x && x !== w[k]) { ok = false; break; } } if (!ok) continue;
      const cells = []; for (let k = 0; k < w.length; k++) { const i = (r + dr * k) * N + c + dc * k; letters[i] = w[k]; cells.push(i); } placed.push({ w, cells }); break; } }
    for (let i = 0; i < letters.length; i++) if (!letters[i]) letters[i] = ABC[Math.floor(Math.random() * ABC.length)];
  }
  const paintHud = () => mount(hud, h('span.pill', '📚 ' + t(theme || '')), h('span.pill', found.length + '/' + placed.length), h('span.pill', '⏱ ' + Math.floor((performance.now() - t0) / 1000) + ' s'), h('span.pill', t('Best: {s}', { s: best })));
  function begin() { o.hide(); build(); found = []; sel = null; cur = []; over = false; t0 = performance.now(); clearInterval(tick); tick = setInterval(paintHud, 1000); paint(); paintHud(); }
  const line = (a, b) => { const ar = Math.floor(a / N), ac = a % N, br = Math.floor(b / N), bc = b % N; const dr = Math.sign(br - ar), dc = Math.sign(bc - ac); const len = Math.max(Math.abs(br - ar), Math.abs(bc - ac)); if (!(ar === br || ac === bc || Math.abs(br - ar) === Math.abs(bc - ac))) return [a]; return Array.from({ length: len + 1 }, (_, k) => (ar + dr * k) * N + ac + dc * k); };
  function finishSel() {
    if (!cur.length) return; const word = cur.map((i) => letters[i]).join(''); const p = placed.find((x) => !found.includes(x.w) && (x.cells.join() === cur.join() || x.cells.slice().reverse().join() === cur.join()));
    if (p) { found.push(p.w); snd('coin'); if (found.length === placed.length) win(); } else if (word.length > 1) snd('lose');
    sel = null; cur = []; paint(); paintHud();
  }
  function win() { over = true; clearInterval(tick); const ms = performance.now() - t0; const sc = Math.round(placed.length * 100 + Math.max(0, 600 - ms / 1000) * 2); snd('win'); setTimeout(() => o.show(t('All found!'), sc, t('Time: {t}', { t: Math.round(ms / 1000) + ' s' }), t('Play again'), begin), 400); end(sc, ms).then((r) => { if (r) best = r.best; }); }
  function paint() {
    const foundCells = new Set(placed.filter((p) => found.includes(p.w)).flatMap((p) => p.cells)); const curSet = new Set(cur);
    mount(grid, letters.map((ch, i) => h('div.ws-c' + (foundCells.has(i) ? '.found' : '') + (curSet.has(i) ? '.sel' : ''), { dataset: { i } }, ch)));
    mount(list, h('b', t(theme)), placed.map((p) => h('span.ws-w' + (found.includes(p.w) ? '.done' : ''), p.w)));
  }
  const cellFromEv = (e) => { const el = document.elementFromPoint(e.clientX, e.clientY); return el && el.classList.contains('ws-c') ? Number(el.dataset.i) : null; };
  grid.addEventListener('pointerdown', (e) => { if (over) return; const i = cellFromEv(e); if (i === null) return; e.preventDefault(); sel = i; cur = [i]; paint(); });
  const mv = (e) => { if (sel === null || !grid.isConnected) return; const i = cellFromEv(e); if (i === null) return; const ln = line(sel, i); if (ln.join() !== cur.join()) { cur = ln; paint(); } }; addEventListener('pointermove', mv);
  const up = () => { if (sel !== null) finishSel(); }; addEventListener('pointerup', up);
  void env; o.show(t('Word Search'), null, t('Drag across the letters to mark a word (any direction, also backwards and diagonally). Find them all as fast as you can.'), t('Start'), begin);
  return () => { clearInterval(tick); removeEventListener('pointerup', up); removeEventListener('pointermove', mv); };
}

export const MORE2_FNS = { bubbles: bubblesGame, td: tdGame, words: wordsGame };
