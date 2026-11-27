// Nebulix imgkit — image kernels in C++ compiled to WebAssembly (freestanding: no libc, no runtime).
// Used by Nebulix Scanner (document clean-up with an adaptive threshold) and Nebulix Photo (sharpen, auto-enhance).
// Every function works in place on RGBA bytes at `px` (width w, height h). public/js/native/imgkit.js has the same
// algorithms in JavaScript as a fallback and as the benchmark reference. Build: native/imgkit/build.sh
typedef unsigned char u8; typedef unsigned int u32; typedef int i32; typedef unsigned long size_t;

extern unsigned char __heap_base;
static size_t heap_top = 0;
static inline size_t page_count() { return __builtin_wasm_memory_size(0); }
extern "C" {
// bump allocator: the page asks for one big buffer per call and resets it afterwards
__attribute__((export_name("alloc"))) u8* alloc(size_t n) {
  if (!heap_top) heap_top = ((size_t)&__heap_base + 15) & ~(size_t)15;
  size_t p = heap_top; size_t end = p + ((n + 15) & ~(size_t)15);
  size_t have = page_count() * 65536; if (end > have) { if (__builtin_wasm_memory_grow(0, (end - have + 65535) / 65536) == (size_t)-1) return 0; }
  heap_top = end; return (u8*)p;
}
__attribute__((export_name("reset"))) void reset() { heap_top = 0; }

static inline u8 clamp8(i32 v) { return v < 0 ? 0 : v > 255 ? 255 : (u8)v; }

// Document mode: grayscale → automatic levels (2 % black, 10 % white) → optional adaptive threshold (Bradley/Roth:
// a pixel is ink if it is `pct` % darker than the mean of its (w/16)² neighbourhood, via an integral image).
// mode 0 = gray, 1 = black & white. `tmp` must hold (w+1)*(h+1) u32 for the integral image.
__attribute__((export_name("doc_enhance"))) void doc_enhance(u8* px, i32 w, i32 h, i32 mode, u32* integral, i32 pct) {
  const i32 n = w * h; u32 hist[256]; for (i32 i = 0; i < 256; i++) hist[i] = 0;
  for (i32 i = 0; i < n; i++) { u8* p = px + i * 4; u8 y = (u8)((p[0] * 299 + p[1] * 587 + p[2] * 114) / 1000); p[0] = y; hist[y]++; }
  i32 lo = 0, hi = 255; u32 acc = 0; while (lo < 255 && (acc += hist[lo]) < (u32)(n * 0.02)) lo++; acc = 0; while (hi > 0 && (acc += hist[hi]) < (u32)(n * 0.10)) hi--;
  i32 span = hi - lo; if (span < 1) span = 1; u8 lut[256]; for (i32 v = 0; v < 256; v++) lut[v] = clamp8((v - lo) * 255 / span);
  for (i32 i = 0; i < n; i++) px[i * 4] = lut[px[i * 4]];
  if (mode == 1) {
    const i32 W = w + 1;
    for (i32 x = 0; x <= w; x++) integral[x] = 0;
    for (i32 y = 1; y <= h; y++) { u32 row = 0; integral[y * W] = 0; const u8* src = px + (y - 1) * w * 4; for (i32 x = 1; x <= w; x++) { row += src[(x - 1) * 4]; integral[y * W + x] = integral[(y - 1) * W + x] + row; } }
    i32 s = w / 16; if (s < 8) s = 8; const i32 r = s / 2;
    for (i32 y = 0; y < h; y++) { i32 y0 = y - r < 0 ? 0 : y - r, y1 = y + r >= h ? h - 1 : y + r;
      for (i32 x = 0; x < w; x++) { i32 x0 = x - r < 0 ? 0 : x - r, x1 = x + r >= w ? w - 1 : x + r; u32 cnt = (u32)((x1 - x0 + 1) * (y1 - y0 + 1));
        u32 sum = integral[(y1 + 1) * W + x1 + 1] - integral[y0 * W + x1 + 1] - integral[(y1 + 1) * W + x0] + integral[y0 * W + x0];
        u8* p = px + (y * w + x) * 4; p[0] = (u32)p[0] * cnt * 100 <= sum * (u32)(100 - pct) ? 0 : 255; } }
  }
  for (i32 i = 0; i < n; i++) { u8* p = px + i * 4; p[1] = p[2] = p[0]; }
}

// Unsharp mask: out = px + amount × (px − blur3x3(px)), RGB only; `tmp` holds w*h*4 bytes for the blurred copy.
__attribute__((export_name("sharpen"))) void sharpen(u8* px, i32 w, i32 h, i32 amount, u8* tmp) {
  // separable [1 2 1]/4 blur: horizontal into tmp, then vertical while applying the mask
  for (i32 y = 0; y < h; y++) { const u8* row = px + y * w * 4; u8* out = tmp + y * w * 4;
    for (i32 x = 0; x < w; x++) { i32 xl = x ? x - 1 : 0, xr = x + 1 < w ? x + 1 : w - 1;
      for (i32 c = 0; c < 3; c++) out[x * 4 + c] = (u8)((row[xl * 4 + c] + 2 * row[x * 4 + c] + row[xr * 4 + c] + 2) >> 2); } }
  const i32 stride = w * 4;
  for (i32 y = 0; y < h; y++) { const u8* up = tmp + (y ? y - 1 : 0) * stride; const u8* mid = tmp + y * stride; const u8* dn = tmp + (y + 1 < h ? y + 1 : h - 1) * stride; u8* p = px + y * stride;
    for (i32 x = 0; x < w; x++) for (i32 c = 0; c < 3; c++) { i32 o = x * 4 + c; i32 b = (up[o] + 2 * mid[o] + dn[o] + 2) >> 2; i32 v = p[o]; p[o] = clamp8(v + ((v - b) * amount) / 100); } }

}

// Auto-enhance: per-channel levels with 0.5 % clipping (fixes colour casts and flat contrast).
__attribute__((export_name("auto_enhance"))) void auto_enhance(u8* px, i32 w, i32 h) {
  const i32 n = w * h; u32 hist[3][256]; for (i32 c = 0; c < 3; c++) for (i32 i = 0; i < 256; i++) hist[c][i] = 0;
  for (i32 i = 0; i < n; i++) { u8* p = px + i * 4; hist[0][p[0]]++; hist[1][p[1]]++; hist[2][p[2]]++; }
  u8 lut[3][256]; const u32 clip = (u32)(n * 0.005);
  for (i32 c = 0; c < 3; c++) { i32 lo = 0, hi = 255; u32 a = 0; while (lo < 255 && (a += hist[c][lo]) <= clip) lo++; a = 0; while (hi > 0 && (a += hist[c][hi]) <= clip) hi--;
    i32 span = hi - lo; if (span < 16) { for (i32 v = 0; v < 256; v++) lut[c][v] = (u8)v; continue; } for (i32 v = 0; v < 256; v++) lut[c][v] = clamp8((v - lo) * 255 / span); }
  for (i32 i = 0; i < n; i++) { u8* p = px + i * 4; p[0] = lut[0][p[0]]; p[1] = lut[1][p[1]]; p[2] = lut[2][p[2]]; }
}
}
