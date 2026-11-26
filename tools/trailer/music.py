# Original soundtrack for the Nebulix 3.0 trailer, synthesized from scratch (no samples, no third-party audio).
import numpy as np, wave, sys
SR = 48000; BPM = 120; BEAT = 60 / BPM; BAR = 4 * BEAT; DUR = 54.0
N = int(SR * DUR); L = np.zeros(N); R = np.zeros(N)
rng = np.random.default_rng(7)
def t_(d): return np.arange(int(SR * d)) / SR
def add(sig, start, pan=0.0, gain=1.0):
    i = int(start * SR); j = min(N, i + len(sig)); s = sig[: j - i] * gain
    L[i:j] += s * np.cos((pan + 1) * np.pi / 4); R[i:j] += s * np.sin((pan + 1) * np.pi / 4)
def env(n, a=0.01, r=0.2, total=None):
    e = np.ones(n); na = max(1, int(a * SR)); nr = max(1, int(r * SR)); e[:na] = np.linspace(0, 1, na); e[-nr:] *= np.linspace(1, 0, nr); return e
def saw(f, d, det=0.0):
    t = t_(d); out = 0
    for k in (-det, 0, det): out = out + 2 * ((t * f * (1 + k)) % 1) - 1
    return out / 3
def lowpass(x, cut):
    a = np.exp(-2 * np.pi * cut / SR); y = np.zeros_like(x); acc = 0.0
    for i in range(len(x)): acc = (1 - a) * x[i] + a * acc; y[i] = acc
    return y
def lp_fast(x, cut):  # two cascaded one-pole filters via lfilter-like cumulative approach
    from math import exp
    a = exp(-2 * np.pi * cut / SR); b = 1 - a
    import itertools
    y = np.empty_like(x); acc = 0.0
    for i, v in enumerate(x): acc = b * v + a * acc; y[i] = acc
    return y
NOTE = lambda n: 440 * 2 ** ((n - 69) / 12)
# Chords (A minor feel): Am – F – C – G, each one bar
PROG = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]
BASS = [45, 41, 36, 43]
# --- pads: whole piece, filter opens during the intro
for b in range(int(DUR / BAR)):
    t0 = b * BAR; ch = PROG[b % 4]; d = BAR + 0.3
    pad = sum(saw(NOTE(n), d, 0.004) for n in ch) / 3
    cut = 500 + 2500 * min(1, t0 / 8) if t0 < 46 else 900
    pad = lp_fast(pad, cut) * env(len(pad), 0.4, 0.5)
    g = 0.22 if t0 < 46 else 0.22 * max(0.0, 1 - (t0 - 46) / 8)
    add(pad, t0, -0.3, g); add(pad, t0 + 0.012, 0.3, g)
# --- riser 4..8 s (noise sweep)
d = 4.0; n = rng.standard_normal(int(SR * d)); tt = t_(d)
rs = np.zeros_like(n); acc = 0.0
for i, v in enumerate(n):
    a = np.exp(-2 * np.pi * (300 + 6000 * (tt[i] / d) ** 2) / SR); acc = (1 - a) * v + a * acc; rs[i] = acc
add(rs * (tt / d) ** 2, 4.0, 0, 0.5)
# --- impact on the drop (8 s) and at the end card (46 s)
def impact():
    d = 2.5; t = t_(d); f = 55 * np.exp(-t * 1.5); s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 2.2)
    s += lp_fast(rng.standard_normal(len(t)), 1200) * np.exp(-t * 6) * 0.6; return s
add(impact(), 8.0, 0, 0.9); add(impact(), 46.0, 0, 0.9); add(impact(), 2.0, 0, 0.5)
# --- drums from 8 s to 46 s
def kick():
    t = t_(0.35); f = 50 + 110 * np.exp(-t * 35); return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9)
def snare():
    t = t_(0.25); nz = rng.standard_normal(len(t)); return (nz - lp_fast(nz, 1500)) * np.exp(-t * 18) * 0.7 + np.sin(2 * np.pi * 190 * t) * np.exp(-t * 25) * 0.4
def hat(open_=False):
    t = t_(0.18 if open_ else 0.05); nz = rng.standard_normal(len(t)); return (nz - lp_fast(nz, 7000)) * np.exp(-t * (14 if open_ else 70))
K, Sn, H, HO = kick(), snare(), hat(), hat(True)
beat = 8.0
while beat < 46.0 - 1e-6:
    pos = round((beat - 8.0) / BEAT) % 4
    add(K, beat, 0, 0.9)
    if pos in (1, 3): add(Sn, beat, 0.05, 0.5)
    add(H, beat + BEAT / 2, 0.35, 0.18); add(H, beat, -0.35, 0.10)
    if pos == 3 and int((beat - 8.0) / BAR) % 2 == 1: add(HO, beat + BEAT / 2, 0.3, 0.12)
    beat += BEAT
# fill before the montage (40..42) – snare roll
for i in range(16): add(Sn, 40 + 1.5 + i * BEAT / 8, 0, 0.18 + 0.02 * i)
# --- bass (8..46): eighth notes, sidechain-ish envelope
for b in range(int(8 / BAR), int(46 / BAR)):
    t0 = b * BAR; f = NOTE(BASS[b % 4])
    for e in range(8):
        d = BEAT / 2; t = t_(d); s = np.sin(2 * np.pi * f * t) * 0.8 + saw(f, d) * 0.25
        add(s * env(len(t), 0.005, 0.05) * (0.6 + 0.4 * np.minimum(1, t / 0.12)), t0 + e * d, 0, 0.35)
# --- arpeggio lead (16..46): sixteenth notes through the chord
for b in range(int(16 / BAR), int(46 / BAR)):
    t0 = b * BAR; ch = PROG[b % 4] + [PROG[b % 4][0] + 12]
    for s16 in range(16):
        n = ch[[0, 1, 2, 3, 2, 1, 2, 3][s16 % 8]] + 12; d = BEAT / 4; t = t_(d * 1.5)
        tone = (np.sign(np.sin(2 * np.pi * NOTE(n) * t)) * 0.5 + np.sin(2 * np.pi * NOTE(n) * 2 * t) * 0.3) * np.exp(-t * 12)
        add(tone, t0 + s16 * d, 0.45 if s16 % 2 else -0.45, 0.07)
# --- intro bell motif (0..8) and outro (46..54)
for i, (n, st) in enumerate([(69, 0.5), (72, 1.0), (76, 1.5), (74, 2.5), (81, 3.0), (79, 4.0), (76, 5.0), (72, 6.0), (69, 46.5), (72, 47.0), (76, 47.5), (81, 48.5)]):
    t = t_(2.5); bell = (np.sin(2 * np.pi * NOTE(n) * t) + 0.4 * np.sin(2 * np.pi * NOTE(n) * 2.01 * t) + 0.15 * np.sin(2 * np.pi * NOTE(n) * 3.98 * t)) * np.exp(-t * 2.2)
    add(bell, st, (-0.4, 0.4)[i % 2], 0.13)
# --- simple stereo delay/reverb on the sum, master fade, normalise
def delay(x, ms, fb, mix):
    k = int(SR * ms / 1000); y = x.copy()
    for rep in range(1, 5): y[k * rep:] += x[: -k * rep] * (fb ** rep) * mix
    return y
L2 = delay(L, 375, 0.45, 0.35); R2 = delay(R, 250, 0.45, 0.35)
fade = np.ones(N); fi = int(0.3 * SR); fo = int(3.0 * SR); fade[:fi] = np.linspace(0, 1, fi); fade[-fo:] = np.linspace(1, 0, fo)
L2 *= fade; R2 *= fade
pk = max(np.abs(L2).max(), np.abs(R2).max()); L2 = np.tanh(L2 / pk * 1.3) * 0.89; R2 = np.tanh(R2 / pk * 1.3) * 0.89
out = (np.stack([L2, R2], 1) * 32767).astype('<i2')
with wave.open(sys.argv[1], 'wb') as w: w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(out.tobytes())
print('wrote', sys.argv[1], DUR, 's')
