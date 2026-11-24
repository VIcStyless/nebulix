// Nebulix 14 extras for the whole app:
//  • Makeovers — one click changes everything at once: design, menu layout, colour theme and screen effect.
//  • Screen effects — snow, sakura petals, autumn leaves, shooting stars, bubbles or hearts falling over the app.
//  • Pointer effects — sparks where you click and a soft glowing trail behind the cursor.
//  • Day / night — switch between two themes automatically by the time of day.
//  • Coin and gem counters bounce when they change.
// Everything is saved on this device and turned off when the user prefers reduced motion.
import { ls } from './util.js';
import * as theme from './theme.js';

const reduced = () => document.documentElement.dataset.reduce === '1' || (document.documentElement.dataset.reduce !== '0' && matchMedia('(prefers-reduced-motion: reduce)').matches);

// ---------- makeovers ----------
// theme: a preset name or a full theme object. layout: see LAYOUTS in app.js.
export const MAKEOVERS = [
  { id: 'n14', name: 'Nebulix 14', desc: 'The fresh new look: floating glass, aurora light and fireflies.', emoji: '✨', design: 'fourteen', layout: 'nexus', theme: 'Nebulix 14', fx: 'none' },
  { id: 'n7', name: 'Classic Nebulix', desc: 'The look from before 14.0, exactly as it was.', emoji: '🕰️', design: 'seven', layout: 'nexus', theme: 'Graphite', fx: 'none' },
  { id: 'dev', name: 'Developer', desc: 'Quiet, dense and square like a code-hosting site, dark.', emoji: '💻', design: 'dev', layout: 'left', theme: 'GitHub Dark', fx: 'none' },
  { id: 'cyber', name: 'Night City', desc: 'Cyberpunk: cut corners, neon yellow and rain.', emoji: '🌃', design: 'cyber', layout: 'top', theme: 'Night City', fx: 'none' },
  { id: 'kawaii', name: 'Cotton Candy', desc: 'Pastel bubbles, bouncy buttons and sakura petals.', emoji: '🌸', design: 'kawaii', layout: 'dock', theme: 'Cotton Candy', fx: 'sakura' },
  { id: 'retro', name: 'Retro Desktop', desc: 'Bevelled buttons and title bars from a late-90s computer.', emoji: '🖥️', design: 'bevel', layout: 'top', theme: 'Retro Desktop', fx: 'none' },
  { id: 'holo', name: 'Hologram', desc: 'Iridescent foil that shifts colour, over shooting stars.', emoji: '🪩', design: 'holo', layout: 'island', theme: 'Hologram', fx: 'stars' },
  { id: 'bento', name: 'Bento', desc: 'Big calm tiles, huge titles, nothing extra.', emoji: '🍱', design: 'bento', layout: 'float', theme: 'Bento', fx: 'none' },
  { id: 'sketch', name: 'Sketchbook', desc: 'Hand-drawn wobbly lines on squared paper.', emoji: '✏️', design: 'sketch', layout: 'left', theme: 'Sketchbook', fx: 'none' },
  { id: 'winter', name: 'Winter Night', desc: 'Frosted glass, icy blue and falling snow.', emoji: '❄️', design: 'glass', layout: 'nexus', theme: 'Winter Night', fx: 'snow' },
  { id: 'forest', name: 'Firefly Forest', desc: 'Deep greens, warm light and fireflies drifting by.', emoji: '🌲', design: 'soft', layout: 'float', theme: 'Firefly Forest', fx: 'leaves' },
  { id: 'terminal', name: 'Hacker', desc: 'Green terminal type, glyph rain and scanlines.', emoji: '🧑‍💻', design: 'retro', layout: 'compact', theme: 'Matrix', fx: 'none' },
  { id: 'love', name: 'Valentine', desc: 'Warm pinks, soft corners and floating hearts.', emoji: '💗', design: 'fourteen', layout: 'island', theme: 'Valentine', fx: 'hearts' },
];
export function makeoverTheme(mk) { if (typeof mk.theme === 'string') { const p = theme.PRESETS.find((x) => x.name === mk.theme); return p ? theme.fromPreset(p) : theme.normalize(theme.DEFAULT); } return theme.normalize(mk.theme); }
export const makeoverNow = () => ls('fx14.mk') || '';

// ---------- screen effects ----------
export const SCREEN_FX = [['none', 'Off', '🚫'], ['snow', 'Snow', '❄️'], ['sakura', 'Sakura petals', '🌸'], ['leaves', 'Autumn leaves', '🍂'], ['stars', 'Shooting stars', '🌠'], ['bubbles', 'Bubbles', '🫧'], ['hearts', 'Hearts', '💗'], ['confetti', 'Confetti', '🎉']];
let fxCv = null, fxCtx = null, fxRaf = 0, fxParts = [], fxKind = 'none', fxLast = 0;
export const screenFxNow = () => ls('fx14.screen') || 'none';
export function setScreenFx(kind) { ls('fx14.screen', kind); startScreenFx(kind); }
function startScreenFx(kind) {
  fxKind = kind; cancelAnimationFrame(fxRaf);
  if (kind === 'none' || reduced()) { if (fxCv) { fxCv.remove(); fxCv = null; } return; }
  if (!fxCv) { fxCv = document.createElement('canvas'); fxCv.id = 'f14fx'; document.body.appendChild(fxCv); fxCtx = fxCv.getContext('2d'); }
  const fit = () => { if (!fxCv) return; const d = Math.min(devicePixelRatio || 1, 1.5); fxCv.width = innerWidth * d; fxCv.height = innerHeight * d; fxCv.style.width = innerWidth + 'px'; fxCv.style.height = innerHeight + 'px'; fxCtx.setTransform(d, 0, 0, d, 0, 0); };
  fit(); if (!startScreenFx.wired) { startScreenFx.wired = true; addEventListener('resize', fit); document.addEventListener('visibilitychange', () => { if (!document.hidden && fxKind !== 'none') { fxLast = performance.now(); fxRaf = requestAnimationFrame(fxLoop); } }); }
  const n = { snow: 90, sakura: 34, leaves: 26, stars: 3, bubbles: 26, hearts: 18, confetti: 60 }[kind] || 30;
  fxParts = Array.from({ length: n }, () => spawn(kind, true)); fxLast = performance.now(); fxRaf = requestAnimationFrame(fxLoop);
}
const R = (a, b) => a + Math.random() * (b - a);
function spawn(kind, anywhere) {
  const W = innerWidth, H = innerHeight;
  if (kind === 'stars') return { x: R(0, W), y: R(-H * .2, H * .4), vx: R(-520, -320), vy: R(160, 260), life: R(-6, 0), len: R(80, 160) };
  if (kind === 'bubbles') return { x: R(0, W), y: anywhere ? R(0, H) : H + 30, r: R(6, 22), v: R(20, 60), p: R(0, 6.28) };
  return { x: R(0, W), y: anywhere ? R(-H, H) : R(-60, -10), r: kind === 'snow' ? R(1.2, 3.4) : R(7, 14), v: R(28, 70) * (kind === 'snow' ? 1 : .8), p: R(0, 6.28), a: R(0, 6.28), w: R(-2, 2), c: Math.floor(R(0, 5)) };
}
function fxLoop(now) {
  if (!fxCv || document.hidden) return; const dt = Math.min(.05, (now - fxLast) / 1000); fxLast = now; const W = innerWidth, H = innerHeight; const g = fxCtx; g.clearRect(0, 0, W, H); const k = fxKind; const tt = now / 1000;
  for (let i = 0; i < fxParts.length; i++) {
    const p = fxParts[i];
    if (k === 'stars') {
      p.life += dt; if (p.life < 0) continue; p.x += p.vx * dt; p.y += p.vy * dt;
      const gr = g.createLinearGradient(p.x, p.y, p.x - p.vx / 520 * p.len, p.y - p.vy / 520 * p.len); gr.addColorStop(0, 'rgba(255,255,255,.95)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.strokeStyle = gr; g.lineWidth = 2; g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x - p.vx / 520 * p.len, p.y - p.vy / 520 * p.len); g.stroke();
      if (p.x < -200 || p.y > H + 200) fxParts[i] = spawn(k); continue;
    }
    if (k === 'bubbles') {
      p.y -= p.v * dt; p.x += Math.sin(tt + p.p) * 12 * dt; if (p.y < -30) fxParts[i] = spawn(k);
      g.strokeStyle = 'rgba(255,255,255,.45)'; g.lineWidth = 1.2; g.beginPath(); g.arc(p.x, p.y, p.r, 0, 6.283); g.stroke(); g.fillStyle = 'rgba(255,255,255,.55)'; g.beginPath(); g.arc(p.x - p.r * .35, p.y - p.r * .35, p.r * .18, 0, 6.283); g.fill(); continue;
    }
    p.y += p.v * dt; p.x += Math.sin(tt * .9 + p.p) * (k === 'snow' ? 16 : 34) * dt; p.a += p.w * dt;
    if (p.y > H + 30) fxParts[i] = spawn(k);
    if (k === 'snow') { g.fillStyle = 'rgba(255,255,255,.85)'; g.beginPath(); g.arc(p.x, p.y, p.r, 0, 6.283); g.fill(); continue; }
    g.save(); g.translate(p.x, p.y); g.rotate(p.a); const r = p.r;
    if (k === 'sakura') { g.fillStyle = ['#ffc1dc', '#ffb0d2', '#ffd6e8', '#ff9fc6', '#ffe4ef'][p.c]; g.beginPath(); g.ellipse(0, 0, r, r * .55, 0, 0, 6.283); g.fill(); g.fillStyle = 'rgba(255,255,255,.4)'; g.beginPath(); g.ellipse(-r * .2, -r * .1, r * .4, r * .18, 0, 0, 6.283); g.fill(); }
    else if (k === 'leaves') { g.fillStyle = ['#e8590c', '#f59f00', '#c92a2a', '#d9480f', '#fab005'][p.c]; g.beginPath(); g.moveTo(0, -r); g.quadraticCurveTo(r, 0, 0, r); g.quadraticCurveTo(-r, 0, 0, -r); g.fill(); g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, -r); g.lineTo(0, r); g.stroke(); }
    else if (k === 'hearts') { g.fillStyle = ['#ff4d8d', '#ff7aa8', '#ff9ec2', '#ff3b6b', '#ffc2d6'][p.c]; g.globalAlpha = .85; g.scale(r / 12, r / 12); g.beginPath(); g.moveTo(0, 4); g.bezierCurveTo(-12, -4, -6, -14, 0, -7); g.bezierCurveTo(6, -14, 12, -4, 0, 4); g.fill(); }
    else if (k === 'confetti') { g.scale(1, Math.cos(tt * 4 + p.p)); g.fillStyle = ['#ff4d8d', '#ffd166', '#06d6a0', '#118ab2', '#9b5de5'][p.c]; g.fillRect(-r / 2, -r / 4, r, r / 2); }
    g.restore();
  }
  fxRaf = requestAnimationFrame(fxLoop);
}

// ---------- pointer effects ----------
export const pointerFxNow = () => ls('fx14.pointer') || { click: false, trail: false };
export function setPointerFx(v) { ls('fx14.pointer', v); }
let lastTrail = 0;
function onDown(e) {
  if (!pointerFxNow().click || reduced() || e.button) return;
  const cs = getComputedStyle(document.documentElement); const cols = [cs.getPropertyValue('--accent'), cs.getPropertyValue('--accent2'), '#ffffff'];
  for (let i = 0; i < 10; i++) {
    const s = document.createElement('i'); s.className = 'f14-spark'; const a = (i / 10) * 6.283 + Math.random() * .4; const d = 22 + Math.random() * 26;
    s.style.cssText = `left:${e.clientX - 3}px;top:${e.clientY - 3}px;--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d}px;--c:${cols[i % 3].trim() || '#fff'}`;
    document.body.appendChild(s); setTimeout(() => s.remove(), 650);
  }
}
function onMove(e) {
  if (!pointerFxNow().trail || reduced() || e.pointerType === 'touch') return; const now = performance.now(); if (now - lastTrail < 28) return; lastTrail = now;
  const s = document.createElement('i'); s.className = 'f14-trail'; s.style.left = e.clientX + 'px'; s.style.top = e.clientY + 'px'; document.body.appendChild(s); setTimeout(() => s.remove(), 720);
}

// ---------- day / night ----------
export const dayNightNow = () => Object.assign({ on: false, day: 'Paper', night: 'Nebulix 14', from: 7, to: 20 }, ls('fx14.daynight') || {});
export function setDayNight(v) { ls('fx14.daynight', v); checkDayNight(true); }
let dnLast = '';
export function checkDayNight(force) {
  const c = dayNightNow(); if (!c.on) { dnLast = ''; return; }
  const hr = new Date().getHours(); const isDay = c.from <= c.to ? hr >= c.from && hr < c.to : hr >= c.from || hr < c.to; const want = isDay ? c.day : c.night;
  if (!force && want === dnLast) return; dnLast = want; const p = theme.PRESETS.find((x) => x.name === want); if (p) theme.apply(theme.fromPreset(p), { persist: false });
}

// ---------- counters bounce when they change ----------
function watchCounters() {
  const mo = new MutationObserver((recs) => { for (const r of recs) { const el = r.target.nodeType === 3 ? r.target.parentElement : r.target; const host = el && el.closest && el.closest('#coinbar, #gembar, .lvl-chip'); if (host) { host.classList.remove('f14-bump'); void host.offsetWidth; host.classList.add('f14-bump'); } } });
  const tryAttach = () => { const els = document.querySelectorAll('#coinbar, #gembar'); if (!els.length) return setTimeout(tryAttach, 1500); els.forEach((el) => mo.observe(el, { childList: true, characterData: true, subtree: true })); };
  tryAttach();
}

let started = false;
export function initFx14() {
  if (started) return; started = true;
  startScreenFx(screenFxNow());
  addEventListener('pointerdown', onDown, { passive: true }); addEventListener('pointermove', onMove, { passive: true });
  checkDayNight(true); setInterval(() => checkDayNight(false), 60000);
  watchCounters();
}
