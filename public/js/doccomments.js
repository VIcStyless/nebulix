// Nebulix 3.0 — comments on documents. Threads are anchored to a quoted piece of text (not to markup, so editing the
// document never breaks them): the quote is highlighted with the CSS Custom Highlight API when the browser has it
// and clicking a thread selects the text. Anyone who can open the document can comment; updates arrive live.
import { h, mount, fmt } from './util.js';
import { t } from './i18n.js';
import { api } from './api.js';
import { bus } from './state.js';
import { icon } from './icons.js';
import { toast, toastErr, confirmBox } from './ui.js';

// find `quote` in the text of `root` (it may cross formatting tags) → Range or null
function findRange(root, quote) {
  if (!quote) return null; const nodes = []; let text = '';
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n;
  while ((n = w.nextNode())) { nodes.push([n, text.length]); text += n.nodeValue; }
  const norm = (s) => s.replace(/\s+/g, ' '); const i = norm(text).indexOf(norm(quote).trim()); if (i < 0) return null;
  // map the offset in the normalised text back to the real text (whitespace runs were collapsed)
  const map = []; let prevWs = false; for (let k = 0; k < text.length; k++) { const ws = /\s/.test(text[k]); if (!(ws && prevWs)) map.push(k); prevWs = ws; }
  const qLen = norm(quote).trim().length; const a = map[i]; const b = (map[i + qLen - 1] ?? text.length - 1) + 1;
  const at = (off) => { for (let k = nodes.length - 1; k >= 0; k--) if (nodes[k][1] <= off) return [nodes[k][0], Math.min(off - nodes[k][1], nodes[k][0].nodeValue.length)]; return null; };
  const s = at(a); const e = at(b - 1); if (!s || !e) return null;
  const r = document.createRange(); r.setStart(s[0], s[1]); r.setEnd(e[0], e[1] + 1); return r;
}

export function commentsPanel(it, page, { onCount } = {}) {
  let list = []; let showResolved = false; let draftQuote = ''; let alive = true;
  const el = h('aside.dcm', { hidden: true });
  const hl = typeof Highlight !== 'undefined' && CSS.highlights;

  function paintHighlights() {
    if (!hl) return; const ranges = list.filter((c) => !c.resolved).map((c) => findRange(page, c.quote)).filter(Boolean);
    if (ranges.length) CSS.highlights.set('nbx-comments', new Highlight(...ranges)); else CSS.highlights.delete('nbx-comments');
  }
  function jump(c) {
    const r = findRange(page, c.quote); if (!r) { toast(t('That text is no longer in the document'), 'info'); return; }
    const s = getSelection(); s.removeAllRanges(); s.addRange(r); (r.startContainer.parentElement || page).scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  const who = (u) => h('b', u.displayName || u.username);
  const act = async (fn) => { try { await fn(); await load(); } catch (e) { toastErr(e); } };
  function replyBox(c) {
    const ta = h('textarea.dcm-ta', { rows: 1, maxLength: 2000, placeholder: t('Reply…'), onKeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } } });
    const send = () => { const text = ta.value.trim(); if (!text) return; ta.disabled = true; act(() => api.post(`/api/drive/item/${it.id}/comments/${c.id}/reply`, { text })); };
    return h('div.dcm-reply', ta, h('button.btn.sm.primary', { onClick: send, title: t('Reply') }, icon('send', 13)));
  }
  function thread(c) {
    return h('div.dcm-th' + (c.resolved ? '.done' : ''),
      c.quote ? h('button.dcm-q', { onClick: () => jump(c), title: t('Show in the document') }, '“', c.quote.length > 120 ? c.quote.slice(0, 120) + '…' : c.quote, '”') : null,
      h('div.dcm-msg', h('div.dcm-hd', who(c.by), h('span.tiny.muted', fmt.dt(c.at))), h('p', c.text)),
      c.replies.map((r) => h('div.dcm-msg.rep', h('div.dcm-hd', who(r.by), h('span.tiny.muted', fmt.dt(r.at)), r.canDelete ? h('button.dcm-x', { title: t('Delete'), onClick: () => act(() => api.del(`/api/drive/item/${it.id}/comments/${c.id}?reply=${r.id}`)) }, '×') : null), h('p', r.text))),
      c.resolved ? h('p.tiny.muted', '✓ ', t('Resolved by @{u}', { u: c.resolvedBy || '?' })) : replyBox(c),
      h('div.dcm-acts',
        (it.canEdit || c.mine) ? h('button.btn.sm.ghost', { onClick: () => act(() => api.put(`/api/drive/item/${it.id}/comments/${c.id}`, { resolved: !c.resolved })) }, c.resolved ? t('Reopen') : '✓ ' + t('Resolve')) : null,
        c.canDelete ? h('button.btn.sm.ghost', { onClick: async () => { if (await confirmBox(t('Delete this comment and its replies?'), { danger: true, ok: t('Delete') })) act(() => api.del(`/api/drive/item/${it.id}/comments/${c.id}`)); } }, t('Delete')) : null));
  }
  function composer() {
    const ta = h('textarea.dcm-ta', { rows: 3, maxLength: 2000, placeholder: t('Add a comment…'), onKeydown: (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); post(); } } });
    const post = async () => { const text = ta.value.trim(); if (!text) { ta.focus(); return; } ta.disabled = true; try { await api.post(`/api/drive/item/${it.id}/comments`, { text, quote: draftQuote }); draftQuote = ''; await load(); } catch (e) { ta.disabled = false; toastErr(e); } };
    return h('div.dcm-new', draftQuote ? h('div.dcm-q.static', '“', draftQuote.length > 120 ? draftQuote.slice(0, 120) + '…' : draftQuote, '”', h('button.dcm-x', { title: t('Remove'), onClick: () => { draftQuote = ''; paint(); } }, '×')) : h('p.tiny.muted', t('Tip: select text in the document first to comment on it.')),
      ta, h('div.row', { style: 'justify-content:flex-end' }, h('button.btn.sm.primary', { onClick: post }, icon('send', 13), t('Comment'))));
  }
  function paint() {
    const open = list.filter((c) => !c.resolved); const done = list.filter((c) => c.resolved);
    mount(el, h('div.dcm-top', h('b', icon('chat', 15), ' ', t('Comments')), h('span.chip', String(open.length)), h('button.dcm-x', { title: t('Close'), onClick: () => toggle(false) }, '×')),
      composer(),
      h('div.dcm-list', open.length ? open.slice().reverse().map(thread) : h('p.small.muted', { style: 'text-align:center;padding:12px 0' }, t('No open comments.')),
        done.length ? h('button.btn.sm.ghost', { style: 'width:100%', onClick: () => { showResolved = !showResolved; paint(); } }, (showResolved ? t('Hide resolved') : t('Show resolved')) + ` (${done.length})`) : null,
        showResolved ? done.slice().reverse().map(thread) : null));
    onCount && onCount(open.length); paintHighlights();
  }
  async function load() { try { list = (await api.get(`/api/drive/item/${it.id}/comments`, { quiet: true })).comments || []; if (alive) paint(); } catch { /* offline: keep what we have */ } }
  function toggle(on = el.hidden) { el.hidden = !on; if (on) { const s = getSelection(); const q = s && s.rangeCount && page.contains(s.anchorNode) ? String(s).trim().slice(0, 300) : ''; if (q) draftQuote = q; paint(); const ta = el.querySelector('.dcm-new textarea'); if (ta && draftQuote) ta.focus(); } }
  // comment on the current selection (button or Ctrl+Alt+M)
  const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'm') { e.preventDefault(); toggle(true); } };
  page.addEventListener('keydown', onKey);
  const off = bus.on('ws:dcomm', (m) => { if (m.item === it.id) load(); });
  // re-anchor highlights while people type (cheap: only when there are open threads)
  let hlT = 0; const onInput = () => { clearTimeout(hlT); hlT = setTimeout(paintHighlights, 600); }; page.addEventListener('input', onInput); page.addEventListener('nx-remote', onInput);
  load();
  return { el, toggle, load, destroy() { alive = false; off && off(); page.removeEventListener('keydown', onKey); page.removeEventListener('input', onInput); page.removeEventListener('nx-remote', onInput); clearTimeout(hlT); if (hl) CSS.highlights.delete('nbx-comments'); } };
}
