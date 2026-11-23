// Voice notes: a recorder (MediaRecorder + live level meter) and a compact player with a waveform.
// The recorder hands back a Blob; the caller decides whether it is uploaded as-is (community) or encrypted first (DMs).
import { h } from './util.js';
import { t } from './i18n.js';
import { icon } from './icons.js';
import { toast } from './ui.js';

export const MAX_SECONDS = 120;
export const canRecord = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
function pickMime() {
  for (const m of ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4']) if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) return m;
  return '';
}
const fmtT = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Replaces `host`'s content with a recording bar. Resolves to { blob, dur, mime } or null when cancelled. */
export function record(host) {
  return new Promise(async (resolve) => {
    if (!canRecord()) { toast(t('Voice messages need a browser with microphone access over https or localhost.'), 'err'); return resolve(null); }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch { toast(t('Microphone access was blocked. Allow it in the address bar to record.'), 'err'); return resolve(null); }
    const mime = pickMime(); const rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 48000 } : undefined);
    const chunks = []; let cancelled = false; const t0 = Date.now();
    const ac = new (window.AudioContext || window.webkitAudioContext)(); const an = ac.createAnalyser(); an.fftSize = 256; ac.createMediaStreamSource(stream).connect(an);
    const cv = h('canvas', { width: 240, height: 28 }); const g = cv.getContext('2d'); const levels = [];
    const time = h('span.rtime', '0:00');
    const prevKids = [...host.childNodes];
    const bar = h('div.rec-bar', h('span.rdot'), time, cv,
      h('button.btn.ghost.icon.sm', { type: 'button', title: t('Discard'), 'aria-label': t('Discard'), onClick: () => { cancelled = true; rec.stop(); } }, icon('trash', 15)),
      h('button.btn.primary.icon.sm', { type: 'button', title: t('Send voice message'), 'aria-label': t('Send voice message'), onClick: () => rec.stop() }, icon('send', 15)));
    host.replaceChildren(bar);
    const buf = new Uint8Array(an.frequencyBinCount); let raf;
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#d4ff3f';
    (function draw() {
      an.getByteTimeDomainData(buf); let peak = 0; for (const v of buf) peak = Math.max(peak, Math.abs(v - 128)); levels.push(peak / 128); if (levels.length > 60) levels.shift();
      g.clearRect(0, 0, cv.width, cv.height); g.fillStyle = accent; const w = cv.width / 60;
      levels.forEach((l, i) => { const hh = Math.max(2, l * cv.height * 1.6); g.fillRect(i * w + 1, (cv.height - hh) / 2, w - 2, Math.min(cv.height, hh)); });
      const s = (Date.now() - t0) / 1000; time.textContent = fmtT(s); if (s >= MAX_SECONDS && rec.state === 'recording') rec.stop();
      raf = requestAnimationFrame(draw);
    })();
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      cancelAnimationFrame(raf); stream.getTracks().forEach((tr) => tr.stop()); ac.close().catch(() => {});
      host.replaceChildren(...prevKids);
      const dur = Math.round((Date.now() - t0) / 1000);
      if (cancelled || dur < 1 || !chunks.length) return resolve(null);
      resolve({ blob: new Blob(chunks, { type: (rec.mimeType || mime || 'audio/webm').split(';')[0] }), dur, mime: rec.mimeType || mime });
    };
    rec.start(250);
  });
}

let playing = null; // only one voice note plays at a time

// Deterministic pseudo-waveform from the URL so every note looks distinct without decoding audio up front.
function bars(seed, n = 34) { let x = 0; for (const c of String(seed)) x = (x * 31 + c.charCodeAt(0)) >>> 0; const out = []; for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; out.push(0.25 + ((x >>> 16) % 1000) / 1333); } return out; }

/** A voice note player. `getSrc` returns (or resolves to) a playable URL — lets DMs decrypt lazily on first play. */
// Chat views redraw their message list often; players are cached by `seed` (the message's file URL) so a note
// keeps playing — and keeps its progress — across redraws.
const cache = new Map();
export function player(getSrc, dur, seed) {
  if (seed && cache.has(seed)) { const el = cache.get(seed); cache.delete(seed); cache.set(seed, el); return el; }
  const el = makePlayer(getSrc, dur, seed);
  if (seed) { cache.set(seed, el); if (cache.size > 150) { const [k, old] = cache.entries().next().value; if (!old.isConnected) cache.delete(k); } }
  return el;
}
function makePlayer(getSrc, dur, seed) {
  const audio = new Audio(); audio.preload = 'none'; let ready = false; let loading = false;
  const shape = bars(seed || Math.random());
  const wave = h('div.vwave', shape.map((v) => h('i', { style: `height:${Math.round(v * 100)}%` })));
  const time = h('span.vtime', fmtT(dur || 0));
  const btn = h('button.vplay', { type: 'button', 'aria-label': t('Play voice message') }, icon('play', 14));
  async function ensure() {
    if (ready || loading) return ready; loading = true;
    try { audio.src = await getSrc(); ready = true; } catch { toast(t('This voice message cannot be played on this device.'), 'err'); }
    loading = false; return ready;
  }
  btn.addEventListener('click', async () => {
    if (!(await ensure())) return;
    if (audio.paused) { if (playing && playing !== audio) playing.pause(); playing = audio; audio.play().catch(() => {}); } else audio.pause();
  });
  wave.addEventListener('click', async (e) => { if (!(await ensure())) return; const r = wave.getBoundingClientRect(); const k = (e.clientX - r.left) / r.width; const total = isFinite(audio.duration) ? audio.duration : dur; if (total) { audio.currentTime = k * total; if (audio.paused) audio.play().catch(() => {}); } });
  const paint = () => {
    const total = isFinite(audio.duration) && audio.duration ? audio.duration : dur || 1; const k = audio.currentTime / total;
    [...wave.children].forEach((b, i) => b.classList.toggle('on', i / wave.children.length < k));
    time.textContent = fmtT(audio.paused && !audio.currentTime ? dur || 0 : audio.currentTime);
  };
  audio.addEventListener('timeupdate', paint);
  audio.addEventListener('play', () => btn.replaceChildren(icon('pause', 14)));
  audio.addEventListener('pause', () => btn.replaceChildren(icon('play', 14)));
  audio.addEventListener('ended', () => { audio.currentTime = 0; paint(); });
  return h('div.voice', btn, wave, time);
}
