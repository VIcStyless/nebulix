// Nebulix SPA entry: boot, auth gate, shell (rail + topbar) or OS mode desktop, hash router, realtime wiring, global hotkeys.
import { h, $, mount, fmt } from './util.js';
import { t, getLang, setLang, loadLang, detectLang, LANGS, langName } from './i18n.js';
import { api, ws, ApiError } from './api.js';
import { S, bus, setMe, patchMe, isStaff, isPro } from './state.js';
import { initBackground } from './starfield.js';
import * as theme from './theme.js';
import { loadCatalog, avatarEl } from './cosmetics.js';
import { icon, logoMark, LOGOS, setLogo, paintFavicon } from './icons.js';
import { toast, toastErr, openMenu, confetti } from './ui.js';
import { openPalette } from './palette.js';
import { loadServers } from './servers.js';
import { sfx, dnd } from './sfx.js';
import { miniPlayer } from './pulse/mini.js';
import { onProg } from './progress-fx.js';
import { statusModal } from './status.js';
import * as inbox from './inbox.js';
import { shortcutsSheet } from './shortcuts.js';
import * as rtc from './rtc.js';
import * as panic from './panic.js';
import { startTour, maybeWelcomeTour } from './tour.js';
import * as vroom from './voice-room.js';
import { maybeShowWhatsNew, showWhatsNew } from './whatsnew.js';
import { initHoverGlow } from './hover.js';
import { buildNexus } from './nexus.js';
import { appTile } from './apps-meta.js';
import { maybeDisguise, showDecoy, releaseDecoy, decoyShowing } from './decoy.js';

// Sidebar groups: [label, [[route, label, icon], …]]
const NAV_GROUPS = [
  ['', [['home', 'Home', 'home'], ['live', 'Nebulix Live', 'activity'], ['season', 'Season', 'star'], ['browse', 'Browser', 'globe']]],
  ['Learn', [['study', 'Study', 'book'], ['study/cards', 'Flashcards', 'layers'], ['study/tutor', 'AI tutor', 'spark'], ['study/live', 'Live class', 'users']]],
  ['Social', [['echo', 'Nebulix Echo', 'activity'], ['clips', 'Clips', 'zap'], ['tv', 'Nebulix TV', 'play'], ['lens', 'Nebulix Lens', 'image'], ['forum', 'Nebulix Foros', 'chat'], ['chat', 'Community', 'users'], ['dm', 'Messages', 'mail'], ['clans', 'Clans', 'shield'], ['squads', 'Squads', 'target'], ['events', 'Events', 'calendar']]],
  ['Play', [['games', 'Nebulix Games', 'gamepad'], ['arena', 'Nebulix Arena', 'target'], ['fusion', 'Nebula Fusion', 'spark'], ['dash', 'Nebula Dash', 'zap'], ['ranked', 'Competitive', 'trophy'], ['vault', 'Nebula Vault', 'bag'], ['retro', 'Retro consoles', 'gamepad'], ['cloud', 'Cloud gaming', 'monitor'], ['worlds', 'Nebula Worlds', 'cube'], ['boss', 'World Boss', 'zap'], ['tournaments', 'Tournaments', 'trophy'], ['leagues', 'Leagues', 'medal'], ['quiz', 'Nebulix Quiz', 'flag'], ['word', 'Word of the day', 'type'], ['play', 'Games', 'puzzle'], ['music', 'Pulse', 'music'], ['arcade', 'Arcade', 'gamepad'], ['library', 'Game library', 'layers'], ['casino', 'Casino', 'dice'], ['casino3d', '3D Casino', 'box3d']]],
  ['Economy', [['shop', 'Shop & Locker', 'bag'], ['wallet', 'Wallet', 'coins'], ['life', 'Life', 'heart'], ['work', 'Work', 'clip'], ['invest', 'Invest', 'chart'], ['perks', 'Advantages', 'zap'], ['market', 'Market', 'bag'], ['plaza', 'Plaza', 'gift'], ['avatar', 'My 3D avatar', 'box3d']]],
  ['Create', [['code', 'Nebulix Code', 'terminal'], ['devtools', 'Developer Toolbox', 'terminal'], ['studio', 'Nebulix Studio', 'edit'], ['hub', 'Nebulix Hub', 'upload'], ['gamedev', 'Create games', 'gamepad'], ['drive', 'Drive', 'layers'], ['docs', 'Docs', 'note'], ['sheets', 'Sheets', 'grid'], ['slides', 'Slides', 'monitor'], ['notes', 'Notes', 'note'], ['calendar', 'Calendar & Tasks', 'calendar'], ['nova', 'Nova AI', 'spark'], ['translate', 'Translator', 'translate'], ['look', 'Appearance', 'layout'], ['mods', 'Mods', 'puzzle'], ['themes', 'Themes', 'palette'], ['terminal', 'Terminal', 'terminal'], ['vm', 'Virtual machines', 'cpu'], ['android', 'Nebulix Android', 'phone'], ['cloudpc', 'Cloud PC', 'monitor'], ['security', 'Security Lab', 'shield'], ['vpn', 'Nebulix VPN', 'lock'], ['links', 'Links', 'link'], ['nerd', 'Nerd Lab', 'flask'], ['changelog', 'What’s new', 'bolt']]],
];
const NAV = NAV_GROUPS.flatMap((g) => g[1]);
const LOADERS = {
  mods: () => import('./views/mods.js'), study: () => import('./views/study.js'), fusion: () => import('./views/fusion.js'), dash: () => import('./views/dash.js'), home: () => import('./views/home.js'), browse: () => import('./views/browser.js'), chat: () => import('./views/chat.js'), dm: () => import('./views/dm.js'),
  casino: () => import('./views/casino.js'), market: () => import('./views/market.js'), themes: () => import('./views/themes.js'), nova: () => import('./views/nova.js'),
  nerd: () => import('./views/nerd.js'), settings: () => import('./views/settings.js'), profile: () => import('./views/profile.js'), pro: () => import('./views/pro.js'),
  ext: () => import('./views/ext.js'), admin: () => import('./views/admin.js'), music: () => import('./views/music.js'), dj: () => import('./views/dj.js'),
  arcade: () => import('./views/arcade.js'), progress: () => import('./views/progress.js'), play: () => import('./views/play.js'),
  squads: () => import('./views/squads.js'), events: () => import('./views/events.js'), library: () => import('./views/library.js'), notes: () => import('./views/notes.js'), translate: () => import('./views/translate.js'), changelog: () => import('./views/changelog.js'),
  perks: () => import('./views/perks.js'), echo: () => import('./views/echo.js'), clips: () => import('./views/clips.js'), tv: () => import('./views/tv.js'),
  hub: () => import('./views/hub.js'), devtools: () => import('./views/devtools.js'), calendar: () => import('./views/calendar.js'), android: () => import('./views/android.js'), cloudpc: () => import('./views/cloudpc.js'), gamedev: () => import('./views/gamedev.js'), drive: () => import('./views/drive.js'), docs: () => import('./views/docs.js'), sheets: () => import('./views/sheets.js'), slides: () => import('./views/slides.js'), code: () => import('./views/code.js'), studio: () => import('./views/studio.js'),
  plaza: () => import('./views/plaza.js'), avatar: () => import('./views/avatar.js'), casino3d: () => import('./views/casino3d.js'), fps: () => import('./views/arena.js'), // old link: the 3D shooter lives in the Arena
  wallet: () => import('./views/wallet.js'), look: () => import('./views/look.js'), season: () => import('./views/season.js'), worlds: () => import('./views/worlds.js'), clans: () => import('./views/clans.js'), live: () => import('./views/live.js'), word: () => import('./views/word.js'), games: () => import('./views/games.js'), arena: () => import('./views/arena.js'), shop: () => import('./views/shop.js'), vm: () => import('./views/vm.js'), terminal: () => import('./views/vm.js').then((m) => ({ default: Object.assign({}, m.default, { title: () => 'Terminal', mount: (r, c) => m.default.mount(r, Object.assign({}, c, { params: ['terminal'] })) }) })), security: () => import('./views/security.js'), vpn: () => import('./views/vpn.js'), retro: () => import('./views/retro.js'), cloud: () => import('./views/cloud.js'), links: () => import('./views/links.js'), ranked: () => import('./views/ranked.js'), vault: () => import('./views/vault.js'), leagues: () => import('./views/leagues.js'), boss: () => import('./views/boss.js'), tournaments: () => import('./views/tournaments.js'), quiz: () => import('./views/quiz.js'), life: () => import('./views/life.js'), lens: () => import('./views/lens.js'), forum: () => import('./views/forum.js'), work: () => import('./views/work.js'), invest: () => import('./views/invest.js'),
};
const KEEP = new Set(['browse', 'chat', 'dm']);

let fx14mod = null; let nexus = null, crumbEl = null; let shell = null, viewsEl = null, titleEl = null, railEl = null, current = null, desk = null; const cache = {}; const mounted = {};
// Desktop mode (Nebulix OS) is a separate experience that runs in its own tab (/?os=1). The classic interface is never changed by it.
const OS_TAB = new URLSearchParams(location.search).has('os');
const osMode = () => OS_TAB;

// ---------- the address bar never changes after Nebulix opens ----------
// Chrome records every change of the page address in its history (even replaceState), so after the first load Nebulix
// keeps "where you are" internally (nav.hash) and never touches the address bar again. Any code that still calls
// history.replaceState/pushState with an in-app #/… address is redirected here. A reload brings you back to where you were.
const nav = { hash: '' };
const realReplace = history.replaceState.bind(history);
export const navHash = () => nav.hash;
function setNav(hash) { nav.hash = hash || '#/home'; try { sessionStorage.setItem('nbx.route', nav.hash); } catch {} }
{
  const opened = location.hash; let saved = null;
  try { saved = sessionStorage.getItem('nbx.route'); const o = sessionStorage.getItem('nbx.open'); if (o !== opened) { sessionStorage.setItem('nbx.open', opened); if (o !== null) saved = null; } } catch {}
  nav.hash = saved || opened; // same tab reloaded on the same address: back to where you were; a new address wins
  try { if (nav.hash) sessionStorage.setItem('nbx.route', nav.hash); else sessionStorage.removeItem('nbx.route'); } catch {}
  const same = (url) => { try { const u = new URL(String(url), location.href); return u.origin === location.origin && u.pathname === location.pathname && u.search === location.search; } catch { return false; } };
  const swallow = (state, title, url) => { if (url != null && same(url)) { setNav(new URL(String(url), location.href).hash); return; } return realReplace(state, title, url); };
  try { history.replaceState = swallow; history.pushState = swallow; } catch {}
}

// ---------- routing ----------
export function parseHash() {
  const raw = nav.hash.replace(/^#\/?/, ''); const [path, q] = raw.split('?'); const parts = path.split('/').filter(Boolean).map((x) => { try { return decodeURIComponent(x); } catch { return x; } });
  return { name: parts[0] || 'home', params: parts.slice(1), query: new URLSearchParams(q || '') };
}
export function go(name, query) {
  let hash = '#/' + name; if (query && typeof query === 'object') { const q = new URLSearchParams(query).toString(); if (q) hash += '?' + q; } else if (typeof query === 'string') hash += '/' + query;
  // replaceState instead of a new hash: moving between sections never adds entries to the browser's history,
  // so Chrome's history only shows Nebulix once, when it was opened.
  if (nav.hash !== hash) setNav(hash);
  route();
}
// In-app links (<a href="#/…">) go through go() too, for the same reason.
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest && e.target.closest('a[href^="#/"]'); if (!a || a.target === '_blank') return;
  e.preventDefault(); const hash = a.getAttribute('href');
  if (nav.hash !== hash) setNav(hash);
  route();
});
async function route() {
  if (!S.me || !shell) return;
  const r = parseHash();
  if (desk) return desk.route(r.name, r); // the desktop knows its own apps (incl. Notes, Calculator…)
  const name = LOADERS[r.name] ? r.name : 'home';
  if (name === 'admin' && !isStaff()) return go('home');
  const prev = current;
  if (prev && (prev !== name || !KEEP.has(name))) { const pm = mounted[prev]; if (pm) { if (KEEP.has(prev)) { pm.el.classList.add('hidden'); pm.mod.deactivate && pm.mod.deactivate(); } else { try { pm.cleanup && pm.cleanup(); } catch (e) { console.error(e); } pm.el.remove(); delete mounted[prev]; } } }
  current = name; paintRail(name); bus.emit('route', name);
  let m = mounted[name];
  const ctx = { params: r.params, query: r.query, go, setTitle };
  if (m && KEEP.has(name)) { m.el.classList.remove('hidden'); m.mod.activate && m.mod.activate(ctx); setTitle(m.mod.title ? m.mod.title() : name); return; }
  try {
    const mod = cache[name] || (cache[name] = (await LOADERS[name]()).default);
    if (current !== name) return; // user navigated away while loading
    const el = h('section.view' + (mod.full ? '.full' : ''), { 'data-view': name });
    viewsEl.appendChild(el); m = mounted[name] = { el, mod, cleanup: null };
    setTitle(mod.title ? mod.title() : name);
    m.cleanup = await mod.mount(el, ctx);
  } catch (e) {
    console.error('[route]', name, e);
    let em = mounted[name]; if (!em) { em = mounted[name] = { el: viewsEl.appendChild(h('section.view')), mod: {}, cleanup: null }; } const el = em.el; mount(el, h('div.empty', h('div.empty-art', icon('alert', 26)), h('h3', t('This page could not load')), h('p.muted', String(e && e.message || e)), h('button.btn', { onClick: () => { delete mounted[name]; el.remove(); route(); } }, t('Try again'))));
  }
}
function setTitle(s) { if (titleEl) titleEl.textContent = s; if (panic.settings().cloak === 'off') document.title = s + ' · Nebulix'; }
function paintRail(name) { if (nexus) { nexus.setActive(name); if (crumbEl) { const c = nexus.catName(name); crumbEl.textContent = c && name !== 'home' ? c + ' › ' : ''; } } if (!railEl) return; for (const b of railEl.querySelectorAll('[data-nav]')) b.classList.toggle('on', b.dataset.nav === name); }

// ---------- shell ----------
function badgeFor(k) { return k === 'dm' ? S.dmUnread : k === 'chat' ? Object.values(S.mentions).reduce((a, b) => a + b, 0) : 0; }
function railBtn(k, label, ic) {
  const n = badgeFor(k);
  return h('a.rail-btn', { href: '#/' + k, 'data-nav': k, 'aria-label': t(label) }, h('span.rb-ic', icon(ic, 18)), h('span.rb-l', t(label)), h('span.lbl-tip', t(label)), n ? h('span.nb', n > 99 ? '99+' : n) : null);
}
// Menu layouts: where the navigation lives. Saved per device.
export const LAYOUTS = [['nexus', 'Nexus (categories)'], ['left', 'Sidebar (left)'], ['right', 'Sidebar (right)'], ['top', 'Top bar'], ['dock', 'Floating dock'], ['compact', 'Compact icons'], ['float', 'Floating sidebar'], ['island', 'Top island'], ['launcher', 'App launcher']];
export const layoutNow = () => { try { const v = JSON.parse(localStorage.getItem('nbx.layout')); return LAYOUTS.some((l) => l[0] === v) ? v : 'nexus'; } catch { return 'nexus'; } };
// 8.0: Nexus is the new default; the old default sidebar moves over once (anyone can switch back in Appearance)
try { if (!localStorage.getItem('nbx.layout8')) { localStorage.setItem('nbx.layout8', '1'); if (JSON.parse(localStorage.getItem('nbx.layout')) === 'left') localStorage.setItem('nbx.layout', JSON.stringify('nexus')); } } catch {}
export function setLayout(v) {
  try { localStorage.setItem('nbx.layout', JSON.stringify(v)); } catch {}
  if (shell) { shell.dataset.layout = v; if (v === 'compact') shell.dataset.side = 'mini'; else if (v !== 'left' && v !== 'right') shell.dataset.side = 'full'; }
  if (v !== 'launcher') closeLauncher();
}
export function layoutMenu(anchor) { openMenu(LAYOUTS.map(([k, l]) => ({ label: t(l), icon: layoutNow() === k ? 'check' : 'layout', onClick: () => setLayout(k) })), anchor); }
// Design skins change the whole look (shapes, type, depth) on top of any colour theme.
export const DESIGNS = [['fourteen', 'Nebulix 14'], ['seven', 'Nebulix 7'], ['studio', 'Studio (clean)'], ['classic', 'Classic'], ['glass', 'Glass'], ['brutal', 'Brutalist'], ['retro', 'Retro terminal'], ['paper', 'Editorial'], ['neon', 'Neon'], ['soft', 'Soft clay'], ['minimal', 'Minimal'], ['comic', 'Comic'], ['aurora', 'Aurora glow'], ['dev', 'Dev (code site)'], ['cyber', 'Cyberpunk'], ['kawaii', 'Kawaii'], ['bevel', 'Retro desktop'], ['bento', 'Bento'], ['holo', 'Holographic'], ['sketch', 'Sketchbook']];
// "App launcher" layout: no menu bar at all; a round button opens a full-screen grid of every app (Esc closes it).
let launcherEl = null;
export function closeLauncher() { if (launcherEl) { launcherEl.remove(); launcherEl = null; document.removeEventListener('keydown', launcherKey, true); } }
function launcherKey(e) { if (e.key === 'Escape') { e.preventDefault(); closeLauncher(); } }
export function openLauncher() {
  if (launcherEl) return closeLauncher();
  const q = h('input.input.ln-q', { placeholder: t('Search apps…'), 'aria-label': t('Search apps') });
  const list = h('div.ln-body');
  const tile = ([k, label, ic]) => h('a.ln-tile', { href: '#/' + k, onClick: () => closeLauncher() }, appTile(k, ic, 46), h('span', t(label)));
  const extra = [['look', 'Appearance', 'palette'], ['ext', 'Extensions', 'puzzle'], ['pro', 'Premium', 'crown'], ['settings', 'Settings', 'gear']];
  const paint = () => { const s = q.value.trim().toLowerCase(); const groups = NAV_GROUPS.concat([['More', extra]]).map(([g, items]) => [g, items.filter((x) => !s || t(x[1]).toLowerCase().includes(s) || x[0].includes(s))]).filter((g) => g[1].length);
    mount(list, groups.map(([g, items]) => h('section.ln-sec', g ? h('div.ln-g', t(g)) : null, h('div.ln-grid', items.map(tile))))); };
  q.addEventListener('input', paint);
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const a = list.querySelector('.ln-tile'); if (a) a.click(); } });
  launcherEl = h('div.ln-ov', { onClick: (e) => { if (e.target === launcherEl) closeLauncher(); } }, h('div.ln-box', h('div.ln-head', icon('grid', 18), q, h('button.btn.ghost.icon', { 'aria-label': t('Close'), onClick: closeLauncher }, icon('x', 18))), list));
  document.body.appendChild(launcherEl); paint(); document.addEventListener('keydown', launcherKey, true); setTimeout(() => q.focus(), 30);
}
export const designNow = () => { try { const v = JSON.parse(localStorage.getItem('nbx.design')); return DESIGNS.some((d) => d[0] === v) ? v : 'fourteen'; } catch { return 'fourteen'; } };
export function setDesign(v) { try { localStorage.setItem('nbx.design', JSON.stringify(v)); } catch {} const de = document.documentElement; if (v === 'studio') { de.dataset.design = 'seven'; de.dataset.look = 'studio'; return; } delete de.dataset.look; if (v === 'classic') delete de.dataset.design; else de.dataset.design = v; }
// 7.0: the old default ("classic") was saved on every start, so it is not a real choice. Move those people to the
// new default once; anyone who picked another design keeps it (Home offers them the new one).
try { if (!localStorage.getItem('nbx.design7')) { localStorage.setItem('nbx.design7', '1'); if (JSON.parse(localStorage.getItem('nbx.design')) === 'classic') localStorage.setItem('nbx.design', JSON.stringify('seven')); } } catch {}
// 13.2: the new clean "Studio" design becomes the default; people still on the old default move to it once
// 13.3: back to the Nebulix 7 design by default; "Studio" stays as an option in Settings → Appearance. Undo the automatic
// move to Studio from 13.2 once (anyone who picks Studio again keeps it).
try { if (!localStorage.getItem('nbx.design133')) { localStorage.setItem('nbx.design133', '1'); if (JSON.parse(localStorage.getItem('nbx.design')) === 'studio') localStorage.setItem('nbx.design', JSON.stringify('seven')); } } catch {}
// 14.0: the fresh "Nebulix 14" design is the new default. People on the old default (Nebulix 7) move to it once;
// anyone can go back in Appearance. (The old look is also kept as a one-click makeover there.)
try { if (!localStorage.getItem('nbx.design14')) { localStorage.setItem('nbx.design14', '1'); const was = JSON.parse(localStorage.getItem('nbx.design')); if (!was || was === 'seven') { localStorage.setItem('nbx.design', JSON.stringify('fourteen')); localStorage.setItem('nbx.new14', '1'); } } } catch {}
setDesign(designNow());
export function designMenu(anchor) { openMenu(DESIGNS.map(([k, l]) => ({ label: t(l), icon: designNow() === k ? 'check' : 'palette', onClick: () => setDesign(k) })), anchor); }
export function logoMenu(anchor) { openMenu(LOGOS.map(([k, l]) => ({ label: t(l), icon: null, onClick: () => { setLogo(k); toast(t('Logo changed'), 'good', 1500); } })), anchor); }
const sideMini = () => { try { return localStorage.getItem('nbx.side') === 'mini'; } catch { return false; } };
function toggleSide() {
  const mini = !sideMini(); try { localStorage.setItem('nbx.side', mini ? 'mini' : 'full'); } catch {}
  if (shell) shell.dataset.side = mini ? 'mini' : 'full';
}
function accountCard() {
  const st = S.me.status;
  return h('button.side-acct', { id: 'acct', 'aria-label': t('Account'), onClick: (e) => accountMenu(e.currentTarget) },
    avatarEl(S.me, { size: 30, status: true, frame: false }),
    h('span.sa-txt', h('b.ellipsis', S.me.displayName || S.me.username), h('span.ellipsis.tiny.muted', st && st.text ? st.text : '@' + S.me.username)),
    icon('more', 16, 'sa-more'));
}
function levelChip() {
  const el = h('button.lvl-chip', { title: t('Level, quests & achievements'), onClick: () => go('progress') });
  const paint = (lv) => { if (!lv) return; mount(el, h('span.lvl-ring', { style: `--p:${Math.round(lv.into / Math.max(1, lv.need) * 100)}` }, h('b', String(lv.level))), h('span.lvl-lbl', t('Lv.'))); };
  api.get('/api/progress', { quiet: true }).then((p) => paint(p.level)).catch(() => {});
  bus.on('ws:prog', (m) => paint(m.level));
  return el;
}
function langButton() {
  return h('button.btn.ghost.sm', { title: t('Language'), onClick: (e) => openMenu(LANGS.map(([code, name]) => ({ label: `${code.toUpperCase()}   ${name}`, icon: code === getLang() ? 'check' : null, onClick: () => changeLang(code) })), e.currentTarget) }, getLang().toUpperCase());
}
function buildShell() {
  if (osMode()) return buildDesktop();
  const groups = NAV_GROUPS.map(([label, items]) => h('div.side-group', label ? h('div.side-label', t(label)) : null, items.map(([k, l, i]) => railBtn(k, l, i))));
  railEl = h('nav.rail', { 'aria-label': 'Main' },
    h('div.side-head', h('a.side-brand', { href: '#/home', title: 'Nebulix' }, logoMark(26, 'rail-logo'), h('span.sb-name', 'Nebulix')),
      h('button.side-fold', { 'aria-label': t('Collapse sidebar'), title: t('Collapse sidebar'), onClick: toggleSide }, icon('sidebar', 16))),
    h('button.side-search', { onClick: () => palette(), 'aria-label': t('Search') }, icon('search', 15), h('span.rb-l', t('Search')), h('kbd', 'Ctrl K')),
    h('div.side-scroll', groups,
      h('div.side-group', h('div.side-label', t('More')), railBtn('ext', 'Extensions', 'puzzle'), railBtn('pro', 'Premium', 'crown'), isStaff() ? railBtn('admin', 'Admin', 'shield') : null, railBtn('settings', 'Settings', 'gear'))),
    accountCard());
  nexus = buildNexus({ groups: NAV_GROUPS, more: [['look', 'Appearance', 'layout'], ['progress', 'Achievements', 'trophy'], ['ext', 'Extensions', 'puzzle'], ['pro', 'Premium', 'crown'], ...(isStaff() ? [['admin', 'Admin', 'shield']] : []), ['settings', 'Settings', 'gear']], go, palette, accountMenu, badgeFor });
  titleEl = h('span'); crumbEl = h('span.top-crumb');
  const coin = h('button.top-coin', { title: t('Your coins'), onClick: () => go('wallet') }, h('span.coin#coinbar', { title: fmt.num(S.me.coins) }, coinTxt(S.me.coins)));
  const gemBtn = h('button.top-gem', { title: t('Your gems'), onClick: () => go('plaza', { tab: 'gems' }) }, icon('gem', 14), h('span#gembar', fmt.compact(S.me.gems || 0)));
  const panicBtn = panic.panicButton();
  const bell = h('button.btn.ghost.icon', { id: 'bell', 'aria-label': t('Notifications'), title: t('Notifications'), onClick: (e) => inbox.openInbox(e.currentTarget, go) }, icon('bell', 17));
  const osBtn = h('button.btn.ghost.sm.osbtn', { title: t('Open desktop mode (Nebulix OS) in its own tab'), onClick: () => openDesktop() }, icon('desktop', 16), h('span.osbtn-l', t('Desktop')));
  const topSearch = h('button.top-search', { type: 'button', onClick: () => palette(), 'aria-label': t('Search') }, icon('search', 15), h('span.grow', t('Search apps, people and more…')), h('kbd', 'Ctrl K'));
  const top = h('header.topbar', h('h1', crumbEl, titleEl), h('div.grow'), topSearch, h('div.grow'), panicBtn, miniPlayer(go), h('button.searchbtn.btn.ghost.icon', { onClick: () => palette(), 'aria-label': t('Search') }, icon('search', 17)), levelChip(), coin, gemBtn, langButton(), osBtn, bell);
  viewsEl = h('main.views'); shell = h('div.shell', { dataset: { side: sideMini() || layoutNow() === 'compact' ? 'mini' : 'full', layout: layoutNow() } }, railEl, nexus.el, h('div.main', top, viewsEl), h('button.ln-fab', { 'aria-label': t('All apps'), title: t('All apps'), onClick: () => openLauncher() }, icon('grid', 22)));
  mount($('#app'), shell);
  setTimeout(paintFavicon, 50);
}
async function buildDesktop() {
  const { createDesktop } = await import('./os/desktop.js');
  desk = createDesktop({ loaders: LOADERS, cache, go, onExit: closeDesktop, logout, palette, accountMenu, announcements: announcementsMenu, groups: NAV_GROUPS });
  shell = desk.el; railEl = null; titleEl = null; viewsEl = null;
  mount($('#app'), shell);
}
// Open the desktop experience in its own tab; the classic interface stays exactly as it is (state, route, playing music…).
export function openDesktop() {
  let w = null; try { w = window.open('/?os=1#/desktop', 'nebulix-os'); } catch {}
  if (w) { try { w.focus(); } catch {} return; }
  // pop-ups blocked: use this tab and remember where to come back
  try { sessionStorage.setItem('nbx.returnTo', nav.hash || '#/home'); } catch {}
  location.href = '/?os=1#/desktop';
}
// Leave the desktop: close its tab and go back to the original one (or return to the saved page when it was opened in place).
function closeDesktop() {
  let back = '#/home'; try { back = sessionStorage.getItem('nbx.returnTo') || '#/home'; sessionStorage.removeItem('nbx.returnTo'); } catch {}
  if (window.opener && !window.opener.closed) { try { window.opener.focus(); } catch {} window.close(); }
  setTimeout(() => { if (!window.closed) location.href = '/' + back; }, 250);
}
async function accountMenu(anchor) {
  const st = S.me.status;
  let accts = []; try { accts = (await api.get('/api/auth/accounts', { quiet: true })).accounts || []; } catch {}
  const others = accts.filter((a) => !a.current);
  openMenu([
    ...others.map((a) => ({ label: t('Switch to {n}', { n: (a.displayName || a.username) + ' (@' + a.username + ')' }), icon: 'users', onClick: () => switchAccount(a.id) })),
    { label: t('Add account (alt)'), icon: 'plus', onClick: addAccount }, { hr: true },
    { label: S.me.displayName || S.me.username, icon: 'user', onClick: () => go('profile') },
    { label: st && (st.text || st.emoji) ? `${st.emoji || ''} ${st.text || ''}`.trim() : t('Set a status…'), icon: 'smile', onClick: () => statusModal() }, { hr: true },
    { label: t('My profile'), icon: 'user', onClick: () => go('profile') }, { label: t('Achievements'), icon: 'trophy', onClick: () => go('progress') }, { label: t('Settings'), icon: 'gear', onClick: () => go('settings') },
    { label: dnd() ? t('Turn off Do not disturb') : t('Do not disturb'), icon: dnd() ? 'bell' : 'micoff', onClick: () => { try { localStorage.setItem('nbx.dnd', dnd() ? '0' : '1'); } catch {} inbox.load(); toast(dnd() ? t('Do not disturb is on. Notifications wait quietly in the inbox.') : t('Do not disturb is off.'), 'good'); } },
    { label: theme.getTheme().mode === 'light' ? t('Dark mode') : t('Light mode'), icon: theme.getTheme().mode === 'light' ? 'moon' : 'sun', onClick: async () => { const p = theme.PRESETS.find((x) => x.name === (theme.getTheme().mode === 'light' ? 'Nebulix 14' : 'Paper')); const th = theme.apply(theme.fromPreset(p)); try { await api.patch('/api/profile', { settings: { activeTheme: th } }); } catch {} } },
    { label: t('Design'), icon: 'palette', onClick: () => designMenu(anchor) }, { label: t('Menu layout'), icon: 'layout', onClick: () => layoutMenu(anchor) }, { label: t('Appearance'), icon: 'palette', onClick: () => go('look') }, { label: t('App logo'), icon: 'star', onClick: () => logoMenu(anchor) },
    desk ? { label: t('Close desktop mode'), icon: 'power', onClick: closeDesktop } : { label: t('Open desktop mode'), icon: 'desktop', onClick: openDesktop },
    { label: t('Lock screen') + '  (Ctrl+Shift+L)', icon: 'lock', onClick: () => import('./lock.js').then((m) => m.lockNow()) },
    { label: isPro() ? t('PRO membership') : t('Get PRO'), icon: 'crown', onClick: () => go('pro') }, { hr: true },
    { label: others.length ? t('Log out of this account') : t('Log out'), icon: 'logout', danger: true, onClick: logout },
    ...(others.length ? [{ label: t('Log out of all accounts'), icon: 'logout', danger: true, onClick: () => logout(true) }] : []),
  ], anchor);
}
function announcementsMenu(anchor) {
  const list = S.announcements;
  const el = openMenu([], anchor); el.style.width = '320px';
  if (!list.length) el.appendChild(h('div.empty', { style: 'padding:20px' }, t('No announcements right now.')));
  list.forEach((a) => el.appendChild(h('div', { style: 'padding:8px 10px' }, h('b', a.title), h('div.small.muted', a.body), h('div.tiny.muted', fmt.rel(a.t)))));
}
function teardown() {
  for (const k of Object.keys(mounted)) { try { mounted[k].cleanup && mounted[k].cleanup(); } catch (e) { console.error(e); } delete mounted[k]; }
  if (desk) { try { desk.destroy(); } catch (e) { console.error(e); } desk = null; }
  shell = null; current = null;
}
async function logout(all) { let r = {}; try { r = await api.post('/api/auth/logout', all === true ? { all: true } : {}); } catch {} if (r && r.switched) { location.reload(); return; } ws.close(); S.me = null; teardown(); await start(); }
async function switchAccount(id) { try { await api.post('/api/auth/switch', { id }); location.reload(); } catch (e) { toastErr(e); } }
async function addAccount() { try { await api.post('/api/auth/add-account'); } catch (e) { toastErr(e); return; } ws.close(); S.me = null; teardown(); await start(); }
async function changeLang(l) {
  setLang(l); try { await api.patch('/api/profile', { lang: l }); } catch {}
  location.reload();
}

function palette() {
  openPalette(go, [
    { label: t('Claim daily reward'), hint: t('Action'), icon: 'gift', run: () => go('home', { daily: 1 }) },
    { label: t('New squad'), hint: t('Action'), icon: 'target', run: () => go('squads') },
    { label: t('New event'), hint: t('Action'), icon: 'calendar', run: () => go('events') },
    { label: t('New note'), hint: t('Action'), icon: 'note', run: () => go('notes') },
    { label: t('Keyboard shortcuts'), hint: t('Action'), icon: 'keyboard', run: () => shortcutsSheet() },
    { label: t('Take a tour'), hint: t('Action'), icon: 'spark', run: () => startTour('welcome', go) },
    { label: t('What\'s new'), hint: t('Action'), icon: 'spark', run: () => showWhatsNew(go) },
    { label: t('Collapse sidebar'), hint: t('Action'), icon: 'sidebar', run: () => toggleSide() },
    { label: t('Set a status…'), hint: t('Action'), icon: 'smile', run: () => statusModal() },
    desk ? { label: t('Close desktop mode'), hint: t('Action'), icon: 'power', run: closeDesktop } : { label: t('Open desktop mode (Nebulix OS)'), hint: t('Action'), icon: 'desktop', run: openDesktop },
    ...LANGS.filter(([c]) => c !== getLang()).map(([code, name]) => ({ label: t('Switch language to {l}', { l: name }), hint: t('Action'), icon: 'globe', run: () => changeLang(code) })),
    { label: t('Compose a song with Nebula Synth'), hint: 'Pulse', icon: 'music', run: () => go('music', { s: 'synth' }) },
    { label: t('Listen to the radio'), hint: 'Pulse', icon: 'music', run: () => go('music', { s: 'radio' }) },
    ...(fx14mod ? fx14mod.MAKEOVERS.map((mk) => ({ label: t('Makeover: {n}', { n: t(mk.name) }), hint: t('Appearance'), icon: 'spark', run: async () => { setDesign(mk.design); setLayout(mk.layout); const th = theme.apply(fx14mod.makeoverTheme(mk)); fx14mod.setScreenFx(mk.fx || 'none'); try { localStorage.setItem('nbx.fx14.mk', JSON.stringify(mk.id)); } catch {} try { await api.patch('/api/profile', { settings: { activeTheme: th } }); } catch {} toast(t('New look: {n}', { n: t(mk.name) }), 'good'); } })) : []),
    ...(fx14mod ? fx14mod.SCREEN_FX.map(([k, l, e]) => ({ label: t('Screen effect: {n}', { n: t(l) }), hint: t('Appearance'), icon: 'star', run: () => fx14mod.setScreenFx(k) })) : []),
    ...theme.PRESETS.map((p) => ({ label: t('Theme: {n}', { n: p.name }), hint: t('Theme'), icon: 'palette', run: async () => { const th = theme.apply(theme.fromPreset(p)); try { await api.patch('/api/profile', { settings: { activeTheme: th } }); } catch {} toast(t('Theme applied'), 'good'); } })),
    { label: t('Log out'), hint: t('Action'), icon: 'logout', run: logout },
    { label: t('Lock screen'), hint: t('Action'), icon: 'lock', run: () => import('./lock.js').then((m) => m.lockNow()) },
  ]);
}

// ---------- realtime ----------
let wired = false;
function wireRealtime() {
  if (wired) return; wired = true;
  inbox.setGo(go);
  inbox.wire((kind, id) => document.hasFocus() && ((kind === 'dm' && current === 'dm' && S.activePeer === id) || (kind === 'chat' && current === 'chat' && S.activeChannel === id)));
  rtc.wire(); vroom.wire();
  bus.on('ws:coins', (m) => { if (S.coinHold) { S.coinPending = m.coins; return; } const from = S.me.coins; patchMe({ coins: m.coins }); const el = $('#coinbar'); if (el) { el.textContent = coinTxt(m.coins); el.title = fmt.num(m.coins); if (m.coins > from) { el.animate([{ transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: 400 }); } } });
  bus.on('ws:me', (m) => { setMe(m.user); });
  bus.on('ws:gems', (m) => { patchMe({ gems: m.gems }); const el = $('#gembar'); if (el) el.textContent = fmt.compact(m.gems); });
  bus.on('ws:donation', (m) => { if (!m.from) return; sfx.coin ? sfx.coin() : null; toast(t('🎁 @{u} donated {n} coins to your booth!', { u: m.from.username, n: fmt.coins(m.amount) }) + (m.note && m.note !== '🎁' ? ' — “' + m.note + '”' : ''), 'coin', 8000); });
  bus.on('ws:sold', (m) => { toast(t('You sold an item to @{u} for {n} coins (you get {g})', { u: m.buyer ? m.buyer.username : '?', n: fmt.coins(m.price), g: fmt.coins(m.got) }), 'coin', 8000); });
  bus.on('ws:transfer', (m) => { if (!m.from) return; sfx.coin ? sfx.coin() : null; toast(t('@{u} sent you {n} coins', { u: m.from.username, n: fmt.coins(m.amount) }) + (m.note ? ' — “' + m.note + '”' : ''), 'coin', 7000); });
  bus.on('ws:announce', (m) => { S.announcements.unshift(m.a); toast(h('div', h('b', m.a.title), h('div.small.muted', m.a.body)), 'info', 9000); });
  bus.on('ws:friend', () => refreshFriends());
  // server notices (tournament prizes, clan news, league results, boss rewards…), in the user's language when the server sent both
  bus.on('ws:notice', (m) => { if (!m.text) return; toast(getLang() === 'es' && m.es ? m.es : m.text, 'info', 9000); });
  // World Boss: a floating pill on every page while a boss is here
  bossPill();
  bus.on('ws:presence', (m) => {
    if (m.online) S.online.add(m.id); else S.online.delete(m.id);
    if ('act' in m) S.acts[m.id] = m.act || null; if (!m.online) S.acts[m.id] = null; if ('status' in m) S.statuses[m.id] = m.status || null;
    if (m.id === S.me.id && 'status' in m) patchMe({ status: m.status });
    bus.emit('presence', m);
  });
  bus.on('ws:dm', (m) => { if (m.to === S.me.id && !(current === 'dm' && document.hasFocus() && S.activePeer === m.from)) { S.dmUnread++; sfx.msg(); updateBadges(); } });
  bus.on('ws:prog', (m) => onProg(m));
  bus.on('ws:duel', (m) => {
    const d = m.duel; if (!d || d.me !== 1 || d.status !== 'pending') return;
    const inArcade = desk ? !!desk.wins.get('arcade') : current === 'arcade'; if (inArcade) return;
    sfx.msg(); toast(h('div', h('b', t('{u} challenges you to {g}', { u: d.a.displayName || d.a.username, g: t(d.name) })), d.wager ? h('div.small', t('Wager: {n} coins', { n: d.wager })) : null, h('div.row', { style: 'margin-top:6px' }, h('button.btn.sm.primary', { onClick: () => go('arcade', { duel: d.id }) }, t('Open')))), 'info', 15000);
  });
  bus.on('badges', updateBadges);
  bus.on('ws:msg', (m) => {
    if (m.m.a === S.me.id) return;
    if (current === 'chat' && S.activeChannel === m.ch && document.hasFocus()) return;
    S.unread[m.ch] = (S.unread[m.ch] || 0) + 1;
    if ((m.m.m || []).includes(S.me.id)) { S.mentions[m.ch] = (S.mentions[m.ch] || 0) + 1; sfx.msg(); }
    updateBadges(); bus.emit('unread', m.ch);
  });
  bus.on('ws:server', () => { loadServers().catch(() => {}); });
}
export function updateBadges() {
  if (nexus) nexus.refresh();
  if (!railEl) return;
  for (const k of ['dm', 'chat']) {
    const b = railEl.querySelector(`[data-nav="${k}"]`); if (!b) continue;
    const old = b.querySelector('.nb, .nd'); if (old) old.remove();
    const n = badgeFor(k);
    if (n > 0) b.appendChild(h('span.nb', n > 99 ? '99+' : n));
    else if (k === 'chat' && Object.values(S.unread).some((x) => x > 0)) b.appendChild(h('span.nd'));
  }
}
async function refreshFriends() {
  try {
    S.friends = await api.get('/api/friends');
    for (const f of S.friends.friends) { if (f.online) S.online.add(f.id); else S.online.delete(f.id); if (f.act !== undefined) S.acts[f.id] = f.act; if (f.status !== undefined) S.statuses[f.id] = f.status; }
    bus.emit('friends', S.friends);
  } catch {}
}

// ---------- boot ----------
async function afterLogin() {
  if (S.me.lang && S.me.lang !== getLang()) await loadLang(S.me.lang);
  const at = S.me.settings && S.me.settings.activeTheme; theme.apply(at ? theme.upgrade(theme.normalize(at)) : theme.normalize(theme.DEFAULT));
  theme.applyUi((S.me.settings && S.me.settings.ui) || {});
  import('./fx14.js').then((m) => { fx14mod = m; m.initFx14(); }).catch(() => {});
  try { if (localStorage.getItem('nbx.new14') === '1') { localStorage.removeItem('nbx.new14'); setTimeout(() => toast(t('Welcome to Nebulix 14: a brand-new look. You can go back to the old one in Appearance.'), 'good', 7000), 1800); } } catch {}
  import('./livebg.js').then((m) => m.applyLiveBg()).catch(() => {});
  import('./lock.js').then((m) => m.initLock()).catch(() => {});
  import('./nova-float.js').then((m) => m.initNovaFloat()).catch(() => {});
  import('./duel-invite.js').then((m) => m.initDuelInvites()).catch(() => {});
  await Promise.all([loadCatalog().catch(() => {}), refreshFriends(), api.get('/api/announcements').then((r) => { S.announcements = r.announcements; }).catch(() => {}), api.get('/api/dm').then((r) => { S.dmUnread = r.conversations.reduce((n, c) => n + (c.unread || 0), 0); }).catch(() => {}), loadServers().catch(() => {})]);
  wireRealtime(); ws.connect();
}

// A link opened from an email (#/link?a=verify|addmail|reset&u=…&c=…): confirm it, then carry on into the app.
let linkReset = null;
async function consumeLink() {
  const r = parseHash(); if (r.name !== 'link') return;
  const a = r.query.get('a'); const u = r.query.get('u') || ''; const c = r.query.get('c') || '';
  realReplace(null, '', location.pathname + location.search); setNav('#/home'); // the one-time link code leaves the address bar
  if (a === 'reset') { linkReset = { mode: 'newpass', uid: u, code: c }; try { await api.post('/api/auth/logout', {}, { quiet: true }); } catch {} return; }
  if (a !== 'verify' && a !== 'addmail') return;
  try {
    const res = await api.post('/api/auth/link', { a, u, c }, { quiet: true });
    setTimeout(() => { sfx.big(); confetti(); toast(t('Email confirmed. You earned {n} coins and your Verified badge.', { n: res.welcome || 50 }), 'good', 7000); }, 2600);
  } catch (e) { setTimeout(() => toast(e.code === 'already_verified' ? e.message : t('This link is no longer valid. Request a new one.'), 'err', 7000), 2600); }
}

async function start() {
  let me;
  { const dz = maybeDisguise(); if (dz) await dz; } // 13.8 disguise mode: a study page until the secret code is typed
  await consumeLink();
  try { me = await api.get('/api/me', { quiet: true }); } catch (e) { mount($('#app'), h('div.boot', h('div.boot-logo'), h('p', e.message), h('button.btn', { onClick: () => location.reload() }, t('Retry')))); return; }
  S.cfg = me.config;
  if (!me.user) { const { renderAuth } = await import('./views/auth.js'); const init = linkReset; linkReset = null; return renderAuth($('#app'), () => start(), init); }
  setMe(me.user); await afterLogin(); await buildShell(); updateBadges(); inbox.load(); panic.applyCloak();
  if (S.cfg && S.cfg.lockdown && !isStaff()) showDecoy({ reason: 'lockdown' });
  import('./views/mods.js').then((m) => m.applyMods()).catch(() => {}); // 13.8 mods
  if (desk) { const r = parseHash(); if (nav.hash && r.name !== 'desktop' && r.name !== 'home') route(); else setNav('#/desktop'); desk.restore(r.name); document.title = 'Nebulix OS'; return; }
  if (!nav.hash || nav.hash === '#/' || nav.hash === '#' || nav.hash === '#/desktop') { setNav('#/home'); route(); } else route();
  setTimeout(() => maybeShowWhatsNew(go), 900);
  setTimeout(() => { if (!document.querySelector('.modal')) maybeWelcomeTour(go); }, 1100);
}

bus.on('unauthorized', () => { if (S.me) { S.me = null; ws.close(); toast(t('Your session ended. Please log in again.'), 'err'); teardown(); start(); } });
const coinTxt = (n) => (n >= 1e9 ? '∞' : fmt.coins(n)); // a full (bottomless) wallet shows as infinity
bus.on('me', () => { const el = $('#coinbar'); if (el && S.me) { el.textContent = coinTxt(S.me.coins); el.title = fmt.num(S.me.coins); } const a = $('#acct'); if (a && S.me && a.classList.contains('side-acct')) a.replaceWith(accountCard()); });
// 13.8 admin lockdown, live: everyone (except staff) switches to the study page, and back when it is lifted
bus.on('ws:lockdown', (m) => { if (S.cfg) S.cfg.lockdown = !!m.on; if (m.on && S.me && !isStaff()) showDecoy({ reason: 'lockdown' }); else if (!m.on && decoyShowing()) releaseDecoy(); });
bus.on('panic-key', (k) => { if (S.me && k === panic.settings().key) panic.panic(); });
window.addEventListener('hashchange', () => { setNav(location.hash); route(); }); // only when someone types a #/… address by hand
// Only opening Nebulix shows up in the browser history: every in-app link (#/…) replaces the current entry instead of adding one.
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
  const a = e.target && e.target.closest ? e.target.closest('a[href^="#"]') : null; if (!a || (a.target && a.target !== '_self')) return;
  const href = a.getAttribute('href'); if (!href || href === '#' || !href.startsWith('#/')) return;
  e.preventDefault(); if (nav.hash !== href) { setNav(href); route(); }
});
let gPending = 0;
export const GO_KEYS = { h: 'home', b: 'browse', c: 'chat', m: 'dm', s: 'squads', e: 'events', l: 'library', n: 'notes', p: 'music', a: 'arcade', i: 'nova', t: 'themes', ',': 'settings' };
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (S.me) palette(); return; }
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '') || (e.target && e.target.isContentEditable);
  if (!S.me || desk || typing || e.ctrlKey || e.metaKey || e.altKey) return;
  // pages that use the plain keyboard themselves (DJ pads, games, keyboard tests) keep every key
  if (['dj', 'arcade', 'nerd'].includes(current) || document.querySelector('.share-win:hover')) return;
  if (panic.matchesKey(e)) { e.preventDefault(); panic.panic(); return; }
  if (e.key === '?') { e.preventDefault(); shortcutsSheet(); return; }
  if (e.key === '[') { e.preventDefault(); toggleSide(); return; }
  // "g" then a letter jumps to a page (g h = home, g m = messages …)
  if (e.key === 'g') { gPending = Date.now(); return; }
  if (gPending && Date.now() - gPending < 1200) { const to = GO_KEYS[e.key.toLowerCase()]; gPending = 0; if (to) { e.preventDefault(); go(to); } }
});
document.addEventListener('click', (e) => { if (e.target.closest('button, .btn, .rail-btn')) sfx.click(); }, true);
window.addEventListener('unhandledrejection', (e) => { if (e.reason instanceof ApiError) { e.preventDefault(); if (e.reason.code !== 'network') toastErr(e.reason); } });

initBackground();
initHoverGlow();
theme.apply(theme.loadSaved(), { persist: false });
panic.applyCloak(); // disguise the tab (title + favicon) before anything renders, even on the login screen
// Opening animation: let it play for a moment, then iris out once the app (or the sign-in screen) is on screen.
function dismissIntro() {
  const el = document.getElementById('intro'); if (!el) return;
  const wait = Math.max(0, 2300 - performance.now());
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 800); }, getComputedStyle(el).display === 'none' ? 0 : wait);
}
loadLang(detectLang()).then(() => start()).catch((e) => { console.error(e); }).finally(dismissIntro);
window.__nbx = { go, S, theme, bus, toast, confetti, langName, openDesktop };
// A gentle nudge after 2 hours of continuous use (counted only while the tab is visible).
setInterval(() => { if (document.hidden || !S.me) return; let m = 0; try { m = Number(sessionStorage.getItem('nbx.mins') || 0) + 1; sessionStorage.setItem('nbx.mins', String(m)); } catch {} if (m === 120) toast(t('You have been on Nebulix for 2 hours. Maybe stretch and drink some water?'), 'info', 9000); }, 60000);

// ---------- World Boss pill ----------
// While a boss is here every page shows a small floating pill with its health and the time left (hidden on the boss page).
let bossEl = null; let bossState = null; let bossT = 0;
function bossPill() {
  const pick = (n) => (getLang() === 'es' ? n[1] : n[0]);
  const clk = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const paint = () => {
    const hide = !bossState || current === 'boss' || osMode();
    if (hide) { if (bossEl) { bossEl.remove(); bossEl = null; } return; }
    if (!bossEl || !bossEl.isConnected) { bossEl = h('a.boss-pill', { href: '#/boss', title: t('World Boss') }); const coinBtn = document.querySelector('.top-coin'); if (coinBtn && coinBtn.parentNode) coinBtn.parentNode.insertBefore(bossEl, coinBtn); else { bossEl.classList.add('float'); document.body.appendChild(bossEl); } }
    const p = bossState.max ? Math.round((bossState.hp / bossState.max) * 100) : 100;
    mount(bossEl, h('span.boss-pill-ic', bossState.boss.icon), h('span.boss-pill-t', h('b', pick(bossState.boss.n)), h('span.boss-pill-bar', h('i', { style: { width: p + '%' } }))), h('span.boss-pill-c', clk(bossState.end - Date.now())));
  };
  bus.on('ws:boss', (m) => {
    if (m.ev === 'spawn') { bossState = { boss: m.boss, end: m.end, hp: 1, max: 1 }; try { sfx.msg(); } catch {} toast(h('div', h('b', m.boss.icon + ' ' + t('A World Boss has appeared!')), h('div.small', pick(m.boss.n) + ' · ' + t('Fight it with everyone online'))), 'info', 9000); }
    else if (m.ev === 'hp') bossState = { boss: m.boss, end: m.end, hp: m.hp, max: m.max };
    else if (m.ev === 'down' || m.ev === 'gone') bossState = null;
    paint();
    if (nexus) nexus.setBoss(!!bossState);
  });
  bus.on('route', () => paint());
  api.get('/api/boss', { quiet: true }).then((d) => { if (d.live) { bossState = d.live; paint(); if (nexus) nexus.setBoss(true); } }).catch(() => {});
  clearInterval(bossT); bossT = setInterval(() => { if (bossState && bossState.end < Date.now()) bossState = null; paint(); }, 1000);
}
