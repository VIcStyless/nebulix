// Nebula Synth: original music composed from a seed and rendered offline with the Web Audio API.
// Every track is 100% generated here (drums, bass, pads, leads, effects) — no samples, no copyrighted material.
// Same seed + style = same song, so a "track" is just a tiny recipe that can be shared or re-rendered.

export const STYLES = {
  synthwave: { name: 'Synthwave', bpm: [96, 118], scale: 'minor', emoji: '🌆', hue: 300 },
  lofi: { name: 'Lo-fi beats', bpm: [72, 88], scale: 'dorian', emoji: '☕', hue: 30 },
  house: { name: 'House', bpm: [120, 126], scale: 'minor', emoji: '🏠', hue: 200 },
  techno: { name: 'Techno', bpm: [126, 134], scale: 'phrygian', emoji: '⚙️', hue: 0 },
  dnb: { name: 'Drum & bass', bpm: [170, 176], scale: 'minor', emoji: '⚡', hue: 160 },
  trap: { name: 'Trap', bpm: [136, 146], scale: 'harmonic', emoji: '💎', hue: 270 },
  chiptune: { name: 'Chiptune', bpm: [140, 160], scale: 'major', emoji: '👾', hue: 120 },
  ambient: { name: 'Ambient', bpm: [62, 76], scale: 'major', emoji: '🌌', hue: 230 },
};
const SCALES = { minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], major: [0, 2, 4, 5, 7, 9, 11], phrygian: [0, 1, 3, 5, 7, 8, 10], harmonic: [0, 2, 3, 5, 7, 8, 11] };
const PROGS = {
  minor: [[0, 5, 2, 6], [0, 3, 5, 4], [0, 5, 3, 4], [0, 6, 5, 6], [5, 3, 0, 4], [0, 2, 5, 6]],
  dorian: [[1, 4, 0, 0], [0, 3, 1, 4], [3, 2, 1, 0], [0, 6, 3, 4]], major: [[0, 4, 5, 3], [0, 5, 3, 4], [3, 4, 0, 0], [0, 3, 4, 3], [5, 3, 0, 4]],
  phrygian: [[0, 1, 0, 6], [0, 0, 1, 1], [0, 6, 5, 1]], harmonic: [[0, 5, 4, 4], [0, 3, 4, 0], [0, 5, 3, 4]],
};
const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const WORDS = {
  synthwave: [['Neon', 'Midnight', 'Chrome', 'Sunset', 'Retro', 'Vapor', 'Electric', 'Laser', 'Turbo', 'Velvet'], ['Drive', 'Skyline', 'Horizon', 'Boulevard', 'Dreams', 'Runner', 'Highway', 'Arcade', 'Mirage', 'Nights']],
  lofi: [['Rainy', 'Sleepy', 'Cozy', 'Late', 'Soft', 'Dusty', 'Warm', 'Quiet', 'Lazy', 'Golden'], ['Window', 'Coffee', 'Notebook', 'Afternoon', 'Tape', 'Streets', 'Pages', 'Clouds', 'Lamp', 'Sunday']],
  house: [['Deep', 'Sunrise', 'Velvet', 'Island', 'Golden', 'Liquid', 'Weekend', 'Rooftop', 'Ocean', 'Summer'], ['Groove', 'Motion', 'Feeling', 'Lights', 'Rhythm', 'Club', 'Waves', 'Bounce', 'Fever', 'Soul']],
  techno: [['Iron', 'Concrete', 'Binary', 'Dark', 'Steel', 'Signal', 'Hollow', 'Static', 'Pulse', 'Void'], ['Machine', 'Tunnel', 'Protocol', 'Engine', 'Circuit', 'Factory', 'System', 'Core', 'Matrix', 'Grid']],
  dnb: [['Rapid', 'Liquid', 'Storm', 'Hyper', 'Quantum', 'Rolling', 'Sonic', 'Atomic', 'Shadow', 'Wild'], ['Force', 'Velocity', 'Rush', 'Breaker', 'Current', 'Jungle', 'Thunder', 'Shift', 'Impact', 'Run']],
  trap: [['Diamond', 'Purple', 'Ice', 'Royal', 'Smoke', 'Gold', 'Phantom', 'Crystal', 'Venom', 'Obsidian'], ['Crown', 'Rain', 'Empire', 'Wave', 'Throne', 'Flex', 'Night', 'Drip', 'Legacy', 'Mode']],
  chiptune: [['Pixel', 'Super', 'Mega', 'Hyper', 'Bit', 'Turbo', 'Power', 'Star', 'Retro', 'Ultra'], ['Quest', 'Castle', 'Dash', 'Level', 'Hero', 'Boss', 'World', 'Jump', 'Coins', 'Combo']],
  ambient: [['Floating', 'Distant', 'Silent', 'Endless', 'Frozen', 'Lunar', 'Drifting', 'Ethereal', 'Deep', 'Weightless'], ['Nebula', 'Ocean', 'Aurora', 'Orbit', 'Horizon', 'Echoes', 'Galaxy', 'Tides', 'Dust', 'Light']],
};

export function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const newSeed = () => (crypto.getRandomValues(new Uint32Array(1))[0] >>> 0) || 1;

// A complete recipe from a style + seed (anything left out is chosen by the seed)
export function recipeFor(style = 'synthwave', seed = newSeed(), opts = {}) {
  const s = STYLES[style] ? style : 'synthwave'; const r = rng(seed); const def = STYLES[s];
  const bpm = opts.bpm ? Math.round(opts.bpm) : Math.round(def.bpm[0] + r() * (def.bpm[1] - def.bpm[0]));
  const root = Number.isInteger(opts.root) ? opts.root : Math.floor(r() * 12);
  return { v: 1, style: s, seed: seed >>> 0, bpm, root, length: ['short', 'normal', 'long'].includes(opts.length) ? opts.length : 'normal', mood: opts.mood || 'auto' };
}
export function titleFor(rc) { const r = rng(rc.seed ^ 0x9e3779b9); const w = WORDS[rc.style] || WORDS.synthwave; return `${w[0][Math.floor(r() * w[0].length)]} ${w[1][Math.floor(r() * w[1].length)]}`; }
export const keyName = (rc) => `${KEYS[rc.root % 12]} ${STYLES[rc.style].scale === 'major' ? 'major' : 'minor'}`;

// ---------------- the band ----------------
// Performance notes: drums are pre-rendered one-shots (1 buffer source per hit), instruments share bus filters,
// vibrato comes from one shared LFO, and the vinyl crackle is a single generated loop. This keeps the offline
// render several times faster than building a full synth graph per note.
function makeImpulse(c, sec, decay) {
  const len = Math.floor(c.sampleRate * sec); const b = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
  return b;
}
// drum one-shots computed directly in JS (no audio graph at all)
function drumKit(sr, style, r) {
  const mk = (sec, fn) => { const n = Math.floor(sr * sec); const d = new Float32Array(n); fn(d, n); return d; };
  const hard = style === 'techno' || style === 'house'; const trap = style === 'trap';
  const kick = mk(trap ? 0.75 : 0.45, (d, n) => { let ph = 0; const f0 = hard ? 165 : 140, f1 = trap ? 38 : 45; for (let i = 0; i < n; i++) { const t = i / sr; const f = f1 + (f0 - f1) * Math.exp(-t / 0.035); ph += 2 * Math.PI * f / sr; const env = Math.min(1, t / 0.003) * Math.exp(-t / (trap ? 0.22 : 0.12)); d[i] = Math.sin(ph) * env + (i < sr * 0.012 ? (Math.random() * 2 - 1) * 0.18 * (1 - i / (sr * 0.012)) : 0); } });
  const bp = (fc, q) => { const w = 2 * Math.PI * fc / sr, al = Math.sin(w) / (2 * q), b0 = al, a0 = 1 + al, a1 = -2 * Math.cos(w), a2 = 1 - al; return { b0: b0 / a0, b2: -b0 / a0, a1: a1 / a0, a2: a2 / a0 }; };
  const filt = (d, c) => { let x1 = 0, x2 = 0, y1 = 0, y2 = 0; for (let i = 0; i < d.length; i++) { const x = d[i]; const y = c.b0 * x + c.b2 * x2 - c.a1 * y1 - c.a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; d[i] = y; } };
  const hp = (d, fc) => { const a = Math.exp(-2 * Math.PI * fc / sr); let lp = 0; for (let i = 0; i < d.length; i++) { lp = (1 - a) * d[i] + a * lp; d[i] -= lp; } };
  const snare = mk(style === 'synthwave' ? 0.34 : 0.22, (d, n) => { for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; filt(d, bp(1900, 0.7)); let ph = 0; for (let i = 0; i < n; i++) { const t = i / sr; ph += 2 * Math.PI * (140 + 60 * Math.exp(-t / 0.03)) / sr; d[i] = d[i] * 1.6 * Math.exp(-t / (style === 'synthwave' ? 0.12 : 0.06)) + Math.sin(ph) * 0.35 * Math.exp(-t / 0.035); } });
  const clap = mk(0.22, (d, n) => { for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; filt(d, bp(1200, 1.2)); for (let i = 0; i < n; i++) { const t = i / sr; const burst = [0, 0.011, 0.022].some((o) => t >= o && t < o + 0.02) ? 1 : 0; d[i] *= 2.2 * (burst ? Math.exp(-((t * 1000) % 11) / 4) : (t > 0.033 ? Math.exp(-(t - 0.033) / 0.05) * 0.8 : 0)); } });
  const hat = mk(0.06, (d, n) => { for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; hp(d, style === 'chiptune' ? 6000 : 7600); hp(d, 7000); for (let i = 0; i < n; i++) d[i] *= 0.7 * Math.exp(-i / sr / 0.012); });
  const ohat = mk(0.32, (d, n) => { for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; hp(d, 7600); hp(d, 7000); for (let i = 0; i < n; i++) d[i] *= 0.55 * Math.exp(-i / sr / 0.09); });
  void r; return { kick, snare, clap, hat, ohat };
}
function noiseLoop(sr, sec, crackle, r) {
  const n = Math.floor(sr * sec); const d = new Float32Array(n);
  if (!crackle) { for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; return d; }
  let lp = 0; for (let i = 0; i < n; i++) { lp = 0.7 * lp + 0.3 * (Math.random() * 2 - 1); d[i] = lp * 0.02; }
  for (let k = 0; k < sec * 9; k++) { const at = Math.floor(r() * (n - 200)); const amp = 0.08 + r() * 0.22; for (let j = 0; j < 90; j++) d[at + j] += (Math.random() * 2 - 1) * amp * Math.exp(-j / 18); }
  return d;
}

export async function render(rc, onProgress) {
  const st = STYLES[rc.style]; const r = rng(rc.seed); const sr = 44100;
  const beat = 60 / rc.bpm, bar = beat * 4, six = beat / 4;
  const mult = { short: 0.5, normal: 1, long: 1.5 }[rc.length] || 1;
  const B = (n) => Math.max(2, Math.round(n * mult / 2) * 2);
  const drums = rc.style !== 'ambient';
  const form = [
    { n: B(8), p: { pad: 1, hat: drums ? 0.5 : 0, arp: 0.6, pluck: rc.style === 'ambient' ? 1 : 0 } },
    { n: B(16), p: { kick: 1, hat: 1, snare: 1, bass: 1, pad: 1, arp: 1, pluck: 0.6 } },
    { n: B(16), p: { kick: 1, hat: 1, snare: 1, clap: 1, bass: 1, pad: 1, lead: 1, pluck: 0.4 } },
    { n: B(8), p: { pad: 1, lead: 0.6, riser: 1, pluck: 1 } },
    { n: B(16), p: { kick: 1, hat: 1, snare: 1, clap: 1, bass: 1, pad: 1, lead: 1, arp: 1, impact: 1 } },
    { n: B(8), p: { pad: 1, kick: drums ? 1 : 0, hat: 0.5, arp: 0.5 } },
  ];
  const bars = form.reduce((a, s2) => a + s2.n, 0); const total = bars * bar + 3.5;
  const c = new OfflineAudioContext(2, Math.ceil(sr * total), sr);
  const toBuf = (d) => { const b = c.createBuffer(1, d.length, sr); b.getChannelData(0).set(d); return b; };
  const kitRaw = drumKit(sr, rc.style, r); const kit = {}; for (const k of Object.keys(kitRaw)) kit[k] = toBuf(kitRaw[k]);
  const noiseBuf = toBuf(noiseLoop(sr, 2, false, r));
  // buses & effects
  const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.2; comp.knee.value = 6;
  const master = c.createGain(); master.gain.value = 0.9;
  let tail = master;
  if (rc.style === 'lofi') { const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3800; master.connect(lp); tail = lp; }
  tail.connect(comp).connect(c.destination);
  const rev = c.createConvolver(); rev.buffer = makeImpulse(c, rc.style === 'ambient' ? 3.2 : rc.style === 'synthwave' ? 2.2 : 1.3, rc.style === 'ambient' ? 2.2 : 3.2);
  const revBus = c.createGain(); revBus.gain.value = rc.style === 'ambient' ? 0.7 : 0.35; revBus.connect(rev).connect(master);
  const dly = c.createDelay(2); dly.delayTime.value = beat * 0.75; const fb = c.createGain(); fb.gain.value = 0.38; const fbf = c.createBiquadFilter(); fbf.type = 'lowpass'; fbf.frequency.value = 2600;
  const dlyBus = c.createGain(); dlyBus.gain.value = 0.32; dlyBus.connect(dly); dly.connect(fbf).connect(fb).connect(dly); dly.connect(master);
  const drumBus = c.createGain(); drumBus.gain.value = 0.95; drumBus.connect(master);
  const snareBus = c.createGain(); snareBus.connect(drumBus); if (rc.style === 'synthwave') { const sv = c.createGain(); sv.gain.value = 0.5; snareBus.connect(sv).connect(revBus); }
  const pump = c.createGain(); pump.connect(master); // pads & bass duck on the kick (sidechain feel)
  const bus = (cut, q = 0.7, dest = master) => { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cut; f.Q.value = q; f.connect(dest); return f; };
  const bassBus = bus(rc.style === 'techno' ? 700 : rc.style === 'lofi' || rc.style === 'ambient' ? 1200 : 950, 3, pump);
  const padBus = bus(rc.style === 'ambient' ? 1100 : 1500, 0.7, pump); { const ps = c.createGain(); ps.gain.value = rc.style === 'ambient' ? 0.8 : 0.35; padBus.connect(ps).connect(revBus); }
  const leadBus = c.createGain(); leadBus.gain.value = 0.55; leadBus.connect(master); leadBus.connect(dlyBus); leadBus.connect(revBus);
  const leadF = bus(rc.style === 'dnb' ? 4200 : 3000, 1, leadBus); const arpF = bus(3200, 1, leadBus);
  const keysBus = c.createGain(); keysBus.connect(master); { const ks = c.createGain(); ks.gain.value = 0.3; keysBus.connect(ks).connect(revBus); }
  const subBus = c.createGain(); { const ws = c.createWaveShaper(); const curve = new Float32Array(1024); for (let i = 0; i < 1024; i++) curve[i] = Math.tanh((i / 512 - 1) * 2.4); ws.curve = curve; subBus.connect(ws).connect(master); }
  const vib = c.createOscillator(); vib.frequency.value = 5.5; const vibAmt = c.createGain(); vibAmt.gain.value = 14; vib.connect(vibAmt); vib.start(0);

  // instruments
  const env = (g, t, a, peak, d, sus, rel, end) => { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * sus), t + a + d); g.gain.setValueAtTime(Math.max(0.0001, peak * sus), end); g.gain.exponentialRampToValueAtTime(0.0001, end + rel); };
  const hit = (buf, t, v, dest = drumBus) => { const s2 = c.createBufferSource(); s2.buffer = buf; if (v === 1) s2.connect(dest); else { const g = c.createGain(); g.gain.value = v; s2.connect(g).connect(dest); } s2.start(t); };
  let lastPump = -1;
  function kick(t, v = 1) { hit(kit.kick, t, v); if (rc.style !== 'lofi' && rc.style !== 'trap' && t > lastPump) { lastPump = t; pump.gain.setValueAtTime(0.32, t); pump.gain.linearRampToValueAtTime(1, t + beat * 0.55); } }
  const snare = (t, v = 1) => hit(kit.snare, t, 0.75 * v, snareBus);
  const clap = (t, v = 1) => { hit(kit.clap, t, 0.6 * v); };
  const hat = (t, v = 1, open = false) => hit(open ? kit.ohat : kit.hat, t, (open ? 0.5 : 0.42) * v);
  function tone(t, midi, dur, { type = 'sawtooth', v = 0.3, a = 0.006, d = 0.12, sus = 0.6, rel = 0.08, dest = master, detune = 0, glideFrom = 0, vibr = 0 } = {}) {
    const o = c.createOscillator(); o.type = type; if (detune) o.detune.value = detune; const f = mtof(midi);
    if (glideFrom) { o.frequency.setValueAtTime(mtof(glideFrom), t); o.frequency.exponentialRampToValueAtTime(f, t + 0.06); } else o.frequency.value = f;
    if (vibr) vibAmt.connect(o.detune);
    const g = c.createGain(); env(g, t, a, v, d, sus, rel, t + dur); o.connect(g).connect(dest); o.start(t); o.stop(t + dur + rel + 0.05); return g;
  }
  function pad(t, notes, dur, v = 0.07) {
    const chip = rc.style === 'chiptune';
    for (const m of notes) { const g = c.createGain(); env(g, t, Math.min(0.6, dur * 0.3), chip ? v * 0.5 : v, 0.3, 0.85, Math.min(1.2, beat * 2), t + dur); g.connect(padBus); for (const dt of [-8, 8]) { const o = c.createOscillator(); o.type = chip ? 'square' : 'sawtooth'; o.frequency.value = mtof(m); o.detune.value = dt; o.connect(g); o.start(t); o.stop(t + dur + 1.3); } }
  }
  function epiano(t, midi, dur, v = 0.12) { tone(t, midi, dur, { type: 'sine', v, a: 0.004, d: 0.6, sus: 0.3, rel: 0.4, dest: keysBus }); tone(t, midi + 12, dur * 0.4, { type: 'sine', v: v * 0.25, a: 0.002, d: 0.15, sus: 0.1, rel: 0.2, dest: keysBus }); }
  function eight08(t, midi, dur, from) { tone(t, midi, Math.max(0.3, dur), { type: 'sine', v: 0.55, a: 0.01, d: Math.max(0.3, dur), sus: 0.01, rel: 0.05, dest: subBus, glideFrom: from || 0 }); }
  function riser(t, dur) { const s2 = c.createBufferSource(); s2.buffer = noiseBuf; s2.loop = true; const fl = c.createBiquadFilter(); fl.type = 'bandpass'; fl.Q.value = 2; fl.frequency.setValueAtTime(300, t); fl.frequency.exponentialRampToValueAtTime(9000, t + dur); const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.22, t + dur); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05); s2.connect(fl).connect(g); g.connect(master); g.connect(revBus); s2.start(t); s2.stop(t + dur + 0.1); }
  function impact(t) { kick(t, 1); const o = c.createOscillator(); o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(30, t + 1.4); const g2 = c.createGain(); g2.gain.setValueAtTime(0.5, t); g2.gain.exponentialRampToValueAtTime(0.0001, t + 1.6); o.connect(g2).connect(master); o.start(t); o.stop(t + 1.7); const s2 = c.createBufferSource(); s2.buffer = noiseBuf; const g3 = c.createGain(); g3.gain.setValueAtTime(0.25, t); g3.gain.exponentialRampToValueAtTime(0.0001, t + 1.5); s2.connect(g3).connect(revBus); s2.start(t); s2.stop(t + 1.6); }
  if (rc.style === 'lofi') { const cr = c.createBufferSource(); cr.buffer = toBuf(noiseLoop(sr, 5, true, r)); cr.loop = true; cr.connect(master); cr.start(0); cr.stop(total); }

  // harmony
  const scale = SCALES[st.scale]; const prog = PROGS[st.scale][Math.floor(r() * PROGS[st.scale].length)];
  const base = 48 + rc.root;
  const deg = (d, oct = 0) => { const n = scale.length; const o = Math.floor(d / n); return base + scale[((d % n) + n) % n] + 12 * (o + oct); };
  const chord = (d, sev = false) => [deg(d), deg(d + 2), deg(d + 4)].concat(sev ? [deg(d + 6)] : []);
  const motif = () => { const out = []; for (let i = 0; i < 32; i++) { if (r() < (rc.style === 'chiptune' ? 0.55 : 0.32) || i === 0) out.push({ s: i, d: [0, 2, 4, 1, 3, 5, 7][Math.floor(r() * 7)] + (r() < 0.2 ? 7 : 0), l: [1, 2, 2, 3, 4][Math.floor(r() * 5)] }); } return out; };
  const motA = motif(), motB = motif();
  const swing = rc.style === 'lofi' ? 0.16 : rc.style === 'house' ? 0.06 : 0;
  const at = (barStart, step) => barStart + step * six + (step % 2 ? swing * six * 2 : 0);

  const t0 = 0.05; let barIdx = 0;
  for (const sec of form) {
    const p = sec.p;
    for (let k = 0; k < sec.n; k++, barIdx++) {
      const bs = t0 + barIdx * bar; const ch = prog[barIdx % prog.length];
      const fill = k === sec.n - 1; const prob = (x) => (p[x] || 0) >= 1 || r() < (p[x] || 0);
      if (drums) {
        const kp = { synthwave: [0, 8], lofi: [0, 7, 10], house: [0, 4, 8, 12], techno: [0, 4, 8, 12], dnb: [0, 10], trap: [0, 11], chiptune: [0, 8] }[rc.style];
        const ks = kp.slice(); if (rc.style === 'dnb' && r() < 0.4) ks.push(6); ks.sort((x, y) => x - y);
        if (p.kick) for (const s2 of ks) kick(at(bs, s2), s2 === 0 ? 1 : s2 === 6 ? 0.7 : 0.85);
        const sp = rc.style === 'trap' ? [8] : [4, 12];
        if (p.snare) { for (const s2 of sp) snare(at(bs, s2)); if (fill) { snare(at(bs, 14), 0.6); snare(at(bs, 15), 0.8); } }
        if (p.clap && (rc.style === 'house' || rc.style === 'techno')) for (const s2 of [4, 12]) clap(at(bs, s2), 0.8);
        if (p.hat) {
          if (rc.style === 'house') for (const s2 of [2, 6, 10, 14]) hat(at(bs, s2), 1, true);
          const step = rc.style === 'techno' || rc.style === 'trap' || rc.style === 'dnb' ? 1 : 2;
          for (let s2 = 0; s2 < 16; s2 += step) if ((p.hat >= 1 || s2 % 4 === 2) && (rc.style !== 'house' || s2 % 4 !== 2)) hat(at(bs, s2), s2 % 4 === 0 ? 0.9 : 0.55);
          if (rc.style === 'trap' && barIdx % 4 === 3) for (let i = 0; i < 6; i++) hat(bs + 12 * six + i * six * 2 / 3, 0.6);
        }
      }
      const sev = rc.style === 'lofi' || rc.style === 'house';
      if (p.pad) { if (rc.style === 'lofi') { for (const m of chord(ch, true)) epiano(bs + (r() * 0.02), m + 12, bar * 0.9); epiano(at(bs, 10), chord(ch, true)[2] + 12, beat); } else pad(bs, chord(ch, sev).map((m) => m + 12), bar); }
      if (p.bass) {
        const root = deg(ch) - 12;
        if (rc.style === 'trap') { eight08(bs, root, bar * 0.48, r() < 0.5 ? root + 12 : 0); eight08(at(bs, 10), root + (r() < 0.3 ? 3 : 0), bar * 0.3); }
        else {
          const pat = { synthwave: [0, 2, 4, 6, 8, 10, 12, 14], house: [2, 6, 10, 14], techno: [2, 3, 6, 7, 10, 11, 14, 15], dnb: [0, 3, 10], lofi: [0, 7, 10], chiptune: [0, 2, 4, 6, 8, 10, 12, 14], ambient: [0] }[rc.style];
          for (const s2 of pat) {
            const oct = rc.style === 'synthwave' && s2 % 4 === 2 ? 12 : 0; const len = rc.style === 'ambient' ? bar : rc.style === 'dnb' ? six * 5 : six * 1.6;
            tone(at(bs, s2), root + oct, len, { type: rc.style === 'chiptune' ? 'triangle' : rc.style === 'lofi' || rc.style === 'ambient' ? 'sine' : 'sawtooth', v: rc.style === 'chiptune' ? 0.35 : 0.3, a: 0.004, d: 0.1, sus: 0.7, rel: 0.05, dest: bassBus });
          }
        }
      }
      if (p.arp && prob('arp') && rc.style !== 'lofi') {
        const notes = chord(ch).map((m) => m + 24); const div = rc.style === 'ambient' ? 4 : rc.style === 'chiptune' ? 1 : 2;
        for (let s2 = 0; s2 < 16; s2 += div) { const n = notes[(s2 / div) % notes.length] + (Math.floor(s2 / 8) % 2 ? 12 : 0); tone(at(bs, s2), n, six * div * 0.8, { type: rc.style === 'chiptune' ? 'square' : 'sawtooth', v: rc.style === 'chiptune' ? 0.06 : 0.07, a: 0.003, d: 0.08, sus: 0.3, rel: 0.06, dest: arpF }); }
      }
      if (p.lead && prob('lead')) {
        const mot = (Math.floor(barIdx / 2) % 4 === 3 ? motB : motA); const half = barIdx % 2;
        for (const nt of mot) {
          if ((nt.s >= 16) !== !!half) continue; const s2 = nt.s % 16;
          tone(at(bs, s2), deg(ch + nt.d, 1) + 12, six * nt.l, { type: rc.style === 'chiptune' ? 'square' : rc.style === 'ambient' ? 'triangle' : 'sawtooth', v: 0.12, a: 0.008, d: 0.2, sus: 0.6, rel: 0.15, dest: leadF, vibr: rc.style === 'chiptune' || rc.style === 'synthwave' ? 1 : 0, detune: rc.style === 'synthwave' ? 6 : 0 });
        }
      }
      if (p.pluck && prob('pluck')) for (let s2 = 0; s2 < 16; s2 += 4) if (r() < 0.6) epiano(at(bs, s2), deg(ch + [0, 2, 4, 7][Math.floor(r() * 4)], 1) + 12, beat * 1.5, 0.08);
      if (p.riser && k === 0) riser(bs, sec.n * bar);
      if (p.impact && k === 0) impact(bs);
    }
  }
  master.gain.setValueAtTime(0.9, t0 + bars * bar - bar * 2); master.gain.linearRampToValueAtTime(0.0001, t0 + bars * bar + 3);
  const poll = onProgress ? setInterval(() => { try { onProgress(Math.min(0.99, c.currentTime / total)); } catch {} }, 250) : null;
  let buffer; try { buffer = await c.startRendering(); } finally { clearInterval(poll); }
  onProgress && onProgress(1);
  return { buffer, bpm: rc.bpm, offset: t0, bars };
}

// 16-bit PCM WAV
export function toWav(buffer) {
  const ch = buffer.numberOfChannels, len = buffer.length, sr = buffer.sampleRate; const data = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) data.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); data.setUint32(4, 36 + len * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt '); data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, ch, true);
  data.setUint32(24, sr, true); data.setUint32(28, sr * ch * 2, true); data.setUint16(32, ch * 2, true); data.setUint16(34, 16, true); w(36, 'data'); data.setUint32(40, len * ch * 2, true);
  const chans = []; for (let c = 0; c < ch; c++) chans.push(buffer.getChannelData(c));
  let o = 44; for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) { const s = Math.max(-1, Math.min(1, chans[c][i])); data.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
  return new Blob([data], { type: 'audio/wav' });
}
export async function renderBlob(rc, onProgress) { const out = await render(rc, onProgress); return { blob: toWav(out.buffer), buffer: out.buffer, bpm: out.bpm, offset: out.offset }; }

// Square cover art painted from the recipe (deterministic)
export function coverFor(rc, size = 300) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d'); const r = rng(rc.seed ^ 0x51ed27); const S = size;
  const h0 = (STYLES[rc.style].hue + Math.floor(r() * 60) - 30 + 360) % 360; const h1 = (h0 + 40 + Math.floor(r() * 80)) % 360;
  const bg = g.createLinearGradient(0, 0, S, S); bg.addColorStop(0, `hsl(${h0},70%,${rc.style === 'lofi' ? 30 : 14}%)`); bg.addColorStop(1, `hsl(${h1},75%,${rc.style === 'lofi' ? 18 : 8}%)`); g.fillStyle = bg; g.fillRect(0, 0, S, S);
  const glow = (x, y, rad, col) => { const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, col); gr.addColorStop(1, 'transparent'); g.fillStyle = gr; g.fillRect(0, 0, S, S); };
  if (rc.style === 'synthwave' || rc.style === 'trap') {
    const sunY = S * 0.52; const sg = g.createLinearGradient(0, sunY - S * 0.3, 0, sunY + S * 0.1); sg.addColorStop(0, `hsl(${h1},95%,65%)`); sg.addColorStop(1, `hsl(${h0},95%,55%)`);
    g.save(); g.beginPath(); g.arc(S / 2, sunY, S * 0.26, Math.PI, 0); g.closePath(); g.clip(); g.fillStyle = sg; g.fillRect(0, 0, S, S); g.fillStyle = `hsl(${h0},70%,12%)`; for (let i = 0; i < 6; i++) g.fillRect(0, sunY - S * 0.02 - i * S * 0.035, S, 2 + i * 1.3); g.restore();
    g.strokeStyle = `hsla(${h1},100%,70%,.7)`; g.lineWidth = 1.2; g.beginPath(); for (let i = -10; i <= 10; i++) { g.moveTo(S / 2 + i * 6, sunY); g.lineTo(S / 2 + i * S * 0.12, S); } for (let j = 1; j < 9; j++) { const y = sunY + (S - sunY) * (j / 9) ** 2; g.moveTo(0, y); g.lineTo(S, y); } g.stroke();
  } else if (rc.style === 'lofi') {
    glow(S * 0.7, S * 0.3, S * 0.25, `hsla(${h1},90%,80%,.6)`); g.fillStyle = `hsla(${h1},80%,85%,.95)`; g.beginPath(); g.arc(S * 0.7, S * 0.3, S * 0.09, 0, 7); g.fill();
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(S * 0.12, S * 0.58, S * 0.76, S * 0.05); g.fillStyle = `hsla(${h0},40%,8%,.9)`; g.fillRect(0, S * 0.63, S, S);
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(255,255,255,${r() * 0.25})`; g.fillRect(r() * S, r() * S * 0.6, 1, 6 + r() * 10); }
  } else if (rc.style === 'chiptune') {
    const px = S / 12; for (let y = 0; y < 12; y++) for (let x = 0; x < 6; x++) if (r() < 0.5) { g.fillStyle = `hsl(${(h0 + y * 12) % 360},90%,60%)`; g.fillRect(x * px + S * 0.25, y * px, px, px); g.fillRect(S - (x + 1) * px - S * 0.25, y * px, px, px); }
  } else if (rc.style === 'ambient') {
    for (let i = 0; i < 5; i++) glow(r() * S, r() * S, S * (0.3 + r() * 0.4), `hsla(${(h0 + i * 30) % 360},80%,60%,.35)`);
    for (let i = 0; i < 70; i++) { g.fillStyle = `rgba(255,255,255,${r()})`; g.fillRect(r() * S, r() * S, 1.2, 1.2); }
  } else {
    for (let i = 9; i > 0; i--) { g.strokeStyle = `hsla(${(h0 + i * 14) % 360},90%,${45 + i * 3}%,.8)`; g.lineWidth = S * 0.012; g.beginPath(); if (rc.style === 'dnb') { for (let x = 0; x <= S; x += S / 14) g.lineTo(x, S / 2 + (r() - 0.5) * i * S * 0.07); } else g.arc(S / 2, S / 2, i * S * 0.05, 0, 7); g.stroke(); }
    glow(S / 2, S / 2, S * 0.4, `hsla(${h1},90%,60%,.35)`);
  }
  g.fillStyle = 'rgba(255,255,255,.85)'; g.font = `800 ${Math.round(S * 0.045)}px system-ui, sans-serif`; g.textAlign = 'left'; g.fillText('NEBULA SYNTH', S * 0.06, S * 0.94);
  return c.toDataURL('image/jpeg', 0.85);
}

// A library entry for a recipe (no audio stored: it is re-rendered on demand)
export function trackFor(rc) { return { id: 'gen-' + rc.style + '-' + rc.seed + '-' + rc.bpm + '-' + rc.root + '-' + rc.length, kind: 'gen', title: titleFor(rc), artist: 'Nebula Synth', album: STYLES[rc.style].name, genre: STYLES[rc.style].name, bpm: rc.bpm, recipe: rc, cover: coverFor(rc), duration: estDuration(rc) }; }
export function estDuration(rc) { const mult = { short: 0.5, normal: 1, long: 1.5 }[rc.length] || 1; const B = (n) => Math.max(2, Math.round(n * mult / 2) * 2); const bars = [8, 16, 16, 8, 16, 8].reduce((a, n) => a + B(n), 0); return bars * 4 * 60 / rc.bpm + 3.5; }
