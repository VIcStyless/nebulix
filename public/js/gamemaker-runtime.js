// Nebulix Game Maker runtime (3.0 phase 19). ONE self-contained function: the editor runs it for play-testing and the
// published Hub game embeds its source text (runGame.toString()), so both behave exactly the same. No imports, no
// outside variables. level = { w, h, tiles: string[] (rows), title, bg, fg, gravity, jump, speed }
// Tiles: '.' empty, '#' ground, 'B' brick, '^' spikes, 'o' coin, 'S' start, 'G' goal, 'E' enemy, 'J' spring.
export function runGame(canvas, level, hooks) {
  hooks = hooks || {};
  const T = 32; const g = canvas.getContext('2d'); const W = level.w, H = level.h;
  const grav = (level.gravity || 10) * 0.12, jumpV = -(level.jump || 10) * 1.05, speed = (level.speed || 10) * 0.32;
  let grid, coins, enemies, p, cam, state, score, collected, time, keys = {}, raf = 0, last = 0, deaths = 0, stopped = false, steps = 0;
  const solid = (c) => c === '#' || c === 'B';
  const at = (x, y) => (x < 0 || x >= W ? '#' : y < 0 ? '.' : y >= H ? '.' : grid[y][x]);
  function reset(full) {
    grid = level.tiles.map((r) => r.padEnd(W, '.').slice(0, W).split('')); coins = 0; collected = 0; enemies = []; let sx = 1, sy = 1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = grid[y][x]; if (c === 'S') { sx = x; sy = y; grid[y][x] = '.'; } else if (c === 'E') { enemies.push({ x: x * T, y: y * T, vx: -1.2, vy: 0, alive: true }); grid[y][x] = '.'; } else if (c === 'o') coins++; }
    p = { x: sx * T + 4, y: sy * T, w: 24, h: 30, vx: 0, vy: 0, ground: false }; cam = 0; state = 'play'; time = 0; steps = 0; if (full) { score = 0; deaths = 0; }
  }
  function collide(o, dx, dy) {
    o.x += dx; let x0 = Math.floor(o.x / T), x1 = Math.floor((o.x + o.w - 1) / T), y0 = Math.floor(o.y / T), y1 = Math.floor((o.y + o.h - 1) / T);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (solid(at(x, y))) { if (dx > 0) o.x = x * T - o.w; else if (dx < 0) o.x = (x + 1) * T; o.vx = o.isEnemy ? -o.vx : 0; return true; }
    o.y += dy; x0 = Math.floor(o.x / T); x1 = Math.floor((o.x + o.w - 1) / T); y0 = Math.floor(o.y / T); y1 = Math.floor((o.y + o.h - 1) / T); o.ground = false;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (solid(at(x, y))) { if (dy > 0) { o.y = y * T - o.h; o.ground = true; } else if (dy < 0) o.y = (y + 1) * T; o.vy = 0; return true; }
    return false;
  }
  function die() { deaths++; if (hooks.onEvent) hooks.onEvent('death'); state = 'dead'; setTimeout(() => { if (!stopped) { const s = score; reset(false); score = s; } }, 900); }
  function step() {
    if (state !== 'play') return; time += 1 / 60; if (hooks.onStep) hooks.onStep(steps++); // optional: replays and tests drive input per physics step
    const left = keys.ArrowLeft || keys.a || keys.A, right = keys.ArrowRight || keys.d || keys.D, jump = keys[' '] || keys.ArrowUp || keys.w || keys.W;
    p.vx = (right ? speed : 0) - (left ? speed : 0); if (jump && p.ground) { p.vy = jumpV; p.ground = false; }
    p.vy = Math.min(p.vy + grav, 14); collide(p, p.vx, 0); collide(p, 0, p.vy);
    if (p.y > H * T + 64) return die();
    const cx0 = Math.floor(p.x / T), cx1 = Math.floor((p.x + p.w - 1) / T), cy0 = Math.floor(p.y / T), cy1 = Math.floor((p.y + p.h - 1) / T);
    for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) { const c = at(x, y);
      if (c === 'o') { grid[y][x] = '.'; collected++; score += 100; if (hooks.onEvent) hooks.onEvent('coin'); }
      else if (c === '^') return die();
      else if (c === 'J' && p.vy >= 0) { p.vy = jumpV * 1.6; }
      else if (c === 'G') { state = 'won'; const bonus = Math.max(0, Math.round(3000 - time * 30)); score += 1000 + bonus; if (hooks.onWin) hooks.onWin({ score, time, coins: collected, total: coins, deaths }); return; } }
    for (const e of enemies) { if (!e.alive) continue; e.isEnemy = true; e.w = 26; e.h = 26; e.vy = Math.min(e.vy + grav, 14);
      const ahead = at(Math.floor((e.vx > 0 ? e.x + e.w + 1 : e.x - 1) / T), Math.floor((e.y + e.h + 2) / T)); if (!solid(ahead) && e.ground) e.vx = -e.vx;
      collide(e, e.vx, 0); collide(e, 0, e.vy);
      if (p.x < e.x + e.w && p.x + p.w > e.x && p.y < e.y + e.h && p.y + p.h > e.y) { if (p.vy > 0 && p.y + p.h - e.y < 14) { e.alive = false; p.vy = jumpV * 0.6; score += 200; } else return die(); } }
    cam += (Math.max(0, Math.min(W * T - canvas.width, p.x - canvas.width / 2)) - cam) * 0.15;
  }
  function draw() {
    const vw = canvas.width, vh = canvas.height; g.fillStyle = level.bg || '#7dd3fc'; g.fillRect(0, 0, vw, vh); const oy = Math.max(0, vh - H * T);
    g.save(); g.translate(-Math.round(cam), oy);
    const x0 = Math.max(0, Math.floor(cam / T)), x1 = Math.min(W, Math.ceil((cam + vw) / T) + 1);
    for (let y = 0; y < H; y++) for (let x = x0; x < x1; x++) { const c = grid[y][x], px = x * T, py = y * T;
      if (c === '#') { g.fillStyle = level.fg || '#16a34a'; g.fillRect(px, py, T, T); g.fillStyle = 'rgba(0,0,0,.15)'; g.fillRect(px, py + T - 6, T, 6); if (at(x, y - 1) !== '#') { g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(px, py, T, 5); } }
      else if (c === 'B') { g.fillStyle = '#b45309'; g.fillRect(px, py, T, T); g.strokeStyle = '#78350f'; g.lineWidth = 2; g.strokeRect(px + 1, py + 1, T - 2, T / 2 - 1); g.strokeRect(px + 1, py + T / 2, T - 2, T / 2 - 1); }
      else if (c === '^') { g.fillStyle = '#94a3b8'; for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(px + i * 8, py + T); g.lineTo(px + i * 8 + 4, py + 10); g.lineTo(px + i * 8 + 8, py + T); g.fill(); } }
      else if (c === 'o') { g.fillStyle = '#facc15'; g.beginPath(); g.ellipse(px + 16, py + 16, 8 + Math.sin(time * 6 + x) * 2, 10, 0, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#ca8a04'; g.stroke(); }
      else if (c === 'J') { g.fillStyle = '#ef4444'; g.fillRect(px + 4, py + 18, T - 8, 14); g.fillStyle = '#fca5a5'; g.fillRect(px + 2, py + 14, T - 4, 6); }
      else if (c === 'G') { g.fillStyle = '#e5e7eb'; g.fillRect(px + 14, py - T * 2, 4, T * 3); g.fillStyle = '#22c55e'; g.beginPath(); g.moveTo(px + 18, py - T * 2); g.lineTo(px + 34, py - T * 2 + 10); g.lineTo(px + 18, py - T * 2 + 20); g.fill(); } }
    for (const e of enemies) if (e.alive) { g.fillStyle = '#7c3aed'; g.beginPath(); g.ellipse(e.x + 13, e.y + 15, 13, 12, 0, 0, Math.PI * 2); g.fill(); g.fillStyle = '#fff'; g.fillRect(e.x + 6, e.y + 8, 5, 6); g.fillRect(e.x + 15, e.y + 8, 5, 6); }
    if (state !== 'dead' || Math.floor(Date.now() / 100) % 2) { g.fillStyle = '#f97316'; g.fillRect(p.x, p.y, p.w, p.h); g.fillStyle = '#fff'; g.fillRect(p.x + (p.vx < 0 ? 4 : 14), p.y + 7, 6, 6); g.fillStyle = '#1e293b'; g.fillRect(p.x + (p.vx < 0 ? 5 : 16), p.y + 9, 3, 3); }
    g.restore();
    g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(8, 8, 250, 30); g.fillStyle = '#fff'; g.font = 'bold 16px system-ui, sans-serif'; g.textBaseline = 'middle'; g.fillText('★ ' + score + '   ● ' + collected + '/' + coins + '   ⏱ ' + time.toFixed(1), 18, 23);
    if (state === 'won') { g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(0, 0, vw, vh); g.fillStyle = '#fff'; g.textAlign = 'center'; g.font = 'bold 40px system-ui'; g.fillText('¡Nivel completado!', vw / 2, vh / 2 - 20); g.font = '20px system-ui'; g.fillText(score + ' puntos · R para repetir', vw / 2, vh / 2 + 24); g.textAlign = 'left'; }
  }
  function loop(now) { if (stopped) return; if (!last) last = now; let acc = Math.min(100, now - last); last = now; while (acc > 0) { step(); acc -= 1000 / 60; } draw(); raf = requestAnimationFrame(loop); }
  const kd = (e) => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', ' ', 'ArrowDown'].includes(e.key)) e.preventDefault(); keys[e.key] = true; if ((e.key === 'r' || e.key === 'R') && state === 'won') { reset(true); } };
  const ku = (e) => { keys[e.key] = false; };
  addEventListener('keydown', kd); addEventListener('keyup', ku);
  reset(true); raf = requestAnimationFrame(loop);
  return { press: (k, on) => { keys[k] = on; }, restart: () => reset(true), stop: () => { stopped = true; cancelAnimationFrame(raf); removeEventListener('keydown', kd); removeEventListener('keyup', ku); }, get state() { return { state, score, collected, coins, x: p.x, y: p.y, deaths }; } };
}
