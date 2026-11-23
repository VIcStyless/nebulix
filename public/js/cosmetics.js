// Renders profile decorations from the data-driven catalog (frames, banners, name effects, particle effects, bubbles, titles, badges).
import { h, hueOf, initial, rand, clamp } from './util.js';
import { t, getLang, pick2 } from './i18n.js';
import { api } from './api.js';
import { icon } from './icons.js';

export const catalog = new Map();
export async function loadCatalog() {
  const r = await api.get('/api/market'); catalog.clear(); for (const it of r.items) catalog.set(it.id, it); return r;
}
const spec = (id) => (id && catalog.get(id)) || null;

export function avatarEl(u, { size = 40, status = false, frame = true, cls = '' } = {}) {
  u = u || {}; const name = u.displayName || u.username || '?';
  const inner = u.avatar ? h('img', { src: u.avatar, alt: '', loading: 'lazy', draggable: 'false' })
    : h('span.ava-in', { style: { background: `hsl(${hueOf(u.id || name)} 32% 30%)`, color: `hsl(${hueOf(u.id || name)} 60% 86%)` } }, initial(name));
  const el = h('span.ava' + (cls ? '.' + cls : ''), { style: { '--s': size + 'px' }, title: name }, inner);
  const f = frame && u.eq && spec(u.eq.frame);
  if (f) {
    const s = f.spec; const w = s.w || 3; const cols = s.c || ['#fff'];
    const grad = s.k === 'dash' ? `repeating-conic-gradient(${cols[0]} 0 12deg, transparent 12deg 24deg)` : s.k === 'ring' ? `linear-gradient(135deg, ${cols.join(', ')})` : `conic-gradient(${[...cols, cols[0]].join(', ')})`;
    el.appendChild(h('i.frame.fr-' + s.k, { style: { '--fw': Math.max(2, Math.round(w * size / 40 + .4)) + 'px', '--fg': grad, '--glow': cols[0] } }));
  }
  if (status) el.appendChild(h('i.dot' + (u.online ? '.on' : '')));
  return el;
}

export function nameEl(u, { size, tag = 'span' } = {}) {
  const name = (u && (u.displayName || u.username)) || '?';
  const s = spec(u && u.eq && u.eq.nameFx);
  const el = h(tag + '.uname', { style: size ? { fontSize: size } : null }, name);
  if (s) {
    el.classList.add('nfx', 'nfx-' + s.spec.k); el.dataset.text = name; const c = s.spec.c || [];
    c.forEach((x, i) => el.style.setProperty('--c' + i, x)); if (!c[1]) el.style.setProperty('--c1', c[0] || '#fff'); if (!c[2]) el.style.setProperty('--c2', c[1] || c[0] || '#fff');
  }
  return el;
}
export function titleEl(u) {
  const s = spec(u && u.eq && u.eq.title); if (!s) return null;
  return h('span.title-chip', getLang() === 'es' ? s.spec.es : t(s.spec.text));
}
const SYS_BADGE = { verified: ['check', 'Verified'], founder: ['crown', 'Founder'], admin: ['shield', 'Admin'], mod: ['shield', 'Moderator'], pro: ['zap', 'PRO'], early: ['star', 'Early supporter'], creator: ['palette', 'Theme creator'] };
// Market badges were designed with emoji glyphs; they are drawn with the icon set instead.
const BADGE_ICON = { '🔥': 'zap', '⚡': 'zap', '💎': 'cube', '🎮': 'gamepad', '👾': 'gamepad', '🕹️': 'gamepad', '🏆': 'trophy', '🥇': 'trophy', '⭐': 'star', '🌟': 'star', '✨': 'spark', '🌌': 'spark', '🚀': 'zap', '❤️': 'heart', '💜': 'heart', '🎵': 'music', '🎧': 'music', '🎨': 'palette', '🛡️': 'shield', '👑': 'crown', '🎲': 'dice', '🎰': 'dice', '🍀': 'spark', '🐉': 'flag', '🦊': 'flag', '🌙': 'moon', '☀️': 'sun', '🧪': 'flask', '💻': 'monitor', '🎯': 'target', '⚔️': 'target', '🔒': 'lock',
  '✅': 'check', '👋': 'smile', '💬': 'chat', '📣': 'bell', '🤝': 'users', '🫂': 'users', '🔐': 'lock', '📅': 'calendar', '🗓️': 'calendar', '🛍️': 'bag', '🐍': 'snake', '🔢': 'grid', '⌨️': 'keyboard',
  '🐧': 'terminal', '🎚️': 'sliders', '🎛️': 'sliders', '🖥️': 'monitor', '🌐': 'globe', '🥉': 'medal', '🥈': 'medal', '🎁': 'gift', '📝': 'note', '🧩': 'puzzle', '🪙': 'coins', '🖼️': 'image', '🎞️': 'image', '🌄': 'image', '🎬': 'play' };
const badgeGlyph = (g) => icon(BADGE_ICON[g] || (/^[a-z]+$/.test(g || '') ? g : 'star'), 11);
export function badgesEl(u, { max = 8, sys = true } = {}) {
  const out = [];
  if (sys) for (const b of (u.badges || [])) { const d = SYS_BADGE[b]; if (d) out.push(h('span.badge-ic.' + b, { title: t(d[1]) }, icon(d[0], 11))); }
  for (const id of (u.eq && u.eq.badges) || []) { const s = spec(id); if (s) out.push(h('span.badge-ic', { title: pick2(s.n) }, badgeGlyph(s.spec.icon))); }
  return h('span.badges', out.slice(0, max));
}
export { badgeGlyph };
export function bannerEl(u, { height = 110, cls = '' } = {}) {
  u = u || {}; const el = h('div.banner' + (cls ? '.' + cls : ''), { style: { height: height + 'px' } });
  if (u.banner) { el.style.backgroundImage = `url("${u.banner}")`; el.classList.add('img'); return el; }
  const s = spec(u.eq && u.eq.banner);
  if (s) {
    const sp = s.spec; el.style.setProperty('--bg', `linear-gradient(${sp.a || 135}deg, ${sp.g.join(', ')})`); el.dataset.p = sp.p || 'none'; if (sp.an) el.classList.add('flow');
    el.style.backgroundImage = `linear-gradient(${sp.a || 135}deg, ${sp.g.join(', ')})`;
  } else if (u.bannerColor) el.style.background = `linear-gradient(135deg, ${u.bannerColor}, color-mix(in srgb, ${u.bannerColor} 55%, #000))`;
  else { const hu = hueOf(u.id || u.username || 'x'); el.style.background = `radial-gradient(120% 140% at 100% 0%, hsl(${hu} 35% 26%), hsl(${hu} 18% 14%) 70%)`; }
  return el;
}
export function bubbleStyle(u) {
  const s = spec(u && u.eq && u.eq.bubble); if (!s) return null; const b = s.spec;
  return { background: b.bg, border: `1px ${b.dash ? 'dashed' : 'solid'} ${b.bd}`, boxShadow: b.glow ? `0 0 14px ${b.glow}55` : 'none' };
}

// ---- particle effects on profile cards ----
let live = 0;
export function effectLayer(kind, color = '#fff') {
  const cv = h('canvas.fxlayer'); const ctx = cv.getContext('2d'); let W = 0, H = 0, parts = [], raf = 0, vis = true, tick = 0;
  const reduce = () => document.documentElement.dataset.reduce === '1' || (matchMedia('(prefers-reduced-motion: reduce)').matches && document.documentElement.dataset.reduce !== '0');
  const mkp = (i) => {
    const p = { x: Math.random() * W, y: Math.random() * H, r: rand(1, 3), v: rand(.2, 1), ph: rand(0, 6), life: rand(0, 1) };
    if (kind === 'bubbles') { p.r = rand(3, 9); p.y = H + p.r; p.v = rand(.3, .9); if (i !== undefined) p.y = Math.random() * H; }
    if (kind === 'snow') { p.y = i === undefined ? -4 : Math.random() * H; p.r = rand(1, 2.8); p.v = rand(.3, .9); }
    if (kind === 'embers') { p.y = i === undefined ? H + 4 : Math.random() * H; p.v = rand(.3, 1); p.r = rand(.8, 2.2); }
    if (kind === 'matrix') { p.x = (i % Math.ceil(W / 12)) * 12; p.y = Math.random() * H; p.v = rand(1, 3); p.ch = '01'; }
    if (kind === 'stars') { p.x = rand(-20, W); p.y = rand(-20, H * .5); p.v = rand(2.5, 5); p.life = rand(0, 1); p.len = rand(20, 50); }
    return p;
  };
  const size = () => { const r = cv.parentElement && cv.parentElement.getBoundingClientRect(); if (!r) return; const d = Math.min(devicePixelRatio || 1, 1.5); W = Math.max(10, r.width); H = Math.max(10, r.height); cv.width = W * d; cv.height = H * d; ctx.setTransform(d, 0, 0, d, 0, 0); const n = kind === 'matrix' ? Math.ceil(W / 12) : kind === 'stars' ? 5 : 34; parts = Array.from({ length: n }, (_, i) => mkp(i)); };
  const draw = () => {
    ctx.clearRect(0, 0, W, H); tick++;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (kind === 'sparkles') { p.life += .012 * p.v; const a = Math.sin(p.life * 3.14) ** 2; if (p.life > 1) { Object.assign(p, mkp(), { life: 0 }); } ctx.fillStyle = color; ctx.globalAlpha = a; const s = 2 + p.r * 1.6; ctx.beginPath(); ctx.moveTo(p.x, p.y - s); ctx.quadraticCurveTo(p.x, p.y, p.x + s, p.y); ctx.quadraticCurveTo(p.x, p.y, p.x, p.y + s); ctx.quadraticCurveTo(p.x, p.y, p.x - s, p.y); ctx.quadraticCurveTo(p.x, p.y, p.x, p.y - s); ctx.fill(); }
      else if (kind === 'bubbles') { p.y -= p.v; p.x += Math.sin(p.ph + p.y / 25) * .4; if (p.y < -p.r) Object.assign(p, mkp()); ctx.globalAlpha = .55; ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.stroke(); ctx.globalAlpha = .12; ctx.fillStyle = color; ctx.fill(); }
      else if (kind === 'snow') { p.y += p.v; p.x += Math.sin(p.ph + p.y / 30) * .5; if (p.y > H + 4) Object.assign(p, mkp()); ctx.globalAlpha = .85; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill(); }
      else if (kind === 'embers') { p.y -= p.v; p.x += Math.sin(p.ph + p.y / 18) * .6; p.life -= .004; if (p.y < -4 || p.life < 0) Object.assign(p, mkp(), { life: 1 }); ctx.globalAlpha = clamp(p.life, 0, 1) * (.5 + .5 * Math.sin(tick / 6 + p.ph)); ctx.fillStyle = color; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill(); }
      else if (kind === 'stars') { p.x += p.v * 1.4; p.y += p.v * .8; p.life += .01; if (p.x > W + 40 || p.y > H + 40) Object.assign(p, mkp(), { x: rand(-30, W * .6), y: rand(-30, 0) }); const g = ctx.createLinearGradient(p.x, p.y, p.x - p.len, p.y - p.len * .55); g.addColorStop(0, color); g.addColorStop(1, 'transparent'); ctx.globalAlpha = .85; ctx.strokeStyle = g; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.len, p.y - p.len * .55); ctx.stroke(); }
      else if (kind === 'matrix') { p.y += p.v; if (p.y > H + 20) { p.y = -10; p.v = rand(1, 3); } ctx.globalAlpha = .75; ctx.fillStyle = color; ctx.font = '11px monospace'; ctx.fillText(String.fromCharCode(0x30A0 + Math.floor(Math.random() * 60)), p.x, p.y); ctx.globalAlpha = .25; ctx.fillText(String.fromCharCode(0x30A0 + Math.floor(Math.random() * 60)), p.x, p.y - 12); }
    }
    ctx.globalAlpha = 1;
  };
  const loop = () => { if (!vis) { raf = 0; return; } draw(); raf = requestAnimationFrame(loop); };
  const io = new IntersectionObserver((es) => { vis = es[0].isIntersecting; if (vis && !raf && !reduce()) { if (live >= 6) return; live++; raf = requestAnimationFrame(loop); } else if (!vis && raf) { cancelAnimationFrame(raf); raf = 0; live = Math.max(0, live - 1); } });
  const ro = new ResizeObserver(size);
  cv._start = () => { if (cv.parentElement) { ro.observe(cv.parentElement); io.observe(cv); size(); if (reduce()) draw(); } };
  const mo = new MutationObserver(() => { if (cv.isConnected) { cv._start(); mo.disconnect(); } }); mo.observe(document.body, { childList: true, subtree: true });
  return cv;
}
export function effectEl(u) { const s = spec(u && u.eq && u.eq.effect); return s ? effectLayer(s.spec.k, s.spec.c) : null; }

// Full profile card (used in profile views, popups and the market preview)
export function profileCard(u, { compact = false } = {}) {
  const head = h('div.pc-head', bannerEl(u, { height: compact ? 84 : 120 }), effectEl(u), h('div.pc-ava', avatarEl(u, { size: compact ? 70 : 92, status: true })));
  const tt = titleEl(u);
  return h('div.pcard', head, h('div.pc-body',
    h('div.row.wrap', { style: 'gap:8px' }, nameEl(u, { size: compact ? '1.15rem' : '1.4rem' }), badgesEl(u)),
    h('div.muted.small', '@' + (u.username || '?'), tt ? ' · ' : '', tt),
    u.bio ? h('p.pc-bio', u.bio) : null));
}

// Preview an arbitrary catalog item on a sample profile
export function previewItem(item, me) {
  const base = Object.assign({}, me || { username: 'You', displayName: 'You', badges: [], eq: {} });
  const eq = Object.assign({}, base.eq || {}); const cat = item.cat;
  if (cat === 'perk') return h('div.perk-prev', h('div.perk-ic', badgeGlyph(item.spec.icon)), h('div.small.muted', pick2(item.spec.desc)));
  if (cat === 'bubble') { // show the bubble on sample chat messages, the way others will see it
    const who = Object.assign({}, base, { eq: Object.assign({}, eq, { bubble: item.id }) }); const st = bubbleStyle(who);
    const msg = (txt) => h('div.bubprev-row', avatarEl(who, { size: 30 }), h('div', h('div.tiny', nameEl(who)), h('div.bubprev-b', { style: st }, txt)));
    return h('div.bubprev', msg(pick2(['Hi! This is how my messages look ✨', '¡Hola! Así se ven mis mensajes ✨'])), msg(pick2(['In Community chat and in DMs.', 'En el chat de la Comunidad y en los mensajes privados.'])));
  }
  if (cat === 'badge') { eq.badges = [item.id]; } else if (cat === 'title') eq.title = item.id; else eq[cat] = item.id;
  return profileCard(Object.assign(base, { eq, badges: base.badges }), { compact: true });
}
