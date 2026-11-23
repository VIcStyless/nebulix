// DJ deck playback in an AudioWorklet: variable (also negative) speed for scratching, motor start/stop,
// sample-accurate loops and instant cue jumps. Position is reported back ~30×/s.
class NbxDeck extends AudioWorkletProcessor {
  constructor() {
    super();
    this.L = null; this.R = null; this.len = 0; this.srcRate = sampleRate; this.pos = 0;
    this.playing = false; this.pitch = 1; this.motor = 0; this.motorK = 0.00016; // motor inertia per sample (vinyl start/stop feel)
    this.scratch = null; this.loop = null; this.n = 0; this.ended = false; this.bend = 0; this.brake = 0;
    this.port.onmessage = (e) => this.msg(e.data);
  }
  msg(m) {
    switch (m.t) {
      case 'load': this.L = m.L; this.R = m.R || m.L; this.len = this.L.length; this.srcRate = m.sr || sampleRate; this.pos = 0; this.playing = false; this.motor = 0; this.loop = null; this.ended = false; break;
      case 'unload': this.L = this.R = null; this.len = 0; this.playing = false; break;
      case 'play': this.playing = true; this.ended = false; this.brake = 0; if (m.instant) this.motor = 1; break;
      case 'pause': this.playing = false; if (m.instant) this.motor = 0; break;
      case 'seek': this.pos = Math.max(0, Math.min(this.len - 1, m.sec * this.srcRate)); this.ended = false; break;
      case 'pitch': this.pitch = m.v; break;
      case 'bend': this.bend = m.v; break;
      case 'motor': this.motorK = m.v; break;
      case 'brake': this.brake = m.v; break; // seconds to stop (vinyl brake) — 0 cancels
      case 'scratch': this.scratch = m.on ? (m.rate || 0) : null; break;
      case 'loop': this.loop = m.on ? { a: m.a * this.srcRate, b: m.b * this.srcRate } : null; break;
    }
  }
  process(_in, outputs) {
    const out = outputs[0]; const oL = out[0]; const oR = out[1] || out[0]; const N = oL.length;
    if (!this.L) { oL.fill(0); if (oR !== oL) oR.fill(0); return true; }
    const L = this.L, R = this.R, len = this.len; const step = this.srcRate / sampleRate;
    let rate = 0;
    for (let i = 0; i < N; i++) {
      if (this.scratch !== null) { this.motor += (this.scratch - this.motor) * 0.02; rate = this.motor; }
      else if (this.brake > 0 && this.playing) { this.motor -= 1 / (this.brake * sampleRate); if (this.motor <= 0) { this.motor = 0; this.playing = false; this.brake = 0; } rate = this.motor * this.pitch; }
      else { this.motor += ((this.playing ? 1 : 0) - this.motor) * this.motorK; rate = this.motor * (this.pitch + this.bend); }
      const p = this.pos; const i0 = Math.floor(p); const f = p - i0;
      if (i0 >= 0 && i0 < len - 1) { oL[i] = L[i0] + (L[i0 + 1] - L[i0]) * f; oR[i] = R[i0] + (R[i0 + 1] - R[i0]) * f; } else { oL[i] = 0; oR[i] = 0; }
      this.pos += rate * step;
      if (this.loop && rate > 0 && this.pos >= this.loop.b) this.pos -= (this.loop.b - this.loop.a);
      if (this.pos < 0) this.pos = 0;
      if (this.pos >= len - 1) { this.pos = len - 1; if (this.playing) { this.playing = false; this.motor = 0; if (!this.ended) { this.ended = true; this.port.postMessage({ t: 'end' }); } } }
    }
    if (++this.n % 11 === 0) this.port.postMessage({ t: 'pos', pos: this.pos / this.srcRate, rate, playing: this.playing });
    return true;
  }
}
registerProcessor('nbx-deck', NbxDeck);
