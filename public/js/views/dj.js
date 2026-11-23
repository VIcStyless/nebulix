// DJ mode: two decks with colour waveforms, beat grid, SYNC, jog wheels (scratch or nudge), hot cues, loops, FX,
// 3-band EQ + filter, crossfader, sampler pads, Auto-DJ, mix recording and MIDI learn.
import { h, mount, clamp, ls, debounce, fmt } from '../util.js';
import { t } from '../i18n.js';
import { api, ws } from '../api.js';
import { icon } from '../icons.js';
import { toast, toastErr, modal, segEl, switchEl, loading, openMenu } from '../ui.js';
import * as P from '../pulse/engine.js';
import * as lib from '../pulse/library.js';
import { createRig, FX, PADS, pad as playPad } from '../pulse/dj-engine.js';

const css = (k, d) => getComputedStyle(document.documentElement).getPropertyValue(k).trim() || d;
const time = (s) => { s = Math.max(0, s || 0); return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0'); };
const HOT = ['#ef4444', '#f59e0b', '#22c55e', '#38bdf8'];
const TAU = Math.PI * 2;

// ---------- controls ----------
function knob({ label, min, max, value, def = value, step = (max - min) / 100, format = (v) => v.toFixed(1), onChange, midi, controls, bip = false, size = 44 }) {
  let v = value; const R = size / 2 - 4; const A0 = -0.75 * Math.PI, A1 = 0.75 * Math.PI;
  const arcPath = (a0, a1) => { const p = (a) => [size / 2 + Math.cos(a - Math.PI / 2) * R, size / 2 + Math.sin(a - Math.PI / 2) * R]; const [x0, y0] = p(a0), [x1, y1] = p(a1); return `M${x0} ${y0} A${R} ${R} 0 ${Math.abs(a1 - a0) > Math.PI ? 1 : 0} ${a1 > a0 ? 1 : 0} ${x1} ${y1}`; };
  const track = h('path', { d: arcPath(A0, A1), class: 'kn-track' }); const val = h('path', { class: 'kn-val' }); const ptr = h('line', { class: 'kn-ptr', x1: size / 2, y1: size / 2 });
  const svg = h('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size }, track, val, h('circle', { cx: size / 2, cy: size / 2, r: R - 6, class: 'kn-cap' }), ptr);
  const out = h('span.kn-out'); const el = h('div.knob', { tabindex: 0, role: 'slider', 'aria-label': label, dataset: midi ? { midi } : {}, title: label }, svg, h('span.kn-lbl', label), out);
  const draw = () => {
    const k = (v - min) / (max - min); const a = A0 + k * (A1 - A0); const mid = bip ? A0 + ((def - min) / (max - min)) * (A1 - A0) : A0;
    val.setAttribute('d', Math.abs(a - mid) < 0.01 ? '' : arcPath(Math.min(mid, a), Math.max(mid, a)));
    ptr.setAttribute('x2', size / 2 + Math.cos(a - Math.PI / 2) * (R - 7)); ptr.setAttribute('y2', size / 2 + Math.sin(a - Math.PI / 2) * (R - 7));
    out.textContent = format(v); el.setAttribute('aria-valuenow', String(v));
  };
  const set = (x, silent) => { v = clamp(Math.round(x / step) * step, min, max); draw(); if (!silent) onChange(v); };
  let drag = null;
  el.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; drag = { y: e.clientY, v }; el.setPointerCapture(e.pointerId); el.classList.add('drag'); });
  el.addEventListener('pointermove', (e) => { if (!drag) return; const dy = drag.y - e.clientY; set(drag.v + dy * (max - min) / (e.shiftKey ? 900 : 180)); });
  el.addEventListener('pointerup', () => { drag = null; el.classList.remove('drag'); });
  el.addEventListener('dblclick', () => set(def));
  el.addEventListener('wheel', (e) => { e.preventDefault(); set(v - Math.sign(e.deltaY) * step * (e.shiftKey ? 1 : 5)); }, { passive: false });
  el.addEventListener('keydown', (e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); set(v + step * 5); } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); set(v - step * 5); } else if (e.key === 'Home') set(def); });
  if (midi && controls) controls.set(midi, { label, set: (x01) => set(min + x01 * (max - min)) });
  el.set = set; draw(); return el;
}
function vfader({ label, value, onChange, midi, controls, cls = '' }) {
  const i = h('input.vfader' + cls, { type: 'range', min: 0, max: 1, step: 0.005, value, 'aria-label': label, dataset: midi ? { midi } : {}, onInput: () => onChange(Number(i.value)) });
  i.addEventListener('dblclick', () => { i.value = 0.85; onChange(0.85); });
  if (midi && controls) controls.set(midi, { label, set: (x) => { i.value = x; onChange(x); } });
  return i;
}

export default {
  title: () => t('DJ mode'),
  full: true,
  async mount(root, ctx) {
    mount(root, h('div.dj-wrap', loading(t('Warming up the decks…'))));
    if (P.snapshot().playing) { P.pause(); toast(t('Pulse paused while DJ mode is on')); }
    let rig;
    try { rig = await createRig(); } catch (e) { mount(root, h('div.empty', h('div.empty-art.ea-mark'), h('h3', t('DJ mode needs a modern browser')), h('p.muted', String(e.message || e)))); return; }
    const { mixer, A, B } = rig; const decks = { A, B }; const actx = rig.ctx;
    const controls = new Map(); const offs = []; let raf = 0; let alive = true;
    const opts = Object.assign({ quant: true, vinyl: false, zoom: 1 }, ls('dj.opts') || {}); const saveOpts = () => ls('dj.opts', opts);
    let tracks = (await lib.allTracks()).filter((x) => x.kind === 'file' || x.kind === 'gen');

    // ---------- deck UI ----------
    function deckUi(d) {
      const side = d.id; const ui = {};
      ui.cover = h('div.dj-cover'); ui.title = h('div.dj-title.ellipsis', t('Load a track')); ui.artist = h('div.dj-artist.ellipsis.muted', t('Drag from the list below or press LOAD'));
      ui.bpm = h('div.dj-bpm', '—'); ui.pitch = h('div.dj-pct', '0.00%'); ui.time = h('div.dj-time.mono', '0:00'); ui.rem = h('div.dj-rem.mono', '-0:00');
      ui.ov = h('canvas.dj-ov', { onPointerdown: (e) => { if (!d.track) return; const r = ui.ov.getBoundingClientRect(); d.seek((e.clientX - r.left) / r.width * d.dur); } });
      ui.jog = h('canvas.dj-jog', { width: 200, height: 200, dataset: { midi: side + '.jog' } });
      const pf = h('input.vfader.pitch', { type: 'range', min: -1, max: 1, step: 0.001, value: 0, 'aria-label': t('Tempo'), dataset: { midi: side + '.pitch' }, onInput: () => d.setPitchV(-Number(pf.value)) });
      pf.addEventListener('dblclick', () => { pf.value = 0; d.setPitchV(0); }); ui.pf = pf;
      controls.set(side + '.pitch', { label: `${side} ${t('Tempo')}`, set: (x) => { pf.value = x * 2 - 1; d.setPitchV(-(x * 2 - 1)); } });
      const rangeBtn = h('button.btn.sm.dj-range', { title: t('Tempo range'), onClick: () => { const r = { 0.08: 0.16, 0.16: 0.5, 0.5: 0.08 }[d.range] || 0.08; d.setRange(r); rangeBtn.textContent = '±' + Math.round(r * 100) + '%'; } }, '±8%'); ui.rangeBtn = rangeBtn;
      const nudge = (v) => h('button.btn.sm.dj-nudge', { onPointerdown: () => d.bend(v), onPointerup: () => d.bend(0), onPointerleave: () => d.bend(0) }, v < 0 ? '−' : '+');
      const btn = (cls, label, fn, midi, extra = {}) => { const b = h('button.dj-btn.' + cls, Object.assign({ dataset: midi ? { midi } : {}, onClick: fn }, extra), label); if (midi) controls.set(midi, { label: `${side} ${typeof label === 'string' ? label : cls}`, press: (on) => { if (on) fn(); } }); return b; };
      ui.play = btn('play', icon('play', 22), () => d.toggle(opts.vinyl), side + '.play');
      ui.cue = h('button.dj-btn.cue', { dataset: { midi: side + '.cue' }, onPointerdown: () => d.cueDown(opts.quant), onPointerup: () => d.cueUp(), onPointerleave: () => d.cueUp() }, 'CUE');
      controls.set(side + '.cue', { label: `${side} CUE`, press: (on) => (on ? d.cueDown(opts.quant) : d.cueUp()) });
      ui.sync = btn('sync', 'SYNC', () => { const o = d === A ? B : A; if (!o.track) return toast(t('Load a track on the other deck first')); d.syncTo(o); pf.value = -d.pitchV; rangeBtn.textContent = '±' + Math.round(d.range * 100) + '%'; ui.sync.classList.add('flash'); setTimeout(() => ui.sync.classList.remove('flash'), 400); }, side + '.sync');
      ui.hot = [0, 1, 2, 3].map((i) => { const b = h('button.dj-hot', { style: `--c:${HOT[i]}`, dataset: { midi: `${side}.hot${i + 1}` }, title: t('Hot cue {n} (Shift+click to delete)', { n: i + 1 }), onClick: (e) => { if (e.shiftKey) d.clearHot(i); else d.hotcue(i, opts.quant); } }, String(i + 1)); controls.set(`${side}.hot${i + 1}`, { label: `${side} hot cue ${i + 1}`, press: (on) => on && d.hotcue(i, opts.quant) }); return b; });
      ui.loops = [0.5, 1, 2, 4, 8, 16].map((n) => h('button.dj-loop', { dataset: { n: String(n), midi: `${side}.loop${n}` }, onClick: () => d.loopBeats(n) }, n === 0.5 ? '½' : String(n)));
      ui.loops.forEach((b) => controls.set(b.dataset.midi, { label: `${side} loop ${b.dataset.n}`, press: (on) => on && d.loopBeats(Number(b.dataset.n)) }));
      const fxSel = h('select.select.dj-fxsel', { onChange: () => { d.fx.set(fxSel.value); if (fxSel.value !== 'none' && !d.fx.on) { d.fx.setOn(true); fxOn.classList.add('on'); } } }, FX.map(([id, n]) => h('option', { value: id }, t(n))));
      const fxOn = h('button.dj-btn.fxon', { dataset: { midi: side + '.fx' }, onClick: () => { d.fx.setOn(!d.fx.on); fxOn.classList.toggle('on', d.fx.on); } }, 'FX');
      controls.set(side + '.fx', { label: `${side} FX`, press: (on) => on && fxOn.click() });
      const fxWet = knob({ label: t('Wet'), min: 0, max: 1, value: 0.5, step: 0.01, format: (v) => Math.round(v * 100) + '%', onChange: (v) => d.fx.setWet(v), midi: side + '.fxwet', controls, size: 38 });
      const fxBeats = segEl([[0.25, '¼'], [0.5, '½'], [1, '1'], [2, '2']], 0.5, (v) => d.fx.setBeats(Number(v)));
      const loadBtn = h('button.btn.sm', { onClick: (e) => loadMenu(d, e.currentTarget) }, icon('download', 14), t('Load'));
      const el = h('section.dj-deck', { dataset: { d: side } },
        h('div.dj-dhead', ui.cover, h('div.grow', ui.title, ui.artist), h('div.dj-bpmbox', ui.bpm, ui.pitch), h('div.dj-tbox', ui.time, ui.rem)),
        ui.ov,
        h('div.dj-dbody', h('div.dj-jogwrap', ui.jog), h('div.dj-pitchcol', h('span.tiny.muted', t('Tempo')), pf, rangeBtn, h('div.row.gap-s', nudge(-0.04), nudge(0.04)))),
        h('div.dj-transport', ui.cue, ui.play, ui.sync, h('button.dj-btn.small', { title: t('Brake (vinyl stop)'), onClick: () => d.brake(0.9) }, '⏹'), h('button.dj-btn.small', { title: t('Spinback'), onClick: () => d.spinback() }, '↺'), loadBtn),
        h('div.dj-hots', ui.hot),
        h('div.dj-loops', h('span.tiny.muted', t('Loop')), ui.loops, h('button.dj-loop', { title: t('Halve loop'), onClick: () => d.loopScale(0.5) }, '÷2'), h('button.dj-loop', { title: t('Double loop'), onClick: () => d.loopScale(2) }, '×2')),
        h('div.dj-fx', fxSel, fxBeats, fxWet, fxOn));
      el.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/nbx-track')) { e.preventDefault(); el.classList.add('dropping'); } });
      el.addEventListener('dragleave', () => el.classList.remove('dropping'));
      el.addEventListener('drop', (e) => { el.classList.remove('dropping'); const id = e.dataTransfer.getData('text/nbx-track'); const tr = tracks.find((x) => x.id === id); if (tr) { e.preventDefault(); loadInto(d, tr); } });
      jogControl(d, ui.jog);
      ui.el = el; d.ui = ui; return el;
    }
    function jogControl(d, cv) {
      let prev = null; let stillT = 0;
      const ang = (e) => { const r = cv.getBoundingClientRect(); return Math.atan2(e.clientY - r.top - r.height / 2, e.clientX - r.left - r.width / 2); };
      cv.addEventListener('pointerdown', (e) => { if (!d.track) return; cv.setPointerCapture(e.pointerId); prev = { a: ang(e), t: performance.now() }; d.touching = true; if (opts.vinyl) d.scratch(true, 0); });
      cv.addEventListener('pointermove', (e) => {
        if (!prev) return; const a = ang(e); const now = performance.now(); let da = a - prev.a; if (da > Math.PI) da -= TAU; if (da < -Math.PI) da += TAU; const dt = Math.max(0.004, (now - prev.t) / 1000); prev = { a, t: now };
        const revs = da / TAU;
        if (opts.vinyl) { d.scratch(true, clamp(revs / dt / 0.5556, -6, 6)); clearTimeout(stillT); stillT = setTimeout(() => prev && d.scratch(true, 0), 60); }
        else if (d.playing) { d.bend(clamp(revs / dt * 0.35, -0.5, 0.5)); clearTimeout(stillT); stillT = setTimeout(() => d.bend(0), 90); }
        else d.seek(d.now() + revs * 1.8);
      });
      const up = () => { if (!prev) return; prev = null; d.touching = false; clearTimeout(stillT); if (opts.vinyl) d.scratch(false); else d.bend(0); };
      cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    }

    // ---------- mixer UI ----------
    const xf = h('input.xfader', { type: 'range', min: -1, max: 1, step: 0.005, value: 0, 'aria-label': t('Crossfader'), dataset: { midi: 'xfader' }, onInput: () => mixer.setCrossfader(Number(xf.value)) });
    xf.addEventListener('dblclick', () => { xf.value = 0; mixer.setCrossfader(0); });
    controls.set('xfader', { label: t('Crossfader'), set: (x) => { xf.value = x * 2 - 1; mixer.setCrossfader(x * 2 - 1); } });
    const vu = (id) => h('canvas.dj-vu', { width: 12, height: 150, dataset: { vu: id } });
    const strip = (d) => {
      const s = d.id; const eqK = (band, label) => knob({ label, min: -26, max: 6, value: 0, def: 0, step: 0.5, bip: true, format: (v) => (v <= -25.5 ? 'KILL' : (v > 0 ? '+' : '') + v.toFixed(1)), onChange: (v) => d.setEq(band, v), midi: `${s}.eq.${band}`, controls });
      d.knobs = { hi: eqK('hi', 'HI'), mi: eqK('mi', 'MID'), lo: eqK('lo', 'LOW') };
      return h('div.dj-strip', { dataset: { d: s } },
        knob({ label: t('Gain'), min: -12, max: 12, value: 0, def: 0, step: 0.5, bip: true, format: (v) => (v > 0 ? '+' : '') + v.toFixed(1), onChange: (v) => d.setTrim(v), midi: s + '.trim', controls, size: 38 }),
        d.knobs.hi, d.knobs.mi, d.knobs.lo,
        knob({ label: t('Filter'), min: -1, max: 1, value: 0, def: 0, step: 0.01, bip: true, format: (v) => (Math.abs(v) < 0.02 ? 'OFF' : v < 0 ? 'LP' : 'HP'), onChange: (v) => d.setFilter(v), midi: s + '.filter', controls }),
        h('div.dj-chan', vu(s), d.faderEl = vfader({ label: `${s} ${t('Volume')}`, value: 0.85, onChange: (v) => d.setFader(v), midi: s + '.vol', controls })));
    };
    const curveSeg = segEl([['smooth', t('Smooth')], ['cut', t('Cut')]], mixer.curve, (v) => { mixer.curve = v; mixer.setCrossfader(Number(xf.value)); });
    const masterK = knob({ label: t('Master'), min: 0, max: 1.2, value: 0.9, def: 0.9, step: 0.01, format: (v) => Math.round(v * 100) + '%', onChange: (v) => mixer.setMaster(v), midi: 'master', controls, size: 40 });
    const mixerEl = h('section.dj-mixer', h('div.dj-strips', strip(A), h('div.dj-mvu', vu('M'), masterK), strip(B)), h('div.dj-xf', h('b.tiny', 'A'), xf, h('b.tiny', 'B')), h('div.row', { style: 'justify-content:center' }, curveSeg));

    // ---------- top bar ----------
    const recBtn = h('button.btn.sm.dj-rec', { onClick: () => (rec ? stopRec() : startRec()) }, '● REC'); const recTime = h('span.mono.tiny');
    const autoSw = switchEl(false, (v) => { auto.on = v; if (v) autoStart(); toast(v ? t('Auto-DJ on: it mixes your queue or library automatically') : t('Auto-DJ off')); }, 'Auto-DJ');
    const masterBpm = h('b.mono.dj-mbpm', '—');
    const top = h('div.dj-top',
      h('div.row', h('span.dj-logo', icon('sliders', 18)), h('b', t('DJ mode')), h('span.pill', 'Pulse'), masterBpm),
      h('div.grow'),
      h('div.row.gap-s.small', switchEl(opts.quant, (v) => { opts.quant = v; saveOpts(); }), t('Quantize')),
      h('div.row.gap-s.small', switchEl(opts.vinyl, (v) => { opts.vinyl = v; saveOpts(); toast(v ? t('Vinyl mode: drag the jog wheel to scratch') : t('CDJ mode: the jog wheel nudges the tempo')); }), t('Vinyl')),
      h('div.row.gap-s.small', autoSw, 'Auto-DJ'),
      h('button.btn.sm', { title: t('Zoom waveforms'), onClick: () => { opts.zoom = { 1: 2, 2: 0.5, 0.5: 1 }[opts.zoom] || 1; saveOpts(); toast(t('Zoom: {z}×', { z: opts.zoom })); } }, '🔍'),
      h('button.btn.sm', { onClick: midiMenu }, 'MIDI'),
      h('div.row.gap-s', recBtn, recTime),
      h('button.btn.sm.icon', { title: t('Keyboard shortcuts'), onClick: help }, '?'),
      h('a.btn.sm', { href: '#/music', title: t('Back to Pulse') }, icon('back', 14), 'Pulse'));
    const zA = h('canvas.dj-zoom', { dataset: { d: 'A' } }), zB = h('canvas.dj-zoom', { dataset: { d: 'B' } });
    [zA, zB].forEach((cv) => cv.addEventListener('wheel', (e) => { e.preventDefault(); const d = decks[cv.dataset.d]; if (!d.track || d.playing) return; d.seek(d.now() + Math.sign(e.deltaY) * d.beatLen()); }, { passive: false }));

    // ---------- browser & sampler ----------
    const search = h('input.input.dj-search', { placeholder: t('Search your library…'), onInput: debounce(() => paintBrowser(), 150) });
    const rows = h('div.dj-rows');
    const paintBrowser = () => {
      const q = search.value.trim().toLowerCase(); const list = tracks.filter((x) => !q || [x.title, x.artist, x.album].some((v) => (v || '').toLowerCase().includes(q)));
      mount(rows, list.length ? list.slice(0, 300).map((tr) => h('div.dj-row', { draggable: 'true', onDragstart: (e) => { e.dataTransfer.setData('text/nbx-track', tr.id); e.dataTransfer.effectAllowed = 'copy'; }, onDblclick: () => loadInto(!A.track ? A : !B.track ? B : (A.playing ? B : A), tr) },
        tr.cover ? h('img', { src: tr.cover, alt: '', width: 30, height: 30 }) : h('span.dj-noart', tr.kind === 'gen' ? '✦' : '♪'), h('div.grow', h('div.ellipsis.small', { style: 'font-weight:600' }, tr.title), h('div.ellipsis.tiny.muted', tr.artist || '')),
        h('span.mono.tiny', tr.bpm ? Math.round(tr.bpm) : '—'), h('span.mono.tiny.muted', time(tr.duration)),
        h('button.dj-ld', { onClick: () => loadInto(A, tr) }, 'A'), h('button.dj-ld', { onClick: () => loadInto(B, tr) }, 'B'))) : h('div.dj-empty', h('p.muted.small', t('Your library is empty. Add songs in Pulse, or let Nebula Synth make two mixable tracks:')), h('button.btn.primary.sm', { onClick: (e) => quickSynth(e.currentTarget) }, '', t('Make 2 tracks for me'))));
    };
    const pads = h('div.dj-pads', PADS.map(([id, label], i) => { const k = 'asdfghjk'[i]; const b = h('button.dj-pad', { dataset: { midi: 'pad.' + id }, onPointerdown: () => { playPad(actx, mixer.bus, id, A.playing ? A.bpm() : B.playing ? B.bpm() : 124); b.classList.add('hit'); setTimeout(() => b.classList.remove('hit'), 160); } }, h('span', t(label)), h('kbd', k.toUpperCase())); controls.set('pad.' + id, { label: t(label), press: (on) => on && b.dispatchEvent(new PointerEvent('pointerdown')) }); return b; }));
    const browser = h('section.dj-browser', h('div.dj-bhead', h('b', t('Tracks')), search, h('button.btn.sm', { onClick: (e) => quickSynth(e.currentTarget) }, '', t('Synth 2 tracks')), h('a.btn.sm.ghost', { href: '#/music?s=library' }, icon('plus', 14), t('Add music'))), rows);
    const sampler = h('section.dj-sampler', h('div.dj-bhead', h('b', t('Sampler'))), pads);

    const wrap = h('div.dj-wrap', top, h('div.dj-zooms', h('div.dj-zrow', h('span.dj-tag.a', 'A'), zA), h('div.dj-zrow', h('span.dj-tag.b', 'B'), zB)), h('div.dj-main', deckUi(A), mixerEl, deckUi(B)), h('div.dj-bottom', browser, sampler));
    mount(root, wrap);
    if (actx.state === 'suspended') { const ov = h('button.dj-start', { onClick: () => { actx.resume(); ov.remove(); } }, icon('sliders', 30), h('b', t('Tap to start DJ mode')), h('span.small.muted', t('Browsers need one click before they can play sound.'))); wrap.appendChild(ov); }
    paintBrowser();

    // ---------- loading ----------
    async function loadInto(d, tr) {
      if (d.playing && !(await new Promise((res) => { modal({ title: t('Deck {d} is playing', { d: d.id }), body: h('p', t('Load "{t}" anyway? The current track stops.', { t: tr.title })), actions: [{ label: t('Cancel'), value: false }, { label: t('Load'), kind: 'primary', value: true }] }).then(res); }))) return;
      d.ui.title.textContent = tr.title; d.ui.artist.textContent = t('Loading & analysing…'); d.ui.el.classList.add('loading');
      try {
        await d.load(tr, (p) => { d.ui.artist.textContent = t('Composing… {p}%', { p: Math.round(p * 100) }); }); paintDeck(d); stripCache.delete(d.id); api.post('/api/progress/event', { type: 'deck' }, { quiet: true }).catch(() => {});
        if (d.an && d.an.confidence < 0.15 && tr.kind === 'file') toast(t('Tempo detection is unsure for this track — check the beat grid.'));
      } catch (e) { toastErr(e); d.ui.title.textContent = t('Load a track'); d.ui.artist.textContent = ''; } finally { d.ui.el.classList.remove('loading'); }
    }
    function loadMenu(d, anchor) {
      const recent = tracks.slice(0, 8);
      openMenu([...recent.map((tr) => ({ label: tr.title + (tr.artist ? ' — ' + tr.artist : ''), icon: 'play', onClick: () => loadInto(d, tr) })), recent.length ? { hr: true } : null, { label: t('Nebula Synth track'), icon: 'spark', onClick: () => synthInto(d) }, { label: t('Browse all tracks below'), icon: 'search', onClick: () => search.focus() }], anchor);
    }
    async function synthInto(d, style = 'house', bpm) {
      const G = await import('../pulse/gen.js'); const rc = G.recipeFor(style, G.newSeed(), { bpm: bpm || (d === B && A.an ? Math.round(A.bpm()) : 124), length: 'normal' });
      const tr = G.trackFor(rc); await lib.addTrack(tr); tracks.unshift(tr); paintBrowser(); return loadInto(d, tr);
    }
    async function quickSynth(btn) {
      btn.disabled = true;
      try { const bpm = 120 + Math.floor(Math.random() * 7); await synthInto(A, 'house', bpm); await synthInto(B, 'techno', bpm); toast(t('Two tracks at {b} BPM are on the decks. Press PLAY on A, then bring in B with SYNC + crossfader!', { b: bpm }), 'good', 7000); }
      finally { btn.disabled = false; }
    }
    function paintDeck(d) {
      const tr = d.track; const ui = d.ui;
      mount(ui.cover, tr && tr.cover ? h('img', { src: tr.cover, alt: '' }) : h('span', tr ? (tr.kind === 'gen' ? '✦' : '♪') : d.id));
      ui.title.textContent = tr ? tr.title : t('Load a track'); ui.artist.textContent = tr ? (tr.artist || '') : '';
      jogImg[d.id] = null; if (tr && tr.cover) { const im = new Image(); im.onload = () => { jogImg[d.id] = im; }; im.src = tr.cover; }
      drawOverview(d);
    }

    // ---------- drawing ----------
    const colors = () => ({ lo: css('--accent', '#8b5cf6'), mi: css('--accent2', '#38bdf8'), hi: '#ffffff' });
    let C = colors(); const jogImg = {}; const stripCache = new Map(); const ovCache = new Map();
    const fit = (cv) => { const r = cv.getBoundingClientRect(); const dpr = Math.min(2, devicePixelRatio || 1); const w = Math.max(10, Math.round(r.width * dpr)), hh = Math.max(10, Math.round(r.height * dpr)); if (cv.width !== w || cv.height !== hh) { cv.width = w; cv.height = hh; return true; } return false; };
    function strips(d) { // pre-rendered waveform chunks (1 px per analysis frame)
      let s = stripCache.get(d.id); if (s && s.an === d.an) return s; const an = d.an; const n = an.low.length; const CH = 4096, H = 96; const chunks = [];
      for (let c0 = 0; c0 < n; c0 += CH) {
        const w = Math.min(CH, n - c0); const cv = document.createElement('canvas'); cv.width = w; cv.height = H; const g = cv.getContext('2d'); const mid = H / 2;
        const band = (arr, col, k, alpha) => { g.fillStyle = col; g.globalAlpha = alpha; for (let x = 0; x < w; x++) { const v = arr[c0 + x] * mid * k; if (v > 0.5) g.fillRect(x, mid - v, 1, v * 2); } };
        band(an.low, C.lo, 0.98, 0.9); band(an.mid, C.mi, 0.7, 0.85); band(an.high, C.hi, 0.42, 0.8); chunks.push({ cv, c0, w });
      }
      s = { an, chunks, H }; stripCache.set(d.id, s); return s;
    }
    function drawZoom(cv, d) {
      fit(cv); const g = cv.getContext('2d'); const W = cv.width, H = cv.height; g.clearRect(0, 0, W, H);
      if (!d.an) { g.fillStyle = 'rgba(255,255,255,.35)'; g.font = `${Math.round(H * 0.28)}px system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t('Deck {d} — load a track', { d: d.id }), W / 2, H / 2); return; }
      const an = d.an; const fr = an.fr; const pos = d.now(); const span = 8 / opts.zoom; const pxPerSec = W / span; const x0 = W / 2 - pos * pxPerSec;
      const s = strips(d);
      for (const ch of s.chunks) { const left = x0 + (ch.c0 / fr) * pxPerSec; const width = (ch.w / fr) * pxPerSec; if (left > W || left + width < 0) continue; g.drawImage(ch.cv, left, 0, width, H); }
      // loop & beat grid & cues
      if (d.loop) { g.fillStyle = 'rgba(34,197,94,.18)'; g.fillRect(x0 + d.loop.a * pxPerSec, 0, (d.loop.b - d.loop.a) * pxPerSec, H); }
      const bl = d.beatLen(); const off = an.offset || 0; const kStart = Math.floor((pos - span / 2 - off) / bl), kEnd = Math.ceil((pos + span / 2 - off) / bl);
      for (let k = kStart; k <= kEnd; k++) { const x = x0 + (off + k * bl) * pxPerSec; const down = ((k % 4) + 4) % 4 === 0; g.fillStyle = down ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.18)'; g.fillRect(Math.round(x), 0, down ? 2 : 1, down ? H : H * 0.22); }
      d.hot.forEach((c, i) => { if (c === null) return; const x = x0 + c * pxPerSec; g.fillStyle = HOT[i]; g.fillRect(x - 1, 0, 2, H); g.beginPath(); g.moveTo(x - 7, 0); g.lineTo(x + 7, 0); g.lineTo(x, 10); g.fill(); });
      { const x = x0 + d.cue * pxPerSec; g.fillStyle = '#f59e0b'; g.beginPath(); g.moveTo(x - 6, H); g.lineTo(x + 6, H); g.lineTo(x, H - 9); g.fill(); }
      g.fillStyle = '#fff'; g.fillRect(W / 2 - 1, 0, 2, H); g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(0, 0, W / 2, H);
    }
    function drawOverview(d) {
      const cv = d.ui.ov; fit(cv); const W = cv.width, H = cv.height; const off = document.createElement('canvas'); off.width = W; off.height = H; const g = off.getContext('2d');
      if (d.an) {
        const an = d.an; const n = an.low.length; const mid = H / 2;
        for (let x = 0; x < W; x++) { const a = Math.floor(x / W * n), b = Math.max(a + 1, Math.floor((x + 1) / W * n)); let lo = 0, mi = 0, hi = 0; for (let i = a; i < b; i++) { if (an.low[i] > lo) lo = an.low[i]; if (an.mid[i] > mi) mi = an.mid[i]; if (an.high[i] > hi) hi = an.high[i]; } g.fillStyle = C.lo; g.globalAlpha = 0.85; g.fillRect(x, mid - lo * mid, 1, lo * mid * 2); g.fillStyle = C.mi; g.fillRect(x, mid - mi * mid * 0.7, 1, mi * mid * 1.4); g.fillStyle = C.hi; g.globalAlpha = 0.7; g.fillRect(x, mid - hi * mid * 0.4, 1, hi * mid * 0.8); }
      }
      ovCache.set(d.id, off);
    }
    function drawOvHead(d) {
      const cv = d.ui.ov; if (fit(cv)) drawOverview(d); const g = cv.getContext('2d'); const W = cv.width, H = cv.height; g.clearRect(0, 0, W, H);
      const off = ovCache.get(d.id); if (off) g.drawImage(off, 0, 0); if (!d.dur) return;
      const x = d.now() / d.dur * W; g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(0, 0, x, H);
      d.hot.forEach((c, i) => { if (c !== null) { g.fillStyle = HOT[i]; g.fillRect(c / d.dur * W - 1, 0, 2, H); } });
      if (d.loop) { g.fillStyle = 'rgba(34,197,94,.35)'; g.fillRect(d.loop.a / d.dur * W, 0, Math.max(2, (d.loop.b - d.loop.a) / d.dur * W), H); }
      g.fillStyle = '#fff'; g.fillRect(x - 1, 0, 2, H);
    }
    function drawJog(d) {
      const cv = d.ui.jog; fit(cv); const g = cv.getContext('2d'); const W = cv.width, R = W / 2 - 4, cx = W / 2; g.clearRect(0, 0, W, W);
      const a = d.now() * 0.5556 * TAU;
      g.fillStyle = '#0c0c12'; g.beginPath(); g.arc(cx, cx, R, 0, TAU); g.fill();
      g.strokeStyle = d.touching ? C.mi : 'rgba(255,255,255,.12)'; g.lineWidth = d.touching ? 4 : 2; g.beginPath(); g.arc(cx, cx, R - 2, 0, TAU); g.stroke();
      for (let k = 0; k < 18; k++) { g.strokeStyle = `rgba(255,255,255,${k % 3 ? 0.03 : 0.06})`; g.lineWidth = 1; g.beginPath(); g.arc(cx, cx, R * (0.45 + k * 0.03), 0, TAU); g.stroke(); }
      g.save(); g.translate(cx, cx); g.rotate(a); const r2 = R * 0.38; g.beginPath(); g.arc(0, 0, r2, 0, TAU); g.clip();
      const im = jogImg[d.id]; if (im) g.drawImage(im, -r2, -r2, r2 * 2, r2 * 2); else { const gr = g.createLinearGradient(-r2, -r2, r2, r2); gr.addColorStop(0, C.lo); gr.addColorStop(1, C.mi); g.fillStyle = gr; g.fillRect(-r2, -r2, r2 * 2, r2 * 2); }
      g.restore(); g.save(); g.translate(cx, cx); g.rotate(a); g.fillStyle = '#fff'; g.beginPath(); g.arc(0, -R + 12, 5, 0, TAU); g.fill(); g.restore();
      if (d.an && d.playing) { const ph = d.beatPhase(); g.strokeStyle = C.lo; g.lineWidth = 3; g.beginPath(); g.arc(cx, cx, R - 8, -Math.PI / 2, -Math.PI / 2 + ph * TAU); g.stroke(); }
    }
    const peaks = { A: 0, B: 0, M: 0 };
    function drawVu(id, lvl) {
      const cv = root.querySelector(`[data-vu="${id}"]`); if (!cv) return; const g = cv.getContext('2d'); const W = cv.width, H = cv.height; peaks[id] = Math.max(lvl, peaks[id] - 0.01);
      g.clearRect(0, 0, W, H); const segs = 24; for (let i = 0; i < segs; i++) { const k = i / segs; const on = lvl > k * 1.05; g.fillStyle = !on ? 'rgba(255,255,255,.07)' : k > 0.85 ? '#ef4444' : k > 0.65 ? '#f59e0b' : '#22c55e'; g.fillRect(1, H - (i + 1) * (H / segs) + 1, W - 2, H / segs - 2); }
      const py = H - peaks[id] * H / 1.05; g.fillStyle = '#fff'; g.fillRect(1, Math.max(0, py), W - 2, 2);
    }
    function frame() {
      if (!alive) return; raf = requestAnimationFrame(frame); if (document.hidden) return;
      for (const d of [A, B]) {
        const ui = d.ui; drawJog(d); drawOvHead(d);
        const now = d.now(); ui.time.textContent = time(now); ui.rem.textContent = '-' + time(d.dur - now); ui.rem.classList.toggle('warn', d.playing && d.dur - now < 30);
        ui.bpm.textContent = d.an ? d.bpm().toFixed(1) : '—'; ui.pitch.textContent = (d.pitchV * d.range * 100 >= 0 ? '+' : '') + (d.pitchV * d.range * 100).toFixed(2) + '%';
        if (ui.playState !== d.playing) { ui.playState = d.playing; ui.play.classList.toggle('on', d.playing); mount(ui.play, icon(d.playing ? 'pause' : 'play', 22)); }
        ui.hot.forEach((b, i) => b.classList.toggle('set', d.hot[i] !== null)); ui.loops.forEach((b) => b.classList.toggle('on', !!d.loop && d.loop.n === Number(b.dataset.n)));
        drawVu(d.id, d.level());
        if (d.an && d.playing) { const ph = d.beatPhase(); ui.el.style.setProperty('--beat', ph < 0.12 ? '1' : '0'); }
      }
      drawZoom(zA, A); drawZoom(zB, B); drawVu('M', mixer.level());
      const m = A.playing && (!B.playing || mixer.xfV <= 0) ? A : B.playing ? B : null; masterBpm.textContent = m && m.an ? m.bpm().toFixed(1) + ' BPM' : '—';
      if (rec) recTime.textContent = time((Date.now() - recStart) / 1000);
      autoTick();
    }
    raf = requestAnimationFrame(frame);

    // ---------- Auto-DJ ----------
    const auto = { on: false, phase: 'idle', t0: 0, dur: 0, from: null, to: null, list: [], i: 0, loading: false };
    function autoSource() {
      const s = P.snapshot(); const q = s.queue.filter((x) => x.kind === 'file' || x.kind === 'gen');
      const pool = q.length >= 2 ? q : tracks.slice().sort(() => Math.random() - 0.5);
      auto.list = pool.map((x) => tracks.find((y) => y.id === x.id) || x); auto.i = 0;
    }
    function nextAuto(exclude) { if (!auto.list.length) autoSource(); for (let k = 0; k < auto.list.length; k++) { const tr = auto.list[auto.i++ % auto.list.length]; if (!exclude.includes(tr.id)) return tr; } return null; }
    async function autoStart() {
      autoSource(); if (!auto.list.length) { toast(t('Add some tracks first (or press "Synth 2 tracks")'), 'err'); auto.on = false; autoSw.input.checked = false; return; }
      if (!A.playing && !B.playing) { const d = A.track ? A : B.track ? B : A; if (!d.track) await loadInto(d, nextAuto([])); xf.value = d === A ? -1 : 1; mixer.setCrossfader(Number(xf.value)); d.play(); }
    }
    function autoTick() {
      if (!auto.on || auto.loading) return;
      const cur = A.playing && B.playing ? (auto.phase === 'mix' ? auto.from : A) : A.playing ? A : B.playing ? B : null; if (!cur || !cur.an) return;
      const other = cur === A ? B : A;
      if (auto.phase === 'idle') {
        if ((!other.track || other.done) && !other.loading) { auto.loading = true; const tr = nextAuto([cur.track.id]); (tr ? loadInto(other, tr) : Promise.resolve()).then(() => { other.done = false; }).finally(() => { auto.loading = false; }); return; }
        const bars = 8; const mixSec = bars * 4 * 60 / cur.bpm(); const remain = (cur.dur - cur.now()) / cur.pitch();
        if (other.track && other.an && remain <= mixSec + 1) {
          other.seek(other.an.offset || 0); other.syncTo(cur); other.setEq('lo', -26); other.knobs.lo.set(-26, true); other.play(true);
          setTimeout(() => other.syncTo(cur), 60);
          Object.assign(auto, { phase: 'mix', t0: actx.currentTime, dur: mixSec, from: cur, to: other });
        }
      } else if (auto.phase === 'mix') {
        const k = clamp((actx.currentTime - auto.t0) / auto.dur, 0, 1); const dir = auto.to === B ? 1 : -1; const x = -dir + dir * 2 * k;
        xf.value = x; mixer.setCrossfader(x);
        if (k > 0.5 && auto.to.eq.lo < -20) { auto.to.setEq('lo', 0); auto.to.knobs.lo.set(0, true); auto.from.setEq('lo', -26); auto.from.knobs.lo.set(-26, true); }
        if (k >= 1) { auto.from.pause(); auto.from.setEq('lo', 0); auto.from.knobs.lo.set(0, true); auto.from.done = true; auto.phase = 'idle'; api.post('/api/progress/event', { type: 'mix' }, { quiet: true }).catch(() => {}); }
      }
    }

    // ---------- recording ----------
    let rec = null, recChunks = [], recStart = 0;
    function startRec() {
      if (!window.MediaRecorder) return toast(t('Recording is not supported in this browser'), 'err');
      const type = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm'].find((x) => MediaRecorder.isTypeSupported(x)) || '';
      try { rec = new MediaRecorder(mixer.rec.stream, type ? { mimeType: type, audioBitsPerSecond: 192000 } : undefined); } catch (e) { return toastErr(e); }
      recChunks = []; recStart = Date.now(); rec.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.push(e.data); };
      rec.onstop = () => {
        const secs = (Date.now() - recStart) / 1000; const blob = new Blob(recChunks, { type: rec && rec.mimeType || 'audio/webm' }); rec = null; recBtn.classList.remove('on'); recTime.textContent = '';
        const url = URL.createObjectURL(blob); const name = `Nebulix mix ${new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', 'h')}.webm`;
        if (secs >= 60) api.post('/api/progress/event', { type: 'mix' }, { quiet: true }).catch(() => {});
        modal({ title: t('Your mix is ready'), body: h('div.col', h('audio', { src: url, controls: true, style: 'width:100%' }), h('p.small.muted', t('{d} recorded · {s}', { d: time(secs), s: fmt.bytes(blob.size) }))), actions: [{ label: t('Close') }, { label: t('Download'), kind: 'primary', onClick: () => { const a = h('a', { href: url, download: name }); document.body.appendChild(a); a.click(); a.remove(); return false; } }] });
      };
      rec.start(1000); recBtn.classList.add('on'); toast(t('Recording your mix…'));
    }
    function stopRec() { if (rec && rec.state !== 'inactive') rec.stop(); }

    // ---------- MIDI learn ----------
    let midiMap = ls('dj.midi') || {}; let learning = false, learnId = null, midiAccess = null;
    async function midiMenu(e) {
      const anchor = e.currentTarget;
      openMenu([
        { label: midiAccess ? t('MIDI connected ({n} devices)', { n: midiAccess.inputs.size }) : t('Connect a MIDI controller'), icon: 'keyboard', onClick: midiInit },
        { label: learning ? t('Stop learning') : t('Learn: click a control, then move a knob'), icon: 'sliders', onClick: () => { learning = !learning; learnId = null; wrap.classList.toggle('learning', learning); if (learning) { midiInit(); toast(t('MIDI learn: click any control on screen, then move or press something on your controller.'), 'info', 7000); } } },
        { label: t('Clear MIDI mappings ({n})', { n: Object.keys(midiMap).length }), icon: 'trash', danger: true, onClick: () => { midiMap = {}; ls('dj.midi', midiMap); toast(t('MIDI mappings cleared')); } },
      ], anchor);
    }
    async function midiInit() {
      if (midiAccess) return; if (!navigator.requestMIDIAccess) return toast(t('Web MIDI is not supported in this browser (use Chrome or Edge)'), 'err');
      try { midiAccess = await navigator.requestMIDIAccess(); const bind = () => { for (const inp of midiAccess.inputs.values()) inp.onmidimessage = onMidi; }; bind(); midiAccess.onstatechange = bind; toast(t('MIDI ready: {n} device(s)', { n: midiAccess.inputs.size }), 'good'); } catch (e) { toastErr(e); }
    }
    function onMidi(e) {
      const [st, d1, d2 = 0] = e.data; const type = st & 0xf0; const ch = st & 0x0f; if (type !== 0x90 && type !== 0x80 && type !== 0xb0) return;
      const key = (type === 0xb0 ? 'c' : 'n') + ch + ':' + d1;
      if (learning && learnId) { midiMap[key] = learnId; ls('dj.midi', midiMap); const c = controls.get(learnId); toast(t('Mapped to {c}', { c: c ? c.label : learnId }), 'good'); root.querySelectorAll('.midi-pick').forEach((x) => x.classList.remove('midi-pick')); learnId = null; return; }
      const c = controls.get(midiMap[key]); if (!c) return;
      if (type === 0xb0) { if (c.set) c.set(d2 / 127); else if (c.press) c.press(d2 > 63); }
      else if (c.press) c.press(type === 0x90 && d2 > 0); else if (c.set && type === 0x90 && d2 > 0) c.set(1);
    }
    wrap.addEventListener('click', (e) => { if (!learning) return; const el = e.target.closest('[data-midi]'); if (!el) return; e.preventDefault(); e.stopPropagation(); learnId = el.dataset.midi; root.querySelectorAll('.midi-pick').forEach((x) => x.classList.remove('midi-pick')); el.classList.add('midi-pick'); }, true);

    // ---------- keyboard ----------
    const held = new Set();
    const isFocused = () => { const w = root.closest('.os-win'); return !w || w.classList.contains('focused'); };
    const onKey = (e) => {
      if (!root.isConnected || !isFocused() || e.target.closest('input:not([type=range]), textarea, select, [contenteditable]') || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const k = e.key.toLowerCase(); const map = { z: () => A.toggle(opts.vinyl), x: () => A.cueDown(opts.quant), c: () => A.ui.sync.click(), m: () => B.toggle(opts.vinyl), n: () => B.cueDown(opts.quant), b: () => B.ui.sync.click(), q: () => A.bend(-0.04), w: () => A.bend(0.04), o: () => B.bend(-0.04), p: () => B.bend(0.04),
        1: () => A.hotcue(0, opts.quant), 2: () => A.hotcue(1, opts.quant), 3: () => A.hotcue(2, opts.quant), 4: () => A.hotcue(3, opts.quant), 7: () => B.hotcue(0, opts.quant), 8: () => B.hotcue(1, opts.quant), 9: () => B.hotcue(2, opts.quant), 0: () => B.hotcue(3, opts.quant),
        arrowleft: () => { xf.value = clamp(Number(xf.value) - 0.1, -1, 1); mixer.setCrossfader(Number(xf.value)); }, arrowright: () => { xf.value = clamp(Number(xf.value) + 0.1, -1, 1); mixer.setCrossfader(Number(xf.value)); }, arrowdown: () => { xf.value = 0; mixer.setCrossfader(0); } };
      const pi = 'asdfghjk'.indexOf(k); if (pi >= 0 && !e.shiftKey) { e.preventDefault(); pads.children[pi].dispatchEvent(new PointerEvent('pointerdown')); return; }
      if (map[k]) { e.preventDefault(); held.add(k); map[k](); }
    };
    const onKeyUp = (e) => { const k = e.key.toLowerCase(); if (!held.has(k)) return; held.delete(k); if (k === 'x') A.cueUp(); if (k === 'n') B.cueUp(); if (k === 'q' || k === 'w') A.bend(0); if (k === 'o' || k === 'p') B.bend(0); };
    document.addEventListener('keydown', onKey); document.addEventListener('keyup', onKeyUp);
    function help() {
      const row = (k, d) => h('div.row.between.small', h('span', d), h('kbd', k));
      modal({ title: t('DJ shortcuts'), body: h('div.grid.cols-2', h('div.col', h('b', t('Deck A')), row('Z', t('Play / pause')), row('X', 'CUE'), row('C', 'SYNC'), row('1–4', t('Hot cues')), row('Q / W', t('Nudge − / +'))), h('div.col', h('b', t('Deck B')), row('M', t('Play / pause')), row('N', 'CUE'), row('B', 'SYNC'), row('7–0', t('Hot cues')), row('O / P', t('Nudge − / +'))), h('div.col', h('b', t('Mixer')), row('← / →', t('Crossfader')), row('↓', t('Center crossfader')), row(t('Double-click'), t('Reset a knob or fader'))), h('div.col', h('b', t('Sampler')), row('A S D F G H J K', t('Pads 1–8')), row('Shift+click', t('Delete a hot cue')))), actions: [{ label: t('Got it'), kind: 'primary' }] });
    }

    // ---------- activity & cleanup ----------
    const act = debounce(() => { const pl = [A, B].filter((d) => d.playing && d.track); if (pl.length) ws.send({ t: 'act', kind: 'dj', label: t('Mixing') + ': ' + pl.map((d) => d.track.title).join(' × ').slice(0, 70) }); else ws.send({ t: 'act' }); }, 1500);
    for (const d of [A, B]) offs.push(d.on((ev) => { if (ev === 'state' || ev === 'loaded') act(); if (ev === 'state' && d.playing) P.claimAudio(); if (ev === 'end' && !auto.on) d.seek(d.cue); }));
    offs.push(P.onForeignAudio(() => { A.pause(); B.pause(); }));
    offs.push(() => { document.removeEventListener('keydown', onKey); document.removeEventListener('keyup', onKeyUp); });
    const onTheme = () => { C = colors(); stripCache.clear(); for (const d of [A, B]) if (d.ui) drawOverview(d); };
    const mo = new MutationObserver(debounce(onTheme, 300)); mo.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    const load = ctx.query.get('load'); if (load) { const tr = tracks.find((x) => x.id === load) || (await lib.getTrack(load)); if (tr) loadInto(ctx.query.get('deck') === 'B' ? B : A, tr); }
    return () => {
      alive = false; cancelAnimationFrame(raf); mo.disconnect(); offs.forEach((f) => f()); stopRec();
      for (const d of [A, B]) { try { d.unload(); d.node.disconnect(); } catch {} } try { mixer.lim.disconnect(); } catch {}
      if (midiAccess) for (const inp of midiAccess.inputs.values()) inp.onmidimessage = null;
      ws.send({ t: 'act' });
    };
  },
};
