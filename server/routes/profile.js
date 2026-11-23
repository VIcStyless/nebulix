'use strict';
const cfg = require('../config');
const { S, publicUser, selfUser, isPro } = require('../state');
const uploads = require('../uploads');
const { HttpError, V, readBody } = require('../util');

const ENGINES = ['nebulix', 'ddg', 'bing', 'brave', 'google'];
const LANGS = ['en', 'es', 'pt', 'fr', 'de', 'it'];
const WALLPAPERS = ['os', 'theme', 'stars', 'nebula', 'aurora', 'grid', 'particles', 'waves', 'matrix', 'bokeh', 'lava', 'gradient', 'image'];
const ANIM = ['off', 'subtle', 'normal', 'extra'];
const EMOJI1 = /^(?:\p{Extended_Pictographic}(?:\u200d\p{Extended_Pictographic}|\ufe0f|\p{Emoji_Modifier})*)$/u;
const CTRL = /[\u0000-\u001f\u202a-\u202e\u2066-\u2069]/g;
const UAS = ['auto', 'chrome', 'firefox', 'safari', 'mobile'];

// Public slice of someone's game library for their profile (owner can hide it in Settings → Privacy).
function gamesOf(u, viewer) {
  if (!Array.isArray(u.library) || !u.library.length) return null;
  if (u.settings && u.settings.showLibrary === false && (!viewer || viewer.id !== u.id)) return null;
  const pick = (st) => u.library.filter((g) => g.status === st);
  const playing = pick('playing').slice(0, 4).map((g) => ({ name: g.name, rating: g.rating || 0, hours: g.hours || 0 }));
  const fav = u.library.filter((g) => g.rating >= 5).slice(0, 4).map((g) => ({ name: g.name, rating: g.rating }));
  return { playing, favorites: fav, total: u.library.length, done: pick('done').length, hours: Math.round(u.library.reduce((a, g) => a + (g.hours || 0), 0)) };
}

function cleanSettings(cur, inp, user = {}) {
  const s = Object.assign({}, cur);
  if (inp.dm !== undefined) { if (!['everyone', 'friends', 'none'].includes(inp.dm)) throw new HttpError(400, 'bad_setting', 'Bad DM setting'); s.dm = inp.dm; }
  if (inp.proxy && typeof inp.proxy === 'object') {
    const p = Object.assign({ engine: 'nebulix', adblock: true, jsRewrite: true, stripTracking: true, cache: true, ua: 'auto' }, cur.proxy || {});
    if (inp.proxy.engine !== undefined) { if (!ENGINES.includes(inp.proxy.engine)) throw new HttpError(400, 'bad_setting', 'Bad search engine'); p.engine = inp.proxy.engine; }
    if (inp.proxy.ua !== undefined) { if (!UAS.includes(inp.proxy.ua)) throw new HttpError(400, 'bad_setting', 'Bad user agent'); p.ua = inp.proxy.ua; }
    for (const k of ['adblock', 'jsRewrite', 'stripTracking', 'cache', 'vpn']) if (inp.proxy[k] !== undefined) p[k] = !!inp.proxy[k];
    s.proxy = p;
  }
  if (inp.ui && typeof inp.ui === 'object') {
    const u = Object.assign({}, cur.ui || {});
    for (const k of ['sounds', 'reduceMotion', 'compact', 'highContrast', 'showCoinsBar']) if (inp.ui[k] !== undefined) u[k] = !!inp.ui[k];
    if (inp.ui.fontScale !== undefined) u.fontScale = Math.max(0.85, Math.min(1.3, Number(inp.ui.fontScale) || 1));
    if (inp.ui.osMode !== undefined) u.osMode = !!inp.ui.osMode;
    if (inp.ui.anim !== undefined) { if (!ANIM.includes(inp.ui.anim)) throw new HttpError(400, 'bad_setting', 'Bad animation level'); u.anim = inp.ui.anim; }
    if (inp.ui.os && typeof inp.ui.os === 'object') {
      const o = Object.assign({ wallpaper: 'os', image: '', react: true, dim: 0, winStyle: 'win', dock: 'bottom', icons: true, widgets: false, restore: true }, u.os || {});
      const x = inp.ui.os;
      if (x.wallpaper !== undefined) { if (!WALLPAPERS.includes(x.wallpaper)) throw new HttpError(400, 'bad_setting', 'Unknown wallpaper'); o.wallpaper = x.wallpaper; }
      if (x.image !== undefined) { if (x.image && !uploads.URL_RE.test(String(x.image))) throw new HttpError(400, 'bad_image', 'Upload the image first'); o.image = x.image || ''; }
      if (x.dim !== undefined) o.dim = Math.max(0, Math.min(0.8, Number(x.dim) || 0));
      if (x.winStyle !== undefined) o.winStyle = x.winStyle === 'linux' ? 'linux' : 'win';
      if (x.dock !== undefined) o.dock = x.dock === 'top' ? 'top' : 'bottom';
      for (const k of ['react', 'icons', 'widgets', 'restore']) if (x[k] !== undefined) o[k] = !!x[k];
      u.os = o;
    }
    // animated background from the Hub (kind "wall"): { id, dim, blur, speed } — id '' removes it
    if (inp.ui.livebg && typeof inp.ui.livebg === 'object') {
      const x = inp.ui.livebg; const o = Object.assign({ id: '', dim: 0.25, blur: 0, speed: 1 }, u.livebg || {});
      if (x.id !== undefined) { const id = String(x.id || ''); if (id) { const it = S.store.table('hubitems')[id]; if (!it || it.kind !== 'wall' || (it.public === false && it.owner !== user.id)) throw new HttpError(400, 'bad_setting', 'That background is not available'); } o.id = id; }
      if (x.dim !== undefined) o.dim = Math.max(0, Math.min(0.85, Number(x.dim) || 0));
      if (x.blur !== undefined) o.blur = Math.max(0, Math.min(20, Math.round(Number(x.blur) || 0)));
      if (x.speed !== undefined) o.speed = Math.max(0.25, Math.min(2, Number(x.speed) || 1));
      u.livebg = o;
    }
    s.ui = u;
  }
  if (inp.showActivity !== undefined) s.showActivity = !!inp.showActivity;
  if (inp.showLibrary !== undefined) s.showLibrary = !!inp.showLibrary;
  if (inp.readReceipts !== undefined) s.readReceipts = !!inp.readReceipts;
  for (const k of ['pushDm', 'pushDuel', 'pushNotice', 'pushStudy']) if (inp[k] !== undefined) s[k] = !!inp[k];
  if (inp.duels !== undefined) { if (!['everyone', 'friends', 'none'].includes(inp.duels)) throw new HttpError(400, 'bad_setting', 'Bad duel setting'); s.duels = inp.duels; }
  if (inp.activeTheme !== undefined) {
    if (inp.activeTheme === null) s.activeTheme = null;
    else s.activeTheme = require('./themes').sanitizeTheme(inp.activeTheme);
  }
  return s;
}

module.exports = function register(r) {
  // ---- screen lock: a password that hides Nebulix until it is typed again (the account password also unlocks it) ----
  const { hashPw, checkPw } = require('./auth');
  const lockView = (u) => (u.lock ? { on: true, idle: u.lock.idle || 0, start: !!u.lock.start } : null);
  r.post('/api/lock/set', { auth: true, limit: [10, 60000, 'user'] }, async (c) => {
    const u = c.user; const pw = String(c.body.password || '');
    if (pw.length < 4 || pw.length > 64) throw new HttpError(400, 'bad_password', 'The lock password needs 4 to 64 characters');
    if (u.lock && !(await checkPw(String(c.body.current || ''), u.lock.hash)) && !(await checkPw(String(c.body.current || ''), u.pass))) throw new HttpError(403, 'bad_password', 'Wrong current lock password');
    u.lock = { hash: await hashPw(pw), idle: (u.lock && u.lock.idle) || 5, start: u.lock ? !!u.lock.start : true, at: Date.now() }; S.store.touch('users');
    return { lock: lockView(u) };
  });
  r.post('/api/lock/options', { auth: true, limit: [30, 60000, 'user'] }, async (c) => {
    const u = c.user; if (!u.lock) throw new HttpError(400, 'no_lock', 'Set a lock password first');
    if (c.body.idle !== undefined) { const m = Math.trunc(Number(c.body.idle)); if (![0, 1, 2, 5, 10, 15, 30, 60].includes(m)) throw new HttpError(400, 'bad_idle', 'Pick a valid time'); u.lock.idle = m; }
    if (c.body.start !== undefined) u.lock.start = !!c.body.start;
    S.store.touch('users'); return { lock: lockView(u) };
  });
  r.post('/api/lock/verify', { auth: true, limit: [12, 60000, 'user'] }, async (c) => {
    const u = c.user; if (!u.lock) return { ok: true }; const pw = String(c.body.password || '');
    const ok = (await checkPw(pw, u.lock.hash)) || (c.body.account === true && (await checkPw(pw, u.pass)));
    if (!ok) throw new HttpError(403, 'bad_password', 'Wrong password'); return { ok: true };
  });
  r.post('/api/lock/remove', { auth: true, limit: [10, 60000, 'user'] }, async (c) => {
    const u = c.user; if (!u.lock) return { lock: null }; const pw = String(c.body.password || '');
    if (!(await checkPw(pw, u.lock.hash)) && !(await checkPw(pw, u.pass))) throw new HttpError(403, 'bad_password', 'Wrong password');
    u.lock = null; S.store.touch('users'); return { lock: null };
  });
  r.patch('/api/profile', { auth: true, limit: [30, 60000, 'user'] }, async (c) => {
    const u = c.user; const b = c.body;
    if (b.displayName !== undefined) {
      if (!V.str(b.displayName, 1, 32) || /[\u0000-\u001f\u202a-\u202e\u2066-\u2069]/.test(b.displayName)) throw new HttpError(400, 'bad_name', 'Display name must be 1-32 characters');
      u.displayName = b.displayName.trim() || u.username;
    }
    if (b.bio !== undefined) {
      if (!V.str(b.bio, 0, 190)) throw new HttpError(400, 'bad_bio', 'Bio can be up to 190 characters');
      u.bio = b.bio.replace(/[\u0000-\u0008\u000b-\u001f\u202a-\u202e\u2066-\u2069]/g, '');
    }
    if (b.lang !== undefined) u.lang = LANGS.includes(b.lang) ? b.lang : 'en';
    if (b.status !== undefined) {
      if (b.status === null || (typeof b.status === 'object' && !b.status.text && !b.status.emoji)) u.status = null;
      else if (typeof b.status === 'object') {
        const text = String(b.status.text || '').replace(CTRL, '').trim();
        if (text.length > 80) throw new HttpError(400, 'bad_status', 'Status can be up to 80 characters');
        const emoji = String(b.status.emoji || '');
        if (emoji && (emoji.length > 16 || !EMOJI1.test(emoji))) throw new HttpError(400, 'bad_status', 'Use a single emoji');
        const mins = [0, 30, 60, 240, 1440].includes(Number(b.status.clearAfter)) ? Number(b.status.clearAfter) : 0;
        u.status = { text, emoji, until: mins ? Date.now() + mins * 60000 : 0 };
      } else throw new HttpError(400, 'bad_status', 'Invalid status');
      require('./chat').announcePresence(u);
    }
    for (const k of ['avatar', 'banner']) {
      if (b[k] !== undefined) {
        if (b[k] !== null) {
          if (!uploads.URL_RE.test(String(b[k]))) throw new HttpError(400, 'bad_image', 'Upload the image first');
          const info = uploads.fileInfo(b[k]);
          if (!info) throw new HttpError(400, 'bad_image', 'That image is not available');
          if (b[k] !== u[k]) require('../economy').requirePerk(u, k, !!info.animated);
        }
        u[k] = b[k];
      }
    }
    if (b.bannerColor !== undefined) {
      if (b.bannerColor !== null && !/^#[0-9a-fA-F]{6}$/.test(String(b.bannerColor))) throw new HttpError(400, 'bad_color', 'Use a #RRGGBB color');
      u.bannerColor = b.bannerColor;
    }
    if (b.settings && typeof b.settings === 'object') {
      const was = !(u.settings && u.settings.showActivity === false);
      u.settings = cleanSettings(u.settings || {}, b.settings, u);
      if (was !== !(u.settings.showActivity === false)) require('./chat').announcePresence(u);
    }
    S.store.touch('users');
    if (b.settings && b.settings.proxy) require('./proxyapi').refreshPrefs(u);
    return { user: selfUser(u) };
  });

  r.post('/api/upload', { auth: true, verified: true, stream: true, limit: [40, 600000, 'user'] }, async (c) => {
    const kind = c.query.kind || 'chat';
    const lim = uploads.LIMITS[kind];
    if (!lim) throw new HttpError(400, 'bad_kind', 'Unknown upload type');
    const pro = isPro(c.user);
    const buf = await readBody(c.req, lim[pro ? 1 : 0] + 1024);
    const out = uploads.save(buf, kind, pro, c.user);
    S.store.touch('users');
    return out;
  });

  r.get('/api/users/search', { auth: true, limit: [60, 60000, 'user'] }, async (c) => {
    const q = String(c.query.q || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20);
    if (q.length < 2) return { users: [] };
    const out = [];
    for (const [name, id] of S.byName) {
      if (name.startsWith(q) && S.users[id].verified) { out.push(publicUser(S.users[id])); if (out.length >= 10) break; }
    }
    return { users: out };
  });

  r.get('/api/users/by-name/:name', { auth: true }, async (c) => {
    const id = S.byName.get(String(c.params.name).toLowerCase());
    const u = id && S.users[id];
    if (!u || !u.verified) throw new HttpError(404, 'no_user', 'User not found');
    return { user: publicUser(u), stats: { wagered: (u.stats || {}).wagered || 0 }, games: gamesOf(u, c.user) };
  });

  r.get('/api/users/:id', { auth: true }, async (c) => {
    const u = S.users[c.params.id];
    if (!u || (!u.verified && !u.deleted)) throw new HttpError(404, 'no_user', 'User not found');
    const f = (c.user.friends || []).includes(u.id);
    return { user: publicUser(u), friend: f, pending: (c.user.outgoing || []).includes(u.id), incoming: (c.user.incoming || []).includes(u.id) };
  });

  r.put('/api/bookmarks', { auth: true, limit: [60, 60000, 'user'] }, async (c) => {
    const list = c.body.list;
    if (!Array.isArray(list) || list.length > 60) throw new HttpError(400, 'bad_list', 'Up to 60 bookmarks');
    const out = [];
    for (const b of list) {
      if (!b || !V.str(b.title, 1, 60) || !V.str(b.url, 4, 600) || !/^https?:\/\//i.test(b.url)) continue;
      out.push({ title: b.title, url: b.url });
    }
    c.user.bookmarks = out; S.store.touch('users');
    return { bookmarks: out };
  });
};

module.exports.cleanSettings = cleanSettings;
