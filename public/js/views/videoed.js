// Nebulix Video Editor (3.0 phase 18) — a simple timeline editor that runs in the browser: video clips with trimming,
// per-clip effects and fades between clips, a text / subtitle track (also from .srt files) and a music track. The
// preview is drawn on a canvas; export records that canvas plus the mixed audio in real time into a WebM video
// (it takes as long as the video lasts). Media files stay on this device; only the exported video can go to Drive.
import { h, mount } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { toast, toastErr } from '../ui.js';

const nid = () => Math.random().toString(36).slice(2, 9);
const fmt = (s) => { s = Math.max(0, s); const m = Math.floor(s / 60); return m + ':' + (s - m * 60).toFixed(1).padStart(4, '0'); };
const FX = [['brightness', 'Brightness', 0, 200, 100], ['contrast', 'Contrast', 0, 200, 100], ['saturate', 'Saturation', 0, 200, 100], ['grayscale', 'Black & white', 0, 100, 0]];
export function parseSrt(text) {
  const out = []; const toS = (x) => { const m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(x); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000 : 0; };
  for (const block of String(text).replace(/\r/g, '').split(/\n\s*\n/)) { const lines = block.trim().split('\n'); const i = lines.findIndex((l) => l.includes('-->')); if (i < 0) continue; const [a, b] = lines[i].split('-->'); const txt = lines.slice(i + 1).join('\n').replace(/<[^>]+>/g, '').trim(); if (txt) out.push({ start: toS(a), end: toS(b), text: txt }); }
  return out;
}

export default {
  full: true,
  title: () => t('Video editor'),
  async mount(root) {
    const W = 1280, H = 720; const canvas = h('canvas.ve-canvas', { width: W, height: H, 'aria-label': t('Preview') }); const g = canvas.getContext('2d');
    const media = []; // { id, name, kind: video|audio|image, url, dur, el }
    const clips = []; // video track: { id, media, in, out, fx, fade }
    const texts = []; // { id, start, end, text, size, color, pos }
    let music = null; // { media, start, volume }
    let time = 0, playing = false, raf = 0, selected = null, exporting = false; let lastTick = 0; let actx = null;
    const total = () => Math.max(clips.reduce((a, c) => a + (c.out - c.in), 0), ...texts.map((x) => x.end), 0); // music is cut at the end of the video
    const clipAt = (tt) => { let acc = 0; for (const c of clips) { const d = c.out - c.in; if (tt < acc + d) return { c, local: tt - acc, start: acc }; acc += d; } return null; };

    // ---------- media ----------
    function load(file) {
      const kind = file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : file.type.startsWith('image/') ? 'image' : null;
      if (!kind) return toast(t('Add video, audio or image files'), 'err');
      const url = URL.createObjectURL(file); const m = { id: nid(), name: file.name, kind, url, dur: kind === 'image' ? 5 : 0, el: null };
      if (kind === 'image') { const im = new Image(); im.onload = () => { m.el = im; paint(); }; im.src = url; media.push(m); paint(); return m; }
      const el = document.createElement(kind); el.src = url; el.preload = 'auto'; el.muted = kind === 'video'; el.playsInline = true; el.crossOrigin = 'anonymous';
      el.addEventListener('loadedmetadata', () => { m.dur = Number.isFinite(el.duration) ? el.duration : 0; if (!m.dur && kind === 'video') { el.currentTime = 1e9; el.addEventListener('durationchange', () => { if (Number.isFinite(el.duration)) { m.dur = el.duration; el.currentTime = 0; paint(); } }, { once: true }); } paint(); });
      m.el = el; media.push(m); paint(); return m;
    }
    const pick = (accept) => { const i = h('input', { type: 'file', multiple: true, accept, onChange: () => [...i.files].forEach(load) }); i.click(); };
    function addClip(m) { if (!m.dur) return toast(t('Still reading this file — try again in a moment'), 'err'); clips.push({ id: nid(), media: m, in: 0, out: m.dur, fx: {}, fade: 0 }); selected = clips[clips.length - 1].id; paint(); seek(time); }
    function addText(tx = t('Your text'), start = time, end = time + 3) { texts.push({ id: nid(), start, end, text: tx, size: 56, color: '#ffffff', pos: 'bottom' }); selected = texts[texts.length - 1].id; paint(); drawFrame(); }
    function importSrt() { const i = h('input', { type: 'file', accept: '.srt,text/plain', onChange: async () => { const subs = parseSrt(await i.files[0].text()); for (const s of subs) texts.push({ id: nid(), ...s, size: 44, color: '#ffffff', pos: 'bottom' }); toast(t('{n} subtitles added', { n: subs.length }), 'good'); paint(); drawFrame(); } }); i.click(); }

    // ---------- rendering ----------
    const fxCss = (f = {}) => `brightness(${f.brightness ?? 100}%) contrast(${f.contrast ?? 100}%) saturate(${f.saturate ?? 100}%) grayscale(${f.grayscale ?? 0}%)`;
    function drawMedia(m, alpha, f) {
      const el = m.el; if (!el) return; const w = m.kind === 'video' ? el.videoWidth : el.naturalWidth, hh = m.kind === 'video' ? el.videoHeight : el.naturalHeight; if (!w || !hh) return;
      const s = Math.min(W / w, H / hh); const dw = w * s, dh = hh * s; g.save(); g.globalAlpha = alpha; g.filter = fxCss(f); g.drawImage(el, (W - dw) / 2, (H - dh) / 2, dw, dh); g.restore();
    }
    function drawFrame() {
      g.fillStyle = '#000'; g.fillRect(0, 0, W, H); const at = clipAt(time);
      if (at) { const d = at.c.out - at.c.in; let a = 1; const fd = at.c.fade || 0; if (fd) { if (at.local < fd) a = at.local / fd; else if (at.local > d - fd) a = (d - at.local) / fd; } drawMedia(at.c.media, Math.max(0, Math.min(1, a)), at.c.fx); }
      for (const x of texts) if (time >= x.start && time < x.end) {
        g.save(); g.font = `800 ${x.size}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round'; g.lineWidth = x.size / 7; g.strokeStyle = 'rgba(0,0,0,.85)'; g.fillStyle = x.color;
        const lines = x.text.split('\n'); const lh = x.size * 1.2; let y = x.pos === 'top' ? 70 + lh / 2 : x.pos === 'center' ? H / 2 - ((lines.length - 1) * lh) / 2 : H - 60 - (lines.length - 1) * lh;
        for (const l of lines) { g.strokeText(l, W / 2, y); g.fillText(l, W / 2, y); y += lh; } g.restore();
      }
      playhead();
    }
    // keep the active media element at the right position
    function sync(force) {
      const at = clipAt(time);
      for (const m of media) if (m.kind === 'video' && m.el && (!at || at.c.media !== m) && !m.el.paused) m.el.pause();
      if (at && at.c.media.kind === 'video') { const el = at.c.media.el; const want = at.c.in + at.local; if (force || Math.abs(el.currentTime - want) > 0.25) el.currentTime = want; if (playing && el.paused) el.play().catch(() => {}); if (!playing && !el.paused) el.pause(); }
      if (music && music.media.el) { const want = time - music.start; const el = music.media.el; el.volume = music.volume ?? 0.8; if (want >= 0 && want < (music.media.dur || 0) && playing) { if (force || Math.abs(el.currentTime - want) > 0.3) el.currentTime = want; if (el.paused) el.play().catch(() => {}); } else if (!el.paused) el.pause(); }
    }
    function seek(tt) { time = Math.max(0, Math.min(total(), tt)); sync(true); const at = clipAt(time); if (at && at.c.media.kind === 'video') at.c.media.el.addEventListener('seeked', drawFrame, { once: true }); drawFrame(); }
    function tick(now) { if (!playing) return; const dt = lastTick ? (now - lastTick) / 1000 : 0; lastTick = now; time += dt; if (time >= total()) { time = total(); stop(); drawFrame(); return; } sync(false); drawFrame(); raf = requestAnimationFrame(tick); }
    function play() { if (!total()) return; if (time >= total()) time = 0; playing = true; lastTick = 0; sync(true); raf = requestAnimationFrame(tick); paintTransport(); }
    function stop() { playing = false; cancelAnimationFrame(raf); for (const m of media) if (m.el && m.el.pause) m.el.pause(); paintTransport(); }

    // ---------- export (real time) ----------
    async function exportVideo(toDrive) {
      if (!clips.length && !texts.length) return toast(t('Add a clip first'), 'err'); if (exporting) return;
      const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((x) => window.MediaRecorder && MediaRecorder.isTypeSupported(x)); if (!mime) return toast(t('This browser cannot record video'), 'err');
      exporting = true; stop(); time = 0; paintTransport();
      // a media element can be routed into Web Audio only once, so one AudioContext lives for the whole editor; each
      // element keeps playing to the speakers and is also connected to the recorder only while exporting
      const ac = actx || (actx = new AudioContext()); await ac.resume(); const dest = ac.createMediaStreamDestination(); const nodes = [];
      for (const m of media) if (m.el && (m.kind === 'video' || m.kind === 'audio')) { if (!m.node) { m.node = ac.createMediaElementSource(m.el); m.node.connect(ac.destination); } m.el.muted = false; m.node.connect(dest); nodes.push(m); }
      const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 5_000_000 }); const parts = []; rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
      const done = new Promise((r) => { rec.onstop = r; }); rec.start(500); play();
      await new Promise((r) => { const chk = setInterval(() => { prog.style.width = (time / total() * 100) + '%'; if (!playing) { clearInterval(chk); r(); } }, 200); });
      rec.stop(); await done; for (const m of nodes) { try { m.node.disconnect(dest); } catch {} if (m.kind === 'video') m.el.muted = true; }
      exporting = false; prog.style.width = '0'; paintTransport();
      const blob = new Blob(parts, { type: 'video/webm' }); const nameV = (title.value.trim() || 'video').replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 80) + '.webm';
      if (toDrive) { try { await api.put('/api/drive/upload?name=' + encodeURIComponent(nameV), blob, { type: 'video/webm' }); toast(t('Saved to Drive'), 'good'); } catch (e) { toastErr(e); } }
      else { const a = h('a', { href: URL.createObjectURL(blob), download: nameV }); a.click(); }
      window.__nbxVideoLast = blob; return blob;
    }

    // ---------- UI ----------
    const title = h('input.input.ve-title', { value: t('My video'), 'aria-label': t('Title') });
    const bin = h('div.ve-bin'); const track = h('div.ve-tracks'); const props = h('div.ve-props'); const transport = h('div.ve-transport'); const prog = h('i');
    function playhead() { const el = track.querySelector('.ve-ph'); const tot = total(); if (el && tot) el.style.left = (time / tot * 100) + '%'; const tm = transport.querySelector('.ve-time'); if (tm) tm.textContent = fmt(time) + ' / ' + fmt(tot); }
    function paintTransport() { mount(transport, h('button.btn.sm.primary', { disabled: exporting, onClick: () => (playing ? stop() : play()) }, icon(playing ? 'stop' : 'play', 14), playing ? t('Pause') : t('Play')), h('button.btn.sm', { disabled: exporting, onClick: () => seek(0) }, '⏮'), h('span.ve-time'), h('span.grow'),
      h('div.ve-prog', prog), h('button.btn.sm', { disabled: exporting, onClick: () => exportVideo(false) }, icon('download', 14), exporting ? t('Exporting…') : t('Export WebM')), h('button.btn.sm', { disabled: exporting, onClick: () => exportVideo(true) }, icon('upload', 14), t('Save to Drive'))); playhead(); }
    function paint() {
      mount(bin, h('div.eyebrow', t('Media')), h('div.row', { style: 'gap:6px;flex-wrap:wrap' }, h('button.btn.sm', { onClick: () => pick('video/*,image/*') }, icon('video', 14), t('Add video or image')), h('button.btn.sm', { onClick: () => pick('audio/*') }, icon('music', 14), t('Add music'))),
        media.length ? media.map((m) => h('div.ve-media', h('span', m.kind === 'video' ? '🎬' : m.kind === 'audio' ? '🎵' : '🖼️'), h('span.grow', m.name), h('span.tiny.muted', m.dur ? fmt(m.dur) : '…'),
          m.kind === 'audio' ? h('button.btn.sm', { onClick: () => { music = { media: m, start: 0, volume: 0.8 }; paint(); } }, t('Use as music')) : h('button.btn.sm', { onClick: () => addClip(m) }, icon('plus', 12), t('Timeline')))) : h('p.tiny.muted', t('Add videos, images and music. They stay on this device.')));
      const tot = total() || 1;
      mount(track, h('div.ve-ruler', Array.from({ length: Math.min(30, Math.ceil(tot)) + 1 }, (_, i) => h('span', { style: 'left:' + (i * Math.ceil(tot / 30 || 1) / tot * 100) + '%' }, fmt(i * Math.ceil(tot / 30 || 1))))),
        h('div.ve-track', h('b.ve-tl', t('Video')), (() => { let acc = 0; return clips.map((c) => { const d = c.out - c.in; const el = h('button.ve-clip' + (selected === c.id ? '.on' : ''), { style: `left:${acc / tot * 100}%;width:${d / tot * 100}%`, onClick: () => { selected = c.id; paint(); } }, c.media.name); acc += d; return el; }); })()),
        h('div.ve-track', h('b.ve-tl', t('Text')), texts.map((x) => h('button.ve-clip.txt' + (selected === x.id ? '.on' : ''), { style: `left:${x.start / tot * 100}%;width:${Math.max(0.5, (x.end - x.start) / tot * 100)}%`, onClick: () => { selected = x.id; seek(x.start); paint(); } }, x.text.split('\n')[0]))),
        h('div.ve-track', h('b.ve-tl', t('Music')), music ? h('div.ve-clip.mus', { style: `left:${music.start / tot * 100}%;width:${Math.min(100, (music.media.dur || 0) / tot * 100)}%` }, music.media.name) : null),
        h('i.ve-ph'));
      track.onclick = (e) => { if (e.target.closest('.ve-clip')) return; const r = track.getBoundingClientRect(); seek(((e.clientX - r.left - 70) / (r.width - 70)) * total()); };
      paintProps(); playhead();
    }
    function paintProps() {
      const c = clips.find((x) => x.id === selected); const x = texts.find((y) => y.id === selected);
      const num = (label, val, min, max, step, on) => h('label.ve-num', h('span', label), h('input.input', { type: 'number', min, max, step, value: Math.round(val * 100) / 100, onChange: (e) => { on(Number(e.target.value)); paint(); seek(time); } }));
      if (c) mount(props, h('div.eyebrow', t('Clip')), h('b', c.media.name),
        num(t('Start in file (s)'), c.in, 0, c.media.dur, 0.1, (v) => { c.in = Math.max(0, Math.min(v, c.out - 0.2)); }), num(t('End in file (s)'), c.out, 0, c.media.dur, 0.1, (v) => { c.out = Math.min(c.media.dur, Math.max(v, c.in + 0.2)); }),
        num(t('Fade (s)'), c.fade || 0, 0, 5, 0.1, (v) => { c.fade = Math.max(0, Math.min(v, (c.out - c.in) / 2)); }),
        h('button.btn.sm', { onClick: () => { const at = clipAt(time); if (!at || at.c !== c) return toast(t('Move the playhead inside this clip'), 'err'); const cut = c.in + at.local; const c2 = { ...c, id: nid(), in: cut, fx: { ...c.fx } }; c.out = cut; clips.splice(clips.indexOf(c) + 1, 0, c2); paint(); } }, t('Split at playhead')),
        h('div.eyebrow', t('Effects')), FX.map(([k, label, min, max, def]) => h('label.ve-num', h('span', t(label)), h('input', { type: 'range', min, max, value: c.fx[k] ?? def, onInput: (e) => { c.fx[k] = Number(e.target.value); drawFrame(); } }))),
        h('div.row', { style: 'gap:6px' }, h('button.btn.sm', { disabled: clips.indexOf(c) === 0, onClick: () => { const i = clips.indexOf(c); [clips[i - 1], clips[i]] = [clips[i], clips[i - 1]]; paint(); } }, '←'), h('button.btn.sm', { disabled: clips.indexOf(c) === clips.length - 1, onClick: () => { const i = clips.indexOf(c); [clips[i + 1], clips[i]] = [clips[i], clips[i + 1]]; paint(); } }, '→'), h('button.btn.sm.danger', { onClick: () => { clips.splice(clips.indexOf(c), 1); selected = null; paint(); seek(time); } }, icon('trash', 13), t('Remove'))));
      else if (x) mount(props, h('div.eyebrow', t('Text')), h('textarea.input', { rows: 3, onInput: (e) => { x.text = e.target.value; drawFrame(); }, onChange: paint }, x.text),
        num(t('From (s)'), x.start, 0, 36000, 0.1, (v) => { x.start = Math.max(0, Math.min(v, x.end - 0.1)); }), num(t('To (s)'), x.end, 0, 36000, 0.1, (v) => { x.end = Math.max(v, x.start + 0.1); }), num(t('Size'), x.size, 12, 200, 1, (v) => { x.size = v; }),
        h('label.ve-num', h('span', t('Colour')), h('input', { type: 'color', value: x.color, onInput: (e) => { x.color = e.target.value; drawFrame(); } })),
        h('label.ve-num', h('span', t('Position')), h('select.input', { onChange: (e) => { x.pos = e.target.value; drawFrame(); } }, [['top', t('Top')], ['center', t('Center')], ['bottom', t('Bottom')]].map(([v, l]) => h('option', { value: v, selected: x.pos === v }, l)))),
        h('button.btn.sm.danger', { onClick: () => { texts.splice(texts.indexOf(x), 1); selected = null; paint(); drawFrame(); } }, icon('trash', 13), t('Remove')));
      else mount(props, h('div.eyebrow', t('Tools')), h('button.btn.sm', { onClick: () => addText() }, icon('edit', 13), t('Add text at playhead')), h('button.btn.sm', { onClick: importSrt }, t('Import subtitles (.srt)')),
        music ? h('label.ve-num', h('span', t('Music volume')), h('input', { type: 'range', min: 0, max: 100, value: Math.round((music.volume ?? 0.8) * 100), onInput: (e) => { music.volume = Number(e.target.value) / 100; } })) : null,
        music ? num(t('Music starts at (s)'), music.start, 0, 36000, 0.1, (v) => { music.start = Math.max(0, v); }) : null,
        h('p.tiny.muted', t('Select a clip or a text on the timeline to edit it. Export plays the video once while recording it.')));
    }
    mount(root, h('div.ve', h('div.ve-bar', title, h('span.tiny.muted', t('Media stays on this device until you export.'))), h('div.ve-main', h('aside.ve-left', bin), h('div.ve-center', h('div.ve-preview', canvas), transport), h('aside.ve-right', props)), track));
    paint(); paintTransport(); drawFrame();
    window.__nbxVideo = { load, addClip: (i) => addClip(media[i]), addText, get clips() { return clips; }, get texts() { return texts; }, get media() { return media; }, exportVideo, seek, total, setMusic: (i) => { music = { media: media[i], start: 0, volume: 0.8 }; paint(); }, parseSrt };
    return () => { stop(); for (const m of media) URL.revokeObjectURL(m.url); if (actx) actx.close(); delete window.__nbxVideo; };
  },
};
