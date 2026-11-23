// Nova Copilot for Nebulix Studio (Nebulix 10): ghost-text completions while you type (Tab accepts, Esc dismisses)
// and a side panel that explains, fixes, refactors, comments, tests or optimizes the selection or the file, with
// "apply" buttons that put the answer straight into the editor.
import { h, mount, ls } from './util.js';
import { t } from './i18n.js';
import { api, ApiError } from './api.js';
import { askNova } from './nova-core.js';
import { icon } from './icons.js';
import { toast } from './ui.js';
import { renderMarkdown } from './markdown.js';

const LANGS = ['javascript', 'typescript', 'html', 'css', 'scss', 'less', 'json', 'markdown', 'python', 'lua', 'java', 'cpp', 'c', 'csharp', 'go', 'rust', 'php', 'ruby', 'sql', 'shell', 'yaml', 'xml', 'kotlin', 'swift', 'plaintext'];
export const copilotOn = () => ls('studio.copilot') !== false;

export function setupCopilot(monaco, editor, { fileName, onStatus }) {
  let off = false; let lastReq = 0;
  const provider = {
    async provideInlineCompletions(model, pos, _ctx, token) {
      if (!copilotOn() || off) return { items: [] };
      const my = ++lastReq; await new Promise((r) => setTimeout(r, 450)); if (my !== lastReq || token.isCancellationRequested) return { items: [] };
      const full = model.getValue(); const offset = model.getOffsetAt(pos); const prefix = full.slice(Math.max(0, offset - 3000), offset); const suffix = full.slice(offset, offset + 1000);
      const lineBefore = model.getLineContent(pos.lineNumber).slice(0, pos.column - 1); if (!lineBefore.trim() && !prefix.trim()) return { items: [] };
      onStatus && onStatus('busy');
      let r; try { r = await api.post('/api/ai/complete', { prefix, suffix, lang: model.getLanguageId(), file: fileName() }, { quiet: true }); } catch { onStatus && onStatus('idle'); return { items: [] }; }
      if (r.off) { off = true; onStatus && onStatus('off'); return { items: [] }; }
      onStatus && onStatus('idle');
      if (!r.text || token.isCancellationRequested) return { items: [] };
      return { items: [{ insertText: r.text, range: new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column) }] };
    },
    freeInlineCompletions() {}, disposeInlineCompletions() {},
  };
  const subs = LANGS.map((l) => monaco.languages.registerInlineCompletionsProvider(l, provider));
  editor.updateOptions({ inlineSuggest: { enabled: true, mode: 'subwordSmart' } });
  return { dispose: () => subs.forEach((s) => s.dispose()), retry: () => { off = false; } };
}

const ACTIONS = [
  ['explain', '💡', 'Explain', 'Explain what this code does, step by step, in simple words.'],
  ['fix', '🐛', 'Fix bugs', 'Find the bugs or problems in this code. Explain each one briefly, then give the corrected code.'],
  ['refactor', '✨', 'Refactor', 'Refactor this code to be cleaner and more readable without changing what it does. Give the full new code.'],
  ['comment', '📝', 'Add comments', 'Add clear comments to this code (keep the code the same). Give the full commented code.'],
  ['tests', '🧪', 'Write tests', 'Write unit tests for this code. Use the usual test framework for the language.'],
  ['optimize', '⚡', 'Optimize', 'Make this code faster or lighter where it matters. Explain the changes and give the full new code.'],
];
// the side panel; returns { el, ask(prompt) }
export function copilotPanel(monaco, editor, { fileName, onRun }) {
  const msgs = []; let streaming = false; let ctrl = null;
  const out = h('div.cp-msgs'); const ta = h('textarea.input.cp-ta', { rows: 2, placeholder: t('Ask Nova about your code… (Ctrl+I)'), onKeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(ta.value); } } });
  const toggle = h('label.cp-toggle', h('input', { type: 'checkbox', checked: copilotOn(), onChange: (e) => { ls('studio.copilot', e.target.checked); toast(e.target.checked ? t('Copilot suggestions on') : t('Copilot suggestions off'), 'info', 1500); } }), ' ', t('Suggestions while typing'));
  const el = h('div.cp', h('div.st-sh', h('span.grow', '✨ Nova Copilot'), h('button.st-ib', { title: t('Clear'), onClick: () => { msgs.length = 0; paint(); } }, icon('trash', 14))),
    h('div.cp-acts', ACTIONS.map(([id, e, l, p]) => h('button.cp-act', { type: 'button', title: t(l), onClick: () => ask(t(p), id) }, h('span', e), h('span', t(l))))), toggle, out,
    h('div.cp-compose', ta, h('button.btn.primary.sm', { onClick: () => (streaming ? ctrl && ctrl.abort() : ask(ta.value)) }, icon('send', 14))));
  const sel = () => { const m = editor.getModel(); if (!m) return { text: '', whole: true }; const s = editor.getSelection(); const txt = s && !s.isEmpty() ? m.getValueInRange(s) : ''; return txt.trim() ? { text: txt, whole: false, range: s } : { text: m.getValue(), whole: true }; };
  function firstCode(text) { const m = /```[^\n]*\n([\s\S]*?)```/.exec(text); return m ? m[1].replace(/\n$/, '') : null; }
  function apply(code, how) {
    const m = editor.getModel(); if (!m || code == null) return;
    if (how === 'file') { editor.executeEdits('nova', [{ range: m.getFullModelRange(), text: code }]); }
    else if (how === 'insert') { const p = editor.getPosition(); editor.executeEdits('nova', [{ range: new monaco.Range(p.lineNumber, p.column, p.lineNumber, p.column), text: code }]); }
    else { const s = editor.getSelection(); const range = s && !s.isEmpty() ? s : m.getFullModelRange(); editor.executeEdits('nova', [{ range, text: code }]); }
    editor.pushUndoStop(); editor.focus(); toast(t('Applied. Ctrl+Z undoes it.'), 'good', 2000);
  }
  function paint() {
    mount(out, msgs.length ? msgs.map((m) => m.role === 'user' ? h('div.cp-u', m.label || m.content.slice(0, 200)) : h('div.cp-a', m.content ? renderMarkdown(m.content, { done: !m.live }) : h('div.nv2-typing', h('i'), h('i'), h('i')), m.error ? h('div.small.error', m.error) : null,
      !m.live && firstCode(m.content) ? h('div.cp-apply', h('button.btn.sm.primary', { onClick: () => apply(firstCode(m.content), 'sel') }, icon('check', 13), m.whole ? t('Replace file') : t('Apply to selection')), h('button.btn.sm', { onClick: () => apply(firstCode(m.content), 'insert') }, t('Insert at cursor'))) : null))
      : h('div.small.muted.cp-empty', t('Select code (or nothing for the whole file) and pick an action, or ask anything. Suggestions appear in grey while you type: Tab accepts them.')));
    out.scrollTop = out.scrollHeight;
  }
  async function ask(prompt, actionId) {
    prompt = String(prompt || '').trim(); if (!prompt || streaming) return; ta.value = '';
    const s = sel(); const lang = editor.getModel() ? editor.getModel().getLanguageId() : 'plaintext'; const name = fileName() || 'file';
    const ctxText = s.text.length > 20000 ? s.text.slice(0, 20000) + '\n…' : s.text;
    const content = `${prompt}\n\n${s.whole ? `File \`${name}\`` : `Selected code from \`${name}\``} (${lang}):\n\`\`\`${lang}\n${ctxText}\n\`\`\``;
    msgs.push({ role: 'user', content, label: (ACTIONS.find((a) => a[0] === actionId) || [0, '💬'])[1] + ' ' + (actionId ? t((ACTIONS.find((a) => a[0] === actionId) || [])[2]) : prompt) + (s.whole ? '' : ' · ' + t('selection')) });
    const a = { role: 'assistant', content: '', live: true, whole: s.whole }; msgs.push(a); streaming = true; paint(); ctrl = new AbortController();
    try { await askNova({ mode: 'copilot', signal: ctrl.signal, messages: msgs.slice(0, -1).slice(-6).map(({ role, content: c }) => ({ role, content: c })), onText: (d) => { a.content += d; paint(); } }); }
    catch (e) { if (!(e && e.name === 'AbortError')) a.error = e instanceof ApiError || (e && e.soft) ? e.message : t('Something went wrong'); }
    a.live = false; streaming = false; ctrl = null; paint(); void onRun;
  }
  paint();
  return { el, ask, focus: () => ta.focus() };
}
