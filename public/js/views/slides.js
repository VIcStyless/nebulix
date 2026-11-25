// Nebulix Slides: presentations with themes, text boxes, images and shapes (drag to move, corner to resize),
// a slide strip, speaker-free fullscreen presenting with keyboard/clicks, and autosave.
import { h, mount, clamp } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { toast, toastErr, loading, emptyState } from '../ui.js';
import { officeHome, officeBar, autosaver } from '../office.js';
import { liveObj } from '../objlive.js';
import { peersEl } from '../doclive.js';

const THEMES = {
  nebula: { bg: 'linear-gradient(135deg,#1e1b4b,#4c1d95 60%,#0e7490)', fg: '#f8fafc', accent: '#a78bfa', font: 'system-ui' },
  paper: { bg: '#ffffff', fg: '#111827', accent: '#2563eb', font: 'Georgia, serif' },
  sunset: { bg: 'linear-gradient(160deg,#7c2d12,#db2777)', fg: '#fff7ed', accent: '#fde047', font: 'system-ui' },
  forest: { bg: 'linear-gradient(160deg,#052e16,#166534)', fg: '#ecfccb', accent: '#a3e635', font: 'system-ui' },
  mono: { bg: '#0a0a0a', fg: '#fafafa', accent: '#fafafa', font: 'ui-monospace, monospace' },
  candy: { bg: 'linear-gradient(135deg,#fbcfe8,#c7d2fe)', fg: '#3b0764', accent: '#db2777', font: 'ui-rounded, system-ui' },
};
const rid = () => Math.random().toString(36).slice(2, 8);
const TPL = [
  ['Blank presentation', null, ''],
  ['Pitch', () => ({ theme: 'nebula', slides: [
    { id: rid(), els: [{ id: rid(), type: 'text', x: 8, y: 32, w: 84, h: 18, text: 'Mi gran idea', size: 60, bold: true, align: 'center' }, { id: rid(), type: 'text', x: 15, y: 54, w: 70, h: 10, text: 'Presentación para inversores', size: 26, align: 'center' }] },
    { id: rid(), els: [{ id: rid(), type: 'text', x: 6, y: 8, w: 88, h: 12, text: 'El problema', size: 44, bold: true }, { id: rid(), type: 'text', x: 6, y: 26, w: 88, h: 60, text: '• Punto 1\n• Punto 2\n• Punto 3', size: 28 }] },
    { id: rid(), els: [{ id: rid(), type: 'text', x: 6, y: 8, w: 88, h: 12, text: 'La solución', size: 44, bold: true }, { id: rid(), type: 'shape', shape: 'circle', x: 60, y: 30, w: 26, h: 46, color: '#a78bfa' }, { id: rid(), type: 'text', x: 6, y: 30, w: 50, h: 50, text: 'Explica aquí tu solución en dos o tres frases.', size: 26 }] }] }), '🚀'],
  ['Class', () => ({ theme: 'paper', slides: [{ id: rid(), els: [{ id: rid(), type: 'text', x: 8, y: 34, w: 84, h: 16, text: 'Tema 5: El sistema solar', size: 52, bold: true, align: 'center' }, { id: rid(), type: 'text', x: 20, y: 56, w: 60, h: 8, text: 'Ciencias · 2º ESO', size: 24, align: 'center' }] }] }), '🪐'],
];

export default {
  full: true,
  title: () => 'Nebulix Slides',
  async mount(root, ctx) {
    const id = ctx.params[0];
    if (!id) return officeHome(root, ctx, { kind: 'slides', route: 'slides', name: 'Nebulix Slides', emoji: '📽️', color: '#f59e0b', templates: TPL.map(([l, d, p]) => [t(l), d, p]) });
    const wrap = h('div.of.slides'); mount(root, wrap, loading());
    let it; try { it = (await api.get('/api/drive/item/' + encodeURIComponent(id))).item; } catch (e) { mount(wrap, emptyState('alert', t('Presentation not found'), e.message)); return () => {}; }
    ctx.setTitle && ctx.setTitle(it.name);
    const data = Object.assign({ theme: 'nebula', slides: [] }, it.data || {}); if (!data.slides.length) data.slides.push({ id: rid(), els: [] });
    let cur = 0; let selEl = null; const edit = it.canEdit; let live = null; let peerList = [];
    const peersBox = peersEl(); const liveTag = h('span.dl-status', { hidden: true });
    const bar = officeBar(it, { emoji: '📽️', onRename: async (n) => { try { await api.put('/api/drive/item/' + it.id, { name: n }); } catch (e) { toastErr(e); } }, extra: h('div.row', { style: 'gap:6px' }, peersBox, liveTag, h('button.btn.sm', { onClick: () => present() }, icon('play', 14), t('Present'))) });
    const save = autosaver(it.id, bar); const changed = () => { if (edit) { if (live && live.everLive) live.changed(); else save(JSON.parse(JSON.stringify(data))); } paintStrip(); };
    const th = () => THEMES[data.theme] || THEMES.nebula;
    const slide = () => data.slides[cur];
    const addEl = (el) => { el.id = rid(); slide().els.push(el); selEl = el.id; paintStage(); changed(); };
    const tools = h('div.dc-tools',
      h('button.dc-b', { title: t('New slide'), onClick: () => { data.slides.splice(cur + 1, 0, { id: rid(), els: [{ id: rid(), type: 'text', x: 6, y: 8, w: 88, h: 12, text: t('Title'), size: 44, bold: true }, { id: rid(), type: 'text', x: 6, y: 26, w: 88, h: 60, text: '• ', size: 28 }] }); cur++; paintAll(); changed(); } }, icon('plus', 15), ' ' + t('Slide')), h('i.dc-sep'),
      h('button.dc-b', { title: t('Text box'), onClick: () => addEl({ type: 'text', x: 20, y: 40, w: 60, h: 12, text: t('Text'), size: 32 }) }, 'T'),
      h('button.dc-b', { title: t('Rectangle'), onClick: () => addEl({ type: 'shape', shape: 'rect', x: 35, y: 35, w: 30, h: 30, color: th().accent }) }, '▭'),
      h('button.dc-b', { title: t('Circle'), onClick: () => addEl({ type: 'shape', shape: 'circle', x: 40, y: 35, w: 20, h: 35, color: th().accent }) }, '◯'),
      h('button.dc-b', { title: t('Image'), onClick: () => { const inp = h('input', { type: 'file', accept: 'image/*' }); inp.onchange = () => { const f = inp.files[0]; if (!f) return; if (f.size > 700000) { toast(t('Images up to 700 KB in slides.'), 'err'); return; } const r = new FileReader(); r.onload = () => addEl({ type: 'image', x: 25, y: 20, w: 50, h: 60, src: r.result }); r.readAsDataURL(f); }; inp.click(); } }, icon('image', 15)), h('i.dc-sep'),
      h('select.dc-sel', { title: t('Theme'), onChange: (e) => { data.theme = e.target.value; paintAll(); changed(); } }, Object.keys(THEMES).map((k) => h('option', { value: k, selected: k === data.theme }, k))), h('i.dc-sep'),
      h('button.dc-b', { title: t('Bigger text'), onClick: () => mod((e) => { e.size = clamp((e.size || 28) + 4, 10, 140); }) }, 'A+'), h('button.dc-b', { title: t('Smaller text'), onClick: () => mod((e) => { e.size = clamp((e.size || 28) - 4, 10, 140); }) }, 'A−'),
      h('button.dc-b', { title: t('Bold'), onClick: () => mod((e) => { e.bold = !e.bold; }) }, h('b', 'B')), h('button.dc-b', { title: t('Center'), onClick: () => mod((e) => { e.align = e.align === 'center' ? 'left' : 'center'; }) }, '≡'),
      h('input.dc-col', { type: 'color', title: t('Colour'), value: '#a78bfa', onInput: (ev) => mod((e) => { e.color = ev.target.value; }) }),
      h('button.dc-b', { title: t('Delete element'), onClick: () => { if (!selEl) return; slide().els = slide().els.filter((x) => x.id !== selEl); selEl = null; paintStage(); changed(); } }, icon('trash', 15)),
      h('button.dc-b', { title: t('Delete slide'), onClick: () => { if (data.slides.length < 2) return; data.slides.splice(cur, 1); cur = Math.max(0, cur - 1); paintAll(); changed(); } }, '✕'));
    function mod(fn) { const e = slide().els.find((x) => x.id === selEl); if (!e) return; fn(e); paintStage(); changed(); }
    const strip = h('div.sl-strip'); const stage = h('div.sl-stage'); const stageWrap = h('div.sl-stagewrap', stage);
    function renderSlide(s, { interactive } = {}) {
      const T = th(); const el = h('div.sl-slide', { style: `background:${s.bg || T.bg};color:${T.fg};font-family:${T.font}` });
      for (const e of s.els) {
        const st = `left:${e.x}%;top:${e.y}%;width:${e.w}%;height:${e.h}%;`;
        let node;
        if (e.type === 'text') node = h('div.sl-el.sl-text', { style: st + `font-size:calc(${e.size || 28} * var(--u));font-weight:${e.bold ? 800 : 400};text-align:${e.align || 'left'};${e.color ? 'color:' + e.color : ''}` }, e.text);
        else if (e.type === 'shape') node = h('div.sl-el.sl-shape', { style: st + `background:${e.color || T.accent};border-radius:${e.shape === 'circle' ? '50%' : '6%'}` });
        else if (e.type === 'image') node = h('div.sl-el', { style: st }, h('img', { src: /^data:image\/(png|jpeg|gif|webp);base64,/.test(e.src || '') ? e.src : '', alt: '', draggable: false }));
        if (!node) continue;
        if (interactive) {
          node.dataset.id = e.id; if (e.id === selEl) node.classList.add('sel');
          if (e.type === 'text') { node.contentEditable = edit ? 'true' : 'false'; node.addEventListener('input', () => { e.text = node.innerText; changed(); }); }
          if (edit) {
            node.addEventListener('pointerdown', (ev) => { if (ev.target.classList.contains('sl-h')) return; selEl = e.id; stage.querySelectorAll('.sel').forEach((x) => x.classList.remove('sel')); node.classList.add('sel'); if (document.activeElement === node) return; drag(ev, e, node, false); });
            node.append(h('i.sl-h', { onPointerdown: (ev) => { ev.stopPropagation(); drag(ev, e, node, true); } }));
          }
        }
        el.append(node);
      }
      return el;
    }
    function drag(ev, e, node, resize) {
      const r = stage.getBoundingClientRect(); const sx = ev.clientX, sy = ev.clientY; const o = { x: e.x, y: e.y, w: e.w, h: e.h }; let moved = false;
      const mv = (m) => { const dx = ((m.clientX - sx) / r.width) * 100; const dy = ((m.clientY - sy) / r.height) * 100; if (Math.abs(dx) + Math.abs(dy) > 0.5) moved = true; if (!moved) return;
        if (resize) { e.w = clamp(o.w + dx, 3, 100 - e.x); e.h = clamp(o.h + dy, 3, 100 - e.y); } else { e.x = clamp(o.x + dx, -10, 100 - e.w / 2); e.y = clamp(o.y + dy, -10, 100 - e.h / 2); }
        node.style.left = e.x + '%'; node.style.top = e.y + '%'; node.style.width = e.w + '%'; node.style.height = e.h + '%'; };
      const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); if (moved) changed(); };
      addEventListener('pointermove', mv); addEventListener('pointerup', up);
    }
    function paintStage() { mount(stage, renderSlide(slide(), { interactive: true })); fitUnits(); }
    function paintStrip() { if (live && data.slides[cur]) live.cursor('s:' + data.slides[cur].id); mount(strip, data.slides.map((s, i) => h('button.sl-th' + (i === cur ? '.on' : ''), { type: 'button', onClick: () => { cur = i; selEl = null; paintAll(); } }, h('span.sl-n', i + 1), h('span.sl-peers', peerList.filter((p) => p.at === 's:' + s.id).map((p) => h('i', { style: 'background:' + p.color, title: p.displayName }))), h('div.sl-mini', renderSlide(s))))); for (const m of strip.querySelectorAll('.sl-mini')) m.style.setProperty('--u', (m.clientWidth / 1000) + 'px'); }
    function fitUnits() { const w = stage.clientWidth || 800; stage.style.setProperty('--u', (w / 1000) + 'px'); }
    function paintAll() { paintStrip(); paintStage(); }
    function present() {
      let i = cur; const ov = h('div.sl-present', { tabindex: 0 }); document.body.append(ov);
      const show = () => { mount(ov, renderSlide(data.slides[i])); ov.style.setProperty('--u', (Math.min(innerWidth, innerHeight * 16 / 9) / 1000) + 'px'); };
      const key = (e) => { if (['ArrowRight', ' ', 'PageDown', 'Enter'].includes(e.key)) { i = Math.min(data.slides.length - 1, i + 1); show(); } else if (['ArrowLeft', 'PageUp', 'Backspace'].includes(e.key)) { i = Math.max(0, i - 1); show(); } else if (e.key === 'Escape') close(); };
      const close = () => { removeEventListener('keydown', key); try { document.exitFullscreen(); } catch {} ov.remove(); };
      ov.addEventListener('click', (e) => { if (e.clientX < innerWidth / 3) i = Math.max(0, i - 1); else i = Math.min(data.slides.length - 1, i + 1); show(); });
      addEventListener('keydown', key); try { ov.requestFullscreen(); } catch {} document.addEventListener('fullscreenchange', function fc() { if (!document.fullscreenElement) { document.removeEventListener('fullscreenchange', fc); close(); } });
      show(); ov.focus();
    }
    mount(wrap, bar, edit ? tools : null, h('div.sl-body', strip, stageWrap));
    const ro = new ResizeObserver(() => { fitUnits(); }); ro.observe(stage);
    // ---- live co-editing (3.0) ----
    const ST = { live: ['Live', 'good'], saving: ['Live', 'good'], connecting: ['Connecting…', ''], reconnecting: ['Reconnecting…', 'warn'], offline: ['Offline — changes will be sent when you reconnect', 'warn'] };
    function setData(d) {
      const curId = data.slides[cur] && data.slides[cur].id; const old = new Map(data.slides.map((x) => [x.id, x]));
      const next = d.slides.map((x) => { const o = old.get(x.id); return o && JSON.stringify(o) === JSON.stringify(x) ? o : x; }); // keep unchanged slide objects
      const curChanged = !next.some((x) => x === old.get(curId));
      data.slides.splice(0, data.slides.length, ...next); for (const [k, v] of Object.entries(d)) if (k !== 'slides') data[k] = v;
      if (!data.slides.length) data.slides.push({ id: rid(), els: [] });
      const ni = data.slides.findIndex((x) => x.id === curId); cur = ni >= 0 ? ni : Math.min(cur, data.slides.length - 1);
      paintStrip();
      if (curChanged) { const focusId = document.activeElement && stage.contains(document.activeElement) && document.activeElement.dataset.id; paintStage(); if (focusId) { const n = stage.querySelector('[data-id="' + focusId + '"]'); if (n) { n.focus(); const r = document.createRange(); r.selectNodeContents(n); r.collapse(false); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); } } }
    }
    live = liveObj(it, { kind: 'slides', getData: () => data, canEdit: () => edit, beforeJoin: () => save.flush(), setData,
      onStatus: (st) => { const x = ST[st]; liveTag.hidden = !x; if (x) { liveTag.textContent = t(x[0]); liveTag.className = 'dl-status ' + x[1]; } if (st === 'saving') bar.saving(); if (st === 'live' && data.slides[cur]) live && live.cursor('s:' + data.slides[cur].id); },
      onSaved: () => bar.saved(), onPeers: (list) => { peerList = list; peersBox.set(list); paintStrip(); },
      onLost: (why) => { if (why === 'too_big') toast(t('This document is too large (2 MB)'), 'err'); else if (why === 'read_only') toast(t('You can only read this document now'), 'err'); } });
    paintAll();
    return () => { ro.disconnect(); const lost = live.everLive && !live.live && live.unsent; live.destroy(); if (lost && edit) save(JSON.parse(JSON.stringify(data))); save.flush(); };
  },
};
