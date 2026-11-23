// Nebula Dash (13.8): an original rhythm runner. #/dash
// Auto-running levels with four vehicles of our own — Cube (jump), Rocket (hold to rise), Gravi-ball (tap flips gravity)
// and Dart (hold to go up diagonally) — pads, jump orbs, vehicle portals, practice mode with checkpoints, attempts,
// progress, a beat made live with WebAudio, and a level editor with share codes. Completing levels pays coins.
import { h, mount, fmt, ls } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { S, patchMe } from '../state.js';
import { icon } from '../icons.js';
import { toast, toastErr, promptBox } from '../ui.js';

const TILE = 40; const SPEED = 10.4; const CEIL = 9; // tiles
const MODES = { cube: ['Cube', 'Cubo', '#a3e635'], rocket: ['Rocket', 'Cohete', '#38bdf8'], ball: ['Gravi-ball', 'Gravi-bola', '#f472b6'], dart: ['Dart', 'Dardo', '#fbbf24'] };
const L = (p) => ((document.documentElement.lang || 'es') === 'es' ? p[1] : p[0]);

// ---------- levels (tile units; y = height above the ground) ----------
function build(fn) { const o = []; const api2 = { B: (x, y = 0, w = 1, hh = 1) => { for (let i = 0; i < w; i++) for (let j = 0; j < hh; j++) o.push({ t: 'B', x: x + i, y: y + j }); }, S: (x, y = 0, n = 1) => { for (let i = 0; i < n; i++) o.push({ t: 'S', x: x + i, y }); }, P: (x, y = 0) => o.push({ t: 'P', x, y }), O: (x, y) => o.push({ t: 'O', x, y }), M: (x, mode) => o.push({ t: 'M', x, y: 0, m: mode }), C: (x, y = 0, n = 1) => { for (let i = 0; i < n; i++) o.push({ t: 'C', x: x + i, y: CEIL - 1 - y }); } }; const end = fn(api2); o.push({ t: 'E', x: end, y: 0 }); return o; }
const LEVELS = [
  { id: 'stardust', n: ['Stardust Run', 'Carrera Estelar'], diff: 1, bpm: 120, col: ['#1e1b4b', '#4c1d95'], data: build(({ B, S, P, O, M }) => {
    S(12); S(20); S(28, 0, 2); B(36); S(40); B(44, 0, 2); B(46, 0, 1, 2); S(52, 0, 2); P(58); S(60, 0, 3); B(66, 0, 3); S(70); O(76, 2); S(76, 0, 3); B(82); B(84, 0, 1, 2); B(86, 0, 1, 3); S(92, 0, 2);
    M(98, 'rocket'); for (let k = 0, x = 104; x < 150; x += 6, k++) { const g = 2 + (k % 3); B(x, 0, 1, g); B(x, g + 4, 1, CEIL - g - 4); } M(152, 'cube'); S(160); S(166, 0, 2); B(172, 0, 2); S(178, 0, 3); P(184); S(186, 0, 4); B(194, 0, 4); S(198, 0, 2); return 206; }) },
  { id: 'neon', n: ['Neon Gravity', 'Gravedad Neón'], diff: 2, bpm: 132, col: ['#082f49', '#831843'], data: build(({ B, S, P, O, M, C }) => {
    S(14, 0, 2); B(20, 0, 2); S(24); P(30); S(32, 0, 4); O(40, 2); S(39, 0, 4); B(46, 0, 1, 2); S(50, 0, 3);
    M(56, 'ball'); for (let x = 64; x < 120; x += 20) { S(x, 0, 2); C(x + 10, 0, 2); } M(124, 'dart'); for (let k = 0, x = 132; x < 176; x += 10, k++) { B(x, 0, 1, 2 + (k % 2)); B(x + 5, 6 - (k % 2), 1, CEIL - 6 + (k % 2)); } M(180, 'cube'); S(186, 0, 3); B(192, 0, 1, 2); S(196, 0, 3); P(202); S(204, 0, 5); B(212); O(216, 3); S(215, 0, 4); return 224; }) },
  { id: 'overdrive', n: ['Overdrive', 'Sobrecarga'], diff: 3, bpm: 145, col: ['#450a0a', '#1e293b'], data: build(({ B, S, P, O, M, C }) => {
    S(10, 0, 3); B(16, 0, 2); S(18, 0, 2); B(22, 0, 1, 2); S(25, 0, 3); O(31, 2); S(30, 0, 3); P(36); S(37, 0, 5); B(44, 0, 1, 3); S(47, 0, 4);
    M(54, 'rocket'); for (let k = 0, x = 60; x < 110; x += 5, k++) { const g = 1 + ((k * 3) % 4); B(x, 0, 1, g); B(x, g + 4, 1, CEIL - g - 4); } M(112, 'ball'); for (let x = 118; x < 160; x += 16) { S(x, 0, 3); C(x + 8, 0, 3); } M(164, 'dart'); for (let k = 0, x = 170; x < 214; x += 8, k++) { const g = 2 + (k % 3); B(x, 0, 1, g); B(x + 4, g + 3, 1, CEIL - g - 3); }
    M(218, 'cube'); S(224, 0, 3); B(230, 0, 2); S(232, 0, 3); P(238); S(240, 0, 6); B(248, 0, 1, 2); B(250, 0, 1, 3); S(254, 0, 4); return 262; }) },
];

export default {
  title: () => 'Nebula Dash', full: true,
  async mount(root, ctx) {
    const box = h('div.dsh'); mount(root, box); let stop = null;
    const best = () => ls('dash.best') || {};
    function menu() {
      if (stop) { stop(); stop = null; }
      const mine = ls('dash.mylevels') || [];
      mount(box, h('div.dsh-menu', h('h2', 'Nebula Dash'), h('p.muted', t('A rhythm runner made for Nebulix. Space, click or tap to jump. Get to the end!')),
        h('div.dsh-levels', LEVELS.map((lv) => h('button.dsh-lv', { style: { '--c1': lv.col[0], '--c2': lv.col[1] }, onClick: () => play(lv, false) }, h('b', L(lv.n)), h('span', '★'.repeat(lv.diff) + '☆'.repeat(3 - lv.diff)), h('div.dsh-bar', h('i', { style: { width: (best()[lv.id] || 0) + '%' } })), h('span.tiny', t('Best: {p}%', { p: best()[lv.id] || 0 }))))),
        h('div.row', { style: 'gap:8px;flex-wrap:wrap;justify-content:center' }, h('button.btn', { onClick: editor }, icon('edit', 15), t('Level editor')), h('button.btn', { onClick: loadCode }, icon('download', 15), t('Play a shared level'))),
        mine.length ? h('div', h('h3', t('My levels')), h('div.dsh-levels', mine.map((m, i) => h('button.dsh-lv.mine', { onClick: () => play({ id: 'my' + i, n: [m.name, m.name], diff: 1, bpm: 128, col: ['#0f172a', '#334155'], data: m.data, custom: true }, false) }, h('b', m.name), h('span.tiny', t('{n} objects', { n: m.data.length })))))) : null,
        h('p.tiny.muted', t('Controls: Space / Up / click to jump. Cube: jump. Rocket: hold to rise. Gravi-ball: tap to flip gravity. Dart: hold to go up, release to go down. P: practice mode (checkpoints). Esc: menu.'))));
    }
    async function loadCode() { const c = await promptBox(t('Play a shared level'), { label: t('Paste the level code'), multiline: true }); if (!c) return; try { const lv = JSON.parse(decodeURIComponent(escape(atob(c.trim())))); if (!Array.isArray(lv.data) || lv.data.length > 5000) throw 0; play({ id: 'shared', n: [lv.name || 'Shared', lv.name || 'Compartido'], diff: 1, bpm: 128, col: ['#111827', '#1f2937'], data: lv.data.filter((o) => o && 'BSPOMCE'.includes(o.t) && Number.isFinite(o.x) && Number.isFinite(o.y)), custom: true }, false); } catch { toast(t('That code is not valid'), 'err'); } }

    // ---------- game ----------
    function play(lv, practice) {
      if (stop) stop();
      const cv = h('canvas.dsh-cv'); const hud = h('div.dsh-hud'); const ov = h('div.dsh-ov');
      mount(box, h('div.dsh-game', cv, hud, ov, h('div.dsh-top', h('button.btn.sm.ghost', { onClick: menu }, icon('back', 14), t('Levels')), h('b.grow', L(lv.n)), h('button.btn.sm', { onClick: () => { practice = !practice; checkpoints = []; restart(); } }, practice ? t('Practice: on') : t('Practice: off')))));
      const g = cv.getContext('2d'); let W = 0, H = 0;
      const resize = () => { const r = cv.getBoundingClientRect(); W = cv.width = Math.round(r.width * devicePixelRatio); H = cv.height = Math.round(r.height * devicePixelRatio); };
      const ro = new ResizeObserver(resize); ro.observe(cv);
      const end = (lv.data.find((o) => o.t === 'E') || { x: 200 }).x; const objs = lv.data.filter((o) => o.t !== 'E').sort((a, b) => a.x - b.x);
      let p, attempts = 0, dead = false, won = false, hold = false, pressed = false, checkpoints = [], parts = [], last = performance.now(), raf = 0, deathAt = 0;
      function restart() { const cp = practice && checkpoints.length ? checkpoints[checkpoints.length - 1] : null; p = cp ? Object.assign({}, cp) : { x: 0, y: 0, vy: 0, mode: 'cube', grav: 1, rot: 0, onGround: true, usedOrbs: new Set() }; p.usedOrbs = new Set(); dead = false; won = false; attempts++; mount(ov); paintHud(); music.start(lv.bpm, p.x / SPEED); }
      const paintHud = () => mount(hud, h('span', t('Attempt {n}', { n: attempts })), h('div.dsh-prog', h('i', { style: { width: Math.min(100, (p.x / end) * 100) + '%' } })), h('span', Math.floor(Math.min(100, (p.x / end) * 100)) + '%'), practice ? h('span.pill', t('Practice')) : null, h('span.pill', { style: { background: MODES[p.mode][2], color: '#111' } }, L(MODES[p.mode])));
      const near = (x0, x1) => { const out = []; for (const o of objs) { if (o.x > x1) break; if (o.x + 1 >= x0) out.push(o); } return out; };
      function die() { if (dead || won) return; dead = true; deathAt = performance.now(); music.stop(); for (let i = 0; i < 26; i++) parts.push({ x: p.x + 0.5, y: p.y + 0.5, vx: (Math.random() - 0.5) * 14, vy: (Math.random() - 0.3) * 14, life: 0.8, c: MODES[p.mode][2] }); const pct = Math.floor(Math.min(100, (p.x / end) * 100)); if (!practice && !lv.custom) { const b = best(); if (pct > (b[lv.id] || 0)) { b[lv.id] = pct; ls('dash.best', b); } } setTimeout(() => { if (!won && box.isConnected) restart(); }, 700); }
      async function win() { won = true; music.stop(); const b = best(); if (!practice && !lv.custom) { b[lv.id] = 100; ls('dash.best', b); }
        mount(ov, h('div.dsh-win', h('h2', t('Level complete!')), h('p', t('{n} attempts', { n: attempts })), practice ? h('p.muted', t('Now try it without practice mode for the reward.')) : null, h('div.row', { style: 'gap:8px;justify-content:center' }, h('button.btn.primary', { onClick: () => { attempts = 0; checkpoints = []; restart(); } }, t('Play again')), h('button.btn', { onClick: menu }, t('Levels')))));
        if (!practice && !lv.custom) { try { const r = await api.post('/api/dash/complete', { level: lv.id, attempts }); if (r.coins) { toast(t('+{n} coins', { n: fmt.coins(r.coins) }), 'good'); if (S.me) patchMe({ coins: S.me.coins + r.coins }); } } catch (e) { toastErr(e); } } }
      function step(dt) {
        if (dead || won) return;
        p.x += SPEED * dt; const m = p.mode; const box2 = () => ({ x0: p.x + 0.1, x1: p.x + 0.9, y0: p.y + 0.1, y1: p.y + 0.9 });
        if (m === 'cube') { p.vy -= 88 * dt; if (hold && p.onGround) { p.vy = 21.5; p.onGround = false; } }
        else if (m === 'rocket') { p.vy += (hold ? 55 : -55) * dt; p.vy = Math.max(-13, Math.min(13, p.vy)); }
        else if (m === 'ball') { p.vy -= 70 * p.grav * dt; if (pressed && p.onGround) { p.grav *= -1; p.onGround = false; p.vy = -6 * p.grav; } }
        else if (m === 'dart') { p.vy = hold ? SPEED : -SPEED; }
        pressed = false; const prevY = p.y; p.y += p.vy * dt; p.onGround = false;
        // floor and ceiling (cube and ball land on the floor; rocket, ball and dart are bounded by the ceiling; dart dies on both)
        if (p.y <= 0) { p.y = 0; if (p.vy < 0) { p.vy = 0; } if (m !== 'ball' || p.grav > 0) p.onGround = true; }
        if (m !== 'cube' && p.y >= CEIL - 1) { p.y = CEIL - 1; if (p.vy > 0) p.vy = 0; if (m === 'ball' && p.grav < 0) p.onGround = true; }
        for (const o of near(p.x - 1, p.x + 2)) {
          const b = box2();
          if (o.t === 'B' || o.t === 'C') { const ox0 = o.x, ox1 = o.x + 1, oy0 = o.y, oy1 = o.y + (o.t === 'C' ? 1 : 1); if (b.x1 > ox0 && b.x0 < ox1 && b.y1 > oy0 && b.y0 < oy1) {
            if (o.t === 'C') return die();
            if (m === 'dart') return die();
            // land on top (falling, was above) / under it upside down; otherwise it is a wall
            if ((m === 'cube' || m === 'rocket' || (m === 'ball' && p.grav > 0)) && prevY >= oy1 - 0.25 && p.vy <= 0) { p.y = oy1; p.vy = 0; p.onGround = true; }
            else if ((m === 'rocket' || (m === 'ball' && p.grav < 0)) && prevY + 1 <= oy0 + 0.25 && p.vy >= 0) { p.y = oy0 - 1; p.vy = 0; if (m === 'ball') p.onGround = true; }
            else return die(); } }
          else if (o.t === 'S') { const sx0 = o.x + 0.25, sx1 = o.x + 0.75, sy0 = o.y, sy1 = o.y + 0.6; if (b.x1 > sx0 && b.x0 < sx1 && b.y1 > sy0 + 0.05 && b.y0 < sy1) return die(); }
          else if (o.t === 'P') { if (b.x1 > o.x && b.x0 < o.x + 1 && b.y0 < o.y + 0.35 && b.y1 > o.y) { p.vy = m === 'ball' ? 18 * p.grav : 28; p.onGround = false; } }
          else if (o.t === 'O') { const k = o.x + ',' + o.y; if (!p.usedOrbs.has(k) && hold && Math.abs(p.x + 0.5 - (o.x + 0.5)) < 0.9 && Math.abs(p.y + 0.5 - (o.y + 0.5)) < 0.9) { p.usedOrbs.add(k); p.vy = m === 'ball' ? 20 * p.grav : 22; p.onGround = false; } }
          else if (o.t === 'M' && p.x + 0.5 >= o.x && p.x + 0.5 < o.x + 1 && p.mode !== o.m) { p.mode = o.m; p.grav = 1; p.vy = Math.min(p.vy, 4); paintHud(); }
        }
        if (m === 'cube' || (m === 'ball' && p.grav > 0) || m === 'rocket') p.rot = p.onGround ? Math.round(p.rot / (Math.PI / 2)) * (Math.PI / 2) : p.rot - 7 * dt * (m === 'rocket' ? 0 : 1);
        if (m === 'rocket') p.rot = Math.atan2(p.vy, SPEED); if (m === 'dart') p.rot = p.y <= 0 || p.y >= CEIL - 1 ? 0 : hold ? Math.PI / 4 : -Math.PI / 4;
        // practice checkpoints every ~3 s on safe ground
        if (practice && p.onGround && (!checkpoints.length || p.x - checkpoints[checkpoints.length - 1].x > 30)) checkpoints.push({ x: p.x, y: p.y, vy: 0, mode: p.mode, grav: p.grav, rot: 0, onGround: true });
        if (p.x >= end) win();
      }
      function draw(ts) {
        const s = H / ((CEIL + 2) * TILE) * TILE; const camX = p.x - (W / s) * 0.3; const gy = H - s * 1.2; // ground screen y
        const X = (x) => (x - camX) * s, Y = (y) => gy - y * s;
        const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, lv.col[0]); gr.addColorStop(1, lv.col[1]); g.fillStyle = gr; g.fillRect(0, 0, W, H);
        // parallax stars and beat pulse
        const beat = music.pulse(); g.fillStyle = `rgba(255,255,255,${0.35 + beat * 0.4})`; for (let i = 0; i < 60; i++) { const sx = ((i * 137.5 - camX * s * 0.2) % W + W) % W; const sy = (i * 71.3) % (gy - 20); g.fillRect(sx, sy, 2, 2); }
        g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, gy, W, H - gy); g.strokeStyle = `rgba(255,255,255,${0.5 + beat * 0.5})`; g.lineWidth = 3; g.beginPath(); g.moveTo(0, gy); g.lineTo(W, gy); g.stroke();
        const x0 = camX - 2, x1 = camX + W / s + 2;
        for (const o of near(x0, x1)) {
          const sx = X(o.x), sy = Y(o.y + 1);
          if (o.t === 'B' || o.t === 'C') { g.fillStyle = o.t === 'C' ? '#7f1d1d' : 'rgba(15,23,42,.92)'; g.fillRect(sx, sy, s, s); g.strokeStyle = o.t === 'C' ? '#f87171' : 'rgba(165,243,252,.9)'; g.lineWidth = 2; g.strokeRect(sx + 1, sy + 1, s - 2, s - 2); }
          else if (o.t === 'S') { g.fillStyle = '#0f172a'; g.strokeStyle = '#f8fafc'; g.lineWidth = 2; g.beginPath(); g.moveTo(sx + s * 0.1, Y(o.y)); g.lineTo(sx + s / 2, Y(o.y + 0.85)); g.lineTo(sx + s * 0.9, Y(o.y)); g.closePath(); g.fill(); g.stroke(); }
          else if (o.t === 'P') { g.fillStyle = '#facc15'; g.fillRect(sx + s * 0.1, Y(o.y + 0.25), s * 0.8, s * 0.25); }
          else if (o.t === 'O') { g.strokeStyle = '#fde047'; g.lineWidth = 3; g.beginPath(); g.arc(sx + s / 2, sy + s / 2, s * 0.32 + beat * 3, 0, 7); g.stroke(); g.fillStyle = 'rgba(253,224,71,.35)'; g.fill(); }
          else if (o.t === 'M') { g.strokeStyle = MODES[o.m][2]; g.lineWidth = 4; g.beginPath(); g.ellipse(sx + s / 2, Y(CEIL / 2), s * 0.35, s * 2.2, 0, 0, 7); g.stroke(); }
        }
        // end line
        g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(X(end), 0, s * 0.4, gy);
        // player
        if (!dead) { const c = MODES[p.mode][2]; g.save(); g.translate(X(p.x + 0.5), Y(p.y + 0.5)); g.rotate(-p.rot); g.shadowColor = c; g.shadowBlur = 16;
          if (p.mode === 'cube') { g.fillStyle = c; g.fillRect(-s * 0.42, -s * 0.42, s * 0.84, s * 0.84); g.fillStyle = '#111'; g.fillRect(-s * 0.2, -s * 0.2, s * 0.4, s * 0.4); }
          else if (p.mode === 'rocket') { g.fillStyle = c; g.beginPath(); g.moveTo(s * 0.5, 0); g.lineTo(-s * 0.4, -s * 0.3); g.lineTo(-s * 0.25, 0); g.lineTo(-s * 0.4, s * 0.3); g.closePath(); g.fill(); }
          else if (p.mode === 'ball') { g.fillStyle = c; g.beginPath(); g.arc(0, 0, s * 0.42, 0, 7); g.fill(); g.strokeStyle = '#111'; g.lineWidth = 3; g.beginPath(); g.moveTo(-s * 0.42, 0); g.lineTo(s * 0.42, 0); g.stroke(); }
          else { g.fillStyle = c; g.beginPath(); g.moveTo(s * 0.45, 0); g.lineTo(-s * 0.35, -s * 0.25); g.lineTo(-s * 0.35, s * 0.25); g.closePath(); g.fill(); }
          g.restore(); }
        for (const q of parts) { g.globalAlpha = Math.max(0, q.life); g.fillStyle = q.c; g.fillRect(X(q.x), Y(q.y), 6, 6); } g.globalAlpha = 1;
        if (practice) { g.fillStyle = '#4ade80'; for (const c of checkpoints) { if (c.x < x0 || c.x > x1) continue; g.beginPath(); g.moveTo(X(c.x), Y(c.y + 1.3)); g.lineTo(X(c.x) + 8, Y(c.y + 1)); g.lineTo(X(c.x), Y(c.y + 0.7)); g.fill(); } }
      }
      function frame(now) { raf = requestAnimationFrame(frame); let dt = Math.min(0.05, (now - last) / 1000); last = now; while (dt > 0) { const d = Math.min(dt, 1 / 240); step(d); dt -= d; } for (const q of parts) { q.x += q.vx * 0.016; q.y += q.vy * 0.016; q.vy -= 30 * 0.016; q.life -= 0.02; } parts = parts.filter((q) => q.life > 0); if (Math.random() < 0.2) paintHud(); draw(now); }
      const down = (e) => { if (e.type === 'keydown') { if (e.repeat) return; if (e.key === 'Escape') return menu(); if (e.key.toLowerCase() === 'p') { practice = !practice; checkpoints = []; return restart(); } if (![' ', 'ArrowUp', 'w', 'W', 'Enter'].includes(e.key)) return; e.preventDefault(); } hold = true; pressed = true; music.unlock(); };
      const up = (e) => { if (e.type === 'keyup' && ![' ', 'ArrowUp', 'w', 'W', 'Enter'].includes(e.key)) return; hold = false; };
      document.addEventListener('keydown', down); document.addEventListener('keyup', up); cv.addEventListener('pointerdown', down); document.addEventListener('pointerup', up);
      restart(); attempts = 1; paintHud(); raf = requestAnimationFrame(frame);
      stop = () => { cancelAnimationFrame(raf); ro.disconnect(); music.stop(); document.removeEventListener('keydown', down); document.removeEventListener('keyup', up); document.removeEventListener('pointerup', up); };
    }

    // ---------- editor ----------
    function editor() {
      if (stop) { stop(); stop = null; }
      let data = []; let tool = 'B'; let scroll = 0; const cv = h('canvas.dsh-cv.ed'); const g = cv.getContext('2d'); let W = 0, H = 0;
      const TOOLS = [['B', t('Block')], ['S', t('Spike')], ['C', t('Ceiling spike')], ['P', t('Jump pad')], ['O', t('Jump orb')], ['M:rocket', L(MODES.rocket)], ['M:ball', L(MODES.ball)], ['M:dart', L(MODES.dart)], ['M:cube', L(MODES.cube)], ['E', t('Finish')], ['X', t('Erase')]];
      const bar = h('div.dsh-tools'); const paintBar = () => mount(bar, TOOLS.map(([k, n]) => h('button.btn.sm' + (tool === k ? '.primary' : ''), { onClick: () => { tool = k; paintBar(); } }, n)));
      const name = h('input.input', { placeholder: t('Level name'), value: t('My level'), style: 'max-width:200px' });
      mount(box, h('div.dsh-ed', h('div.dsh-top', h('button.btn.sm.ghost', { onClick: menu }, icon('back', 14), t('Levels')), name, h('button.btn.sm.primary', { onClick: test }, icon('play', 14), t('Test')), h('button.btn.sm', { onClick: save }, icon('save', 14), t('Save')), h('button.btn.sm', { onClick: share }, icon('copy', 14), t('Copy code'))), bar, cv, h('p.tiny.muted', t('Click to place, right click to erase, scroll / arrows to move along the level. Put a Finish line at the end.'))));
      paintBar();
      const resize = () => { const r = cv.getBoundingClientRect(); W = cv.width = r.width; H = cv.height = r.height; draw(); }; const ro = new ResizeObserver(resize); ro.observe(cv);
      const s = () => H / (CEIL + 2); const gy = () => H - s();
      function draw() { if (!W) return; const S2 = s(); g.fillStyle = '#0f172a'; g.fillRect(0, 0, W, H); g.strokeStyle = '#ffffff14'; for (let x = 0; x < W / S2 + 1; x++) { g.beginPath(); g.moveTo(x * S2 - (scroll % 1) * S2, 0); g.lineTo(x * S2 - (scroll % 1) * S2, gy()); g.stroke(); } for (let y = 0; y <= CEIL; y++) { g.beginPath(); g.moveTo(0, gy() - y * S2); g.lineTo(W, gy() - y * S2); g.stroke(); } g.fillStyle = '#ffffff22'; g.fillRect(0, gy(), W, H);
        for (const o of data) { const sx = (o.x - scroll) * S2, sy = gy() - (o.y + 1) * S2; if (sx < -S2 || sx > W) continue; g.fillStyle = { B: '#94a3b8', S: '#f8fafc', C: '#f87171', P: '#facc15', O: '#fde047', E: '#22c55e' }[o.t] || (o.m && MODES[o.m][2]) || '#fff';
          if (o.t === 'S') { g.beginPath(); g.moveTo(sx + 4, sy + S2); g.lineTo(sx + S2 / 2, sy + 4); g.lineTo(sx + S2 - 4, sy + S2); g.fill(); } else if (o.t === 'O') { g.beginPath(); g.arc(sx + S2 / 2, sy + S2 / 2, S2 * 0.3, 0, 7); g.fill(); } else if (o.t === 'M' || o.t === 'E') { g.fillRect(sx + S2 * 0.35, gy() - CEIL * S2, S2 * 0.3, CEIL * S2); } else g.fillRect(sx + 2, sy + 2, S2 - 4, o.t === 'P' ? S2 * 0.3 : S2 - 4); }
        g.fillStyle = '#fff'; g.font = '12px system-ui'; g.fillText(t('Column {n}', { n: Math.floor(scroll) }), 8, 16); }
      const cell = (e) => { const r = cv.getBoundingClientRect(); const S2 = s(); return { x: Math.floor((e.clientX - r.left) / S2 + scroll), y: Math.floor((gy() - (e.clientY - r.top)) / S2) }; };
      cv.addEventListener('contextmenu', (e) => e.preventDefault());
      cv.addEventListener('pointerdown', (e) => { const c = cell(e); if (c.x < 0 || c.y < 0 || c.y >= CEIL) return; data = data.filter((o) => !(o.x === c.x && (o.y === c.y || o.t === 'M' || o.t === 'E'))); if (e.button === 2 || tool === 'X') { draw(); return; } if (tool === 'E') data = data.filter((o) => o.t !== 'E'); const [tt, m] = tool.split(':'); data.push(Object.assign({ t: tt, x: c.x, y: tt === 'M' || tt === 'E' ? 0 : c.y }, m ? { m } : {})); if (data.length > 5000) data.shift(); draw(); });
      cv.addEventListener('wheel', (e) => { e.preventDefault(); scroll = Math.max(0, scroll + (e.deltaY + e.deltaX) / 40); draw(); }, { passive: false });
      const onK = (e) => { if (!cv.isConnected) return document.removeEventListener('keydown', onK); if (e.key === 'ArrowRight') { scroll += 4; draw(); } if (e.key === 'ArrowLeft') { scroll = Math.max(0, scroll - 4); draw(); } }; document.addEventListener('keydown', onK);
      const pack = () => ({ name: name.value.trim().slice(0, 40) || 'Level', data: data.some((o) => o.t === 'E') ? data : data.concat([{ t: 'E', x: Math.max(30, ...data.map((o) => o.x + 8)), y: 0 }]) });
      function test() { const lv = pack(); const back = data.slice(); play({ id: 'test', n: [lv.name, lv.name], diff: 1, bpm: 128, col: ['#0f172a', '#334155'], data: lv.data, custom: true }, false); const prev = stop; stop = () => { prev(); data = back; }; }
      function save() { const mine = ls('dash.mylevels') || []; mine.unshift(pack()); ls('dash.mylevels', mine.slice(0, 30)); toast(t('Level saved on this device'), 'good'); }
      function share() { const code = btoa(unescape(encodeURIComponent(JSON.stringify(pack())))); navigator.clipboard.writeText(code).then(() => toast(t('Code copied — send it to a friend'), 'good')).catch(() => promptBox(t('Level code'), { value: code, multiline: true })); }
      stop = () => { ro.disconnect(); document.removeEventListener('keydown', onK); };
    }

    if (ctx.params[0] === 'editor') editor(); else menu();
    return () => { if (stop) stop(); };
  },
};

// ---------- a live beat (WebAudio): kick, hats and a bass line at the level's tempo ----------
const music = (() => {
  let ac = null, timer = 0, bpm = 120, t0 = 0, step = 0, on = false;
  const unlock = () => { try { if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); } catch {} };
  const note = (time, freq, dur, type, vol) => { const o = ac.createOscillator(), g = ac.createGain(); o.type = type; o.frequency.setValueAtTime(freq, time); if (type === 'sine') o.frequency.exponentialRampToValueAtTime(40, time + dur); g.gain.setValueAtTime(vol, time); g.gain.exponentialRampToValueAtTime(0.001, time + dur); o.connect(g); g.connect(ac.destination); o.start(time); o.stop(time + dur + 0.02); };
  const BASS = [55, 55, 65.4, 55, 73.4, 55, 65.4, 49];
  function sched() { if (!ac || !on) return; const spb = 60 / bpm / 2; while (t0 < ac.currentTime + 0.15) { if (step % 2 === 0) note(t0, 150, 0.25, 'sine', 0.5); note(t0, 6000, 0.03, 'square', 0.03); if (step % 2 === 1) note(t0, BASS[(step >> 1) % 8] * 2, spb * 0.9, 'sawtooth', 0.06); t0 += spb; step++; } }
  return { unlock, start(b) { unlock(); if (!ac) return; bpm = b; on = true; t0 = ac.currentTime + 0.05; step = 0; clearInterval(timer); timer = setInterval(sched, 40); }, stop() { on = false; clearInterval(timer); }, pulse() { if (!ac || !on) return 0; const ph = ((ac.currentTime - t0) * bpm / 60) % 1; return Math.max(0, 1 - ((ph + 1) % 1) * 4); } };
})();
