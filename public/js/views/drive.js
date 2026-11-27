// Nebulix Drive: your files in the cloud + Docs, Sheets and Slides. #/drive · #/drive/<folderId> · ?view=recent|starred|shared|trash
import { h, mount, fmt, ls } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { toast, toastErr, loading, emptyState, promptBox, confirmBox, openMenu, modal } from '../ui.js';

export const KIND = { folder: ['📁', 'Folder', '#f5b84a'], doc: ['📄', 'Document', '#3b82f6'], sheet: ['📊', 'Spreadsheet', '#22c55e'], slides: ['📽️', 'Presentation', '#f59e0b'], file: ['📎', 'File', '#94a3b8'] };
const size = (n) => (!n ? '' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
// coloured file badges (an SVG icon on a tinted tile) instead of emoji
const BADGE = { folder: ['layers', '#f5b84a'], doc: ['note', '#3b82f6'], sheet: ['grid', '#22c55e'], slides: ['monitor', '#f59e0b'], image: ['image', '#a855f7'], video: ['play', '#ef4444'], audio: ['music', '#ff7043'], pdf: ['book', '#dc2626'], zip: ['cube', '#8d6e63'], file: ['clip', '#90a4ae'] };
const badgeKey = (it) => { if (it.kind !== 'file') return it.kind; const ty = it.type || ''; return ty.startsWith('image/') ? 'image' : ty.startsWith('video/') ? 'video' : ty.startsWith('audio/') ? 'audio' : ty === 'application/pdf' ? 'pdf' : /zip/.test(ty) ? 'zip' : 'file'; };
export const badge = (it, sz = 18) => { const [ic, c] = BADGE[badgeKey(it)] || BADGE.file; return h('span.dv-badge', { style: '--kc:' + c }, icon(ic, sz)); };
const fileIcon = (it) => { if (it.kind !== 'file') return KIND[it.kind][0]; const ty = it.type || ''; return ty.startsWith('image/') ? '🖼️' : ty.startsWith('video/') ? '🎬' : ty.startsWith('audio/') ? '🎵' : ty === 'application/pdf' ? '📕' : /zip/.test(ty) ? '🗜️' : '📎'; };
export const openItem = (go, it) => (it.kind === 'folder' ? go('drive', it.id) : it.kind === 'file' ? null : go(it.kind === 'doc' ? 'docs' : it.kind === 'sheet' ? 'sheets' : 'slides', it.id));
function putFile(url, file, onProgress) {
  return new Promise((resolve, reject) => { const x = new XMLHttpRequest(); x.open('PUT', url); x.setRequestHeader('Content-Type', 'application/octet-stream'); x.responseType = 'json'; x.upload.onprogress = (e) => e.lengthComputable && onProgress && onProgress(e.loaded / e.total); x.onload = () => (x.status < 300 ? resolve(x.response) : reject(new Error((x.response && x.response.message) || 'Upload failed'))); x.onerror = () => reject(new Error('Network error')); x.send(file); });
}

export default {
  title: () => 'Nebulix Drive',
  async mount(root, ctx) {
    const folder = ctx.params[0] || null; const view = ctx.query.get('view') || 'files';
    let layout = ls('drive.layout') || 'grid';
    const inner = h('div.dv'); mount(root, inner);
    const navBtn = (v, ic, label) => h('a.dv-nav' + (view === v && !(v === 'files' && folder && view !== 'files') ? '.on' : ''), { href: v === 'files' ? '#/drive' : '#/drive?view=' + v }, icon(ic, 17), label);
    let filter = ''; let sort = ls('drive.sort') || 'modified';
    const usage = h('div.dv-usage');
    const newBtn = h('button.btn.primary.dv-new', { onClick: (e) => openMenu([
      { label: t('New folder'), icon: 'layers', onClick: () => create('folder') }, { hr: true },
      { label: t('Document'), icon: 'note', onClick: () => create('doc') }, { label: t('Spreadsheet'), icon: 'grid', onClick: () => create('sheet') }, { label: t('Presentation'), icon: 'monitor', onClick: () => create('slides') }, { hr: true },
      { label: t('Upload files'), icon: 'upload', onClick: () => pick(false) }, { label: t('Upload folder'), icon: 'upload', onClick: () => pick(true) }], e.currentTarget) }, icon('plus', 18), t('New'));
    const side = h('aside.dv-side', newBtn, navBtn('files', 'home', t('My Drive')), navBtn('recent', 'clock', t('Recent')), navBtn('starred', 'star', t('Starred')), navBtn('shared', 'users', t('Shared with me')), navBtn('trash', 'trash', t('Trash')), usage,
      h('div.dv-apps', h('div.eyebrow', t('Apps')), h('a', { href: '#/docs' }, badge({ kind: 'doc' }, 14), 'Docs'), h('a', { href: '#/sheets' }, badge({ kind: 'sheet' }, 14), 'Sheets'), h('a', { href: '#/slides' }, badge({ kind: 'slides' }, 14), 'Slides')));
    const body = h('section.dv-body'); const progress = h('div.dv-up');
    mount(inner, side, h('div.dv-mainwrap', body, progress));
    // drag & drop upload
    inner.addEventListener('dragover', (e) => { e.preventDefault(); inner.classList.add('drop'); });
    inner.addEventListener('dragleave', (e) => { if (e.target === inner) inner.classList.remove('drop'); });
    inner.addEventListener('drop', (e) => { e.preventDefault(); inner.classList.remove('drop'); upload([...e.dataTransfer.files]); });

    async function load() {
      mount(body, loading());
      let d; try { d = await api.get(`/api/drive/list?view=${view}${folder ? '&parent=' + folder : ''}`); } catch (e) { mount(body, emptyState('alert', t('Could not load this'), e.message)); return; }
      const pct = Math.min(100, (d.usage.used / d.usage.quota) * 100);
      mount(usage, h('div.dv-usetitle', icon('layers', 14), t('Storage')), h('div.hb-prog', h('i', { style: `width:${pct}%` })), h('div.tiny.muted', t('{a} of {b} used', { a: size(d.usage.used) || '0 KB', b: size(d.usage.quota) })), h('a.btn.sm.dv-more-st', { href: '#/perks' }, t('Get more storage')));
      const title = view === 'files' ? h('div.dv-crumbs', h('a', { href: '#/drive' }, t('My Drive')), d.crumbs.map((c) => [' › ', h('a', { href: '#/drive/' + c.id }, c.name)])) : h('h2', { recent: t('Recent'), starred: t('Starred'), shared: t('Shared with me'), trash: t('Trash') }[view]);
      const search = h('input.input.dv-search', { placeholder: t('Search in Drive'), value: filter, onInput: (e) => { filter = e.target.value.toLowerCase(); paintItems(); } });
      const sortSel = h('select.select.sm.dv-sort', { onChange: (e) => { sort = e.target.value; ls('drive.sort', sort); paintItems(); } }, [['modified', t('Last modified')], ['name', t('Name')], ['size', t('Size')]].map(([v, l]) => h('option', { value: v, selected: v === sort }, l)));
      const tools = h('div.row', { style: 'gap:6px' }, sortSel, view === 'trash' && d.items.length ? h('button.btn.sm.danger', { onClick: async () => { if (!(await confirmBox(t('Delete everything in the trash forever?'), { danger: true }))) return; await api.post('/api/drive/trash/empty'); load(); } }, t('Empty trash')) : null,
        h('button.btn.sm.ghost', { title: t('Layout'), onClick: () => { layout = layout === 'grid' ? 'list' : 'grid'; ls('drive.layout', layout); load(); } }, icon(layout === 'grid' ? 'menu' : 'grid', 16)));
      const empty = emptyState('upload', view === 'trash' ? t('The trash is empty') : t('Nothing here yet'), view === 'files' ? t('Drop files here or press New.') : '');
      const holder = h('div');
      const quick = view === 'files' && !folder ? d.items.filter((x) => x.kind !== 'folder').sort((a, b) => b.updated - a.updated).slice(0, 4) : [];
      function paintItems() {
        let list = d.items.filter((x) => !filter || x.name.toLowerCase().includes(filter));
        list = list.slice().sort((a, b) => (a.kind === 'folder') !== (b.kind === 'folder') ? (a.kind === 'folder' ? -1 : 1) : sort === 'name' ? a.name.localeCompare(b.name) : sort === 'size' ? (b.size || 0) - (a.size || 0) : b.updated - a.updated);
        const folders = list.filter((x) => x.kind === 'folder'); const files = list.filter((x) => x.kind !== 'folder');
        if (!list.length) return mount(holder, filter ? emptyState('search', t('No results')) : empty);
        if (layout === 'list') return mount(holder, h('div.dv-items.list', h('div.dv-lhead', h('span', t('Name')), h('span', t('Owner')), h('span', t('Last modified')), h('span', t('Size'))), list.map(itemEl)));
        mount(holder, folders.length ? [h('div.dv-sec', t('Folders')), h('div.dv-folders', folders.map(itemEl))] : null, files.length ? [h('div.dv-sec', t('Files')), h('div.dv-items.grid', files.map(itemEl))] : null);
      }
      paintItems();
      mount(body, h('div.dv-searchrow', icon('search', 18), search), h('div.dv-top', title, h('div.grow'), tools),
        quick.length && !filter ? h('div.dv-quick', h('div.dv-sec', t('Suggested')), h('div.dv-qrow', quick.map((it) => h('button.dv-q', { onClick: () => open(it) }, h('div.dv-qprev', { style: '--kc:' + (BADGE[badgeKey(it)] || BADGE.file)[1] }, it.kind === 'file' && /^image\//.test(it.type || '') ? h('img', { src: it.url, alt: '', loading: 'lazy' }) : badge(it, 30)), h('div.dv-qmeta', badge(it, 14), h('b.ellipsis', it.name)), h('div.tiny.muted', t('Edited {t}', { t: fmt.rel(it.updated) })))))) : null,
        holder);
    }
    function itemEl(it) {
      const thumb = it.kind === 'file' && /^image\//.test(it.type || '') ? h('img', { src: it.url, alt: '', loading: 'lazy' }) : badge(it, it.kind === 'folder' ? 18 : 34);
      const el = h('div.dv-item' + (it.kind === 'folder' ? '.folder' : ''), { tabindex: 0, onDblclick: () => open(it), onKeydown: (e) => { if (e.key === 'Enter') open(it); }, onClick: (e) => { if (matchMedia('(pointer: coarse)').matches) open(it); }, onContextmenu: (e) => { e.preventDefault(); menu(it, e); } },
        it.kind === 'folder' ? null : h('div.dv-thumb', { style: '--kc:' + (BADGE[badgeKey(it)] || BADGE.file)[1] }, thumb), h('div.dv-meta', h('div.dv-nrow', it.kind === 'folder' || layout === 'list' ? badge(it, 15) : badge(it, 13), h('b.ellipsis', it.name), it.starred ? h('span.dv-star', icon('star', 12)) : null, it.share !== 'private' ? h('span.dv-shared', { title: t('Shared') }, icon('users', 12)) : null),
          layout === 'list' ? [h('span.tiny.muted.dv-col', it.mine ? t('me') : '@' + (it.owner || {}).username), h('span.tiny.muted.dv-col', fmt.rel(it.updated)), h('span.tiny.muted.dv-col', size(it.size) || '—')] : h('span.tiny.muted', [it.mine ? '' : '@' + (it.owner || {}).username, size(it.size), fmt.rel(it.updated)].filter(Boolean).join(' · '))),
        h('button.st-ib.dv-more', { onClick: (e) => { e.stopPropagation(); menu(it, e); } }, icon('more', 16)));
      return el;
    }
    function open(it) {
      if (it.trashed) return; if (it.kind !== 'file') return openItem(ctx.go, it);
      const ty = it.type || ''; let pv;
      if (ty.startsWith('image/')) pv = h('img.dv-pv', { src: it.url, alt: it.name });
      else if (ty.startsWith('video/')) pv = h('video.dv-pv', { src: it.url, controls: true, autoplay: true });
      else if (ty.startsWith('audio/')) pv = h('audio', { src: it.url, controls: true, autoplay: true });
      else if (ty === 'application/pdf') pv = h('iframe.dv-pdf', { src: it.url, title: it.name });
      else if (/\.(glb|gltf|stl|obj)$/i.test(it.name || '')) return ctx.go('model3d', { src: it.url, name: it.name });
      else { window.open(it.url + '?dl=1', '_blank', 'noopener'); return; }
      modal({ title: it.name, cls: 'wide', body: h('div.dv-pvwrap', pv), actions: [{ label: t('Download'), onClick: () => { window.open(it.url + '?dl=1', '_blank', 'noopener'); return false; } }, { label: t('Close'), kind: 'primary', value: true }] });
    }
    function anchorAt(e) { return e.currentTarget && e.currentTarget.getBoundingClientRect ? e.currentTarget : { getBoundingClientRect: () => ({ left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY, width: 0, height: 0 }) }; }
    function menu(it, e) {
      const put = async (b, msg) => { try { await api.put('/api/drive/item/' + it.id, b); if (msg) toast(msg, 'good', 1600); load(); } catch (er) { toastErr(er); } };
      const items = it.trashed ? [{ label: t('Restore'), icon: 'refresh', onClick: () => put({ trashed: false }, t('Restored')) }, { label: t('Delete forever'), icon: 'trash', danger: true, onClick: async () => { if (await confirmBox(t('Delete “{n}” forever?', { n: it.name }), { danger: true })) { await api.del('/api/drive/item/' + it.id); load(); } } }] : [
        { label: t('Open'), icon: 'external', onClick: () => open(it) },
        it.kind === 'file' ? { label: t('Download'), icon: 'download', onClick: () => window.open(it.url + '?dl=1', '_blank', 'noopener') } : null,
        it.mine ? { label: t('Rename'), icon: 'edit', onClick: async () => { const n = await promptBox(t('Rename'), { value: it.name }); if (n) put({ name: n }); } } : null,
        it.mine ? { label: it.starred ? t('Remove star') : t('Add star'), icon: 'star', onClick: () => put({ starred: !it.starred }) } : null,
        it.mine && it.kind !== 'folder' ? { label: t('Share…'), icon: 'link', onClick: () => share(it) } : null,
        it.mine ? { label: t('Move to…'), icon: 'layers', onClick: () => move(it) } : null,
        it.mine ? { label: t('Move to trash'), icon: 'trash', danger: true, onClick: () => put({ trashed: true }, t('Moved to trash')) } : null].filter(Boolean);
      openMenu(items, anchorAt(e));
    }
    async function share(it) {
      const link = location.origin + '/#/' + ({ doc: 'docs', sheet: 'sheets', slides: 'slides', file: 'drive' }[it.kind]) + '/' + it.id;
      const v = await modal({ title: t('Share “{n}”', { n: it.name }), cls: 'narrow', body: h('div.col.gap', h('p.small.muted', t('People with the link must be signed in to Nebulix.')), h('input.input', { value: link, readonly: true, onFocus: (e) => e.target.select() })),
        actions: [{ label: t('Private'), value: 'private' }, { label: t('Anyone with the link can view'), value: 'link' }, ...(it.kind !== 'file' ? [{ label: t('Anyone with the link can edit'), kind: 'primary', value: 'edit' }] : [])] });
      if (!v) return; try { await api.put('/api/drive/item/' + it.id, { share: v }); if (v !== 'private') { try { await navigator.clipboard.writeText(link); } catch {} toast(t('Link copied'), 'good'); } load(); } catch (e) { toastErr(e); }
    }
    async function move(it) {
      const all = await api.get('/api/drive/list?view=files'); const folders = all.items.filter((x) => x.kind === 'folder' && x.id !== it.id);
      const sel = h('select.select', h('option', { value: '' }, t('My Drive')), folders.map((f) => h('option', { value: f.id }, f.name)));
      const ok = await modal({ title: t('Move to…'), cls: 'narrow', body: sel, actions: [{ label: t('Cancel'), value: false }, { label: t('Move'), kind: 'primary', value: true }] });
      if (ok) { try { await api.put('/api/drive/item/' + it.id, { parent: sel.value || null }); load(); } catch (e) { toastErr(e); } }
    }
    async function create(kind) {
      const name = kind === 'folder' ? await promptBox(t('New folder'), { value: t('New folder') }) : null; if (kind === 'folder' && !name) return;
      try { const r = await api.post('/api/drive', { kind, name, parent: view === 'files' ? folder : null }); if (kind === 'folder') load(); else openItem(ctx.go, r.item); } catch (e) { toastErr(e); }
    }
    function pick(dir) { const inp = h('input', { type: 'file', multiple: true, webkitdirectory: dir || null }); inp.onchange = () => upload([...inp.files]); inp.click(); }
    async function upload(files) {
      if (!files.length) return;
      for (const f of files) {
        const row = h('div.dv-uprow', h('span.ellipsis', f.name), h('div.hb-prog', h('i'))); progress.append(row);
        try { await putFile(`/api/drive/upload?name=${encodeURIComponent(f.name)}${view === 'files' && folder ? '&parent=' + folder : ''}`, f, (p) => { row.lastChild.firstChild.style.width = Math.round(p * 100) + '%'; }); row.classList.add('ok'); }
        catch (e) { row.classList.add('err'); toastErr(e); }
        setTimeout(() => row.remove(), 2500);
      }
      load();
    }
    load();
    return () => {};
  },
};
