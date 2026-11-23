// Nebulix Code: a code forge. Routes:
//   #/code                       dashboard (your repositories, explore, starred)
//   #/code/<user>                profile (overview with pinned repos + contribution graph, repositories, stars)
//   #/code/<o>/<r>[?ref&dir]     code (branch picker, file table with last commits, README, about, languages)
//   #/code/<o>/<r>/f/<path>      file · /commits · /commit/<id> · /issues[/new|/<n>] · /pulls[/new|/<n>] · /branches · /settings
// Editing opens Nebulix Studio (#/studio/<owner>/<repo>).
import { h, mount, fmt } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { S } from '../state.js';
import { icon } from '../icons.js';
import { toast, toastErr, loading, emptyState, busy, field, confirmBox, promptBox, modal, switchEl, openMenu } from '../ui.js';
import { avatarEl } from '../cosmetics.js';
import { mdToEls } from '../md.js';

const LANGC = { JavaScript: '#f1e05a', TypeScript: '#3178c6', Python: '#3572A5', HTML: '#e34c26', CSS: '#563d7c', SCSS: '#c6538c', Java: '#b07219', 'C++': '#f34b7d', C: '#555555', 'C#': '#178600', Go: '#00ADD8', Rust: '#dea584', PHP: '#4F5D95', Ruby: '#701516', Lua: '#000080', Shell: '#89e051', Kotlin: '#A97BFF', Swift: '#F05138', Vue: '#41b883', Svelte: '#ff3e00', Dart: '#00B4AB', SQL: '#e38c00' };
const LABELC = { bug: '#d73a4a', enhancement: '#a2eeef', question: '#d876e3', documentation: '#0075ca', 'good first issue': '#7057ff', 'help wanted': '#008672', wontfix: '#cfd3d7' };
const size = (n) => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
const b64 = (buf) => { let s = ''; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
const enc = (p) => p.split('/').map(encodeURIComponent).join('/');
const sha7 = (id) => String(id || '').slice(0, 7);
const lang = (l) => h('span.gh-lang', h('i', { style: { background: LANGC[l] || '#8b949e' } }), l);
const label = (l) => h('span.gh-label', { style: { '--lc': LABELC[l] || '#8b949e' } }, l);
const dayKey = (ms) => new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

// line diff: trims the common prefix/suffix, then an LCS table for the middle (falls back to replace-all if huge)
function diffLines(a, b) {
  const A = a.split('\n'); const B = b.split('\n'); let s = 0; while (s < A.length && s < B.length && A[s] === B[s]) s++;
  let ea = A.length; let eb = B.length; while (ea > s && eb > s && A[ea - 1] === B[eb - 1]) { ea--; eb--; }
  const out = []; for (let i = 0; i < s; i++) out.push([' ', A[i], i + 1, i + 1]);
  const x = A.slice(s, ea); const y = B.slice(s, eb);
  if (x.length * y.length > 4e6) { x.forEach((l, i) => out.push(['-', l, s + i + 1, null])); y.forEach((l, i) => out.push(['+', l, null, s + i + 1])); }
  else {
    const n = x.length; const m = y.length; const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    let i = 0; let j = 0; while (i < n || j < m) { if (i < n && j < m && x[i] === y[j]) { out.push([' ', x[i], s + i + 1, s + j + 1]); i++; j++; } else if (i < n && (j >= m || L[i + 1][j] >= L[i][j + 1])) { out.push(['-', x[i], s + i + 1, null]); i++; } else { out.push(['+', y[j], null, s + j + 1]); j++; } }
  }
  for (let i = ea, j = eb; i < A.length; i++, j++) out.push([' ', A[i], i + 1, j + 1]);
  return out;
}
function diffView(f) {
  const ops = f.binary ? [] : diffLines(f.before || '', f.after || '');
  const add = ops.filter((o) => o[0] === '+').length; const del = ops.filter((o) => o[0] === '-').length;
  // collapse unchanged runs, keeping 3 lines of context
  const rows = []; let run = [];
  const flush = (end) => { const lead = rows.length === 0; if (run.length <= 7) rows.push(...run); else { const hd = lead ? [] : run.slice(0, 3); const tl = end ? [] : run.slice(-3); rows.push(...hd, ['@', t('{n} unchanged lines', { n: run.length - hd.length - tl.length })], ...tl); } run = []; };
  for (const o of ops) { if (o[0] === ' ') run.push(o); else { flush(false); rows.push(o); } } flush(true);
  const open = { v: true }; const body = h('table.gh-diff', rows.map((o) => o[0] === '@' ? h('tr.hunk', h('td', { colspan: 3 }, '⋯ ' + o[1])) : h('tr.' + (o[0] === '+' ? 'add' : o[0] === '-' ? 'del' : 'ctx'), h('td.ln', o[2] || ''), h('td.ln', o[3] || ''), h('td.code', h('span.sig', o[0] === ' ' ? ' ' : o[0]), o[1]))));
  const box = h('div.gh-box.gh-dfile', h('div.gh-box-h.gh-dhead', { onClick: () => { open.v = !open.v; body.style.display = open.v ? '' : 'none'; } }, h('span.gh-dstat', h('b.add', '+' + add), ' ', h('b.del', '−' + del)), h('code', f.p), h('span.pill.tiny', f.a === 'add' ? t('added') : f.a === 'del' ? t('deleted') : t('modified'))),
    f.binary ? h('div.gh-pad.muted.small', t('Binary file not shown.')) : body);
  return box;
}
function contribGraph(days, total) {
  const end = new Date(); end.setHours(0, 0, 0, 0); const start = new Date(end); start.setDate(start.getDate() - 364 - start.getDay());
  const cells = []; const max = Math.max(1, ...Object.values(days));
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) { const k = d.toISOString().slice(0, 10); const n = days[k] || 0; const lv = n ? Math.min(4, Math.ceil((n / max) * 4)) : 0; cells.push(h('i.gh-c.l' + lv, { title: t('{n} contributions on {d}', { n, d: dayKey(d.getTime()) }) })); }
  return h('div.gh-box.gh-contrib', h('div.gh-pad', h('b', t('{n} contributions in the last year', { n: fmt.num(total) }))), h('div.gh-cal', cells), h('div.gh-legend.tiny.muted', t('Less'), [0, 1, 2, 3, 4].map((l) => h('i.gh-c.l' + l)), t('More')));
}

export default {
  title: () => 'Nebulix Code',
  async mount(root, ctx) {
    const [owner, name, mode, ...rest] = ctx.params;
    const inner = h('div.inner.gh'); mount(root, inner);
    const ref = ctx.query.get('ref') || '';
    if (!owner) home();
    else if (!name) profile(owner);
    else repoPage(owner, name, mode || '', rest);

    // ================= dashboard =================
    async function home() {
      const side = h('aside.gh-dside'); const main = h('main.gh-dmain');
      mount(inner, h('div.gh-dash', side, main));
      let scope = ctx.query.get('scope') || 'explore'; let q = '';
      try {
        const mine = await api.get('/api/code/repos?scope=mine');
        const filt = h('input.input.sm', { placeholder: t('Find a repository…'), onInput: (e) => { const v = e.target.value.toLowerCase(); for (const a of list.children) a.style.display = a.textContent.toLowerCase().includes(v) ? '' : 'none'; } });
        const list = h('div.gh-toplist', mine.repos.map((r) => h('a.gh-toprepo', { href: `#/code/${r.owner}/${r.name}` }, avatarEl(S.me, { size: 18, frame: false }), h('span', r.owner + '/', h('b', r.name)))));
        mount(side, h('div.row', h('b.grow', t('Top repositories')), h('button.btn.sm.primary', { onClick: newRepo }, icon('book', 13), t('New'))), filt, list.children.length ? list : h('p.small.muted', t('Create your first repository to start.')),
          h('div.gh-usage.tiny.muted', t('{a} of {b} used', { a: size(mine.usage.used), b: size(mine.usage.quota) })), h('a.btn.sm.block', { href: '#/code/' + S.me.username }, icon('user', 13), t('Your profile')), h('button.btn.sm.block', { onClick: () => ctx.go('studio') }, icon('edit', 13), 'Nebulix Studio'));
      } catch (e) { mount(side, h('p.small.muted', e.message)); }
      const listEl = h('div.gh-box.gh-rlist');
      const tabs = h('div.gh-subnav', [['explore', t('Explore'), 'globe'], ['mine', t('Your repositories'), 'book'], ['starred', t('Starred'), 'star']].map(([k, l, ic]) => h('a' + (scope === k ? '.on' : ''), { href: '#', onClick: (e) => { e.preventDefault(); scope = k; for (const a of tabs.children) a.classList.toggle('on', a === e.currentTarget); load(); } }, icon(ic, 14), l)));
      const search = h('input.input', { placeholder: t('Search repositories, topics…'), onInput: (e) => { q = e.target.value; clearTimeout(search.t); search.t = setTimeout(load, 220); } });
      mount(main, h('div.gh-hero', h('div', h('h2', icon('terminal', 22), ' Nebulix Code'), h('p.muted', t('Host code with branches, pull requests, issues and reviews. Edit in Nebulix Studio and preview web projects live.'))), h('button.btn.primary', { onClick: newRepo }, icon('plus', 15), t('New repository'))),
        h('div.row.wrap', { style: 'gap:10px;margin-bottom:12px' }, tabs, h('div.grow'), search), listEl);
      async function load() {
        mount(listEl, loading());
        try { const r = await api.get(`/api/code/repos?scope=${scope}&q=${encodeURIComponent(q)}`); mount(listEl, r.repos.length ? r.repos.map(repoRow) : emptyState('book', t('Nothing here yet'), scope === 'mine' ? t('Create your first repository to start.') : '')); }
        catch (e) { mount(listEl, emptyState('alert', t('Could not load this'), e.message)); }
      }
      load();
    }
    function repoRow(r) {
      const star = h('button.btn.sm' + (r.starred ? '.gh-starred' : ''), { onClick: (e) => busy(e.currentTarget, async () => { const x = await api.post(`/api/code/r/${r.owner}/${r.name}/star`); r.starred = x.starred; r.stars = x.stars; star.classList.toggle('gh-starred', x.starred); mount(star, icon('star', 13), x.starred ? t('Starred') : t('Star')); }) }, icon('star', 13), r.starred ? t('Starred') : t('Star'));
      return h('div.gh-rrow', h('div.grow', h('div.row', { style: 'gap:8px;align-items:center' }, h('a.gh-rname', { href: `#/code/${r.owner}/${r.name}` }, r.owner, ' / ', h('b', r.name)), h('span.gh-vis', r.public ? t('Public') : t('Private'))),
        r.forkOf ? h('div.tiny.muted', t('Forked from {r}', { r: r.forkOf.owner + '/' + r.forkOf.name })) : null, r.desc ? h('p.small.muted.gh-rdesc', r.desc) : null,
        (r.topics || []).length ? h('div.gh-topics', r.topics.map((tp) => h('span.gh-topic', tp))) : null,
        h('div.gh-rmeta', r.lang ? lang(r.lang) : null, r.stars ? h('span', icon('star', 12), ' ' + r.stars) : null, r.forks ? h('span', icon('share', 12), ' ' + r.forks) : null, r.openIssues ? h('span', icon('target', 12), ' ' + t('{n} issues', { n: r.openIssues })) : null, h('span', t('Updated {t}', { t: fmt.rel(r.updated) })))), star);
    }
    async function newRepo() {
      const nm = h('input.input', { placeholder: 'mi-proyecto', maxlength: 48 }); const ds = h('input.input', { maxlength: 200, placeholder: t('Description (optional)') });
      let pub = true; let readme = true; let gi = false; let lic = false;
      const ok = await modal({ title: t('Create a new repository'), body: h('div.col.gap', h('p.small.muted', t('A repository contains all project files, including the revision history.')), h('div.row', { style: 'gap:8px;align-items:flex-end' }, h('div', field(t('Owner'), h('div.input.gh-owner', avatarEl(S.me, { size: 18, frame: false }), S.me.username))), h('b', { style: 'padding-bottom:10px' }, '/'), h('div.grow', field(t('Repository name'), nm))), field(t('Description'), ds),
        h('div.gh-radio', h('label', h('input', { type: 'radio', name: 'vis', checked: true, onChange: () => { pub = true; } }), icon('book', 16), h('div', h('b', t('Public')), h('div.tiny.muted', t('Anyone in Nebulix can see this repository.')))), h('label', h('input', { type: 'radio', name: 'vis', onChange: () => { pub = false; } }), icon('lock', 16), h('div', h('b', t('Private')), h('div.tiny.muted', t('You choose who can see and commit.'))))),
        h('div.gh-init', h('b.small', t('Initialize this repository with:')), h('div.row', h('span.grow', t('Add a README file')), switchEl(true, (v) => { readme = v; })), h('div.row', h('span.grow', t('Add .gitignore')), switchEl(false, (v) => { gi = v; })), h('div.row', h('span.grow', t('Choose a license (MIT)')), switchEl(false, (v) => { lic = v; })))),
      actions: [{ label: t('Cancel'), value: false }, { label: t('Create repository'), kind: 'primary', value: true }] });
      if (!ok) return;
      try { const r = await api.post('/api/code/repos', { name: nm.value.trim(), desc: ds.value, public: pub, readme, gitignore: gi, license: lic }); ctx.go('code', `${r.repo.owner}/${r.repo.name}`); } catch (e) { toastErr(e); }
    }

    // ================= profile =================
    async function profile(user) {
      mount(inner, loading());
      let d; try { d = await api.get('/api/code/u/' + encodeURIComponent(user)); } catch (e) { mount(inner, emptyState('user', t('User not found'), e.message)); return; }
      const u = d.user; const tab = ctx.query.get('tab') || 'overview';
      const body = h('div.gh-pmain');
      mount(inner, h('div.gh-profile',
        h('aside.gh-pside', avatarEl(u, { size: 260, frame: false, cls: 'gh-pava' }), h('h1.gh-pname', u.displayName), h('div.gh-plogin', u.username), u.bio ? h('p.small', u.bio) : null,
          h('a.btn.block', { href: '#/echo/u/' + u.username }, icon('user', 14), t('View social profile')),
          h('div.tiny.muted.gh-pstats', icon('book', 13), ' ', t('{n} repositories', { n: d.repos.length }), ' · ', icon('star', 13), ' ', t('{n} stars', { n: d.stars }))),
        h('div.grow', { style: 'min-width:0' }, h('nav.gh-utabs', [['overview', t('Overview'), 'book'], ['repositories', t('Repositories'), 'layers'], ['stars', t('Stars'), 'star']].map(([k, l, ic]) => h('a' + (tab === k ? '.on' : ''), { href: `#/code/${u.username}?tab=${k}` }, icon(ic, 14), l, k === 'repositories' ? h('span.gh-count', String(d.repos.length)) : k === 'stars' ? h('span.gh-count', String(d.starred)) : null))), body)));
      if (tab === 'repositories') mount(body, h('div.gh-box.gh-rlist', d.repos.length ? d.repos.map(repoRow) : emptyState('book', t('No repositories yet'))));
      else if (tab === 'stars') { mount(body, loading()); try { const r = await api.get('/api/code/repos?scope=starred'); mount(body, h('div.gh-box.gh-rlist', r.repos.length ? r.repos.map(repoRow) : emptyState('star', t('Nothing here yet')))); } catch (e) { mount(body, emptyState('alert', e.message)); } }
      else mount(body, h('div.small.muted', { style: 'margin:4px 0 8px' }, d.pinned.length ? t('Popular repositories') : ''), h('div.gh-pinned', d.pinned.map((r) => h('div.gh-pin', h('div.row', h('a.gh-rname', { href: `#/code/${r.owner}/${r.name}` }, icon('book', 14), ' ', h('b', r.name)), h('span.gh-vis', r.public ? t('Public') : t('Private'))), h('p.tiny.muted', r.desc || ''), h('div.gh-rmeta', r.lang ? lang(r.lang) : null, r.stars ? h('span', icon('star', 12), ' ' + r.stars) : null, r.forks ? h('span', icon('share', 12), ' ' + r.forks) : null)))),
        contribGraph(d.days, d.total));
    }

    // ================= repository =================
    async function repoPage(ow, nm, mode, rest) {
      mount(inner, loading());
      let d; try { d = await api.get(`/api/code/r/${encodeURIComponent(ow)}/${encodeURIComponent(nm)}${ref ? '?ref=' + encodeURIComponent(ref) : ''}`); } catch (e) { mount(inner, emptyState('alert', t('Repository not found'), e.message, h('button.btn', { onClick: () => ctx.go('code') }, t('Back')))); return; }
      const r = d.repo; const base = `${r.owner}/${r.name}`; const api0 = `/api/code/r/${base}`;
      ctx.setTitle && ctx.setTitle(base);
      const star = h('button.btn.sm' + (r.starred ? '.gh-starred' : ''), { onClick: (e) => busy(e.currentTarget, async () => { const x = await api.post(`${api0}/star`); star.classList.toggle('gh-starred', x.starred); mount(star, icon('star', 14), x.starred ? t('Starred') : t('Star'), h('span.gh-count', String(x.stars))); }) }, icon('star', 14), r.starred ? t('Starred') : t('Star'), h('span.gh-count', String(r.stars)));
      const tabs = [['', t('Code'), 'terminal'], ['issues', t('Issues'), 'target', r.openIssues], ['pulls', t('Pull requests'), 'swap', r.openPulls], ['commits', t('Commits'), 'clock'], ['branches', t('Branches'), 'layers', r.branches.length]];
      if (r.isOwner) tabs.push(['settings', t('Settings'), 'gear']);
      const active = mode === 'f' ? '' : mode === 'commit' ? 'commits' : mode;
      const head = h('div.gh-rhead', h('div.row.wrap', { style: 'gap:10px;align-items:center' },
        h('h2.gh-rtitle', icon(r.public ? 'book' : 'lock', 18), h('a', { href: `#/code/${r.owner}` }, r.owner), h('span.muted', ' / '), h('a', { href: `#/code/${base}` }, h('b', r.name)), h('span.gh-vis', r.public ? t('Public') : t('Private'))), h('div.grow'),
        h('button.btn.sm', { onClick: (e) => busy(e.currentTarget, async () => { const x = await api.post(`${api0}/fork`); toast(t('Forked!'), 'good'); ctx.go('code', `${x.repo.owner}/${x.repo.name}`); }) }, icon('share', 14), t('Fork'), h('span.gh-count', String(r.forks))), star),
        r.forkOf ? h('div.tiny.muted', { style: 'margin:-4px 0 6px 26px' }, t('forked from'), ' ', h('a', { href: `#/code/${r.forkOf.owner}/${r.forkOf.name}` }, r.forkOf.owner + '/' + r.forkOf.name)) : null,
        h('nav.gh-rtabs', tabs.map(([k, l, ic, n]) => h('a' + (active === k ? '.on' : ''), { href: `#/code/${base}${k ? '/' + k : ''}` }, icon(ic, 15), l, n ? h('span.gh-count', String(n)) : null))));
      const page = h('div.gh-rbody'); mount(inner, head, page);
      if (mode === 'f') return fileView(r, base, rest.map(decodeURIComponent).join('/'), d);
      if (mode === 'commits') return commitsView(r, base);
      if (mode === 'commit') return commitView(r, base, rest[0]);
      if (mode === 'issues' || mode === 'pulls') { const pr = mode === 'pulls'; if (rest[0] === 'new') return pr ? newPull(r, base) : newIssue(r, base); if (rest[0]) return issueView(r, base, Number(rest[0]), pr); return issuesList(r, base, pr); }
      if (mode === 'branches') return branchesView(r, base);
      if (mode === 'settings' && r.isOwner) return settingsView(r, base);
      codeView(r, base, d);

      // ---------- code ----------
      function branchPicker(current, onPick) {
        return h('button.btn.sm.gh-branch', { onClick: (e) => openMenu(r.branches.map((b) => ({ label: b.name + (b.name === r.def ? ' · ' + t('default') : ''), icon: b.name === current ? 'check' : 'layers', onClick: () => onPick(b.name) })).concat(r.canWrite ? [{ label: t('New branch…'), icon: 'plus', onClick: () => newBranch(current) }] : []), e.currentTarget) }, icon('layers', 14), h('b', current), icon('more', 12));
      }
      async function newBranch(from) {
        const n = await promptBox(t('Create a branch'), { label: t('Branch name'), placeholder: 'feature/nueva-cosa', hint: t('From {b}', { b: from }) }); if (!n) return;
        try { await api.post(`${api0}/branches`, { name: n.trim(), from }); toast(t('Branch created'), 'good'); ctx.go('code', `${base}?ref=${encodeURIComponent(n.trim())}`); } catch (e) { toastErr(e); }
      }
      function codeView(r, base, d) {
        const cur = d.ref || r.def; const dir = ctx.query.get('dir') || ''; const refQ = cur !== r.def ? 'ref=' + encodeURIComponent(cur) : '';
        const q = (extra) => { const s = [refQ, extra].filter(Boolean).join('&'); return s ? '?' + s : ''; };
        const goFile = h('input.input.sm.gh-goto', { placeholder: t('Go to file'), onInput: (e) => { const v = e.target.value.toLowerCase(); mount(found, v ? d.files.filter((f) => f.path.toLowerCase().includes(v)).slice(0, 12).map((f) => h('a.gh-found', { href: `#/code/${base}/f/${enc(f.path)}${q()}` }, icon('note', 13), f.path)) : null); } });
        const found = h('div.gh-foundlist');
        const addMenu = r.canWrite ? h('button.btn.sm', { onClick: (e) => openMenu([{ label: t('Create new file'), icon: 'plus', onClick: () => newFile(base, cur) }, { label: t('Upload files'), icon: 'upload', onClick: () => upload(base, cur) }], e.currentTarget) }, t('Add file'), icon('more', 12)) : null;
        const hasIndex = d.files.some((f) => /(^|\/)index\.html$/.test(f.path)) && d.commit;
        const codeBtn = h('button.btn.sm.primary', { onClick: (e) => openMenu([{ label: t('Download ZIP'), icon: 'download', onClick: () => { location.href = `/x/code/zip/${r.id}/${encodeURIComponent(cur)}`; } }, { label: t('Open in Nebulix Studio'), icon: 'edit', onClick: () => ctx.go('studio', base) }, ...(hasIndex ? [{ label: t('Live preview'), icon: 'play', onClick: () => window.open(`/x/preview/${r.id}/${d.commit.id}/index.html`, '_blank', 'noopener') }] : [])], e.currentTarget) }, icon('terminal', 14), t('Code'), icon('more', 12));
        const bar = h('div.gh-cbar', branchPicker(cur, (b) => ctx.go('code', base + (b === r.def ? '' : '?ref=' + encodeURIComponent(b)))), h('a.gh-meta-link', { href: `#/code/${base}/branches` }, icon('layers', 13), h('b', String(r.branches.length)), ' ', t('branches')), h('div.grow'), h('div.gh-gotow', goFile, found), addMenu, codeBtn);
        // tree
        const kids = new Map(); const pre = dir ? dir + '/' : '';
        for (const f of d.files) { if (!f.path.startsWith(pre)) continue; const restP = f.path.slice(pre.length); const top = restP.split('/')[0]; const isDir = restP.includes('/'); const k = (isDir ? '0' : '1') + top; const e = kids.get(k) || { name: top, dir: isDir, last: null, size: f.size, path: pre + top }; if (f.last && (!e.last || f.last.t > e.last.t)) e.last = f.last; kids.set(k, e); }
        const rows = [...kids.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, e]) => h('div.gh-frow', h('span.gh-fic' + (e.dir ? '.dir' : ''), icon(e.dir ? 'layers' : 'note', 15)), h('a.gh-fname', { href: e.dir ? `#/code/${base}${q('dir=' + encodeURIComponent(e.path))}` : `#/code/${base}/f/${enc(e.path)}${q()}` }, e.name),
          h('a.gh-fmsg', { href: e.last ? `#/code/${base}/commit/${e.last.id}` : '#' }, e.last ? e.last.msg : ''), h('span.gh-ftime', e.last ? fmt.rel(e.last.t) : '')));
        const crumbs = dir ? h('div.gh-crumbs', h('a', { href: `#/code/${base}${q()}` }, h('b', r.name)), dir.split('/').map((p, i, a) => [' / ', i === a.length - 1 ? h('b', p) : h('a', { href: `#/code/${base}${q('dir=' + encodeURIComponent(a.slice(0, i + 1).join('/')))}` }, p)])) : null;
        const lastBar = d.commit ? h('div.gh-box-h.gh-lastc', d.commit.byUser ? avatarEl(d.commit.byUser, { size: 22, frame: false }) : null, h('a.gh-user', { href: '#/code/' + d.commit.by }, h('b', d.commit.by)), h('a.gh-lmsg', { href: `#/code/${base}/commit/${d.commit.id}` }, d.commit.msg), h('div.grow'), h('a.gh-sha', { href: `#/code/${base}/commit/${d.commit.id}` }, sha7(d.commit.id)), h('span.tiny.muted', '· ' + fmt.rel(d.commit.t)), h('a.gh-meta-link', { href: `#/code/${base}/commits${q()}` }, icon('clock', 13), h('b', String(d.count)), ' ', t('commits'))) : null;
        const files = h('div.gh-box', lastBar, dir ? h('div.gh-frow', h('span.gh-fic.dir', icon('back', 15)), h('a.gh-fname', { href: `#/code/${base}${q(dir.includes('/') ? 'dir=' + encodeURIComponent(dir.split('/').slice(0, -1).join('/')) : '')}` }, '..')) : null,
          rows.length ? rows : h('div.gh-empty', h('h3', t('This repository is empty.')), r.canWrite ? h('div.row', { style: 'gap:8px;justify-content:center' }, h('button.btn.primary', { onClick: () => upload(base, cur) }, icon('upload', 14), t('Upload files')), h('button.btn', { onClick: () => newFile(base, cur) }, icon('plus', 14), t('Create new file'))) : null));
        const readme = d.readme && !dir ? h('div.gh-box.gh-readme', h('div.gh-box-h', icon('book', 14), h('b', 'README')), h('div.gh-md', mdToEls(d.readme))) : null;
        const about = h('aside.gh-about',
          h('h3', t('About')), r.desc ? h('p', r.desc) : h('p.muted.small', t('No description, website, or topics provided.')),
          r.website ? h('a.gh-web', { href: r.website, target: '_blank', rel: 'noopener noreferrer' }, icon('link', 13), r.website.replace(/^https?:\/\//, '')) : null,
          r.topics.length ? h('div.gh-topics', r.topics.map((tp) => h('a.gh-topic', { href: '#/code?scope=explore', onClick: (e) => { e.preventDefault(); ctx.go('code'); } }, tp))) : null,
          h('div.gh-aboutl', d.readme ? h('span', icon('book', 13), ' Readme') : null, d.files.some((f) => /^license/i.test(f.path)) ? h('span', icon('shield', 13), ' ' + t('License')) : null, h('span', icon('star', 13), ' ', h('b', String(r.stars)), ' ', t('stars')), h('span', icon('share', 13), ' ', h('b', String(r.forks)), ' ', t('forks'))),
          r.contributors.length ? [h('h3', t('Contributors'), h('span.gh-count', String(r.contributors.length))), h('div.gh-contribs', r.contributors.map((u) => h('a', { href: '#/code/' + u.username, title: u.username }, avatarEl(u, { size: 32, frame: false }))))] : null,
          r.langs.length ? [h('h3', t('Languages')), h('div.gh-lbar', r.langs.map((l) => h('i', { style: { width: l.pct + '%', background: LANGC[l.name] || '#8b949e' }, title: l.name + ' ' + l.pct + '%' }))), h('div.gh-llist', r.langs.slice(0, 8).map((l) => h('span', lang(l.name), h('span.muted', ' ' + l.pct + '%'))))] : null);
        mount(page, h('div.gh-code', h('div.gh-cmain', bar, crumbs, files, readme), about));
      }
      // ---------- file ----------
      async function fileView(r, base, p, d) {
        const cur = ref || r.def; const box = h('div', loading()); mount(page, box);
        try {
          const f = await api.get(`${api0}/file?path=${encodeURIComponent(p)}${ref ? '&ref=' + encodeURIComponent(ref) : ''}`);
          const crumbs = p.split('/'); const isImg = /\.(png|jpe?g|gif|webp|svg|avif|ico)$/i.test(p); const refQ = ref ? '?ref=' + encodeURIComponent(ref) : '';
          const lines = f.text != null ? f.text.split('\n') : [];
          const actions = h('div.row', { style: 'gap:6px' }, h('a.btn.sm', { href: f.raw, target: '_blank', rel: 'noopener' }, t('Raw')), f.text != null ? h('button.btn.sm', { title: t('Copy raw file'), onClick: async () => { try { await navigator.clipboard.writeText(f.text); toast(t('Copied'), 'good'); } catch {} } }, icon('copy', 14)) : null,
            h('a.btn.sm', { href: f.raw, download: crumbs[crumbs.length - 1] }, icon('download', 14)),
            r.canWrite && !f.binary ? h('button.btn.sm', { onClick: () => ctx.go('studio', base + '?path=' + encodeURIComponent(p)) }, icon('edit', 14)) : null,
            r.canWrite ? h('button.btn.sm.gh-dangerbtn', { onClick: async () => { if (!(await confirmBox(t('Delete {f}?', { f: p }), { danger: true }))) return; try { await api.post(`${api0}/commit`, { message: 'Delete ' + p, branch: cur, changes: [{ path: p, delete: true }] }); ctx.go('code', base + refQ); } catch (e) { toastErr(e); } } }, icon('trash', 14)) : null);
          let content;
          if (isImg) content = h('div.gh-img', h('img', { src: f.raw, alt: p }));
          else if (f.binary) content = h('div.gh-empty', h('p', t('Binary file — download it to open it.')));
          else if (/\.md$/i.test(p)) content = h('div.gh-md', mdToEls(f.text));
          else content = h('div.gh-src', h('table', lines.map((l, i) => h('tr', { id: 'L' + (i + 1) }, h('td.ln', String(i + 1)), h('td.code', l)))));
          mount(box, h('div.gh-cbar', branchPicker(cur, (b) => ctx.go('code', `${base}/f/${enc(p)}${b === r.def ? '' : '?ref=' + encodeURIComponent(b)}`)), h('div.gh-crumbs', h('a', { href: `#/code/${base}${refQ}` }, h('b', r.name)), crumbs.map((c, i) => [' / ', i === crumbs.length - 1 ? h('b', c) : h('a', { href: `#/code/${base}?${ref ? 'ref=' + encodeURIComponent(ref) + '&' : ''}dir=${encodeURIComponent(crumbs.slice(0, i + 1).join('/'))}` }, c)]))),
            f.last ? h('div.gh-box.gh-box-h.gh-lastc', h('a.gh-user', { href: '#/code/' + f.last.by }, h('b', f.last.by)), h('a.gh-lmsg', { href: `#/code/${base}/commit/${f.last.id}` }, f.last.msg), h('div.grow'), h('a.gh-sha', { href: `#/code/${base}/commit/${f.last.id}` }, sha7(f.last.id)), h('span.tiny.muted', '· ' + fmt.rel(f.last.t)), h('a.gh-meta-link', { href: `#/code/${base}/commits${refQ}` }, icon('clock', 13), t('History'))) : null,
            h('div.gh-box', h('div.gh-box-h', h('span.small.muted', f.text != null ? t('{n} lines', { n: lines.length }) + ' · ' : '', size(f.size)), h('div.grow'), actions), content));
        } catch (e) { mount(box, emptyState('alert', t('File not found'), e.message)); }
        void d;
      }
      // ---------- commits ----------
      async function commitsView(r, base) {
        const cur = ref || r.def; mount(page, loading());
        try {
          const x = await api.get(`${api0}/commits${ref ? '?ref=' + encodeURIComponent(ref) : ''}`); const groups = new Map();
          for (const c of x.commits) { const k = dayKey(c.t); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); }
          mount(page, h('div.gh-cbar', branchPicker(cur, (b) => ctx.go('code', `${base}/commits${b === r.def ? '' : '?ref=' + encodeURIComponent(b)}`)), h('b.small.muted', t('{n} commits', { n: x.commits.length }))),
            [...groups].map(([day, cs]) => h('div.gh-cgroup', h('div.gh-cday', icon('clock', 13), ' ', t('Commits on {d}', { d: day })), h('div.gh-box', cs.map((c) => h('div.gh-crow', h('div.grow', { style: 'min-width:0' }, h('a.gh-cmsg', { href: `#/code/${base}/commit/${c.id}` }, c.msg), h('div.tiny.muted.row', { style: 'gap:6px;align-items:center' }, c.byUser ? avatarEl(c.byUser, { size: 16, frame: false }) : null, h('a.gh-user', { href: '#/code/' + c.by }, h('b', c.by)), t('committed {t}', { t: fmt.rel(c.t) }))),
              h('a.btn.sm.gh-shabtn', { href: `#/code/${base}/commit/${c.id}` }, sha7(c.id)), h('a.btn.sm', { href: `#/code/${base}?ref=${c.id}`, title: t('Browse the repository at this point in the history') }, '<>')))))));
        } catch (e) { mount(page, emptyState('alert', t('Could not load this'), e.message)); }
      }
      async function commitView(r, base, id) {
        mount(page, loading());
        try {
          const x = await api.get(`${api0}/commit/${encodeURIComponent(id)}`); const c = x.commit;
          const add = x.files.reduce((a, f) => a + (f.binary ? 0 : diffLines(f.before || '', f.after || '').filter((o) => o[0] === '+').length), 0);
          mount(page, h('div.gh-box.gh-chead', h('div.gh-pad', h('h3', c.msg), h('div.row.wrap.small.muted', { style: 'gap:8px;align-items:center' }, c.byUser ? avatarEl(c.byUser, { size: 20, frame: false }) : null, h('a.gh-user', { href: '#/code/' + c.by }, h('b', c.by)), t('committed {t}', { t: fmt.rel(c.t) }), h('div.grow'), c.parent ? [t('parent'), ' ', h('a.gh-sha', { href: `#/code/${base}/commit/${c.parent}` }, sha7(c.parent))] : null, ' ', t('commit'), ' ', h('code.gh-sha', c.id), h('a.btn.sm', { href: `#/code/${base}?ref=${c.id}` }, t('Browse files'))))),
            h('div.small.muted', { style: 'margin:12px 0' }, t('Showing {n} changed files with {a} additions', { n: x.files.length, a: add })), x.files.map(diffView));
        } catch (e) { mount(page, emptyState('alert', t('Commit not found'), e.message)); }
      }
      // ---------- branches ----------
      function branchesView(r, base) {
        mount(page, h('div.gh-cbar', h('h3.grow', t('Branches')), r.canWrite ? h('button.btn.sm.primary', { onClick: () => newBranch(r.def) }, icon('plus', 14), t('New branch')) : null),
          h('div.gh-box', r.branches.map((b) => h('div.gh-crow', h('div.grow', h('a.gh-cmsg', { href: `#/code/${base}?ref=${encodeURIComponent(b.name)}` }, icon('layers', 13), ' ', b.name), b.name === r.def ? h('span.gh-vis', t('Default')) : null, h('div.tiny.muted', b.msg + (b.t ? ' · ' + fmt.rel(b.t) : ''))),
            b.name !== r.def ? h('a.btn.sm', { href: `#/code/${base}/pulls/new?head=${encodeURIComponent(b.name)}` }, icon('swap', 13), t('New pull request')) : null,
            r.canWrite && b.name !== r.def ? h('button.btn.sm.gh-dangerbtn', { onClick: async () => { if (!(await confirmBox(t('Delete branch {b}?', { b: b.name }), { danger: true }))) return; try { await api.del(`${api0}/branches/${enc(b.name)}`); ctx.go('code', base + '/branches'); } catch (e) { toastErr(e); } } }, icon('trash', 13)) : null))));
      }
      // ---------- issues & pull requests ----------
      async function issuesList(r, base, pr) {
        const state = ctx.query.get('state') || 'open'; const q = ctx.query.get('q') || ''; const kind = pr ? 'pulls' : 'issues';
        mount(page, loading());
        try {
          const x = await api.get(`${api0}/issues?kind=${pr ? 'pr' : 'issue'}&state=${state}&q=${encodeURIComponent(q)}`);
          const search = h('input.input.sm', { value: q, placeholder: pr ? t('Search all pull requests') : t('Search all issues'), onKeydown: (e) => { if (e.key === 'Enter') ctx.go('code', `${base}/${kind}?state=${state}&q=${encodeURIComponent(e.target.value)}`); } });
          mount(page, h('div.gh-cbar', h('div.grow', search), h('a.btn.sm.primary', { href: `#/code/${base}/${kind}/new` }, pr ? t('New pull request') : t('New issue'))),
            h('div.gh-box', h('div.gh-box-h.gh-ihead', h('a' + (state === 'open' ? '.on' : ''), { href: `#/code/${base}/${kind}?state=open` }, icon(pr ? 'swap' : 'target', 14), ' ', t('{n} Open', { n: x.open })), h('a' + (state === 'closed' ? '.on' : ''), { href: `#/code/${base}/${kind}?state=closed` }, icon('check', 14), ' ', t('{n} Closed', { n: x.closed }))),
              x.items.length ? x.items.map((it) => h('div.gh-irow', h('span.gh-istate.' + (it.merged ? 'merged' : it.state), icon(it.pr ? 'swap' : it.state === 'open' ? 'target' : 'check', 16)),
                h('div.grow', { style: 'min-width:0' }, h('a.gh-ititle', { href: `#/code/${base}/${kind}/${it.num}` }, it.title), it.labels.map(label), h('div.tiny.muted', `#${it.num} `, it.state === 'open' ? t('opened {t} by {u}', { t: fmt.rel(it.t), u: it.by }) : it.merged ? t('by {u} was merged {t}', { u: it.by, t: fmt.rel(it.closedAt) }) : t('by {u} was closed {t}', { u: it.by, t: fmt.rel(it.closedAt) }))),
                it.comments ? h('span.tiny.muted', icon('chat', 13), ' ' + it.comments) : null))
                : h('div.gh-empty', h('h3', pr ? t('There aren’t any open pull requests.') : t('There aren’t any open issues.')), h('p.small.muted', pr ? t('Pull requests help you collaborate on code with other people.') : t('Issues are used to track todos, bugs, feature requests, and more.')))));
        } catch (e) { mount(page, emptyState('alert', t('Could not load this'), e.message)); }
      }
      function labelPicker(sel, all, onChange) { const box = h('div.gh-lpick', all.map((l) => h('label', h('input', { type: 'checkbox', checked: sel.includes(l), onChange: (e) => { if (e.target.checked) sel.push(l); else sel.splice(sel.indexOf(l), 1); onChange && onChange(sel); } }), label(l)))); return box; }
      function composer(placeholder) { const ta = h('textarea.input.gh-ta', { rows: 6, placeholder }); const prev = h('div.gh-md.gh-prev'); let mode = 'w'; const tabs = h('div.gh-wtabs', h('a.on', { href: '#', onClick: (e) => { e.preventDefault(); mode = 'w'; tabs.children[0].classList.add('on'); tabs.children[1].classList.remove('on'); ta.style.display = ''; prev.style.display = 'none'; } }, t('Write')), h('a', { href: '#', onClick: (e) => { e.preventDefault(); mode = 'p'; tabs.children[1].classList.add('on'); tabs.children[0].classList.remove('on'); ta.style.display = 'none'; prev.style.display = ''; mount(prev, ta.value.trim() ? mdToEls(ta.value) : h('p.muted', t('Nothing to preview'))); } }, t('Preview'))); prev.style.display = 'none'; void mode; return { el: h('div.gh-composer', tabs, ta, prev, h('div.tiny.muted', icon('book', 12), ' ', t('Markdown is supported'))), ta }; }
      async function newIssue(r, base) {
        const title = h('input.input', { placeholder: t('Title'), maxlength: 200 }); const c = composer(t('Add a description')); const labels = [];
        mount(page, h('div.gh-newi', h('div.grow', h('div.gh-box.gh-pad.col.gap', h('div.row', { style: 'gap:10px' }, avatarEl(S.me, { size: 40, frame: false }), h('div.grow.col.gap', title, c.el)),
          h('div.row', h('div.grow'), h('button.btn.primary', { onClick: (e) => busy(e.currentTarget, async () => { const x = await api.post(`${api0}/issues`, { title: title.value, body: c.ta.value, labels }); ctx.go('code', `${base}/issues/${x.item.num}`); }) }, t('Submit new issue'))))),
          h('aside.gh-iside', h('b.small', t('Labels')), labelPicker(labels, ['bug', 'enhancement', 'question', 'documentation', 'good first issue', 'help wanted', 'wontfix']))));
        setTimeout(() => title.focus(), 30);
      }
      async function newPull(r, base) {
        let baseB = r.def; let headB = ctx.query.get('head') || (r.branches.find((b) => b.name !== r.def) || {}).name || r.def;
        const title = h('input.input', { placeholder: t('Title'), maxlength: 200 }); const c = composer(t('Add a description'));
        const pick = (cur, set) => h('select.select.sm', { onChange: (e) => { set(e.target.value); } }, r.branches.map((b) => h('option', { value: b.name, selected: b.name === cur }, b.name)));
        if (r.branches.length < 2) { mount(page, h('div.gh-box.gh-empty', h('h3', t('Compare changes')), h('p.muted', t('Create another branch, commit to it, and open a pull request to merge it into {b}.', { b: r.def })), r.canWrite ? h('button.btn.primary', { onClick: () => newBranch(r.def) }, icon('plus', 14), t('New branch')) : null)); return; }
        if (!title.value) title.value = headB.replace(/[-_/]+/g, ' ');
        mount(page, h('h2', t('Open a pull request')), h('p.small.muted', t('Create a new pull request by comparing changes across two branches.')),
          h('div.gh-box.gh-pad.gh-compare', icon('swap', 16), ' ', t('base:'), ' ', pick(baseB, (v) => { baseB = v; }), ' ← ', t('compare:'), ' ', pick(headB, (v) => { headB = v; })),
          h('div.gh-box.gh-pad.col.gap', { style: 'margin-top:12px' }, h('div.row', { style: 'gap:10px' }, avatarEl(S.me, { size: 40, frame: false }), h('div.grow.col.gap', title, c.el)),
            h('div.row', h('div.grow'), h('button.btn.primary', { onClick: (e) => busy(e.currentTarget, async () => { const x = await api.post(`${api0}/issues`, { pr: true, title: title.value, body: c.ta.value, head: headB, base: baseB }); ctx.go('code', `${base}/pulls/${x.item.num}`); }) }, t('Create pull request')))));
      }
      async function issueView(r, base, num, pr) {
        mount(page, loading());
        let x; try { x = await api.get(`${api0}/issues/${num}`); } catch (e) { mount(page, emptyState('alert', t('Not found'), e.message)); return; }
        const it = x.item; const tab = ctx.query.get('tab') || 'conversation'; const kind = it.pr ? 'pulls' : 'issues';
        const stateBadge = h('span.gh-sbadge.' + (it.merged ? 'merged' : it.state), icon(it.pr ? 'swap' : it.state === 'open' ? 'target' : 'check', 14), it.merged ? t('Merged') : it.state === 'open' ? t('Open') : t('Closed'));
        const canEdit = x.canWrite || it.by === S.me.username;
        const headEl = h('div.gh-ihd', h('h1', it.title, ' ', h('span.muted', '#' + it.num), canEdit ? h('button.btn.sm.gh-edit', { onClick: async () => { const v = await promptBox(t('Title'), { value: it.title }); if (!v) return; try { await api.patch(`${api0}/issues/${num}`, { title: v }); issueView(r, base, num, pr); } catch (e) { toastErr(e); } } }, t('Edit')) : null),
          h('div.row.wrap.small.muted', { style: 'gap:8px;align-items:center' }, stateBadge, h('b', it.by), it.pr ? [t('wants to merge {n} commits into', { n: (x.commits || []).length }), ' ', h('code.gh-bref', it.base), ' ', t('from'), ' ', h('code.gh-bref', it.head)] : t('opened this issue {t} · {n} comments', { t: fmt.rel(it.t), n: it.list.length })));
        const tl = h('div.gh-timeline');
        const bubble = (who, u, tms, body, first) => h('div.gh-tli', h('a', { href: '#/code/' + who }, avatarEl(u, { size: 40, frame: false })), h('div.gh-box.gh-cbox' + (first ? '.first' : ''), h('div.gh-box-h', h('b', who), h('span.muted.small', ' ' + t('commented {t}', { t: fmt.rel(tms) })), first && it.pr ? null : null), h('div.gh-pad.gh-md', body ? mdToEls(body) : h('p.muted.small', h('i', t('No description provided.'))))));
        tl.append(bubble(it.by, it.byUser, it.t, it.body, true));
        for (const cm of it.list) tl.append(cm.ev ? h('div.gh-ev', h('span.gh-evic.' + cm.ev, icon(cm.ev === 'merged' ? 'swap' : cm.ev === 'closed' ? 'check' : 'refresh', 14)), h('b', cm.by), ' ', cm.ev === 'merged' ? t('merged this pull request') : cm.ev === 'closed' ? t('closed this') : t('reopened this'), ' ', h('span.muted', fmt.rel(cm.t))) : bubble(cm.by, cm.byUser, cm.t, cm.body));
        // merge box
        let mergeBox = null;
        if (it.pr && it.state === 'open') {
          let delBranch = true;
          mergeBox = h('div.gh-tli', h('span.gh-mic.' + (x.mergeable ? 'ok' : 'bad'), icon('swap', 20)), h('div.gh-box.gh-merge' + (x.mergeable ? '.ok' : '.bad'), h('div.gh-pad',
            x.missing ? h('b', t('A branch of this pull request no longer exists.')) : x.upToDate ? h('div', h('b', t('Nothing to merge')), h('div.small.muted', t('{h} has no commits that are not in {b}.', { h: it.head, b: it.base })))
              : x.mergeable ? h('div', h('b', icon('check', 14), ' ', t('This branch has no conflicts with the base branch')), h('div.small.muted', t('Merging can be performed automatically.')))
                : h('div', h('b', icon('alert', 14), ' ', t('This branch has conflicts that must be resolved')), h('div.small.muted', t('Conflicting files:'), ' ', x.conflicts.join(', '))),
            x.canWrite && x.mergeable && !x.upToDate ? h('div.row', { style: 'gap:10px;margin-top:12px;align-items:center' }, h('button.btn.gh-mergebtn', { onClick: (e) => busy(e.currentTarget, async () => { await api.post(`${api0}/issues/${num}/merge`, { deleteBranch: delBranch }); toast(t('Pull request merged'), 'good'); issueView(r, base, num, pr); }) }, t('Merge pull request')), h('label.small.row', { style: 'gap:6px' }, h('input', { type: 'checkbox', checked: true, onChange: (e) => { delBranch = e.target.checked; } }), t('Delete branch {b} after merging', { b: it.head }))) : null)));
        }
        const c = composer(t('Leave a comment'));
        const commentBox = h('div.gh-tli', avatarEl(S.me, { size: 40, frame: false }), h('div.gh-box.gh-pad.col.gap.grow', c.el, h('div.row', { style: 'gap:8px;justify-content:flex-end' },
          canEdit && !it.merged ? h('button.btn', { onClick: (e) => busy(e.currentTarget, async () => { if (c.ta.value.trim()) await api.post(`${api0}/issues/${num}/comments`, { body: c.ta.value }); await api.patch(`${api0}/issues/${num}`, { state: it.state === 'open' ? 'closed' : 'open' }); issueView(r, base, num, pr); }) }, icon(it.state === 'open' ? 'check' : 'refresh', 14), it.state === 'open' ? (it.pr ? t('Close pull request') : t('Close issue')) : t('Reopen')) : null,
          h('button.btn.primary', { onClick: (e) => busy(e.currentTarget, async () => { if (!c.ta.value.trim()) { toast(t('Write a comment'), 'err'); return; } await api.post(`${api0}/issues/${num}/comments`, { body: c.ta.value }); issueView(r, base, num, pr); }) }, t('Comment')))));
        const labels = it.labels.slice();
        const side = h('aside.gh-iside', h('b.small', t('Labels')), x.canWrite ? labelPicker(labels, x.labels, async (sel) => { try { await api.patch(`${api0}/issues/${num}`, { labels: sel }); } catch (e) { toastErr(e); } }) : (it.labels.length ? h('div', it.labels.map(label)) : h('div.tiny.muted', t('None yet'))),
          h('b.small', t('Participants')), h('div.gh-contribs', [...new Map([[it.by, it.byUser], ...it.list.filter((cm) => cm.byUser).map((cm) => [cm.by, cm.byUser])]).values()].filter(Boolean).map((u) => avatarEl(u, { size: 26, frame: false }))));
        const prTabs = it.pr ? h('nav.gh-prtabs', [['conversation', t('Conversation'), 'chat', it.list.filter((m) => !m.ev).length], ['commits', t('Commits'), 'clock', (x.commits || []).length], ['files', t('Files changed'), 'note', (x.files || []).length]].map(([k, l, ic, n]) => h('a' + (tab === k ? '.on' : ''), { href: `#/code/${base}/${kind}/${num}?tab=${k}` }, icon(ic, 14), l, h('span.gh-count', String(n))))) : null;
        let bodyEl;
        if (it.pr && tab === 'files') bodyEl = h('div', (x.files || []).length ? x.files.map(diffView) : h('div.gh-empty', h('p', t('No changes.'))));
        else if (it.pr && tab === 'commits') bodyEl = h('div.gh-box', (x.commits || []).map((cm) => h('div.gh-crow', h('div.grow', h('a.gh-cmsg', { href: `#/code/${base}/commit/${cm.id}` }, cm.msg), h('div.tiny.muted', cm.by + ' · ' + fmt.rel(cm.t))), h('a.btn.sm.gh-shabtn', { href: `#/code/${base}/commit/${cm.id}` }, sha7(cm.id)))));
        else bodyEl = h('div.gh-iwrap', h('div.grow', { style: 'min-width:0' }, tl, mergeBox, commentBox), side);
        mount(page, headEl, prTabs, bodyEl);
      }
      // ---------- settings ----------
      function settingsView(r, base) {
        const nm = h('input.input', { value: r.name, maxlength: 48 }); const ds = h('input.input', { value: r.desc || '', maxlength: 200 }); const web = h('input.input', { value: r.website || '', placeholder: 'https://' });
        const topics = h('input.input', { value: r.topics.join(', '), placeholder: 'javascript, juego, web' }); const col = h('input.input', { value: (r.collab || []).map((x) => '@' + x).join(', '), placeholder: '@amigo, @otro' });
        const def = h('select.select', r.branches.map((b) => h('option', { value: b.name, selected: b.name === r.def }, b.name))); let pub = r.public;
        const save = (body, msg) => async (e) => busy(e.currentTarget, async () => { const x = await api.patch(`/api/code/r/${base}`, body()); toast(msg || t('Saved'), 'good'); if (x.repo.name !== r.name) ctx.go('code', `${x.repo.owner}/${x.repo.name}/settings`); });
        mount(page, h('div.gh-settings',
          h('div.gh-box.gh-pad.col.gap', h('h3', t('General')), h('div.row', { style: 'gap:8px;align-items:flex-end' }, h('div.grow', field(t('Repository name'), nm)), h('button.btn', { onClick: save(() => ({ rename: nm.value })) }, t('Rename'))),
            field(t('Description'), ds), field(t('Website'), web), field(t('Topics'), topics, t('Separated by commas')), h('div.row', h('button.btn.primary', { onClick: save(() => ({ desc: ds.value, website: web.value, topics: topics.value.split(',').map((x) => x.trim()).filter(Boolean) })) }, t('Save changes')))),
          h('div.gh-box.gh-pad.col.gap', h('h3', t('Default branch')), h('p.small.muted', t('The default branch is the base for pull requests and what people see first.')), h('div.row', { style: 'gap:8px' }, h('div.grow', def), h('button.btn', { onClick: save(() => ({ def: def.value })) }, t('Update')))),
          h('div.gh-box.gh-pad.col.gap', h('h3', t('Collaborators')), field(t('People who can push, merge and manage issues'), col), h('div.row', h('button.btn', { onClick: save(() => ({ collab: col.value.split(/[\s,]+/).filter(Boolean) })) }, t('Save collaborators')))),
          h('div.gh-box.gh-danger', h('div.gh-box-h', h('b', t('Danger Zone'))),
            h('div.gh-drow', h('div.grow', h('b', t('Change repository visibility')), h('div.small.muted', t('This repository is currently {v}.', { v: pub ? t('public') : t('private') }))), h('button.btn.gh-dangerbtn', { onClick: async (e) => { if (!(await confirmBox(pub ? t('Make this repository private?') : t('Make this repository public?')))) return; pub = !pub; await save(() => ({ public: pub }))(e); ctx.go('code', base + '/settings'); } }, t('Change visibility'))),
            h('div.gh-drow', h('div.grow', h('b', t('Delete this repository')), h('div.small.muted', t('Once you delete a repository, there is no going back. Please be certain.'))), h('button.btn.gh-dangerbtn', { onClick: async () => { const v = await promptBox(t('Type the repository name to delete it forever'), { label: base }); if (v !== r.name && v !== base) return; try { await api.del(`/api/code/r/${base}`); toast(t('Deleted'), 'good'); ctx.go('code'); } catch (e) { toastErr(e); } } }, t('Delete this repository'))))));
      }
      async function upload(base, branch) {
        const inp = h('input', { type: 'file', multiple: true }); const dirInp = h('input', { type: 'file', multiple: true, webkitdirectory: true });
        const pick = (el) => new Promise((res) => { el.onchange = () => res([...el.files]); el.click(); });
        const which = await modal({ title: t('Upload files'), cls: 'narrow', body: h('p.small.muted', t('Files up to 5 MB each. Folders keep their structure.')), actions: [{ label: t('Cancel'), value: false }, { label: t('Folder'), value: 'dir' }, { label: t('Files'), kind: 'primary', value: 'files' }] });
        if (!which) return;
        const files = await pick(which === 'dir' ? dirInp : inp); if (!files.length) return;
        const msg = await promptBox(t('Commit changes'), { label: t('Commit message'), value: t('Add files via upload') }); if (msg === null) return;
        try {
          const dir = ctx.query.get('dir') ? ctx.query.get('dir') + '/' : '';
          const changes = []; for (const f of files) { if (f.size > 5 * 1048576) { toast(t('{f} is larger than 5 MB — skipped', { f: f.name }), 'err'); continue; } changes.push({ path: dir + (f.webkitRelativePath || f.name).replace(/^\/+/, ''), b64: b64(await f.arrayBuffer()) }); }
          for (let i = 0; i < changes.length; i += 60) await api.post(`/api/code/r/${base}/commit`, { message: msg || 'Add files via upload', branch, changes: changes.slice(i, i + 60) });
          toast(t('Uploaded {n} files', { n: changes.length }), 'good'); ctx.go('code', base + (branch && branch !== r.def ? '?ref=' + encodeURIComponent(branch) : ''));
        } catch (e) { toastErr(e); }
      }
      async function newFile(base, branch) {
        const p = await promptBox(t('Create new file'), { label: t('File name (use / for folders)'), placeholder: 'src/main.js' }); if (!p) return;
        if (branch && branch !== r.def) { const text = await promptBox(t('File contents'), { multiline: true, value: '' }); if (text === null) return; try { await api.post(`/api/code/r/${base}/commit`, { message: 'Create ' + p.trim(), branch, changes: [{ path: p.trim(), text }] }); ctx.go('code', `${base}/f/${enc(p.trim())}?ref=${encodeURIComponent(branch)}`); } catch (e) { toastErr(e); } return; }
        ctx.go('studio', base + '?path=' + encodeURIComponent(p.trim()) + '&new=1');
      }
    }
    return () => {};
  },
};
