// Nebulix Audio (3.0 phase 17) — an audio editor in the browser: open a file or record from the microphone, see the
// waveform, select a region and cut, trim, copy/paste, silence, fade, change the volume, normalise, reverse or mix in
// another file; undo; play; export WAV (16-bit) or save it to Drive. All processing happens on this device. #/audio
import { h, mount } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { toast, toastErr, promptBox } from '../ui.js';

const fmt = (s) => { s = Math.max(0, s); const m = Math.floor(s / 60); return m + ':' + (s - m * 60).toFixed(2).padStart(5, '0'); };

export function encodeWav(chs, rate) { // 16-bit PCM WAV
  const n = chs[0].length, c = chs.length, bytes = n * c * 2; const b = new ArrayBuffer(44 + bytes); const v = new DataView(b);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + bytes, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, c, true); v.setUint32(24, rate, true); v.setUint32(28, rate * c * 2, true); v.setUint16(32, c * 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, bytes, true);
  let o = 44; for (let i = 0; i < n; i++) for (let k = 0; k < c; k++) { const x = Math.max(-1, Math.min(1, chs[k][i])); v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true); o += 2; }
  return new Blob([b], { type: 'audio/wav' });
}

export default {
  full: true,
  title: () => 'Nebulix Audio',
  async mount(root) {
    const AC = window.AudioContext || window.webkitAudioContext; const ac = new AC();
    let chs = null; let rate = 44100; let name = 'audio'; let selA = 0, selB = 0, cursor = 0; let zoom = 1; let src = null; let playT0 = 0, playFrom = 0, playTo = 0, raf = 0; let clip = null;
    const undo = []; const redo = [];
    const len = () => (chs ? chs[0].length : 0);
    const save = () => { undo.push(chs.map((c) => c.slice())); if (undo.length > 15) undo.shift(); redo.length = 0; };
    const canvas = h('canvas.au-wave', { tabIndex: 0, 'aria-label': t('Waveform — drag to select, click to place the cursor') }); const g = canvas.getContext('2d');
    const scroller = h('div.au-scroll', canvas); const info = h('div.au-info'); const bar = h('div.au-bar');

    function setAudio(buf, n) {
      rate = buf.sampleRate; chs = []; for (let k = 0; k < Math.min(2, buf.numberOfChannels); k++) chs.push(buf.getChannelData(k).slice());
      if (n) name = n.replace(/\.[^.]+$/, ''); selA = selB = cursor = 0; undo.length = redo.length = 0; paint(); draw();
    }
    async function openFile(f) { if (f.size > 200 * 1048576) return toast(t('Files up to 200 MB'), 'err'); try { const buf = await ac.decodeAudioData(await f.arrayBuffer()); setAudio(buf, f.name); } catch { toast(t('That file could not be read as audio'), 'err'); } }
    const pick = (fn) => { const i = h('input', { type: 'file', accept: 'audio/*,video/*', onChange: () => i.files[0] && fn(i.files[0]) }); i.click(); };
    let rec = null;
    async function record() {
      if (rec) { rec.stop(); return; }
      let stream; try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) { return toast(t('The microphone is not available: {e}', { e: e.message }), 'err'); }
      const parts = []; rec = new MediaRecorder(stream); rec.ondataavailable = (e) => parts.push(e.data);
      rec.onstop = async () => { stream.getTracks().forEach((x) => x.stop()); rec = null; paint(); try { const buf = await ac.decodeAudioData(await new Blob(parts).arrayBuffer()); setAudio(buf, t('Recording') + ' ' + new Date().toLocaleTimeString()); } catch { toast(t('The recording could not be decoded'), 'err'); } };
      rec.start(); paint();
    }

    // ---------- drawing ----------
    function draw() {
      const W = Math.round(scroller.clientWidth * zoom) || 800, H = 220; if (canvas.width !== W) { canvas.width = W; canvas.height = H; canvas.style.width = W + 'px'; }
      g.fillStyle = getComputedStyle(document.body).getPropertyValue('--bg') || '#0b1220'; g.fillRect(0, 0, W, H);
      if (!chs) { g.fillStyle = '#64748b'; g.font = '15px system-ui'; g.textAlign = 'center'; g.fillText(t('Open an audio file or record from the microphone'), W / 2, H / 2); return; }
      const n = len(); const per = n / W; const mid = H / 2;
      if (selB > selA) { g.fillStyle = 'rgba(99,102,241,.28)'; g.fillRect((selA / n) * W, 0, ((selB - selA) / n) * W, H); }
      g.fillStyle = '#22c55e';
      for (let x = 0; x < W; x++) { let mn = 1, mx = -1; const s0 = Math.floor(x * per), s1 = Math.min(n, Math.floor((x + 1) * per) + 1); const step = Math.max(1, Math.floor((s1 - s0) / 400)); for (const c of chs) for (let i = s0; i < s1; i += step) { const v = c[i]; if (v < mn) mn = v; if (v > mx) mx = v; } if (mx < mn) continue; g.fillRect(x, mid - mx * mid * 0.95, 1, Math.max(1, (mx - mn) * mid * 0.95)); }
      g.fillStyle = 'rgba(148,163,184,.35)'; g.fillRect(0, mid, W, 1);
      const cx = (cursor / n) * W; g.fillStyle = '#f59e0b'; g.fillRect(cx, 0, 2, H);
      if (src) { const pos = playFrom + (ac.currentTime - playT0) * rate; g.fillStyle = '#ef4444'; g.fillRect((Math.min(pos, playTo) / n) * W, 0, 2, H); }
    }
    let down = null;
    const sampleAt = (e) => { const r = canvas.getBoundingClientRect(); return Math.max(0, Math.min(len(), Math.round(((e.clientX - r.left) / r.width) * len()))); };
    canvas.addEventListener('pointerdown', (e) => { if (!chs) return; canvas.setPointerCapture(e.pointerId); down = sampleAt(e); selA = selB = cursor = down; draw(); paintInfo(); });
    canvas.addEventListener('pointermove', (e) => { if (down === null) return; const s = sampleAt(e); selA = Math.min(down, s); selB = Math.max(down, s); draw(); paintInfo(); });
    canvas.addEventListener('pointerup', () => { down = null; });
    canvas.addEventListener('keydown', (e) => { const mod = e.ctrlKey || e.metaKey; const k = e.key.toLowerCase();
      if (k === ' ') { e.preventDefault(); src ? stop() : play(); } else if (k === 'delete' || k === 'backspace') { e.preventDefault(); op('delete'); }
      else if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); } else if (mod && k === 'y') { e.preventDefault(); doRedo(); }
      else if (mod && k === 'c') { e.preventDefault(); op('copy'); } else if (mod && k === 'x') { e.preventDefault(); op('cut'); } else if (mod && k === 'v') { e.preventDefault(); op('paste'); } else if (mod && k === 'a') { e.preventDefault(); selA = 0; selB = len(); draw(); paintInfo(); } });

    // ---------- editing ----------
    const range = () => (selB > selA ? [selA, selB] : [0, len()]);
    const splice = (a, b, insert) => { chs = chs.map((c, k) => { const ins = insert ? insert[Math.min(k, insert.length - 1)] : new Float32Array(0); const out = new Float32Array(c.length - (b - a) + ins.length); out.set(c.subarray(0, a)); out.set(ins, a); out.set(c.subarray(b), a + ins.length); return out; }); };
    async function op(kind) {
      if (!chs) return; stop(); const [a, b] = range();
      if (kind === 'copy') { if (selB <= selA) return toast(t('Select a region first'), 'err'); clip = chs.map((c) => c.slice(a, b)); toast(t('Copied {s}', { s: fmt((b - a) / rate) })); return; }
      if (kind === 'paste') { if (!clip) return toast(t('Copy or cut a region first'), 'err'); save(); splice(cursor, cursor, clip); selA = cursor; selB = cursor + clip[0].length; }
      else if (kind === 'cut' || kind === 'delete') { if (selB <= selA) return toast(t('Select a region first'), 'err'); save(); if (kind === 'cut') clip = chs.map((c) => c.slice(a, b)); splice(a, b); selA = selB = cursor = a; }
      else if (kind === 'trim') { if (selB <= selA) return toast(t('Select a region first'), 'err'); save(); chs = chs.map((c) => c.slice(a, b)); selA = 0; selB = len(); cursor = 0; }
      else if (kind === 'silence') { save(); for (const c of chs) c.fill(0, a, b); }
      else if (kind === 'fadein' || kind === 'fadeout') { save(); const n = b - a; for (const c of chs) for (let i = 0; i < n; i++) { const f = kind === 'fadein' ? i / n : 1 - i / n; c[a + i] *= f * f; } }
      else if (kind === 'gain') { const v = await promptBox(t('Change volume (dB)'), { value: '3', hint: t('Positive is louder, negative is quieter') }); const db = Number(v); if (v === null || !Number.isFinite(db) || Math.abs(db) > 40) return; save(); const m = Math.pow(10, db / 20); for (const c of chs) for (let i = a; i < b; i++) c[i] *= m; }
      else if (kind === 'normalize') { let peak = 0; for (const c of chs) for (let i = a; i < b; i++) peak = Math.max(peak, Math.abs(c[i])); if (!peak) return; save(); const m = 0.891 / peak; for (const c of chs) for (let i = a; i < b; i++) c[i] *= m; } // −1 dBFS
      else if (kind === 'reverse') { save(); for (const c of chs) c.subarray(a, b).reverse(); }
      else if (kind === 'mix') { pick(async (f) => { try { const buf = await ac.decodeAudioData(await f.arrayBuffer()); const other = await resample(buf, rate); save(); const end = cursor + other[0].length; if (end > len()) chs = chs.map((c) => { const o = new Float32Array(end); o.set(c); return o; }); chs.forEach((c, k) => { const s = other[Math.min(k, other.length - 1)]; for (let i = 0; i < s.length; i++) c[cursor + i] = Math.max(-1, Math.min(1, c[cursor + i] + s[i])); }); paint(); draw(); toast(t('Mixed in at the cursor'), 'good'); } catch { toast(t('That file could not be read as audio'), 'err'); } }); return; }
      paint(); draw();
    }
    async function resample(buf, to) { if (buf.sampleRate === to) return [...Array(Math.min(2, buf.numberOfChannels))].map((_, k) => buf.getChannelData(k).slice()); const off = new OfflineAudioContext(Math.min(2, buf.numberOfChannels), Math.ceil(buf.duration * to), to); const s = off.createBufferSource(); s.buffer = buf; s.connect(off.destination); s.start(); const r = await off.startRendering(); return [...Array(r.numberOfChannels)].map((_, k) => r.getChannelData(k).slice()); }
    function doUndo() { if (!undo.length) return; redo.push(chs); chs = undo.pop(); selA = selB = 0; cursor = Math.min(cursor, len()); paint(); draw(); }
    function doRedo() { if (!redo.length) return; undo.push(chs); chs = redo.pop(); paint(); draw(); }

    // ---------- playback / export ----------
    function play() {
      if (!chs || src) return; ac.resume(); const [a, b] = selB > selA ? [selA, selB] : [cursor, len()]; if (b - a < 2) return;
      const buf = ac.createBuffer(chs.length, b - a, rate); chs.forEach((c, k) => buf.copyToChannel(c.subarray(a, b), k));
      src = ac.createBufferSource(); src.buffer = buf; src.connect(ac.destination); src.onended = () => { src = null; cancelAnimationFrame(raf); paint(); draw(); };
      playFrom = a; playTo = b; playT0 = ac.currentTime; src.start(); const tick = () => { draw(); if (src) raf = requestAnimationFrame(tick); }; tick(); paint();
    }
    function stop() { if (src) { try { src.stop(); } catch {} src = null; } cancelAnimationFrame(raf); }
    const wavName = () => (name || 'audio').replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 80) + '.wav';
    const exportBlob = () => { const [a, b] = selB > selA ? [selA, selB] : [0, len()]; return encodeWav(chs.map((c) => c.subarray(a, b)), rate); };
    async function download() { const b = exportBlob(); const el = h('a', { href: URL.createObjectURL(b), download: wavName() }); el.click(); setTimeout(() => URL.revokeObjectURL(el.href), 4000); }
    async function toDrive() { try { await api.put('/api/drive/upload?name=' + encodeURIComponent(wavName()), exportBlob(), { type: 'audio/wav' }); toast(t('Saved to Drive'), 'good'); } catch (e) { toastErr(e); } }

    // ---------- UI ----------
    function paintInfo() { mount(info, chs ? [h('span', t('Length') + ' ' + fmt(len() / rate)), h('span', rate + ' Hz · ' + (chs.length === 2 ? t('stereo') : t('mono'))), h('span', t('Cursor') + ' ' + fmt(cursor / rate)), selB > selA ? h('b', t('Selection') + ' ' + fmt(selA / rate) + ' – ' + fmt(selB / rate) + ' (' + fmt((selB - selA) / rate) + ')') : h('span.muted', t('No selection: tools apply to the whole clip'))] : null); }
    function paint() {
      const B = (ic, label, fn, dis) => h('button.btn.sm', { type: 'button', onClick: fn, disabled: !!dis }, ic ? icon(ic, 14) : null, label);
      const none = !chs;
      mount(bar, h('div.au-group', B('upload', t('Open'), () => pick(openFile)), h('button.btn.sm' + (rec ? '.danger' : ''), { onClick: record }, icon('mic', 14), rec ? t('Stop recording') : t('Record'))),
        h('div.au-group', h('button.btn.sm.primary', { disabled: none, onClick: () => (src ? stop() : play()) }, icon(src ? 'stop' : 'play', 14), src ? t('Stop') : t('Play')), B(null, '↶', doUndo, !undo.length), B(null, '↷', doRedo, !redo.length)),
        h('div.au-group', B(null, t('Cut'), () => op('cut'), none), B(null, t('Copy'), () => op('copy'), none), B(null, t('Paste'), () => op('paste'), none || !clip), B(null, t('Delete'), () => op('delete'), none), B(null, t('Trim to selection'), () => op('trim'), none)),
        h('div.au-group', B(null, t('Fade in'), () => op('fadein'), none), B(null, t('Fade out'), () => op('fadeout'), none), B(null, t('Volume…'), () => op('gain'), none), B(null, t('Normalise'), () => op('normalize'), none), B(null, t('Silence'), () => op('silence'), none), B(null, t('Reverse'), () => op('reverse'), none), B(null, t('Mix in a file…'), () => op('mix'), none)),
        h('div.au-group', h('label.tiny', t('Zoom'), ' ', h('input', { type: 'range', min: 1, max: 32, value: zoom, 'aria-label': t('Zoom'), onInput: (e) => { zoom = Number(e.target.value); draw(); } }))),
        h('div.au-group', B('download', 'WAV', download, none), B('upload', t('Save to Drive'), toDrive, none)));
      paintInfo();
    }
    const ro = new ResizeObserver(() => draw()); ro.observe(scroller);
    mount(root, h('div.au', h('div.page-title', h('div', h('h2', icon('music', 22), ' Nebulix Audio'), h('p', t('Edit audio on this device: cut, trim, fade, volume, normalise, mix and export WAV.')))), bar, scroller, info,
      h('p.tiny.muted', t('Keys: Space play/stop · Delete removes the selection · Ctrl+X/C/V cut, copy, paste at the cursor · Ctrl+A select all · Ctrl+Z undo'))));
    paint(); draw();
    window.__nbxAudio = { load: (buf) => setAudio(buf, 'test'), get chs() { return chs; }, get rate() { return rate; }, op, select: (a, b) => { selA = a; selB = b; cursor = a; draw(); paintInfo(); }, setCursor: (c) => { cursor = c; selA = selB = c; }, exportBlob, ac };
    return () => { stop(); ro.disconnect(); if (rec) try { rec.stop(); } catch {} ac.close(); delete window.__nbxAudio; };
  },
};
