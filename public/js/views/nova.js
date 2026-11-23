// Nova (Nebulix 10): a ChatGPT-style assistant. Sidebar with saved conversations (on your account), Chat and Code
// modes, streaming answers with the model's reasoning folded away, Markdown with highlighted code you can run or open in
// Nebulix Studio, edit & resend, regenerate, attach files, read aloud, custom instructions, personality and memory.
import { h, mount, ls, fmt } from '../util.js';
import { t, getLang } from '../i18n.js';
import { api, ApiError } from '../api.js';
import { setMe } from '../state.js';
import { icon } from '../icons.js';
import * as theme from '../theme.js';
import { toast, toastErr, confirmBox, busy, openMenu, modal, promptBox, field } from '../ui.js';
import { renderMarkdown } from '../markdown.js';
import { askNova, imageUrl, STYLES } from '../nova-core.js';
import { runAgent, TOOLS } from '../nova-agent.js';
import { isPro } from '../state.js';
import { sfx } from '../sfx.js';

const SUGGEST = {
  chat: [['gamepad', 'Recommend a co-op game for me and my friends'], ['bolt', 'How can I get more FPS on my PC?'], ['palette', 'Make me a cyberpunk theme'], ['book', 'Explain photosynthesis like I am 12']],
  code: [['play', 'Make a Snake game in one HTML file'], ['search', 'Find the bug in my code and explain it'], ['terminal', 'Write a Python script that renames files by date'], ['layers', 'Explain React hooks with examples']],
  agent: [['branch', 'Create a repository with a Snake game and test it'], ['note', 'Read my notes and make a to-do list note with the important things'], ['tag', 'Look at today’s Shop and tell me what is worth buying'], ['upload', 'Improve the titles and descriptions of my Hub games']],
};
const cid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ---------- Nebulix extras inside answers: theme cards and game lists ----------
function themeFromBlock(src) { try { const j = JSON.parse(src); if (j && typeof j === 'object' && j.colors) return theme.normalize(j); } catch { /* streaming */ } return null; }
function themeCard(th, go) {
  const c = th.colors;
  const apply = (btn) => busy(btn, async () => { try { const a = theme.apply(th); const r = await api.patch('/api/profile', { settings: { activeTheme: a } }); if (r.user) setMe(r.user); toast(t('Theme applied: {n}', { n: a.name }), 'good'); sfx.coin(); } catch (e) { toastErr(e); } });
  return h('div.nv-theme', h('div.nv-swatch', { style: { background: `linear-gradient(135deg, ${th.bg.c1}, ${th.bg.c2} 60%, ${th.bg.c3})`, borderColor: c.border } }, h('span', { style: { background: c.accent } }), h('span', { style: { background: c.accent2 } }), h('span', { style: { background: c.surface } }), h('span', { style: { background: c.text } })),
    h('div.grow', h('b', th.name), h('div.small.muted', th.mode === 'light' ? t('Light') : t('Dark'))), h('button.btn.primary.sm', { type: 'button', onClick: (e) => apply(e.currentTarget) }, t('Apply')), h('button.btn.sm', { type: 'button', onClick: () => { theme.setPending(th); go('themes', 'studio'); } }, icon('sliders', 15), t('Tweak')));
}
const special = (go) => (lang, code, closed) => {
  if (lang === 'nbx-theme') { const th = closed ? themeFromBlock(code) : null; return th ? themeCard(th, go) : null; }
  if (lang === 'nbx-action') { let a = null; try { a = JSON.parse(code); } catch {} return h('div.nv2-actchip', icon('bot', 13), h('code', a && a.tool ? a.tool : '…')); }
  if (lang === 'nbx-sources') { let a = null; if (closed) { try { a = JSON.parse(code); } catch {} } return Array.isArray(a) ? h('div.nv2-srcs', h('div.tiny.muted', icon('globe', 12), ' ' + t('Sources')), h('div.nv2-srcrow', a.map((x, i) => h('a.nv2-src', { href: x.url, target: '_blank', rel: 'noopener noreferrer', title: x.title }, h('b', String(i + 1)), h('span.ellipsis', x.host || x.title))))) : null; }
  if (lang === 'nbx-games') { let a = null; if (closed) { try { a = JSON.parse(code); } catch {} } return Array.isArray(a) ? h('div.nv-games', a.slice(0, 8).map((n) => h('button.nv-game', { type: 'button', onClick: () => go('browse', { go: n + ' game' }) }, icon('gamepad', 15), h('span.ellipsis', String(n))))) : null; }
  return undefined;
};

let inst = null;
function build(root, ctx) {
  const go = ctx.go;
  let chats = []; let cur = null; let streaming = false; let ctrl = null; let status = null; let stick = true; let searchQ = '';
  let mode = ['code', 'agent'].includes(ls('nova.mode')) ? ls('nova.mode') : 'chat'; if (mode === 'agent' && !isPro()) mode = 'code'; let model = ls('nova.model') || 'auto'; let models = []; let autoOk = false; let attach = []; let webOn = !!ls('nova.web'); let imgOn = false; let imgStyle = ls('nova.istyle') || 'none'; let imgSize = ls('nova.isize') || 'square'; let sideOpen = innerWidth > 900 && ls('nova.side') !== false;
  const titleOf = (ms) => { const u = (ms || []).find((m) => m.role === 'user'); return u ? u.content.replace(/```[\s\S]*?```/g, '').replace(/\s+/g, ' ').trim().slice(0, 48) || t('Code') : t('New chat'); };

  // ---------- layout ----------
  const side = h('aside.nv2-side'); const list = h('div.nv2-msgs', { role: 'log', 'aria-live': 'polite', onScroll: () => { stick = list.scrollHeight - list.scrollTop - list.clientHeight < 140; jump.classList.toggle('show', !stick); } });
  const jump = h('button.nv2-jump', { type: 'button', onClick: () => bottom(true) }, icon('down', 16));
  const ta = h('textarea.nv2-ta', { rows: '1', maxlength: '24000', placeholder: t('Message Nova'), 'aria-label': t('Message Nova'), onInput: autosize, onKeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } if (e.key === 'Escape' && streaming) stop(); },
    onPaste: (e) => { const f = [...(e.clipboardData ? e.clipboardData.files : [])][0]; if (f) { e.preventDefault(); addFile(f); } } });
  const sendBtn = h('button.nv2-send', { type: 'button', 'aria-label': t('Send'), onClick: () => (streaming ? stop() : send()) }, icon('send', 18));
  const modeBtn = h('button.nv2-mode', { type: 'button', onClick: () => setMode(mode === 'chat' ? 'code' : mode === 'code' && isPro() ? 'agent' : 'chat') });
  const attachRow = h('div.nv2-attach'); const head = h('div.nv2-head'); const foot = h('div.nv2-foot');
  const fileIn = h('input', { type: 'file', multiple: true, hidden: true, onChange: () => { for (const f of fileIn.files) addFile(f); fileIn.value = ''; } });
  const webBtn = h('button.nv2-tool', { type: 'button', onClick: () => { webOn = !webOn; ls('nova.web', webOn); paintTools(); } });
  const imgBtn = h('button.nv2-tool', { type: 'button', onClick: () => { imgOn = !imgOn; paintTools(); ta.focus(); } });
  const autoBtn = h('button.nv2-tool', { type: 'button', onClick: () => { autoOk = !autoOk; paintTools(); } });
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition; let rec = null;
  const micBtn = SR ? h('button.nv2-ib', { type: 'button', title: t('Dictate'), onClick: () => dictate() }, icon('mic', 18)) : null;
  const imgBar = h('div.nv2-imgbar');
  function paintTools() {
    mount(webBtn, icon('globe', 15), h('span', t('Search'))); webBtn.classList.toggle('on', webOn); webBtn.title = t('Search the internet and cite sources');
    mount(imgBtn, icon('image', 15), h('span', t('Image')));
    mount(autoBtn, icon('check', 15), h('span', t('Auto-approve'))); autoBtn.classList.toggle('on', autoOk); autoBtn.style.display = mode === 'agent' ? '' : 'none'; autoBtn.title = t('Approve Nova’s changes automatically in this chat'); imgBtn.classList.toggle('on', imgOn); imgBtn.title = t('Create an image');
    ta.placeholder = imgOn ? t('Describe the image you want…') : mode === 'agent' ? t('Tell Nova what to do in your Nebulix…') : mode === 'code' ? t('Describe what to build, or paste code to fix…') : t('Message Nova');
    mount(imgBar, imgOn ? [h('span.tiny.muted', t('Style')), Object.entries(STYLES).map(([k, [l]]) => h('button.nv2-pill' + (imgStyle === k ? '.on' : ''), { type: 'button', onClick: () => { imgStyle = k; ls('nova.istyle', k); paintTools(); } }, t(l))), h('span.tiny.muted', { style: 'margin-left:8px' }, t('Format')), [['square', '◻'], ['wide', '▭'], ['tall', '▯']].map(([k, l]) => h('button.nv2-pill' + (imgSize === k ? '.on' : ''), { type: 'button', title: k, onClick: () => { imgSize = k; ls('nova.isize', k); paintTools(); } }, l))] : null);
    imgBar.classList.toggle('show', imgOn);
  }
  function dictate() {
    if (rec) { rec.stop(); return; }
    rec = new SR(); rec.lang = getLang() === 'es' ? 'es-ES' : getLang(); rec.interimResults = true; rec.continuous = false; const base = ta.value ? ta.value.replace(/\s*$/, ' ') : '';
    rec.onresult = (e) => { let txt = ''; for (const r of e.results) txt += r[0].transcript; ta.value = base + txt; autosize(); };
    rec.onend = () => { rec = null; micBtn.classList.remove('rec'); ta.focus(); }; rec.onerror = (e) => { if (e.error === 'not-allowed') toast(t('Microphone access was blocked.'), 'err'); };
    try { rec.start(); micBtn.classList.add('rec'); } catch { rec = null; }
  }
  const composer = h('div.nv2-composer', attachRow, imgBar, h('div.nv2-box', h('div.nv2-boxtop', ta), h('div.nv2-boxbot', h('button.nv2-ib', { type: 'button', title: t('Attach files (code, text)'), onClick: () => fileIn.click() }, icon('plus', 18)), webBtn, imgBtn, autoBtn, modeBtn, h('span.grow'), micBtn, sendBtn)), foot, fileIn);
  const main = h('main.nv2-main', head, h('div.nv2-scroll', list, jump), composer);
  const wrap = h('div.nv2' + (sideOpen ? '.side-open' : ''), side, main, h('div.nv2-scrim', { onClick: () => toggleSide(false) }));
  mount(root, wrap);
  // drop files anywhere on Nova
  wrap.addEventListener('dragover', (e) => { e.preventDefault(); wrap.classList.add('drop'); });
  wrap.addEventListener('dragleave', (e) => { if (e.target === wrap) wrap.classList.remove('drop'); });
  wrap.addEventListener('drop', (e) => { e.preventDefault(); wrap.classList.remove('drop'); for (const f of e.dataTransfer.files) addFile(f); });

  function autosize() { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 260) + 'px'; }
  const bottom = (smooth) => { list.scrollTo({ top: list.scrollHeight, behavior: smooth ? 'smooth' : 'auto' }); stick = true; jump.classList.remove('show'); };
  function toggleSide(v) { sideOpen = v === undefined ? !sideOpen : v; wrap.classList.toggle('side-open', sideOpen); if (innerWidth > 900) ls('nova.side', sideOpen); }
  function setMode(m) { if (m === 'agent' && !isPro()) { toast(t('Nova Agent is part of PRO.'), 'info'); go('pro'); return; } mode = m; ls('nova.mode', m); if (cur && !cur.msgs.length) cur.mode = m; paintMode(); paintTools(); if (!cur || !cur.msgs.length) paint(); ta.focus(); }
  function paintMode() { mount(modeBtn, icon(mode === 'agent' ? 'bot' : mode === 'code' ? 'terminal' : 'chat', 15), h('span', mode === 'agent' ? t('Agent') : mode === 'code' ? t('Code') : t('Chat'))); modeBtn.classList.toggle('on', mode !== 'chat'); modeBtn.title = mode === 'code' ? t('Code mode: expert programmer, complete runnable code') : t('Switch to Code mode for programming'); ta.placeholder = mode === 'code' ? t('Describe what to build, or paste code to fix…') : t('Message Nova'); }

  // ---------- attachments: text / code files become a fenced block in the message ----------
  const TEXTY = /\.(txt|md|js|mjs|cjs|ts|tsx|jsx|json|html?|css|scss|py|java|c|cc|cpp|h|hpp|cs|go|rs|rb|php|lua|sql|sh|bat|ps1|yml|yaml|xml|svg|csv|ini|toml|kt|swift|vue|svelte|gd|dart|r|m)$/i;
  async function addFile(f) {
    if (!TEXTY.test(f.name) && !/^text\//.test(f.type)) return toast(t('Nova can read text and code files for now.'), 'info');
    if (f.size > 200 * 1024) return toast(t('{f} is too big (max 200 KB)', { f: f.name }), 'err');
    const text = await f.text(); attach.push({ name: f.name, text }); paintAttach(); ta.focus();
  }
  function paintAttach() { mount(attachRow, attach.map((a, i) => h('span.nv2-chip', icon('note', 13), h('span.ellipsis', a.name), h('span.tiny.muted', ' ' + fmt.num(a.text.split('\n').length) + ' ' + t('lines')), h('button', { type: 'button', 'aria-label': t('Remove'), onClick: () => { attach.splice(i, 1); paintAttach(); } }, icon('x', 12))))); }

  // ---------- sidebar ----------
  const groupOf = (ts) => { const d = Date.now() - ts; return d < 864e5 && new Date(ts).toDateString() === new Date().toDateString() ? t('Today') : d < 2 * 864e5 ? t('Yesterday') : d < 7 * 864e5 ? t('Previous 7 days') : d < 30 * 864e5 ? t('Previous 30 days') : t('Older'); };
  function paintSide() {
    const q = searchQ.toLowerCase(); const shown = chats.filter((c) => !q || c.title.toLowerCase().includes(q));
    const groups = []; const pinned = shown.filter((c) => c.pin); if (pinned.length) groups.push([t('Pinned'), pinned]);
    for (const c of shown.filter((x) => !x.pin)) { const g = groupOf(c.updated); let gr = groups.find((x) => x[0] === g); if (!gr) groups.push((gr = [g, []])); gr[1].push(c); }
    const search = h('input.nv2-search', { placeholder: t('Search chats'), value: searchQ, onInput: (e) => { searchQ = e.target.value; paintSide(); const el = side.querySelector('.nv2-search'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); } });
    mount(side,
      h('div.nv2-sidetop', h('button.nv2-ib', { type: 'button', title: t('Close sidebar'), onClick: () => toggleSide(false) }, icon('layout', 18)), h('span.grow'), h('button.nv2-ib', { type: 'button', title: t('New chat') + ' (Ctrl+Shift+O)', onClick: newChat }, icon('edit', 18))),
      h('button.nv2-new', { type: 'button', onClick: newChat }, h('span.nv2-logo', icon('spark', 15)), h('b.grow', 'Nova'), icon('plus', 15)),
      search,
      h('div.nv2-list', groups.length ? groups.map(([g, items]) => [h('div.nv2-group', g), items.map((c) => h('div.nv2-item' + (cur && c.id === cur.id ? '.on' : ''), { onClick: () => openChat(c.id) },
        c.mode === 'code' ? h('span.nv2-ic', icon('terminal', 13)) : null, h('span.grow.ellipsis', c.title), h('button.nv2-dots', { type: 'button', 'aria-label': t('Options'), onClick: (e) => { e.stopPropagation(); chatMenu(c, e.currentTarget); } }, icon('more', 15))))]) : h('div.small.muted', { style: 'padding:12px' }, q ? t('No chats found') : t('Your chats will appear here.'))),
      h('div.nv2-sidebot',
        h('button.nv2-sb', { type: 'button', onClick: customModal }, icon('sliders', 16), t('Customize Nova')),
        h('button.nv2-sb', { type: 'button', onClick: (e) => personaMenu(e.currentTarget) }, icon('smile', 16), t('Personality & memory')),
        h('button.nv2-sb', { type: 'button', onClick: () => go('studio') }, icon('terminal', 16), t('Copilot in Nebulix Studio')),
        status ? h('div.nv2-status', h('span.nv2-dot' + (status.mode === 'local' ? '.off' : '')), h('span.grow', status.mode === 'local' ? t('Built-in helper') : (status.model || t('Online AI'))), h('span.tiny.muted', t('{n} left today', { n: status.left }))) : null));
  }
  function chatMenu(c, anchor) {
    openMenu([
      { label: c.pin ? t('Unpin') : t('Pin'), icon: 'pin', onClick: async () => { c.pin = !c.pin; try { await api.patch('/api/ai/chats/' + c.id, { pin: c.pin }); } catch {} sortChats(); paintSide(); } },
      { label: t('Rename'), icon: 'edit', onClick: async () => { const n = await promptBox(t('Rename'), { value: c.title }); if (!n) return; c.title = n.slice(0, 80); try { await api.patch('/api/ai/chats/' + c.id, { title: c.title }); } catch {} paintSide(); paintHead(); } },
      { label: t('Export as Markdown'), icon: 'download', onClick: async () => { const full = c.msgs ? c : (await api.get('/api/ai/chats/' + c.id)).chat; const md = '# ' + full.title + '\n\n' + full.msgs.map((m) => (m.role === 'user' ? '## ' + t('You') : '## Nova') + '\n\n' + m.content).join('\n\n'); const a = h('a', { href: URL.createObjectURL(new Blob([md], { type: 'text/markdown' })), download: (full.title || 'nova').replace(/[^\w\- ]+/g, '').slice(0, 40) + '.md' }); document.body.append(a); a.click(); a.remove(); } },
      { hr: true },
      { label: t('Delete'), icon: 'trash', danger: true, onClick: async () => { if (!(await confirmBox(t('Delete “{t}”?', { t: c.title }), { danger: true, ok: t('Delete') }))) return; try { await api.del('/api/ai/chats/' + c.id); } catch {} chats = chats.filter((x) => x.id !== c.id); if (cur && cur.id === c.id) newChat(); paintSide(); } },
    ], anchor);
  }
  const sortChats = () => chats.sort((a, b) => (b.pin ? 1 : 0) - (a.pin ? 1 : 0) || b.updated - a.updated);
  async function personaMenu(anchor) {
    try {
      const p = await api.get('/api/ai/prefs');
      openMenu([...p.styles.map((st) => ({ label: (getLang() === 'es' ? st.n[1] : st.n[0]), icon: st.id === p.style ? 'check' : 'smile', onClick: async () => { try { await api.put('/api/ai/prefs', { style: st.id }); toast(t('Personality updated'), 'good'); } catch (e) { toastErr(e); } } })),
        { hr: true }, { label: t('What Nova remembers ({n})', { n: p.memory.length }), icon: 'note', onClick: () => memoryModal(p.memory) }], anchor);
    } catch (e) { toastErr(e); }
  }
  function memoryModal(mem) {
    modal({ title: t('Memory'), cls: 'narrow', body: h('div.col', { style: 'gap:6px' }, h('p.small.muted', t('Tell Nova “remember that …” and it will keep it in mind in every chat. You can delete anything here.')),
      mem.length ? mem.map((m) => h('div.row', { style: 'gap:8px;align-items:center' }, h('span.grow.small', m.text || m), h('button.btn.sm.ghost', { onClick: async (e) => { try { await api.put('/api/ai/prefs', { forget: m.text || m }); e.currentTarget.closest('.row').remove(); } catch (er) { toastErr(er); } } }, icon('trash', 13)))) : h('p.muted', t('Nothing yet.'))), actions: [{ label: t('Close') }] });
  }
  async function customModal() {
    let c = { about: '', how: '' }; try { c = (await api.get('/api/ai/custom')).custom; } catch {}
    const about = h('textarea.input', { rows: 4, maxlength: 1500, placeholder: t('E.g. I am 15, I code in JavaScript and Lua (Roblox), I like strategy games.') }); about.value = c.about || '';
    const how = h('textarea.input', { rows: 4, maxlength: 1500, placeholder: t('E.g. Answer in Spanish, be brief, give full code with comments, explain like a teacher.') }); how.value = c.how || '';
    await modal({ title: t('Customize Nova'), body: h('div.col.gap', field(t('What should Nova know about you?'), about), field(t('How should Nova answer?'), how), h('p.tiny.muted', t('Nova uses this in every new message.')),
      h('label.row', { style: 'gap:8px;align-items:center' }, h('input', { type: 'checkbox', checked: ls('nova.float') !== false, onChange: (e) => ls('nova.float', e.target.checked) }), t('Floating Nova button on every page (Alt+N)')),
      h('label.row', { style: 'gap:8px;align-items:center' }, h('input', { type: 'checkbox', checked: ls('nova.write') !== false, onChange: (e) => ls('nova.write', e.target.checked) }), t('Write with Nova in text boxes'))),
      actions: [{ label: t('Cancel'), value: false }, { label: t('Save'), kind: 'primary', onClick: async () => { try { await api.put('/api/ai/custom', { about: about.value, how: how.value }); toast(t('Saved'), 'good'); } catch (e) { toastErr(e); return false; } } }] });
  }

  // ---------- header ----------
  function paintHead() {
    mount(head, !sideOpen ? h('button.nv2-ib', { type: 'button', title: t('Open sidebar'), onClick: () => toggleSide(true) }, icon('layout', 18)) : null,
      !sideOpen ? h('button.nv2-ib', { type: 'button', title: t('New chat'), onClick: newChat }, icon('edit', 18)) : null,
      h('button.nv2-model', { type: 'button', onClick: (e) => modelMenu(e.currentTarget) },
        h('b', 'Nova'), h('span.muted', ' ' + (mode === 'agent' ? t('Agent') : mode === 'code' ? t('Code') : t('Chat')) + ' · ' + modelName()), icon('down', 14)),
      h('span.grow.nv2-title.ellipsis', cur && cur.msgs.length ? cur.title : ''),
      cur && cur.msgs.length ? h('button.nv2-ib', { type: 'button', title: t('Options'), onClick: (e) => { const c = chats.find((x) => x.id === cur.id) || cur; chatMenu(c, e.currentTarget); } }, icon('more', 18)) : null);
    mount(foot, status && status.external ? t('Nova uses a free online model. Do not share passwords or private data.') : t('Nova can make mistakes. Check important information.'));
  }

  // ---------- models ----------
  const modelName = () => (model === 'auto' ? t('Auto') : (models.find((m) => m.id === model) || { label: model }).label);
  const dot = (st) => h('span.nv2-mdot' + (!st ? '' : st.ok ? '.ok' : '.bad'));
  async function loadModels() { try { const r = await api.get('/api/ai/models', { quiet: true }); models = r.free ? r.models : []; if (r.keyed) models = []; } catch { models = []; } paintHead(); }
  function modelMenu(anchor) {
    const items = [
      { label: 'Nova · ' + t('Chat'), icon: mode === 'chat' ? 'check' : 'chat', onClick: () => setMode('chat') },
      { label: 'Nova · ' + t('Code'), icon: mode === 'code' ? 'check' : 'terminal', onClick: () => setMode('code') },
      { label: 'Nova · ' + t('Agent') + (isPro() ? '' : ' (PRO)'), icon: mode === 'agent' ? 'check' : 'bot', onClick: () => setMode('agent') },
      { hr: true },
    ];
    if (models.length) {
      items.push({ label: t('Auto — the best one available'), icon: model === 'auto' ? 'check' : 'zap', onClick: () => { model = 'auto'; ls('nova.model', model); paintHead(); } });
      for (const m of models) items.push({ label: m.label + ' · ' + m.by.replace(/ \(open weights\)/, '') + (m.status ? (m.status.ok ? ' · ' + t('working') : ' · ' + t('busy')) : ''), icon: model === m.id ? 'check' : m.tags.includes('code') ? 'terminal' : m.tags.includes('reasoning') ? 'spark' : 'chat', onClick: () => { model = m.id; ls('nova.model', model); paintHead(); } });
      items.push({ hr: true }, { label: t('Check models…'), icon: 'activity', onClick: checker });
    } else items.push({ label: status ? (status.mode === 'local' ? t('Built-in helper (no AI connected)') : t('Model: {m}', { m: status.model || '?' })) : '…', disabled: true });
    openMenu(items, anchor);
  }
  // the model checker: asks every free model for a tiny reply (server) and, for models that run in your browser, tests them from here too
  async function checker() {
    const body = h('div.nv2-check', h('p.small.muted', t('Nova tries every free model with a tiny message. Green answered now; red is busy or down (it is skipped automatically and tried again later).'))); const rows = h('div.col', { style: 'gap:6px' }); body.append(rows);
    const paintRows = (list, mine) => mount(rows, list.map((m) => { const st = m.status; const b = mine && mine[m.id]; return h('div.nv2-crow', dot(st), h('div.grow', h('b', m.label), h('div.tiny.muted', m.by + ' · ' + m.host + (m.browser ? ' · ' + t('runs from your browser') : ''))), h('span.tiny', st ? (st.ok ? (st.ms ? (st.ms / 1000).toFixed(1) + ' s' : 'OK') : (st.err || t('busy'))) : '—'), b ? h('span.tiny' + (b.ok ? '.nv2-okt' : '.nv2-badt'), b.ok ? t('Browser OK') : t('Browser: busy')) : null, h('button.btn.sm' + (model === m.id ? '.primary' : ''), { onClick: () => { model = m.id; ls('nova.model', model); paintHead(); toast(t('Model: {m}', { m: m.label }), 'good', 1500); } }, model === m.id ? t('In use') : t('Use'))); }));
    paintRows(models, null);
    const p = modal({ title: t('Model checker'), body, actions: [{ label: t('Close') }] });
    try {
      mount(rows, h('div.row', h('span.spinner'), h('span.small', ' ' + t('Checking…'))));
      const r = await api.post('/api/ai/models/check', {}); models = r.models; paintRows(models, null);
      const mine = {}; await Promise.all(models.filter((m) => m.browser).map(async (m) => { try { const ac = new AbortController(); setTimeout(() => ac.abort(), 20000); const resp = await fetch(m.url, { method: 'POST', signal: ac.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: m.model, max_tokens: 20, messages: [{ role: 'user', content: 'Reply with: OK' }] }) }); mine[m.id] = { ok: resp.ok }; } catch { mine[m.id] = { ok: false }; } }));
      paintRows(models, mine); paintHead();
    } catch (e) { toastErr(e); }
    await p;
  }

  // ---------- messages ----------
  const fmtSec = (ms) => Math.max(1, Math.round(ms / 1000));
  function speak(text, btn) {
    if (!('speechSynthesis' in window)) return; if (speechSynthesis.speaking) { speechSynthesis.cancel(); btn.classList.remove('on'); return; }
    const u = new SpeechSynthesisUtterance(text.replace(/```[\s\S]*?```/g, ' (code) ').replace(/[#*_`>|-]/g, ' ').slice(0, 4000)); u.lang = getLang() === 'es' ? 'es-ES' : getLang(); u.onend = () => btn.classList.remove('on'); speechSynthesis.speak(u); btn.classList.add('on');
  }
  function msgEl(m, i) {
    const msgs = cur.msgs; const last = i === msgs.length - 1; const live = streaming && last;
    if (m.role === 'user') {
      if (m.editing) { const ed = h('textarea.input.nv2-edit', { rows: 3 }); ed.value = m.content; setTimeout(() => { ed.focus(); ed.style.height = Math.min(400, ed.scrollHeight + 4) + 'px'; }, 10); return h('div.nv2-msg.me', h('div.nv2-editbox', ed, h('div.row', { style: 'gap:6px;justify-content:flex-end' }, h('button.btn.sm', { onClick: () => { m.editing = false; paint(); } }, t('Cancel')), h('button.btn.sm.primary', { onClick: () => { const v = ed.value.trim(); if (!v) return; cur.msgs = msgs.slice(0, i); m.editing = false; send(v); } }, t('Send'))))); }
      return h('div.nv2-msg.me', h('div.nv2-ubub', renderMarkdown(m.content, { go })), !streaming ? h('div.nv2-uact', h('button.nv2-act', { type: 'button', title: t('Edit'), onClick: () => { m.editing = true; paint(); } }, icon('edit', 14)), h('button.nv2-act', { type: 'button', title: t('Copy'), onClick: () => navigator.clipboard.writeText(m.content).then(() => toast(t('Copied!'), 'good', 1000)) }, icon('copy', 14))) : null);
    }
    const thinking = live && !m.content;
    const reasoning = m.reason ? h('details.nv2-think' + (live && !m.content ? '.live' : ''), { open: live && !m.content }, h('summary', icon('spark', 13), ' ', live && !m.content ? t('Thinking…') : t('Thought for {n} s', { n: fmtSec(m.thinkMs || 1000) })), h('div.nv2-thinktxt', m.reason)) : null;
    const actions = !live && m.content ? h('div.nv2-acts',
      h('button.nv2-act', { type: 'button', title: t('Copy'), onClick: () => navigator.clipboard.writeText(m.content).then(() => toast(t('Copied!'), 'good', 1000)) }, icon('copy', 15)),
      h('button.nv2-act' + (m.rate === 1 ? '.on' : ''), { type: 'button', title: t('Good answer'), onClick: () => { m.rate = m.rate === 1 ? 0 : 1; paint(); save(); } }, icon('thumbup', 15)),
      h('button.nv2-act' + (m.rate === -1 ? '.on' : ''), { type: 'button', title: t('Bad answer'), onClick: () => { m.rate = m.rate === -1 ? 0 : -1; paint(); save(); } }, icon('thumbdown', 15)),
      'speechSynthesis' in window ? h('button.nv2-act', { type: 'button', title: t('Read aloud'), onClick: (e) => speak(m.content, e.currentTarget) }, icon('volume', 15)) : null,
      last ? h('button.nv2-act', { type: 'button', title: t('Regenerate'), onClick: regenerate }, icon('refresh', 15)) : null,
      m.model ? h('span.nv2-model-tag', m.model) : null) : null;
    return h('div.nv2-msg.ai', h('div.nv2-ava', icon('spark', 16)), h('div.nv2-abody', reasoning,
      thinking && m.searching ? h('div.nv2-searching', icon('globe', 14), ' ', t('Searching the internet…')) : thinking ? h('div.nv2-typing', h('i'), h('i'), h('i')) : h('div.nv2-md' + (live ? '.live' : ''), renderMarkdown(m.content, { go, done: !live, special: special(go) })),
      m.error ? h('div.nv-err', icon('alert', 15), h('span', m.error), h('button.btn.sm', { type: 'button', onClick: regenerate }, icon('refresh', 14), t('Retry'))) : null,
      m.steps && m.steps.length ? h('div.nv2-steps', m.steps.map(stepEl)) : null,
      m.fallback ? h('div.tiny.muted', t('The free AI was busy, so the built-in helper answered. Try again in a minute.')) : null, actions));
  }
  function stepEl(st) {
    const args = st.args || {}; const T = TOOLS[st.tool];
    const preview = st.diff && Array.isArray(args.files) ? h('div.nv2-diff', args.files.slice(0, 6).map((f) => h('details', h('summary', icon('note', 12), ' ', f.path, h('span.tiny.muted', ' · ' + String(f.content || '').split('\n').length + ' ' + t('lines'))), h('pre', String(f.content || '').slice(0, 4000))))) : null;
    const res = st.status === 'done' || st.status === 'error' || st.status === 'denied' ? h('details.nv2-res', h('summary', st.status === 'done' ? t('Result') : st.status === 'denied' ? t('Refused') : t('Error')), h('pre', (typeof st.result === 'string' ? st.result : JSON.stringify(st.result, null, 1)).slice(0, 3000))) : null;
    const open = st.tool === 'open.page' && st.result && st.result.route ? h('button.btn.sm.primary', { onClick: () => go(st.result.route.split('/')[0], st.result.route.split('/').slice(1).join('/') || undefined) }, icon('external', 13), t('Open')) : null;
    return h('div.nv2-step.' + st.status, h('div.nv2-stephead', h('span.nv2-stepic', icon(st.status === 'done' ? 'check' : st.status === 'error' ? 'alert' : st.status === 'denied' ? 'x' : st.status === 'running' ? 'refresh' : T && T.write ? 'edit' : 'eye', 14)), h('b.grow', st.label || st.tool), h('code.tiny', st.tool)),
      preview, st.status === 'ask' ? h('div.nv2-ask', h('span.small', t('Allow Nova to do this?')), h('span.grow'), h('button.btn.sm', { onClick: () => st._resolve && st._resolve(false) }, t('Refuse')), h('button.btn.sm.primary', { onClick: () => st._resolve && st._resolve(true) }, t('Allow'))) : null, res, open);
  }
  function paint() {
    paintHead();
    if (!cur || !cur.msgs.length) {
      const sug = SUGGEST[mode] || SUGGEST.chat;
      mount(list, h('div.nv2-hello', h('div.nv2-orb', icon(mode === 'agent' ? 'bot' : mode === 'code' ? 'terminal' : 'spark', 30)), h('h1', mode === 'agent' ? t('What should I do in your Nebulix?') : mode === 'code' ? t('What are we building today?') : t('What can I help with?')),
        mode === 'agent' ? h('p.small.muted', { style: 'max-width:560px;text-align:center' }, t('Nova Agent works on your repositories, notes, Drive, Hub, profile, Shop and Locker. It shows every change before doing it; you approve or refuse each one.')) : null,
        h('div.nv2-sugs', sug.map(([e, q]) => h('button.nv2-sug', { type: 'button', onClick: () => send(t(q)) }, h('span.nv2-sugic', icon(e, 16)), h('span', t(q))))),
        mode === 'code' ? h('p.small.muted', { style: 'max-width:520px;text-align:center' }, t('Code mode answers like a senior programmer: complete code you can run with ▶ or open in Nebulix Studio. Attach files with + or drag them here.')) : null));
      return;
    }
    mount(list, h('div.nv2-thread', cur.msgs.map(msgEl))); if (stick) bottom();
  }
  let raf = 0; const paintSoon = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; paint(); }); };

  // ---------- chats ----------
  async function loadChats() {
    try { chats = (await api.get('/api/ai/chats')).chats; } catch { chats = []; }
    // bring over chats saved in this browser by older versions
    const old = ls('nova.convos'); if (Array.isArray(old) && old.length && !ls('nova.migrated')) { for (const c of old.slice(0, 30)) { const id = 'm' + (c.id || cid()).replace(/[^A-Za-z0-9]/g, '').slice(0, 20).padEnd(6, '0'); try { await api.put('/api/ai/chats/' + id, { title: c.title, msgs: (c.msgs || []).map((m) => ({ role: m.role, content: m.content })) }); } catch {} } ls('nova.migrated', 1); try { chats = (await api.get('/api/ai/chats')).chats; } catch {} }
    paintSide();
  }
  function newChat() { if (streaming) stop(); cur = { id: cid(), title: t('New chat'), msgs: [], mode, isNew: true }; attach = []; paintAttach(); paint(); paintSide(); ta.value = ''; autosize(); setTimeout(() => ta.focus(), 20); if (innerWidth <= 900) toggleSide(false); }
  async function openChat(id) {
    if (streaming) stop(); if (cur && cur.id === id) return;
    try { const r = await api.get('/api/ai/chats/' + id); cur = { id, title: r.chat.title, msgs: r.chat.msgs, mode: r.chat.mode || 'chat' }; mode = cur.mode; paintMode(); stick = true; paint(); paintSide(); bottom(); if (innerWidth <= 900) toggleSide(false); } catch (e) { toastErr(e); }
  }
  let saveT = 0;
  function save(now) {
    clearTimeout(saveT); if (!cur || !cur.msgs.length) return;
    const doit = async () => { const c = cur; if (c.isNew) { c.title = titleOf(c.msgs); c.isNew = false; } const body = { title: c.title, mode: c.mode || mode, msgs: c.msgs.filter((m) => m.content).map((m) => ({ role: m.role, content: m.content, t: m.t, model: m.model })) };
      try { await api.put('/api/ai/chats/' + c.id, body); } catch {} const ex = chats.find((x) => x.id === c.id); if (ex) { ex.title = c.title; ex.updated = Date.now(); ex.mode = body.mode; } else chats.unshift({ id: c.id, title: c.title, updated: Date.now(), mode: body.mode, pin: false }); sortChats(); paintSide(); };
    if (now) doit(); else saveT = setTimeout(doit, 600);
  }

  // ---------- sending ----------
  async function loadStatus() { try { status = await api.get('/api/ai/status', { quiet: true }); } catch { status = null; } paintSide(); paintHead(); }
  function stop() { if (ctrl) ctrl.abort(); }
  async function regenerate() { if (streaming || !cur) return; const msgs = cur.msgs; if (msgs.length && msgs[msgs.length - 1].role === 'assistant') msgs.pop(); const u = msgs.pop(); if (u) send(u.content.startsWith('🎨 ') ? '/imagina ' + u.content.slice(3) : u.content.startsWith('/imagina ') ? u.content : u.content); }
  async function send(text) {
    text = (typeof text === 'string' ? text : ta.value).trim();
    if (attach.length) { text = (text ? text + '\n\n' : '') + attach.map((a) => `**${a.name}**\n\`\`\`${(a.name.split('.').pop() || '').toLowerCase()}\n${a.text}\n\`\`\``).join('\n\n'); attach = []; paintAttach(); }
    if (!text || streaming) return;
    if (!cur) newChat(); if (!cur.msgs.length) cur.mode = mode;
    const im = /^\/(imagina|imagine|image|imagen|dibuja|draw)\s+([\s\S]+)/i.exec(text);
    if (imgOn || im) { // images are made by the free image model, straight from the browser
      const prompt = (im ? im[2] : text).trim(); ta.value = ''; autosize();
      cur.msgs.push({ role: 'user', content: '/imagina ' + prompt, t: Date.now() });
      cur.msgs.push({ role: 'assistant', content: `![${prompt.replace(/[\]\n]/g, ' ').slice(0, 300)}](${imageUrl(prompt, { style: imgStyle, size: imgSize })})`, t: Date.now(), model: 'FLUX' });
      stick = true; save(true); paint(); paintSide(); return;
    }
    ta.value = ''; autosize();
    cur.msgs.push({ role: 'user', content: text, t: Date.now() }); const a = { role: 'assistant', content: '', reason: '', t: Date.now(), searching: webOn }; cur.msgs.push(a);
    streaming = true; stick = true; sendBtn.classList.add('stop'); mount(sendBtn, h('i.nv2-stopsq')); sendBtn.setAttribute('aria-label', t('Stop')); paint(); paintSide();
    ctrl = new AbortController(); const t0 = Date.now(); let firstText = 0;
    try {
      let sources = null;
      if ((cur.mode || mode) === 'agent') {
        a.steps = []; a.searching = false;
        const history = cur.msgs.slice(0, -1).map(({ role, content }) => ({ role, content: content.replace(/\n*```nbx-sources[\s\S]*?```\s*$/, '') }));
        const res = await runAgent({ messages: history, signal: ctrl.signal, model, auto: () => autoOk, hooks: {
          onStart: (i) => { if (i > 0 && a.content) a.content += '\n\n'; paintSoon(); },
          onText: (d) => { if (!firstText) { firstText = Date.now(); a.thinkMs = firstText - t0; } a.content += d; paintSoon(); },
          onReason: (d) => { a.reason += d; paintSoon(); },
          onStep: (st) => { if (!a.steps.includes(st)) a.steps.push(st); paintSoon(); },
          approve: (st) => new Promise((resolve) => { st._resolve = (v) => { st._resolve = null; resolve(v); }; paintSoon(); }),
        } });
        a.model = (res.last && res.last.model) || (a.steps[0] && a.steps[0].model) || null; if (res.limit) a.content += '\n\n_' + t('Nova stopped after {n} steps. Say “continue” to go on.', { n: 12 }) + '_';
        return;
      }
      const r = await askNova({ model, mode: cur.mode || mode, web: webOn, signal: ctrl.signal, messages: cur.msgs.slice(0, -1).map(({ role, content }) => ({ role, content: content.replace(/\n*```nbx-sources[\s\S]*?```\s*$/, '') })),
        onReason: (d) => { a.reason += d; paintSoon(); }, onSources: (l) => { sources = l; a.searching = false; paintSoon(); },
        onText: (d) => { if (!firstText) { firstText = Date.now(); a.thinkMs = firstText - t0; } a.searching = false; a.content += d; paintSoon(); } });
      a.model = r.model || (r.mode === 'local' ? t('Built-in helper') : null); if (r.fallback) a.fallback = true; if (status && typeof r.left === 'number') { status.left = r.left; paintSide(); }
      if (sources && sources.length && a.content) a.content += '\n\n```nbx-sources\n' + JSON.stringify(sources) + '\n```';
    } catch (e) {
      if (e && e.name === 'AbortError') { if (!a.content) { cur.msgs.pop(); cur.msgs.pop(); ta.value = text; autosize(); } }
      else if (e instanceof ApiError && e.code === 'ai_quota') { cur.msgs.pop(); cur.msgs.pop(); toast(e.message, 'err', 7000); ta.value = text; loadStatus(); }
      else { a.error = (e && e.message) || t('Something went wrong'); }
    } finally {
      a.searching = false;
      streaming = false; ctrl = null; sendBtn.classList.remove('stop'); mount(sendBtn, icon('send', 18)); sendBtn.setAttribute('aria-label', t('Send'));
      if (a.error && !a.content) a.content = '';
      save(true); paint(); ta.focus();
    }
  }

  const onKey = (e) => { if (!wrap.isConnected) return; if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'o') { e.preventDefault(); newChat(); } if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); toggleSide(); paintHead(); } };
  document.addEventListener('keydown', onKey);
  paintMode(); paintTools(); newChat(); loadChats(); loadStatus(); loadModels();
  const q = ctx.query && ctx.query.get('q'); if (q) { if (ctx.query.get('mode') === 'code') setMode('code'); send(q); }
  return { destroy() { if (ctrl) ctrl.abort(); save(true); document.removeEventListener('keydown', onKey); try { speechSynthesis.cancel(); } catch {} } };
}

export default {
  title: () => 'Nova', full: true,
  async mount(root, ctx) { inst = build(root, ctx); return () => { if (inst) inst.destroy(); inst = null; }; },
};
