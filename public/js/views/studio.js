// Nebulix Studio: a code editor in the style of a desktop IDE, built on Monaco (the editor engine of VS Code, MIT).
// Explorer, tabs, search across files, source control (commit to a Nebulix Code repo), live preview and a
// local workspace saved in this browser. #/studio = local workspace · #/studio/<owner>/<repo>?path=…
import { setupCopilot, copilotPanel } from '../studio-copilot.js';
import { h, mount, ls } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { toast, toastErr, loading, emptyState, promptBox, confirmBox, openMenu } from '../ui.js';
import * as theme from '../theme.js';

let monacoP = null;
function loadMonaco() {
  if (monacoP) return monacoP;
  monacoP = new Promise((resolve, reject) => {
    if (window.monaco) return resolve(window.monaco);
    window.MonacoEnvironment = { getWorkerUrl: () => '/js/vendor/monaco/vs/base/worker/workerMain.js' };
    const s = document.createElement('script'); s.src = '/js/vendor/monaco/vs/loader.js';
    s.onload = () => { window.require.config({ paths: { vs: '/js/vendor/monaco/vs' } }); window.require(['vs/editor/editor.main'], () => resolve(window.monaco), reject); };
    s.onerror = () => reject(new Error('Could not load the editor'));
    document.head.appendChild(s);
  });
  monacoP.catch(() => { monacoP = null; });
  return monacoP;
}
const SAMPLE = {
  'index.html': '<!doctype html>\n<html lang="es">\n<head>\n  <meta charset="utf-8">\n  <title>Mi proyecto</title>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  <h1>¡Hola, Nebulix!</h1>\n  <button id="btn">Púlsame</button>\n  <p id="out"></p>\n  <script src="main.js"></script>\n</body>\n</html>\n',
  'style.css': 'body {\n  font-family: system-ui, sans-serif;\n  background: #0b0c10;\n  color: #ececef;\n  display: grid;\n  place-items: center;\n  min-height: 100vh;\n  margin: 0;\n}\nbutton {\n  padding: 10px 18px;\n  border-radius: 10px;\n  border: 0;\n  background: #7c5cff;\n  color: #fff;\n  font-size: 1rem;\n  cursor: pointer;\n}\n',
  'main.js': "let n = 0;\ndocument.getElementById('btn').addEventListener('click', () => {\n  n++;\n  document.getElementById('out').textContent = `Has pulsado ${n} ${n === 1 ? 'vez' : 'veces'}`;\n});\n",
  'README.md': '# Mi proyecto\n\nEditado con **Nebulix Studio**. Pulsa ▶ para la vista previa.\n',
};

export default {
  full: true,
  title: () => 'Nebulix Studio',
  async mount(root, ctx) {
    const [owner, repoName] = ctx.params; const repoMode = !!(owner && repoName); const base = repoMode ? `${owner}/${repoName}` : null;
    const wrap = h('div.st'); mount(root, wrap, loading(t('Opening Nebulix Studio…')));
    let monaco; try { monaco = await loadMonaco(); } catch (e) { mount(wrap, emptyState('alert', t('Could not load the editor'), e.message)); return () => {}; }
    // ---------- workspace ----------
    const files = new Map(); // path -> { text, orig, binary, model }
    let repo = null; let canWrite = true; let headId = null;
    if (repoMode) {
      try {
        const d = await api.get(`/api/code/r/${base}`); repo = d.repo; canWrite = d.repo.canWrite; headId = d.commit ? d.commit.id : null;
        await Promise.all(d.files.map(async (f) => { if (f.size > 2 * 1048576) { files.set(f.path, { binary: true, orig: null, text: null }); return; } try { const x = await api.get(`/api/code/r/${base}/file?path=${encodeURIComponent(f.path)}`, { quiet: true }); files.set(f.path, x.binary ? { binary: true } : { text: x.text, orig: x.text }); } catch {} }));
      } catch (e) { mount(wrap, emptyState('alert', t('Repository not found'), e.message)); return () => {}; }
    } else {
      const saved = ls('studio.local') || SAMPLE; for (const [p, txt] of Object.entries(saved)) files.set(p, { text: txt, orig: txt });
    }
    const newPath = ctx.query.get('path'); if (newPath && !files.has(newPath) && ctx.query.get('new')) files.set(newPath, { text: '', orig: null });
    const isDirty = (f) => !f.binary && f.text !== f.orig;
    const persistLocal = () => { if (!repoMode) { const o = {}; for (const [p, f] of files) if (!f.deleted) o[p] = f.text; ls('studio.local', o); for (const f of files.values()) f.orig = f.text; } };

    // ---------- layout ----------
    let panel = 'files'; const open = []; let active = null;
    const act = (id, ic, label) => h('button.st-act', { title: label, dataset: { id }, onClick: () => { panel = panel === id ? null : id; paintSide(); } }, icon(ic, 22));
    const activity = h('div.st-actbar', act('files', 'copy', t('Explorer')), act('search', 'search', t('Search')), act('git', 'layers', t('Source control')), act('copilot', 'spark', 'Nova Copilot'), h('div.grow'), h('button.st-act', { title: t('Back to Nebulix'), onClick: () => ctx.go(repoMode ? 'code' : 'home', repoMode ? base : undefined) }, icon('back', 20)));
    const side = h('div.st-side'); const tabsEl = h('div.st-tabs'); const edHost = h('div.st-editor'); const welcome = h('div.st-welcome');
    const status = h('div.st-status'); const preview = h('div.st-preview'); preview.style.display = 'none';
    const runBtn = h('button.st-run', { title: t('Live preview'), onClick: () => togglePreview() }, icon('play', 15), t('Run'));
    const title = h('div.st-title', icon('terminal', 14), h('b', repoMode ? base : t('Local workspace')), h('span.grow'), runBtn);
    mount(wrap, h('div.st-top', title), h('div.st-main', activity, side, h('div.st-center', tabsEl, h('div.st-edwrap', edHost, welcome), preview)), status);
    const dark = (theme.getTheme() || {}).mode !== 'light';
    monaco.editor.setTheme(dark ? 'vs-dark' : 'vs');
    const editor = monaco.editor.create(edHost, { automaticLayout: true, fontSize: 14, minimap: { enabled: innerWidth > 900 }, fontLigatures: true, smoothScrolling: true, cursorSmoothCaretAnimation: 'on', bracketPairColorization: { enabled: true }, scrollBeyondLastLine: false, tabSize: 2, renderWhitespace: 'selection', readOnly: !canWrite, model: null });
    const modelFor = (p) => { const f = files.get(p); if (!f.model) { f.model = monaco.editor.createModel(f.text || '', undefined, monaco.Uri.parse('file:///' + p.split('/').map(encodeURIComponent).join('/'))); f.model.onDidChangeContent(() => { f.text = f.model.getValue(); paintTabs(); if (panel === 'git') paintSide(); paintStatus(); }); } return f.model; };
    function openFile(p) {
      const f = files.get(p); if (!f) return; if (f.binary) { toast(t('Binary file — it cannot be edited here.'), 'info'); return; }
      if (!open.includes(p)) open.push(p); active = p; editor.setModel(modelFor(p)); welcome.style.display = 'none'; edHost.style.visibility = 'visible'; editor.focus(); paintTabs(); paintStatus(); if (panel === 'files') paintSide();
    }
    function closeTab(p) { const i = open.indexOf(p); if (i < 0) return; open.splice(i, 1); if (active === p) { active = open[Math.min(i, open.length - 1)] || null; if (active) editor.setModel(modelFor(active)); else { editor.setModel(null); welcome.style.display = 'flex'; edHost.style.visibility = 'hidden'; } } paintTabs(); paintStatus(); }
    function paintTabs() { mount(tabsEl, open.map((p) => { const f = files.get(p); return h('div.st-tab' + (p === active ? '.on' : ''), { title: p, onClick: () => openFile(p), onAuxclick: (e) => { if (e.button === 1) closeTab(p); } }, h('span.st-fi', fileIcon(p)), h('span', p.split('/').pop()), h('button.st-x', { onClick: (e) => { e.stopPropagation(); closeTab(p); } }, isDirty(f) ? '●' : '×')); })); }
    function paintStatus() { const f = active && files.get(active); const pos = editor.getPosition(); const m = editor.getModel();
      const dirty = [...files.values()].filter((x) => isDirty(x) || x.deleted).length;
      mount(status, h('span', icon('layers', 12), ' main'), repoMode ? h('span', dirty ? t('{n} changes', { n: dirty }) : t('Up to date')) : h('span', t('Saved in this browser')), h('span.grow'), m && pos ? h('span', `Ln ${pos.lineNumber}, Col ${pos.column}`) : null, m ? h('span', m.getLanguageId()) : null, h('span', 'UTF-8'), f && isDirty(f) ? h('span', '●') : null); }
    editor.onDidChangeCursorPosition(() => paintStatus());
    // ---------- Nova Copilot ----------
    let cpState = 'idle'; const cpBadge = h('span.st-cp', { title: 'Nova Copilot' });
    const paintCp = () => mount(cpBadge, '✨ ', cpState === 'busy' ? t('Copilot…') : cpState === 'off' ? t('Copilot: needs an AI key') : 'Copilot');
    const copilot = setupCopilot(monaco, editor, { fileName: () => active || '', onStatus: (st) => { cpState = st; paintCp(); } }); paintCp(); status.after(cpBadge);
    const cp = copilotPanel(monaco, editor, { fileName: () => active || '' });
    const openCp = (prompt) => { panel = 'copilot'; paintSide(); if (prompt) cp.ask(prompt); else setTimeout(() => cp.focus(), 30); };
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI, () => openCp());
    for (const [id, label, prompt] of [['explain', 'Nova: ' + t('Explain'), t('Explain what this code does, step by step, in simple words.')], ['fix', 'Nova: ' + t('Fix bugs'), t('Find the bugs or problems in this code. Explain each one briefly, then give the corrected code.')], ['refactor', 'Nova: ' + t('Refactor'), t('Refactor this code to be cleaner and more readable without changing what it does. Give the full new code.')]])
      editor.addAction({ id: 'nova-' + id, label, contextMenuGroupId: '0_nova', run: () => openCp(prompt) });
    // ---------- side panels ----------
    function tree() { const root = { d: {}, f: [] }; for (const [p, f] of files) { if (f.deleted) continue; const parts = p.split('/'); let n = root; for (const k of parts.slice(0, -1)) n = n.d[k] = n.d[k] || { d: {}, f: [] }; n.f.push(p); } return root; }
    const collapsed = new Set();
    function paintTree(n, prefix, depth) {
      const out = [];
      for (const k of Object.keys(n.d).sort()) { const full = prefix + k; const c = collapsed.has(full); out.push(h('div.st-node.dir', { style: `--d:${depth}`, onClick: () => { c ? collapsed.delete(full) : collapsed.add(full); paintSide(); }, onContextmenu: (e) => { e.preventDefault(); menuFor(full + '/', e); } }, h('span.st-chev', c ? '▸' : '▾'), k)); if (!c) out.push(...paintTree(n.d[k], full + '/', depth + 1)); }
      for (const p of n.f.sort()) { const f = files.get(p); out.push(h('div.st-node' + (p === active ? '.on' : '') + (isDirty(f) ? '.dirty' : ''), { style: `--d:${depth}`, onClick: () => openFile(p), onContextmenu: (e) => { e.preventDefault(); menuFor(p, e); } }, h('span.st-fi', fileIcon(p)), p.split('/').pop())); }
      return out;
    }
    function menuFor(p, e) { openMenu([{ label: t('New file'), icon: 'plus', onClick: () => newFile(p.endsWith('/') ? p : p.split('/').slice(0, -1).join('/') + (p.includes('/') ? '/' : '')) }, ...(p.endsWith('/') ? [] : [{ label: t('Rename'), icon: 'edit', onClick: () => rename(p) }, { label: t('Delete'), icon: 'trash', danger: true, onClick: () => del(p) }])], { getBoundingClientRect: () => ({ left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY, width: 0, height: 0 }) }); }
    function paintSide() {
      for (const b of activity.querySelectorAll('.st-act[data-id]')) b.classList.toggle('on', b.dataset.id === panel);
      side.style.display = panel ? '' : 'none'; if (!panel) return;
      if (panel === 'files') return mount(side, h('div.st-sh', h('span.grow', t('Explorer')), canWrite ? h('button.st-ib', { title: t('New file'), onClick: () => newFile('') }, icon('plus', 15)) : null, h('button.st-ib', { title: t('Upload'), onClick: uploadFiles }, icon('upload', 15))), h('div.st-tree', paintTree(tree(), '', 0)));
      if (panel === 'copilot') { mount(side, cp.el); side.classList.add('wide'); return; }
      side.classList.remove('wide');
      if (panel === 'search') {
        const inp = h('input.input.sm', { placeholder: t('Search'), autofocus: true }); const res = h('div.st-res');
        inp.addEventListener('input', () => { const q = inp.value; if (q.length < 2) return mount(res); const hits = []; for (const [p, f] of files) { if (f.binary || f.deleted || !f.text) continue; f.text.split('\n').forEach((l, i) => { if (hits.length < 200 && l.toLowerCase().includes(q.toLowerCase())) hits.push([p, i + 1, l.trim().slice(0, 90)]); }); }
          mount(res, hits.map(([p, ln, l]) => h('div.st-hit', { onClick: () => { openFile(p); editor.revealLineInCenter(ln); editor.setPosition({ lineNumber: ln, column: 1 }); } }, h('b.tiny', p + ':' + ln), h('div.tiny.muted', l)))); });
        mount(side, h('div.st-sh', t('Search')), h('div', { style: 'padding:8px' }, inp), res); setTimeout(() => inp.focus(), 20); return;
      }
      if (panel === 'git') {
        const changed = [...files.entries()].filter(([, f]) => isDirty(f) || f.deleted);
        const msg = h('textarea.input', { rows: 2, placeholder: repoMode ? t('Commit message') : t('Changes are saved in this browser') });
        mount(side, h('div.st-sh', t('Source control')),
          repoMode ? h('div', { style: 'padding:8px;display:flex;flex-direction:column;gap:6px' }, msg, h('button.btn.primary.sm', { disabled: !changed.length || !canWrite, onClick: () => commitAll(msg.value) }, icon('check', 14), t('Commit {n}', { n: changed.length }))) :
            h('div', { style: 'padding:8px;display:flex;flex-direction:column;gap:6px' }, h('button.btn.primary.sm', { onClick: publishLocal }, icon('upload', 14), t('Publish to Nebulix Code'))),
          h('div.st-tree', changed.map(([p, f]) => h('div.st-node.' + (f.deleted ? 'del' : f.orig == null ? 'add' : 'mod'), { style: '--d:0', onClick: () => !f.deleted && openFile(p) }, h('span.st-fi', f.deleted ? 'D' : f.orig == null ? 'A' : 'M'), p))));
      }
    }
    function fileIcon(p) { const e = p.split('.').pop().toLowerCase(); return ({ js: 'JS', mjs: 'JS', ts: 'TS', html: '<>', css: '#', json: '{}', md: 'M↓', py: 'PY', png: '▣', jpg: '▣', svg: '▣' }[e] || '·'); }
    // ---------- file operations ----------
    async function newFile(dir) { const p = await promptBox(t('New file'), { label: t('File name (use / for folders)'), value: dir || '', placeholder: 'src/app.js' }); if (!p || !p.trim()) return; const path = p.trim().replace(/^\/+/, ''); if (files.has(path) && !files.get(path).deleted) { openFile(path); return; } files.set(path, { text: '', orig: null }); paintSide(); openFile(path); }
    async function rename(p) { const n = await promptBox(t('Rename'), { value: p }); if (!n || n === p) return; const f = files.get(p); files.set(n.trim(), { text: f.text, orig: null }); if (repoMode) files.set(p, Object.assign(f, { deleted: true, model: null })); else files.delete(p); if (f.model) f.model.dispose(); closeTab(p); persistLocal(); paintSide(); openFile(n.trim()); }
    async function del(p) { if (!(await confirmBox(t('Delete {f}?', { f: p }), { danger: true }))) return; const f = files.get(p); closeTab(p); if (f.model) { f.model.dispose(); f.model = null; } if (repoMode && f.orig != null) f.deleted = true; else files.delete(p); persistLocal(); paintSide(); paintStatus(); }
    function uploadFiles() { const inp = h('input', { type: 'file', multiple: true }); inp.onchange = async () => { for (const fl of inp.files) { if (fl.size > 2 * 1048576) { toast(t('{f} is larger than 2 MB — skipped', { f: fl.name }), 'err'); continue; } files.set(fl.name, { text: await fl.text(), orig: null }); } persistLocal(); paintSide(); }; inp.click(); }
    async function commitAll(message) {
      const changes = []; for (const [p, f] of files) { if (f.deleted) changes.push({ path: p, delete: true }); else if (isDirty(f)) changes.push({ path: p, text: f.text }); }
      if (!changes.length) return;
      try { const r = await api.post(`/api/code/r/${base}/commit`, { message: message || t('Update {n} files', { n: changes.length }), changes }); headId = r.commit.id;
        for (const [p, f] of [...files]) { if (f.deleted) files.delete(p); else f.orig = f.text; } toast(t('Committed: {m}', { m: r.commit.msg }), 'good'); paintSide(); paintTabs(); paintStatus();
      } catch (e) { toastErr(e); }
    }
    async function publishLocal() {
      const name = await promptBox(t('Publish to Nebulix Code'), { label: t('Repository name'), placeholder: 'mi-proyecto' }); if (!name) return;
      try { const r = await api.post('/api/code/repos', { name: name.trim(), public: true, readme: false }); const changes = [...files].filter(([, f]) => !f.deleted && !f.binary).map(([p, f]) => ({ path: p, text: f.text }));
        await api.post(`/api/code/r/${r.repo.owner}/${r.repo.name}/commit`, { message: 'Initial commit from Nebulix Studio', changes }); toast(t('Published!'), 'good'); ctx.go('code', `${r.repo.owner}/${r.repo.name}`);
      } catch (e) { toastErr(e); }
    }
    // ---------- live preview (sandboxed, served by Nebulix) ----------
    let pvOpen = false;
    async function togglePreview(force) {
      pvOpen = force === undefined ? !pvOpen : force; preview.style.display = pvOpen ? 'flex' : 'none'; runBtn.classList.toggle('on', pvOpen); if (!pvOpen) return;
      const out = {}; for (const [p, f] of files) if (!f.deleted && !f.binary && f.text != null) out[p] = f.text;
      if (!Object.keys(out).some((p) => /(^|\/)index\.html$/.test(p))) { mount(preview, h('div.empty', h('p', t('Add an index.html to preview your project.')))); return; }
      try { const r = await api.post('/api/code/scratch', { files: out }); const entry = active && /\.html?$/.test(active) ? active : Object.keys(out).find((p) => p === 'index.html') || Object.keys(out).find((p) => /index\.html$/.test(p));
        mount(preview, h('div.st-pvbar', icon('globe', 13), h('span.grow.tiny', entry), h('button.st-ib', { title: t('Reload'), onClick: () => togglePreview(true) }, icon('refresh', 14)), h('button.st-ib', { title: t('Open in a new tab'), onClick: () => window.open(r.url + entry.split('/').map(encodeURIComponent).join('/'), '_blank', 'noopener') }, icon('external', 14)), h('button.st-ib', { onClick: () => togglePreview(false) }, icon('x', 14))),
          h('iframe.st-frame', { src: r.url + entry.split('/').map(encodeURIComponent).join('/'), title: 'Preview' }));
      } catch (e) { toastErr(e); }
    }
    // keyboard: Ctrl+S saves (local) or stages (repo), Ctrl+Enter = run
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => { if (repoMode) { panel = 'git'; paintSide(); toast(t('Write a message and commit your changes.'), 'info', 2500); } else { persistLocal(); paintTabs(); toast(t('Saved'), 'good', 1200); } if (pvOpen) togglePreview(true); });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => togglePreview(true));
    mount(welcome, h('div.st-wl', h('div.st-wlogo', icon('terminal', 40)), h('h2', 'Nebulix Studio'), h('p.muted', t('Open a file from the Explorer.')), h('div.tiny.muted', 'Ctrl+S ' + t('save') + ' · Ctrl+Enter ' + t('run') + ' · F1 ' + t('commands'))));
    edHost.style.visibility = 'hidden';
    paintSide(); paintTabs(); paintStatus();
    const first = newPath && files.has(newPath) ? newPath : files.has('index.html') ? 'index.html' : [...files.keys()].find((p) => /readme/i.test(p)) || [...files.keys()][0];
    if (first) openFile(first);
    const autosave = setInterval(() => { if (!repoMode) persistLocal(); }, 5000);
    const beforeUnload = (e) => { if (repoMode && [...files.values()].some((f) => isDirty(f) || f.deleted)) { e.preventDefault(); e.returnValue = ''; } }; addEventListener('beforeunload', beforeUnload);
    return () => { copilot.dispose(); clearInterval(autosave); persistLocal(); removeEventListener('beforeunload', beforeUnload); for (const f of files.values()) if (f.model) f.model.dispose(); editor.dispose(); };
  },
};
