// Nebulix 13.1 — Nova Agent (PRO): Nova works on your Nebulix the way a coding agent works on a project.
// The model answers with at most one action per step in a ```nbx-action``` block; the browser runs it with YOUR session
// (the same APIs the app uses), shows a card for it and feeds the result back, step by step, until the task is done.
// Anything that changes something (writing files, notes, your profile, buying…) waits for your approval, unless you
// turn on "Approve changes automatically" for this chat. Reading never changes anything and runs straight away.
import { api } from './api.js';
import { S } from './state.js';
import { askNova } from './nova-core.js';
import { t } from './i18n.js';

export const MAX_STEPS = 12;
const enc = encodeURIComponent;
const trim = (v, n = 6000) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s.length > n ? s.slice(0, n) + '…(cut)' : s; };
const repoPath = (a) => { const [o, n] = String(a.repo || '').includes('/') ? String(a.repo).split('/') : [S.me.username, a.repo]; if (!n) throw new Error('repo is required ("owner/name" or your repo name)'); return `/api/code/r/${enc(o)}/${enc(n)}`; };

// run JavaScript in a throwaway sandbox (no access to Nebulix, no network to your account) and return the console
function runJs(code) {
  return new Promise((res) => {
    const id = 'nx' + Math.random().toString(36).slice(2); const logs = []; let done = false;
    const fr = document.createElement('iframe'); fr.sandbox = 'allow-scripts'; fr.style.display = 'none';
    const finish = (extra) => { if (done) return; done = true; removeEventListener('message', on); fr.remove(); res({ logs: logs.slice(0, 200), ...extra }); };
    const on = (e) => { if (e.source !== fr.contentWindow || !e.data || e.data.id !== id) return; if (e.data.end) finish({ ok: !e.data.err, error: e.data.err || null }); else logs.push(e.data.line); };
    addEventListener('message', on);
    const src = `<script>const P=(o)=>parent.postMessage(Object.assign({id:${JSON.stringify(id)}},o),'*');const f=(k)=>(...a)=>P({line:(k==='log'?'':k+': ')+a.map(x=>{try{return typeof x==='string'?x:JSON.stringify(x)}catch(e){return String(x)}}).join(' ')});console.log=f('log');console.error=f('error');console.warn=f('warn');console.info=f('log');
(async()=>{try{${String(code).replace(/<\/script/gi, '<\\/script')}\n;P({end:1})}catch(e){P({line:'error: '+e.message});P({end:1,err:e.message})}})();<\/script>`;
    fr.srcdoc = src; document.body.append(fr); setTimeout(() => finish({ ok: false, error: 'timeout (5 s)' }), 5000);
  });
}

// tool: { d: description for the model, args, write: needs approval, run(args) → result, label(args) for the card }
export const TOOLS = {
  'me': { d: 'Your account: username, coins, level, PRO.', args: '{}', run: async () => { const m = (await api.get('/api/me')).user; return { username: m.username, displayName: m.displayName, coins: m.coins, lvl: m.lvl, pro: m.pro }; } },
  'code.repos': { d: 'List your repositories in Nebulix Code.', args: '{}', run: async () => (await api.get('/api/code/repos?scope=mine')).repos.map((r) => ({ repo: r.owner + '/' + r.name, desc: r.desc, files: r.files, updated: r.updated, public: r.public })) },
  'code.files': { d: 'List the files of a repository and read its README.', args: '{"repo":"owner/name"}', run: async (a) => { const r = await api.get(repoPath(a)); return { files: r.files.map((f) => f.path + ' (' + f.size + ' B)'), readme: trim(r.readme || '', 3000) }; } },
  'code.read': { d: 'Read one file of a repository.', args: '{"repo":"owner/name","path":"src/app.js"}', run: async (a) => { const r = await api.get(repoPath(a) + '/file?path=' + enc(a.path)); return r.binary ? { binary: true, size: r.size } : { path: r.path, text: trim(r.text, 12000) }; } },
  'code.create_repo': { d: 'Create a new repository (with README).', args: '{"name":"my-game","desc":"…","public":true}', write: true, label: (a) => t('Create repository “{n}”', { n: a.name }), run: async (a) => { const r = await api.post('/api/code/repos', { name: a.name, desc: a.desc || '', public: a.public !== false, readme: true }); return { repo: r.repo.owner + '/' + r.repo.name }; } },
  'code.write': { d: 'Create or overwrite files in a repository, as one commit. Give the FULL content of every file.', args: '{"repo":"owner/name","message":"Add game loop","files":[{"path":"index.html","content":"…"}]}', write: true, label: (a) => t('Commit “{m}” to {r}: {f}', { m: a.message || 'Update', r: a.repo, f: (a.files || []).map((f) => f.path).join(', ') }), diff: true,
    run: async (a) => { const r = await api.post(repoPath(a) + '/commit', { message: String(a.message || 'Update from Nova').slice(0, 200), changes: (a.files || []).slice(0, 40).map((f) => ({ path: f.path, text: String(f.content || '') })) }); return { commit: r.commit.id, files: (a.files || []).length }; } },
  'code.delete': { d: 'Delete files from a repository (one commit).', args: '{"repo":"owner/name","paths":["old.js"],"message":"Remove old file"}', write: true, label: (a) => t('Delete {f} in {r}', { f: (a.paths || []).join(', '), r: a.repo }), run: async (a) => { const r = await api.post(repoPath(a) + '/commit', { message: a.message || 'Delete files', changes: (a.paths || []).map((p) => ({ path: p, delete: true })) }); return { commit: r.commit.id }; } },
  'run.js': { d: 'Run JavaScript in a sandbox and get the console output (to test code). No DOM of Nebulix, 5 s limit.', args: '{"code":"console.log(1+1)"}', run: async (a) => runJs(a.code) },
  'notes.list': { d: 'List your notes.', args: '{}', run: async () => (await api.get('/api/notes')).notes.slice(0, 50).map((n) => ({ id: n.id, title: n.title, updated: n.updated })) },
  'notes.read': { d: 'Read a note.', args: '{"id":"…"}', run: async (a) => { const n = (await api.get('/api/notes/' + enc(a.id))).note; return { id: n.id, title: n.title, body: trim(n.body, 8000) }; } },
  'notes.create': { d: 'Create a note.', args: '{"title":"…","body":"…"}', write: true, label: (a) => t('Create note “{n}”', { n: a.title || '' }), run: async (a) => ({ id: (await api.post('/api/notes', { title: a.title, body: a.body })).note.id }) },
  'notes.update': { d: 'Change a note (title and/or body).', args: '{"id":"…","title":"…","body":"…"}', write: true, label: (a) => t('Edit note {n}', { n: a.id }), run: async (a) => { const b = {}; if (a.title !== undefined) b.title = a.title; if (a.body !== undefined) b.body = a.body; await api.patch('/api/notes/' + enc(a.id), b); return { ok: true }; } },
  'drive.list': { d: 'List the files in your Drive.', args: '{}', run: async () => { const r = await api.get('/api/drive/list'); return (r.items || r.files || []).slice(0, 80).map((x) => ({ id: x.id, name: x.name, kind: x.kind || x.type, size: x.size })); } },
  'hub.mine': { d: 'List your Hub uploads (games, apps, videos).', args: '{}', run: async () => (await api.get('/api/hub?mine=1')).items.map((x) => ({ id: x.id, kind: x.kind, title: x.title, public: x.public, views: x.views, price: x.sale ? x.sale.price : 0 })) },
  'hub.update': { d: 'Change the title, description, tags or visibility of one of your Hub uploads.', args: '{"id":"…","title":"…","desc":"…","tags":["…"],"public":true}', write: true, label: (a) => t('Edit Hub upload {n}', { n: a.id }), run: async (a) => { const b = {}; for (const k of ['title', 'desc', 'tags', 'public']) if (a[k] !== undefined) b[k] = a[k]; return { item: (await api.patch('/api/hub/' + enc(a.id), b)).item.title }; } },
  'vault.price': { d: 'Set the price (coins) and discount of one of your games in Nebula Vault.', args: '{"id":"…","price":500,"disc":0}', write: true, label: (a) => t('Price of {n}: {p} coins', { n: a.id, p: a.price }) + (a.disc ? ' (-' + a.disc + '%)' : ''), run: async (a) => api.post(`/api/vault/${enc(a.id)}/sale`, { price: a.price, disc: a.disc || 0, days: a.days || 7 }) },
  'profile.update': { d: 'Change your display name or bio.', args: '{"displayName":"…","bio":"…"}', write: true, label: (a) => t('Update your profile') + (a.displayName ? ' · ' + a.displayName : ''), run: async (a) => { const b = {}; if (a.displayName) b.displayName = a.displayName; if (a.bio !== undefined) b.bio = a.bio; await api.patch('/api/profile', b); return { ok: true }; } },
  'shop.today': { d: 'See today’s Shop (items, prices, exclusives).', args: '{}', run: async () => { const d = await api.get('/api/shop'); const m = (x) => ({ id: x.id, name: x.n[0], cat: x.cat, price: x.price, owned: x.owned }); return { daily: d.daily.map(m), exclusive: d.excl.map(m), bundles: d.bundles.map((b) => ({ id: b.id, price: b.price })) }; } },
  'shop.buy': { d: 'Buy something from today’s Shop.', args: '{"id":"…"}', write: true, label: (a) => t('Buy “{n}” in the Shop', { n: a.id }), run: async (a) => { const r = await api.post('/api/shop/buy', { id: a.id }); return { ok: true, coins: r.coins }; } },
  'locker.equip': { d: 'Equip an item you own in your Locker (slot: outfit, backpack, pickaxe, glider, wrap, trail, elim).', args: '{"slot":"outfit","id":"…"}', write: true, label: (a) => t('Equip {n}', { n: a.id }), run: async (a) => { await api.post('/api/locker/equip', { slot: a.slot, id: a.id }); return { ok: true }; } },
  'open.page': { d: 'Offer the user a button to open a part of Nebulix (route like "arena", "shop/locker", "code", "hub/<id>").', args: '{"route":"shop"}', run: async (a) => ({ ok: true, route: String(a.route || '').replace(/^#?\/?/, '') }) },
};
export function toolsPrompt() {
  return Object.entries(TOOLS).map(([k, v]) => `- ${k}${v.write ? ' [changes things]' : ''}: ${v.d} Args: ${v.args}`).join('\n');
}
// first ```nbx-action``` block of an answer → { tool, args } (or null)
export function parseAction(text) {
  const m = /```nbx-action\s*\n([\s\S]*?)```/.exec(text || ''); if (!m) return null;
  try {
    let j = JSON.parse(m[1]);
    // some models wrap the action once more ({"tool":"nbx-action","args":{"tool":…,"args":…}}) or call it by name
    while (j && j.args && typeof j.args.tool === 'string' && (j.tool === 'nbx-action' || j.tool === 'action' || !TOOLS[j.tool])) j = j.args;
    if (j && !j.tool && j.name) j = { tool: j.name, args: j.arguments || j.parameters || {} };
    if (j && typeof j.tool === 'string') return { tool: j.tool, args: j.args && typeof j.args === 'object' ? j.args : {}, raw: m[0] };
  } catch { return { error: 'The action block is not valid JSON', raw: m[0] }; }
  return null;
}
// one agent turn. hooks: onText(d) / onReason(d) for the live answer, onStep(step) after every step,
// approve(step) → Promise<boolean> for write tools. Returns the list of steps.
export async function runAgent({ messages, signal, model, hooks, auto = () => false }) {
  const convo = messages.slice(); const steps = [];
  for (let i = 0; i < MAX_STEPS; i++) {
    let text = ''; hooks.onStart && hooks.onStart(i);
    const r = await askNova({ messages: convo, mode: 'code', agent: toolsPrompt(), model, signal, onText: (d) => { text += d; hooks.onText(d); }, onReason: (d) => hooks.onReason && hooks.onReason(d) });
    const act = parseAction(text); convo.push({ role: 'assistant', content: text });
    if (!act) return { steps, last: r };
    const step = { i, tool: act.tool, args: act.args, status: 'pending', model: r.model };
    if (act.error) { step.status = 'error'; step.result = act.error; }
    else {
      const T = TOOLS[act.tool];
      if (!T) { step.status = 'error'; step.result = 'Unknown tool: ' + act.tool; }
      else {
        step.write = !!T.write; step.label = T.label ? T.label(act.args) : act.tool; step.diff = !!T.diff;
        let ok = true; if (T.write && !auto()) { hooks.onStep(Object.assign(step, { status: 'ask' })); ok = await hooks.approve(step); }
        if (!ok) { step.status = 'denied'; step.result = 'The user did not allow this action.'; }
        else { step.status = 'running'; hooks.onStep(step); try { step.result = await T.run(act.args); step.status = 'done'; } catch (e) { step.status = 'error'; step.result = (e && e.message) || 'failed'; } }
      }
    }
    steps.push(step); hooks.onStep(step);
    convo.push({ role: 'user', content: `TOOL RESULT for ${act.tool} (${step.status}):\n${trim(step.result)}\n\nContinue the task. Use another action if needed, or give the final answer without an action block.` });
    if (signal && signal.aborted) break;
  }
  return { steps, last: null, limit: true };
}
