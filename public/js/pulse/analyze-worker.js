// Pulse analysis worker: colour waveform (low / mid / high energy) + tempo (BPM) and first-beat offset.
// Input: { id, data: Float32Array (mono), sr }  →  Output: { id, fr, low, mid, high, peak, bpm, offset, confidence }
'use strict';
self.onmessage = (e) => {
  const { id, data, sr, knownBpm, knownOffset } = e.data;
  try { self.postMessage(Object.assign({ id }, analyze(data, sr, knownBpm, knownOffset))); }
  catch (err) { self.postMessage({ id, error: String(err && err.message || err) }); }
};

function analyze(x, sr, knownBpm, knownOffset) {
  const fr = 150; const hop = Math.max(1, Math.round(sr / fr)); const n = Math.floor(x.length / hop);
  const low = new Float32Array(n), mid = new Float32Array(n), high = new Float32Array(n), peak = new Float32Array(n);
  // one-pole filters: low < ~200 Hz, high > ~2.5 kHz, mid = rest
  const aL = Math.exp(-2 * Math.PI * 200 / sr), aH = Math.exp(-2 * Math.PI * 2500 / sr);
  let lp = 0, lp2 = 0, i = 0;
  for (let f = 0; f < n; f++) {
    let sl = 0, sm = 0, sh = 0, pk = 0;
    for (let k = 0; k < hop; k++, i++) {
      const s = x[i]; lp = (1 - aL) * s + aL * lp; lp2 = (1 - aH) * s + aH * lp2;
      const hi = s - lp2; const md = lp2 - lp;
      sl += lp * lp; sm += md * md; sh += hi * hi; const a = s < 0 ? -s : s; if (a > pk) pk = a;
    }
    low[f] = Math.sqrt(sl / hop); mid[f] = Math.sqrt(sm / hop); high[f] = Math.sqrt(sh / hop); peak[f] = pk;
  }
  // normalise for display
  const norm = (a, q) => { const s = Array.from(a).sort((p, r) => p - r); const ref = s[Math.floor(s.length * q)] || 1e-6; for (let k = 0; k < a.length; k++) a[k] = Math.min(1, a[k] / ref); };
  if (n > 10) { norm(low, 0.985); norm(mid, 0.985); norm(high, 0.985); norm(peak, 0.995); }

  if (knownBpm) return { fr, low, mid, high, peak, bpm: knownBpm, offset: knownOffset || 0, confidence: 1 };
  // onset envelope: positive flux of log energy (kick-weighted)
  const env = new Float32Array(n); let prev = 0;
  for (let f = 0; f < n; f++) { const e2 = Math.log(1e-4 + low[f] * 1.4 + mid[f] * 0.6 + high[f] * 0.3); const d = e2 - prev; prev = e2; env[f] = d > 0 ? d : 0; }
  // remove local mean
  const W = 30; let acc = 0; const sm = new Float32Array(n);
  for (let f = 0; f < n; f++) { acc += env[f]; if (f >= W) acc -= env[f - W]; sm[f] = env[f] - acc / Math.min(f + 1, W); if (sm[f] < 0) sm[f] = 0; }
  // autocorrelation for 60..200 BPM
  const minLag = Math.floor(fr * 60 / 200), maxLag = Math.ceil(fr * 60 / 60); const ac = new Float32Array(maxLag + 2);
  const start = Math.floor(n * 0.05), end = Math.floor(n * 0.95);
  for (let L = minLag; L <= maxLag + 1; L++) { let s = 0; for (let f = start; f + L < end; f++) s += sm[f] * sm[f + L]; ac[L] = s; }
  let best = -1, bestL = minLag;
  for (let L = minLag; L <= maxLag; L++) {
    const bpm = 60 * fr / L; const w = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 122) / 0.9, 2)); // prefer the 85-170 range
    const score = (ac[L] + 0.5 * (ac[L * 2] || 0) + 0.25 * (ac[Math.round(L / 2)] || 0)) * w;
    if (score > best) { best = score; bestL = L; }
  }
  // parabolic refinement
  const y0 = ac[bestL - 1] || 0, y1 = ac[bestL], y2 = ac[bestL + 1] || 0; const den = y0 - 2 * y1 + y2; const shift = den ? 0.5 * (y0 - y2) / den : 0;
  const lag = bestL + Math.max(-0.5, Math.min(0.5, shift)); let bpm = 60 * fr / lag;
  while (bpm < 78) bpm *= 2; while (bpm > 185) bpm /= 2;
  bpm = Math.round(bpm * 10) / 10; if (Math.abs(bpm - Math.round(bpm)) < 0.15) bpm = Math.round(bpm);
  // phase: offset maximising onset energy on the beat grid
  const P = fr * 60 / bpm; let bo = 0, bs = -1;
  for (let ph = 0; ph < P; ph += 0.5) { let s = 0; for (let t = ph; t < n; t += P) { const k = Math.floor(t), fk = t - k; s += (sm[k] || 0) * (1 - fk) + (sm[k + 1] || 0) * fk; } if (s > bs) { bs = s; bo = ph; } }
  const mean = ac.slice(minLag, maxLag).reduce((a, b) => a + b, 0) / Math.max(1, maxLag - minLag);
  return { fr, low, mid, high, peak, bpm, offset: bo / fr, confidence: Math.max(0, Math.min(1, (ac[bestL] / (mean || 1) - 1) / 3)) };
}
