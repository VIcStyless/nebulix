// Appearance: one page to change the whole look — where the menu lives (with live previews), the design skin and the
// colour theme. Everything applies instantly; layout and design are saved on this device, the theme on the account.
import { h, mount } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { toast, toastErr } from '../ui.js';
import { liveBgCfg, setLiveBg } from '../livebg.js';
import * as theme from '../theme.js';
import { LAYOUTS, setLayout, layoutNow, DESIGNS, designNow, setDesign } from '../app.js';
import * as FX from '../fx14.js';
import { ls } from '../util.js';

const ns = 'http://www.w3.org/2000/svg';
const svg = (w, hh, kids) => { const s = document.createElementNS(ns, 'svg'); s.setAttribute('viewBox', `0 0 ${w} ${hh}`); for (const [tag, a] of kids) { const e = document.createElementNS(ns, tag); for (const k in a) e.setAttribute(k, a[k]); s.appendChild(e); } return s; };
// mini drawings of each menu layout (120×76): nav = accent, content = muted blocks
const R = (x, y, w, hh, cls, rx = 2) => ['rect', { x, y, width: w, height: hh, rx, class: cls }];
const content = (x, y, w, hh) => [R(x, y, w, 6, 'lk-t'), R(x, y + 10, w * 0.62, hh - 10, 'lk-c', 3), R(x + w * 0.66, y + 10, w * 0.34, hh - 10, 'lk-c', 3)];
const SHOTS = {
  nexus: () => [R(0, 0, 14, 76, 'lk-n', 0), ...[8, 18, 28, 38, 48].map((y) => R(3, y, 8, 7, 'lk-i', 2)), R(16, 4, 34, 68, 'lk-o', 4), ...[10, 20, 30, 40].map((y) => R(20, y, 6, 6, 'lk-g', 2)), ...[10, 20, 30, 40].map((y) => R(29, y + 1, 18, 4, 'lk-i')), ...content(54, 6, 60, 64)],
  left: () => [R(0, 0, 26, 76, 'lk-n', 0), ...[10, 18, 26, 34, 42].map((y) => R(5, y, 16, 4, 'lk-i')), ...content(32, 6, 82, 64)],
  right: () => [R(94, 0, 26, 76, 'lk-n', 0), ...[10, 18, 26, 34, 42].map((y) => R(99, y, 16, 4, 'lk-i')), ...content(6, 6, 82, 64)],
  top: () => [R(0, 0, 120, 12, 'lk-n', 0), ...[6, 20, 34, 48, 62].map((x) => R(x, 4, 10, 4, 'lk-i')), ...content(8, 18, 104, 52)],
  dock: () => [...content(8, 6, 104, 52), R(30, 63, 60, 10, 'lk-n', 5), ...[35, 45, 55, 65, 75].map((x) => R(x, 66, 6, 4, 'lk-i', 2))],
  compact: () => [R(0, 0, 12, 76, 'lk-n', 0), ...[8, 16, 24, 32, 40].map((y) => R(3, y, 6, 5, 'lk-i')), ...content(18, 6, 96, 64)],
  float: () => [R(4, 4, 26, 68, 'lk-n', 6), ...[12, 20, 28, 36, 44].map((y) => R(9, y, 16, 4, 'lk-i')), ...content(36, 6, 78, 64)],
  island: () => [R(28, 3, 64, 10, 'lk-n', 5), ...[34, 46, 58, 70, 80].map((x) => R(x, 6, 7, 4, 'lk-i')), ...content(8, 18, 104, 52)],
  launcher: () => [...content(8, 6, 104, 64), R(4, 60, 13, 13, 'lk-n', 7), ...[[40, 22], [54, 22], [68, 22], [40, 36], [54, 36], [68, 36]].map(([x, y]) => R(x, y, 10, 10, 'lk-g', 3)), R(34, 16, 50, 34, 'lk-o', 5)],
};
const DESIGN_INFO = {
  fourteen: 'Floating glass, aurora light, glowing markers and springy motion. The new default look.', dev: 'Dense, square and quiet, like a code-hosting site.', cyber: 'Cut corners, scanlines and glitchy titles.',
  kawaii: 'Pastel, puffy and bouncy. Everything is round.', bevel: 'Bevelled buttons and title bars from a late-90s computer.', bento: 'Big calm tiles and huge titles.',
  holo: 'Iridescent foil that slowly shifts colour.', sketch: 'Hand-drawn wobbly lines, like a notebook.',
  seven: 'Floating glass panels, gradient buttons and soft motion. The look of Nebulix 7 to 13.', classic: 'Clean cards with soft depth. The look before 7.0.', glass: 'Frosted, translucent panels over the animated background.', brutal: 'Thick borders, hard shadows, loud type.',
  retro: 'Monospace terminal with scanlines and glow.', paper: 'Editorial serif type and quiet lines.', neon: 'Cut corners and glowing edges.',
  soft: 'Puffy, rounded “clay” shapes with gentle shadows.', minimal: 'No boxes, only spacing and thin lines.', comic: 'Bold outlines, tilted stickers and halftone dots.', aurora: 'Glowing gradient borders that slowly shift colour.',
};

export default {
  title: () => t('Appearance'),
  async mount(root) {
    const inner = h('div.inner.lk'); mount(root, inner);
    // animated background (from the Hub)
    const bgBox = h('div.card');
    async function paintBg() {
      const c = liveBgCfg(); let w = null; if (c.id) { try { w = await api.get('/api/hub/' + c.id + '/wall', { quiet: true }); } catch {} }
      const slider = (label, key, min, max, step, fmtv) => { const val = h('span.tiny.muted', fmtv(c[key])); const inp = h('input', { type: 'range', min, max, step, value: c[key], onInput: (e) => { val.textContent = fmtv(Number(e.target.value)); }, onChange: async (e) => { try { await setLiveBg({ [key]: Number(e.target.value) }); } catch (er) { toastErr(er); } } }); return [h('span.small', label), inp, val]; };
      mount(bgBox, w ? h('div.lbg-card', h('div.lbg-prev', { style: { backgroundImage: w.thumb ? `url(${w.thumb})` : 'none' } }), h('div.grow', h('b', w.title), h('div.tiny.muted', t({ video: 'Video', image: 'Image', html: 'Animated page' }[w.wtype] || 'Background')),
        h('div.lbg-ctl', slider(t('Darken'), 'dim', 0, 0.85, 0.05, (v) => Math.round(v * 100) + '%'), slider(t('Blur'), 'blur', 0, 20, 1, (v) => v + 'px'), w.wtype === 'video' ? slider(t('Speed'), 'speed', 0.25, 2, 0.25, (v) => v + '×') : [])),
        h('div.col', { style: 'gap:6px' }, h('a.btn.sm', { href: '#/hub?kind=wall' }, icon('search', 14), t('Change')), h('button.btn.sm.ghost', { onClick: async () => { try { await setLiveBg({ id: '' }); paintBg(); } catch (e) { toastErr(e); } } }, icon('x', 14), t('Remove'))))
        : h('div.lbg-card', h('div.grow', h('b', t('No animated background')), h('div.small.muted', t('Pick a video, GIF or animated page from Nebulix Hub, or upload your own. It plays behind the whole app.'))), h('a.btn.primary', { href: '#/hub?kind=wall' }, icon('image', 15), t('Browse backgrounds'))));
    }
    paintBg();
    const paint = () => {
      const lay = layoutNow(); const des = designNow(); const cur = theme.getTheme();
      mount(inner,
        h('div.page-title', h('div', h('h2', icon('palette', 22), ' ', t('Appearance')), h('p', t('Change where the menu lives, the design and the colours. Everything applies instantly.')))),
        h('h3.lk-h', icon('spark', 17), ' ', t('Total makeover'), h('span.tiny.muted', ' · ' + t('changes everything at once'))),
        h('div.f14-mk-grid', FX.MAKEOVERS.map((mk) => { const th = FX.makeoverTheme(mk); const c = th.colors; const on = FX.makeoverNow() === mk.id;
          return h('button.f14-mk' + (on ? '.on' : ''), { type: 'button', onClick: async () => { setDesign(mk.design); setLayout(mk.layout); const ap = theme.apply(th); FX.setScreenFx(mk.fx || 'none'); ls('fx14.mk', mk.id); paint(); toast(t('New look: {n}', { n: t(mk.name) }), 'good', 1800); try { await api.patch('/api/profile', { settings: { activeTheme: ap } }); } catch {} } },
            h('div.f14-mk-art', { style: { background: `linear-gradient(135deg, ${c.bg}, ${th.bg.c1 || c.bg})` } }, h('i.a1', { style: { background: c.surface, borderRadius: Math.min(th.ui.radius, 10) + 'px' } }), h('i.a2', { style: { background: c.surface2 } }), h('i.a3', { style: { background: c.surface, border: '1px solid ' + c.border, borderRadius: Math.min(th.ui.radius, 12) + 'px' } }), h('i.a4', { style: { background: `linear-gradient(135deg, ${c.accent}, ${c.accent2})`, borderRadius: Math.min(th.ui.radius, 12) + 'px' } }), h('b', mk.emoji)),
            h('div.f14-mk-txt', h('b', on ? '✓ ' : '', t(mk.name)), h('span', t(mk.desc)))); })),
        h('h3.lk-h', icon('star', 17), ' ', t('Screen effects'), h('span.tiny.muted', ' · ' + t('over the whole app'))),
        h('div.f14-fx-row', FX.SCREEN_FX.map(([k, l, e]) => h('button' + (FX.screenFxNow() === k ? '.on' : ''), { type: 'button', onClick: () => { FX.setScreenFx(k); paint(); } }, e + ' ' + t(l)))),
        h('h3.lk-h', icon('target', 17), ' ', t('Cursor effects')),
        (() => { const pf = FX.pointerFxNow(); const tog = (k, l, e) => h('button' + (pf[k] ? '.on' : ''), { type: 'button', onClick: () => { FX.setPointerFx(Object.assign({}, pf, { [k]: !pf[k] })); paint(); } }, e + ' ' + t(l) + (pf[k] ? ' ✓' : '')); return h('div.f14-fx-row', tog('click', 'Sparks when you click', '✨'), tog('trail', 'Glowing cursor trail', '☄️')); })(),
        h('h3.lk-h', icon('sun', 17), ' ', t('Day and night'), h('span.tiny.muted', ' · ' + t('switch theme by the time of day'))),
        (() => { const dn = FX.dayNightNow(); const names = theme.PRESETS.map((p) => p.name); const save = (patch) => { FX.setDayNight(Object.assign({}, dn, patch)); paint(); };
          const sel = (v, on) => h('select.select', { style: 'width:auto', onChange: (e) => on(e.target.value) }, names.map((n) => h('option', { value: n, selected: n === v }, n)));
          const hr = (v, on) => h('select.select', { style: 'width:auto', onChange: (e) => on(Number(e.target.value)) }, Array.from({ length: 24 }, (_, i) => h('option', { value: i, selected: i === v }, String(i).padStart(2, '0') + ':00')));
          return h('div.card.row', { style: 'gap:10px;flex-wrap:wrap;align-items:center' }, h('label.row', { style: 'gap:8px;align-items:center' }, h('input', { type: 'checkbox', checked: dn.on, onChange: (e) => save({ on: e.target.checked }) }), h('b', t('Automatic'))),
            h('span', '☀️ ' + t('Day')), sel(dn.day, (v) => save({ day: v })), h('span', t('from')), hr(dn.from, (v) => save({ from: v })), h('span', '🌙 ' + t('Night')), sel(dn.night, (v) => save({ night: v })), h('span', t('from')), hr(dn.to, (v) => save({ to: v }))); })(),
        h('h3.lk-h', icon('layout', 17), ' ', t('Menu layout'), h('span.tiny.muted', ' · ' + t('saved on this device'))),
        h('div.lk-grid', LAYOUTS.map(([k, l]) => h('button.lk-card' + (k === lay ? '.on' : ''), { type: 'button', onClick: () => { setLayout(k); paint(); toast(t('Layout: {n}', { n: t(l) }), 'good', 1400); } },
          h('div.lk-shot', svg(120, 76, SHOTS[k] ? SHOTS[k]() : [])), h('div.lk-name', k === lay ? icon('check', 14) : null, t(l))))),
        h('p.tiny.muted', t('On phones the menu always stays at the bottom of the screen.')),
        h('h3.lk-h', icon('star', 17), ' ', t('Design'), h('span.tiny.muted', ' · ' + t('works with any colour theme'))),
        h('div.lk-grid.lk-des', DESIGNS.map(([k, l]) => h('button.lk-card.lk-d-' + k + (k === des ? '.on' : ''), { type: 'button', onClick: () => { setDesign(k); paint(); } },
          h('div.lk-dprev', h('i'), h('i'), h('b', 'Aa')), h('div.lk-name', k === des ? icon('check', 14) : null, t(l)), h('div.tiny.muted', t(DESIGN_INFO[k] || ''))))),
        h('h3.lk-h', icon('image', 17), ' ', t('Animated background'), h('span.tiny.muted', ' · ' + t('from Nebulix Hub'))), bgBox,
        h('h3.lk-h', icon('palette', 17), ' ', t('Colour theme'), h('a.tiny', { href: '#/themes', style: 'margin-left:auto' }, t('Open the theme studio') + ' →')),
        h('div.lk-themes', theme.PRESETS.map((p) => { const c = Object.assign({}, theme.DEFAULT.colors, p.colors); const on = cur && cur.name === p.name;
          return h('button.lk-th' + (on ? '.on' : ''), { type: 'button', title: p.name, onClick: async () => { const th = theme.apply(theme.fromPreset(p)); paint(); try { await api.patch('/api/profile', { settings: { activeTheme: th } }); } catch {} toast(t('Theme applied: {n}', { n: p.name }), 'good', 1400); } },
            h('div.lk-sw', { style: { background: c.bg } }, h('i', { style: { background: c.surface } }), h('i', { style: { background: c.accent } }), h('i', { style: { background: c.accent2 } })), h('span', p.name)); })));
    };
    paint();
    return () => {};
  },
};
