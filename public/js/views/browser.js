// Nebulix Browser: tabs (one sandboxed iframe each, served from the isolated proxy origin), omnibox, bookmarks,
// history, shield (ad/tracker blocking + prefs), request log and cookie manager.
import { h, mount, clear, ls, debounce, fmt, safeUrl } from '../util.js';
import { t, getLang } from '../i18n.js';
import { api, ws } from '../api.js';
import { S, bus, setMe, patchMe } from '../state.js';
import { icon, logoMark } from '../icons.js';
import { toast, toastErr, openMenu, switchEl, segEl, tabsEl, confirmBox, promptBox, settingRow } from '../ui.js';
import { GAMES, ENGINES, siteLogo } from '../sites.js';
import { sendToFriend } from '../share.js';
import { nativeFor } from '../natives.js';

const SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-pointer-lock allow-presentation allow-orientation-lock';
const MAX_TABS = 12;
const DEFAULT_PREFS = { engine: 'nebulix', adblock: true, jsRewrite: true, stripTracking: true, cache: true, ua: 'auto' };
let inst = null;

const hostOf = (u) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return u; } };
const prefsNow = () => Object.assign({}, DEFAULT_PREFS, (S.me.settings && S.me.settings.proxy) || {});

function resolveInput(raw) {
  raw = String(raw || '').trim(); if (!raw) return { url: null };
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^[\w.-]+:\d+([/?#]|$)/.test(raw);
  if (hasScheme) { const u = safeUrl(raw); return u ? { url: u } : { url: null, error: t('Only http and https addresses can be opened.') }; }
  const looksHost = !/\s/.test(raw) && (/^([\w-]+\.)+[a-z]{2,}(:\d+)?([/?#].*)?$/i.test(raw) || /^localhost(:\d+)?([/?#]|$)/i.test(raw) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?([/?#]|$)/.test(raw));
  if (looksHost) { const local = /^(localhost|\d{1,3}(\.\d{1,3}){3})/i.test(raw); const u = safeUrl((local ? 'http://' : 'https://') + raw); return u ? { url: u } : { url: null, error: t('That address does not look right.') }; }
  const eng = ENGINES[prefsNow().engine] || ENGINES.nebulix;
  return { url: eng[1].replace('%s', encodeURIComponent(raw)), search: true };
}

function build(root) {
  let tabs = [], active = null, nextId = 1, panel = null, panelTab = 'shield', session = null, pollTimer = null, logTimer = null, alive = true, shown = false;
  const unsubs = [];

  // ---------------- proxy session ----------------
  // Browser profiles: each one is its own proxy session (its own cookies), so you can be signed in to the same
  // site with a main account and alt accounts at once. The list lives in this browser only.
  const profiles = () => { const p = ls('bprofiles'); return Array.isArray(p) && p.length ? p : [{ id: 'main', name: t('Main'), color: '#7c5cff', sid: null }]; };
  const saveProfiles = (p) => ls('bprofiles', p.slice(0, 6));
  const curProfile = () => { const id = ls('bprofile') || 'main'; return profiles().find((x) => x.id === id) || profiles()[0]; };
  async function ensureSession(force) {
    if (session && !force) return session;
    if (!session || force) {
      session = (async () => {
        const prof = incog ? null : curProfile();
        if (prof && prof.sid && !force) {
          try { await api.get('/api/proxy/session/' + prof.sid, { quiet: true }); if (prof.origin) { S.proxy = { sid: prof.sid, origin: prof.origin }; return S.proxy; } } catch {}
        }
        const r = await api.post('/api/proxy/session');
        S.proxy = { sid: r.sid, origin: r.origin };
        if (prof && !force) { const all = profiles(); const me = all.find((x) => x.id === prof.id) || prof; me.sid = r.sid; me.origin = r.origin; if (!all.includes(me)) all.push(me); saveProfiles(all); }
        return S.proxy;
      })();
      session.catch(() => { session = null; });
    }
    return session;
  }
  async function switchProfile(id) {
    if (incog) await setIncognito(false);
    ls('bprofile', id); session = null; S.proxy = {}; await ensureSession();
    for (const tb of tabs) if (tb.frame && tb.stack[tb.idx] && !tb.isTube) load(tb, tb.stack[tb.idx]);
    paintBar(); toast(t('Browsing as {n}', { n: curProfile().name }), 'good');
  }
  async function addProfile() {
    const all = profiles(); if (all.length >= 6) { toast(t('Up to 6 profiles.'), 'err'); return; }
    const name = await promptBox(t('New browser profile'), { label: t('Name (for example: Alt account)'), value: t('Alt {n}', { n: all.length }) }); if (!name || !name.trim()) return;
    const colors = ['#7c5cff', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899'];
    const p = { id: 'p' + Date.now().toString(36), name: name.trim().slice(0, 24), color: colors[all.length % colors.length], sid: null };
    all.push(p); saveProfiles(all); await switchProfile(p.id);
  }
  async function removeProfile(id) {
    if (id === 'main') return; const p = profiles().find((x) => x.id === id); if (!p) return;
    if (!(await confirmBox(t('Delete the profile "{n}" and its cookies?', { n: p.name }), { danger: true }))) return;
    if (p.sid) api.del('/api/proxy/session/' + p.sid, { quiet: true }).catch(() => {});
    saveProfiles(profiles().filter((x) => x.id !== id)); if ((ls('bprofile') || 'main') === id) await switchProfile('main'); else paintBar();
  }
  function profileMenu(anchor) {
    const cur = curProfile();
    openMenu([
      ...profiles().map((p) => ({ label: p.name + (p.id === cur.id ? '  ✓' : ''), icon: 'user', onClick: () => p.id !== cur.id && switchProfile(p.id) })),
      { hr: true }, { label: t('Add profile (alt account)'), icon: 'plus', onClick: addProfile },
      ...(cur.id !== 'main' ? [{ label: t('Delete this profile'), icon: 'trash', danger: true, onClick: () => removeProfile(cur.id) }] : []),
    ], anchor);
  }
  const toProxy = (url) => { const u = new URL(url); return `${S.proxy.origin}/service/${S.proxy.sid}/${u.protocol.slice(0, -1)}/${u.host}${u.pathname}${u.search}${u.hash}`; };
  async function checkSession() {
    if (!S.proxy.sid) return;
    try { await api.get('/api/proxy/session/' + S.proxy.sid); }
    catch (e) { if (e.status === 404) { session = null; await ensureSession(); for (const tb of tabs) if (tb.frame && tb.stack[tb.idx]) load(tb, tb.stack[tb.idx]); toast(t('Your proxy session was renewed.'), 'info'); } }
  }

  // ---------------- history / bookmarks ----------------
  const getHist = () => ls('history') || [];
  function addHistory(url, title) {
    if (incog || !/^https?:/.test(url)) return; const hs = getHist();
    if (hs[0] && hs[0].url === url) { if (title) hs[0].title = title; ls('history', hs); return; }
    hs.unshift({ url, title: title || hostOf(url), t: Date.now() }); hs.length = Math.min(hs.length, 200); ls('history', hs);
  }
  const marks = () => (S.me.bookmarks || []);
  const isMarked = (u) => marks().some((b) => b.url === u);
  async function saveMarks(list) { try { const r = await api.put('/api/bookmarks', { list }); patchMe({ bookmarks: r.bookmarks }); } catch (e) { toastErr(e); } paintBar(); if (panel === 'library') paintPanel(); }
  async function toggleMark() {
    const tb = active; const u = tb && tb.stack[tb.idx]; if (!u) return;
    if (isMarked(u)) return saveMarks(marks().filter((b) => b.url !== u));
    if (marks().length >= 60) return toast(t('You can keep up to 60 bookmarks.'), 'err');
    saveMarks(marks().concat([{ title: (tb.title || hostOf(u)).slice(0, 60), url: u }])); toast(t('Bookmark added'), 'good', 1800);
  }

  // ---------------- tabs ----------------
  function newTab(url, { background = false, reuseBlank = false } = {}) {
    if (reuseBlank && active && active.home && !active.frame && !active.lazy && !url) return active;
    if (reuseBlank && active && active.home && !active.frame && !active.lazy && url) { navigate(active, url); return active; }
    if (tabs.length >= MAX_TABS) { toast(t('Too many tabs open — close one first.'), 'err'); return null; }
    const tb = { id: nextId++, title: t('New tab'), icon: '', loading: false, stack: [], idx: -1, fresh: false, zoom: 1, frame: null, home: !url, lazy: null };
    tabs.push(tb);
    if (!background) select(tb);
    if (url) navigate(tb, url); else if (background) paintTabs();
    return tb;
  }
  function closeTab(tb) {
    const i = tabs.indexOf(tb); if (i < 0) return;
    if (tb.frame) tb.frame.remove();
    if (tb.tube) tb.tube.remove();
    tabs.splice(i, 1);
    if (!tabs.length) { newTab(); return; }
    if (active === tb) select(tabs[Math.min(i, tabs.length - 1)]); else { paintTabs(); saveTabs(); }
  }
  function select(tb) {
    active = tb;
    if (findBar && findBar.style.display !== 'none') { findBar.style.display = 'none'; findCount.textContent = ''; }
    for (const x of tabs) { if (x.frame) x.frame.style.display = x === tb && !tb.home && !x.isTube ? 'block' : 'none'; if (x.tube) x.tube.style.display = x === tb && !tb.home && x.isTube ? 'block' : 'none'; }
    if (tb.lazy) { const u = tb.lazy; tb.lazy = null; navigate(tb, u); }
    homeEl.style.display = tb.home ? 'block' : 'none';
    if (tb.home) paintHome();
    paintTabs(); paintBar(); saveTabs();
    if (tb.home && shown) setTimeout(() => homeIn && homeIn.focus(), 30);
  }
  function saveTabs() {
    if (incog) return; // nothing about a private session is written down
    try { sessionStorage.setItem('nbx.tabs', JSON.stringify({ a: Math.max(0, tabs.indexOf(active)), t: tabs.map((x) => x.stack[x.idx] || x.lazy || '') })); } catch {}
  }
  function frameFor(tb) {
    if (tb.frame) return tb.frame;
    const f = h('iframe.bframe', { sandbox: SANDBOX, allow: 'fullscreen; autoplay; gamepad; clipboard-write', title: 'Page ' + tb.id, referrerpolicy: 'no-referrer' });
    f.addEventListener('load', () => { tb.loading = false; if (tb.zoom !== 1) postTo(tb, { nx: 1, t: 'zoom', v: tb.zoom }); if (tb.dark) applyDark(tb); postTo(tb, { nx: 1, t: 'sellabels', labels: selLabels() }); postTo(tb, { nx: 1, t: 'piplabel', label: t('Picture-in-picture') }); paintTabs(); if (tb === active) paintBar(); scheduleStats(); });
    tb.frame = f; viewport.appendChild(f); f.style.display = 'none'; return f;
  }
  const postTo = (tb, msg) => { try { tb.frame && tb.frame.contentWindow.postMessage(msg, '*'); } catch {} };
  async function navigate(tb, input, { push = true } = {}) {
    if (findBar && findBar.style.display !== 'none') { findBar.style.display = 'none'; findCount.textContent = ''; }
    const r = resolveInput(input);
    if (!r.url) { if (r.error) toast(r.error, 'err'); return; }
    try { await ensureSession(); } catch (e) { toastErr(e); return; }
    if (tb.lazy) tb.lazy = null;
    if (push) { tb.stack.splice(tb.idx + 1); tb.stack.push(r.url); tb.idx = tb.stack.length - 1; } else tb.stack[tb.idx] = r.url;
    load(tb, r.url);
    api.post('/api/progress/event', { type: 'browse' }, { quiet: true }).catch(() => {}); // XP / quests (rate-limited on the server)
    ws.send({ t: 'act', kind: 'browse', label: t('Browsing the web') });
  }
  function load(tb, url) {
    tb.home = false; tb.fresh = true; tb.loading = true; tb.title = hostOf(url); tb.icon = ''; tb.dark = darkFor(url); tb.hasMedia = false;
    const nat = nativeFor(url); if (nat) { loadTube(tb, url, nat); return; }
    tb.isTube = false; if (tb.tube) tb.tube.style.display = 'none';
    const f = frameFor(tb); const src = toProxy(url);
    try { if (f.getAttribute('src') && f.contentWindow) f.contentWindow.location.replace(src); else f.src = src; } catch { f.src = src; }
    if (tb === active) { homeEl.style.display = 'none'; f.style.display = 'block'; }
    paintTabs(); if (tb === active) paintBar(); saveTabs();
  }
  // YouTube does not work through the rewriting proxy: those addresses open the native Nebulix Tube page instead.
  function loadTube(tb, url, nat) {
    tb.isTube = true; tb.loading = false; tb.title = hostOf(url); tb.icon = '';
    if (tb.frame) { try { tb.frame.contentWindow.location.replace('about:blank'); } catch {} tb.frame.style.display = 'none'; }
    if (!tb.tube) { tb.tube = h('div.btube'); viewport.appendChild(tb.tube); }
    tb.tube.scrollTop = 0; nat.render(tb.tube, url, { open: (u) => navigate(tb, u), setTitle: (x) => { tb.title = x; paintTabs(); } });
    if (tb === active) { homeEl.style.display = 'none'; tb.tube.style.display = 'block'; } else tb.tube.style.display = 'none';
    paintTabs(); if (tb === active) paintBar(); saveTabs();
  }
  const goBack = () => { const tb = active; if (!tb || tb.idx <= 0) return; tb.idx--; load(tb, tb.stack[tb.idx]); };
  const goFwd = () => { const tb = active; if (!tb || tb.idx >= tb.stack.length - 1) return; tb.idx++; load(tb, tb.stack[tb.idx]); };
  function reloadOrStop() {
    const tb = active; if (!tb || tb.home || (!tb.frame && !tb.isTube)) return;
    if (tb.loading && !tb.isTube) { postTo(tb, { nx: 1, t: 'cmd', cmd: 'stop' }); tb.loading = false; paintTabs(); paintBar(); return; }
    load(tb, tb.stack[tb.idx]);
  }
  function showHome() { const tb = active; if (!tb) return; tb.home = true; if (tb.frame) tb.frame.style.display = 'none'; if (tb.tube) tb.tube.style.display = 'none'; homeEl.style.display = 'block'; paintHome(); paintBar(); paintTabs(); setTimeout(() => homeIn && homeIn.focus(), 20); }

  // messages from proxied pages (runtime.js)
  function onMessage(e) {
    const d = e.data; if (!d || d.nx !== 1 || !S.proxy.origin || e.origin !== S.proxy.origin) return;
    const tb = tabs.find((x) => x.frame && x.frame.contentWindow === e.source); if (!tb) return;
    if (d.t === 'nav') onNav(tb, d); else if (d.t === 'open' && safeUrl(String(d.url || ''))) newTab(String(d.url));
    else if (d.t === 'find' && tb === active) onFindResult(d);
    else if (d.t === 'translate') translateFor(tb, String(d.text || ''));
    else if (d.t === 'search') { const r = resolveInput(String(d.text || '').replace(/\s+/g, ' ').trim().slice(0, 300)); if (r.url) newTab(r.url); }
    else if (d.t === 'media') { tb.hasMedia = !!d.has; tb.media = { muted: !!d.muted, paused: !!d.paused, time: d.time || 0, dur: d.dur || 0 }; if (tb.hasMedia && tb.mediaRate && tb.mediaRate !== 1 && typeof d.rate === 'number' && d.rate === 1) postTo(tb, { nx: 1, t: 'media', cmd: 'speed', v: tb.mediaRate }); if (tb === active) paintBar(); }
    else if (d.t === 'pip') toast(d.active ? t('Picture-in-picture on') : t('Picture-in-picture off'), 'info', 1600);  }
  const selLabels = () => ({ translate: t('Translate'), search: t('Search'), copy: t('Copy'), copied: t('Copied!') });
  const TR_LANGS = { en: 1, es: 1, pt: 1, fr: 1, de: 1, it: 1, ca: 1, nl: 1, pl: 1, ru: 1, uk: 1, tr: 1, ar: 1, zh: 1, ja: 1, ko: 1, hi: 1, ro: 1, sv: 1 };
  async function translateFor(tb, text) {
    if (!text || !tb || !tb.frame) return;
    const to = TR_LANGS[getLang()] ? getLang() : 'en';
    try { const r = await api.post('/api/translate', { text: text.slice(0, 2000), to }); postTo(tb, { nx: 1, t: 'translated', text: r.text, from: r.from, to: r.to }); }
    catch (e) { postTo(tb, { nx: 1, t: 'translated', error: (e && e.message) || t('The translator is not available right now.') }); }
  }
  function onNav(tb, d) {
    const url = String(d.url || ''); if (!/^https?:\/\//.test(url)) return;
    if (tb.stack[tb.idx] !== url) {
      if (tb.fresh) tb.stack[tb.idx] = url; // redirect of our own navigation: replace, do not add an entry
      else { tb.stack.splice(tb.idx + 1); tb.stack.push(url); tb.idx = tb.stack.length - 1; }
    }
    tb.fresh = false;
    tb.title = String(d.title || '').slice(0, 120) || hostOf(url); tb.loading = !!d.loading;
    const ic = safeUrl(String(d.icon || '')); tb.icon = ic && S.proxy.origin ? toProxy(ic) : '';
    if (!d.loading) { addHistory(url, tb.title); if (tb.zoom !== 1) postTo(tb, { nx: 1, t: 'zoom', v: tb.zoom }); tb.dark = darkFor(url); if (tb.dark) applyDark(tb); }
    paintTabs(); if (tb === active) paintBar(); saveTabs(); if (!d.loading) scheduleStats();
  }

  // ---------------- toolbar ----------------
  const btn = (ic, label, onClick) => h('button.btn.ghost.icon.tb', { type: 'button', title: label, 'aria-label': label, onClick }, icon(ic, 18));
  const backBtn = btn('back', t('Back'), goBack), fwdBtn = btn('fwd', t('Forward'), goFwd), reloadBtn = btn('refresh', t('Reload'), reloadOrStop), homeBtn = btn('home', t('Start page'), showHome);
  const lockEl = h('span.omni-ic'); const omniIn = h('input.omni-in', { type: 'text', spellcheck: 'false', autocomplete: 'off', 'aria-label': t('Address bar'), placeholder: t('Search or enter address') });
  const sug = h('div.omni-sug'); sug.style.display = 'none';
  const starBtn = btn('star', t('Bookmark this page'), toggleMark);
  const readerBtn = btn('book', t('Reader mode'), openReader); readerBtn.style.display = 'none';
  const darkBtn = btn('moon', t('Dark mode'), toggleDark); darkBtn.style.display = 'none';
  const MEDIA_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  const mediaBtn = h('button.btn.ghost.sm.tb.b-media', { type: 'button', title: t('Media controls'), 'aria-label': t('Media controls'), onClick: (e) => openMediaMenu(e.currentTarget) }, '1×'); mediaBtn.style.display = 'none';
  const postMedia = (cmd, v) => { const tb = active; if (tb && tb.frame && !tb.home) postTo(tb, { nx: 1, t: 'media', cmd, v }); };
  function setMediaSpeed(v) { const tb = active; if (!tb) return; tb.mediaRate = v; postMedia('speed', v); paintBar(); }
  function openMediaMenu(anchor) {
    const tb = active; if (!tb || tb.home || !tb.hasMedia) return; const m = tb.media || {};
    openMenu([
      ...MEDIA_SPEEDS.map((v) => ({ label: v + '×', icon: (tb.mediaRate || 1) === v ? 'check' : null, onClick: () => setMediaSpeed(v) })),
      { hr: true },
      { label: m.paused ? t('Play') : t('Pause'), icon: m.paused ? 'play' : 'pause', onClick: () => postMedia('playpause') },
      { label: t('Back 10 seconds'), icon: 'back', onClick: () => postMedia('skip', -10) },
      { label: t('Forward 10 seconds'), icon: 'fwd', onClick: () => postMedia('skip', 10) },
      { label: m.muted ? t('Unmute') : t('Mute'), icon: 'volume', onClick: () => postMedia('mute') },
    ], anchor);
  }
  const shieldBadge = h('span.nb', '0'); shieldBadge.style.display = 'none';
  const shieldBtn = h('button.btn.ghost.icon.tb', { type: 'button', title: t('Shield, log and cookies'), 'aria-label': t('Shield'), style: 'position:relative', onClick: () => togglePanel('shield') }, icon('shield', 18), shieldBadge);
  // ---------------- incognito ----------------
  // A private session gets its own proxy session (its own cookie jar and request log). Nothing is added to the history,
  // open tabs are not remembered, and on leaving the whole proxy session is deleted on the server.
  let incog = false; let normalProxy = null; let parked = null;
  const incogBtn = btn('eyeoff', t('Incognito mode'), () => setIncognito(!incog));
  const profBtn = h('button.btn.ghost.sm.tb.b-prof', { type: 'button', title: t('Browser profiles (alt accounts)'), 'aria-label': t('Browser profiles (alt accounts)'), onClick: (e) => profileMenu(e.currentTarget) });
  const paintProf = () => { const p = curProfile(); mount(profBtn, h('span.b-prof-dot', { style: '--pc:' + p.color }, p.name.slice(0, 1).toUpperCase()), h('span.b-prof-n', p.name)); };
  const incogNote = h('div.b-incog', icon('eyeoff', 15), h('span.grow', t('Incognito: history, tabs and cookies from this session are erased when you leave. Websites and your network can still see the traffic that reaches them.')), h('button.btn.sm', { type: 'button', onClick: () => setIncognito(false) }, t('Leave incognito')));
  incogNote.style.display = 'none';
  function dropTabs() { for (const tb of tabs) { if (tb.frame) tb.frame.remove(); if (tb.tube) tb.tube.remove(); } tabs = []; active = null; }
  async function endPrivate() { const sid = S.proxy.sid; if (sid) { try { await api.del('/api/proxy/session/' + sid, { quiet: true }); } catch {} } if (normalProxy) { S.proxy = normalProxy; session = Promise.resolve(normalProxy); } else { S.proxy = {}; session = null; } normalProxy = null; }
  let incogBusy = false;
  async function setIncognito(on) {
    if (on === incog || incogBusy) return; incogBusy = true;
    try {
      if (on) {
        parked = { a: Math.max(0, tabs.indexOf(active)), t: tabs.map((x) => x.stack[x.idx] || x.lazy || '') };
        normalProxy = S.proxy && S.proxy.sid ? Object.assign({}, S.proxy) : null;
        dropTabs(); session = null; await ensureSession(true); incog = true;
        try { sessionStorage.removeItem('nbx.tabs'); } catch {}
        newTab();
      } else {
        dropTabs(); await endPrivate(); incog = false;
        const sv = parked; parked = null;
        if (sv && sv.t.some(Boolean)) { sv.t.slice(0, MAX_TABS).forEach((u) => tabs.push({ id: nextId++, title: u ? hostOf(u) : t('New tab'), icon: '', loading: false, stack: [], idx: -1, fresh: false, zoom: 1, frame: null, home: !u, lazy: u || null })); select(tabs[Math.min(sv.a, tabs.length - 1)]); } else newTab();
        saveTabs(); toast(t('Incognito session erased.'), 'good');
      }
    } catch (e) { toastErr(e); if (!tabs.length) newTab(); }
    incogBusy = false;
    wrap.classList.toggle('incog', incog); incogBtn.classList.toggle('on', incog); incogNote.style.display = incog ? 'flex' : 'none';
    Object.assign(stats, { req: 0, bytes: 0, blocked: 0, cached: 0, ads: 0 }); paintShieldBadge(); if (active && active.home) paintHome();
  }
  const moreBtn = btn('more', t('More'), (e) => moreMenu(e.currentTarget));
  const prog = h('div.bprog');
  const toolbar = h('div.btool', backBtn, fwdBtn, reloadBtn, homeBtn, h('div.omni', lockEl, omniIn, sug, starBtn), readerBtn, mediaBtn, darkBtn, profBtn, incogBtn, shieldBtn, moreBtn);

  let sugItems = [], sugSel = -1;
  const setSug = (items) => {
    sugItems = items; sugSel = -1; clear(sug);
    if (!items.length) { sug.style.display = 'none'; return; }
    items.forEach((it, i) => sug.appendChild(h('div.omni-opt', { onMousedown: (e) => { e.preventDefault(); omniIn.value = it.value; omniGo(it.value); } }, icon(it.icon, 16), h('span.grow', { style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, it.label), it.sub ? h('span.tiny.muted', it.sub) : null)));
    sug.style.display = 'block';
  };
  function suggest() {
    const q = omniIn.value.trim(); if (!q) return setSug([]);
    const ql = q.toLowerCase(); const out = [{ icon: 'search', label: resolveInput(q).search ? t('Search for "{q}"', { q }) : t('Go to {u}', { u: q }), value: q }];
    const seen = new Set();
    for (const b of marks()) if ((b.title + ' ' + b.url).toLowerCase().includes(ql) && !seen.has(b.url)) { seen.add(b.url); out.push({ icon: 'star', label: b.title, sub: hostOf(b.url), value: b.url }); }
    for (const x of getHist()) if ((x.title + ' ' + x.url).toLowerCase().includes(ql) && !seen.has(x.url) && out.length < 8) { seen.add(x.url); out.push({ icon: 'clock', label: x.title, sub: hostOf(x.url), value: x.url }); }
    setSug(out.slice(0, 8));
  }
  function omniGo(v) { setSug([]); omniIn.blur(); if (!active) return; if (!String(v).trim()) return; navigate(active, v); }
  omniIn.addEventListener('input', suggest);
  omniIn.addEventListener('focus', () => setTimeout(() => omniIn.select(), 0));
  omniIn.addEventListener('blur', () => setTimeout(() => { setSug([]); paintBar(); }, 120));
  omniIn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); omniGo(sugSel >= 0 && sugItems[sugSel] ? sugItems[sugSel].value : omniIn.value); }
    else if (e.key === 'Escape') { setSug([]); omniIn.blur(); }
    else if (e.key === 'ArrowDown' && sugItems.length) { e.preventDefault(); sugSel = (sugSel + 1) % sugItems.length; paintSel(); }
    else if (e.key === 'ArrowUp' && sugItems.length) { e.preventDefault(); sugSel = (sugSel - 1 + sugItems.length) % sugItems.length; paintSel(); }
  });
  const paintSel = () => { [...sug.children].forEach((c, i) => c.classList.toggle('on', i === sugSel)); if (sugItems[sugSel]) omniIn.value = sugItems[sugSel].value; };

  function paintBar() {
    paintProf();
    const tb = active; if (!tb) return;
    const u = tb.home ? '' : tb.stack[tb.idx] || '';
    if (document.activeElement !== omniIn) omniIn.value = u;
    lockEl.replaceChildren(icon(!u ? 'search' : u.startsWith('https:') ? 'lock' : 'alert', 15)); lockEl.className = 'omni-ic' + (u && !u.startsWith('https:') ? ' warn' : '');
    lockEl.title = !u ? '' : u.startsWith('https:') ? t('Connection to the proxy is protected by HTTPS on the site side') : t('This site does not use HTTPS');
    backBtn.disabled = tb.home || tb.idx <= 0; fwdBtn.disabled = tb.home || tb.idx >= tb.stack.length - 1;
    reloadBtn.replaceChildren(icon(tb.loading ? 'x' : 'refresh', 18)); reloadBtn.title = tb.loading ? t('Stop') : t('Reload'); reloadBtn.disabled = tb.home;
    starBtn.style.display = u ? '' : 'none'; starBtn.classList.toggle('on', isMarked(u)); starBtn.replaceChildren(icon('star', 17)); starBtn.querySelector('svg').style.fill = isMarked(u) ? 'currentColor' : 'none';
    readerBtn.style.display = u && /^https?:/.test(u) ? '' : 'none';
    darkBtn.style.display = u && /^https?:/.test(u) ? '' : 'none'; darkBtn.classList.toggle('on', !!tb.dark); darkBtn.title = tb.dark ? t('Light mode') : t('Dark mode');
    mediaBtn.style.display = !tb.home && tb.hasMedia ? '' : 'none'; mediaBtn.textContent = (tb.mediaRate || 1) + '×'; mediaBtn.classList.toggle('on', (tb.mediaRate || 1) !== 1);
    prog.classList.toggle('on', !!tb.loading);
  }

  // ---------------- tab strip ----------------
  const tabStrip = h('div.btabs');
  function paintTabs() {
    clear(tabStrip);
    for (const tb of tabs) {
      const fav = tb.loading ? h('span.spinner', { style: 'width:14px;height:14px;border-width:2px' }) : tb.icon ? (() => { const i = h('img.fav', { src: tb.icon, alt: '', width: 14, height: 14 }); i.addEventListener('error', () => i.replaceWith(icon('globe', 14))); return i; })() : icon(tb.home ? 'home' : 'globe', 14);
      const el = h('div.btab' + (tb === active ? '.on' : ''), { role: 'tab', title: tb.title, onClick: () => select(tb), onAuxclick: (e) => { if (e.button === 1) { e.preventDefault(); closeTab(tb); } },
        onContextmenu: (e) => { e.preventDefault(); tabMenu(tb, e); } },
        fav, h('span.tt', tb.home ? t('New tab') : tb.title), h('button.x', { type: 'button', 'aria-label': t('Close tab'), onClick: (e) => { e.stopPropagation(); closeTab(tb); } }, icon('x', 13)));
      tabStrip.appendChild(el);
    }
    tabStrip.appendChild(h('button.btn.ghost.icon.sm', { type: 'button', title: t('New tab'), 'aria-label': t('New tab'), onClick: () => newTab() }, icon('plus', 17)));
  }
  function tabMenu(tb, e) {
    openMenu([
      { label: t('Reload'), icon: 'refresh', disabled: tb.home, onClick: () => { if (tb.stack[tb.idx]) load(tb, tb.stack[tb.idx]); } },
      { label: t('Duplicate tab'), icon: 'copy', disabled: tb.home, onClick: () => newTab(tb.stack[tb.idx]) },
      { hr: true }, { label: t('Close other tabs'), icon: 'x', onClick: () => { tabs.filter((x) => x !== tb).forEach(closeTab); select(tb); } }, { label: t('Close tab'), icon: 'x', danger: true, onClick: () => closeTab(tb) },
    ], e);
  }
  function moreMenu(anchor) {
    const tb = active; const u = tb && !tb.home ? tb.stack[tb.idx] : null;
    openMenu([
      { label: t('New tab'), icon: 'plus', onClick: () => newTab() },
      { label: incog ? t('Leave incognito') : t('Incognito mode'), icon: 'eyeoff', onClick: () => setIncognito(!incog) },
      { label: t('Browser profiles (alt accounts)'), icon: 'users', onClick: () => profileMenu(anchor) },
      { label: t('Find in page'), icon: 'search', disabled: !u, onClick: () => openFind() },
      { label: t('Reader mode'), icon: 'book', disabled: !u, onClick: () => openReader() },
      { label: active && active.dark ? t('Light mode') : t('Dark mode'), icon: 'moon', disabled: !u, onClick: () => toggleDark() },
      { label: t('Zoom in'), icon: 'zoomin', disabled: !u, onClick: () => zoom(+0.1) }, { label: t('Zoom out'), icon: 'zoomout', disabled: !u, onClick: () => zoom(-0.1) }, { label: t('Reset zoom'), icon: 'search', disabled: !u, onClick: () => zoom(0) },
      { label: t('Fullscreen'), icon: 'fullscreen', onClick: () => { try { viewport.requestFullscreen(); } catch {} } }, { hr: true },
      { label: t('Send this page to a friend'), icon: 'send', disabled: !u, onClick: () => sendToFriend((tb.title ? tb.title + '\n' : '') + u) },
      { label: t('Copy page link'), icon: 'copy', disabled: !u, onClick: async () => { try { await navigator.clipboard.writeText(u); toast(t('Link copied'), 'good'); } catch { toast(u); } } }, { hr: true },
      { label: t('Bookmarks & history'), icon: 'bookmark', onClick: () => togglePanel('library') }, { label: t('Request log'), icon: 'terminal', onClick: () => togglePanel('log') }, { label: t('Cookies'), icon: 'layers', onClick: () => togglePanel('cookies') }, { hr: true },
      { label: t('Open this page outside the proxy'), icon: 'external', disabled: !u, onClick: async () => { if (await confirmBox(t('This opens the real site directly in a new window — your IP and cookies will not be protected by Nebulix. Continue?'), { ok: t('Open') })) window.open(u, '_blank', 'noopener,noreferrer'); } },
    ], anchor);
  }
  function zoom(delta) { const tb = active; if (!tb || tb.home) return; tb.zoom = delta === 0 ? 1 : Math.max(0.5, Math.min(2, Math.round((tb.zoom + delta) * 10) / 10)); postTo(tb, { nx: 1, t: 'zoom', v: tb.zoom }); toast(Math.round(tb.zoom * 100) + '%', 'info', 900); }

  // ---------------- per-site dark mode ----------------
  const darkPrefs = () => { try { return ls('proxyDark') || {}; } catch { return {}; } };
  const darkFor = (url) => { const hs = hostOf(url); return hs ? !!darkPrefs()[hs] : false; };
  function applyDark(tb) { if (tb && tb.frame && !tb.home) postTo(tb, { nx: 1, t: 'dark', on: !!tb.dark }); }
  function toggleDark() {
    const tb = active; const u = tb && !tb.home ? tb.stack[tb.idx] : null; if (!u || !/^https?:/.test(u)) return;
    tb.dark = !tb.dark; const hs = hostOf(u);
    const prefs = darkPrefs(); if (tb.dark) prefs[hs] = 1; else delete prefs[hs];
    if (!incog) { try { ls('proxyDark', prefs); } catch {} }
    applyDark(tb); paintBar();
  }

  // ---------------- start page ----------------
  let homeIn = null;
  const homeEl = h('div.bhome'); homeEl.style.display = 'none';
  function paintHome() {
    const p = prefsNow(); const hs = getHist().slice(0, 6); const bm = marks();
    homeIn = h('input.input.bh-in', { placeholder: t('Search with {e} or type a URL', { e: (ENGINES[p.engine] || ENGINES.nebulix)[0] }), autocomplete: 'off', spellcheck: 'false' });
    homeIn.addEventListener('keydown', (e) => { if (e.key === 'Enter' && active) navigate(active, homeIn.value); });
    const tile = (e, name, url) => h('button.link-tile.site-link', { style: 'position:relative', onClick: () => active && navigate(active, url) }, siteLogo(url, name, e, 32), h('div.grow', { style: 'min-width:0' }, h('b', { style: 'display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, name), h('span.tiny.muted', hostOf(url))));
    mount(homeEl, h('div.bh-wrap', h('div.brand', { style: 'justify-content:center;font-size:2rem' }, logoMark(40, 'logo-draw'), 'Nebulix'), h('p.muted.center', { style: 'margin:-4px 0 14px' }, t('Fast, private browsing through an isolated proxy.')),
      h('div.bh-search', icon('search', 20), homeIn, segEl(Object.entries(ENGINES).map(([k, v]) => [k, v[0]]), p.engine, (v) => saveEngine(v))),
      bm.length ? h('div.card', h('h3', t('Bookmarks')), h('div.grid.auto-s', bm.slice(0, 12).map((b) => tile((b.title || '?').slice(0, 2), b.title, b.url)))) : null,
      h('div.card', h('h3', t('Quick launch')), h('div.site-grid', GAMES.map(([e, n, u]) => h('button.site-tile', { title: n, onClick: () => active && navigate(active, u) }, siteLogo(u, n, e, 38), h('span.ellipsis', n))))),
      hs.length && !incog ? h('div.card', h('div.row', h('h3.grow', t('Recently visited')), h('button.btn.sm.ghost', { onClick: () => { ls('history', []); paintHome(); } }, t('Clear'))), h('div.col', { style: 'gap:2px' }, hs.map((x) => h('button.btn.ghost', { style: 'justify-content:flex-start;text-align:left', onClick: () => active && navigate(active, x.url) }, icon('clock', 16), h('span.grow', { style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, x.title), h('span.tiny.muted', hostOf(x.url)))))) : null,
      h('p.tiny.muted.center', t('Tip: some sites that require camera, microphone or heavy anti-bot checks may not work through a proxy.'))));
    if (shown) setTimeout(() => homeIn.focus(), 30);
  }
  async function saveEngine(v) { await savePrefs({ engine: v }); paintHome(); }

  // ---------------- side panel ----------------
  const panelEl = h('aside.bpanel'); panelEl.style.display = 'none';
  function togglePanel(name) { if (panel === name) { panel = null; } else { panel = name; panelTab = name; } panelEl.style.display = panel ? 'flex' : 'none'; if (panel) paintPanel(); else stopLog(); }
  const stats = { req: 0, bytes: 0, blocked: 0, cached: 0, ads: 0 };
  async function fetchStats() {
    if (!S.proxy.sid || !alive) return;
    try { const r = await api.get('/api/proxy/session/' + S.proxy.sid); Object.assign(stats, r.stats || {}); paintShieldBadge(); if (panel === 'shield') paintStatsGrid(); } catch (e) { if (e.status === 404) checkSession(); }
  }
  const scheduleStats = debounce(fetchStats, 700);
  function paintShieldBadge() { const n = (stats.ads || 0) + (stats.blocked || 0); shieldBadge.textContent = n > 99 ? '99+' : String(n); shieldBadge.style.display = n ? '' : 'none'; shieldBtn.title = t('{n} ads and trackers blocked this session', { n }); }
  async function savePrefs(patch) {
    try {
      const jobs = [api.patch('/api/profile', { settings: { proxy: patch } })];
      if (S.proxy.sid && !('engine' in patch)) jobs.push(api.patch('/api/proxy/session/' + S.proxy.sid, { prefs: patch }).catch(() => {}));
      const [r] = await Promise.all(jobs); setMe(r.user);
    } catch (e) { toastErr(e); }
  }
  let statsGrid = null;
  function paintStatsGrid() {
    if (!statsGrid) return; const cell = (l, v) => h('div.card.tight.stat', h('b', v), h('span', l));
    statsGrid.replaceChildren(cell(t('Requests'), fmt.num(stats.req)), cell(t('Data'), fmt.bytes(stats.bytes || 0)), cell(t('Blocked'), fmt.num((stats.ads || 0) + (stats.blocked || 0))), cell(t('From cache'), fmt.num(stats.cached)));
  }
  function stopLog() { clearInterval(logTimer); logTimer = null; }
  function paintPanel() {
    stopLog(); clear(panelEl);
    const head = h('div.row', { style: 'padding:10px 12px 0' }, tabsEl([['shield', t('Shield'), 'shield'], ['log', t('Log'), 'terminal'], ['cookies', t('Cookies'), 'layers'], ['library', t('Library'), 'bookmark']], panelTab, (id) => { panel = panelTab = id; paintPanel(); }), h('div.grow'), h('button.btn.ghost.icon.sm', { type: 'button', 'aria-label': t('Close'), onClick: () => togglePanel(panel) }, icon('x', 16)));
    head.firstChild.style.marginBottom = '0'; head.firstChild.style.flex = '1 1 auto';
    const body = h('div.bpbody'); panelEl.append(head, body);
    ({ shield: panelShield, log: panelLog, cookies: panelCookies, library: panelLibrary }[panelTab])(body);
  }
  function panelShield(body) {
    const p = prefsNow(); const row = (k, title, desc) => settingRow(title, desc, switchEl(p[k], (v) => savePrefs({ [k]: v }), title));
    statsGrid = h('div.grid.cols-2', { style: 'gap:8px' });
    const ua = h('select.select', { onChange: (e) => savePrefs({ ua: e.target.value }) }, [['auto', t('Automatic')], ['chrome', 'Chrome'], ['firefox', 'Firefox'], ['safari', 'Safari'], ['mobile', t('Mobile')]].map(([v, l]) => h('option', { value: v, selected: p.ua === v }, l)));
    body.append(h('div.card.tight', h('div.row', h('span.empty-art', { style: 'width:40px;height:40px;border-radius:10px' }, icon('shield', 18)), h('div.grow', h('b', t('Shield is active')), h('div.small.muted', t('Ads and trackers are blocked, cookies live on the server, your IP stays hidden from sites.')))), statsGrid),
      h('div.card.tight', row('adblock', t('Block ads & trackers'), t('Stops known ad and tracking hosts before they load.')), row('stripTracking', t('Strip tracking parameters'), t('Removes utm_*, fbclid, gclid and similar from links.')),
        row('jsRewrite', t('Keep scripts inside the proxy'), t('Rewrites page scripts so links and requests stay protected. Turn off only if a site breaks.')), row('cache', t('Smart cache'), t('Speeds up repeat visits to static files.')),
        settingRow(t('Browser identity'), t('What websites think you are using.'), ua)),
      h('button.btn.block', { type: 'button', onClick: newIdentity }, icon('refresh', 16), t('New identity (clear cookies & log)')));
    paintStatsGrid(); fetchStats();
  }
  async function newIdentity() {
    if (!(await confirmBox(t('This signs you out of every site in the proxy and reloads your tabs with a clean session. Continue?'), { ok: t('Start fresh') }))) return;
    try { const old = S.proxy.sid; if (old) await api.del('/api/proxy/session/' + old).catch(() => {}); session = null; S.proxy = { sid: null, origin: null }; await ensureSession(); Object.assign(stats, { req: 0, bytes: 0, blocked: 0, cached: 0, ads: 0 }); paintShieldBadge();
      for (const tb of tabs) if (tb.frame && tb.stack[tb.idx]) load(tb, tb.stack[tb.idx]); toast(t('Fresh identity ready'), 'good'); if (panel) paintPanel(); } catch (e) { toastErr(e); }
  }
  function panelLog(body) {
    const list = h('div.logtab'); const clearBtn = h('button.btn.sm', { type: 'button', onClick: async () => { if (S.proxy.sid) { await api.post('/api/proxy/clear/' + S.proxy.sid, { what: 'log' }).catch(() => {}); Object.assign(stats, { req: 0, bytes: 0, blocked: 0, cached: 0, ads: 0 }); paintShieldBadge(); draw(); } } }, t('Clear log'));
    body.append(h('div.row', h('span.small.muted.grow', t('Live requests made by your proxied pages')), clearBtn), list);
    const draw = async () => {
      if (!S.proxy.sid) { list.replaceChildren(h('div.muted.small', t('Open a page to see requests.'))); return; }
      try {
        const r = await api.get('/api/proxy/log/' + S.proxy.sid); if (panel !== 'log') return;
        list.replaceChildren(...(r.log.length ? r.log.slice(0, 80).map((x) => h('div.logrow' + (x.c === 'AD' ? '.ad' : x.s >= 400 ? '.bad' : ''), h('span.m', x.m), h('span.u', { title: x.u }, x.u), h('span.s', String(x.s)), h('span.z', x.c === 'AD' ? t('blocked') : x.c === 'HIT' ? t('cache') : fmt.bytes(x.b || 0)), h('span.ms', x.ms ? x.ms + 'ms' : '')))
          : [h('div.muted.small', t('Nothing yet.'))]));
      } catch {}
    };
    draw(); logTimer = setInterval(draw, 1800);
  }
  async function panelCookies(body) {
    const list = h('div.col', { style: 'gap:6px' }); const filter = h('input.input', { placeholder: t('Filter by site'), 'aria-label': t('Filter by site') });
    body.append(h('div.row', filter, h('button.btn.sm.danger', { type: 'button', onClick: async () => { if (S.proxy.sid && await confirmBox(t('Delete every cookie in this proxy session?'), { danger: true, ok: t('Delete all') })) { await api.post('/api/proxy/clear/' + S.proxy.sid, { what: 'cookies' }); draw(); } } }, t('Clear all'))),
      h('p.tiny.muted', t('Cookies are stored on the server for this session, never in your browser, and values are never shown here.')), list);
    let all = [];
    const paint = () => {
      const q = filter.value.trim().toLowerCase(); const by = {};
      for (const c of all) if (!q || c.domain.includes(q) || c.name.toLowerCase().includes(q)) (by[c.domain] = by[c.domain] || []).push(c);
      const doms = Object.keys(by).sort();
      list.replaceChildren(...(doms.length ? doms.map((d) => h('div.card.tight', h('div.row', h('b.grow', d), h('span.pill', String(by[d].length)), h('button.btn.sm.ghost', { type: 'button', onClick: async () => { await api.post('/api/proxy/clear/' + S.proxy.sid, { what: 'cookies', domain: d }); draw(); } }, t('Clear'))),
        by[d].map((c) => h('div.row.small', { style: 'padding:3px 0' }, h('span.grow', { style: 'overflow:hidden;text-overflow:ellipsis' }, c.name), c.secure ? h('span.tiny.muted', 'secure') : null, c.httpOnly ? h('span.tiny.muted', 'httpOnly') : null,
          h('button.btn.ghost.icon.sm', { type: 'button', 'aria-label': t('Delete'), onClick: async () => { await api.post(`/api/proxy/cookies/${S.proxy.sid}/delete`, { domain: c.domain, path: c.path, name: c.name }); draw(); } }, icon('trash', 14)))))) : [h('div.muted.small', t('No cookies yet.'))]));
    };
    filter.addEventListener('input', paint);
    async function draw() { if (!S.proxy.sid) { paint(); return; } try { all = (await api.get('/api/proxy/cookies/' + S.proxy.sid)).cookies; } catch { all = []; } paint(); }
    draw();
  }
  function panelLibrary(body) {
    let which = ls('libtab') || 'bm'; const list = h('div.col', { style: 'gap:2px' });
    const paint = () => {
      if (which === 'bm') {
        list.replaceChildren(...(marks().length ? marks().map((b, i) => h('div.row', h('button.btn.ghost', { style: 'flex:1;justify-content:flex-start;min-width:0;text-align:left', onClick: () => active && navigate(active, b.url) }, icon('star', 15), h('span.grow', { style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, b.title)),
          h('button.btn.ghost.icon.sm', { type: 'button', 'aria-label': t('Rename'), onClick: async () => { const n = await promptBox(t('Rename bookmark'), { value: b.title, validate: (v) => (!v.trim() || v.length > 60 ? t('1-60 characters') : '') }); if (n) { const l = marks().slice(); l[i] = { title: n.trim(), url: b.url }; saveMarks(l); } } }, icon('edit', 14)),
          h('button.btn.ghost.icon.sm', { type: 'button', 'aria-label': t('Delete'), onClick: () => saveMarks(marks().filter((_, j) => j !== i)) }, icon('trash', 14)))) : [h('div.muted.small', t('No bookmarks yet — press the star in the address bar.'))]));
      } else {
        const hs = getHist(); list.replaceChildren(h('div.row', h('span.grow'), h('button.btn.sm.ghost', { type: 'button', onClick: () => { ls('history', []); paint(); } }, t('Clear history'))),
          ...(hs.length ? hs.slice(0, 100).map((x) => h('button.btn.ghost', { style: 'justify-content:flex-start;text-align:left', onClick: () => active && navigate(active, x.url) }, icon('clock', 15), h('span.grow', { style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, x.title), h('span.tiny.muted', fmt.rel(x.t)))) : [h('div.muted.small', t('History is empty.'))]));
      }
    };
    body.append(segEl([['bm', t('Bookmarks')], ['hist', t('History')]], which, (v) => { which = v; ls('libtab', v); paint(); }), list); paint();
  }

  // ---------------- reader mode ----------------
  const readerPrefs = () => Object.assign({ fs: 19, width: 'normal', theme: 'auto', speed: 1 }, ls('reader') || {});
  const rdTitle = h('h1.rd-title'); const rdMeta = h('div.rd-meta'); const rdBody = h('article.rd-body');
  const rdDoc = h('div.rd-doc', rdTitle, rdMeta, rdBody);
  const rdScroll = h('div.rd-scroll', rdDoc);
  const rdHtitle = h('span.rd-htitle.grow.ellipsis');
  const rdFsOut = h('span.tiny.muted.rd-fs');
  let curReaderUrl = null;
  function setReaderStyle() { const p = readerPrefs(); rdDoc.style.fontSize = p.fs + 'px'; readerEl.dataset.width = p.width; readerEl.dataset.rtheme = p.theme; rdFsOut.textContent = p.fs + 'px'; }
  function patchReader(patch) { try { ls('reader', Object.assign(readerPrefs(), patch)); } catch {} setReaderStyle(); }
  const themeSeg = segEl([['auto', t('Auto')], ['light', t('Light')], ['sepia', t('Sepia')], ['dark', t('Dark')]], readerPrefs().theme, (v) => patchReader({ theme: v }));

  // Read the article aloud (Web Speech API, fully on-device). Highlights the block being spoken.
  const tts = (() => {
    const synth = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
    let chunks = [], idx = 0, playing = false, lang = '';
    const splitLong = (txt) => { const out = []; let s = txt.replace(/\s+/g, ' ').trim(); while (s.length > 220) { let cut = s.lastIndexOf('. ', 220); if (cut < 80) cut = s.lastIndexOf(' ', 220); if (cut < 80) cut = 220; out.push(s.slice(0, cut + 1).trim()); s = s.slice(cut + 1); } if (s) out.push(s); return out; };
    const voiceFor = (l) => { try { const vs = synth.getVoices(); if (!l || !vs.length) return null; l = l.toLowerCase(); return vs.find((v) => v.lang.toLowerCase() === l) || vs.find((v) => v.lang.toLowerCase().startsWith(l.slice(0, 2))) || null; } catch { return null; } };
    const rebuild = () => { chunks = []; rdBody.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption').forEach((el) => { const txt = (el.textContent || '').trim(); if (txt.length < 2) return; splitLong(txt).forEach((s) => chunks.push({ el, text: s })); }); };
    const hi = (el) => { rdBody.querySelectorAll('.rd-speaking').forEach((x) => x.classList.remove('rd-speaking')); if (el) { el.classList.add('rd-speaking'); try { el.scrollIntoView({ block: 'center' }); } catch {} } };
    function speakAt() {
      if (!playing) return;
      if (idx >= chunks.length) { stop(); return; }
      const c = chunks[idx]; const u = new SpeechSynthesisUtterance(c.text);
      u.rate = readerPrefs().speed || 1; if (lang) u.lang = lang; const v = voiceFor(lang); if (v) u.voice = v;
      u.onend = () => { if (playing) { idx++; speakAt(); } };
      u.onerror = () => { if (playing) { idx++; speakAt(); } };
      hi(c.el); try { synth.speak(u); } catch { stop(); }
    }
    function start() { if (!synth) { toast(t('Your browser cannot read pages aloud.'), 'err'); return; } try { synth.cancel(); } catch {} rebuild(); if (!chunks.length) return; idx = 0; playing = true; emit(); speakAt(); }
    function stop() { playing = false; try { synth && synth.cancel(); } catch {} hi(null); emit(); }
    function toggle() { if (playing) stop(); else start(); } // Play/Stop — pause()/resume() is unreliable across browsers
    function setSpeed(s) { patchReader({ speed: s }); if (playing) { const keep = idx; try { synth.cancel(); } catch {} idx = keep; speakAt(); } }
    let onchg = () => {};
    function emit() { try { onchg(); } catch {} }
    return { start, stop, toggle, setSpeed, setLang: (l) => { lang = l || ''; }, onChange: (f) => { onchg = f; }, supported: !!synth, get playing() { return playing; }, get paused() { return !!(synth && synth.paused); } };
  })();

  const listenBtn = h('button.btn.ghost.icon.sm.rd-listen', { type: 'button', title: t('Listen'), 'aria-label': t('Listen'), onClick: () => tts.toggle() }, icon('play', 16));
  const speedBtn = h('button.btn.ghost.sm.rd-speed', { type: 'button', title: t('Reading speed'), onClick: () => { const steps = [1, 1.25, 1.5, 1.75, 0.75]; const cur = readerPrefs().speed || 1; const next = steps[(steps.indexOf(cur) + 1) % steps.length] || 1; tts.setSpeed(next); updateTtsUi(); } }, (readerPrefs().speed || 1) + '×');
  function updateTtsUi() {
    const sp = readerPrefs().speed || 1; speedBtn.textContent = sp + '×';
    listenBtn.replaceChildren(icon(tts.playing ? 'pause' : 'play', 16));
    listenBtn.classList.toggle('on', tts.playing);
    listenBtn.title = tts.playing ? t('Stop') : t('Listen');
  }
  tts.onChange(updateTtsUi);

  const readerHead = h('div.rd-head',
    h('button.btn.ghost.icon.sm', { type: 'button', title: t('Close reader'), 'aria-label': t('Close reader'), onClick: () => closeReader() }, icon('x', 18)),
    rdHtitle, listenBtn, speedBtn,
    h('button.btn.ghost.icon.sm', { type: 'button', title: t('Smaller text'), 'aria-label': t('Smaller text'), onClick: () => patchReader({ fs: Math.max(14, readerPrefs().fs - 1) }) }, icon('zoomout', 16)),
    rdFsOut,
    h('button.btn.ghost.icon.sm', { type: 'button', title: t('Bigger text'), 'aria-label': t('Bigger text'), onClick: () => patchReader({ fs: Math.min(28, readerPrefs().fs + 1) }) }, icon('zoomin', 16)),
    h('button.btn.ghost.icon.sm', { type: 'button', title: t('Column width'), 'aria-label': t('Column width'), onClick: () => patchReader({ width: readerPrefs().width === 'normal' ? 'wide' : 'normal' }) }, icon('layers', 16)),
    themeSeg,
    h('button.btn.ghost.sm.rd-full', { type: 'button', title: t('Open the full page'), onClick: () => { const u = curReaderUrl; closeReader(); if (u && active) navigate(active, u); } }, icon('globe', 15), t('Full page')));
  const readerEl = h('div.breader', readerHead, rdScroll); readerEl.style.display = 'none';
  rdBody.addEventListener('click', (e) => { const a = e.target.closest('a[href]'); if (!a) return; const href = a.getAttribute('href'); if (/^https?:/.test(href)) { e.preventDefault(); closeReader(); if (active) navigate(active, href); } });
  async function openReader() {
    const tb = active; const u = tb && !tb.home ? tb.stack[tb.idx] : null; if (!u || !/^https?:/.test(u)) return;
    curReaderUrl = u; readerEl.style.display = 'flex'; setReaderStyle(); tts.stop(); updateTtsUi();
    rdHtitle.textContent = t('Reader mode'); rdTitle.textContent = ''; mount(rdMeta);
    mount(rdBody, h('div.rd-status', h('span.spinner'), h('p.muted', t('Preparing a clean read…'))));
    try {
      const { article } = await api.get('/api/reader?url=' + encodeURIComponent(u));
      if (curReaderUrl !== u) return; renderReader(article);
    } catch (e) {
      if (curReaderUrl !== u) return;
      const msg = e && e.code === 'no_article' ? t('This page doesn’t look like an article — try Reader on a news story or blog post.') : (e && e.message) || t('Could not load this page.');
      mount(rdBody, h('div.rd-status', icon('book', 30), h('h3', t('No readable article')), h('p.muted', msg), h('button.btn', { type: 'button', onClick: () => closeReader() }, t('Close'))));
    }
  }
  function renderReader(a) {
    rdHtitle.textContent = a.site || t('Reader mode');
    rdTitle.textContent = a.title || '';
    const bits = [a.byline ? h('span', a.byline) : null, h('span', t('{n} min read', { n: a.minutes })), h('span', hostOf(a.url))].filter(Boolean);
    mount(rdMeta, bits);
    rdBody.innerHTML = a.html || '';
    const proxied = S.proxy && S.proxy.origin && S.proxy.sid;
    rdBody.querySelectorAll('img').forEach((img) => { const s = img.getAttribute('src'); const p = proxied && /^https?:/.test(s || '') ? toProxy(s) : ''; if (p) { img.src = p; img.addEventListener('error', () => img.remove()); } else img.remove(); });
    rdScroll.scrollTop = 0;
    tts.stop(); tts.setLang(a.lang || ''); updateTtsUi();
  }
  function closeReader() { curReaderUrl = null; tts.stop(); readerEl.style.display = 'none'; mount(rdBody); }

  // ---------------- find in page ----------------
  let findQ = '';
  const findIn = h('input.find-in', { type: 'text', spellcheck: 'false', autocomplete: 'off', 'aria-label': t('Find in page'), placeholder: t('Find in page') });
  const findCount = h('span.find-count.tiny.muted');
  const sendFind = (msg) => { const tb = active; if (tb && tb.frame && !tb.home) postTo(tb, Object.assign({ nx: 1, t: 'find' }, msg)); };
  const doFind = debounce(() => { findQ = findIn.value; findCount.textContent = ''; sendFind({ q: findQ }); }, 160);
  const findBar = h('div.bfind',
    icon('search', 15), findIn, findCount,
    h('button.btn.ghost.icon.sm', { type: 'button', title: t('Previous match'), 'aria-label': t('Previous match'), onClick: () => sendFind({ step: -1 }) }, icon('back', 15)),
    h('button.btn.ghost.icon.sm', { type: 'button', title: t('Next match'), 'aria-label': t('Next match'), onClick: () => sendFind({ step: 1 }) }, icon('fwd', 15)),
    h('button.btn.ghost.icon.sm', { type: 'button', title: t('Close'), 'aria-label': t('Close'), onClick: () => closeFind() }, icon('x', 15)));
  findBar.style.display = 'none';
  findIn.addEventListener('input', doFind);
  findIn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sendFind({ step: e.shiftKey ? -1 : 1 }); }
    else if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
  });
  function openFind() {
    const tb = active; if (!tb || tb.home || !tb.frame) return;
    findBar.style.display = 'flex'; findIn.focus(); findIn.select();
    if (findIn.value.trim()) sendFind({ q: findIn.value });
  }
  function closeFind() { findBar.style.display = 'none'; sendFind({ close: true }); findCount.textContent = ''; const tb = active; if (tb && tb.frame) try { tb.frame.focus(); } catch {} }
  function onFindResult(d) {
    if (findBar.style.display === 'none') return;
    const n = d.count || 0; const i = d.index || 0;
    findCount.textContent = n ? `${i}/${n}` : (findIn.value.trim() ? t('No results') : '');
    findIn.classList.toggle('no-hit', !!findIn.value.trim() && !n);
  }

  // ---------------- layout ----------------
  const viewport = h('div.bviewport', homeEl, readerEl, findBar);
  const wrap = h('div.bwrap', tabStrip, toolbar, prog, incogNote, h('div.bbody', viewport, panelEl));
  mount(root, wrap);

  // ---------------- init / lifecycle ----------------
  const handledCtx = new WeakSet();
  function handleGo(ctx) {
    const v = ctx && ctx.query && ctx.query.get('go'); if (!v || handledCtx.has(ctx)) return false; handledCtx.add(ctx);
    try { history.replaceState(null, '', '#/browse'); } catch {}
    const r = resolveInput(v); if (!r.url) { toast(r.error || t('That address does not look right.'), 'err'); return true; }
    newTab(r.url, { reuseBlank: true }); return true;
  }
  const onKey = (e) => {
    if (!shown) return;
    const win = root.closest && root.closest('.os-win'); if (win && !win.classList.contains('focused')) return;
    if (e.key === 'Escape' && findBar.style.display !== 'none') { e.preventDefault(); closeFind(); return; }
    if (e.key === 'Escape' && readerEl.style.display !== 'none') { e.preventDefault(); closeReader(); return; }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'f' && active && !active.home) { e.preventDefault(); openFind(); return; }
    if (!e.altKey || e.ctrlKey || e.metaKey) return; const w = win; const k = e.key.toLowerCase();
    if (k === 'b') { e.preventDefault(); openReader(); return; }
    if (k === 'f') { e.preventDefault(); openFind(); return; }
    if (k === 'n') { e.preventDefault(); setIncognito(!incog); return; }
    if (k === 't') { e.preventDefault(); newTab(); } else if (k === 'w') { e.preventDefault(); active && closeTab(active); } else if (k === 'l') { e.preventDefault(); omniIn.focus(); }
    else if (k === 'arrowleft') { e.preventDefault(); goBack(); } else if (k === 'arrowright') { e.preventDefault(); goFwd(); } else if (k === 'r') { e.preventDefault(); reloadOrStop(); }
  };
  window.addEventListener('message', onMessage); document.addEventListener('keydown', onKey);
  unsubs.push(bus.on('ws:open', () => { if (S.proxy.sid) checkSession(); }), bus.on('me', () => { if (active && active.home) paintHome(); }));

  return {
    async init(ctx) {
      paintTabs(); paintShieldBadge();
      let restored = false;
      if (!(ctx.query && ctx.query.get('go'))) {
        try { const sv = JSON.parse(sessionStorage.getItem('nbx.tabs') || 'null'); if (sv && Array.isArray(sv.t) && sv.t.length && sv.t.some(Boolean)) { sv.t.slice(0, MAX_TABS).forEach((u) => { const tb = { id: nextId++, title: u ? hostOf(u) : t('New tab'), icon: '', loading: false, stack: [], idx: -1, fresh: false, zoom: 1, frame: null, home: !u, lazy: u || null }; tabs.push(tb); }); restored = true; select(tabs[Math.min(sv.a || 0, tabs.length - 1)]); } } catch {}
      }
      if (!restored) { if (!handleGo(ctx)) newTab(); }
      shown = true; paintBar();
    },
    activate(ctx) { shown = true; if (!handleGo(ctx)) { if (active && active.home && homeIn) setTimeout(() => homeIn.focus(), 30); } paintBar(); fetchStats(); clearInterval(pollTimer); pollTimer = setInterval(fetchStats, 8000); },
    deactivate() { shown = false; clearInterval(pollTimer); stopLog(); },
    destroy() { if (incog) { incog = false; endPrivate(); } alive = false; shown = false; clearInterval(pollTimer); stopLog(); try { tts.stop(); } catch {} window.removeEventListener('message', onMessage); document.removeEventListener('keydown', onKey); unsubs.forEach((f) => f()); tabs.forEach((tb) => tb.frame && tb.frame.remove()); },
  };
}

export default {
  title: () => t('Browser'), full: true,
  async mount(root, ctx) { inst = build(root); await inst.init(ctx); inst.activate(ctx); return () => { if (inst) inst.destroy(); inst = null; }; },
  activate(ctx) { if (inst) inst.activate(ctx); },
  deactivate() { if (inst) inst.deactivate(); },
};
