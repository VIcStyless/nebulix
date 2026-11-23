// Shared bits for Nebulix Docs / Sheets / Slides: the app home (recent files + templates), the title bar with
// rename + share + autosave state, and an HTML sanitiser for document content (DOMParser never runs scripts).
import { h, mount, fmt } from './util.js';
import { t } from './i18n.js';
import { api } from './api.js';
import { icon } from './icons.js';
import { toast, toastErr, loading, emptyState, modal } from './ui.js';
import { S } from './state.js';
import { avatarEl } from './cosmetics.js';
const APP = { doc: ['note', '#3b82f6', 'Docs'], sheet: ['grid', '#22c55e', 'Sheets'], slides: ['monitor', '#f59e0b', 'Slides'] };
export const appTile = (kind, sz = 20) => { const [ic, c] = APP[kind] || APP.doc; return h('span.of-tile', { style: '--oc:' + c }, icon(ic, sz)); };

export function officeHome(root, ctx, { kind, route, name, emoji, color, templates }) {
  const wrap = h('div.inner.of-home'); mount(root, wrap, loading());
  const make = async (data, title) => { try { const r = await api.post('/api/drive', { kind, name: title }); if (data) await api.put('/api/drive/item/' + r.item.id, { data }); ctx.go(route, r.item.id); } catch (e) { toastErr(e); } };
  api.get('/api/drive/list?view=recent').then((d) => {
    const mine = d.items.filter((x) => x.kind === kind);
    mount(wrap, h('div.of-hero', { style: '--oc:' + color }, appTile(kind, 30), h('div.grow', h('h2', name), h('p.muted', t('Saved automatically in your Nebulix Drive. Share a link to work together.'))), h('a.btn', { href: '#/drive' }, icon('layers', 15), 'Drive')),
      h('div.of-tpl', { style: '--oc:' + color }, h('div.of-tplh', h('b', t('Start a new one')), h('span.tiny.muted', t('Template gallery'))), h('div.of-tpls', templates.map(([label, data, prev]) => h('button.of-t.' + kind, { type: 'button', onClick: () => make(data && data(), label) }, h('div.of-tprev', { style: '--oc:' + color }, h('div.of-tfake', h('i'), h('i'), h('i'), h('i')), prev ? h('span.of-temoji', prev) : h('span.of-tplus', icon('plus', 34))), h('span.small', label))))),
      h('div.eyebrow', { style: 'margin-top:18px' }, t('Recent')),
      mine.length ? h('div.of-recent', mine.map((x) => h('a.of-r', { href: `#/${route}/${x.id}` }, h('div.of-rprev', { style: '--oc:' + color }, h('div.of-tfake', h('i'), h('i'), h('i'))), h('span.of-ri', appTile(kind, 14)), h('div', h('b.ellipsis', x.name), h('div.tiny.muted', fmt.rel(x.updated) + (x.share !== 'private' ? ' · 🔗' : '')))))) : emptyState('note', t('Nothing here yet'), t('Pick a template above to start.')));
  }).catch((e) => mount(wrap, emptyState('alert', t('Could not load this'), e.message)));
  return () => {};
}

// Title bar: app icon, editable name, save state, share button, back to Drive.
export function officeBar(it, { emoji, onRename, extra }) {
  const nameIn = h('input.of-name', { value: it.name, readonly: !it.canEdit, onChange: (e) => onRename(e.target.value.trim() || it.name), onKeydown: (e) => { if (e.key === 'Enter') e.target.blur(); } });
  const state = h('span.of-state.tiny.muted', it.canEdit ? t('All changes saved') : t('View only'));
  const share = it.mine ? h('button.btn.sm.primary', { onClick: () => shareDialog(it) }, icon('link', 14), t('Share')) : null;
  const kind = it.kind || 'doc';
  const bar = h('div.of-bar', { style: '--oc:' + (APP[kind] || APP.doc)[1] }, h('a.of-logo', { href: '#/' + ({ doc: 'docs', sheet: 'sheets', slides: 'slides' }[kind] || 'drive'), title: (APP[kind] || APP.doc)[2] }, appTile(kind, 22)), h('div.of-tt', nameIn, h('div.of-sub', h('a.tiny', { href: '#/drive' }, icon('layers', 11), ' Drive'), state)), h('div.grow'), extra || null, share, S.me ? h('span.of-me', avatarEl(S.me, { size: 30, frame: false })) : null);
  void emoji;
  bar.saving = () => { state.textContent = t('Saving…'); };
  bar.saved = () => { state.textContent = t('All changes saved'); };
  bar.failed = () => { state.textContent = t('Not saved — retrying…'); };
  return bar;
}
async function shareDialog(it) {
  const route = { doc: 'docs', sheet: 'sheets', slides: 'slides' }[it.kind]; const link = location.origin + '/#/' + route + '/' + it.id;
  const v = await modal({ title: t('Share “{n}”', { n: it.name }), cls: 'narrow', body: h('div.col.gap', h('p.small.muted', t('People with the link must be signed in to Nebulix.')), h('input.input', { value: link, readonly: true, onFocus: (e) => e.target.select() })),
    actions: [{ label: t('Private'), value: 'private' }, { label: t('Can view'), value: 'link' }, { label: t('Can edit'), kind: 'primary', value: 'edit' }] });
  if (!v) return; try { await api.put('/api/drive/item/' + it.id, { share: v }); it.share = v; if (v !== 'private') { try { await navigator.clipboard.writeText(link); } catch {} toast(t('Link copied'), 'good'); } else toast(t('Now private'), 'good'); } catch (e) { toastErr(e); }
}
// Debounced saver: save(data) → PUT; retries on failure.
export function autosaver(id, bar, delay = 900) {
  let tm = 0; let pending = null; let busy = false;
  const flush = async () => { if (!pending || busy) return; const data = pending; pending = null; busy = true; bar.saving();
    try { await api.put('/api/drive/item/' + id, { data }, { quiet: true }); bar.saved(); } catch { pending = pending || data; bar.failed(); setTimeout(flush, 3000); } finally { busy = false; if (pending) flush(); } };
  const fn = (data) => { pending = data; clearTimeout(tm); tm = setTimeout(flush, delay); bar.saving(); };
  fn.flush = () => { clearTimeout(tm); return flush(); };
  return fn;
}

// ---------- sanitiser ----------
const TAGS = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'H1', 'H2', 'H3', 'H4', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'CODE', 'A', 'SPAN', 'DIV', 'HR', 'IMG', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'SUB', 'SUP', 'FONT', 'MARK']);
const STYLE = /^(color|background-color|text-align|font-size|font-family|font-weight|font-style|text-decoration|margin-left|padding-left)\s*:\s*[#(),.%\w\s-]{1,60}$/i;
export function sanitize(html) {
  const doc = new DOMParser().parseFromString('<body>' + String(html || '') + '</body>', 'text/html');
  const walk = (node) => {
    for (const el of [...node.children]) {
      if (!TAGS.has(el.tagName)) { if (/^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|LINK|META|svg|SVG|MATH|TEMPLATE|NOSCRIPT|FORM|INPUT|BUTTON|TEXTAREA|SELECT)$/.test(el.tagName)) el.remove(); else { walk(el); el.replaceWith(...el.childNodes); } continue; }
      for (const a of [...el.attributes]) {
        const n = a.name.toLowerCase(); let keep = false;
        if (n === 'href' && el.tagName === 'A') keep = /^(https?:|mailto:|#\/)/i.test(a.value.trim());
        else if (n === 'src' && el.tagName === 'IMG') keep = /^(https:|data:image\/(png|jpeg|gif|webp);base64,|\/x\/drive\/)/i.test(a.value.trim());
        else if (n === 'style') { const ok = a.value.split(';').map((x) => x.trim()).filter((x) => STYLE.test(x) && !/url|expression/i.test(x)); if (ok.length) { el.setAttribute('style', ok.join('; ')); continue; } }
        else if ((n === 'color' || n === 'face' || n === 'size') && el.tagName === 'FONT') keep = /^[#\w\s,-]{1,40}$/.test(a.value);
        else if (n === 'colspan' || n === 'rowspan') keep = /^\d{1,2}$/.test(a.value);
        else if (n === 'alt' || n === 'title') keep = true;
        if (!keep) el.removeAttribute(a.name);
      }
      if (el.tagName === 'A') { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); }
      walk(el);
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}
