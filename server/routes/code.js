'use strict';
// Nebulix Code: code hosting with the usual workflow of a git forge.
//   repositories (public/private, collaborators, stars, forks, topics), branches, commits (every commit is a
//   snapshot of the file tree), commit diffs, file upload, README, issues with labels and comments, pull requests
//   between branches with a three-way merge (conflicts are detected per file), ZIP download, contribution graph,
//   and a live preview of HTML projects (sandboxed, no cookies).
// File contents live in the shared blob store; the repo table keeps trees (path -> blob) per commit.
const zlib = require('zlib');
const { S, publicUser, isPro, hub } = require('../state');
const blobs = require('../blobs');
const { HttpError, now, rid } = require('../util');

const repos = () => S.store.table('repos');
const NAME = /^[A-Za-z0-9._-]{1,48}$/;
const BRANCH = /^(?!.*\.\.)(?!\/)(?!.*\/$)[A-Za-z0-9._\-/]{1,60}$/;
const PATH = /^(?!\/)(?!.*\/\/)(?!.*(^|\/)\.\.?(\/|$))[^\u0000-\u001f\\:*?"<>|]{1,200}$/;
const MAX_FILES = 600; const MAX_FILE = 5 * 1024 * 1024; const MAX_COMMITS = 400;
const maxRepos = (u) => (isPro(u) ? 200 : 30);
const touch = () => S.store.touch('repos');
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/\r\n?/g, '\n').trim().slice(0, n);
const LABELS = ['bug', 'enhancement', 'question', 'documentation', 'good first issue', 'help wanted', 'wontfix'];

// older repos (single linear history) get branches and issues the first time they are touched
function norm(r) {
  if (!r) return r;
  if (!r.branches) { r.branches = { main: r.commits[0] ? r.commits[0].id : null }; r.def = 'main'; }
  if (!r.def || !(r.def in r.branches)) r.def = Object.keys(r.branches)[0] || 'main';
  r.issues = r.issues || []; r.nextNum = r.nextNum || (r.issues.reduce((m, x) => Math.max(m, x.num), 0) + 1); r.topics = r.topics || [];
  return r;
}
function find(owner, name) {
  const oid = S.byName.get(String(owner).toLowerCase()); if (!oid) return null;
  return norm(Object.values(repos()).find((r) => r.owner === oid && r.nameLower === String(name).toLowerCase()) || null);
}
const canSee = (r, u) => r && (r.public || (u && (u.id === r.owner || (r.collab || []).includes(u.id) || u.role === 'owner')));
const canWrite = (r, u) => r && u && (u.id === r.owner || (r.collab || []).includes(u.id));
function need(c, write) {
  const r = find(c.params.owner, c.params.name);
  if (!canSee(r, c.user)) throw new HttpError(404, 'no_repo', 'Repository not found');
  if (write && !canWrite(r, c.user)) throw new HttpError(403, 'forbidden', 'You cannot change this repository');
  return r;
}
const byId = (r, id) => (id ? r.commits.find((x) => x.id === id) || null : null);
// ref = branch name or commit id (default branch when empty)
function refCommit(r, ref) { norm(r); if (!ref) return byId(r, r.branches[r.def]); if (ref in r.branches) return byId(r, r.branches[ref]); return byId(r, ref); }
const headOf = (r) => refCommit(r, null);
const treeOf = (r, ref) => { const c = refCommit(r, ref); return c ? c.tree : {}; };
// every commit reachable from a ref (both parents of merges), newest first
function walk(r, start, max = MAX_COMMITS) {
  const idx = new Map(r.commits.map((c) => [c.id, c])); const seen = new Set(); const out = []; const queue = start ? [start] : [];
  while (queue.length && out.length < max) { queue.sort((a, b) => b.t - a.t); const c = queue.shift(); if (!c || seen.has(c.id)) continue; seen.add(c.id); out.push(c); for (const p of [c.parent, c.parent2]) if (p && idx.has(p) && !seen.has(p)) queue.push(idx.get(p)); }
  return out;
}
const history = (r, ref, max = MAX_COMMITS) => walk(r, refCommit(r, ref), max);
const ancestors = (r, id) => new Set(walk(r, byId(r, id), 100000).map((c) => c.id));
const ownerOf = (r) => S.users[r.owner];
const uname = (id) => (S.users[id] || {}).username || '?';
function view(r, u, full) {
  norm(r); const o = ownerOf(r); const head = headOf(r);
  const v = { id: r.id, owner: o ? o.username : '?', name: r.name, desc: r.desc, public: r.public, created: r.created, updated: r.updated, stars: (r.stars || []).length, starred: !!(u && (r.stars || []).includes(u.id)), forks: r.forks || 0, forkOf: r.forkOf || null, lang: r.lang || null, files: head ? Object.keys(head.tree).length : 0, canWrite: canWrite(r, u), commits: history(r, null).length, def: r.def, topics: r.topics, website: r.website || '',
    openIssues: r.issues.filter((x) => !x.pr && x.state === 'open').length, openPulls: r.issues.filter((x) => x.pr && x.state === 'open').length };
  if (full) {
    v.ownerUser = o ? publicUser(o) : null; v.isOwner = !!(u && u.id === r.owner); v.collab = (r.collab || []).map(uname);
    v.head = head ? { id: head.id, msg: head.msg, t: head.t, by: uname(head.by) } : null;
    v.branches = Object.entries(r.branches).map(([name, id]) => { const c = byId(r, id); return { name, id, t: c ? c.t : 0, msg: c ? c.msg : '' }; }).sort((a, b) => (a.name === r.def ? -1 : b.name === r.def ? 1 : b.t - a.t));
    v.langs = langsOf(head ? head.tree : {}); v.contributors = [...new Set(history(r, null).map((c) => c.by))].slice(0, 12).map((id) => S.users[id]).filter(Boolean).map(publicUser);
  }
  return v;
}
const LANG = { js: 'JavaScript', mjs: 'JavaScript', ts: 'TypeScript', tsx: 'TypeScript', jsx: 'JavaScript', py: 'Python', html: 'HTML', htm: 'HTML', css: 'CSS', scss: 'SCSS', java: 'Java', c: 'C', h: 'C', cpp: 'C++', hpp: 'C++', cs: 'C#', go: 'Go', rs: 'Rust', php: 'PHP', rb: 'Ruby', lua: 'Lua', sh: 'Shell', kt: 'Kotlin', swift: 'Swift', vue: 'Vue', svelte: 'Svelte', dart: 'Dart', sql: 'SQL' };
function langsOf(tree) { const n = {}; let tot = 0; for (const [p, f] of Object.entries(tree)) { const l = LANG[p.split('.').pop().toLowerCase()]; if (l) { n[l] = (n[l] || 0) + f.size; tot += f.size; } } return Object.entries(n).sort((a, b) => b[1] - a[1]).map(([name, s]) => ({ name, pct: Math.round((s / tot) * 1000) / 10 })); }
const langOf = (tree) => (langsOf(tree)[0] || {}).name || null;

function commit(r, u, msg, changes, branch) {
  norm(r); branch = branch || r.def; if (!(branch in r.branches)) throw new HttpError(404, 'no_branch', 'Branch not found');
  const parent = byId(r, r.branches[branch]); const base = Object.assign({}, parent ? parent.tree : {});
  const log = []; let added = 0;
  for (const ch of changes) {
    const p = String(ch.path || '').trim();
    if (!PATH.test(p)) throw new HttpError(400, 'bad_path', 'Invalid file name: ' + p.slice(0, 60));
    if (ch.delete) { if (base[p]) { added -= base[p].size; delete base[p]; log.push({ p, a: 'del' }); } continue; }
    let buf;
    if (typeof ch.text === 'string') buf = Buffer.from(ch.text, 'utf8');
    else if (typeof ch.b64 === 'string') buf = Buffer.from(ch.b64, 'base64');
    else if (typeof ch.sha === 'string' && blobs.exists(ch.sha)) buf = null;
    else throw new HttpError(400, 'bad_change', 'Missing file content');
    if (buf && buf.length > MAX_FILE) throw new HttpError(413, 'too_big', `${p} is larger than 5 MB`);
    const put = buf ? blobs.putBuffer(buf) : { sha: ch.sha, size: Number(ch.size) || 0 };
    if (base[p] && base[p].sha === put.sha) continue;
    log.push({ p, a: base[p] ? 'mod' : 'add' }); added += put.size - (base[p] ? base[p].size : 0);
    base[p] = { sha: put.sha, size: put.size };
  }
  if (!log.length) throw new HttpError(400, 'no_changes', 'Nothing changed');
  if (Object.keys(base).length > MAX_FILES) throw new HttpError(400, 'too_many', `Up to ${MAX_FILES} files per repository`);
  blobs.charge(u, Math.max(0, added));
  return pushCommit(r, { id: rid(7), msg: clean(msg, 200).replace(/\n/g, ' ') || 'Update files', by: u.id, t: now(), tree: base, changes: log.slice(0, 200), parent: parent ? parent.id : null }, branch, u);
}
function pushCommit(r, c, branch, u) {
  r.commits.unshift(c); if (r.commits.length > MAX_COMMITS) r.commits.length = MAX_COMMITS;
  r.branches[branch] = c.id; r.updated = c.t; if (branch === r.def) r.lang = langOf(c.tree); touch();
  try { require('../progress').award(u, 'work'); } catch {}
  return c;
}
// three-way merge of trees: ok when every path changed on at most one side (or identically on both)
function merge3(baseT, ours, theirs) {
  const out = {}; const conflicts = []; const paths = new Set([...Object.keys(baseT), ...Object.keys(ours), ...Object.keys(theirs)]);
  const sha = (t, p) => (t[p] ? t[p].sha : null);
  for (const p of paths) {
    const b = sha(baseT, p); const o = sha(ours, p); const t = sha(theirs, p);
    let pick;
    if (o === t) pick = ours[p]; else if (o === b) pick = theirs[p]; else if (t === b) pick = ours[p]; else { conflicts.push(p); continue; }
    if (pick) out[p] = pick;
  }
  return { tree: out, conflicts };
}
function mergeBase(r, a, b) { const A = ancestors(r, a); for (const c of walk(r, byId(r, b), 100000)) if (A.has(c.id)) return c; return null; }
function textOf(f) { if (!f) return ''; try { const buf = blobs.readBuffer(f.sha); if (buf.length > 300 * 1024 || !blobs.isText(buf)) return null; return buf.toString('utf8'); } catch { return null; } }
function treeDiff(a, b) { // files changed between two trees, with contents for text files
  const out = []; const paths = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  for (const p of paths) { const x = a[p]; const y = b[p]; if (x && y && x.sha === y.sha) continue; const before = textOf(x); const after = textOf(y); out.push({ p, a: !x ? 'add' : !y ? 'del' : 'mod', before: x ? before : '', after: y ? after : '', binary: (x && before === null) || (y && after === null) }); if (out.length >= 60) break; }
  return out;
}
function issueView(r, x, full) {
  const v = { num: x.num, title: x.title, state: x.state, pr: !!x.pr, by: uname(x.by), byUser: publicUser(S.users[x.by]), t: x.t, labels: x.labels || [], comments: (x.comments || []).length, closedAt: x.closedAt || null, merged: !!x.merged, head: x.head, base: x.base };
  if (full) { v.body = x.body; v.list = (x.comments || []).map((cm) => ({ id: cm.id, by: uname(cm.by), byUser: publicUser(S.users[cm.by]), t: cm.t, body: cm.body, ev: cm.ev || null })); }
  return v;
}
// minimal ZIP writer (stored entries) for "Download ZIP"
function zipOf(entries) {
  const parts = []; const central = []; let off = 0;
  for (const { name, data } of entries) {
    const nb = Buffer.from(name, 'utf8'); const crc = zlib.crc32(data) >>> 0; const d = deflateOrStore(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(d.method, 8); lh.writeUInt32LE(0, 10); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(d.buf.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nb.length, 26); lh.writeUInt16LE(0, 28);
    parts.push(lh, nb, d.buf);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(d.method, 10); ch.writeUInt32LE(0, 12); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(d.buf.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(off, 42);
    central.push(ch, nb); off += 30 + nb.length + d.buf.length;
  }
  const cd = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}
function deflateOrStore(data) { const z = zlib.deflateRawSync(data); return z.length < data.length ? { method: 8, buf: z } : { method: 0, buf: data }; }

// binary formats used by game engines (Emscripten, Unity, Godot, three.js…)
const GAME_TYPES = { wasm: 'application/wasm', data: 'application/octet-stream', mem: 'application/octet-stream', unityweb: 'application/octet-stream', bin: 'application/octet-stream', pck: 'application/octet-stream', glb: 'model/gltf-binary', gltf: 'model/gltf+json', ogg: 'audio/ogg', oga: 'audio/ogg', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', flac: 'audio/flac', ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2', xml: 'application/xml', csv: 'text/csv; charset=utf-8', atlas: 'text/plain; charset=utf-8', fnt: 'text/plain; charset=utf-8', ktx2: 'image/ktx2', basis: 'application/octet-stream' };
const TEXT_TYPES = { html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', json: 'application/json', svg: 'image/svg+xml', txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8', wasm: 'application/wasm' };
// Serves a project file for live preview: an opaque, sandboxed origin (no cookies, no access to Nebulix).
function sendPreview(req, res, tree, path) { return sendFiles(res, (p) => (tree[p] ? blobs.readBuffer(tree[p].sha) : null), path); }
// opts.net: Hub games/apps may load scripts, images, sounds, fonts and data from the internet (https). They still run
// sandboxed on an opaque origin, so they can never read Nebulix cookies or act as the user.
function sendFiles(res, get, path, opts = {}) {
  const O = require('../config').appOrigin;
  const cands = [path, (path ? path.replace(/\/$/, '') + '/' : '') + 'index.html'];
  let name = null; let buf = null; for (const c of cands) { if (c && (buf = get(c))) { name = c; break; } }
  if (!buf) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Security-Policy': 'sandbox' }); return res.end('404 — ' + path); }
  // pre-compressed engine files (game.wasm.br, game.data.gz…): serve the inner type with the right Content-Encoding
  let inner = name; let enc = null; if (opts.net && /\.(br|gz)$/i.test(name) && /\.[a-z0-9]+\.(br|gz)$/i.test(name)) { enc = /\.br$/i.test(name) ? 'br' : 'gzip'; inner = name.slice(0, -3); }
  const ext = inner.split('.').pop().toLowerCase(); const type = GAME_TYPES[ext] || TEXT_TYPES[ext] || blobs.typeOf(inner);
  if (opts.inject && /^(html?)$/.test(ext) && !enc) { buf = opts.inject(buf); }
  // a sandboxed game has the origin "null": let it fetch() its own files (they are public; no cookies are involved)
  res.writeHead(200, Object.assign(enc ? { 'Content-Encoding': enc } : {}, opts.net ? { 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin' } : {}, { 'Content-Type': type, 'Content-Length': buf.length, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    // a sandboxed document has an opaque origin, so 'self' would match nothing: name the origin explicitly
    'Content-Security-Policy': opts.net ? `default-src ${O} https: data: blob:; script-src ${O} https: 'unsafe-inline' 'unsafe-eval' blob:; style-src ${O} https: 'unsafe-inline'; img-src * data: blob:; media-src * data: blob:; font-src ${O} https: data:; connect-src ${O} https: wss: data: blob:; worker-src ${O} https: blob:; frame-src https:; sandbox allow-scripts allow-forms allow-modals allow-pointer-lock allow-popups allow-popups-to-escape-sandbox allow-downloads allow-orientation-lock allow-presentation` : `default-src ${O} data: blob:; script-src ${O} 'unsafe-inline' 'unsafe-eval' blob:; style-src ${O} 'unsafe-inline'; img-src * data: blob:; media-src * data: blob:; font-src ${O} data:; connect-src ${O}; frame-src 'none'; sandbox allow-scripts allow-forms allow-modals allow-pointer-lock allow-popups` }));
  res.end(buf);
}
// Unsaved projects from Nebulix Studio: kept in memory for 30 minutes, then forgotten.
const scratch = new Map(); const SCRATCH_TTL = 30 * 60000;
setInterval(() => { const t = now(); for (const [k, v] of scratch) if (t - v.t > SCRATCH_TTL) scratch.delete(k); }, 60000).unref();

module.exports = function register(r) {
  r.get('/api/code/repos', { auth: true, limit: [120, 60000, 'user'] }, async (c) => {
    const u = c.user; const scope = c.query.scope || 'explore'; const q = String(c.query.q || '').toLowerCase().slice(0, 60);
    let list = Object.values(repos()).map(norm);
    if (scope === 'mine') list = list.filter((x) => x.owner === u.id || (x.collab || []).includes(u.id));
    else if (scope === 'starred') list = list.filter((x) => (x.stars || []).includes(u.id) && canSee(x, u));
    else if (scope === 'user') { const oid = S.byName.get(String(c.query.user || '').toLowerCase()); list = list.filter((x) => x.owner === oid && canSee(x, u)); }
    else list = list.filter((x) => x.public);
    if (q) list = list.filter((x) => x.nameLower.includes(q) || String(x.desc || '').toLowerCase().includes(q) || (x.topics || []).some((tp) => tp.includes(q)));
    list.sort((a, b) => (scope === 'explore' ? (b.stars || []).length - (a.stars || []).length || b.updated - a.updated : b.updated - a.updated));
    return { repos: list.slice(0, 100).map((x) => view(x, u)), usage: blobs.usage(u) };
  });
  r.post('/api/code/repos', { auth: true, verified: true, limit: [20, 3600000, 'user'] }, async (c) => {
    const u = c.user; const name = String(c.body.name || '').trim();
    if (!NAME.test(name)) throw new HttpError(400, 'bad_name', 'Use letters, numbers, dots, dashes and underscores (max 48)');
    if (find(u.username, name)) throw new HttpError(409, 'exists', 'You already have a repository with that name');
    if (Object.values(repos()).filter((x) => x.owner === u.id).length >= maxRepos(u)) throw new HttpError(400, 'too_many', 'Repository limit reached');
    const repo = norm({ id: rid(8), owner: u.id, name, nameLower: name.toLowerCase(), desc: clean(c.body.desc, 200).replace(/\n/g, ' '), public: c.body.public !== false, created: now(), updated: now(), stars: [], forks: 0, commits: [], collab: [] });
    repos()[repo.id] = repo; touch();
    const init = [];
    if (c.body.readme !== false) init.push({ path: 'README.md', text: `# ${name}\n\n${repo.desc || 'A new Nebulix Code repository.'}\n` });
    if (c.body.gitignore) init.push({ path: '.gitignore', text: 'node_modules/\ndist/\n.env\n.DS_Store\n' });
    if (c.body.license) init.push({ path: 'LICENSE', text: `MIT License\n\nCopyright (c) ${new Date().getFullYear()} ${u.username}\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.\n` });
    if (init.length) commit(repo, u, 'Initial commit', init);
    return { repo: view(repo, u, true) };
  });
  r.get('/api/code/r/:owner/:name', { auth: true, limit: [240, 60000, 'user'] }, async (c) => {
    const repo = need(c); const ref = c.query.ref || null; const cm = refCommit(repo, ref); const tree = cm ? cm.tree : {};
    // the last commit that touched each path (like the file table of a forge)
    const last = {}; const hist = history(repo, ref, 300); const want = new Set(Object.keys(tree));
    for (const h of hist) { for (const ch of h.changes || []) if (want.has(ch.p) && !last[ch.p]) last[ch.p] = { id: h.id, msg: h.msg, t: h.t }; if (Object.keys(last).length >= want.size) break; }
    const oldest = hist[hist.length - 1];
    const files = Object.entries(tree).map(([path, f]) => ({ path, size: f.size, last: last[path] || (oldest ? { id: oldest.id, msg: oldest.msg, t: oldest.t } : null) })).sort((a, b) => a.path.localeCompare(b.path));
    const rd = Object.keys(tree).find((p) => /^readme(\.md|\.txt)?$/i.test(p));
    let readme = null; if (rd) { try { readme = blobs.readBuffer(tree[rd].sha).toString('utf8').slice(0, 60000); } catch {} }
    return { repo: view(repo, c.user, true), files, readme, ref: ref || repo.def, commit: cm ? { id: cm.id, msg: cm.msg, t: cm.t, by: uname(cm.by), byUser: publicUser(S.users[cm.by]) } : null, count: hist.length };
  });
  r.get('/api/code/r/:owner/:name/file', { auth: true, limit: [600, 60000, 'user'] }, async (c) => {
    const repo = need(c); const tree = treeOf(repo, c.query.ref); const p = String(c.query.path || ''); const f = tree[p];
    if (!f) throw new HttpError(404, 'no_file', 'File not found');
    const buf = blobs.readBuffer(f.sha); const text = blobs.isText(buf);
    const hist = history(repo, c.query.ref, 300).filter((h) => (h.changes || []).some((x) => x.p === p));
    return { path: p, size: f.size, sha: f.sha, text: text ? buf.toString('utf8') : null, binary: !text, raw: `/x/code/raw/${repo.id}/${f.sha}/${encodeURIComponent(p.split('/').pop())}`, last: hist[0] ? { id: hist[0].id, msg: hist[0].msg, t: hist[0].t, by: uname(hist[0].by) } : null, history: hist.length };
  });
  r.get('/x/code/raw/:id/:sha/:fname', { auth: true }, async (c) => {
    const repo = repos()[c.params.id]; if (!canSee(repo, c.user)) throw new HttpError(404, 'no_repo', 'Not found');
    if (!repo.commits.some((cm) => Object.values(cm.tree).some((f) => f.sha === c.params.sha))) throw new HttpError(404, 'no_file', 'Not found');
    blobs.send(c.req, c.res, c.params.sha, { type: blobs.typeOf(c.params.fname), name: c.params.fname });
  });
  r.get('/x/code/zip/:id/:ref', { auth: true, limit: [20, 60000, 'user'] }, async (c) => {
    const repo = norm(repos()[c.params.id]); if (!canSee(repo, c.user)) throw new HttpError(404, 'no_repo', 'Not found');
    const tree = treeOf(repo, c.params.ref === 'HEAD' ? null : c.params.ref); const top = repo.name + '-' + (c.params.ref === 'HEAD' ? repo.def : c.params.ref).replace(/[^A-Za-z0-9._-]/g, '-');
    const total = Object.values(tree).reduce((a, f) => a + f.size, 0); if (total > 150 * 1048576) throw new HttpError(413, 'too_big', 'Repository too large to zip');
    const zip = zipOf(Object.entries(tree).sort().map(([p, f]) => ({ name: top + '/' + p, data: blobs.readBuffer(f.sha) })));
    c.res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': zip.length, 'Content-Disposition': `attachment; filename="${top}.zip"`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' }); c.res.end(zip);
  });
  r.post('/api/code/r/:owner/:name/commit', { auth: true, verified: true, limit: [60, 60000, 'user'], bodyLimit: 30 * 1024 * 1024 }, async (c) => {
    const repo = need(c, true); if (!Array.isArray(c.body.changes) || !c.body.changes.length || c.body.changes.length > 300) throw new HttpError(400, 'bad_changes', 'Send between 1 and 300 file changes');
    let branch = c.body.branch ? String(c.body.branch) : repo.def;
    if (c.body.newBranch) { const nb = String(c.body.newBranch).trim(); if (!BRANCH.test(nb)) throw new HttpError(400, 'bad_branch', 'Invalid branch name'); if (nb in repo.branches) throw new HttpError(409, 'exists', 'That branch already exists'); repo.branches[nb] = repo.branches[branch] || null; branch = nb; }
    const cm = commit(repo, c.user, c.body.message, c.body.changes, branch);
    return { commit: { id: cm.id, msg: cm.msg, t: cm.t, changes: cm.changes }, branch, repo: view(repo, c.user, true) };
  });
  r.get('/api/code/r/:owner/:name/commits', { auth: true }, async (c) => {
    const repo = need(c); return { commits: history(repo, c.query.ref || null).map((x) => ({ id: x.id, msg: x.msg, t: x.t, by: uname(x.by), byUser: publicUser(S.users[x.by]), changes: x.changes, files: Object.keys(x.tree).length })) };
  });
  r.get('/api/code/r/:owner/:name/commit/:id', { auth: true, limit: [120, 60000, 'user'] }, async (c) => {
    const repo = need(c); const cm = byId(repo, c.params.id); if (!cm) throw new HttpError(404, 'no_commit', 'Commit not found');
    const parent = byId(repo, cm.parent);
    return { commit: { id: cm.id, msg: cm.msg, t: cm.t, by: uname(cm.by), byUser: publicUser(S.users[cm.by]), parent: cm.parent }, files: treeDiff(parent ? parent.tree : {}, cm.tree) };
  });
  // ---- branches ----
  r.post('/api/code/r/:owner/:name/branches', { auth: true, verified: true, limit: [30, 60000, 'user'] }, async (c) => {
    const repo = need(c, true); const name = String(c.body.name || '').trim(); if (!BRANCH.test(name)) throw new HttpError(400, 'bad_branch', 'Use letters, numbers, dots, dashes, slashes');
    if (name in repo.branches) throw new HttpError(409, 'exists', 'That branch already exists'); if (Object.keys(repo.branches).length >= 50) throw new HttpError(400, 'too_many', 'Up to 50 branches');
    const from = refCommit(repo, c.body.from || null); repo.branches[name] = from ? from.id : null; touch(); return { repo: view(repo, c.user, true) };
  });
  r.delete('/api/code/r/:owner/:name/branches/:branch+', { auth: true, verified: true }, async (c) => {
    const repo = need(c, true); const b = c.params.branch; if (!(b in repo.branches)) throw new HttpError(404, 'no_branch', 'Branch not found'); if (b === repo.def) throw new HttpError(400, 'default', 'You cannot delete the default branch');
    delete repo.branches[b]; touch(); return { repo: view(repo, c.user, true) };
  });
  // ---- issues and pull requests (one numbering, like a forge) ----
  r.get('/api/code/r/:owner/:name/issues', { auth: true }, async (c) => {
    const repo = need(c); const pr = c.query.kind === 'pr'; const state = c.query.state === 'closed' ? 'closed' : 'open'; const q = String(c.query.q || '').toLowerCase();
    const all = repo.issues.filter((x) => !!x.pr === pr);
    const list = all.filter((x) => x.state === state && (!q || x.title.toLowerCase().includes(q) || (x.labels || []).some((l) => l.includes(q)))).sort((a, b) => b.num - a.num);
    return { items: list.map((x) => issueView(repo, x)), open: all.filter((x) => x.state === 'open').length, closed: all.filter((x) => x.state === 'closed').length, labels: LABELS };
  });
  r.post('/api/code/r/:owner/:name/issues', { auth: true, verified: true, limit: [20, 600000, 'user'] }, async (c) => {
    const repo = need(c); const title = clean(c.body.title, 200).replace(/\n/g, ' '); if (title.length < 2) throw new HttpError(400, 'bad_title', 'Give it a title');
    const x = { num: repo.nextNum++, title, body: clean(c.body.body, 20000), by: c.user.id, t: now(), state: 'open', labels: (Array.isArray(c.body.labels) ? c.body.labels : []).filter((l) => LABELS.includes(l)).slice(0, 5), comments: [] };
    if (c.body.pr) {
      const head = String(c.body.head || ''); const base = String(c.body.base || repo.def);
      if (!(head in repo.branches) || !(base in repo.branches)) throw new HttpError(404, 'no_branch', 'Branch not found'); if (head === base) throw new HttpError(400, 'same', 'Pick two different branches');
      if (repo.issues.some((y) => y.pr && y.state === 'open' && y.head === head && y.base === base)) throw new HttpError(409, 'exists', 'A pull request for these branches is already open');
      Object.assign(x, { pr: true, head, base });
    }
    repo.issues.push(x); touch();
    if (repo.owner !== c.user.id) hub.push(repo.owner, { t: 'notice', text: `@${c.user.username} opened ${x.pr ? 'pull request' : 'issue'} #${x.num} in ${repo.name}: ${title.slice(0, 60)}` });
    return { item: issueView(repo, x, true) };
  });
  r.get('/api/code/r/:owner/:name/issues/:num', { auth: true }, async (c) => {
    const repo = need(c); const x = repo.issues.find((y) => y.num === Number(c.params.num)); if (!x) throw new HttpError(404, 'no_issue', 'Not found');
    const out = { item: issueView(repo, x, true), canWrite: canWrite(repo, c.user), labels: LABELS };
    if (x.pr) {
      const h = refCommit(repo, x.merged ? x.mergedHead : x.head); const b = refCommit(repo, x.base);
      if (h && b) {
        const mb = x.merged ? byId(repo, x.mergeBase) : mergeBase(repo, b.id, h.id);
        const baseTree = mb ? mb.tree : {};
        out.files = treeDiff(baseTree, h.tree);
        const inBase = x.merged ? (mb ? ancestors(repo, mb.id) : new Set()) : ancestors(repo, b.id); out.commits = walk(repo, h, 100).filter((cm) => !inBase.has(cm.id)).map((cm) => ({ id: cm.id, msg: cm.msg, t: cm.t, by: uname(cm.by) }));
        if (!x.merged) { const m = merge3(baseTree, b.tree, h.tree); out.mergeable = !m.conflicts.length; out.conflicts = m.conflicts; out.upToDate = !out.commits.length; }
      } else out.missing = true;
    }
    return out;
  });
  r.post('/api/code/r/:owner/:name/issues/:num/comments', { auth: true, verified: true, limit: [30, 60000, 'user'] }, async (c) => {
    const repo = need(c); const x = repo.issues.find((y) => y.num === Number(c.params.num)); if (!x) throw new HttpError(404, 'no_issue', 'Not found');
    const body = clean(c.body.body, 20000); if (!body) throw new HttpError(400, 'empty', 'Write a comment');
    x.comments = x.comments || []; x.comments.push({ id: rid(6), by: c.user.id, t: now(), body }); touch();
    for (const id of new Set([x.by, repo.owner])) if (id !== c.user.id) hub.push(id, { t: 'notice', text: `@${c.user.username} commented on #${x.num} in ${repo.name}` });
    return { item: issueView(repo, x, true) };
  });
  r.patch('/api/code/r/:owner/:name/issues/:num', { auth: true, verified: true, limit: [60, 60000, 'user'] }, async (c) => {
    const repo = need(c); const x = repo.issues.find((y) => y.num === Number(c.params.num)); if (!x) throw new HttpError(404, 'no_issue', 'Not found');
    if (!(canWrite(repo, c.user) || x.by === c.user.id)) throw new HttpError(403, 'forbidden', 'You cannot change this');
    x.comments = x.comments || [];
    if (c.body.title !== undefined) x.title = clean(c.body.title, 200).replace(/\n/g, ' ') || x.title;
    if (c.body.body !== undefined) x.body = clean(c.body.body, 20000);
    if (c.body.labels !== undefined && canWrite(repo, c.user)) x.labels = (Array.isArray(c.body.labels) ? c.body.labels : []).filter((l) => LABELS.includes(l)).slice(0, 5);
    if (c.body.state && c.body.state !== x.state && !x.merged) { x.state = c.body.state === 'closed' ? 'closed' : 'open'; x.closedAt = x.state === 'closed' ? now() : null; x.comments.push({ id: rid(6), by: c.user.id, t: now(), body: '', ev: x.state === 'closed' ? 'closed' : 'reopened' }); }
    touch(); return { item: issueView(repo, x, true) };
  });
  r.post('/api/code/r/:owner/:name/issues/:num/merge', { auth: true, verified: true, limit: [20, 60000, 'user'] }, async (c) => {
    const repo = need(c, true); const x = repo.issues.find((y) => y.num === Number(c.params.num)); if (!x || !x.pr) throw new HttpError(404, 'no_pr', 'Pull request not found');
    if (x.state !== 'open') throw new HttpError(400, 'closed', 'This pull request is closed');
    const h = refCommit(repo, x.head); const b = refCommit(repo, x.base); if (!h || !b) throw new HttpError(400, 'missing', 'A branch of this pull request is gone');
    const mb = mergeBase(repo, b.id, h.id);
    let merged;
    if (mb && mb.id === b.id) { repo.branches[x.base] = h.id; merged = h; repo.updated = now(); if (x.base === repo.def) repo.lang = langOf(h.tree); touch(); } // fast-forward
    else {
      const m = merge3(mb ? mb.tree : {}, b.tree, h.tree); if (m.conflicts.length) throw new HttpError(409, 'conflicts', 'Conflicts in: ' + m.conflicts.slice(0, 5).join(', '));
      merged = pushCommit(repo, { id: rid(7), msg: `Merge pull request #${x.num} from ${x.head}`, by: c.user.id, t: now(), tree: m.tree, changes: treeDiff(b.tree, m.tree).map((f) => ({ p: f.p, a: f.a })), parent: b.id, parent2: h.id }, x.base, c.user);
    }
    Object.assign(x, { state: 'closed', merged: true, closedAt: now(), mergedHead: h.id, mergeBase: mb ? mb.id : null }); x.comments = x.comments || []; x.comments.push({ id: rid(6), by: c.user.id, t: now(), body: '', ev: 'merged' });
    if (c.body.deleteBranch && x.head !== repo.def) delete repo.branches[x.head];
    touch(); if (x.by !== c.user.id) hub.push(x.by, { t: 'notice', text: `Your pull request #${x.num} in ${repo.name} was merged 🎉` });
    return { item: issueView(repo, x, true), commit: merged.id };
  });
  // ---- social / settings ----
  r.post('/api/code/r/:owner/:name/star', { auth: true, verified: true, limit: [60, 60000, 'user'] }, async (c) => {
    const repo = need(c); repo.stars = repo.stars || []; const i = repo.stars.indexOf(c.user.id);
    if (i >= 0) repo.stars.splice(i, 1); else { repo.stars.push(c.user.id); if (repo.owner !== c.user.id) hub.push(repo.owner, { t: 'notice', text: `@${c.user.username} starred ${repo.name}` }); }
    touch(); return { stars: repo.stars.length, starred: i < 0 };
  });
  r.post('/api/code/r/:owner/:name/fork', { auth: true, verified: true, limit: [10, 600000, 'user'] }, async (c) => {
    const src = need(c); const u = c.user; let name = src.name; let n = 1; while (find(u.username, name)) name = src.name + '-' + (++n);
    const head = headOf(src); const size = head ? Object.values(head.tree).reduce((a, f) => a + f.size, 0) : 0; blobs.charge(u, size);
    const first = head ? Object.assign({}, head, { id: rid(7), msg: `Fork of ${(ownerOf(src) || {}).username}/${src.name}`, by: u.id, t: now(), parent: null, changes: Object.keys(head.tree).map((p) => ({ p, a: 'add' })).slice(0, 200) }) : null;
    const repo = norm({ id: rid(8), owner: u.id, name, nameLower: name.toLowerCase(), desc: src.desc, public: true, created: now(), updated: now(), stars: [], forks: 0, forkOf: { owner: (ownerOf(src) || {}).username, name: src.name }, commits: first ? [first] : [], branches: { main: first ? first.id : null }, def: 'main', collab: [], lang: src.lang, topics: (src.topics || []).slice() });
    repos()[repo.id] = repo; src.forks = (src.forks || 0) + 1; touch();
    if (src.owner !== u.id) hub.push(src.owner, { t: 'notice', text: `@${u.username} forked ${src.name}` });
    return { repo: view(repo, u, true) };
  });
  r.patch('/api/code/r/:owner/:name', { auth: true, verified: true, limit: [30, 60000, 'user'] }, async (c) => {
    const repo = need(c, true); if (repo.owner !== c.user.id) throw new HttpError(403, 'forbidden', 'Only the owner can change settings');
    if (c.body.desc !== undefined) repo.desc = clean(c.body.desc, 200).replace(/\n/g, ' ');
    if (c.body.website !== undefined) repo.website = /^https?:\/\/\S{3,200}$/.test(String(c.body.website)) ? String(c.body.website) : '';
    if (c.body.topics !== undefined) repo.topics = [...new Set((Array.isArray(c.body.topics) ? c.body.topics : []).map((x) => String(x).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30)).filter(Boolean))].slice(0, 12);
    if (c.body.public !== undefined) repo.public = !!c.body.public;
    if (c.body.def !== undefined && String(c.body.def) in repo.branches) repo.def = String(c.body.def);
    if (c.body.rename !== undefined) { const nn = String(c.body.rename).trim(); if (nn !== repo.name) { if (!NAME.test(nn)) throw new HttpError(400, 'bad_name', 'Invalid name'); if (find(c.user.username, nn)) throw new HttpError(409, 'exists', 'You already have a repository with that name'); repo.name = nn; repo.nameLower = nn.toLowerCase(); } }
    if (c.body.collab !== undefined) repo.collab = (Array.isArray(c.body.collab) ? c.body.collab : []).map((n) => S.byName.get(String(n).replace(/^@/, '').toLowerCase())).filter((id) => id && id !== repo.owner).slice(0, 10);
    touch(); return { repo: view(repo, c.user, true), collab: (repo.collab || []).map(uname) };
  });
  r.delete('/api/code/r/:owner/:name', { auth: true, verified: true }, async (c) => {
    const repo = need(c, true); if (repo.owner !== c.user.id && c.user.role !== 'owner') throw new HttpError(403, 'forbidden', 'Only the owner can delete it');
    const head = headOf(repo); if (head) blobs.charge(ownerOf(repo) || c.user, -Object.values(head.tree).reduce((a, f) => a + f.size, 0));
    delete repos()[repo.id]; touch(); return { ok: true };
  });
  // a user's code profile: repositories, stars and a year of contributions (commits per day)
  r.get('/api/code/u/:user', { auth: true, limit: [60, 60000, 'user'] }, async (c) => {
    const oid = S.byName.get(String(c.params.user).toLowerCase()); const u = oid && S.users[oid]; if (!u || u.deleted) throw new HttpError(404, 'no_user', 'User not found');
    const days = {}; const since = now() - 371 * 86400000; let total = 0;
    for (const rp of Object.values(repos())) { if (!canSee(rp, c.user)) continue; for (const cm of rp.commits) if (cm.by === oid && cm.t >= since) { const k = new Date(cm.t).toISOString().slice(0, 10); days[k] = (days[k] || 0) + 1; total++; } for (const x of rp.issues || []) if (x.by === oid && x.t >= since) { const k = new Date(x.t).toISOString().slice(0, 10); days[k] = (days[k] || 0) + 1; total++; } }
    const list = Object.values(repos()).map(norm).filter((x) => x.owner === oid && canSee(x, c.user)).sort((a, b) => b.updated - a.updated);
    const stars = list.reduce((a, x) => a + (x.stars || []).length, 0);
    const pinned = list.slice().sort((a, b) => (b.stars || []).length - (a.stars || []).length || b.updated - a.updated).slice(0, 6);
    return { user: publicUser(u), days, total, repos: list.map((x) => view(x, c.user)), pinned: pinned.map((x) => view(x, c.user)), stars, starred: Object.values(repos()).filter((x) => (x.stars || []).includes(oid) && canSee(x, c.user)).length };
  });
  r.post('/api/code/scratch', { auth: true, limit: [60, 60000, 'user'], bodyLimit: 8 * 1024 * 1024 }, async (c) => {
    const inp = c.body.files; if (!inp || typeof inp !== 'object') throw new HttpError(400, 'bad_files', 'No files');
    const files = new Map(); let total = 0;
    for (const [p, txt] of Object.entries(inp).slice(0, 300)) { if (!PATH.test(p) || typeof txt !== 'string') continue; const b = Buffer.from(txt, 'utf8'); total += b.length; if (total > 8 * 1024 * 1024) throw new HttpError(413, 'too_big', 'Project too large to preview'); files.set(p, b); }
    for (const [k, v] of scratch) if (v.uid === c.user.id) scratch.delete(k); // one live preview per user
    const id = rid(12); scratch.set(id, { uid: c.user.id, t: now(), files });
    return { id, url: `/x/live/${id}/` };
  });
  r.get('/x/live/:id/:rest+', {}, async (c) => { const sc = scratch.get(c.params.id); if (!sc) throw new HttpError(404, 'expired', 'Preview expired — press Run again'); sendFiles(c.res, (p) => sc.files.get(p) || null, c.params.rest); });
  // live preview of a commit (commit ids are random, so they work as a capability for private repos)
  r.get('/x/preview/:id/:commit/:rest+', {}, async (c) => { const repo = repos()[c.params.id]; const cm = repo && repo.commits.find((x) => x.id === c.params.commit); if (!cm) throw new HttpError(404, 'no_preview', 'Not found'); sendPreview(c.req, c.res, cm.tree, c.params.rest); });
  r.get('/x/preview/:id/:commit', {}, async (c) => { const repo = repos()[c.params.id]; const cm = repo && repo.commits.find((x) => x.id === c.params.commit); if (!cm) throw new HttpError(404, 'no_preview', 'Not found'); c.res.writeHead(302, { Location: `/x/preview/${repo.id}/${cm.id}/index.html` }); c.res.end(); });
};
module.exports.find = find;
module.exports.sendFiles = sendFiles;
module.exports.zipOf = zipOf;
module.exports.NET_CSP = () => { const O = require('../config').appOrigin; return `default-src ${O} https: data: blob:; script-src ${O} https: 'unsafe-inline' 'unsafe-eval' blob:; style-src ${O} https: 'unsafe-inline'; img-src * data: blob:; media-src * data: blob:; font-src ${O} https: data:; connect-src ${O} https: wss: data: blob:; worker-src ${O} https: blob:; frame-src https:; sandbox allow-scripts allow-forms allow-modals allow-pointer-lock allow-popups allow-popups-to-escape-sandbox allow-downloads allow-orientation-lock allow-presentation`; };
module.exports.typeFor = (name) => { const ext = name.split('.').pop().toLowerCase(); return GAME_TYPES[ext] || TEXT_TYPES[ext] || blobs.typeOf(name); };
