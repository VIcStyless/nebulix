// Nova everywhere (Nebulix 11): a floating button on every page opens a mini-chat that knows the page you are on and
// the text you selected (explain, summarise, translate…), and a ✨ button on any text box rewrites what you wrote
// (improve, fix spelling, shorter, longer, formal, fun, translate, continue). Alt+N opens the mini-chat.
import { h, mount, ls } from './util.js';
import { t, getLang } from './i18n.js';
import { S, bus } from './state.js';
import { icon } from './icons.js';
import { toast, openMenu } from './ui.js';
import { renderMarkdown } from './markdown.js';
import { askNova, novaOnce } from './nova-core.js';

const on = () => ls('nova.float') !== false;
let fab = null; let panel = null; let msgs = []; let busy = false; let ctrl = null; let wired = false;
let curRoute = 'home'; const route = () => curRoute;
// 13.8: never over games, emulators and machines (full-screen things), and it can be hidden with a right click
const GAME_ROUTES = ['arena', 'dash', 'fusion', 'casino3d', 'worlds', 'vm', 'terminal', 'retro', 'cloud', 'boss', 'play', 'arcade', 'arcade3d', 'avatar', 'study'];
const hidden = () => !S.me || route() === 'nova' || GAME_ROUTES.includes(route()) || document.documentElement.classList.contains('nbx-locked') || document.body.classList.contains('os-mode');
const selected = () => { const s = String(window.getSelection ? window.getSelection() : '').trim(); return s.length > 2 ? s.slice(0, 6000) : ''; };
function pageText() { const root = document.querySelector('#app .view, #app main, #app') || document.body; return String(root.innerText || '').replace(/\n{3,}/g, '\n\n').slice(0, 7000); }

function paintFab() {
  if (!on() || hidden()) { if (fab) fab.style.display = 'none'; if (panel && hidden()) closePanel(); return; }
  if (!fab) { fab = h('button.nvf-fab', { type: 'button', title: 'Nova (Alt+N)', 'aria-label': 'Nova', onMousedown: (e) => e.preventDefault(), onClick: () => (panel ? closePanel() : openPanel()), onContextmenu: (e) => { e.preventDefault(); openMenu([{ label: t('Hide the Nova button'), icon: 'eyeoff', onClick: () => { ls('nova.float', false); paintFab(); toast(t('Hidden. Turn it back on in Settings → Appearance, or press Alt+N.'), 'info', 4000); } }], fab); } }, icon('spark', 22)); document.body.append(fab); }
  fab.style.display = '';
}
function closePanel() { if (ctrl) ctrl.abort(); if (panel) { panel.classList.add('out'); const p = panel; setTimeout(() => p.remove(), 200); } panel = null; if (fab) fab.classList.remove('open'); }
function openPanel(prompt) {
  if (panel) { if (prompt) ask(prompt); return; }
  const sel = selected();
  const list = h('div.nvf-msgs'); const ta = h('textarea.nvf-ta', { rows: 1, placeholder: t('Ask Nova about this page…'), onKeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(ta.value); } if (e.key === 'Escape') closePanel(); }, onInput: () => { ta.style.height = 'auto'; ta.style.height = Math.min(120, ta.scrollHeight) + 'px'; } });
  const chips = sel ? [[t('Explain'), 'Explain this clearly:'], [t('Summarize'), 'Summarize this in a few bullet points:'], [t('Translate'), getLang() === 'es' ? 'Translate this to Spanish (or to English if it is already Spanish):' : 'Translate this to English (or to Spanish if it is already English):']]
    : [[t('Summarize this page'), '#page'], [t('What can I do here?'), '#help'], [t('Give me an idea'), 'Give me one fun idea of something to do in Nebulix right now, based on this page.']];
  panel = h('div.nvf-panel', h('div.nvf-head', h('span.nvf-logo', icon('spark', 14)), h('b.grow', 'Nova'), h('button.nvf-ib', { title: t('Open in Nova'), onClick: () => { const q = msgs.filter((m) => m.role === 'user').pop(); closePanel(); window.__nbx.go('nova', q ? { q: q.content.slice(0, 1500) } : undefined); } }, icon('external', 15)), h('button.nvf-ib', { title: t('Close'), onClick: closePanel }, icon('x', 15))),
    sel ? h('div.nvf-sel', h('span.tiny.muted', t('Selected text')), h('div.ellipsis2', sel.slice(0, 220))) : null,
    list, h('div.nvf-chips', chips.map(([l, p]) => h('button.nvf-chip', { type: 'button', onClick: () => ask(p, sel) }, l))), h('div.nvf-box', ta, h('button.nvf-send', { type: 'button', onClick: () => (busy ? ctrl && ctrl.abort() : ask(ta.value)) }, icon('send', 15))));
  document.body.append(panel); fab && fab.classList.add('open'); msgs = []; paint(); setTimeout(() => ta.focus(), 30);
  function paint() { mount(list, msgs.length ? msgs.map((m) => (m.role === 'user' ? h('div.nvf-u', m.label || m.content) : h('div.nvf-a', m.content ? renderMarkdown(m.content, { done: !m.live }) : h('div.nv2-typing', h('i'), h('i'), h('i')), m.error ? h('div.small.error', m.error) : null))) : h('div.small.muted.nvf-hi', t('Hi! I can see the page you are on. Ask me anything, or select some text first.'))); list.scrollTop = list.scrollHeight; }
  async function ask(p, selText) {
    p = String(p || '').trim(); if (!p || busy) return; ta.value = '';
    let content = p; let label = p;
    if (p === '#page') { content = `Summarize this Nebulix page ("${route()}") in a few short bullet points:\n\n${pageText()}`; label = t('Summarize this page'); }
    else if (p === '#help') { content = `I am on the Nebulix page "${route()}". Based on what is on screen, explain briefly what I can do here and 3 useful tips.\n\n${pageText().slice(0, 3500)}`; label = t('What can I do here?'); }
    else if (selText) { content = `${p}\n\n"""${selText}"""`; label = p.replace(/:$/, '') + ' · ' + t('selection'); }
    else if (!msgs.length) content = `(I am on the Nebulix page "${route()}". Page text, for context:\n${pageText().slice(0, 2500)}\n)\n\n${p}`;
    msgs.push({ role: 'user', content, label }); const a = { role: 'assistant', content: '', live: true }; msgs.push(a); busy = true; paint(); ctrl = new AbortController();
    try { await askNova({ mode: 'chat', signal: ctrl.signal, messages: msgs.slice(0, -1).slice(-8).map(({ role, content: c }) => ({ role, content: c })), onText: (d) => { a.content += d; paint(); } }); }
    catch (e) { if (!(e && e.name === 'AbortError')) a.error = e.message || t('Something went wrong'); }
    a.live = false; busy = false; ctrl = null; paint();
  }
  panel._ask = ask; if (prompt) ask(prompt);
}

// ---------- ✨ write with Nova on any text box ----------
const WRITE = [
  ['improve', '✨', 'Improve', 'Improve this text: clearer and nicer, same meaning and same language.'],
  ['fix', '🔤', 'Fix spelling', 'Fix the spelling, grammar and punctuation of this text. Keep the same language and style.'],
  ['short', '✂️', 'Shorter', 'Make this text shorter, keep the key points, same language.'],
  ['long', '📏', 'Longer', 'Make this text a bit longer and more detailed, same language and tone.'],
  ['formal', '👔', 'More formal', 'Rewrite this text in a more formal, polite tone, same language.'],
  ['fun', '😄', 'More fun', 'Rewrite this text to be more fun and casual (you may add an emoji or two), same language.'],
  ['en', '🇬🇧', 'To English', 'Translate this text to English.'],
  ['es', '🇪🇸', 'To Spanish', 'Translate this text to Spanish.'],
  ['continue', '➡️', 'Continue', 'Continue writing this text naturally (2–3 more sentences). Return the original text followed by the continuation.'],
];
let pill = null; let target = null; let hideT = 0;
const textOf = (el) => (el.isContentEditable ? el.innerText : el.value) || '';
const okField = (el) => el && ((el.tagName === 'TEXTAREA') || (el.tagName === 'INPUT' && /^(text|search|)$/i.test(el.type || '')) || el.isContentEditable) && !el.closest('.monaco-editor, .nv2, .nvf-panel, .nbx-lock, [data-nonova]') && !el.readOnly && !el.disabled && el.type !== 'password';
function placePill() {
  if (!pill || !target || !target.isConnected) return hidePill();
  const r = target.getBoundingClientRect(); if (!r.width || r.bottom < 0 || r.top > innerHeight) return hidePill();
  pill.style.top = Math.max(4, Math.min(innerHeight - 30, r.bottom - 28)) + 'px'; pill.style.left = Math.max(4, Math.min(innerWidth - 34, r.right - 32)) + 'px';
}
function showPill(el) {
  target = el; if (ls('nova.write') === false) return;
  if (!pill) { pill = h('button.nvf-pill', { type: 'button', title: t('Write with Nova'), onMousedown: (e) => e.preventDefault(), onClick: (e) => writeMenu(e.currentTarget) }, '✨'); document.body.append(pill); }
  pill.style.display = textOf(el).trim().length >= 3 ? '' : 'none'; placePill();
}
function hidePill() { if (pill) pill.style.display = 'none'; }
function writeMenu(anchor) {
  const el = target; if (!el) return; const text = textOf(el).trim(); if (!text) return;
  openMenu([...WRITE.map(([id, e, l, inst]) => ({ label: e + '  ' + t(l), onClick: () => rewrite(el, text, inst) })), { hr: true }, { label: t('Ask Nova about it'), icon: 'spark', onClick: () => openPanel() }, { label: t('Hide this button'), icon: 'eyeoff', onClick: () => { ls('nova.write', false); hidePill(); toast(t('You can turn it back on in Nova → Customize.'), 'info'); } }], anchor);
}
async function rewrite(el, text, inst) {
  pill.classList.add('busy'); pill.textContent = '…';
  try {
    let out = await novaOnce(`${inst}\nReturn ONLY the resulting text, with no quotes, no explanations and no preface.\n\n"""${text.slice(0, 6000)}"""`);
    out = out.replace(/^```[\w-]*\n?|\n?```$/g, '').replace(/^["“«]|["”»]$/g, '').trim(); if (!out) throw new Error(t('Nova did not return any text.'));
    el.focus();
    if (el.isContentEditable) { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); if (!document.execCommand('insertText', false, out)) el.innerText = out; }
    else { el.select(); if (!document.execCommand('insertText', false, out)) { el.value = out; el.dispatchEvent(new Event('input', { bubbles: true })); } }
    toast(t('Done. Ctrl+Z undoes it.'), 'good', 1800);
  } catch (e) { toast(e && e.busy ? t('The AI is busy right now, your text was not changed. Try again in a minute.') : (e.message || t('Something went wrong')), 'err', 4000); }
  pill.classList.remove('busy'); pill.textContent = '✨'; placePill();
}

export function initNovaFloat() {
  if (wired) { paintFab(); return; } wired = true;
  try { curRoute = (sessionStorage.getItem('nbx.route') || '#/home').replace(/^#\/?/, '').split(/[/?]/)[0] || 'home'; } catch {}
  bus.on('route', (name) => { curRoute = name || 'home'; setTimeout(paintFab, 30); }); setInterval(paintFab, 1500);
  addEventListener('keydown', (e) => { if (e.altKey && !e.ctrlKey && (e.key === 'n' || e.key === 'N')) { if (hidden()) return; e.preventDefault(); if (!on()) { ls('nova.float', true); paintFab(); } panel ? closePanel() : openPanel(); } });
  document.addEventListener('focusin', (e) => { clearTimeout(hideT); if (okField(e.target)) showPill(e.target); else hidePill(); });
  document.addEventListener('focusout', () => { hideT = setTimeout(() => { if (!document.activeElement || !okField(document.activeElement)) hidePill(); }, 200); });
  document.addEventListener('input', (e) => { if (e.target === target) showPill(target); });
  addEventListener('scroll', placePill, true); addEventListener('resize', placePill);
  paintFab();
}
export const novaFloatOn = on;
