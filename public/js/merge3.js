// Nebulix 3.0 — three-way merge used by live co-editing (Docs paragraphs, Sheets cells, Slides). The server runs this
// very file (the part between the markers, in an isolated vm — see server/merge.js), so both sides merge identically.
//   mergeTokens(base, a, b) → merged token list, or null when a and b changed the same spot differently
//   mergeHtml(base, a, b)   → HTML string or null   (tags and entities are single tokens, text is per character)
//   mergeJson(base, a, b)   → value: objects key by key, arrays of {id} items by id, strings per character,
//                             anything else: whoever changed it (b when both did)
// ---- merge:begin ----
const MAX_CELLS = 2500000;
function lcsPairs(x, y) { // pairs [i, j] of a longest common subsequence (after trimming the common ends)
  let pre = 0; while (pre < x.length && pre < y.length && x[pre] === y[pre]) pre++;
  let suf = 0; while (suf < x.length - pre && suf < y.length - pre && x[x.length - 1 - suf] === y[y.length - 1 - suf]) suf++;
  const n = x.length - pre - suf, m = y.length - pre - suf; const pairs = [];
  for (let i = 0; i < pre; i++) pairs.push([i, i]);
  if (n > 0 && m > 0) {
    if (n * m > MAX_CELLS) return null;
    const w = m + 1; const dp = new Uint16Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i * w + j] = x[pre + i] === y[pre + j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    let i = 0, j = 0; while (i < n && j < m) { if (x[pre + i] === y[pre + j]) { pairs.push([pre + i, pre + j]); i++; j++; } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i++; else j++; }
  }
  for (let s = suf; s > 0; s--) pairs.push([x.length - s, y.length - s]);
  return pairs;
}
function same(p, q) { if (p.length !== q.length) return false; for (let i = 0; i < p.length; i++) if (p[i] !== q[i]) return false; return true; }
function mergeTokens(o, a, b) {
  if (same(a, b)) return a.slice(); if (same(o, a)) return b.slice(); if (same(o, b)) return a.slice();
  const pa = lcsPairs(o, a), pb = lcsPairs(o, b); if (!pa || !pb) return null;
  const ma = new Map(pa), mb = new Map(pb); const out = [];
  let i = 0, j = 0, k = 0;
  const chunk = (i2, j2, k2) => { // the unstable region before the next point where all three agree
    const O = o.slice(i, i2), A = a.slice(j, j2), B = b.slice(k, k2);
    if (same(A, B) || same(O, B)) out.push(...A); else if (same(O, A)) out.push(...B);
    else if (!O.length) out.push(...A, ...B); // both only inserted text at the same spot: keep both (theirs first)
    else return false;
    return true;
  };
  for (let x = 0; x <= o.length; x++) {
    if (x < o.length) { if (!ma.has(x) || !mb.has(x)) continue; const ja = ma.get(x), kb = mb.get(x); if (ja < j || kb < k) continue; if (!chunk(x, ja, kb)) return null; out.push(o[x]); i = x + 1; j = ja + 1; k = kb + 1; }
    else if (!chunk(o.length, a.length, b.length)) return null;
  }
  return out;
}
const tokHtml = (s) => String(s).match(/<[^>]*>|&[a-zA-Z#0-9]{1,12};|[\s\S]/g) || [];
function mergeHtml(o, a, b) { const r = mergeTokens(tokHtml(o), tokHtml(a), tokHtml(b)); return r ? r.join('') : null; }
function mergeText(o, a, b) { const r = mergeTokens(Array.from(String(o)), Array.from(String(a)), Array.from(String(b))); return r ? r.join('') : null; }
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const json = (v) => JSON.stringify(v === undefined ? null : v);
function mergeJson(o, a, b) {
  if (json(a) === json(b)) return a; if (json(o) === json(a)) return b; if (json(o) === json(b)) return a;
  if (typeof o === 'string' && typeof a === 'string' && typeof b === 'string') { const t = mergeText(o, a, b); return t === null ? b : t; }
  if (isObj(o) && isObj(a) && isObj(b)) {
    const out = {}; const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
      const ia = key in a, ib = key in b, io = key in o;
      if (ia && ib) out[key] = mergeJson(io ? o[key] : null, a[key], b[key]);
      else if (ia) { if (!io || json(o[key]) !== json(a[key])) out[key] = a[key]; } // b deleted it: keep only if a changed it
      else if (ib) { if (!io || json(o[key]) !== json(b[key])) out[key] = b[key]; }
    }
    return out;
  }
  const ids = (v) => Array.isArray(v) && v.every((x) => isObj(x) && x.id != null);
  if (ids(o) && ids(a) && ids(b)) {
    const byO = new Map(o.map((x) => [x.id, x])), byA = new Map(a.map((x) => [x.id, x])), byB = new Map(b.map((x) => [x.id, x]));
    const out = [];
    const pick = (id) => { const ia = byA.has(id), ib = byB.has(id), io = byO.has(id);
      if (ia && ib) return mergeJson(io ? byO.get(id) : null, byA.get(id), byB.get(id));
      if (ia) return !io || json(byO.get(id)) !== json(byA.get(id)) ? byA.get(id) : undefined;
      return !io || json(byO.get(id)) !== json(byB.get(id)) ? byB.get(id) : undefined; };
    const seen = new Set();
    for (const x of b) { seen.add(x.id); const v = pick(x.id); if (v !== undefined) out.push(v); }
    for (const x of a) if (!seen.has(x.id)) { seen.add(x.id); const v = pick(x.id); if (v !== undefined) out.push(v); }
    return out;
  }
  return b;
}
// ---- merge:end ----
export { mergeTokens, mergeHtml, mergeText, mergeJson };
