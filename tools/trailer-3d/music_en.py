# Original soundtrack for the Nebulix 3.0 trailer, "edit" cut (48 s, 150 BPM, F# minor). Synthesized with numpy only:
# no samples, no loops from anywhere. Phonk/trap style: distorted 808 slides, a cowbell lead, hard kick and clap,
# hi-hat rolls, risers, a beat of silence before each drop and big impacts.
# Usage: python3 music_en.py music.wav hits.js   (hits.js = the exact hit times, so the video punches on the beat)
import numpy as np, wave, sys, json

SR = 44100; BPM = 150; B = 60 / BPM; S16 = B / 4; BAR = 4 * B; DUR = 48.0; N = int(SR * DUR)
rng = np.random.default_rng(7)
BUS = {k: [np.zeros(N), np.zeros(N)] for k in ('main', 'pad', 'cow', 'fx')}
HITS = {'kick': [], 'snare': [], 'impact': [], 'blip': [], 'roll': []}

def T(d): return np.arange(int(SR * d)) / SR
def NOTE(n): return 440 * 2 ** ((n - 69) / 12)
def add(sig, at, pan=0.0, g=1.0, bus='main'):
    i = int(round(at * SR))
    if i >= N or i < 0: return
    j = min(N, i + len(sig)); s = sig[: j - i] * g; a = np.cos((pan + 1) * np.pi / 4); b = np.sin((pan + 1) * np.pi / 4)
    BUS[bus][0][i:j] += s * a; BUS[bus][1][i:j] += s * b
def band(x, lo=None, hi=None, order=8):
    X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR); m = np.ones_like(f)
    if hi: m /= np.sqrt(1 + (f / hi) ** order)
    if lo: m /= np.sqrt(1 + (lo / np.maximum(f, 1e-3)) ** order)
    return np.fft.irfft(X * m, len(x))
noise = lambda d: rng.standard_normal(int(SR * d))

# ---------------- instruments ----------------
def kick(hard=1.0):
    t = T(0.5); f = 46 + 280 * np.exp(-t * 40) + 30 * np.exp(-t * 7)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 5)
    click = band(noise(0.5), 2500) * np.exp(-t * 320) * 0.5
    return np.tanh((s + click) * 2.6 * hard) * 0.95
def snare(g=1.0):
    t = T(0.4)
    body = np.sin(2 * np.pi * 190 * t) * np.exp(-t * 26) * 0.8 + np.sin(2 * np.pi * 340 * t) * np.exp(-t * 38) * 0.3
    nz = band(noise(0.4), 1400, 10000) * np.exp(-t * 15)
    env = sum(np.exp(-np.maximum(0, t - d) * 75) * (t >= d) for d in (0, 0.010, 0.021, 0.033))
    clap = band(noise(0.4), 900, 5200) * env * 0.7
    return np.tanh((body + nz * 0.9 + clap) * 1.8) * 0.8 * g
def hat(open_=False):
    d = 0.4 if open_ else 0.06; t = T(d)
    return band(noise(d), 7500) * np.exp(-t * (8 if open_ else 85)) * 0.5
def sq(f, t, top=12000):  # band-limited square
    s = np.zeros_like(t); k = 1
    while f * k < top: s += np.sin(2 * np.pi * f * k * t) / k; k += 2
    return s
def cowbell(n, d=0.42):  # the classic two-square cowbell (ratio 1.48), pitched to play a melody
    t = T(d); f1 = NOTE(n); f2 = f1 * 1.4815
    s = band(sq(f1, t) + sq(f2, t), f1 * 0.75, f2 * 3.2, 4)
    return s * (0.6 * np.exp(-t * 55) + 0.4 * np.exp(-t * 7.5)) * 0.55
def b808(n, d, prev=None, drive=2.6):
    t = T(d); f0 = NOTE(n)
    f = f0 + (NOTE(prev) - f0) * np.exp(-t / 0.05) if prev is not None else f0 + 110 * np.exp(-t * 45)
    ph = 2 * np.pi * np.cumsum(f) / SR; s = np.sin(ph) + 0.18 * np.sin(2 * ph)
    env = np.minimum(1, t / 0.003) * np.exp(-t * 0.6) * np.clip((d - t) / 0.025, 0, 1)
    return np.tanh(s * env * drive) * 0.72
def saw(f, t, top):
    s = np.zeros_like(t); k = 1
    while f * k < top: s += np.sin(2 * np.pi * f * k * t) / k; k += 1
    return s
def pad(notes, d, top=2600):
    t = T(d); s = np.zeros_like(t)
    for n in notes:
        for det in (-0.008, 0, 0.008): s += saw(NOTE(n) * (1 + det), t, top)
    return s / (3 * len(notes)) * np.minimum(1, t / 0.2) * np.clip((d - t) / 0.3, 0, 1) * 0.55
def riser(d):  # noise that opens up + a rising tone
    t = T(d); out = np.zeros_like(t); nb = 14
    for b in range(nb):
        lo = 300 * 2 ** (b * 0.45); w = np.clip((t / d) * nb - b + 1, 0, 1) * np.clip(b + 2 - (t / d) * nb, 0, 1)
        out += band(noise(d), lo, lo * 2.2) * w
    tone = np.sin(2 * np.pi * np.cumsum(200 * 2 ** (3 * t / d)) / SR) * 0.25
    return (out * 0.6 + tone) * (t / d) ** 2
def revcym(d):
    t = T(d); return band(noise(d), 4000) * (t / d) ** 3 * 0.8
def impact():
    t = T(3.0); f = 70 * np.exp(-t * 1.2) + 28
    boom = np.tanh(np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 1.3) * 3) * 0.9
    crash = band(noise(3.0), 3000) * np.exp(-t * 2.2) * 0.35
    k = kick(1.3); return boom + crash + np.pad(k, (0, len(t) - len(k)))
def blip(n):
    t = T(0.09); return sq(NOTE(n), t, 6000) * np.exp(-t * 40) * 0.25
def crackle(d):
    x = np.zeros(int(SR * d)); idx = rng.integers(0, len(x), int(d * 40)); x[idx] = rng.uniform(-1, 1, len(idx))
    return band(x, 1500, 9000, 4) * 2 + band(noise(d), 200, 3000, 4) * 0.01

# ---------------- music ----------------
CH = [[54, 57, 61, 66], [50, 54, 57, 62], [52, 56, 59, 64], [49, 53, 56, 61]]  # F#m – D – E – C#
ROOT = [30, 38, 40, 37]
RIFF = [(0, 78), (3, 78), (6, 76), (8, 73), (11, 73), (14, 74), (16, 78), (19, 78), (22, 81), (24, 80), (27, 76), (30, 73)]

def drop(t0, bars, intense=False, first_bar_index=0):
    prev = None
    for b in range(bars):
        bt = t0 + b * BAR; ci = (first_bar_index + b) % 4; r = ROOT[ci]
        final = intense and b == bars - 1
        add(pad(CH[ci], BAR + 0.05), bt, 0, 0.5, 'pad')
        # 808 + kick
        pat = [(0, r, 6), (7, r, 3), (10, r + 12, 3), (13, r, 3)]
        for st, n, ln in pat:
            add(b808(n, ln * S16, prev, 3.4 if intense else 2.6), bt + st * S16, 0, 0.9); prev = n
        kicks = range(0, 16, 4) if final else (0, 7, 10)
        for st in kicks: add(kick(), bt + st * S16, 0, 0.85); HITS['kick'].append(round(bt + st * S16, 4))
        for st in (4, 12): add(snare(), bt + st * S16, 0.05, 0.75); HITS['snare'].append(round(bt + st * S16, 4))
        # hats: 8ths, 16ths when intense, rolls on the last beat of every 2nd bar
        step = 1 if intense else 2
        for st in range(0, 16, step):
            if b % 2 == 1 and st >= 12: continue
            add(hat(), bt + st * S16, 0.35 if st % 4 else -0.2, 0.33 if st % 2 == 0 else 0.22)
        if b % 2 == 1:
            n = 12 if final else 6
            for k in range(n): add(hat(), bt + 12 * S16 + k * (B / n), 0.3, 0.2 + 0.03 * k)
        if b % 2 == 0: add(hat(True), bt + 14 * S16, -0.3, 0.18)
        # cowbell lead (+ octave layer in the second drop)
        for st, n in RIFF:
            if (b % 2) * 16 <= st < (b % 2) * 16 + 16:
                at = bt + (st - (b % 2) * 16) * S16
                add(cowbell(n), at, -0.15, 0.55, 'cow')
                if intense: add(cowbell(n + 12, 0.25), at, 0.25, 0.18, 'cow')

def roll(a, b, g0=0.15, g1=0.6):  # accelerating snare roll: 8ths → 16ths → 32nds
    t = a
    while t < b - 1e-6:
        k = (t - a) / (b - a); add(snare(), t, 0, g0 + (g1 - g0) * k); HITS['roll'].append(round(t, 4))
        t += B / 2 if k < 1 / 3 else B / 4 if k < 2 / 3 else B / 8

def hit(at, g=1.0):
    add(impact(), at, 0, 0.9 * g); HITS['impact'].append(at)

# 0 – 6.4: intro (title glitch, words on the beat, build, one beat of silence)
add(crackle(6.0), 0, 0, 0.5, 'fx')
for b in range(2): add(pad(CH[b], BAR + 0.05, 1200), b * BAR, 0, 0.45, 'pad')
add(pad(CH[2], BAR * 2 - 0.4, 1600), 2 * BAR, 0, 0.5, 'pad')
for b in range(4):
    for st, n in RIFF:
        if (b % 2) * 16 <= st < (b % 2) * 16 + 16:
            at = b * BAR + (st - (b % 2) * 16) * S16
            if at < 6.0: add(band(cowbell(n), None, 900 + 500 * b), at, -0.1, 0.35, 'cow')
for i in range(7): add(blip([78, 81, 85, 83, 78, 90, 85][i]), 0.4 + i * S16 * 1.0, (-0.6 + 0.2 * i), 1.0); HITS['blip'].append(round(0.4 + i * S16, 4))
hit(1.6, 0.6)
for k in range(7): add(kick(0.9), 3.2 + k * B, 0, 0.75); HITS['kick'].append(round(3.2 + k * B, 4))
add(riser(2.8), 3.2, 0, 0.5, 'fx'); roll(4.8, 6.0)
add(revcym(0.8), 5.6, 0, 0.5, 'fx')

# 6.4 – 32.0: drop 1 (16 bars)
hit(6.4); drop(6.4, 16)
# 32.0 – 35.2: breakdown (ring montage), build, silence
for b in range(2):
    add(pad(CH[b], BAR + 0.05, 2000), 32.0 + b * BAR, 0, 0.6, 'pad')
    for st, n in RIFF:
        if (b % 2) * 16 <= st < (b % 2) * 16 + 16:
            at = 32.0 + b * BAR + (st - (b % 2) * 16) * S16
            if at < 34.8: add(band(cowbell(n), None, 1400), at, 0, 0.45, 'cow')
add(b808(30, 1.6), 32.0, 0, 0.7); add(b808(38, 1.2, 30), 33.6, 0, 0.6)
for at in (32.0, 32.8, 33.6): add(kick(1.1), at, 0, 0.8); HITS['kick'].append(at)
add(riser(1.2), 33.6, 0, 0.55, 'fx'); roll(33.6, 34.8, 0.2, 0.7); add(revcym(0.4), 34.8, 0, 0.6, 'fx')
# 35.2 – 41.6: drop 2 (4 bars, harder)
hit(35.2); drop(35.2, 4, intense=True)
# 41.6 – 48: final impact and tail
hit(41.6, 1.2)
add(b808(30, 6.4, 42, 3.0), 41.6, 0, 0.8)
add(pad(CH[0], 5.5, 2200), 41.6, 0, 0.6, 'pad')
for i, n in enumerate([78, 73, 78 + 12]): add(cowbell(n, 0.8), 41.6 + i * B * 2, (-0.3, 0.3, 0)[i], 0.5, 'cow')

# ---------------- mix ----------------
t = np.arange(N) / SR
duck = np.ones(N)  # sidechain: pads dip on every kick
for k in HITS['kick'] + HITS['impact']:
    i = int(k * SR); j = min(N, i + int(0.35 * SR)); tt = np.arange(j - i) / SR; duck[i:j] = np.minimum(duck[i:j], 1 - 0.75 * np.exp(-tt * 9))
def echo(x, sec, fb, mix, n=5):
    k = int(SR * sec); y = x.copy()
    for r in range(1, n + 1): y[k * r:] += x[: -k * r] * (fb ** r) * mix
    return y
cowL = echo(BUS['cow'][0], 3 * S16, 0.45, 0.35); cowR = echo(BUS['cow'][1], 2 * S16, 0.45, 0.35)
mixL = BUS['main'][0] + BUS['pad'][0] * duck + cowL + echo(BUS['fx'][0], B, 0.3, 0.2)
mixR = BUS['main'][1] + BUS['pad'][1] * duck + cowR + echo(BUS['fx'][1], B * 0.75, 0.3, 0.2)
gap = np.ones(N)  # true silence in the two pre-drop gaps (except the reverse cymbal on the fx bus)
for a, b_ in ((6.0, 6.4), (34.8, 35.2)):
    i, j = int(a * SR), int(b_ * SR); gap[i:j] = 0.0
mixL = mixL * gap + echo(BUS['fx'][0], B, 0.3, 0.2) * (1 - gap); mixR = mixR * gap + echo(BUS['fx'][1], B * 0.75, 0.3, 0.2) * (1 - gap)
fo = int(2.0 * SR); fade = np.ones(N); fade[-fo:] = np.linspace(1, 0, fo) ** 2; fade[: int(0.05 * SR)] = np.linspace(0, 1, int(0.05 * SR))
mixL *= fade; mixR *= fade
pk = max(np.abs(mixL).max(), np.abs(mixR).max()); mixL = np.tanh(mixL / pk * 1.8) / np.tanh(1.8) * 0.93; mixR = np.tanh(mixR / pk * 1.8) / np.tanh(1.8) * 0.93
with wave.open(sys.argv[1], 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((np.stack([mixL, mixR], 1) * 32767).astype('<i2').tobytes())
for k in HITS: HITS[k] = sorted(set(HITS[k]))
if len(sys.argv) > 2: open(sys.argv[2], 'w').write('const HITS = ' + json.dumps(HITS) + ';')
print('wrote', sys.argv[1], {k: len(v) for k, v in HITS.items()})
