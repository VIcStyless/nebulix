// Nebulix Sheets: a spreadsheet with formulas (=SUM(A1:A9), =AVERAGE, MIN, MAX, COUNT, IF, ROUND, ABS, SQRT,
// POWER, CONCAT, LEN, UPPER, LOWER, TODAY, NOW, maths and cell references), formatting, autosave and CSV.
import { h, mount } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { toast, toastErr, loading, emptyState } from '../ui.js';
import { officeHome, officeBar, autosaver } from '../office.js';

const colName = (i) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const colIdx = (s) => { let n = 0; for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
const parseRef = (r) => { const m = /^\$?([A-Z]{1,3})\$?(\d{1,5})$/.exec(r); return m ? [colIdx(m[1]), +m[2] - 1] : null; };

// ---------- formula engine ----------
function evaluate(cells, ref, stack = new Set()) {
  if (stack.has(ref)) return '#CICLO!';
  const c = cells[ref]; const raw = c ? (typeof c === 'object' ? c.v : c) : '';
  if (raw === undefined || raw === null || raw === '') return '';
  if (typeof raw !== 'string' || raw[0] !== '=') { const n = Number(String(raw).replace(',', '.')); return raw !== '' && Number.isFinite(n) && /^-?[\d.,]+$/.test(String(raw).trim()) ? n : raw; }
  stack.add(ref);
  try { const v = new Parser(raw.slice(1), (r) => evaluate(cells, r, stack)).run(); stack.delete(ref); return typeof v === 'number' && !Number.isFinite(v) ? '#DIV/0!' : v; } catch (e) { stack.delete(ref); return e && e.sheet ? e.sheet : '#ERROR!'; }
}
class Parser {
  constructor(src, get) { this.s = src.replace(/\s+/g, (m, i) => m); this.i = 0; this.get = get; }
  run() { const v = this.cmp(); this.ws(); if (this.i < this.s.length) throw err('#ERROR!'); return v; }
  ws() { while (this.s[this.i] === ' ') this.i++; }
  peek(x) { this.ws(); return this.s.slice(this.i, this.i + x.length).toUpperCase() === x; }
  eat(x) { if (this.peek(x)) { this.i += x.length; return true; } return false; }
  cmp() { let a = this.cat(); for (;;) { const op = ['<=', '>=', '<>', '=', '<', '>'].find((o) => this.peek(o)); if (!op) return a; this.i += op.length; const b = this.cat(); a = op === '=' ? a == b : op === '<>' ? a != b : op === '<' ? a < b : op === '>' ? a > b : op === '<=' ? a <= b : a >= b; } }
  cat() { let a = this.add(); while (this.eat('&')) a = String(a) + String(this.add()); return a; }
  add() { let a = this.mul(); for (;;) { if (this.eat('+')) a = num(a) + num(this.mul()); else if (this.eat('-')) a = num(a) - num(this.mul()); else return a; } }
  mul() { let a = this.pow(); for (;;) { if (this.eat('*')) a = num(a) * num(this.pow()); else if (this.eat('/')) a = num(a) / num(this.pow()); else return a; } }
  pow() { let a = this.unary(); while (this.eat('^')) a = Math.pow(num(a), num(this.unary())); return a; }
  unary() { if (this.eat('-')) return -num(this.unary()); if (this.eat('+')) return num(this.unary()); const v = this.atom(); if (this.eat('%')) return num(v) / 100; return v; }
  atom() {
    this.ws(); const rest = this.s.slice(this.i);
    let m;
    if (this.eat('(')) { const v = this.cmp(); if (!this.eat(')')) throw err('#ERROR!'); return v; }
    if ((m = /^"([^"]*)"/.exec(rest))) { this.i += m[0].length; return m[1]; }
    if ((m = /^\d+(\.\d+)?/.exec(rest))) { this.i += m[0].length; return parseFloat(m[0]); }
    if ((m = /^(TRUE|FALSE|VERDADERO|FALSO)\b/i.exec(rest))) { this.i += m[0].length; return /^(TRUE|VERDADERO)$/i.test(m[1]); }
    if ((m = /^([A-Za-z][A-Za-z0-9.]*)\s*\(/.exec(rest))) { this.i += m[0].length; const args = []; if (!this.eat(')')) { do { args.push(this.arg()); } while (this.eat(',') || this.eat(';')); if (!this.eat(')')) throw err('#ERROR!'); } return call(m[1].toUpperCase(), args); }
    if ((m = /^\$?[A-Za-z]{1,3}\$?\d{1,5}/.exec(rest))) { this.i += m[0].length; return this.get(m[0].toUpperCase().replace(/\$/g, '')); }
    throw err('#ERROR!');
  }
  arg() { this.ws(); const m = /^(\$?[A-Za-z]{1,3}\$?\d{1,5}):(\$?[A-Za-z]{1,3}\$?\d{1,5})/.exec(this.s.slice(this.i)); if (m) { this.i += m[0].length; const a = parseRef(m[1].toUpperCase().replace(/\$/g, '')); const b = parseRef(m[2].toUpperCase().replace(/\$/g, '')); const out = []; for (let r = Math.min(a[1], b[1]); r <= Math.max(a[1], b[1]); r++) for (let c = Math.min(a[0], b[0]); c <= Math.max(a[0], b[0]); c++) out.push(this.get(colName(c) + (r + 1))); return out; } return this.cmp(); }
}
const err = (s) => { const e = new Error(s); e.sheet = s; return e; };
const num = (v) => { if (v === '' || v === null || v === undefined) return 0; if (typeof v === 'boolean') return v ? 1 : 0; const n = Number(v); if (!Number.isFinite(n)) throw err('#VALOR!'); return n; };
const flat = (args) => args.flat(Infinity);
const nums = (args) => flat(args).filter((v) => v !== '' && v !== null && !Number.isNaN(Number(v)) && typeof v !== 'boolean').map(Number);
function call(fn, a) {
  const F = {
    SUM: () => nums(a).reduce((x, y) => x + y, 0), SUMA: () => F.SUM(), AVERAGE: () => { const n = nums(a); if (!n.length) throw err('#DIV/0!'); return n.reduce((x, y) => x + y, 0) / n.length; }, PROMEDIO: () => F.AVERAGE(),
    MIN: () => Math.min(...nums(a)), MAX: () => Math.max(...nums(a)), COUNT: () => nums(a).length, CONTAR: () => F.COUNT(), COUNTA: () => flat(a).filter((v) => v !== '').length,
    IF: () => (a[0] ? a[1] : a[2] ?? false), SI: () => F.IF(), ROUND: () => { const p = Math.pow(10, num(a[1] || 0)); return Math.round(num(a[0]) * p) / p; }, REDONDEAR: () => F.ROUND(),
    ABS: () => Math.abs(num(a[0])), SQRT: () => Math.sqrt(num(a[0])), RAIZ: () => F.SQRT(), POWER: () => Math.pow(num(a[0]), num(a[1])), POTENCIA: () => F.POWER(), MOD: () => num(a[0]) % num(a[1]), INT: () => Math.floor(num(a[0])), ENTERO: () => F.INT(),
    CONCAT: () => flat(a).join(''), CONCATENAR: () => F.CONCAT(), LEN: () => String(a[0] ?? '').length, LARGO: () => F.LEN(), UPPER: () => String(a[0] ?? '').toUpperCase(), MAYUSC: () => F.UPPER(), LOWER: () => String(a[0] ?? '').toLowerCase(), MINUSC: () => F.LOWER(),
    AND: () => flat(a).every(Boolean), Y: () => F.AND(), OR: () => flat(a).some(Boolean), O: () => F.OR(), NOT: () => !a[0], NO: () => F.NOT(),
    TODAY: () => new Date().toLocaleDateString(), HOY: () => F.TODAY(), NOW: () => new Date().toLocaleString(), AHORA: () => F.NOW(), RAND: () => Math.random(), ALEATORIO: () => F.RAND(), PI: () => Math.PI,
  };
  if (!F[fn]) throw err('#NOMBRE?'); return F[fn]();
}
const fmtV = (v, f) => { if (typeof v === 'number') { if (f === 'eur') return v.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' }); if (f === 'pct') return (v * 100).toLocaleString('es-ES', { maximumFractionDigits: 2 }) + ' %'; if (f === 'int') return Math.round(v).toLocaleString('es-ES'); return Math.round(v * 1e8) / 1e8 + ''; } if (typeof v === 'boolean') return v ? 'VERDADERO' : 'FALSO'; return String(v ?? ''); };

const TPL = [
  ['Blank spreadsheet', null, ''],
  ['Budget', () => ({ cols: 26, rows: 100, widths: { A: 180 }, cells: { A1: { v: 'Presupuesto mensual', b: 1 }, A3: { v: 'Concepto', b: 1 }, B3: { v: 'Importe', b: 1 }, A4: 'Alquiler', B4: { v: '650', f: 'eur' }, A5: 'Comida', B5: { v: '250', f: 'eur' }, A6: 'Transporte', B6: { v: '60', f: 'eur' }, A7: 'Ocio', B7: { v: '90', f: 'eur' }, A9: { v: 'Total', b: 1 }, B9: { v: '=SUM(B4:B7)', b: 1, f: 'eur' } } }), '💶'],
  ['Grades', () => ({ cols: 26, rows: 100, widths: { A: 160 }, cells: { A1: { v: 'Alumno', b: 1 }, B1: { v: 'Examen 1', b: 1 }, C1: { v: 'Examen 2', b: 1 }, D1: { v: 'Media', b: 1 }, A2: 'Ana', B2: '8', C2: '9', D2: '=ROUND(AVERAGE(B2:C2),2)', A3: 'Luis', B3: '6.5', C3: '7', D3: '=ROUND(AVERAGE(B3:C3),2)' } }), '🎓'],
];

export default {
  full: true,
  title: () => 'Nebulix Sheets',
  async mount(root, ctx) {
    const id = ctx.params[0];
    if (!id) return officeHome(root, ctx, { kind: 'sheet', route: 'sheets', name: 'Nebulix Sheets', emoji: '📊', color: '#22c55e', templates: TPL.map(([l, d, p]) => [t(l), d, p]) });
    const wrap = h('div.of.sheets'); mount(root, wrap, loading());
    let it; try { it = (await api.get('/api/drive/item/' + encodeURIComponent(id))).item; } catch (e) { mount(wrap, emptyState('alert', t('Spreadsheet not found'), e.message)); return () => {}; }
    ctx.setTitle && ctx.setTitle(it.name);
    const data = Object.assign({ cells: {}, cols: 26, rows: 100, widths: {} }, it.data || {});
    const cells = data.cells; const COLS = Math.min(52, data.cols || 26); const ROWS = Math.min(1000, data.rows || 100);
    let sel = 'A1'; let editing = false;
    const bar = officeBar(it, { emoji: '📊', onRename: async (n) => { try { await api.put('/api/drive/item/' + it.id, { name: n }); } catch (e) { toastErr(e); } }, extra: h('button.btn.sm', { onClick: exportCsv }, icon('download', 14), 'CSV') });
    const save = autosaver(it.id, bar);
    const refBox = h('input.sh-ref', { value: sel, onKeydown: (e) => { if (e.key === 'Enter') { const r = e.target.value.toUpperCase(); if (parseRef(r)) select(r); } } });
    const fx = h('input.sh-fx', { readonly: !it.canEdit, onInput: () => { setRaw(sel, fx.value, true); }, onKeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); move(0, 1); grid.focus(); } } });
    const getC = (r) => (cells[r] && typeof cells[r] === 'object' ? cells[r] : { v: cells[r] ?? '' });
    const setRaw = (r, v, live) => { const c = Object.assign({}, getC(r), { v }); if (!c.v && !c.b && !c.i && !c.f && !c.bg && !c.c && !c.al) delete cells[r]; else cells[r] = c; if (!live) paint(); else paintCell(r, true); save(Object.assign({}, data)); };
    const fmtBtn = (label, title, key, val) => h('button.dc-b', { type: 'button', title, onClick: () => { const c = getC(sel); c[key] = c[key] === val ? undefined : val; cells[sel] = c; paint(); save(Object.assign({}, data)); } }, label);
    const tools = h('div.dc-tools', fmtBtn(h('b', 'B'), t('Bold'), 'b', 1), fmtBtn(h('i', 'I'), t('Italic'), 'i', 1), h('i.dc-sep'), fmtBtn('€', t('Euros'), 'f', 'eur'), fmtBtn('%', t('Percent'), 'f', 'pct'), fmtBtn('0', t('Whole number'), 'f', 'int'), h('i.dc-sep'),
      fmtBtn('⇤', t('Align left'), 'al', 'left'), fmtBtn('≡', t('Center'), 'al', 'center'), fmtBtn('⇥', t('Align right'), 'al', 'right'), h('i.dc-sep'),
      h('input.dc-col', { type: 'color', title: t('Fill colour'), value: '#fde68a', onInput: (e) => { const c = getC(sel); c.bg = e.target.value; cells[sel] = c; paint(); save(Object.assign({}, data)); } }),
      h('input.dc-col', { type: 'color', title: t('Text colour'), value: '#e11d48', onInput: (e) => { const c = getC(sel); c.c = e.target.value; cells[sel] = c; paint(); save(Object.assign({}, data)); } }),
      h('button.dc-b', { title: t('Clear'), onClick: () => { delete cells[sel]; paint(); save(Object.assign({}, data)); } }, 'Tx'), h('i.dc-sep'),
      h('button.dc-b', { title: t('Sum of the column above'), onClick: () => { const [c, r] = parseRef(sel); let top = r - 1; while (top >= 0 && evaluate(cells, colName(c) + (top + 1)) !== '' ) top--; if (top < r - 1) setRaw(sel, `=SUM(${colName(c)}${top + 2}:${colName(c)}${r})`); } }, 'Σ'));
    const grid = h('div.sh-grid', { tabindex: 0 }); const table = h('table.sh-t');
    const head = h('tr', h('th.sh-corner'), Array.from({ length: COLS }, (_, c) => h('th', { style: `width:${data.widths[colName(c)] || 100}px` }, colName(c))));
    const tds = {};
    const body = Array.from({ length: ROWS }, (_, r) => h('tr', h('th', String(r + 1)), Array.from({ length: COLS }, (_, c) => { const ref = colName(c) + (r + 1); const td = h('td', { dataset: { r: ref } }); tds[ref] = td; return td; })));
    table.append(h('colgroup', h('col', { style: 'width:46px' }), Array.from({ length: COLS }, (_, c) => h('col', { style: `width:${data.widths[colName(c)] || 100}px` }))), h('thead', head), h('tbody', body));
    table.style.width = (46 + Array.from({ length: COLS }, (_, c) => data.widths[colName(c)] || 100).reduce((a, b) => a + b, 0)) + 'px'; grid.append(table);
    function paintCell(ref, skipEval) {
      const td = tds[ref]; if (!td) return; const c = getC(ref); const v = evaluate(cells, ref);
      td.textContent = fmtV(v, c.f); td.className = (typeof v === 'number' ? 'n' : '') + (String(v).startsWith('#') ? ' err' : '') + (ref === sel ? ' sel' : '');
      td.style.fontWeight = c.b ? '700' : ''; td.style.fontStyle = c.i ? 'italic' : ''; td.style.background = c.bg || ''; td.style.color = c.c || ''; td.style.textAlign = c.al || '';
      if (skipEval) for (const r of Object.keys(cells)) if (r !== ref && typeof getC(r).v === 'string' && getC(r).v[0] === '=') paintCell(r);
    }
    function paint() { for (const ref of Object.keys(tds)) if (cells[ref] !== undefined || tds[ref].textContent || tds[ref].classList.contains('sel')) paintCell(ref); tds[sel] && tds[sel].classList.add('sel'); fx.value = String(getC(sel).v ?? ''); }
    function select(ref) { if (tds[sel]) tds[sel].classList.remove('sel'); sel = ref; tds[sel].classList.add('sel'); refBox.value = sel; fx.value = String(getC(sel).v ?? ''); tds[sel].scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
    function move(dc, dr) { const [c, r] = parseRef(sel); select(colName(Math.max(0, Math.min(COLS - 1, c + dc))) + Math.max(1, Math.min(ROWS, r + 1 + dr))); }
    function editCell(initial) {
      if (!it.canEdit || editing) return; editing = true; const td = tds[sel]; const ref = sel;
      const inp = h('input.sh-in', { value: initial !== undefined ? initial : String(getC(ref).v ?? '') });
      td.textContent = ''; td.append(inp); inp.focus(); if (initial === undefined) inp.select();
      const done = (commit, dc = 0, dr = 0) => { if (!editing) return; editing = false; if (commit) setRaw(ref, inp.value); else paintCell(ref); inp.remove(); paintCell(ref); if (dc || dr) move(dc, dr); grid.focus(); };
      inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') done(true, 0, 1); else if (e.key === 'Tab') { e.preventDefault(); done(true, 1, 0); } else if (e.key === 'Escape') done(false); });
      inp.addEventListener('blur', () => done(true));
    }
    grid.addEventListener('mousedown', (e) => { const td = e.target.closest('td'); if (td && !editing) select(td.dataset.r); });
    grid.addEventListener('dblclick', (e) => { const td = e.target.closest('td'); if (td) { select(td.dataset.r); editCell(); } });
    grid.addEventListener('keydown', (e) => {
      if (editing) return; const k = e.key;
      if (k === 'ArrowUp') { move(0, -1); e.preventDefault(); } else if (k === 'ArrowDown' || k === 'Enter') { move(0, 1); e.preventDefault(); } else if (k === 'ArrowLeft') { move(-1, 0); e.preventDefault(); } else if (k === 'ArrowRight' || k === 'Tab') { move(1, 0); e.preventDefault(); }
      else if (k === 'Delete' || k === 'Backspace') { if (it.canEdit) setRaw(sel, ''); }
      else if (k === 'F2') editCell();
      else if ((e.ctrlKey || e.metaKey) && k === 'c') { navigator.clipboard && navigator.clipboard.writeText(String(getC(sel).v ?? '')); }
      else if ((e.ctrlKey || e.metaKey) && k === 'v') { navigator.clipboard && navigator.clipboard.readText().then((txt) => { const rows = txt.replace(/\r/g, '').split('\n').filter((x, i, a) => x || i < a.length - 1); const [c0, r0] = parseRef(sel); rows.forEach((row, ri) => row.split('\t').forEach((v, ci) => { const ref = colName(c0 + ci) + (r0 + 1 + ri); if (tds[ref]) { const c = getC(ref); c.v = v; cells[ref] = c; } })); paint(); save(Object.assign({}, data)); }).catch(() => {}); }
      else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { editCell(k); e.preventDefault(); }
    });
    function exportCsv() { let maxR = 0, maxC = 0; for (const r of Object.keys(cells)) { const p = parseRef(r); if (p) { maxC = Math.max(maxC, p[0]); maxR = Math.max(maxR, p[1]); } } const rows = []; for (let r = 0; r <= maxR; r++) { const row = []; for (let c = 0; c <= maxC; c++) { const v = fmtV(evaluate(cells, colName(c) + (r + 1)), getC(colName(c) + (r + 1)).f); row.push(/[",;\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v); } rows.push(row.join(',')); } const a = h('a', { href: URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' })), download: it.name + '.csv' }); a.click(); toast(t('Downloaded'), 'good', 1200); }
    mount(wrap, bar, it.canEdit ? tools : null, h('div.sh-fxbar', refBox, h('span.sh-fxl', 'fx'), fx), grid);
    paint(); select('A1'); grid.focus();
    return () => save.flush();
  },
};
