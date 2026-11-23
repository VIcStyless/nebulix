// Nerd Lab → Benchmarks: CPU (one core / all threads), memory, JavaScript, canvas particles and a WebGL shader ramp.
// Scores are relative: use them to compare your own machines, browsers and settings. Heavy loops run in Web Workers so the page stays responsive.
import { h, mount, ls, fmt, copyText } from '../util.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { toast } from '../ui.js';
import { api } from '../api.js';
import { card, stat, pill, progress, sleep, nextFrame, measureRefresh, round } from './common.js';

// Each job is self-contained: it is stringified into a Worker (and called directly if Workers are unavailable).
const JOBS = {
  cpu(ms) {
    const t0 = performance.now(); let x = 2463534242, acc = 0, n = 0;
    while (performance.now() - t0 < ms) { for (let i = 0; i < 20000; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; acc += Math.sqrt((x >>> 0) % 977 + 1) + Math.sin(i * 0.001); } n += 20000; }
    return { n, t: performance.now() - t0, acc };
  },
  mem(ms) {
    const N = 1 << 22; const a = new Float64Array(N), b = new Float64Array(N); for (let i = 0; i < N; i++) a[i] = i;
    const t0 = performance.now(); let bytes = 0, s = 0;
    while (performance.now() - t0 < ms) { b.set(a); for (let i = 0; i < N; i += 8) s += b[i]; bytes += N * 8 * 2; }
    return { n: bytes, t: performance.now() - t0, acc: s };
  },
  js(ms) {
    const t0 = performance.now(); let rounds = 0, acc = 0;
    while (performance.now() - t0 < ms) {
      const arr = Array.from({ length: 12000 }, (_, i) => ((i * 2654435761) >>> 0) % 100003); arr.sort((p, q) => p - q);
      const objs = []; for (let i = 0; i < 1500; i++) objs.push({ id: i, name: 'item' + i, tags: ['a', 'b', 'c'], v: i * 1.5 });
      const back = JSON.parse(JSON.stringify(objs)); acc += back.length + arr[100];
      acc += back.map((o) => o.name).join(',').replace(/item(\d+)/g, '$1').length; rounds++;
    }
    return { n: rounds, t: performance.now() - t0, acc };
  },
};
const WORKER_SRC = `const J={${Object.values(JOBS).map((f) => f.toString()).join(',')}};onmessage=(e)=>{const d=e.data;postMessage(Object.assign({name:d.name},J[d.name](d.ms)));};`;

const TIER = ['Entry', 'Solid', 'Fast', 'Beast']; const TIER_KIND = ['', '', 'ok', 'pro'];
const tierOf = (v, th) => (v < th[0] ? 0 : v < th[1] ? 1 : v < th[2] ? 2 : 3);

const frame = () => new Promise((resolve, reject) => {
  let done = false; const to = setTimeout(() => { if (!done) { done = true; reject(new Error(t('Keep this tab visible while the test runs.'))); } }, 800);
  requestAnimationFrame((now) => { if (done) return; done = true; clearTimeout(to); resolve(now); });
});

async function canvasStress(x) {
  const W = 640, H = 360, MAXP = 60000; const cv = h('canvas.nl-prev', { width: W, height: H }); x.stage(cv); const g = cv.getContext('2d');
  const hz = (await measureRefresh(450)).hz || 60;
  const px = new Float32Array(MAXP), py = new Float32Array(MAXP), vx = new Float32Array(MAXP), vy = new Float32Array(MAXP); let n = 0;
  const spawn = (k) => { for (let i = 0; i < k && n < MAXP; i++, n++) { px[n] = Math.random() * W; py[n] = Math.random() * H; const a = Math.random() * 6.283, s = 40 + Math.random() * 160; vx[n] = Math.cos(a) * s; vy[n] = Math.sin(a) * s; } };
  spawn(500); const COLS = ['#38bdf8', '#a78bfa', '#f472b6', '#fbbf24', '#34d399', '#fb7185'];
  let last = performance.now(), winStart = last, wf = 0, sustained = 0, bad = 0; const t0 = last;
  while (performance.now() - t0 < 7000 && !x.cancelled() && sustained < MAXP) {
    const now = await frame(); const dt = Math.min(0.05, (now - last) / 1000); last = now;
    g.fillStyle = 'rgba(8,6,24,.55)'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < n; i++) { let X = px[i] + vx[i] * dt, Y = py[i] + vy[i] * dt; if (X < 0 || X > W) { vx[i] = -vx[i]; X = X < 0 ? 0 : W; } if (Y < 0 || Y > H) { vy[i] = -vy[i]; Y = Y < 0 ? 0 : H; } px[i] = X; py[i] = Y; }
    for (let c = 0; c < 6; c++) { g.fillStyle = COLS[c]; g.beginPath(); for (let i = c; i < n; i += 6) { g.moveTo(px[i] + 2.2, py[i]); g.arc(px[i], py[i], 2.2, 0, 6.283); } g.fill(); }
    wf++; x.progress((now - t0) / 7000);
    if (now - winStart >= 400) {
      const fps = (wf * 1000) / (now - winStart); x.live(`${fmt.num(n)} · ${Math.round(fps)} FPS`);
      if (fps >= hz * 0.85) { sustained = n; bad = 0; spawn(Math.ceil(n * 0.35)); } else if (++bad >= 2) break;
      winStart = now; wf = 0;
    }
  }
  return sustained;
}

async function glStress(x) {
  const cv = h('canvas.nl-prev', { width: 640, height: 360 }); x.stage(cv);
  const gl = cv.getContext('webgl2') || cv.getContext('webgl'); if (!gl) throw new Error(t('WebGL is not available in this browser.'));
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader error'); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}'));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, 'precision mediump float;uniform vec2 res;uniform float time;uniform float iters;void main(){vec2 uv=(gl_FragCoord.xy/res*2.-1.)*vec2(res.x/res.y,1.)*1.4;vec2 z=uv;float acc=0.;for(int i=0;i<512;i++){if(float(i)>=iters)break;z=vec2(z.x*z.x-z.y*z.y,2.*z.x*z.y)+vec2(-.745+.03*sin(time),.113);acc+=exp(-length(z)*.5);}gl_FragColor=vec4(acc*.03,acc*.015+.1,acc*.05+.15,1.);}'));
  gl.linkProgram(prog); if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('shader link error'); gl.useProgram(prog);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.viewport(0, 0, 640, 360); gl.uniform2f(gl.getUniformLocation(prog, 'res'), 640, 360);
  const uIt = gl.getUniformLocation(prog, 'iters'), uTime = gl.getUniformLocation(prog, 'time'); const px = new Uint8Array(4);
  let pts = 0;
  for (let it = 8; it <= 512 && !x.cancelled(); it = Math.round(it * 1.5)) {
    gl.uniform1f(uIt, it); let tot = 0; const FR = 4;
    for (let f = 0; f <= FR; f++) { const t0 = performance.now(); gl.uniform1f(uTime, t0 / 1000); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); if (f) tot += performance.now() - t0; }
    const ms = tot / FR; x.live(`${it} ${t('loops')} · ${ms.toFixed(1)} ms`); x.progress(Math.log(it / 8) / Math.log(64));
    if (ms > 16.7) { pts = it * (16.7 / ms); break; }
    pts = it; await sleep(0);
  }
  const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
  return Math.round(pts * 10);
}

const TESTS = [
  { id: 'cpu1', name: 'CPU · one core', ic: 'cpu', unit: 'Mit/s', tiers: [70, 130, 210], dec: 0, sub: 'Single-thread speed — what most games care about', async run(x) { const r = await x.work('cpu', 1500, 1); return r[0].n / r[0].t / 1000; } },
  { id: 'cpuN', name: 'CPU · all threads', ic: 'cpu', unit: 'Mit/s', tiers: [250, 700, 1500], dec: 0, sub: 'Every thread at once', async run(x) { const n = Math.max(2, Math.min(32, navigator.hardwareConcurrency || 4)); const r = await x.work('cpu', 1500, n); x.note(t('{n} threads', { n })); return r.reduce((a, q) => a + q.n / q.t / 1000, 0); } },
  { id: 'mem', name: 'Memory', ic: 'layers', unit: 'GB/s', tiers: [10, 20, 35], dec: 1, sub: 'Copy bandwidth', async run(x) { const r = await x.work('mem', 1200, 1); return r[0].n / (r[0].t / 1000) / 1073741824; } },
  { id: 'js', name: 'JavaScript', ic: 'terminal', unit: 'rounds/s', tiers: [200, 380, 600], dec: 0, sub: 'Sorting, JSON and regex', async run(x) { const r = await x.work('js', 1500, 1); return r[0].n / (r[0].t / 1000); } },
  { id: 'c2d', name: 'Canvas 2D', ic: 'sliders', unit: 'objects', tiers: [4000, 15000, 40000], dec: 0, sub: 'Moving objects before FPS drops', run: canvasStress },
  { id: 'gpu', name: 'GPU shader', ic: 'monitor', unit: 'points', tiers: [300, 1000, 2500], dec: 0, sub: 'Shader load held at 60 FPS', run: glStress },
];

export default {
  mount(host) {
    let running = false, cancel = false, kill = null, alive = true;
    const saved = ls('nerd.bench') || { ts: 0, r: {} }; const best = ls('nerd.best') || {}; const results = Object.assign({}, saved.r);
    const bar = progress(); const status = h('div.small.muted', t('Ready. Close heavy tabs and keep this one in view while testing.')); const live = h('div.nl-live.mono', '');
    const stageBox = h('div.nl-stage'); const startBtn = h('button.btn.primary.lg', { onClick: () => start(TESTS) }); const stopBtn = h('button.btn.danger', { onClick: () => { cancel = true; if (kill) kill(); } }, icon('x', 16), t('Stop'));
    const tiles = {};

    function tileFor(test) {
      const st = stat(t(test.name), null, ' ' + test.unit); const tier = h('span'); const bestEl = h('div.tiny.muted'); const sub = h('div.tiny.muted', t(test.sub));
      const btn = h('button.btn.sm.ghost', { onClick: () => start([test]), 'aria-label': t('Run') + ' ' + t(test.name) }, icon('play', 14), t('Run')); const note = h('div.tiny.muted');
      const el = h('div.card.nl-tile', { dataset: { test: test.id } }, h('div.row', icon(test.ic, 18), h('b.grow', t(test.name)), btn), st, h('div.row', tier, bestEl), note, sub);
      const o = {
        el, btn, set(v) { st.set(v === null ? null : (test.dec ? v.toFixed(test.dec) : fmt.num(v)), ' ' + test.unit); mount(tier, v === null ? '' : pill(t(TIER[tierOf(v, test.tiers)]), TIER_KIND[tierOf(v, test.tiers)] || undefined)); if (best[test.id]) bestEl.textContent = t('Best: {v}', { v: test.dec ? best[test.id].toFixed(test.dec) : fmt.num(best[test.id]) }); },
        busy(b) { el.classList.toggle('busy', b); }, fail(m) { st.set(null); mount(tier, pill(t('Failed'), 'bad')); note.textContent = m; }, note(s) { note.textContent = s; },
      };
      o.set(results[test.id] === undefined ? null : results[test.id]); return o;
    }
    for (const tst of TESTS) tiles[tst.id] = tileFor(tst);

    function paintControls() {
      mount(startBtn, icon('bolt', 18), running ? t('Running…') : t('Run all tests')); startBtn.disabled = running; stopBtn.classList.toggle('hide', !running);
      for (const k in tiles) tiles[k].btn.disabled = running;
    }
    // Run `count` copies of a job in Web Workers (falls back to the main thread when Workers are blocked).
    function work(name, ms, count = 1) {
      return new Promise((resolve, reject) => {
        let url = null, ws = [], settled = false;
        const finish = (fn, v) => { if (settled) return; settled = true; kill = null; clearInterval(tick); ws.forEach((w) => w.terminate()); if (url) URL.revokeObjectURL(url); fn(v); };
        const t0 = performance.now(); const tick = setInterval(() => bar.set(base + Math.min(0.98, (performance.now() - t0) / (ms + 150)) * span), 90);
        kill = () => finish(reject, new Error('cancelled'));
        try { url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' })); } catch { url = null; }
        if (!url || typeof Worker === 'undefined') { setTimeout(() => { try { finish(resolve, [Object.assign({ name }, JOBS[name](ms))]); } catch (e) { finish(reject, e); } }, 30); return; }
        const out = []; let left = count;
        try {
          for (let i = 0; i < count; i++) {
            const w = new Worker(url); ws.push(w);
            w.onmessage = (e) => { out.push(e.data); if (--left === 0) finish(resolve, out); };
            w.onerror = (e) => { e.preventDefault && e.preventDefault(); finish(reject, new Error(e.message || t('A worker could not start.'))); };
            w.postMessage({ name, ms });
          }
        } catch (e) { finish(reject, e); }
      });
    }
    let base = 0, span = 1;

    async function start(list) {
      if (running) return; running = true; cancel = false; paintControls();
      for (let k = 0; k < list.length && alive && !cancel; k++) {
        const test = list[k]; const tile = tiles[test.id]; tile.busy(true); tile.note(''); base = k / list.length; span = 1 / list.length; bar.set(base);
        status.textContent = t(test.name) + '…'; live.textContent = '';
        const x = { work, stage: (el) => mount(stageBox, el), live: (s) => { live.textContent = s; }, progress: (p) => bar.set(base + Math.max(0, Math.min(1, p)) * span), cancelled: () => cancel, note: (s) => tile.note(s) };
        try {
          const v = await test.run(x); if (cancel || !alive) break;
          const val = round(v, test.dec); results[test.id] = val; if (!best[test.id] || val > best[test.id]) best[test.id] = val; tile.set(val);
          api.post('/api/progress/event', { type: 'bench' }, { quiet: true }).catch(() => {});
        } catch (e) { if (cancel || !alive) break; tile.fail(e.message); toast(e.message, 'err', 5000); }
        finally { tile.busy(false); mount(stageBox); live.textContent = ''; }
      }
      running = false; kill = null;
      if (alive) {
        bar.set(cancel ? 0 : 1); status.textContent = cancel ? t('Stopped.') : t('Done — scores are saved on this device.');
        ls('nerd.bench', { ts: Date.now(), r: results }); ls('nerd.best', best); for (const id in tiles) tiles[id].set(results[id] === undefined ? null : results[id]); paintControls();
      }
    }
    const summary = () => ['Nebulix benchmark — ' + new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC', ...TESTS.filter((q) => results[q.id] !== undefined).map((q) => `${q.name}: ${q.dec ? results[q.id].toFixed(q.dec) : fmt.num(results[q.id])} ${q.unit} (${TIER[tierOf(results[q.id], q.tiers)]})`)].join('\n');

    mount(host,
      h('div.card.nl-card', h('div.row.wrap', startBtn, stopBtn, h('button.btn', { onClick: () => { if (!Object.keys(results).length) return toast(t('Run a test first.'), 'err'); copyText(summary()).then(() => toast(t('Results copied'), 'good', 2000)); } }, icon('copy', 16), t('Copy results')),
        h('div.grow'), saved.ts ? h('span.tiny.muted', t('Last full save: {d}', { d: fmt.dt(saved.ts) })) : null), bar, h('div.row.between.wrap', status, live)),
      h('div.nl-tiles', TESTS.map((q) => tiles[q.id].el)), stageBox,
      h('p.tiny.muted', { style: 'margin-top:12px' }, t('Scores are relative and meant for comparing your own devices, browsers and settings — they are not official benchmarks. Mit/s = million loop iterations per second.')));
    paintControls();
    return () => { alive = false; cancel = true; if (kill) kill(); };
  },
};
