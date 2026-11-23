// Notes: private notes with autosave, pinning, search, a small Markdown preview and clickable checklists.
import { h, mount, fmt, debounce, escapeHtml } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { toastErr, confirmBox, emptyState, segEl } from '../ui.js';
import { sendToFriend } from '../share.js';

// Minimal, safe Markdown: everything is escaped first; only a few constructs are re-enabled.
function md(src) {
  const lines = escapeHtml(src).split('\n'); const out = []; let list = null;
  const inline = (s) => s.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|\s)\*([^*]+)\*/g, '$1<i>$2</i>').replace(/~~([^~]+)~~/g, '<s>$1</s>');
  const close = () => { if (list) { out.push('</ul>'); list = null; } };
  lines.forEach((l, i) => {
    let m;
    if ((m = /^(#{1,3})\s+(.*)$/.exec(l))) { close(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); }
    else if ((m = /^\s*[-*]\s+\[( |x)\]\s+(.*)$/i.exec(l))) { if (!list) { out.push('<ul>'); list = 1; } out.push(`<li class="todo"><label><input type="checkbox" data-line="${i}"${m[1].toLowerCase() === 'x' ? ' checked' : ''}>${inline(m[2])}</label></li>`); }
    else if ((m = /^\s*[-*]\s+(.*)$/.exec(l))) { if (!list) { out.push('<ul>'); list = 1; } out.push(`<li>${inline(m[1])}</li>`); }
    else if (/^\s*---\s*$/.test(l)) { close(); out.push('<hr>'); }
    else if (!l.trim()) { close(); out.push('<br>'); }
    else { close(); out.push(`<p>${inline(l)}</p>`); }
  });
  close(); return out.join('');
}

export default {
  title: () => t('Notes'), full: true,
  async mount(root) {
    let notes = []; let cur = null; let q = ''; let mode = 'write'; let dirty = false;
    const list = h('div.nl'); const search = h('input.input', { type: 'search', placeholder: t('Search notes'), onInput: (e) => { q = e.target.value.toLowerCase(); paintList(); } });
    const side = h('aside.notes-side', h('div.row', { style: 'padding:12px 12px 6px' }, h('h3.grow', { style: 'margin:0' }, t('Notes')), h('button.btn.primary.sm', { onClick: create }, icon('plus', 14), t('New'))), h('div', { style: 'padding:0 12px 6px' }, search), list);
    const ed = h('section.note-ed');
    const wrap = h('div.notes', side, ed);
    mount(root, wrap);

    async function load() { try { notes = (await api.get('/api/notes')).notes; } catch (e) { toastErr(e); } paintList(); if (!cur && notes.length && innerWidth > 760) open(sorted()[0].id); else if (!cur) paintEd(); }
    const sorted = () => notes.slice().sort((a, b) => (b.pinned - a.pinned) || (b.updated - a.updated));
    function paintList() {
      const rows = sorted().filter((n) => !q || (n.title + ' ' + n.preview).toLowerCase().includes(q));
      mount(list, rows.length ? rows.map((n) => h('button.note-item' + (cur && cur.id === n.id ? '.on' : ''), { onClick: () => open(n.id) },
        h('b', (n.pinned ? '· ' : '') + (n.title || t('Untitled'))), h('span', fmt.rel(n.updated) + (n.preview ? ' — ' + n.preview.replace(/\s+/g, ' ') : '')))) : h('div.tiny.muted', { style: 'padding:10px' }, q ? t('No matches') : t('No notes yet')));
    }
    async function open(id) {
      await flush();
      try { cur = (await api.get('/api/notes/' + id)).note; } catch (e) { toastErr(e); return; }
      wrap.classList.add('ed-open'); paintList(); paintEd();
    }
    const saved = h('span.saved');
    function paintEd() {
      if (!cur) { mount(ed, h('div', { style: 'margin:auto' }, emptyState('note', t('Your private notes'), t('Strategies, builds, codes, to-do lists. Markdown and - [ ] checklists work.'), h('button.btn.primary', { onClick: create }, t('New note'))))); return; }
      const title = h('input.note-title', { value: cur.title, placeholder: t('Untitled'), maxlength: 120, onInput: () => { cur.title = title.value; touch(); } });
      const body = h('textarea.note-body', { placeholder: t('Start writing…'), onInput: () => { cur.body = body.value; touch(); } }); body.value = cur.body;
      const prev = h('div.note-prev');
      const seg = segEl([['write', t('Write')], ['read', t('Preview')]], mode, (v) => { mode = v; show(); });
      function show() { body.style.display = mode === 'write' ? '' : 'none'; prev.style.display = mode === 'read' ? '' : 'none'; if (mode === 'read') prev.innerHTML = md(cur.body); }
      prev.addEventListener('change', (e) => { const cb = e.target.closest('input[data-line]'); if (!cb) return; const ls = cur.body.split('\n'); const i = +cb.dataset.line; ls[i] = ls[i].replace(/\[( |x)\]/i, cb.checked ? '[x]' : '[ ]'); cur.body = ls.join('\n'); body.value = cur.body; touch(); });
      const pin = h('button.btn.ghost.sm', { onClick: async () => { cur.pinned = !cur.pinned; await api.patch('/api/notes/' + cur.id, { pinned: cur.pinned }).catch(toastErr); const m = notes.find((n) => n.id === cur.id); if (m) m.pinned = cur.pinned; paintList(); pin.replaceChildren(icon('pin', 14), cur.pinned ? t('Unpin') : t('Pin')); } }, icon('pin', 14), cur.pinned ? t('Unpin') : t('Pin'));
      const del = h('button.btn.ghost.sm', { onClick: async () => { if (!await confirmBox(t('Delete this note?'), { danger: true, ok: t('Delete') })) return; try { await api.del('/api/notes/' + cur.id); notes = notes.filter((n) => n.id !== cur.id); cur = null; dirty = false; wrap.classList.remove('ed-open'); paintList(); paintEd(); } catch (e) { toastErr(e); } } }, icon('trash', 14));
      const back = h('button.btn.ghost.icon.sm.only-mobile', { 'aria-label': t('Back'), onClick: async () => { await flush(); cur = null; wrap.classList.remove('ed-open'); paintList(); } }, icon('back', 16));
      saved.textContent = t('Saved'); saved.classList.remove('dirty');
      const share = h('button.btn.ghost.sm', { title: t('Send to a friend'), onClick: async () => { await flush(); const txt = ((cur.title ? cur.title + '\n\n' : '') + cur.body).trim(); if (!txt) return; sendToFriend(txt.slice(0, 1400)); } }, icon('send', 14));
      mount(ed, h('div.bar', back, seg, h('div.grow'), saved, share, pin, del), title, body, prev);
      show(); if (!cur.body && !cur.title) title.focus();
    }
    const save = debounce(() => flush(), 700);
    function touch() { dirty = true; saved.textContent = t('Saving…'); saved.classList.add('dirty'); save(); }
    async function flush() {
      if (!dirty || !cur) return; dirty = false; const n = cur;
      try { const r = await api.patch('/api/notes/' + n.id, { title: n.title, body: n.body }); const m = notes.find((x) => x.id === n.id); if (m) Object.assign(m, r.note); else notes.unshift(r.note); if (cur === n) { saved.textContent = t('Saved'); saved.classList.remove('dirty'); } paintList(); }
      catch (e) { dirty = true; saved.textContent = t('Not saved'); toastErr(e); }
    }
    async function create() {
      await flush();
      try { const r = await api.post('/api/notes', { title: '', body: '' }); cur = r.note; notes.unshift({ id: cur.id, title: '', preview: '', pinned: false, updated: cur.updated }); mode = 'write'; wrap.classList.add('ed-open'); paintList(); paintEd(); } catch (e) { toastErr(e); }
    }
    const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && root.isConnected) { e.preventDefault(); flush(); } };
    document.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', flush);
    await load();
    return () => { flush(); document.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', flush); };
  },
};
