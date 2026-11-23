// Built-in desktop tools for Nebulix OS: Notes, Calculator, Focus timer and System monitor.
// They follow the same view contract as the rest of the app ({ title, mount(root, ctx) → cleanup }).
import { h, mount, ls, debounce, fmt, clamp } from '../util.js';
import { t } from '../i18n.js';
import { S } from '../state.js';
import { icon } from '../icons.js';
import { toast, confirmBox, segEl } from '../ui.js';
import { sfx } from '../sfx.js';

// ---------- Notes ----------
const notes = {
  title: () => t('Notes'),
  mount(root) {
    let list = ls('os.notes') || [{ id: Date.now(), title: t('Welcome'), body: t('Notes are saved in this browser automatically.') + '\n\n- ' + t('Use # for headings') + '\n- ' + t('Ctrl+B to toggle bold'), t: Date.now(), color: '#8b5cf6' }];
    let cur = list[0] ? list[0].id : null; let q = '';
    const save = debounce(() => ls('os.notes', list), 300);
    const side = h('div.nt-side'); const ed = h('div.nt-ed');
    const paintSide = () => mount(side,
      h('div.row', h('input.input.sm', { placeholder: t('Search notes'), value: q, onInput: (e) => { q = e.target.value.toLowerCase(); paintSide(); } }), h('button.btn.icon.sm.primary', { title: t('New note'), onClick: () => { const n = { id: Date.now(), title: '', body: '', t: Date.now(), color: ['#8b5cf6', '#38bdf8', '#22c55e', '#f59e0b', '#ec4899'][list.length % 5] }; list.unshift(n); cur = n.id; save(); paint(); } }, icon('plus', 15))),
      h('div.nt-list', list.filter((n) => !q || (n.title + n.body).toLowerCase().includes(q)).map((n) => h('button.nt-item' + (n.id === cur ? '.on' : ''), { style: `--c:${n.color}`, onClick: () => { cur = n.id; paint(); } }, h('b.ellipsis', n.title || t('Untitled')), h('span.tiny.muted.ellipsis', (n.body || '').split('\n')[0] || '…'), h('span.tiny.muted', fmt.rel(n.t))))));
    const paintEd = () => {
      const n = list.find((x) => x.id === cur); if (!n) return mount(ed, h('div.empty', h('div.empty-art.ea-mark'), h('p.muted', t('Create a note to get started.'))));
      const title = h('input.nt-title', { value: n.title, placeholder: t('Title'), onInput: () => { n.title = title.value; n.t = Date.now(); save(); updItem(); } });
      const body = h('textarea.nt-body', { placeholder: t('Write something…'), onInput: () => { n.body = body.value; n.t = Date.now(); save(); updItem(); count.textContent = t('{n} words', { n: (body.value.match(/\S+/g) || []).length }); } }); body.value = n.body;
      const count = h('span.tiny.muted', t('{n} words', { n: (n.body.match(/\S+/g) || []).length }));
      body.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); const a = body.selectionStart, b = body.selectionEnd; const sel = body.value.slice(a, b); const wrapped = sel.startsWith('**') && sel.endsWith('**') ? sel.slice(2, -2) : '**' + sel + '**'; body.setRangeText(wrapped, a, b, 'select'); body.dispatchEvent(new Event('input')); } });
      mount(ed, h('div.row', title, h('div.row.gap-s', ['#8b5cf6', '#38bdf8', '#22c55e', '#f59e0b', '#ec4899'].map((c) => h('button.nt-dot' + (n.color === c ? '.on' : ''), { style: `background:${c}`, title: t('Colour'), onClick: () => { n.color = c; save(); paint(); } }))),
        h('button.btn.ghost.icon.sm', { title: t('Download as .txt'), onClick: () => { const a = h('a', { href: URL.createObjectURL(new Blob([n.title + '\n\n' + n.body], { type: 'text/plain' })), download: (n.title || 'note') + '.txt' }); document.body.appendChild(a); a.click(); a.remove(); } }, icon('download', 15)),
        h('button.btn.ghost.icon.sm', { title: t('Delete'), onClick: async () => { if (await confirmBox(t('Delete this note?'), { danger: true, ok: t('Delete') })) { list = list.filter((x) => x.id !== n.id); cur = list[0] ? list[0].id : null; save(); paint(); } } }, icon('trash', 15))), body, count);
      setTimeout(() => (n.title ? body : title).focus(), 30);
    };
    const updItem = debounce(paintSide, 400);
    const paint = () => { paintSide(); paintEd(); };
    mount(root, h('div.nt', side, ed)); paint();
    return () => ls('os.notes', list);
  },
};

// ---------- Calculator ----------
const calc = {
  title: () => t('Calculator'),
  mount(root) {
    let expr = ''; let hist = ls('os.calc') || [];
    const disp = h('div.calc-expr'); const res = h('div.calc-res', '0'); const histEl = h('div.calc-hist');
    const safeEval = (s) => { // tiny recursive-descent parser: + - * / ^ % ( ) and sqrt — no eval()
      const tok = s.replace(/\s+/g, '').replace(/×/g, '*').replace(/÷/g, '/').match(/\d*\.?\d+(?:e[+-]?\d+)?|√|[-+*/^%()]/g) || []; let i = 0;
      const peek = () => tok[i]; const next = () => tok[i++];
      const prim = () => { const x = next(); if (x === '(') { const v = add(); if (next() !== ')') throw 0; return v; } if (x === '-') return -prim(); if (x === '√') return Math.sqrt(prim()); const n = parseFloat(x); if (Number.isNaN(n)) throw 0; let v = n; if (peek() === '%') { next(); v /= 100; } return v; };
      const pow = () => { let v = prim(); while (peek() === '^') { next(); v = Math.pow(v, prim()); } return v; };
      const mul = () => { let v = pow(); while (peek() === '*' || peek() === '/') { const o = next(); const r = pow(); v = o === '*' ? v * r : v / r; } return v; };
      const add = () => { let v = mul(); while (peek() === '+' || peek() === '-') { const o = next(); const r = mul(); v = o === '+' ? v + r : v - r; } return v; };
      const v = add(); if (i !== tok.length) throw 0; return v;
    };
    const show = () => { disp.textContent = expr || ' '; try { const v = expr ? safeEval(expr) : 0; res.textContent = Number.isFinite(v) ? String(+v.toFixed(10)) : '∞'; res.classList.remove('err'); } catch { res.classList.add('err'); } };
    const paintHist = () => mount(histEl, hist.slice(0, 12).map((x) => h('button.calc-h', { onClick: () => { expr = x.e; show(); } }, h('span.tiny.muted', x.e + ' ='), h('b', x.r))));
    const press = (k) => {
      sfx.click();
      if (k === 'C') expr = ''; else if (k === '⌫') expr = expr.slice(0, -1);
      else if (k === '=') { try { const v = safeEval(expr); const r = String(+v.toFixed(10)); hist.unshift({ e: expr, r }); hist = hist.slice(0, 30); ls('os.calc', hist); expr = r; paintHist(); } catch { toast(t('That expression is not valid'), 'err'); } }
      else expr += k;
      show();
    };
    const keys = ['C', '(', ')', '÷', '7', '8', '9', '×', '4', '5', '6', '-', '1', '2', '3', '+', '√', '0', '.', '=', '^', '%', '⌫'];
    const pad = h('div.calc-pad', keys.map((k) => h('button.calc-k' + (k === '=' ? '.eq' : /[÷×+\-^%√()]/.test(k) ? '.op' : k === 'C' || k === '⌫' ? '.fn' : ''), { onClick: () => press(k) }, k)));
    const onKey = (e) => { if (!root.isConnected) return; const w = root.closest('.os-win'); if (w && !w.classList.contains('focused')) return; const m = { Enter: '=', '=': '=', Backspace: '⌫', Escape: 'C', '*': '×', '/': '÷' }[e.key] || (/^[0-9+\-().^%]$/.test(e.key) ? e.key : null); if (m) { e.preventDefault(); press(m); } };
    document.addEventListener('keydown', onKey);
    mount(root, h('div.calc', h('div.calc-main', h('div.calc-disp', disp, res), pad), histEl)); show(); paintHist();
    return () => document.removeEventListener('keydown', onKey);
  },
};

// ---------- Focus timer (Pomodoro) ----------
const timer = {
  title: () => t('Focus timer'),
  mount(root) {
    const o = Object.assign({ work: 25, brk: 5, mode: 'work', left: 25 * 60, run: false, done: 0 }, ls('os.timer') || {}); let iv = null; let last = Date.now();
    const ring = h('div.tm-ring'); const big = h('div.tm-big'); const lbl = h('div.tm-lbl');
    const save = () => ls('os.timer', Object.assign({}, o, { run: false }));
    const total = () => (o.mode === 'work' ? o.work : o.brk) * 60;
    const paint = () => { const m = Math.floor(o.left / 60), s = o.left % 60; big.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`; lbl.textContent = (o.mode === 'work' ? t('Focus') : t('Break')) + ' · ' + t('{n} sessions today', { n: o.done }); ring.style.setProperty('--p', String(1 - o.left / total())); playBtn.textContent = o.run ? t('Pause') : t('Start'); document.title = o.run ? `${big.textContent} · ${t('Focus timer')}` : document.title; };
    const tick = () => { const now = Date.now(); const d = Math.round((now - last) / 1000); if (d < 1) return; last = now; o.left = Math.max(0, o.left - d); if (o.left === 0) { sfx.big(); if (o.mode === 'work') o.done++; o.mode = o.mode === 'work' ? 'brk' : 'work'; o.left = total(); toast(o.mode === 'work' ? t('Break over — back to focus!') : t('Great work! Take a break.'), 'good', 6000); try { if (Notification.permission === 'granted') new Notification('Nebulix', { body: o.mode === 'work' ? t('Break over — back to focus!') : t('Great work! Take a break.') }); } catch {} save(); } paint(); };
    const playBtn = h('button.btn.primary.lg', { onClick: () => { o.run = !o.run; last = Date.now(); clearInterval(iv); if (o.run) { iv = setInterval(tick, 250); try { if (Notification.permission === 'default') Notification.requestPermission(); } catch {} } save(); paint(); } });
    const len = (k, label, opts) => h('div.field', h('label', label), segEl(opts.map((m) => [m, m + ' min']), o[k], (v) => { o[k] = Number(v); if (!o.run) o.left = total(); save(); paint(); }));
    mount(root, h('div.tm', h('div.tm-wrap', ring, h('div.tm-in', big, lbl)), h('div.row', playBtn, h('button.btn', { onClick: () => { o.run = false; clearInterval(iv); o.left = total(); save(); paint(); } }, t('Reset')), h('button.btn.ghost', { onClick: () => { o.mode = o.mode === 'work' ? 'brk' : 'work'; o.left = total(); save(); paint(); } }, t('Skip'))),
      len('work', t('Focus length'), [15, 25, 45, 60]), len('brk', t('Break length'), [5, 10, 15])));
    paint();
    return () => { clearInterval(iv); save(); };
  },
};

// ---------- System monitor ----------
const monitor = {
  title: () => t('System monitor'),
  mount(root) {
    const cv = h('canvas.mon-cv', { width: 600, height: 140 }); const stats = h('div.mon-stats'); const fpsHist = []; let frames = 0, lastT = performance.now(), raf = 0, ping = null;
    const loop = (now) => { raf = requestAnimationFrame(loop); frames++; if (now - lastT >= 1000) { fpsHist.push(Math.round(frames * 1000 / (now - lastT))); if (fpsHist.length > 60) fpsHist.shift(); frames = 0; lastT = now; draw(); } };
    const draw = () => {
      const g = cv.getContext('2d'); const W = cv.width, H = cv.height; g.clearRect(0, 0, W, H); g.strokeStyle = 'rgba(255,255,255,.08)'; for (let y = 0; y <= 4; y++) { g.beginPath(); g.moveTo(0, y * H / 4); g.lineTo(W, y * H / 4); g.stroke(); }
      const acc = getComputedStyle(document.documentElement).getPropertyValue('--accent2').trim() || '#38bdf8'; g.strokeStyle = acc; g.lineWidth = 2; g.beginPath(); fpsHist.forEach((v, i) => { const x = W - (fpsHist.length - 1 - i) * (W / 59); const y = H - clamp(v / 144, 0, 1) * H; if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.stroke();
      const mem = performance.memory; const wins = document.querySelectorAll('.os-win').length;
      mount(stats,
        stat(icon('activity', 16), t('Frame rate'), (fpsHist[fpsHist.length - 1] || 0) + ' FPS'), stat(icon('window', 16), t('Open windows'), String(wins)),
        stat(icon('cpu', 16), t('JS memory'), mem ? fmt.bytes(mem.usedJSHeapSize) + ' / ' + fmt.bytes(mem.jsHeapSizeLimit) : t('Not available in this browser')),
        stat(icon('wifi', 16), t('Realtime'), S.ws ? (ping !== null ? t('Connected · {ms} ms', { ms: ping }) : t('Connected')) : t('Offline')),
        stat(icon('gear', 16), t('CPU threads'), String(navigator.hardwareConcurrency || '?')), stat(icon('monitor', 16), t('Screen'), `${screen.width}×${screen.height} @${devicePixelRatio}x`),
        stat(icon('server', 16), t('Storage used'), h('span.mon-st', '…')));
      navigator.storage && navigator.storage.estimate && navigator.storage.estimate().then((e) => { const el = stats.querySelector('.mon-st'); if (el) el.textContent = fmt.bytes(e.usage || 0) + ' / ' + fmt.bytes(e.quota || 0); });
    };
    const stat = (e, k, v) => h('div.mon-stat', h('span', e), h('div.grow', h('div.tiny.muted', k), h('b.small', v)));
    const measure = async () => { const t0 = performance.now(); try { await fetch('/api/health', { cache: 'no-store' }); ping = Math.round(performance.now() - t0); } catch { ping = null; } };
    const pi = setInterval(measure, 5000); measure();
    mount(root, h('div.mon', h('h3', t('Performance')), cv, stats, h('p.tiny.muted', t('Measured live in this tab. Close windows you are not using to free memory.')))); raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); clearInterval(pi); };
  },
};

export const OS_APPS = { notes, calc, timer, monitor };
