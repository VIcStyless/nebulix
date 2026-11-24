'use strict';
const { S, publicUser, isStaff } = require('../state');
const econ = require('../economy');
const prog = require('../progress');
const uploads = require('../uploads');
const { HttpError, rid, now, dayKey, V } = require('../util');

const color = (v, d) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(v) ? v : d);
const num = (v, min, max, d) => { v = Number(v); return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d; };
const oneOf = (v, arr, d) => (arr.includes(v) ? v : d);
const FONT_KEYS = ['system', 'rounded', 'mono', 'serif', 'pixel', 'geometric', 'humanist', 'condensed', 'slab', 'hand', 'display', 'elegant', 'wide'];
const BG_KEYS = ['stars', 'nebula', 'aurora', 'grid', 'particles', 'waves', 'matrix', 'bokeh', 'bubbles', 'blobs', 'mesh', 'lava', 'gradient', 'solid', 'image', 'space3d', 'tunnel3d', 'crystals3d', 'city3d', 'snow', 'fireflies', 'hexgrid', 'confetti', 'rain', 'orbits'];

function cleanCss(s) {
  if (typeof s !== 'string') return '';
  s = s.slice(0, 4000).replace(/[<>\u0000]/g, '');
  s = s.replace(/@import[^;]*;?/gi, '').replace(/url\s*\(/gi, '(').replace(/expression\s*\(/gi, '(').replace(/javascript\s*:/gi, '').replace(/behaviou?r\s*:/gi, '').replace(/-moz-binding\s*:/gi, '');
  return s;
}

const DEFAULT_THEME = {
  v: 1, name: 'Nebula Dark', mode: 'dark',
  colors: { bg: '#0a0719', surface: '#141032', surface2: '#1c1745', text: '#ece9ff', muted: '#9b94d1', accent: '#8b5cf6', accent2: '#38bdf8', success: '#34d399', warn: '#fbbf24', danger: '#fb7185', border: '#2d2766' },
  bg: { type: 'stars', c1: '#1b1050', c2: '#0a0719', c3: '#3b0f6b', angle: 160, dim: 0.0, image: '', stars: { density: 0.6, speed: 0.5, twinkle: 0.7, color: '#ffffff' } },
  ui: { radius: 14, blur: 14, glow: 0.5, shadow: 0.5, density: 1, font: 'system', fontScale: 1, anim: 1, border: 1 },
  chat: { bubble: 'rounded' },
  customCss: '',
};

function sanitizeTheme(t) {
  if (!t || typeof t !== 'object') throw new HttpError(400, 'bad_theme', 'Invalid theme');
  const d = DEFAULT_THEME; const c = t.colors || {}; const b = t.bg || {}; const u = t.ui || {}; const s = b.stars || {};
  const out = {
    v: 1,
    name: typeof t.name === 'string' && t.name.trim() ? t.name.trim().slice(0, 40).replace(/[\u0000-\u001f]/g, '') : 'Untitled theme',
    mode: oneOf(t.mode, ['dark', 'light'], 'dark'),
    colors: {},
    bg: {
      type: oneOf(b.type, BG_KEYS, 'stars'),
      c1: color(b.c1, d.bg.c1), c2: color(b.c2, d.bg.c2), c3: color(b.c3, d.bg.c3),
      angle: Math.round(num(b.angle, 0, 360, 160)), dim: num(b.dim, 0, 0.9, 0),
      image: typeof b.image === 'string' && uploads.URL_RE.test(b.image) ? b.image : '',
      stars: { density: num(s.density, 0, 1, 0.6), speed: num(s.speed, 0, 3, 0.5), twinkle: num(s.twinkle, 0, 1, 0.7), color: color(s.color, '#ffffff') },
    },
    ui: {
      radius: Math.round(num(u.radius, 0, 28, 14)), blur: Math.round(num(u.blur, 0, 40, 14)), glow: num(u.glow, 0, 1, 0.5), shadow: num(u.shadow, 0, 1, 0.5),
      density: num(u.density, 0.85, 1.15, 1), font: oneOf(u.font, FONT_KEYS, 'system'),
      fontScale: num(u.fontScale, 0.9, 1.2, 1), anim: num(u.anim, 0, 2, 1), border: Math.round(num(u.border, 0, 3, 1)),
      surface: oneOf(u.surface, ['flat', 'glass', 'aero', 'mica', 'neo'], 'flat'),
      // 14.0
      headFont: oneOf(u.headFont, ['same', ...FONT_KEYS], 'same'), btn: oneOf(u.btn, ['gradient', 'solid', 'outline', 'soft', 'pill', '3d', 'glow'], 'gradient'),
      card: oneOf(u.card, ['default', 'outline', 'elevated', 'accent', 'gborder', 'neon', 'paper'], 'default'), pattern: oneOf(u.pattern, ['none', 'dots', 'grid', 'lines', 'diagonal', 'cross', 'hex', 'noise', 'waves'], 'none'),
      patternAlpha: num(u.patternAlpha, 0, 1, 0.5), hover: oneOf(u.hover, ['lift', 'glow', 'scale', 'tilt', 'none'], 'lift'), enter: oneOf(u.enter, ['fade', 'slide', 'zoom', 'blur', 'flip', 'none'], 'fade'),
      scroll: oneOf(u.scroll, ['thin', 'accent', 'hidden'], 'thin'), headGrad: u.headGrad === true, headWeight: Math.round(num(u.headWeight, 400, 900, 700) / 100) * 100,
    },
    chat: { bubble: oneOf((t.chat || {}).bubble, ['flat', 'rounded', 'glass'], 'rounded') },
    customCss: cleanCss(t.customCss),
  };
  for (const k of Object.keys(d.colors)) out.colors[k] = color(c[k], d.colors[k]);
  if (out.bg.type === 'image' && !out.bg.image) out.bg.type = 'stars';
  return out;
}

function pub(t, viewer) {
  const o = S.users[t.owner];
  return {
    id: t.id, name: t.name, desc: t.desc, tags: t.tags, installs: t.installs || 0, likes: (t.likes || []).length,
    liked: viewer ? (t.likes || []).includes(viewer.id) : false, created: t.created, data: t.data,
    owner: o ? { id: o.id, name: o.displayName || o.username, username: o.username } : null,
  };
}

module.exports = function register(r) {
  r.post('/api/themes/validate', { auth: true, limit: [60, 60000, 'user'], bodyLimit: 64 * 1024 }, async (c) => ({ theme: sanitizeTheme(c.body.theme) }));

  r.get('/api/themes', { auth: true, limit: [60, 60000, 'user'] }, async (c) => {
    const q = String(c.query.q || '').toLowerCase().slice(0, 40); const sort = c.query.sort === 'new' ? 'new' : 'popular';
    let list = Object.values(S.themes).filter((t) => !t.hidden);
    if (q) list = list.filter((t) => t.name.toLowerCase().includes(q) || (t.tags || []).some((x) => x.includes(q)) || (t.desc || '').toLowerCase().includes(q));
    list.sort(sort === 'new' ? (a, b) => b.created - a.created : (a, b) => ((b.likes || []).length * 3 + (b.installs || 0)) - ((a.likes || []).length * 3 + (a.installs || 0)) || b.created - a.created);
    return { themes: list.slice(0, 60).map((t) => pub(t, c.user)) };
  });

  r.get('/api/themes/mine', { auth: true }, async (c) => ({ themes: Object.values(S.themes).filter((t) => t.owner === c.user.id).map((t) => pub(t, c.user)) }));

  r.post('/api/themes', { auth: true, verified: true, limit: [10, 3600000, 'user'], bodyLimit: 64 * 1024 }, async (c) => {
    const u = c.user; const b = c.body;
    if (Object.values(S.themes).filter((t) => t.owner === u.id).length >= 20) throw new HttpError(400, 'too_many', 'You can publish up to 20 themes');
    const data = sanitizeTheme(b.theme); data.customCss = ''; // never share raw CSS
    const name = V.str(b.name, 2, 40) ? b.name.trim() : data.name;
    const desc = V.str(b.desc || '', 0, 200) ? String(b.desc || '').trim() : '';
    const tags = (Array.isArray(b.tags) ? b.tags : []).map((x) => String(x).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 16)).filter(Boolean).slice(0, 5);
    const t = { id: 't' + rid(7), owner: u.id, name, desc, tags, data: Object.assign(data, { name }), installs: 0, likes: [], inst: [], created: now() };
    S.themes[t.id] = t; u.themesPublished = (u.themesPublished || 0) + 1; prog.award(u, 'theme_pub');
    S.store.touch('themes'); S.store.touch('users');
    return { theme: pub(t, u) };
  });

  r.post('/api/themes/:id/install', { auth: true, limit: [60, 60000, 'user'] }, async (c) => {
    const t = S.themes[c.params.id];
    if (!t || t.hidden) throw new HttpError(404, 'no_theme', 'Theme not found');
    const u = c.user; let reward = 0;
    t.inst = t.inst || [];
    if (!t.inst.includes(u.id)) {
      t.inst.push(u.id); t.installs = (t.installs || 0) + 1;
      const o = S.users[t.owner];
      if (o && o.id !== u.id && u.verified && now() - u.created > 3600000) {
        o.themeReward = o.themeReward && o.themeReward.day === dayKey() ? o.themeReward : { day: dayKey(), n: 0 };
        if (o.themeReward.n < 50) { o.themeReward.n += 2; econ.adjust(o, 2, 'theme_install'); reward = 2; }
        prog.award(o, 'theme_inst'); prog.award(u, 'theme_use');
      }
      S.store.touch('themes');
    }
    return { theme: sanitizeTheme(t.data), reward };
  });

  r.post('/api/themes/:id/like', { auth: true, limit: [60, 60000, 'user'] }, async (c) => {
    const t = S.themes[c.params.id];
    if (!t || t.hidden) throw new HttpError(404, 'no_theme', 'Theme not found');
    t.likes = t.likes || [];
    const i = t.likes.indexOf(c.user.id);
    if (i >= 0) t.likes.splice(i, 1); else t.likes.push(c.user.id);
    S.store.touch('themes');
    return { liked: i < 0, likes: t.likes.length };
  });

  r.delete('/api/themes/:id', { auth: true }, async (c) => {
    const t = S.themes[c.params.id];
    if (!t) throw new HttpError(404, 'no_theme', 'Theme not found');
    if (t.owner !== c.user.id && !isStaff(c.user)) throw new HttpError(403, 'forbidden', 'Not your theme');
    delete S.themes[t.id]; S.store.touch('themes');
    return { ok: true };
  });
};

module.exports.sanitizeTheme = sanitizeTheme;
module.exports.DEFAULT_THEME = DEFAULT_THEME;
