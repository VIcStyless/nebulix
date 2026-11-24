'use strict';
// Gem shop (13.8): gems finally buy useful things — 24-hour boosts, streak shields, permanent Arena weapon finishes that
// everyone sees, and Nebula Fusion hints. Gems are earned (daily reward, levels, achievements, PRO); never sold for money.
const { S, hub } = require('../state');
const { HttpError, now } = require('../util');
const econ = require('../economy');

const HOUR = 3600000;
const SKINS = { gold: ['Gold', 'Oro'], neon: ['Neon', 'Neón'], carbon: ['Carbon', 'Carbono'], camo: ['Camo', 'Camuflaje'], ice: ['Ice', 'Hielo'] };
const ITEMS = [
  { id: 'boost_xp2', kind: 'boost', boost: 'xp2', hours: 24, gems: 8, n: ['Double XP · 24 h', 'XP doble · 24 h'], d: ['Every action gives twice the XP.', 'Cada acción da el doble de XP.'], ic: 'zap' },
  { id: 'boost_nova', kind: 'boost', boost: 'nova', hours: 24, gems: 5, n: ['Nova turbo · 24 h', 'Nova turbo · 24 h'], d: ['+40 Nova AI messages a day.', '+40 mensajes diarios con Nova IA.'], ic: 'spark' },
  { id: 'boost_arena', kind: 'boost', boost: 'arena', hours: 24, gems: 10, n: ['Arena booster · 24 h', 'Potenciador Arena · 24 h'], d: ['+50% coins in the Arena and a higher daily cap.', '+50 % de monedas en la Arena y más límite diario.'], ic: 'target' },
  { id: 'boost_daily', kind: 'boost', boost: 'daily', hours: 72, gems: 6, n: ['Lucky wheel · 3 days', 'Ruleta de la suerte · 3 días'], d: ['Your daily reward pays double.', 'Tu recompensa diaria paga el doble.'], ic: 'gift' },
  { id: 'shield', kind: 'shield', gems: 10, n: ['Streak shield', 'Protector de racha'], d: ['Saves your daily streak if you miss a day (max 2).', 'Salva tu racha diaria si un día no entras (máx. 2).'], ic: 'shield' },
  { id: 'fusion_hint', kind: 'hint', gems: 3, n: ['Fusion hint', 'Pista de Fusion'], d: ['Shows a pair you can combine for something new.', 'Te enseña una pareja que da algo nuevo.'], ic: 'search' },
  ...Object.entries(SKINS).map(([k, n]) => ({ id: 'skin_' + k, kind: 'skin', skin: k, gems: 30, n: [n[0] + ' weapon finish', 'Acabado ' + n[1].toLowerCase()], d: ['A permanent finish for all your Arena weapons. Everyone sees it.', 'Un acabado permanente para todas tus armas de la Arena. Lo ven todos.'], ic: 'star' })),
];
const BY = new Map(ITEMS.map((x) => [x.id, x]));
const view = (u) => ({ gems: u.gems || 0, items: ITEMS, skins: (u.arenaSkins || []), equipped: u.arenaSkin || null });

function fusionHint(u) {
  const lang = u.lang === 'en' ? 'en' : 'es'; const t = S.store.table('fusion', {}); const w = t[lang]; const f = u.fusion && u.fusion[lang];
  if (!w || !f) return null; const have = new Set(f.found.map((x) => x.toLowerCase()));
  const opts = Object.entries(w.combos).filter(([k, c]) => { const [a, b] = k.split('|'); return have.has(a) && have.has(b) && !have.has(String(c.r).toLowerCase()); });
  if (!opts.length) return null; const [k] = opts[Math.floor(Math.random() * opts.length)]; const [a, b] = k.split('|');
  const name = (x) => f.found.find((y) => y.toLowerCase() === x) || x; return { a: name(a), b: name(b) };
}

module.exports = function register(r) {
  r.get('/api/gems/shop', { auth: true }, async (c) => view(c.user));
  r.post('/api/gems/buy', { auth: true, verified: true, limit: [30, 60000, 'user'] }, async (c) => {
    const u = c.user; const it = BY.get(String(c.body.id || '')); if (!it) throw new HttpError(404, 'no_item', 'Unknown item');
    if (it.kind === 'skin' && (u.arenaSkins || []).includes(it.skin)) throw new HttpError(400, 'owned', 'You already own this finish');
    if (it.kind === 'shield' && ((u.daily && u.daily.freezes) || 0) >= 2) throw new HttpError(400, 'max_freezes', 'You already have the most streak shields');
    let hint = null; if (it.kind === 'hint') { hint = fusionHint(u); if (!hint) throw new HttpError(400, 'no_hint', 'No hint right now: discover a few more elements first'); }
    if (!econ.adjustGems(u, -it.gems, 'shop:' + it.id)) throw new HttpError(402, 'no_gems', 'Not enough gems');
    if (it.kind === 'boost') { u.boosts = u.boosts || {}; u.boosts[it.boost] = Math.max(u.boosts[it.boost] || 0, now()) + it.hours * HOUR; }
    else if (it.kind === 'shield') { u.daily = u.daily || { last: 0, streak: 0 }; u.daily.freezes = (u.daily.freezes || 0) + 1; }
    else if (it.kind === 'skin') { u.arenaSkins = (u.arenaSkins || []).concat(it.skin); u.arenaSkin = it.skin; }
    S.store.touch('users'); try { hub.push(u.id, { t: 'gems', gems: u.gems }); } catch {}
    return Object.assign(view(u), { hint });
  });
  r.post('/api/gems/equip', { auth: true, limit: [30, 60000, 'user'] }, async (c) => {
    const u = c.user; const k = c.body.skin ? String(c.body.skin) : null;
    if (k && !(u.arenaSkins || []).includes(k)) throw new HttpError(400, 'not_owned', 'You do not own that finish');
    u.arenaSkin = k; S.store.touch('users'); return view(u);
  });
};
module.exports.SKINS = SKINS;
