// Nebulix 3.0 phase 23 — screensaver. Starts after N idle minutes (Settings → Appearance; off by default), never while a
// game, a video, a stream, a remote machine or full screen is in use, and ends on any key, click or mouse move.
// Styles are drawn on one canvas: starfield, clock, matrix rain, aurora and bouncing logo. Settings live on the device.
import { h, ls } from './util.js';
import { t, locale } from './i18n.js';
import { GAME_ROUTES } from './playtime.js';

export const STYLES = [['stars', 'Starfield'], ['clock', 'Clock'], ['matrix', 'Matrix rain'], ['aurora', 'Aurora'], ['logo', 'Bouncing logo']];
const BUSY = new Set([...GAME_ROUTES, 'cloudpc', 'android', 'vm', 'tv', 'live', 'clips', 'videoed', 'cloud', 'trailer', 'dj', 'audio', 'terminal']);
export const settings = () => { const s = ls('ss') || {}; return { after: [0, 1, 2, 5, 10, 15, 30, 60].includes(s.after) ? s.after : 0, style: STYLES.some((x) => x[0] === s.style) ? s.style : 'stars' }; };
export const save = (patch) => ls('ss', Object.assign(settings(), patch));

let last = Date.now(), el = null, raf = 0, startedAt = 0;
function busy() {
  if (document.fullscreenElement || document.pictureInPictureElement) return true;
  if ([...document.querySelectorAll('video, audio')].some((m) => !m.paused && !m.ended)) return true;
  const route = String(location.hash || '').replace(/^#\/?/, '').split(/[/?]/)[0];
  if (BUSY.has(route)) return true;
  // desktop mode: an open, not minimised window of a game or a remote machine
  if ([...document.querySelectorAll('.os-win:not(.min)')].some((w) => BUSY.has(w.dataset.app))) return true;
  return false;
}
export function show(style = settings().style) {
  if (el) return; startedAt = Date.now();
  const cv = h('canvas'); const hint = h('div.ss-hint', t('Move the mouse or press a key to come back'));
  el = h('div.ss', { role: 'presentation' }, cv, hint); document.body.append(el);
  const g = cv.getContext('2d'); let W = 0, H = 0; const dpr = Math.min(2, devicePixelRatio || 1);
  const size = () => { W = innerWidth; H = innerHeight; cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px'; g.setTransform(dpr, 0, 0, dpr, 0, 0); };
  size(); addEventListener('resize', size);
  const R = Math.random;
  const stars = Array.from({ length: 420 }, () => ({ x: R() * 2 - 1, y: R() * 2 - 1, z: R() }));
  const cols = []; const fs = 16; const glyphs = 'アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789NEBULIX';
  let lx = 100, ly = 100, vx = 2.2, vy = 1.7, hue = 260;
  const fmtT = new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit' }); const fmtD = new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'long' });
  const frame = (ms) => {
    raf = requestAnimationFrame(frame);
    if (style === 'stars') {
      g.fillStyle = 'rgba(4,4,12,.35)'; g.fillRect(0, 0, W, H);
      for (const s of stars) { s.z -= 0.004; if (s.z <= 0.01) { s.x = R() * 2 - 1; s.y = R() * 2 - 1; s.z = 1; } const k = 0.6 / s.z; const x = W / 2 + s.x * k * W / 2, y = H / 2 + s.y * k * H / 2; const r = Math.max(0.3, (1 - s.z) * 2.6); g.fillStyle = `rgba(${200 + 55 * (1 - s.z)},${210},255,${1 - s.z})`; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
    } else if (style === 'matrix') {
      const n = Math.ceil(W / fs); while (cols.length < n) cols.push(R() * -H / fs);
      g.fillStyle = 'rgba(0,0,0,.08)'; g.fillRect(0, 0, W, H); g.font = fs + 'px ui-monospace, monospace'; g.fillStyle = '#22e07a';
      for (let i = 0; i < n; i++) { g.fillText(glyphs[(R() * glyphs.length) | 0], i * fs, cols[i] * fs); if (cols[i] * fs > H && R() > 0.975) cols[i] = 0; cols[i] += 0.5; }
    } else if (style === 'aurora') {
      const tt = ms / 1000; g.fillStyle = '#030712'; g.fillRect(0, 0, W, H); g.globalCompositeOperation = 'lighter';
      for (let b = 0; b < 4; b++) { const grad = g.createLinearGradient(0, 0, W, 0); const hh = (160 + b * 45 + tt * 8) % 360; grad.addColorStop(0, `hsla(${hh},90%,55%,0)`); grad.addColorStop(0.5, `hsla(${hh},90%,55%,.22)`); grad.addColorStop(1, `hsla(${hh + 40},90%,55%,0)`); g.fillStyle = grad; g.beginPath(); g.moveTo(0, H); for (let x = 0; x <= W; x += 24) g.lineTo(x, H * 0.45 + Math.sin(x / 210 + tt * (0.25 + b * 0.08) + b) * H * 0.12 + Math.sin(x / 90 + tt * 0.6) * 18 - b * 40); g.lineTo(W, H); g.fill(); }
      g.globalCompositeOperation = 'source-over';
    } else if (style === 'logo') {
      g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, 0, W, H); const lw = 220, lh = 70; lx += vx; ly += vy;
      if (lx < 0 || lx + lw > W) { vx = -vx; hue = (hue + 67) % 360; lx = Math.max(0, Math.min(W - lw, lx)); } if (ly < 0 || ly + lh > H) { vy = -vy; hue = (hue + 67) % 360; ly = Math.max(0, Math.min(H - lh, ly)); }
      g.fillStyle = `hsl(${hue},90%,62%)`; g.font = '800 46px system-ui, sans-serif'; g.textBaseline = 'top'; g.fillText('NEBULIX', lx + 8, ly + 10);
    }
    if (style === 'clock' || style === 'aurora') {
      if (style === 'clock') { g.fillStyle = '#05060a'; g.fillRect(0, 0, W, H); }
      const d = new Date(); const drift = Math.floor((Date.now() - startedAt) / 60000); // nudge the clock every minute so nothing burns in
      const cx = W / 2 + Math.sin(drift) * W * 0.12, cy = H / 2 + Math.cos(drift * 1.3) * H * 0.12;
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = 'rgba(255,255,255,.92)'; g.font = `200 ${Math.min(W / 5, 180)}px system-ui, sans-serif`; g.fillText(fmtT.format(d), cx, cy);
      g.fillStyle = 'rgba(255,255,255,.55)'; g.font = `400 ${Math.min(W / 28, 26)}px system-ui, sans-serif`; g.fillText(fmtD.format(d), cx, cy + Math.min(W / 8, 110)); g.textAlign = 'start';
    }
  };
  raf = requestAnimationFrame(frame);
  el._off = () => removeEventListener('resize', size);
}
export function hide() { if (!el) return; cancelAnimationFrame(raf); el._off(); el.remove(); el = null; }
export const showing = () => !!el;

let started = false;
export function start() {
  if (started) return; started = true;
  const wake = (e) => { last = Date.now(); if (el && Date.now() - startedAt > 600) { hide(); if (e && e.type !== 'pointermove') { e.preventDefault && e.preventDefault(); e.stopPropagation && e.stopPropagation(); } } };
  for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart']) addEventListener(ev, wake, { capture: true, passive: ev === 'pointermove' || ev === 'wheel' || ev === 'touchstart' });
  setInterval(() => {
    const s = settings(); if (!s.after || el || document.visibilityState !== 'visible') return;
    if (busy()) { last = Date.now(); return; }
    if (Date.now() - last >= s.after * 60000) show(s.style);
  }, 5000);
}
