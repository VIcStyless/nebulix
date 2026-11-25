// Admin & moderation panel. Visible to staff (mod/admin/owner); some actions need admin or owner.
import { h, mount, fmt, debounce } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { S, isAdmin, isStaff } from '../state.js';
import { icon } from '../icons.js';
import { toast, toastErr, tabsEl, promptBox, confirmBox, copyBtn, loading, modal, busy, switchEl, emojiPicker, field, settingRow } from '../ui.js';
import { roleChip } from '../roles.js';
import { avatarEl } from '../cosmetics.js';

const owner = () => S.me && S.me.role === 'owner';
const tierPick = () => new Promise((res) => { const m = modal({ title: t('Which plan?'), body: h('div.col', { style: 'gap:6px' }, [['premium', 'Premium'], ['pro', 'Premium Pro'], ['ultimate', 'Premium Ultimate']].map(([k, n]) => h('button.btn', { onClick: () => { m.close(); res(k); } }, icon('crown', 14), n))), actions: [{ label: t('Cancel'), value: null }] }); m.then((v) => { if (v === null || v === true) res(null); }); });


export default {
  title: () => t('Admin'),
  mount(root, ctx) {
    if (!isStaff()) { mount(root, h('div.page', h('div.empty', h('div.empty-art.ea-mark'), h('h3', t('Staff only'))))); return () => {}; }
    const TABS = [['overview', 'Overview', 'monitor', overview], ['users', 'Users', 'users', users], ['reports', 'Reports', 'flag', reports], ['content', 'Content', 'layers', content], ['modlog', 'Moderation log', 'clock', modlog]];
    if (isAdmin()) TABS.splice(2, 0, ['coins', 'Coins', 'coins', coinsTab], ['control', 'Control', 'power', controlTab]);
    if (isAdmin()) TABS.push(['ai', 'AI', 'bolt', aiTab], ['groles', 'Community roles', 'shield', groles], ['codes', 'PRO codes', 'gift', codes], ['announce', 'Announce', 'bell', announce], ['system', 'System', 'server', system], ['compute', 'Compute', 'cpu', computeTab]);
    let cleanup = null, token = 0;
    const body = h('div.adm-body');
    const first = TABS.some((x) => x[0] === ctx.params[0]) ? ctx.params[0] : 'overview';
    async function show(id) {
      const my = ++token; if (cleanup) { try { cleanup(); } catch {} cleanup = null; }
      history.replaceState(null, '', '#/admin/' + id); mount(body, loading());
      try { const box = h('div.adm-tab'); const fn = TABS.find((x) => x[0] === id)[3]; mount(body, box); const c = await fn(box, ctx); if (my === token) cleanup = typeof c === 'function' ? c : null; }
      catch (e) { if (my === token) mount(body, h('span.error', e.message)); }
    }
    mount(root, h('div.page.admin', h('div.page-title', h('div', h('h2', '', t('Admin')), h('p', t('Moderate the community and run Nebulix.')))), h('div.adm-tabs', tabsEl(TABS.map(([i, l, ic]) => [i, t(l), ic]), first, show)), body));
    show(first);
    return () => { token++; if (cleanup) try { cleanup(); } catch {} };
  },
};

async function overview(box) {
  const s = await api.get('/api/admin/stats');
  const tile = (label, v, ic) => h('div.adm-stat', h('div.adm-stat-ic', icon(ic, 18)), h('div', h('b', fmt.num(v)), h('div.tiny.muted', label)));
  mount(box,
    h('div.adm-stats',
      tile(t('Members'), s.users, 'users'), tile(t('Verified'), s.verified, 'check'), tile(t('PRO'), s.pro, 'crown'), tile(t('Online now'), s.online, 'wifi'),
      tile(t('Banned'), s.banned, 'shield'), tile(t('Servers'), s.servers, 'server'), tile(t('Themes'), s.themes, 'palette'), tile(t('Open reports'), s.openReports, 'flag'),
      tile(t('Coins in circulation'), s.coinsInCirculation, 'coins'), tile(t('Proxy sessions'), s.proxy.sessions, 'globe')),
    h('div.nl-grid', { style: 'margin-top:14px' },
      h('section.card.nl-card', h('h3', icon('server', 18), t('Server')),
        kv('Nebulix', 'v' + s.version), kv('Node.js', s.node), kv(t('Uptime'), fmt.dur(s.uptime)), kv(t('Memory'), s.memMB + ' MB'), kv(t('Data on disk'), s.dataMB + ' MB'), kv(t('Email mode'), s.mail), kv(t('Public link'), s.public ? t('On') : t('Off'))),
      h('section.card.nl-card', h('h3', icon('globe', 18), t('Proxy')),
        kv(t('Active sessions'), fmt.num(s.proxy.sessions)), kv(t('Requests served'), fmt.num(s.proxy.requests || 0)), kv(t('Data proxied'), fmt.bytes(s.proxy.bytes || 0)), kv(t('Cache entries'), fmt.num((s.proxy.cache || {}).entries || 0)), kv(t('Cache size'), fmt.bytes((s.proxy.cache || {}).bytes || 0)))));
}
const kv = (k, v) => h('div.nl-kv', h('span', k), h('b', v === undefined || v === null || v === '' ? '—' : v));

async function users(box, ctx) {
  const search = h('input.input', { type: 'search', placeholder: t('Search by name, email or ID'), 'aria-label': t('Search users') });
  const listBox = h('div.col', { style: 'gap:8px' }, loading());
  async function run(q) {
    try { const r = await api.get('/api/admin/users' + (q ? '?q=' + encodeURIComponent(q) : '')); paint(r); } catch (e) { mount(listBox, h('span.error', e.message)); }
  }
  function paint(r) {
    if (!r.users.length) return mount(listBox, h('div.empty', { style: 'padding:20px' }, h('p', t('No users found.'))));
    mount(listBox, h('div.tiny.muted', t('{a} shown of {b}', { a: r.users.length, b: r.total })), r.users.map(rowFor));
  }
  function rowFor(u) {
    const banned = u.banned && (!u.banned.until || u.banned.until > Date.now());
    const tags = [u.mutedUntil ? h('span.pill.bad', '🔇 ' + t('muted')) : null, u.warnings ? h('span.pill', '⚠ ' + u.warnings) : null, u.role !== 'user' ? h('span.pill', u.role) : null, u.pro ? h('span.pill.pro', 'PRO') : null, u.infinite ? h('span.pill.pro', '∞ ' + t('coins')) : null, !u.verified ? h('span.pill', t('unverified')) : null, banned ? h('span.pill.bad', t('banned')) : null];
    const row = h('div.card.adm-user', avatarEl(u, { size: 40, frame: false }),
      h('div.grow', h('div.row', { style: 'gap:6px' }, h('b', u.displayName || u.username), tags), h('div.tiny.muted', '@' + u.username + ' · ' + u.email + ' · ' + t('joined {d}', { d: fmt.date(u.created) })),
        h('div.tiny.muted', t('{c} coins · {s} sessions · last seen {d}', { c: u.infinite ? '∞' : fmt.coins(u.coins), s: u.sessions, d: u.lastSeen ? fmt.rel(u.lastSeen) : '—' }))),
      h('button.btn.sm', { onClick: (e) => menu(u, row, e) }, icon('more', 16), t('Actions')));
    return row;
  }
  function menu(u, row, ev) {
    const act = async (fn) => { try { const r = await fn(); if (r && r.user) { const nu = rowFor(r.user); row.replaceWith(nu); } } catch (e) { toastErr(e); } };
    const banned = u.banned && (!u.banned.until || u.banned.until > Date.now());
    const items = [
      { label: t('View profile'), icon: 'user', onClick: () => ctx.go('profile', u.username) },
      !u.verified && isAdmin() ? { label: t('Verify (+50 coins)'), icon: 'check', onClick: () => act(() => api.post(`/api/admin/users/${u.id}/verify`)) } : null,
      isAdmin() ? { label: t('Give / take coins'), icon: 'coins', onClick: () => act(async () => { const v = await promptBox(t('Adjust coins'), { label: t('Amount (use a minus sign to remove)'), type: 'text', validate: (x) => (Number.isFinite(+x) ? null : t('Enter a number')) }); if (v === null) return; return api.post(`/api/admin/users/${u.id}/coins`, { delta: Math.trunc(+v), reason: 'admin' }); }) } : null,
      owner() ? { label: u.infinite ? t('Turn off unlimited coins') : t('Give unlimited coins'), icon: 'coins', onClick: () => act(() => api.post(`/api/admin/users/${u.id}/infinite`, { on: !u.infinite })) } : null,
      isAdmin() ? { label: t('Community roles…'), icon: 'shield', onClick: () => assignGroles(u) } : null,
      isAdmin() ? { label: t('Grant PRO days'), icon: 'crown', onClick: () => act(async () => { const v = await promptBox(t('Grant PRO'), { label: t('Days of PRO to add'), type: 'number' }); if (!v) return; const tier = await tierPick(); if (!tier) return; return api.post(`/api/admin/users/${u.id}/pro`, { days: Math.trunc(+v), tier }); }) } : null,
      owner() && u.role !== 'owner' ? { label: t('Change role'), icon: 'shield', onClick: () => act(async () => { const v = await pickRole(u.role); if (!v) return; return api.post(`/api/admin/users/${u.id}/role`, { role: v }); }) } : null,
      { hr: true },
      { label: t('Warn…'), icon: 'alert', onClick: () => act(async () => { const reason = await promptBox(t('Warn {n}', { n: u.username }), { label: t('Reason (they will see it)') }); if (!reason) return; return api.post(`/api/admin/users/${u.id}/warn`, { reason }); }) },
      u.mutedUntil ? { label: t('Unmute'), icon: 'volume', onClick: () => act(() => api.post(`/api/admin/users/${u.id}/mute`, { minutes: 0 })) }
        : { label: t('Mute…'), icon: 'micoff', onClick: () => act(async () => { const mins = await pickMute(); if (!mins) return; const reason = await promptBox(t('Mute {n}', { n: u.username }), { label: t('Reason (optional)') }); if (reason === null) return; return api.post(`/api/admin/users/${u.id}/mute`, { minutes: mins, reason }); }) },
      u.warnings ? { label: t('See warnings ({n})', { n: u.warnings }), icon: 'flag', onClick: async () => { try { const r = await api.get(`/api/admin/users/${u.id}/warnings`); modal({ title: t('Warnings for @{u}', { u: u.username }), body: h('div.col', { style: 'gap:6px' }, r.warnings.map((w) => h('div.card.tight', h('div.small', w.reason), h('div.tiny.muted', fmt.dt(w.t) + ' · @' + w.byName)))), actions: [{ label: t('Close'), kind: 'primary' }] }); } catch (e) { toastErr(e); } } } : null,
      banned ? { label: t('Unban'), icon: 'check', onClick: () => act(() => api.post(`/api/admin/users/${u.id}/unban`)) }
        : { label: t('Ban'), icon: 'shield', danger: true, onClick: () => act(async () => { const reason = await promptBox(t('Ban {n}', { n: u.username }), { label: t('Reason'), hint: t('Leave hours empty for a permanent ban.') }); if (reason === null) return; const hrs = await promptBox(t('Duration'), { label: t('Hours (empty = permanent)'), type: 'number' }); return api.post(`/api/admin/users/${u.id}/ban`, { reason, hours: hrs ? +hrs : 0 }); }) },
    ].filter(Boolean);
    import('../ui.js').then((ui) => ui.openMenu(items, ev.currentTarget));
  }
  function pickMute() {
    return new Promise((res) => {
      let v = null; const opts = [[10, t('10 minutes')], [60, t('1 hour')], [360, t('6 hours')], [1440, t('1 day')], [10080, t('7 days')]];
      const p = modal({ title: t('Mute for how long?'), body: h('div.col', { style: 'gap:6px' }, opts.map(([m, l]) => h('button.btn', { onClick: () => { v = m; p.close(); } }, l))), actions: [{ label: t('Cancel'), value: false }] });
      p.then(() => res(v));
    });
  }
  function pickRole(cur) {
    return new Promise((res) => {
      const roles = ['user', 'mod', 'admin'];
      modal({ title: t('Change role'), body: h('div.col', roles.map((r) => h('button.btn' + (r === cur ? '.primary' : ''), { onClick: () => { m.close(); res(r === cur ? null : r); } }, t(r)))), actions: [{ label: t('Cancel'), value: false }] }).then(() => res(null));
      var m = { close: () => {} };
    });
  }
  search.oninput = debounce(() => run(search.value.trim()), 350);
  mount(box, h('div.row', { style: 'margin-bottom:12px' }, search), listBox); run('');
}

async function reports(box, ctx) {
  let showAll = false;
  const listBox = h('div.col', { style: 'gap:8px' });
  async function run() {
    mount(listBox, loading());
    try { const r = await api.get('/api/admin/reports' + (showAll ? '?all=1' : '')); if (!r.reports.length) return mount(listBox, h('div.empty', { style: 'padding:20px' }, h('div.empty-art.ea-mark'), h('p', t('No open reports. Nice and quiet.')))); mount(listBox, r.reports.map(rowFor)); }
    catch (e) { mount(listBox, h('span.error', e.message)); }
  }
  function rowFor(rp) {
    return h('div.card.adm-report' + (rp.open ? '' : '.done'),
      h('div.row', h('span.pill', rp.type), h('b.grow', t('Reported by @{n}', { n: rp.byName })), h('span.tiny.muted', fmt.rel(rp.t))),
      rp.reason ? h('p.small', rp.reason) : null,
      h('div.tiny.muted', t('Target: {t}', { t: rp.target })),
      rp.open ? h('div.row.wrap', { style: 'margin-top:6px' },
        h('button.btn.sm', { onClick: () => resolve(rp, 'reviewed') }, t('Mark reviewed')),
        h('button.btn.sm.ghost', { onClick: () => resolve(rp, 'dismissed') }, t('Dismiss'))) : h('div.tiny.muted', t('Resolved: {s}', { s: rp.resolution || 'done' })));
  }
  async function resolve(rp, resolution) { try { await api.post(`/api/admin/reports/${rp.id}/resolve`, { resolution }); run(); } catch (e) { toastErr(e); } }
  const toggle = h('label.row', { style: 'gap:6px;cursor:pointer' }, h('input', { type: 'checkbox', onchange: (e) => { showAll = e.target.checked; run(); } }), h('span.small', t('Show resolved too')));
  mount(box, h('div.row.between', h('div.grow'), toggle), listBox); run();
}

async function codes(box) {
  const listBox = h('div.col', { style: 'gap:6px' });
  // card payments switch (owner): off = PRO only through codes; Stripe stays configured
  if (S.me.role === 'owner') api.get('/api/pro/state', { quiet: true }).then((st) => {
    let on = !(st.payments && st.payments.cardsOff);
    const btn = h('button.btn.sm', { onClick: async () => { try { await api.put('/api/admin/payments', { cards: !on }); on = !on; paintBtn(); toast(on ? t('Card payments on') : t('Card payments off'), 'good'); } catch (er) { toastErr(er); } } });
    const paintBtn = () => { btn.textContent = on ? t('On') : t('Off'); btn.classList.toggle('primary', on); }; paintBtn();
    box.prepend(h('div.card.tight', { style: 'margin-bottom:12px' }, h('div.row', h('div.grow', h('b', t('Card payments (Stripe)')), h('div.small.muted', t('Off: PRO is only unlocked with codes. Your Stripe setup is kept.'))), btn)));
  }).catch(() => {});
  async function run() { mount(listBox, loading()); try { const r = await api.get('/api/admin/codes'); paint(r.codes); } catch (e) { mount(listBox, h('span.error', e.message)); } }
  function paint(list) {
    if (!list.length) return mount(listBox, h('div.empty', { style: 'padding:16px' }, h('p', t('No PRO codes yet. Generate some to give out.'))));
    mount(listBox, list.sort((a, b) => b.created - a.created).map((c) => h('div.card.adm-code' + (c.disabled ? '.off' : ''),
      h('code.grow', c.code), h('span.pill', t('{n} days', { n: c.days })), h('span.small.muted', t('{u}/{m} used', { u: c.used, m: c.max })), c.note ? h('span.tiny.muted', c.note) : null,
      copyBtn(c.code), c.disabled ? h('span.pill.bad', t('disabled')) : h('button.btn.sm.ghost', { onClick: async () => { if (await confirmBox(t('Disable this code?'))) { try { await api.del('/api/admin/codes/' + encodeURIComponent(c.code)); run(); } catch (e) { toastErr(e); } } } }, t('Disable')))));
  }
  const gen = h('button.btn.primary', { onClick: () => busy(gen, async () => {
    const tier = await tierPick(); if (!tier) return;
    const days = await promptBox(t('Generate PRO codes'), { label: t('Days of PRO each code grants'), type: 'number', value: '30' }); if (!days) return;
    const count = await promptBox(t('How many codes?'), { label: t('Number of codes (1-50)'), type: 'number', value: '1' }); if (!count) return;
    try { const r = await api.post('/api/admin/codes', { days: +days, count: +count, max: 1, tier }); await navigator.clipboard.writeText(r.codes.join('\n')).catch(() => {}); toast(t('{n} codes created and copied.', { n: r.codes.length }), 'good', 3500); run(); } catch (e) { toastErr(e); }
  }) }, icon('plus', 16), t('Generate codes'));
  mount(box, h('div.row', { style: 'margin-bottom:12px' }, gen), listBox); run();
}

async function announce(box) {
  const title = h('input.input', { placeholder: t('Title'), maxlength: 80 });
  const body = h('textarea.input', { rows: 3, placeholder: t('Message to everyone…'), maxlength: 500 });
  const send = h('button.btn.primary', { onClick: () => busy(send, async () => {
    if (!title.value.trim() || !body.value.trim()) return toast(t('Add a title and a message.'), 'err');
    try { await api.post('/api/admin/announce', { title: title.value.trim(), body: body.value.trim() }); title.value = body.value = ''; toast(t('Announcement sent to everyone online.'), 'good', 3000); } catch (e) { toastErr(e); }
  }) }, icon('send', 16), t('Send announcement'));
  mount(box, h('section.card', h('h3', icon('bell', 18), t('Broadcast an announcement')), h('p.muted.small', t('Everyone online sees it instantly; it also shows in the notifications bell.')), h('div.field', title), h('div.field', body), h('div.row', send)));
}

async function system(box) {
  const hostsText = h('textarea.input', { rows: 8, spellcheck: 'false', style: 'font-family:var(--mono);font-size:.82rem' });
  const blockBox = h('section.card', h('h3', icon('shield', 18), t('Proxy blocklist')), h('p.muted.small', t('One host per line. These domains are refused by the proxy for everyone (in addition to the built-in ad/malware lists).')), hostsText, h('div.row', { style: 'margin-top:8px' }, h('button.btn.primary', { onClick: saveHosts }, t('Save blocklist'))));
  async function loadHosts() { try { const r = await api.get('/api/admin/blocklist'); hostsText.value = (r.hosts || []).join('\n'); } catch (e) { hostsText.value = ''; } }
  async function saveHosts(e) { await busy(e.currentTarget, async () => { try { const hosts = hostsText.value.split('\n').map((s) => s.trim()).filter(Boolean); const r = await api.put('/api/admin/blocklist', { hosts }); hostsText.value = r.hosts.join('\n'); toast(t('Blocklist saved ({n} hosts).', { n: r.hosts.length }), 'good'); } catch (err) { toastErr(err); } }); }

  const mailBtn = h('button.btn', { onClick: () => busy(mailBtn, async () => { const to = await promptBox(t('Send a test email'), { label: t('Recipient'), type: 'email', value: S.me.email }); if (!to) return; try { const r = await api.post('/api/admin/mail/test', { to }); toast(t('Test email sent (mode: {m}).', { m: r.mode }), 'good'); } catch (e) { toastErr(e); } }) }, icon('mail', 16), t('Send test email'));
  const auditBox = h('div.col', { style: 'gap:4px' }, loading());
  async function loadAudit() { try { const r = await api.get('/api/admin/audit'); mount(auditBox, (r.audit || []).slice(0, 40).map((a) => h('div.adm-audit', h('span.tiny.muted', fmt.dt(a.t)), h('span.pill', a.a), h('span.small', (a.d || '').slice(0, 80))))); } catch (e) { mount(auditBox, h('span.error', e.message)); } }

  mount(box, blockBox,
    h('section.card', h('h3', icon('mail', 18), t('Email')), h('p.muted.small', t('Verification and reset emails use the server\'s mail settings. Send a test to check they work.')), h('div.row', mailBtn)),
    h('section.card', h('h3', icon('clock', 18), t('Recent admin actions')), auditBox));
  loadHosts(); loadAudit();
}

// ----- AI: connect Nova to Claude (API key) or a local Ollama model -----
async function aiTab(box) {
  let s = await api.get('/api/admin/ai');
  const NAMES = { auto: t('Automatic'), free: t('Free online AI (no key)'), anthropic: 'Claude (Anthropic)', ollama: t('Local AI (Ollama)'), openai: t('Free or paid API with a key (Groq, Gemini, OpenRouter…)'), local: t('Built-in helper only') };
  const MODES = { anthropic: 'Claude', free: t('Free online AI'), ollama: t('Local AI (Ollama)'), openai: t('API with a key'), local: t('Built-in helper') };
  function paint() {
    const prov = h('select.select', s.providers.map((p) => h('option', { value: p, selected: p === s.provider }, NAMES[p] || p)));
    const key = h('input.input', { type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: s.anthropicKey || 'sk-ant-…' });
    const model = h('input.input', { value: s.model, placeholder: 'claude-sonnet-5-5', spellcheck: 'false' });
    const omodel = s.ollama.models.length
      ? h('select.select', [h('option', { value: '' }, t('Automatic')), ...s.ollama.models.map((m) => h('option', { value: m, selected: m === s.ollamaModel }, m))])
      : h('input.input', { value: s.ollamaModel, placeholder: 'llama3.2', spellcheck: 'false' });
    const obase = h('input.input', { value: s.openaiBase || '', placeholder: 'https://api.groq.com/openai/v1', spellcheck: 'false' }); const okey = h('input.input', { type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: s.openaiKey || t('Paste the API key') }); const omodel2 = h('input.input', { value: s.model || '', placeholder: 'openai/gpt-oss-120b', spellcheck: 'false' });
    const out = h('div.small');
    const save = async (e, extra) => busy(e.currentTarget, async () => {
      try {
        const body = Object.assign({ provider: prov.value, model: model.value.trim(), ollamaModel: omodel.value.trim() }, extra || {});
        if (key.value.trim()) body.anthropicKey = key.value.trim();
        if (extra && extra.keyed) { delete body.keyed; body.provider = 'openai'; body.openaiBase = obase.value.trim(); body.model = omodel2.value.trim(); if (okey.value.trim()) body.openaiKey = okey.value.trim(); }
        s = await api.put('/api/admin/ai', body); toast(t('AI settings saved'), 'good'); paint();
      } catch (err) { toastErr(err); }
    });
    const test = (e) => busy(e.currentTarget, async () => { out.textContent = ''; try { const r = await api.post('/api/admin/ai/test'); out.className = 'small ok'; out.textContent = (MODES[r.mode] || r.mode) + (r.model ? ' · ' + r.model : '') + ': “' + r.reply + '”'; } catch (err) { out.className = 'small error'; out.textContent = err.message; } });
    mount(box,
      h('section.card', h('div.row.between', h('h3', { style: 'margin:0' }, icon('bolt', 18), t('Nova AI')), h('span.pill' + (s.mode === 'local' ? '' : '.ok'), MODES[s.mode] || s.mode, s.effectiveModel ? ' · ' + s.effectiveModel : '')),
        h('p.small.muted', t('Choose what powers Nova. "Automatic" uses your Claude key if there is one, otherwise a local Ollama model if it is running, otherwise the built-in helper.')),
        field(t('Provider'), prov)),
      h('section.card.ai-keyed', h('h3', icon('zap', 18), ' ', t('Fast models with free keys (recommended)')), h('p.small.muted', t('Paste one or more free keys. Nebulix finds the best chat models of each provider and adds them all to Nova: Llama 3.3 70B, GPT-OSS 120B, Qwen 3, Kimi K2, Gemini 2.5, Mistral… They answer in about a second, and if one is busy Nova uses the next. Keys stay on the server.')),
        (s.keyed || []).map((k) => { const inp = h('input.input', { type: 'password', autocomplete: 'off', placeholder: k.set ? k.masked : t('Paste the key'), spellcheck: 'false' });
          return h('div.ai-krow', h('div.ai-kname', h('b', k.name), h('a.tiny', { href: k.keyUrl, target: '_blank', rel: 'noopener' }, t('Get a free key'))), inp,
            h('button.btn.sm.primary', { onClick: (e) => busy(e.currentTarget, async () => { if (!inp.value.trim()) return; s = await api.put('/api/admin/ai', { keys: { [k.id]: inp.value.trim() } }); toast(t('Key saved'), 'good'); paint(); }) }, t('Save')),
            k.set ? h('button.btn.sm.ghost', { onClick: (e) => busy(e.currentTarget, async () => { s = await api.put('/api/admin/ai', { keys: { [k.id]: '' } }); paint(); }) }, icon('trash', 14)) : null,
            k.models && k.models.length ? h('div.tiny.muted.ai-kmodels', k.models.join(' · ')) : k.set ? h('div.tiny.muted.ai-kmodels', t('Key saved — models load on the next message')) : null); })),
      h('section.card', h('h3', icon('globe', 18), ' ', t('Free online AI (no key)')), h('p.small.muted', t('Works right away with no account: GPT-OSS 20B from Pollinations. The free tier allows about one reply every 45 seconds for the whole server, so with several people at once Nova falls back to the built-in helper. For real use, add a free key below.')),
        h('div.row', h('span.pill' + (s.free && s.free.on ? '.ok' : ''), s.free && s.free.on ? t('Available') : t('Off')), s.free && s.free.busyUntil > Date.now() ? h('span.pill', t('Busy for {n} s', { n: Math.ceil((s.free.busyUntil - Date.now()) / 1000) })) : null)),
      h('section.card', h('h3', icon('key', 18), ' ', t('One custom OpenAI-compatible API')), h('p.small.muted', t('Create a free key on one of these sites (it takes a minute), pick it here and paste the key. Groq is the fastest; Gemini and OpenRouter also have free plans. The key stays on this server.')),
        h('div.row.wrap', { style: 'gap:8px' }, (s.presets || []).map((p) => h('button.btn.sm', { onClick: () => { obase.value = p.base; omodel2.value = p.model; okey.focus(); } }, p.name))),
        h('div.small', (s.presets || []).map((p) => h('div', '• ', h('a', { href: p.keyUrl, target: '_blank', rel: 'noopener' }, p.name + ' → ' + p.keyUrl)))),
        field(t('API address'), obase), field(t('API key') + (s.openaiKey ? ' · ' + t('saved') : ''), okey), field(t('Model'), omodel2),
        h('div.row.wrap', h('button.btn.primary', { onClick: (e) => save(e, { keyed: true }) }, t('Save and use it')), s.openaiKey ? h('button.btn.ghost', { onClick: (e) => save(e, { openaiKey: '', openaiBase: '', provider: 'auto' }) }, icon('trash', 15), t('Remove key')) : null)),
      h('section.card', h('h3', 'Claude (Anthropic)'),
        h('p.small.muted', t('Best quality. Create a key at console.anthropic.com (pay per use). The key stays on this server and is never shown to users.')),
        field(t('API key') + (s.keyFrom ? ' · ' + (s.keyFrom === 'env' ? t('set in .env') : t('saved')) : ''), key),
        field(t('Model (optional)'), model),
        h('div.row.wrap', h('button.btn.primary', { onClick: (e) => save(e) }, t('Save')), s.keyFrom === 'admin' ? h('button.btn.ghost', { onClick: (e) => save(e, { anthropicKey: '' }) }, icon('trash', 15), t('Remove key')) : null)),
      h('section.card', h('h3', t('Local AI (Ollama)')),
        h('p.small.muted', t('Free and private: runs on the computer that hosts Nebulix. Install Ollama from ollama.com, then download a model, for example:')),
        h('pre', 'ollama pull llama3.2'),
        h('div.row', h('span.pill' + (s.ollama.ok ? '.ok' : ''), s.ollama.ok ? t('Ollama detected ({n} models)', { n: s.ollama.models.length }) : t('Ollama not detected'))),
        field(t('Model'), omodel),
        h('div.row.wrap', h('button.btn.primary', { onClick: (e) => save(e) }, t('Save')), h('button.btn', { onClick: async (e) => busy(e.currentTarget, async () => { s = await api.get('/api/admin/ai'); paint(); }) }, icon('refresh', 15), t('Check again')))),
      h('section.card', h('h3', t('Test')), h('p.small.muted', t('Sends a short message with the current settings.')), h('div.row', h('button.btn', { onClick: test }, icon('send', 15), t('Test Nova'))), out));
  }
  paint();
}

// ----- community roles: site-wide tags shown on profiles ("Beta tester", "Event winner"…) -----
async function groles(box) {
  const paint = async () => {
    let list = []; try { list = (await api.get('/api/community/roles')).roles; } catch (e) { mount(box, h('span.error', e.message)); return; }
    mount(box, h('div.card', h('div.row.between', h('h3', { style: 'margin:0' }, t('Community roles')), h('button.btn.primary.sm', { onClick: () => edit(null) }, icon('plus', 15), t('New role'))),
      h('p.small.muted', t('Site-wide roles appear as tags on profiles. Assign them from the Users tab (⋯ → Community roles).')),
      list.length ? h('div.col.gap-s', list.map((g) => h('div.row.adm-grole', roleChip(g), g.nameEn && g.nameEn !== g.name ? h('span.tiny.muted', 'EN: @' + g.nameEn) : null, g.hoist !== false ? h('span.pill', t('Grouped in member list')) : null, h('span.tiny.muted', t('{n} members', { n: g.count })), h('div.grow'),
        h('button.btn.sm', { onClick: () => edit(g) }, icon('edit', 14), t('Edit')), h('button.btn.sm.ghost', { onClick: async () => { if (await confirmBox(t('Delete the community role "{r}"?', { r: g.name }), { danger: true, ok: t('Delete') })) { try { await api.del('/api/admin/groles/' + g.id); paint(); } catch (e) { toastErr(e); } } } }, icon('trash', 14))))) : h('p.muted', t('No community roles yet.'))));
  };
  const edit = (g) => {
    const name = h('input.input', { value: g ? g.name : '', maxlength: 24, placeholder: t('Beta tester') }); const nameEn = h('input.input', { value: g && g.nameEn ? g.nameEn : '', maxlength: 24, placeholder: t('Optional') }); let hoist = g ? g.hoist !== false : true; const color = h('input', { type: 'color', value: (g && g.color) || '#8b5cf6' }); let ic = (g && g.icon) || '';
    const icb = h('button.btn.sm', { type: 'button', onClick: (e) => emojiPicker(e.currentTarget, (x) => { ic = x; icb.textContent = x; }) }, ic || t('Pick an icon'));
    modal({ title: g ? t('Edit community role') : t('New community role'), cls: 'narrow', body: h('div.col', field(t('Name'), name), field(t('Name in English'), nameEn, t('Shown to people using Nebulix in other languages. Both names work as @mentions.')), field(t('Colour'), color), field(t('Icon'), icb), settingRow(t('Show separately in the member list'), t('Like Discord: online members with this role get their own group.'), switchEl(hoist, (v) => { hoist = v; }))),
      actions: [{ label: t('Cancel') }, { label: t('Save'), kind: 'primary', onClick: async () => { try { const body = { name: name.value.trim(), nameEn: nameEn.value.trim(), hoist, color: color.value, icon: ic }; if (g) await api.patch('/api/admin/groles/' + g.id, body); else await api.post('/api/admin/groles', body); paint(); } catch (e) { toastErr(e); return false; } } }] });
  };
  await paint();
}
async function assignGroles(u) {
  let list = []; try { list = (await api.get('/api/community/roles')).roles; } catch (e) { return toastErr(e); }
  const have = new Set((u.groles || []).map((g) => g.id || g));
  const rows = list.map((g) => h('div.setting', h('div.grow', roleChip(g)), switchEl(have.has(g.id), (v) => { if (v) have.add(g.id); else have.delete(g.id); })));
  modal({ title: t('Community roles for {u}', { u: u.username }), cls: 'narrow', body: h('div.col', rows.length ? rows : h('p.muted', t('Create community roles in the Community roles tab first.'))),
    actions: [{ label: t('Cancel') }, { label: t('Save'), kind: 'primary', onClick: async () => { try { await api.put(`/api/admin/users/${u.id}/groles`, { roles: [...have] }); toast(t('Saved'), 'good'); } catch (e) { toastErr(e); return false; } } }] });
}

// Content moderation: Hub uploads and community worlds
async function content(box) {
  let kind = 'hub'; let q = ''; const list = h('div.col', { style: 'gap:8px' });
  const search = h('input.input', { placeholder: t('Search by title or @user'), onInput: debounce((e) => { q = e.target.value.trim(); run(); }, 300) });
  async function run() {
    mount(list, loading());
    try {
      const r = await api.get(`/api/admin/content?kind=${kind}&q=${encodeURIComponent(q)}`);
      mount(list, r.items.length ? r.items.map((x) => h('div.card.adm-user', x.owner ? avatarEl(x.owner, { size: 34, frame: false }) : null,
        h('div.grow', h('div.row', { style: 'gap:6px;align-items:center' }, h('b', x.title), h('span.pill', x.kind), x.public ? null : h('span.pill', t('private'))), h('div.tiny.muted', '@' + (x.owner ? x.owner.username : '?') + ' · ' + fmt.date(x.created) + ' · ' + t('{n} views', { n: fmt.num(x.views) }))),
        h('a.btn.sm', { href: x.link }, icon('external', 14), t('Open')),
        h('button.btn.sm.danger', { onClick: async (e) => { const b = e.currentTarget; const reason = await promptBox(t('Remove “{t}”', { t: x.title }), { label: t('Reason (the author will see it)') }); if (reason === null) return; await busy(b, async () => { try { await api.del(`/api/admin/content/${kind}/${x.id}?reason=${encodeURIComponent(reason)}`); toast(t('Removed'), 'good'); run(); } catch (er) { toastErr(er); } }); } }, icon('trash', 14), t('Remove')))) : h('p.muted', t('Nothing here.')));
    } catch (e) { mount(list, h('span.error', e.message)); }
  }
  mount(box, h('div.row', { style: 'gap:8px;margin-bottom:12px;flex-wrap:wrap' }, tabsEl([['hub', 'Nebulix Hub', 'upload'], ['worlds', t('Community worlds'), 'cube']], kind, (v) => { kind = v; run(); }), search), list);
  run();
}
// What the moderation team did (bans, warnings, mutes, removed content, closed reports)
async function modlog(box) {
  const r = await api.get('/api/admin/modlog');
  const IC = { ban: '⛔', unban: '✅', warn: '⚠️', mute: '🔇', unmute: '🔊', 'remove.hub': '🗑', 'remove.world': '🗑', report: '🚩', theme: '🎨' };
  mount(box, r.log.length ? h('div.col', { style: 'gap:6px' }, r.log.map((a) => h('div.card.tight.row', { style: 'gap:10px;align-items:center' }, h('span', IC[a.a] || IC[a.a.split('.')[0]] || '•'), h('div.grow', h('div.small', h('b', '@' + a.byName), ' · ' + a.a + ' · ' + a.d)), h('span.tiny.muted', fmt.dt(a.t)))))
    : h('p.muted', t('No moderation actions yet.')));
}

// ---------- Coins (13.6): donate to one person, unlimited wallets (owner) and gifts for everyone ----------
const AMOUNTS = [100, 1000, 10000, 100000, 1000000, 1000000000];
const short = (n) => (n >= 1e9 ? n / 1e9 + 'B' : n >= 1e6 ? n / 1e6 + 'M' : n >= 1e3 ? n / 1e3 + 'K' : String(n));
async function coinsTab(box) {
  let sel = null; let amount = 1000; let results = [];
  const q = h('input.input', { placeholder: t('Search by name or email'), autocomplete: 'off', onInput: debounce(async () => { try { results = (await api.get('/api/admin/users?q=' + encodeURIComponent(q.value.trim()))).users.slice(0, 8); } catch { results = []; } paint(); }, 250) });
  const amt = h('input.input', { type: 'number', min: 1, step: 1, value: amount, onInput: () => { amount = Math.trunc(Number(amt.value) || 0); paintAmounts(); } });
  const reason = h('input.input', { placeholder: t('Reason (optional)'), maxlength: 80 });
  const listEl = h('div.adm-coin-list'); const selEl = h('div'); const amountsEl = h('div.row.wrap', { style: 'gap:6px' });
  const give = async (e, sign) => {
    if (!sel || !amount) return; busy(e.currentTarget, async () => {
      try { const r = await api.post(`/api/admin/users/${sel.id}/coins`, { delta: sign * amount, reason: reason.value.trim() || 'admin' }); sel = r.user; toast(sign > 0 ? t('{n} coins sent to @{u}', { n: fmt.num(amount), u: sel.username }) : t('{n} coins taken from @{u}', { n: fmt.num(amount), u: sel.username }), 'good'); paint(); } catch (err) { toastErr(err); }
    });
  };
  function paintAmounts() { mount(amountsEl, AMOUNTS.map((n) => h('button.btn.sm' + (amount === n ? '.primary' : ''), { onClick: () => { amount = n; amt.value = n; paintAmounts(); } }, '+' + short(n)))); }
  function paint() {
    mount(listEl, results.map((u) => h('button.adm-coin-u' + (sel && sel.id === u.id ? '.on' : ''), { onClick: () => { sel = u; paint(); } }, avatarEl(u, { size: 28, frame: false }), h('span.grow', h('b', u.displayName || u.username), h('span.tiny.muted', ' @' + u.username)), h('span.tiny', u.infinite ? '∞' : fmt.coins(u.coins)))));
    mount(selEl, sel ? h('div.card.adm-coin-sel', avatarEl(sel, { size: 48, frame: false }), h('div.grow', h('b', sel.displayName || sel.username), h('div.tiny.muted', '@' + sel.username), h('div.adm-coin-bal', icon('coins', 18), ' ', sel.infinite ? t('Unlimited') : fmt.coins(sel.coins))),
      owner() ? h('label.row', { style: 'gap:8px' }, h('span.tiny', t('Unlimited coins')), switchEl(!!sel.infinite, async (on) => { try { sel = (await api.post(`/api/admin/users/${sel.id}/infinite`, { on })).user; toast(on ? t('Unlimited coins on') : t('Unlimited coins off — the old balance is back'), 'good'); paint(); } catch (err) { toastErr(err); paint(); } })) : null)
      : h('p.muted', t('Search for a person and pick them.')));
  }
  const bulkAmt = h('input.input', { type: 'number', min: 1, step: 1, value: 500 });
  const bulk = (scope) => async (e) => {
    const n = Math.trunc(Number(bulkAmt.value) || 0); if (n <= 0) return toast(t('Enter an amount'), 'info');
    if (!(await confirmBox(scope === 'all' ? t('Give {n} coins to every account?', { n: fmt.num(n) }) : t('Give {n} coins to everyone online?', { n: fmt.num(n) }), { ok: t('Give') }))) return;
    busy(e.currentTarget, async () => { try { const r = await api.post('/api/admin/coins/bulk', { amount: n, scope }); toast(t('{n} coins sent to {c} people', { n: fmt.num(n), c: r.count }), 'good'); } catch (err) { toastErr(err); } });
  };
  mount(box, h('div.adm-coins',
    h('section.card', h('h3', icon('gift', 18), ' ', t('Donate coins')), h('p.small.muted', t('Pick a person, choose an amount and send it. They get a notice. Up to 1,000,000,000,000 coins at once.')),
      q, listEl, selEl, h('div.adm-coin-amt', amountsEl, h('div.row', { style: 'gap:8px;margin-top:8px' }, amt, reason)),
      h('div.row', { style: 'gap:8px;margin-top:10px' }, h('button.btn.primary', { onClick: (e) => give(e, 1) }, icon('gift', 15), t('Give')), h('button.btn.ghost', { onClick: (e) => give(e, -1) }, t('Take')))),
    h('section.card', h('h3', icon('users', 18), ' ', t('Gift for everyone')), h('p.small.muted', t('Send the same amount to everyone online right now, or to every account (banned accounts are skipped).')),
      h('div.row', { style: 'gap:8px;flex-wrap:wrap' }, bulkAmt, h('button.btn', { onClick: bulk('online') }, t('Everyone online')), h('button.btn', { onClick: bulk('all') }, t('Every account'))))));
  paintAmounts(); paint();
}

// ---------- Control (13.8): lockdown for everyone and who is online ----------
async function controlTab(box) {
  let st = await api.get('/api/admin/lockdown'); const lockBox = h('div'); const onBox = h('div'); let timer = 0;
  const paintLock = () => mount(lockBox, h('section.card.adm-lock' + (st.lockdown.on ? '.on' : ''), h('div.row', { style: 'gap:12px;align-items:center' }, icon('lock', 26), h('div.grow', h('h3', { style: 'margin:0' }, t('Lockdown mode')), h('p.small.muted', { style: 'margin:4px 0 0' }, t('Every open Nebulix (except staff) instantly switches to an ordinary study notes page, and stays there until you lift it. New visitors see it too.'))),
    h('button.btn' + (st.lockdown.on ? '' : '.danger'), { onClick: async (e) => { const on = !st.lockdown.on; if (on && !(await confirmBox(t('Lock Nebulix for everyone online ({n}) now?', { n: st.online }), { ok: t('Lock now'), danger: true }))) return; busy(e.currentTarget, async () => { try { st = await api.post('/api/admin/lockdown', { on }); toast(on ? t('Lockdown on') : t('Lockdown lifted'), 'good'); paintLock(); } catch (err) { toastErr(err); } }); } }, st.lockdown.on ? t('Lift lockdown') : t('Lock everyone'))),
    st.lockdown.on ? h('p.tiny', t('On since {d}', { d: fmt.rel(st.lockdown.at) })) : null));
  async function loadOnline() {
    try { const r = await api.get('/api/admin/online'); mount(onBox, h('section.card', h('h3', icon('users', 18), ' ', t('Online now') + ' · ' + r.users.length), r.users.length ? h('div.adm-online', r.users.map((u) => h('div.adm-orow', avatarEl(u, { size: 32, frame: false }), h('div.grow', h('b', u.displayName || u.username), h('div.tiny.muted', '@' + u.username + (u.tabs > 1 ? ' · ' + t('{n} tabs', { n: u.tabs }) : ''))), u.activity ? h('span.pill', u.activity.label || u.activity.kind) : h('span.tiny.muted', t('Browsing')), u.infinite ? h('span.pill.pro', '∞') : h('span.tiny', fmt.coins(u.coins))))) : h('p.muted', t('Nobody is online.')))); } catch (e) { mount(onBox, h('span.error', e.message)); }
  }
  mount(box, lockBox, onBox, h('p.tiny.muted', t('Nebulix never shows you other people’s screens: that would break their privacy. You see the same activity status their friends see.')));
  paintLock(); loadOnline(); timer = setInterval(loadOnline, 10000);
  return () => clearInterval(timer);
}

// Nebulix 3.0: compute nodes (separate KVM servers that run Nebulix Android). Only the owner can add or remove them.
async function computeTab(box) {
  const listEl = h('div.col', { style: 'gap:10px' });
  const gb = (n) => (n / 1073741824).toFixed(1) + ' GB';
  async function load() {
    let r; try { r = await api.get('/api/admin/compute'); } catch (e) { mount(listEl, h('span.error', e.message)); return; }
    mount(listEl, r.nodes.length ? r.nodes.map((n) => { const hh = n.health || {}; return h('div.card.cn-node', { style: 'padding:14px' },
      h('div.row', { style: 'gap:10px' }, h('b.grow', n.name), h('span.an-state.' + (hh.ok ? 'good' : 'bad'), hh.ok ? t('Online') : t('Offline')), n.enabled ? null : h('span.an-state.idle', t('Paused'))),
      h('div.tiny.muted', n.url + ' · ' + t('{n} devices', { n: n.devices })),
      hh.ok ? h('div.small', { style: 'margin-top:6px' }, [t('Agent {v}', { v: hh.version }), (hh.accel === 'tcg' ? t('software emulation (no KVM)') : 'KVM ✓'), hh.cpus + ' CPU', gb(hh.memFree) + ' / ' + gb(hh.memTotal) + ' RAM', t('{a} of {b} running', { a: hh.running, b: hh.maxRunning }), t('Android {v}', { v: (hh.images || []).map((i) => i.android).join(', ') || '—' })].join(' · ')) : h('div.small.error', hh.error || ''),
      n.env ? h('p.tiny.muted', { style: 'margin-top:6px' }, t('Configured on the server (NX_COMPUTE_NODES) — change it with Fly secrets.')) : owner() ? h('div.row', { style: 'gap:6px;margin-top:8px' },
        h('button.btn.sm', { onClick: async () => { try { await api.put('/api/admin/compute/' + n.id, { enabled: !n.enabled }); load(); } catch (e) { toastErr(e); } } }, n.enabled ? t('Pause') : t('Resume')),
        h('button.btn.sm.danger', { onClick: async () => { if (!await confirmBox(t('Remove this node? Its devices stop being reachable from Nebulix.'), { danger: true })) return; try { await api.del('/api/admin/compute/' + n.id); load(); } catch (e) { toastErr(e); } } }, t('Remove'))) : null); })
      : h('p.muted', t('No compute nodes yet. Nebulix Android needs at least one.')));
  }
  const name = h('input', { placeholder: 'node-1' }); const url = h('input', { placeholder: 'https://node1.example.com' }); const secret = h('input', { type: 'password', placeholder: 'NX_NODE_SECRET', autocomplete: 'off' });
  const add = owner() ? h('div.card', { style: 'padding:14px' }, h('h3', t('Connect a compute node')),
    h('p.small.muted', t('A compute node is a Linux server with KVM that runs services/compute-node/agent.js (see its README). Enter its public HTTPS address and the same NX_NODE_SECRET you set on it. The secret is stored on the server and never sent to browsers.')),
    h('div.an-hw', field(t('Name'), name), field(t('Address'), url), field(t('Secret'), secret)),
    h('button.btn.primary', { onClick: async () => { try { await api.post('/api/admin/compute', { name: name.value, url: url.value, secret: secret.value }); secret.value = ''; toast(t('Node connected'), 'good'); load(); } catch (e) { toastErr(e); } } }, icon('plus', 15), t('Connect'))) : null;
  mount(box, h('div.col', { style: 'gap:14px' }, h('p.small.muted', t('Heavy services (Android devices) run on separate servers so they never slow down the Nebulix web server.')), listEl, add));
  await load();
}
