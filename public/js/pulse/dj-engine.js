// DJ engine: two decks (AudioWorklet playback) → 3-band EQ → filter → FX → channel fader → crossfader → master limiter.
// Also: beat sync, loops, hot cues, brake/spinback, sampler pads and mix recording.
import { audioCtx } from './engine.js';
import { decode, analyze } from './analyze.js';
import { clamp } from '../util.js';

let workletReady = null;
async function ready(ctx) { if (!workletReady) workletReady = ctx.audioWorklet.addModule('/js/pulse/deck-worklet.js'); return workletReady; }
const dbToGain = (db) => Math.pow(10, db / 20);

function impulse(ctx, sec = 2.4, decay = 3) { const len = Math.floor(ctx.sampleRate * sec); const b = ctx.createBuffer(2, len, ctx.sampleRate); for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); } return b; }

export const FX = [['none', 'No FX'], ['echo', 'Echo'], ['reverb', 'Reverb'], ['flanger', 'Flanger'], ['gate', 'Trance gate'], ['crush', 'Bitcrush'], ['sweep', 'Filter sweep']];

class FxUnit {
  constructor(ctx, deck) {
    this.ctx = ctx; this.deck = deck; this.type = 'none'; this.wetV = 0.5; this.beats = 0.5; this.on = false;
    this.input = ctx.createGain(); this.output = ctx.createGain(); this.dry = ctx.createGain(); this.wet = ctx.createGain(); this.wet.gain.value = 0;
    this.input.connect(this.dry).connect(this.output); this.wet.connect(this.output); this.nodes = [];
  }
  beatSec() { return 60 / Math.max(40, this.deck.bpm() || 120); }
  set(type) {
    for (const n of this.nodes) { try { n.stop && n.stop(); } catch {} try { n.disconnect(); } catch {} }
    this.nodes = []; this.delay = this.lfo = null; this.input.disconnect(); this.input.connect(this.dry); this.type = type; const c = this.ctx; const i = this.input; const w = this.wet; const keep = (...n) => { this.nodes.push(...n); return n[0]; };
    if (type === 'echo') { const d = keep(c.createDelay(4)); const fb = keep(c.createGain()); const lp = keep(c.createBiquadFilter()); lp.type = 'lowpass'; lp.frequency.value = 5000; fb.gain.value = 0.45; i.connect(d); d.connect(lp).connect(fb).connect(d); d.connect(w); this.delay = d; }
    else if (type === 'reverb') { const cv = keep(c.createConvolver()); cv.buffer = impulse(c); i.connect(cv).connect(w); }
    else if (type === 'flanger') { const d = keep(c.createDelay(0.05)); d.delayTime.value = 0.004; const lfo = keep(c.createOscillator()); lfo.frequency.value = 0.25; const dep = keep(c.createGain()); dep.gain.value = 0.0028; const fb = keep(c.createGain()); fb.gain.value = 0.6; lfo.connect(dep).connect(d.delayTime); lfo.start(); i.connect(d); d.connect(fb).connect(d); d.connect(w); i.connect(w); this.lfo = lfo; }
    else if (type === 'gate') { const g = keep(c.createGain()); g.gain.value = 0; const lfo = keep(c.createOscillator()); lfo.type = 'square'; const amt = keep(c.createGain()); amt.gain.value = 0.5; const off = keep(c.createConstantSource()); off.offset.value = 0.5; lfo.connect(amt).connect(g.gain); off.connect(g.gain); lfo.start(); off.start(); i.connect(g).connect(w); this.lfo = lfo; }
    else if (type === 'crush') { const ws = keep(c.createWaveShaper()); const steps = 10; const curve = new Float32Array(4096); for (let k = 0; k < 4096; k++) { const x = k / 2048 - 1; curve[k] = Math.round(x * steps) / steps; } ws.curve = curve; const lp = keep(c.createBiquadFilter()); lp.type = 'lowpass'; lp.frequency.value = 6000; i.connect(ws).connect(lp).connect(w); }
    else if (type === 'sweep') { const f = keep(c.createBiquadFilter()); f.type = 'bandpass'; f.Q.value = 4; f.frequency.value = 1000; const lfo = keep(c.createOscillator()); const dep = keep(c.createGain()); dep.gain.value = 1800; lfo.connect(dep).connect(f.frequency); lfo.start(); i.connect(f).connect(w); this.lfo = lfo; this.sweepF = f; }
    this.sync(); this.apply();
  }
  sync() { // tempo-sync the effect to the deck
    const t = this.beatSec() * this.beats; const now = this.ctx.currentTime;
    if (this.type === 'echo' && this.delay) this.delay.delayTime.setTargetAtTime(clamp(t, 0.02, 3.9), now, 0.05);
    if (this.type === 'gate' && this.lfo) this.lfo.frequency.setTargetAtTime(1 / Math.max(0.05, t), now, 0.05);
    if (this.type === 'sweep' && this.lfo) this.lfo.frequency.setTargetAtTime(1 / Math.max(0.2, t * 8), now, 0.05);
    if (this.type === 'flanger' && this.lfo) this.lfo.frequency.setTargetAtTime(1 / Math.max(0.5, t * 16), now, 0.05);
  }
  setWet(v) { this.wetV = clamp(v, 0, 1); this.apply(); }
  setBeats(b) { this.beats = b; this.sync(); }
  setOn(b) { this.on = !!b; this.apply(); }
  apply() { const on = this.on && this.type !== 'none'; const now = this.ctx.currentTime; this.wet.gain.setTargetAtTime(on ? this.wetV : 0, now, 0.03); this.dry.gain.setTargetAtTime(on && ['gate', 'crush', 'sweep'].includes(this.type) ? 1 - this.wetV : 1, now, 0.03); }
}

export class Deck {
  constructor(ctx, id, mixer) {
    this.ctx = ctx; this.id = id; this.mixer = mixer; this.track = null; this.an = null; this.dur = 0;
    this.pos = 0; this.posAt = 0; this.rate = 0; this.playing = false; this.pitchV = 0; this.range = 0.08; this.cue = 0; this.hot = [null, null, null, null]; this.loop = null; this.loading = false; this.listeners = new Set();
    this.node = new AudioWorkletNode(ctx, 'nbx-deck', { numberOfInputs: 0, outputChannelCount: [2] });
    this.node.port.onmessage = (e) => { const m = e.data; if (m.t === 'pos') { this.pos = m.pos; this.posAt = ctx.currentTime; this.rate = m.rate; if (this.playing !== m.playing) { this.playing = m.playing; this.emit('state'); } } else if (m.t === 'end') { this.playing = false; this.emit('end'); this.emit('state'); } };
    const bi = (type, f, q) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q) b.Q.value = q; return b; };
    this.trim = ctx.createGain(); this.lo = bi('lowshelf', 220); this.mi = bi('peaking', 1100, 0.7); this.hi = bi('highshelf', 3800);
    this.lp = bi('lowpass', 22000, 0.9); this.hp = bi('highpass', 10, 0.9); this.fx = new FxUnit(ctx, this); this.fader = ctx.createGain(); this.xf = ctx.createGain();
    this.meter = ctx.createAnalyser(); this.meter.fftSize = 1024; this.mbuf = new Float32Array(1024);
    this.node.connect(this.trim).connect(this.lo).connect(this.mi).connect(this.hi).connect(this.lp).connect(this.hp).connect(this.fx.input);
    this.fx.output.connect(this.fader).connect(this.xf).connect(mixer.bus); this.fader.connect(this.meter);
    this.eq = { lo: 0, mi: 0, hi: 0 }; this.filterV = 0; this.faderV = 0.85; this.trimV = 0; this.fader.gain.value = this.faderV;
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(ev) { for (const f of this.listeners) { try { f(ev, this); } catch (e) { console.error(e); } } }
  post(m) { this.node.port.postMessage(m); }
  // ---- loading ----
  async load(track, onProgress) {
    this.loading = true; this.emit('loading');
    try {
      const d = await decode(track, onProgress); const buf = d.buffer;
      const an = await analyze(track, buf, d.bpm ? { bpm: d.bpm, offset: d.offset } : {});
      const L = new Float32Array(buf.getChannelData(0)); const R = buf.numberOfChannels > 1 ? new Float32Array(buf.getChannelData(1)) : null;
      this.post({ t: 'load', L, R, sr: buf.sampleRate }); // copies; the decoded buffer can be garbage collected
      this.track = track; this.an = an; this.dur = buf.duration; this.pos = 0; this.posAt = this.ctx.currentTime; this.playing = false; this.loop = null; this.cue = an.offset || 0; this.hot = [null, null, null, null];
      this.post({ t: 'pitch', v: this.pitch() }); this.post({ t: 'seek', sec: this.cue }); this.pos = this.cue; this.fx.sync();
      this.emit('loaded'); return true;
    } finally { this.loading = false; this.emit('state'); }
  }
  // ---- time & tempo ----
  now() { return this.playing || this.rate ? clamp(this.pos + (this.ctx.currentTime - this.posAt) * this.rate, 0, this.dur) : this.pos; }
  pitch() { return 1 + this.pitchV * this.range; }
  baseBpm() { return this.an ? this.an.bpm : 0; }
  bpm() { return this.baseBpm() * this.pitch(); }
  beatLen() { return this.an && this.an.bpm ? 60 / this.an.bpm : 0.5; } // in track seconds
  beatPhase(t = this.now()) { const bl = this.beatLen(); const x = (t - (this.an ? this.an.offset : 0)) / bl; return x - Math.floor(x); }
  nearestBeat(t = this.now(), floor = false) { const bl = this.beatLen(); const off = this.an ? this.an.offset : 0; const k = (t - off) / bl; return off + (floor ? Math.floor(k + 1e-6) : Math.round(k)) * bl; }
  // ---- transport ----
  play(instant = true) { if (!this.track) return; this.post({ t: 'play', instant }); this.playing = true; this.emit('state'); }
  pause(instant = true) { this.post({ t: 'pause', instant }); this.playing = false; this.emit('state'); }
  toggle(vinyl) { if (this.playing) this.pause(!vinyl); else this.play(!vinyl); }
  seek(sec) { sec = clamp(sec, 0, Math.max(0, this.dur - 0.01)); this.post({ t: 'seek', sec }); this.pos = sec; this.posAt = this.ctx.currentTime; this.emit('seek'); }
  cueDown(quant) { if (!this.track) return; if (this.playing) { this.pause(); this.seek(this.cue); this.cueHeld = false; return; } const t = this.now(); if (Math.abs(t - this.cue) < 0.03) { this.cueHeld = true; this.play(); } else { this.cue = quant ? this.nearestBeat(t) : t; this.seek(this.cue); this.emit('cue'); } }
  cueUp() { if (this.cueHeld) { this.cueHeld = false; this.pause(); this.seek(this.cue); } }
  setPitchV(v) { this.pitchV = clamp(v, -1, 1); this.post({ t: 'pitch', v: this.pitch() }); this.fx.sync(); this.emit('pitch'); }
  setRange(r) { const p = this.pitch(); this.range = r; this.setPitchV((p - 1) / r); }
  bend(v) { this.post({ t: 'bend', v }); }
  scratch(on, rate = 0) { this.post({ t: 'scratch', on, rate }); }
  brake(sec = 0.9) { if (this.playing) this.post({ t: 'brake', v: sec }); }
  spinback() { if (!this.track) return; this.scratch(true, -3.2); setTimeout(() => { this.scratch(false); this.pause(); }, 520); }
  // ---- sync: match the other deck's tempo and beat phase ----
  syncTo(o) {
    if (!o || !o.an || !this.an) return false;
    const target = o.bpm(); let need = target / this.baseBpm() - 1;
    for (const cand of [need, (target * 2) / this.baseBpm() - 1, (target / 2) / this.baseBpm() - 1]) if (Math.abs(cand) < Math.abs(need)) need = cand; // half/double time
    if (Math.abs(need) > this.range) this.range = Math.abs(need) > 0.16 ? 0.5 : 0.16;
    this.setPitchV(need / this.range);
    if (o.playing || this.playing) { const d = o.beatPhase() - this.beatPhase(); let shift = d - Math.round(d); this.seek(this.now() + shift * this.beatLen()); }
    return true;
  }
  // ---- hot cues & loops ----
  hotcue(i, quant) { if (!this.track) return; if (this.hot[i] === null) { this.hot[i] = quant ? this.nearestBeat() : this.now(); this.emit('cue'); } else { this.seek(this.hot[i]); if (!this.playing) this.play(); } }
  clearHot(i) { this.hot[i] = null; this.emit('cue'); }
  loopBeats(n) {
    if (!this.track) return;
    if (this.loop && this.loop.n === n) return this.loopOff();
    const a = this.loop ? this.loop.a : this.nearestBeat(this.now(), true); const b = a + n * this.beatLen();
    this.loop = { a, b, n }; this.post({ t: 'loop', on: true, a, b }); this.emit('loop');
  }
  loopScale(k) { if (!this.loop) return; const n = clamp(this.loop.n * k, 1 / 8, 64); this.loop = { a: this.loop.a, b: this.loop.a + n * this.beatLen(), n }; this.post({ t: 'loop', on: true, a: this.loop.a, b: this.loop.b }); this.emit('loop'); }
  loopOff() { this.loop = null; this.post({ t: 'loop', on: false }); this.emit('loop'); }
  // ---- mixer strip ----
  setEq(band, db) { this.eq[band] = clamp(db, -26, 6); const node = this[band]; node.gain.setTargetAtTime(this.eq[band] <= -25.5 ? -40 : this.eq[band], this.ctx.currentTime, 0.02); }
  setFilter(v) { // -1 = low-pass closed … 0 = off … +1 = high-pass closed
    this.filterV = clamp(v, -1, 1); const now = this.ctx.currentTime; const x = Math.abs(this.filterV);
    if (this.filterV < -0.02) { this.lp.frequency.setTargetAtTime(22000 * Math.pow(60 / 22000, x), now, 0.02); this.hp.frequency.setTargetAtTime(10, now, 0.02); }
    else if (this.filterV > 0.02) { this.hp.frequency.setTargetAtTime(10 * Math.pow(9000 / 10, x), now, 0.02); this.lp.frequency.setTargetAtTime(22000, now, 0.02); }
    else { this.lp.frequency.setTargetAtTime(22000, now, 0.02); this.hp.frequency.setTargetAtTime(10, now, 0.02); }
  }
  setTrim(db) { this.trimV = clamp(db, -12, 12); this.trim.gain.setTargetAtTime(dbToGain(this.trimV), this.ctx.currentTime, 0.02); }
  setFader(v) { this.faderV = clamp(v, 0, 1); this.fader.gain.setTargetAtTime(this.faderV * this.faderV, this.ctx.currentTime, 0.015); }
  level() { this.meter.getFloatTimeDomainData(this.mbuf); let p = 0; for (let i = 0; i < this.mbuf.length; i++) { const a = Math.abs(this.mbuf[i]); if (a > p) p = a; } return p; }
  unload() { this.pause(); this.post({ t: 'unload' }); this.track = null; this.an = null; this.dur = 0; this.emit('loaded'); }
}

export class Mixer {
  constructor(ctx) {
    this.ctx = ctx; this.bus = ctx.createGain(); this.master = ctx.createGain(); this.master.gain.value = 0.9; this.lim = ctx.createDynamicsCompressor();
    this.lim.threshold.value = -2; this.lim.ratio.value = 20; this.lim.knee.value = 0; this.lim.attack.value = 0.002; this.lim.release.value = 0.2;
    this.meter = ctx.createAnalyser(); this.meter.fftSize = 1024; this.mbuf = new Float32Array(1024);
    this.rec = ctx.createMediaStreamDestination();
    this.bus.connect(this.master).connect(this.lim); this.lim.connect(ctx.destination); this.lim.connect(this.meter); this.lim.connect(this.rec);
    this.xfV = 0; this.curve = 'smooth'; this.decks = [];
  }
  setCrossfader(v) {
    this.xfV = clamp(v, -1, 1); const x = (this.xfV + 1) / 2; let a, b;
    if (this.curve === 'cut') { a = x < 0.96 ? 1 : (1 - x) / 0.04; b = x > 0.04 ? 1 : x / 0.04; } else { a = Math.cos(x * Math.PI / 2); b = Math.sin(x * Math.PI / 2); }
    const now = this.ctx.currentTime; if (this.decks[0]) this.decks[0].xf.gain.setTargetAtTime(a, now, 0.012); if (this.decks[1]) this.decks[1].xf.gain.setTargetAtTime(b, now, 0.012);
  }
  setMaster(v) { this.master.gain.setTargetAtTime(clamp(v, 0, 1.2), this.ctx.currentTime, 0.02); }
  level() { this.meter.getFloatTimeDomainData(this.mbuf); let p = 0; for (let i = 0; i < this.mbuf.length; i++) { const a = Math.abs(this.mbuf[i]); if (a > p) p = a; } return p; }
}

// ---- sampler pads (synthesised one-shots) ----
export const PADS = [['horn', 'Air horn'], ['kick', 'Kick drum'], ['clap', 'Clap'], ['snare', 'Snare'], ['laser', 'Laser'], ['riser', 'Riser'], ['impact', 'Impact'], ['scratch', 'Scratch']];
export function pad(ctx, out, kind, bpm = 124) {
  const t = ctx.currentTime + 0.005; const g = ctx.createGain(); g.connect(out);
  const noise = (dur) => { const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; const s = ctx.createBufferSource(); s.buffer = b; return s; };
  const env = (node, a, peak, rel) => { node.gain.setValueAtTime(0.0001, t); node.gain.exponentialRampToValueAtTime(peak, t + a); node.gain.exponentialRampToValueAtTime(0.0001, t + a + rel); };
  if (kind === 'horn') { for (const [d, f] of [[0, 440], [-12, 554], [8, 659]]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.detune.value = d; o.frequency.setValueAtTime(f * 0.92, t); o.frequency.linearRampToValueAtTime(f, t + 0.05); for (let k = 0; k < 3; k++) { o.frequency.setValueAtTime(f, t + 0.12 + k * 0.18); o.frequency.linearRampToValueAtTime(f * 0.97, t + 0.2 + k * 0.18); } o.connect(g); o.start(t); o.stop(t + 0.75); } const f = ctx.createBiquadFilter(); g.disconnect(); f.type = 'lowpass'; f.frequency.value = 2600; g.connect(f).connect(out); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.02); g.gain.setValueAtTime(0.18, t + 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.74); }
  else if (kind === 'kick') { const o = ctx.createOscillator(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12); o.connect(g); env(g, 0.004, 0.9, 0.42); o.start(t); o.stop(t + 0.5); }
  else if (kind === 'clap') { for (let k = 0; k < 4; k++) { const s = noise(0.2); const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1200; const gg = ctx.createGain(); s.connect(f).connect(gg).connect(g); gg.gain.setValueAtTime(0.0001, t + k * 0.011); gg.gain.exponentialRampToValueAtTime(0.5, t + k * 0.011 + 0.002); gg.gain.exponentialRampToValueAtTime(0.0001, t + k * 0.011 + (k === 3 ? 0.18 : 0.02)); s.start(t + k * 0.011); } g.gain.value = 1; }
  else if (kind === 'snare') { const s = noise(0.25); const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1400; s.connect(f).connect(g); env(g, 0.002, 0.5, 0.2); s.start(t); const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 190; const og = ctx.createGain(); o.connect(og).connect(out); og.gain.setValueAtTime(0.3, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.1); o.start(t); o.stop(t + 0.12); }
  else if (kind === 'laser') { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(2400, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.35); o.connect(g); env(g, 0.003, 0.14, 0.36); o.start(t); o.stop(t + 0.42); }
  else if (kind === 'riser') { const dur = 4 * 60 / bpm * 2; const s = noise(dur + 0.1); const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 3; f.frequency.setValueAtTime(250, t); f.frequency.exponentialRampToValueAtTime(9000, t + dur); s.connect(f).connect(g); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + dur); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05); s.start(t); }
  else if (kind === 'impact') { const o = ctx.createOscillator(); o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(28, t + 1.4); o.connect(g); env(g, 0.005, 0.9, 1.5); o.start(t); o.stop(t + 1.6); const s = noise(1.6); const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(5000, t); f.frequency.exponentialRampToValueAtTime(200, t + 1.2); const ng = ctx.createGain(); s.connect(f).connect(ng).connect(out); ng.gain.setValueAtTime(0.3, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 1.5); s.start(t); }
  else if (kind === 'scratch') { const s = noise(0.5); const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 6; for (let k = 0; k < 4; k++) { f.frequency.setValueAtTime(400, t + k * 0.11); f.frequency.exponentialRampToValueAtTime(2600, t + k * 0.11 + 0.08); } s.connect(f).connect(g); env(g, 0.004, 0.5, 0.44); s.start(t); }
}

export async function createRig() {
  const ctx = audioCtx(); await ready(ctx);
  const mixer = new Mixer(ctx); const A = new Deck(ctx, 'A', mixer); const B = new Deck(ctx, 'B', mixer); mixer.decks = [A, B]; mixer.setCrossfader(0);
  return { ctx, mixer, A, B };
}
