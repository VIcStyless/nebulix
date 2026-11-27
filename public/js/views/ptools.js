// Nebulix 3.0 phase 16 — Productivity: Habits, Journal, Read later, Mind maps, Password vault and Scanner.
// Everything is saved to your account (server/routes/ptools.js). The vault is encrypted here, in your browser
// (AES-256-GCM with a key derived from your master password); the server only stores ciphertext. #/ptools/<tool>
import { imgkit } from '../native/imgkit.js';
import { h, mount, ls } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { toast, toastErr, modal, confirmBox, loading, emptyState, field, tabsEl, promptBox } from '../ui.js';

const TOOLS = [['habits', 'Habits', 'check'], ['journal', 'Journal', 'book'], ['readlater', 'Read later', 'bookmark'], ['mindmap', 'Mind maps', 'branch'], ['vault', 'Passwords', 'key'], ['scanner', 'Scanner', 'camera']];
const newId = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(9)))).replace(/\+/g, '-').replace(/\//g, '_');
const day = (d = new Date()) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const store = (kind) => ({
  list: () => api.get('/api/me/tools/' + kind).then((r) => r.items),
  save: (id, data, base) => api.put('/api/me/tools/' + kind + '/' + id, { data, base }).then((r) => r.item),
  del: (id) => api.del('/api/me/tools/' + kind + '/' + id),
});

export default {
  title: () => t('Productivity'),
  async mount(root, ctx) {
    let tool = TOOLS.some((x) => x[0] === ctx.params[0]) ? ctx.params[0] : ls('pt.tool') || 'habits';
    const body = h('section.pt-body'); let cleanup = null;
    const show = async () => { ls('pt.tool', tool); history.replaceState(null, '', '#/ptools/' + tool); if (cleanup) { try { cleanup(); } catch {} cleanup = null; } mount(body, loading()); try { cleanup = (await TOOL_FN[tool](body)) || null; } catch (e) { mount(body, emptyState('alert', t('Something went wrong'), e.message)); } };
    mount(root, h('div.inner.pt', h('div.page-title', h('div', h('h2', icon('check', 22), ' ', t('Productivity')), h('p', t('Habits, journal, reading list, mind maps, an encrypted password vault and a document scanner — saved to your account.')))),
      tabsEl(TOOLS.map(([k, l, ic]) => [k, t(l), ic]), tool, (v) => { tool = v; show(); }), body));
    show();
    return () => { if (cleanup) try { cleanup(); } catch {} };
  },
};

// ---------------- Habits ----------------
async function habits(box) {
  const S = store('habits'); let items = await S.list();
  const last = (n) => Array.from({ length: n }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (n - 1 - i)); return day(d); });
  const streak = (done) => { let n = 0; const d = new Date(); if (!done[day(d)]) d.setDate(d.getDate() - 1); while (done[day(d)]) { n++; d.setDate(d.getDate() - 1); } return n; };
  async function toggle(it, d) { const done = { ...(it.data.done || {}) }; if (done[d]) delete done[d]; else done[d] = 1; try { const n = await S.save(it.id, { ...it.data, done }); Object.assign(it, n); paint(); } catch (e) { toastErr(e); } }
  async function add() { const name = await promptBox(t('New habit'), { placeholder: t('e.g. Read 20 minutes') }); if (!name) return; const id = newId(); try { items.unshift(await S.save(id, { name: name.slice(0, 80), color: ['#22c55e', '#3b82f6', '#f59e0b', '#ec4899', '#a855f7'][items.length % 5], done: {} })); paint(); } catch (e) { toastErr(e); } }
  function paint() {
    const days = last(14); const today = day();
    mount(box, h('div.row', { style: 'gap:8px;margin-bottom:12px' }, h('button.btn.primary', { onClick: add }, icon('plus', 15), t('New habit'))),
      items.length ? h('div.pt-habits', h('div.pt-hrow.head', h('span'), days.map((d) => h('span.pt-hd', { title: d }, d.slice(8))), h('span', t('Streak'))),
        items.map((it) => h('div.pt-hrow', h('div.pt-hname', h('i', { style: 'background:' + it.data.color }), h('b', it.data.name), h('button.btn.sm.ghost', { title: t('Delete'), 'aria-label': t('Delete'), onClick: async () => { if (await confirmBox(t('Delete “{n}” and its history?', { n: it.data.name }), { danger: true })) { await S.del(it.id); items = items.filter((x) => x !== it); paint(); } } }, icon('trash', 13))),
          days.map((d) => h('button.pt-day' + ((it.data.done || {})[d] ? '.on' : '') + (d === today ? '.today' : ''), { style: '--c:' + it.data.color, title: d, 'aria-pressed': String(!!(it.data.done || {})[d]), 'aria-label': it.data.name + ' ' + d, onClick: () => toggle(it, d) })),
          h('b.pt-streak', '🔥 ' + streak(it.data.done || {})))))
        : emptyState('check', t('No habits yet'), t('Add a habit and tick the days you did it. Your streak grows every day in a row.')));
  }
  paint();
}

// ---------------- Journal ----------------
async function journal(box) {
  const S = store('journal'); let items = await S.list(); let cur = null; let q = '';
  const MOODS = ['😞', '😕', '😐', '🙂', '😄'];
  const ed = h('textarea.input.pt-jtext', { rows: 14, placeholder: t('How was your day?') }); const title = h('input.input', { placeholder: t('Title (optional)') }); let mood = 2; const moodBar = h('div.pt-moods');
  const listEl = h('div.pt-jlist'); const search = h('input.input', { type: 'search', placeholder: t('Search entries'), onInput: (e) => { q = e.target.value.toLowerCase(); paintList(); } });
  const paintMood = () => mount(moodBar, MOODS.map((m, i) => h('button.pt-mood' + (i === mood ? '.on' : ''), { type: 'button', 'aria-label': t('Mood {n} of 5', { n: i + 1 }), onClick: () => { mood = i; paintMood(); } }, m)));
  function open(it) { cur = it || null; title.value = it ? it.data.title || '' : ''; ed.value = it ? it.data.text || '' : ''; mood = it ? it.data.mood ?? 2 : 2; dateEl.textContent = it ? it.data.date : day(); paintMood(); paintList(); ed.focus(); }
  const dateEl = h('span.muted');
  async function save() {
    const id = cur ? cur.id : newId(); const data = { date: cur ? cur.data.date : day(), title: title.value.slice(0, 120), text: ed.value, mood };
    if (!data.text.trim()) return toast(t('Write something first'), 'err');
    try { const n = await S.save(id, data); if (cur) Object.assign(cur, n); else { items.unshift(n); cur = n; } toast(t('Saved'), 'good'); paintList(); } catch (e) { toastErr(e); }
  }
  function paintList() {
    const shown = items.filter((x) => !q || (x.data.title + ' ' + x.data.text).toLowerCase().includes(q)).sort((a, b) => (b.data.date < a.data.date ? -1 : 1));
    mount(listEl, shown.length ? shown.map((x) => h('button.pt-jitem' + (cur === x ? '.on' : ''), { onClick: () => open(x) }, h('span', MOODS[x.data.mood ?? 2]), h('div', h('b', x.data.title || x.data.date), h('div.tiny.muted', x.data.date + ' · ' + (x.data.text || '').slice(0, 60))))) : h('p.muted.small', q ? t('Nothing matches') : t('No entries yet')));
  }
  mount(box, h('div.pt-journal', h('aside', h('button.btn.primary', { onClick: () => open(null) }, icon('plus', 15), t('New entry')), search, listEl),
    h('div.pt-jed', h('div.row', { style: 'gap:8px;align-items:center' }, dateEl, moodBar), title, ed, h('div.row', { style: 'gap:6px' }, h('button.btn.primary', { onClick: save }, t('Save')), h('button.btn.ghost', { onClick: async () => { if (cur && await confirmBox(t('Delete this entry?'), { danger: true })) { await S.del(cur.id); items = items.filter((x) => x !== cur); open(null); } } }, icon('trash', 14), t('Delete'))))));
  open(items.find((x) => x.data.date === day()) || null);
}

// ---------------- Read later ----------------
async function readlater(box) {
  const S = store('readlater'); let items = await S.list(); let view = 'unread';
  const url = h('input.input', { type: 'url', placeholder: 'https://…', 'aria-label': t('Address') }); const add = h('button.btn.primary', t('Save'));
  add.onclick = async () => {
    const u = url.value.trim(); if (!u) return; add.disabled = true;
    try { let meta; try { meta = await api.post('/api/me/tools/readlater/fetch', { url: u }); } catch (e) { if (e.status === 403 || e.status === 400) throw e; meta = { url: u, title: u, desc: '', site: '' }; }
      items.unshift(await S.save(newId(), { url: meta.url, title: meta.title || meta.url, desc: meta.desc, site: meta.site, read: false, added: Date.now() })); url.value = ''; paint(); } catch (e) { toastErr(e); } finally { add.disabled = false; }
  };
  url.addEventListener('keydown', (e) => { if (e.key === 'Enter') add.onclick(); });
  const listEl = h('div.pt-rl');
  async function set(it, patch) { try { Object.assign(it, await S.save(it.id, { ...it.data, ...patch })); paint(); } catch (e) { toastErr(e); } }
  function paint() {
    const shown = items.filter((x) => (view === 'unread' ? !x.data.read : x.data.read));
    mount(listEl, shown.length ? shown.map((x) => h('article.pt-rli', h('div.grow', h('a', { href: x.data.url, target: '_blank', rel: 'noopener noreferrer', onClick: () => { if (!x.data.read) setTimeout(() => set(x, { read: true }), 300); } }, h('b', x.data.title)), x.data.desc ? h('p.small.muted', x.data.desc) : null, h('div.tiny.muted', (x.data.site || '') + ' · ' + new Date(x.data.added || x.created).toLocaleDateString())),
      h('div.row', { style: 'gap:4px' }, h('button.btn.sm', { onClick: () => set(x, { read: !x.data.read }) }, icon('check', 13), x.data.read ? t('Mark unread') : t('Mark read')), h('button.btn.sm.ghost', { title: t('Delete'), 'aria-label': t('Delete'), onClick: async () => { await S.del(x.id); items = items.filter((y) => y !== x); paint(); } }, icon('trash', 13))))) : h('p.muted.small', view === 'unread' ? t('Nothing to read. Save links here to read them later.') : t('Nothing read yet.')));
  }
  mount(box, h('div.row', { style: 'gap:8px;margin-bottom:10px' }, url, add), tabsEl([['unread', t('To read')], ['read', t('Read')]], view, (v) => { view = v; paint(); }), listEl);
  paint();
}

// ---------------- Mind maps ----------------
async function mindmap(box) {
  const S = store('mindmaps'); let maps = await S.list(); let cur = null; let sel = null; let dirty = false; let saveT = 0;
  const svgNS = 'http://www.w3.org/2000/svg'; const stage = h('div.pt-mm');
  const pick = h('select.input', { onChange: (e) => open(maps.find((m) => m.id === e.target.value)) });
  const paintPick = () => mount(pick, maps.map((m) => h('option', { value: m.id, selected: cur && m.id === cur.id }, m.data.root.text || t('Untitled'))));
  async function newMap() { const n = { id: newId(), data: { root: { id: newId(), text: t('Central idea'), kids: [] } } }; maps.unshift(n); await persist(n); open(n); }
  function open(m) { cur = m; sel = m ? m.data.root.id : null; paintPick(); draw(); }
  const find = (n, id, parent = null) => { if (n.id === id) return [n, parent]; for (const k of n.kids || []) { const r = find(k, id, n); if (r) return r; } return null; };
  async function persist(m = cur) { if (!m) return; try { const n = await S.save(m.id, m.data); m.updated = n.updated; dirty = false; } catch (e) { toastErr(e); } }
  const changed = () => { dirty = true; clearTimeout(saveT); saveT = setTimeout(() => persist(), 800); draw(); paintPick(); };
  async function act(kind) {
    if (!cur || !sel) return; const [node, parent] = find(cur.data.root, sel);
    if (kind === 'child') { const n = { id: newId(), text: t('New idea'), kids: [] }; (node.kids = node.kids || []).push(n); sel = n.id; changed(); rename(); }
    else if (kind === 'sibling' && parent) { const n = { id: newId(), text: t('New idea'), kids: [] }; parent.kids.splice(parent.kids.indexOf(node) + 1, 0, n); sel = n.id; changed(); rename(); }
    else if (kind === 'delete' && parent) { parent.kids.splice(parent.kids.indexOf(node), 1); sel = parent.id; changed(); }
    else if (kind === 'fold') { node.fold = !node.fold; changed(); }
  }
  async function rename() { const [node] = find(cur.data.root, sel); const v = await promptBox(t('Rename'), { value: node.text }); if (v != null && v.trim()) { node.text = v.trim().slice(0, 120); changed(); } }
  function layout(n, depth, y0) { // tidy tree: leaves stacked vertically, parents centred on their children
    const kids = n.fold ? [] : n.kids || []; let y = y0; const placed = [];
    for (const k of kids) { const r = layout(k, depth + 1, y); placed.push(r); y = r.bottom + 14; }
    const myY = placed.length ? (placed[0].y + placed[placed.length - 1].y) / 2 : y0 + 18;
    return { n, x: 30 + depth * 210, y: myY, kids: placed, bottom: placed.length ? Math.max(y - 14, myY + 18) : y0 + 36 };
  }
  function draw() {
    if (!cur) { mount(stage, emptyState('branch', t('No mind maps yet'), t('Create one and add ideas around a central topic.'))); return; }
    const L = layout(cur.data.root, 0, 10); const svg = document.createElementNS(svgNS, 'svg'); let maxX = 0, maxY = L.bottom + 20;
    const el = (tag, attrs, txt) => { const e = document.createElementNS(svgNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (txt != null) e.textContent = txt; return e; };
    const walk = (p) => { for (const k of p.kids) { svg.append(el('path', { d: `M${p.x + 180} ${p.y} C${p.x + 195} ${p.y} ${k.x - 15} ${k.y} ${k.x} ${k.y}`, class: 'pt-mm-link' })); walk(k); }
      maxX = Math.max(maxX, p.x + 190); const g = el('g', { class: 'pt-mm-node' + (p.n.id === sel ? ' sel' : '') + (p.n === cur.data.root ? ' root' : ''), tabindex: '0', role: 'button', 'aria-label': p.n.text });
      g.append(el('rect', { x: p.x, y: p.y - 16, width: 180, height: 32, rx: 9 }), el('text', { x: p.x + 90, y: p.y + 5, 'text-anchor': 'middle' }, p.n.text.length > 24 ? p.n.text.slice(0, 23) + '…' : p.n.text));
      if (p.n.fold && (p.n.kids || []).length) g.append(el('text', { x: p.x + 186, y: p.y + 5, class: 'pt-mm-more' }, '+' + p.n.kids.length));
      g.addEventListener('click', () => { sel = p.n.id; draw(); }); g.addEventListener('dblclick', () => { sel = p.n.id; rename(); });
      g.addEventListener('keydown', (e) => { sel = p.n.id; if (e.key === 'Tab') { e.preventDefault(); act('child'); } else if (e.key === 'Enter') { e.preventDefault(); act('sibling'); } else if (e.key === 'Delete') act('delete'); else if (e.key === 'F2') rename(); });
      svg.append(g); };
    walk(L); svg.setAttribute('viewBox', `0 0 ${maxX + 30} ${maxY}`); svg.setAttribute('width', maxX + 30); svg.setAttribute('height', maxY); svg.setAttribute('class', 'pt-mm-svg');
    mount(stage, svg); const s = svg.querySelector('.sel'); if (s) s.focus({ preventScroll: true });
  }
  function exportSvg() { const svg = stage.querySelector('svg'); if (!svg) return; const css = '.pt-mm-link{fill:none;stroke:#94a3b8;stroke-width:2}.pt-mm-node rect{fill:#eef2ff;stroke:#6366f1;stroke-width:1.5}.pt-mm-node.root rect{fill:#6366f1}.pt-mm-node.root text{fill:#fff}.pt-mm-node text{font:600 13px system-ui,sans-serif;fill:#1e1b4b}'; const clone = svg.cloneNode(true); const st = document.createElementNS(svgNS, 'style'); st.textContent = css; clone.prepend(st); const a = h('a', { href: URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' })), download: (cur.data.root.text || 'mindmap') + '.svg' }); a.click(); }
  mount(box, h('div.row.pt-mmbar', pick, h('button.btn.sm.primary', { onClick: newMap }, icon('plus', 14), t('New map')),
    h('button.btn.sm', { onClick: () => act('child') }, t('Add idea') + ' (Tab)'), h('button.btn.sm', { onClick: () => act('sibling') }, t('Add sibling') + ' (Enter)'), h('button.btn.sm', { onClick: rename }, icon('edit', 13), t('Rename')),
    h('button.btn.sm', { onClick: () => act('fold') }, t('Fold / unfold')), h('button.btn.sm.ghost', { onClick: () => act('delete') }, icon('trash', 13)), h('button.btn.sm', { onClick: exportSvg }, icon('download', 13), 'SVG'),
    h('button.btn.sm.ghost', { onClick: async () => { if (cur && await confirmBox(t('Delete this mind map?'), { danger: true })) { await S.del(cur.id); maps = maps.filter((m) => m !== cur); open(maps[0] || null); } } }, t('Delete map'))), stage);
  open(maps[0] || null);
  return () => { if (dirty) persist(); };
}

// ---------------- Password vault (encrypted in the browser) ----------------
const enc = new TextEncoder(); const dec = new TextDecoder();
const b64 = (u8) => btoa(String.fromCharCode(...new Uint8Array(u8))); const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function deriveKey(pass, salt, iter) { const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']); return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); }
async function seal(key, salt, iter, obj) { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj))); return { v: 1, salt: b64(salt), iv: b64(iv), ct: b64(ct), iter }; }
function genPassword(n = 20, sym = true) { const set = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789' + (sym ? '!@#$%^&*-_=+?' : ''); const lim = Math.floor(4294967296 / set.length) * set.length; let out = ''; const one = new Uint32Array(1); while (out.length < n) { crypto.getRandomValues(one); if (one[0] < lim) out += set[one[0] % set.length]; } return out; } // rejection sampling: no modulo bias
async function vault(box) {
  const S = store('vault'); const items = await S.list(); let rec = items.find((x) => x.id === 'main') || null;
  let key = null, salt = null, iter = 310000, entries = [], lockT = 0, base = rec ? rec.updated : null;
  const lock = () => { key = null; entries = []; clearTimeout(lockT); paint(); };
  const touch = () => { clearTimeout(lockT); lockT = setTimeout(() => { lock(); toast(t('Vault locked after 5 minutes without use')); }, 300000); };
  async function persist() { const data = await seal(key, salt, iter, { entries }); const n = await S.save('main', data, base); base = n.updated; rec = n; touch(); }
  function paint() {
    if (!key) {
      const pass = h('input.input', { type: 'password', autocomplete: rec ? 'current-password' : 'new-password', placeholder: t('Master password'), 'aria-label': t('Master password') });
      const pass2 = rec ? null : h('input.input', { type: 'password', autocomplete: 'new-password', placeholder: t('Repeat the master password'), 'aria-label': t('Repeat the master password') });
      const go = h('button.btn.primary', rec ? t('Unlock') : t('Create vault'));
      go.onclick = async () => {
        go.disabled = true;
        try {
          if (!rec) { if (pass.value.length < 10) throw new Error(t('Use at least 10 characters')); if (pass.value !== pass2.value) throw new Error(t('The passwords do not match')); salt = crypto.getRandomValues(new Uint8Array(16)); key = await deriveKey(pass.value, salt, iter); entries = []; await persist(); toast(t('Vault created'), 'good'); }
          else { salt = unb64(rec.data.salt); iter = rec.data.iter || 310000; key = await deriveKey(pass.value, salt, iter); const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(rec.data.iv) }, key, unb64(rec.data.ct)).catch(() => { key = null; throw new Error(t('Wrong master password')); }); entries = JSON.parse(dec.decode(pt)).entries || []; touch(); }
          paint();
        } catch (e) { toastErr(e); } finally { go.disabled = false; }
      };
      pass.addEventListener('keydown', (e) => { if (e.key === 'Enter') go.onclick(); });
      mount(box, h('div.pt-vlock', icon('lock', 34), h('h3', rec ? t('Your vault is locked') : t('Create your password vault')),
        h('p.small.muted', t('Passwords are encrypted in this browser with your master password (AES-256). Nebulix only stores the encrypted vault and cannot read it — if you forget the master password, nobody can recover it.')), pass, pass2, go));
      setTimeout(() => pass.focus()); return;
    }
    const q = h('input.input', { type: 'search', placeholder: t('Search'), onInput: () => paintList() }); const listEl = h('div.pt-vlist');
    const paintList = () => { const s = q.value.toLowerCase(); const shown = entries.filter((e) => !s || (e.site + ' ' + e.user).toLowerCase().includes(s));
      mount(listEl, shown.length ? shown.map((e) => h('div.pt-ventry', h('div.grow', h('b', e.site), h('div.tiny.muted', e.user || '')),
        h('button.btn.sm', { onClick: () => { navigator.clipboard.writeText(e.user || ''); toast(t('User copied')); touch(); } }, t('User')),
        h('button.btn.sm', { onClick: () => { navigator.clipboard.writeText(e.pass || ''); toast(t('Password copied — the clipboard is cleared in 30 s')); setTimeout(() => navigator.clipboard.writeText('').catch(() => {}), 30000); touch(); } }, icon('copy', 13), t('Password')),
        h('button.btn.sm.ghost', { 'aria-label': t('Edit'), onClick: () => edit(e) }, icon('edit', 13)))) : h('p.muted.small', t('No passwords saved yet.'))); };
    mount(box, h('div.row', { style: 'gap:8px;margin-bottom:10px' }, q, h('button.btn.primary', { onClick: () => edit(null) }, icon('plus', 15), t('Add')), h('button.btn', { onClick: lock }, icon('lock', 14), t('Lock'))), listEl);
    paintList();
  }
  function edit(e) {
    const site = h('input.input', { value: e ? e.site : '', placeholder: 'nebulix.fly.dev' }); const user = h('input.input', { value: e ? e.user : '', autocomplete: 'off' }); const pass = h('input.input', { value: e ? e.pass : genPassword(), autocomplete: 'off' }); const note = h('textarea.input', { rows: 2 }); note.value = e ? e.note || '' : '';
    modal({ title: e ? t('Edit password') : t('New password'), body: h('div.col', { style: 'gap:10px' }, field(t('Site or app'), site), field(t('User or email'), user), field(t('Password'), h('div.row', { style: 'gap:6px' }, pass, h('button.btn.sm', { type: 'button', onClick: () => { pass.value = genPassword(); } }, icon('refresh', 13), t('Generate')))), field(t('Note'), note)),
      actions: [...(e ? [{ label: t('Delete'), kind: 'danger', onClick: async () => { entries = entries.filter((x) => x !== e); await persist().catch(toastErr); paint(); } }] : []), { label: t('Cancel'), value: false }, { label: t('Save'), kind: 'primary', onClick: async () => {
        if (!site.value.trim()) { toast(t('Write the site or app'), 'err'); return false; }
        const v = { id: e ? e.id : newId(), site: site.value.trim().slice(0, 120), user: user.value.slice(0, 200), pass: pass.value.slice(0, 500), note: note.value.slice(0, 2000) };
        if (e) Object.assign(e, v); else entries.push(v); entries.sort((a, b) => a.site.localeCompare(b.site));
        try { await persist(); paint(); } catch (er) { toastErr(er); return false; } } }] });
  }
  paint();
  return () => { clearTimeout(lockT); key = null; entries = []; };
}

// ---------------- Scanner ----------------
async function scanner(box) {
  let stream = null; const video = h('video.pt-video', { autoplay: true, playsInline: true, muted: true }); const canvas = h('canvas.pt-scan'); const pages = []; const thumbs = h('div.pt-pages');
  let mode = 'doc';
  // grayscale + automatic levels (makes paper white and ink dark); B&W uses an adaptive threshold so shadows on the page
  // do not turn black. The pixel work runs in the C++ → WebAssembly kernels (imgkit) with a JavaScript fallback.
  async function enhance(src) {
    const c = document.createElement('canvas'); const scale = Math.min(1, 2400 / Math.max(src.width, src.height)); c.width = Math.round(src.width * scale); c.height = Math.round(src.height * scale);
    const g = c.getContext('2d'); g.drawImage(src, 0, 0, c.width, c.height); if (mode === 'photo') return c;
    const im = g.getImageData(0, 0, c.width, c.height); (await imgkit()).docEnhance(im, mode === 'bw' ? 'bw' : 'gray'); g.putImageData(im, 0, 0); return c;
  }
  async function addPage(src) { const c = await enhance(src); pages.push(c); paintPages(); }
  function paintPages() { mount(thumbs, pages.map((c, i) => h('div.pt-page', h('img', { src: c.toDataURL('image/jpeg', 0.6), alt: t('Page {n}', { n: i + 1 }) }), h('button.btn.sm.ghost', { 'aria-label': t('Remove page'), onClick: () => { pages.splice(i, 1); paintPages(); } }, icon('trash', 12))))); pdfBtn.disabled = drvBtn.disabled = !pages.length; }
  async function camera() { try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 } } }); video.srcObject = stream; video.hidden = false; shot.hidden = false; } catch (e) { toast(t('The camera is not available: {e}', { e: e.message }), 'err'); } }
  const shot = h('button.btn.primary', { hidden: true, onClick: () => { canvas.width = video.videoWidth; canvas.height = video.videoHeight; canvas.getContext('2d').drawImage(video, 0, 0); addPage(canvas); } }, icon('camera', 15), t('Capture page'));
  const fileIn = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onChange: async (e) => { for (const f of e.target.files) { const img = await createImageBitmap(f).catch(() => null); if (img) await addPage(img); } } });
  const pdfBtn = h('button.btn', { disabled: true, onClick: async () => download(await makePdf()) }, icon('download', 14), 'PDF');
  const drvBtn = h('button.btn', { disabled: true, onClick: async () => { try { const blob = await makePdf(); await api.put('/api/drive/upload?name=' + encodeURIComponent('Escaneo ' + new Date().toISOString().slice(0, 16).replace('T', ' ') + '.pdf'), blob, { type: 'application/pdf' }); toast(t('Saved to Drive'), 'good'); } catch (e) { toastErr(e); } } }, icon('upload', 14), t('Save to Drive'));
  const download = (blob) => { const a = h('a', { href: URL.createObjectURL(blob), download: 'escaneo.pdf' }); a.click(); };
  async function makePdf() { // a minimal PDF: one JPEG image per A4-proportioned page
    const imgs = await Promise.all(pages.map((c) => new Promise((r) => c.toBlob((b) => b.arrayBuffer().then((ab) => r({ w: c.width, h: c.height, data: new Uint8Array(ab) })), 'image/jpeg', 0.85))));
    const parts = []; const offs = []; let pos = 0; const push = (x) => { const u = typeof x === 'string' ? enc.encode(x) : x; parts.push(u); pos += u.length; };
    const obj = (n, body) => { offs[n] = pos; push(n + ' 0 obj\n'); for (const b of [].concat(body)) push(b); push('\nendobj\n'); };
    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'); const n = imgs.length; const kids = imgs.map((_, i) => (3 + i * 3) + ' 0 R').join(' ');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>'); obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`);
    imgs.forEach((im, i) => { const p = 3 + i * 3; const W = 595, H = Math.round(595 * im.h / im.w); const cs = `q ${W} 0 0 ${H} 0 0 cm /Im${i} Do Q`;
      obj(p, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im${i} ${p + 2} 0 R >> >> /Contents ${p + 1} 0 R >>`);
      obj(p + 1, [`<< /Length ${cs.length} >>\nstream\n`, cs, '\nendstream']);
      obj(p + 2, [`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.data.length} >>\nstream\n`, im.data, '\nendstream']); });
    const xref = pos; const count = 3 + n * 3; let x = `xref\n0 ${count}\n0000000000 65535 f \n`; for (let i = 1; i < count; i++) x += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
    push(x + `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(parts, { type: 'application/pdf' });
  }
  mount(box, h('div.row', { style: 'gap:8px;flex-wrap:wrap;margin-bottom:10px' }, h('button.btn', { onClick: camera }, icon('camera', 15), t('Use camera')), h('button.btn', { onClick: () => fileIn.click() }, icon('image', 15), t('Add photos')), fileIn, shot,
    h('select.input', { style: 'width:auto', 'aria-label': t('Mode'), onChange: (e) => { mode = e.target.value; } }, [['doc', t('Document')], ['bw', t('Black and white')], ['photo', t('Colour photo')]].map(([v, l]) => h('option', { value: v }, l))), pdfBtn, drvBtn),
    h('p.small.muted', t('Point the camera at a page (or add photos) — each page is cleaned up like a scanner and you can save everything as one PDF.')), video, thumbs);
  video.hidden = true;
  return () => { if (stream) stream.getTracks().forEach((tr) => tr.stop()); };
}

const TOOL_FN = { habits, journal, readlater, mindmap, vault, scanner };
export { genPassword };
