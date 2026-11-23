// World Builder: make your own Nebula World on a top-down grid, test it in 3D and publish it for everyone.
// Blocks are [gx, gy, gz, size, kind, colour]; gy is the height of the block's top (0–80).
import { h, mount } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { toast, toastErr, busy, confirmBox } from '../ui.js';

export const TOOLS = [
  ['n', 'Platform', '▭', null], ['spawn', 'Spawn', '🟢', '#22c55e'], ['finish', 'Finish', '🏁', '#fbbf24'], ['check', 'Checkpoint', '🚩', '#16a34a'],
  ['bounce', 'Bounce pad', '⤒', '#ec4899'], ['kill', 'Lava (danger)', '🔥', '#ef4444'], ['move', 'Moving (side to side)', '↔', null], ['lift', 'Lift (up and down)', '↕', null],
  ['ice', 'Speed floor', '⚡', '#67e8f9'], ['deco', 'Glow block', '✦', null], ['erase', 'Eraser', '⌫', null], ['pan', 'Move view', '✋', null],
];
const SWATCH = ['#8b5cf6', '#6366f1', '#0ea5e9', '#22d3ee', '#14b8a6', '#22c55e', '#a3e635', '#facc15', '#f97316', '#ef4444', '#ec4899', '#f472b6', '#f8fafc', '#94a3b8', '#475569', '#1e293b', '#78350f', '#a16207'];
const MARK = { spawn: 'S', finish: '🏁', check: '⚑', bounce: '⤒', kill: '!', move: '↔', lift: '↕', ice: '⚡', deco: '✦' };
export const SKY_NAMES = { night: 'Night', sunset: 'Sunset', day: 'Day', neon: 'Neon', void: 'Void', lava: 'Lava', candy: 'Candy' };
const FIXED = { spawn: '#22c55e', finish: '#fbbf24', check: '#16a34a', bounce: '#ec4899', kill: '#ef4444', ice: '#67e8f9' };
const MAXB = 900;

function starter() {
  const B = [[0, 0, 0, 3, 'spawn', '#22c55e']]; let x = 0, y = 0, z = 0;
  for (let i = 1; i <= 14; i++) { z -= 2; x += i % 4 === 0 ? 1 : i % 4 === 2 ? -1 : 0; y += i % 3 === 0 ? 1 : 0; B.push([x, y, z, i === 7 ? 2 : 1, i === 7 ? 'check' : i === 10 ? 'bounce' : i === 5 ? 'move' : 'n', ['#8b5cf6', '#6366f1', '#0ea5e9'][i % 3]]); if (i === 10) y += 3; }
  B.push([x, y, z - 3, 3, 'finish', '#fbbf24']); return B;
}

// el: container; draft: { id?, name, desc, kind, sky, pub, blocks }; onTest(draft); onExit()
export function builder(el, draft, { onTest, onExit }) {
  draft = Object.assign({ name: '', desc: '', kind: 'obby', sky: 'night', pub: true, blocks: [] }, JSON.parse(JSON.stringify(draft || {})));
  let tool = 'n', color = SWATCH[0], hgt = 0, size = 1, zoom = 18, cx = 0, cz = 0, hover = null, painting = false, panning = null, dirty = false;
  const undo = []; const redo = [];
  const snap = () => { undo.push(JSON.stringify(draft.blocks)); if (undo.length > 60) undo.shift(); redo.length = 0; };
  const key = (b) => b[0] + ',' + b[1] + ',' + b[2];
  const cv = h('canvas.wb-cv'); const g = cv.getContext('2d'); const info = h('div.wb-info'); const hLab = h('b.wb-hv', '0'); const sLab = h('b.wb-hv', '1');
  const name = h('input.input', { maxlength: 40, placeholder: t('World name'), value: draft.name, onInput: (e) => { draft.name = e.target.value; dirty = true; } });
  const desc = h('input.input', { maxlength: 200, placeholder: t('Short description (optional)'), value: draft.desc, onInput: (e) => { draft.desc = e.target.value; dirty = true; } });
  const kind = h('select.input', { onChange: (e) => { draft.kind = e.target.value; dirty = true; paintInfo(); } }, h('option', { value: 'obby' }, t('Obby (parkour course)')), h('option', { value: 'hangout' }, t('Hangout'))); kind.value = draft.kind;
  const sky = h('select.input', { onChange: (e) => { draft.sky = e.target.value; dirty = true; } }, Object.entries(SKY_NAMES).map(([k, v]) => h('option', { value: k }, '☁ ' + t(v)))); sky.value = draft.sky;
  const pub = h('input', { type: 'checkbox', checked: draft.pub, onChange: (e) => { draft.pub = e.target.checked; dirty = true; } });
  const toolBtns = TOOLS.map(([id, label, ic, fixed]) => h('button.wb-tool', { type: 'button', title: t(label), 'data-id': id, onClick: () => { tool = id; if (fixed) color = fixed; paintTools(); } }, h('span.wb-ti', ic), h('span.wb-tl', t(label))));
  const sw = SWATCH.map((c) => h('button.wb-sw', { type: 'button', style: { background: c }, 'data-c': c, 'aria-label': c, onClick: () => { color = c; if (tool === 'erase' || tool === 'pan' || FIXED[tool]) tool = 'n'; paintTools(); } }));
  const paintTools = () => { for (const b of toolBtns) b.classList.toggle('on', b.dataset.id === tool); for (const b of sw) b.classList.toggle('on', b.dataset.c === color); cv.style.cursor = tool === 'pan' ? 'grab' : 'crosshair'; };
  const setH = (v) => { hgt = Math.max(0, Math.min(80, v)); hLab.textContent = hgt; draw(); };
  const setS = (v) => { size = Math.max(1, Math.min(4, v)); sLab.textContent = size; draw(); };
  function paintInfo() {
    const B = draft.blocks; const sp = B.filter((b) => b[4] === 'spawn').length; const fin = B.filter((b) => b[4] === 'finish').length;
    mount(info, h('span', t('{n} / {m} blocks', { n: B.length, m: MAXB })), sp !== 1 ? h('span.wb-warn', t('Place one spawn')) : null, draft.kind === 'obby' && !fin ? h('span.wb-warn', t('Add a finish')) : null,
      h('span.tiny.muted', t('Click to place · right-drag to move the view · wheel to zoom · [ ] height · Ctrl+Z undo')));
  }
  // ---- drawing ----
  function resize() { const W = Math.max(280, cv.parentElement ? cv.parentElement.clientWidth : 600); const H = Math.round(Math.min(W * 0.72, innerHeight * 0.66)); const dpr = Math.min(2, devicePixelRatio || 1); cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px'; g.setTransform(dpr, 0, 0, dpr, 0, 0); draw(); }
  const toCell = (px, py) => { const W = cv.clientWidth, H = cv.clientHeight; return [Math.round((px - W / 2) / zoom + cx), Math.round((py - H / 2) / zoom + cz)]; };
  const toPx = (gx, gz) => { const W = cv.clientWidth, H = cv.clientHeight; return [(gx - cx) * zoom + W / 2, (gz - cz) * zoom + H / 2]; };
  function draw() {
    const W = cv.clientWidth, H = cv.clientHeight; if (!W) return; g.clearRect(0, 0, W, H);
    g.fillStyle = '#0f172a'; g.fillRect(0, 0, W, H);
    // grid
    g.lineWidth = 1; const [x0, z0] = toCell(0, 0); const [x1, z1] = toCell(W, H);
    for (let x = x0 - 1; x <= x1 + 1; x++) { const [px] = toPx(x - 0.5, 0); g.strokeStyle = x === 0 ? 'rgba(148,163,184,.45)' : x % 5 === 0 ? 'rgba(148,163,184,.18)' : 'rgba(148,163,184,.07)'; g.beginPath(); g.moveTo(px, 0); g.lineTo(px, H); g.stroke(); }
    for (let z = z0 - 1; z <= z1 + 1; z++) { const [, py] = toPx(0, z - 0.5); g.strokeStyle = z === 0 ? 'rgba(148,163,184,.45)' : z % 5 === 0 ? 'rgba(148,163,184,.18)' : 'rgba(148,163,184,.07)'; g.beginPath(); g.moveTo(0, py); g.lineTo(W, py); g.stroke(); }
    // boundary (±60)
    { const [a, b] = toPx(-60.5, -60.5); const [c, d] = toPx(60.5, 60.5); g.strokeStyle = 'rgba(239,68,68,.5)'; g.strokeRect(a, b, c - a, d - b); }
    // blocks, lowest first so the top one shows
    const list = draft.blocks.slice().sort((a, b) => a[1] - b[1]);
    for (const b of list) {
      const [gx, gy, gz, s, k, c] = b; const [px, py] = toPx(gx - s / 2, gz - s / 2); const w = s * zoom; const cur = gy === hgt;
      g.globalAlpha = cur ? 1 : gy < hgt ? 0.35 : 0.6; g.fillStyle = c; g.fillRect(px + 1, py + 1, w - 2, w - 2);
      if (k === 'kill') { g.strokeStyle = '#fff3'; for (let i = -w; i < w; i += 6) { g.beginPath(); g.moveTo(px + i, py + w); g.lineTo(px + i + w, py); g.stroke(); } }
      if (cur) { g.strokeStyle = '#fff'; g.lineWidth = 2; g.strokeRect(px + 1, py + 1, w - 2, w - 2); g.lineWidth = 1; }
      g.globalAlpha = 1; g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      if (zoom >= 12) { g.font = `700 ${Math.max(9, zoom * 0.5)}px system-ui`; const m = MARK[k]; g.fillText(m ? m : String(gy), px + w / 2, py + w / 2); if (m && zoom >= 20) { g.font = `600 ${zoom * 0.34}px system-ui`; g.fillText(String(gy), px + w - zoom * 0.3, py + zoom * 0.3); } }
    }
    if (hover && tool !== 'pan') { const s = tool === 'erase' ? 1 : size; const [px, py] = toPx(hover[0] - s / 2, hover[1] - s / 2); g.strokeStyle = tool === 'erase' ? '#ef4444' : '#fde68a'; g.setLineDash([4, 3]); g.lineWidth = 2; g.strokeRect(px, py, s * zoom, s * zoom); g.setLineDash([]); g.lineWidth = 1; }
  }
  // ---- editing ----
  function apply(gx, gz) {
    if (Math.abs(gx) > 60 || Math.abs(gz) > 60) return; const B = draft.blocks;
    if (tool === 'erase') { let i = B.findIndex((b) => b[0] === gx && b[2] === gz && b[1] === hgt); if (i < 0) { let top = -1; B.forEach((b, j) => { if (b[0] === gx && b[2] === gz && (top < 0 || b[1] > B[top][1])) top = j; }); i = top; } if (i >= 0) { B.splice(i, 1); dirty = true; } return; }
    const nb = [gx, hgt, gz, size, tool, FIXED[tool] || color]; const k = key(nb); const i = B.findIndex((b) => key(b) === k);
    if (i >= 0) { if (JSON.stringify(B[i]) === JSON.stringify(nb)) return; B[i] = nb; } else { if (B.length >= MAXB) { toast(t('This world is full ({n} blocks).', { n: MAXB }), 'info'); return; } B.push(nb); }
    if (tool === 'spawn') for (let j = B.length - 1; j >= 0; j--) if (B[j][4] === 'spawn' && B[j] !== nb && key(B[j]) !== k) B.splice(j, 1);
    dirty = true;
  }
  let lastCell = null;
  const at = (e) => { const r = cv.getBoundingClientRect(); return toCell(e.clientX - r.left, e.clientY - r.top); };
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    if (e.button === 2 || e.button === 1 || tool === 'pan' || e.shiftKey) { panning = { x: e.clientX, y: e.clientY, cx, cz }; return; }
    snap(); painting = true; const c = at(e); lastCell = c.join(); apply(c[0], c[1]); paintInfo(); draw();
  });
  cv.addEventListener('pointermove', (e) => {
    if (panning) { cx = panning.cx - (e.clientX - panning.x) / zoom; cz = panning.cz - (e.clientY - panning.y) / zoom; draw(); return; }
    const c = at(e); hover = c; if (painting && c.join() !== lastCell) { lastCell = c.join(); apply(c[0], c[1]); paintInfo(); } draw();
  });
  const up = () => { painting = false; panning = null; }; cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up); cv.addEventListener('pointerleave', () => { hover = null; draw(); });
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('wheel', (e) => { e.preventDefault(); zoom = Math.max(6, Math.min(48, zoom * (e.deltaY > 0 ? 0.88 : 1.14))); draw(); }, { passive: false });
  cv.style.touchAction = 'none';
  const onKey = (e) => {
    if (!cv.isConnected) return; if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) { if (redo.length) { undo.push(JSON.stringify(draft.blocks)); draft.blocks = JSON.parse(redo.pop()); } } else if (undo.length) { redo.push(JSON.stringify(draft.blocks)); draft.blocks = JSON.parse(undo.pop()); } paintInfo(); draw(); return; }
    if (e.key === ']' || e.key === 'PageUp') setH(hgt + 1); if (e.key === '[' || e.key === 'PageDown') setH(hgt - 1);
    if (e.key === '+' || e.key === '=') setS(size + 1); if (e.key === '-') setS(size - 1);
  };
  document.addEventListener('keydown', onKey);
  const ro = new ResizeObserver(resize);
  // ---- save / test ----
  async function save(btn) {
    await busy(btn, async () => { try { const r = await api.post('/api/worlds/ugc', draft); draft.id = r.id; dirty = false; toast(draft.pub ? t('Published! Everyone can play “{n}” now.', { n: r.name }) : t('Saved as a draft (only you can see it).'), 'good'); } catch (e) { toastErr(e); } });
  }
  async function exit() { if (dirty && draft.blocks.length && !(await confirmBox(t('Leave without saving? Your latest changes will be lost.')))) return; stop(); onExit(); }
  const stop = () => { ro.disconnect(); document.removeEventListener('keydown', onKey); };
  mount(el,
    h('div.wb-top', h('button.btn.sm.ghost', { onClick: exit }, icon('back', 14), t('Worlds')), h('b.grow', '🧱 ' + t('World Builder')),
      h('button.btn.sm', { onClick: () => { stop(); onTest(draft); } }, icon('play', 14), t('Test in 3D')), h('button.btn.sm.primary', { onClick: (e) => save(e.currentTarget) }, icon('check', 14), t('Save'))),
    h('div.wb-meta', name, desc, kind, sky, h('label.row.small', { style: 'gap:6px' }, pub, t('Public'))),
    h('div.wb', h('div.wb-side', h('div.wb-tools', toolBtns), h('div.wb-lab', t('Colour')), h('div.wb-sws', sw),
      h('div.wb-lab', t('Height')), h('div.wb-step', h('button.btn.sm', { onClick: () => setH(hgt - 1) }, '−'), hLab, h('button.btn.sm', { onClick: () => setH(hgt + 1) }, '+')),
      h('div.wb-lab', t('Size')), h('div.wb-step', h('button.btn.sm', { onClick: () => setS(size - 1) }, '−'), sLab, h('button.btn.sm', { onClick: () => setS(size + 1) }, '+')),
      h('div.wb-lab', t('View')), h('div.wb-step', h('button.btn.sm', { onClick: () => { zoom = Math.max(6, zoom / 1.25); draw(); } }, '−'), h('button.btn.sm', { title: t('Centre'), onClick: () => { centre(); draw(); } }, '⌖'), h('button.btn.sm', { onClick: () => { zoom = Math.min(48, zoom * 1.25); draw(); } }, '+')),
      h('button.btn.sm.ghost', { style: 'margin-top:8px', onClick: async () => { if (draft.blocks.length && !(await confirmBox(t('Replace your world with the starter course?')))) return; snap(); draft.blocks = starter(); dirty = true; paintInfo(); draw(); } }, '✨ ' + t('Starter course')),
      h('button.btn.sm.ghost', { onClick: async () => { if (!(await confirmBox(t('Delete every block?')))) return; snap(); draft.blocks = []; dirty = true; paintInfo(); draw(); } }, icon('trash', 14), t('Clear all'))),
    h('div.wb-main', h('div.wb-cvbox', cv), info)));
  if (!draft.blocks.length) draft.blocks = starter();
  const centre = () => { const B = draft.blocks; if (!B.length) return; const xs = B.map((b) => b[0]), zs = B.map((b) => b[2]); cx = (Math.min(...xs) + Math.max(...xs)) / 2; cz = (Math.min(...zs) + Math.max(...zs)) / 2; const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) + 6; const W = cv.clientWidth || 600, H = cv.clientHeight || 400; zoom = Math.max(8, Math.min(30, Math.min(W, H) / span)); };
  ro.observe(cv.parentElement); paintTools(); paintInfo(); resize(); centre(); draw();
  return stop;
}
