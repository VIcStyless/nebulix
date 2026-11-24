// Nebulix Developer Toolbox (Nebulix 3.0): everyday developer utilities that run entirely in the browser.
// JSON · Regex · Encoders · UUID & random · Timestamps · Cron · Colours & gradients · Diff · Markdown · Text tools.
// #/devtools/<tool>. Nothing is sent to the server.
import { h, mount, ls } from '../util.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { toast } from '../ui.js';
import { renderMarkdown } from '../markdown.js';

const TOOLS = [['json', 'JSON', 'terminal'], ['regex', 'Regex tester', 'search'], ['encode', 'Encode / decode', 'lock'], ['uuid', 'UUID & random', 'dice'], ['time', 'Timestamps', 'clock'], ['cron', 'Cron explainer', 'calendar'], ['color', 'Colours & gradients', 'palette'], ['diff', 'Text diff', 'layers'], ['md', 'Markdown preview', 'note'], ['text', 'Text tools', 'edit']];
const area = (val, rows = 10, attrs = {}) => { const ta = h('textarea.input.dt-area', Object.assign({ rows, spellcheck: 'false' }, attrs)); ta.value = val || ''; return ta; };
const copyBtn = (get) => h('button.btn.sm', { onClick: () => navigator.clipboard.writeText(get()).then(() => toast(t('Copied!'), 'good', 1200)).catch(() => {}) }, icon('copy', 13), t('Copy'));
const out = () => h('pre.dt-out');
const saved = (k, d) => { const v = ls('dt.' + k); return v === null ? d : v; };

const tools = {
  json() {
    const inp = area(saved('json', '{"name":"Nebulix","version":3,"apps":["OS","Hub","Nova"]}'), 12); const res = out(); const st = h('div.dt-status');
    const run = (mode) => { ls('dt.json', inp.value); try { const v = JSON.parse(inp.value); res.textContent = mode === 'min' ? JSON.stringify(v) : JSON.stringify(v, null, mode === 'tab' ? '\t' : 2); const keys = JSON.stringify(v).match(/"[^"]*":/g); mount(st, h('span.dt-ok', '✓ ' + t('Valid JSON')), h('span', t('{n} keys', { n: keys ? keys.length : 0 })), h('span', (new Blob([inp.value]).size) + ' B')); } catch (e) { const m = /position (\d+)/.exec(e.message); const pos = m ? Number(m[1]) : -1; const line = pos >= 0 ? inp.value.slice(0, pos).split('\n').length : '?'; res.textContent = ''; mount(st, h('span.dt-bad', '✗ ' + e.message), h('span', t('Line {n}', { n: line }))); } };
    inp.addEventListener('input', () => run('pretty'));
    setTimeout(() => run('pretty'));
    return [h('div.dt-row', h('button.btn.sm.primary', { onClick: () => run('pretty') }, t('Format')), h('button.btn.sm', { onClick: () => run('min') }, t('Minify')), h('button.btn.sm', { onClick: () => run('tab') }, t('Tabs')), h('button.btn.sm', { onClick: () => { try { const srt = (v) => (Array.isArray(v) ? v.map(srt) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, srt(v[k])])) : v); inp.value = JSON.stringify(srt(JSON.parse(inp.value)), null, 2); run('pretty'); } catch {} } }, t('Sort keys')), copyBtn(() => res.textContent)), h('div.dt-two', inp, res), st];
  },
  regex() {
    const pat = h('input.input.dt-mono', { value: saved('rx', '(\\w+)@(\\w+)\\.com') }); const flags = h('input.input.dt-mono', { value: 'g', style: 'width:80px' }); const txt = area(saved('rxt', 'Write to hello@nebulix.com or team@example.com'), 6); const hl = h('div.dt-hl'); const groups = h('div.dt-groups');
    const run = () => { ls('dt.rx', pat.value); ls('dt.rxt', txt.value); let re; try { re = new RegExp(pat.value, flags.value.includes('g') ? flags.value : flags.value + 'g'); } catch (e) { mount(hl, h('span.dt-bad', e.message)); mount(groups); return; }
      const s = txt.value; const parts = []; let last = 0; const ms = []; let m; let guard = 0; while ((m = re.exec(s)) && guard++ < 1000) { if (m[0] === '') { re.lastIndex++; continue; } parts.push(s.slice(last, m.index), h('mark', m[0])); last = m.index + m[0].length; ms.push(m); }
      parts.push(s.slice(last)); mount(hl, parts); mount(groups, h('b', t('{n} matches', { n: ms.length })), ms.slice(0, 30).map((x, i) => h('div.dt-g', h('span.muted', '#' + (i + 1) + ' @' + x.index), h('code', x[0]), x.slice(1).map((g, k) => h('span', '$' + (k + 1) + '=', h('code', g === undefined ? '∅' : g)))))); };
    [pat, flags, txt].forEach((x) => x.addEventListener('input', run)); setTimeout(run);
    const CHEATS = [['\\d', t('digit')], ['\\w', t('word char')], ['\\s', t('space')], ['.', t('any char')], ['^ $', t('start / end')], ['( )', t('group')], ['[abc]', t('one of')], ['a|b', t('or')], ['*', '0+'], ['+', '1+'], ['?', '0-1'], ['{2,4}', t('2 to 4')]];
    return [h('div.dt-row', h('span.dt-mono', '/'), pat, h('span.dt-mono', '/'), flags), txt, hl, groups, h('div.dt-cheats', CHEATS.map(([a, b]) => h('button.dt-chip', { onClick: () => { pat.value += a.split(' ')[0]; run(); } }, h('code', a), ' ', b)))];
  },
  encode() {
    const inp = area(saved('enc', 'Nebulix 3.0 — ¡hola!'), 6); const res = out();
    const b64e = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s))); const b64d = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));
    const ops = [['Base64', b64e], ['Base64 → text', b64d], ['URL encode', encodeURIComponent], ['URL decode', decodeURIComponent], ['HTML escape', (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')], ['HTML unescape', (s) => { const d = document.createElement('textarea'); d.innerHTML = s; return d.value; }], ['Hex', (s) => [...new TextEncoder().encode(s)].map((b) => b.toString(16).padStart(2, '0')).join(' ')], ['Binary', (s) => [...new TextEncoder().encode(s)].map((b) => b.toString(2).padStart(8, '0')).join(' ')], ['Unicode code points', (s) => [...s].map((c) => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')).join(' ')], ['SHA-256', null]];
    const run = async (name, fn) => { ls('dt.enc', inp.value); try { if (name === 'SHA-256') { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(inp.value)); res.textContent = [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join(''); } else res.textContent = fn(inp.value); } catch (e) { res.textContent = '✗ ' + e.message; } };
    return [inp, h('div.dt-row', ops.map(([n, fn]) => h('button.btn.sm', { onClick: () => run(n, fn) }, t(n)))), res, h('div.dt-row', copyBtn(() => res.textContent), h('button.btn.sm.ghost', { onClick: () => { inp.value = res.textContent; } }, '↑ ' + t('Use as input')))];
  },
  uuid() {
    const res = out(); let n = 5; let len = 20; let sets = { a: true, A: true, d: true, s: true };
    const rnd = (max) => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % max; };
    const gen = (kind) => { const L = []; for (let i = 0; i < n; i++) { if (kind === 'uuid') L.push(crypto.randomUUID()); else if (kind === 'pass') { const pool = (sets.a ? 'abcdefghijkmnopqrstuvwxyz' : '') + (sets.A ? 'ABCDEFGHJKLMNPQRSTUVWXYZ' : '') + (sets.d ? '23456789' : '') + (sets.s ? '!@#$%^&*-_=+?' : ''); L.push(Array.from({ length: len }, () => pool[rnd(pool.length)]).join('')); } else if (kind === 'hex') L.push([...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('')); else if (kind === 'num') L.push(String(rnd(1000000))); else if (kind === 'nano') { const al = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict'; L.push(Array.from({ length: 21 }, () => al[rnd(64)]).join('')); } } res.textContent = L.join('\n'); };
    const chk = (k, l) => h('label.dt-chk', h('input', { type: 'checkbox', checked: sets[k], onChange: (e) => { sets[k] = e.target.checked; } }), l);
    setTimeout(() => gen('uuid'));
    return [h('div.dt-row', h('label.dt-chk', t('How many'), h('input.input.sm', { type: 'number', min: 1, max: 100, value: n, style: 'width:70px', onInput: (e) => { n = Math.max(1, Math.min(100, Number(e.target.value) || 1)); } })), h('button.btn.sm.primary', { onClick: () => gen('uuid') }, 'UUID v4'), h('button.btn.sm', { onClick: () => gen('nano') }, 'Nano ID'), h('button.btn.sm', { onClick: () => gen('hex') }, t('Hex token')), h('button.btn.sm', { onClick: () => gen('num') }, t('Number'))),
      h('div.dt-row', h('label.dt-chk', t('Password length'), h('input', { type: 'range', min: 8, max: 64, value: len, onInput: (e) => { len = Number(e.target.value); e.target.nextSibling.textContent = len; } }), h('b', String(len))), chk('a', 'a-z'), chk('A', 'A-Z'), chk('d', '0-9'), chk('s', '!@#'), h('button.btn.sm', { onClick: () => gen('pass') }, t('Passwords'))), res, copyBtn(() => res.textContent), h('p.tiny.muted', t('Made with your browser’s secure random generator (crypto.getRandomValues).'))];
  },
  time() {
    const inp = h('input.input.dt-mono', { value: String(Math.floor(Date.now() / 1000)) }); const res = h('div.dt-kv'); const now = h('b.dt-mono');
    const run = () => { const v = inp.value.trim(); let d; if (/^\d{9,10}$/.test(v)) d = new Date(Number(v) * 1000); else if (/^\d{12,13}$/.test(v)) d = new Date(Number(v)); else d = new Date(v); if (isNaN(d)) { mount(res, h('span.dt-bad', t('Not a date or timestamp'))); return; }
      const rel = Math.round((d - Date.now()) / 1000); const rf = new Intl.RelativeTimeFormat(document.documentElement.lang || 'en', { numeric: 'auto' }); const ab = Math.abs(rel); const relS = ab < 60 ? rf.format(rel, 'second') : ab < 3600 ? rf.format(Math.round(rel / 60), 'minute') : ab < 86400 ? rf.format(Math.round(rel / 3600), 'hour') : rf.format(Math.round(rel / 86400), 'day');
      mount(res, [['Unix (s)', Math.floor(d / 1000)], ['Unix (ms)', +d], ['ISO 8601', d.toISOString()], [t('Local time'), d.toLocaleString()], ['UTC', d.toUTCString()], [t('Relative'), relS], [t('Day of year'), Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000)], [t('Week day'), d.toLocaleDateString(undefined, { weekday: 'long' })]].map(([k, v]) => h('div', h('span', k), h('code', String(v)), h('button.btn.sm.ghost', { onClick: () => navigator.clipboard.writeText(String(v)) }, icon('copy', 12))))); };
    inp.addEventListener('input', run); setTimeout(run); const iv = setInterval(() => { if (!now.isConnected) return clearInterval(iv); now.textContent = Math.floor(Date.now() / 1000); }, 1000);
    return [h('div.dt-row', h('span', t('Now')), now, h('button.btn.sm', { onClick: () => { inp.value = String(Math.floor(Date.now() / 1000)); run(); } }, t('Use now'))), inp, res];
  },
  cron() {
    const inp = h('input.input.dt-mono', { value: saved('cron', '*/15 9-17 * * 1-5') }); const res = h('div.dt-cron');
    const NAMES = [t('minute'), t('hour'), t('day of month'), t('month'), t('day of week')]; const RANGES = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]];
    const parse = (f, [lo, hi]) => { const set = new Set(); for (const part of f.split(',')) { const [r, st] = part.split('/'); const step = st ? Number(st) : 1; let a = lo, b = hi; if (r !== '*') { const [x, y] = r.split('-').map(Number); a = x; b = y === undefined ? (st ? hi : x) : y; } if ([a, b, step].some((n) => !Number.isFinite(n)) || a < lo || b > hi || step < 1) throw new Error(t('Bad field: {f}', { f })); for (let v = a; v <= b; v += step) set.add(v); } return set; };
    const run = () => { ls('dt.cron', inp.value); const f = inp.value.trim().split(/\s+/); if (f.length !== 5) { mount(res, h('span.dt-bad', t('A cron expression has 5 fields: minute hour day month weekday'))); return; }
      try { const sets = f.map((x, i) => parse(x, RANGES[i])); const next = []; const d = new Date(); d.setSeconds(0, 0); for (let i = 0; i < 527040 && next.length < 6; i++) { d.setMinutes(d.getMinutes() + 1); if (sets[0].has(d.getMinutes()) && sets[1].has(d.getHours()) && sets[2].has(d.getDate()) && sets[3].has(d.getMonth() + 1) && sets[4].has(d.getDay())) next.push(new Date(d)); }
        mount(res, h('div.dt-kv', f.map((x, i) => h('div', h('span', NAMES[i]), h('code', x), h('span.muted', x === '*' ? t('every') : [...sets[i]].slice(0, 12).join(', ') + (sets[i].size > 12 ? '…' : ''))))), h('b', t('Next runs')), h('ul', next.map((x) => h('li', x.toLocaleString()))));
      } catch (e) { mount(res, h('span.dt-bad', e.message)); } };
    inp.addEventListener('input', run); setTimeout(run);
    return [inp, h('div.dt-row', [['* * * * *', t('every minute')], ['0 * * * *', t('every hour')], ['0 9 * * 1-5', t('9:00 on weekdays')], ['0 0 1 * *', t('first of the month')]].map(([c, l]) => h('button.dt-chip', { onClick: () => { inp.value = c; run(); } }, h('code', c), ' ', l))), res];
  },
  color() {
    let c1 = saved('c1', '#8b7bff'), c2 = saved('c2', '#3ee6c4'), ang = 135; const prev = h('div.dt-grad'); const info = h('div.dt-kv'); const css = out();
    const hex2rgb = (x) => { const n = parseInt(x.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
    const rgb2hsl = ([r, g, b]) => { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let hh = 0, s = 0; const l = (mx + mn) / 2; if (mx !== mn) { const d = mx - mn; s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn); hh = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; hh *= 60; } return [Math.round(hh), Math.round(s * 100), Math.round(l * 100)]; };
    const lum = (x) => hex2rgb(x).map((v) => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [.2126, .7152, .0722][i], 0);
    const paint = () => { ls('dt.c1', c1); ls('dt.c2', c2); const g = `linear-gradient(${ang}deg, ${c1}, ${c2})`; prev.style.background = g; css.textContent = `background: ${g};`; const ratio = (Math.max(lum(c1), lum(c2)) + .05) / (Math.min(lum(c1), lum(c2)) + .05);
      mount(info, [c1, c2].map((c) => { const rgb = hex2rgb(c); const [hh, s, l] = rgb2hsl(rgb); return h('div', h('i.dt-sw', { style: { background: c } }), h('code', c), h('code', `rgb(${rgb.join(', ')})`), h('code', `hsl(${hh} ${s}% ${l}%)`)); }), h('div', h('span', t('Contrast')), h('b', ratio.toFixed(2) + ':1'), h('span', ratio >= 4.5 ? '✓ AA' : ratio >= 3 ? '✓ AA large' : '✗'))); };
    setTimeout(paint);
    return [h('div.dt-row', h('input', { type: 'color', value: c1, onInput: (e) => { c1 = e.target.value; paint(); } }), h('input', { type: 'color', value: c2, onInput: (e) => { c2 = e.target.value; paint(); } }), h('label.dt-chk', t('Angle'), h('input', { type: 'range', min: 0, max: 360, value: ang, onInput: (e) => { ang = Number(e.target.value); paint(); } })), h('button.btn.sm', { onClick: () => { [c1, c2] = [c2, c1]; paint(); } }, '⇄')), prev, css, copyBtn(() => css.textContent), info];
  },
  diff() {
    const a = area(saved('da', 'Nebulix OS\nNebulix Hub\nNova AI\nArena'), 8); const b = area(saved('db', 'Nebulix OS\nNebulix Hub 2\nNova AI\nArcade\nArena'), 8); const res = h('div.dt-diff'); const st = h('div.dt-status');
    const run = () => { ls('dt.da', a.value); ls('dt.db', b.value); const A = a.value.split('\n'), B = b.value.split('\n'); const n = A.length, m = B.length; if (n * m > 4e6) { mount(res, h('span.dt-bad', t('Too long to compare here'))); return; }
      const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1)); for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
      const rows = []; let i = 0, j = 0, add = 0, del = 0; while (i < n || j < m) { if (i < n && j < m && A[i] === B[j]) { rows.push(['=', A[i]]); i++; j++; } else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) { rows.push(['+', B[j++]]); add++; } else { rows.push(['-', A[i++]]); del++; } }
      mount(res, rows.map(([k, l]) => h('div.dt-dl.' + (k === '+' ? 'add' : k === '-' ? 'del' : 'eq'), h('span', k === '=' ? ' ' : k), l || ' '))); mount(st, h('span.dt-ok', '+' + add), h('span.dt-bad', '−' + del)); };
    [a, b].forEach((x) => x.addEventListener('input', run)); setTimeout(run);
    return [h('div.dt-two', a, b), st, res];
  },
  md() {
    const inp = area(saved('md', '# Nebulix 3.0\n\n**Markdown** with `code`, lists and tables:\n\n- One\n- Two\n\n| App | Status |\n|---|---|\n| OS | ✓ |\n'), 14); const prev = h('div.dt-md.md');
    const run = () => { ls('dt.md', inp.value); mount(prev, renderMarkdown(inp.value)); }; inp.addEventListener('input', run); setTimeout(run);
    return [h('div.dt-two', inp, prev), copyBtn(() => inp.value)];
  },
  text() {
    const inp = area(saved('txt', 'Nebulix is a whole digital world in your browser.'), 8); const st = h('div.dt-status');
    const stats = () => { ls('dt.txt', inp.value); const v = inp.value; const w = (v.match(/\S+/g) || []).length; mount(st, h('span', t('{n} characters', { n: v.length })), h('span', t('{n} words', { n: w })), h('span', t('{n} lines', { n: v.split('\n').length })), h('span', t('{n} min read', { n: Math.max(1, Math.round(w / 200)) }))); };
    const ops = [['UPPER', (s) => s.toUpperCase()], ['lower', (s) => s.toLowerCase()], ['Title Case', (s) => s.replace(/\p{L}+/gu, (x) => x[0].toUpperCase() + x.slice(1).toLowerCase())], ['camelCase', (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+(\p{L})/gu, (_, c) => c.toUpperCase())], ['snake_case', (s) => s.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '_')], ['kebab-case', (s) => s.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-')], ['Sort lines', (s) => s.split('\n').sort((a, b) => a.localeCompare(b)).join('\n')], ['Unique lines', (s) => [...new Set(s.split('\n'))].join('\n')], ['Reverse', (s) => [...s].reverse().join('')], ['Trim spaces', (s) => s.split('\n').map((l) => l.trim().replace(/\s+/g, ' ')).join('\n')], ['Slug', (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')]];
    inp.addEventListener('input', stats); setTimeout(stats);
    return [inp, st, h('div.dt-row', ops.map(([n, fn]) => h('button.btn.sm', { onClick: () => { inp.value = fn(inp.value); stats(); } }, n))), copyBtn(() => inp.value)];
  },
};

export default {
  title: () => t('Developer Toolbox'),
  async mount(root, ctx) {
    let tool = TOOLS.some((x) => x[0] === ctx.params[0]) ? ctx.params[0] : ls('dt.tool') || 'json';
    const nav = h('nav.dt-nav'); const body = h('section.dt-body');
    const paint = () => { ls('dt.tool', tool); history.replaceState(null, '', '#/devtools/' + tool); mount(nav, TOOLS.map(([k, l, ic]) => h('button.dt-tab' + (k === tool ? '.on' : ''), { onClick: () => { tool = k; paint(); } }, icon(ic, 15), h('span', t(l))))); const cur = TOOLS.find((x) => x[0] === tool); mount(body, h('h3.dt-h', icon(cur[2], 18), ' ', t(cur[1])), tools[tool]()); };
    mount(root, h('div.inner.dt', h('div.page-title', h('div', h('h2', icon('terminal', 22), ' ', t('Developer Toolbox')), h('p', t('Everyday developer utilities. Everything runs in your browser; nothing is uploaded.')))), h('div.dt-layout', nav, body)));
    paint();
    return () => {};
  },
};
