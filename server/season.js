'use strict';
// Season pass: a free 40-tier track that resets every calendar month (UTC). Season points (SP) come from the XP you
// earn anywhere in Nebulix, from daily quests and from 6 weekly challenges. Every tier pays a reward.
// There is no paid track, and gambling never counts: casino bets and wins are not challenges and give no extra SP.
const crypto = require('crypto');
const { S, hub } = require('./state');
const { now, HttpError } = require('./util');

const TIERS = 40; const TIER_SP = 150;
const NAMES = [['Frost Nebula', 'Nebulosa Helada'], ['Neon Hearts', 'Corazones de Neón'], ['Cosmic Bloom', 'Flor Cósmica'], ['Starfall', 'Lluvia de Estrellas'], ['Solar Drift', 'Deriva Solar'], ['Aurora', 'Aurora'],
  ['Supernova', 'Supernova'], ['Tidal Moon', 'Luna de Mareas'], ['Comet Run', 'Carrera de Cometas'], ['Eclipse', 'Eclipse'], ['Dark Matter', 'Materia Oscura'], ['Galaxy Lights', 'Luces Galácticas']];
const seasonId = (t = now()) => new Date(t).toISOString().slice(0, 7);
const seasonEnd = (t = now()) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); };
const seasonName = (id) => NAMES[(Number(id.slice(5, 7)) - 1) % 12];
const weekKey = (t = now()) => { const d = new Date(t); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const weekEnd = () => Date.parse(weekKey() + 'T00:00:00Z') + 7 * 86400000;

// weekly challenge pool: counter key (from progress.js), goal, SP reward, icon, [en, es]
const POOL = [
  ['msgs', 60, 300, '💬', ['Send 60 messages in Community', 'Envía 60 mensajes en la Comunidad']],
  ['arcadeRuns', 15, 300, '🕹️', ['Play 15 Arcade games', 'Juega 15 partidas en el Arcade']],
  ['duels', 4, 300, '⚔️', ['Play 4 duels against friends', 'Juega 4 duelos contra amigos']],
  ['shifts', 10, 300, '💼', ['Work 10 shifts', 'Trabaja 10 turnos']],
  ['trades', 5, 250, '📈', ['Make 5 trades in Invest', 'Haz 5 operaciones en Inversiones']],
  ['lifeActs', 20, 300, '🏡', ['Do 20 things in Life', 'Haz 20 cosas en Vida']],
  ['socialPosts', 4, 300, '📸', ['Post 4 times on Lens, Foros or Echo', 'Publica 4 veces en Lens, Foros o Echo']],
  ['petCare', 12, 250, '🐾', ['Feed or play with your pets 12 times', 'Alimenta o juega con tus mascotas 12 veces']],
  ['dailies', 5, 350, '🎡', ['Claim the daily reward 5 days', 'Recoge la recompensa diaria 5 días']],
  ['chests', 3, 200, '🎁', ['Open 3 chests', 'Abre 3 cofres']],
  ['stockgames', 3, 250, '🕯️', ['Play Market Rush 3 times', 'Juega 3 veces a Market Rush']],
  ['novaMsgs', 10, 200, '🧠', ['Chat 10 times with Nova', 'Habla 10 veces con Nova']],
  ['tracks', 10, 200, '🎵', ['Listen to 10 songs in Pulse', 'Escucha 10 canciones en Pulse']],
  ['donations', 2, 250, '🤝', ['Donate to 2 booths in the Plaza', 'Dona a 2 puestos de la Plaza']],
  ['reacts', 20, 200, '😀', ['React to 20 messages', 'Reacciona a 20 mensajes']],
  ['sites', 10, 150, '🌐', ['Visit 10 sites in the Browser', 'Visita 10 webs en el Navegador']],
];
const WEEKLY = 6;
// tier rewards: coins on every tier, gems every 5, boosts at 10/20/30, a badge at 40
function reward(i) {
  const r = { coins: 250 + i * 50 };
  if (i % 5 === 0) r.gems = 10 + i;
  if (i === 10) r.boost = ['xp2', 24]; if (i === 20) r.boost = ['work', 48]; if (i === 30) r.boost = ['vip', 24];
  if (i === 25) r.chest = 'gold';
  if (i === TIERS) { r.coins = 50000; r.gems = 150; r.badge = true; }
  return r;
}
const REWARDS = Array.from({ length: TIERS }, (_, k) => reward(k + 1));

function st(u) {
  const id = seasonId();
  if (!u.season || u.season.id !== id) { const old = u.season; u.season = { id, sp: 0, claimed: [], wk: null, badges: (old && old.badges) || [] }; }
  const s = u.season; const w = weekKey();
  if (!s.wk || s.wk.w !== w) {
    // deterministic per user and week, so a reload never rerolls
    const ids = POOL.map((p) => ({ k: p[0], r: crypto.createHash('sha256').update(u.id + ':wk:' + w + ':' + p[0]).digest().readUInt32BE(0) })).sort((a, b) => a.r - b.r).slice(0, WEEKLY).map((x) => x.k);
    s.wk = { w, ids, n: {}, done: [] };
  }
  return s;
}
const tierOf = (sp) => Math.min(TIERS, Math.floor(sp / TIER_SP));
function addSp(u, n, why) {
  if (!(n > 0) || !u) return; const s = st(u); const before = tierOf(s.sp); s.sp += Math.round(n); const after = tierOf(s.sp);
  if (after > before) hub.push(u.id, { t: 'notice', text: `⭐ Season tier ${after} reached! Claim your reward in Season.` });
  S.store.touch('users');
}
// called by progress.award for every event (cnt = counter key, xp = XP actually gained)
function onEvent(u, cnt, n, xp) {
  try {
    const s = st(u); if (xp > 0) addSp(u, xp, 'xp');
    const wk = s.wk; if (!wk.ids.includes(cnt) || wk.done.includes(cnt)) return;
    const def = POOL.find((p) => p[0] === cnt); wk.n[cnt] = Math.min(def[1], (wk.n[cnt] || 0) + n);
    if (wk.n[cnt] >= def[1]) { wk.done.push(cnt); addSp(u, def[2], 'weekly'); hub.push(u.id, { t: 'notice', text: `${def[3]} Weekly challenge done: +${def[2]} SP` }); }
    S.store.touch('users');
  } catch (e) { console.error('[season]', e); }
}
function view(u) {
  const s = st(u); const id = s.id; const tier = tierOf(s.sp);
  return {
    id, name: seasonName(id), endsAt: seasonEnd(), weekEndsAt: weekEnd(), sp: s.sp, tier, tiers: TIERS, tierSp: TIER_SP, into: tier >= TIERS ? TIER_SP : s.sp - tier * TIER_SP,
    rewards: REWARDS.map((r, k) => Object.assign({ tier: k + 1, claimed: s.claimed.includes(k + 1), ready: k + 1 <= tier }, r)),
    weekly: s.wk.ids.map((k) => { const p = POOL.find((x) => x[0] === k); return { id: k, goal: p[1], sp: p[2], icon: p[3], n: p[4], have: s.wk.n[k] || 0, done: s.wk.done.includes(k) }; }),
    badges: s.badges, unclaimed: Array.from({ length: tier }, (_, k) => k + 1).filter((t) => !s.claimed.includes(t)).length,
  };
}
function pay(u, t) {
  const r = REWARDS[t - 1]; const econ = require('./economy');
  econ.adjust(u, r.coins, 'season:tier' + t); if (r.gems) econ.adjustGems(u, r.gems, 'season:tier' + t);
  if (r.boost) { const b = (u.boosts = u.boosts || {}); b[r.boost[0]] = Math.max(b[r.boost[0]] || 0, now()) + r.boost[1] * 3600000; }
  if (r.chest) econ.adjust(u, 8000, 'season:golden-chest');
  if (r.badge) { const s = st(u); if (!s.badges.includes(s.id)) s.badges.push(s.id); }
}
function claim(u, which) {
  const s = st(u); const tier = tierOf(s.sp);
  const list = which === 'all' ? Array.from({ length: tier }, (_, k) => k + 1).filter((t) => !s.claimed.includes(t)) : [Math.trunc(Number(which))];
  if (!list.length) throw new HttpError(400, 'nothing', 'Nothing to claim yet');
  for (const t of list) {
    if (!(t >= 1 && t <= TIERS)) throw new HttpError(404, 'no_tier', 'Unknown tier');
    if (t > tier) throw new HttpError(400, 'locked', 'Reach that tier first');
    if (s.claimed.includes(t)) { if (which === 'all') continue; throw new HttpError(409, 'claimed', 'Already claimed'); }
    s.claimed.push(t); pay(u, t);
  }
  S.store.touch('users');
  return Object.assign(view(u), { got: list, coins: u.coins, gems: u.gems });
}
module.exports = { view, claim, onEvent, addSp, TIERS, TIER_SP };
