// Nebulix OS 14.1 — apps that only exist on the desktop:
//   Files (a small file system kept in this browser), Text editor, Nova Agents (four AI agents that work as a team),
//   Command Center (live status of Nebulix and your account), Widgets (glass widgets you place on the desktop) and Camera.
// Same view contract as every page: { title, mount(root, ctx) → cleanup }.
import { h, mount, ls, fmt, debounce, clamp } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { S } from '../state.js';
import { icon } from '../icons.js';
import { toast, toastErr, confirmBox, promptBox, openMenu, modal } from '../ui.js';

// ================= virtual file system (localStorage) =================
const ROOTS = [['/Home', 'Home', 'home'], ['/Home/Desktop', 'Desktop', 'layout'], ['/Home/Documents', 'Documents', 'note'], ['/Home/Pictures', 'Pictures', 'image'], ['/Home/Music', 'Music', 'music'], ['/Home/Downloads', 'Downloads', 'download']];
export const vfs = {
  load() { let d = ls('os.vfs'); if (!d || !d.n) { d = { n: {} }; for (const [p] of ROOTS) d.n[p] = { d: 1, t: Date.now() }; d.n['/Trash'] = { d: 1, t: Date.now() }; d.n['/Home/Documents/Welcome.md'] = { m: 'text/markdown', v: '# Welcome to Nebulix OS\n\nThis is your own little file system. It lives in this browser.\n\n- Make folders and text files\n- Import pictures and documents from your computer\n- Photos from Camera land in Pictures', t: Date.now() }; vfs.save(d); } return d; },
  save(d) { try { ls('os.vfs', d); return true; } catch { toast(t('Not enough space in this browser for that file'), 'err'); return false; } },
  list(dir) { const d = vfs.load(); const pre = dir.endsWith('/') ? dir : dir + '/'; return Object.entries(d.n).filter(([p]) => p.startsWith(pre) && !p.slice(pre.length).includes('/')).map(([p, x]) => Object.assign({ path: p, name: p.slice(pre.length) }, x)).sort((a, b) => (b.d ? 1 : 0) - (a.d ? 1 : 0) || a.name.localeCompare(b.name)); },
  get(p) { return vfs.load().n[p] || null; },
  write(p, v, m) { const d = vfs.load(); d.n[p] = { m: m || 'text/plain', v, t: Date.now() }; return vfs.save(d); },
  mkdir(p) { const d = vfs.load(); if (d.n[p]) return false; d.n[p] = { d: 1, t: Date.now() }; return vfs.save(d); },
  move(a, b) { const d = vfs.load(); if (d.n[b]) return false; for (const k of Object.keys(d.n)) if (k === a || k.startsWith(a + '/')) { d.n[b + k.slice(a.length)] = d.n[k]; delete d.n[k]; } return vfs.save(d); },
  remove(p) { const d = vfs.load(); for (const k of Object.keys(d.n)) if (k === p || k.startsWith(p + '/')) delete d.n[k]; return vfs.save(d); },
  size(x) { return x.d ? 0 : (x.v || '').length; },
  unique(dir, name) { let n = name; let i = 2; const dot = name.lastIndexOf('.'); while (vfs.get(dir + '/' + n)) { n = dot > 0 ? name.slice(0, dot) + ' (' + i + ')' + name.slice(dot) : name + ' (' + i + ')'; i++; } return dir + '/' + n; },
};
const isText = (x) => x && !x.d && /^text\/|json|markdown/.test(x.m || 'text/plain');
const isImg = (x) => x && !x.d && /^image\//.test(x.m || '');
const FOLDER_COL = { Desktop: '#ec4899', Documents: '#3b82f6', Pictures: '#22c55e', Music: '#a855f7', Downloads: '#f59e0b', Trash: '#64748b' };
function folderArt(name, size = 56) {
  const c = FOLDER_COL[name] || '#facc15';
  const s = h('span.fx-folder', { style: `--fc:${c};width:${size}px;height:${size * 0.8}px` }); return s;
}
function fileArt(x, size = 56) {
  if (isImg(x)) return h('span.fx-thumb', { style: `width:${size}px;height:${size * 0.8}px` }, h('img', { src: x.v, alt: '' }));
  const ext = (x.name.split('.').pop() || '').slice(0, 4).toUpperCase(); return h('span.fx-doc', { style: `width:${size * 0.75}px;height:${size * 0.9}px` }, h('b', ext || 'TXT'));
}

// ================= Files =================
const files = {
  title: () => t('Files'),
  mount(root, ctx) {
    let cwd = (ctx.query && ctx.query.get('dir')) || '/Home'; let view = ls('os.files.view') || 'grid'; let sel = null; let q = ''; const backS = []; const fwdS = [];
    const side = h('aside.fx-side'); const main = h('div.fx-main'); const crumbs = h('div.fx-crumbs'); const status = h('div.fx-status');
    const search = h('input.input.sm.fx-search', { placeholder: t('Search'), onInput: (e) => { q = e.target.value.toLowerCase(); paint(); } });
    const go = (dir, push = true) => { if (push && dir !== cwd) { backS.push(cwd); fwdS.length = 0; } cwd = dir; sel = null; q = ''; search.value = ''; paint(); };
    const tb = (ic, label, fn) => h('button.fx-tb', { title: label, 'aria-label': label, onClick: fn }, icon(ic, 16));
    const openItem = (x) => { if (x.d) return go(x.path); if (isText(x)) return ctx.go('texted', { f: x.path }); if (isImg(x)) return modal({ title: x.name, cls: 'wide', body: h('img', { src: x.v, alt: x.name, style: 'max-width:100%;border-radius:10px' }), actions: [{ label: t('Close'), kind: 'primary' }] }); download(x); };
    const download = (x) => { const a = document.createElement('a'); a.href = isImg(x) ? x.v : URL.createObjectURL(new Blob([x.v || ''], { type: x.m || 'text/plain' })); a.download = x.name; a.click(); };
    const newFolder = async () => { const n = await promptBox(t('New folder'), { label: t('Name'), value: t('New folder') }); if (!n) return; vfs.mkdir(vfs.unique(cwd, n.replace(/\//g, '-'))); paint(); };
    const newFile = async () => { const n = await promptBox(t('New text file'), { label: t('Name'), value: 'note.txt' }); if (!n) return; const p = vfs.unique(cwd, n.replace(/\//g, '-')); vfs.write(p, '', /\.md$/i.test(p) ? 'text/markdown' : 'text/plain'); paint(); ctx.go('texted', { f: p }); };
    const importFiles = () => { const i = h('input', { type: 'file', multiple: true, onChange: async () => { for (const f of i.files) { if (f.size > 2 * 1048576) { toast(t('{n} is too big (max 2 MB)', { n: f.name }), 'err'); continue; } const img = f.type.startsWith('image/'); const v = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); if (img) r.readAsDataURL(f); else r.readAsText(f); }); vfs.write(vfs.unique(cwd, f.name), v, f.type || 'text/plain'); } paint(); } }); i.click(); };
    const ctxMenu = (e, x) => { e.preventDefault(); e.stopPropagation(); sel = x.path; paint(); const inTrash = cwd === '/Trash';
      openMenu([{ label: t('Open'), icon: 'external', onClick: () => openItem(x) }, !x.d ? { label: t('Download'), icon: 'download', onClick: () => download(x) } : null,
        { label: t('Rename'), icon: 'edit', onClick: async () => { const n = await promptBox(t('Rename'), { label: t('Name'), value: x.name }); if (n && n !== x.name) { if (!vfs.move(x.path, cwd + '/' + n.replace(/\//g, '-'))) toast(t('That name is already used'), 'err'); paint(); } } },
        inTrash ? { label: t('Restore'), icon: 'refresh', onClick: () => { vfs.move(x.path, vfs.unique('/Home/Documents', x.name)); paint(); } } : null,
        { hr: true }, { label: inTrash ? t('Delete forever') : t('Move to Trash'), icon: 'trash', danger: true, onClick: async () => { if (inTrash) { if (await confirmBox(t('Delete “{n}” forever?', { n: x.name }), { danger: true })) vfs.remove(x.path); } else vfs.move(x.path, vfs.unique('/Trash', x.name)); paint(); } }].filter(Boolean), e); };
    function paintSide() {
      const item = ([p, l, ic]) => h('button.fx-si' + (cwd === p ? '.on' : ''), { onClick: () => go(p) }, icon(ic, 15), h('span', t(l)));
      mount(side, h('div.fx-sh', t('Favourites')), ROOTS.map(item), h('div.fx-sh', t('System')), item(['/Trash', 'Trash', 'trash']),
        h('div.fx-sh', t('Storage')), (() => { const used = JSON.stringify(vfs.load()).length; return h('div.fx-quota', h('div.fx-qbar', h('i', { style: { width: Math.min(100, used / 50000) + '%' } })), h('span.tiny.muted', fmt.bytes(used) + ' / 5 MB')); })());
    }
    function paint() {
      paintSide(); const parts = cwd.split('/').filter(Boolean);
      mount(crumbs, parts.map((p, i) => [i ? h('span.muted', '›') : null, h('button.fx-crumb', { onClick: () => go('/' + parts.slice(0, i + 1).join('/')) }, t(p))]));
      const list = vfs.list(cwd).filter((x) => !q || x.name.toLowerCase().includes(q));
      if (!list.length) mount(main, h('div.fx-empty', folderArt(cwd.split('/').pop(), 80), h('p.muted', q ? t('Nothing matches “{q}”.', { q }) : t('This folder is empty')), cwd === '/Trash' ? null : h('div.row', { style: 'gap:6px;justify-content:center' }, h('button.btn.sm', { onClick: newFolder }, icon('folder', 14), t('New folder')), h('button.btn.sm', { onClick: importFiles }, icon('upload', 14), t('Import')))));
      else if (view === 'grid') mount(main, h('div.fx-grid', list.map((x) => h('button.fx-it' + (sel === x.path ? '.sel' : ''), { onClick: () => { sel = x.path; paint(); }, onDblclick: () => openItem(x), onContextmenu: (e) => ctxMenu(e, x), onKeydown: (e) => { if (e.key === 'Enter') openItem(x); } }, x.d ? folderArt(x.name) : fileArt(x), h('span.fx-name', x.name), h('span.tiny.muted', x.d ? t('{n} items', { n: vfs.list(x.path).length }) : fmt.bytes(vfs.size(x)))))));
      else mount(main, h('div.fx-list', h('div.fx-lh', h('span.grow', t('Name')), h('span', t('Modified')), h('span', t('Size'))), list.map((x) => h('button.fx-li' + (sel === x.path ? '.sel' : ''), { onClick: () => { sel = x.path; paint(); }, onDblclick: () => openItem(x), onContextmenu: (e) => ctxMenu(e, x) }, x.d ? folderArt(x.name, 22) : fileArt(x, 22), h('span.grow.ellipsis', x.name), h('span.tiny.muted', fmt.rel ? fmt.rel(x.t) : ''), h('span.tiny.muted', x.d ? '—' : fmt.bytes(vfs.size(x)))))));
      mount(status, t('{n} items', { n: list.length }), sel ? ' · ' + sel.split('/').pop() : '');
    }
    const bar = h('div.fx-bar', tb('back', t('Back'), () => { if (backS.length) { fwdS.push(cwd); go(backS.pop(), false); } }), tb('up', t('Up'), () => { const p = cwd.split('/').slice(0, -1).join('/'); if (p) go(p); }), tb('refresh', t('Refresh'), paint), crumbs, h('div.grow'), search,
      tb('folder', t('New folder'), newFolder), tb('plus', t('New text file'), newFile), tb('upload', t('Import'), importFiles), tb(view === 'grid' ? 'menu' : 'grid', t('Change view'), (e) => { view = view === 'grid' ? 'list' : 'grid'; ls('os.files.view', view); mount(e.currentTarget, icon(view === 'grid' ? 'menu' : 'grid', 16)); paint(); }));
    const onStore = () => paint(); addEventListener('nbx:vfs', onStore);
    mount(root, h('div.fx', bar, h('div.fx-body', side, h('div.fx-mainwrap', { onClick: (e) => { if (e.target === e.currentTarget) { sel = null; paint(); } } }, main)), status)); paint();
    return () => removeEventListener('nbx:vfs', onStore);
  },
};

// ================= Text editor =================
let tedLoad = null;
const texted = {
  title: () => t('Text editor'),
  activate(c) { const f = c && c.query && c.query.get('f'); if (f && tedLoad) tedLoad(f); },
  mount(root, ctx) {
    let path = ctx.query && ctx.query.get('f'); let dirty = false; let wrap = ls('os.ted.wrap') !== false; let mono = ls('os.ted.mono') !== false;
    const ta = h('textarea.ted-ta', { spellcheck: 'false', onInput: () => { dirty = true; paintStatus(); } }); const status = h('div.ted-status'); const nameEl = h('b.ted-name');
    const load = (p) => { const x = p && vfs.get(p); path = x ? p : null; ta.value = x ? x.v || '' : ''; dirty = false; paintStatus(); ctx.setTitle && ctx.setTitle((path ? path.split('/').pop() : t('Untitled')) + ' — ' + t('Text editor')); };
    const save = async (as) => { if (!path || as) { const n = await promptBox(t('Save as'), { label: t('Name'), value: path ? path.split('/').pop() : 'note.txt' }); if (!n) return; path = vfs.unique('/Home/Documents', n.replace(/\//g, '-')); } if (vfs.write(path, ta.value, /\.md$/i.test(path) ? 'text/markdown' : 'text/plain')) { dirty = false; toast(t('Saved to {p}', { p: path }), 'good', 1600); dispatchEvent(new Event('nbx:vfs')); paintStatus(); } };
    const openPicker = () => { const all = Object.entries(vfs.load().n).filter(([p, x]) => isText(x) && !p.startsWith('/Trash')).map(([p]) => p);
      modal({ title: t('Open a file'), body: all.length ? h('div.col', { style: 'gap:4px;max-height:50vh;overflow:auto' }, all.map((p) => h('button.btn.ghost', { style: 'justify-content:flex-start', 'data-close': '1', onClick: () => load(p) }, icon('note', 14), p))) : h('p.muted', t('No text files yet.')), actions: [{ label: t('Close') }] }); };
    function paintStatus() { const v = ta.value; mount(status, h('span', t('{n} lines', { n: v.split('\n').length })), h('span', t('{n} words', { n: (v.match(/\S+/g) || []).length })), h('span', path || t('Not saved yet')), dirty ? h('span.ted-dirty', '● ' + t('Unsaved')) : h('span.muted', '✓ ' + t('Saved'))); nameEl.textContent = (dirty ? '● ' : '') + (path ? path.split('/').pop() : t('Untitled')); }
    const applyOpts = () => { ta.style.whiteSpace = wrap ? 'pre-wrap' : 'pre'; ta.style.fontFamily = mono ? 'ui-monospace, "Cascadia Code", Menlo, Consolas, monospace' : 'inherit'; };
    const onKey = (e) => { if (!root.isConnected) return; if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && root.contains(document.activeElement)) { e.preventDefault(); save(e.shiftKey); } };
    ta.addEventListener('keydown', (e) => { if (e.key === 'Tab') { e.preventDefault(); const a = ta.selectionStart; ta.setRangeText('  ', a, ta.selectionEnd, 'end'); dirty = true; paintStatus(); } });
    document.addEventListener('keydown', onKey);
    mount(root, h('div.ted', h('div.ted-bar', nameEl, h('div.grow'), h('button.btn.sm.ghost', { onClick: () => { if (!dirty || confirm(t('Discard the unsaved changes?'))) load(null); } }, icon('plus', 14), t('New')), h('button.btn.sm.ghost', { onClick: openPicker }, icon('folder', 14), t('Open')),
      h('button.btn.sm.primary', { onClick: () => save(false) }, icon('check', 14), t('Save')), h('button.btn.sm.ghost', { onClick: () => save(true) }, t('Save as…')),
      h('button.btn.sm.ghost', { title: t('Word wrap'), onClick: () => { wrap = !wrap; ls('os.ted.wrap', wrap); applyOpts(); } }, '↩'), h('button.btn.sm.ghost', { title: t('Monospace'), onClick: () => { mono = !mono; ls('os.ted.mono', mono); applyOpts(); } }, 'Aa')), ta, status));
    applyOpts(); load(path); setTimeout(() => ta.focus(), 50);
    tedLoad = (f) => { if (f !== path) load(f); };
    return () => { tedLoad = null; document.removeEventListener('keydown', onKey); };
  },
};

// ================= Nova Agents =================
const AGENTS = [
  { id: 'research', name: 'Research agent', ic: 'search', col: '#22c55e', task: 'Scanning sources', role: 'You are the RESEARCH agent of a team. Gather the key facts, options, risks and open questions about the goal. Use short bullet points grouped under headings. No intro.' },
  { id: 'analysis', name: 'Analysis agent', ic: 'chart', col: '#eab308', task: 'Synthesizing data', role: 'You are the ANALYSIS agent. From the research notes, compare the options, find patterns and priorities, and give a clear recommendation with reasons. Use a small Markdown table if it helps.' },
  { id: 'writing', name: 'Writing agent', ic: 'edit', col: '#3b82f6', task: 'Drafting report', role: 'You are the WRITING agent. Turn the research and analysis into a clear, well structured final document for the user (Markdown, headings, steps). Be practical and concrete.' },
  { id: 'review', name: 'Decision agent', ic: 'check', col: '#f97316', task: 'Making a decision', role: 'You are the REVIEW / DECISION agent. Check the draft for mistakes, missing points and risks. Finish with a checklist and a final verdict line that starts with "VERDICT: Approved" or "VERDICT: Needs changes".' },
];
const agents = {
  title: () => t('Nova Agents'),
  mount(root) {
    let running = false; let ac = null; const out = {}; const state = {}; const prog = {};
    const goal = h('textarea.input.ag-goal', { rows: 2, placeholder: t('Give the team a goal, e.g. “Plan a Fortnite-style tournament for my class with rules, prizes and a schedule”') }); goal.value = ls('os.agents.goal') || '';
    const flow = h('div.ag-flow'); const runBtn = h('button.btn.primary', { onClick: () => (running ? stop() : run()) });
    const paintBtn = () => mount(runBtn, icon(running ? 'x' : 'zap', 15), running ? t('Stop') : t('Run the team'));
    const card = (a, i) => { const st = state[a.id] || 'idle';
      return h('section.ag-card.' + st, { style: `--c:${a.col};--i:${i}` }, h('header', h('span.ag-ic', icon(a.ic, 18)), h('div.grow', h('b', t(a.name)), h('small.ag-st', st === 'work' ? t('Working…') : st === 'done' ? t('Done') : st === 'error' ? t('Error') : t('Waiting')))),
        h('div.ag-task', h('span', t(a.task)), h('span', Math.round(prog[a.id] || 0) + '%')), h('div.ag-bar', h('i', { style: { width: (prog[a.id] || 0) + '%' } })),
        h('div.ag-out', out[a.id] ? out[a.id] : h('span.muted', st === 'work' ? '…' : t('Waiting for the previous agent'))), i < AGENTS.length - 1 ? h('i.ag-link' + (st === 'done' ? '.on' : '')) : null); };
    const paint = () => { mount(flow, AGENTS.map(card)); const last = flow.querySelector('.ag-card.work .ag-out'); if (last) last.scrollTop = last.scrollHeight; };
    const final = h('div.ag-final');
    async function run() {
      const g = goal.value.trim(); if (g.length < 6) return toast(t('Write a goal first'), 'err'); ls('os.agents.goal', g);
      running = true; ac = new AbortController(); paintBtn(); for (const a of AGENTS) { out[a.id] = ''; state[a.id] = 'idle'; prog[a.id] = 0; } mount(final); paint();
      const { askNova } = await import('../nova-core.js'); let ctxText = '';
      for (const a of AGENTS) {
        if (!running) break; state[a.id] = 'work'; paint(); let n = 0;
        const prompt = `${a.role}\n\nGOAL: ${g}\n\n${ctxText ? 'WORK FROM THE TEAM SO FAR:\n' + ctxText.slice(-9000) : ''}\n\nAnswer in the same language as the goal.`;
        try { const r = await askNova({ messages: [{ role: 'user', content: prompt }], signal: ac.signal, onText: (d) => { out[a.id] += d; n += d.length; prog[a.id] = Math.min(96, 8 + n / 18); const el = flow.querySelector(`.ag-card:nth-child(${AGENTS.indexOf(a) + 1}) .ag-out`); if (el) { el.textContent = out[a.id]; el.scrollTop = el.scrollHeight; } const b = flow.querySelector(`.ag-card:nth-child(${AGENTS.indexOf(a) + 1}) .ag-bar i`); if (b) b.style.width = prog[a.id] + '%'; } });
          if (r && r.error) throw new Error(r.error); state[a.id] = 'done'; prog[a.id] = 100; ctxText += `\n\n## ${a.name}\n${out[a.id]}`;
        } catch (e) { if (ac.signal.aborted) break; state[a.id] = 'error'; out[a.id] += '\n\n' + (e.message || String(e)); paint(); toastErr(e); break; }
        paint();
      }
      running = false; paintBtn();
      if (AGENTS.every((a) => state[a.id] === 'done')) {
        const report = `# ${g}\n\n${out.writing}\n\n---\n\n## ${t('Review')}\n${out.review}`; const ok = /VERDICT:\s*Approved/i.test(out.review);
        mount(final, h('div.ag-verdict.' + (ok ? 'ok' : 'warn'), icon(ok ? 'check' : 'alert', 18), h('b', ok ? t('The team approved the result') : t('The reviewer asked for changes'))),
          h('div.row', { style: 'gap:6px;flex-wrap:wrap' }, h('button.btn.sm.primary', { onClick: () => { const p = vfs.unique('/Home/Documents', 'Agents report.md'); if (vfs.write(p, report, 'text/markdown')) { dispatchEvent(new Event('nbx:vfs')); toast(t('Saved to {p}', { p }), 'good'); } } }, icon('folder', 14), t('Save to Files')),
            h('button.btn.sm', { onClick: () => navigator.clipboard.writeText(report).then(() => toast(t('Copied!'), 'good')).catch(() => {}) }, icon('copy', 14), t('Copy report')), h('button.btn.sm', { onClick: run }, icon('refresh', 14), t('Run again'))));
      }
    }
    function stop() { running = false; if (ac) ac.abort(); for (const a of AGENTS) if (state[a.id] === 'work') state[a.id] = 'idle'; paintBtn(); paint(); }
    paintBtn(); paint();
    mount(root, h('div.ag', h('div.ag-head', h('div', h('h2', icon('agents', 22), ' ', t('Nova Agents')), h('p.small.muted', t('Four AI agents work as a team on your goal: research, analysis, writing and a final review. Each step uses one Nova message.'))), h('div.ag-goalrow', goal, runBtn)), flow, final));
    return () => stop();
  },
};

// ================= Command Center =================
const command = {
  title: () => t('Command Center'),
  mount(root) {
    const pings = []; let fps = []; let frames = 0, lastT = performance.now(), raf = 0; let data = {};
    const grid = h('div.cc-grid');
    const spark = (vals, col, max) => { const w = 220, hh = 54; const m = max || Math.max(1, ...vals); const pts = vals.map((v, i) => `${(i / Math.max(1, vals.length - 1)) * w},${hh - (v / m) * (hh - 6) - 3}`).join(' ');
      const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', `0 0 ${w} ${hh}`); s.setAttribute('class', 'cc-spark'); s.innerHTML = `<polyline fill="none" stroke="${col}" stroke-width="2.5" points="${pts}"/><polyline fill="${col}22" stroke="none" points="0,${hh} ${pts} ${w},${hh}"/>`; return s; };
    const ring = (pct, col, label) => h('div.cc-ring', { style: `--p:${clamp(pct, 0, 100)};--c:${col}` }, h('b', Math.round(pct) + '%'), h('span', label));
    const panel = (title, ic, col, ...kids) => h('section.cc-panel', { style: `--c:${col}` }, h('header', icon(ic, 15), h('b', title), h('i.cc-led')), ...kids);
    const loop = (now) => { raf = requestAnimationFrame(loop); frames++; if (now - lastT >= 1000) { fps.push(Math.round(frames * 1000 / (now - lastT))); fps = fps.slice(-30); frames = 0; lastT = now; } };
    async function refresh() {
      const t0 = performance.now(); let health = null; try { health = await (await fetch('/api/health', { cache: 'no-store' })).json(); pings.push(Math.round(performance.now() - t0)); } catch { pings.push(0); } while (pings.length > 30) pings.shift();
      const [prog, hub, feed] = await Promise.all([api.get('/api/progress', { quiet: true }).catch(() => null), api.get('/api/hub?mine=1', { quiet: true }).catch(() => null), api.get('/api/feed?n=6', { quiet: true }).catch(() => null)]);
      data = { health, prog, hub, feed }; paint();
    }
    function paint() {
      const { health, prog, hub, feed } = data; const me = S.me; const mem = performance.memory; const online = (S.friends && S.friends.friends || []).filter((f) => S.online.has(f.id));
      const used = hub && hub.usage ? hub.usage.used / Math.max(1, hub.usage.quota) * 100 : 0;
      mount(grid,
        panel(t('Server'), 'server', '#22d3ee', h('div.cc-big', health && health.ok ? h('span.cc-ok', '● ' + t('Online')) : h('span.cc-bad', '● ' + t('Offline'))), h('div.small.muted', 'Nebulix ' + (health ? health.version : '?')), h('div.cc-kv', h('span', t('Response time')), h('b', (pings[pings.length - 1] || 0) + ' ms')), spark(pings, '#22d3ee')),
        panel(t('This device'), 'cpu', '#a78bfa', h('div.cc-rings', ring(Math.min(100, (fps[fps.length - 1] || 0) / 60 * 100), '#a78bfa', (fps[fps.length - 1] || 0) + ' FPS'), ring(mem ? mem.usedJSHeapSize / mem.jsHeapSizeLimit * 100 : 0, '#f472b6', t('Memory'))), h('div.cc-kv', h('span', t('CPU threads')), h('b', String(navigator.hardwareConcurrency || '?'))), h('div.cc-kv', h('span', t('Open windows')), h('b', String(document.querySelectorAll('.os-win').length)))),
        panel(t('Your account'), 'user', '#facc15', h('div.cc-big', '@' + me.username), h('div.cc-kv', h('span', t('Coins')), h('b', me.coins >= 1e9 ? '∞' : fmt.coins(me.coins))), h('div.cc-kv', h('span', t('Gems')), h('b', fmt.compact(me.gems || 0))), prog && prog.level ? h('div.cc-kv', h('span', t('Level')), h('b', String(prog.level.level))) : null, prog && prog.level ? h('div.cc-lvl', h('i', { style: { width: Math.round(prog.level.into / Math.max(1, prog.level.need) * 100) + '%' } })) : null),
        panel(t('Storage'), 'gauge', '#34d399', h('div.cc-rings', ring(used, '#34d399', t('Hub'))), hub && hub.usage ? h('div.small.muted', fmt.bytes(hub.usage.used) + ' / ' + fmt.bytes(hub.usage.quota)) : null, h('div.cc-kv', h('span', t('Files on this desktop')), h('b', fmt.bytes(JSON.stringify(vfs.load()).length)))),
        panel(t('Realtime'), 'wifi', '#60a5fa', h('div.cc-big', S.ws ? h('span.cc-ok', '● ' + t('Connected')) : h('span.cc-bad', '● ' + t('Disconnected'))), h('div.cc-kv', h('span', t('Friends online')), h('b', String(online.length))), h('div.cc-avs', online.slice(0, 8).map((f) => h('span.cc-av', { title: f.username }, (f.displayName || f.username || '?')[0])))),
        panel(t('Live activity'), 'activity', '#fb7185', h('div.cc-feed', feed && feed.items && feed.items.length ? feed.items.slice(0, 6).map((e) => h('div.cc-fi', h('i'), h('span.ellipsis', e.text || e.title || e.t || '…'))) : h('p.small.muted', t('Nothing happening right now.')))));
    }
    raf = requestAnimationFrame(loop); refresh(); const iv = setInterval(refresh, 5000);
    mount(root, h('div.cc', h('div.cc-head', h('h2', icon('gauge', 22), ' ', t('Command Center')), h('span.tiny.muted', t('Refreshes every 5 seconds'))), grid));
    return () => { clearInterval(iv); cancelAnimationFrame(raf); };
  },
};

// ================= Desktop widgets =================
export const WIDGETS = [['clock', 'Clock', 'clock'], ['calendar', 'Calendar', 'calendar'], ['notes', 'Sticky note', 'note'], ['todo', 'To-do list', 'check'], ['timer', 'Timer', 'zap'], ['system', 'System monitor', 'activity'], ['photo', 'Photo frame', 'image'], ['quote', 'Quote of the moment', 'spark']];
const QUOTES = [['Simplicity is the soul of efficiency.', 'Austin Freeman'], ['Make it work, make it right, make it fast.', 'Kent Beck'], ['Stay hungry, stay foolish.', 'Whole Earth Catalog'], ['The best way out is always through.', 'Robert Frost'], ['Done is better than perfect.', 'Proverb'], ['Small steps every day.', 'Proverb']];
const dwState = () => ls('os.dw') || [];
export function addWidget(kind) { const l = dwState(); const n = l.length; const cols = Math.max(1, Math.floor((innerWidth - 480) / 280)); l.push({ id: Date.now(), k: kind, x: 170 + (n % cols) * 280, y: 24 + Math.floor(n / cols) % 3 * 300, d: {} }); ls('os.dw', l); dispatchEvent(new Event('nbx:widgets')); }
export function mountWidgets(layer) {
  const timers = [];
  const save = debounce(() => ls('os.dw', list), 200); let list = dwState();
  function body(w) {
    const d = w.d;
    if (w.k === 'clock') { const el = h('div.dw-clock'); const tick = () => { const n = new Date(); mount(el, h('b', n.toLocaleTimeString(document.documentElement.lang || 'en', { hour: '2-digit', minute: '2-digit', second: '2-digit' })), h('span', n.toLocaleDateString(document.documentElement.lang || 'en', { weekday: 'long', day: 'numeric', month: 'long' }))); }; tick(); timers.push(setInterval(tick, 1000)); return el; }
    if (w.k === 'calendar') { const n = new Date(); const y = n.getFullYear(), m = n.getMonth(); const first = (new Date(y, m, 1).getDay() + 6) % 7; const days = new Date(y, m + 1, 0).getDate(); const cells = []; for (let i = 0; i < first; i++) cells.push(h('i')); for (let i = 1; i <= days; i++) cells.push(h('i' + (i === n.getDate() ? '.on' : ''), String(i)));
      return h('div.dw-cal', h('b', n.toLocaleDateString(document.documentElement.lang || 'en', { month: 'long', year: 'numeric' })), h('div.dw-calg', ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x) => h('i.h', x)), cells)); }
    if (w.k === 'notes') { const ta = h('textarea.dw-note', { placeholder: t('Type something…'), onInput: () => { d.v = ta.value; save(); } }); ta.value = d.v || ''; return ta; }
    if (w.k === 'todo') { const box = h('div.dw-todo'); d.items = d.items || []; const inp = h('input.input.sm', { placeholder: t('Add task…'), onKeydown: (e) => { if (e.key === 'Enter' && inp.value.trim()) { d.items.push({ t: inp.value.trim(), ok: false }); inp.value = ''; save(); paintT(); } } });
      const paintT = () => mount(box, inp, d.items.map((it, i) => h('label.dw-ti' + (it.ok ? '.ok' : ''), h('input', { type: 'checkbox', checked: it.ok, onChange: () => { it.ok = !it.ok; save(); paintT(); } }), h('span.grow', it.t), h('button', { onClick: () => { d.items.splice(i, 1); save(); paintT(); } }, '×')))); paintT(); return box; }
    if (w.k === 'timer') { let left = d.len || 300; let iv = null; const big = h('b.dw-tbig'); const show = () => { big.textContent = String(Math.floor(left / 60)).padStart(2, '0') + ':' + String(left % 60).padStart(2, '0'); };
      const btn = h('button.btn.sm', { onClick: () => { if (iv) { clearInterval(iv); iv = null; btn.textContent = t('Start'); } else { iv = setInterval(() => { left = Math.max(0, left - 1); show(); if (!left) { clearInterval(iv); iv = null; btn.textContent = t('Start'); toast('⏰ ' + t('Time is up!'), 'good'); left = d.len || 300; } }, 1000); timers.push(iv); btn.textContent = t('Pause'); } } }, t('Start'));
      show(); return h('div.dw-timer', big, h('div.row', { style: 'gap:6px;justify-content:center' }, btn, h('button.btn.sm.ghost', { onClick: () => { left = d.len || 300; show(); } }, t('Reset')), h('button.btn.sm.ghost', { onClick: () => { d.len = ({ 300: 600, 600: 1500, 1500: 60, 60: 300 })[d.len || 300]; left = d.len; save(); show(); } }, t('Mode')))); }
    if (w.k === 'system') { const el = h('div.dw-sys'); let fr = 0, lt = performance.now(), fpsV = 0; let rf = 0; const loop = (now) => { rf = requestAnimationFrame(loop); fr++; if (now - lt > 1000) { fpsV = Math.round(fr * 1000 / (now - lt)); fr = 0; lt = now; } }; rf = requestAnimationFrame(loop); timers.push({ raf: rf, stop: () => cancelAnimationFrame(rf) });
      const tick = () => { const m = performance.memory; mount(el, [[t('Frame rate'), fpsV + ' FPS'], [t('Memory'), m ? fmt.bytes(m.usedJSHeapSize) : 'N/A'], [t('CPU threads'), String(navigator.hardwareConcurrency || '?')], [t('Windows'), String(document.querySelectorAll('.os-win').length)], [t('Files'), fmt.bytes(JSON.stringify(vfs.load()).length)]].map(([k, v]) => h('div.dw-kv', h('span', k), h('b', v)))); }; tick(); timers.push(setInterval(tick, 1500)); return el; }
    if (w.k === 'photo') { const pick = () => { const i = h('input', { type: 'file', accept: 'image/*', onChange: () => { const f = i.files[0]; if (!f) return; if (f.size > 1.5 * 1048576) return toast(t('That picture is too big (max 1.5 MB)'), 'err'); const r = new FileReader(); r.onload = () => { d.img = r.result; save(); repaint(); }; r.readAsDataURL(f); } }); i.click(); };
      return d.img ? h('div.dw-photo', { onDblclick: pick, title: t('Double-click to change') }, h('img', { src: d.img, alt: '' })) : h('button.btn.dw-pick', { onClick: pick }, icon('image', 16), t('Choose a picture')); }
    if (w.k === 'quote') { const q = QUOTES[Math.floor(Date.now() / 3600000) % QUOTES.length]; return h('blockquote.dw-quote', '“' + q[0] + '”', h('small', '— ' + q[1])); }
    return h('span');
  }
  function drag(e, w, el) {
    if (e.button !== 0 || e.target.closest('button, input, textarea')) return; e.preventDefault(); const sx = e.clientX, sy = e.clientY, x0 = w.x, y0 = w.y; el.classList.add('drag');
    const mv = (ev) => { w.x = clamp(x0 + ev.clientX - sx, 0, layer.clientWidth - 80); w.y = clamp(y0 + ev.clientY - sy, 0, layer.clientHeight - 40); el.style.transform = `translate(${w.x}px,${w.y}px) rotate(${clamp((ev.movementX || 0) * 0.4, -6, 6)}deg)`; };
    const up = () => { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); el.classList.remove('drag'); el.style.transform = `translate(${w.x}px,${w.y}px)`; save(); };
    document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up);
  }
  function repaint() {
    for (const x of timers.splice(0)) { if (x && x.stop) x.stop(); else clearInterval(x); }
    list = dwState();
    mount(layer, list.map((w) => { const meta = WIDGETS.find((x) => x[0] === w.k) || [w.k, w.k, 'widget'];
      const el = h('div.dw', { style: { transform: `translate(${w.x}px,${w.y}px)` } }, h('header.dw-h', { onPointerdown: (e) => drag(e, w, el) }, icon(meta[2], 13), h('b', t(meta[1])), h('button.dw-x', { 'aria-label': t('Remove'), onClick: () => { list = list.filter((x) => x !== w); ls('os.dw', list); repaint(); } }, '×')), h('div.dw-b', body(w)));
      return el; }));
  }
  addEventListener('nbx:widgets', repaint); repaint();
  return () => { removeEventListener('nbx:widgets', repaint); for (const x of timers.splice(0)) { if (x && x.stop) x.stop(); else clearInterval(x); } };
}
const widgets = {
  title: () => t('Widgets'),
  mount(root) {
    const paint = () => { const have = dwState();
      mount(root, h('div.wg', h('h2', icon('widget', 22), ' ', t('Widgets')), h('p.small.muted', t('Glass widgets for your desktop. Drag them by the title, they stay where you leave them.')),
        h('div.wg-grid', WIDGETS.map(([k, l, ic]) => { const n = have.filter((x) => x.k === k).length; return h('div.wg-card', h('span.wg-ic', icon(ic, 22)), h('b', t(l)), h('span.tiny.muted', n ? t('{n} on the desktop', { n }) : t('Not added')), h('div.row', { style: 'gap:6px' }, h('button.btn.sm.primary', { onClick: () => { addWidget(k); paint(); } }, icon('plus', 13), t('Add')), n ? h('button.btn.sm.ghost', { onClick: () => { ls('os.dw', dwState().filter((x) => x.k !== k)); dispatchEvent(new Event('nbx:widgets')); paint(); } }, t('Remove')) : null)); })),
        have.length ? h('button.btn.sm.ghost', { style: 'margin-top:12px', onClick: () => { ls('os.dw', []); dispatchEvent(new Event('nbx:widgets')); paint(); } }, icon('trash', 13), t('Remove all widgets')) : null)); };
    paint(); const on = () => paint(); addEventListener('nbx:widgets', on); return () => removeEventListener('nbx:widgets', on);
  },
};

// ================= Camera =================
const FILTERS = [['none', 'Normal', 'none'], ['mono', 'Mono', 'grayscale(1) contrast(1.1)'], ['sepia', 'Sepia', 'sepia(.9) contrast(1.05)'], ['vivid', 'Vivid', 'saturate(1.8) contrast(1.15)'], ['cool', 'Cool', 'hue-rotate(-20deg) saturate(1.3) brightness(1.05)'], ['warm', 'Warm', 'sepia(.3) saturate(1.4) hue-rotate(-10deg)'], ['neon', 'Neon', 'hue-rotate(200deg) saturate(2.4) contrast(1.3)'], ['invert', 'X-ray', 'invert(1) grayscale(.4)'], ['dream', 'Dream', 'blur(1.5px) brightness(1.15) saturate(1.3)']];
const camera = {
  title: () => t('Camera'),
  mount(root, ctx) {
    let stream = null; let filter = FILTERS[0]; let mirror = true; let timerS = 0;
    const video = h('video.cam-v', { autoplay: true, playsinline: true, muted: true }); const flash = h('div.cam-flash'); const count = h('div.cam-count'); const strip = h('div.cam-strip'); const msg = h('div.cam-msg');
    const shots = () => vfs.list('/Home/Pictures').filter((x) => isImg(x) && /^Photo /.test(x.name)).slice(-8).reverse();
    const paintStrip = () => mount(strip, shots().map((x) => h('button.cam-shot', { title: x.name, onClick: () => modal({ title: x.name, cls: 'wide', body: h('img', { src: x.v, alt: '', style: 'max-width:100%;border-radius:10px' }), actions: [{ label: t('Close'), kind: 'primary' }] }) }, h('img', { src: x.v, alt: '' }))));
    async function start() { try { stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }); video.srcObject = stream; mount(msg); } catch (e) { mount(msg, icon('camera', 28), h('p', t('Allow the camera to take photos. Nothing is uploaded: photos stay in your Files.')), h('button.btn.primary', { onClick: start }, t('Try again')), h('p.tiny.muted', String(e.message || e))); } }
    const applyF = () => { video.style.filter = filter[2]; video.style.transform = mirror ? 'scaleX(-1)' : 'none'; };
    async function shoot() {
      if (!stream) return; for (let s = timerS; s > 0; s--) { count.textContent = String(s); count.classList.add('on'); await new Promise((r) => setTimeout(r, 1000)); } count.classList.remove('on');
      const c = document.createElement('canvas'); c.width = video.videoWidth || 1280; c.height = video.videoHeight || 720; const g = c.getContext('2d'); g.filter = filter[2]; if (mirror) { g.translate(c.width, 0); g.scale(-1, 1); } g.drawImage(video, 0, 0, c.width, c.height);
      flash.classList.remove('on'); void flash.offsetWidth; flash.classList.add('on'); try { (await import('../sfx.js')).sfx.click(); } catch {}
      const url = c.toDataURL('image/jpeg', 0.82); const name = 'Photo ' + new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '-') + '.jpg';
      if (vfs.write('/Home/Pictures/' + name, url, 'image/jpeg')) { dispatchEvent(new Event('nbx:vfs')); paintStrip(); toast(t('Saved to Pictures'), 'good', 1400); }
    }
    const fbar = h('div.cam-filters'); const paintF = () => mount(fbar, FILTERS.map((f) => h('button' + (f === filter ? '.on' : ''), { onClick: () => { filter = f; applyF(); paintF(); } }, t(f[1]))));
    const tBtn = h('button.btn.sm.ghost', { onClick: () => { timerS = { 0: 3, 3: 10, 10: 0 }[timerS]; tBtn.textContent = '⏱ ' + (timerS ? timerS + ' s' : t('Off')); } }, '⏱ ' + t('Off'));
    mount(root, h('div.cam', h('div.cam-stage', video, flash, count, msg), h('div.cam-bar', h('button.btn.sm.ghost', { onClick: () => { mirror = !mirror; applyF(); } }, '⇋ ' + t('Mirror')), tBtn, h('button.cam-btn', { 'aria-label': t('Take a photo'), onClick: shoot }), h('button.btn.sm.ghost', { onClick: () => ctx.go('files', { dir: '/Home/Pictures' }) }, icon('folder', 14), t('Pictures'))), fbar, strip));
    paintF(); applyF(); paintStrip(); start();
    return () => { if (stream) stream.getTracks().forEach((x) => x.stop()); };
  },
};

export const OS_APPS2 = { files, texted, agents, command, widgets, camera };
