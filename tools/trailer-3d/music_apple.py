# Original soundtrack for the English Nebulix 3.0 trailer (58 s, 120 BPM). Synthesized with numpy only (no samples).
# Arc: soft piano intro (0–10) → groove enters at 10 → lift at 34 → breakdown for the ring montage 46–50 → resolve 50–58.
import numpy as np, wave, sys
SR = 48000; BEAT = 0.5; BAR = 2.0; DUR = 58.0; N = int(SR * DUR)
L = np.zeros(N); R = np.zeros(N); rng = np.random.default_rng(11)
t_ = lambda d: np.arange(int(SR * d)) / SR
NOTE = lambda n: 440 * 2 ** ((n - 69) / 12)
def add(sig, at, pan=0.0, g=1.0):
    i = int(at * SR); j = min(N, i + len(sig)); s = sig[: j - i] * g
    L[i:j] += s * np.cos((pan + 1) * np.pi / 4); R[i:j] += s * np.sin((pan + 1) * np.pi / 4)
def onepole(x, cut):
    a = np.exp(-2 * np.pi * cut / SR); y = np.empty_like(x); acc = 0.0
    for i in range(len(x)): acc = (1 - a) * x[i] + a * acc; y[i] = acc
    return y
def piano(n, d=2.2, vel=1.0):  # additive "felt piano": inharmonic partials, fast attack, two-stage decay
    t = t_(d); f = NOTE(n); s = np.zeros_like(t)
    for k, (amp, dec) in enumerate([(1, 2.2), (0.45, 3.0), (0.22, 4.0), (0.12, 5.5), (0.06, 7)]):
        fk = f * (k + 1) * (1 + 0.0004 * (k + 1) ** 2); s += amp * np.sin(2 * np.pi * fk * t) * np.exp(-t * dec)
    att = np.minimum(1, t / 0.004); return s * att * vel * 0.5
def pad(notes, d):
    t = t_(d); s = np.zeros_like(t)
    for n in notes:
        for det in (-0.006, 0.0, 0.006): s += np.sin(2 * np.pi * NOTE(n) * (1 + det) * t + 0.3 * np.sin(2 * np.pi * 0.2 * t))
    env = np.minimum(1, t / 0.8) * np.minimum(1, (d - t) / 0.8); return s / (3 * len(notes)) * env
# progression (D major-ish, airy): Dmaj9 – Bm7 – Gmaj7 – A6sus, one bar each
CH = [[50, 57, 62, 64, 69], [47, 54, 57, 62, 66], [43, 50, 54, 59, 62], [45, 52, 57, 59, 64]]
BASS = [38, 35, 31, 33]
bars = int(DUR / BAR)
for b in range(bars):
    t0 = b * BAR; ch = CH[b % 4]
    g = 0.0 if t0 >= 56 else (0.16 if t0 < 10 else 0.2) * (1 if t0 < 52 else max(0.0, 1 - (t0 - 52) / 4))
    if g: add(pad(ch[1:], BAR + 0.6), t0, -0.25, g); add(pad(ch[1:], BAR + 0.6), t0 + 0.01, 0.25, g)
# piano motif: arpeggiated, sparse in the intro, denser after the drop
MOTIF = [0, 2, 4, 3, 2, 4, 1, 3]
for b in range(bars):
    t0 = b * BAR; ch = CH[b % 4]
    if t0 >= 56: break
    steps = 4 if t0 < 10 or 46 <= t0 < 50 else 8
    for s in range(steps):
        at = t0 + s * (BAR / steps); n = ch[MOTIF[s % 8] % len(ch)] + 12
        vel = 0.9 if s == 0 else 0.6; add(piano(n, 2.4, vel), at, -0.3 + 0.6 * (s % 2), 0.22 if t0 < 10 else 0.16)
# closing chord + high bell
for n in [50, 57, 62, 66, 69, 74]: add(piano(n, 6.0, 0.9), 50.0, 0.0, 0.16)
add(piano(86, 4, 0.7), 52.0, 0.3, 0.12); add(piano(81, 4, 0.7), 53.0, -0.3, 0.12)
# sub bass from 10 s (not in the breakdown)
for b in range(int(10 / BAR), int(50 / BAR)):
    if 46 <= b * BAR < 50: continue
    t0 = b * BAR; f = NOTE(BASS[b % 4])
    for e in range(4):
        t = t_(BEAT * 0.95); s = np.sin(2 * np.pi * f * t) * np.minimum(1, t / 0.01) * np.exp(-t * 2.2)
        add(s, t0 + e * BEAT, 0, 0.32)
# drums: soft kick, clap, shaker
def kick(): t = t_(0.4); f = 45 + 80 * np.exp(-t * 40); return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 7)
def clap():
    t = t_(0.3); nz = rng.standard_normal(len(t)); hp = nz - onepole(nz, 900); env = np.zeros_like(t)
    for d in (0, 0.012, 0.024): env += np.exp(-np.maximum(0, t - d) * 60) * (t >= d)
    return hp * (env * 0.5 + np.exp(-t * 14) * 0.5) * 0.5
def shaker(): t = t_(0.06); nz = rng.standard_normal(len(t)); return (nz - onepole(nz, 6000)) * np.exp(-t * 60)
K, C, SH = kick(), clap(), shaker()
beat = 10.0
while beat < 50.0 - 1e-9:
    if 46 <= beat < 50: beat += BEAT; continue
    pos = round((beat - 10) / BEAT) % 4; add(K, beat, 0, 0.7)
    if pos in (1, 3): add(C, beat, 0.05, 0.45 if beat >= 34 else 0.35)
    add(SH, beat + BEAT / 2, 0.4, 0.10); 
    if beat >= 34: add(SH, beat + BEAT / 4, -0.4, 0.06); add(SH, beat + 3 * BEAT / 4, -0.4, 0.06)
    beat += BEAT
# swells into 10 s (drop), 46 s (montage) and 50 s (end card)
def swell(d):
    t = t_(d); nz = rng.standard_normal(len(t)); y = onepole(nz, 2500); return y * (t / d) ** 2.5
add(swell(2.0), 8.0, 0, 0.35); add(swell(2.0), 44.0, 0, 0.3); add(swell(1.5), 48.5, 0, 0.3)
def boom(): t = t_(2.5); f = 40 * np.exp(-t * 0.8); return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 1.8)
add(boom(), 10.0, 0, 0.6); add(boom(), 50.0, 0, 0.6); add(boom(), 2.0, 0, 0.35)
# room: short stereo echoes
def echo(x, ms, fb, mix):
    k = int(SR * ms / 1000); y = x.copy()
    for r in range(1, 6): y[k * r:] += x[: -k * r] * (fb ** r) * mix
    return y
L2, R2 = echo(L, 330, 0.5, 0.28), echo(R, 250, 0.5, 0.28)
fade = np.ones(N); fi = int(0.2 * SR); fo = int(2.5 * SR); fade[:fi] = np.linspace(0, 1, fi); fade[-fo:] = np.linspace(1, 0, fo); L2 *= fade; R2 *= fade
pk = max(np.abs(L2).max(), np.abs(R2).max()); L2 = np.tanh(L2 / pk * 1.2) * 0.9; R2 = np.tanh(R2 / pk * 1.2) * 0.9
with wave.open(sys.argv[1], 'wb') as w: w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((np.stack([L2, R2], 1) * 32767).astype('<i2').tobytes())
print('wrote', sys.argv[1])
