// Nerd Lab shared helpers: probing the machine, tiny charts, small layout bits. Everything here runs locally in the browser.
import { h } from '../util.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';

export const nextFrame = () => new Promise((r) => requestAnimationFrame(r));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
export const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const pctl = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))]; };
export const round = (n, d = 1) => { const k = 10 ** d; return Math.round((n + Number.EPSILON) * k) / k; };

// ---------- layout bits ----------
export const card = (title, ic, ...kids) => h('section.card.nl-card', h('h3', ic ? icon(ic, 18) : null, title), ...kids);
export const kv = (k, v, title) => h('div.nl-kv', { title: title || null }, h('span', k), h('b', v === undefined || v === null || v === '' ? '—' : v));
export function stat(label, value = '—', unit, sub) {
  const v = h('div.nl-v', value === null ? '—' : String(value)); const u = unit ? h('small', unit) : null; if (u) v.appendChild(u);
  const s = h('div.nl-s', sub || ''); const el = h('div.nl-stat', v, h('div.nl-l', label), s);
  el.set = (val, un, sb) => { v.textContent = val === null || val === undefined ? '—' : String(val); const uu = un !== undefined ? un : unit; if (uu) v.appendChild(h('small', uu)); if (sb !== undefined) s.textContent = sb; el.classList.toggle('nl-none', val === null || val === undefined); };
  el.classList.toggle('nl-none', value === '—' || value === null); return el;
}
export const pill = (text, kind) => h('span.pill' + (kind ? '.' + kind : ''), text);
export const progress = () => { const i = h('i'); const el = h('div.nl-bar', i); el.set = (p) => { i.style.width = Math.max(0, Math.min(100, p * 100)) + '%'; }; return el; };

// A crisp canvas line chart that sizes itself to its box when drawn.
export function sparkline(opt = {}) {
  const H = opt.h || 64; const c = h('canvas.nl-spark', { style: { height: H + 'px' }, 'aria-hidden': 'true' });
  c.draw = (vals, o = {}) => {
    const dpr = window.devicePixelRatio || 1; const W = Math.max(120, Math.round(c.clientWidth || 320));
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const cs = getComputedStyle(document.documentElement); const col = o.color || cs.getPropertyValue('--accent2').trim() || '#38bdf8'; const grid = cs.getPropertyValue('--border').trim() || '#444';
    g.strokeStyle = grid; g.globalAlpha = .5; g.lineWidth = 1; for (let i = 1; i < 4; i++) { const y = Math.round((H / 4) * i) + .5; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); } g.globalAlpha = 1;
    if (!vals || !vals.length) return;
    const lo = o.min !== undefined ? o.min : Math.min(...vals); const hi = o.max !== undefined ? o.max : Math.max(...vals); const span = hi - lo || 1;
    const X = (i) => (vals.length === 1 ? W / 2 : 2 + (i / (vals.length - 1)) * (W - 4)); const Y = (v) => H - 4 - ((Math.min(hi, Math.max(lo, v)) - lo) / span) * (H - 8);
    g.beginPath(); vals.forEach((v, i) => (i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v)))); g.strokeStyle = col; g.lineWidth = 2; g.lineJoin = 'round'; g.stroke();
    g.lineTo(X(vals.length - 1), H); g.lineTo(X(0), H); g.closePath(); g.globalAlpha = .14; g.fillStyle = col; g.fill(); g.globalAlpha = 1;
  };
  return c;
}

// ---------- display refresh rate ----------
const RATES = [24, 25, 30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 170, 180, 200, 240, 280, 300, 360, 480, 540];
export const snapHz = (hz) => { let best = null; for (const r of RATES) { if (Math.abs(hz - r) / r < 0.035 && (!best || Math.abs(hz - r) < Math.abs(hz - best))) best = r; } return best || Math.round(hz); };
// Median frame interval over `ms` of requestAnimationFrame ticks (needs the tab to be visible).
export async function measureRefresh(ms = 800) {
  const stamps = []; const t0 = performance.now();
  await new Promise((resolve) => { const tick = (now) => { stamps.push(now); if (now - t0 < ms && !document.hidden) requestAnimationFrame(tick); else resolve(); }; requestAnimationFrame(tick); });
  const d = []; for (let i = 1; i < stamps.length; i++) d.push(stamps[i] - stamps[i - 1]);
  if (d.length < 5) return { hz: 0, raw: 0, frames: d };
  const med = median(d); return { hz: snapHz(1000 / med), raw: 1000 / med, frames: d };
}

// ---------- graphics ----------
export function glProbe() {
  try {
    const c = document.createElement('canvas'); const gl2 = c.getContext('webgl2'); const gl = gl2 || c.getContext('webgl') || c.getContext('experimental-webgl'); if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const info = { gl2: !!gl2, vendor: String(ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR)), renderer: String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)),
      version: String(gl.getParameter(gl.VERSION)), maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE), maxAniso: (() => { const e = gl.getExtension('EXT_texture_filter_anisotropic'); return e ? gl.getParameter(e.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : 0; })() };
    info.software = /swiftshader|llvmpipe|software|basic render|softpipe|mesa offscreen/i.test(info.renderer);
    const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
    return info;
  } catch { return null; }
}

// ---------- machine probing ----------
function parseBrowser(ua, uad) {
  const b = uad && uad.brands ? uad.brands.filter((x) => !/not.?a.?brand/i.test(x.brand)) : [];
  const pickB = (re) => b.find((x) => re.test(x.brand));
  let m;
  if (pickB(/Microsoft Edge/)) return 'Edge ' + pickB(/Microsoft Edge/).version;
  if (pickB(/Opera/)) return 'Opera ' + pickB(/Opera/).version;
  if (pickB(/Google Chrome/)) return 'Chrome ' + pickB(/Google Chrome/).version;
  if ((m = /Firefox\/(\d+)/.exec(ua))) return 'Firefox ' + m[1];
  if ((m = /Edg\/(\d+)/.exec(ua))) return 'Edge ' + m[1];
  if ((m = /OPR\/(\d+)/.exec(ua))) return 'Opera ' + m[1];
  if ((m = /(?:Chrome|CriOS)\/(\d+)/.exec(ua))) return 'Chrome ' + m[1];
  if (pickB(/Chromium/)) return 'Chromium ' + pickB(/Chromium/).version;
  if ((m = /Version\/(\d+).*Safari/.exec(ua))) return 'Safari ' + m[1];
  return 'Unknown browser';
}
function parseOs(ua, uad, hi) {
  const plat = (uad && uad.platform) || '';
  if (plat === 'Windows' || /Windows NT/.test(ua)) { const maj = parseInt(String(hi.platformVersion || '').split('.')[0], 10); return Number.isFinite(maj) ? (maj >= 13 ? 'Windows 11' : 'Windows 10') : 'Windows 10/11'; }
  if (plat === 'macOS' || /Mac OS X/.test(ua) && !/iPhone|iPad/.test(ua)) return 'macOS' + (hi.platformVersion ? ' ' + hi.platformVersion.split('.').slice(0, 2).join('.') : '');
  if (plat === 'Android' || /Android/.test(ua)) { const m = /Android (\d+)/.exec(ua); return 'Android' + (m ? ' ' + m[1] : ''); }
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS / iPadOS';
  if (plat === 'Chrome OS' || /CrOS/.test(ua)) return 'ChromeOS';
  if (plat === 'Linux' || /Linux|X11/.test(ua)) return 'Linux';
  return plat || 'Unknown OS';
}

export async function sysInfo() {
  const n = navigator; const uad = n.userAgentData; const hi = {};
  if (uad && uad.getHighEntropyValues) { try { Object.assign(hi, await uad.getHighEntropyValues(['platformVersion', 'architecture', 'bitness', 'model'])); } catch {} }
  const ua = n.userAgent; const gl = glProbe(); const conn = n.connection || n.mozConnection || n.webkitConnection;
  let battery = null; if (n.getBattery) { try { const b = await n.getBattery(); battery = { level: Math.round(b.level * 100), charging: b.charging }; } catch {} }
  let storage = null; if (n.storage && n.storage.estimate) { try { const e = await n.storage.estimate(); storage = { used: e.usage || 0, quota: e.quota || 0 }; } catch {} }
  const mq = (q) => { try { return matchMedia(q).matches; } catch { return false; } };
  const mem = performance && performance.memory ? { used: performance.memory.usedJSHeapSize, limit: performance.memory.jsHeapSizeLimit } : null;
  const arch = hi.architecture ? hi.architecture + (hi.bitness ? '-' + hi.bitness + 'bit' : '') : '';
  const dpr = window.devicePixelRatio || 1;
  const feats = [
    ['WebGL 2', !!(gl && gl.gl2)], ['WebGPU', !!n.gpu], ['WebAssembly', typeof WebAssembly === 'object'], ['SharedArrayBuffer', typeof SharedArrayBuffer !== 'undefined'], ['OffscreenCanvas', typeof OffscreenCanvas !== 'undefined'],
    ['Web Workers', typeof Worker !== 'undefined'], ['Gamepad API', !!n.getGamepads], ['Pointer Lock', !!document.documentElement.requestPointerLock], ['Fullscreen', !!document.documentElement.requestFullscreen],
    ['WebRTC', !!window.RTCPeerConnection], ['WebSocket', !!window.WebSocket], ['Web Audio', !!(window.AudioContext || window.webkitAudioContext)], ['WebCodecs', typeof window.VideoDecoder !== 'undefined'],
    ['Service Worker', 'serviceWorker' in n], ['IndexedDB', !!window.indexedDB], ['Web Crypto', !!(window.crypto && crypto.subtle)], ['Clipboard API', !!n.clipboard], ['WebHID', !!n.hid], ['Web Bluetooth', !!n.bluetooth], ['Vibration', !!n.vibrate],
  ];
  return {
    browser: parseBrowser(ua, uad), os: parseOs(ua, uad, hi), arch, ua, languages: (n.languages && n.languages.length ? [...n.languages] : [n.language]).filter(Boolean), tz: (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ''; } })(),
    threads: n.hardwareConcurrency || 0, memGB: n.deviceMemory || 0, touch: n.maxTouchPoints || 0, online: n.onLine, cookies: n.cookieEnabled, isolated: !!window.crossOriginIsolated,
    gl, gpuApi: !!n.gpu, screen: { w: screen.width, h: screen.height, pw: Math.round(screen.width * dpr), ph: Math.round(screen.height * dpr), dpr: round(dpr, 2), depth: screen.colorDepth, vw: innerWidth, vh: innerHeight, orient: (screen.orientation && screen.orientation.type) || '' },
    hdr: mq('(dynamic-range: high)'), p3: mq('(color-gamut: p3)'), dark: mq('(prefers-color-scheme: dark)'), reduceMotion: mq('(prefers-reduced-motion: reduce)'),
    conn: conn ? { type: conn.effectiveType || '', down: conn.downlink || 0, rtt: conn.rtt || 0, save: !!conn.saveData } : null, battery, storage, jsHeap: mem, feats,
  };
}

export function reportText(info, extra = {}) {
  const L = [`Nebulix system report — ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`, ''];
  const add = (k, v) => { if (v !== undefined && v !== null && v !== '' && v !== 0) L.push(`${k}: ${v}`); };
  add('OS', info.os + (info.arch ? ` (${info.arch})` : '')); add('Browser', info.browser); add('CPU threads', info.threads); add('Memory (browser-reported)', info.memGB ? (info.memGB >= 8 ? '8+ GB' : info.memGB + ' GB') : '');
  if (info.gl) { add('GPU', info.gl.renderer); add('GPU vendor', info.gl.vendor); add('WebGL', info.gl.gl2 ? '2' : '1'); add('Hardware accelerated', info.gl.software ? 'NO (software rendering)' : 'yes'); }
  add('WebGPU', info.gpuApi ? 'yes' : 'no'); add('Screen', `${info.screen.pw}×${info.screen.ph} px (${info.screen.w}×${info.screen.h} @${info.screen.dpr}x)`); add('Refresh rate', extra.hz ? extra.hz + ' Hz' : '');
  add('HDR', info.hdr ? 'yes' : 'no'); add('Wide gamut (P3)', info.p3 ? 'yes' : 'no'); add('Language', info.languages.join(', ')); add('Time zone', info.tz);
  if (info.conn) add('Connection', `${info.conn.type || '?'} · ${info.conn.down} Mbps · ${info.conn.rtt} ms RTT`);
  L.push('', 'Features: ' + info.feats.map(([k, v]) => (v ? '' : '') + k).join(', '));
  return L.join('\n');
}

export const hwTip = (info) => (info.gl && info.gl.software
  ? t('Your browser is rendering graphics in software. Turn on "Use hardware acceleration" in your browser settings and update your GPU driver — games will run far better.')
  : '');
