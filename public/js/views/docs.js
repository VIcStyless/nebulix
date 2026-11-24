// Nebulix Docs: rich-text documents with autosave, sharing, outline, word count, export and print.
import { h, mount } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { toast, toastErr, loading, emptyState, promptBox, openMenu } from '../ui.js';
import { officeHome, officeBar, autosaver, sanitize } from '../office.js';
import { htmlToDocx, prepareImages } from '../docx.js';
import { commentsPanel } from '../doccomments.js';

const TPL = [
  ['Blank document', null, ''],
  ['Letter', () => ({ html: '<p style="text-align: right">Madrid, ' + new Date().toLocaleDateString('es-ES', { dateStyle: 'long' }) + '</p><p>Estimado/a:</p><p>Le escribo para…</p><p>Atentamente,</p><p><b>Tu nombre</b></p>' }), '✉️'],
  ['Class notes', () => ({ html: '<h1>Apuntes</h1><h2>Tema 1</h2><ul><li>Idea principal</li><li>Detalle importante</li></ul><h2>Tema 2</h2><p>…</p>' }), '📝'],
  ['Work report', () => ({ html: '<h1>Informe</h1><p><i>Autor · fecha</i></p><h2>1. Introducción</h2><p>…</p><h2>2. Desarrollo</h2><p>…</p><h2>3. Conclusiones</h2><p>…</p>' }), '📈'],
  ['To-do list', () => ({ html: '<h1>Tareas</h1><ul><li>☐ Primera tarea</li><li>☐ Segunda tarea</li><li>☑ Tarea hecha</li></ul>' }), '✅'],
];

export default {
  full: true,
  title: () => 'Nebulix Docs',
  async mount(root, ctx) {
    const id = ctx.params[0];
    if (!id) return officeHome(root, ctx, { kind: 'doc', route: 'docs', name: 'Nebulix Docs', emoji: '📄', color: '#3b82f6', templates: TPL.map(([l, d, p]) => [t(l), d, p]) });
    const wrap = h('div.of.docs'); mount(root, wrap, loading());
    let it; try { it = (await api.get('/api/drive/item/' + encodeURIComponent(id))).item; } catch (e) { mount(wrap, emptyState('alert', t('Document not found'), e.message, h('button.btn', { onClick: () => ctx.go('docs') }, t('Back')))); return () => {}; }
    ctx.setTitle && ctx.setTitle(it.name);
    const cCount = h('span.dcm-n', { hidden: true });
    const cBtn = h('button.btn.sm', { title: t('Comments') + ' (Ctrl+Alt+M)', onMousedown: (e) => e.preventDefault(), onClick: () => comments.toggle() }, icon('chat', 14), h('span.dcm-lbl', t('Comments')), cCount);
    const page = h('div.dc-page', { contentEditable: it.canEdit ? 'true' : 'false', spellcheck: 'true' });
    page.innerHTML = sanitize((it.data && it.data.html) || '');
    const words = h('span.tiny.muted');
    const bar = officeBar(it, { emoji: '📄', onRename: async (n) => { try { await api.put('/api/drive/item/' + it.id, { name: n }); it.name = n; } catch (e) { toastErr(e); } },
      extra: h('div.row', { style: 'gap:6px' }, words, cBtn, h('button.btn.sm', { onClick: (e) => openMenu([{ label: t('Download as Word (.docx)'), icon: 'download', onClick: () => downloadDocx() }, { label: t('Download as HTML'), icon: 'download', onClick: () => download('html') }, { label: t('Download as text'), icon: 'download', onClick: () => download('txt') }, { label: t('Print / save as PDF'), icon: 'external', onClick: () => window.print() }], e.currentTarget) }, icon('download', 14), t('Export'))) });
    const save = autosaver(it.id, bar);
    const ex = (cmd, val) => { page.focus(); document.execCommand(cmd, false, val); changed(); };
    const btn = (ic, title, fn, label) => h('button.dc-b', { type: 'button', title, onMousedown: (e) => e.preventDefault(), onClick: fn }, label ? h('b', label) : icon(ic, 16));
    const sel = (opts, fn, title) => h('select.dc-sel', { title, onChange: (e) => { fn(e.target.value); e.target.selectedIndex = 0; } }, opts.map(([v, l]) => h('option', { value: v }, l)));
    const color = (title, cmd) => { const c = h('input.dc-col', { type: 'color', title, value: cmd === 'foreColor' ? '#e11d48' : '#fde047', onInput: (e) => ex(cmd, e.target.value) }); return c; };
    const tools = h('div.dc-tools',
      btn('back', t('Undo'), () => ex('undo')), btn('fwd', t('Redo'), () => ex('redo')), h('i.dc-sep'),
      sel([['', t('Style')], ['P', t('Normal text')], ['H1', t('Title')], ['H2', t('Heading')], ['H3', t('Subheading')], ['BLOCKQUOTE', t('Quote')], ['PRE', t('Code')]], (v) => v && ex('formatBlock', v), t('Style')),
      sel([['', t('Font')], ['system-ui', 'Sans'], ['Georgia', 'Serif'], ['ui-monospace', 'Mono'], ['Comic Sans MS', 'Comic'], ['Impact', 'Impact']], (v) => v && ex('fontName', v), t('Font')),
      sel([['', t('Size')], ['2', t('Small')], ['3', t('Normal')], ['5', t('Large')], ['7', t('Huge')]], (v) => v && ex('fontSize', v), t('Size')), h('i.dc-sep'),
      btn(null, t('Bold') + ' (Ctrl+B)', () => ex('bold'), 'B'), btn(null, t('Italic') + ' (Ctrl+I)', () => ex('italic'), 'I'), btn(null, t('Underline') + ' (Ctrl+U)', () => ex('underline'), 'U'), btn(null, t('Strikethrough'), () => ex('strikeThrough'), 'S'),
      color(t('Text colour'), 'foreColor'), color(t('Highlight'), 'hiliteColor'), h('i.dc-sep'),
      btn('menu', t('Align left'), () => ex('justifyLeft')), btn(null, t('Center'), () => ex('justifyCenter'), '≡'), btn(null, t('Align right'), () => ex('justifyRight'), '⇥'), h('i.dc-sep'),
      btn(null, t('Bulleted list'), () => ex('insertUnorderedList'), '•'), btn(null, t('Numbered list'), () => ex('insertOrderedList'), '1.'), btn(null, t('Checklist item'), () => ex('insertText', '☐ '), '☐'),
      btn('link', t('Link'), async () => { const u = await promptBox(t('Link'), { placeholder: 'https://' }); if (u && /^https?:\/\//.test(u)) ex('createLink', u); }),
      btn('image', t('Image'), () => { const inp = h('input', { type: 'file', accept: 'image/*' }); inp.onchange = () => { const f = inp.files[0]; if (!f) return; if (f.size > 600000) { toast(t('Images up to 600 KB in documents — use Drive for bigger ones.'), 'err'); return; } const r = new FileReader(); r.onload = () => ex('insertImage', r.result); r.readAsDataURL(f); }; inp.click(); }),
      btn(null, t('Table'), () => ex('insertHTML', '<table><tbody>' + '<tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>'.repeat(3) + '</tbody></table><p></p>'), '▦'),
      btn(null, t('Horizontal line'), () => ex('insertHorizontalRule'), '―'), btn(null, t('Clear formatting'), () => ex('removeFormat'), 'Tx'));
    const outline = h('nav.dc-outline');
    function changed() { if (!it.canEdit) return; save({ html: sanitize(page.innerHTML) }); stats(); }
    function stats() { const txt = page.innerText || ''; const w = (txt.match(/\S+/g) || []).length; words.textContent = t('{n} words', { n: w }); const hs = [...page.querySelectorAll('h1,h2,h3')]; mount(outline, hs.length ? h('div.eyebrow', t('Outline')) : null, hs.map((x) => h('a.dc-o.' + x.tagName.toLowerCase(), { href: '#', onClick: (e) => { e.preventDefault(); x.scrollIntoView({ behavior: 'smooth', block: 'center' }); } }, x.textContent.slice(0, 40) || '…'))); }
    page.addEventListener('input', changed);
    page.addEventListener('paste', (e) => { const html = e.clipboardData.getData('text/html'); if (html) { e.preventDefault(); document.execCommand('insertHTML', false, sanitize(html)); changed(); } });
    page.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save.flush(); } });
    function download(kind) { const blob = kind === 'html' ? new Blob(['<!doctype html><meta charset="utf-8"><title>' + it.name.replace(/</g, '') + '</title><body style="font-family:system-ui;max-width:800px;margin:40px auto">' + sanitize(page.innerHTML)], { type: 'text/html' }) : new Blob([page.innerText], { type: 'text/plain' }); const a = h('a', { href: URL.createObjectURL(blob), download: it.name + '.' + kind }); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
    async function downloadDocx() {
      try { const blob = await htmlToDocx(sanitize(page.innerHTML), { title: it.name, images: await prepareImages(page) }); const a = h('a', { href: URL.createObjectURL(new Blob([blob], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })), download: it.name.replace(/[\\/:*?"<>|]+/g, ' ').trim() + '.docx' }); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); toast(t('Word document downloaded'), 'good'); } catch (e) { toastErr(e); }
    }
    const comments = commentsPanel(it, page, { onCount: (n) => { cCount.hidden = !n; cCount.textContent = n; } });
    mount(wrap, bar, it.canEdit ? tools : null, h('div.dc-body', outline, h('div.dc-scroll', page), comments.el));
    stats(); if (it.canEdit) page.focus();
    // keep in sync with other editors when you are not typing
    let lastLocal = Date.now(); page.addEventListener('input', () => { lastLocal = Date.now(); });
    const poll = setInterval(async () => { if (Date.now() - lastLocal < 8000 || document.activeElement === page) return; try { const d = (await api.get('/api/drive/item/' + it.id, { quiet: true })).item; if (d.data && d.data.html !== undefined && sanitize(d.data.html) !== page.innerHTML) { page.innerHTML = sanitize(d.data.html); stats(); } } catch {} }, 10000);
    return () => { clearInterval(poll); comments.destroy(); save.flush(); };
  },
};
