// Nebulix Photo (3.0 phase 17) — a layered image editor that runs in the browser: image, text and shape layers;
// move / resize / rotate; opacity, blend modes and filters per layer; crop and canvas size; templates for thumbnails,
// banners and social posts; undo/redo; export PNG/JPEG; projects saved to Drive as .nbxphoto files. #/photo
import { h, mount } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { toast, toastErr, modal, field } from '../ui.js';

const TEMPLATES = [['YouTube thumbnail', 1280, 720], ['Channel banner', 2560, 1440], ['Twitter / X header', 1500, 500], ['Square post', 1080, 1080], ['Story', 1080, 1920], ['Poster (A4)', 1240, 1754], ['Logo', 1000, 1000], ['Full HD', 1920, 1080]];
const BLENDS = ['source-over', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'];
const FONTS = ['system-ui', 'Georgia', 'Impact', 'ui-monospace', 'Arial Black', 'Trebuchet MS', 'Comic Sans MS'];
const FILTERS = [['brightness', 'Brightness', 0, 200, 100, '%'], ['contrast', 'Contrast', 0, 200, 100, '%'], ['saturate', 'Saturation', 0, 200, 100, '%'], ['hue', 'Hue', -180, 180, 0, '°'], ['blur', 'Blur', 0, 20, 0, 'px'], ['grayscale', 'Black & white', 0, 100, 0, '%'], ['sepia', 'Sepia', 0, 100, 0, '%']];
const nid = () => Math.random().toString(36).slice(2, 10);
const filterCss = (f = {}) => `brightness(${f.brightness ?? 100}%) contrast(${f.contrast ?? 100}%) saturate(${f.saturate ?? 100}%) hue-rotate(${f.hue ?? 0}deg) blur(${f.blur ?? 0}px) grayscale(${f.grayscale ?? 0}%) sepia(${f.sepia ?? 0}%)`;

export default {
  full: true,
  title: () => 'Nebulix Photo',
  async mount(root) {
    let doc = { w: 1280, h: 720, bg: '#0f172a', layers: [] }; let name = t('Untitled design'); let sel = null; let tool = 'move'; let crop = null; let driveId = null;
    const imgs = new Map(); // src -> HTMLImageElement
    const undo = []; const redo = []; const snap = () => JSON.stringify(doc);
    const commit = () => { undo.push(snap()); if (undo.length > 60) undo.shift(); redo.length = 0; };
    const canvas = h('canvas.ph-canvas', { tabIndex: 0, 'aria-label': t('Design canvas') }); const g = canvas.getContext('2d');
    const stageWrap = h('div.ph-stage'); const layersEl = h('div.ph-layers'); const propsEl = h('div.ph-props'); const nameIn = h('input.input.ph-name', { value: name, 'aria-label': t('Name'), onInput: (e) => { name = e.target.value; } });
    const imgOf = (src) => { let im = imgs.get(src); if (!im) { im = new Image(); im.onload = () => draw(); im.src = src; imgs.set(src, im); } return im; };
    const layer = () => doc.layers.find((l) => l.id === sel) || null;

    // ---------- rendering ----------
    function drawLayer(c, l) {
      if (!l.visible) return; c.save(); c.globalAlpha = (l.opacity ?? 100) / 100; c.globalCompositeOperation = l.blend || 'source-over'; c.filter = filterCss(l.filters);
      c.translate(l.x + l.w / 2, l.y + l.h / 2); c.rotate(((l.rot || 0) * Math.PI) / 180); const x = -l.w / 2, y = -l.h / 2;
      if (l.type === 'image') { const im = imgOf(l.src); if (im.complete && im.naturalWidth) c.drawImage(im, x, y, l.w, l.h); }
      else if (l.type === 'rect' || l.type === 'ellipse') {
        c.beginPath(); if (l.type === 'rect') { const r = Math.min(l.radius || 0, l.w / 2, l.h / 2); c.roundRect ? c.roundRect(x, y, l.w, l.h, r) : c.rect(x, y, l.w, l.h); } else c.ellipse(0, 0, l.w / 2, l.h / 2, 0, 0, Math.PI * 2);
        if (l.fill && l.fill !== 'none') { c.fillStyle = l.fill; c.fill(); } if (l.strokeW > 0) { c.lineWidth = l.strokeW; c.strokeStyle = l.stroke || '#000'; c.stroke(); }
      } else if (l.type === 'text') {
        c.font = `${l.italic ? 'italic ' : ''}${l.weight || 700} ${l.size || 64}px ${l.font || 'system-ui'}`; c.textBaseline = 'middle'; c.textAlign = l.align || 'center';
        const tx = l.align === 'left' ? x : l.align === 'right' ? x + l.w : 0; const lines = String(l.text || '').split('\n'); const lh = (l.size || 64) * 1.15; let ty = -((lines.length - 1) * lh) / 2;
        if (l.shadow) { c.shadowColor = 'rgba(0,0,0,.55)'; c.shadowBlur = (l.size || 64) / 6; c.shadowOffsetY = (l.size || 64) / 16; }
        for (const line of lines) { if (l.strokeW > 0) { c.lineWidth = l.strokeW; c.strokeStyle = l.stroke || '#000'; c.lineJoin = 'round'; c.strokeText(line, tx, ty); } c.fillStyle = l.color || '#fff'; c.fillText(line, tx, ty); ty += lh; }
      }
      c.restore();
    }
    function render(c, w, h2, withBg = true) { c.clearRect(0, 0, w, h2); if (withBg && doc.bg !== 'transparent') { c.fillStyle = doc.bg; c.fillRect(0, 0, w, h2); } for (const l of doc.layers) drawLayer(c, l); }
    function draw() {
      if (canvas.width !== doc.w || canvas.height !== doc.h) { canvas.width = doc.w; canvas.height = doc.h; }
      render(g, doc.w, doc.h); const l = layer();
      const s = doc.w / Math.max(1, canvas.clientWidth || doc.w); g.save(); g.lineWidth = 2 * s; g.setLineDash([8 * s, 6 * s]); g.strokeStyle = '#38bdf8';
      if (l && tool === 'move') { g.translate(l.x + l.w / 2, l.y + l.h / 2); g.rotate(((l.rot || 0) * Math.PI) / 180); g.strokeRect(-l.w / 2, -l.h / 2, l.w, l.h); g.setLineDash([]); g.fillStyle = '#38bdf8'; const hs = 14 * s; g.fillRect(l.w / 2 - hs / 2, l.h / 2 - hs / 2, hs, hs); }
      if (crop) { g.setLineDash([]); g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(0, 0, doc.w, crop.y); g.fillRect(0, crop.y + crop.h, doc.w, doc.h); g.fillRect(0, crop.y, crop.x, crop.h); g.fillRect(crop.x + crop.w, crop.y, doc.w, crop.h); g.strokeStyle = '#fbbf24'; g.strokeRect(crop.x, crop.y, crop.w, crop.h); }
      g.restore();
    }

    // ---------- pointer interaction ----------
    const pt = (e) => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * doc.w / r.width, y: (e.clientY - r.top) * doc.h / r.height }; };
    const local = (l, p) => { const a = (-(l.rot || 0) * Math.PI) / 180; const dx = p.x - (l.x + l.w / 2), dy = p.y - (l.y + l.h / 2); return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) }; };
    const hit = (l, p) => { const q = local(l, p); return Math.abs(q.x) <= l.w / 2 && Math.abs(q.y) <= l.h / 2; };
    let drag = null;
    canvas.addEventListener('pointerdown', (e) => {
      const p = pt(e); canvas.setPointerCapture(e.pointerId); canvas.focus();
      if (tool === 'crop') { drag = { mode: 'crop', p0: p }; crop = { x: p.x, y: p.y, w: 0, h: 0 }; return; }
      const cur = layer(); const s = doc.w / canvas.clientWidth;
      if (cur && !cur.locked) { const q = local(cur, p); if (Math.abs(q.x - cur.w / 2) < 18 * s && Math.abs(q.y - cur.h / 2) < 18 * s) { commit(); drag = { mode: 'resize', l: cur, p0: p, o: { ...cur }, ratio: cur.w / cur.h }; return; } }
      const top = [...doc.layers].reverse().find((l) => l.visible && !l.locked && hit(l, p));
      sel = top ? top.id : null; paintPanels(); draw();
      if (top) { commit(); drag = { mode: 'move', l: top, p0: p, o: { x: top.x, y: top.y } }; }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return; const p = pt(e);
      if (drag.mode === 'move') { drag.l.x = Math.round(drag.o.x + p.x - drag.p0.x); drag.l.y = Math.round(drag.o.y + p.y - drag.p0.y); }
      else if (drag.mode === 'resize') { const q = local({ ...drag.o }, p); let w = Math.max(8, q.x + drag.o.w / 2), hh = Math.max(8, q.y + drag.o.h / 2); if (drag.l.type === 'image' && !e.shiftKey) hh = w / drag.ratio; drag.l.w = Math.round(w); drag.l.h = Math.round(hh); drag.l.x = Math.round(drag.o.x + drag.o.w / 2 - w / 2 + (w - drag.o.w) / 2); drag.l.y = Math.round(drag.o.y + drag.o.h / 2 - hh / 2 + (hh - drag.o.h) / 2); }
      else if (drag.mode === 'crop') { crop = { x: Math.max(0, Math.min(drag.p0.x, p.x)), y: Math.max(0, Math.min(drag.p0.y, p.y)), w: Math.abs(p.x - drag.p0.x), h: Math.abs(p.y - drag.p0.y) }; }
      draw();
    });
    const end = () => { if (drag && drag.mode !== 'crop') paintPanels(); drag = null; };
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('keydown', (e) => {
      const l = layer(); const k = e.key; const mod = e.ctrlKey || e.metaKey;
      if (mod && k.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
      if (mod && k.toLowerCase() === 'y') { e.preventDefault(); doRedo(); return; }
      if (!l) return;
      if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); commit(); doc.layers = doc.layers.filter((x) => x !== l); sel = null; paintPanels(); draw(); }
      else if (k.startsWith('Arrow')) { e.preventDefault(); commit(); const d = e.shiftKey ? 10 : 1; if (k === 'ArrowLeft') l.x -= d; if (k === 'ArrowRight') l.x += d; if (k === 'ArrowUp') l.y -= d; if (k === 'ArrowDown') l.y += d; draw(); }
      else if (mod && k.toLowerCase() === 'd') { e.preventDefault(); duplicate(l); }
    });

    // ---------- actions ----------
    function add(l) { commit(); l.id = nid(); l.visible = true; l.opacity = 100; l.blend = 'source-over'; l.rot = 0; l.filters = {}; doc.layers.push(l); sel = l.id; tool = 'move'; paintTools(); paintPanels(); draw(); }
    const addText = () => add({ type: 'text', name: t('Text'), text: t('Your title'), x: doc.w * 0.1, y: doc.h * 0.4, w: doc.w * 0.8, h: Math.round(doc.h * 0.2), size: Math.round(doc.h / 8), color: '#ffffff', font: 'system-ui', weight: 800, align: 'center', strokeW: 0, stroke: '#000000', shadow: true });
    const addShape = (type) => add({ type, name: type === 'rect' ? t('Rectangle') : t('Ellipse'), x: doc.w * 0.35, y: doc.h * 0.3, w: doc.w * 0.3, h: doc.h * 0.4, fill: '#6366f1', stroke: '#ffffff', strokeW: 0, radius: 24 });
    function addImageFile(file) {
      if (!/^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(file.type)) return toast(t('Choose a PNG, JPEG, GIF, WebP or SVG image'), 'err'); if (file.size > 20 * 1048576) return toast(t('Images up to 20 MB'), 'err');
      const r = new FileReader(); r.onload = () => { const im = new Image(); im.onload = () => { imgs.set(r.result, im); const sc = Math.min(1, (doc.w * 0.9) / im.naturalWidth, (doc.h * 0.9) / im.naturalHeight); const w = Math.round(im.naturalWidth * sc), hh = Math.round(im.naturalHeight * sc); add({ type: 'image', name: file.name.slice(0, 40), src: r.result, x: Math.round((doc.w - w) / 2), y: Math.round((doc.h - hh) / 2), w, h: hh }); }; im.src = r.result; }; r.readAsDataURL(file);
    }
    const pickImage = () => { const i = h('input', { type: 'file', accept: 'image/*', onChange: () => i.files[0] && addImageFile(i.files[0]) }); i.click(); };
    function duplicate(l) { commit(); const c = JSON.parse(JSON.stringify(l)); c.id = nid(); c.x += 20; c.y += 20; c.name = (l.name || '') + ' ' + t('copy'); doc.layers.splice(doc.layers.indexOf(l) + 1, 0, c); sel = c.id; paintPanels(); draw(); }
    function move(l, d) { const i = doc.layers.indexOf(l); const j = i + d; if (j < 0 || j >= doc.layers.length) return; commit(); [doc.layers[i], doc.layers[j]] = [doc.layers[j], doc.layers[i]]; paintPanels(); draw(); }
    function doUndo() { if (!undo.length) return; redo.push(snap()); doc = JSON.parse(undo.pop()); if (!layer()) sel = null; paintPanels(); draw(); }
    function doRedo() { if (!redo.length) return; undo.push(snap()); doc = JSON.parse(redo.pop()); paintPanels(); draw(); }
    function applyCrop() { if (!crop || crop.w < 8 || crop.h < 8) { crop = null; tool = 'move'; paintTools(); draw(); return; } commit(); for (const l of doc.layers) { l.x -= Math.round(crop.x); l.y -= Math.round(crop.y); } doc.w = Math.round(crop.w); doc.h = Math.round(crop.h); crop = null; tool = 'move'; paintTools(); paintPanels(); draw(); }
    function newDoc(w, hh) { commit(); doc = { w, h: hh, bg: '#0f172a', layers: [] }; sel = null; driveId = null; paintPanels(); draw(); }
    function sizeDialog() {
      const w = h('input.input', { type: 'number', min: 16, max: 8000, value: doc.w }); const hh = h('input.input', { type: 'number', min: 16, max: 8000, value: doc.h }); const scale = h('input', { type: 'checkbox', checked: true });
      modal({ title: t('Canvas size'), body: h('div.col', { style: 'gap:10px' }, h('div.row', { style: 'gap:8px' }, field(t('Width'), w), field(t('Height'), hh)), h('label.small', scale, ' ', t('Scale the layers too')), h('div.ph-tpls', TEMPLATES.map(([n, tw, th]) => h('button.btn.sm', { type: 'button', onClick: () => { w.value = tw; hh.value = th; } }, t(n) + ' · ' + tw + '×' + th)))),
        actions: [{ label: t('Cancel'), value: false }, { label: t('Apply'), kind: 'primary', onClick: () => { const nw = Math.max(16, Math.min(8000, +w.value)), nh = Math.max(16, Math.min(8000, +hh.value)); commit(); if (scale.checked) { const sx = nw / doc.w, sy = nh / doc.h; for (const l of doc.layers) { l.x *= sx; l.y *= sy; l.w *= sx; l.h *= sy; if (l.size) l.size *= Math.min(sx, sy); } } doc.w = nw; doc.h = nh; draw(); } }] });
    }
    async function exportImg(type) {
      const c = document.createElement('canvas'); c.width = doc.w; c.height = doc.h; render(c.getContext('2d'), doc.w, doc.h, !(type === 'png' && doc.bg === 'transparent'));
      return new Promise((r) => c.toBlob(r, type === 'png' ? 'image/png' : 'image/jpeg', 0.92));
    }
    const fileName = (ext) => (name.trim() || 'design').replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 80) + '.' + ext;
    async function download(type) { const b = await exportImg(type); const a = h('a', { href: URL.createObjectURL(b), download: fileName(type === 'png' ? 'png' : 'jpg') }); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 3000); }
    async function toDrive(kind) {
      try {
        const blob = kind === 'project' ? new Blob([JSON.stringify({ app: 'nebulix-photo', v: 1, name, doc })], { type: 'application/json' }) : await exportImg('png');
        const r = await api.put('/api/drive/upload?name=' + encodeURIComponent(fileName(kind === 'project' ? 'nbxphoto' : 'png')), blob, { type: kind === 'project' ? 'application/json' : 'image/png' });
        if (kind === 'project') driveId = r.item.id; toast(t('Saved to Drive'), 'good');
      } catch (e) { toastErr(e); }
    }
    async function openFromDrive() {
      let items = []; try { items = (await api.get('/api/drive/list?view=recent')).items.filter((x) => /\.nbxphoto$/i.test(x.name)); } catch (e) { return toastErr(e); }
      modal({ title: t('Open a design from Drive'), body: items.length ? h('div.col', { style: 'gap:6px' }, items.map((x) => h('button.btn', { type: 'button', onClick: async () => { try { const j = await (await fetch(x.url)).json(); if (j.app !== 'nebulix-photo') throw new Error(t('That is not a Nebulix Photo design')); commit(); doc = j.doc; name = j.name || x.name; nameIn.value = name; sel = null; paintPanels(); draw(); document.querySelector('.modal .actions button') && document.querySelector('.modal .actions button').click(); } catch (e) { toastErr(e); } } }, x.name))) : h('p.muted', t('No saved designs yet.')), actions: [{ label: t('Close') }] });
    }

    // ---------- panels ----------
    const toolsEl = h('div.ph-tools');
    function paintTools() {
      const b = (k, ic, label, fn) => h('button.ph-tool' + (tool === k ? '.on' : ''), { type: 'button', title: label, 'aria-label': label, 'aria-pressed': String(tool === k), onClick: fn }, icon(ic, 18));
      mount(toolsEl, b('move', 'mouse', t('Select and move'), () => { tool = 'move'; crop = null; paintTools(); draw(); }), b('', 'image', t('Add image'), pickImage), b('', 'edit', t('Add text'), addText), b('', 'grid', t('Add rectangle'), () => addShape('rect')), b('', 'target', t('Add ellipse'), () => addShape('ellipse')),
        b('crop', 'layers', t('Crop'), () => { tool = tool === 'crop' ? 'move' : 'crop'; crop = null; paintTools(); draw(); }), tool === 'crop' ? h('button.btn.sm.primary', { onClick: applyCrop }, t('Apply crop')) : null);
    }
    function paintPanels() {
      mount(layersEl, h('div.eyebrow', t('Layers')), doc.layers.length ? [...doc.layers].reverse().map((l) => h('div.ph-layer' + (l.id === sel ? '.on' : ''), { onClick: () => { sel = l.id; paintPanels(); draw(); } },
        h('button.btn.sm.ghost', { 'aria-label': l.visible ? t('Hide') : t('Show'), onClick: (e) => { e.stopPropagation(); commit(); l.visible = !l.visible; paintPanels(); draw(); } }, icon(l.visible ? 'eye' : 'x', 13)),
        h('span.grow', l.name || l.type), h('button.btn.sm.ghost', { 'aria-label': t('Move up'), onClick: (e) => { e.stopPropagation(); move(l, 1); } }, '↑'), h('button.btn.sm.ghost', { 'aria-label': t('Move down'), onClick: (e) => { e.stopPropagation(); move(l, -1); } }, '↓'))) : h('p.tiny.muted', t('Add an image, text or a shape.')),
        h('div.row', { style: 'gap:6px;margin-top:8px;align-items:center' }, h('span.tiny', t('Background')), h('input', { type: 'color', value: doc.bg === 'transparent' ? '#000000' : doc.bg, 'aria-label': t('Background colour'), onInput: (e) => { doc.bg = e.target.value; draw(); } }), h('label.tiny', h('input', { type: 'checkbox', checked: doc.bg === 'transparent', onChange: (e) => { commit(); doc.bg = e.target.checked ? 'transparent' : '#0f172a'; draw(); paintPanels(); } }), ' ', t('Transparent'))));
      const l = layer(); if (!l) { mount(propsEl, h('p.tiny.muted', t('Select a layer to change it.'))); return; }
      const num = (label, key, min, max, step = 1) => field(label, h('input.input', { type: 'number', min, max, step, value: Math.round(l[key] * 10) / 10, onChange: (e) => { commit(); l[key] = Number(e.target.value); draw(); } }));
      const rng = (label, get, set, min, max, unit) => { const o = h('b', get() + unit); return h('label.ph-range', h('span', label), h('input', { type: 'range', min, max, value: get(), 'aria-label': label, onPointerdown: commit, onInput: (e) => { set(Number(e.target.value)); o.textContent = e.target.value + unit; draw(); } }), o); };
      const parts = [h('div.eyebrow', t('Layer')), h('input.input', { value: l.name || '', 'aria-label': t('Layer name'), onChange: (e) => { l.name = e.target.value.slice(0, 40); paintPanels(); } }),
        h('div.ph-grid2', num('X', 'x', -9999, 9999), num('Y', 'y', -9999, 9999), num(t('Width'), 'w', 4, 9999), num(t('Height'), 'h', 4, 9999)),
        rng(t('Rotation'), () => l.rot || 0, (v) => { l.rot = v; }, -180, 180, '°'), rng(t('Opacity'), () => l.opacity ?? 100, (v) => { l.opacity = v; }, 0, 100, '%'),
        field(t('Blend mode'), h('select.input', { onChange: (e) => { commit(); l.blend = e.target.value; draw(); } }, BLENDS.map((b) => h('option', { value: b, selected: (l.blend || 'source-over') === b }, b === 'source-over' ? t('Normal') : b))))];
      if (l.type === 'text') parts.push(h('div.eyebrow', t('Text')), h('textarea.input', { rows: 3, onInput: (e) => { l.text = e.target.value; draw(); }, onFocus: commit }, l.text),
        h('div.ph-grid2', field(t('Font'), h('select.input', { onChange: (e) => { commit(); l.font = e.target.value; draw(); } }, FONTS.map((f) => h('option', { value: f, selected: l.font === f }, f)))), num(t('Size'), 'size', 6, 1000),
          field(t('Colour'), h('input', { type: 'color', value: l.color, onInput: (e) => { l.color = e.target.value; draw(); }, onPointerdown: commit })), field(t('Align'), h('select.input', { onChange: (e) => { commit(); l.align = e.target.value; draw(); } }, [['left', t('Left')], ['center', t('Center')], ['right', t('Right')]].map(([v, n]) => h('option', { value: v, selected: (l.align || 'center') === v }, n))))),
        h('div.row', { style: 'gap:10px;flex-wrap:wrap' }, h('label.tiny', h('input', { type: 'checkbox', checked: (l.weight || 400) >= 700, onChange: (e) => { commit(); l.weight = e.target.checked ? 800 : 400; draw(); } }), ' ', t('Bold')), h('label.tiny', h('input', { type: 'checkbox', checked: !!l.italic, onChange: (e) => { commit(); l.italic = e.target.checked; draw(); } }), ' ', t('Italic')), h('label.tiny', h('input', { type: 'checkbox', checked: !!l.shadow, onChange: (e) => { commit(); l.shadow = e.target.checked; draw(); } }), ' ', t('Shadow'))),
        h('div.ph-grid2', num(t('Outline'), 'strokeW', 0, 100), field(t('Outline colour'), h('input', { type: 'color', value: l.stroke || '#000000', onInput: (e) => { l.stroke = e.target.value; draw(); }, onPointerdown: commit }))));
      if (l.type === 'rect' || l.type === 'ellipse') parts.push(h('div.eyebrow', t('Shape')), h('div.ph-grid2', field(t('Fill'), h('input', { type: 'color', value: l.fill, onInput: (e) => { l.fill = e.target.value; draw(); }, onPointerdown: commit })), field(t('Border colour'), h('input', { type: 'color', value: l.stroke || '#ffffff', onInput: (e) => { l.stroke = e.target.value; draw(); }, onPointerdown: commit })), num(t('Border'), 'strokeW', 0, 200), l.type === 'rect' ? num(t('Corners'), 'radius', 0, 2000) : null));
      parts.push(h('div.eyebrow', t('Filters')), FILTERS.map(([k, label, min, max, def, unit]) => rng(t(label), () => (l.filters || {})[k] ?? def, (v) => { (l.filters = l.filters || {})[k] = v; }, min, max, unit)),
        h('button.btn.sm', { onClick: () => { commit(); l.filters = {}; paintPanels(); draw(); } }, t('Reset filters')),
        h('div.row', { style: 'gap:6px;margin-top:8px' }, h('button.btn.sm', { onClick: () => duplicate(l) }, icon('copy', 13), t('Duplicate')), h('button.btn.sm', { onClick: () => { commit(); l.locked = !l.locked; paintPanels(); } }, icon('lock', 13), l.locked ? t('Unlock') : t('Lock')), h('button.btn.sm.danger', { onClick: () => { commit(); doc.layers = doc.layers.filter((x) => x !== l); sel = null; paintPanels(); draw(); } }, icon('trash', 13), t('Delete'))));
      mount(propsEl, parts);
    }
    const bar = h('div.ph-bar', nameIn,
      h('button.btn.sm', { onClick: () => { const m = modal({ title: t('New design'), body: h('div.ph-tpls', TEMPLATES.map(([n, w, hh]) => h('button.btn', { type: 'button', onClick: () => { newDoc(w, hh); document.querySelector('.modal .actions button').click(); } }, h('b', t(n)), h('span.tiny.muted', ' ' + w + '×' + hh)))), actions: [{ label: t('Cancel') }] }); void m; } }, icon('plus', 14), t('New')),
      h('button.btn.sm', { onClick: openFromDrive }, icon('folder', 14), t('Open')), h('button.btn.sm', { onClick: sizeDialog }, t('Canvas size')),
      h('button.btn.sm.ghost', { title: t('Undo') + ' (Ctrl+Z)', 'aria-label': t('Undo'), onClick: doUndo }, '↶'), h('button.btn.sm.ghost', { title: t('Redo') + ' (Ctrl+Y)', 'aria-label': t('Redo'), onClick: doRedo }, '↷'), h('span.grow'),
      h('button.btn.sm', { onClick: () => toDrive('project') }, icon('upload', 14), t('Save to Drive')), h('button.btn.sm', { onClick: () => download('jpg') }, 'JPG'), h('button.btn.sm.primary', { onClick: () => download('png') }, icon('download', 14), 'PNG'));
    stageWrap.addEventListener('dragover', (e) => e.preventDefault()); stageWrap.addEventListener('drop', (e) => { e.preventDefault(); for (const f of e.dataTransfer.files) addImageFile(f); });
    const onPaste = (e) => { for (const it of e.clipboardData ? e.clipboardData.items : []) if (it.type.startsWith('image/')) { addImageFile(it.getAsFile()); e.preventDefault(); } }; document.addEventListener('paste', onPaste);
    mount(root, h('div.ph', bar, h('div.ph-main', toolsEl, h('div.ph-center', stageWrap), h('aside.ph-side', layersEl, propsEl))));
    mount(stageWrap, canvas); paintTools(); paintPanels(); draw();
    window.__nbxPhoto = { get doc() { return doc; }, exportImg }; // used by tests
    return () => { document.removeEventListener('paste', onPaste); delete window.__nbxPhoto; };
  },
};
