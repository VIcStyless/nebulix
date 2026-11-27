// Nebulix imgkit loader: image kernels compiled from C++ (native/imgkit/imgkit.cpp) to WebAssembly, with the very same
// algorithms in JavaScript as a fallback (old browsers, blocked WASM) and as the reference the tests compare against.
// API (all in place on an ImageData): docEnhance(img, 'gray'|'bw'), sharpen(img, amount%), autoEnhance(img).
let ready = null;
const clamp8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

export const js = {
  docEnhance(img, mode = 'gray', pct = 12) {
    const d = img.data, w = img.width, h = img.height, n = w * h; const hist = new Uint32Array(256);
    for (let i = 0; i < n; i++) { const p = i * 4; const y = ((d[p] * 299 + d[p + 1] * 587 + d[p + 2] * 114) / 1000) | 0; d[p] = y; hist[y]++; }
    let lo = 0, hi = 255, acc = 0; while (lo < 255 && (acc += hist[lo]) < ((n * 0.02) >>> 0)) lo++; acc = 0; while (hi > 0 && (acc += hist[hi]) < ((n * 0.10) >>> 0)) hi--;
    const span = Math.max(1, hi - lo); const lut = new Uint8Array(256); for (let v = 0; v < 256; v++) lut[v] = clamp8(((v - lo) * 255 / span) | 0);
    for (let i = 0; i < n; i++) d[i * 4] = lut[d[i * 4]];
    if (mode === 'bw') {
      const W = w + 1; const I = new Uint32Array(W * (h + 1));
      for (let y = 1; y <= h; y++) { let row = 0; const base = (y - 1) * w * 4; for (let x = 1; x <= w; x++) { row += d[base + (x - 1) * 4]; I[y * W + x] = I[(y - 1) * W + x] + row; } }
      const s = Math.max(8, (w / 16) | 0), r = (s / 2) | 0;
      for (let y = 0; y < h; y++) { const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
        for (let x = 0; x < w; x++) { const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r); const cnt = (x1 - x0 + 1) * (y1 - y0 + 1);
          const sum = I[(y1 + 1) * W + x1 + 1] - I[y0 * W + x1 + 1] - I[(y1 + 1) * W + x0] + I[y0 * W + x0]; const p = (y * w + x) * 4;
          d[p] = d[p] * cnt * 100 <= sum * (100 - pct) ? 0 : 255; } }
    }
    for (let i = 0; i < n; i++) { const p = i * 4; d[p + 1] = d[p + 2] = d[p]; }
  },
  sharpen(img, amount = 80) {
    const d = img.data, w = img.width, h = img.height, st = w * 4; const t = new Uint8ClampedArray(d.length);
    for (let y = 0; y < h; y++) { const o = y * st; for (let x = 0; x < w; x++) { const xl = x ? x - 1 : 0, xr = x + 1 < w ? x + 1 : w - 1; for (let c = 0; c < 3; c++) t[o + x * 4 + c] = (d[o + xl * 4 + c] + 2 * d[o + x * 4 + c] + d[o + xr * 4 + c] + 2) >> 2; } }
    for (let y = 0; y < h; y++) { const up = (y ? y - 1 : 0) * st, mid = y * st, dn = (y + 1 < h ? y + 1 : h - 1) * st;
      for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) { const o = x * 4 + c; const b = (t[up + o] + 2 * t[mid + o] + t[dn + o] + 2) >> 2; const v = d[mid + o]; d[mid + o] = clamp8(v + Math.trunc(((v - b) * amount) / 100)); } }
  },
  autoEnhance(img) {
    const d = img.data, n = img.width * img.height; const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
    for (let i = 0; i < n; i++) { const p = i * 4; hist[0][d[p]]++; hist[1][d[p + 1]]++; hist[2][d[p + 2]]++; }
    const clip = (n * 0.005) >>> 0; const luts = hist.map((hh) => { let lo = 0, hi = 255, a = 0; while (lo < 255 && (a += hh[lo]) <= clip) lo++; a = 0; while (hi > 0 && (a += hh[hi]) <= clip) hi--;
      const lut = new Uint8Array(256); const span = hi - lo; for (let v = 0; v < 256; v++) lut[v] = span < 16 ? v : clamp8(((v - lo) * 255 / span) | 0); return lut; });
    for (let i = 0; i < n; i++) { const p = i * 4; d[p] = luts[0][d[p]]; d[p + 1] = luts[1][d[p + 1]]; d[p + 2] = luts[2][d[p + 2]]; }
  },
};

function wrap(inst) {
  const ex = inst.exports; const mem = () => new Uint8Array(ex.memory.buffer);
  const run = (img, extra, fn) => { ex.reset(); const len = img.data.length; const p = ex.alloc(len); const e = extra ? ex.alloc(extra) : 0; if (!p || (extra && !e)) throw new Error('imgkit: out of memory');
    mem().set(img.data, p); fn(p, e); img.data.set(new Uint8Array(ex.memory.buffer, p, len)); ex.reset(); };
  return {
    engine: 'wasm',
    docEnhance: (img, mode = 'gray', pct = 12) => run(img, mode === 'bw' ? (img.width + 1) * (img.height + 1) * 4 : 0, (p, e) => ex.doc_enhance(p, img.width, img.height, mode === 'bw' ? 1 : 0, e, pct)),
    sharpen: (img, amount = 80) => run(img, img.data.length, (p, e) => ex.sharpen(p, img.width, img.height, amount | 0, e)),
    autoEnhance: (img) => run(img, 0, (p) => ex.auto_enhance(p, img.width, img.height)),
  };
}
export function imgkit() {
  if (!ready) ready = (async () => {
    try { if (typeof WebAssembly !== 'object') throw new Error('no wasm');
      const res = await fetch(new URL('./imgkit.wasm', import.meta.url));
      const { instance } = WebAssembly.instantiateStreaming && /wasm/.test(res.headers.get('content-type') || '') ? await WebAssembly.instantiateStreaming(res, {}) : await WebAssembly.instantiate(await res.arrayBuffer(), {});
      return wrap(instance);
    } catch (e) { console.info('[imgkit] using the JavaScript version:', e.message); return Object.assign({ engine: 'js' }, js); }
  })();
  return ready;
}
