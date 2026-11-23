// Themes: community gallery, built-in presets, a full-featured Studio (live preview on the whole app), import/export (NBX1 codes or JSON) and publishing.
import { h, mount, fmt, ls, throttle, download, pickFile, readFile, clamp } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { S, setMe, isStaff } from '../state.js';
import { icon } from '../icons.js';
import * as theme from '../theme.js';
import { toast, toastErr, confirmBox, promptBox, modal, openMenu, tabsEl, segEl, emptyState, loading, copyBtn, field, busy, switchEl } from '../ui.js';
import { sfx } from '../sfx.js';

const BG_LABEL = { stars: 'Starfield', nebula: 'Nebula', aurora: 'Aurora', grid: 'Retro grid', particles: 'Particle network', waves: 'Waves', matrix: 'Glyph rain', bokeh: 'Bokeh lights', bubbles: 'Bubbles', blobs: 'Liquid blobs', mesh: 'Soft mesh', lava: 'Lava lamp', gradient: 'Gradient', solid: 'Solid colour', image: 'Image' };
const FONT_LABEL = { system: 'System', rounded: 'Rounded', mono: 'Monospace', serif: 'Serif', pixel: 'Pixel / terminal' };
const SURFACE_LABEL = { flat: 'Flat', glass: 'Glass', aero: 'Aero (glossy)', mica: 'Mica (Win 11)', neo: 'Neumorphism' };
const COLOR_LABEL = { bg: 'Background', surface: 'Panels', surface2: 'Panels (alt)', text: 'Text', muted: 'Muted text', accent: 'Accent', accent2: 'Accent 2', success: 'Success', warn: 'Warning', danger: 'Danger', border: 'Borders' };

// ---------- colour helpers ----------
const hex2rgb = (x) => { const m = /^#?([0-9a-f]{6})/i.exec(x || ''); const n = m ? parseInt(m[1], 16) : 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lum = (hx) => { const [r, g, b] = hex2rgb(hx).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
function hsl(hh, s, l) { s /= 100; l /= 100; const k = (n) => (n + hh / 30) % 12; const a = s * Math.min(l, 1 - l); const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); const x = (v) => Math.round(v * 255).toString(16).padStart(2, '0'); return '#' + x(f(0)) + x(f(8)) + x(f(4)); }
function randomTheme() {
  const hue = Math.floor(Math.random() * 360); const light = Math.random() < 0.18; const h2 = (hue + 40 + Math.floor(Math.random() * 100)) % 360;
  const colors = light
    ? { bg: hsl(hue, 70, 96), surface: '#ffffff', surface2: hsl(hue, 70, 93), text: hsl(hue, 45, 14), muted: hsl(hue, 20, 42), accent: hsl(hue, 80, 52), accent2: hsl(h2, 85, 50), success: '#059669', warn: '#d97706', danger: '#e11d48', border: hsl(hue, 60, 85) }
    : { bg: hsl(hue, 60, 5), surface: hsl(hue, 50, 11), surface2: hsl(hue, 48, 16), text: hsl(hue, 100, 95), muted: hsl(hue, 30, 68), accent: hsl(hue, 90, 64), accent2: hsl(h2, 90, 62), success: '#34d399', warn: '#fbbf24', danger: '#fb7185', border: hsl(hue, 45, 28) };
  const types = ['stars', 'nebula', 'aurora', 'grid', 'gradient'];
  return theme.normalize({ name: 'Surprise ' + hue, mode: light ? 'light' : 'dark', colors, bg: { type: light ? 'gradient' : types[Math.floor(Math.random() * types.length)], c1: hsl(hue, 70, light ? 92 : 14), c2: hsl(hue, 60, light ? 97 : 5), c3: hsl(h2, 75, light ? 90 : 26), angle: Math.floor(Math.random() * 360), stars: { density: 0.3 + Math.random() * 0.6, speed: Math.random() * 1.2, twinkle: Math.random(), color: '#ffffff' } },
    ui: { radius: [4, 8, 14, 20, 26][Math.floor(Math.random() * 5)], glow: Math.round(Math.random() * 90) / 100, blur: 8 + Math.floor(Math.random() * 18), font: ['system', 'rounded', 'mono'][Math.floor(Math.random() * 3)] } });
}

// ---------- preview card ----------
function bgCss(b, c) {
  const dim = b.dim > 0 ? `linear-gradient(rgba(0,0,0,${b.dim}), rgba(0,0,0,${b.dim})), ` : '';
  const dots = `radial-gradient(1.4px 1.4px at 18% 28%, #fff, transparent), radial-gradient(1px 1px at 62% 18%, #fffc, transparent), radial-gradient(1.6px 1.6px at 80% 62%, #fff, transparent), radial-gradient(1px 1px at 34% 76%, #fffa, transparent), radial-gradient(1.2px 1.2px at 52% 48%, #fff9, transparent)`;
  if (b.type === 'gradient') return `${dim}linear-gradient(${b.angle}deg, ${b.c1}, ${b.c2}, ${b.c3})`;
  if (b.type === 'solid') return `${dim}${b.c2}`;
  if (b.type === 'image' && b.image) return `${dim}url("${b.image}") center / cover`;
  if (b.type === 'grid') return `${dim}linear-gradient(${b.c3}66 1px, transparent 1px) 0 0 / 14px 14px, linear-gradient(90deg, ${b.c3}66 1px, transparent 1px) 0 0 / 14px 14px, linear-gradient(180deg, ${b.c1}, ${b.c2})`;
  if (b.type === 'aurora') return `${dim}radial-gradient(ellipse at 20% 0%, ${c.accent}88, transparent 55%), radial-gradient(ellipse at 85% 10%, ${b.c3}aa, transparent 50%), linear-gradient(180deg, ${b.c1}, ${b.c2})`;
  if (b.type === 'nebula') return `${dim}radial-gradient(circle at 25% 35%, ${b.c3}cc, transparent 45%), radial-gradient(circle at 78% 70%, ${c.accent}66, transparent 48%), linear-gradient(180deg, ${b.c1}, ${b.c2})`;
  return `${dim}${dots}, radial-gradient(circle at 30% 20%, ${b.c3}88, transparent 55%), linear-gradient(180deg, ${b.c1}, ${b.c2})`;
}
function previewEl(th, { big = false } = {}) {
  const n = theme.normalize(th); const v = theme.varsOf(n);
  return h('div.th-prev' + (big ? '.big' : ''), { style: Object.assign({}, v, { background: bgCss(n.bg, n.colors), color: n.colors.text, fontFamily: v['--font'] }), 'aria-hidden': 'true' },
    h('div.th-bar', { style: { background: n.colors.surface, borderColor: n.colors.border } }, h('i', { style: { background: n.colors.danger } }), h('i', { style: { background: n.colors.warn } }), h('i', { style: { background: n.colors.success } }), h('span', { style: { background: n.colors.surface2 } })),
    h('div.th-body', h('div.th-side', { style: { background: n.colors.surface, borderColor: n.colors.border } }, [0, 1, 2, 3].map((i) => h('b', { style: { background: i === 0 ? n.colors.accent : n.colors.surface2, borderRadius: Math.min(n.ui.radius, 10) + 'px' } }))),
      h('div.th-main', h('div.th-card', { style: { background: n.colors.surface, borderColor: n.colors.border, borderRadius: Math.min(n.ui.radius, 16) + 'px', boxShadow: `0 6px 18px rgba(0,0,0,${0.15 + n.ui.shadow * 0.35}), 0 0 ${n.ui.glow * 22}px ${n.colors.accent}44` } },
        h('span.th-t', { style: { background: n.colors.text } }), h('span.th-l', { style: { background: n.colors.muted } }), h('span.th-l.s', { style: { background: n.colors.muted } }),
        h('div.th-row', h('span.th-btn', { style: { background: `linear-gradient(135deg, ${n.colors.accent}, ${n.colors.accent2})`, borderRadius: Math.min(n.ui.radius, 12) + 'px' } }), h('span.th-chip', { style: { background: n.colors.surface2, borderColor: n.colors.border, borderRadius: Math.min(n.ui.radius, 12) + 'px' } }))),
        h('div.th-bub', { style: { background: `${n.colors.accent}55`, borderRadius: n.chat.bubble === 'flat' ? '3px' : n.chat.bubble === 'glass' ? '12px' : '14px', border: `1px solid ${n.colors.accent}88` } }))));
}

let inst = null;
function build(root, ctx) {
  const unsubs = [];
  let tab = ['gallery', 'studio', 'presets', 'mine'].includes(ctx.params[0]) ? ctx.params[0] : 'gallery';
  const saved = () => theme.normalize((S.me.settings && S.me.settings.activeTheme) || theme.loadSaved());
  const pend = theme.takePending();
  let baseline = saved(); let draft = pend || theme.normalize(theme.getTheme()); let dirty = !!pend; let previewing = false;
  if (pend) { tab = 'studio'; theme.apply(draft, { persist: false }); }
  let q = ''; let sort = 'popular'; let gallery = null; let mine = null;
  const lib = () => ls('themes.lib') || [];

  const body = h('div.th-body-host'); const tabsHost = h('div');
  mount(root, h('div.inner', h('div.page-title', h('div', h('h2', t('Themes')), h('p', t('Make Nebulix look like you. Browse the community, remix presets, or build your own and share it.'))),
    h('div.row', h('button.btn', { type: 'button', onClick: importDialog }, icon('upload', 16), t('Import')), h('button.btn.primary', { type: 'button', onClick: () => show('studio') }, icon('palette', 16), t('Create a theme')))), tabsHost, body));

  function paintTabs() { mount(tabsHost, tabsEl([['gallery', t('Community'), 'globe'], ['presets', t('Presets'), 'star'], ['studio', t('Studio'), 'sliders'], ['mine', t('My themes'), 'user']], tab, (id) => show(id))); }
  function show(id) { if (previewing) { previewing = false; theme.apply(baseline, { persist: false }); } revertIfLeavingStudio(id); tab = id; history.replaceState(null, '', '#/themes/' + id); paintTabs(); paint(); }
  function revertIfLeavingStudio(next) { if (tab === 'studio' && next !== 'studio' && dirty) { theme.apply(baseline, { persist: false }); dirty = false; } }
  function paint() { if (tab === 'gallery') return gallery === null ? loadGallery() : paintGallery(); if (tab === 'presets') return paintPresets(); if (tab === 'studio') return paintStudio(); mine = null; return paintMine(); }

  // ---------- applying / saving ----------
  async function commit(th, { quiet = false } = {}) {
    const applied = theme.apply(th); dirty = false; baseline = theme.normalize(applied); draft = theme.normalize(applied);
    try { const r = await api.patch('/api/profile', { settings: { activeTheme: applied } }); if (r.user) setMe(r.user); } catch (e) { toastErr(e); }
    if (!quiet) { toast(t('Theme applied: {n}', { n: applied.name }), 'good'); sfx.coin(); }
    return applied;
  }
  const saveLocal = (th) => { const l = lib(); const n = theme.normalize(th); const i = l.findIndex((x) => x.name === n.name); if (i >= 0) l[i] = n; else l.unshift(n); if (l.length > 30) l.length = 30; ls('themes.lib', l); toast(t('Saved to your library.'), 'good'); };

  // ---------- gallery ----------
  async function loadGallery() {
    gallery = null; paintGallery();
    try { gallery = (await api.get(`/api/themes?sort=${sort}&q=${encodeURIComponent(q)}`)).themes; } catch (e) { toastErr(e); gallery = []; }
    if (tab === 'gallery') paintGallery();
  }
  function themeCard(th, { actions }) {
    return h('div.card.th-card-x', previewEl(th.data || th), h('div.row', { style: 'margin-top:10px' }, h('b.grow', { style: 'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, th.name || (th.data && th.data.name)), th.data && th.data.mode === 'light' ? h('span.pill', icon('sun', 12), ' ' + t('Light')) : h('span.pill', icon('moon', 12), ' ' + t('Dark'))), th.owner ? h('div.small.muted', t('by {n}', { n: th.owner.name })) : null, th.desc ? h('div.small', th.desc) : null,
      th.tags && th.tags.length ? h('div.row', { style: 'gap:4px;flex-wrap:wrap' }, th.tags.map((x) => h('span.pill', '#' + x))) : null, actions);
  }
  function paintGallery() {
    const search = h('input.input', { value: q, placeholder: t('Search themes'), 'aria-label': t('Search themes'), onKeydown: (e) => { if (e.key === 'Enter') { q = e.target.value.trim(); loadGallery(); } } });
    const head = h('div.row', { style: 'flex-wrap:wrap;margin:14px 0' }, h('div.grow', { style: 'min-width:180px' }, search), h('button.btn', { type: 'button', onClick: () => { q = search.value.trim(); loadGallery(); } }, icon('search', 16), t('Search')),
      segEl([['popular', t('Popular')], ['new', t('Newest')]], sort, (v) => { sort = v; loadGallery(); }));
    if (gallery === null) return mount(body, head, loading(t('Loading themes…')));
    mount(body, head, gallery.length ? h('div.grid.th-grid', gallery.map((th) => themeCard(th, { actions: h('div.row', { style: 'margin-top:10px;gap:6px' },
      h('button.btn.primary.sm.grow', { type: 'button', onClick: (e) => busy(e.currentTarget, async () => { try { const r = await api.post(`/api/themes/${th.id}/install`); await commit(r.theme); th.installs++; } catch (er) { toastErr(er); } }) }, t('Apply')),
      h('button.btn.sm' + (th.liked ? '.primary' : ''), { type: 'button', 'aria-pressed': String(th.liked), 'aria-label': t('Like'), onClick: async (e) => { try { const r = await api.post(`/api/themes/${th.id}/like`); th.liked = r.liked; th.likes = r.likes; paintGallery(); } catch (er) { toastErr(er); } } }, icon('heart', 15), String(th.likes)),
      h('button.btn.sm.ghost.icon', { type: 'button', 'aria-label': t('More'), onClick: (e) => openMenu([
        { label: t('Open in Studio'), icon: 'sliders', onClick: () => { draft = theme.normalize(th.data); dirty = true; show('studio'); live(); } },
        { label: t('Copy share code'), icon: 'copy', onClick: async () => { await navigator.clipboard.writeText(theme.toShare(th.data)).catch(() => {}); toast(t('Copied!'), 'good'); } },
        { label: t('Save to my library'), icon: 'download', onClick: () => saveLocal(th.data) },
        { hr: true }, { label: t('Report'), icon: 'flag', onClick: () => reportTheme(th) },
        isStaff() || (th.owner && th.owner.id === S.me.id) ? { label: t('Delete'), icon: 'trash', danger: true, onClick: () => removeTheme(th) } : null,
      ], e.currentTarget) }, icon('more', 16))), }))) : emptyState('🎨', t('No themes yet'), q ? t('Nothing matches “{q}”.', { q }) : t('Be the first to publish one from the Studio!'), h('button.btn.primary', { type: 'button', onClick: () => show('studio') }, t('Open the Studio'))));
  }
  async function reportTheme(th) {
    const reason = await promptBox(t('Report theme'), { label: t('What is wrong with this theme?'), multiline: true, ok: t('Send report'), validate: (v) => (v.trim().length < 3 ? t('Please tell us briefly what happened.') : '') });
    if (reason === null) return; try { await api.post('/api/reports', { type: 'theme', target: th.id, reason: reason.trim() }); toast(t('Thanks — the moderators will take a look.'), 'good'); } catch (e) { toastErr(e); }
  }
  async function removeTheme(th) {
    if (!(await confirmBox(t('Delete “{n}” for everyone?', { n: th.name }), { danger: true, ok: t('Delete') }))) return;
    try { await api.del('/api/themes/' + th.id); toast(t('Deleted.')); mine = null; if (tab === 'gallery') loadGallery(); else paint(); } catch (e) { toastErr(e); }
  }

  // ---------- presets ----------
  // Hovering a preset skins the whole app live; leaving reverts to the active theme.
  function previewOn(th) { previewing = true; theme.apply(th, { persist: false }); }
  function previewOff() { if (previewing) { previewing = false; theme.apply(baseline, { persist: false }); } }
  function paintPresets() {
    mount(body,
      h('p.small.muted', { style: 'margin:14px 0 0' }, t('Hover a theme to preview it across the whole app.')),
      h('div.grid.th-grid', { style: 'margin-top:10px' }, theme.PRESETS.map((p) => { const th = theme.fromPreset(p); return h('div.card.th-card-x.th-live', { onMouseenter: () => previewOn(th), onMouseleave: () => previewOff(), onFocusin: () => previewOn(th), onFocusout: () => previewOff() },
        previewEl(th), h('div.row', { style: 'margin-top:10px' }, h('b.grow', p.name), h('span.pill', p.mode === 'light' ? t('Light') : t('Dark'))),
        h('div.row', { style: 'margin-top:10px;gap:6px' }, h('button.btn.primary.sm.grow', { type: 'button', onClick: () => { previewing = false; commit(th); } }, t('Apply')), h('button.btn.sm', { type: 'button', onClick: () => { previewing = false; draft = th; dirty = true; show('studio'); live(); } }, icon('sliders', 15), t('Remix')))); })));
  }

  // ---------- my themes ----------
  async function paintMine() {
    mount(body, loading());
    if (mine === null) { try { mine = (await api.get('/api/themes/mine')).themes; } catch (e) { mine = []; toastErr(e); } }
    if (tab !== 'mine') return; const l = lib();
    mount(body, h('h3', { style: 'margin:16px 0 8px' }, t('Saved on this device')),
      l.length ? h('div.grid.th-grid', l.map((th, i) => h('div.card.th-card-x', previewEl(th), h('div.row', { style: 'margin-top:10px' }, h('b.grow', th.name), th.customCss ? h('span.pill', { title: t('Has custom CSS (stays on this device)') }, 'CSS') : null),
        h('div.row', { style: 'margin-top:10px;gap:6px;flex-wrap:wrap' }, h('button.btn.primary.sm.grow', { type: 'button', onClick: () => commit(th) }, t('Apply')), h('button.btn.sm', { type: 'button', onClick: () => { draft = theme.normalize(th); dirty = true; show('studio'); live(); } }, icon('edit', 15), t('Edit')),
          h('button.btn.sm.ghost.icon', { type: 'button', 'aria-label': t('Delete'), onClick: () => { const x = lib(); x.splice(i, 1); ls('themes.lib', x); paintMine(); } }, icon('trash', 15)))))) : emptyState('🗂️', t('Your library is empty'), t('Save themes from the Studio or the gallery to keep them here.')),
      h('h3', { style: 'margin:22px 0 8px' }, t('Published by you')),
      mine.length ? h('div.grid.th-grid', mine.map((th) => themeCard(th, { actions: h('div.row', { style: 'margin-top:10px;gap:6px' }, h('span.small.muted.grow', t('{a} installs · {b} likes', { a: th.installs, b: th.likes })), h('button.btn.sm.danger', { type: 'button', onClick: () => removeTheme(th) }, icon('trash', 15), t('Delete'))) }))) : h('div.small.muted', t('You have not published anything yet.')));
  }

  // ---------- studio ----------
  const live = throttle(() => { dirty = true; theme.apply(draft, { persist: false }); updatePreview(); updateContrast(); }, 60);
  let prevHost = null, contrastEl = null;
  const updatePreview = () => { if (prevHost) mount(prevHost, previewEl(draft, { big: true })); };
  function updateContrast() {
    if (!contrastEl) return; const c = contrast(draft.colors.text, draft.colors.bg); const c2 = contrast(draft.colors.muted, draft.colors.surface); const ok = (v, min) => v >= min;
    mount(contrastEl, h('span.pill' + (ok(c, 4.5) ? '.good' : '.bad'), icon(ok(c, 4.5) ? 'check' : 'alert', 12), ' ' + t('Text on background {r}:1', { r: c.toFixed(1) })), h('span.pill' + (ok(c2, 3) ? '.good' : '.bad'), icon(ok(c2, 3) ? 'check' : 'alert', 12), ' ' + t('Muted on panels {r}:1', { r: c2.toFixed(1) })));
  }
  const sect = (title, ic, ...kids) => h('details.card.th-sect', { open: true }, h('summary', icon(ic, 17), h('b', title)), h('div.th-ctl', kids));
  const colorRow = (key, label, get, set) => { const code = h('code.tiny.muted', get()); const inp = h('input', { type: 'color', value: get().slice(0, 7), 'aria-label': label, onInput: (e) => { set(e.target.value); code.textContent = e.target.value; live(); } }); return h('label.th-color', inp, h('span.grow', label), code); };
  const slider = (label, min, max, step, get, set, f = (v) => v) => { const out = h('b.tiny', f(get())); const inp = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(get()), 'aria-label': label, onInput: (e) => { const v = Number(e.target.value); set(v); out.textContent = f(v); live(); } }); return h('label.th-slider', h('span', label), inp, out); };
  const select = (label, opts, get, set) => h('label.th-select', h('span', label), h('select.select', { 'aria-label': label, onChange: (e) => { set(e.target.value); live(); if (label === t('Type')) paintStudio(); } }, opts.map(([v, l]) => h('option', { value: v, selected: v === get() }, l))));

  function paintStudio() {
    const d = draft;
    prevHost = h('div'); contrastEl = h('div.row', { style: 'gap:6px;flex-wrap:wrap' });
    const isImg = d.bg.type === 'image'; const isStars = d.bg.type === 'stars' || d.bg.type === 'nebula' || d.bg.type === 'aurora';
    const name = h('input.input', { value: d.name, maxlength: '40', 'aria-label': t('Theme name'), onInput: (e) => { d.name = e.target.value; dirty = true; } });
    const controls = h('div.th-controls',
      sect(t('Basics'), 'style', field(t('Name'), name),
        h('div.th-two', select(t('Start from'), [['', t('Choose…')]].concat(theme.PRESETS.map((p) => [p.name, p.name])), () => '', (v) => { const p = theme.PRESETS.find((x) => x.name === v); if (p) { draft = theme.fromPreset(p); dirty = true; theme.apply(draft, { persist: false }); paintStudio(); } }),
          select(t('Mode'), [['dark', t('Dark')], ['light', t('Light')]], () => d.mode, (v) => { d.mode = v; }))),
      sect(t('Colours'), 'palette', h('div.th-colors', theme.COLOR_KEYS.map((k) => colorRow(k, t(COLOR_LABEL[k]), () => d.colors[k], (v) => { d.colors[k] = v; }))), contrastEl),
      sect(t('Background'), 'image', select(t('Type'), theme.BG_TYPES.map((v) => [v, t(BG_LABEL[v])]), () => d.bg.type, (v) => { d.bg.type = v; }),
        d.bg.type !== 'image' && d.bg.type !== 'solid' ? h('div.th-colors', colorRow('c1', t('Colour 1'), () => d.bg.c1, (v) => { d.bg.c1 = v; }), colorRow('c2', t('Colour 2'), () => d.bg.c2, (v) => { d.bg.c2 = v; }), colorRow('c3', t('Colour 3'), () => d.bg.c3, (v) => { d.bg.c3 = v; })) : null,
        d.bg.type === 'solid' ? colorRow('c2', t('Colour'), () => d.bg.c2, (v) => { d.bg.c2 = v; }) : null,
        d.bg.type === 'gradient' ? slider(t('Angle'), 0, 360, 1, () => d.bg.angle, (v) => { d.bg.angle = v; }, (v) => v + '°') : null,
        slider(t('Darken'), 0, 0.9, 0.05, () => d.bg.dim, (v) => { d.bg.dim = v; }, (v) => Math.round(v * 100) + '%'),
        isStars ? h('div.col', { style: 'gap:8px' }, slider(t('Star density'), 0, 1, 0.05, () => d.bg.stars.density, (v) => { d.bg.stars.density = v; }, (v) => Math.round(v * 100) + '%'), slider(t('Motion speed'), 0, 3, 0.1, () => d.bg.stars.speed, (v) => { d.bg.stars.speed = v; }, (v) => v.toFixed(1) + '×'), slider(t('Twinkle'), 0, 1, 0.05, () => d.bg.stars.twinkle, (v) => { d.bg.stars.twinkle = v; }, (v) => Math.round(v * 100) + '%'), colorRow('sc', t('Star colour'), () => d.bg.stars.color, (v) => { d.bg.stars.color = v; })) : null,
        isImg ? h('div.col', { style: 'gap:8px' }, h('div.small.muted', t('Upload a picture (PNG, JPG, GIF or WEBP). It is stored on the server and shown behind the app.')), h('button.btn', { type: 'button', onClick: async (e) => busy(e.currentTarget, async () => { const f = await pickFile('image/png,image/jpeg,image/gif,image/webp'); if (!f) return; try { const r = await api.upload('bg', f); d.bg.image = r.url; live(); toast(t('Background uploaded.'), 'good'); } catch (er) { toastErr(er); } }) }, icon('upload', 16), d.bg.image ? t('Replace picture') : t('Choose a picture'))) : null),
      sect(t('Interface'), 'layers', h('div.col', { style: 'gap:8px' },
        select(t('Surface style'), theme.SURFACES.map((k) => [k, t(SURFACE_LABEL[k])]), () => d.ui.surface || 'flat', (v) => { d.ui.surface = v; if (v !== 'flat' && d.ui.blur < 12) d.ui.blur = v === 'mica' ? 30 : 18; live(); }),
        slider(t('Corner roundness'), 0, 28, 1, () => d.ui.radius, (v) => { d.ui.radius = v; }, (v) => v + 'px'), slider(t('Glass blur'), 0, 40, 1, () => d.ui.blur, (v) => { d.ui.blur = v; }, (v) => v + 'px'),
        slider(t('Glow'), 0, 1, 0.05, () => d.ui.glow, (v) => { d.ui.glow = v; }, (v) => Math.round(v * 100) + '%'), slider(t('Shadows'), 0, 1, 0.05, () => d.ui.shadow, (v) => { d.ui.shadow = v; }, (v) => Math.round(v * 100) + '%'),
        slider(t('Density'), 0.85, 1.15, 0.05, () => d.ui.density, (v) => { d.ui.density = v; }, (v) => (v < 1 ? t('Compact') : v > 1 ? t('Roomy') : t('Normal'))), slider(t('Text size'), 0.9, 1.2, 0.05, () => d.ui.fontScale, (v) => { d.ui.fontScale = v; }, (v) => Math.round(v * 100) + '%'),
        slider(t('Animation speed'), 0, 2, 0.1, () => d.ui.anim, (v) => { d.ui.anim = v; }, (v) => (v === 0 ? t('Off') : v.toFixed(1) + '×')), slider(t('Border width'), 0, 3, 1, () => d.ui.border, (v) => { d.ui.border = v; }, (v) => v + 'px'),
        select(t('Font'), Object.keys(theme.FONTS).map((k) => [k, t(FONT_LABEL[k])]), () => d.ui.font, (v) => { d.ui.font = v; }))),
      sect(t('Chat bubbles'), 'chat', segEl([['flat', t('Flat')], ['rounded', t('Rounded')], ['glass', t('Glass')]], d.chat.bubble, (v) => { d.chat.bubble = v; live(); })),
      sect(t('Advanced: custom CSS'), 'terminal', h('p.small.muted', t('Only applies on this device. It is removed when you share or publish a theme, and url() and @import are blocked for safety.')),
        (() => { const ta = h('textarea.input', { rows: '6', maxlength: '4000', spellcheck: 'false', placeholder: ':root { --accent: #ff4d9d; }\n.card { border-radius: 4px; }', 'aria-label': t('Custom CSS'), value: d.customCss, style: 'font-family:var(--mono);font-size:12px', onInput: (e) => { d.customCss = e.target.value; live(); } }); return ta; })()));
    const side = h('div.th-side-col', prevHost, h('div.card', h('h3', t('Preview')), h('div.small.muted', t('Everything you change here is applied to the whole app instantly. Leave without saving to go back.'))),
      h('div.card.col', { style: 'gap:8px' }, h('button.btn.primary', { type: 'button', onClick: (e) => busy(e.currentTarget, () => commit(draft)) }, icon('check', 16), t('Apply & save')),
        h('div.row', { style: 'gap:6px;flex-wrap:wrap' }, h('button.btn.sm', { type: 'button', onClick: () => { saveLocal(draft); } }, icon('download', 15), t('Save to library')), h('button.btn.sm', { type: 'button', onClick: publish }, icon('globe', 15), t('Publish')),
          h('button.btn.sm', { type: 'button', onClick: () => exportDialog(draft) }, icon('copy', 15), t('Export')), h('button.btn.sm', { type: 'button', onClick: () => { draft = randomTheme(); dirty = true; theme.apply(draft, { persist: false }); paintStudio(); } }, icon('spark', 15), t('Surprise me')),
          h('button.btn.sm.ghost', { type: 'button', onClick: () => { draft = theme.normalize(baseline); dirty = false; theme.apply(draft, { persist: false }); paintStudio(); } }, icon('refresh', 15), t('Revert')))));
    mount(body, h('div.th-studio', controls, side)); updatePreview(); updateContrast();
  }

  async function publish() {
    let name, desc, tags; const n = h('input.input', { value: draft.name, maxlength: '40', 'aria-label': t('Name') }); const dsc = h('input.input', { maxlength: '200', placeholder: t('What makes it special?'), 'aria-label': t('Description') }); const tg = h('input.input', { placeholder: t('space, neon, minimal'), 'aria-label': t('Tags') }); const err = h('div.error.small');
    const ok = await modal({ title: t('Publish to the community'), cls: 'narrow', body: h('div.col', previewEl(draft), field(t('Name'), n), field(t('Description'), dsc), field(t('Tags (comma separated, up to 5)'), tg), h('p.small.muted', t('Custom CSS is never shared. When people apply your theme you earn a few coins.')), err),
      actions: [{ label: t('Cancel'), value: false }, { label: t('Publish'), kind: 'primary', onClick: async () => { try { await api.post('/api/themes', { theme: draft, name: n.value.trim(), desc: dsc.value.trim(), tags: tg.value.split(/[ ,]+/).filter(Boolean) }); } catch (e) { err.textContent = e.message; return false; } } }] });
    if (ok) { toast(t('Your theme is live in the gallery!'), 'good'); mine = null; gallery = null; show('mine'); }
  }
  function exportDialog(th) {
    const code = theme.toShare(th); const ta = h('textarea.input', { rows: '4', readonly: true, value: code, style: 'font-family:var(--mono);font-size:11px', 'aria-label': t('Share code'), onFocus: (e) => e.target.select() });
    modal({ title: t('Export theme'), cls: 'narrow', body: h('div.col', h('p.small.muted', t('Send this code to a friend — they can paste it in Import. Custom CSS is not included in codes.')), ta, h('div.row', { style: 'gap:8px;flex-wrap:wrap' }, copyBtn(code, t('Copy code')),
      h('button.btn.sm', { type: 'button', onClick: () => download('nebulix-theme-' + (th.name || 'theme').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.json', JSON.stringify(theme.normalize(th), null, 2)) }, icon('download', 15), t('Download .json')))), actions: [{ label: t('Done'), kind: 'primary' }] });
  }
  async function importDialog() {
    let parsed = null; const area = h('textarea.input', { rows: '5', placeholder: 'NBX1.… or {"name": …}', spellcheck: 'false', 'aria-label': t('Theme code or JSON'), style: 'font-family:var(--mono);font-size:12px' }); const prev = h('div'); const err = h('div.error.small');
    const check = () => { parsed = theme.fromShare(area.value); err.textContent = ''; if (!area.value.trim()) return mount(prev); if (!parsed) { err.textContent = t('That does not look like a Nebulix theme.'); return mount(prev); } mount(prev, previewEl(parsed), h('div.small.muted', { style: 'margin-top:6px' }, t('Preview: {n}', { n: parsed.name }))); };
    area.addEventListener('input', check);
    const r = await modal({ title: t('Import a theme'), cls: 'narrow', body: h('div.col', h('p.small.muted', t('Paste a share code (NBX1.…) from another player, or a theme .json file.')), area,
      h('div.row', h('button.btn.sm', { type: 'button', onClick: async () => { const f = await pickFile('.json,.txt,application/json'); if (!f) return; if (f.size > 100000) return toast(t('That file is too big.'), 'err'); area.value = await readFile(f, 'text'); check(); } }, icon('upload', 15), t('Choose a file'))), prev, err),
      actions: [{ label: t('Cancel'), value: null }, { label: t('Open in Studio'), onClick: () => { if (!parsed) { err.textContent = t('Paste a theme first.'); return false; } }, value: 'studio' }, { label: t('Apply'), kind: 'primary', onClick: () => { if (!parsed) { err.textContent = t('Paste a theme first.'); return false; } }, value: 'apply' }] });
    if (!parsed || !r) return; if (r === 'apply') { await commit(parsed); } else if (r === 'studio') { draft = parsed; dirty = true; show('studio'); live(); }
  }

  paintTabs(); paint();
  return {
    activate() {}, destroy() { if (dirty || previewing) theme.apply(baseline, { persist: false }); unsubs.forEach((f) => f()); },
  };
}

export default {
  title: () => t('Themes'),
  async mount(root, ctx) { inst = build(root, ctx); return () => { if (inst) inst.destroy(); inst = null; }; },
};
