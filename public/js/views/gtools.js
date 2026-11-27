// Nebulix 3.0 phase 21 — Gaming Tools. #/gtools/<tool>
//  sens:    sensitivity converter between games (published yaw values), eDPI and cm/360.
//  fov:     FOV converter (horizontal ⇄ vertical, aspect ratio changes) and a resolution / aspect calculator.
//  xhair:   crosshair creator with a shareable code, saved designs and a community gallery (server/routes/gtools.js).
//  reflex:  tracking and flick aim trainers (30 s rounds, personal bests on this device).
//  input / net / system: the Nerd Lab modules (keyboard, mouse polling, reaction, CPS, gamepad, screen; ping and speed;
//           system info and benchmarks), reused here so gamers find them in one place.
// Everything is measured here, in the browser. Nothing is estimated from made-up benchmark tables.
import { h, mount, ls, copyText } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { toast, toastErr, loading, emptyState, field, tabsEl, segEl, confirmBox, promptBox } from '../ui.js';

const TOOLS = [['sens', 'Sensitivity', 'target'], ['fov', 'FOV & resolution', 'monitor'], ['xhair', 'Crosshairs', 'plus'], ['reflex', 'Aim trainer', 'zap'], ['input', 'Input testers', 'gamepad'], ['net', 'Network & FPS', 'activity'], ['system', 'My system', 'cpu']];
const r2 = (n, d = 2) => (Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : '—');
const numIn = (v, opts = {}) => h('input.input', { type: 'number', value: v, step: opts.step || 'any', min: opts.min, max: opts.max, style: 'max-width:160px' });
const out = () => h('b.gt-out');
const card = (title, ...kids) => h('section.card.gt-card', h('h3', title), ...kids);
const row = (...kids) => h('div.gt-row', ...kids);

export default {
  title: () => t('Gaming Tools'),
  async mount(root, ctx) {
    let tool = TOOLS.some((x) => x[0] === ctx.params[0]) ? ctx.params[0] : ls('gt.tool') || 'sens';
    const body = h('section.gt-body'); let cleanup = null;
    const show = async () => {
      ls('gt.tool', tool); history.replaceState(null, '', '#/gtools/' + tool);
      if (cleanup) { try { cleanup(); } catch {} cleanup = null; }
      mount(body, loading());
      try { cleanup = (await FN[tool](body)) || null; } catch (e) { mount(body, emptyState('alert', t('Something went wrong'), e.message)); }
    };
    mount(root, h('div.inner.gt', h('div.page-title', h('div', h('h2', icon('gamepad', 22), ' ', t('Gaming Tools')), h('p', t('Sensitivity, FOV, crosshairs, reflex trainers, input testers, network tests and your system — measured here, in your browser.')))),
      tabsEl(TOOLS.map(([k, l, ic]) => [k, t(l), ic]), tool, (v) => { tool = v; show(); }), body));
    show();
    return () => { if (cleanup) try { cleanup(); } catch {} };
  },
};

// ---------------- Sensitivity ----------------
// Degrees turned per mouse count at sensitivity 1 (the "yaw" each engine uses). These are the engines' published or
// widely verified constants; games whose curves are not linear (Fortnite's %, Minecraft, R6's FOV-scaled sens) are left out.
const YAW = [['cs2', 'Counter-Strike 2', 0.022], ['valorant', 'Valorant', 0.07], ['apex', 'Apex Legends', 0.022], ['ow2', 'Overwatch 2', 0.0066], ['cod', 'Call of Duty (MW 2019+)', 0.0066], ['tf2', 'Team Fortress 2', 0.022], ['quake', 'Quake Champions', 0.022], ['source', 'Source / GoldSrc', 0.022]];
function sens(box) {
  const opt = (sel) => YAW.map(([k, n]) => h('option', { value: k, selected: k === sel }, n));
  const from = h('select.input', opt(ls('gt.from') || 'cs2')); const to = h('select.input', opt(ls('gt.to') || 'valorant'));
  const s = numIn(ls('gt.sens') || 1.2, { step: 0.01 }); const dpi = numIn(ls('gt.dpi') || 800, { step: 50, min: 50 }); const dpi2 = numIn(ls('gt.dpi2') || ls('gt.dpi') || 800, { step: 50, min: 50 });
  const o1 = out(), o2 = out(), o3 = out(), o4 = out();
  const yaw = (k) => YAW.find((x) => x[0] === k)[2];
  const calc = () => {
    const S1 = Number(s.value), D1 = Number(dpi.value), D2 = Number(dpi2.value);
    ls('gt.from', from.value); ls('gt.to', to.value); ls('gt.sens', s.value); ls('gt.dpi', dpi.value); ls('gt.dpi2', dpi2.value);
    if (!(S1 > 0 && D1 > 0 && D2 > 0)) { [o1, o2, o3, o4].forEach((o) => (o.textContent = '—')); return; }
    const deg = yaw(from.value) * S1 * D1; // degrees per inch of mouse movement
    const cm360 = (360 / deg) * 2.54;
    const target = deg / (yaw(to.value) * D2);
    o1.textContent = r2(target, 3); o2.textContent = r2(cm360, 1) + ' cm'; o3.textContent = r2(S1 * D1, 0); o4.textContent = r2(360 / deg, 2) + ' in';
  };
  [from, to, s, dpi, dpi2].forEach((e) => e.addEventListener('input', calc));
  const swap = h('button.btn.sm', { onClick: () => { const a = from.value; from.value = to.value; to.value = a; s.value = o1.textContent === '—' ? s.value : o1.textContent; calc(); } }, icon('refresh', 14), t('Swap'));
  // DPI change helper
  const oldDpi = numIn(800, { step: 50 }), newDpi = numIn(1600, { step: 50 }), oldS = numIn(1, { step: 0.01 }); const o5 = out();
  const calc2 = () => { const a = Number(oldDpi.value), b = Number(newDpi.value), c = Number(oldS.value); o5.textContent = a > 0 && b > 0 && c > 0 ? r2((c * a) / b, 3) : '—'; };
  [oldDpi, newDpi, oldS].forEach((e) => e.addEventListener('input', calc2));
  mount(box, h('div.gt-grid',
    card(t('Convert sensitivity between games'),
      row(field(t('From'), from), field(t('Sensitivity'), s), field('DPI', dpi)),
      row(field(t('To'), to), field(t('DPI in the other game'), dpi2), swap),
      h('div.gt-results', h('div', h('span', t('Sensitivity to use')), o1), h('div', h('span', 'cm/360°'), o2), h('div', h('span', 'eDPI'), o3), h('div', h('span', t('Inches per 360°')), o4)),
      h('p.tiny.muted', t('Hip-fire, same mouse movement for a full turn. Uses each engine’s yaw value (degrees per mouse count). Scoped / ADS multipliers differ per game.'))),
    card(t('Changed your mouse DPI?'),
      row(field(t('Old DPI'), oldDpi), field(t('New DPI'), newDpi), field(t('Old sensitivity'), oldS)),
      h('div.gt-results', h('div', h('span', t('New sensitivity (same feel)')), o5))),
    card(t('What cm/360 means'), h('p.small.muted', t('cm/360 is how far you move the mouse for a full 360° turn. Lower = faster. Many tactical-shooter players sit between 25 and 60 cm; tracking-heavy games are often faster. Pick what lets you both flick and hold a target steadily.')))));
  calc(); calc2();
}

// ---------------- FOV & resolution ----------------
function fov(box) {
  const deg = (r) => (r * 180) / Math.PI, rad = (d) => (d * Math.PI) / 180;
  const val = numIn(ls('gt.fov') || 90, { step: 1 }); const kind = h('select.input', h('option', { value: 'h' }, t('Horizontal')), h('option', { value: 'v' }, t('Vertical')));
  const ar1 = h('select.input'); const ar2 = h('select.input');
  const ARS = [['16:9', 16 / 9], ['16:10', 1.6], ['21:9', 64 / 27], ['32:9', 32 / 9], ['4:3', 4 / 3], ['5:4', 1.25], ['1:1', 1]];
  ARS.forEach(([n], i) => { ar1.append(h('option', { value: i, selected: i === 0 }, n)); ar2.append(h('option', { value: i, selected: i === 2 }, n)); });
  const o1 = out(), o2 = out(), o3 = out();
  const calc = () => {
    ls('gt.fov', val.value); const f = Number(val.value); const a1 = ARS[ar1.value][1], a2 = ARS[ar2.value][1];
    if (!(f > 0 && f < 180)) { o1.textContent = o2.textContent = o3.textContent = '—'; return; }
    const v = kind.value === 'v' ? rad(f) : 2 * Math.atan(Math.tan(rad(f) / 2) / a1);
    const hz = 2 * Math.atan(Math.tan(v / 2) * a1);
    o1.textContent = r2(deg(hz), 2) + '°'; o2.textContent = r2(deg(v), 2) + '°'; o3.textContent = r2(deg(2 * Math.atan(Math.tan(v / 2) * a2)), 2) + '°';
  };
  [val, kind, ar1, ar2].forEach((e) => e.addEventListener('input', calc));
  // resolution / aspect
  const w = numIn(1920, { step: 1 }), hh = numIn(1080, { step: 1 }), inch = numIn(27, { step: 0.1 }); const o4 = out(), o5 = out(), o6 = out(), o7 = out();
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const calc2 = () => {
    const W = Math.round(Number(w.value)), H = Math.round(Number(hh.value)), D = Number(inch.value);
    if (!(W > 0 && H > 0)) { [o4, o5, o6, o7].forEach((o) => (o.textContent = '—')); return; }
    const g = gcd(W, H); let ar = W / g + ':' + H / g; if (Math.abs(W / H - 64 / 27) < 0.02) ar += ' (≈21:9)';
    o4.textContent = ar; o5.textContent = r2((W * H) / 1e6, 2) + ' MP';
    o6.textContent = D > 0 ? r2(Math.hypot(W, H) / D, 0) + ' PPI' : '—';
    o7.textContent = D > 0 ? r2((D * W) / Math.hypot(W, H) * 2.54, 1) + ' × ' + r2((D * H) / Math.hypot(W, H) * 2.54, 1) + ' cm' : '—';
  };
  [w, hh, inch].forEach((e) => e.addEventListener('input', calc2));
  const preset = (W, H) => h('button.chip', { onClick: () => { w.value = W; hh.value = H; calc2(); } }, W + '×' + H);
  mount(box, h('div.gt-grid',
    card(t('FOV converter'), row(field(t('Field of view'), val), field(t('Type'), kind), field(t('Your aspect ratio'), ar1)),
      h('div.gt-results', h('div', h('span', t('Horizontal')), o1), h('div', h('span', t('Vertical')), o2)),
      row(field(t('Horizontal FOV on another screen'), ar2), h('div.gt-results', h('div', h('span', t('Same vertical FOV')), o3))),
      h('p.tiny.muted', t('Most modern games keep the vertical FOV and widen the horizontal one on wider screens (“Hor+”). Some games show a horizontal value based on 4:3 — check your game’s settings.'))),
    card(t('Resolution and aspect ratio'), h('div.filters', preset(1280, 720), preset(1920, 1080), preset(2560, 1440), preset(3440, 1440), preset(3840, 2160), preset(1280, 960), preset(1440, 1080)),
      row(field(t('Width'), w), field(t('Height'), hh), field(t('Diagonal (inches)'), inch)),
      h('div.gt-results', h('div', h('span', t('Aspect ratio')), o4), h('div', h('span', t('Pixels')), o5), h('div', h('span', t('Density')), o6), h('div', h('span', t('Screen size')), o7)))));
  calc(); calc2();
}

// ---------------- Crosshairs ----------------
export const XH_DEFAULT = { color: '#00ff88', outline: true, outlineColor: '#000000', outlineW: 1, length: 6, thick: 2, gap: 3, dot: false, dotSize: 2, tstyle: false, alpha: 1, circle: 0 };
export function drawCrosshair(cv, c, scale = 1, bg = null) {
  const g = cv.getContext('2d'); const W = cv.width, H = cv.height; g.clearRect(0, 0, W, H);
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, W, H); }
  const cx = Math.round(W / 2), cy = Math.round(H / 2); const L = c.length * scale, T = Math.max(1, c.thick * scale), G = c.gap * scale;
  const rects = [];
  if (L > 0) { rects.push([cx + G, cy - T / 2, L, T], [cx - G - L, cy - T / 2, L, T], [cx - T / 2, cy + G, T, L]); if (!c.tstyle) rects.push([cx - T / 2, cy - G - L, T, L]); }
  if (c.dot) { const d = Math.max(1, c.dotSize * scale); rects.push([cx - d / 2, cy - d / 2, d, d]); }
  g.globalAlpha = c.alpha;
  if (c.outline) { const o = c.outlineW * scale; g.fillStyle = c.outlineColor; rects.forEach(([x, y, w, hh]) => g.fillRect(x - o, y - o, w + 2 * o, hh + 2 * o)); }
  g.fillStyle = c.color; rects.forEach(([x, y, w, hh]) => g.fillRect(x, y, w, hh));
  if (c.circle > 0) { g.strokeStyle = c.color; g.lineWidth = Math.max(1, scale); g.beginPath(); g.arc(cx, cy, c.circle * scale, 0, Math.PI * 2); g.stroke(); }
  g.globalAlpha = 1;
}
const XKEYS = ['color', 'outline', 'outlineColor', 'outlineW', 'length', 'thick', 'gap', 'dot', 'dotSize', 'tstyle', 'alpha', 'circle'];
const toCode = (c) => 'NX1-' + btoa(JSON.stringify(XKEYS.map((k) => c[k]))).replace(/=+$/, '');
function fromCode(code) {
  const m = /^NX1-([A-Za-z0-9+/]+)$/.exec(String(code).trim()); if (!m) return null;
  try { const a = JSON.parse(atob(m[1])); if (!Array.isArray(a) || a.length !== XKEYS.length) return null; const c = {}; XKEYS.forEach((k, i) => (c[k] = a[i])); return { ...XH_DEFAULT, ...c }; } catch { return null; }
}
async function xhair(box) {
  let c = { ...XH_DEFAULT, ...(ls('gt.xh') || {}) };
  const big = h('canvas.gt-xh-big', { width: 360, height: 220 }); let bg = ls('gt.xhbg') || 'map';
  const BGS = { map: 'linear-gradient(160deg,#6b7a5a,#c4b38b 55%,#7e8b9c)', dark: '#111', light: '#e8e8e8', sky: 'linear-gradient(#78a9d8,#d9e7f3)' };
  const stage = h('div.gt-xh-stage', big); const paintBg = () => (stage.style.background = BGS[bg]);
  const codeEl = h('code.gt-code');
  const repaint = () => { drawCrosshair(big, c, 4); codeEl.textContent = toCode(c); ls('gt.xh', c); };
  const slider = (k, label, min, max, step) => { const i = h('input', { type: 'range', min, max, step, value: c[k] }); const v = h('span.tiny.muted', String(c[k])); i.addEventListener('input', () => { c[k] = Number(i.value); v.textContent = i.value; repaint(); }); return h('label.gt-sl', h('span', label), i, v); };
  const color = (k, label) => { const i = h('input', { type: 'color', value: c[k] }); i.addEventListener('input', () => { c[k] = i.value; repaint(); }); return h('label.gt-sl', h('span', label), i); };
  const check = (k, label) => { const i = h('input', { type: 'checkbox', checked: !!c[k] }); i.addEventListener('change', () => { c[k] = i.checked; repaint(); }); return h('label.gt-chk', i, label); };
  const controls = h('div.gt-xh-ctl');
  const buildControls = () => mount(controls,
    h('div.row', { style: 'gap:6px;flex-wrap:wrap' }, ['#00ff88', '#ffffff', '#ff2d55', '#00e5ff', '#ffee00', '#ff00ff'].map((col) => h('button.gt-swatch', { style: 'background:' + col, 'aria-label': col, onClick: () => { c.color = col; buildControls(); repaint(); } }))),
    color('color', t('Colour')), slider('length', t('Length'), 0, 30, 0.5), slider('thick', t('Thickness'), 0.5, 10, 0.5), slider('gap', t('Gap'), -5, 30, 0.5), slider('alpha', t('Opacity'), 0.1, 1, 0.05),
    check('dot', t('Centre dot')), slider('dotSize', t('Dot size'), 1, 12, 0.5), check('tstyle', t('T-style (no top line)')),
    check('outline', t('Outline')), color('outlineColor', t('Outline colour')), slider('outlineW', t('Outline width'), 0.5, 3, 0.5), slider('circle', t('Circle radius'), 0, 40, 1));
  buildControls();
  const bgSeg = segEl(Object.keys(BGS).map((k) => [k, t({ map: 'Map', dark: 'Dark', light: 'Light', sky: 'Sky' }[k])]), bg, (v) => { bg = v; ls('gt.xhbg', v); paintBg(); });
  const importBtn = h('button.btn.sm', { onClick: async () => { const s = await promptBox(t('Paste a crosshair code'), { placeholder: 'NX1-…' }); if (!s) return; const n = fromCode(s); if (!n) return toast(t('That is not a valid Nebulix crosshair code'), 'error'); c = n; buildControls(); repaint(); } }, icon('download', 14), t('Import code'));
  const resetBtn = h('button.btn.sm.ghost', { onClick: () => { c = { ...XH_DEFAULT }; buildControls(); repaint(); } }, t('Reset'));
  const pubBtn = h('button.btn.sm.primary', { onClick: publish }, icon('upload', 14), t('Publish to gallery'));
  const overlayBtn = h('button.btn.sm', { onClick: overlay }, icon('monitor', 14), t('Full-screen preview'));
  const gallery = h('div.gt-gallery'); let sort = 'top'; let q = '';
  const gsearch = h('input.input', { type: 'search', placeholder: t('Search by name or game'), onInput: (e) => { q = e.target.value; loadG(); } });
  const gseg = segEl([['top', t('Most liked')], ['new', t('Newest')], ['mine', t('Mine')]], sort, (v) => { sort = v; loadG(); });
  async function publish() {
    const name = await promptBox(t('Name your crosshair'), { placeholder: t('e.g. Clean green dot') }); if (!name) return;
    const game = await promptBox(t('Which game is it for? (optional)'), { placeholder: 'Valorant, CS2…' });
    try { await api.post('/api/crosshairs', { name, game: game || '', cfg: c }); toast(t('Published')); sort = 'mine'; gseg.set('mine'); loadG(); } catch (e) { toastErr(e); }
  }
  function overlay() {
    const cv = h('canvas', { width: innerWidth, height: innerHeight }); const ov = h('div.gt-xh-ov', { style: 'background:' + BGS[bg], onClick: () => ov.remove() }, cv, h('p.gt-xh-ovhint', t('Click anywhere to close')));
    document.body.append(ov); drawCrosshair(cv, c, devicePixelRatio > 1 ? 1.5 : 1.2);
  }
  async function loadG() {
    mount(gallery, loading());
    try {
      const r = await api.get('/api/crosshairs?sort=' + sort + '&q=' + encodeURIComponent(q));
      if (!r.items.length) return mount(gallery, emptyState('plus', sort === 'mine' ? t('You have not published any crosshairs') : t('No crosshairs yet'), t('Design one above and publish it so others can copy it.')));
      mount(gallery, r.items.map((x) => {
        const cv = h('canvas', { width: 120, height: 90 }); drawCrosshair(cv, { ...XH_DEFAULT, ...x.cfg }, 2.2, '#2b2f36');
        const like = h('button.btn.sm' + (x.liked ? '.primary' : ''), { 'aria-pressed': String(x.liked), onClick: async () => { try { const n = (await api.post('/api/crosshairs/' + x.id + '/like')).item; Object.assign(x, n); like.className = 'btn sm' + (x.liked ? ' primary' : ''); like.lastChild.textContent = ' ' + x.likes; } catch (e) { toastErr(e); } } }, icon('heart', 13), ' ' + x.likes);
        return h('div.gt-xcard', cv, h('b', x.name), h('div.tiny.muted', (x.game ? x.game + ' · ' : '') + '@' + (x.by ? x.by.username : '?')),
          h('div.row', { style: 'gap:4px;flex-wrap:wrap' }, h('button.btn.sm', { onClick: () => { c = { ...XH_DEFAULT, ...x.cfg }; buildControls(); repaint(); window.scrollTo({ top: 0, behavior: 'smooth' }); toast(t('Loaded into the editor')); } }, t('Use')), like,
            x.mine ? h('button.btn.sm.ghost', { 'aria-label': t('Delete'), onClick: async () => { if (await confirmBox(t('Delete “{n}”?', { n: x.name }), { danger: true })) { try { await api.del('/api/crosshairs/' + x.id); loadG(); } catch (e) { toastErr(e); } } } }, icon('trash', 13)) : null));
      }));
    } catch (e) { mount(gallery, emptyState('alert', t('Could not load the gallery'), e.message)); }
  }
  mount(box, h('div.gt-grid',
    card(t('Crosshair creator'), h('div.gt-xh', h('div', stage, h('div.row', { style: 'gap:6px;margin-top:8px;flex-wrap:wrap' }, bgSeg, overlayBtn)), controls),
      h('div.gt-codebar', h('span.small', t('Share code')), codeEl, h('button.btn.sm', { onClick: async () => { await copyText(toCode(c)); toast(t('Copied!')); } }, icon('copy', 14), t('Copy')), importBtn, resetBtn, pubBtn),
      h('p.tiny.muted', t('The code works inside Nebulix. Games use their own formats: copy the values (length, thickness, gap, outline) into your game’s crosshair settings.'))),
    card(t('Community gallery'), h('div.toolbar', gsearch, gseg), gallery)));
  paintBg(); repaint(); loadG();
}

// ---------------- Reflex & aim ----------------
function reflex(box) {
  let stop = () => {};
  const area = h('div.gt-arena');
  const first = ['track', 'flick'].includes(ls('gt.rx')) ? ls('gt.rx') : 'track';
  const pick = segEl([['track', t('Tracking')], ['flick', t('Flicking')]], first, (v) => { ls('gt.rx', v); run(v); });
  const best = (k) => ls('gt.best.' + k);
  const setBest = (k, v, lower) => { const b = best(k); if (b == null || (lower ? v < b : v > b)) { ls('gt.best.' + k, v); return true; } return false; };
  function run(kind) { stop(); stop = () => {}; ({ track, flick })[kind](); }

  // Canvas trainers share one loop
  function canvasGame(kind) {
    const cv = h('canvas.gt-canvas', { width: 900, height: 480 }); const g = cv.getContext('2d'); const stat = h('div.gt-results'); let raf = 0, running = false;
    const startBtn = h('button.btn.primary', { onClick: () => begin() }, icon('play', 14), t('Start (30 s)'));
    let mouse = { x: -1, y: -1, in: false }; let tg, t0, last, score, hits, shots, onTime, total, spawnAt;
    const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * cv.width, y: ((e.clientY - r.top) / r.height) * cv.height }; };
    cv.addEventListener('pointermove', (e) => { Object.assign(mouse, pos(e), { in: true }); });
    cv.addEventListener('pointerleave', () => (mouse.in = false));
    cv.addEventListener('pointerdown', (e) => {
      if (!running || kind !== 'flick') return; const p = pos(e); shots++;
      if (Math.hypot(p.x - tg.x, p.y - tg.y) <= tg.r) { hits++; score += Math.max(0, Math.round(1000 - (performance.now() - spawnAt))); spawn(); }
    });
    const spawn = () => { tg = { x: 40 + Math.random() * (cv.width - 80), y: 40 + Math.random() * (cv.height - 80), r: kind === 'flick' ? 18 : 26, vx: 0, vy: 0 }; spawnAt = performance.now(); if (kind === 'track') { const a = Math.random() * Math.PI * 2; tg.vx = Math.cos(a) * 260; tg.vy = Math.sin(a) * 260; } };
    function begin() { running = true; score = 0; hits = 0; shots = 0; onTime = 0; total = 0; t0 = last = performance.now(); spawn(); startBtn.disabled = true; raf = requestAnimationFrame(loop); }
    function end() {
      running = false; startBtn.disabled = false;
      if (kind === 'track') { const pct = Math.round((onTime / Math.max(total, 1)) * 100); const rec = setBest('track', pct, false); mount(stat, h('div', h('span', t('On target')), h('b.gt-out', pct + '%')), h('div', h('span', t('Best')), h('b.gt-out', best('track') + '%')), rec ? h('div', h('b', t('New personal best!'))) : null); }
      else { const acc = shots ? Math.round((hits / shots) * 100) : 0; const rec = setBest('flick', score, false); mount(stat, h('div', h('span', t('Score')), h('b.gt-out', String(score))), h('div', h('span', t('Hits')), h('b.gt-out', String(hits))), h('div', h('span', t('Accuracy')), h('b.gt-out', acc + '%')), h('div', h('span', t('Best')), h('b.gt-out', String(best('flick')))), rec ? h('div', h('b', t('New personal best!'))) : null); }
      draw();
    }
    function loop(now) {
      const dt = Math.min(0.05, (now - last) / 1000); last = now; const el = (now - t0) / 1000;
      if (kind === 'track') {
        tg.x += tg.vx * dt; tg.y += tg.vy * dt;
        if (tg.x < tg.r || tg.x > cv.width - tg.r) { tg.vx *= -1; tg.x = Math.max(tg.r, Math.min(cv.width - tg.r, tg.x)); }
        if (tg.y < tg.r || tg.y > cv.height - tg.r) { tg.vy *= -1; tg.y = Math.max(tg.r, Math.min(cv.height - tg.r, tg.y)); }
        if (Math.random() < dt * 1.2) { const a = Math.atan2(tg.vy, tg.vx) + (Math.random() - 0.5) * 2.2; const sp = 180 + Math.random() * 200; tg.vx = Math.cos(a) * sp; tg.vy = Math.sin(a) * sp; }
        total += dt; if (mouse.in && Math.hypot(mouse.x - tg.x, mouse.y - tg.y) <= tg.r) onTime += dt;
        mount(stat, h('div', h('span', t('On target')), h('b.gt-out', Math.round((onTime / Math.max(total, 0.001)) * 100) + '%')), h('div', h('span', t('Time left')), h('b.gt-out', r2(30 - el, 1) + ' s')));
      } else mount(stat, h('div', h('span', t('Hits')), h('b.gt-out', String(hits))), h('div', h('span', t('Score')), h('b.gt-out', String(score))), h('div', h('span', t('Time left')), h('b.gt-out', r2(30 - el, 1) + ' s')));
      draw();
      if (el >= 30) return end();
      raf = requestAnimationFrame(loop);
    }
    function draw() {
      const css = getComputedStyle(document.documentElement); g.fillStyle = css.getPropertyValue('--surface2').trim() || '#1a1c21'; g.fillRect(0, 0, cv.width, cv.height);
      g.strokeStyle = 'rgba(128,128,128,.15)'; for (let x = 0; x < cv.width; x += 60) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, cv.height); g.stroke(); } for (let y = 0; y < cv.height; y += 60) { g.beginPath(); g.moveTo(0, y); g.lineTo(cv.width, y); g.stroke(); }
      if (!running) { g.fillStyle = css.getPropertyValue('--muted').trim() || '#888'; g.font = '600 20px system-ui'; g.textAlign = 'center'; g.fillText(kind === 'track' ? t('Keep the cursor on the moving target') : t('Click the targets as fast as you can'), cv.width / 2, cv.height / 2); return; }
      const on = kind === 'track' && mouse.in && Math.hypot(mouse.x - tg.x, mouse.y - tg.y) <= tg.r;
      g.fillStyle = on ? '#22c55e' : '#ef4444'; g.beginPath(); g.arc(tg.x, tg.y, tg.r, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(tg.x, tg.y, tg.r * 0.35, 0, Math.PI * 2); g.fill();
    }
    mount(area, h('div.row', { style: 'gap:8px;margin-bottom:8px' }, startBtn), cv, stat); draw();
    stop = () => { cancelAnimationFrame(raf); running = false; };
  }
  const track = () => canvasGame('track'); const flick = () => canvasGame('flick');
  mount(box, h('div', h('div.row', { style: 'margin-bottom:12px;gap:10px;flex-wrap:wrap;align-items:center' }, pick, h('span.tiny.muted', t('Reaction time and clicks-per-second tests are in the Input testers tab.'))), area));
  run(first);
  return () => stop();
}

// Input testers, network tests and system info are the Nerd Lab modules (public/js/nerd/*), shown here as tabs.
const nerdTab = (load) => async (box) => { const mod = (await load()).default; const c = await mod.mount(box, { params: [], query: new URLSearchParams(), go: () => {} }); return typeof c === 'function' ? c : null; };
const input = nerdTab(() => import('../nerd/input.js'));
const net = nerdTab(() => import('../nerd/net.js'));
const system = nerdTab(() => import('../nerd/sys.js'));

const FN = { sens, fov, xhair, reflex, input, net, system };
