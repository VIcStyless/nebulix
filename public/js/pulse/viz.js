// Pulse visualizers: canvas skins driven by the live spectrum (orbit, vinyl, neon bars, waves, particles, tunnel, minimal).
import { clamp } from '../util.js';

export const SKINS = [['orbit', 'Orbit', '🪐'], ['vinyl', 'Vinyl', '💿'], ['bars', 'Neon bars', '📊'], ['waves', 'Waves', '🌊'], ['particles', 'Particles', '✨'], ['tunnel', 'Tunnel', '🌀'], ['minimal', 'Minimal', '◻️']];
const TAU = Math.PI * 2;
const css = (k, d) => (getComputedStyle(document.documentElement).getPropertyValue(k).trim() || d);
const rgb = (c) => { const m = /^#?([0-9a-f]{6})/i.exec(c || ''); if (!m) return [139, 92, 246]; const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${clamp(a, 0, 1)})`;
const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k].map(Math.round);

export class Viz {
  constructor(canvas, src) {
    this.cv = canvas; this.g = canvas.getContext('2d'); this.src = src; // { freq(), wave(), playing(), progress() }
    this.skin = 'orbit'; this.o = { bars: 96, glow: 0.7, sens: 1, mirror: true, colors: 'theme', c1: '#8b5cf6', c2: '#38bdf8', cover: true };
    this.cover = null; this.coverCols = null; this.t = 0; this.last = 0; this.raf = 0; this.rot = 0; this.spin = 0; this.peaks = []; this.parts = []; this.rings = []; this.beat = 0; this.bAvg = 0.2; this.bCool = 0; this.idle = 0;
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(canvas); this.resize(); this.cols();
  }
  resize() { const d = Math.min(2, devicePixelRatio || 1); const r = this.cv.getBoundingClientRect(); this.W = Math.max(10, r.width); this.H = Math.max(10, r.height); this.cv.width = Math.round(this.W * d); this.cv.height = Math.round(this.H * d); this.g.setTransform(d, 0, 0, d, 0, 0); }
  setSkin(s) { this.skin = SKINS.some((x) => x[0] === s) ? s : 'orbit'; this.parts = []; this.rings = []; }
  setOpts(o) { Object.assign(this.o, o); this.cols(); }
  cols() {
    if (this.o.colors === 'custom') { this.c1 = rgb(this.o.c1); this.c2 = rgb(this.o.c2); }
    else if (this.o.colors === 'cover' && this.coverCols) { [this.c1, this.c2] = this.coverCols; }
    else { this.c1 = rgb(css('--accent', '#8b5cf6')); this.c2 = rgb(css('--accent2', '#38bdf8')); }
  }
  setCover(url) {
    this.cover = null; this.coverCols = null; if (!url) { this.cols(); return; }
    const img = new Image(); img.onload = () => { this.cover = img; try { this.coverCols = palette(img); } catch {} this.cols(); }; img.src = url;
  }
  start() { if (this.raf) return; this.last = performance.now(); const loop = (now) => { this.raf = requestAnimationFrame(loop); if (document.hidden) return; const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now; this.frame(dt); }; this.raf = requestAnimationFrame(loop); }
  stop() { cancelAnimationFrame(this.raf); this.raf = 0; }
  destroy() { this.stop(); this.ro.disconnect(); }
  // normalised spectrum (log-spaced bins) 0..1
  spectrum(n) {
    const f = this.src.freq && this.src.playing() ? this.src.freq() : null; const out = new Float32Array(n);
    if (!f) { this.idle += 0.016; for (let i = 0; i < n; i++) out[i] = 0.08 + 0.06 * Math.sin(this.idle * 2 + i * 0.35) + 0.04 * Math.sin(this.idle * 3.1 - i * 0.17); return out; }
    const L = f.length * 0.72; for (let i = 0; i < n; i++) { const a = Math.floor(Math.pow(L, i / n)), b = Math.max(a + 1, Math.floor(Math.pow(L, (i + 1) / n))); let s = 0; for (let k = a; k < b; k++) s += f[k]; out[i] = clamp(Math.pow(s / (b - a) / 255, 1.35) * this.o.sens * (1 + i / n * 0.6), 0, 1); }
    return out;
  }
  frame(dt) {
    const g = this.g, W = this.W, H = this.H; this.t += dt; const playing = this.src.playing();
    const sp = this.spectrum(this.skin === 'bars' ? Math.max(24, Math.min(160, this.o.bars)) : this.o.bars);
    let bass = 0; for (let i = 0; i < 6; i++) bass += sp[i]; bass /= 6;
    this.bAvg += (bass - this.bAvg) * 0.05; this.bCool -= dt;
    if (playing && bass > this.bAvg * 1.3 && bass > 0.32 && this.bCool <= 0) { this.beat = 1; this.bCool = 0.2; }
    this.beat = Math.max(0, this.beat - dt * 4);
    g.clearRect(0, 0, W, H); g.save(); g.shadowBlur = 0;
    try { this['d_' + this.skin](g, W, H, sp, dt, bass, playing); } catch (e) { /* never break the page for a frame */ }
    g.restore();
  }
  glow(g, col, k = 1) { g.shadowColor = rgba(col, 0.9); g.shadowBlur = 18 * this.o.glow * k; }
  drawCover(g, x, y, r, rot = 0) {
    g.save(); g.beginPath(); g.arc(x, y, r, 0, TAU); g.clip();
    if (this.cover && this.o.cover) { g.translate(x, y); g.rotate(rot); g.drawImage(this.cover, -r, -r, r * 2, r * 2); }
    else { const gr = g.createLinearGradient(x - r, y - r, x + r, y + r); gr.addColorStop(0, rgba(this.c1, 1)); gr.addColorStop(1, rgba(this.c2, 1)); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); g.fillStyle = 'rgba(255,255,255,.85)'; g.font = `${Math.round(r * 0.7)}px system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('♪', x, y); }
    g.restore();
  }
  d_orbit(g, W, H, sp, dt, bass, playing) {
    const cx = W / 2, cy = H / 2, m = Math.min(W, H); const R = m * 0.2 * (1 + this.beat * 0.05);
    if (playing) this.rot += dt * 0.12;
    const n = sp.length; g.lineCap = 'round'; g.lineWidth = Math.max(2, (TAU * R / n) * 0.55);
    for (let i = 0; i < n; i++) {
      const v = sp[i]; const len = 6 + v * m * 0.2; const col = mix(this.c1, this.c2, i / n);
      for (const s of this.o.mirror ? [1, -1] : [1]) {
        const a = -Math.PI / 2 + s * (i / n) * Math.PI * (this.o.mirror ? 1 : 2);
        const x1 = cx + Math.cos(a) * (R + 8), y1 = cy + Math.sin(a) * (R + 8), x2 = cx + Math.cos(a) * (R + 8 + len), y2 = cy + Math.sin(a) * (R + 8 + len);
        g.strokeStyle = rgba(col, 0.55 + v * 0.45); this.glow(g, col, v); g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
      }
    }
    g.shadowBlur = 0;
    for (let k = 0; k < 3; k++) { const rr = R * (1.9 + k * 0.42); g.strokeStyle = rgba(this.c2, 0.12); g.lineWidth = 1; g.beginPath(); g.arc(cx, cy, rr, 0, TAU); g.stroke(); const band = [bass, sp[Math.floor(n * 0.4)], sp[Math.floor(n * 0.8)]][k]; this['orb' + k] = (this['orb' + k] || k * 2) + dt * (0.3 + band * 2.2) * (k % 2 ? -1 : 1); const a = this['orb' + k]; const col = k === 1 ? this.c2 : this.c1; this.glow(g, col, 1.5); g.fillStyle = rgba(col, 1); g.beginPath(); g.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 3 + band * 7, 0, TAU); g.fill(); }
    g.shadowBlur = 0; this.glow(g, this.c1, 1.2 + this.beat); g.fillStyle = '#000'; g.beginPath(); g.arc(cx, cy, R + 2, 0, TAU); g.fill(); g.shadowBlur = 0;
    this.drawCover(g, cx, cy, R, this.rot);
  }
  d_vinyl(g, W, H, sp, dt, bass, playing) {
    const cx = W / 2, cy = H / 2, m = Math.min(W, H); const R = m * 0.38;
    this.spin += ((playing ? 1 : 0) - this.spin) * Math.min(1, dt * (playing ? 2.2 : 1.4)); this.rot += dt * this.spin * TAU * (33.333 / 60);
    // spectrum halo
    const n = sp.length; for (let i = 0; i < n; i++) { const a = (i / n) * TAU - Math.PI / 2; const v = sp[i]; const col = mix(this.c1, this.c2, i / n); g.strokeStyle = rgba(col, 0.25 + v * 0.7); g.lineWidth = (TAU * R / n) * 0.7; this.glow(g, col, v * 1.4); g.beginPath(); g.arc(cx, cy, R + 6 + v * m * 0.06, a, a + TAU / n * 0.75); g.stroke(); }
    g.shadowBlur = 0;
    g.fillStyle = '#0b0b10'; g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.fill();
    for (let k = 0; k < 26; k++) { g.strokeStyle = `rgba(255,255,255,${0.025 + (k % 3 === 0 ? 0.03 : 0)})`; g.lineWidth = 1; g.beginPath(); g.arc(cx, cy, R * (0.42 + k * 0.022), 0, TAU); g.stroke(); }
    g.save(); g.translate(cx, cy); g.rotate(this.rot); const sh = g.createLinearGradient(-R, -R, R, R); sh.addColorStop(0.35, 'rgba(255,255,255,0)'); sh.addColorStop(0.5, 'rgba(255,255,255,.09)'); sh.addColorStop(0.65, 'rgba(255,255,255,0)'); g.fillStyle = sh; g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fill(); g.restore();
    this.drawCover(g, cx, cy, R * 0.36, this.rot); g.fillStyle = '#111'; g.beginPath(); g.arc(cx, cy, R * 0.03, 0, TAU); g.fill();
    // tonearm follows progress
    const p = clamp(this.src.progress ? this.src.progress() : 0, 0, 1); const px = cx + R * 1.12, py = cy - R * 0.92; const ang = (playing || p > 0 ? 0.42 + p * 0.38 : 0.12) * Math.PI / 2;
    g.save(); g.translate(px, py); g.rotate(Math.PI / 2 + ang); g.strokeStyle = '#c9c9d6'; g.lineWidth = Math.max(3, R * 0.03); g.lineCap = 'round'; g.beginPath(); g.moveTo(0, 0); g.lineTo(0, R * 1.18); g.stroke(); g.fillStyle = '#e4e4ee'; g.fillRect(-R * 0.04, R * 1.12, R * 0.08, R * 0.14); g.restore();
    g.fillStyle = '#9b9bb0'; g.beginPath(); g.arc(px, py, R * 0.07, 0, TAU); g.fill();
  }
  d_bars(g, W, H, sp) {
    const n = sp.length; const gap = 2; const bw = (W - gap * n) / n; const base = H * (this.o.mirror ? 0.72 : 0.94);
    if (this.peaks.length !== n) this.peaks = new Array(n).fill(0);
    const gr = g.createLinearGradient(0, base - H * 0.7, 0, base); gr.addColorStop(0, rgba(this.c2, 1)); gr.addColorStop(1, rgba(this.c1, 1));
    for (let i = 0; i < n; i++) {
      const v = sp[i]; const h = Math.max(2, v * H * 0.66); const x = i * (bw + gap) + gap / 2;
      this.peaks[i] = Math.max(this.peaks[i] - 0.012, v);
      this.glow(g, mix(this.c1, this.c2, v), v); g.fillStyle = gr; g.fillRect(x, base - h, bw, h);
      g.shadowBlur = 0; g.fillStyle = rgba(this.c2, 0.95); g.fillRect(x, base - this.peaks[i] * H * 0.66 - 5, bw, 3);
      if (this.o.mirror) { g.fillStyle = rgba(this.c1, 0.18); g.fillRect(x, base + 3, bw, h * 0.35); }
    }
  }
  d_waves(g, W, H, sp, dt, bass) {
    const w = this.src.wave && this.src.playing() ? this.src.wave() : null; const cy = H / 2;
    for (let k = 0; k < 4; k++) {
      const col = mix(this.c1, this.c2, k / 3); g.strokeStyle = rgba(col, 0.75 - k * 0.12); g.lineWidth = 2.5 - k * 0.4; this.glow(g, col, 1); g.beginPath();
      const amp = H * (0.18 + bass * 0.25) * (1 - k * 0.15);
      for (let x = 0; x <= W; x += 4) {
        const u = x / W; let v;
        if (w) { const i = Math.floor(u * (w.length - 1)); v = (w[(i + k * 37) % w.length] - 128) / 128; } else v = Math.sin(u * 9 + this.t * 2 + k) * 0.25;
        const env = Math.sin(u * Math.PI); const y = cy + v * amp * env + Math.sin(u * 6 + this.t * (1 + k * 0.3)) * H * 0.04 * (k + 1) * env;
        if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
    g.shadowBlur = 0; const gr = g.createLinearGradient(0, cy, 0, H); gr.addColorStop(0, rgba(this.c1, 0.12)); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, cy, W, H / 2);
  }
  d_particles(g, W, H, sp, dt, bass, playing) {
    const cx = W / 2, cy = H / 2; const lvl = sp.reduce((a, b) => a + b, 0) / sp.length;
    const spawn = (k, speed) => { for (let i = 0; i < k; i++) { const a = Math.random() * TAU; const s = speed * (0.4 + Math.random()); const band = Math.floor(Math.random() * sp.length); this.parts.push({ x: cx, y: cy, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1, c: mix(this.c1, this.c2, band / sp.length), r: 1 + sp[band] * 3.5 }); } };
    if (playing) spawn(Math.round(lvl * 10), 60 + lvl * 220); else if (Math.random() < 0.3) spawn(1, 40);
    if (this.beat > 0.95) spawn(45, 320);
    if (this.parts.length > 900) this.parts.splice(0, this.parts.length - 900);
    g.globalCompositeOperation = 'lighter';
    for (let i = this.parts.length - 1; i >= 0; i--) { const p = this.parts[i]; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.995; p.vy *= 0.995; p.life -= dt * 0.45; if (p.life <= 0 || p.x < -20 || p.y < -20 || p.x > W + 20 || p.y > H + 20) { this.parts.splice(i, 1); continue; } g.fillStyle = rgba(p.c, p.life); g.beginPath(); g.arc(p.x, p.y, p.r, 0, TAU); g.fill(); }
    g.globalCompositeOperation = 'source-over';
    const R = Math.min(W, H) * 0.12 * (1 + this.beat * 0.1); this.glow(g, this.c1, 1.5); this.drawCover(g, cx, cy, R, 0); g.shadowBlur = 0;
  }
  d_tunnel(g, W, H, sp, dt, bass, playing) {
    const cx = W / 2, cy = H / 2, m = Math.max(W, H);
    if (!this.rings.length || this.rings[this.rings.length - 1].z > 0.08) this.rings.push({ z: 0, h: this.t });
    const speed = 0.12 + (playing ? bass * 0.6 : 0.02);
    for (const r of this.rings) r.z += dt * speed * (0.6 + r.z);
    this.rings = this.rings.filter((r) => r.z < 1.25);
    for (const r of this.rings) {
      const rad = Math.pow(r.z, 1.6) * m * 0.75; const col = mix(this.c1, this.c2, (Math.sin(r.h * 0.7) + 1) / 2);
      g.strokeStyle = rgba(col, Math.min(1, r.z * 1.6) * (1.25 - r.z)); g.lineWidth = 1 + r.z * 3; this.glow(g, col, r.z); g.beginPath();
      const n = 64; for (let i = 0; i <= n; i++) { const a = (i / n) * TAU + this.t * 0.2; const v = sp[Math.floor((i % n) / n * sp.length)]; const rr = rad * (1 + v * 0.22); const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr; if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); }
      g.stroke();
    }
    g.shadowBlur = 0;
  }
  d_minimal(g, W, H, sp) {
    const s = Math.min(W, H) * 0.56; const x = (W - s) / 2, y = (H - s) / 2 - H * 0.04; const k = 1 + this.beat * 0.025;
    g.save(); g.translate(W / 2, y + s / 2); g.scale(k, k); g.translate(-W / 2, -(y + s / 2)); this.glow(g, this.c1, 2); g.fillStyle = '#000'; rr(g, x, y, s, s, s * 0.06); g.fill(); g.shadowBlur = 0; g.save(); rr(g, x, y, s, s, s * 0.06); g.clip();
    if (this.cover && this.o.cover) g.drawImage(this.cover, x, y, s, s); else { const gr = g.createLinearGradient(x, y, x + s, y + s); gr.addColorStop(0, rgba(this.c1, 1)); gr.addColorStop(1, rgba(this.c2, 1)); g.fillStyle = gr; g.fillRect(x, y, s, s); }
    g.restore(); g.restore();
    const n = sp.length; const by = y + s + H * 0.06; g.strokeStyle = rgba(this.c2, 0.9); g.lineWidth = 2; g.beginPath();
    for (let i = 0; i < n; i++) { const xx = x + (i / (n - 1)) * s; const yy = by - sp[i] * H * 0.08; if (i === 0) g.moveTo(xx, yy); else g.lineTo(xx, yy); }
    g.stroke();
  }
}
function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
// two vivid colours from an image (for "colours from cover art")
export function palette(img) {
  const c = document.createElement('canvas'); c.width = c.height = 24; const g = c.getContext('2d'); g.drawImage(img, 0, 0, 24, 24); const d = g.getImageData(0, 0, 24, 24).data;
  const buckets = new Map();
  for (let i = 0; i < d.length; i += 4) { const r = d[i], gg = d[i + 1], b = d[i + 2]; const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b); const sat = mx ? (mx - mn) / mx : 0; if (mx < 50 || sat < 0.25) continue; const key = ((r >> 5) << 6) | ((gg >> 5) << 3) | (b >> 5); const e = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0, s: 0 }; e.n++; e.r += r; e.g += gg; e.b += b; e.s += sat; buckets.set(key, e); }
  const list = [...buckets.values()].sort((a, b) => b.n * b.s - a.n * a.s);
  const col = (e) => [e.r / e.n, e.g / e.n, e.b / e.n].map(Math.round);
  if (!list.length) return null; const a = col(list[0]); const b = list.find((e) => { const c2 = col(e); return Math.abs(c2[0] - a[0]) + Math.abs(c2[1] - a[1]) + Math.abs(c2[2] - a[2]) > 120; });
  return [a, b ? col(b) : [255 - a[0], 255 - a[1], 255 - a[2]]];
}
// tiny animated equaliser icon (3 bars) for "now playing" chips
export function eqIcon() { const el = document.createElement('span'); el.className = 'eqi'; for (let i = 0; i < 3; i++) el.appendChild(document.createElement('i')); return el; }
