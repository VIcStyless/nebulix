// Animated backgrounds drawn on one canvas: stars, nebula, aurora, synthwave grid, particles, waves,
// glyph rain, bokeh and lava. OS mode can override the theme's background with a wallpaper, and every
// animated type can react to the music that is playing in Pulse (bass / mids / highs).
import { debounce, clamp, rand } from './util.js';

let canvas, ctx, W = 0, H = 0, dpr = 1, raf = 0, last = 0;
let base = { type: 'stars', c1: '#1b1050', c2: '#0a0719', c3: '#3b0f6b', angle: 160, dim: 0, image: '', stars: { density: .6, speed: .5, twinkle: .7, color: '#ffffff' }, accent: '#8b5cf6', accent2: '#38bdf8', anim: 1 };
let wall = null; // OS wallpaper override { type, image, dim, react }
let cfg = base;
let motion = 1; // personal animation level multiplier (Settings → Animations)
let energySrc = null; let E = { bass: 0, mid: 0, high: 0, level: 0 }; let reactOn = true;
let stars = [], shoot = [], nextShoot = 0, tt = 0, nodes = [], drops = [], blobs = [], bokeh = [], bubbles = [], glassBlobs = [], fx14 = [];
let mouse = { x: -1e4, y: -1e4 };
let lavaCv = null, lavaCtx = null, lavaImg = null;
const STATIC = ['solid', 'gradient', 'image', 'space3d', 'tunnel3d', 'crystals3d', 'city3d'];
const IS3D = (t) => /3d$/.test(t || '');
let bg3dLoaded = false;
const hexRgb = (c) => { const m = /^#?([0-9a-f]{6})/i.exec(c || ''); if (!m) return [255, 255, 255]; const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const hex = (c, a = 1) => { const [r, g, b] = hexRgb(c); return `rgba(${r},${g},${b},${clamp(a, 0, 1)})`; };
const reduced = () => document.documentElement.dataset.reduce === '1' || (matchMedia('(prefers-reduced-motion: reduce)').matches && document.documentElement.dataset.reduce !== '0');

export function initBackground() {
  canvas = document.getElementById('bgfx'); ctx = canvas.getContext('2d');
  resize(); addEventListener('resize', debounce(resize, 150));
  addEventListener('pointermove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; }, { passive: true });
  document.addEventListener('pointerleave', () => { mouse.x = mouse.y = -1e4; });
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancelAnimationFrame(raf); else start(); });
  compose();
}
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 1.5); W = innerWidth; H = innerHeight;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  build(); if (!animating()) frame(0);
}
const animating = () => cfg.anim * motion > 0 && !reduced() && !document.hidden && !STATIC.includes(cfg.type);
const area = () => (W * H) / (1280 * 720);
function build() {
  const s = cfg.stars; const t = cfg.type;
  const n = STATIC.includes(t) || ['matrix', 'lava', 'waves', 'bubbles', 'blobs', 'mesh', 'snow', 'fireflies', 'hexgrid', 'confetti', 'rain', 'orbits'].includes(t) ? 0 : Math.round(clamp(s.density, 0, 1) * (W * H) / 9000 * (t === 'nebula' || t === 'aurora' ? .6 : t === 'particles' || t === 'bokeh' ? .25 : 1));
  stars = Array.from({ length: n }, () => ({ x: Math.random() * W, y: Math.random() * H, z: rand(.2, 1), p: Math.random() * 6.28, tw: rand(.4, 1.6) }));
  shoot = []; nextShoot = 2 + Math.random() * 5;
  nodes = t === 'particles' ? Array.from({ length: Math.round(clamp(70 * area(), 30, 140)) }, () => ({ x: Math.random() * W, y: Math.random() * H, vx: rand(-18, 18), vy: rand(-18, 18), r: rand(1.2, 2.6), c: Math.random() < .5 })) : [];
  const cw = 18; drops = t === 'matrix' ? Array.from({ length: Math.ceil(W / cw) }, (_, i) => ({ x: i * cw + 2, y: rand(-H, 0), v: rand(60, 160), len: Math.round(rand(8, 26)), seed: Math.random() * 1e4 })) : [];
  blobs = t === 'lava' ? Array.from({ length: 7 }, (_, i) => ({ px: Math.random() * 6.28, py: Math.random() * 6.28, sx: rand(.05, .12), sy: rand(.04, .1), r: rand(.11, .2), i })) : [];
  bokeh = t === 'bokeh' ? Array.from({ length: Math.round(clamp(34 * area(), 18, 60)) }, () => ({ x: Math.random() * W, y: Math.random() * H, r: rand(18, 90), v: rand(6, 22), p: Math.random() * 6.28, k: Math.floor(Math.random() * 3) })) : [];
  bubbles = t === 'bubbles' ? Array.from({ length: Math.round(clamp(30 * area(), 16, 54)) }, () => ({ x: Math.random() * W, y: Math.random() * H, r: rand(8, 46), v: rand(10, 36), p: Math.random() * 6.28, sway: rand(6, 18), k: Math.floor(Math.random() * 3) })) : [];
  glassBlobs = (t === 'blobs' || t === 'mesh') ? Array.from({ length: t === 'mesh' ? 4 : 6 }, (_, i) => ({ px: Math.random() * 6.28, py: Math.random() * 6.28, sx: rand(.04, .11), sy: rand(.035, .09), r: rand(.3, .52), k: i % 3 })) : [];
  // 14.0 backgrounds: one shared particle list
  const nfx = { snow: 140, fireflies: 46, confetti: 90, rain: 160, orbits: 7, hexgrid: 0 }[t] || 0;
  fx14 = Array.from({ length: Math.round(nfx * clamp(area(), .5, 1.6) * (t === 'orbits' ? 1 / clamp(area(), .5, 1.6) : 1) * (.4 + clamp(s.density, 0, 1) * .9)) }, (_, i) => ({ x: Math.random() * W, y: Math.random() * H, r: t === 'orbits' ? 60 + i * 70 : rand(1, t === 'snow' ? 3.6 : 3), v: rand(.5, 1.5), p: Math.random() * 6.283, k: Math.floor(Math.random() * 3), a: Math.random() * 6.283, w: rand(-3, 3) }));
  if (t === 'lava') { lavaCv = lavaCv || document.createElement('canvas'); lavaCv.width = Math.max(40, Math.round(W / 8)); lavaCv.height = Math.max(24, Math.round(H / 8)); lavaCtx = lavaCv.getContext('2d'); lavaImg = lavaCtx.createImageData(lavaCv.width, lavaCv.height); }
}
function compose() {
  cfg = Object.assign({}, base);
  if (wall && wall.type && wall.type !== 'theme') {
    cfg.type = wall.type === 'image' && !wall.image ? base.type : wall.type;
    if (wall.type === 'image') cfg.image = wall.image;
    cfg.dim = wall.dim != null ? wall.dim : cfg.dim;
  } else if (wall && wall.dim != null) cfg.dim = Math.max(cfg.dim, wall.dim);
  reactOn = !wall || wall.react !== false;
  paintBase();
  if (canvas) { canvas.style.display = STATIC.includes(cfg.type) ? 'none' : 'block'; build(); start(); }
  // 3D theme backgrounds run in their own WebGL canvas (loaded only when used)
  if (IS3D(cfg.type)) import('./bg3d.js').then((m) => m.startBg3d(cfg.type, [cfg.c1 || '#0b0c0e', cfg.c2 || '#7c5cff', cfg.c3 || '#22d3ee'], cfg.anim * motion)).catch(() => {});
  else if (bg3dLoaded) import('./bg3d.js').then((m) => m.stopBg3d());
  if (IS3D(cfg.type)) bg3dLoaded = true;
}
function paintBase() {
  const body = document.body; const img = document.getElementById('bgimg'); if (!body || !img) return;
  if (cfg.type === 'solid') body.style.background = cfg.c2;
  else if (cfg.type === 'gradient') body.style.background = `linear-gradient(${cfg.angle}deg, ${cfg.c1}, ${cfg.c2}, ${cfg.c3})`;
  else if (cfg.type === 'matrix') body.style.background = `linear-gradient(${cfg.angle}deg, #010805, ${cfg.c2})`;
  else body.style.background = `linear-gradient(${cfg.angle}deg, ${cfg.c1}, ${cfg.c2} 55%, ${cfg.c2})`;
  if (cfg.type === 'image' && cfg.image) { img.style.backgroundImage = `linear-gradient(rgba(0,0,0,${cfg.dim}),rgba(0,0,0,${cfg.dim})), url("${cfg.image}")`; img.style.display = 'block'; }
  else { img.style.display = 'none'; img.style.backgroundImage = 'none'; }
  if (cfg.type !== 'image' && cfg.dim > 0) body.style.background = `linear-gradient(rgba(0,0,0,${cfg.dim}),rgba(0,0,0,${cfg.dim})), ${body.style.background}`;
}
export function setBackground(bg, extra = {}) {
  base = Object.assign({}, base, bg, { accent: extra.accent || base.accent, accent2: extra.accent2 || base.accent2, anim: extra.anim === undefined ? base.anim : extra.anim });
  compose();
}
// OS mode wallpaper: null restores the theme background.
export function setWallpaper(wp) { wall = wp ? Object.assign({}, wp) : null; compose(); }
// Settings → Animations: off / subtle / normal / extra
export function setMotion(level) { motion = { off: 0, subtle: .55, normal: 1, extra: 1.6 }[level] ?? 1; start(); }
// Pulse registers a function that returns { bass, mid, high, level } (0..1) while music plays.
export function setEnergySource(fn) { energySrc = fn; }
export const currentType = () => cfg.type;

function start() { cancelAnimationFrame(raf); if (!ctx) return; if (animating()) { last = performance.now(); raf = requestAnimationFrame(loop); } else frame(0); }
function loop(now) {
  if (!animating()) { frame(0); return; }
  const dt = Math.min(.05, (now - last) / 1000);
  const cap = cfg.type === 'stars' || cfg.type === 'particles' ? 1 / 60 : cfg.type === 'lava' ? 1 / 30 : 1 / 40;
  if (dt >= cap) { last = now; sampleEnergy(dt); const k = cfg.anim * motion; tt += dt * k * (1 + E.level * .6); frame(dt * k); }
  raf = requestAnimationFrame(loop);
}
function sampleEnergy(dt) {
  let e = null; if (reactOn && energySrc) { try { e = energySrc(); } catch { e = null; } }
  const a = 1 - Math.exp(-dt * 12);
  for (const k of ['bass', 'mid', 'high', 'level']) E[k] += ((e ? clamp(+e[k] || 0, 0, 1) : 0) - E[k]) * a;
}
function drawStars(dt) {
  const s = cfg.stars; const sp = s.speed * 14 * (1 + E.bass * 3);
  for (const o of stars) {
    o.x += sp * o.z * dt; o.y += sp * o.z * dt * .35; if (o.x > W + 2) o.x = -2; if (o.y > H + 2) o.y = -2;
    const tw = s.twinkle > 0 ? .55 + .45 * Math.sin(o.p + tt * o.tw * 2) : 1; const a = clamp((.25 + o.z * .75) * (1 - s.twinkle * .5 + s.twinkle * .5 * tw) + E.high * .3, 0, 1);
    ctx.fillStyle = hex(s.color, a); const r = .4 + o.z * 1.25 * (1 + E.high * .6); ctx.beginPath(); ctx.arc(o.x, o.y, r, 0, 6.283); ctx.fill();
  }
  if (cfg.type === 'stars' && sp > 0) {
    nextShoot -= dt * (1 + E.bass * 2); if (nextShoot <= 0) { nextShoot = rand(5, 11); const ang = rand(.35, .6); shoot.push({ x: rand(0, W * .8), y: rand(0, H * .35), vx: Math.cos(ang) * 620, vy: Math.sin(ang) * 620, life: 0, max: rand(.5, .9), len: rand(90, 190) }); }
    for (let i = shoot.length - 1; i >= 0; i--) {
      const q = shoot[i]; q.life += dt; q.x += q.vx * dt; q.y += q.vy * dt; const k = 1 - q.life / q.max; if (k <= 0) { shoot.splice(i, 1); continue; }
      const g = ctx.createLinearGradient(q.x, q.y, q.x - q.vx / 620 * q.len, q.y - q.vy / 620 * q.len); g.addColorStop(0, hex(s.color, .9 * k)); g.addColorStop(1, hex(s.color, 0));
      ctx.strokeStyle = g; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x - q.vx / 620 * q.len, q.y - q.vy / 620 * q.len); ctx.stroke();
    }
  }
}
function drawNebula() {
  const m = Math.min(W, H); const cols = [cfg.c3, cfg.accent, cfg.accent2, cfg.c1]; ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 4; i++) {
    const x = W * (.2 + .6 * ((i * .37) % 1)) + Math.sin(tt * .08 + i * 2) * m * .12; const y = H * (.25 + .5 * ((i * .53) % 1)) + Math.cos(tt * .07 + i * 3) * m * .1; const r = m * (.45 + .12 * Math.sin(tt * .1 + i)) * (1 + E.bass * .25);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, hex(cols[i], .26 + E.level * .15)); g.addColorStop(1, hex(cols[i], 0)); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  ctx.globalCompositeOperation = 'source-over';
}
function drawAurora() {
  ctx.globalCompositeOperation = 'lighter'; const cols = [cfg.accent2, cfg.accent, cfg.c3];
  for (let k = 0; k < 3; k++) {
    const b = H * (.28 + k * .1); const amp = H * (.07 + k * .02) * (1 + E.mid * .9); ctx.beginPath(); ctx.moveTo(0, H * .8);
    for (let x = 0; x <= W; x += 14) { const y = b + Math.sin(x * .004 + tt * (.25 + k * .1) + k * 2) * amp + Math.sin(x * .011 - tt * .3) * amp * .4; ctx.lineTo(x, y); }
    ctx.lineTo(W, H * .8); ctx.closePath(); const g = ctx.createLinearGradient(0, b - amp, 0, b + H * .38); g.addColorStop(0, hex(cols[k], .0)); g.addColorStop(.25, hex(cols[k], .3 + E.level * .2)); g.addColorStop(1, hex(cols[k], 0)); ctx.fillStyle = g; ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}
function drawGrid() {
  const hz = H * .56; const sr = Math.min(W, H) * .42 * (1 + E.bass * .18); const sun = ctx.createRadialGradient(W / 2, hz, 0, W / 2, hz, sr); sun.addColorStop(0, hex(cfg.c3, .75)); sun.addColorStop(.35, hex(cfg.accent, .28 + E.bass * .3)); sun.addColorStop(1, hex(cfg.accent, 0)); ctx.fillStyle = sun; ctx.fillRect(0, 0, W, hz + 2);
  const g = ctx.createLinearGradient(0, hz, 0, H); g.addColorStop(0, hex(cfg.c1, .85)); g.addColorStop(1, hex(cfg.c2, .95)); ctx.fillStyle = g; ctx.fillRect(0, hz, W, H - hz);
  ctx.strokeStyle = hex(cfg.accent2, .55 + E.high * .4); ctx.lineWidth = 1.1; ctx.beginPath();
  for (let i = -20; i <= 20; i++) { ctx.moveTo(W / 2 + i * 14, hz); ctx.lineTo(W / 2 + i * W * .09, H); }
  const off = (tt * .35) % 1; for (let j = 0; j < 14; j++) { const z = (j + off) / 14; const y = hz + (H - hz) * z * z; ctx.moveTo(0, y); ctx.lineTo(W, y); }
  ctx.stroke(); ctx.strokeStyle = hex(cfg.accent, .8); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, hz); ctx.lineTo(W, hz); ctx.stroke();
}
function drawParticles(dt) {
  const link = Math.min(170, Math.max(110, Math.sqrt(W * H) / 7)) * (1 + E.bass * .35); const l2 = link * link; const sp = 1 + E.level * 2.5;
  for (const n of nodes) {
    const dx = mouse.x - n.x, dy = mouse.y - n.y; const d2 = dx * dx + dy * dy;
    if (d2 < 40000 && d2 > 1) { const f = 22 / Math.sqrt(d2); n.vx += dx * f * dt * .5; n.vy += dy * f * dt * .5; }
    const v = Math.hypot(n.vx, n.vy); if (v > 40) { n.vx *= 40 / v; n.vy *= 40 / v; }
    n.x += n.vx * dt * sp; n.y += n.vy * dt * sp;
    if (n.x < -10) n.x = W + 10; else if (n.x > W + 10) n.x = -10; if (n.y < -10) n.y = H + 10; else if (n.y > H + 10) n.y = -10;
  }
  ctx.lineWidth = 1;
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j]; const dx = a.x - b.x, dy = a.y - b.y; const d2 = dx * dx + dy * dy;
      if (d2 < l2) { ctx.strokeStyle = hex(a.c ? cfg.accent : cfg.accent2, (1 - d2 / l2) * (.35 + E.mid * .4)); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    }
  }
  for (const n of nodes) { ctx.fillStyle = hex(n.c ? cfg.accent : cfg.accent2, .9); ctx.beginPath(); ctx.arc(n.x, n.y, n.r * (1 + E.bass * .8), 0, 6.283); ctx.fill(); }
}
function drawWaves() {
  const cols = [cfg.c3, cfg.accent, cfg.accent2, cfg.accent, cfg.c1];
  ctx.globalCompositeOperation = 'lighter';
  for (let k = 0; k < 5; k++) {
    const yb = H * (.5 + k * .09); const amp = H * (.05 + k * .012) * (1 + (k % 2 ? E.mid : E.bass) * 1.2); const f = .0025 + k * .0011; const s = tt * (.35 + k * .12) * (k % 2 ? -1 : 1);
    ctx.beginPath(); ctx.moveTo(0, H);
    for (let x = 0; x <= W + 10; x += 10) ctx.lineTo(x, yb + Math.sin(x * f + s + k) * amp + Math.sin(x * f * 2.3 - s * .7) * amp * .35);
    ctx.lineTo(W, H); ctx.closePath();
    const g = ctx.createLinearGradient(0, yb - amp, 0, H); g.addColorStop(0, hex(cols[k], .22 + E.level * .12)); g.addColorStop(1, hex(cols[k], 0)); ctx.fillStyle = g; ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}
const GLYPHS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン0123456789NEBULIX✦+*<>=';
function drawMatrix(dt) {
  ctx.font = '15px ui-monospace, Consolas, monospace'; ctx.textBaseline = 'top'; const sp = 1 + E.bass * 2.2;
  for (const d of drops) {
    d.y += d.v * dt * sp; if (d.y - d.len * 17 > H) { d.y = rand(-200, 0); d.v = rand(60, 160); d.len = Math.round(rand(8, 26)); }
    const head = Math.floor(d.y / 17);
    for (let i = 0; i < d.len; i++) {
      const row = head - i; const y = row * 17; if (y < -17 || y > H) continue;
      const ch = GLYPHS[Math.abs(Math.floor(d.seed + row * 7.3 + (i === 0 ? tt * 9 : tt * .7))) % GLYPHS.length];
      ctx.fillStyle = i === 0 ? hex('#ffffff', .9) : hex(i < 3 ? cfg.accent2 : cfg.accent, (1 - i / d.len) * (.75 + E.high * .25)); ctx.fillText(ch, d.x, y);
    }
  }
}
function drawBokeh(dt) {
  const cols = [cfg.accent, cfg.accent2, cfg.c3]; ctx.globalCompositeOperation = 'lighter';
  for (const b of bokeh) {
    b.y -= b.v * dt * (1 + E.level); b.x += Math.sin(tt * .3 + b.p) * 6 * dt; if (b.y < -b.r) { b.y = H + b.r; b.x = Math.random() * W; }
    const r = b.r * (1 + E.bass * .35 * ((b.k + 1) / 3)); const a = .12 + .08 * Math.sin(tt * .8 + b.p) + E.mid * .12;
    const g = ctx.createRadialGradient(b.x, b.y, r * .2, b.x, b.y, r); g.addColorStop(0, hex(cols[b.k], a)); g.addColorStop(.8, hex(cols[b.k], a * .7)); g.addColorStop(1, hex(cols[b.k], 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, 6.283); ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}
function drawLava() {
  if (!lavaCtx) return;
  const w = lavaCv.width, h = lavaCv.height, d = lavaImg.data; const m = Math.min(w, h);
  const c1 = hexRgb(cfg.accent), c2 = hexRgb(cfg.c3), c3 = hexRgb(cfg.accent2);
  const P = blobs.map((b) => ({ x: w * (.5 + .38 * Math.sin(tt * b.sx * 3 + b.px)), y: h * (.5 + .42 * Math.sin(tt * b.sy * 3 + b.py)), r2: Math.pow(m * b.r * (1 + E.bass * .3), 2) }));
  for (let y = 0; y < h; y++) {
    const ky = y / h;
    for (let x = 0; x < w; x++) {
      let f = 0; for (const p of P) { const dx = x - p.x, dy = y - p.y; f += p.r2 / (dx * dx + dy * dy + 1); }
      const i = (y * w + x) * 4;
      if (f > .9) {
        const edge = clamp((f - .9) * 3, 0, 1); const mix = clamp(ky + (x / w - .5) * .3, 0, 1);
        const r = c1[0] * (1 - mix) + c2[0] * mix, g = c1[1] * (1 - mix) + c2[1] * mix, b = c1[2] * (1 - mix) + c2[2] * mix;
        const glow = f > 1.6 ? .25 : 0;
        d[i] = r + (c3[0] - r) * glow; d[i + 1] = g + (c3[1] - g) * glow; d[i + 2] = b + (c3[2] - b) * glow; d[i + 3] = 150 + edge * 80;
      } else { const a = clamp((f - .45) / .45, 0, 1); d[i] = c1[0]; d[i + 1] = c1[1]; d[i + 2] = c1[2]; d[i + 3] = a * 45; }
    }
  }
  lavaCtx.putImageData(lavaImg, 0, 0); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(lavaCv, 0, 0, W, H);
}
// Frutiger-Aero rising bubbles: translucent spheres with a rim light and a bright specular highlight.
function drawBubbles(dt) {
  const cols = [cfg.accent, cfg.accent2, cfg.c3];
  for (const b of bubbles) {
    b.y -= b.v * dt * (1 + E.level * .8); b.x += Math.sin(tt * .5 + b.p) * b.sway * dt;
    if (b.y < -b.r - 4) { b.y = H + b.r + rand(0, 60); b.x = Math.random() * W; }
    const r = b.r * (1 + E.bass * .25); const col = cols[b.k];
    const g = ctx.createRadialGradient(b.x - r * .3, b.y - r * .3, r * .1, b.x, b.y, r);
    g.addColorStop(0, hex('#ffffff', .5)); g.addColorStop(.25, hex(col, .18 + E.mid * .1)); g.addColorStop(.85, hex(col, .06)); g.addColorStop(1, hex(col, .22));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, 6.283); ctx.fill();
    ctx.strokeStyle = hex('#ffffff', .22); ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = hex('#ffffff', .7); ctx.beginPath(); ctx.arc(b.x - r * .32, b.y - r * .34, r * .16, 0, 6.283); ctx.fill();
  }
}
// Liquid-glass soft blobs (and the Windows-11 mica mesh): large blurred colour fields drifting slowly.
function drawBlobs() {
  const m = Math.max(W, H); const cols = [cfg.accent, cfg.c3, cfg.accent2]; ctx.globalCompositeOperation = 'lighter';
  for (const b of glassBlobs) {
    const x = W * (.5 + .4 * Math.sin(tt * b.sx + b.px)); const y = H * (.5 + .42 * Math.cos(tt * b.sy + b.py)); const r = m * b.r * (1 + E.bass * .18);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, hex(cols[b.k], (cfg.type === 'mesh' ? .16 : .3) + E.level * .1)); g.addColorStop(1, hex(cols[b.k], 0));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  ctx.globalCompositeOperation = 'source-over';
}
function frame(dt) {
  if (!ctx) return;
  ctx.clearRect(0, 0, W, H);
  const t = cfg.type;
  if (t === 'nebula') drawNebula(); else if (t === 'aurora') drawAurora(); else if (t === 'grid') drawGrid();
  else if (t === 'waves') drawWaves(); else if (t === 'lava') drawLava(); else if (t === 'bokeh') drawBokeh(dt);
  else if (t === 'blobs' || t === 'mesh') drawBlobs(); else if (t === 'bubbles') drawBubbles(dt);
  if (stars.length) drawStars(dt);
  if (t === 'particles') drawParticles(dt); else if (t === 'matrix') drawMatrix(dt);
  else if (t === 'snow') drawSnow(dt); else if (t === 'fireflies') drawFireflies(dt); else if (t === 'hexgrid') drawHex(); else if (t === 'confetti') drawConfetti(dt); else if (t === 'rain') drawRain(dt); else if (t === 'orbits') drawOrbits(dt);
}

// ---- 14.0 backgrounds ----
const sp14 = () => (cfg.stars.speed || .5) * 2;
function drawSnow(dt) {
  const col = cfg.stars.color || '#ffffff';
  for (const f of fx14) {
    f.y += (18 + f.r * 14) * f.v * dt * sp14() * (1 + E.level); f.x += Math.sin(tt * .8 + f.p) * 14 * dt + (mouse.x > 0 ? (f.x - mouse.x) / Math.max(40, Math.hypot(f.x - mouse.x, f.y - mouse.y) ** 1.4) * 30 : 0);
    if (f.y > H + 6) { f.y = -6; f.x = Math.random() * W; } if (f.x < -6) f.x = W + 6; else if (f.x > W + 6) f.x = -6;
    ctx.fillStyle = hex(col, .35 + f.r / 8); ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 6.283); ctx.fill();
  }
}
function drawFireflies(dt) {
  const cols = [cfg.accent, cfg.accent2, cfg.c3]; ctx.globalCompositeOperation = 'lighter';
  for (const f of fx14) {
    f.a += f.w * .1 * dt; f.x += Math.cos(f.a) * 22 * dt * sp14(); f.y += Math.sin(f.a * 1.3) * 18 * dt * sp14();
    if (f.x < -20) f.x = W + 20; else if (f.x > W + 20) f.x = -20; if (f.y < -20) f.y = H + 20; else if (f.y > H + 20) f.y = -20;
    const glow = (.35 + .65 * Math.max(0, Math.sin(tt * f.v * 2 + f.p))) * (1 + E.high); const r = 10 + f.r * 5;
    const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r); g.addColorStop(0, hex(cols[f.k], .9 * glow)); g.addColorStop(.25, hex(cols[f.k], .35 * glow)); g.addColorStop(1, hex(cols[f.k], 0));
    ctx.fillStyle = g; ctx.fillRect(f.x - r, f.y - r, r * 2, r * 2);
  }
  ctx.globalCompositeOperation = 'source-over';
}
function drawHex() {
  const R = 26, w = R * Math.sqrt(3), hh = R * 1.5; ctx.lineWidth = 1;
  for (let row = -1, y = 0; y < H + R * 2; row++, y = row * hh) for (let col = -1; col * w < W + w; col++) {
    const x = col * w + (row % 2 ? w / 2 : 0); const d = Math.hypot(x - mouse.x, y - mouse.y); const wave = .5 + .5 * Math.sin(tt * .9 - (x + y) * .006);
    const lit = Math.max(0, 1 - d / 220) + wave * .25 + E.level * .4;
    ctx.strokeStyle = hex(d < 220 ? cfg.accent : cfg.c3, .08 + lit * .35); ctx.beginPath();
    for (let i = 0; i < 6; i++) { const an = Math.PI / 3 * i + Math.PI / 6; const px = x + Math.cos(an) * (R - 2), py = y + Math.sin(an) * (R - 2); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
    ctx.closePath(); ctx.stroke(); if (lit > .75) { ctx.fillStyle = hex(cfg.accent, (lit - .75) * .35); ctx.fill(); }
  }
}
function drawConfetti(dt) {
  const cols = [cfg.accent, cfg.accent2, cfg.c3, '#ffd166', '#ef476f'];
  for (const f of fx14) {
    f.y += (30 + f.v * 40) * dt * sp14(); f.x += Math.sin(tt + f.p) * 20 * dt; f.a += f.w * dt;
    if (f.y > H + 10) { f.y = -10; f.x = Math.random() * W; }
    ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.a); ctx.scale(1, Math.cos(tt * 3 + f.p)); ctx.fillStyle = hex(cols[(f.k + Math.floor(f.p)) % cols.length], .75); ctx.fillRect(-4, -2, 8, 4); ctx.restore();
  }
}
function drawRain(dt) {
  ctx.strokeStyle = hex(cfg.stars.color || '#a5c8ff', .28); ctx.lineWidth = 1.1; ctx.beginPath();
  for (const f of fx14) {
    f.y += (420 + f.v * 260) * dt * sp14() * .6; f.x -= 60 * dt; if (f.y > H) { f.y = -20 - Math.random() * 100; f.x = Math.random() * (W + 100); }
    const l = 10 + f.r * 5; ctx.moveTo(f.x, f.y); ctx.lineTo(f.x - l * .14, f.y + l);
  }
  ctx.stroke();
}
function drawOrbits(dt) {
  const cx = W * .5, cy = H * .5; ctx.lineWidth = 1; const cols = [cfg.accent, cfg.accent2, cfg.c3];
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 70); g.addColorStop(0, hex(cfg.accent, .55 + E.bass * .3)); g.addColorStop(1, hex(cfg.accent, 0)); ctx.fillStyle = g; ctx.fillRect(cx - 70, cy - 70, 140, 140);
  for (const f of fx14) {
    f.a += dt * sp14() * .5 * (90 / f.r); ctx.strokeStyle = hex(cfg.c3, .14); ctx.beginPath(); ctx.ellipse(cx, cy, f.r, f.r * .42, -.3, 0, 6.283); ctx.stroke();
    const x = cx + Math.cos(f.a) * f.r * Math.cos(-.3) - Math.sin(f.a) * f.r * .42 * Math.sin(-.3); const y = cy + Math.cos(f.a) * f.r * Math.sin(-.3) + Math.sin(f.a) * f.r * .42 * Math.cos(-.3);
    const rr = 3 + f.k * 2; const gg = ctx.createRadialGradient(x, y, 0, x, y, rr * 4); gg.addColorStop(0, hex(cols[f.k], .95)); gg.addColorStop(.3, hex(cols[f.k], .4)); gg.addColorStop(1, hex(cols[f.k], 0)); ctx.fillStyle = gg; ctx.fillRect(x - rr * 4, y - rr * 4, rr * 8, rr * 8);
  }
}
