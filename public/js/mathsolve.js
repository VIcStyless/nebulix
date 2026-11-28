// Nebulix 3.0 phase 24 — a small, dependency-free maths engine for Reference → Math solver.
// parse(text) → AST; evaluate; polynomial detection (exact coefficients for degree ≤ 2 with steps);
// numeric roots for anything else (sign changes + bisection on [-1000, 1000], honest about the range);
// symbolic derivative with light simplification; Simpson integration. No eval(), no Function().
// AST nodes: { n: number } | { v: 'x' } | { op: '+-*/^', a, b } | { neg: node } | { fn: name, a }

const FNS = ['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sqrt', 'abs', 'ln', 'log', 'exp', 'cbrt'];
const CONST = { pi: Math.PI, 'π': Math.PI, e: Math.E };

export class MathError extends Error { constructor(msg, params) { super(params ? msg.replace(/\{(\w+)\}/g, (_, k) => params[k]) : msg); this.key = msg; this.params = params || null; } } // key + params for t()

function tokenize(s) {
  const out = []; let i = 0;
  s = s.replace(/[−–]/g, '-').replace(/[×·]/g, '*').replace(/÷/g, '/').replace(/²/g, '^2').replace(/³/g, '^3').replace(/,/g, '.');
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) { let j = i; while (j < s.length && /[0-9.]/.test(s[j])) j++; if (s[j] === 'e' && /[-+0-9]/.test(s[j + 1] || '') && /[0-9]/.test(s[j + 1] === '-' || s[j + 1] === '+' ? s[j + 2] || '' : s[j + 1])) { j += 2; while (j < s.length && /[0-9]/.test(s[j])) j++; } const v = Number(s.slice(i, j)); if (!Number.isFinite(v)) throw new MathError('Bad number: {s}', { s: s.slice(i, j) }); out.push({ t: 'n', v }); i = j; continue; }
    if (/[a-zπ]/i.test(c)) { let j = i; while (j < s.length && /[a-zπ]/i.test(s[j])) j++; let w = s.slice(i, j).toLowerCase(); i = j;
      // split runs like "2xsin" / "pix" into known words
      while (w) { const f = FNS.find((k) => w.startsWith(k)) || (w.startsWith('pi') ? 'pi' : null); if (f) { out.push(FNS.includes(f) ? { t: 'f', v: f } : { t: 'n', v: CONST[f], name: f }); w = w.slice(f.length); continue; } const ch = w[0]; if (ch === 'x') out.push({ t: 'x' }); else if (ch === 'e') out.push({ t: 'n', v: Math.E, name: 'e' }); else if (ch === 'π') out.push({ t: 'n', v: Math.PI, name: 'pi' }); else throw new MathError('Unknown name “{s}”. Use x as the variable.', { s: s.slice(i - w.length, i) }); w = w.slice(1); }
      continue; }
    if ('+-*/^()='.includes(c)) { out.push({ t: c }); i++; continue; }
    throw new MathError('Unexpected character “{s}”', { s: c });
  }
  return out;
}

export function parse(text) {
  const tk = tokenize(String(text || '')); let p = 0;
  if (tk.length > 400) throw new MathError('That expression is too long');
  const peek = () => tk[p]; const take = (t) => { if (tk[p] && tk[p].t === t) { p++; return true; } return false; };
  const startsAtom = (k) => k && (k.t === 'n' || k.t === 'x' || k.t === 'f' || k.t === '(');
  function expr() { let a = term(); for (;;) { if (take('+')) a = { op: '+', a, b: term() }; else if (take('-')) a = { op: '-', a, b: term() }; else return a; } }
  function term() { let a = unary(); for (;;) { if (take('*')) a = { op: '*', a, b: unary() }; else if (take('/')) a = { op: '/', a, b: unary() }; else if (startsAtom(peek())) a = { op: '*', a, b: power() }; else return a; } } // implicit ×: 2x, 3(x+1), x sin x
  function unary() { if (take('-')) return { neg: unary() }; if (take('+')) return unary(); return power(); }
  function power() { const b = atom(); if (take('^')) return { op: '^', a: b, b: unary() }; return b; } // right-assoc, -x^2 = -(x^2)
  function atom() {
    const k = tk[p++]; if (!k) throw new MathError('The expression ends too early');
    if (k.t === 'n') return { n: k.v, name: k.name }; if (k.t === 'x') return { v: 'x' };
    if (k.t === '(') { const e = expr(); if (!take(')')) throw new MathError('A “)” is missing'); return e; }
    if (k.t === 'f') { const a = take('(') ? (() => { const e = expr(); if (!take(')')) throw new MathError('A “)” is missing'); return e; })() : power(); return { fn: k.v, a }; }
    throw new MathError('Unexpected “{s}”', { s: k.t });
  }
  const lhs = expr(); let rhs = null;
  if (take('=')) rhs = expr();
  if (p < tk.length) throw new MathError('Unexpected “{s}”', { s: tk[p].t === 'n' ? tk[p].v : tk[p].t });
  return { lhs, rhs };
}

export function evaluate(node, x = 0) {
  if ('n' in node) return node.n; if (node.v) return x;
  if (node.neg) return -evaluate(node.neg, x);
  if (node.fn) { const v = evaluate(node.a, x); switch (node.fn) { case 'sin': return Math.sin(v); case 'cos': return Math.cos(v); case 'tan': return Math.tan(v); case 'asin': return Math.asin(v); case 'acos': return Math.acos(v); case 'atan': return Math.atan(v); case 'sqrt': return Math.sqrt(v); case 'cbrt': return Math.cbrt(v); case 'abs': return Math.abs(v); case 'ln': return Math.log(v); case 'log': return Math.log10(v); case 'exp': return Math.exp(v); } }
  const a = evaluate(node.a, x); const b = evaluate(node.b, x);
  switch (node.op) { case '+': return a + b; case '-': return a - b; case '*': return a * b; case '/': return a / b; case '^': return Math.pow(a, b); }
  return NaN;
}
export const hasX = (n) => !!n && (n.v === 'x' || (n.neg && hasX(n.neg)) || (n.fn && hasX(n.a)) || (n.op && (hasX(n.a) || hasX(n.b))));

// ---- polynomials: arrays of coefficients, c[k] = coefficient of x^k (null when not a polynomial) ----
const padd = (p, q) => { const r = []; for (let i = 0; i < Math.max(p.length, q.length); i++) r[i] = (p[i] || 0) + (q[i] || 0); return r; };
const pmul = (p, q) => { const r = Array(p.length + q.length - 1).fill(0); p.forEach((a, i) => q.forEach((b, j) => { r[i + j] += a * b; })); return r; };
const ptrim = (p) => { const r = p.slice(); while (r.length > 1 && Math.abs(r[r.length - 1]) < 1e-12) r.pop(); return r; };
export function poly(n) {
  if ('n' in n) return [n.n]; if (n.v) return [0, 1];
  if (n.neg) { const p = poly(n.neg); return p && p.map((c) => -c); }
  if (n.fn) return hasX(n.a) ? null : [evaluate(n)];
  const a = poly(n.a); const b = poly(n.b); if (!a || !b) return null;
  if (n.op === '+') return padd(a, b); if (n.op === '-') return padd(a, b.map((c) => -c)); if (n.op === '*') return ptrim(pmul(a, b));
  if (n.op === '/') { const bt = ptrim(b); return bt.length === 1 && bt[0] !== 0 ? a.map((c) => c / bt[0]) : null; }
  if (n.op === '^') { const bt = ptrim(b); if (bt.length !== 1) return null; const k = bt[0]; if (!Number.isInteger(k) || k < 0 || k > 12) return ptrim(a).length === 1 ? [Math.pow(a[0], k)] : null; let r = [1]; for (let i = 0; i < k; i++) r = pmul(r, a); return ptrim(r); }
  return null;
}

// tidy number for display: integers, simple fractions, otherwise 6 significant digits
export function fmtNum(v) {
  if (!Number.isFinite(v)) return Number.isNaN(v) ? 'undefined' : v > 0 ? '∞' : '−∞';
  if (Math.abs(v) < 1e-12) return '0';
  if (Math.abs(v - Math.round(v)) < 1e-9) return String(Math.round(v)).replace('-', '−');
  for (let d = 2; d <= 64; d++) { const n = v * d; if (Math.abs(n - Math.round(n)) < 1e-9) return (Math.round(n) < 0 ? '−' : '') + Math.abs(Math.round(n)) + '/' + d + ' ≈ ' + Number(v.toPrecision(6)).toString().replace('-', '−'); }
  const s = Math.abs(v) >= 1e9 || Math.abs(v) < 1e-5 ? v.toExponential(5) : String(Number(v.toPrecision(8)));
  return s.replace('-', '−');
}
const sgn = (v, first) => (v < 0 ? (first ? '−' : ' − ') : first ? '' : ' + ');
export function polyStr(c) {
  const parts = []; for (let k = c.length - 1; k >= 0; k--) { const v = c[k]; if (Math.abs(v) < 1e-12) continue; const a = Math.abs(v); const coef = k > 0 && Math.abs(a - 1) < 1e-12 ? '' : fmtNum(a).split(' ≈')[0]; parts.push(sgn(v, !parts.length) + coef + (k > 1 ? 'x^' + k : k === 1 ? 'x' : '')); }
  return parts.join('') || '0';
}

// numeric roots of f on [-1000, 1000], searched outward from 0 so the roots nearest 0 come first (periodic functions
// have hundreds); at most MAX_ROOTS are kept. Returns { roots, capped }.
const MAX_ROOTS = 40;
function scan(f, lo, hi, N, push, full) {
  const step = (hi - lo) / N; let x0 = lo; let y0 = f(x0);
  for (let i = 1; i <= N && !full(); i++) {
    const x1 = lo + i * step; const y1 = f(x1);
    if (Number.isFinite(y0) && Math.abs(y0) < 1e-12) push(x0);
    else if (Number.isFinite(y0) && Number.isFinite(y1) && y0 * y1 < 0) {
      let a = x0, b = x1, fa = y0; for (let k = 0; k < 80; k++) { const m = (a + b) / 2; const fm = f(m); if (fa * fm <= 0) b = m; else { a = m; fa = fm; } }
      const r = (a + b) / 2; const fr = f(r); if (Number.isFinite(fr) && Math.abs(fr) < 1e-6 * Math.max(1, Math.abs(y0), Math.abs(y1))) push(r); // skip poles (tan, 1/x)
    }
    x0 = x1; y0 = y1;
  }
  if (Number.isFinite(y0) && Math.abs(y0) < 1e-12) push(x0);
}
export function numericRoots(f) {
  const roots = []; const full = () => roots.length >= MAX_ROOTS;
  const push = (r) => { if (Math.abs(r) < 1e-10) r = 0; if (!full() && !roots.some((q) => Math.abs(q - r) < 1e-6 * Math.max(1, Math.abs(r)))) roots.push(r); };
  scan(f, -10, 10, 8000, push, full);
  for (const [a, b] of [[10, 100], [100, 1000]]) { if (full()) break; scan(f, a, b, 12000, push, full); scan(f, -b, -a, 12000, push, full); }
  return { roots: roots.sort((a, b) => a - b), capped: full() };
}

// ---- derivative ----
const N = (n) => ({ n }); const isN = (a, v) => a && 'n' in a && (v === undefined || Math.abs(a.n - v) < 1e-15);
function S(op, a, b) { // build with light simplification
  if (isN(a) && isN(b) && !a.name && !b.name) { const r = evaluate({ op, a, b }); if (Number.isFinite(r)) return N(r); }
  if (op === '+') { if (isN(a, 0)) return b; if (isN(b, 0)) return a; }
  if (op === '-') { if (isN(b, 0)) return a; if (isN(a, 0)) return { neg: b }; }
  if (op === '*') { if (isN(a, 0) || isN(b, 0)) return N(0); if (isN(a, 1)) return b; if (isN(b, 1)) return a; if (isN(b) && !isN(a)) return S('*', b, a);
    if (isN(a) && !a.name && b.op === '*' && isN(b.a) && !b.a.name) return S('*', N(a.n * b.a.n), b.b); } // 3·(2x) → 6x
  if (op === '/') { if (isN(a, 0)) return N(0); if (isN(b, 1)) return a; }
  if (op === '^') { if (isN(b, 0)) return N(1); if (isN(b, 1)) return a; }
  return { op, a, b };
}
const neg = (a) => (isN(a) ? N(-a.n) : a.neg ? a.neg : { neg: a });
export function derive(n) {
  if ('n' in n) return N(0); if (n.v) return N(1);
  if (n.neg) return neg(derive(n.neg));
  if (n.fn) {
    const u = n.a; const du = derive(u); if (isN(du, 0)) return N(0);
    const outer = { sin: { fn: 'cos', a: u }, cos: neg({ fn: 'sin', a: u }), tan: S('/', N(1), S('^', { fn: 'cos', a: u }, N(2))), exp: { fn: 'exp', a: u }, ln: S('/', N(1), u), log: S('/', N(1), S('*', u, { fn: 'ln', a: N(10) })),
      sqrt: S('/', N(1), S('*', N(2), { fn: 'sqrt', a: u })), cbrt: S('/', N(1), S('*', N(3), S('^', { fn: 'cbrt', a: u }, N(2)))), abs: S('/', u, { fn: 'abs', a: u }),
      asin: S('/', N(1), { fn: 'sqrt', a: S('-', N(1), S('^', u, N(2))) }), acos: neg(S('/', N(1), { fn: 'sqrt', a: S('-', N(1), S('^', u, N(2))) })), atan: S('/', N(1), S('+', N(1), S('^', u, N(2)))) }[n.fn];
    return S('*', outer, du);
  }
  const { a, b } = n; const da = derive(a); const db = derive(b);
  switch (n.op) {
    case '+': return S('+', da, db); case '-': return S('-', da, db);
    case '*': return S('+', S('*', da, b), S('*', a, db));
    case '/': return S('/', S('-', S('*', da, b), S('*', a, db)), S('^', b, N(2)));
    case '^':
      if (!hasX(b)) return S('*', S('*', b, S('^', a, S('-', b, N(1)))), da); // power rule
      if (!hasX(a)) return S('*', S('*', n, { fn: 'ln', a }), db); // a^u
      return S('*', n, S('+', S('*', db, { fn: 'ln', a }), S('/', S('*', b, da), a))); // general
  }
  return N(NaN);
}
const PREC = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 3 };
export function toStr(n, parent = 0, right = false) {
  if ('n' in n) { if (n.name) return n.name === 'pi' ? 'π' : n.name; const s = fmtNum(n.n).split(' ≈')[0]; return n.n < 0 && parent ? '(' + s + ')' : s; }
  if (n.v) return 'x';
  if (n.neg) { const s = '−' + toStr(n.neg, 2.5); return parent >= 1 ? '(' + s + ')' : s; }
  if (n.fn) return n.fn + '(' + toStr(n.a) + ')';
  const p = PREC[n.op]; let s;
  if (n.op === '*' && isN(n.a) && !n.a.name && n.a.n >= 0 && (n.b.v || n.b.fn || (n.b.op === '^' && n.b.a.v))) s = toStr(n.a, p) + toStr(n.b, p, true); // 3x, 2sin(x)
  else s = toStr(n.a, p, false) + (n.op === '*' ? '·' : n.op === '^' ? '^' : ' ' + (n.op === '-' ? '−' : n.op) + ' ') + toStr(n.b, p, true);
  return p < parent || (p === parent && (right || n.op === '^')) ? '(' + s + ')' : s;
}

export function integrate(node, a, b, n = 2000) {
  if (n % 2) n++; const h = (b - a) / n; let s = evaluate(node, a) + evaluate(node, b);
  for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * evaluate(node, a + i * h);
  return (s * h) / 3;
}

// Solve or evaluate a line of input. Returns { kind, steps[], result, roots?, expr? }
export function solve(text) {
  const { lhs, rhs } = parse(text);
  if (!rhs) {
    if (!hasX(lhs)) { const v = evaluate(lhs); return { kind: 'value', result: fmtNum(v), value: v, steps: [] }; }
    return { kind: 'function', expr: lhs, steps: [] };
  }
  const f = { op: '-', a: lhs, b: rhs };
  if (!hasX(f)) { const l = evaluate(lhs); const r = evaluate(rhs); return { kind: 'check', result: Math.abs(l - r) < 1e-9 * Math.max(1, Math.abs(l)) ? 'true' : 'false', steps: [fmtNum(l) + ' ' + (Math.abs(l - r) < 1e-9 ? '=' : '≠') + ' ' + fmtNum(r)] }; }
  const c = poly(f); const steps = [];
  if (c) {
    const p = ptrim(c); const deg = p.length - 1; steps.push(['Move everything to one side', polyStr(p) + ' = 0']);
    if (deg === 0) return { kind: 'none', result: Math.abs(p[0]) < 1e-12 ? 'all' : 'none', steps };
    if (deg === 1) { steps.push(['Isolate x', 'x = ' + fmtNum(-p[0]).split(' ≈')[0] + (Math.abs(p[1] - 1) > 1e-12 ? ' / ' + fmtNum(p[1]).split(' ≈')[0] : '')]); const r = -p[0] / p[1]; return { kind: 'roots', roots: [r], exact: true, steps, degree: 1 }; }
    if (deg === 2) {
      const [C, Bc, A] = p; const D = Bc * Bc - 4 * A * C;
      steps.push(['Quadratic: a = ' + fmtNum(A).split(' ≈')[0] + ', b = ' + fmtNum(Bc).split(' ≈')[0] + ', c = ' + fmtNum(C).split(' ≈')[0], 'x = (−b ± √(b² − 4ac)) / 2a']);
      steps.push(['Discriminant', 'Δ = b² − 4ac = ' + fmtNum(D)]);
      if (Math.abs(D) < 1e-12) return { kind: 'roots', roots: [-Bc / (2 * A)], exact: true, steps, degree: 2, note: 'double' };
      if (D > 0) { const s = Math.sqrt(D); return { kind: 'roots', roots: [(-Bc - s) / (2 * A), (-Bc + s) / (2 * A)].sort((x, y) => x - y), exact: true, steps, degree: 2 }; }
      const re = -Bc / (2 * A); const im = Math.sqrt(-D) / (2 * Math.abs(A));
      return { kind: 'complex', roots: [], complex: [fmtNum(re).split(' ≈')[0] + ' − ' + fmtNum(im) + 'i', fmtNum(re).split(' ≈')[0] + ' + ' + fmtNum(im) + 'i'], steps, degree: 2 };
    }
    steps.push(['Polynomial of degree ' + deg, 'solved numerically']);
  }
  const { roots, capped } = numericRoots((x) => evaluate(f, x));
  return { kind: 'roots', roots, capped, exact: false, steps, degree: c ? ptrim(c).length - 1 : null, range: [-1000, 1000] };
}
