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

export default {
  title: () => 'Nebulix Hub',
  async mount(root, ctx) {
    const inner = h('div.inner.hb'); mount(root, inner);
    if (ctx.params[0]) { itemPage(ctx.params[0]); return () => {}; }
    // mode: a kind (all/game/app/wall/video) or a personal list (mine/saved/history/col:<id>)
    let mode = ctx.query.get('kind') || ls('hub.kind') || 'all'; let q = ''; let sort = 'new'; let tag = ''; let viewMode = ls('hub.view') || 'grid'; let last = []; let cols = []; let counts = {};
    const KINDS_TAB = ['all', 'game', 'app', 'wall', 'video'];
    const list = h('div.hb-grid'); const usageEl = h('div.hb-usage'); const featEl = h('div'); const chips = h('div', { style: 'display:contents' }); const tagsEl = h('div.hb-tags'); const statsEl = h('div');
    const search = h('input.input', { placeholder: t('Search games, apps, backgrounds, videos, tags or people…'), onInput: (e) => { q = e.target.value; clearTimeout(search.t); search.t = setTimeout(load, 250); } });
    const sortSel = h('select.select', { onChange: (e) => { sort = e.target.value; load(); } }, [['new', 'Newest'], ['top', 'Most popular'], ['likes', 'Most liked'], ['comments', 'Most commented'], ['rating', 'Best rated'], ['updated', 'Recently updated'], ['random', 'Random']].map(([v, l]) => h('option', { value: v }, t(l))));
    const CH = [['all', t('All')], ['game', t('Games')], ['app', t('Apps')], ['wall', t('Backgrounds')], ['video', t('Videos')], ['|'], ['saved', t('Saved')], ['history', t('History')], ['mine', t('My uploads')]];
    const setMode = (m) => { mode = m; if (KINDS_TAB.includes(m)) ls('hub.kind', m); tag = ''; paintChips(); load(); };
    const paintChips = () => mount(chips, CH.map(([k, l]) => (k === '|' ? h('span.hb-sep') : h('button.hb-tab' + (mode === k ? '.on' : ''), { type: 'button', onClick: () => setMode(k) }, l, counts[k] ? h('small', String(counts[k])) : null))),
      cols.map((c) => h('button.hb-tab' + (mode === 'col:' + c.id ? '.on' : ''), { type: 'button', title: t('Collection'), onClick: () => setMode('col:' + c.id) }, '▤ ' + c.name, h('small', String(c.n)))),
      h('button.hb-tab', { type: 'button', title: t('New collection'), onClick: async () => { const name = await promptBox(t('New collection'), { label: t('Name') }); if (!name) return; try { await api.post('/api/hub/collections', { name }); load(); } catch (e) { toastErr(e); } } }, '+'));
    const viewBtns = h('div.hb-view', [['grid', 'grid'], ['list', 'menu']].map(([v, ic]) => h('button' + (viewMode === v ? '.on' : ''), { type: 'button', title: v === 'grid' ? t('Grid') : t('List'), 'aria-label': v === 'grid' ? t('Grid') : t('List'), onClick: (e) => { viewMode = v; ls('hub.view', v); for (const b of viewBtns.children) b.classList.toggle('on', b === e.currentTarget); paintList(); } }, icon(ic, 15))));
    mount(inner,
      h('header.hb-head', h('div.grow', h('h2', 'Nebulix Hub'), h('p', t('Games, web apps, animated backgrounds and videos made by the community. Upload a file, a .zip or a whole folder.'))), usageEl,
        h('div.row', { style: 'gap:6px' }, h('button.btn', { onClick: () => uploadDialog('game', true) }, icon('layers', 15), t('Upload a folder')), h('button.btn.primary', { onClick: () => uploadDialog() }, icon('upload', 15), t('Upload')))),
      h('nav.hb-tabs', chips), statsEl, featEl, h('div.hb-bar', search, sortSel, h('div.grow'), viewBtns), tagsEl, list);
    paintChips();
    async function load() {
      mount(list, loading());
      try {
        const qs = new URLSearchParams({ q, sort }); if (KINDS_TAB.includes(mode) && mode !== 'all') qs.set('kind', mode); if (mode === 'mine') qs.set('mine', 1); if (mode === 'saved') qs.set('saved', 1); if (mode === 'history') qs.set('history', 1); if (mode.startsWith('col:')) qs.set('col', mode.slice(4)); if (tag) qs.set('tag', tag);
        const r = await api.get('/api/hub?' + qs);
        const u = r.usage; const pct = Math.min(100, (u.used / Math.max(1, u.quota)) * 100);
        mount(usageEl, h('span', t('Your storage') + ': ' + mb(u.used) + ' / ' + mb(u.quota)), h('div.hb-ubar', h('i', { style: { width: pct + '%' } })));
        counts = Object.assign({}, r.counts || {}); counts.all = Object.values(r.counts || {}).reduce((a, b) => a + b, 0); cols = r.cols || []; paintChips();
        mount(tagsEl, r.tags && r.tags.length && KINDS_TAB.includes(mode) ? r.tags.map((x) => h('button.hb-tag' + (tag === x.t ? '.on' : ''), { type: 'button', onClick: () => { tag = tag === x.t ? '' : x.t; load(); } }, '#' + x.t, h('small', String(x.n)))) : null);
        const st = r.stats; mount(statsEl, st ? h('div.hb-stats', [[st.items, t('Uploads')], [st.views, t('Views')], [st.likes, t('Likes')], [st.comments, t('Comments')], [st.remixes, t('Remixes')]].map(([v, l]) => h('div', h('b', fmt.num(v)), h('span', l)))) : null);
        if (mode === 'history' && r.items.length) statsEl.append(h('button.btn.sm.ghost', { style: 'margin:-6px 0 10px', onClick: async () => { try { await api.del('/api/hub/history'); load(); } catch (e) { toastErr(e); } } }, icon('trash', 13), t('Clear history')));
        if (mode.startsWith('col:')) { const c = cols.find((x) => 'col:' + x.id === mode); if (c) statsEl.append(h('button.btn.sm.ghost', { style: 'margin:-6px 0 10px', onClick: async () => { if (!(await confirmBox(t('Delete the collection “{n}”? The uploads stay in the Hub.', { n: c.name })))) return; try { await api.del('/api/hub/collections/' + c.id); setMode('all'); } catch (e) { toastErr(e); } } }, icon('trash', 13), t('Delete collection'))); }
        const f = r.featured; mount(featEl, f && !q && !tag && mode === 'all' ? h('a.hb-feat', { href: '#/hub/' + f.id }, cover(f), h('div.hb-fi', h('span.hb-flabel', t('Most played this week')), h('h3', f.title), f.desc ? h('p', f.desc.slice(0, 180)) : null,
          h('span.hb-sub', '@' + (f.owner ? f.owner.username : '?') + ' · ' + t('{n} views', { n: fmt.compact(f.views) }) + ' · ' + t('{n} likes', { n: f.likes })))) : null);
        last = r.items; paintList();
      } catch (e) { mount(list, emptyState('alert', t('Could not load this'), e.message)); }
    }
    function paintList() {
      if (!last.length) { mount(list, emptyState('upload', t('Nothing here yet'), t('Be the first to upload something!'), h('button.btn.primary', { onClick: () => uploadDialog() }, t('Upload')))); return; }
      if (viewMode === 'grid') { list.className = 'hb-grid'; mount(list, last.map(card)); return; }
      list.className = 'hb-listwrap';
      mount(list, h('table.hb-table', h('thead', h('tr', h('th', t('Title')), h('th.hide-sm', t('Author')), h('th.hide-sm', t('Type')), h('th.num.hide-sm', t('Files')), h('th.num.hide-sm', t('Size')), h('th.num', t('Views')), h('th.num.hide-sm', t('Updated')))),
        h('tbody', last.map((it) => h('tr', { onClick: () => ctx.go('hub', it.id) }, h('td', h('div.hb-tt', cover(it), h('b', it.title), it.public ? null : h('span.hb-sub', '· ' + t('private')))), h('td.hide-sm', '@' + (it.owner ? it.owner.username : '?')), h('td.hide-sm', t(KIND_LABEL[it.kind])),
          h('td.num.hide-sm', it.files || '—'), h('td.num.hide-sm', mb(it.size || 0)), h('td.num', fmt.compact(it.views)), h('td.num.hide-sm', fmt.date(it.updated || it.created)))))));
    }
    function card(it) {
      return h('a.hb-card', { href: '#/hub/' + it.id }, cover(it),
        h('div.row', { style: 'gap:8px;align-items:flex-start' }, it.owner ? avatarEl(it.owner, { size: 30 }) : null, h('div.grow', { style: 'min-width:0' }, h('b.tube-title', it.title),
          h('div.hb-sub', '@' + (it.owner ? it.owner.username : '?') + ' · ' + t('{n} views', { n: fmt.compact(it.views) }) + (it.likes ? ' · ' + t('{n} likes', { n: it.likes }) : '') + (it.public ? '' : ' · ' + t('private'))), it.rating ? h('div.hb-cardr', starsEl(it.rating.avg, 12), h('span.tiny.muted', it.rating.avg.toFixed(1) + ' (' + it.rating.n + ')')) : null)));
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

    async function itemPage(id) {
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
        fr = h('iframe.hb-frame', { src: it.src, title: it.title, allow: 'cross-origin-isolated; fullscreen; autoplay; gamepad; clipboard-write; clipboard-read; screen-wake-lock; accelerometer; gyroscope; midi; encrypted-media; picture-in-picture; web-share; xr-spatial-tracking', allowfullscreen: '' });
        player = h('div.hb-player.game', fr);
      }
      else {
        fr = h('iframe.hb-frame', { src: it.src, title: it.title, sandbox: it.runMode === 'domain' ? 'allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-pointer-lock allow-downloads allow-orientation-lock allow-presentation' : null, allow: 'fullscreen; autoplay; gamepad; clipboard-write; clipboard-read; screen-wake-lock; accelerometer; gyroscope; picture-in-picture; web-share; xr-spatial-tracking', allowfullscreen: '' });
        // the game's saves arrive from the sandbox (see server/hubshim.js) and are kept on the player's account
        let saveT = 0; let pending = null;
        const onMsg = (e) => { if (!fr.isConnected) { removeEventListener('message', onMsg); return; } if (e.source !== fr.contentWindow || !e.data || e.data.nxHubSave !== 1) return; pending = { ls: e.data.ls || {}, ck: String(e.data.ck || '') }; clearTimeout(saveT); saveT = setTimeout(() => { const b = pending; pending = null; api.put(`/api/hub/${it.id}/gamesave`, b, { quiet: true }).catch(() => {}); }, 1500); };
        addEventListener('message', onMsg);
        player = h('div.hb-player.game', fr);
      }
      const tools = code && fr ? h('div.hb-tools', h('button.btn.sm', { onClick: () => { try { fr.requestFullscreen(); } catch {} } }, icon('fullscreen', 14), t('Fullscreen')), h('button.btn.sm', { onClick: () => { const s = fr.src; try { fr.contentWindow.location.replace(s); } catch { fr.src = s; } } }, icon('refresh', 14), t('Restart')),
        h('a.btn.sm', { href: it.src, target: '_blank', rel: 'noopener' }, icon('external', 14), t('Open in a new tab')),
        it.runMode === 'native' ? h('button.btn.sm', { onClick: () => { const w = Math.min(1600, screen.availWidth - 40), hh = Math.min(1000, screen.availHeight - 60); if (!window.open(it.src, 'nbx-game-' + it.id, `popup=yes,width=${w},height=${hh},left=${Math.round((screen.availWidth - w) / 2)},top=${Math.round((screen.availHeight - hh) / 2)}`)) window.open(it.src, '_blank'); } }, icon('window', 14), t('Own window')) : null, it.mine && it.sale ? h('button.btn.sm', { onClick: () => ctx.go('vault', 'sell') }, '🔷 ', it.sale.price ? t('Vault: {c} coins', { c: fmt.coins(it.sale.eff) }) : t('Sell in Nebula Vault')) : (it.sale && it.sale.price ? h('span.pill', '🔷 ' + t('Owned')) : null), h('span.grow'), h('span.tiny.muted', it.runMode === 'native' ? t('Runs natively, like a Chrome tab · cannot see your account') : it.runMode === 'domain' ? t('Runs like in Chrome on the games domain · cannot see your account') : t('Runs sandboxed · can load files from the internet'))) : null;
      const like = h('button.btn' + (it.liked ? '.primary' : ''), { onClick: (e) => busy(e.currentTarget, async () => { const r = await api.post(`/api/hub/${it.id}/like`); like.classList.toggle('primary', r.liked); like.lastChild.textContent = ' ' + r.likes; }) }, icon('heart', 15), ' ' + it.likes);
      let theater = false;
      const saveBtn = h('button.btn' + (it.saved ? '.primary' : ''), { onClick: (e) => busy(e.currentTarget, async () => { try { const r = await api.post(`/api/hub/${it.id}/save`); saveBtn.classList.toggle('primary', r.saved); saveBtn.lastChild.textContent = r.saved ? t('Saved') : t('Save'); } catch (er) { toastErr(er); } }) }, icon('bookmark', 15), it.saved ? t('Saved') : t('Save'));
      async function colMenu(anchor) {
        let r; try { r = await api.get('/api/hub/collections/of/' + it.id); } catch (e) { toastErr(e); return; }
        const ui = await import('../ui.js');
        ui.openMenu([...r.cols.map((c) => ({ label: c.name, icon: c.has ? 'check' : 'plus', onClick: async () => { try { const x = await api.post(`/api/hub/collections/${c.id}/toggle`, { item: it.id }); toast(x.on ? t('Added to “{n}”', { n: c.name }) : t('Removed from “{n}”', { n: c.name }), 'good'); } catch (e) { toastErr(e); } } })),
          { hr: true }, { label: t('New collection…'), icon: 'plus', onClick: async () => { const name = await promptBox(t('New collection'), { label: t('Name') }); if (!name) return; try { const c = await api.post('/api/hub/collections', { name }); await api.post(`/api/hub/collections/${c.col.id}/toggle`, { item: it.id }); toast(t('Added to “{n}”', { n: name }), 'good'); } catch (e) { toastErr(e); } } }], anchor);
      }
      // comments
      const cBox = h('div.hb-comments');
      async function loadComments() {
        let r; try { r = await api.get('/api/comments/' + it.id); } catch { mount(cBox); return; }
        const inp = h('textarea.input', { rows: 2, maxlength: 600, placeholder: t('Write a comment…') });
        const one = (c, isReply) => h('div.hb-cm' + (isReply ? '.reply' : ''), c.owner ? avatarEl(c.owner, { size: isReply ? 24 : 30 }) : null, h('div.grow', h('div.tiny', h('b', c.owner ? c.owner.displayName : '?'), h('span.muted', ' · ' + fmt.rel(c.created))), h('div.small', { style: 'white-space:pre-wrap' }, c.text)));
        mount(cBox, h('h3', { style: 'margin:14px 0 8px;font-size:1rem' }, t('Comments') + ' (' + r.total + ')'),
          h('div.row', { style: 'gap:8px;align-items:flex-start' }, inp, h('button.btn.primary', { onClick: (e) => busy(e.currentTarget, async () => { const text = inp.value.trim(); if (!text) return; try { await api.post('/api/comments/' + it.id, { text }); inp.value = ''; loadComments(); } catch (er) { toastErr(er); } }) }, t('Post'))),
          r.items.length ? r.items.map((c) => h('div', one(c), (c.replies || []).map((x) => one(x, true)))) : h('p.small.muted', t('No comments yet. Be the first!')));
      }
      // tabs under the player: info · files · versions
      let tab = 'info'; const tabBody = h('div');
      const tabs = code ? tabsEl([['info', t('Info'), 'info'], ['files', t('Files') + ' (' + it.files + ')', 'layers'], ['versions', t('Versions') + ' (v' + it.version + ')', 'clock']], tab, (v) => { tab = v; paintTab(); }) : null;
      async function paintTab() {
        if (tab === 'info') { mount(tabBody, h('div.card.tight.hb-desc', h('div.small.muted', t('{n} views', { n: fmt.num(it.views) }) + ' · ' + fmt.date(it.created) + (it.updated && it.updated !== it.created ? ' · ' + t('updated {d}', { d: fmt.date(it.updated) }) : '') + (it.tags.length ? ' · ' + it.tags.map((x) => '#' + x).join(' ') : '')), it.desc ? h('p.small', { style: 'white-space:pre-wrap' }, it.desc) : h('p.small.muted', t('No description.')))); return; }
        if (tab === 'files') {
          mount(tabBody, loading()); let f; try { f = await api.get(`/api/hub/${it.id}/files`); } catch (e) { mount(tabBody, h('p.small.muted', e.message)); return; }
          const viewer = h('pre.hb-src.hide');
          const base = (it.src || '').slice(0, (it.src || '').length - f.entry.split('/').map(encodeURIComponent).join('/').length);
          mount(tabBody, h('div.hb-files', h('div.hb-flist', f.files.map((x) => h('button.hb-frow' + (x.path === f.entry ? '.entry' : ''), { type: 'button', disabled: !TEXTY.test(x.path), title: TEXTY.test(x.path) ? t('View the code') : '', onClick: async () => {
            try { const res = await fetch(base + x.path.split('/').map(encodeURIComponent).join('/')); const txt = await res.text(); viewer.textContent = txt.length > 200000 ? txt.slice(0, 200000) + '\n…' : txt; viewer.classList.remove('hide'); viewer.scrollTop = 0; } catch (e) { toastErr(e); } } },
            h('span.tiny.muted', x.path === f.entry ? '▶' : TEXTY.test(x.path) ? '·' : '◦'), h('span.grow.ellipsis', x.path), h('span.tiny.muted', mb(x.size))))), viewer)); return;
        }
        mount(tabBody, h('div.card.tight', (it.versions || []).length ? it.versions.map((v) => h('div.hb-ver', h('b', 'v' + v.v), h('span.grow', v.note || t('No notes')), h('span.tiny.muted', fmt.date(v.at) + ' · ' + mb(v.size || 0)))) : h('p.small.muted', t('First version.')),
          it.mine ? h('button.btn.primary.sm', { style: 'margin-top:10px', onClick: () => newVersion() }, icon('upload', 14), t('Upload a new version')) : null));
      }
      async function newVersion() {
        let entries = []; const pk = picker((e) => { entries = e; }, '.html,.htm,.js,.mjs,.zip'); const note = h('input.input', { maxlength: 200, placeholder: t('What changed? (optional)') }); const status = h('div.tiny.muted');
        await modal({ title: t('New version of “{t}”', { t: it.title }), cls: 'wide', body: h('div.col.gap', pk.el, field(t('Notes'), note), status), actions: [{ label: t('Cancel'), value: false }, { label: t('Publish'), kind: 'primary', onClick: async (ev, m) => {
          if (!entries.length) { toast(t('Choose a file or a folder first'), 'err'); return false; } ev.currentTarget.disabled = true;
          try { const file = await packEntries(entries, (s) => { status.textContent = s; }); const up = await putFile(`/api/hub/upload?kind=${it.kind}&name=${encodeURIComponent(file.name)}`, file, (p) => { status.textContent = t('Uploading… {p}%', { p: Math.round(p * 100) }); });
            await api.post(`/api/hub/${it.id}/version`, { upload: up.upload, note: note.value }); toast(t('New version published'), 'good'); m.close(true); itemPage(it.id); } catch (e) { toastErr(e); ev.currentTarget.disabled = false; }
          return false; } }] });
      }
      async function changeCover() {
        const i = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', onChange: async () => { const f = i.files[0]; if (!f) return; try { const up = await putFile(`/api/hub/upload?kind=${it.kind}&thumb=1&name=${encodeURIComponent(f.name)}`, f); await api.post(`/api/hub/${it.id}/cover`, { thumb: up.upload }); toast(t('Cover updated'), 'good'); } catch (e) { toastErr(e); } } });
        i.click();
      }
      async function editInfo() {
        const ti = h('input.input', { maxlength: 90, value: it.title }); const de = h('textarea.input', { rows: 4, maxlength: 2000 }); de.value = it.desc || ''; const tg = h('input.input', { value: (it.tags || []).join(', ') }); let pub = it.public; const sw = switchEl(it.public, (v) => { pub = v; }); let rd = it.runMode || 'sandbox'; const swr = modePicker(rd, (v) => { rd = v; });
        const ok = await modal({ title: t('Edit'), body: h('div.col.gap', field(t('Title'), ti), field(t('Description'), de), field(t('Tags'), tg), h('div.row', h('span.grow', t('Public')), sw), code && it.gamesDomain ? field(t('How it runs'), swr) : null), actions: [{ label: t('Cancel'), value: false }, { label: t('Save'), kind: 'primary', value: true }] });
        if (!ok) return; try { await api.patch('/api/hub/' + it.id, { title: ti.value, desc: de.value, tags: tg.value.split(',').map((x) => x.trim()).filter(Boolean), public: pub, runMode: rd }); toast(t('Saved'), 'good'); itemPage(it.id); } catch (e) { toastErr(e); }
      }
      mount(inner, h('div.hb-watch', h('div.hb-main', h('button.btn.ghost.sm', { style: 'align-self:flex-start', onClick: () => ctx.go('hub') }, icon('back', 14), 'Nebulix Hub'), player, tools,
        h('h2.tube-h', it.title, it.version > 1 ? h('span.pill', { style: 'margin-left:8px;font-size:.7rem' }, 'v' + it.version) : null),
        h('div.row.wrap', { style: 'gap:10px;align-items:center' }, it.owner ? h('a.row', { href: '#/profile/' + it.owner.username, style: 'gap:8px;align-items:center;text-decoration:none;color:inherit' }, avatarEl(it.owner, { size: 34 }), h('b', '@' + it.owner.username)) : null, h('span.grow'), like,
          it.kind === 'wall' ? h('button.btn.primary', { onClick: async (e) => busy(e.currentTarget, async () => { try { const { setLiveBg } = await import('../livebg.js'); await setLiveBg({ id: it.id }); toast(t('Background applied. Adjust it in Appearance.'), 'good'); } catch (er) { toastErr(er); } }) }, icon('image', 15), t('Use as background')) : null,
          saveBtn, h('button.btn', { title: t('Add to a collection'), onClick: (e) => colMenu(e.currentTarget) }, icon('layers', 15), t('Collection')),
          h('button.btn', { onClick: (e) => import('../ui.js').then((ui) => ui.openMenu([
            { label: t('Copy link'), icon: 'link', onClick: async () => { try { await navigator.clipboard.writeText(location.origin + '/#/hub/' + it.id); toast(t('Link copied'), 'good'); } catch {} } },
            code ? { label: t('Copy embed code'), icon: 'copy', onClick: async () => { try { await navigator.clipboard.writeText(`<iframe src="${/^https?:/.test(it.src) ? it.src : location.origin + it.src}" width="960" height="540" style="border:0" allow="fullscreen; autoplay; gamepad" allowfullscreen></iframe>`); toast(t('Embed code copied'), 'good'); } catch {} } } : null,
            it.allowDownload || it.mine ? { label: t('Download'), icon: 'download', onClick: () => { const a = document.createElement('a'); a.href = `/x/hub/dl/${it.id}`; a.download = ''; document.body.append(a); a.click(); a.remove(); } } : null,
            (it.allowRemix || it.mine) && it.files ? { label: t('Remix (copy it to your uploads)'), icon: 'refresh', onClick: async () => { try { const r = await api.post(`/api/hub/${it.id}/remix`); toast(t('Remix created as a private draft'), 'good'); ctx.go('hub', r.item.id); } catch (er) { toastErr(er); } } } : null,
            code && it.files ? { label: t('Delete my saved game'), icon: 'trash', onClick: async () => { if (!(await confirmBox(t('Delete your saved progress in “{t}”?', { t: it.title }), { danger: true }))) return; try { await api.del(`/api/hub/${it.id}/gamesave`); toast(t('Saved game deleted'), 'good'); itemPage(it.id); } catch (er) { toastErr(er); } } } : null,
            code ? { label: theater ? t('Normal view') : t('Theater mode'), icon: 'fullscreen', onClick: () => { theater = !theater; inner.querySelector('.hb-watch').classList.toggle('theater', theater); } } : null,
            !it.mine ? { hr: true } : null,
            !it.mine ? { label: t('Report'), icon: 'flag', danger: true, onClick: async () => { const reason = await promptBox(t('Report “{t}”', { t: it.title }), { label: t('What is wrong?'), multiline: true }); if (!reason || reason.trim().length < 3) return; try { await api.post('/api/reports', { type: 'hub', target: it.id, reason }); toast(t('Thanks — the moderators will review it.'), 'good'); } catch (er) { toastErr(er); } } } : null,
          ].filter(Boolean), e.currentTarget)) }, icon('more', 15), t('More')),
          it.mine ? h('button.btn', { onClick: editInfo }, icon('edit', 15), t('Edit')) : null,
          it.mine && code ? h('button.btn', { onClick: changeCover }, icon('image', 15), t('Cover')) : null,
          !it.mine && ['owner', 'admin', 'mod'].includes(S.me.role) ? h('button.btn.danger', { onClick: async () => { const reason = await promptBox(t('Remove “{t}”', { t: it.title }), { label: t('Reason (the author will see it)') }); if (reason === null) return; try { await api.del(`/api/admin/content/hub/${it.id}?reason=${encodeURIComponent(reason)}`); toast(t('Removed'), 'good'); ctx.go('hub'); } catch (e) { toastErr(e); } } }, icon('shield', 15), t('Remove')) : null,
          it.mine && code ? h('button.btn', { onClick: () => newVersion() }, icon('upload', 15), t('New version')) : null,
          it.mine ? h('button.btn.ghost', { 'aria-label': t('Delete'), onClick: async () => { if (!(await confirmBox(t('Delete “{t}”?', { t: it.title }), { danger: true }))) return; try { await api.del('/api/hub/' + it.id); ctx.go('hub'); } catch (e) { toastErr(e); } } }, icon('trash', 15)) : null),
        tabs, tabBody, it.remixOf ? h('p.tiny.muted', t('Remix of'), ' ', h('a', { href: '#/hub/' + it.remixOf }, t('the original'))) : null, cBox),
        h('div.hb-side', h('div.hb-flabel', t('More like this')), d.more.map((m) => h('a.hb-mini', { href: '#/hub/' + m.id }, cover(m), h('div', h('b.tube-title', m.title), h('div.tiny.muted', '@' + (m.owner ? m.owner.username : '?') + ' · ' + t('{n} views', { n: fmt.compact(m.views) }))))))));
      paintTab(); void loadComments;
      const extra = h('div.hb-extra'); const paintExtra = () => mount(extra, X.shotsPanel(it, paintExtra), X.clipsPanel(it, { frame: fr }), X.reviewsPanel(it), X.hubComments(it)); paintExtra(); cBox.replaceWith(extra);
    }
    return () => {};
  },
};
