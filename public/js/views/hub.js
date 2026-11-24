// Nebulix Hub: share videos, browser games and web apps — single files, .zip files or whole folders (packed in the
// browser). Games and apps run sandboxed on an opaque origin, never with your session. #/hub · #/hub/<id>
import { h, mount, fmt, ls } from '../util.js';
import { t } from '../i18n.js';
import * as X from './hub-extra.js';
import { starsEl } from './hub-extra.js';
import { api } from '../api.js';
import { S } from '../state.js';
import { icon } from '../icons.js';
import { toast, toastErr, loading, emptyState, busy, tabsEl, field, confirmBox, modal, switchEl, promptBox } from '../ui.js';
import { avatarEl } from '../cosmetics.js';
import { zipFiles, filesFromDrop, filesFromInput, SKIP } from '../zipwrite.js';
import { renderMarkdown } from '../markdown.js';
import { gameApi, allowExtra, missingPerms, askPerms, PERM_INFO } from '../gameapi.js';

const dur = (s) => (s ? Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0') : '');
const mb = (n) => (n / 1048576).toFixed(n > 10485760 ? 0 : 1) + ' MB';
export function putFile(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest(); x.open('PUT', url); x.setRequestHeader('Content-Type', 'application/octet-stream'); x.responseType = 'json';
    x.upload.onprogress = (e) => e.lengthComputable && onProgress && onProgress(e.loaded / e.total);
    x.onload = () => (x.status >= 200 && x.status < 300 ? resolve(x.response) : reject(new Error((x.response && x.response.message) || 'Upload failed (' + x.status + ')')));
    x.onerror = () => reject(new Error('Network error')); x.send(file);
  });
}
// first frame-ish thumbnail for videos (and its duration)
export function videoThumb(file) {
  return new Promise((resolve) => {
    const v = document.createElement('video'); v.muted = true; v.preload = 'metadata'; v.src = URL.createObjectURL(file);
    const done = (blob, d) => { URL.revokeObjectURL(v.src); resolve({ blob, duration: d || 0 }); };
    v.onloadedmetadata = () => { v.currentTime = Math.min(2, (v.duration || 4) / 3); };
    v.onseeked = () => { try { const c = document.createElement('canvas'); c.width = 480; c.height = Math.round(480 * (v.videoHeight / v.videoWidth || 0.5625)); c.getContext('2d').drawImage(v, 0, 0, c.width, c.height); c.toBlob((b) => done(b, v.duration), 'image/jpeg', 0.82); } catch { done(null, v.duration); } };
    v.onerror = () => done(null, 0); setTimeout(() => done(null, v.duration), 8000);
  });
}

const PALETTE = ['#3f4a5a', '#5b4a3a', '#2f5a4f', '#4a3f63', '#6a3f45', '#2f4f6a', '#5a5a2f', '#4f3a5a', '#355e3b', '#5e4b35'];
const hashOf = (str) => { let a = 0; for (const c of String(str)) a = (a * 31 + c.charCodeAt(0)) >>> 0; return a; };
const mono = (title) => { const w = String(title || '?').trim().split(/\s+/).filter(Boolean); return ((w[0] || '?')[0] + (w[1] ? w[1][0] : (w[0] || '')[1] || '')).toUpperCase(); };
const KIND_LABEL = { video: 'Video', clip: 'Clip', game: 'Game', app: 'App', wall: 'Background' };
const cover = (it) => h('div.hb-thumb.' + it.kind, { style: { '--hb-c': PALETTE[hashOf(it.title + it.id) % PALETTE.length] } },
  it.thumb ? h('img', { src: it.thumb, alt: '', loading: 'lazy' }) : h('span.hb-mono', mono(it.title)),
  h('span.hb-kind', t(KIND_LABEL[it.kind]) + (it.version > 1 ? ' · v' + it.version : '')), it.duration ? h('span.tube-dur', dur(it.duration)) : null);
const MODES = [['sandbox', 'Sandboxed', 'Safest. Runs inside Nebulix with no access to the browser’s own storage (Nebulix saves the game for it).'], ['domain', 'Like in Chrome, inside Nebulix', 'Runs inside Nebulix on the separate games domain: normal storage, IndexedDB and service workers.'], ['native', 'Native, like a Chrome tab', 'The game’s real page on the games domain, shown inside Nebulix with no sandbox and no proxy: every browser feature, including multithreaded games. For games that only work in a new tab.']];
function modePicker(cur, onChange) {
  let v = cur || 'sandbox';
  const box = h('div.hb-modes', MODES.map(([k, l, d]) => h('label.hb-mode' + (k === v ? '.on' : ''), h('input', { type: 'radio', name: 'hbmode-' + Math.random().toString(36).slice(2, 6), checked: k === v, onChange: () => { v = k; for (const x of box.children) x.classList.toggle('on', x.querySelector('input').checked); onChange(k); } }), h('span', h('b', t(l)), h('small', t(d))))));
  return box;
}
const TEXTY = /\.(html?|css|m?js|json|txt|md|svg|xml|csv)$/i;

// pick a single file, a .zip or a whole folder (button or drag & drop); returns { entries, single }
function picker(onChange, accept) {
  let entries = []; const info = h('div.hb-pinfo');
  const fileIn = h('input', { type: 'file', accept, hidden: true, onChange: () => { const f = fileIn.files[0]; if (f) set([{ path: f.name, file: f }]); } });
  const dirIn = h('input', { type: 'file', hidden: true, multiple: true, webkitdirectory: '', onChange: () => set(filesFromInput(dirIn.files)) });
  const zone = h('div.hb-drop', { tabindex: 0, onDragover: (e) => { e.preventDefault(); zone.classList.add('over'); }, onDragleave: () => zone.classList.remove('over'),
    onDrop: async (e) => { e.preventDefault(); zone.classList.remove('over'); set(await filesFromDrop(e.dataTransfer)); } },
    h('div.hb-drop-ic', icon('upload', 28)), h('b', t('Drop a file or a whole folder here')), h('span.tiny.muted', t('HTML, JS, ZIP, a game folder… or a video')),
    h('div.row', { style: 'gap:8px;justify-content:center;flex-wrap:wrap' }, h('button.btn.sm', { type: 'button', onClick: () => fileIn.click() }, icon('note', 14), t('Choose a file')), h('button.btn.sm', { type: 'button', onClick: () => dirIn.click() }, icon('layers', 14), t('Choose a folder'))), fileIn, dirIn);
  function set(list) {
    entries = list.filter((x) => !SKIP.test(x.path)); const total = entries.reduce((a, x) => a + x.file.size, 0);
    // a folder: strip its top directory so index.html ends up at the root
    if (entries.length > 1) { const tops = new Set(entries.map((x) => x.path.split('/')[0])); if (tops.size === 1 && entries.every((x) => x.path.includes('/'))) { const top = [...tops][0] + '/'; entries = entries.map((x) => ({ path: x.path.slice(top.length), file: x.file })); } }
    const start = entries.length > 1 ? entries.find((x) => /^index\.html?$/i.test(x.path)) || entries.filter((x) => /\.html?$/i.test(x.path)).sort((a, b) => a.path.split('/').length - b.path.split('/').length)[0] : null;
    mount(info, entries.length ? [h('div.row', { style: 'gap:8px;align-items:center' }, icon(entries.length > 1 ? 'layers' : 'note', 15), h('b.grow.ellipsis', entries.length > 1 ? t('{n} files', { n: entries.length }) : entries[0].path), h('span.tiny.muted', mb(total))),
      entries.length > 1 ? h('div.tiny', start ? '▶ ' + t('Starts at {p}', { p: start.path }) : '⚠ ' + t('No .html page found: add an index.html')) : null,
      entries.length > 1 ? h('div.hb-plist', entries.slice(0, 40).map((x) => h('div.tiny.ellipsis', x.path)), entries.length > 40 ? h('div.tiny.muted', '… +' + (entries.length - 40)) : null) : null] : null);
    zone.classList.toggle('has', entries.length > 0); onChange(entries);
  }
  return { el: h('div.col', { style: 'gap:8px' }, zone, info), get: () => entries, setAccept: (a) => { fileIn.accept = a; } };
}
// entries → one uploadable File (folders are zipped in the browser)
async function packEntries(entries, onStatus) {
  if (entries.length === 1) return entries[0].file;
  if (entries.length > 3000) throw new Error(t('Too many files (max {n})', { n: 3000 }));
  onStatus(t('Packing {n} files…', { n: entries.length }));
  const blob = await zipFiles(entries, (p) => onStatus(t('Packing… {p}%', { p: Math.round(p * 100) })));
  return new File([blob], 'folder.zip', { type: 'application/zip' });
}

// ---------- 14.0: the Hub, redesigned like a code-hosting site ----------
// Home: a dashboard (your uploads and collections on the left, the feed in the middle, trending topics on the right).
// Each upload is a "repository": header with Save / Remix / Star, underline tabs (Play, Code, Releases, Reviews,
// Discussions, Media, Settings), a file browser with its README, and an About sidebar with a languages bar.
const KIND_COLOR = { game: '#f1e05a', app: '#e34c26', wall: '#a371f7', video: '#3178c6', clip: '#2ea043' };
const KIND_ICON = { game: 'gamepad', app: 'cube', wall: 'image', video: 'play', clip: 'play' };
const kindDot = (k) => h('span.hbx-kind', h('i', { style: { background: KIND_COLOR[k] || '#8b949e' } }), t(KIND_LABEL[k] || 'Upload'));
const rel = (ms) => { try { return fmt.rel(ms); } catch { return fmt.date(ms); } };
const LANG = [[/\.html?$/i, 'HTML', '#e34c26'], [/\.m?js$/i, 'JavaScript', '#f1e05a'], [/\.css$/i, 'CSS', '#663399'], [/\.(png|jpe?g|gif|webp|svg|avif|ico)$/i, 'Images', '#3fb950'], [/\.(mp3|ogg|wav|m4a|flac)$/i, 'Audio', '#db61a2'], [/\.(json|xml|csv|txt|md)$/i, 'Data', '#8b949e'], [/\.(wasm|data|bin|pck|unityweb)$/i, 'WebAssembly', '#654ff0']];
function languages(files) {
  const by = new Map(); let total = 0;
  for (const f of files) { const m = LANG.find(([re]) => re.test(f.path)) || [null, 'Other', '#6e7681']; const k = m[1]; const cur = by.get(k) || { n: m[1], c: m[2], s: 0 }; cur.s += f.size || 1; by.set(k, cur); total += f.size || 1; }
  return [...by.values()].sort((a, b) => b.s - a.s).map((x) => Object.assign(x, { p: (x.s / Math.max(1, total)) * 100 }));
}
// buttons that update their own label: unlike busy(), this keeps their content (busy swaps it for a spinner and restores the old one)
const lock = async (b, fn) => { if (b.disabled) return; b.disabled = true; b.classList.add('busy'); try { return await fn(); } finally { b.disabled = false; b.classList.remove('busy'); } };
const fileIcon = (p) => (/\/$/.test(p) ? 'layers' : /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(p) ? 'image' : /\.(mp3|ogg|wav)$/i.test(p) ? 'music' : /\.(html?|m?js|css|json)$/i.test(p) ? 'terminal' : 'note');

export default {
  title: () => 'Nebulix Hub',
  async mount(root, ctx) {
    const inner = h('div.inner.hb.hbx'); mount(root, inner);
    if (ctx.params[0]) { itemPage(ctx.params[0], ctx.params[1]); return () => {}; }
    // mode: a kind (all/game/app/wall/video) or a personal list (mine/saved/history/col:<id>)
    let mode = ctx.query.get('kind') || ls('hub.kind') || 'all'; let q = ''; let sort = 'new'; let tag = ctx.query.get('tag') || ''; let viewMode = ls('hub.view14') || 'list'; let last = []; let cols = []; let counts = {};
    const KINDS_TAB = ['all', 'game', 'app', 'wall', 'video'];
    const list = h('div.hbx-list'); const usageEl = h('div.hbx-usage'); const featEl = h('div'); const tabsBar = h('nav.hbx-utabs'); const tagsEl = h('div.hbx-topics'); const statsEl = h('div'); const mineEl = h('div.hbx-mine'); const colsEl = h('div');
    const search = h('input.input.hbx-search', { placeholder: t('Find a game, app, background or video…'), onInput: (e) => { q = e.target.value; clearTimeout(search.t); search.t = setTimeout(load, 250); } });
    const sortSel = h('select.select.hbx-sel', { onChange: (e) => { sort = e.target.value; load(); } }, [['new', 'Newest'], ['top', 'Most popular'], ['likes', 'Most stars'], ['comments', 'Most discussed'], ['rating', 'Best rated'], ['updated', 'Recently updated'], ['random', 'Random']].map(([v, l]) => h('option', { value: v }, t('Sort') + ': ' + t(l))));
    const CH = [['all', t('Overview'), 'globe'], ['game', t('Games'), 'gamepad'], ['app', t('Apps'), 'cube'], ['wall', t('Backgrounds'), 'image'], ['video', t('Videos'), 'play'], ['installed', t('Installed'), 'download'], ['saved', t('Saved'), 'bookmark'], ['history', t('History'), 'clock'], ['mine', t('My uploads'), 'book']];
    const setMode = (m) => { mode = m; if (KINDS_TAB.includes(m)) ls('hub.kind', m); tag = ''; paintTabs(); load(); };
    const paintTabs = () => mount(tabsBar, CH.map(([k, l, ic]) => h('button.hbx-utab' + (mode === k ? '.on' : ''), { type: 'button', onClick: () => setMode(k) }, icon(ic, 15), h('span', l), counts[k] ? h('span.hbx-count', fmt.compact(counts[k])) : null)));
    const viewBtns = h('div.hbx-viewsw', [['list', 'menu', t('List')], ['grid', 'grid', t('Cards')]].map(([v, ic, l]) => h('button' + (viewMode === v ? '.on' : ''), { type: 'button', title: l, 'aria-label': l, onClick: (e) => { viewMode = v; ls('hub.view14', v); for (const b of viewBtns.children) b.classList.toggle('on', b === e.currentTarget); paintList(); } }, icon(ic, 15))));
    const newBtn = h('button.btn.hbx-green', { onClick: (e) => import('../ui.js').then((ui) => ui.openMenu([{ label: t('Upload a file or .zip'), icon: 'upload', onClick: () => uploadDialog() }, { label: t('Upload a whole folder'), icon: 'layers', onClick: () => uploadDialog('game', true) }, { hr: true }, { label: t('New collection…'), icon: 'plus', onClick: newCollection }], e.currentTarget)) }, icon('plus', 15), t('New'));
    async function newCollection() { const name = await promptBox(t('New collection'), { label: t('Name') }); if (!name) return; try { await api.post('/api/hub/collections', { name }); load(); } catch (e) { toastErr(e); } }
    mount(inner,
      h('header.hbx-hero', h('div.hbx-hero-l', h('div.hbx-logo', icon('book', 22)), h('div', h('h2', 'Nebulix Hub'), h('p', t('Games, web apps, animated backgrounds and videos made by the community. Upload a file, a .zip or a whole folder.')))), h('div.row', { style: 'gap:8px' }, h('a.btn', { href: '#/gamedev' }, icon('gamepad', 15), t('Create games')), newBtn)),
      tabsBar,
      h('div.hbx-dash',
        h('aside.hbx-left', h('div.hbx-box', h('div.hbx-boxh', h('b', t('Your uploads')), h('button.btn.sm.hbx-green', { onClick: () => uploadDialog() }, icon('book', 13), t('New'))), mineEl), h('div.hbx-box', h('div.hbx-boxh', h('b', t('Collections')), h('button.btn.sm.ghost', { onClick: newCollection, 'aria-label': t('New collection') }, icon('plus', 13))), colsEl), usageEl),
        h('main.hbx-main', featEl, h('div.hbx-filter', search, sortSel, viewBtns), tagsEl, list),
        h('aside.hbx-right', statsEl)));
    paintTabs();
    // left column: your newest uploads
    api.get('/api/hub?mine=1&sort=updated', { quiet: true }).then((r) => mount(mineEl, r.items.length ? r.items.slice(0, 8).map((it) => h('a.hbx-mini', { href: '#/hub/' + it.id }, it.owner ? avatarEl(it.owner, { size: 18 }) : null, h('span.ellipsis', (it.owner ? it.owner.username : '?') + ' / ', h('b', it.title)))) : h('p.tiny.muted', t('You have not uploaded anything yet.')))).catch(() => mount(mineEl));
    async function load() {
      mount(list, loading());
      try {
        const qs = new URLSearchParams({ q, sort }); if (KINDS_TAB.includes(mode) && mode !== 'all') qs.set('kind', mode); if (mode === 'mine') qs.set('mine', 1); if (mode === 'saved') qs.set('saved', 1); if (mode === 'installed') qs.set('installed', 1); if (mode === 'history') qs.set('history', 1); if (mode.startsWith('col:')) qs.set('col', mode.slice(4)); if (tag) qs.set('tag', tag);
        const r = await api.get('/api/hub?' + qs);
        const u = r.usage; const pct = Math.min(100, (u.used / Math.max(1, u.quota)) * 100);
        mount(usageEl, h('div.hbx-box', h('div.tiny.muted', t('Your storage')), h('div.hbx-ubar', h('i', { style: { width: pct + '%' } })), h('div.tiny', mb(u.used) + ' / ' + mb(u.quota))));
        counts = Object.assign({}, r.counts || {}); counts.all = Object.values(r.counts || {}).reduce((a, b) => a + b, 0); cols = r.cols || []; paintTabs();
        mount(colsEl, cols.length ? cols.map((c) => h('button.hbx-mini' + (mode === 'col:' + c.id ? '.on' : ''), { type: 'button', onClick: () => setMode('col:' + c.id) }, icon('layers', 14), h('span.grow.ellipsis', c.name), h('span.hbx-count', String(c.n)))) : h('p.tiny.muted', t('Group uploads you like into collections.')));
        mount(tagsEl, r.tags && r.tags.length && KINDS_TAB.includes(mode) ? r.tags.slice(0, 14).map((x) => h('button.hbx-topic' + (tag === x.t ? '.on' : ''), { type: 'button', onClick: () => { tag = tag === x.t ? '' : x.t; load(); } }, x.t)) : null);
        const st = r.stats;
        mount(statsEl, st ? h('div.hbx-box', h('div.hbx-boxh', h('b', t('Hub in numbers'))), h('div.hbx-nums', [[st.items, t('Uploads'), 'book'], [st.views, t('Views'), 'eye'], [st.likes, t('Stars'), 'star'], [st.comments, t('Comments'), 'chat'], [st.remixes, t('Remixes'), 'fork']].map(([v, l, ic]) => h('div', icon(ic, 14), h('b', fmt.compact(v)), h('span', l))))) : null,
          r.tags && r.tags.length ? h('div.hbx-box', h('div.hbx-boxh', h('b', t('Trending topics'))), h('div.hbx-topics', r.tags.slice(0, 12).map((x) => h('button.hbx-topic', { type: 'button', onClick: () => { tag = x.t; if (!KINDS_TAB.includes(mode)) mode = 'all'; paintTabs(); load(); } }, x.t, h('small', ' ' + x.n))))) : null,
          mode === 'history' && r.items.length ? h('button.btn.sm.ghost', { onClick: async () => { try { await api.del('/api/hub/history'); load(); } catch (e) { toastErr(e); } } }, icon('trash', 13), t('Clear history')) : null,
          mode.startsWith('col:') ? (() => { const c = cols.find((x) => 'col:' + x.id === mode); return c ? h('button.btn.sm.danger', { onClick: async () => { if (!(await confirmBox(t('Delete the collection “{n}”? The uploads stay in the Hub.', { n: c.name })))) return; try { await api.del('/api/hub/collections/' + c.id); setMode('all'); } catch (e) { toastErr(e); } } }, icon('trash', 13), t('Delete collection')) : null; })() : null);
        if (!q && !tag && mode === 'all') paintShowcase(r.featured); else mount(featEl);
        last = r.items; paintList();
      } catch (e) { mount(list, emptyState('alert', t('Could not load this'), e.message)); }
    }
    // 14.1 showcase: rotating hero with the most played uploads, Nebulix's official apps and a trending row
    let show = null; let heroT = 0;
    async function paintShowcase(feat) {
      if (!show) { try { const [top, off] = await Promise.all([api.get('/api/hub?sort=top', { quiet: true }), api.get('/api/hub?tag=official&sort=new', { quiet: true })]); show = { top: top.items.filter((x) => x.kind !== 'video' || x.thumb).slice(0, 6), off: off.items.filter((x) => x.official || (x.tags || []).includes('official')).slice(0, 12) }; } catch { show = { top: [], off: [] }; } }
      const heroes = (show.top.length ? show.top : feat ? [feat] : []).slice(0, 5); let at = 0; clearInterval(heroT);
      const heroBox = h('div.hbx-hero2');
      const paintHero = () => { if (!heroes.length) return mount(heroBox); const it = heroes[at];
        mount(heroBox, h('div.hbx-hbg', it.thumb ? h('img', { src: it.thumb, alt: '' }) : h('div.hbx-hbg-c', { style: { '--hb-c': KIND_COLOR[it.kind] || '#8b7bff' } })),
          h('div.hbx-hcontent', h('span.hbx-live', h('i'), at === 0 ? t('Most played this week') : t('Trending now')), h('h2', it.title), it.desc ? h('p', it.desc.slice(0, 160)) : null,
            h('div.hbx-hmeta', it.owner ? avatarEl(it.owner, { size: 26 }) : null, h('b', '@' + (it.owner ? it.owner.username : '?')), kindDot(it.kind), h('span', icon('eye', 13), fmt.compact(it.views)), h('span', icon('star', 13), fmt.compact(it.likes || 0))),
            h('div.row', { style: 'gap:8px;margin-top:14px' }, h('a.btn.primary.hbx-play', { href: '#/hub/' + it.id }, icon('play', 16), it.kind === 'video' ? t('Watch') : t('Play now')), h('a.btn', { href: '#/hub/' + it.id + '/code' }, icon('book', 15), t('Details')))),
          h('div.hbx-hdots', heroes.map((_, k) => h('button' + (k === at ? '.on' : ''), { type: 'button', 'aria-label': String(k + 1), onClick: () => { at = k; paintHero(); restart(); } }))),
          heroes.length > 1 ? h('div.hbx-hthumbs', heroes.map((x, k) => h('button.hbx-ht' + (k === at ? '.on' : ''), { type: 'button', onClick: () => { at = k; paintHero(); restart(); } }, cover(x)))) : null); };
      const restart = () => { clearInterval(heroT); heroT = setInterval(() => { if (!heroBox.isConnected) return clearInterval(heroT); at = (at + 1) % heroes.length; paintHero(); }, 7000); };
      paintHero(); if (heroes.length > 1) restart();
      const shelf = (title, ic, list, big) => (list.length ? h('section.hbx-shelf', h('div.hbx-shelf-h', h('h3', icon(ic, 17), ' ', title), h('span.tiny.muted', t('{n} items', { n: list.length }))),
        h('div.hbx-row-scroll', list.map((it) => h('a.hbx-tile' + (big ? '.big' : ''), { href: '#/hub/' + it.id }, cover(it), h('div.hbx-tile-i', h('b.ellipsis', it.title), h('span.tiny.muted', (it.official ? 'Nebulix' : '@' + (it.owner ? it.owner.username : '?')) + ' · ★ ' + fmt.compact(it.likes || 0))), it.official ? h('span.hbx-offbadge', icon('check', 11), ' ' + t('Official')) : null)))) : null);
      mount(featEl, heroBox, shelf(t('Official apps by Nebulix'), 'spark', show.off, true), shelf(t('Trending now'), 'chart', show.top.slice(0, 10)));
    }
    function paintList() {
      if (!last.length) { mount(list, emptyState('upload', t('Nothing here yet'), t('Be the first to upload something!'), h('button.btn.primary', { onClick: () => uploadDialog() }, t('Upload')))); return; }
      list.className = viewMode === 'grid' ? 'hbx-list hb-grid' : 'hbx-list';
      mount(list, last.map(viewMode === 'grid' ? card : row));
    }
    function starBtn(it) {
      const b = h('button.hbx-star' + (it.liked ? '.on' : ''), { type: 'button', onClick: (e) => { e.preventDefault(); e.stopPropagation(); lock(b, async () => { try { const r = await api.post(`/api/hub/${it.id}/like`); it.liked = r.liked; it.likes = r.likes; b.classList.toggle('on', r.liked); mount(b, icon('star', 14), r.liked ? t('★ Starred') : t('Star')); } catch (er) { toastErr(er); } }); } }, icon('star', 14), it.liked ? t('★ Starred') : t('Star'));
      return b;
    }
    function row(it) {
      return h('article.hbx-row', { onClick: (e) => { if (!e.target.closest('a,button')) ctx.go('hub', it.id); } },
        h('div.hbx-row-l', h('h3', h('a', { href: '#/hub/' + it.id }, h('span.hbx-owner', (it.owner ? it.owner.username : '?') + ' / '), h('b', it.title)), h('span.hbx-lbl', it.public ? t('Public') : t('Private'))),
          it.desc ? h('p.hbx-desc', it.desc.slice(0, 220)) : null,
          it.tags && it.tags.length ? h('div.hbx-topics', it.tags.slice(0, 6).map((x) => h('span.hbx-topic', x))) : null,
          h('div.hbx-meta', kindDot(it.kind), h('span', { title: t('Stars') }, icon('star', 13), fmt.compact(it.likes || 0)), h('span', { title: t('Views') }, icon('eye', 13), fmt.compact(it.views || 0)), it.rating ? h('span', starsEl(it.rating.avg, 11), ' ' + it.rating.avg.toFixed(1)) : null, it.version > 1 ? h('span', icon('tag', 13), 'v' + it.version) : null, it.duration ? h('span', icon('clock', 13), dur(it.duration)) : null, h('span', t('Updated {d}', { d: rel(it.updated || it.created) })))),
        h('div.hbx-row-r', starBtn(it), h('a.hbx-rthumb', { href: '#/hub/' + it.id, tabindex: -1 }, cover(it))));
    }
    function card(it) {
      return h('a.hb-card', { href: '#/hub/' + it.id }, cover(it),
        h('div.row', { style: 'gap:8px;align-items:flex-start' }, it.owner ? avatarEl(it.owner, { size: 30 }) : null, h('div.grow', { style: 'min-width:0' }, h('b.tube-title', it.title),
          h('div.hb-sub', '@' + (it.owner ? it.owner.username : '?') + ' · ' + t('{n} views', { n: fmt.compact(it.views) }) + (it.likes ? ' · ★ ' + it.likes : '') + (it.public ? '' : ' · ' + t('private'))), it.rating ? h('div.hb-cardr', starsEl(it.rating.avg, 12), h('span.tiny.muted', it.rating.avg.toFixed(1) + ' (' + it.rating.n + ')')) : null)));
    }
    async function uploadDialog(k0, folder) {
      let k = k0 || (['game', 'app', 'wall', 'video'].includes(mode) ? mode : 'game'); let entries = []; let coverFile = null; let allowDl = false; let allowRx = false; let runMode = 'sandbox';
      const accept = () => (k === 'video' ? 'video/mp4,video/webm,.mp4,.webm,.mov' : k === 'wall' ? 'video/mp4,video/webm,.mp4,.webm,image/*,.gif,.html,.htm,.js,.zip' : '.html,.htm,.js,.mjs,.zip');
      const pk = picker((e) => { entries = e; if (e.length && !title.value) title.value = (e.length > 1 ? (e[0].path.split('/')[0] || 'app') : e[0].path).replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').slice(0, 90); }, accept());
      const seg = tabsEl([['game', t('Game'), 'gamepad'], ['app', t('App'), 'cube'], ['wall', t('Background'), 'image'], ['video', t('Video'), 'play']], k, (v) => { k = v; pk.setAccept(accept()); hint.textContent = hintFor(); coverRow.style.display = k === 'video' ? 'none' : ''; });
      const hintFor = () => (k === 'video' ? t('MP4 or WEBM, up to {n} MB.', { n: S.me.pro ? 1024 : 200 }) : k === 'wall' ? t('An animated background: a looping video (MP4/WEBM), a GIF or image, or an animated web page (HTML/JS/ZIP/folder). Up to {n} MB.', { n: S.me.pro ? 200 : 80 }) : t('An .html or .js file, a .zip or a whole folder (up to {n} MB). It runs sandboxed: it cannot see your account.', { n: S.me.pro ? 2048 : 60 }));
      const hint = h('div.tiny.muted', hintFor());
      const coverIn = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', onChange: () => { coverFile = coverIn.files[0] || null; } });
      const coverRow = field(t('Cover image (optional)'), coverIn); if (k === 'video') coverRow.style.display = 'none';
      const title = h('input.input', { maxlength: 90, placeholder: t('Title') }); const desc = h('textarea.input', { rows: 3, maxlength: 2000, placeholder: t('Description (optional)') }); const tags = h('input.input', { placeholder: t('Tags, separated by commas') });
      let pub = true; const sw = switchEl(true, (v) => { pub = v; });
      const bar = h('div.hb-prog', h('i')); bar.style.display = 'none'; const status = h('div.tiny.muted');
      await modal({ title: t('Upload to the Hub'), cls: 'wide', body: h('div.col.gap', seg, pk.el, hint, coverRow, field(t('Title'), title), field(t('Description'), desc), field(t('Tags'), tags), h('div.row', h('span.grow', t('Public')), sw),
        S.cfg && S.cfg.gamesDomain ? field(t('How it runs'), modePicker('sandbox', (v) => { runMode = v; }), t('In every mode the game can never see anyone’s Nebulix account.')) : null,
        h('div.row', h('span.grow', t('Others can download it')), switchEl(false, (v) => { allowDl = v; })), h('div.row', h('span.grow', t('Others can remix it (copy and change it)')), switchEl(false, (v) => { allowRx = v; })), bar, status),
        actions: [{ label: t('Cancel'), value: false }, { label: t('Publish'), kind: 'primary', onClick: async (ev, m) => {
          const btn = ev.currentTarget;
          if (!entries.length) { toast(t('Choose a file or a folder first'), 'err'); return false; }
          if (title.value.trim().length < 2) { toast(t('Give it a title'), 'err'); return false; }
          btn.disabled = true; bar.style.display = 'block';
          try {
            let th = null; let duration = 0;
            const single = entries.length === 1 && (k === 'video' || (k === 'wall' && /\.(mp4|webm|mov|m4v|png|jpe?g|webp|gif|avif)$/i.test(entries[0].path)));
            const file = single ? entries[0].file : await packEntries(entries, (s) => { status.textContent = s; });
            if (k === 'video' || (k === 'wall' && /\.(mp4|webm|mov|m4v)$/i.test(file.name))) { status.textContent = t('Making a thumbnail…'); const v = await videoThumb(file); duration = v.duration; if (v.blob) th = (await putFile(`/api/hub/upload?kind=video&thumb=1&name=thumb.jpg`, new File([v.blob], 'thumb.jpg', { type: 'image/jpeg' }))).upload; }
            else if (coverFile) th = (await putFile(`/api/hub/upload?kind=${k}&thumb=1&name=${encodeURIComponent(coverFile.name)}`, coverFile)).upload;
            status.textContent = t('Uploading…');
            const up = await putFile(`/api/hub/upload?kind=${k}&name=${encodeURIComponent(file.name)}`, file, (p) => { bar.firstChild.style.width = Math.round(p * 100) + '%'; status.textContent = t('Uploading… {p}%', { p: Math.round(p * 100) }); });
            status.textContent = t('Publishing…');
            const r = await api.post('/api/hub', { upload: up.upload, thumb: th, title: title.value, desc: desc.value, tags: tags.value.split(',').map((x) => x.trim()).filter(Boolean), public: pub, duration, allowDownload: allowDl, allowRemix: allowRx, runMode });
            toast(t('Published!'), 'good'); m.close(true); ctx.go('hub', r.item.id);
          } catch (e) { toastErr(e); btn.disabled = false; status.textContent = ''; bar.style.display = 'none'; }
          return false;
        } }] });
      void folder;
    }
    load();

    // ---------- one upload, shown like a repository ----------
    var loadBoardRef = () => {}; // var: itemPage() can run before this line (deep links)
    async function itemPage(id, tab0) {
      mount(inner, loading());
      let d; try { d = await api.get('/api/hub/' + encodeURIComponent(id)); } catch (e) { mount(inner, emptyState('alert', t('Not found'), e.message, h('button.btn', { onClick: () => ctx.go('hub') }, t('Back')))); return; }
      const it = d.item; ctx.setTitle && ctx.setTitle(it.title); const code = !(it.kind === 'video' || it.kind === 'clip') && it.wtype !== 'video' && it.wtype !== 'image';
      let player; let fr = null;
      if (it.wtype === 'video') player = h('div.hb-player', h('video', { src: it.src, autoplay: true, muted: true, loop: true, playsinline: true, poster: it.thumb || null }));
      else if (it.wtype === 'image') player = h('div.hb-player', h('img', { src: it.src, alt: it.title, style: 'width:100%;height:100%;object-fit:cover' }));
      else if (!code) player = h('div.hb-player', h('video', { src: it.src, controls: true, autoplay: true, playsinline: true, poster: it.thumb || null, preload: 'metadata' }));
      else if (!it.src && it.sale && it.sale.locked) {
        // Nebula Vault: a paid game that is not in your library yet
        player = h('div.hb-player.game.vt-locked', it.thumb ? h('img.vt-lockbg', { src: it.thumb, alt: '' }) : null, h('div.vt-lockc', h('div', { style: 'font-size:42px' }, '🔒'), h('h2', it.title), h('p.muted', t('This game is sold in Nebula Vault. Buy it once and play it forever.')),
          h('div.row', { style: 'justify-content:center;gap:10px' }, (await import('./vault.js')).priceTag(it.sale), h('button.btn.primary', { onClick: async () => { const V = await import('./vault.js'); V.buyGame(it, () => itemPage(it.id)); } }, icon('bag', 15), t('Buy and play')), h('button.btn', { onClick: () => api.post(`/api/vault/${it.id}/wish`).then((r) => toast(r.wished ? t('Added to your wishlist') : t('Removed from your wishlist'), 'info')).catch(toastErr) }, '♡ ', t('Wishlist')))));
      }
      else if (it.runMode === 'native') {
        // native: the real page on the games domain, inside Nebulix, with no sandbox and no proxy — like a Chrome tab
        fr = h('iframe.hb-frame', { src: it.src, title: it.title, allow: 'cross-origin-isolated; fullscreen; autoplay; gamepad; clipboard-write; clipboard-read; screen-wake-lock; accelerometer; gyroscope; midi; encrypted-media; picture-in-picture; web-share; xr-spatial-tracking' + allowExtra(it).replace('; midi', ''), allowfullscreen: '' });
        player = h('div.hb-player.game', fr);
      }
      else {
        fr = h('iframe.hb-frame', { src: it.src, title: it.title, sandbox: it.runMode === 'domain' ? 'allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-pointer-lock allow-downloads allow-orientation-lock allow-presentation' : null, allow: 'fullscreen; autoplay; gamepad; clipboard-write; clipboard-read; screen-wake-lock; accelerometer; gyroscope; picture-in-picture; web-share; xr-spatial-tracking' + allowExtra(it), allowfullscreen: '' });
        // the game's saves arrive from the sandbox (see server/hubshim.js) and are kept on the player's account
        let saveT = 0; let pending = null;
        const onMsg = (e) => { if (!fr.isConnected) { removeEventListener('message', onMsg); return; } if (e.source !== fr.contentWindow || !e.data || e.data.nxHubSave !== 1) return; pending = { ls: e.data.ls || {}, ck: String(e.data.ck || '') }; clearTimeout(saveT); saveT = setTimeout(() => { const b = pending; pending = null; api.put(`/api/hub/${it.id}/gamesave`, b, { quiet: true }).catch(() => {}); }, 1500); };
        addEventListener('message', onMsg);
        player = h('div.hb-player.game', fr);
      }
      if (fr) gameApi(fr, it.id, { onBoard: () => setTimeout(loadBoardRef, 300) });
      let theater = false;
      const tools = code && fr ? h('div.hb-tools', h('button.btn.sm', { onClick: () => { try { fr.requestFullscreen(); } catch {} } }, icon('fullscreen', 14), t('Fullscreen')), h('button.btn.sm', { onClick: () => { const s = fr.src; try { fr.contentWindow.location.replace(s); } catch { fr.src = s; } } }, icon('refresh', 14), t('Restart')),
        h('button.btn.sm', { onClick: () => { theater = !theater; inner.classList.toggle('hbx-theater', theater); } }, icon('fullscreen', 14), t('Theater mode')),
        h('a.btn.sm', { href: it.src, target: '_blank', rel: 'noopener' }, icon('external', 14), t('Open in a new tab')),
        it.runMode === 'native' ? h('button.btn.sm', { onClick: () => { const w = Math.min(1600, screen.availWidth - 40), hh = Math.min(1000, screen.availHeight - 60); if (!window.open(it.src, 'nbx-game-' + it.id, `popup=yes,width=${w},height=${hh},left=${Math.round((screen.availWidth - w) / 2)},top=${Math.round((screen.availHeight - hh) / 2)}`)) window.open(it.src, '_blank'); } }, icon('window', 14), t('Own window')) : null, it.mine && it.sale ? h('button.btn.sm', { onClick: () => ctx.go('vault', 'sell') }, '🔷 ', it.sale.price ? t('Vault: {c} coins', { c: fmt.coins(it.sale.eff) }) : t('Sell in Nebula Vault')) : (it.sale && it.sale.price ? h('span.pill', '🔷 ' + t('Owned')) : null), h('span.grow'), h('span.tiny.muted', it.runMode === 'native' ? t('Runs natively, like a Chrome tab · cannot see your account') : it.runMode === 'domain' ? t('Runs like in Chrome on the games domain · cannot see your account') : t('Runs sandboxed · can load files from the internet'))) : null;

      // header buttons: Save · Remix · Star (each with its counter, like a code site)
      const pairBtn = (ic, label, n, on, onClick) => { const b = h('button.hbx-pair' + (on ? '.on' : ''), { type: 'button', onClick: (e) => onClick(e, b) }, h('span.hbx-pair-l', icon(ic, 14), h('span', label)), n != null ? h('span.hbx-pair-n', fmt.compact(n)) : null); return b; };
      const saveB = pairBtn('bookmark', it.saved ? t('Saved') : t('Save'), null, it.saved, (e, b) => lock(b, async () => { try { const r = await api.post(`/api/hub/${it.id}/save`); it.saved = r.saved; b.classList.toggle('on', r.saved); b.querySelector('.hbx-pair-l span').textContent = r.saved ? t('Saved') : t('Save'); } catch (er) { toastErr(er); } }));
      const installB = code && it.files && (!it.sale || !it.sale.locked) ? pairBtn(it.installed ? 'check' : 'download', it.installed ? t('Installed') : t('Install'), null, it.installed, (e, b) => lock(b, async () => { try { if (!it.installed && missingPerms(it).length) await askPerms(it); const r = await api.post(`/api/hub/${it.id}/install`); it.installed = r.installed; b.classList.toggle('on', r.installed); mount(b.querySelector('.hbx-pair-l'), icon(r.installed ? 'check' : 'download', 14), h('span', r.installed ? t('Installed') : t('Install'))); toast(r.installed ? t('Installed: it is now in the Nebulix OS start menu and desktop') : t('Uninstalled'), 'good'); dispatchEvent(new Event('nbx:apps')); } catch (er) { toastErr(er); } })) : null;
      const remixB = (it.allowRemix || it.mine) && it.files ? pairBtn('fork', t('Remix'), it.remixes || 0, false, async () => { try { const r = await api.post(`/api/hub/${it.id}/remix`); toast(t('Remix created as a private draft'), 'good'); ctx.go('hub', r.item.id); } catch (er) { toastErr(er); } }) : null;
      const starB = pairBtn('star', it.liked ? t('★ Starred') : t('Star'), it.likes, it.liked, (e, b) => lock(b, async () => { const r = await api.post(`/api/hub/${it.id}/like`); it.liked = r.liked; it.likes = r.likes; b.classList.toggle('on', r.liked); b.querySelector('.hbx-pair-l span').textContent = r.liked ? t('★ Starred') : t('Star'); b.querySelector('.hbx-pair-n').textContent = fmt.compact(r.likes); if (r.liked) { b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); } }));
      async function colMenu(anchor) {
        let r; try { r = await api.get('/api/hub/collections/of/' + it.id); } catch (e) { toastErr(e); return; }
        const ui = await import('../ui.js');
        ui.openMenu([...r.cols.map((c) => ({ label: c.name, icon: c.has ? 'check' : 'plus', onClick: async () => { try { const x = await api.post(`/api/hub/collections/${c.id}/toggle`, { item: it.id }); toast(x.on ? t('Added to “{n}”', { n: c.name }) : t('Removed from “{n}”', { n: c.name }), 'good'); } catch (e) { toastErr(e); } } })),
          { hr: true }, { label: t('New collection…'), icon: 'plus', onClick: async () => { const name = await promptBox(t('New collection'), { label: t('Name') }); if (!name) return; try { const c = await api.post('/api/hub/collections', { name }); await api.post(`/api/hub/collections/${c.col.id}/toggle`, { item: it.id }); toast(t('Added to “{n}”', { n: name }), 'good'); } catch (e) { toastErr(e); } } }], anchor);
      }
      const download = () => { const a = document.createElement('a'); a.href = `/x/hub/dl/${it.id}`; a.download = ''; document.body.append(a); a.click(); a.remove(); };
      const codeMenu = (anchor) => import('../ui.js').then((ui) => ui.openMenu([
        { label: t('Copy link'), icon: 'link', onClick: async () => { try { await navigator.clipboard.writeText(location.origin + '/#/hub/' + it.id); toast(t('Link copied'), 'good'); } catch {} } },
        code ? { label: t('Copy embed code'), icon: 'copy', onClick: async () => { try { await navigator.clipboard.writeText(`<iframe src="${/^https?:/.test(it.src) ? it.src : location.origin + it.src}" width="960" height="540" style="border:0" allow="fullscreen; autoplay; gamepad" allowfullscreen></iframe>`); toast(t('Embed code copied'), 'good'); } catch {} } } : null,
        it.allowDownload || it.mine ? { label: t('Download ZIP'), icon: 'download', onClick: download } : null,
        code && it.src ? { label: t('Open in a new tab'), icon: 'external', onClick: () => window.open(it.src, '_blank', 'noopener') } : null,
        { label: t('Add to a collection'), icon: 'layers', onClick: () => colMenu(anchor) },
        code && it.files ? { label: t('Delete my saved game'), icon: 'trash', onClick: async () => { if (!(await confirmBox(t('Delete your saved progress in “{t}”?', { t: it.title }), { danger: true }))) return; try { await api.del(`/api/hub/${it.id}/gamesave`); toast(t('Saved game deleted'), 'good'); } catch (er) { toastErr(er); } } } : null,
        !it.mine ? { hr: true } : null,
        !it.mine ? { label: t('Report'), icon: 'flag', danger: true, onClick: async () => { const reason = await promptBox(t('Report “{t}”', { t: it.title }), { label: t('What is wrong?'), multiline: true }); if (!reason || reason.trim().length < 3) return; try { await api.post('/api/reports', { type: 'hub', target: it.id, reason }); toast(t('Thanks — the moderators will review it.'), 'good'); } catch (er) { toastErr(er); } } } : null,
      ].filter(Boolean), anchor));
      const modRemove = !it.mine && ['owner', 'admin', 'mod'].includes(S.me.role) ? h('button.btn.sm.danger', { onClick: async () => { const reason = await promptBox(t('Remove “{t}”', { t: it.title }), { label: t('Reason (the author will see it)') }); if (reason === null) return; try { await api.del(`/api/admin/content/hub/${it.id}?reason=${encodeURIComponent(reason)}`); toast(t('Removed'), 'good'); ctx.go('hub'); } catch (e) { toastErr(e); } } }, icon('shield', 14), t('Remove')) : null;

      const head = h('header.hbx-rhead',
        h('div.hbx-rtitle', icon(KIND_ICON[it.kind] || 'book', 18), it.owner ? h('a.hbx-rown', { href: '#/profile/' + it.owner.username }, it.owner.username) : h('span', '?'), h('span.hbx-slash', '/'), h('a.hbx-rname', { href: '#/hub/' + it.id }, it.title), h('span.hbx-lbl', it.public ? t('Public') : t('Private')), it.remixOf ? h('span.hbx-lbl', icon('fork', 11), ' ', h('a', { href: '#/hub/' + it.remixOf }, t('remix'))) : null),
        h('div.hbx-ractions', modRemove, installB, saveB, remixB, starB, it.kind === 'wall' ? h('button.btn.sm.primary', { onClick: async (e) => busy(e.currentTarget, async () => { try { const { setLiveBg } = await import('../livebg.js'); await setLiveBg({ id: it.id }); toast(t('Background applied. Adjust it in Appearance.'), 'good'); } catch (er) { toastErr(er); } }) }, icon('image', 14), t('Use as background')) : null));

      // tabs
      const TABS = [['play', code ? t('Play') : t('Watch'), 'play'], code && it.files ? ['code', t('Code'), 'terminal'] : null, code ? ['releases', t('Releases'), 'tag', it.version] : null, ['reviews', t('Reviews'), 'star', it.rating ? it.rating.n : 0], ['discuss', t('Discussions'), 'chat', it.comments], ['media', t('Media'), 'image', (it.shots || []).length], it.mine ? ['settings', t('Settings'), 'gear'] : null].filter(Boolean);
      let tab = TABS.some((x) => x[0] === tab0) ? tab0 : 'play';
      const tabsNav = h('nav.hbx-utabs.hbx-rtabs'); const body = h('div.hbx-rbody');
      const paintTabs2 = () => mount(tabsNav, TABS.map(([k, l, ic, n]) => h('button.hbx-utab' + (tab === k ? '.on' : ''), { type: 'button', onClick: () => { tab = k; history.replaceState(null, '', '#/hub/' + it.id + (k === 'play' ? '' : '/' + k)); paintTabs2(); paintBody(); } }, icon(ic, 15), h('span', l), n ? h('span.hbx-count', fmt.compact(n)) : null)));

      // About sidebar (always visible next to the tab)
      let filesCache = null; const getFiles = async () => { if (filesCache) return filesCache; if (!code || !it.files) return (filesCache = { files: [], entry: '' }); try { filesCache = await api.get(`/api/hub/${it.id}/files`); } catch { filesCache = { files: [], entry: '' }; } return filesCache; };
      const langEl = h('div'); const boardEl = h('div'); loadBoardRef = () => { loadBoard(); loadAch(); };
      const loadBoard = () => api.get(`/api/hub/${it.id}/board`, { quiet: true }).then((r) => mount(boardEl, r.board.length ? h('div.hbx-box', h('div.hbx-boxh', h('b', '🏆 ' + t('Leaderboard')), it.mine || ['owner', 'admin', 'mod'].includes(S.me.role) ? h('button.btn.sm.ghost', { title: t('Reset the leaderboard'), onClick: async () => { if (await confirmBox(t('Reset the leaderboard of “{t}”?', { t: it.title }), { danger: true })) { await api.del(`/api/hub/${it.id}/board`).catch(toastErr); loadBoard(); } } }, icon('refresh', 13)) : null),
        h('ol.hbx-board', r.board.slice(0, 10).map((x) => h('li' + (x.me ? '.me' : ''), h('span.hbx-rank', String(x.rank)), x.user ? avatarEl(x.user, { size: 20 }) : null, h('span.grow.ellipsis', x.user ? x.user.displayName || x.user.username : '?'), h('b', Number(x.score).toLocaleString())))), r.mine && r.mine.rank > 10 ? h('div.tiny.muted', t('Your rank: #{r}', { r: r.mine.rank })) : null, h('div.tiny.muted', t('Scores are sent by the game itself.'))) : null)).catch(() => {});
      const achEl = h('div');
      const loadAch = () => api.get(`/api/hub/${it.id}/ach`, { quiet: true }).then((a) => mount(achEl, a.total ? h('div.hbx-box', h('div.hbx-boxh', h('b', '🏅 ' + t('Achievements')), h('span.hbx-count', a.unlocked + '/' + a.total)), h('div.hbx-achbar', h('i', { style: { width: (a.unlocked / a.total * 100) + '%' } })),
        h('ul.hbx-achs', a.list.map((x) => h('li' + (x.mine ? '.on' : ''), h('span.hbx-achic', x.mine ? '🏅' : '🔒'), h('div.grow', h('b', x.title), x.desc ? h('div.tiny.muted', x.desc) : null), h('span.tiny.muted', t('{p}% of players', { p: x.pct })))))) : null)).catch(() => {});
      if (code && it.files) { loadBoard(); loadAch(); }
      const about = h('aside.hbx-about',
        h('div.hbx-box', h('div.hbx-boxh', h('b', t('About'))), it.desc ? h('p.small', { style: 'white-space:pre-wrap;margin:0 0 10px' }, it.desc.slice(0, 600)) : h('p.small.muted', t('No description.')),
          it.tags && it.tags.length ? h('div.hbx-topics', it.tags.map((x) => h('a.hbx-topic', { href: '#/hub?tag=' + encodeURIComponent(x) }, x))) : null,
          h('ul.hbx-facts', h('li', icon('star', 14), h('b', fmt.compact(it.likes)), ' ' + t('stars')), h('li', icon('eye', 14), h('b', fmt.compact(it.views)), ' ' + t('views')), h('li', icon('fork', 14), h('b', fmt.compact(it.remixes || 0)), ' ' + t('remixes')), h('li', icon('chat', 14), h('b', fmt.compact(it.comments || 0)), ' ' + t('comments')),
            h('li', icon('clock', 14), t('Created {d}', { d: fmt.date(it.created) })), it.size ? h('li', icon('download', 14), mb(it.size)) : null, (it.perms || []).length ? h('li', icon('lock', 14), t('Permissions: {p}', { p: it.perms.map((p) => PERM_INFO[p][0] + ' ' + t(PERM_INFO[p][1]) + ((it.granted || []).includes(p) ? ' ✓' : '')).join(', ') })) : null, code ? h('li', icon('shield', 14), it.runMode === 'native' ? t('Runs natively') : it.runMode === 'domain' ? t('Runs on the games domain') : t('Runs sandboxed')) : null)),
        code ? h('div.hbx-box', h('div.hbx-boxh', h('b', t('Releases')), h('span.hbx-count', String(it.version || 1))), h('div.hbx-rel-mini', icon('tag', 15), h('div', h('b', 'v' + (it.version || 1)), ' ', h('span.hbx-latest', t('Latest')), h('div.tiny.muted', rel(it.updated || it.created))))) : null,
        code && it.files ? boardEl : null,
        code && it.files ? achEl : null,
        code && it.files ? h('div.hbx-box', h('div.hbx-boxh', h('b', t('Languages'))), langEl) : null,
        d.more && d.more.length ? h('div.hbx-box', h('div.hbx-boxh', h('b', t('More like this'))), d.more.slice(0, 6).map((m) => h('a.hbx-mini', { href: '#/hub/' + m.id }, h('i.hbx-kdot', { style: { background: KIND_COLOR[m.kind] || '#8b949e' } }), h('span.ellipsis', (m.owner ? m.owner.username : '?') + ' / ', h('b', m.title))))) : null);
      if (code && it.files) getFiles().then((f) => { const L = languages(f.files); mount(langEl, h('div.hbx-langbar', L.map((x) => h('i', { style: { width: x.p + '%', background: x.c }, title: x.n }))), h('ul.hbx-langs', L.map((x) => h('li', h('i', { style: { background: x.c } }), h('b', x.n), ' ', h('span.muted', x.p.toFixed(1) + '%'))))); });

      async function paintBody() {
        if (tab === 'play') { const miss = fr ? missingPerms(it) : []; mount(body, miss.length ? h('div.hbx-perm', h('span', '🔐 ' + t('This game asks for: {p}', { p: miss.map((p) => PERM_INFO[p][0] + ' ' + t(PERM_INFO[p][1])).join(', ') })), h('button.btn.sm.primary', { onClick: async () => { await askPerms(it); itemPage(it.id); } }, t('Review'))) : null, player, tools, h('div.hbx-under', h('h2.tube-h', it.title), h('div.row', { style: 'gap:6px;flex-wrap:wrap' }, h('button.btn.sm', { onClick: (e) => codeMenu(e.currentTarget) }, icon('more', 14), t('More'))))); return; }
        if (tab === 'code') {
          mount(body, loading()); const f = await getFiles(); if (tab !== 'code') return;
          const base = (it.src || '').slice(0, (it.src || '').length - String(f.entry || '').split('/').map(encodeURIComponent).join('/').length);
          const urlOf = (p) => base + p.split('/').map(encodeURIComponent).join('/');
          // folders → browse like a code site; dir = current folder path ('' = root)
          let dir = ''; const viewer = h('div.hbx-viewer.hide'); const tableHost = h('div'); const readmeHost = h('div');
          const readme = f.files.find((x) => /^readme(\.md|\.txt)?$/i.test(x.path)) || f.files.find((x) => /(^|\/)readme\.md$/i.test(x.path));
          const paintDir = () => {
            const here = new Map(); for (const x of f.files) { if (!x.path.startsWith(dir)) continue; const rest = x.path.slice(dir.length); const slash = rest.indexOf('/'); if (slash >= 0) { const name = rest.slice(0, slash + 1); const e = here.get(name) || { path: dir + name, dir: true, size: 0, n: 0 }; e.size += x.size; e.n++; here.set(name, e); } else here.set(rest, x); }
            const rows = [...here.entries()].sort((a, b) => (b[1].dir ? 1 : 0) - (a[1].dir ? 1 : 0) || a[0].localeCompare(b[0]));
            mount(tableHost, h('div.hbx-ftable',
              h('div.hbx-fhead', it.owner ? avatarEl(it.owner, { size: 20 }) : null, h('b', it.owner ? it.owner.username : '?'), h('span.grow.ellipsis.muted', (it.versions && it.versions.length ? it.versions[it.versions.length - 1].note : '') || t('Version {v}', { v: it.version || 1 })), h('span.tiny.muted', icon('clock', 12), ' ', rel(it.updated || it.created)), h('span.tiny', h('b', String(f.files.length)), ' ' + t('files'))),
              dir ? h('button.hbx-frow', { type: 'button', onClick: () => { dir = dir.replace(/[^/]+\/$/, ''); paintDir(); } }, icon('back', 14), h('span.grow', '..')) : null,
              rows.map(([name, x]) => h('button.hbx-frow' + (x.path === f.entry ? '.entry' : ''), { type: 'button', disabled: !x.dir && !TEXTY.test(x.path) && !/\.(png|jpe?g|gif|webp|svg)$/i.test(x.path), onClick: async () => {
                if (x.dir) { dir = x.path; paintDir(); return; }
                try { if (/\.(png|jpe?g|gif|webp|svg)$/i.test(x.path)) { mount(viewer, h('div.hbx-vhead', icon('image', 14), h('b.grow', x.path), h('span.tiny.muted', mb(x.size))), h('div.hbx-vimg', h('img', { src: urlOf(x.path), alt: x.path }))); }
                  else { const txt = (await api.get(`/api/hub/${it.id}/raw?path=${encodeURIComponent(x.path)}`)).text; const lines = (txt.length > 200000 ? txt.slice(0, 200000) + '\n…' : txt).split('\n');
                    mount(viewer, h('div.hbx-vhead', icon('terminal', 14), h('b.grow', x.path), h('span.tiny.muted', t('{n} lines', { n: lines.length }) + ' · ' + mb(x.size)), h('button.btn.sm.ghost', { onClick: () => { navigator.clipboard.writeText(txt).then(() => toast(t('Copied!'), 'good')).catch(() => {}); } }, icon('copy', 13))), h('pre.hbx-code', lines.map((l, i) => h('div', h('span.hbx-ln', String(i + 1)), h('code', l || ' '))))); }
                  viewer.classList.remove('hide'); viewer.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) { toastErr(e); } } },
                icon(x.dir ? 'layers' : fileIcon(x.path), 15), h('span.grow.ellipsis', name.replace(/\/$/, '')), x.path === f.entry ? h('span.hbx-lbl', '▶ ' + t('start')) : null, h('span.tiny.muted', x.dir ? t('{n} files', { n: x.n }) : mb(x.size)))))); };
          paintDir();
          if (readme) { api.get(`/api/hub/${it.id}/raw?path=${encodeURIComponent(readme.path)}`, { quiet: true }).then((r) => r.text).then((txt) => mount(readmeHost, h('div.hbx-readme', h('div.hbx-vhead', icon('book', 14), h('b', 'README')), h('div.hbx-md.md', renderMarkdown(txt.slice(0, 60000)))))).catch(() => {}); }
          else mount(readmeHost, h('div.hbx-readme', h('div.hbx-vhead', icon('book', 14), h('b', 'README')), h('div.hbx-md', it.desc ? h('p', { style: 'white-space:pre-wrap' }, it.desc) : h('p.muted', it.mine ? t('Add a README.md file to your upload to explain it here.') : t('No description.')))));
          mount(body, h('div.hbx-codebar', h('span.hbx-branch', icon('branch', 14), 'main'), h('span.tiny.muted', icon('tag', 13), ' v' + (it.version || 1)), h('span.grow'), h('button.btn.sm.hbx-green', { onClick: (e) => codeMenu(e.currentTarget) }, icon('terminal', 14), t('Code'), ' ▾')), tableHost, viewer, readmeHost); return;
        }
        if (tab === 'releases') {
          const vs = (it.versions || []).slice().reverse();
          mount(body, h('div.hbx-rels', it.mine ? h('div.row', { style: 'justify-content:flex-end;margin-bottom:10px' }, h('button.btn.sm.hbx-green', { onClick: () => newVersion() }, icon('upload', 14), t('Draft a new release'))) : null,
            (vs.length ? vs : [{ v: it.version || 1, note: '', at: it.created, size: it.size }]).map((v, i) => h('article.hbx-rel', h('div.hbx-rel-side', h('span.hbx-tagpill', icon('tag', 12), ' v' + v.v), h('div.tiny.muted', rel(v.at))),
              h('div.hbx-rel-main', h('h3', 'v' + v.v, i === 0 ? h('span.hbx-latest', t('Latest')) : null), h('p.small', { style: 'white-space:pre-wrap' }, v.note || (i === vs.length - 1 || !vs.length ? t('First version.') : t('No notes'))), h('div.hbx-asset', icon('download', 14), h('span.grow', t('Source code (zip)')), h('span.tiny.muted', mb(v.size || 0)), i === 0 && (it.allowDownload || it.mine) ? h('button.btn.sm', { onClick: download }, t('Download')) : null)))))); return;
        }
        if (tab === 'reviews') { mount(body, X.reviewsPanel(it)); return; }
        if (tab === 'discuss') { mount(body, X.hubComments(it)); return; }
        if (tab === 'media') { const host = h('div'); const paintM = () => mount(host, X.shotsPanel(it, paintM), X.clipsPanel(it, { frame: fr })); paintM(); mount(body, host); return; }
        if (tab === 'settings') {
          mount(body, h('div.hbx-settings',
            h('section.hbx-box', h('h3', t('General')), h('p.small.muted', t('Title, description, topics, visibility and how it runs.')), h('button.btn', { onClick: editInfo }, icon('edit', 14), t('Edit details'))),
            code ? h('section.hbx-box', h('h3', t('Cover image')), h('p.small.muted', t('The picture shown in lists and cards.')), h('button.btn', { onClick: changeCover }, icon('image', 14), t('Change cover'))) : null,
            code ? h('section.hbx-box', h('h3', t('Releases')), h('p.small.muted', t('Upload a new version: players get it straight away and the old notes stay in Releases.')), h('button.btn', { onClick: () => newVersion() }, icon('upload', 14), t('New version'))) : null,
            code && (it.kind === 'game' || it.kind === 'app') ? h('section.hbx-box', h('h3', 'Nebula Vault'), h('p.small.muted', t('Sell it for coins in Nebula Vault.')), h('button.btn', { onClick: () => ctx.go('vault', 'sell') }, '🔷 ', t('Sell in Nebula Vault'))) : null,
            h('section.hbx-box.hbx-danger', h('h3', t('Danger zone')), h('div.row', { style: 'align-items:center;gap:10px;flex-wrap:wrap' }, h('div.grow', h('b', t('Delete this upload')), h('div.small.muted', t('Once you delete it, there is no going back.'))),
              h('button.btn.danger', { onClick: async () => { if (!(await confirmBox(t('Delete “{t}”?', { t: it.title }), { danger: true }))) return; try { await api.del('/api/hub/' + it.id); ctx.go('hub'); } catch (e) { toastErr(e); } } }, icon('trash', 14), t('Delete'))))));
        }
      }
      async function newVersion() {
        let entries = []; const pk = picker((e) => { entries = e; }, '.html,.htm,.js,.mjs,.zip'); const note = h('input.input', { maxlength: 200, placeholder: t('What changed? (optional)') }); const status = h('div.tiny.muted');
        await modal({ title: t('New version of “{t}”', { t: it.title }), cls: 'wide', body: h('div.col.gap', pk.el, field(t('Notes'), note), status), actions: [{ label: t('Cancel'), value: false }, { label: t('Publish'), kind: 'primary', onClick: async (ev, m) => {
          if (!entries.length) { toast(t('Choose a file or a folder first'), 'err'); return false; } ev.currentTarget.disabled = true;
          try { const file = await packEntries(entries, (s) => { status.textContent = s; }); const up = await putFile(`/api/hub/upload?kind=${it.kind}&name=${encodeURIComponent(file.name)}`, file, (p) => { status.textContent = t('Uploading… {p}%', { p: Math.round(p * 100) }); });
            await api.post(`/api/hub/${it.id}/version`, { upload: up.upload, note: note.value }); toast(t('New version published'), 'good'); m.close(true); itemPage(it.id, 'releases'); } catch (e) { toastErr(e); ev.currentTarget.disabled = false; }
          return false; } }] });
      }
      async function changeCover() {
        const i = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', onChange: async () => { const f = i.files[0]; if (!f) return; try { const up = await putFile(`/api/hub/upload?kind=${it.kind}&thumb=1&name=${encodeURIComponent(f.name)}`, f); await api.post(`/api/hub/${it.id}/cover`, { thumb: up.upload }); toast(t('Cover updated'), 'good'); } catch (e) { toastErr(e); } } });
        i.click();
      }
      async function editInfo() {
        const ti = h('input.input', { maxlength: 90, value: it.title }); const de = h('textarea.input', { rows: 4, maxlength: 2000 }); de.value = it.desc || ''; const tg = h('input.input', { value: (it.tags || []).join(', ') }); let pub = it.public; const sw = switchEl(it.public, (v) => { pub = v; }); let rd = it.runMode || 'sandbox'; const swr = modePicker(rd, (v) => { rd = v; });
        const ok = await modal({ title: t('Edit'), body: h('div.col.gap', field(t('Title'), ti), field(t('Description'), de), field(t('Tags'), tg), h('div.row', h('span.grow', t('Public')), sw), code && it.gamesDomain ? field(t('How it runs'), swr) : null), actions: [{ label: t('Cancel'), value: false }, { label: t('Save'), kind: 'primary', value: true }] });
        if (!ok) return; try { await api.patch('/api/hub/' + it.id, { title: ti.value, desc: de.value, tags: tg.value.split(',').map((x) => x.trim()).filter(Boolean), public: pub, runMode: rd }); toast(t('Saved'), 'good'); itemPage(it.id, 'settings'); } catch (e) { toastErr(e); }
      }
      mount(inner, h('div.hbx-repo', h('a.hbx-back', { href: '#/hub' }, icon('back', 14), 'Nebulix Hub'), head, tabsNav, h('div.hbx-rgrid', h('div.hbx-rmain', body), about)));
      paintTabs2(); paintBody();
    }
    return () => {};
  },
};
