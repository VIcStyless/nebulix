'use strict';
// Coins, ledger, daily wheel and the cosmetics catalog.
const crypto = require('crypto');
const { S, hub, isPro } = require('./state');
const { now, HttpError } = require('./util');

const MAX_COINS = 1_000_000_000_000_000; // 1000 billones: effectively no limit, still a safe integer for bet × multiplier

function adjust(u, delta, reason) {
  delta = Math.trunc(delta);
  if (!Number.isFinite(delta)) throw new Error('bad delta');
  // The owner can be given a bottomless wallet (u.infinite, set with scripts/infinite-coins.js): every spend succeeds and the balance stays full.
  if (u.infinite) u.coins = MAX_COINS;
  else { if (u.coins + delta < 0) return false; u.coins = Math.min(MAX_COINS, u.coins + delta); }
  u.tx = u.tx || [];
  u.tx.unshift({ t: now(), d: delta, r: reason, b: u.coins });
  if (u.tx.length > 60) u.tx.length = 60;
  S.store.touch('users');
  hub.push(u.id, { t: 'coins', coins: u.coins });
  return true;
}

// ---------------- gems (second currency) ----------------
// Coins: casino, arcade, market, transfers, staff. Gems: premium 3D avatar parts and premium staff,
// Gems are earned (daily reward, levels, achievements, staff, PRO) or exchanged from
// coins one way; they are never sold for real money and never usable in the casino.
const MAX_GEMS = 10_000_000;
const GEM_RATE = 2500; // coins per gem
const GEM_DAY = 40;    // max gems bought with coins per day
function adjustGems(u, delta, reason) {
  delta = Math.trunc(delta);
  if (!Number.isFinite(delta)) throw new Error('bad delta');
  u.gems = u.gems || 0;
  if (u.gems + delta < 0) return false;
  u.gems = Math.min(MAX_GEMS, u.gems + delta);
  u.gtx = u.gtx || []; u.gtx.unshift({ t: now(), d: delta, r: reason, b: u.gems }); if (u.gtx.length > 40) u.gtx.length = 40;
  S.store.touch('users');
  hub.push(u.id, { t: 'gems', gems: u.gems });
  return true;
}
function buyGems(u, n) {
  n = Math.trunc(Number(n));
  if (!Number.isFinite(n) || n < 1 || n > GEM_DAY) throw new HttpError(400, 'bad_amount', `Exchange between 1 and ${GEM_DAY} gems at a time`);
  const key = new Date().toISOString().slice(0, 10);
  const d = (u.gemDay = u.gemDay && u.gemDay.d === key ? u.gemDay : { d: key, n: 0 });
  if (d.n + n > GEM_DAY) throw new HttpError(429, 'daily_cap', `You can exchange up to ${GEM_DAY} gems per day (${GEM_DAY - d.n} left today)`);
  if (u.infinite) throw new HttpError(403, 'infinite', 'Not available for unlimited wallets');
  if (!adjust(u, -n * GEM_RATE, 'gems:exchange')) throw new HttpError(402, 'no_funds', 'Not enough coins');
  d.n += n; adjustGems(u, n, 'exchange');
  return { gems: u.gems, coins: u.coins, left: GEM_DAY - d.n };
}

// ---------------- cosmetics catalog ----------------
// n: [English, Spanish]. Visual specs are rendered by the client (public/js/cosmetics.js).
const items = [];
const add = (cat, id, n, price, spec, extra) => items.push(Object.assign({ id, cat, n, price, spec }, extra || {}));
const rarityOf = (p) => (p <= 90 ? 'common' : p <= 260 ? 'rare' : p <= 520 ? 'epic' : 'legendary');

// Avatar frames
add('frame', 'frame_ring_cyan', ['Cyan Ring', 'Anillo cian'], 60, { k: 'ring', c: ['#5eead4', '#22d3ee'], w: 3 });
add('frame', 'frame_ring_violet', ['Violet Ring', 'Anillo violeta'], 60, { k: 'ring', c: ['#a78bfa', '#c084fc'], w: 3 });
add('frame', 'frame_ring_gold', ['Golden Ring', 'Anillo dorado'], 180, { k: 'ring', c: ['#fde047', '#f59e0b'], w: 4 });
add('frame', 'frame_spin_aurora', ['Aurora Spin', 'Giro aurora'], 250, { k: 'spin', c: ['#34d399', '#60a5fa', '#a78bfa', '#f472b6'], w: 4 });
add('frame', 'frame_spin_fire', ['Inferno', 'Infierno'], 400, { k: 'spin', c: ['#f97316', '#ef4444', '#facc15'], w: 4 });
add('frame', 'frame_pulse_neon', ['Neon Pulse', 'Pulso neón'], 450, { k: 'pulse', c: ['#22d3ee', '#e879f9'], w: 4 });
add('frame', 'frame_dash_orbit', ['Orbit', 'Órbita'], 500, { k: 'dash', c: ['#93c5fd', '#f0abfc'], w: 3 });
add('frame', 'frame_spin_prism', ['Prism', 'Prisma'], 900, { k: 'spin', c: ['#ef4444', '#f59e0b', '#eab308', '#22c55e', '#06b6d4', '#6366f1', '#d946ef'], w: 5 });
add('frame', 'frame_pro_galaxy', ['Galaxy (PRO)', 'Galaxia (PRO)'], 300, { k: 'spin', c: ['#312e81', '#7c3aed', '#38bdf8', '#f0abfc'], w: 5 }, { pro: true });

// Banners
add('banner', 'banner_nebula', ['Nebula', 'Nebulosa'], 40, { g: ['#1e1b4b', '#6d28d9', '#0ea5e9'], a: 135, p: 'stars' });
add('banner', 'banner_sunset', ['Sunset', 'Atardecer'], 60, { g: ['#f97316', '#db2777', '#4c1d95'], a: 160, p: 'none' });
add('banner', 'banner_ocean', ['Deep Ocean', 'Océano profundo'], 60, { g: ['#0c4a6e', '#0891b2', '#5eead4'], a: 120, p: 'waves' });
add('banner', 'banner_forest', ['Mossy Forest', 'Bosque de musgo'], 60, { g: ['#052e16', '#15803d', '#bef264'], a: 140, p: 'dots' });
add('banner', 'banner_synth', ['Synthwave', 'Synthwave'], 150, { g: ['#2e1065', '#be185d', '#fb923c'], a: 180, p: 'grid' });
add('banner', 'banner_aurora', ['Aurora Borealis', 'Aurora boreal'], 200, { g: ['#064e3b', '#10b981', '#6366f1', '#a855f7'], a: 100, p: 'none', an: true });
add('banner', 'banner_cyber', ['Cyber Scan', 'Escáner cíber'], 350, { g: ['#020617', '#0f766e', '#22d3ee'], a: 90, p: 'scan', an: true });
add('banner', 'banner_void', ['The Void', 'El vacío'], 400, { g: ['#000000', '#1e1b4b', '#4c1d95'], a: 150, p: 'stars', an: true });
add('banner', 'banner_inferno', ['Inferno', 'Infierno'], 450, { g: ['#450a0a', '#dc2626', '#fbbf24'], a: 200, p: 'dots', an: true });
add('banner', 'banner_pro_cosmos', ['Cosmos (PRO)', 'Cosmos (PRO)'], 500, { g: ['#020617', '#312e81', '#7c3aed', '#38bdf8', '#f0abfc'], a: 120, p: 'stars', an: true }, { pro: true });

// Name effects
add('nameFx', 'name_cyan', ['Cyan Glow', 'Brillo cian'], 40, { k: 'glow', c: ['#67e8f9'] });
add('nameFx', 'name_gradient_pink', ['Candy Gradient', 'Degradado caramelo'], 140, { k: 'gradient', c: ['#f472b6', '#a78bfa', '#60a5fa'] });
add('nameFx', 'name_gold', ['Gold Shimmer', 'Destello dorado'], 160, { k: 'shimmer', c: ['#fde68a', '#f59e0b', '#fde68a'] });
add('nameFx', 'name_neon', ['Neon Sign', 'Neón'], 300, { k: 'neon', c: ['#f0abfc', '#e879f9'] });
add('nameFx', 'name_rainbow', ['Rainbow', 'Arcoíris'], 450, { k: 'rainbow', c: [] });
add('nameFx', 'name_glitch', ['Glitch', 'Glitch'], 700, { k: 'glitch', c: ['#22d3ee', '#f43f5e'] });

// Profile effects
add('effect', 'fx_sparkles', ['Sparkles', 'Destellos'], 220, { k: 'sparkles', c: '#fde68a' });
add('effect', 'fx_bubbles', ['Bubbles', 'Burbujas'], 230, { k: 'bubbles', c: '#7dd3fc' });
add('effect', 'fx_stars', ['Shooting Stars', 'Estrellas fugaces'], 250, { k: 'stars', c: '#ffffff' });
add('effect', 'fx_snow', ['Snowfall', 'Nevada'], 350, { k: 'snow', c: '#e0f2fe' });
add('effect', 'fx_embers', ['Embers', 'Brasas'], 420, { k: 'embers', c: '#fb923c' });
add('effect', 'fx_matrix', ['Digital Rain', 'Lluvia digital'], 800, { k: 'matrix', c: '#4ade80' });

// Chat bubbles
add('bubble', 'bubble_glass', ['Frosted Glass', 'Cristal esmerilado'], 80, { bg: 'rgba(255,255,255,.07)', bd: 'rgba(255,255,255,.18)', glow: '' });
add('bubble', 'bubble_pixel', ['Pixel Border', 'Borde pixelado'], 200, { bg: 'rgba(0,0,0,.35)', bd: '#a3e635', glow: '', dash: true });
add('bubble', 'bubble_neon', ['Neon Edge', 'Borde neón'], 220, { bg: 'rgba(20,10,50,.5)', bd: '#22d3ee', glow: '#22d3ee' });
add('bubble', 'bubble_royal', ['Royal Velvet', 'Terciopelo real'], 380, { bg: 'rgba(76,29,149,.45)', bd: '#fbbf24', glow: '#fbbf24' });

// Titles
[['Gamer', 'Gamer', 30], ['Speedrunner', 'Speedrunner', 60], ['No-Scope Legend', 'Leyenda sin mira', 90], ['Night Owl', 'Búho nocturno', 60], ['Builder', 'Constructor', 60], ['Ranked Grinder', 'Rankeado', 80], ['Cozy Gamer', 'Gamer cozy', 60], ['PC Nerd', 'Friki del PC', 90]]
  .forEach(([en, es, p], i) => add('title', 'title_' + i, [en, es], p, { text: en, es }));

// Collectible badges
[['🎮', 'Gamer', 'Gamer', 50], ['🌙', 'Night Owl', 'Búho', 80], ['🧪', 'Tinkerer', 'Manitas', 90], ['🔥', 'On Fire', 'En racha', 120], ['🚀', 'Pioneer', 'Pionero', 150], ['🍀', 'Lucky', 'Suertudo', 200], ['🐉', 'Dragon', 'Dragón', 250], ['🏆', 'Champion', 'Campeón', 300], ['👑', 'High Roller', 'Gran apostador', 500], ['💎', 'Diamond Hands', 'Manos de diamante', 600]]
  .forEach(([ic, en, es, p], i) => add('badge', 'badge_' + i, [en, es], p, { icon: ic }));

// Upgrades (permanent abilities, not equippable). PRO members have all of them.
add('perk', 'perk_avatar', ['Custom Profile Picture', 'Foto de perfil personalizada'], 100, { icon: '🖼️', desc: ['Upload your own PNG, JPG or WEBP avatar.', 'Sube tu propio avatar PNG, JPG o WEBP.'], unlocks: 'avatar' });
add('perk', 'perk_avatar_gif', ['Animated Profile Picture', 'Foto de perfil animada (GIF)'], 300, { icon: '🎞️', desc: ['Use an animated GIF or WEBP as your avatar.', 'Usa un GIF o WEBP animado como avatar.'], unlocks: 'avatar_animated' });
add('perk', 'perk_banner_img', ['Custom Banner Image', 'Banner personalizado'], 120, { icon: '🌄', desc: ['Upload your own banner image.', 'Sube tu propia imagen de banner.'], unlocks: 'banner' });
add('perk', 'perk_banner_gif', ['Animated Banner', 'Banner animado (GIF)'], 350, { icon: '🎬', desc: ['Use an animated GIF or WEBP as your banner.', 'Usa un GIF o WEBP animado como banner.'], unlocks: 'banner_animated' });

// ---------------- Nebulix 13: locker items (Taquilla) ----------------
// Sold only in the daily Shop (server/shop.js), which rotates every day; `excl` items are limited exclusives,
// `reward` items are earned (ranked seasons, duels) and never sold. Visual specs are drawn by public/js/locker3d.js.
const L_PRICE = { common: 450, rare: 950, epic: 1700, legendary: 2800, mythic: 6500 };
const L_SETS = [
  // id, [en, es], colour 1, colour 2, rarity, outfit [en, es], top, hat, acc, backpack, pickaxe, glider
  ['astral', ['Astral', 'Astral'], '#7c3aed', '#22d3ee', 'epic', ['Star Drifter', 'Vagabundo estelar'], 'suit', 'halo', 'visor', 'orb', 'crystal', 'wing'],
  ['ember', ['Ember', 'Brasa'], '#ea580c', '#facc15', 'rare', ['Ember Knight', 'Caballero brasa'], 'armor', 'horns', null, 'jet', 'axe', 'kite'],
  ['glacier', ['Glacier', 'Glaciar'], '#38bdf8', '#f0f9ff', 'rare', ['Frost Scout', 'Explorador escarcha'], 'hoodie', 'beanie', 'shades', 'box', 'scythe', 'disc'],
  ['toxic', ['Toxic', 'Tóxico'], '#84cc16', '#1a2e05', 'common', ['Bio Hazard', 'Biopeligro'], 'tee', null, 'visor', 'box', 'hammer', 'canopy'],
  ['royal', ['Royal', 'Real'], '#7e22ce', '#fbbf24', 'legendary', ['Sovereign', 'Soberano'], 'suit', 'crown', 'cape', 'wings', 'scythe', 'wing'],
  ['shadow', ['Shadow', 'Sombra'], '#111827', '#ef4444', 'epic', ['Night Blade', 'Hoja nocturna'], 'hoodie', null, 'shades', 'fin', 'scythe', 'disc'],
  ['coral', ['Coral', 'Coral'], '#f472b6', '#14b8a6', 'common', ['Reef Runner', 'Corredor de arrecife'], 'tee', 'cap', null, 'orb', 'hammer', 'kite'],
  ['circuit', ['Circuit', 'Circuito'], '#22c55e', '#0f172a', 'rare', ['Glitch Runner', 'Corredor glitch'], 'armor', 'headset', 'visor', 'jet', 'crystal', 'canopy'],
  ['solar', ['Solar', 'Solar'], '#fde047', '#f97316', 'legendary', ['Sun Herald', 'Heraldo solar'], 'armor', 'halo', 'wings', 'wings', 'axe', 'wing'],
  ['void', ['Void', 'Vacío'], '#1e1b4b', '#a855f7', 'epic', ['Void Walker', 'Caminante del vacío'], 'suit', 'horns', 'cape', 'fin', 'crystal', 'disc'],
];
const LOCK_CATS = ['outfit', 'backpack', 'pickaxe', 'glider', 'wrap', 'trail', 'emote', 'elim'];
const lAdd = (cat, id, n, rarity, spec, extra) => add(cat, id, n, L_PRICE[rarity] * ({ outfit: 1.6, backpack: 0.8, pickaxe: 0.8, glider: 1, wrap: 0.6, trail: 0.6, emote: 0.7, elim: 0.7 }[cat] || 1), spec, Object.assign({ rarity, shop: true }, extra || {}));
for (const [id, nm, c1, c2, rar, oname, top, hat, acc, bp, pk, gl] of L_SETS) {
  const set = { set: id };
  lAdd('outfit', 'outfit_' + id, oname, rar, { top, hat, acc, topHex: c1, pantsHex: c2 === '#f0f9ff' ? '#0c4a6e' : c2, aura: rar === 'legendary' ? (id === 'solar' ? 'gold' : 'rainbow') : null }, set);
  lAdd('backpack', 'back_' + id, [nm[0] + ' Pack', 'Mochila ' + nm[1]], rar, { k: bp, c: c1, c2 }, set);
  lAdd('pickaxe', 'pick_' + id, [nm[0] + ' Pick', 'Pico ' + nm[1]], rar, { k: pk, c: c1, c2 }, set);
  lAdd('glider', 'glider_' + id, [nm[0] + ' Glider', 'Planeador ' + nm[1]], rar, { k: gl, c: c1, c2 }, set);
  lAdd('wrap', 'wrap_' + id, [nm[0] + ' Wrap', 'Camuflaje ' + nm[1]], rar, { c: c1, c2, metal: rar === 'legendary' || rar === 'epic' }, set);
}
[['spark', ['Cyan Sparks', 'Chispas cian'], '#22d3ee', 'common'], ['embers', ['Embers', 'Ascuas'], '#fb923c', 'rare'], ['stars', ['Stardust', 'Polvo de estrellas'], '#fde68a', 'epic'], ['rainbow', ['Prism Trail', 'Estela prisma'], '#e879f9', 'legendary'], ['smoke', ['Ghost Smoke', 'Humo fantasma'], '#cbd5e1', 'common'], ['hearts', ['Lovestruck', 'Flechazo'], '#f472b6', 'rare']]
  .forEach(([k, n, c, r]) => lAdd('trail', 'trail_' + k, n, r, { k, c }));
[['wave', ['Hello There', 'Hola, hola'], '👋', 'common'], ['dance', ['Groove Machine', 'Máquina de ritmo'], '🕺', 'rare'], ['spin', ['Tornado Spin', 'Giro tornado'], '🌀', 'rare'], ['flex', ['Flex Zone', 'Zona flex'], '💪', 'common'], ['hop', ['Bunny Hop', 'Saltitos'], '🐇', 'common'], ['bow', ['Grand Bow', 'Gran reverencia'], '🎩', 'epic'], ['robot', ['Robo Step', 'Paso robot'], '🤖', 'epic'], ['orbit', ['Orbit Float', 'Flotar en órbita'], '🪐', 'legendary']]
  .forEach(([k, n, ic, r]) => lAdd('emote', 'emote_' + k, n, r, { k, ic }));
[['burst', ['Plasma Burst', 'Estallido de plasma'], '#a855f7', 'rare'], ['pixels', ['Pixel Pop', 'Píxeles'], '#22c55e', 'common'], ['stars', ['Star Shower', 'Lluvia de estrellas'], '#fde047', 'epic'], ['ring', ['Shock Ring', 'Anillo de choque'], '#38bdf8', 'rare'], ['flame', ['Phoenix Flame', 'Llama fénix'], '#f97316', 'legendary']]
  .forEach(([k, n, c, r]) => lAdd('elim', 'elim_' + k, n, r, { k, c }));
// limited exclusives: a few copies per day, and they do not come back for at least 30 days
lAdd('outfit', 'outfit_x_aurora', ['Aurora Prime', 'Aurora Prime'], 'mythic', { top: 'armor', hat: 'halo', acc: 'wings', topHex: '#10b981', pantsHex: '#6366f1', aura: 'rainbow' }, { excl: true, stock: 25 });
lAdd('glider', 'glider_x_comet', ['Comet Rider', 'Jinete del cometa'], 'mythic', { k: 'disc', c: '#f43f5e', c2: '#fde047', fx: true }, { excl: true, stock: 30 });
lAdd('pickaxe', 'pick_x_prism', ['Prism Breaker', 'Rompeprismas'], 'mythic', { k: 'crystal', c: '#e879f9', c2: '#22d3ee', fx: true }, { excl: true, stock: 30 });
lAdd('backpack', 'back_x_halo', ['Halo Engine', 'Motor halo'], 'mythic', { k: 'orb', c: '#fde68a', c2: '#f59e0b', fx: true }, { excl: true, stock: 30 });
lAdd('elim', 'elim_x_supernova', ['Supernova', 'Supernova'], 'mythic', { k: 'flame', c: '#f43f5e' }, { excl: true, stock: 30 });
lAdd('emote', 'emote_x_meteor', ['Meteor Drop', 'Caída de meteorito'], 'mythic', { k: 'orbit', ic: '☄️' }, { excl: true, stock: 30 });
lAdd('outfit', 'outfit_x_obsidian', ['Obsidian Warden', 'Guardián obsidiana'], 'mythic', { top: 'armor', hat: 'horns', acc: 'cape', topHex: '#0b0b10', pantsHex: '#7f1d1d', aura: 'fire' }, { excl: true, stock: 20 });
lAdd('wrap', 'wrap_x_galaxy', ['Galaxy Wrap', 'Camuflaje galaxia'], 'mythic', { c: '#312e81', c2: '#f0abfc', metal: true, fx: true }, { excl: true, stock: 40 });
// earned, never sold: ranked season rewards and duel milestones
lAdd('glider', 'glider_rk_gold', ['Season Glider', 'Planeador de temporada'], 'epic', { k: 'wing', c: '#facc15', c2: '#78350f' }, { reward: true, shop: false });
lAdd('trail', 'trail_rk_diamond', ['Diamond Trail', 'Estela diamante'], 'legendary', { k: 'stars', c: '#60a5fa' }, { reward: true, shop: false });
lAdd('outfit', 'outfit_rk_super', ['Supernova Ace', 'As Supernova'], 'mythic', { top: 'armor', hat: 'crown', acc: 'wings', topHex: '#f97316', pantsHex: '#1e1b4b', aura: 'fire' }, { reward: true, shop: false });
lAdd('wrap', 'wrap_duel', ['Duelist Wrap', 'Camuflaje duelista'], 'epic', { c: '#be123c', c2: '#fde68a', metal: true }, { reward: true, shop: false });
add('title', 'title_rk_nebula', ['Nebula Ranked', 'Nebulosa clasificatoria'], 0, { text: 'Nebula Ranked', es: 'Nebulosa clasificatoria' }, { reward: true });
add('title', 'title_rk_supernova', ['Supernova', 'Supernova'], 0, { text: 'Supernova', es: 'Supernova' }, { reward: true });
add('title', 'title_rk_singularity', ['Singularity', 'Singularidad'], 0, { text: 'Singularity', es: 'Singularidad' }, { reward: true });
add('title', 'title_duelist', ['Duelist', 'Duelista'], 0, { text: 'Duelist', es: 'Duelista' }, { reward: true });
for (const it of items) if (LOCK_CATS.includes(it.cat)) it.price = it.price >= 1000 ? Math.round(it.price / 50) * 50 : Math.round(it.price / 10) * 10;

for (const it of items) it.rarity = it.rarity || rarityOf(it.price);
const byId = new Map(items.map((i) => [i.id, i]));
const SLOTS = { frame: 'frame', banner: 'banner', nameFx: 'nameFx', effect: 'effect', bubble: 'bubble', title: 'title', outfit: 'outfit', backpack: 'backpack', pickaxe: 'pickaxe', glider: 'glider', wrap: 'wrap', trail: 'trail', elim: 'elim' };

function buy(u, id) {
  const it = byId.get(id);
  if (!it) throw new HttpError(404, 'no_item', 'Item not found');
  if (u.inv[id]) throw new HttpError(409, 'owned', 'You already own this item');
  if (it.reward) throw new HttpError(403, 'reward_only', 'This item can only be earned');
  if (it.shop) throw new HttpError(403, 'shop_only', 'This item is sold in the daily Shop');
  if (it.pro && !isPro(u)) throw new HttpError(403, 'pro_only', 'This item is for PRO members');
  const price = require('./market').price(it.price, it.id);
  if (!adjust(u, -price, 'buy:' + id)) throw new HttpError(402, 'no_funds', 'Not enough coins');
  require('./market').demand(it.id);
  u.inv[id] = now();
  u.stats = u.stats || {};
  S.store.touch('users');
  require('./progress').award(u, 'buy');
  return it;
}

// Upgrades: PRO owns them all; everyone else needs to have bought them.
const PERK_FOR = { avatar: 'perk_avatar', avatar_animated: 'perk_avatar_gif', banner: 'perk_banner_img', banner_animated: 'perk_banner_gif' };
function hasPerk(u, perk) {
  if (isPro(u)) return true;
  const id = PERK_FOR[perk];
  if (u.inv && u.inv[id]) return true;
  // the animated upgrade also covers still images
  if (perk === 'avatar' && u.inv && u.inv.perk_avatar_gif) return true;
  if (perk === 'banner' && u.inv && u.inv.perk_banner_gif) return true;
  return false;
}
function requirePerk(u, kind, animated) {
  const perk = animated ? kind + '_animated' : kind;
  if (!hasPerk(u, perk)) {
    const it = byId.get(PERK_FOR[perk]);
    throw new HttpError(403, 'perk_required', `Unlock "${it.n[0]}" in the Market (${it.price} coins) or get PRO`);
  }
}

function equip(u, slot, id) {
  u.eq = u.eq || {};
  if (slot === 'badges') {
    const arr = Array.isArray(id) ? id : [];
    if (arr.length > 3) throw new HttpError(400, 'too_many', 'Up to 3 badges');
    for (const b of arr) { const it = byId.get(b); if (!it || it.cat !== 'badge' || !u.inv[b]) throw new HttpError(403, 'not_owned', 'You do not own that badge'); }
    u.eq.badges = arr; S.store.touch('users'); return;
  }
  if (slot === 'emotes') {
    const arr = Array.isArray(id) ? [...new Set(id.map(String))] : [];
    if (arr.length > 4) throw new HttpError(400, 'too_many', 'Up to 4 emotes');
    for (const b of arr) { const it = byId.get(b); if (!it || it.cat !== 'emote' || !u.inv[b]) throw new HttpError(403, 'not_owned', 'You do not own that emote'); }
    u.eq.emotes = arr; S.store.touch('users'); return;
  }
  if (!SLOTS[slot]) throw new HttpError(400, 'bad_slot', 'Unknown slot');
  if (id === null) { u.eq[slot] = null; S.store.touch('users'); return; }
  const it = byId.get(id);
  if (!it || it.cat !== SLOTS[slot]) throw new HttpError(400, 'bad_item', 'Item does not fit this slot');
  if (!u.inv[id]) throw new HttpError(403, 'not_owned', 'You do not own this item');
  if (it.pro && !isPro(u)) throw new HttpError(403, 'pro_only', 'This item needs an active PRO plan');
  u.eq[slot] = id; S.store.touch('users');
}

// ---------------- daily wheel ----------------
const WHEEL = [10, 15, 20, 25, 30, 40, 60, 150];
const WHEEL_W = [20, 20, 18, 14, 12, 9, 5, 2];
const DAY = 86400000;

const FREEZE_MAX = 2; const FREEZE_PRICE = 750;
function buyFreeze(u) {
  const d = u.daily || (u.daily = { last: 0, streak: 0 }); const have = d.freezes || 0;
  if (have >= FREEZE_MAX) throw new HttpError(400, 'max_freezes', 'You already have the most streak shields');
  if (!adjust(u, -FREEZE_PRICE, 'streak-shield')) throw new HttpError(402, 'no_funds', 'Not enough coins');
  d.freezes = have + 1; S.store.touch('users'); return dailyState(u);
}
function dailyState(u) {
  const d = u.daily || { last: 0, streak: 0 };
  const since = now() - d.last;
  const can = since >= 20 * 3600 * 1000;
  // 13.8 streak shields: each one covers one missed day (bought with coins, up to FREEZE_MAX)
  const freezes = Math.max(0, Math.min(FREEZE_MAX, (u.daily && u.daily.freezes) || 0));
  const missed = d.last && since >= 48 * 3600 * 1000 ? Math.ceil((since - 48 * 3600 * 1000) / DAY) : 0;
  const streakAlive = since < 48 * 3600 * 1000 || (missed > 0 && missed <= freezes);
  const streak = streakAlive ? d.streak : 0;
  return { can, nextAt: can ? 0 : d.last + 20 * 3600 * 1000, streak, bonus: Math.min(streak + (can ? 1 : 0), 7) * 3, wheel: WHEEL, freezes, freezeMax: FREEZE_MAX, freezePrice: FREEZE_PRICE, saving: streakAlive && missed > 0 ? missed : 0 };
}

function claimDaily(u) {
  const st = dailyState(u);
  if (!st.can) throw new HttpError(429, 'too_soon', 'Daily reward is not ready yet');
  const total = WHEEL_W.reduce((a, b) => a + b, 0);
  let r = crypto.randomInt(0, total); let idx = 0;
  for (; idx < WHEEL_W.length; idx++) { if (r < WHEEL_W[idx]) break; r -= WHEEL_W[idx]; }
  const streak = st.streak + 1;
  const bonus = Math.min(streak, 7) * 3;
  const base = WHEEL[idx] * require('./boosts').dailyMult(u);
  adjust(u, base + bonus, 'daily');
  const gems = (streak % 7 === 0 ? 5 : 1) * (isPro(u) ? 2 : 1); adjustGems(u, gems, 'daily');
  u.daily = { last: now(), streak, freezes: Math.max(0, st.freezes - st.saving) };
  S.store.touch('users');
  require('./progress').award(u, 'daily', 1, { streak });
  return { index: idx, base, bonus, streak, total: base + bonus, coins: u.coins, gems, gemsTotal: u.gems };
}

// give an item without charging (shop, gifts, rewards)
function grant(u, id) { const it = byId.get(id); if (!it) return false; u.inv = u.inv || {}; if (u.inv[id]) return false; u.inv[id] = now(); S.store.touch('users'); return true; }
module.exports = { buyFreeze, grant, LOCK_CATS, L_SETS, adjustGems, buyGems, GEM_RATE, GEM_DAY, MAX_GEMS, adjust, items, byId, buy, equip, claimDaily, dailyState, hasPerk, requirePerk, WHEEL, MAX_COINS };
