// Nebulix OS mode: an original desktop with two styles — Nebulix Glass (centred taskbar and a Start panel with Pinned /
// All apps by category / Recommended) or Nebulix Dock (top bar, side dock and an app overview),
// Activities overview, header bars with round buttons). Every Nebulix page runs as an app window.
import { h, mount, ls, clamp, fmt, debounce } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { S, bus, isStaff } from '../state.js';
import { icon, logoMark } from '../icons.js';
import { metaOf, APP_META } from '../apps-meta.js';
import { avatarEl, badgeGlyph } from '../cosmetics.js';
import { openMenu, modal, segEl, switchEl, settingRow, toastErr, toast, confirmBox } from '../ui.js';
import { setWallpaper } from '../starfield.js';
import { miniPlayer } from '../pulse/mini.js';
import * as P from '../pulse/engine.js';
import { feedItem } from '../widgets/feed.js';
import { pick2 } from '../i18n.js';
import { mountWidgets, hubAppView } from './apps2.js';

// [route, label, icon name, tile colour]
export const APPS = [
  ['home', 'Home', 'home', '#3b82f6'], ['browse', 'Browser', 'globe', '#0ea5e9'], ['chat', 'Community', 'users', '#6366f1'], ['dm', 'Messages', 'mail', '#ec4899'],
  ['squads', 'Squads', 'target', '#ef4444'], ['events', 'Events', 'calendar', '#f97316'], ['library', 'Game library', 'layers', '#16a34a'], ['discover', 'Discover games', 'tag', '#0d9488'], ['notes', 'Notes', 'note', '#eab308'], ['ptools', 'Productivity', 'check', '#16a34a'], ['forms', 'Forms', 'list', '#7c3aed'], ['translate', 'Translator', 'translate', '#2563eb'],
  ['music', 'Pulse', 'music', '#8b5cf6'], ['dj', 'DJ mode', 'sliders', '#e11d48'], ['arcade', 'Arcade', 'gamepad', '#22c55e'], ['progress', 'Achievements', 'trophy', '#f59e0b'],
  ['casino', 'Casino', 'dice', '#ca8a04'], ['market', 'Market', 'bag', '#14b8a6'], ['wallet', 'Wallet', 'coins', '#eab308'], ['work', 'Work', 'clip', '#0ea5e9'], ['invest', 'Invest', 'chart', '#16a34a'], ['themes', 'Themes', 'palette', '#d946ef'], ['nova', 'Nova AI', 'spark', '#06b6d4'], ['android', 'Nebulix Android', 'phone', '#3ddc84'], ['cloudpc', 'Cloud PC', 'monitor', '#6366f1'],
  ['nerd', 'Nerd Lab', 'flask', '#65a30d'], ['calc', 'Calculator', 'grid', '#64748b'], ['timer', 'Focus timer', 'clock', '#dc2626'], ['monitor', 'System monitor', 'activity', '#059669'],
  ['files', 'Files', 'folder', '#f59e0b'], ['texted', 'Text editor', 'note', '#0ea5e9'], ['agents', 'Nova Agents', 'agents', '#a855f7'], ['command', 'Command Center', 'gauge', '#06b6d4'], ['widgets', 'Widgets', 'widget', '#ec4899'], ['camera', 'Camera', 'camera', '#475569'], ['taskmgr', 'Task Manager', 'activity', '#16a34a'], ['clipboard', 'Clipboard', 'copy', '#7c3aed'], ['screenshot', 'Screenshot', 'image', '#0891b2'],
  ['ext', 'Extensions', 'puzzle', '#475569'], ['pro', 'PRO', 'crown', '#d97706'], ['profile', 'Profile', 'user', '#0891b2'], ['settings', 'Settings', 'gear', '#52525b'], ['admin', 'Admin', 'shield', '#047857'],
];
const OS_ONLY = ['calc', 'timer', 'monitor'];
const OS_ONLY2 = ['files', 'texted', 'agents', 'command', 'widgets', 'camera', 'taskmgr', 'clipboard', 'screenshot']; // 14.1: desktop-only apps (apps2.js)
export const WALLPAPERS = [['os', 'System wallpaper', 'desktop'], ['theme', 'Theme background', 'palette'], ['stars', 'Starfield', 'star'], ['nebula', 'Nebula', 'spark'], ['aurora', 'Aurora', 'activity'], ['grid', 'Synthwave grid', 'grid'], ['particles', 'Particle network', 'share'], ['waves', 'Waves', 'activity'], ['matrix', 'Glyph rain', 'terminal'], ['bokeh', 'Bokeh lights', 'sun'], ['lava', 'Lava lamp', 'flask'], ['gradient', 'Gradient (static)', 'layers'], ['image', 'My image', 'image']];
const DEFAULT_PINS = ['files', 'browse', 'chat', 'dm', 'music', 'agents', 'command', 'settings'];
const G = { // system glyphs the app icon set does not have
  up: 'M6 15l6-6 6 6', right: 'M9 6l6 6-6 6', left: 'M15 6l-6 6 6 6', down: 'M6 9l6 6 6-6',
  battery: 'M3 8h15a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM22 11v2M5 10.5h9v3H5z',
  dots: 'M5 5h.01M12 5h.01M19 5h.01M5 12h.01M12 12h.01M19 12h.01M5 19h.01M12 19h.01M19 19h.01',
};
const glyph = (d, size = 16, o = {}) => h('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: o.fill ? 'currentColor' : 'none', stroke: o.fill ? 'none' : 'currentColor', 'stroke-width': o.sw || 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', style: 'flex:none' }, h('path', { d }));
// The default wallpaper is drawn, not downloaded: an original Nebulix nebula (glowing clouds and stars in the theme's spirit).
function bloomSvg() {
  let stars = ''; let a = 7;
  for (let i = 0; i < 140; i++) { a = (a * 9301 + 49297) % 233280; const x = (a / 233280) * 1600; a = (a * 9301 + 49297) % 233280; const y = (a / 233280) * 900; const r = (i % 7 === 0 ? 1.6 : 0.8); stars += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${r}" fill="#fff" opacity="${(0.35 + (i % 5) * 0.12).toFixed(2)}"/>`; }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" width="100%" height="100%"><defs>
<radialGradient id="n0" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#a855f7" stop-opacity=".9"/><stop offset="1" stop-color="#a855f7" stop-opacity="0"/></radialGradient>
<radialGradient id="n1" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#22d3ee" stop-opacity=".75"/><stop offset="1" stop-color="#22d3ee" stop-opacity="0"/></radialGradient>
<radialGradient id="n2" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ec4899" stop-opacity=".6"/><stop offset="1" stop-color="#ec4899" stop-opacity="0"/></radialGradient>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#05061a"/><stop offset=".55" stop-color="#0c0a2e"/><stop offset="1" stop-color="#14062a"/></linearGradient>
<filter id="soft"><feGaussianBlur stdDeviation="40"/></filter></defs>
<rect width="1600" height="900" fill="url(#bg)"/><g filter="url(#soft)"><ellipse cx="1050" cy="420" rx="520" ry="300" fill="url(#n0)" transform="rotate(-18 1050 420)"/><ellipse cx="760" cy="560" rx="460" ry="220" fill="url(#n1)" transform="rotate(12 760 560)"/><ellipse cx="1250" cy="640" rx="320" ry="200" fill="url(#n2)"/></g>${stars}</svg>`;
}
const appOf = (name) => APPS.find((a) => a[0] === name) || [name, name, 'window', '#cbd5e1'];
const ic = (name, size = 22) => icon(name, size);
const tile = (name, size, cls) => { const [, , e, col] = appOf(name); return h('span.os-ic' + (cls || ''), { style: `--c:${col}` }, ic(e, size)); };
const MIN_W = 380, MIN_H = 260;

export function createDesktop({ loaders: baseLoaders, cache, go, onExit, logout, palette, accountMenu, announcements, groups = [] }) {
  // every app of the main navigation, with its own colour; plus the desktop-only tools
  const CAT_NAME = { '': 'Home', Social: 'Social', Play: 'Games', Economy: 'Economy', Create: 'Create' };
  const cats = groups.map(([g, items]) => [CAT_NAME[g] || g, items.map((x) => x[0])]);
  if (groups.length) {
    const known = new Map(APPS.map((a) => [a[0], a]));
    const fromNav = groups.flatMap(([, items]) => items).map(([k, l, i]) => [k, l, i, (APP_META[k] ? metaOf(k)[0] : (known.get(k) || [])[3]) || '#64748b']);
    const extra = APPS.filter((a) => !fromNav.some((x) => x[0] === a[0])).map((a) => (APP_META[a[0]] ? [a[0], a[1], a[2], metaOf(a[0])[0]] : a));
    APPS.splice(0, APPS.length, ...fromNav, ...extra);
    cats.push(['Tools', extra.map((a) => a[0])]);
  }
  const loaders = Object.assign({}, baseLoaders); for (const n of OS_ONLY) loaders[n] = () => import('./apps.js').then((m) => ({ default: m.OS_APPS[n] }));
  for (const n of OS_ONLY2) loaders[n] = () => import('./apps2.js').then((m) => ({ default: m.OS_APPS2[n] }));
  const small = () => innerWidth < 760;
  const os = () => Object.assign({ wallpaper: 'os', image: '', react: true, dim: 0, winStyle: 'win', dock: 'bottom', icons: true, widgets: false, restore: true, glass: 0.72, blur: 22, wobbly: true, minFx: 'lamp', closeFx: 'burn', openFx: 'zoom', cube: true, hot: true }, (S.me.settings && S.me.settings.ui && S.me.settings.ui.os) || {});
  const style = () => (os().winStyle === 'linux' ? 'linux' : 'win');
  const lang = () => document.documentElement.lang || 'en';
  const wins = new Map(); let z = 10; let focused = null; const geo = ls('os.wins') || {};
  const saveGeo = debounce(() => ls('os.wins', geo), 300);
  const pinsOf = () => { const p = ls('os.pins'); return Array.isArray(p) ? p : DEFAULT_PINS; };
  let recent = Array.isArray(ls('os.recent')) ? ls('os.recent') : [];
  const dwLayer = h('div.os-dwl'); const hotEl = h('div.os-hot', { onPointerenter: () => { if (os().hot && !tvEl) taskView(); } }); let curWs = 0; const WS_N = 4; const wsBar = h('div.os-wsbar');
  const wallEl = h('div.os-wall'); const winLayer = h('div.os-wins'); const iconsEl = h('div.os-icons'); const widgetsEl = h('aside.os-widgets'); const snapPrev = h('div.os-snap.hide');
  const taskApps = h('div.os-taskapps');
  const coin = h('span.coin#coinbar', { title: t('Your coins'), style: 'cursor:pointer', onClick: () => go('wallet') }, S.me.coins >= 1e9 ? '∞' : fmt.coins(S.me.coins));
  const bell = h('button.os-tbtn', { id: 'bell', 'aria-label': t('Announcements'), onClick: (e) => announcements(e.currentTarget) }, icon('bell', 16));
  const trayBox = h('div.os-traybox', miniPlayer(go, { compact: true }), coin, bell);
  const sysIcons = () => [icon('wifi', 16), icon('volume', 16), glyph(G.battery, 17)];
  const sysMenu = (e) => quickPanel(e, sysMenuOld);
  const sysMenuOld = (e) => openMenu([
    { label: t('Desktop & wallpaper'), icon: 'image', onClick: wallpaperPicker }, { label: t('Settings'), icon: 'gear', onClick: () => go('settings') },
    { label: t('Tile open windows'), icon: 'layout', onClick: tileAll }, { label: t('Task view'), icon: 'layers', onClick: () => taskView() }, { label: t('Keyboard shortcuts'), icon: 'keyboard', onClick: () => shortcutsHelp() }, { hr: true },
    { label: t('Close desktop mode'), icon: 'power', onClick: () => shutdown() }, { label: t('Log out'), icon: 'logout', danger: true, onClick: logout },
  ], e);
  // Glass taskbar: Start, Search and apps centred; overflow chevron, system icons, clock and "show desktop" on the right.
  const startBtn = h('button.os-start', { 'aria-label': t('Start'), title: t('Start'), onClick: (e) => { e.stopPropagation(); toggleStart(); } }, logoMark(24));
  const searchBtn = h('button.os-search', { onClick: (e) => { e.stopPropagation(); toggleStart(true); } }, icon('search', 15), h('span', t('Search')));
  const tvBtn = () => h('button.os-tbtn.os-tv', { 'aria-label': t('Task view'), title: t('Task view') + ' (Alt+Q)', onClick: (e) => { e.stopPropagation(); taskView(); } }, icon('layers', 18));
  const tcenter = h('div.os-tcenter', startBtn, searchBtn, tvBtn());
  const winClock = h('button.os-clock', { onClick: (e) => { e.stopPropagation(); calendar(); } }, h('span'), h('span'));
  const wsDot = h('span.os-ws', { title: t('Realtime connection') });
  const winTray = h('div.os-tray', wsBar, h('button.os-tbtn.os-chev', { 'aria-label': t('Show hidden icons'), onClick: (e) => sysMenu(e) }, glyph(G.up, 14)), h('button.os-sys', { title: t('Quick settings'), onClick: (e) => sysMenu(e) }, sysIcons(), wsDot), winClock, h('button.os-peek', { title: t('Show desktop'), 'aria-label': t('Show desktop'), onClick: () => peek() }));
  const taskbar = h('footer.os-taskbar', h('div.os-tleft'), tcenter, winTray);
  // Dock style: top bar (Activities · clock · system menu) and the dock on the left with Show Apps at the bottom.
  const gClock = h('button.os-gclock', { onClick: (e) => { e.stopPropagation(); calendar(); } });
  const gRight = h('div.os-gright', wsBar.cloneNode ? h('span') : null, tvBtn(), h('button.os-gsys', { title: t('Quick settings'), onClick: (e) => sysMenu(e) }, sysIcons()));
  const gbar = h('header.os-gbar', h('button.os-gact', { onClick: (e) => { e.stopPropagation(); toggleStart(); } }, h('i'), h('span', t('Activities'))), gClock, gRight);
  const appsBtn = h('button.os-gapps', { title: t('Show apps'), 'aria-label': t('Show apps'), onClick: (e) => { e.stopPropagation(); toggleStart(); } }, glyph(G.dots, 26, { sw: 3 }));
  const gdock = h('nav.os-gdock', h('div.grow'), appsBtn);
  const startEl = h('div.os-startmenu.hide'); let calEl = null;
  const root = h('div.os-desktop', { onContextmenu: (e) => { if (e.target === root || e.target === winLayer || e.target === wallEl || e.target.closest('.os-icons') === iconsEl && !e.target.closest('.os-icon')) { e.preventDefault(); deskMenu(e); } } },
    wallEl, iconsEl, widgetsEl, dwLayer, winLayer, snapPrev, gbar, gdock, startEl, taskbar, hotEl);
  const offWidgets = mountWidgets(dwLayer);
  window.__nbxOs = { list: () => [...wins.values()].map((w) => ({ name: w.name, title: w.title || t(appOf(w.name)[1]), ws: w.ws || 0, min: !!w.min, focused: focused === w })), focus: (n) => { const w = wins.get(n); if (w) focus(w); }, close: (n) => { const w = wins.get(n); if (w) close(w); }, appName: (n) => appOf(n)[1] };
  const onCopy = () => { const txt = String(document.getSelection() || '').trim(); if (!txt || txt.length > 20000) return; const l = (ls('os.clip') || []).filter((y) => y.t !== txt); l.unshift({ t: txt, at: Date.now() }); const pins = l.filter((y) => y.pin); ls('os.clip', [...new Set([...l.slice(0, 40), ...pins])]); dispatchEvent(new Event('nbx:clip')); };
  document.addEventListener('copy', onCopy);
  // Alt+` (and Alt+Shift+`): window switcher with live previews of every open window, like Alt+Tab
  let swEl = null, swIdx = 0, swList = [];
  const paintSw = () => mount(swEl, h('div.os-swbox', swList.map((w, i) => h('div.os-swc' + (i === swIdx ? '.on' : ''), { onClick: () => { swIdx = i; endSw(true); } }, h('div.os-swt', tile(w.name, 30)), h('b.ellipsis', w.title || t(appOf(w.name)[1])), h('span.tiny.muted', t('Desktop {n}', { n: (w.ws || 0) + 1 }))))));
  const endSw = (go) => { if (!swEl) return; const w = swList[swIdx]; swEl.remove(); swEl = null; if (go && w) focus(w); };
  const onSw = (e) => { if (!root.isConnected) return; if (e.altKey && (e.code === 'Backquote' || e.key === '`')) { e.preventDefault(); if (!swEl) { swList = [...wins.values()].sort((a, b) => b.z - a.z); if (swList.length < 1) return; swIdx = swList.length > 1 ? 1 : 0; swEl = h('div.os-switch'); root.appendChild(swEl); } else swIdx = (swIdx + (e.shiftKey ? swList.length - 1 : 1)) % swList.length; paintSw(); } else if (swEl && e.key === 'Escape') { endSw(false); } };
  const onSwUp = (e) => { if (swEl && (e.key === 'Alt' || !e.altKey)) endSw(true); };
  document.addEventListener('keydown', onSw, true); document.addEventListener('keyup', onSwUp, true);
  root.classList.toggle('small', small());
  const quickAnim = () => document.documentElement.dataset.reduce === '1' || document.documentElement.dataset.anim === 'off';
  const bootMark = () => h('div.os-bootlogo', logoMark(84));
  function boot() {
    const ov = h('div.os-boot.' + style(), bootMark(), h('div.os-spin', [0, 1, 2, 3, 4].map((i) => h('i', { style: `--i:${i}` }))), h('b', 'Nebulix OS'));
    root.appendChild(ov); setTimeout(() => { ov.classList.add('out'); setTimeout(() => ov.remove(), 450); }, quickAnim() ? 50 : 1300);
  }
  function shutdown() {
    const ov = h('div.os-boot.off.' + style(), h('div.os-spin', [0, 1, 2, 3, 4].map((i) => h('i', { style: `--i:${i}` }))), h('span', t('Closing desktop mode…')));
    root.appendChild(ov); ls('os.session', [...wins.keys()]);
    setTimeout(() => onExit(), quickAnim() ? 50 : 900);
  }
  // ---------- task view: every open window as a card ----------
  let tvEl = null;
  function taskView(force) {
    if (tvEl) { tvEl.remove(); tvEl = null; if (force !== true) return; } if (force === false) return;
    const list = [...wins.values()].sort((a, b) => b.z - a.z);
    const card = (w) => h('div.os-tvc' + (w === focused ? '.on' : '') + (w.min ? '.min' : ''), { onClick: () => { taskView(false); focus(w); } },
      h('div.os-tvh', tile(w.name, 13, '.sm'), h('b.grow.ellipsis', w.title || t(appOf(w.name)[1])), h('button.os-tbtn', { 'aria-label': t('Close window'), onClick: (e) => { e.stopPropagation(); close(w); taskView(true); } }, icon('x', 14))),
      h('div.os-tvb', { style: `--c:${appOf(w.name)[3]}` }, tile(w.name, 30), w.min ? h('span.tiny', t('Minimized')) : null));
    tvEl = h('div.os-tview', { onClick: (e) => { if (e.target === tvEl) taskView(false); } },
      h('div.os-tvtop', h('b', t('Task view')), h('span.tiny', t('{n} windows', { n: list.length })), h('div.grow'), list.length ? h('button.btn.sm', { onClick: () => { taskView(false); tileAll(); } }, icon('layout', 14), t('Tile open windows')) : null,
        list.length ? h('button.btn.sm.danger', { onClick: () => { for (const w of [...wins.values()]) close(w); taskView(false); } }, icon('x', 14), t('Close all')) : null),
      list.length ? h('div.os-tvgrid', list.map(card)) : h('p.os-snone', t('No windows open. Open an app from Start.')));
    root.appendChild(tvEl);
  }
  function snapTo(win, where) {
    if (!win) return; const a = area(); win.g.max = false;
    if (where === 'left') win.g = Object.assign(win.g, { x: 0, y: 0, w: a.w / 2, h: a.h, snap: true });
    else if (where === 'right') win.g = Object.assign(win.g, { x: a.w / 2, y: 0, w: a.w / 2, h: a.h, snap: true });
    place(win); geo[win.name] = win.g; saveGeo();
  }
  function shortcutsHelp() {
    const rows = [['Alt + Space', t('Open Start')], ['Alt + Q', t('Task view')], ['Alt + ← / →', t('Snap the window to the left or right half')], ['Alt + ↑', t('Maximize or restore the window')], ['Alt + ↓', t('Minimize the window')], ['Alt + W', t('Close the window')], ['Alt + D', t('Show the desktop')], ['Alt + 1…9', t('Open the apps pinned to the taskbar')]];
    modal({ title: t('Keyboard shortcuts'), body: h('div.os-keys', rows.map(([k, d]) => h('div.row', h('kbd', k), h('span', d)))), actions: [{ label: t('Done'), kind: 'primary' }] });
  }
  const onKeys = (e) => {
    if (!root.isConnected || !e.altKey || e.ctrlKey || e.metaKey) return; const k = e.key.toLowerCase(); const w = focused && !focused.min ? focused : null; let done = true;
    if (k === ' ') toggleStart(); else if (k === 'q') taskView(); else if (k === 'arrowleft') snapTo(w, 'left'); else if (k === 'arrowright') snapTo(w, 'right');
    else if (k === 'arrowup') { if (w) toggleMax(w); } else if (k === 'arrowdown') { if (w) minimize(w); } else if (k === 'w') { if (w) close(w); } else if (k === 'd') peek();
    else if (/^[1-9]$/.test(k)) { const n = pinsOf().filter(allowed)[Number(k) - 1]; if (n) { const ow = wins.get(n); if (ow) focus(ow); else go(n); } } else done = false;
    if (done) e.preventDefault();
  };
  document.addEventListener('keydown', onKeys, true);
  const onWsKeys = (e) => { if (!root.isConnected || !e.ctrlKey || !e.altKey) return; const k = e.key; if (k === 'ArrowRight' || k === 'ArrowLeft') { e.preventDefault(); if (e.shiftKey && focused) { focused.ws = (curWs + (k === 'ArrowRight' ? 1 : WS_N - 1)) % WS_N; } switchWs((curWs + (k === 'ArrowRight' ? 1 : WS_N - 1)) % WS_N); } else if (/^[1-4]$/.test(k)) { e.preventDefault(); switchWs(Number(k) - 1); } };
  document.addEventListener('keydown', onWsKeys, true);
  function peek() { const open = [...wins.values()].filter((w) => !w.min); if (open.length) open.forEach((w) => minimize(w)); else wins.forEach((w) => { w.min = false; w.el.classList.remove('min'); }); paintTask(); }
  function applyStyle() {
    const s = style(); root.classList.toggle('w11', s === 'win'); root.classList.toggle('gnome', s === 'linux'); root.classList.toggle('dock-top', s === 'win' && os().dock === 'top');
    if (s === 'win') { tcenter.appendChild(taskApps); winTray.prepend(trayBox); } else { gdock.prepend(taskApps); gRight.prepend(trayBox); }
    const o = os(); root.style.setProperty('--osw-a', String(clamp(Number(o.glass) || 0.72, 0.35, 1))); root.style.setProperty('--osw-blur', clamp(Number(o.blur) || 0, 0, 40) + 'px'); root.classList.toggle('fxglass', Number(o.glass) < 0.99); root.classList.toggle('hotc', !!o.hot && s === 'linux');
    if (s === 'linux') gRight.prepend(wsBar); else winTray.prepend(wsBar); paintWs();
    document.body.classList.add('os-mode'); document.body.classList.toggle('os-dock-top', s === 'win' && os().dock === 'top'); document.body.classList.toggle('os-gnome', s === 'linux');
  }

  // ---------- wallpaper ----------
  function applyWall() {
    const o = os(); const sys = o.wallpaper === 'os'; applyStyle();
    wallEl.className = 'os-wall' + (sys ? ' ' + style() : ' hide'); wallEl.style.setProperty('--dim', String(o.dim || 0));
    if (sys) { if (!wallEl.firstChild) wallEl.innerHTML = bloomSvg(); } else wallEl.textContent = '';
    setWallpaper(sys ? { type: 'solid', dim: 0, react: false } : { type: o.wallpaper, image: o.image, dim: o.dim, react: o.react });
  }
  async function saveOs(patch) {
    const cur = os(); const next = Object.assign({}, cur, patch);
    S.me.settings = S.me.settings || {}; S.me.settings.ui = Object.assign({}, S.me.settings.ui || {}, { os: next }); applyWall(); paintIcons(); paintWidgets(); paintTask(); toggleStart(false);
    try { await api.patch('/api/profile', { settings: { ui: { os: patch } } }); } catch (e) { toastErr(e); }
  }

  // ---------- desktop icons ----------
  function visibleApps() { return APPS.filter(([n]) => loaders[n] && (n !== 'admin' || isStaff())); }
  function paintIcons() {
    const o = os(); iconsEl.classList.toggle('hide', !o.icons);
    const DESK = [...new Set([...APPS.filter((a) => a[0].startsWith('x-')).map((a) => a[0]), 'files', 'home', 'games', 'worlds', 'browse', 'chat', 'dm', 'agents', 'command', 'camera', 'music', 'wallet', 'notes', 'calc', 'settings', ...pinsOf()])];
    mount(iconsEl, visibleApps().filter(([n]) => DESK.includes(n)).sort((a, b) => DESK.indexOf(a[0]) - DESK.indexOf(b[0])).slice(0, 18).map(([n, label]) => h('button.os-icon' + (updated.has(n) ? '.upd' : ''), { dataset: { app: n }, onContextmenu: n.startsWith('x-') ? (ev) => { ev.preventDefault(); ev.stopPropagation(); appMenu(n, ev); } : null, onDblclick: () => go(n), onClick: (ev) => { iconsEl.querySelectorAll('.sel').forEach((x) => x.classList.remove('sel')); ev.currentTarget.classList.add('sel'); if (matchMedia('(pointer: coarse)').matches) go(n); }, onKeydown: (ev) => { if (ev.key === 'Enter') go(n); } },
      tile(n, 26), h('span.os-il', t(label)))));
  }

  // ---------- widgets ----------
  let progData = null;
  function paintWidgets() {
    const o = os(); widgetsEl.classList.toggle('hide', !o.widgets); if (!o.widgets) return;
    const now = new Date();
    const clock = h('div.os-w.os-wclock', h('div.os-time', now.toLocaleTimeString(document.documentElement.lang || 'en', { hour: '2-digit', minute: '2-digit' })), h('div.small.muted', now.toLocaleDateString(document.documentElement.lang || 'en', { weekday: 'long', day: 'numeric', month: 'long' })));
    const s = P.snapshot(); const tr = s.track;
    const music = h('div.os-w.os-wmusic', h('div.os-wh', 'Pulse'),
      tr ? h('div.row', tr.cover || tr.thumb ? h('img.os-wcover', { src: tr.cover || tr.thumb, alt: '' }) : h('span.os-wcover.ph', '♪'), h('div.grow', h('div.ellipsis', { style: 'font-weight:700' }, s.now || tr.title), h('div.tiny.muted.ellipsis', s.now ? tr.title : tr.artist || ''))) : h('p.small.muted', t('Nothing playing.')),
      h('div.row', { style: 'justify-content:center' }, h('button.btn.ghost.icon.sm', { onClick: () => P.prev() }, icon('back', 15)), h('button.btn.primary.icon.sm', { onClick: () => (tr ? P.toggle() : go('music')) }, icon(s.playing ? 'pause' : 'play', 15)), h('button.btn.ghost.icon.sm', { onClick: () => P.next() }, icon('fwd', 15)), h('button.btn.ghost.sm', { onClick: () => go('music') }, t('Open'))));
    const pr = progData; const lvl = pr ? pr.level : null;
    const prog = h('div.os-w', h('div.os-wh', t('Level {n}', { n: lvl ? lvl.level : '…' })), lvl ? h('div.xpbar', h('i', { style: `width:${Math.round(lvl.into / lvl.need * 100)}%` })) : null, lvl ? h('div.tiny.muted', `${fmt.num(lvl.into)} / ${fmt.num(lvl.need)} XP`) : null,
      pr ? h('div.col.gap-s', { style: 'margin-top:8px' }, pr.quests.map((q) => h('div.os-quest' + (q.claimed ? '.done' : ''), h('span', badgeGlyph(q.icon)), h('div.grow', h('div.tiny', t(q.name, { n: q.goal })), h('div.qbar', h('i', { style: `width:${Math.round(Math.min(1, q.n / q.goal) * 100)}%` }))), q.n >= q.goal && !q.claimed ? h('button.btn.sm.primary', { onClick: () => go('progress') }, t('Claim')) : null))) : null);
    const fr = (S.friends.friends || []).filter((f) => S.online.has(f.id)).slice(0, 6);
    const friends = h('div.os-w', h('div.os-wh', t('Friends online')), fr.length ? fr.map((f) => h('button.os-friend', { onClick: () => go('dm', f.id) }, avatarEl(f, { size: 28, status: true, frame: false }), h('div.grow', h('div.small.ellipsis', { style: 'font-weight:600' }, f.displayName || f.username), (S.acts && S.acts[f.id]) ? h('div.tiny.muted.ellipsis', actText(S.acts[f.id])) : null))) : h('p.small.muted', t('No friends online right now.')));
    const extra = [];
    if (bossData) { const L = bossData.live; extra.push(h('button.os-w.os-wboss', { style: `--c:${(L ? L.boss : bossData.nextBoss).color}`, onClick: () => go('boss') }, h('div.os-wh', t('World Boss')), L ? [h('div.row', h('span', { style: 'font-size:1.6rem' }, L.boss.icon), h('b.grow', pick2(L.boss.n))), h('div.xpbar', h('i', { style: `width:${Math.round((L.hp / L.max) * 100)}%` })), h('div.tiny', t('{n} fighters', { n: L.fighters }))]
      : h('div.row', h('span', { style: 'font-size:1.6rem' }, bossData.nextBoss.icon), h('div.grow', h('b', pick2(bossData.nextBoss.n)), h('div.tiny.muted', t('Next one at {t}', { t: new Date(bossData.next).toLocaleTimeString(lang(), { hour: '2-digit', minute: '2-digit' }) })))))); }
    if (wordData) extra.push(h('button.os-w', { onClick: () => go('word') }, h('div.os-wh', t('Word of the day')), h('div.small', wordData.done ? (wordData.won ? '✅ ' + t('Solved in {n}', { n: wordData.guesses.length }) : '❌ ' + t('Not solved')) : t('{n}/6 tries used', { n: wordData.guesses.length })), h('div.tiny.muted', t('Streak') + ': ' + wordData.stats.streak)));
    if (liveData && liveData.length) extra.push(h('div.os-w', h('div.os-wh', t('Nebulix Live')), h('div.fd-list.compact', liveData.slice(0, 4).map((e) => feedItem(e)))));
    mount(widgetsEl, clock, music, ...extra, prog, friends);
  }
  let bossData = null, wordData = null, liveData = null;
  const loadLive = () => Promise.all([api.get('/api/boss', { quiet: true }).catch(() => null), api.get('/api/word', { quiet: true }).catch(() => null), api.get('/api/feed?n=4', { quiet: true }).catch(() => null)])
    .then(([b, w, f]) => { bossData = b; wordData = w; liveData = f ? f.items : null; paintWidgets(); });
  const loadProg = () => api.get('/api/progress', { quiet: true }).then((p) => { progData = p; paintWidgets(); }).catch(() => {});

  // ---------- windows ----------
  function defGeo(name) {
    const W = root.clientWidth || innerWidth, H = (root.clientHeight || innerHeight) - 48; const n = wins.size;
    const w = clamp(Math.round(W * 0.66), MIN_W, 1280), hh = clamp(Math.round(H * 0.78), MIN_H, 900);
    return { x: clamp(Math.round((W - w) / 2) + n * 28 - 40, 8, Math.max(8, W - w - 8)), y: clamp(Math.round((H - hh) / 2) + n * 24 - 30, 8, Math.max(8, H - hh)), w, h: hh, max: ['browse', 'dj', 'music'].includes(name) && W < 1400 };
  }
  function place(win) {
    const g = win.g; const el = win.el;
    if (g.max || small()) { el.classList.add('max'); el.style.cssText = `z-index:${win.z}`; return; }
    el.classList.remove('max'); el.style.cssText = `left:${g.x}px;top:${g.y}px;width:${g.w}px;height:${g.h}px;z-index:${win.z}`;
  }
  function focus(win) {
    if (!win) return; if (win.ws !== undefined && win.ws !== curWs) { switchWs(win.ws); } if (win.min) restore(win);
    win.z = ++z; win.el.style.zIndex = win.z;
    if (focused !== win) { if (focused) focused.el.classList.remove('focused'); focused = win; win.el.classList.add('focused'); }
    paintTask(); history.replaceState(null, '', win.hash || '#/' + win.name);
    document.title = (win.title || appOf(win.name)[1]) + ' · Nebulix';
  }
  function chrome(win, title, emoji) {
    const btn = (cls, ic, label, fn) => h('button.os-wb.' + cls, { 'aria-label': label, title: label, onClick: (e) => { e.stopPropagation(); fn(); } }, ic);
    const buttons = h('div.os-wbtns', btn('min', h('i'), t('Minimize'), () => minimize(win)), btn('max', h('i'), t('Maximize'), () => toggleMax(win)), btn('close', h('i'), t('Close'), () => close(win)));
    win.titleEl = h('span.os-wt.ellipsis', title);
    const bar = h('div.os-titlebar', tile(win.name, 11, '.wi'), win.titleEl, h('div.grow'), buttons);
    bar.addEventListener('dblclick', (e) => { if (!e.target.closest('.os-wb')) toggleMax(win); });
    bar.addEventListener('pointerdown', (e) => startDrag(e, win));
    bar.addEventListener('contextmenu', (e) => { e.preventDefault(); openMenu([{ label: t('Minimize'), icon: 'window', onClick: () => minimize(win) }, { label: win.g.max ? t('Restore size') : t('Maximize'), icon: 'fullscreen', onClick: () => toggleMax(win) }, { hr: true }, ...[0, 1, 2, 3].filter((i) => i !== win.ws).map((i) => ({ label: t('Move to desktop {n}', { n: i + 1 }), icon: 'layers', onClick: () => { win.ws = i; applyWs(); paintTask(); paintWs(); } })), { hr: true }, { label: t('Close'), icon: 'x', danger: true, onClick: () => close(win) }], e); });
    return bar;
  }
  async function open(name, r) {
    const ctx = { params: r.params || [], query: r.query || new URLSearchParams(), go, setTitle: (s) => setTitle(name, s) };
    let win = wins.get(name); markSeen(name);
    win && (win.hash = '#/' + name + (r.params && r.params.length ? '/' + r.params.map(encodeURIComponent).join('/') : '') + (r.query && String(r.query) ? '?' + r.query : ''));
    if (win) {
      focus(win);
      if (win.mod && win.mod.activate && (r.params.length || String(r.query))) { try { await win.mod.activate(ctx); } catch (e) { console.error(e); } }
      else if (win.mod && !win.mod.activate && (r.params.length || String(r.query)) && win.mod.mount) await remount(win, ctx);
      return win;
    }
    const [, label, emoji] = appOf(name);
    win = { name, ws: curWs, title: t(label), z: ++z, g: Object.assign(defGeo(name), geo[name] || {}), min: false, hash: '#/' + name };
    recent = [name, ...recent.filter((x) => x !== name)].slice(0, 6); ls('os.recent', recent);
    const body = h('div.os-body'); win.body = body;
    win.el = h('section.os-win', { dataset: { app: name }, onPointerdown: () => focus(win) }, chrome(win, t(label), emoji), body, ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map((d) => h('span.os-rz.' + d, { onPointerdown: (e) => startResize(e, win, d) })));
    wins.set(name, win); winLayer.appendChild(win.el); place(win); focus(win); saveSession();
    win.el.animate(OPEN_FX[os().openFx] || OPEN_FX.zoom, { duration: (os().openFx === 'glide' ? 320 : 260) * animK(), easing: 'cubic-bezier(.2,.9,.25,1.15)' });
    await remount(win, ctx);
    return win;
  }
  async function remount(win, ctx) {
    if (win.cleanup) { try { win.cleanup(); } catch (e) { console.error(e); } win.cleanup = null; }
    const name = win.name; const el = h('section.view' , { 'data-view': name }); mount(win.body, el);
    try {
      const mod = cache[name] || (cache[name] = (await loaders[name]()).default); win.mod = mod;
      if (mod.full) el.classList.add('full');
      setTitle(name, mod.title ? mod.title() : win.title);
      win.cleanup = await mod.mount(el, ctx);
    } catch (e) { console.error('[os]', name, e); mount(el, h('div.empty', h('div.empty-art.ea-mark'), h('h3', t('This page could not load')), h('p.muted', String(e && e.message || e)), h('button.btn', { onClick: () => remount(win, ctx) }, t('Try again')))); }
  }
  function setTitle(name, s) { const w = wins.get(name); if (!w) return; w.title = s; if (w.titleEl) w.titleEl.textContent = s; paintTask(); if (focused === w) document.title = s + ' · Nebulix'; }
  function close(win) {
    if (win.cleanup) { try { win.cleanup(); } catch (e) { console.error(e); } }
    const el = win.el; wins.delete(win.name); if (focused === win) focused = null; saveSession();
    const cfx = os().closeFx; el.style.pointerEvents = 'none';
    el.animate(cfx === 'burn' ? [{ opacity: 1, filter: 'none', clipPath: 'inset(0 0 0 0)', boxShadow: '0 0 0 0 #ff7a18' }, { offset: .35, filter: 'sepia(1) saturate(5) hue-rotate(-25deg) brightness(1.5)', clipPath: 'inset(0 0 12% 0)', boxShadow: '0 30px 60px -10px #ff5a00' }, { opacity: 0, filter: 'sepia(1) saturate(6) hue-rotate(-35deg) brightness(2) blur(3px)', clipPath: 'inset(0 0 100% 0)', transform: 'translateY(-14px)' }]
      : cfx === 'implode' ? [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.2) rotate(8deg)', filter: 'blur(6px)' }] : [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.95)' }], { duration: (cfx === 'burn' ? 620 : cfx === 'implode' ? 300 : 150) * animK(), easing: 'ease-in' }).onfinish = () => el.remove();
    const next = [...wins.values()].filter((w) => !w.min).sort((a, b) => b.z - a.z)[0]; if (next) focus(next); else { history.replaceState(null, '', '#/desktop'); document.title = 'Nebulix OS'; }
    paintTask();
  }
  function minimize(win) {
    win.min = true; lamp(win, false, () => win.min && win.el.classList.add('min')); if (win.mod && win.mod.deactivate) try { win.mod.deactivate(); } catch {}
    if (focused === win) { win.el.classList.remove('focused'); focused = null; const next = [...wins.values()].filter((w) => !w.min).sort((a, b) => b.z - a.z)[0]; if (next) focus(next); }
    paintTask();
  }
  function restore(win) { win.min = false; win.el.classList.remove('min'); lamp(win, true); if (win.mod && win.mod.activate) try { win.mod.activate({ params: [], query: new URLSearchParams(), go, setTitle: (s) => setTitle(win.name, s) }); } catch {} }
  function toggleMax(win) { win.g.max = !win.g.max; win.g.snap = null; place(win); geo[win.name] = win.g; saveGeo(); }
  const animK = () => (document.documentElement.dataset.reduce === '1' || document.documentElement.dataset.anim === 'off' ? 0.01 : document.documentElement.dataset.anim === 'extra' ? 1.4 : 1);

  // ---------- 14.1 effects ----------
  const OPEN_FX = {
    zoom: [{ opacity: 0, transform: 'scale(.86)', filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'none' }],
    glide: [{ opacity: 0, transform: 'translateY(40px) rotateX(18deg)', transformOrigin: '50% 100%' }, { opacity: 1, transform: 'none' }],
    pop: [{ opacity: 0, transform: 'scale(.5)' }, { opacity: 1, transform: 'scale(1.04)', offset: .7 }, { transform: 'none' }],
  };
  // "magic lamp": the window pours into its taskbar button (and back out when restored)
  function lamp(win, back, done) {
    const el = win.el; const k = animK(); if (os().minFx === 'none' || k < 0.05) { if (done) done(); return; }
    const btn = taskApps.querySelector('.os-task[data-app="' + win.name + '"]'); const r = el.getBoundingClientRect(); const b = btn ? btn.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight, width: 0, height: 0 };
    const dx = b.left + b.width / 2 - (r.left + r.width / 2); const dy = b.top + b.height / 2 - (r.top + r.height / 2);
    const fx = os().minFx === 'scale' ? [{ transform: 'none', opacity: 1 }, { transform: `translate(${dx}px,${dy}px) scale(.05)`, opacity: 0 }]
      : [{ transform: 'none', opacity: 1, clipPath: 'polygon(0 0,100% 0,100% 100%,0 100%)' }, { offset: .45, transform: `translate(${dx * .35}px,${dy * .5}px) scale(.7,.85)`, clipPath: 'polygon(0 0,100% 0,70% 100%,30% 100%)', opacity: .95 }, { transform: `translate(${dx}px,${dy}px) scale(.06,.04)`, clipPath: 'polygon(0 0,100% 0,52% 100%,48% 100%)', opacity: 0 }];
    el.style.display = 'flex'; const a = el.animate(back ? fx.slice().reverse() : fx, { duration: 420 * k, easing: back ? 'cubic-bezier(.2,.9,.3,1)' : 'cubic-bezier(.55,0,.8,.4)' });
    a.onfinish = () => { el.style.display = ''; if (done) done(); };
  }
  // virtual desktops ("workspaces") with a cube or slide transition
  function applyWs() { for (const w of wins.values()) w.el.classList.toggle('ows-hide', w.ws !== curWs); }
  function paintWs() { mount(wsBar, Array.from({ length: WS_N }, (_, i) => { const n = [...wins.values()].filter((w) => w.ws === i).length; return h('button.os-wsb' + (i === curWs ? '.on' : ''), { title: t('Desktop {n}', { n: i + 1 }) + ' (Ctrl+Alt+' + (i + 1) + ')', onClick: (e) => { e.stopPropagation(); switchWs(i); } }, String(i + 1), n ? h('i', String(n)) : null); })); }
  let wsBusy = false;
  function switchWs(i) {
    if (i === curWs || wsBusy) return; const dir = i > curWs ? 1 : -1; const k = animK(); const cube = os().cube !== false && k > 0.05;
    const swap = () => { curWs = i; applyWs(); paintWs(); paintTask(); const top = [...wins.values()].filter((w) => w.ws === curWs && !w.min).sort((a, b) => b.z - a.z)[0]; if (top && focused !== top) { if (focused) focused.el.classList.remove('focused'); focused = top; top.el.classList.add('focused'); } else if (!top && focused) { focused.el.classList.remove('focused'); focused = null; } };
    if (k < 0.05) return swap(); wsBusy = true; winLayer.classList.add('ws-anim'); const D = 260 * k;
    const out = cube ? [{ transform: 'perspective(1600px) rotateY(0deg)', opacity: 1 }, { transform: `perspective(1600px) translateZ(-260px) rotateY(${-dir * 90}deg)`, opacity: .2 }] : [{ transform: 'none', opacity: 1 }, { transform: `translateX(${-dir * 40}%)`, opacity: 0 }];
    const inn = cube ? [{ transform: `perspective(1600px) translateZ(-260px) rotateY(${dir * 90}deg)`, opacity: .2 }, { transform: 'perspective(1600px) rotateY(0deg)', opacity: 1 }] : [{ transform: `translateX(${dir * 40}%)`, opacity: 0 }, { transform: 'none', opacity: 1 }];
    winLayer.style.transformOrigin = dir > 0 ? '100% 50%' : '0% 50%';
    winLayer.animate(out, { duration: D, easing: 'cubic-bezier(.5,0,.75,0)' }).onfinish = () => { swap(); winLayer.style.transformOrigin = dir > 0 ? '0% 50%' : '100% 50%'; winLayer.animate(inn, { duration: D, easing: 'cubic-bezier(.25,1,.5,1)' }).onfinish = () => { winLayer.classList.remove('ws-anim'); winLayer.style.transformOrigin = ''; wsBusy = false; }; };
    const toast1 = h('div.os-wstoast', t('Desktop {n}', { n: i + 1 })); root.appendChild(toast1); setTimeout(() => toast1.remove(), 1100);
  }
  // quick settings: a glass panel with transparency, effects, workspaces and the old menu items
  let qpEl = null;
  function quickPanel(e, fallback) {
    if (qpEl) { qpEl.remove(); qpEl = null; return; } const o = os();
    const tog = (key, label, ic) => h('button.os-qt' + (o[key] ? '.on' : ''), { onClick: () => { saveOs({ [key]: !o[key] }); qpEl.remove(); qpEl = null; quickPanel(e, fallback); } }, icon(ic, 18), h('span', label));
    const slider = (key, label, min, max, step, show) => { const out = h('b', show(o[key])); return h('label.os-qs', h('span', label), h('input', { type: 'range', min, max, step, value: o[key], onInput: (ev) => { out.textContent = show(Number(ev.target.value)); root.style.setProperty(key === 'glass' ? '--osw-a' : '--osw-blur', key === 'glass' ? ev.target.value : ev.target.value + 'px'); root.classList.toggle('fxglass', key !== 'glass' || Number(ev.target.value) < 0.99); }, onChange: (ev) => saveOs({ [key]: Number(ev.target.value) }) }), out); };
    const sel = (key, label, opts) => h('label.os-qs', h('span', label), h('select.select.sm', { onChange: (ev) => saveOs({ [key]: ev.target.value }) }, opts.map(([v, l]) => h('option', { value: v, selected: o[key] === v }, t(l)))));
    qpEl = h('div.os-quick', { onClick: (ev) => ev.stopPropagation() },
      h('div.os-qgrid', tog('wobbly', t('Wobbly windows'), 'activity'), tog('cube', t('Desktop cube'), 'cube'), tog('hot', t('Hot corner'), 'target'), tog('widgets', t('Side widgets'), 'layout')),
      slider('glass', t('Window opacity'), 0.35, 1, 0.01, (v) => Math.round(v * 100) + '%'), slider('blur', t('Glass blur'), 0, 40, 1, (v) => v + ' px'),
      sel('openFx', t('Open effect'), [['zoom', 'Zoom'], ['glide', 'Glide'], ['pop', 'Pop']]), sel('minFx', t('Minimize effect'), [['lamp', 'Magic lamp'], ['scale', 'Scale'], ['none', 'None']]), sel('closeFx', t('Close effect'), [['burn', 'Burn'], ['implode', 'Implode'], ['fade', 'Fade']]),
      h('div.os-qws', h('span', t('Desktops')), Array.from({ length: WS_N }, (_, i) => h('button' + (i === curWs ? '.on' : ''), { onClick: () => { switchWs(i); qpEl.remove(); qpEl = null; } }, String(i + 1)))),
      h('div.os-qrow', h('button.btn.sm', { onClick: () => { qpEl.remove(); qpEl = null; go('widgets'); } }, icon('widget', 14), t('Widgets')), h('button.btn.sm', { onClick: () => { qpEl.remove(); qpEl = null; wallpaperPicker(); } }, icon('image', 14), t('Wallpaper')), h('button.btn.sm.ghost', { onClick: (ev) => { qpEl.remove(); qpEl = null; fallback(ev); } }, icon('more', 14), t('More'))));
    root.appendChild(qpEl); const close1 = () => { if (qpEl) { qpEl.remove(); qpEl = null; } document.removeEventListener('pointerdown', close1); }; setTimeout(() => document.addEventListener('pointerdown', close1), 0);
  }

  // drag + snap
  function area() { const r = winLayer.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }
  function snapZone(px, py) {
    const a = area(); const m = 14; const x = px - a.x, y = py - a.y;
    const L = x < m, R = x > a.w - m, T = y < m, B = y > a.h - m;
    if (T && L) return { x: 0, y: 0, w: a.w / 2, h: a.h / 2 }; if (T && R) return { x: a.w / 2, y: 0, w: a.w / 2, h: a.h / 2 };
    if (B && L) return { x: 0, y: a.h / 2, w: a.w / 2, h: a.h / 2 }; if (B && R) return { x: a.w / 2, y: a.h / 2, w: a.w / 2, h: a.h / 2 };
    if (T) return { max: true }; if (L) return { x: 0, y: 0, w: a.w / 2, h: a.h }; if (R) return { x: a.w / 2, y: 0, w: a.w / 2, h: a.h }; return null;
  }
  function startDrag(e, win) {
    if (e.button !== 0 || e.target.closest('.os-wb') || small()) return; e.preventDefault(); focus(win);
    const a = area(); let g0 = Object.assign({}, win.g); const sx = e.clientX, sy = e.clientY; let moved = false; let zone = null;
    if (win.g.max || win.g.snap) { const rw = (win.g.pre && win.g.pre.w) || Math.min(900, a.w * 0.6); const rh = (win.g.pre && win.g.pre.h) || Math.min(640, a.h * 0.7); g0 = { x: clamp(e.clientX - a.x - rw / 2, 0, a.w - rw), y: 0, w: rw, h: rh }; }
    const blocker = h('div.os-blocker'); // keeps iframes from eating pointer events — added only once the drag really starts (so double-clicks still reach the title bar)
    const mv = (ev) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy; if (!moved && Math.hypot(dx, dy) < 4) return;
      if (!moved) { moved = true; root.appendChild(blocker); win.g = Object.assign({}, g0, { max: false, snap: null }); win.el.classList.add('dragging'); }
      win.g.x = clamp(g0.x + dx, -win.g.w + 80, a.w - 80); win.g.y = clamp(g0.y + dy, 0, a.h - 30); place(win);
      if (os().wobbly && animK() > 0.05) { const vx = ev.clientX - (mv.lx ?? ev.clientX), vy = ev.clientY - (mv.ly ?? ev.clientY); mv.lx = ev.clientX; mv.ly = ev.clientY; mv.sk = (mv.sk || 0) * 0.7 + clamp(-vx * 0.45, -9, 9) * 0.3; mv.sy = (mv.sy || 0) * 0.7 + clamp(vy * 0.004, -0.04, 0.04) * 0.3; win.el.style.transform = `skewX(${mv.sk.toFixed(2)}deg) scale(${(1 + Math.abs(mv.sk) * 0.004).toFixed(3)}, ${(1 - mv.sy).toFixed(3)})`; win.el.style.transformOrigin = `${((sx - win.el.getBoundingClientRect().left) / Math.max(1, win.g.w) * 100).toFixed(0)}% 0`; }
      zone = snapZone(ev.clientX, ev.clientY); if (zone) { snapPrev.classList.remove('hide'); const zz = zone.max ? { x: 0, y: 0, w: a.w, h: a.h } : zone; snapPrev.style.cssText = `left:${zz.x + a.x}px;top:${zz.y + a.y}px;width:${zz.w}px;height:${zz.h}px`; } else snapPrev.classList.add('hide');
    };
    const up = () => {
      document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); blocker.remove(); snapPrev.classList.add('hide'); win.el.classList.remove('dragging');
      if (mv.sk) { const k = mv.sk; win.el.style.transform = ''; win.el.animate([{ transform: `skewX(${k}deg)` }, { transform: `skewX(${-k * 0.5}deg)` }, { transform: `skewX(${k * 0.25}deg)` }, { transform: 'none' }], { duration: 520, easing: 'ease-out' }); mv.sk = 0; } else win.el.style.transform = '';
      if (!moved) return;
      if (zone) { const pre = { w: win.g.w, h: win.g.h }; if (zone.max) win.g = Object.assign(win.g, { max: true, pre }); else win.g = Object.assign({}, win.g, { x: zone.x, y: zone.y, w: zone.w, h: zone.h, snap: true, pre }); }
      place(win); geo[win.name] = win.g; saveGeo();
    };
    document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up);
  }
  function startResize(e, win, dir) {
    if (e.button !== 0 || win.g.max || small()) return; e.preventDefault(); e.stopPropagation(); focus(win);
    const g0 = Object.assign({}, win.g); const sx = e.clientX, sy = e.clientY; const a = area(); const blocker = h('div.os-blocker.rz-' + dir); root.appendChild(blocker);
    const mv = (ev) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy; const g = Object.assign({}, g0, { snap: null });
      if (dir.includes('e')) g.w = clamp(g0.w + dx, MIN_W, a.w - g0.x); if (dir.includes('s')) g.h = clamp(g0.h + dy, MIN_H, a.h - g0.y);
      if (dir.includes('w')) { const w = clamp(g0.w - dx, MIN_W, g0.x + g0.w); g.x = g0.x + g0.w - w; g.w = w; }
      if (dir.includes('n')) { const hh = clamp(g0.h - dy, MIN_H, g0.y + g0.h); g.y = g0.y + g0.h - hh; g.h = hh; }
      win.g = g; place(win);
    };
    const up = () => { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); blocker.remove(); geo[win.name] = win.g; saveGeo(); };
    document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up);
  }

  // ---------- taskbar / dock ----------
  const allowed = (n) => loaders[n] && (n !== 'admin' || isStaff());
  function togglePin(n) { const p = pinsOf(); ls('os.pins', p.includes(n) ? p.filter((x) => x !== n) : [...p, n]); paintTask(); }
  function paintTask() {
    const pins = pinsOf().filter(allowed); const names = [...pins, ...[...wins.keys()].filter((n) => !pins.includes(n))];
    mount(taskApps, names.map((n) => {
      const w = wins.get(n); const label = w ? w.title : t(appOf(n)[1]);
      return h('button.os-task' + (w ? '.run' : '') + (w && focused === w ? '.on' : '') + (w && w.min ? '.minned' : '') + (w && w.ws !== curWs ? '.otherws' : ''), { title: label, 'aria-label': label, dataset: { app: n },
        onClick: () => { if (!w) return go(n); if (focused === w && !w.min) minimize(w); else focus(w); },
        onContextmenu: (ev) => { ev.preventDefault(); const pinned = pinsOf().includes(n); openMenu([
          w ? { label: w.min ? t('Restore') : t('Minimize'), icon: 'window', onClick: () => (w.min ? focus(w) : minimize(w)) } : { label: t('Open'), icon: 'external', onClick: () => go(n) },
          w ? { label: w.g.max ? t('Restore size') : t('Maximize'), icon: 'fullscreen', onClick: () => toggleMax(w) } : null,
          { label: pinned ? t('Unpin from taskbar') : t('Pin to taskbar'), icon: 'pin', onClick: () => togglePin(n) },
          w ? { hr: true } : null, w ? { label: t('Close window'), icon: 'x', danger: true, onClick: () => close(w) } : null].filter(Boolean), ev); } },
        tile(n, 17, '.tk'));
    }));
  }
  function tickClock() {
    const d = new Date(); const L = lang();
    winClock.firstChild.textContent = d.toLocaleTimeString(L, { hour: '2-digit', minute: '2-digit' }); winClock.lastChild.textContent = d.toLocaleDateString(L, { day: '2-digit', month: '2-digit', year: 'numeric' });
    gClock.textContent = d.toLocaleDateString(L, { day: 'numeric', month: 'short' }) + '  ' + d.toLocaleTimeString(L, { hour: '2-digit', minute: '2-digit' });
    winClock.title = gClock.title = d.toLocaleDateString(L, { dateStyle: 'full' }); wsDot.classList.toggle('on', !!S.ws);
  }
  function calendar(force) {
    if (calEl) { calEl.remove(); calEl = null; if (force !== true) return; } if (force === false) return;
    const now = new Date(); let y = now.getFullYear(), m = now.getMonth(); const L = lang();
    const head = h('b'); const grid = h('div.os-calgrid');
    const paint = () => {
      head.textContent = new Date(y, m, 1).toLocaleDateString(L, { month: 'long', year: 'numeric' });
      const first = (new Date(y, m, 1).getDay() + 6) % 7; const days = new Date(y, m + 1, 0).getDate(); const cells = [];
      for (let i = 0; i < 7; i++) cells.push(h('span.wd', new Date(2024, 0, 1 + i).toLocaleDateString(L, { weekday: 'short' }).slice(0, 2)));
      for (let i = 0; i < first; i++) cells.push(h('span'));
      for (let i = 1; i <= days; i++) cells.push(h('span.d' + (i === now.getDate() && m === now.getMonth() && y === now.getFullYear() ? '.today' : ''), String(i)));
      mount(grid, cells);
    };
    const step = (k) => { m += k; if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; } paint(); };
    calEl = h('div.os-cal', { onPointerdown: (e) => e.stopPropagation() }, h('div.os-calday', now.toLocaleDateString(L, { weekday: 'long', day: 'numeric', month: 'long' })),
      h('div.os-calhead', head, h('div.grow'), h('button.os-tbtn', { 'aria-label': t('Previous month'), onClick: () => step(-1) }, glyph(G.up, 14)), h('button.os-tbtn', { 'aria-label': t('Next month'), onClick: () => step(1) }, glyph(G.down, 14))), grid);
    paint(); root.appendChild(calEl);
  }

  // ---------- Start panel (Glass) / app overview (Dock) ----------
  function toggleStart(force) {
    const show = force !== undefined ? force : startEl.classList.contains('hide');
    startEl.className = 'os-startmenu hide'; if (!show) return; calendar(false);
    const linux = style() === 'linux'; const apps = visibleApps(); let view = 'pinned';
    const launch = (n) => { toggleStart(false); go(n); };
    const q = h('input.os-sq', { placeholder: linux ? t('Type to search') : t('Search for apps, settings, and documents'), 'aria-label': t('Search'), onInput: () => paint() });
    const body = h('div.os-sbody');
    const appBtn = (n, size) => h('button.os-sapp', { onClick: () => launch(n), onContextmenu: (ev) => { ev.preventDefault(); openMenu([{ label: t('Open'), icon: 'external', onClick: () => launch(n) }, { label: pinsOf().includes(n) ? t('Unpin from taskbar') : t('Pin to taskbar'), icon: 'pin', onClick: () => togglePin(n) }, { label: (ls('os.startup') || []).includes(n) ? t('Do not open at startup') : t('Open at startup'), icon: 'power', onClick: () => toggleStartup(n) }], ev); } }, tile(n, size, '.sti'), h('span', t(appOf(n)[1])));
    const match = () => { const s = q.value.trim().toLowerCase(); return apps.filter(([n, l]) => t(l).toLowerCase().includes(s) || n.includes(s) || t(metaOf(n)[2] || '').toLowerCase().includes(s)).map(([n]) => n); };
    function paint() {
      const s = q.value.trim();
      if (linux) { const list = s ? match() : apps.map(([n]) => n); mount(body, list.length ? h('div.os-sgrid', list.map((n) => appBtn(n, 34))) : h('p.os-snone', t('No results.'))); return; }
      if (s) { const list = match(); mount(body, h('div.os-shead', h('b', t('Best match'))), list.length ? h('div.os-sgrid', list.map((n) => appBtn(n, 22))) : h('p.os-snone', t('No results.'))); return; }
      if (view === 'all') {
        const out = []; const shown = new Set(apps.map(([n]) => n));
        const groupsList = cats.length ? cats : [['All apps', apps.map(([n]) => n)]];
        for (const [cat, names] of groupsList) { const list = names.filter((n) => shown.has(n)); if (!list.length) continue; out.push(h('div.os-sletter', t(cat))); for (const n of list) out.push(h('button.os-srow', { onClick: () => launch(n) }, tile(n, 15, '.xs'), h('span', h('b', t(appOf(n)[1])), metaOf(n)[2] ? h('small', t(metaOf(n)[2])) : null))); }
        mount(body, h('div.os-shead', h('b', t('All apps')), h('button.os-smore', { onClick: () => { view = 'pinned'; paint(); } }, glyph(G.left, 12), t('Back'))), h('div.os-slist', out)); return;
      }
      const pinned = [...new Set([...pinsOf().filter(allowed), ...apps.map(([n]) => n)])].slice(0, 18);
      const rec = recent.filter(allowed).slice(0, 6);
      mount(body, h('div.os-shead', h('b', t('Pinned')), h('button.os-smore', { onClick: () => { view = 'all'; paint(); } }, t('All apps'), glyph(G.right, 12))), h('div.os-sgrid', pinned.map((n) => appBtn(n, 22))),
        h('div.os-shead', h('b', t('Recommended'))), rec.length ? h('div.os-srec', rec.map((n) => h('button.os-srow', { onClick: () => launch(n) }, tile(n, 18, '.sm'), h('span', h('b', t(appOf(n)[1])), h('small', t('Recently opened')))))) : h('p.os-snone', t('The apps you open will show up here.')));
    }
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const b = body.querySelector('.os-sapp, .os-srow'); if (b) b.click(); } else if (e.key === 'Escape') toggleStart(false); });
    const search = h('label.os-ssearch', icon('search', 16), q);
    if (linux) mount(startEl, search, body);
    else mount(startEl, search, body, h('div.os-sfoot', h('button.os-suser', { onClick: (e) => accountMenu(e.currentTarget) }, avatarEl(S.me, { size: 30, frame: false }), h('span', S.me.displayName || S.me.username)), h('div.grow'),
      h('button.os-tbtn.lg', { title: t('Power'), 'aria-label': t('Power'), onClick: (e) => openMenu([{ label: t('Close desktop mode'), icon: 'power', onClick: () => { toggleStart(false); shutdown(); } }, { label: t('Log out'), icon: 'logout', danger: true, onClick: logout }], e) }, icon('power', 18))));
    startEl.className = 'os-startmenu ' + (linux ? 'overview' : 'start'); paint(); setTimeout(() => q.focus(), 30);
  }
  document.addEventListener('pointerdown', (e) => {
    if (!startEl.classList.contains('hide') && !startEl.contains(e.target) && !startBtn.contains(e.target) && !searchBtn.contains(e.target) && !gbar.contains(e.target) && !appsBtn.contains(e.target) && !e.target.closest('.menu')) toggleStart(false);
    if (calEl && !calEl.contains(e.target)) calendar(false);
  });
  function deskMenu(e) {
    const o = os();
    openMenu([
      { label: t('Refresh'), icon: 'refresh', onClick: () => { iconsEl.style.visibility = 'hidden'; setTimeout(() => { paintIcons(); iconsEl.style.visibility = ''; }, 120); } },
      { label: o.icons ? t('Hide desktop icons') : t('Show desktop icons'), icon: 'cube', onClick: () => saveOs({ icons: !o.icons }) },
      { label: o.widgets ? t('Hide widgets') : t('Show widgets'), icon: 'layers', onClick: () => saveOs({ widgets: !o.widgets }) },
      { hr: true }, { label: t('Tile open windows'), icon: 'layout', onClick: tileAll }, { label: t('Minimize all'), icon: 'window', onClick: () => wins.forEach((w) => minimize(w)) },
      { hr: true }, { label: t('Personalize'), icon: 'palette', onClick: wallpaperPicker },
    ], e);
  }
  function tileAll() {
    const list = [...wins.values()].filter((w) => !w.min); if (!list.length) return; const a = area(); const cols = Math.ceil(Math.sqrt(list.length)); const rows = Math.ceil(list.length / cols);
    list.forEach((w, i) => { const c = i % cols, r = Math.floor(i / cols); w.g = { x: c * a.w / cols, y: r * a.h / rows, w: a.w / cols, h: a.h / rows, snap: true }; place(w); geo[w.name] = w.g; }); saveGeo();
  }
  async function wallpaperPicker() {
    const o = os();
    const grid = h('div.os-wpgrid', WALLPAPERS.map(([id, name, e]) => h('button.os-wp' + (o.wallpaper === id ? '.on' : ''), { dataset: { wp: id }, onClick: async (ev) => {
      if (id === 'image') { const f = await new Promise((res) => { const i = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', style: 'display:none' }); i.onchange = () => { res(i.files[0] || null); i.remove(); }; document.body.appendChild(i); i.click(); }); if (!f) return; try { const up = await api.upload('bg', f); await saveOs({ wallpaper: 'image', image: up.url }); } catch (err) { toastErr(err); return; } }
      else await saveOs({ wallpaper: id });
      grid.querySelectorAll('.os-wp').forEach((b) => b.classList.toggle('on', b === ev.currentTarget));
    } }, h('span.os-wpe', ic(e, 18)), h('span.small', t(name)))));
    const dim = h('input', { type: 'range', min: 0, max: 0.8, step: 0.05, value: o.dim, onChange: () => saveOs({ dim: Number(dim.value) }) });
    modal({ title: t('Desktop & wallpaper'), cls: 'wide', body: h('div.col',
      grid,
      settingRow(t('Darken wallpaper'), t('Makes windows easier to read.'), dim),
      settingRow(t('Wallpaper reacts to music'), t('Animated wallpapers pulse with whatever plays in Pulse.'), switchEl(o.react, (v) => saveOs({ react: v }))),
      settingRow(t('Desktop style'), t('Glass has a centred taskbar and a Start panel; Dock has a top bar, a side dock and an app overview.'), segEl([['win', 'Nebulix Glass'], ['linux', 'Nebulix Dock']], style(), (v) => saveOs({ winStyle: v }))),
      settingRow(t('Taskbar position'), null, segEl([['bottom', t('Bottom')], ['top', t('Top')]], o.dock, (v) => saveOs({ dock: v }))),
      settingRow(t('Widgets'), null, switchEl(o.widgets, (v) => saveOs({ widgets: v }))), settingRow(t('Desktop icons'), null, switchEl(o.icons, (v) => saveOs({ icons: v }))),
      settingRow(t('Reopen my windows'), t('Restore the apps you had open last time.'), switchEl(o.restore !== false, (v) => saveOs({ restore: v })))),
      actions: [{ label: t('Done'), kind: 'primary' }] });
  }

  // ---------- lifecycle ----------
  const offs = [];
  offs.push(bus.on('ws:feed', (m) => { liveData = [m.e, ...(liveData || [])].slice(0, 4); paintWidgets(); }), bus.on('ws:boss', debounce(() => loadLive(), 1500)));
  offs.push(bus.on('pulse', debounce(() => paintWidgets(), 250)), bus.on('friends', () => paintWidgets()), bus.on('presence', debounce(() => paintWidgets(), 400)), bus.on('ws:prog', () => loadProg()), bus.on('ws:open', tickClock), bus.on('ws:close', tickClock));
  const clockT = setInterval(() => { tickClock(); if (new Date().getSeconds() < 15) paintWidgets(); }, 15000);
  offs.push(bus.on('me', () => { coin.textContent = S.me && S.me.coins >= 1e9 ? '∞' : fmt.coins((S.me && S.me.coins) || 0); }));
  const onResize = debounce(() => { root.classList.toggle('small', small()); for (const w of wins.values()) { if (w.g.max) continue; const a = area(); w.g.x = clamp(w.g.x, -w.g.w + 80, Math.max(0, a.w - 80)); w.g.y = clamp(w.g.y, 0, Math.max(0, a.h - 30)); place(w); } }, 150);
  addEventListener('resize', onResize);
  // Nebulix 3.0 App Store: games/apps installed from the Hub become desktop apps (their own window, start menu, desktop)
  const installedCat = ['Installed', []]; cats.push(installedCat);
  const updated = new Set(); // installed apps with a new version since they were last opened
  function appMenu(n, ev) { const id = n.slice(2); const label = (APPS.find((a) => a[0] === n) || [n, n])[1];
    openMenu([{ label: t('Open'), icon: 'external', onClick: () => go(n) }, { label: t('Open in Nebulix Hub'), icon: 'book', onClick: () => go('hub', id) }, { hr: true },
      { label: t('Uninstall'), icon: 'trash', danger: true, onClick: async () => { if (!(await confirmBox(t('Uninstall “{n}”? Your saved progress stays on your account.', { n: label }), { danger: true }))) return; try { await api.post('/api/hub/' + id + '/install'); const w = wins.get(n); if (w) close(w); toast(t('Uninstalled'), 'good'); loadInstalled(); } catch (e) { toastErr(e); } } }], ev); }
  async function loadInstalled() {
    let list = []; try { list = (await api.get('/api/apps/installed', { quiet: true })).apps; } catch { return; }
    for (let i = APPS.length - 1; i >= 0; i--) if (APPS[i][0].startsWith('x-')) APPS.splice(i, 1);
    installedCat[1].length = 0;
    const seen = ls('os.appver') || {}; let changed = false;
    for (const it of list) { const k = 'x-' + it.id; const v = it.version || 1; if (seen[it.id] === undefined) { seen[it.id] = v; changed = true; } else if (v > seen[it.id] && !updated.has(k)) { updated.add(k); toast(t('{n} was updated to version {v}', { n: it.title, v }), 'info', 6000); } APPS.push([k, it.title, it.kind === 'game' ? 'gamepad' : 'cube', ['#8b7bff', '#22c55e', '#f59e0b', '#ec4899', '#06b6d4', '#ef4444'][it.title.length % 6]]); loaders[k] = () => Promise.resolve({ default: hubAppView(it.id) }); installedCat[1].push(k); }
    if (changed) ls('os.appver', seen); paintIcons(); paintTask();
  }
  // opening an updated app clears its badge
  const markSeen = (n) => { if (!n || !n.startsWith('x-') || !updated.has(n)) return; updated.delete(n); const seen = ls('os.appver') || {}; api.get('/api/hub/' + n.slice(2), { quiet: true }).then((r) => { seen[n.slice(2)] = r.item.version || 1; ls('os.appver', seen); paintIcons(); }).catch(() => {}); };
  const onApps = () => loadInstalled(); addEventListener('nbx:apps', onApps); loadInstalled();
  applyWall(); paintIcons(); paintWidgets(); paintTask(); tickClock(); loadProg(); loadLive(); boot();
  const liveT = setInterval(() => { if (os().widgets) loadLive(); }, 60000);
  api.post('/api/progress/event', { type: 'os' }, { quiet: true }).catch(() => {});
  const restoreSession = (skip) => {
    const ok = (n) => n !== skip && loaders[n] && (n !== 'admin' || isStaff()) && !wins.has(n);
    if (os().restore !== false) for (const n of (ls('os.session') || []).filter((x) => x !== 'camera').slice(0, 6)) if (ok(n)) open(n, { params: [], query: new URLSearchParams() });
    for (const n of (ls('os.startup') || []).slice(0, 8)) if (ok(n)) open(n, { params: [], query: new URLSearchParams() }); // 3.0: startup apps
  };
  const startupOf = () => ls('os.startup') || [];
  const toggleStartup = (n) => { const l = startupOf(); ls('os.startup', l.includes(n) ? l.filter((x) => x !== n) : [...l, n].slice(0, 8)); toast(l.includes(n) ? t('Will no longer open at startup') : t('Will open when Nebulix OS starts'), 'good'); };
  const saveSession = debounce(() => ls('os.session', [...wins.keys()]), 500);
  return {
    el: root, open, wins,
    route(name, r) { if (name === 'desktop') { toggleStart(false); return; } if (!loaders[name] || (name === 'admin' && !isStaff())) name = 'home'; return open(name, r); },
    restore: restoreSession,
    focusedName: () => (focused ? focused.name : null),
    destroy() { removeEventListener('nbx:apps', onApps); try { offWidgets(); } catch {} delete window.__nbxOs; document.removeEventListener('copy', onCopy); document.removeEventListener('keydown', onSw, true); document.removeEventListener('keyup', onSwUp, true); document.removeEventListener('keydown', onWsKeys, true); document.body.classList.remove('os-mode', 'os-dock-top', 'os-gnome'); for (const w of [...wins.values()]) { if (w.cleanup) try { w.cleanup(); } catch (e) { console.error(e); } } wins.clear(); offs.forEach((f) => f()); clearInterval(clockT); clearInterval(liveT); document.removeEventListener('keydown', onKeys, true); removeEventListener('resize', onResize); setWallpaper(null); },
    refresh() { applyWall(); paintIcons(); paintWidgets(); },
  };
}
export function actText(a) { return a ? (a.label || '') : ''; }
